// Salary Templates (Pay Groups), laid out like Zoho Payroll's. Three modes:
//   list    — Template Name · Description · Status  (+ Create New)
//   detail  — read-only grouped breakdown with Monthly + Annual columns and
//             Cost to Company, plus the statutory list and paid-days rules.
//   builder — a standalone page over the dashboard: "Build your Template" on
//             the left lists the active components by group (click to add),
//             the form on the right holds name, description, Annual CTC, the
//             grouped component table with live amounts, Cost to Company, the
//             statutory list and the paid-days rules.
// Amounts come from the backend preview; components the preview doesn't
// return (reimbursements, benefits) are resolved from their calculation basis.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import {
  DEDUCTION_TRIGGER_LABELS,
  createSalaryTemplate,
  deleteSalaryTemplate,
  getSalaryTemplate,
  getStatutorySettings,
  listPayHeads,
  listSalaryStructures,
  listSalaryTemplates,
  previewSalaryTemplate,
  rupeesToPaise,
  updateSalaryTemplate,
} from '../../services/payroll';
import type {
  CalculationBasis,
  CalculationMode,
  ComputedStructure,
  DeductionTrigger,
  PayHeadDTO,
  PercentageBase,
  SalaryDeductionRule,
  SalaryTemplateDTO,
  SalaryTemplateInput,
  StatutoryOverview,
  TemplateStatutoryWages,
} from '../../services/payroll';
import { getAllEmployees } from '../../services/hrms';
import * as XLSX from 'xlsx';
import { Card, EmptyRow } from '../ui';
import { IconClose, IconPlus } from '../icons';

type Mode = 'list' | 'detail' | 'edit';

/** The CTC the detail page and a fresh builder preview amounts at. */
const SAMPLE_CTC_RUPEES = '1500000';

type Row = {
  payHeadCode: string;
  calcMode: CalculationMode;
  percent: string;
  base: PercentageBase;
  baseComponentCode: string;
  amountRupees: string;
  /** This template's payslip label; blank uses the component's. */
  payslipName: string;
  /** undefined: the component's own setting. */
  showInPayslip?: boolean;
};
type Form = {
  editingCode?: string;
  name: string;
  description: string;
  active: boolean;
  rows: Row[];
  balancingComponentCode: string;
  paidDaysEnabled: boolean;
  statutoryWages: TemplateStatutoryWages | null;
  deductionRules: SalaryDeductionRule[];
  monthlyPaidLeaveDays: number;
  sampleCtc: string;
};

