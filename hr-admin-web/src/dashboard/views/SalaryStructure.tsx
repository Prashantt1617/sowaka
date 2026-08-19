// Salary Structure — assign a Salary Template to an employee (PRD §5.6). Pick a
// template + Annual CTC, set per-employee statutory applicability, bonus category,
// and any flat-amount overrides; the CTC breakup + EPF preview compute live.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { getAllEmployees } from '../../services/hrms';
import type { EmployeeDTO } from '../../services/hrms';
import {
  getSalaryStructure,
  inr,
  listSalaryTemplates,
  previewSalaryStructure,
  rupeesToPaise,
  saveSalaryStructure,
} from '../../services/payroll';
import type { ComputedStructure, EmployeeStatutory, SalaryStructureInput, SalaryTemplateDTO } from '../../services/payroll';
import { Card, EmptyRow, SummaryCard } from '../ui';

const BONUS_CATEGORIES = ['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'];
const prettify = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function SalaryStructure() {
  const { flash } = useStore();
  const [employees, setEmployees] = useState<EmployeeDTO[]>([]);
  const [templates, setTemplates] = useState<SalaryTemplateDTO[]>([]);
  const [userId, setUserId] = useState('');
  const [templateCode, setTemplateCode] = useState('');
  const [ctc, setCtc] = useState('1200000');
  const [statutory, setStatutory] = useState<EmployeeStatutory>({ epf: true, esi: true, lwf: true });
  const [bonusCategory, setBonusCategory] = useState('skilled');
  const [componentValues, setComponentValues] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<'draft' | 'active'>('draft');
  const [computed, setComputed] = useState<ComputedStructure | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [emps, tmpls] = await Promise.all([getAllEmployees(), listSalaryTemplates()]);
        setEmployees(emps);
        setTemplates(tmpls.filter((t) => t.active));
        if (emps.length > 0) setUserId(emps[0].userId);
      } catch (e) {
        flash(e instanceof ApiError ? e.message : 'Could not load data');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const { structure } = await getSalaryStructure(userId);
        setTemplateCode(structure.salaryTemplateCode ?? '');
        setCtc(String(structure.annualCtcPaise / 100));
        setStatutory({ epf: structure.statutory.epf !== false, esi: structure.statutory.esi !== false, lwf: structure.statutory.lwf !== false });
        setBonusCategory(structure.bonusCategory ?? 'skilled');
        setComponentValues(structure.componentValues ?? {});
        setStatus(structure.status);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setTemplateCode('');
          setComponentValues({});
          setStatutory({ epf: true, esi: true, lwf: true });
          setBonusCategory('skilled');
          setStatus('draft');
          setComputed(null);
        } else {
          flash(e instanceof ApiError ? e.message : 'Could not load structure');
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const currentInput = (): SalaryStructureInput => ({
    salaryTemplateCode: templateCode || undefined,
    annualCtcPaise: rupeesToPaise(ctc),
    componentValues,
    statutory,
    bonusCategory,
  });

  useEffect(() => {
    if (!userId || !templateCode) {
      setComputed(null);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setBusy(true);
      try {
        setComputed(await previewSalaryStructure(userId, currentInput()));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) setComputed(null);
      } finally {
        setBusy(false);
      }
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, templateCode, ctc, bonusCategory, JSON.stringify(statutory), JSON.stringify(componentValues)]);

  const save = async (next: 'draft' | 'active') => {
    if (!userId) return;
    if (!templateCode) return flash('Pick a salary template first');
    setSaving(true);
    try {
      const { computed: c } = await saveSalaryStructure(userId, { ...currentInput(), status: next });
      setComputed(c);
      setStatus(next);
      flash(next === 'active' ? 'Salary structure activated' : 'Saved as draft');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const flatLines = useMemo(
    () => (computed ? computed.earnings.filter((e) => e.calcLabel === 'Flat (per employee)') : []),
    [computed],
  );
  const setFlat = (code: string, rupees: string) => setComponentValues((s) => ({ ...s, [code]: rupeesToPaise(rupees) }));
  const toggleStat = (k: keyof EmployeeStatutory) => setStatutory((s) => ({ ...s, [k]: !(s[k] !== false) }));
  const epf = computed?.statutory.epf;

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ minWidth: 240 }}>
          <label style={lbl}>Employee</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} style={input}>
            {employees.length === 0 && <option value="">No employees</option>}
            {employees.map((e) => <option key={e.userId} value={e.userId}>{e.name}{e.designation ? ` — ${e.designation}` : ''}</option>)}
          </select>
        </div>
        <div style={{ width: 220 }}>
          <label style={lbl}>Salary template</label>
          <select value={templateCode} onChange={(e) => setTemplateCode(e.target.value)} style={input}>
            <option value="">Select a template…</option>
            {templates.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
        </div>
        <div style={{ width: 180 }}>
          <label style={lbl}>Annual CTC (₹)</label>
          <input type="number" step="10000" value={ctc} onChange={(e) => setCtc(e.target.value)} style={input} />
        </div>
        <div style={{ width: 170 }}>
          <label style={lbl}>Bonus category</label>
          <select value={bonusCategory} onChange={(e) => setBonusCategory(e.target.value)} style={input}>
            {BONUS_CATEGORIES.map((c) => <option key={c} value={c}>{prettify(c)}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9, paddingBottom: 2 }}>
          <span style={{ alignSelf: 'center', fontSize: 14, fontWeight: 700, color: status === 'active' ? '#4F7A52' : '#9A6B25' }}>{status === 'active' ? '● Active' : '○ Draft'}</span>
          <button onClick={() => save('draft')} disabled={saving} style={ghostBtn}>Save draft</button>
          <button onClick={() => save('active')} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Activate'}</button>
        </div>
      </div>

      {templates.length === 0 && (
        <div style={{ background: '#F6E9D5', border: '1px solid #ECD9B4', color: '#9A6B25', borderRadius: 12, padding: '11px 15px', fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
          No salary templates yet — create one under <strong>Salary Templates</strong> first, then assign it here.
        </div>
      )}

      {/* Statutory toggles */}
      <Card style={{ padding: '12px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#484848', textTransform: 'uppercase', letterSpacing: '.04em' }}>Statutory for this employee</span>
          {(['epf', 'esi', 'lwf'] as const).map((k) => (
            <label key={k} style={checkRow}>
              <input type="checkbox" checked={statutory[k] !== false} onChange={() => toggleStat(k)} /> {k.toUpperCase()}
            </label>
          ))}
        </div>
      </Card>

      {!templateCode ? (
        <Card><EmptyRow text="Pick a salary template to see the breakup." /></Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16, opacity: busy ? 0.6 : 1 }}>
            <SummaryCard label="Monthly CTC" value={computed ? inr(computed.monthlyCtcPaise) : '—'} />
            <SummaryCard label="Gross / month" value={computed ? inr(computed.grossMonthlyPaise) : '—'} />
            <SummaryCard label="Deductions / month" value={computed ? inr(computed.employeeDeductionsMonthlyPaise) : '—'} color="#A8475F" />
            <SummaryCard label="Net pay / month" value={computed ? inr(computed.netMonthlyPaise) : '—'} color="#4F7A52" />
          </div>

          {flatLines.length > 0 && (
            <Card style={{ padding: '14px 18px', marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#484848', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>Per-employee amounts (flat components)</div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {flatLines.map((e) => (
                  <div key={e.code}>
                    <label style={lbl}>{e.name} (₹/month)</label>
                    <input type="number" value={String((componentValues[e.code] ?? 0) / 100)} onChange={(ev) => setFlat(e.code, ev.target.value)} style={{ ...input, width: 160 }} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card style={{ marginBottom: 16, opacity: busy ? 0.6 : 1 }}>
            {!computed ? (
              <EmptyRow text="Enter a CTC to compute." />
            ) : (
              <table style={tableStyle}>
                <thead><tr><Th>Component</Th><Th>Calculation</Th><Th right>Monthly (₹)</Th><Th right>Annual (₹)</Th></tr></thead>
                <tbody>
                  {computed.earnings.map((e) => (
                    <tr key={e.code}><Td>{e.name}</Td><Td muted>{e.calcLabel}</Td><Td right mono>{inr(e.monthlyPaise)}</Td><Td right mono>{inr(e.annualPaise)}</Td></tr>
                  ))}
                  {computed.deductions.map((d) => (
                    <tr key={d.code}><Td>{d.name} <Tag>deduction</Tag></Td><Td muted>{d.calcLabel}</Td><Td right mono>−{inr(d.monthlyPaise)}</Td><Td right mono>−{inr(d.annualPaise)}</Td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {epf && (
            <Card style={{ padding: '18px 20px' }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Statutory preview — EPF</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <Tile label="PF wage (capped ₹15,000)" value={inr(epf.contributionWagePaise)} />
                <Tile label="Employee EPF (12%)" value={inr(epf.employeePaise)} />
                <Tile label="Employer EPS (8.33%)" value={inr(epf.employerEpsPaise)} />
                <Tile label="Employer EPF residual" value={inr(epf.employerEpfPaise)} />
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#F7F7F9', border: '1px solid #EBEBEB', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 14, color: '#717171', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}
function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 16px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, muted, right, mono }: { children: ReactNode; muted?: boolean; right?: boolean; mono?: boolean }) {
  return <td style={{ padding: '10px 16px', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222', textAlign: right ? 'right' : 'left', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}
function Tag({ children }: { children: ReactNode }) {
  return <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: '#F4DEE2', color: '#A8475F' }}>{children}</span>;
}

const lbl: CSSProperties = { display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' };
const input: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 700, color: '#484848' };
const primaryBtn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
