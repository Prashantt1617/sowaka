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
  type OvertimePayRule,
  createSalaryTemplate,
  deleteSalaryTemplate,
  getSalaryTemplate,
  getStatutorySettings,
  listPayHeads,
  listSalaryStructures,
  listSalaryTemplates,
  previewSalaryTemplate,
  rupeesToPaise,
  updatePayHead,
  updateSalaryTemplate,
} from '../../services/payroll';
import type {
  CalculationBasis,
  CalculationMode,
  ComputedStructure,
  DeductionTrigger,
  PayHeadDTO,
  PayHeadInput,
  PercentageBase,
  SalaryDeductionRule,
  SalaryTemplateDTO,
  SalaryTemplateInput,
  StatutoryOverview,
  TemplateStatutoryWages,
} from '../../services/payroll';
import { getAllEmployees } from '../../services/hrms';
import { Card, EmptyRow, ListPending, Skeleton, Spinner } from '../ui';
import type { LoadState } from '../ui';
import * as L from './look';
import './look.css';
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
  overtimePay: OvertimePayRule | null;
  sampleCtc: string;
  /** The flexible pool a month, in rupees; blank: not set (required once the template has flexible heads). */
  flexiblePool: string;
  /** Monthly limits edited here, in rupees, by component code; saved to the component on Save. */
  limits: Record<string, string>;
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
    flexiblePoolPaise: f.flexiblePool.trim() === '' ? null : rupeesToPaise(f.flexiblePool),
    statutoryWages: cleanWages(f.statutoryWages, f.rows.map((r) => r.payHeadCode)),
    overtimePay: f.overtimePay,
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
    overtimePay: t.overtimePay ?? null,
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
    <div title="Fixed for this earning type" style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
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

