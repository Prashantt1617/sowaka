// Employee profile › Salary details, laid out like Zoho Payroll's employee
// Salary Details tab:
//   Salary Details  — Annual and Monthly CTC, Revise
//   Salary Structure — the assigned template plus this person's own changes,
//                      grouped, with Monthly / Annual amounts and Cost to Company
//   Other Deductions — PF, ESI and LWF for this person, with on/off switches
//   Salary Revision History
// "Revise" opens a standalone Salary Revision page: pick the template, revise
// the CTC by a percentage or a new amount, then add, remove or edit components
// for this person only. Those changes are saved as overrides on top of the
// template; the template itself never changes.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import {
  getSalaryStructure,
  getStatutorySettings,
  listPayHeads,
  listSalaryTemplates,
  listPaidDaysTemplates,
  assignPaidDaysTemplate,
  type PaidDaysTemplateDTO,
  previewSalaryStructure,
  rupeesToPaise,
  saveSalaryStructure,
} from '../../services/payroll';
import type {
  CalculationBasis,
  CalculationMode,
  ComputedStructure,
  EmployeeStatutory,
  PayHeadDTO,
  PercentageBase,
  SalaryStructureDTO,
  SalaryTemplateDTO,
  StatutoryOverview,
  StructureComponent,
  StructureOverrides,
  StructureResponse,
} from '../../services/payroll';
import { Card } from '../ui';
import { IconClose } from '../icons';
import { paidDaysSummary } from './PaidDaysTemplates';