function rowFromCalc(payHeadCode: string, c: CalculationBasis): Row {
  return {
    payHeadCode,
    calcMode: c.mode,
    percent: String(c.percent ?? 50),
    base: c.base ?? 'ctc',
    baseComponentCode: c.baseComponentCode ?? '',
    amountRupees: String((c.amountPaise ?? 0) / 100),
    payslipName: '',
  };
}
function calcFromRow(r: Row): CalculationBasis {
  if (r.calcMode === 'percentage') {
    return {
      mode: 'percentage',
      percent: Number(r.percent) || 0,
      base: r.base,
      ...(r.base === 'component' ? { baseComponentCode: r.baseComponentCode.trim().toUpperCase() } : {}),
    };
  }
  if (r.calcMode === 'flat_per_month') return { mode: 'flat_per_month', amountPaise: rupeesToPaise(r.amountRupees) };
  return { mode: 'flat_amount' };
}
/** A template code from its name, unique among the org's codes: "Senior staff" → SENIOR_STAFF. */
function codeFromName(name: string, taken: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 34) || 'TEMPLATE';
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base}_${i}`;
  return code;
}
function buildInput(f: Form, code: string): SalaryTemplateInput {
  return {
    name: f.name.trim(),
    code,
    description: f.description.trim() || undefined,
    components: f.rows.filter((r) => r.payHeadCode).map((r) => ({
      payHeadCode: r.payHeadCode,
      calculation: calcFromRow(r),
      ...(r.payslipName.trim() ? { payslipName: r.payslipName.trim() } : {}),
      ...(r.showInPayslip !== undefined ? { showInPayslip: r.showInPayslip } : {}),
    })),
    balancingComponentCode: f.balancingComponentCode || null,
    paidDaysEnabled: f.paidDaysEnabled,
    statutoryWages: cleanWages(f.statutoryWages, f.rows.map((r) => r.payHeadCode)),
    deductionRules: f.deductionRules,
    monthlyPaidLeaveDays: f.monthlyPaidLeaveDays,
    active: f.active,
  };
}
function inputFromTemplate(t: SalaryTemplateDTO): SalaryTemplateInput {
  return {
    name: t.name,
    code: t.code,
    description: t.description,
    components: t.components,
    balancingComponentCode: t.balancingComponentCode ?? null,
    paidDaysEnabled: t.paidDaysEnabled ?? true,
    statutoryWages: t.statutoryWages ?? null,
    deductionRules: t.deductionRules ?? [],
    monthlyPaidLeaveDays: t.monthlyPaidLeaveDays ?? 0,
    active: t.active,
  };
}
/** Drop codes no longer on the template, and an empty setting altogether (= the defaults). */
function cleanWages(w: TemplateStatutoryWages | null, codes: string[]): TemplateStatutoryWages | null {
  if (!w) return null;
  const on = new Set(codes);
  const out: TemplateStatutoryWages = {};
  if (w.pfComponents) out.pfComponents = w.pfComponents.filter((c) => on.has(c));
  if (w.esiComponents) out.esiComponents = w.esiComponents.filter((c) => on.has(c));
  if (w.pfWageMode && w.pfWageMode !== 'org') out.pfWageMode = w.pfWageMode;
  return Object.keys(out).length ? out : null;
}

// —— Grouping (mirrors Zoho's sections) ——
type Group = 'earning' | 'reimbursement' | 'fbp' | 'benefit' | 'deduction' | 'onetime';
const GROUP_ORDER: Group[] = ['earning', 'reimbursement', 'fbp', 'benefit', 'deduction', 'onetime'];
const GROUP_LABEL: Record<Group, string> = {
  earning: 'Earnings',
  reimbursement: 'Reimbursements',
  fbp: 'Flexible Benefit Plan Components',
  benefit: 'Benefits',
  deduction: 'Deductions',
  onetime: 'One Time Earnings',
};
const NAV_LABEL: Record<Group, string> = {
  earning: 'EARNINGS',
  reimbursement: 'REIMBURSEMENTS',
  fbp: 'FBP COMPONENTS',
  benefit: 'BENEFITS',
  deduction: 'DEDUCTIONS',
  onetime: 'ONE TIME EARNINGS',
};
function groupOf(ph?: PayHeadDTO): Group {
  if (!ph) return 'earning';
  if (ph.recurrence === 'one_time') return 'onetime';
  if (ph.fbp) return 'fbp';
  if (ph.category === 'reimbursement') return 'reimbursement';
  if (ph.category === 'benefit') return 'benefit';
  if (ph.category === 'deduction') return 'deduction';
  return 'earning';
}

// —— Basic and HRA: the same fixed settings as their Salary Components form ——
/** The one base a fixed earning's percentage may use, or undefined if any base goes. */
function fixedBaseOf(ph?: PayHeadDTO): PercentageBase | undefined {
  if (ph?.category !== 'earning') return undefined;
  if (ph.componentType === 'basic') return 'ctc';
  if (ph.componentType === 'hra') return 'basic';
  return undefined;
}
/** What the earning type pins, as the component form shows it ticked and locked. */
function fixedTagsOf(ph?: PayHeadDTO): string[] {
  if (ph?.category !== 'earning') return [];
  if (ph.componentType === 'basic') return ['Salary structure', 'Taxable', 'Pro-rata', 'EPF always', 'ESI', 'Payslip'];
  if (ph.componentType === 'hra') return ['Salary structure', 'Taxable', 'Payslip'];
  return [];
}
/** A row for a component as first added: Basic and HRA keep to their two choices. */
function rowForAdd(ph: PayHeadDTO): Row {
  const row = rowFromCalc(ph.code, ph.calculation);
  const base = fixedBaseOf(ph);
  if (!base) return row;
  if (row.calcMode === 'percentage' && row.base === base) return row;
  if (row.calcMode === 'flat_per_month') return row;
  return { ...row, calcMode: 'percentage', base, percent: base === 'ctc' ? '50' : '40' };
}
function FixedTags({ ph }: { ph?: PayHeadDTO }) {
  const tags = fixedTagsOf(ph);
  if (!tags.length) return null;
  return (
    <div title="Fixed for this earning type" style={{ fontSize: 12.5, color: '#9197A2', marginTop: 3 }}>
      Fixed: {tags.join(' · ')}
    </div>
  );
}

/** Plain "1,500" (no ₹, no rounding beyond paise). */
function rupees(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
/** "₹7,000.00", as Zoho prints limits. */
function rupees2(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function calcSubtitle(c: CalculationBasis, ph: PayHeadDTO | undefined, isBalancing: boolean, phByCode: Map<string, PayHeadDTO>): string {
  if (ph?.category === 'reimbursement' && ph.maxClaimablePaise) return `Max Limit : ${rupees2(ph.maxClaimablePaise)}  |  Monthly Carry Forward`;
  if (groupOf(ph) === 'fbp' && c.mode === 'flat_per_month') return `Max Limit : ${rupees2(c.amountPaise ?? 0)}`;
  if (isBalancing) return 'Monthly CTC - Sum of all other components';
  if (c.mode === 'percentage') {
    const baseLbl = c.base === 'ctc' ? 'Fixed CTC' : c.base === 'basic' ? 'Basic Amount' : phByCode.get(c.baseComponentCode ?? '')?.name ?? 'component';
    return `(${(c.percent ?? 0).toFixed(2)} % of ${baseLbl})`;
  }
  if (c.mode === 'flat_per_month') return `₹${rupees(c.amountPaise ?? 0)} / month`;
  if (c.mode === 'flat_amount') return 'Fixed amount';
  return '';
}

/** Build a code→{monthly,annual} map plus resolvers from a computed preview. */
function amountResolver(computed: ComputedStructure | null, payHeadsList: PayHeadDTO[], fallbackCtc: string) {
  const map = new Map<string, { monthly: number; annual: number }>();
  if (computed) {
    for (const e of computed.earnings) map.set(e.code, { monthly: e.monthlyPaise, annual: e.annualPaise });
    for (const d of computed.deductions) map.set(d.code, { monthly: d.monthlyPaise, annual: d.annualPaise });
    for (const x of [...(computed.reimbursements ?? []), ...(computed.benefits ?? [])]) map.set(x.code, { monthly: x.monthlyPaise, annual: x.annualPaise });
  }
  const ctcMonthly = computed?.monthlyCtcPaise ?? Math.round(rupeesToPaise(fallbackCtc) / 12);
  const basicCode = payHeadsList.find((p) => p.componentType === 'basic')?.code;
  const basicMonthly = basicCode ? map.get(basicCode)?.monthly ?? 0 : 0;
  const resolve = (code: string, c: CalculationBasis): { monthly: number; annual: number } => {
    const hit = map.get(code);
    if (hit) return hit;
    if (c.mode === 'flat_per_month') { const m = c.amountPaise ?? 0; return { monthly: m, annual: m * 12 }; }
    if (c.mode === 'flat_amount') { const m = c.amountPaise ?? 0; return { monthly: 0, annual: m }; }
    if (c.mode === 'percentage') {
      const base = c.base === 'ctc' ? ctcMonthly : c.base === 'basic' ? basicMonthly : map.get(c.baseComponentCode ?? '')?.monthly ?? 0;
      const m = Math.round((base * (c.percent ?? 0)) / 100);
      return { monthly: m, annual: m * 12 };
    }
    return { monthly: 0, annual: 0 };
  };
  return { resolve };
}

export function SalaryTemplates() {
  const { flash } = useStore();
  const [mode, setMode] = useState<Mode>('list');
  const [templates, setTemplates] = useState<SalaryTemplateDTO[]>([]);
  const [payHeadsList, setPayHeadsList] = useState<PayHeadDTO[]>([]);
  const [statutory, setStatutory] = useState<StatutoryOverview | null>(null);
  const [loading, setLoading] = useState(true);

  // detail
  const [detailTpl, setDetailTpl] = useState<SalaryTemplateDTO | null>(null);
  const [detailComputed, setDetailComputed] = useState<ComputedStructure | null>(null);

  // builder
  const [form, setForm] = useState<Form | null>(null);
  const [computed, setComputed] = useState<ComputedStructure | null>(null);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      // The statutory list is decoration here; don't hold the templates for it.
      void getStatutorySettings().then(setStatutory).catch(() => setStatutory(null));
      const [ts, phs] = await Promise.all([listSalaryTemplates(), listPayHeads()]);
      setTemplates(ts);
      setPayHeadsList(phs);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load templates', 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phByCode = useMemo(() => new Map(payHeadsList.map((p) => [p.code, p])), [payHeadsList]);
  const earningCodesInForm = (f: Form) =>
    f.rows.filter((r) => r.payHeadCode && phByCode.get(r.payHeadCode)?.category === 'earning').map((r) => r.payHeadCode);

  // —— Builder: live preview whenever the form changes ——
  useEffect(() => {
    if (mode !== 'edit' || !form) return;
    if (debounce.current) clearTimeout(debounce.current);
    const snapshot = form;
    debounce.current = setTimeout(async () => {
      const input = buildInput(snapshot, snapshot.editingCode ?? 'PREVIEW');
      if (input.components.length === 0) {
        setComputed(null);
        return;
      }
      try {
        setComputed(await previewSalaryTemplate({ ...input, sampleAnnualCtcPaise: rupeesToPaise(snapshot.sampleCtc) }));
      } catch {
        /* invalid intermediate state — keep last good preview */
      }
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(form), mode]);

  const openDetail = async (code: string) => {
    try {
      const t = await getSalaryTemplate(code);
      setDetailTpl(t);
      setDetailComputed(null);
      setMode('detail');
      // Amounts for the detail columns, at the sample CTC.
      void previewSalaryTemplate({ ...inputFromTemplate(t), sampleAnnualCtcPaise: rupeesToPaise(SAMPLE_CTC_RUPEES) })
        .then(setDetailComputed)
        .catch(() => setDetailComputed(null));
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load template', 'error');
    }
  };

  const newTemplate = () => {
    setForm({ name: '', description: '', active: true, rows: [], balancingComponentCode: '', paidDaysEnabled: true, statutoryWages: null, deductionRules: [], monthlyPaidLeaveDays: 0, sampleCtc: SAMPLE_CTC_RUPEES });
    setComputed(null);
    setMode('edit');
  };
  const editCurrent = () => {
    const t = detailTpl;
    if (!t) return;
    setForm({
      editingCode: t.code,
      name: t.name,
      description: t.description ?? '',
      active: t.active,
      // A component deleted from the catalog can't be saved back: leave it out.
      rows: t.components.filter((c) => phByCode.has(c.payHeadCode)).map((c) => ({ ...rowFromCalc(c.payHeadCode, c.calculation), payslipName: c.payslipName ?? '', showInPayslip: c.showInPayslip })),
      balancingComponentCode: t.balancingComponentCode ?? '',
      paidDaysEnabled: t.paidDaysEnabled ?? true,
      statutoryWages: t.statutoryWages ?? null,
      deductionRules: t.deductionRules ?? [],
      monthlyPaidLeaveDays: t.monthlyPaidLeaveDays ?? 0,
      sampleCtc: SAMPLE_CTC_RUPEES,
    });
    const orphans = t.components.filter((c) => !phByCode.has(c.payHeadCode)).map((c) => c.payHeadCode);
    if (orphans.length) flash(`${orphans.join(', ')} ${orphans.length === 1 ? 'is' : 'are'} no longer a salary component and ${orphans.length === 1 ? 'was' : 'were'} left out`, 'error');
    setComputed(null);
    setMode('edit');
  };
  const closeBuilder = () => {
    const code = form?.editingCode;
    setForm(null);
    if (code) void openDetail(code);
    else setMode('list');
  };

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) return flash('Enter a template name');
    if (form.rows.filter((r) => r.payHeadCode).length === 0) return flash('Add at least one component');
    setSaving(true);
    try {
      const code = form.editingCode ?? codeFromName(form.name, new Set(templates.map((t) => t.code)));
      const input = buildInput(form, code);
      if (form.editingCode) await updateSalaryTemplate(form.editingCode, input);
      else await createSalaryTemplate(input);
      flash(`Template "${input.name}" saved`);
      await load();
      setForm(null);
      void openDetail(code);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save template', 'error');
    } finally {
      setSaving(false);
    }
  };

  const exportEmployees = (t: SalaryTemplateDTO) => exportEmployeesOnTemplate(t, flash);

  const remove = async () => {
    if (!form?.editingCode) return;
    setSaving(true);
    try {
      await deleteSalaryTemplate(form.editingCode);
      flash('Template deleted');
      setForm(null);
      setMode('list');
      await load();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not delete template', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ——————————————————————————————— LIST ———————————————————————————————
  if (mode === 'list') {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button onClick={newTemplate} style={primaryBtn}><IconPlus size={15} /> Create New</button>
        </div>
        <Card>
          {loading ? (
            <EmptyRow text="Loading…" />
          ) : templates.length === 0 ? (
            <EmptyRow text="No salary templates yet — create your first pay group." />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr><Th>Template Name</Th><Th>Description</Th><Th>Status</Th></tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.code} onClick={() => openDetail(t.code)} style={{ cursor: 'pointer' }}>
                    <Td><strong style={{ color: '#0571A6' }}>{t.name}</strong></Td>
                    <Td muted>{t.description || '—'}</Td>
                    <Td><StatusText on={t.active} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    );
  }

  // ——————————————————————————————— DETAIL ———————————————————————————————
  if (mode === 'detail' && detailTpl) {
    const t = detailTpl;
    const { resolve } = amountResolver(detailComputed, payHeadsList, SAMPLE_CTC_RUPEES);

    const buckets = new Map<Group, { comp: { payHeadCode: string; calculation: CalculationBasis }; ph?: PayHeadDTO }[]>();
    for (const comp of t.components) {
      const ph = phByCode.get(comp.payHeadCode);
      const g = groupOf(ph);
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g)!.push({ comp, ph });
    }
    const hasOneTime = (buckets.get('onetime')?.length ?? 0) > 0;
    const costMonthly = detailComputed?.employerCostMonthlyPaise ?? 0;

    return (
      <div>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 22px', borderBottom: '1px solid #EBEBEB' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-.2px', color: '#222222' }}>{t.name} - Salary Template</div>
              <div style={{ fontSize: 13, color: '#9197A2', marginTop: 2 }}>
                {t.description ? `${t.description} · ` : ''}Amounts shown for a sample CTC of ₹{rupees(rupeesToPaise(SAMPLE_CTC_RUPEES))} a year
              </div>
            </div>
            <StatusText on={t.active} />
            <button onClick={editCurrent} style={{ ...primaryBtn, padding: '7px 14px', fontSize: 14 }}>Edit</button>
            <button onClick={() => void exportEmployees(t)} title="Export employees (Excel)" style={{ ...ghostBtn, padding: '7px 12px', fontSize: 14 }}>···</button>
            <button onClick={() => setMode('list')} title="Close" style={{ ...ghostBtn, padding: '7px 11px', fontSize: 14, display: 'inline-flex' }}><IconClose size={14} /></button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
            <thead>
              <tr>
                <th style={detTh}>Salary Components</th>
                <th style={{ ...detTh, textAlign: 'right', width: 200 }}>Monthly Amount</th>
                <th style={{ ...detTh, textAlign: 'right', width: 200 }}>Annual Amount</th>
              </tr>
            </thead>
            <tbody>
              {GROUP_ORDER.filter((g) => g !== 'onetime' && buckets.get(g)?.length).map((g) => (
                <GroupRows key={g} label={GROUP_LABEL[g]} cols={3}>
                  {buckets.get(g)!.map(({ comp, ph }) => {
                    const isBalancing = comp.payHeadCode === t.balancingComponentCode;
                    const amt = resolve(comp.payHeadCode, comp.calculation);
                    return (
                      <tr key={comp.payHeadCode}>
                        <td style={detTd}>
                          <div style={{ fontWeight: 600, color: '#222222' }}>{ph?.name ?? comp.payHeadCode}</div>
                          <div style={{ fontSize: 12.5, color: '#717171', marginTop: 2 }}>{calcSubtitle(comp.calculation, ph, isBalancing, phByCode)}</div>
                          <FixedTags ph={ph} />
                        </td>
                        <td style={numTd}>₹{rupees(amt.monthly)}</td>
                        <td style={numTd}>₹{rupees(amt.annual)}</td>
                      </tr>
                    );
                  })}
                </GroupRows>
              ))}
              {hasOneTime && (
                <>
                  <tr>
                    <td style={{ ...detTd, fontWeight: 700 }}>Fixed CTC <span style={{ fontWeight: 500, color: '#717171' }}>(Annual CTC - One Time Earnings)</span></td>
                    <td style={numTd} />
                    <td style={numTd}>₹{rupees(detailComputed?.annualCtcPaise ?? 0)}</td>
                  </tr>
                  <GroupRows label={GROUP_LABEL.onetime} cols={3}>
                    {buckets.get('onetime')!.map(({ comp, ph }) => (
                      <tr key={comp.payHeadCode}>
                        <td style={detTd}><div style={{ fontWeight: 600, color: '#222222' }}>{ph?.name ?? comp.payHeadCode}</div></td>
                        <td style={numTd} />
                        <td style={numTd}>₹{rupees(resolve(comp.payHeadCode, comp.calculation).annual)}</td>
                      </tr>
                    ))}
                  </GroupRows>
                </>
              )}
              <TotalRow monthly={costMonthly} cols={3} />
            </tbody>
          </table>
          <StatutoryList overview={statutory} computed={detailComputed} />
          <WagesSummary wages={t.statutoryWages ?? null} phByCode={phByCode} />
        </Card>

        <RulesSummary enabled={t.paidDaysEnabled ?? true} rules={t.deductionRules ?? []} paidLeaveDays={t.monthlyPaidLeaveDays ?? 0} />
      </div>
    );
  }

  // ——————————————————————————————— BUILDER (standalone page) ———————————————————————————————
  if (!form) return null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const setByCode = (code: string, patch: Partial<Row>) => set('rows', form.rows.map((r) => (r.payHeadCode === code ? { ...r, ...patch } : r)));
  const removeByCode = (code: string) =>
    setForm({ ...form, rows: form.rows.filter((r) => r.payHeadCode !== code), balancingComponentCode: form.balancingComponentCode === code ? '' : form.balancingComponentCode });
  const addComponent = (code: string) => {
    const ph = phByCode.get(code);
    if (!ph) return;
    set('rows', [...form.rows, rowForAdd(ph)]);
  };
  const usedCodes = new Set(form.rows.map((r) => r.payHeadCode).filter(Boolean));
  const balancingOptions = earningCodesInForm(form);
  const unused = payHeadsList.filter((p) => p.active && !usedCodes.has(p.code));
  const { resolve } = amountResolver(computed, payHeadsList, form.sampleCtc);

  const rowBuckets = new Map<Group, Row[]>();
  for (const r of form.rows) {
    if (!r.payHeadCode) continue;
    const g = groupOf(phByCode.get(r.payHeadCode));
    if (!rowBuckets.has(g)) rowBuckets.set(g, []);
    rowBuckets.get(g)!.push(r);
  }
  const costMonthly = computed?.employerCostMonthlyPaise ?? 0;

  return (
    <div style={builderPage}>
      <ComponentNav unused={unused} onPick={addComponent} />

      <div style={{ overflowY: 'auto', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 36px 18px', borderBottom: '1px solid #EBEBEB' }}>
          <div style={{ fontSize: 26, fontWeight: 600, color: '#222222', letterSpacing: '-.2px' }}>{form.editingCode ? 'Edit Salary Template' : 'New Salary Template'}</div>
          <button onClick={closeBuilder} title="Close" style={closeCircle}><IconClose size={16} /></button>
        </div>

        <div style={{ padding: '24px 36px 40px', maxWidth: 1240 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '340px 470px', gap: 40, marginBottom: 26 }}>
            <Field label="Template Name" required><input value={form.name} onChange={(e) => set('name', e.target.value)} style={input} /></Field>
            <Field label="Description">
              <textarea value={form.description} maxLength={500} placeholder="Max 500 Characters" onChange={(e) => set('description', e.target.value)} rows={2} style={{ ...input, resize: 'vertical', minHeight: 54 }} />
            </Field>
          </div>

          <div style={builderCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap', padding: '26px 36px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#222222', width: 230 }}>Annual CTC</div>
                <CtcInput value={form.sampleCtc} onChange={(v) => set('sampleCtc', v)} />
              </div>
              <div style={{ fontSize: 12.5, color: '#9197A2', maxWidth: 360 }}>Used to preview the amounts below. Each person's own CTC is set when the template is assigned to them.</div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18 }}>
                <label style={{ ...checkRow, fontWeight: 600 }}>
                  Balancing component
                  <select value={form.balancingComponentCode} onChange={(e) => set('balancingComponentCode', e.target.value)} style={{ ...input, width: 200 }}>
                    <option value="">None</option>
                    {balancingOptions.map((code) => <option key={code} value={code}>{phByCode.get(code)?.name ?? code}</option>)}
                  </select>
                </label>
                <label style={checkRow}><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active</label>
              </div>
            </div>

            <div style={{ margin: '0 36px', border: '1px solid #EBEBEB', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
                <thead>
                  <tr>
                    <th style={{ ...bldTh, width: '32%' }}>Salary Components</th>
                    <th style={{ ...bldTh, width: '38%' }}>Calculation Type</th>
                    <th style={{ ...bldTh, textAlign: 'right' }}>Monthly Amount</th>
                    <th style={{ ...bldTh, textAlign: 'right' }}>Annual Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {form.rows.length === 0 && (
                    <tr><td colSpan={4} style={{ ...detTd, textAlign: 'center', color: '#9197A2', padding: '30px' }}>Click a component on the left to add it to the template.</td></tr>
                  )}
                  {GROUP_ORDER.filter((g) => rowBuckets.get(g)?.length).map((g) => (
                    <GroupRows key={g} label={GROUP_LABEL[g]} cols={4} big>
                      {rowBuckets.get(g)!.map((r) => {
                        const ph = phByCode.get(r.payHeadCode);
                        const isBalancing = r.payHeadCode === form.balancingComponentCode;
                        const amt = resolve(r.payHeadCode, calcFromRow(r));
                        return (
                          <tr key={r.payHeadCode}>
                            <td style={bldTd}>
                              <div style={{ fontWeight: 600, color: '#222222' }}>{ph?.name ?? r.payHeadCode}{isBalancing && <span title="Takes whatever is left of the monthly CTC" style={{ color: '#9197A2', marginLeft: 6, fontSize: 13 }}>ⓘ</span>}</div>
                              {ph?.category === 'reimbursement' && ph.maxClaimablePaise ? (
                                <div style={{ fontSize: 13, color: '#717171', marginTop: 2 }}>Max Limit : {rupees2(ph.maxClaimablePaise)}</div>
                              ) : isBalancing ? (
                                <div style={{ fontSize: 13, color: '#717171', marginTop: 2 }}>Monthly CTC - Sum of all other components</div>
                              ) : null}
                              <FixedTags ph={ph} />
                              <PayslipLabel r={r} ph={ph} onChange={(patch) => setByCode(r.payHeadCode, patch)} />
                            </td>
                            <td style={bldTd}>
                              <CalcCell r={r} isBalancing={isBalancing} form={form} phByCode={phByCode} setByCode={setByCode} />
                            </td>
                            <td style={{ ...bldTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{g === 'onetime' ? '—' : rupees(amt.monthly)}</td>
                            <td style={{ ...bldTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                                <span>{rupees(amt.annual)}</span>
                                <button onClick={() => removeByCode(r.payHeadCode)} title="Remove" style={iconBtn}><IconClose size={14} /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </GroupRows>
                  ))}
                  <tr>
                    <td colSpan={4} style={{ padding: '18px 20px 20px' }}>
                      <div style={ctcBand}>
                        <span>Cost to Company</span>
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 120 }}>
                          <span>₹{rupees(costMonthly)}</span>
                          <span>₹{rupees(costMonthly * 12)}</span>
                        </span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ margin: '18px 36px 0' }}>
              <StatutoryList overview={statutory} computed={computed} flat />
            </div>

            <div style={{ margin: '18px 36px 0' }}>
              <WagesCard
                wages={form.statutoryWages}
                onChange={(w) => set('statutoryWages', w)}
                earnings={balancingOptions}
                phByCode={phByCode}
                pfWagePaise={computed?.pfWagePaise}
              />
            </div>

            <div style={{ margin: '18px 36px 0' }}>
              <RulesCard
                enabled={form.paidDaysEnabled}
                onEnabled={(v) => set('paidDaysEnabled', v)}
                rules={form.deductionRules}
                onChange={(rules) => set('deductionRules', rules)}
                paidLeaveDays={form.monthlyPaidLeaveDays}
                onPaidLeaveDays={(v) => set('monthlyPaidLeaveDays', v)}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '26px 36px 30px' }}>
              <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={closeBuilder} style={ghostBtn}>Cancel</button>
              {form.editingCode && <button onClick={remove} disabled={saving} style={{ ...ghostBtn, marginLeft: 'auto', color: '#A8475F', borderColor: '#EBD9DE' }}>Delete</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// —— PF and ESI wages for this template ————————————————————————————————
// Default (nothing chosen): each component's own "Consider for EPF", the
// org's PF setting, and ESI on gross pay — exactly how payroll worked before.
const defaultPfCodes = (earnings: string[], phByCode: Map<string, PayHeadDTO>) =>
  earnings.filter((c) => phByCode.get(c)?.considerForEpf?.consider === true);
function WagesCard({ wages, onChange, earnings, phByCode, pfWagePaise }: {
  wages: TemplateStatutoryWages | null;
  onChange: (w: TemplateStatutoryWages | null) => void;
  earnings: string[];
  phByCode: Map<string, PayHeadDTO>;
  pfWagePaise?: number;
}) {
  const w = wages ?? {};
  const pfCustom = Array.isArray(w.pfComponents);
  const esiCustom = Array.isArray(w.esiComponents);
  const pfCodes = pfCustom ? w.pfComponents! : defaultPfCodes(earnings, phByCode);
  const esiCodes = esiCustom ? w.esiComponents! : earnings;
  const patch = (p: Partial<TemplateStatutoryWages>) => {
    const next: TemplateStatutoryWages = { ...w, ...p };
    for (const k of Object.keys(next) as (keyof TemplateStatutoryWages)[]) if (next[k] === undefined) delete next[k];
    onChange(Object.keys(next).length ? next : null);
  };
  const toggle = (list: string[], code: string) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);
  const name = (code: string) => phByCode.get(code)?.name ?? code;
  return (
    <div style={{ border: '1px solid #EBEBEB', borderRadius: 8, padding: '16px 20px', background: '#fff' }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.03em', textTransform: 'uppercase', color: '#717171' }}>PF and ESI wages</div>
      <div style={{ fontSize: 13, color: '#9197A2', marginTop: 2 }}>Which earnings on this template count toward the PF and ESI wage. Left on the defaults, payroll works exactly as before.</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginTop: 14 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>PF wage</div>
          <label style={checkRow}><input type="radio" checked={!pfCustom} onChange={() => patch({ pfComponents: undefined })} /> Each component’s own “Consider for EPF”</label>
          <label style={checkRow}><input type="radio" checked={pfCustom} onChange={() => patch({ pfComponents: defaultPfCodes(earnings, phByCode) })} /> Choose for this template</label>
          <div style={{ marginLeft: 22, marginTop: 4 }}>
            {earnings.map((code) => (
              <label key={code} style={{ ...checkRow, opacity: pfCustom ? 1 : 0.6 }}>
                <input type="checkbox" disabled={!pfCustom} checked={pfCodes.includes(code)} onChange={() => patch({ pfComponents: toggle(pfCodes, code) })} /> {name(code)}
              </label>
            ))}
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, margin: '12px 0 6px' }}>PF contribution</div>
          <select value={w.pfWageMode ?? 'org'} onChange={(e) => patch({ pfWageMode: e.target.value === 'org' ? undefined : (e.target.value as 'actual' | 'ceiling') })} style={{ ...input, width: 340 }}>
            <option value="org">As set in Statutory Components</option>
            <option value="ceiling">12% of PF wage, capped at the ceiling</option>
            <option value="actual">12% of the actual PF wage (no cap)</option>
          </select>
          {pfWagePaise !== undefined && <div style={{ fontSize: 12.5, color: '#717171', marginTop: 6 }}>PF wage at the preview CTC: ₹{rupees(pfWagePaise)} a month</div>}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>ESI wage</div>
          <label style={checkRow}><input type="radio" checked={!esiCustom} onChange={() => patch({ esiComponents: undefined })} /> Gross pay (every earning)</label>
          <label style={checkRow}><input type="radio" checked={esiCustom} onChange={() => patch({ esiComponents: earnings })} /> Choose for this template</label>
          <div style={{ marginLeft: 22, marginTop: 4 }}>
            {earnings.map((code) => (
              <label key={code} style={{ ...checkRow, opacity: esiCustom ? 1 : 0.6 }}>
                <input type="checkbox" disabled={!esiCustom} checked={esiCodes.includes(code)} onChange={() => patch({ esiComponents: toggle(esiCodes, code) })} /> {name(code)}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: '#717171', marginTop: 6 }}>ESI applies while this wage is ₹21,000 a month or less, and is taken on it.</div>
        </div>
      </div>
    </div>
  );
}
function WagesSummary({ wages, phByCode }: { wages: TemplateStatutoryWages | null; phByCode: Map<string, PayHeadDTO> }) {
  const names = (codes: string[]) => (codes.length ? codes.map((c) => phByCode.get(c)?.name ?? c).join(', ') : 'none');
  const pf = wages?.pfComponents ? names(wages.pfComponents) : 'each component’s own setting';
  const mode = wages?.pfWageMode === 'actual' ? 'on the actual wage' : wages?.pfWageMode === 'ceiling' ? 'capped at the ceiling' : 'as set in Statutory Components';
  const esi = wages?.esiComponents ? names(wages.esiComponents) : 'gross pay';
  return (
    <div style={{ padding: '12px 20px', fontSize: 14, color: '#484848', borderTop: '1px solid #F0F0F2' }}>
      <strong>PF wage:</strong> {pf} · PF {mode} · <strong>ESI wage:</strong> {esi}
    </div>
  );
}

// How a component reads on this template's payslips, and whether it is listed
// at all. Blank / unchanged uses the component's own payslip name and setting.
function PayslipLabel({ r, ph, onChange }: { r: Row; ph?: PayHeadDTO; onChange: (patch: Partial<Row>) => void }) {
  const shown = r.showInPayslip ?? ph?.showInPayslip !== false;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12.5, color: '#717171' }}>
      <span>On payslip as</span>
      <input
        value={r.payslipName}
        placeholder={ph?.payslipName || ph?.name || r.payHeadCode}
        onChange={(e) => onChange({ payslipName: e.target.value })}
        disabled={!shown}
        style={{ ...input, width: 170, padding: '3px 7px', fontSize: 12.5 }}
      />
      <label title="Hidden components still count in every total" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input type="checkbox" checked={!shown} onChange={(e) => onChange({ showInPayslip: !e.target.checked })} /> Hide
      </label>
    </div>
  );
}

// ——————————————————————————————— BUILD YOUR TEMPLATE (left nav) ———————————————————————————————
// The active components not yet on the template, by group. Clicking one adds it.
function ComponentNav({ unused, onPick }: { unused: PayHeadDTO[]; onPick: (code: string) => void }) {
  const [open, setOpen] = useState<Set<Group>>(() => new Set<Group>(['earning']));
  const toggle = (g: Group) => setOpen((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  return (
    <div style={{ borderRight: '1px solid #EBEBEB', padding: '26px 26px 30px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#222222' }}>Build your Template</div>
      <div style={{ fontSize: 15.5, color: '#484848', marginTop: 4, marginBottom: 22 }}>Include active salary components</div>
      {GROUP_ORDER.map((g) => {
        const items = unused.filter((p) => groupOf(p) === g);
        const isOpen = open.has(g);
        return (
          <div key={g} style={{ marginBottom: 6 }}>
            <button type="button" onClick={() => toggle(g)} style={navGroupBtn}>
              <span>{NAV_LABEL[g]}</span>
              <span style={{ color: '#717171', fontSize: 16, transform: isOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' }}>›</span>
            </button>
            {isOpen && (
              <div style={{ padding: '2px 0 10px' }}>
                {items.length === 0 && <div style={{ fontSize: 13.5, color: '#9197A2', padding: '6px 0' }}>Nothing left to add</div>}
                {items.map((p) => (
                  <button key={p.code} type="button" onClick={() => onPick(p.code)} style={navItemBtn}>{p.name}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ marginTop: 'auto', paddingTop: 30, textAlign: 'center', color: '#9197A2', fontSize: 15, fontStyle: 'italic', lineHeight: 1.5 }}>
        <div style={{ fontSize: 22, marginBottom: 2 }}>↗</div>
        Click on a component to<br />add it to the template
      </div>
    </div>
  );
}

// ——————————————————————————————— PAID DAYS ———————————————————————————————
// How attendance costs paid days for the people on this template. A payroll
// run reads each person's attendance calendar and turns the month's late
// arrivals, early leaves and absences into loss-of-pay days with these; the
// slip shows the deduction. The whole thing can be switched off per template.

const TRIGGERS = Object.keys(DEDUCTION_TRIGGER_LABELS) as DeductionTrigger[];
const ruleText = (rule: SalaryDeductionRule) =>
  `Every ${rule.every} → ${rule.deductDays} paid ${rule.deductDays === 1 ? 'day' : 'days'}`;

function RulesCard({ enabled, onEnabled, rules, onChange, paidLeaveDays, onPaidLeaveDays }: {
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  rules: SalaryDeductionRule[];
  onChange: (rules: SalaryDeductionRule[]) => void;
  paidLeaveDays: number;
  onPaidLeaveDays: (v: number) => void;
}) {
  const [draft, setDraft] = useState<SalaryDeductionRule>({ trigger: 'late', every: 3, deductDays: 1, active: true });
  const update = (index: number, patch: Partial<SalaryDeductionRule>) => onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', borderBottom: '1px solid #EBEBEB' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Paid days calculation</div>
          <div style={{ fontSize: 13, color: '#717171', marginTop: 2 }}>Read from each person's attendance calendar when payroll runs</div>
        </div>
        <div style={toggleWrap}>
          {[true, false].map((v) => (
            <button key={String(v)} type="button" onClick={() => onEnabled(v)} style={toggleBtn(enabled === v, v)}>{v ? 'Enabled' : 'Disabled'}</button>
          ))}
        </div>
      </div>
      {!enabled ? (
        <div style={{ padding: '16px 22px', color: '#717171', fontSize: 15 }}>Off for this template: every working day is paid, whatever the attendance calendar shows.</div>
      ) : (
        <>
          {rules.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
              <thead><tr><th style={detTh}>Counts</th><th style={detTh}>Rule</th><th style={{ ...detTh, width: 130 }}>Active</th><th style={{ ...detTh, width: 90 }} /></tr></thead>
              <tbody>
                {rules.map((rule, index) => (
                  <tr key={index}>
                    <td style={ruleTd}><strong style={{ color: rule.active ? '#222222' : '#9197A2' }}>{DEDUCTION_TRIGGER_LABELS[rule.trigger]}</strong></td>
                    <td style={{ ...ruleTd, color: '#717171' }}>{ruleText(rule)}</td>
                    <td style={ruleTd}>
                      <div style={toggleWrap}>
                        {[true, false].map((v) => (
                          <button key={String(v)} type="button" onClick={() => update(index, { active: v })} style={toggleBtn(rule.active === v, v)}>{v ? 'Yes' : 'No'}</button>
                        ))}
                      </div>
                    </td>
                    <td style={ruleTd}><button type="button" onClick={() => onChange(rules.filter((_, i) => i !== index))} style={dangerLink}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 180px auto', gap: 12, alignItems: 'end', padding: '16px 22px', background: '#FBFBFC', borderTop: rules.length ? '1px solid #EBEBEB' : 'none' }}>
            <div>
              <label style={fieldLabel}>Counts</label>
              <select value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value as DeductionTrigger })} style={{ ...input, cursor: 'pointer' }}>
                {TRIGGERS.map((t) => <option key={t} value={t}>{DEDUCTION_TRIGGER_LABELS[t]}</option>)}
              </select>
            </div>
            <div><label style={fieldLabel}>Every</label><Suffixed value={draft.every} onChange={(v) => setDraft({ ...draft, every: v })} suffix="times" step="1" /></div>
            <div><label style={fieldLabel}>Deduct</label><Suffixed value={draft.deductDays} onChange={(v) => setDraft({ ...draft, deductDays: v })} suffix="paid days" step="0.5" /></div>
            <button type="button" onClick={() => { if (draft.every > 0 && draft.deductDays > 0) onChange([...rules, draft]); }} style={primaryBtn}>+ Add rule</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', borderTop: '1px solid #EBEBEB' }}>
            <div style={{ flex: 1, fontSize: 15, fontWeight: 600, color: '#222222' }}>Paid leave allowance per month</div>
            <div style={{ width: 200 }}><Suffixed value={paidLeaveDays} onChange={onPaidLeaveDays} suffix="paid days" step="0.5" /></div>
          </div>
        </>
      )}
    </Card>
  );
}

function RulesSummary({ enabled, rules, paidLeaveDays }: { enabled: boolean; rules: SalaryDeductionRule[]; paidLeaveDays: number }) {
  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 22px', borderBottom: '1px solid #EBEBEB' }}>
        <div style={{ fontSize: 17, fontWeight: 800, flex: 1 }}>Paid days calculation</div>
        <span style={{ fontSize: 13, fontWeight: 700, color: enabled ? '#4F7A52' : '#9197A2' }}>{enabled ? 'Enabled · read from the attendance calendar' : 'Disabled'}</span>
      </div>
      {!enabled ? (
        <div style={{ padding: '18px 22px', color: '#717171', fontSize: 15 }}>Off for this template — every working day is paid.</div>
      ) : rules.length === 0 ? (
        <div style={{ padding: '18px 22px', color: '#717171', fontSize: 15 }}>No attendance deductions — every working day is paid.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
          <thead><tr><th style={detTh}>Counts</th><th style={detTh}>Rule</th><th style={{ ...detTh, width: 130 }}>Active</th></tr></thead>
          <tbody>
            {rules.map((rule, index) => (
              <tr key={index}>
                <td style={ruleTd}><strong style={{ color: rule.active ? '#222222' : '#9197A2' }}>{DEDUCTION_TRIGGER_LABELS[rule.trigger]}</strong></td>
                <td style={{ ...ruleTd, color: '#717171' }}>{ruleText(rule)}</td>
                <td style={ruleTd}><StatusText on={rule.active} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {enabled && paidLeaveDays > 0 && (
        <div style={{ padding: '12px 22px', borderTop: '1px solid #EBEBEB', fontSize: 15, color: '#484848' }}>
          Paid leave allowance: <strong>{paidLeaveDays} {paidLeaveDays === 1 ? 'day' : 'days'}</strong> a month, set off against the deductions.
        </div>
      )}
    </Card>
  );
}

// ——————————————————————————————— PEOPLE ON IT ———————————————————————————————
// Who is on a template is a payroll list, not something to edit here: it
// exports as an Excel sheet with each person's CTC.

async function exportEmployeesOnTemplate(t: SalaryTemplateDTO, flash: (m: string, tone?: 'ok' | 'error') => void) {
  try {
    const [rows, people] = await Promise.all([listSalaryStructures(), getAllEmployees()]);
    const byId = new Map(people.map((e) => [e.userId, e]));
    const onThis = rows
      .filter((r) => r.salaryTemplateCode === t.code)
      .map((r) => {
        const person = byId.get(r.userId);
        return {
          'Employee ID': person?.employeeId ?? '',
          Name: person?.name ?? r.employeeName ?? r.userId,
          Department: person?.department ?? '',
          Designation: person?.designation ?? '',
          'Salary template': t.name,
          'Annual CTC (₹)': Math.round(r.annualCtcPaise / 100),
          'Monthly (₹)': Math.round(r.annualCtcPaise / 1200),
          Status: r.status === 'active' ? 'Active' : 'Draft',
        };
      })
      .sort((a, b) => a.Name.localeCompare(b.Name));
    if (onThis.length === 0) { flash('Nobody is on this template yet'); return; }
    const ws = XLSX.utils.json_to_sheet(onThis);
    ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    XLSX.writeFile(wb, `${t.code.toLowerCase()}-employees.xlsx`);
  } catch (e) { flash(e instanceof ApiError ? e.message : 'Could not export', 'error'); }
}

function Suffixed({ value, onChange, suffix, step }: { value: number; onChange: (v: number) => void; suffix: string; step: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff' }}>
      <input type="number" min="0" step={step} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} style={{ border: 'none', outline: 'none', padding: '8px 10px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent', fontFamily: 'inherit' }} />
      <span style={{ padding: '0 10px', fontSize: 13, color: '#717171', borderLeft: '1px solid #EBEBEB', alignSelf: 'stretch', display: 'flex', alignItems: 'center', background: '#FBFBFC', whiteSpace: 'nowrap' }}>{suffix}</span>
    </div>
  );
}

const ruleTd: CSSProperties = { padding: '12px 22px', borderBottom: '1px solid #F4F4F6', verticalAlign: 'middle' };
const dangerLink: CSSProperties = { background: 'none', border: 'none', color: '#C4382E', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };
const toggleWrap: CSSProperties = { display: 'inline-flex', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden' };
const toggleBtn = (on: boolean, yes: boolean): CSSProperties => ({
  padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', fontFamily: 'inherit',
  borderLeft: yes ? 'none' : '1px solid #EBEBEB', background: on ? '#0571A6' : '#fff', color: on ? '#fff' : '#484848',
});

// —— Inline calculation editor for one row ——
function CalcCell({
  r,
  isBalancing,
  form,
  phByCode,
  setByCode,
}: {
  r: Row;
  isBalancing: boolean;
  form: Form;
  phByCode: Map<string, PayHeadDTO>;
  setByCode: (code: string, patch: Partial<Row>) => void;
}) {
  if (isBalancing) return <span style={{ color: '#484848' }}>Fixed amount</span>;
  const fixedBase = fixedBaseOf(phByCode.get(r.payHeadCode));
  if (fixedBase) {
    // Basic: flat / month or % of CTC. HRA: flat / month or % of Basic.
    const mode = r.calcMode === 'flat_per_month' ? 'flat_per_month' : 'percentage';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {mode === 'percentage' ? (
          <div style={pairBox}>
            <input type="number" step="0.01" value={r.percent} onChange={(e) => setByCode(r.payHeadCode, { percent: e.target.value, base: fixedBase })} style={pairInput} />
            <span style={pairSuffix}>% of {fixedBase === 'ctc' ? 'CTC' : 'Basic'}</span>
          </div>
        ) : (
          <div style={pairBox}>
            <span style={{ ...pairSuffix, borderLeft: 'none', borderRight: '1px solid #EBEBEB' }}>₹</span>
            <input type="number" value={r.amountRupees} onChange={(e) => setByCode(r.payHeadCode, { amountRupees: e.target.value })} style={pairInput} />
            <span style={pairSuffix}>/ month</span>
          </div>
        )}
        <select value={mode} onChange={(e) => setByCode(r.payHeadCode, { calcMode: e.target.value as CalculationMode, base: fixedBase })} style={miniSelect}>
          <option value="percentage">Percentage</option>
          <option value="flat_per_month">Flat / month</option>
        </select>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <select value={r.calcMode} onChange={(e) => setByCode(r.payHeadCode, { calcMode: e.target.value as CalculationMode })} style={miniSelect}>
        <option value="percentage">Percentage</option>
        <option value="flat_per_month">Flat / month</option>
        <option value="flat_amount">Fixed amount</option>
      </select>
      {r.calcMode === 'percentage' && (
        <>
          <input type="number" step="0.01" value={r.percent} onChange={(e) => setByCode(r.payHeadCode, { percent: e.target.value })} style={{ ...miniInput, width: 64 }} />
          <span style={{ color: '#717171' }}>%</span>
          <select value={r.base} onChange={(e) => setByCode(r.payHeadCode, { base: e.target.value as PercentageBase })} style={miniSelect}>
            <option value="ctc">of CTC</option>
            <option value="basic">of Basic</option>
            <option value="component">of…</option>
          </select>
          {r.base === 'component' && (
            <select value={r.baseComponentCode} onChange={(e) => setByCode(r.payHeadCode, { baseComponentCode: e.target.value })} style={miniSelect}>
              <option value="">base…</option>
              {form.rows.filter((x) => x.payHeadCode && x.payHeadCode !== r.payHeadCode).map((x) => <option key={x.payHeadCode} value={x.payHeadCode}>{phByCode.get(x.payHeadCode)?.name ?? x.payHeadCode}</option>)}
            </select>
          )}
        </>
      )}
      {r.calcMode === 'flat_per_month' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#717171' }}>₹</span>
          <input type="number" value={r.amountRupees} onChange={(e) => setByCode(r.payHeadCode, { amountRupees: e.target.value })} style={{ ...miniInput, width: 100 }} />
          <span style={{ color: '#717171' }}>/ mo</span>
        </div>
      )}
      {r.calcMode === 'flat_amount' && <span style={{ color: '#717171' }}>Fixed amount</span>}
    </div>
  );
}

// ——————————————————————————————— STATUTORY ———————————————————————————————
// The statutory components every person on this template gets. They are set
// once for the company (Payroll › Statutory Components) and apply by each
// person's pay and work state, so a template lists them but cannot drop them;
// a one-person exception is made on that person's salary.
function StatutoryList({ overview, computed, flat }: { overview: StatutoryOverview | null; computed?: ComputedStructure | null; flat?: boolean }) {
  if (!overview) return null;
  const { settings } = overview;
  const ceiling = rupees(overview.ceilingPaise);
  const st = computed?.statutory;
  const rows: { name: string; how: string; monthly?: number }[] = [];
  if (settings.epf.enabled) {
    const emp = settings.epf.employeeRate === 'restricted' ? `12% of PF wage up to ₹${ceiling}` : '12% of actual PF wage';
    const er = settings.epf.employerRate === 'restricted' ? `12% up to ₹${ceiling}` : '12% of actual PF wage';
    rows.push({ name: 'Employees’ Provident Fund', how: `Employee ${emp} · Employer ${er}${settings.epf.includeEmployer ? ' · employer share inside CTC' : ''}`, monthly: st?.epf.employeePaise });
  }
  if (settings.esi.enabled) {
    rows.push({ name: 'Employees’ State Insurance', how: `0.75% of gross while gross is ₹21,000 or less · Employer 3.25%${settings.esi.includeEmployer ? ' · employer share inside CTC' : ''}`, monthly: st ? (st.esi.applicable ? st.esi.employeePaise : 0) : undefined });
  }
  const ptStates = [...new Set(overview.pt.filter((p) => p.pt).map((p) => p.state))];
  rows.push({ name: 'Professional Tax', how: ptStates.length ? `By slab in ${ptStates.join(', ')}; not levied in the other work states` : 'Not levied in any current work state', monthly: st?.pt.amountPaise });
  const lwfOn = overview.lwf.filter((l) => l.rule && l.enabled).map((l) => l.state);
  rows.push({ name: 'Labour Welfare Fund', how: lwfOn.length ? `Applies in ${lwfOn.join(', ')}` : 'Switched off or not applicable in every current work state', monthly: st ? (st.lwf.applicable ? st.lwf.employeePaise : 0) : undefined });
  if (settings.bonus.enabled) {
    rows.push({ name: 'Statutory Bonus', how: `${settings.bonus.ratePercent}% of Basic or the state minimum wage, whichever is higher, ${settings.bonus.frequency}` });
  }
  const pad = flat ? '10px 0' : '10px 22px';
  return (
    <div style={flat ? { border: '1px solid #EBEBEB', borderRadius: 8, padding: '0 20px' } : { borderTop: '1px solid #EBEBEB' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: flat ? '14px 0 4px' : '14px 22px 4px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.03em', textTransform: 'uppercase', color: '#717171' }}>Statutory Components</div>
        <div style={{ fontSize: 13, color: '#9197A2' }}>Same for everyone · set in Payroll › Statutory Components · a one-person exception is made on that person’s salary</div>
      </div>
      {rows.map((r) => (
        <div key={r.name} style={{ display: 'grid', gridTemplateColumns: computed === undefined ? '1fr 2fr' : '1fr 2fr 140px', gap: 12, padding: pad, borderTop: '1px solid #F4F4F6', fontSize: 14.5, alignItems: 'center' }}>
          <div style={{ fontWeight: 600, color: '#222222' }}>{r.name}</div>
          <div style={{ color: '#717171' }}>{r.how}</div>
          {computed !== undefined && (
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#484848' }}>{r.monthly === undefined ? '—' : `₹${rupees(r.monthly)}`}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function CtcInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #D9DCE1', borderRadius: 9, overflow: 'hidden', background: '#fff', width: 'fit-content' }}>
      <span style={{ padding: '10px 14px', color: '#717171', borderRight: '1px solid #D9DCE1', background: '#FBFBFC' }}>₹</span>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '10px 12px', fontSize: 16, width: 190, color: '#222222', fontFamily: 'inherit' }} />
      <span style={{ padding: '10px 14px', color: '#717171', fontSize: 14 }}>per year</span>
    </div>
  );
}

function GroupRows({ label, cols, big, children }: { label: string; cols: number; big?: boolean; children: ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={cols} style={{ padding: big ? '18px 20px 8px' : '14px 22px 6px', fontSize: big ? 18 : 15, fontWeight: big ? 600 : 800, color: '#222222' }}>{label}</td>
      </tr>
      {children}
    </>
  );
}
function TotalRow({ monthly, cols }: { monthly: number; cols: number }) {
  const cell: CSSProperties = { ...detTd, fontWeight: 800, fontSize: 16, borderTop: '2px solid #EBEBEB' };
  const num: CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  return (
    <tr>
      <td style={cell}>Cost to Company</td>
      {cols === 4 && <td style={{ ...cell, borderTop: '2px solid #EBEBEB' }} />}
      <td style={num}>₹{rupees(monthly)}</td>
      <td style={num}>₹{rupees(monthly * 12)}</td>
    </tr>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th style={{ textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 16px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <td style={{ padding: '13px 16px', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222' }}>{children}</td>;
}
function StatusText({ on }: { on: boolean }) {
  return <span style={{ fontSize: 14, fontWeight: 700, color: on ? '#4F7A52' : '#9197A2' }}>{on ? 'Active' : 'Inactive'}</span>;
}
function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={fieldLabel}>{label}{required && <span style={{ color: '#C4382E' }}> *</span>}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: '#717171', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const fieldLabel: CSSProperties = { display: 'block', fontSize: 15, fontWeight: 600, marginBottom: 7, color: '#484848' };
const input: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #D9DCE1', borderRadius: 8, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const miniInput: CSSProperties = { padding: '6px 8px', border: '1px solid #EBEBEB', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const miniSelect: CSSProperties = { padding: '6px 8px', border: '1px solid #EBEBEB', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: '#fff', color: '#222222', cursor: 'pointer' };
const pairBox: CSSProperties = { display: 'inline-flex', alignItems: 'stretch', border: '1px solid #D9DCE1', borderRadius: 7, overflow: 'hidden', background: '#fff' };
const pairInput: CSSProperties = { border: 'none', outline: 'none', padding: '8px 10px', fontSize: 15, width: 96, color: '#222222', fontFamily: 'inherit' };
const pairSuffix: CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 14, color: '#484848', background: '#F7F7F9', borderLeft: '1px solid #D9DCE1', whiteSpace: 'nowrap' };
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const detTh: CSSProperties = { textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 22px', borderBottom: '1px solid #EBEBEB', background: '#FBFBFC' };
const detTd: CSSProperties = { padding: '12px 22px', borderBottom: '1px solid #F4F4F6', color: '#222222' };
const numTd: CSSProperties = { ...detTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const bldTh: CSSProperties = { textAlign: 'left', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#5B6475', fontWeight: 700, padding: '13px 20px', borderBottom: '1px solid #EBEBEB', background: '#F7F8FC' };
const bldTd: CSSProperties = { padding: '14px 20px', borderBottom: '1px solid #F4F4F6', color: '#222222', verticalAlign: 'middle' };
const ctcBand: CSSProperties = { display: 'flex', alignItems: 'center', background: '#EAF2FB', borderRadius: 8, padding: '18px 22px', fontSize: 20, fontWeight: 600, color: '#222222', fontVariantNumeric: 'tabular-nums' };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 700, color: '#484848' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const iconBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 4, opacity: 0.65 };
const closeCircle: CSSProperties = { width: 40, height: 40, borderRadius: '50%', border: 'none', background: '#F1F2F5', color: '#484848', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
// The builder is its own page over the whole dashboard, left nav included.
const builderPage: CSSProperties = { position: 'fixed', inset: 0, zIndex: 90, background: '#fff', display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', fontFamily: 'inherit' };
const builderCard: CSSProperties = { border: '1px solid #EBEBEB', borderRadius: 12, background: '#fff', boxShadow: '0 1px 2px rgba(34,34,34,.04)' };
const navGroupBtn: CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', padding: '12px 0', fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', color: '#484848', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' };
const navItemBtn: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '10px 0', fontSize: 16, color: '#222222', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.3 };
