// Salary Templates (Pay Groups) — Zoho-style. Three modes:
//   list   — Template Name · Description · Status  (+ Create New)
//   detail — read-only grouped breakdown (Earnings / Reimbursements / FBP /
//            Benefits / One-Time), Monthly + Annual columns, Cost to Company.
//   edit   — grouped editable table: pick a calculation per component inline,
//            live Monthly/Annual columns, add components, Cost to Company.
// Amounts are computed by the backend preview; components the preview doesn't
// return (reimbursements, benefits) are resolved from their calculation basis.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import {
  createSalaryTemplate,
  deleteSalaryTemplate,
  getSalaryTemplate,
  listPayHeads,
  listSalaryTemplates,
  previewSalaryTemplate,
  rupeesToPaise,
  updateSalaryTemplate,
} from '../../services/payroll';
import type {
  CalculationBasis,
  CalculationMode,
  ComputedStructure,
  PayHeadDTO,
  PercentageBase,
  SalaryTemplateDTO,
  SalaryTemplateInput,
} from '../../services/payroll';
import { Card, EmptyRow } from '../ui';
import { IconClose, IconPlus } from '../icons';

type Mode = 'list' | 'detail' | 'edit';

type Row = {
  payHeadCode: string;
  calcMode: CalculationMode;
  percent: string;
  base: PercentageBase;
  baseComponentCode: string;
  amountRupees: string;
};
type Form = {
  editingCode?: string;
  name: string;
  code: string;
  description: string;
  active: boolean;
  rows: Row[];
  balancingComponentCode: string;
  epfApplyCeiling: boolean;
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
function buildInput(f: Form): SalaryTemplateInput {
  return {
    name: f.name.trim(),
    code: f.code.trim().toUpperCase(),
    description: f.description.trim() || undefined,
    components: f.rows.filter((r) => r.payHeadCode).map((r) => ({ payHeadCode: r.payHeadCode, calculation: calcFromRow(r) })),
    balancingComponentCode: f.balancingComponentCode || null,
    epfApplyCeiling: f.epfApplyCeiling,
    active: f.active,
  };
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
function groupOf(ph?: PayHeadDTO): Group {
  if (!ph) return 'earning';
  if (ph.recurrence === 'one_time') return 'onetime';
  if (ph.fbp) return 'fbp';
  if (ph.category === 'reimbursement') return 'reimbursement';
  if (ph.category === 'benefit') return 'benefit';
  if (ph.category === 'deduction') return 'deduction';
  return 'earning';
}

/** Plain "1,500" (no ₹, no rounding beyond paise). */
function rupees(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function calcSubtitle(c: CalculationBasis, ph: PayHeadDTO | undefined, isBalancing: boolean, phByCode: Map<string, PayHeadDTO>): string {
  if (ph?.category === 'reimbursement' && ph.maxClaimablePaise) return `Max Limit ₹${rupees(ph.maxClaimablePaise)} · Monthly Carry Forward`;
  if (isBalancing) return 'Monthly CTC − Sum of all other components';
  if (c.mode === 'percentage') {
    const baseLbl = c.base === 'ctc' ? 'Fixed CTC' : c.base === 'basic' ? 'Basic' : phByCode.get(c.baseComponentCode ?? '')?.name ?? 'component';
    return `${c.percent}% of ${baseLbl}`;
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
  const [loading, setLoading] = useState(true);

  // detail
  const [detailTpl, setDetailTpl] = useState<SalaryTemplateDTO | null>(null);
  const [detailCtc, setDetailCtc] = useState('1500000');
  const [detailComputed, setDetailComputed] = useState<ComputedStructure | null>(null);

  // edit
  const [form, setForm] = useState<Form | null>(null);
  const [computed, setComputed] = useState<ComputedStructure | null>(null);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [ts, phs] = await Promise.all([listSalaryTemplates(), listPayHeads()]);
      setTemplates(ts);
      setPayHeadsList(phs);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load templates');
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

  // —— Detail: recompute amounts against the entered CTC ——
  useEffect(() => {
    if (mode !== 'detail' || !detailTpl) return;
    const input: SalaryTemplateInput & { sampleAnnualCtcPaise: number } = {
      name: detailTpl.name,
      code: detailTpl.code,
      description: detailTpl.description,
      components: detailTpl.components,
      balancingComponentCode: detailTpl.balancingComponentCode ?? null,
      epfApplyCeiling: detailTpl.epfApplyCeiling,
      active: detailTpl.active,
      sampleAnnualCtcPaise: rupeesToPaise(detailCtc),
    };
    if (input.components.length === 0) {
      setDetailComputed(null);
      return;
    }
    let cancelled = false;
    previewSalaryTemplate(input)
      .then((c) => !cancelled && setDetailComputed(c))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode, detailTpl, detailCtc]);

  // —— Edit: live preview whenever the form changes ——
  useEffect(() => {
    if (mode !== 'edit' || !form) return;
    if (debounce.current) clearTimeout(debounce.current);
    const snapshot = form;
    debounce.current = setTimeout(async () => {
      const input = buildInput(snapshot);
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
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load template');
    }
  };

  const newTemplate = () => {
    setForm({ name: '', code: '', description: '', active: true, rows: [], balancingComponentCode: '', epfApplyCeiling: true, sampleCtc: '1500000' });
    setComputed(null);
    setMode('edit');
  };
  const editCurrent = () => {
    const t = detailTpl;
    if (!t) return;
    setForm({
      editingCode: t.code,
      name: t.name,
      code: t.code,
      description: t.description ?? '',
      active: t.active,
      rows: t.components.map((c) => rowFromCalc(c.payHeadCode, c.calculation)),
      balancingComponentCode: t.balancingComponentCode ?? '',
      epfApplyCeiling: t.epfApplyCeiling,
      sampleCtc: detailCtc || '1500000',
    });
    setComputed(null);
    setMode('edit');
  };

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) return flash('Enter a template name');
    if (!form.code.trim()) return flash('Enter a code');
    if (form.rows.filter((r) => r.payHeadCode).length === 0) return flash('Add at least one component');
    setSaving(true);
    try {
      const input = buildInput(form);
      if (form.editingCode) await updateSalaryTemplate(form.editingCode, input);
      else await createSalaryTemplate(input);
      flash(`Template "${input.name}" saved`);
      await load();
      setForm(null);
      void openDetail(input.code);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save template');
    } finally {
      setSaving(false);
    }
  };

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
      flash(e instanceof ApiError ? e.message : 'Could not delete template');
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
    const { resolve } = amountResolver(detailComputed, payHeadsList, detailCtc);

    const buckets = new Map<Group, { comp: { payHeadCode: string; calculation: CalculationBasis }; ph?: PayHeadDTO }[]>();
    for (const comp of t.components) {
      const ph = phByCode.get(comp.payHeadCode);
      const g = groupOf(ph);
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g)!.push({ comp, ph });
    }

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <button onClick={() => setMode('list')} style={ghostBtn}>← All templates</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
            <button onClick={editCurrent} style={primaryBtn}>Edit</button>
          </div>
        </div>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 22px', borderBottom: '1px solid #EBEBEB' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.3px' }}>{t.name} <span style={{ color: '#9197A2', fontWeight: 600 }}>— Salary Template</span></div>
              {t.description && <div style={{ fontSize: 14, color: '#717171', marginTop: 3 }}>{t.description}</div>}
            </div>
            <StatusText on={t.active} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px', background: '#F7F7F9', borderBottom: '1px solid #EBEBEB' }}>
            <label style={{ fontSize: 14, fontWeight: 700, color: '#484848' }}>Annual CTC</label>
            <CtcInput value={detailCtc} onChange={setDetailCtc} />
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
            <thead>
              <tr>
                <th style={detTh}>Salary Components</th>
                <th style={{ ...detTh, textAlign: 'right', width: 180 }}>Monthly Amount</th>
                <th style={{ ...detTh, textAlign: 'right', width: 180 }}>Annual Amount</th>
              </tr>
            </thead>
            <tbody>
              {GROUP_ORDER.filter((g) => buckets.get(g)?.length).map((g) => (
                <GroupRows key={g} label={GROUP_LABEL[g]} cols={3}>
                  {buckets.get(g)!.map(({ comp, ph }) => {
                    const isBalancing = comp.payHeadCode === t.balancingComponentCode;
                    const amt = resolve(comp.payHeadCode, comp.calculation);
                    return (
                      <tr key={comp.payHeadCode}>
                        <td style={detTd}>
                          <div style={{ fontWeight: 600, color: '#222222' }}>{ph?.name ?? comp.payHeadCode}</div>
                          <div style={{ fontSize: 13, color: '#9197A2', marginTop: 2 }}>{calcSubtitle(comp.calculation, ph, isBalancing, phByCode)}</div>
                        </td>
                        <td style={{ ...detTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{g === 'onetime' ? '—' : `₹${rupees(amt.monthly)}`}</td>
                        <td style={{ ...detTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>₹{rupees(amt.annual)}</td>
                      </tr>
                    );
                  })}
                </GroupRows>
              ))}
              <TotalRow monthly={detailComputed?.employerCostMonthlyPaise ?? 0} cols={3} />
            </tbody>
          </table>
        </Card>
      </div>
    );
  }

  // ——————————————————————————————— EDIT (grouped builder) ———————————————————————————————
  if (!form) return null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const setByCode = (code: string, patch: Partial<Row>) => set('rows', form.rows.map((r) => (r.payHeadCode === code ? { ...r, ...patch } : r)));
  const removeByCode = (code: string) => set('rows', form.rows.filter((r) => r.payHeadCode !== code));
  const addComponent = (code: string) => {
    const ph = phByCode.get(code);
    if (!ph) return;
    set('rows', [...form.rows, rowFromCalc(code, ph.calculation)]);
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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <button onClick={() => (form.editingCode ? openDetail(form.editingCode) : setMode('list'))} style={ghostBtn}>← Back</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
          {form.editingCode && <button onClick={remove} disabled={saving} style={{ ...ghostBtn, color: '#A8475F', borderColor: '#EBD9DE' }}>Delete</button>}
          <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save template'}</button>
        </div>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {/* Identity + CTC header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #EBEBEB' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Template Name" required><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Below Taxable" style={input} /></Field>
            <Field label="Code" hint="Unique reference used when assigning to employees"><input value={form.code} disabled={Boolean(form.editingCode)} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="e.g. BELOW_TAXABLE" style={{ ...input, ...(form.editingCode ? { background: '#F7F7F9', color: '#717171' } : {}) }} /></Field>
          </div>
          <Field label="Description"><input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional — e.g. used for salary above 12 lakhs" style={input} /></Field>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <label style={fieldLabel}>Annual CTC</label>
              <CtcInput value={form.sampleCtc} onChange={(v) => set('sampleCtc', v)} />
            </div>
            <div style={{ minWidth: 220 }}>
              <label style={fieldLabel}>Balancing component <span style={{ fontWeight: 500, color: '#9197A2' }}>· reconciles to CTC</span></label>
              <select value={form.balancingComponentCode} onChange={(e) => set('balancingComponentCode', e.target.value)} style={input}>
                <option value="">None</option>
                {balancingOptions.map((code) => <option key={code} value={code}>{phByCode.get(code)?.name ?? code}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', paddingBottom: 8 }}>
              <label style={checkRow}><input type="checkbox" checked={form.epfApplyCeiling} onChange={(e) => set('epfApplyCeiling', e.target.checked)} /> EPF ceiling (₹15,000)</label>
              <label style={checkRow}><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active</label>
            </div>
          </div>
        </div>

        {/* Grouped component table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
          <thead>
            <tr>
              <th style={detTh}>Salary Components</th>
              <th style={{ ...detTh, width: 320 }}>Calculation Type</th>
              <th style={{ ...detTh, textAlign: 'right', width: 140 }}>Monthly</th>
              <th style={{ ...detTh, textAlign: 'right', width: 140 }}>Annual</th>
            </tr>
          </thead>
          <tbody>
            {form.rows.length === 0 && (
              <tr><td colSpan={4} style={{ ...detTd, textAlign: 'center', color: '#9197A2', padding: '26px' }}>No components yet — add one below.</td></tr>
            )}
            {GROUP_ORDER.filter((g) => rowBuckets.get(g)?.length).map((g) => (
              <GroupRows key={g} label={GROUP_LABEL[g]} cols={4}>
                {rowBuckets.get(g)!.map((r) => {
                  const ph = phByCode.get(r.payHeadCode);
                  const isBalancing = r.payHeadCode === form.balancingComponentCode;
                  const amt = resolve(r.payHeadCode, calcFromRow(r));
                  return (
                    <tr key={r.payHeadCode}>
                      <td style={detTd}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: '#222222' }}>{ph?.name ?? r.payHeadCode}</div>
                            {ph?.category === 'reimbursement' && ph.maxClaimablePaise ? (
                              <div style={{ fontSize: 13, color: '#9197A2', marginTop: 2 }}>Max Limit ₹{rupees(ph.maxClaimablePaise)}</div>
                            ) : isBalancing ? (
                              <div style={{ fontSize: 13, color: '#9197A2', marginTop: 2 }}>Balancing · reconciles to CTC</div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td style={detTd}>
                        <CalcCell r={r} isBalancing={isBalancing} form={form} phByCode={phByCode} setByCode={setByCode} />
                      </td>
                      <td style={{ ...detTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{g === 'onetime' ? '—' : `₹${rupees(amt.monthly)}`}</td>
                      <td style={{ ...detTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                          <span>₹{rupees(amt.annual)}</span>
                          <button onClick={() => removeByCode(r.payHeadCode)} title="Remove" style={iconBtn}><IconClose size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </GroupRows>
            ))}

            {/* Add component */}
            <tr>
              <td colSpan={4} style={{ padding: '14px 22px', borderBottom: '1px solid #F4F4F6' }}>
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) { addComponent(e.target.value); e.currentTarget.value = ''; } }}
                  style={{ ...input, width: 300, color: '#0571A6', fontWeight: 700, cursor: 'pointer' }}
                >
                  <option value="">＋ Add component…</option>
                  {unused.length === 0 && <option value="" disabled>All components added</option>}
                  {GROUP_ORDER.map((g) => {
                    const opts = unused.filter((p) => groupOf(p) === g);
                    if (!opts.length) return null;
                    return (
                      <optgroup key={g} label={GROUP_LABEL[g]}>
                        {opts.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                      </optgroup>
                    );
                  })}
                </select>
              </td>
            </tr>

            <TotalRow monthly={computed?.employerCostMonthlyPaise ?? 0} cols={4} />
          </tbody>
        </table>
      </Card>
      <div style={{ fontSize: 13, color: '#9197A2', margin: '10px 4px' }}>Note: changes apply to future associations only. Monthly / Annual figures preview against the Annual CTC above.</div>
    </div>
  );
}

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
  if (isBalancing) return <span style={{ color: '#717171' }}>System Calculated (balancing)</span>;
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

function CtcInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff', width: 'fit-content' }}>
      <span style={{ padding: '8px 10px', color: '#717171', borderRight: '1px solid #EBEBEB' }}>₹</span>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '8px 10px', fontSize: 16, width: 150, color: '#222222' }} />
      <span style={{ padding: '8px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14 }}>per year</span>
    </div>
  );
}

function GroupRows({ label, cols, children }: { label: string; cols: number; children: ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={cols} style={{ padding: '14px 22px 6px', fontSize: 15, fontWeight: 800, color: '#222222' }}>{label}</td>
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

const fieldLabel: CSSProperties = { display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' };
const input: CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const miniInput: CSSProperties = { padding: '6px 8px', border: '1px solid #EBEBEB', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const miniSelect: CSSProperties = { padding: '6px 8px', border: '1px solid #EBEBEB', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: '#fff', color: '#222222', cursor: 'pointer' };
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const detTh: CSSProperties = { textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 22px', borderBottom: '1px solid #EBEBEB', background: '#FBFBFC' };
const detTd: CSSProperties = { padding: '12px 22px', borderBottom: '1px solid #F4F4F6', color: '#222222' };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 700, color: '#484848' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const iconBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 4, opacity: 0.65 };