// —— Grouping, as on Salary Templates ——
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
const ADD_LABEL: Record<Group, string> = {
  earning: 'Add Earning',
  reimbursement: 'Add Reimbursement',
  fbp: 'Add FBP Component',
  benefit: 'Add Benefit',
  deduction: 'Add Deduction',
  onetime: 'Add One Time Earning',
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
/** The one base a fixed earning's percentage may use. */
function fixedBaseOf(ph?: PayHeadDTO): PercentageBase | undefined {
  if (ph?.category !== 'earning') return undefined;
  if (ph.componentType === 'basic') return 'ctc';
  if (ph.componentType === 'hra') return 'basic';
  return undefined;
}

const rupees = (paise: number) => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const dmy = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

function calcSubtitle(c: CalculationBasis, ph: PayHeadDTO | undefined, isBalancing: boolean, phByCode: Map<string, PayHeadDTO>): string {
  if (ph?.category === 'reimbursement' && ph.maxClaimablePaise) return `Max Limit : ₹${rupees(ph.maxClaimablePaise)}  |  Monthly Carry Forward`;
  if (groupOf(ph) === 'fbp' && c.mode === 'flat_per_month') return `Max Limit : ₹${rupees(c.amountPaise ?? 0)}`;
  if (isBalancing) return 'Monthly CTC - Sum of all other components';
  if (c.mode === 'percentage') {
    const baseLbl = c.base === 'ctc' ? 'CTC' : c.base === 'basic' ? 'Basic Amount' : phByCode.get(c.baseComponentCode ?? '')?.name ?? 'component';
    return `(${(c.percent ?? 0).toFixed(2)} % of ${baseLbl})`;
  }
  if (c.mode === 'flat_per_month') return `₹${rupees(c.amountPaise ?? 0)} / month`;
  return 'Fixed amount';
}

/** Monthly / annual for a component, from the preview or its own basis. */
function amountsFor(code: string, c: CalculationBasis, computed: ComputedStructure | null, payHeads: PayHeadDTO[]) {
  const map = new Map<string, { monthly: number; annual: number }>();
  if (computed) {
    for (const e of computed.earnings) map.set(e.code, { monthly: e.monthlyPaise, annual: e.annualPaise });
    for (const d of computed.deductions) map.set(d.code, { monthly: d.monthlyPaise, annual: d.annualPaise });
    for (const x of [...(computed.reimbursements ?? []), ...(computed.benefits ?? [])]) map.set(x.code, { monthly: x.monthlyPaise, annual: x.annualPaise });
  }
  const hit = map.get(code);
  if (hit) return hit;
  if (c.mode === 'flat_per_month') { const m = c.amountPaise ?? 0; return { monthly: m, annual: m * 12 }; }
  if (c.mode === 'percentage') {
    const basicCode = payHeads.find((p) => p.componentType === 'basic')?.code ?? '';
    const base = c.base === 'ctc' ? computed?.monthlyCtcPaise ?? 0 : c.base === 'basic' ? map.get(basicCode)?.monthly ?? 0 : map.get(c.baseComponentCode ?? '')?.monthly ?? 0;
    const m = Math.round((base * (c.percent ?? 0)) / 100);
    return { monthly: m, annual: m * 12 };
  }
  return { monthly: 0, annual: 0 };
}

/** The same resolution the server does, so the page updates before the preview lands. */
function applyOverridesLocal(template: SalaryTemplateDTO | undefined, overrides: StructureOverrides, phByCode: Map<string, PayHeadDTO>): StructureComponent[] {
  if (!template) return [];
  const removed = new Set((overrides.remove ?? []).filter((code) => phByCode.get(code)?.componentType !== 'basic'));
  const edits = overrides.edit ?? {};
  const out: StructureComponent[] = [];
  for (const c of template.components) {
    if (removed.has(c.payHeadCode) || !phByCode.has(c.payHeadCode)) continue;
    const edited = edits[c.payHeadCode];
    out.push(edited ? { payHeadCode: c.payHeadCode, calculation: edited, source: 'edited' } : { ...c, source: 'template' });
  }
  const present = new Set(out.map((c) => c.payHeadCode));
  for (const a of overrides.add ?? []) {
    if (present.has(a.payHeadCode) || !phByCode.has(a.payHeadCode)) continue;
    present.add(a.payHeadCode);
    out.push({ ...a, source: 'added' });
  }
  return out;
}

export function EmployeeSalary({ userId, name }: { userId: string; name: string }) {
  const { flash } = useStore();
  const [data, setData] = useState<StructureResponse | null | undefined>(undefined);
  const [templates, setTemplates] = useState<SalaryTemplateDTO[]>([]);
  const [payHeads, setPayHeads] = useState<PayHeadDTO[]>([]);
  const [statutory, setStatutory] = useState<StatutoryOverview | null>(null);
  const [revising, setRevising] = useState(false);
  const [saving, setSaving] = useState(false);
  const phByCode = useMemo(() => new Map(payHeads.map((p) => [p.code, p])), [payHeads]);

  useEffect(() => {
    let live = true;
    setData(undefined);
    void Promise.all([
      getSalaryStructure(userId).catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }),
      listSalaryTemplates(),
      listPayHeads(),
      getStatutorySettings().catch(() => null),
    ]).then(([d, ts, phs, st]) => {
      if (!live) return;
      setData(d);
      setTemplates(ts);
      setPayHeads(phs);
      setStatutory(st);
    }).catch((e) => { if (live) { setData(null); flash(e instanceof ApiError ? e.message : 'Could not load salary'); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const patch = async (input: Parameters<typeof saveSalaryStructure>[1], done: string) => {
    if (saving) return;
    setSaving(true);
    try {
      setData(await saveSalaryStructure(userId, input));
      flash(done);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (data === undefined) return <Card><div style={{ padding: 40, textAlign: 'center', color: '#717171', fontWeight: 600 }}>Loading…</div></Card>;

  if (data === null) {
    return <AssignCard templates={templates} phByCode={phByCode} saving={saving} onSave={(code, ctc, values) => void patch({ salaryTemplateCode: code, annualCtcPaise: ctc, componentValues: values, status: 'active', effectiveFrom: today() }, 'Salary assigned')} />;
  }

  const { structure, computed, components } = data;
  const template = templates.find((t) => t.code === structure.salaryTemplateCode);
  const settings = statutory?.settings;
  const person: EmployeeStatutory = structure.statutory ?? {};
  const pfRestrictedEmployee = settings ? settings.epf.employeeRate === 'restricted' && !(settings.epf.overrideAtEmployee && person.pfActualWage) : true;
  const ceiling = statutory ? rupees(statutory.ceilingPaise) : '25,000.00';
  const monthlyCtc = Math.round(structure.annualCtcPaise / 12);

  const buckets = new Map<Group, StructureComponent[]>();
  for (const c of components) {
    const g = groupOf(phByCode.get(c.payHeadCode));
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(c);
  }
  // Employer statutory shares the org keeps inside CTC show as Benefits.
  const employerRows: { name: string; sub: string; monthly: number }[] = [];
  if (settings?.epf.enabled && settings.epf.includeEmployer && person.epf !== false) {
    employerRows.push({ name: 'EPF - Employer Contribution', sub: `(12.00% of ${settings.epf.employerRate === 'restricted' ? 'Restricted PF Wages' : 'Actual PF Wages'})`, monthly: computed.statutory.epf.employerTotalPaise });
    if (settings.epf.includeEDLI) employerRows.push({ name: 'EDLI - Employer Contribution', sub: '(0.50% of Restricted PF Wages)', monthly: computed.statutory.epf.edliPaise ?? 0 });
    if (settings.epf.includeAdmin) employerRows.push({ name: 'EPF Admin Charges', sub: '(0.50% of PF Wages)', monthly: computed.statutory.epf.adminPaise ?? 0 });
  }
  if (settings?.esi.enabled && settings.esi.includeEmployer && person.esi !== false && computed.statutory.esi.applicable) {
    employerRows.push({ name: 'ESI - Employer Contribution', sub: '(3.25% of Gross)', monthly: computed.statutory.esi.employerPaise });
  }
  const revisions = [...structure.revisions].reverse();
  const lastRevision = revisions[0];

  return (
    <div>
      <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>Salary Details</div>
      <Card style={{ padding: '16px 22px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 44 }}>
          <div><div style={labelSm}>Annual CTC</div><div style={valueLg}>₹{rupees(structure.annualCtcPaise)} <span style={unit}>per year</span></div></div>
          <div><div style={labelSm}>Monthly CTC</div><div style={valueLg}>₹{rupees(monthlyCtc)} <span style={unit}>per month</span></div></div>
          <div><div style={labelSm}>Salary Template</div><div style={{ ...valueLg, fontSize: 15 }}>{structure.templateName ?? template?.name ?? structure.salaryTemplateCode ?? '—'}{Object.keys(structure.overrides.edit ?? {}).length + (structure.overrides.add?.length ?? 0) + (structure.overrides.remove?.length ?? 0) > 0 && <span style={{ ...unit, marginLeft: 6 }}>· with own changes</span>}</div></div>
          <button onClick={() => setRevising(true)} style={{ ...primaryBtn, marginLeft: 'auto' }}>Revise</button>
        </div>
      </Card>

      <PaidDaysCard
        userId={userId}
        code={structure.paidDaysTemplateCode}
        onChanged={(code) => setData((d) => (d ? { ...d, structure: { ...d.structure, paidDaysTemplateCode: code ?? undefined } } : d))}
      />

      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Salary Structure</div>
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 22 }}>
        <table style={table}>
          <thead><tr><th style={th}>Salary Components</th><th style={{ ...th, textAlign: 'right', width: 220 }}>Monthly Amount</th><th style={{ ...th, textAlign: 'right', width: 220 }}>Annual Amount</th></tr></thead>
          <tbody>
            {GROUP_ORDER.filter((g) => buckets.get(g)?.length || (g === 'benefit' && employerRows.length)).map((g) => (
              <GroupRows key={g} label={GROUP_LABEL[g]} cols={3}>
                {(buckets.get(g) ?? []).map((c) => {
                  const ph = phByCode.get(c.payHeadCode);
                  const isBalancing = c.payHeadCode === template?.balancingComponentCode;
                  const amt = amountsFor(c.payHeadCode, c.calculation, computed, payHeads);
                  return (
                    <tr key={c.payHeadCode}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{ph?.name ?? c.payHeadCode}{c.source !== 'template' && <span style={{ ...tag, marginLeft: 8 }}>{c.source === 'added' ? 'Only this person' : 'Edited for this person'}</span>}</div>
                        <div style={sub}>{calcSubtitle(c.calculation, ph, isBalancing, phByCode)}</div>
                      </td>
                      <td style={num}>₹{rupees(amt.monthly)}</td>
                      <td style={num}>₹{rupees(amt.annual)}</td>
                    </tr>
                  );
                })}
                {g === 'benefit' && employerRows.map((r) => (
                  <tr key={r.name}>
                    <td style={td}><div style={{ fontWeight: 600 }}>{r.name}</div><div style={sub}>{r.sub}</div></td>
                    <td style={num}>₹{rupees(r.monthly)}</td>
                    <td style={num}>₹{rupees(r.monthly * 12)}</td>
                  </tr>
                ))}
              </GroupRows>
            ))}
            <tr>
              <td style={{ ...td, fontWeight: 800, fontSize: 16, borderTop: '2px solid #EBEBEB' }}>Cost to Company</td>
              <td style={{ ...num, fontWeight: 800, fontSize: 16, borderTop: '2px solid #EBEBEB' }}>₹{rupees(computed.employerCostMonthlyPaise)}</td>
              <td style={{ ...num, fontWeight: 800, fontSize: 16, borderTop: '2px solid #EBEBEB' }}>₹{rupees(computed.employerCostMonthlyPaise * 12)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Other Deductions</div>
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 22 }}>
        <table style={table}>
          <thead><tr><th style={th}>Deduction Name</th><th style={{ ...th, width: '40%' }}>Calculation Type</th><th style={{ ...th, textAlign: 'right', width: 200 }}>Actions</th></tr></thead>
          <tbody>
            <GroupRows label="Benefits" cols={3}>
              <tr>
                <td style={td}><div style={{ fontWeight: 600 }}>EPF Contribution</div></td>
                <td style={td}><span style={{ color: person.epf === false || settings?.epf.enabled === false ? '#9197A2' : '#222222' }}>{settings?.epf.enabled === false ? 'Off for the company' : person.epf === false ? 'Disabled for this person' : ''}</span></td>
                <td style={{ ...td, textAlign: 'right' }}>{settings?.epf.enabled !== false && <Switch on={person.epf !== false} disabled={saving} onToggle={() => void patch({ statutory: { ...person, epf: person.epf === false } }, person.epf === false ? 'EPF enabled' : 'EPF disabled')} />}</td>
              </tr>
              {settings?.epf.enabled !== false && person.epf !== false && (
                <>
                  <tr>
                    <td style={{ ...td, paddingLeft: 40 }}>Employer's Contribution</td>
                    <td style={td}>{settings?.epf.employerRate === 'actual' ? 'Actual PF Wage' : `Restricted to ₹${ceiling}`}</td>
                    <td style={td} />
                  </tr>
                  <tr>
                    <td style={{ ...td, paddingLeft: 40 }}>Restricted PF wage</td>
                    <td style={td}>
                      ₹{' '}
                      <input
                        key={person.pfRestrictedWagePaise ?? 'ceiling'}
                        type="number"
                        defaultValue={person.pfRestrictedWagePaise ? person.pfRestrictedWagePaise / 100 : ''}
                        placeholder={ceiling.replace(/\.00$/, '')}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          const paise = v ? rupeesToPaise(v) : undefined;
                          if (paise !== person.pfRestrictedWagePaise) void patch({ statutory: { ...person, pfRestrictedWagePaise: paise ?? 0 } }, paise ? 'PF wage set for this person' : 'PF wage back to the ceiling');
                        }}
                        style={{ ...input, width: 150, display: 'inline-block' }}
                      />
                      <span style={{ ...unit, marginLeft: 8 }}>blank = the ₹{ceiling} ceiling</span>
                    </td>
                    <td style={td} />
                  </tr>
                  <tr>
                    <td style={{ ...td, paddingLeft: 40 }}>Employee's Contribution</td>
                    <td style={td}>{pfRestrictedEmployee ? `Restricted to ₹${person.pfRestrictedWagePaise ? rupees(person.pfRestrictedWagePaise) : ceiling}` : 'Actual PF Wage'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {settings?.epf.overrideAtEmployee && (
                        <button disabled={saving} onClick={() => void patch({ statutory: { ...person, pfActualWage: !person.pfActualWage } }, 'PF wage basis changed')} style={linkBtn}>
                          {person.pfActualWage ? 'Restrict to ceiling' : 'Contribute on actual wage'}
                        </button>
                      )}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td style={td}><div style={{ fontWeight: 600 }}>ESI Contribution</div></td>
                <td style={td}>{settings?.esi.enabled === false ? 'Off for the company' : person.esi === false ? 'Disabled for this person' : computed.statutory.esi.applicable ? '0.75% of gross (gross is ₹21,000 or less)' : 'Not applicable: gross is above ₹21,000'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{settings?.esi.enabled !== false && <Switch on={person.esi !== false} disabled={saving} onToggle={() => void patch({ statutory: { ...person, esi: person.esi === false } }, person.esi === false ? 'ESI enabled' : 'ESI disabled')} />}</td>
              </tr>
              <tr>
                <td style={td}><div style={{ fontWeight: 600 }}>Labour Welfare Fund</div></td>
                <td style={td}>{person.lwf === false ? 'Disabled for this person' : computed.statutory.lwf.applicable ? `₹${rupees(computed.statutory.lwf.employeePaise)} this month` : 'Not applicable in the work state this month'}</td>
                <td style={{ ...td, textAlign: 'right' }}><Switch on={person.lwf !== false} disabled={saving} onToggle={() => void patch({ statutory: { ...person, lwf: person.lwf === false } }, person.lwf === false ? 'LWF enabled' : 'LWF disabled')} /></td>
              </tr>
              {settings?.bonus.enabled && (
                <tr>
                  <td style={td}><div style={{ fontWeight: 600 }}>Statutory Bonus</div></td>
                  <td style={td}>
                    Employment category:{' '}
                    <input defaultValue={structure.bonusCategory ?? ''} placeholder="e.g. Skilled" onBlur={(e) => { if (e.target.value.trim() !== (structure.bonusCategory ?? '')) void patch({ bonusCategory: e.target.value.trim() }, 'Bonus category saved'); }} style={{ ...input, width: 180, display: 'inline-block' }} />
                  </td>
                  <td style={td} />
                </tr>
              )}
            </GroupRows>
          </tbody>
        </table>
      </Card>

      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Salary Revision History</div>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table style={table}>
          <thead><tr><th style={th}>Previous CTC</th><th style={th}>Revised CTC</th><th style={th}>Effective From</th></tr></thead>
          <tbody>
            {revisions.length === 0 && <tr><td colSpan={3} style={{ ...td, color: '#9197A2' }}>No revisions yet.</td></tr>}
            {revisions.map((r, i) => {
              const change = r.previousCtcPaise > 0 ? ((r.annualCtcPaise - r.previousCtcPaise) / r.previousCtcPaise) * 100 : null;
              return (
                <tr key={i}>
                  <td style={td}>{r.previousCtcPaise > 0 ? `₹${rupees(r.previousCtcPaise)}` : '-'}</td>
                  <td style={td}>₹{rupees(r.annualCtcPaise)}{change !== null && <span style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 700, color: change >= 0 ? '#4F7A52' : '#C4382E' }}>{Math.abs(change).toFixed(2)}% {change >= 0 ? '▲' : '▼'}</span>}</td>
                  <td style={td}>{dmy(r.effectiveFrom)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {revising && (
        <SalaryRevision
          userId={userId}
          name={name}
          structure={structure}
          lastRevision={lastRevision?.effectiveFrom}
          templates={templates}
          payHeads={payHeads}
          phByCode={phByCode}
          settings={statutory?.settings ?? null}
          onClose={() => setRevising(false)}
          onSaved={(d) => { setData(d); setRevising(false); flash('Salary revised'); }}
        />
      )}
    </div>
  );
}

// ——————————————————————————————— PAID DAYS ———————————————————————————————
/** The Paid Days Template this person is on (the company's Default unless given another), and a way to change it. */
function PaidDaysCard({ userId, code, onChanged }: { userId: string; code?: string; onChanged: (code: string | null) => void }) {
  const { flash } = useStore();
  const [templates, setTemplates] = useState<PaidDaysTemplateDTO[] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    void listPaidDaysTemplates().then((ts) => { if (live) setTemplates(ts); }).catch(() => { if (live) setTemplates([]); });
    return () => { live = false; };
  }, []);
  const def = templates?.find((t) => t.isDefault);
  const current = templates?.find((t) => t.code === code) ?? def;
  const change = async (next: string) => {
    setSaving(true);
    try {
      const picked = templates?.find((t) => t.code === next);
      const r = await assignPaidDaysTemplate(userId, picked?.isDefault ? null : next);
      onChanged(r.paidDaysTemplateCode);
      flash(`Paid days: ${picked?.name ?? next}. Applies from the next payroll run.`);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not change paid days');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card style={{ padding: '14px 22px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={labelSm}>Paid Days Template</div>
          <div style={{ fontSize: 14, color: '#484848', marginTop: 4 }}>{templates === null ? 'Loading…' : current ? paidDaysSummary(current) : 'Attendance calendar'}</div>
        </div>
        <select
          value={current?.code ?? ''}
          disabled={saving || !templates?.length}
          onChange={(e) => void change(e.target.value)}
          style={{ ...input, width: 260, display: 'inline-block' }}
        >
          {(templates ?? []).map((t) => <option key={t.code} value={t.code}>{t.name}{t.isDefault && t.name !== 'Default' ? ' (Default)' : ''}</option>)}
        </select>
      </div>
    </Card>
  );
}

// ——————————————————————————————— ASSIGN (no salary yet) ———————————————————————————————
/** Components whose monthly amount is set for each person ("Set per employee"); the balancing one and one-time items are not. */
function perPersonCodes(components: { payHeadCode: string; calculation: CalculationBasis }[], balancing: string | undefined, phByCode: Map<string, PayHeadDTO>): string[] {
  return components
    .filter((c) => c.calculation.mode === 'flat_amount' && c.payHeadCode !== balancing)
    .filter((c) => phByCode.get(c.payHeadCode)?.recurrence !== 'one_time')
    .map((c) => c.payHeadCode);
}
function cleanValues(values: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, v] of Object.entries(values)) if (v !== '' && Number(v) >= 0) out[code] = rupeesToPaise(v);
  return out;
}

function AssignCard({ templates, phByCode, saving, onSave }: { templates: SalaryTemplateDTO[]; phByCode: Map<string, PayHeadDTO>; saving: boolean; onSave: (code: string, ctcPaise: number, values: Record<string, number>) => void }) {
  const [code, setCode] = useState('');
  const [ctc, setCtc] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const tpl = templates.find((t) => t.code === code);
  const perPerson = tpl ? perPersonCodes(tpl.components, tpl.balancingComponentCode, phByCode) : [];
  return (
    <Card style={{ padding: '22px 24px' }}>
      <div style={{ fontSize: 17, fontWeight: 800 }}>No salary yet</div>
      <div style={{ fontSize: 14, color: '#717171', marginTop: 4, marginBottom: 16 }}>Pick a salary template and the annual CTC. You can change any component for this person after that.</div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><div style={fieldLabel}>Salary Template</div>
          <select value={code} onChange={(e) => setCode(e.target.value)} style={{ ...input, width: 280 }}>
            <option value="">Select</option>
            {templates.filter((t) => t.active).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
        </div>
        <div><div style={fieldLabel}>Annual CTC</div><CtcInput value={ctc} onChange={setCtc} /></div>
        <button disabled={saving || !code || !(Number(ctc) > 0)} onClick={() => onSave(code, rupeesToPaise(ctc), cleanValues(values))} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      {perPerson.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={fieldLabel}>Amounts set for this person (per month)</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {perPerson.map((c) => {
              const ph = phByCode.get(c);
              return (
                <label key={c} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
                  <span>{ph?.name ?? c}</span>
                  <span style={pairBox}>
                    <span style={{ ...pairSuffix, borderLeft: 'none', borderRight: '1px solid #D9DCE1' }}>₹</span>
                    <input type="number" min={0} value={values[c] ?? ''} placeholder={ph?.category === 'reimbursement' && ph.maxClaimablePaise ? String(ph.maxClaimablePaise / 100) : '0'} onChange={(e) => setValues({ ...values, [c]: e.target.value })} style={pairInput} />
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{ fontSize: 12.5, color: '#9197A2', marginTop: 6 }}>Blank: ₹0 (a reimbursement uses its monthly limit). One-time items such as a bonus are entered on each payroll run.</div>
        </div>
      )}
    </Card>
  );
}

// ——————————————————————————————— SALARY REVISION (standalone page) ———————————————————————————————
type RevisionForm = {
  templateCode: string;
  mode: 'percent' | 'amount';
  percent: string;
  ctcRupees: string;
  effectiveFrom: string;
  overrides: StructureOverrides;
  /** Per-person monthly amounts ("Set per employee" components), in rupees as typed. */
  values: Record<string, string>;
};

function SalaryRevision({ userId, name, structure, lastRevision, templates, payHeads, phByCode, settings, onClose, onSaved }: {
  userId: string;
  name: string;
  structure: SalaryStructureDTO;
  lastRevision?: string;
  templates: SalaryTemplateDTO[];
  payHeads: PayHeadDTO[];
  phByCode: Map<string, PayHeadDTO>;
  settings: StatutoryOverview['settings'] | null;
  onClose: () => void;
  onSaved: (d: StructureResponse) => void;
}) {
  const { flash } = useStore();
  const [form, setForm] = useState<RevisionForm>({
    templateCode: structure.salaryTemplateCode ?? '',
    mode: 'amount',
    percent: '',
    ctcRupees: String(structure.annualCtcPaise / 100),
    effectiveFrom: today(),
    overrides: structure.overrides ?? {},
    values: Object.fromEntries(Object.entries(structure.componentValues ?? {}).map(([k, v]) => [k, String(v / 100)])),
  });
  const [computed, setComputed] = useState<ComputedStructure | null>(null);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const template = templates.find((t) => t.code === form.templateCode);
  const revisedPaise = form.mode === 'percent'
    ? Math.round(structure.annualCtcPaise * (1 + (Number(form.percent) || 0) / 100))
    : rupeesToPaise(form.ctcRupees || '0');
  const rows = applyOverridesLocal(template, form.overrides, phByCode);
  const previewInput = { salaryTemplateCode: form.templateCode, annualCtcPaise: revisedPaise, overrides: form.overrides, componentValues: cleanValues(form.values) };

  useEffect(() => {
    if (!form.templateCode) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try { setComputed((await previewSalaryStructure(userId, previewInput)).computed); } catch { /* keep the last good preview */ }
    }, 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(previewInput)]);

  const set = <K extends keyof RevisionForm>(k: K, v: RevisionForm[K]) => setForm({ ...form, [k]: v });
  const setOverrides = (o: StructureOverrides) => set('overrides', o);
  const editCalc = (c: StructureComponent, calculation: CalculationBasis) => {
    const o = form.overrides;
    if (c.source === 'added') setOverrides({ ...o, add: (o.add ?? []).map((a) => (a.payHeadCode === c.payHeadCode ? { ...a, calculation } : a)) });
    else setOverrides({ ...o, edit: { ...(o.edit ?? {}), [c.payHeadCode]: calculation } });
  };
  const removeRow = (c: StructureComponent) => {
    const o = form.overrides;
    if (c.source === 'added') setOverrides({ ...o, add: (o.add ?? []).filter((a) => a.payHeadCode !== c.payHeadCode) });
    else {
      const edit = { ...(o.edit ?? {}) };
      delete edit[c.payHeadCode];
      setOverrides({ ...o, edit, remove: [...new Set([...(o.remove ?? []), c.payHeadCode])] });
    }
  };
  const addRow = (code: string) => {
    const ph = phByCode.get(code);
    if (!ph) return;
    const o = form.overrides;
    // A template component taken away earlier comes back; anything else is this person's own.
    if ((o.remove ?? []).includes(code)) { setOverrides({ ...o, remove: (o.remove ?? []).filter((r) => r !== code) }); return; }
    let calculation = ph.calculation;
    const base = fixedBaseOf(ph);
    if (base && !(calculation.mode === 'flat_per_month' || (calculation.mode === 'percentage' && calculation.base === base))) {
      calculation = { mode: 'percentage', percent: base === 'ctc' ? 50 : 40, base };
    }
    setOverrides({ ...o, add: [...(o.add ?? []), { payHeadCode: code, calculation }] });
  };
  const changeTemplate = (code: string) => setForm({ ...form, templateCode: code, overrides: {} });

  const save = async () => {
    if (!form.templateCode) return flash('Pick a salary template');
    if (!(revisedPaise > 0)) return flash('Enter the revised CTC');
    setSaving(true);
    try {
      onSaved(await saveSalaryStructure(userId, { ...previewInput, effectiveFrom: form.effectiveFrom, status: 'active' }));
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the revision');
    } finally {
      setSaving(false);
    }
  };

  const present = new Set(rows.map((r) => r.payHeadCode));
  const unused = payHeads.filter((p) => p.active && !present.has(p.code));
  const buckets = new Map<Group, StructureComponent[]>();
  for (const r of rows) {
    const g = groupOf(phByCode.get(r.payHeadCode));
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(r);
  }
  const employerPf = settings?.epf.enabled && settings.epf.includeEmployer;

  return (
    <div style={page}>
      <div style={{ overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px 0' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Salary Revision for {name}</div>
          <button onClick={onClose} title="Close" style={closeCircle}><IconClose size={16} /></button>
        </div>
        <div style={{ display: 'flex', gap: 60, padding: '14px 32px 18px', borderBottom: '1px solid #EBEBEB' }}>
          <div><div style={labelSm}>Previous CTC</div><div style={{ fontWeight: 600 }}>₹{rupees(structure.annualCtcPaise)}</div></div>
          <div><div style={labelSm}>Previous Monthly Salary</div><div style={{ fontWeight: 600 }}>₹{rupees(Math.round(structure.annualCtcPaise / 12))}</div></div>
          <div><div style={labelSm}>Last Revision</div><div style={{ fontWeight: 600 }}>{lastRevision ? new Date(lastRevision).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) : '—'}</div></div>
        </div>

        <div style={{ padding: '22px 32px 40px', maxWidth: 1240 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '260px 300px', alignItems: 'center', gap: 12, marginBottom: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Salary Templates</div>
            <select value={form.templateCode} onChange={(e) => changeTemplate(e.target.value)} style={input}>
              <option value="">Select</option>
              {templates.filter((t) => t.active || t.code === form.templateCode).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </select>
          </div>

          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Select the Salary Revision type <span style={{ color: '#C4382E' }}>*</span></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
            <input type="radio" checked={form.mode === 'percent'} onChange={() => set('mode', 'percent')} /> Revise CTC by percentage
            <span style={pairBox}><input type="number" step="0.01" value={form.percent} onChange={(e) => setForm({ ...form, mode: 'percent', percent: e.target.value })} style={{ ...pairInput, width: 80 }} /><span style={pairSuffix}>%</span></span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
            <input type="radio" checked={form.mode === 'amount'} onChange={() => set('mode', 'amount')} /> Enter the new CTC amount below
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '260px auto', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Revised Annual CTC <span style={{ color: '#C4382E' }}>*</span></div>
            {form.mode === 'amount'
              ? <CtcInput value={form.ctcRupees} onChange={(v) => set('ctcRupees', v)} />
              : <div style={{ fontWeight: 600 }}>₹{rupees(revisedPaise)} <span style={unit}>per year</span></div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '260px auto', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Effective From</div>
            <input type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} style={{ ...input, width: 200 }} />
          </div>

          <div style={{ border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
            <table style={table}>
              <thead><tr><th style={{ ...th, width: '30%' }}>Salary Components</th><th style={{ ...th, width: '36%' }}>Calculation Type</th><th style={{ ...th, textAlign: 'right' }}>Monthly Amount</th><th style={{ ...th, textAlign: 'right' }}>Annual Amount</th></tr></thead>
              <tbody>
                {!template && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#9197A2', padding: 28 }}>Pick a salary template to start from.</td></tr>}
                {GROUP_ORDER.filter((g) => buckets.get(g)?.length || unused.some((p) => groupOf(p) === g)).map((g) => (
                  <GroupRows key={g} label={GROUP_LABEL[g]} cols={4} big>
                    {(buckets.get(g) ?? []).map((c) => {
                      const ph = phByCode.get(c.payHeadCode);
                      const isBalancing = c.payHeadCode === template?.balancingComponentCode;
                      const amt = amountsFor(c.payHeadCode, c.calculation, computed, payHeads);
                      const isBasic = ph?.componentType === 'basic';
                      return (
                        <tr key={c.payHeadCode}>
                          <td style={td}>
                            <div style={{ fontWeight: 600 }}>{ph?.name ?? c.payHeadCode}{c.source !== 'template' && <span style={{ ...tag, marginLeft: 8 }}>{c.source === 'added' ? 'Only this person' : 'Edited'}</span>}</div>
                            {isBalancing && <div style={sub}>Monthly CTC - Sum of all other components</div>}
                          </td>
                          <td style={td}>{isBalancing ? <span style={{ color: '#484848' }}>Fixed amount</span> : (
                            <CalcEditor
                              calc={c.calculation} ph={ph} others={rows.filter((r) => r.payHeadCode !== c.payHeadCode)} phByCode={phByCode} onChange={(calc) => editCalc(c, calc)}
                              amount={ph?.recurrence === 'one_time' ? undefined : form.values[c.payHeadCode] ?? ''}
                              onAmount={(v) => setForm({ ...form, values: { ...form.values, [c.payHeadCode]: v } })}
                            />
                          )}</td>
                          <td style={num}>{g === 'onetime' ? '—' : rupees(amt.monthly)}</td>
                          <td style={num}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                              <span>{rupees(amt.annual)}</span>
                              {!isBasic && !isBalancing && <button onClick={() => removeRow(c)} title="Remove for this person" style={iconBtn}><IconClose size={14} /></button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {template && unused.some((p) => groupOf(p) === g) && (
                      <tr>
                        <td colSpan={4} style={{ padding: '8px 20px 14px' }}>
                          <select value="" onChange={(e) => { if (e.target.value) addRow(e.target.value); }} style={{ ...linkBtn, border: 'none', background: 'none', fontSize: 14 }}>
                            <option value="">+ {ADD_LABEL[g]}</option>
                            {unused.filter((p) => groupOf(p) === g).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    )}
                  </GroupRows>
                ))}
                {employerPf && computed && (
                  <GroupRows label="Benefits (employer share inside CTC)" cols={4} big>
                    <tr>
                      <td style={td}><div style={{ fontWeight: 600 }}>EPF - Employer Contribution</div><div style={sub}>{settings?.epf.employerRate === 'restricted' ? `Restricted to ₹${settings ? rupees(25_000_00) : ''}` : 'Actual PF Wage'}</div></td>
                      <td style={td}><span style={{ color: '#484848' }}>12% of PF Wage</span></td>
                      <td style={num}>{rupees(computed.statutory.epf.employerTotalPaise)}</td>
                      <td style={num}>{rupees(computed.statutory.epf.employerTotalPaise * 12)}</td>
                    </tr>
                  </GroupRows>
                )}
                <tr>
                  <td colSpan={4} style={{ padding: '16px 20px 20px' }}>
                    <div style={ctcBand}>
                      <span>Cost to Company</span>
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 120 }}>
                        <span>₹{rupees(computed?.employerCostMonthlyPaise ?? 0)}</span>
                        <span>₹{rupees((computed?.employerCostMonthlyPaise ?? 0) * 12)}</span>
                      </span>
                    </div>
                    {computed?.overBudget && <div style={{ color: '#C4382E', fontSize: 13.5, marginTop: 8 }}>The other components already exceed the CTC; the balancing component is at zero.</div>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
            <button onClick={() => void save()} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={onClose} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// —— Inline calculation editor for one row ——
function CalcEditor({ calc, ph, others, phByCode, onChange, amount, onAmount }: {
  calc: CalculationBasis;
  ph?: PayHeadDTO;
  others: StructureComponent[];
  phByCode: Map<string, PayHeadDTO>;
  onChange: (c: CalculationBasis) => void;
  /** This person's monthly amount for a "Fixed amount" component, in rupees; undefined: entered on each run. */
  amount?: string;
  onAmount?: (rupees: string) => void;
}) {
  const fixedBase = fixedBaseOf(ph);
  const modeOf = (m: CalculationMode): CalculationBasis =>
    m === 'percentage' ? { mode: 'percentage', percent: calc.percent ?? (fixedBase === 'ctc' ? 50 : 40), base: fixedBase ?? calc.base ?? 'ctc', ...(calc.baseComponentCode ? { baseComponentCode: calc.baseComponentCode } : {}) }
      : m === 'flat_per_month' ? { mode: 'flat_per_month', amountPaise: calc.amountPaise ?? 0 }
        : { mode: 'flat_amount' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {calc.mode === 'percentage' && (
        <span style={pairBox}>
          <input type="number" step="0.01" value={calc.percent ?? 0} onChange={(e) => onChange({ ...calc, percent: Number(e.target.value) || 0 })} style={pairInput} />
          {fixedBase ? (
            <span style={pairSuffix}>% of {fixedBase === 'ctc' ? 'CTC' : 'Basic'}</span>
          ) : (
            <select value={calc.base ?? 'ctc'} onChange={(e) => onChange({ ...calc, base: e.target.value as PercentageBase })} style={{ ...pairSuffix, border: 'none', borderLeft: '1px solid #D9DCE1', cursor: 'pointer', fontFamily: 'inherit' }}>
              <option value="ctc">% of CTC</option>
              <option value="basic">% of Basic</option>
              <option value="component">% of…</option>
            </select>
          )}
        </span>
      )}
      {calc.mode === 'percentage' && calc.base === 'component' && !fixedBase && (
        <select value={calc.baseComponentCode ?? ''} onChange={(e) => onChange({ ...calc, baseComponentCode: e.target.value })} style={miniSelect}>
          <option value="">base…</option>
          {others.map((o) => <option key={o.payHeadCode} value={o.payHeadCode}>{phByCode.get(o.payHeadCode)?.name ?? o.payHeadCode}</option>)}
        </select>
      )}
      {calc.mode === 'flat_per_month' && (
        <span style={pairBox}>
          <span style={{ ...pairSuffix, borderLeft: 'none', borderRight: '1px solid #D9DCE1' }}>₹</span>
          <input type="number" value={(calc.amountPaise ?? 0) / 100} onChange={(e) => onChange({ mode: 'flat_per_month', amountPaise: rupeesToPaise(e.target.value || '0') })} style={pairInput} />
          <span style={pairSuffix}>/ month</span>
        </span>
      )}
      {calc.mode === 'flat_amount' && (amount === undefined || !onAmount ? (
        <span style={{ color: '#717171' }}>{ph?.recurrence === 'one_time' ? 'Entered on each payroll run' : 'Fixed amount'}</span>
      ) : (
        <span style={pairBox} title="This person's monthly amount">
          <span style={{ ...pairSuffix, borderLeft: 'none', borderRight: '1px solid #D9DCE1' }}>₹</span>
          <input type="number" min={0} value={amount} placeholder={ph?.category === 'reimbursement' && ph.maxClaimablePaise ? String(ph.maxClaimablePaise / 100) : '0'} onChange={(e) => onAmount(e.target.value)} style={pairInput} />
          <span style={pairSuffix}>/ month</span>
        </span>
      ))}
      <select value={calc.mode} onChange={(e) => onChange(modeOf(e.target.value as CalculationMode))} style={miniSelect}>
        <option value="percentage">Percentage</option>
        <option value="flat_per_month">Flat / month</option>
        {!fixedBase && <option value="flat_amount">Fixed amount</option>}
      </select>
    </div>
  );
}

function Switch({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <span>
      <span style={{ color: on ? '#4F7A52' : '#C4382E', fontWeight: 700 }}>{on ? '✓ Enabled' : '✕ Disabled'}</span>{' '}
      <button disabled={disabled} onClick={onToggle} style={linkBtn}>({on ? 'Disable' : 'Enable'})</button>
    </span>
  );
}
function CtcInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span style={{ ...pairBox, borderRadius: 9 }}>
      <span style={{ ...pairSuffix, borderLeft: 'none', borderRight: '1px solid #D9DCE1' }}>₹</span>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} style={{ ...pairInput, width: 170, padding: '10px 12px' }} />
      <span style={{ ...pairSuffix, background: 'none', borderLeft: 'none' }}>per year</span>
    </span>
  );
}
function GroupRows({ label, cols, big, children }: { label: string; cols: number; big?: boolean; children: ReactNode }) {
  return (
    <>
      <tr><td colSpan={cols} style={{ padding: big ? '16px 20px 6px' : '14px 22px 4px', fontSize: big ? 17 : 14.5, fontWeight: big ? 600 : 800, color: '#222222' }}>{label}</td></tr>
      {children}
    </>
  );
}

const labelSm: CSSProperties = { fontSize: 12.5, color: '#717171', marginBottom: 3 };
const valueLg: CSSProperties = { fontSize: 18, fontWeight: 700, color: '#222222', fontVariantNumeric: 'tabular-nums' };
const unit: CSSProperties = { fontSize: 13, fontWeight: 500, color: '#717171' };
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 15 };
const th: CSSProperties = { textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 22px', borderBottom: '1px solid #EBEBEB', background: '#FBFBFC' };
const td: CSSProperties = { padding: '12px 22px', borderBottom: '1px solid #F4F4F6', color: '#222222', verticalAlign: 'middle' };
const num: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const sub: CSSProperties = { fontSize: 12.5, color: '#717171', marginTop: 2 };
const tag: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: '#0571A6', background: '#E7F2F7', borderRadius: 6, padding: '2px 7px', verticalAlign: 'middle' };
const fieldLabel: CSSProperties = { fontSize: 14, fontWeight: 700, marginBottom: 6, color: '#484848' };
const input: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #D9DCE1', borderRadius: 8, fontSize: 15, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const miniSelect: CSSProperties = { padding: '6px 8px', border: '1px solid #EBEBEB', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: '#fff', color: '#222222', cursor: 'pointer' };
const pairBox: CSSProperties = { display: 'inline-flex', alignItems: 'stretch', border: '1px solid #D9DCE1', borderRadius: 7, overflow: 'hidden', background: '#fff' };
const pairInput: CSSProperties = { border: 'none', outline: 'none', padding: '8px 10px', fontSize: 15, width: 96, color: '#222222', fontFamily: 'inherit' };
const pairSuffix: CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 14, color: '#484848', background: '#F7F7F9', borderLeft: '1px solid #D9DCE1', whiteSpace: 'nowrap' };
const ctcBand: CSSProperties = { display: 'flex', alignItems: 'center', background: '#EAF2FB', borderRadius: 8, padding: '16px 22px', fontSize: 19, fontWeight: 600, color: '#222222', fontVariantNumeric: 'tabular-nums' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: '#0571A6', fontWeight: 700, fontSize: 14, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };
const iconBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 4, opacity: 0.65 };
const closeCircle: CSSProperties = { width: 36, height: 36, borderRadius: '50%', border: 'none', background: '#F1F2F5', color: '#484848', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
// The revision is its own page over the whole dashboard.
const page: CSSProperties = { position: 'fixed', inset: 0, zIndex: 90, background: '#fff', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', fontFamily: 'inherit' };