// —— Flexible heads and the pool (the app's Payroll › Change my split) ——
// Exactly as the server decides it (employeePayroll.split.ts): a reimbursement
// head (or one marked FBP) that the template sets per person ("flat_amount")
// and whose component has a monthly limit above zero, and is not the
// balancing component. The limit lives on the component (Salary Components),
// and only reimbursements can have one.
function canBeFlexible(ph?: PayHeadDTO): boolean {
  return ph?.category === 'reimbursement';
}
function isFlexible(code: string, mode: CalculationMode, ph: PayHeadDTO | undefined, balancing: string | undefined, limitPaise: number): boolean {
  return !!ph && (ph.category === 'reimbursement' || ph.fbp === true) && mode === 'flat_amount' && limitPaise > 0 && code !== balancing;
}
type FlexHead = { code: string; name: string; limitPaise: number };

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
  // Skeleton until the first load; a refresh after a save keeps the list up.
  const [state, setState] = useState<LoadState>('loading');
  // The template being opened, and whether its amounts are still being worked out.
  const [opening, setOpening] = useState<string | null>(null);
  const [detailPending, setDetailPending] = useState(false);

  // detail
  const [detailTpl, setDetailTpl] = useState<SalaryTemplateDTO | null>(null);
  const [detailComputed, setDetailComputed] = useState<ComputedStructure | null>(null);

  // builder
  const [form, setForm] = useState<Form | null>(null);
  const [computed, setComputed] = useState<ComputedStructure | null>(null);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    try {
      // The statutory list is decoration here; don't hold the templates for it.
      void getStatutorySettings().then(setStatutory).catch(() => setStatutory(null));
      const [ts, phs] = await Promise.all([listSalaryTemplates(), listPayHeads()]);
      setTemplates(ts);
      // The org's own components plus the standard ones it hasn't added: a
      // standard one used on a template is saved as the org's on Save.
      // Only the company's own components; others are added in Salary Components first.
      setPayHeadsList(phs);
      setState('ready');
    } catch (e) {
      setState((st) => (st === 'ready' ? st : 'error'));
      flash(e instanceof ApiError ? e.message : 'Could not load templates', 'error');
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
    setOpening(code);
    try {
      const t = await getSalaryTemplate(code);
      setDetailTpl(t);
      setDetailComputed(null);
      setDetailPending(true);
      setMode('detail');
      // Amounts for the detail columns, at the sample CTC.
      void previewSalaryTemplate({ ...inputFromTemplate(t), sampleAnnualCtcPaise: rupeesToPaise(SAMPLE_CTC_RUPEES) })
        .then(setDetailComputed)
        .catch(() => setDetailComputed(null))
        .finally(() => setDetailPending(false));
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load template', 'error');
    } finally {
      setOpening(null);
    }
  };

  const newTemplate = () => {
    setForm({ name: '', description: '', active: true, rows: [], balancingComponentCode: '', paidDaysEnabled: true, statutoryWages: null, deductionRules: [], monthlyPaidLeaveDays: 0, overtimePay: null, sampleCtc: SAMPLE_CTC_RUPEES, flexiblePool: '', limits: {} });
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
      overtimePay: t.overtimePay ?? null,
      sampleCtc: SAMPLE_CTC_RUPEES,
      flexiblePool: t.flexiblePoolPaise != null ? String(t.flexiblePoolPaise / 100) : '',
      limits: {},
    });
    const orphans = t.components.filter((c) => !phByCode.has(c.payHeadCode)).map((c) => c.payHeadCode);
    if (orphans.length) flash(`${orphans.join(', ')} ${orphans.length === 1 ? 'is' : 'are'} no longer a salary component and ${orphans.length === 1 ? 'was' : 'were'} left out`, 'error');
    setComputed(null);
    setMode('edit');
  };
  /** A copy of the open template in the builder, unsaved, named "Copy of …" until HR renames it. */
  const duplicateCurrent = () => {
    const t = detailTpl;
    if (!t) return;
    const taken = new Set(templates.map((x) => x.name.toLowerCase()));
    let name = `Copy of ${t.name}`;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `Copy of ${t.name} (${i})`;
    setForm({
      name,
      description: t.description ?? '',
      active: t.active,
      rows: t.components.filter((c) => phByCode.has(c.payHeadCode)).map((c) => ({ ...rowFromCalc(c.payHeadCode, c.calculation), payslipName: c.payslipName ?? '', showInPayslip: c.showInPayslip })),
      balancingComponentCode: t.balancingComponentCode ?? '',
      paidDaysEnabled: t.paidDaysEnabled ?? true,
      statutoryWages: t.statutoryWages ?? null,
      deductionRules: t.deductionRules ?? [],
      monthlyPaidLeaveDays: t.monthlyPaidLeaveDays ?? 0,
      overtimePay: t.overtimePay ?? null,
      sampleCtc: SAMPLE_CTC_RUPEES,
      flexiblePool: t.flexiblePoolPaise != null ? String(t.flexiblePoolPaise / 100) : '',
      limits: {},
    });
    setComputed(null);
    setMode('edit');
    flash(`Copied "${t.name}": rename it and save`);
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
    const pool = form.flexiblePool.trim();
    if (pool !== '' && !(Number(pool) >= 0 && Number.isInteger(Number(pool)))) return flash('Flexible pool: enter whole rupees, or leave it blank', 'error');
    // With flexible heads the pool is required: nothing in code stands in for it.
    const flexOnForm = flexHeadsOf(form.rows.filter((r) => r.payHeadCode).map((r) => ({ code: r.payHeadCode, mode: r.calcMode })), phByCode, form.balancingComponentCode, (c) => limitOf(form, c, phByCode.get(c)));
    if (flexOnForm.length > 0 && pool === '') return flash('Set the flexible pool: the template has flexible heads', 'error');
    const limitChanges = changedLimits(form, phByCode);
    if (limitChanges.some((c) => !Number.isInteger(c.paise / 100))) return flash('Monthly limits are whole rupees', 'error');
    setSaving(true);
    try {
      // A limit belongs to the component: saved there first, for every template that uses it.
      for (const c of limitChanges) {
        const head: Partial<PayHeadDTO> = { ...c.head, maxClaimablePaise: c.paise };
        delete head.id;
        delete head.standard;
        await updatePayHead(c.head.id, head as PayHeadInput);
      }
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

  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = async () => {
    if (!form?.editingCode) return;
    // Second click confirms.
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setConfirmDelete(false);
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
          <button onClick={newTemplate} className="lk-btn-p" style={primaryBtn}><IconPlus size={15} /> Create New</button>
        </div>
        <Card style={L.cardPad}>
          {state !== 'ready' ? (
            <ListPending state={state} onRetry={() => { setState('loading'); void load(); }} rows={4} cols={3} avatar={false} rowHeight={48} />
          ) : templates.length === 0 ? (
            <EmptyRow text="No salary templates yet — create your first pay group." />
          ) : (
            <table className="lk-t" style={tableStyle}>
              <thead>
                <tr><Th>Template Name</Th><Th>Description</Th><Th>Status</Th></tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.code} className="lk-click" onClick={() => openDetail(t.code)} style={{ cursor: 'pointer' }}>
                    <Td><strong style={L.cellName}>{t.name}</strong>{opening === t.code && <span style={{ marginLeft: 10 }}><Spinner /></span>}</Td>
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
    const detailFlex = flexHeadsOf(t.components.map((c) => ({ code: c.payHeadCode, mode: c.calculation.mode })), phByCode, t.balancingComponentCode, (code) => phByCode.get(code)?.maxClaimablePaise ?? 0);
    const showPool = t.flexiblePoolPaise != null || t.components.some((c) => canBeFlexible(phByCode.get(c.payHeadCode)));

    return (
      <div>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 20px 16px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={L.cardTitle}>{t.name} - Salary Template</div>
              <div style={{ ...L.cardNote, marginTop: 2 }}>
                {t.description ? `${t.description} · ` : ''}Amounts shown for a sample CTC of ₹{rupees(rupeesToPaise(SAMPLE_CTC_RUPEES))} a year
              </div>
            </div>
            <StatusText on={t.active} />
            <button onClick={editCurrent} className="lk-btn-p" style={L.btnSmPrimary}>Edit</button>
            <TemplateMenu onDuplicate={duplicateCurrent} onExport={() => void exportEmployees(t)} />
            <button onClick={() => setMode('list')} title="Close" className="lk-btn" style={{ ...L.btnSm, width: 32, padding: 0 }}><IconClose size={14} /></button>
          </div>

          <div style={{ padding: '0 20px' }}>
          <table className="lk-t" style={{ ...L.table }}>
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
                          <div style={{ fontWeight: 400, color: 'var(--ink)' }}>{ph?.name ?? comp.payHeadCode}{detailFlex.some((h) => h.code === comp.payHeadCode) && <FlexTag />}</div>
                          <div style={L.cellSub}>{calcSubtitle(comp.calculation, ph, isBalancing, phByCode)}</div>
                          <FixedTags ph={ph} />
                        </td>
                        <td style={numTd}>{detailPending ? <AmountPending /> : `₹${rupees(amt.monthly)}`}</td>
                        <td style={numTd}>{detailPending ? <AmountPending /> : `₹${rupees(amt.annual)}`}</td>
                      </tr>
                    );
                  })}
                </GroupRows>
              ))}
              {hasOneTime && (
                <>
                  <tr>
                    <td style={{ ...detTd, fontWeight: 500 }}>Fixed CTC <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>(Annual CTC - One Time Earnings)</span></td>
                    <td style={numTd} />
                    <td style={numTd}>{detailPending ? <AmountPending /> : `₹${rupees(detailComputed?.annualCtcPaise ?? 0)}`}</td>
                  </tr>
                  <GroupRows label={GROUP_LABEL.onetime} cols={3}>
                    {buckets.get('onetime')!.map(({ comp, ph }) => (
                      <tr key={comp.payHeadCode}>
                        <td style={detTd}><div style={{ fontWeight: 400, color: 'var(--ink)' }}>{ph?.name ?? comp.payHeadCode}</div></td>
                        <td style={numTd} />
                        <td style={numTd}>{detailPending ? <AmountPending /> : `₹${rupees(resolve(comp.payHeadCode, comp.calculation).annual)}`}</td>
                      </tr>
                    ))}
                  </GroupRows>
                </>
              )}
              <TotalRow monthly={costMonthly} cols={3} pending={detailPending} />
            </tbody>
          </table>
          </div>
          {showPool && (
            <div style={{ padding: '18px 20px 0' }}>
              <FlexiblePoolCard heads={detailFlex} pool={t.flexiblePoolPaise != null ? String(t.flexiblePoolPaise / 100) : ''} balancingName={t.balancingComponentCode ? phByCode.get(t.balancingComponentCode)?.name ?? t.balancingComponentCode : undefined} />
            </div>
          )}
          <StatutoryList overview={statutory} computed={detailComputed} />
          <WagesSummary wages={t.statutoryWages ?? null} phByCode={phByCode} />
        </Card>

        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--ink-3)' }}>Paid days (attendance rules, paid leave, all days paid) are set in <strong>Paid Days Templates</strong>, per person.</div>
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
  const limitFor = (code: string) => limitOf(form, code, phByCode.get(code));
  const formFlex = flexHeadsOf(form.rows.filter((r) => r.payHeadCode).map((r) => ({ code: r.payHeadCode, mode: r.calcMode })), phByCode, form.balancingComponentCode, limitFor);
  const formShowPool = form.flexiblePool.trim() !== '' || form.rows.some((r) => canBeFlexible(phByCode.get(r.payHeadCode)));

  return (
    <div style={builderPage}>
      <ComponentNav unused={unused} onPick={addComponent} />

      <div style={{ overflowY: 'auto', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 36px 18px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-.02em', lineHeight: 1.2 }}>{form.editingCode ? 'Edit Salary Template' : 'New Salary Template'}</div>
          <button onClick={closeBuilder} title="Close" style={closeCircle}><IconClose size={16} /></button>
        </div>

        <div style={{ padding: '24px 36px 40px', maxWidth: 1240 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '340px 470px', gap: 40, marginBottom: 26 }}>
            <Field label="Template Name" required><input value={form.name} onChange={(e) => set('name', e.target.value)} className="lk-in" style={input} /></Field>
            <Field label="Description">
              <textarea value={form.description} maxLength={500} placeholder="Max 500 Characters" onChange={(e) => set('description', e.target.value)} rows={2} className="lk-in" style={{ ...input, resize: 'vertical', minHeight: 54 }} />
            </Field>
          </div>

          <div style={builderCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap', padding: '26px 36px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', width: 230 }}>Annual CTC</div>
                <CtcInput value={form.sampleCtc} onChange={(v) => set('sampleCtc', v)} />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', maxWidth: 360 }}>Used to preview the amounts below. Each person's own CTC is set when the template is assigned to them.</div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18 }}>
                <label style={{ ...checkRow, fontWeight: 400 }}>
                  Balancing component
                  <select value={form.balancingComponentCode} onChange={(e) => set('balancingComponentCode', e.target.value)} style={{ ...input, width: 200 }}>
                    <option value="">None</option>
                    {balancingOptions.map((code) => <option key={code} value={code}>{phByCode.get(code)?.name ?? code}</option>)}
                  </select>
                </label>
                <label style={checkRow}><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active</label>
              </div>
            </div>

            <div style={{ margin: '0 36px' }}>
              <table className="lk-t" style={L.table}>
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
                    <tr><td colSpan={4} style={{ ...detTd, textAlign: 'center', color: 'var(--ink-3)', padding: 40 }}>Click a component on the left to add it to the template.</td></tr>
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
                              <div style={{ fontWeight: 400, color: 'var(--ink)' }}>{ph?.name ?? r.payHeadCode}{isBalancing && <span title="Takes whatever is left of the monthly CTC" style={{ color: 'var(--ink-3)', marginLeft: 6, fontSize: 12.5 }}>ⓘ</span>}{formFlex.some((h) => h.code === r.payHeadCode) && <FlexTag />}</div>
                              {ph?.category === 'reimbursement' && limitFor(r.payHeadCode) ? (
                                <div style={L.cellSub}>Max Limit : {rupees2(limitFor(r.payHeadCode))}</div>
                              ) : isBalancing ? (
                                <div style={L.cellSub}>Monthly CTC - Sum of all other components</div>
                              ) : null}
                              <FixedTags ph={ph} />
                              <PayslipLabel r={r} ph={ph} onChange={(patch) => setByCode(r.payHeadCode, patch)} />
                            </td>
                            <td style={bldTd}>
                              {canBeFlexible(ph) && !isBalancing && r.calcMode !== 'percentage' ? (
                                <FlexCell
                                  r={r}
                                  ph={ph!}
                                  limit={form.limits[r.payHeadCode] ?? String((ph!.maxClaimablePaise ?? 0) / 100)}
                                  onLimit={(v) => set('limits', { ...form.limits, [r.payHeadCode]: v })}
                                  setByCode={setByCode}
                                />
                              ) : (
                                <CalcCell r={r} isBalancing={isBalancing} form={form} phByCode={phByCode} setByCode={setByCode} />
                              )}
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

            {formShowPool && (
              <div style={{ margin: '18px 36px 0' }}>
                <FlexiblePoolCard
                  heads={formFlex}
                  pool={form.flexiblePool}
                  onPool={(v) => set('flexiblePool', v)}
                  balancingName={form.balancingComponentCode ? phByCode.get(form.balancingComponentCode)?.name ?? form.balancingComponentCode : undefined}
                />
              </div>
            )}

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
              <OvertimeCard rule={form.overtimePay} onChange={(v) => set('overtimePay', v)} />
            </div>

            <div style={{ display: 'flex', gap: 8, padding: '24px 36px 28px' }}>
              <button onClick={save} disabled={saving} className="lk-btn-p" style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={closeBuilder} className="lk-btn" style={ghostBtn}>Cancel</button>
              {form.editingCode && (
                <button onClick={() => void remove()} onMouseLeave={() => setConfirmDelete(false)} disabled={saving} style={{ ...ghostBtn, marginLeft: 'auto', color: 'var(--bad)', borderColor: confirmDelete ? 'var(--bad)' : 'transparent', background: 'var(--bad-bg)' }}>
                  {confirmDelete ? 'Click again to delete this template' : 'Delete'}
                </button>
              )}
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
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '16px 20px', background: 'var(--surface)' }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--hi)' }}>PF and ESI wages</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>Which earnings on this template count toward the PF and ESI wage. Left on the defaults, payroll works exactly as before.</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginTop: 14 }}>
        <div>
          <div style={{ fontWeight: 400, fontSize: 13.5, marginBottom: 6 }}>PF wage</div>
          <label style={checkRow}><input type="radio" checked={!pfCustom} onChange={() => patch({ pfComponents: undefined })} /> Each component’s own “Consider for EPF”</label>
          <label style={checkRow}><input type="radio" checked={pfCustom} onChange={() => patch({ pfComponents: defaultPfCodes(earnings, phByCode) })} /> Choose for this template</label>
          <div style={{ marginLeft: 22, marginTop: 4 }}>
            {earnings.map((code) => (
              <label key={code} style={{ ...checkRow, opacity: pfCustom ? 1 : 0.6 }}>
                <input type="checkbox" disabled={!pfCustom} checked={pfCodes.includes(code)} onChange={() => patch({ pfComponents: toggle(pfCodes, code) })} /> {name(code)}
              </label>
            ))}
          </div>
          <div style={{ fontWeight: 400, fontSize: 13.5, margin: '12px 0 6px' }}>PF contribution</div>
          <select value={w.pfWageMode ?? 'org'} onChange={(e) => patch({ pfWageMode: e.target.value === 'org' ? undefined : (e.target.value as 'actual' | 'ceiling') })} style={{ ...input, width: 340 }}>
            <option value="org">As set in Statutory Components</option>
            <option value="ceiling">12% of PF wage, capped at the ceiling</option>
            <option value="actual">12% of the actual PF wage (no cap)</option>
          </select>
          {pfWagePaise !== undefined && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>PF wage at the preview CTC: ₹{rupees(pfWagePaise)} a month</div>}
        </div>
        <div>
          <div style={{ fontWeight: 400, fontSize: 13.5, marginBottom: 6 }}>ESI wage</div>
          <label style={checkRow}><input type="radio" checked={!esiCustom} onChange={() => patch({ esiComponents: undefined })} /> Gross pay (every earning)</label>
          <label style={checkRow}><input type="radio" checked={esiCustom} onChange={() => patch({ esiComponents: earnings })} /> Choose for this template</label>
          <div style={{ marginLeft: 22, marginTop: 4 }}>
            {earnings.map((code) => (
              <label key={code} style={{ ...checkRow, opacity: esiCustom ? 1 : 0.6 }}>
                <input type="checkbox" disabled={!esiCustom} checked={esiCodes.includes(code)} onChange={() => patch({ esiComponents: toggle(esiCodes, code) })} /> {name(code)}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>ESI applies while this wage is ₹21,000 a month or less, and is taken on it.</div>
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
    <div style={{ padding: '12px 20px', fontSize: 13, color: 'var(--ink-2)', borderTop: '1px solid var(--line)' }}>
      <strong>PF wage:</strong> {pf} · PF {mode} · <strong>ESI wage:</strong> {esi}
    </div>
  );
}

// How a component reads on this template's payslips, and whether it is listed
// at all. Blank / unchanged uses the component's own payslip name and setting.
function PayslipLabel({ r, ph, onChange }: { r: Row; ph?: PayHeadDTO; onChange: (patch: Partial<Row>) => void }) {
  const shown = r.showInPayslip ?? ph?.showInPayslip !== false;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12, color: 'var(--ink-3)' }}>
      <span>On payslip as</span>
      <input
        value={r.payslipName}
        placeholder={ph?.payslipName || ph?.name || r.payHeadCode}
        onChange={(e) => onChange({ payslipName: e.target.value })}
        disabled={!shown}
        style={{ ...input, width: 170, padding: '3px 7px', fontSize: 12 }}
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
    <div style={{ borderRight: '1px solid var(--line)', background: 'var(--surface)', padding: '24px 24px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 19, fontWeight: 500, color: 'var(--ink)' }}>Build your Template</div>
      <div style={{ fontSize: 14, color: 'var(--ink-2)', marginTop: 4, marginBottom: 22 }}>Include active salary components</div>
      {GROUP_ORDER.map((g) => {
        const items = unused.filter((p) => groupOf(p) === g);
        const isOpen = open.has(g);
        return (
          <div key={g} style={{ marginBottom: 6 }}>
            <button type="button" onClick={() => toggle(g)} style={navGroupBtn}>
              <span>{NAV_LABEL[g]}</span>
              <span style={{ color: 'var(--ink-3)', fontSize: 14, transform: isOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' }}>›</span>
            </button>
            {isOpen && (
              <div style={{ padding: '2px 0 10px' }}>
                {items.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', padding: '6px 0' }}>Nothing left to add</div>}
                {items.map((p) => (
                  <button key={p.code} type="button" onClick={() => onPick(p.code)} style={navItemBtn} title={p.standard ? 'Standard component: saved for your organisation when the template is saved' : undefined}>{p.name}{p.standard && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-3)', fontWeight: 400 }}>Standard</span>}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ marginTop: 'auto', paddingTop: 30, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5, fontStyle: 'italic', lineHeight: 1.5 }}>
        <div style={{ fontSize: 19, marginBottom: 2 }}>↗</div>
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

// Absent days and half days always cost pay straight from the calendar (one
// day, and half a day, each), so a template rule on them would count those
// days twice: the server ignores such rules and they are not offered here.
// Leave without pay is the same, on every template, and no rule may count it.
const CALENDAR_TRIGGERS = new Set<DeductionTrigger>(['absent', 'half_day', 'unpaid_leave']);
const TRIGGERS = (Object.keys(DEDUCTION_TRIGGER_LABELS) as DeductionTrigger[]).filter((t) => !CALENDAR_TRIGGERS.has(t));
function CalendarNote() {
  return (
    <div style={{ padding: '12px 20px', fontSize: 13, color: 'var(--ink-2)', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}>
      Always, from the calendar: each <strong>absent day</strong> costs 1 paid day and each <strong>half day</strong> ½ a day. The rules below add to that.
    </div>
  );
}
export const ruleText = (rule: SalaryDeductionRule) =>
  `Every ${rule.every} → ${rule.deductDays} paid ${rule.deductDays === 1 ? 'day' : 'days'}`;

export function RulesCard({ enabled, onEnabled, rules, onChange, paidLeaveDays, onPaidLeaveDays }: {
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  rules: SalaryDeductionRule[];
  onChange: (rules: SalaryDeductionRule[]) => void;
  paidLeaveDays: number;
  onPaidLeaveDays: (v: number) => void;
}) {
  const [draft, setDraft] = useState<SalaryDeductionRule>({ trigger: 'late', every: 3, deductDays: 1, active: true });
  // Older templates may hold an absent / half-day rule; it was never applied.
  const shown = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => !CALENDAR_TRIGGERS.has(rule.trigger));
  const update = (index: number, patch: Partial<SalaryDeductionRule>) => onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>Paid days calculation</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>{enabled ? "Read from each person's attendance calendar when payroll runs" : 'Every day of the month is paid; the attendance calendar is not read'}</div>
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 20px', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: 13.5 }}>
        <input type="checkbox" checked={!enabled} onChange={(e) => onEnabled(!e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: 'var(--accent-ink)' }} />
        <span>
          <strong>All days of the month are paid days</strong>
          <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 12.5, marginTop: 2 }}>Overrides the calendar completely: absences, half days and the rules below are not docked. Loss of pay typed on a run, and the days before someone joins, still count.</span>
        </span>
      </label>
      {!enabled ? (
        <div style={{ padding: '16px 20px', color: 'var(--ink-3)', fontSize: 13.5 }}>Everyone on this template is paid for all the days of the month, whatever the attendance calendar shows.</div>
      ) : (
        <>
          <CalendarNote />
          {shown.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr><th style={detTh}>Counts</th><th style={detTh}>Rule</th><th style={{ ...detTh, width: 130 }}>Active</th><th style={{ ...detTh, width: 90 }} /></tr></thead>
              <tbody>
                {shown.map(({ rule, index }) => (
                  <tr key={index}>
                    <td style={ruleTd}><strong style={{ color: rule.active ? 'var(--ink)' : 'var(--ink-4)' }}>{DEDUCTION_TRIGGER_LABELS[rule.trigger]}</strong></td>
                    <td style={{ ...ruleTd, color: 'var(--ink-3)' }}>{ruleText(rule)}</td>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 180px auto', gap: 12, alignItems: 'end', padding: '16px 20px', background: 'var(--surface-2)', borderTop: shown.length ? '1px solid var(--line)' : 'none' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderTop: '1px solid var(--line)' }}>
            <div style={{ flex: 1, fontSize: 13.5, fontWeight: 400, color: 'var(--ink)' }}>Paid leave allowance per month</div>
            <div style={{ width: 200 }}><Suffixed value={paidLeaveDays} onChange={onPaidLeaveDays} suffix="paid days" step="0.5" /></div>
          </div>
        </>
      )}
    </Card>
  );
}

/** The ··· menu on a template: duplicate it, or export the people on it. */
function TemplateMenu({ onDuplicate, onExport }: { onDuplicate: () => void; onExport: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const item: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '9px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)', whiteSpace: 'nowrap' };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((v) => !v)} title="More" aria-haspopup="menu" aria-expanded={open} className="lk-btn" style={{ ...L.btnSm, minWidth: 32 }}>···</button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', padding: 6, zIndex: 20, minWidth: 190 }}>
          <button role="menuitem" style={item} onClick={() => { setOpen(false); onDuplicate(); }}>Duplicate template</button>
          <button role="menuitem" style={item} onClick={() => { setOpen(false); onExport(); }}>Export employees (Excel)</button>
        </div>
      )}
    </div>
  );
}

export function RulesSummary({ enabled, rules, paidLeaveDays }: { enabled: boolean; rules: SalaryDeductionRule[]; paidLeaveDays: number }) {
  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', flex: 1 }}>Paid days calculation</div>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: enabled ? 'var(--ok)' : 'var(--ink-4)' }}>{enabled ? 'Read from the attendance calendar' : 'All days of the month are paid days'}</span>
      </div>
      {!enabled ? (
        <div style={{ padding: '18px 20px', color: 'var(--ink-3)', fontSize: 13.5 }}>The attendance calendar is not read: every day of the month is paid.</div>
      ) : rules.filter((r) => !CALENDAR_TRIGGERS.has(r.trigger)).length === 0 ? (
        <>
          <CalendarNote />
          <div style={{ padding: '14px 20px', color: 'var(--ink-3)', fontSize: 13.5 }}>No other attendance rules.</div>
        </>
      ) : (
        <>
        <CalendarNote />
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr><th style={detTh}>Counts</th><th style={detTh}>Rule</th><th style={{ ...detTh, width: 130 }}>Active</th></tr></thead>
          <tbody>
            {rules.filter((rule) => !CALENDAR_TRIGGERS.has(rule.trigger)).map((rule, index) => (
              <tr key={index}>
                <td style={ruleTd}><strong style={{ color: rule.active ? 'var(--ink)' : 'var(--ink-4)' }}>{DEDUCTION_TRIGGER_LABELS[rule.trigger]}</strong></td>
                <td style={{ ...ruleTd, color: 'var(--ink-3)' }}>{ruleText(rule)}</td>
                <td style={ruleTd}><StatusText on={rule.active} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}
      {enabled && paidLeaveDays > 0 && (
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)', fontSize: 13.5, color: 'var(--ink-2)' }}>
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
    // The spreadsheet library is large; it is fetched the first time someone exports.
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(onThis);
    ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    XLSX.writeFile(wb, `${t.code.toLowerCase()}-employees.xlsx`);
  } catch (e) { flash(e instanceof ApiError ? e.message : 'Could not export', 'error'); }
}

/** How approved overtime hours become pay for the people on this template. */
// —— Flexible pool ————————————————————————————————————————————————————————
/** A head's monthly limit as the builder has it: edited here, else the component's. */
function limitOf(f: Form, code: string, ph?: PayHeadDTO): number {
  const edited = f.limits[code];
  return edited !== undefined ? rupeesToPaise(edited || '0') : ph?.maxClaimablePaise ?? 0;
}
/** Limits edited in the builder that differ from the component's, to save on the component. */
function changedLimits(f: Form, phByCode: Map<string, PayHeadDTO>): { head: PayHeadDTO; paise: number }[] {
  const onTemplate = new Set(f.rows.map((r) => r.payHeadCode));
  return Object.entries(f.limits).flatMap(([code, v]) => {
    const head = phByCode.get(code);
    const paise = rupeesToPaise(v || '0');
    return head?.id && onTemplate.has(code) && paise !== (head.maxClaimablePaise ?? 0) ? [{ head, paise }] : [];
  });
}
function flexHeadsOf(rows: { code: string; mode: CalculationMode }[], phByCode: Map<string, PayHeadDTO>, balancing: string | undefined, limit: (code: string) => number): FlexHead[] {
  return rows.flatMap(({ code, mode }) => {
    const ph = phByCode.get(code);
    const limitPaise = limit(code);
    return isFlexible(code, mode, ph, balancing || undefined, limitPaise) ? [{ code, name: ph!.name, limitPaise }] : [];
  });
}
function FlexTag() {
  return <span title="The employee sets the amount on the app, within the monthly limit" style={{ ...L.tag, marginLeft: 8, color: 'var(--accent-ink)', borderColor: 'var(--accent-soft)', background: 'var(--accent-soft)' }}>Flexible</span>;
}

/** A reimbursement head on the builder: flexible (the employee's split, up to the limit) or a fixed amount every month. */
function FlexCell({ r, ph, limit, onLimit, setByCode }: {
  r: Row;
  ph: PayHeadDTO;
  limit: string;
  onLimit: (v: string) => void;
  setByCode: (code: string, patch: Partial<Row>) => void;
}) {
  const on = r.calcMode === 'flat_amount';
  const limitPaise = rupeesToPaise(limit || '0');
  const edited = limitPaise !== (ph.maxClaimablePaise ?? 0);
  const toggle = (next: boolean) => setByCode(r.payHeadCode, next
    ? { calcMode: 'flat_amount' }
    : { calcMode: 'flat_per_month', amountRupees: Number(r.amountRupees) > 0 ? r.amountRupees : String(limitPaise / 100) });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ ...checkRow, color: 'var(--ink)' }}>
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
        Flexible (FBP): each person sets it on the app
      </label>
      {on ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Up to</span>
          <div style={pairBox}>
            <span style={{ ...pairSuffix, borderLeft: 'none', borderRight: '1px solid var(--line)' }}>₹</span>
            <input type="number" min={0} step={1} value={limit} onChange={(e) => onLimit(e.target.value)} style={pairInput} aria-label={`${ph.name} monthly limit`} />
            <span style={pairSuffix}>/ month</span>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'var(--ink-3)' }}>₹</span>
          <input type="number" value={r.amountRupees} onChange={(e) => setByCode(r.payHeadCode, { amountRupees: e.target.value })} style={{ ...miniInput, width: 100 }} />
          <span style={{ color: 'var(--ink-3)' }}>/ mo, the same for everyone</span>
        </div>
      )}
      {on && limitPaise <= 0 && <div style={{ fontSize: 11.5, color: 'var(--warn)' }}>Give it a monthly limit above ₹0, or it is not flexible.</div>}
      {on && edited && limitPaise > 0 && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Saved on the component: every template with {ph.name} gets this limit.</div>}
    </div>
  );
}

/** The pool people on the template split among its flexible heads, against what the heads can take. */
function FlexiblePoolCard({ heads, pool, onPool, balancingName }: {
  heads: FlexHead[];
  /** Rupees; blank: not set. */
  pool: string;
  onPool?: (v: string) => void;
  balancingName?: string;
}) {
  const sum = heads.reduce((t, h) => t + h.limitPaise, 0);
  const set = pool.trim() !== '';
  const poolPaise = set ? rupeesToPaise(pool) : 0;
  const over = set && poolPaise > sum;
  const scale = Math.max(poolPaise, sum, 1);
  const missing = !set && heads.length > 0;
  const balancing = balancingName ?? 'the balancing component';
  let status: { text: string; warn?: boolean };
  if (heads.length === 0) status = { text: 'No flexible heads yet: tick Flexible on a reimbursement and give it a monthly limit.', warn: set };
  else if (!set) status = { text: 'Not set. Required for a template with flexible heads: until it is set, the app tells people on this template that their split is not configured, and nobody can split.', warn: true };
  else if (over) status = { text: `The pool is ${rupees2(poolPaise - sum)} more than the heads can take. At most ${rupees2(sum)} can be assigned; the rest is always paid as ${balancing}.`, warn: true };
  else if (poolPaise < sum) status = { text: `People choose where ${rupees2(poolPaise)} goes; the heads could take up to ${rupees2(sum)} together.` };
  else status = { text: 'The pool matches the limits added up.' };
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 20px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>Flexible pool</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2, maxWidth: 620 }}>
            What each person on this template splits among the flexible heads on the app (Payroll › Change my split), each within its limit. What they leave unassigned is paid as {balancing} and taxed in full.
          </div>
        </div>
        {onPool ? (
          <div style={{ width: 230 }}>
            <PoolInput value={pool} onChange={onPool} placeholder="Not set" missing={missing} />
          </div>
        ) : (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: set ? 'var(--ink)' : missing ? 'var(--warn)' : 'var(--ink-3)' }}>{set ? rupees2(poolPaise) : 'Not set'}</div>
            <div style={L.cellSub}>{set ? 'a month' : missing ? 'Required: edit the template to set it' : 'a month'}</div>
          </div>
        )}
      </div>
      {heads.length > 0 && (
        <div style={{ padding: '4px 20px 6px', borderTop: '1px solid var(--line)' }}>
          {heads.map((h) => (
            <div key={h.code} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', fontSize: 13.5 }}>
              <span style={{ flex: 1 }}>{h.name}</span>
              <span style={{ color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>up to {rupees2(h.limitPaise)}</span>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 110px', alignItems: 'center', gap: 12, padding: '10px 0 4px', fontSize: 12.5, color: 'var(--ink-2)' }}>
            <span>Pool</span>
            <div style={L.barTrack}><div style={{ width: `${(poolPaise / scale) * 100}%`, height: '100%', background: over ? 'var(--p-yellow)' : 'var(--p-blue)', borderRadius: 99 }} /></div>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: set ? undefined : 'var(--warn)' }}>{set ? rupees2(poolPaise) : 'Not set'}</span>
            <span>Limits added up</span>
            <div style={L.barTrack}><div style={{ width: `${(sum / scale) * 100}%`, height: '100%', background: 'var(--p-green)', borderRadius: 99 }} /></div>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupees2(sum)}</span>
          </div>
        </div>
      )}
      <div style={{ padding: '10px 20px 14px', borderTop: '1px solid var(--line)', fontSize: 12.5, color: status.warn ? 'var(--warn)' : 'var(--ink-3)' }}>
        {status.text}
        {!balancingName && heads.length > 0 && <span style={{ color: 'var(--warn)' }}> No balancing component is set: choose one above so what is left unassigned is paid.</span>}
      </div>
    </Card>
  );
}

/** The pool field: whole rupees; blank is "not set". */
function PoolInput({ value, onChange, placeholder, missing }: { value: string; onChange: (v: string) => void; placeholder: string; missing?: boolean }) {
  return (
    <div className="lk-field" style={{ display: 'flex', alignItems: 'center', height: 42, border: `1px solid ${missing ? 'var(--warn)' : 'var(--line-2)'}`, borderRadius: 12, overflow: 'hidden', background: 'var(--surface)' }}>
      <span style={{ padding: '0 10px', fontSize: 12, color: 'var(--ink-3)', borderRight: '1px solid var(--line-2)', alignSelf: 'stretch', display: 'flex', alignItems: 'center', background: 'var(--surface-2)' }}>₹</span>
      <input type="number" min="0" step="1" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label="Flexible pool a month" style={{ border: 'none', outline: 'none', padding: '0 12px', fontSize: 13, width: '100%', color: 'var(--ink)', background: 'transparent', fontFamily: 'inherit' }} />
      <span style={{ padding: '0 12px', fontSize: 12, color: 'var(--ink-3)', borderLeft: '1px solid var(--line-2)', alignSelf: 'stretch', display: 'flex', alignItems: 'center', background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>a month</span>
    </div>
  );
}

function OvertimeCard({ rule, onChange }: { rule: OvertimePayRule | null; onChange: (v: OvertimePayRule | null) => void }) {
  const mode = rule?.mode ?? 'off';
  const pick = (m: 'off' | 'hourly_multiple' | 'flat_per_hour') =>
    onChange(m === 'off' ? null : m === 'hourly_multiple' ? { mode: m, base: 'basic', multiplier: 2, hoursPerDay: 8 } : { mode: m, flatPerHourPaise: 20000 });
  const row = (label: string, control: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
      <div style={{ flex: 1, fontSize: 13.5, fontWeight: 400, color: 'var(--ink)' }}>{label}</div>
      <div style={{ width: 220 }}>{control}</div>
    </div>
  );
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>Overtime pay</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>Turns each person's approved overtime hours into pay when payroll runs. HR can still change the amount on the run.</div>
        </div>
        <select value={mode} onChange={(e) => pick(e.target.value as 'off' | 'hourly_multiple' | 'flat_per_hour')} style={{ ...input, width: 230, cursor: 'pointer' }}>
          <option value="off">Typed on the run</option>
          <option value="hourly_multiple">From the hourly rate</option>
          <option value="flat_per_hour">Fixed amount per hour</option>
        </select>
      </div>
      {rule?.mode === 'hourly_multiple' && (
        <>
          {row('Hourly rate from', (
            <select value={rule.base ?? 'basic'} onChange={(e) => onChange({ ...rule, base: e.target.value as 'basic' | 'gross' })} style={{ ...input, cursor: 'pointer' }}>
              <option value="basic">Monthly Basic</option>
              <option value="gross">Monthly Gross</option>
            </select>
          ))}
          {row('Working hours a day', <Suffixed value={rule.hoursPerDay ?? 8} onChange={(v) => onChange({ ...rule, hoursPerDay: v })} suffix="hours" step="0.5" />)}
          {row('Pay per overtime hour', <Suffixed value={rule.multiplier ?? 2} onChange={(v) => onChange({ ...rule, multiplier: v })} suffix="× hourly rate" step="0.25" />)}
          <div style={{ padding: '10px 20px 16px', fontSize: 12.5, color: 'var(--ink-3)' }}>
            Hourly rate = monthly {rule.base === 'gross' ? 'Gross' : 'Basic'} ÷ (working days × {rule.hoursPerDay ?? 8} hours). The Factories Act sets overtime at twice the ordinary rate.
          </div>
        </>
      )}
      {rule?.mode === 'flat_per_hour' && row('Amount per hour', (
        <Suffixed value={(rule.flatPerHourPaise ?? 0) / 100} onChange={(v) => onChange({ ...rule, flatPerHourPaise: Math.round(v * 100) })} suffix="₹ / hour" step="1" />
      ))}
    </Card>
  );
}

function Suffixed({ value, onChange, suffix, step }: { value: number; onChange: (v: number) => void; suffix: string; step: string }) {
  return (
    <div className="lk-field" style={{ display: 'flex', alignItems: 'center', height: 42, border: '1px solid var(--line-2)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)' }}>
      <input type="number" min="0" step={step} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} style={{ border: 'none', outline: 'none', padding: '0 12px', fontSize: 13, width: '100%', color: 'var(--ink)', background: 'transparent', fontFamily: 'inherit' }} />
      <span style={{ padding: '0 12px', fontSize: 12, color: 'var(--ink-3)', borderLeft: '1px solid var(--line-2)', alignSelf: 'stretch', display: 'flex', alignItems: 'center', background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>{suffix}</span>
    </div>
  );
}

const ruleTd: CSSProperties = { padding: '10px 20px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle', fontSize: 13.5 };
export const dangerLink: CSSProperties = { background: 'none', border: 'none', color: 'var(--bad)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };
const toggleWrap: CSSProperties = { ...L.seg, padding: 3 };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const toggleBtn = (on: boolean, _yes: boolean): CSSProperties => ({ ...L.segBtn(on), height: 26, padding: '0 10px', fontSize: 12 });

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
  if (isBalancing) return <span style={{ color: 'var(--ink-2)' }}>Fixed amount</span>;
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
            <span style={{ ...pairSuffix, borderLeft: 'none', borderRight: '1px solid var(--line)' }}>₹</span>
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
          <span style={{ color: 'var(--ink-3)' }}>%</span>
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
          <span style={{ color: 'var(--ink-3)' }}>₹</span>
          <input type="number" value={r.amountRupees} onChange={(e) => setByCode(r.payHeadCode, { amountRupees: e.target.value })} style={{ ...miniInput, width: 100 }} />
          <span style={{ color: 'var(--ink-3)' }}>/ mo</span>
        </div>
      )}
      {r.calcMode === 'flat_amount' && <span style={{ color: 'var(--ink-3)' }}>Fixed amount</span>}
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
    <div style={flat ? { border: '1px solid var(--line)', borderRadius: 14, padding: '0 20px' } : { borderTop: '1px solid var(--line)', marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: flat ? '14px 0 4px' : '14px 22px 4px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--hi)' }}>Statutory Components</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Same for everyone · set in Payroll › Statutory Components · a one-person exception is made on that person’s salary</div>
      </div>
      {rows.map((r) => (
        <div key={r.name} style={{ display: 'grid', gridTemplateColumns: computed === undefined ? '1fr 2fr' : '1fr 2fr 140px', gap: 12, padding: pad, borderTop: '1px solid var(--line)', fontSize: 13.5, alignItems: 'center' }}>
          <div style={{ fontWeight: 400, color: 'var(--ink)' }}>{r.name}</div>
          <div style={{ color: 'var(--ink-3)' }}>{r.how}</div>
          {computed !== undefined && (
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)' }}>{r.monthly === undefined ? '—' : `₹${rupees(r.monthly)}`}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function CtcInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="lk-field" style={{ display: 'flex', alignItems: 'center', height: 42, border: '1px solid var(--line-2)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)', width: 'fit-content' }}>
      <span style={{ padding: '0 12px', height: '100%', display: 'flex', alignItems: 'center', color: 'var(--ink-3)', borderRight: '1px solid var(--line-2)', background: 'var(--surface-2)', fontSize: 13 }}>₹</span>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '0 12px', fontSize: 13, width: 190, color: 'var(--ink)', background: 'none', fontFamily: 'inherit' }} />
      <span style={{ padding: '0 12px', color: 'var(--ink-3)', fontSize: 12 }}>per year</span>
    </div>
  );
}

function GroupRows({ label, cols, big, children }: { label: string; cols: number; big?: boolean; children: ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={cols} style={{ padding: big ? '18px 12px 6px' : '16px 12px 6px', ...L.eyebrow }}>{label}</td>
      </tr>
      {children}
    </>
  );
}
/** An amount still being worked out: a placeholder rather than ₹0. */
function AmountPending() {
  return <span className="sk-delay" style={{ display: 'inline-flex' }}><Skeleton w={72} h={11} /></span>;
}

function TotalRow({ monthly, cols, pending }: { monthly: number; cols: number; pending?: boolean }) {
  const cell: CSSProperties = { ...detTd, fontWeight: 600, fontSize: 13.5, borderTop: '2px solid var(--line-2)', borderBottom: 0 };
  const num: CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  return (
    <tr>
      <td style={cell}>Cost to Company</td>
      {cols === 4 && <td style={cell} />}
      <td style={num}>{pending ? <AmountPending /> : `₹${rupees(monthly)}`}</td>
      <td style={num}>{pending ? <AmountPending /> : `₹${rupees(monthly * 12)}`}</td>
    </tr>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return <th style={L.th}>{children}</th>;
}
export function Td({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <td style={{ ...L.td, color: muted ? 'var(--ink-2)' : 'var(--ink)' }}>{children}</td>;
}
export function StatusText({ on }: { on: boolean }) {
  return <span style={L.pill(on ? 'ok' : 'mute')}><span aria-hidden style={L.pillDot} />{on ? 'Active' : 'Inactive'}</span>;
}
export function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={fieldLabel}>{label}{required && <span style={{ color: 'var(--bad)' }}> *</span>}</label>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const fieldLabel: CSSProperties = { ...L.label };
export const input: CSSProperties = { ...L.input };
const miniInput: CSSProperties = { height: 34, padding: '0 10px', border: '1px solid var(--line-2)', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' };
const miniSelect: CSSProperties = { height: 34, padding: '0 10px', border: '1px solid var(--line-2)', borderRadius: 999, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer' };
const pairBox: CSSProperties = { display: 'inline-flex', alignItems: 'stretch', height: 34, border: '1px solid var(--line-2)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' };
const pairInput: CSSProperties = { border: 'none', outline: 'none', padding: '0 10px', fontSize: 13, width: 96, color: 'var(--ink)', background: 'none', fontFamily: 'inherit' };
const pairSuffix: CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 12, color: 'var(--ink-2)', background: 'var(--surface-2)', borderLeft: '1px solid var(--line-2)', whiteSpace: 'nowrap' };
export const tableStyle: CSSProperties = { ...L.table };
const detTh: CSSProperties = { ...L.th };
const detTd: CSSProperties = { ...L.td };
const numTd: CSSProperties = { ...detTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const bldTh: CSSProperties = { ...L.th };
const bldTd: CSSProperties = { ...L.td, padding: '12px' };
const ctcBand: CSSProperties = { display: 'flex', alignItems: 'center', background: 'var(--accent-soft)', borderRadius: 14, padding: '16px 20px', fontSize: 16, fontWeight: 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 400, color: 'var(--ink-2)' };
export const primaryBtn: CSSProperties = { ...L.btnPrimary };
export const ghostBtn: CSSProperties = { ...L.btn };
const iconBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 4, opacity: 0.65 };
const closeCircle: CSSProperties = { width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink-2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
// The builder is its own page over the whole dashboard, left nav included.
const builderPage: CSSProperties = { position: 'fixed', inset: 0, zIndex: 90, background: 'var(--canvas)', display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', fontFamily: 'inherit' };
const builderCard: CSSProperties = { border: '1px solid transparent', borderRadius: 'var(--r-lg)', background: 'var(--surface)', boxShadow: 'var(--shadow)' };
const navGroupBtn: CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', padding: '12px 0', fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', color: 'var(--hi)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' };
const navItemBtn: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '10px 0', fontSize: 13.5, color: 'var(--ink)', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.3 };
