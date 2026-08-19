// Salary Templates (Pay Groups) — reusable salary structures. Pick components from
// the Pay Head Master, set each one's calculation IN the template, choose a
// balancing component, and preview against a sample CTC. Assigned to employees on
// the Salary Structure screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import {
  createSalaryTemplate,
  deleteSalaryTemplate,
  getSalaryTemplate,
  inr,
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
import { Card, EmptyRow, SummaryCard } from '../ui';
import { IconClose, IconPlus } from '../icons';

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

export function SalaryTemplates() {
  const { flash } = useStore();
  const [templates, setTemplates] = useState<SalaryTemplateDTO[]>([]);
  const [payHeadsList, setPayHeadsList] = useState<PayHeadDTO[]>([]);
  const [loading, setLoading] = useState(true);
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

  // Live preview whenever the form changes.
  useEffect(() => {
    if (!form) return;
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
        // invalid intermediate state (e.g. cycle) — leave last good preview
      }
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(form)]);

  const newTemplate = () =>
    setForm({ name: '', code: '', description: '', active: true, rows: [], balancingComponentCode: '', epfApplyCeiling: true, sampleCtc: '1500000' });

  const editTemplate = async (code: string) => {
    try {
      const t = await getSalaryTemplate(code);
      setForm({
        editingCode: t.code,
        name: t.name,
        code: t.code,
        description: t.description ?? '',
        active: t.active,
        rows: t.components.map((c) => rowFromCalc(c.payHeadCode, c.calculation)),
        balancingComponentCode: t.balancingComponentCode ?? '',
        epfApplyCeiling: t.epfApplyCeiling,
        sampleCtc: '1500000',
      });
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load template');
    }
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
      setForm(null);
      await load();
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
      await load();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not delete template');
    } finally {
      setSaving(false);
    }
  };

  // —— List ——
  if (!form) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button onClick={newTemplate} style={primaryBtn}><IconPlus size={15} /> New template</button>
        </div>
        <Card>
          {loading ? (
            <EmptyRow text="Loading…" />
          ) : templates.length === 0 ? (
            <EmptyRow text="No salary templates yet — create your first pay group." />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr><Th>Template</Th><Th>Code</Th><Th>Description</Th><Th right>Components</Th><Th>Status</Th></tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.code} onClick={() => editTemplate(t.code)} style={{ cursor: 'pointer' }}>
                    <Td><strong style={{ color: '#0571A6' }}>{t.name}</strong></Td>
                    <Td muted><code>{t.code}</code></Td>
                    <Td muted>{t.description || '—'}</Td>
                    <Td right mono>{t.components.length}</Td>
                    <Td><Badge on={t.active}>{t.active ? 'Active' : 'Inactive'}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    );
  }

  // —— Builder ——
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const setRow = (i: number, patch: Partial<Row>) => set('rows', form.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => set('rows', [...form.rows, { payHeadCode: '', calcMode: 'percentage', percent: '50', base: 'ctc', baseComponentCode: '', amountRupees: '0' }]);
  const removeRow = (i: number) => set('rows', form.rows.filter((_, j) => j !== i));
  const pickPayHead = (i: number, code: string) => {
    const ph = phByCode.get(code);
    setRow(i, ph ? rowFromCalc(code, ph.calculation) : { payHeadCode: code });
  };
  const usedCodes = new Set(form.rows.map((r) => r.payHeadCode).filter(Boolean));
  const balancingOptions = earningCodesInForm(form);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <button onClick={() => setForm(null)} style={ghostBtn}>← All templates</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
          {form.editingCode && <button onClick={remove} disabled={saving} style={{ ...ghostBtn, color: '#A8475F', borderColor: '#EBD9DE' }}>Delete</button>}
          <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save template'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Card style={{ padding: '16px 18px', marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Template name"><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Below Taxable" style={input} /></Field>
              <Field label="Code" hint="Unique reference used when assigning to employees"><input value={form.code} disabled={Boolean(form.editingCode)} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="e.g. BELOW_TAXABLE" style={{ ...input, ...(form.editingCode ? { background: '#F7F7F9', color: '#717171' } : {}) }} /></Field>
            </div>
            <Field label="Description"><input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional — e.g. used for salary above 12 lakhs" style={input} /></Field>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 4 }}>
              <label style={checkRow}><input type="checkbox" checked={form.epfApplyCeiling} onChange={(e) => set('epfApplyCeiling', e.target.checked)} /> EPF wage ceiling (₹15,000)</label>
              <label style={checkRow}><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active</label>
            </div>
          </Card>

          <Card style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Components</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {form.rows.map((r, i) => {
                const ph = phByCode.get(r.payHeadCode);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <select value={r.payHeadCode} onChange={(e) => pickPayHead(i, e.target.value)} style={{ ...input, width: 200 }}>
                      <option value="">Select component…</option>
                      {payHeadsList.map((p) => (
                        <option key={p.code} value={p.code} disabled={usedCodes.has(p.code) && p.code !== r.payHeadCode}>{p.name} ({p.category})</option>
                      ))}
                    </select>
                    <select value={r.calcMode} onChange={(e) => setRow(i, { calcMode: e.target.value as CalculationMode })} style={{ ...input, width: 150 }}>
                      <option value="percentage">Percentage</option>
                      <option value="flat_per_month">Flat / month</option>
                      <option value="flat_amount">Flat (per employee)</option>
                    </select>
                    {r.calcMode === 'percentage' && (
                      <>
                        <input type="number" step="0.01" value={r.percent} onChange={(e) => setRow(i, { percent: e.target.value })} style={{ ...input, width: 80 }} />
                        <select value={r.base} onChange={(e) => setRow(i, { base: e.target.value as PercentageBase })} style={{ ...input, width: 120 }}>
                          <option value="ctc">% of CTC</option>
                          <option value="basic">% of Basic</option>
                          <option value="component">% of…</option>
                        </select>
                        {r.base === 'component' && (
                          <select value={r.baseComponentCode} onChange={(e) => setRow(i, { baseComponentCode: e.target.value })} style={{ ...input, width: 140 }}>
                            <option value="">base…</option>
                            {form.rows.filter((x) => x.payHeadCode && x.payHeadCode !== r.payHeadCode).map((x) => <option key={x.payHeadCode} value={x.payHeadCode}>{x.payHeadCode}</option>)}
                          </select>
                        )}
                      </>
                    )}
                    {r.calcMode === 'flat_per_month' && (
                      <input type="number" value={r.amountRupees} onChange={(e) => setRow(i, { amountRupees: e.target.value })} placeholder="₹/month" style={{ ...input, width: 120 }} />
                    )}
                    {ph && <span style={{ fontSize: 12, color: '#717171' }}>{ph.category}</span>}
                    <button onClick={() => removeRow(i)} style={iconBtn}><IconClose size={14} /></button>
                  </div>
                );
              })}
            </div>
            <button onClick={addRow} style={{ ...ghostBtn, marginTop: 10, fontSize: 14, padding: '6px 12px' }}>+ Add component</button>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              <Field label="Balancing component" hint="Absorbs the residual so gross reconciles to CTC">
                <select value={form.balancingComponentCode} onChange={(e) => set('balancingComponentCode', e.target.value)} style={input}>
                  <option value="">None</option>
                  {balancingOptions.map((code) => <option key={code} value={code}>{phByCode.get(code)?.name ?? code}</option>)}
                </select>
              </Field>
              <Field label="Preview against sample CTC (₹/year)">
                <input type="number" value={form.sampleCtc} onChange={(e) => set('sampleCtc', e.target.value)} style={input} />
              </Field>
            </div>
          </Card>
        </div>

        {/* Live preview */}
        <div style={{ width: 340, flexShrink: 0 }}>
          <Card style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Preview</div>
            {!computed ? (
              <div style={{ fontSize: 14, color: '#717171' }}>Add components to see the breakup.</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <SummaryCard label="Gross / mo" value={inr(computed.grossMonthlyPaise)} />
                  <SummaryCard label="Net / mo" value={inr(computed.netMonthlyPaise)} color="#4F7A52" />
                </div>
                <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                  <tbody>
                    {computed.earnings.map((e) => (
                      <tr key={e.code}><td style={pc}>{e.name}</td><td style={{ ...pc, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inr(e.monthlyPaise)}</td></tr>
                    ))}
                    {computed.deductions.map((d) => (
                      <tr key={d.code}><td style={{ ...pc, color: '#A8475F' }}>{d.name}</td><td style={{ ...pc, textAlign: 'right', color: '#A8475F' }}>−{inr(d.monthlyPaise)}</td></tr>
                    ))}
                    <tr><td style={{ ...pc, fontWeight: 700 }}>EPF (employee)</td><td style={{ ...pc, textAlign: 'right', fontWeight: 700 }}>{inr(computed.statutory.epf.employeePaise)}</td></tr>
                  </tbody>
                </table>
                {computed.overBudget && <div style={{ marginTop: 10, fontSize: 14, color: '#A8475F', fontWeight: 600 }}>Components exceed the sample CTC — balancing floored at ₹0.</div>}
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 16px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, muted, right, mono }: { children: ReactNode; muted?: boolean; right?: boolean; mono?: boolean }) {
  return <td style={{ padding: '11px 16px', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222', textAlign: right ? 'right' : 'left', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}
function Badge({ children, on }: { children: ReactNode; on: boolean }) {
  const t = on ? { bg: '#E4EDE0', fg: '#4F7A52' } : { bg: '#F7F7F9', fg: '#717171' };
  return <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: t.bg, color: t.fg }}>{children}</span>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: '#717171', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const input: CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const pc: CSSProperties = { padding: '5px 0', borderBottom: '1px solid #F0F0F2' };
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 700, color: '#484848' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const iconBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 4 };
