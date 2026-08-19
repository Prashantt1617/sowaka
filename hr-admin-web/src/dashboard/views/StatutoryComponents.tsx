// Payroll › Statutory Components — EPF / ESI / Professional Tax / Labour Welfare
// Fund / Statutory Bonus. Built one component at a time; EPF first.
//
// NOTE: frontend-capture phase — renders from local mock data, no API calls.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { CloseButton } from '../drawers/shell';

type StatTab = 'epf' | 'esi' | 'pt' | 'lwf' | 'bonus';
const TABS: { key: StatTab; label: string }[] = [
  { key: 'epf', label: 'EPF' },
  { key: 'esi', label: 'ESI' },
  { key: 'pt', label: 'Professional Tax' },
  { key: 'lwf', label: 'Labour Welfare Fund' },
  { key: 'bonus', label: 'Statutory Bonus' },
];

export function StatutoryComponents() {
  const [tab, setTab] = useState<StatTab>('epf');
  return (
    <div>
      <div style={tabBar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ ...tabBtn, color: active ? '#0571A6' : '#717171', borderBottomColor: active ? '#0571A6' : 'transparent', fontWeight: active ? 800 : 600 }}>
              {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'epf' ? <EpfTab /> : tab === 'esi' ? <EsiTab /> : tab === 'pt' ? <PtTab /> : tab === 'lwf' ? <LwfTab /> : tab === 'bonus' ? <BonusTab /> : <ComingSoon label={TABS.find((t) => t.key === tab)!.label} />}
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <Card style={{ padding: '40px 22px', textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#484848' }}>{label}</div>
      <div style={{ fontSize: 14, color: '#717171', marginTop: 6 }}>This statutory component is being set up next.</div>
    </Card>
  );
}

// —— EPF ————————————————————————————————————————————————————————————————
const EPF_RATES = ['12% of Actual PF Wage', 'Restrict Contribution to ₹15,000 of PF Wage'];
type EpfConfig = {
  epfNumber: string;
  employeeRate: string;
  employerRate: string;
  includeEmployer: boolean;
  includeEDLI: boolean;
  includeAdmin: boolean;
  overrideAtEmployee: boolean;
  proRateRestricted: boolean;
  considerLOP: boolean;
};
const MOCK_EPF: EpfConfig = {
  epfNumber: 'GN/GGN/3328343/000',
  employeeRate: 'Restrict Contribution to ₹15,000 of PF Wage',
  employerRate: 'Restrict Contribution to ₹15,000 of PF Wage',
  includeEmployer: true,
  includeEDLI: false,
  includeAdmin: false,
  overrideAtEmployee: true,
  proRateRestricted: false,
  considerLOP: true,
};

function EpfTab() {
  const { flash } = useStore();
  const [cfg, setCfg] = useState<EpfConfig>(MOCK_EPF);
  const [draft, setDraft] = useState<EpfConfig>(MOCK_EPF);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);

  const startEdit = () => { setDraft(cfg); setEditing(true); };
  const save = () => { setCfg(draft); setEditing(false); flash('EPF settings saved'); };
  const active = editing ? draft : cfg;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 372px', gap: 24, alignItems: 'start' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>Employees' Provident Fund</div>
          {!editing && <button onClick={startEdit} title="Edit" style={pencilBtn}>✎</button>}
        </div>

        {editing ? (
          <EpfEditForm draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setEditing(false)} />
        ) : (
          <EpfReadView cfg={cfg} onDisable={() => flash('Disable EPF — coming soon')} />
        )}
      </div>

      <EpfSamplePanel cfg={active} onPreview={() => setPreview(true)} />

      {preview && <EpfPreviewModal cfg={active} onClose={() => setPreview(false)} />}
    </div>
  );
}

// —— Professional Tax ——————————————————————————————————————————————————
type PtLocation = { name: string; state: string; applicable: boolean };
const MOCK_PT: PtLocation[] = [
  { name: 'Head Office', state: 'Haryana', applicable: false },
  { name: 'AIHP Skyline', state: 'Haryana', applicable: false },
  { name: 'Majestic Omnia', state: 'Delhi', applicable: false },
];
function PtTab() {
  return (
    <div>
      <SectionHead title="Professional Tax" sub="This tax is levied on an employee’s income by the State Government. Tax slabs differ in each state." />
      <div style={cardGrid}>
        {MOCK_PT.map((l) => (
          <div key={l.name} style={stateCard}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#222222', marginBottom: 16 }}>{l.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, border: '1px solid #F0F0F2', borderRadius: 10, padding: '16px 18px', background: '#FBFBFC' }}>
              <NoEntry />
              <div style={{ fontSize: 14.5, color: '#717171', lineHeight: 1.5 }}>
                Professional Tax is not applicable for your work location in <strong style={{ color: '#484848' }}>{l.state}</strong>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function NoEntry() {
  return (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#B7BCC5" strokeWidth="1.6" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  );
}

// —— Labour Welfare Fund ————————————————————————————————————————————————
type LwfState = { state: string; empContribution: string; empSub?: string; employerContribution: string; cycle: string; enabled: boolean };
const MOCK_LWF: LwfState[] = [
  { state: 'Haryana', empContribution: '0.20% of Gross Pay', empSub: 'Max Limit : ₹ 35.00', employerContribution: "2 * Employees' Contribution", cycle: 'Monthly', enabled: true },
  { state: 'Delhi', empContribution: '₹ 1.00', employerContribution: '₹ 2.00', cycle: 'Half Yearly', enabled: false },
];
function LwfTab() {
  const { flash } = useStore();
  const [states, setStates] = useState<LwfState[]>(MOCK_LWF);
  const toggle = (name: string) => setStates((ss) => ss.map((s) => (s.state === name ? { ...s, enabled: !s.enabled } : s)));

  return (
    <div>
      <SectionHead title="Labour Welfare Fund" sub="Labour Welfare Fund act ensures social security and improves working conditions for employees." />
      <div style={cardGrid}>
        {states.map((s) => (
          <div key={s.state} style={stateCard}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#222222', marginBottom: 16 }}>{s.state}</div>
            <LwfRow label="Employees' Contribution" value={<span>{s.empContribution}{s.empSub && <><br /><span style={{ fontSize: 13, color: '#9197A2' }}>({s.empSub})</span></>}</span>} />
            <LwfRow label="Employer's Contribution" value={s.employerContribution} />
            <LwfRow label="Deduction Cycle" value={s.cycle} />
            <LwfRow label="Status" value={
              <span>
                <span style={{ color: s.enabled ? '#4F7A52' : '#C4382E', fontWeight: 700 }}>{s.enabled ? 'Enabled' : 'Disabled'}</span>{' '}
                <button onClick={() => { toggle(s.state); flash(`LWF ${s.enabled ? 'disabled' : 'enabled'} for ${s.state}`); }}
                  style={{ background: 'none', border: 'none', color: '#0571A6', fontWeight: 700, fontSize: 15, cursor: 'pointer', padding: 0 }}>
                  ({s.enabled ? 'Disable' : 'Enable'})
                </button>
              </span>
            } last />
          </div>
        ))}
      </div>
    </div>
  );
}
function LwfRow({ label, value, last }: { label: string; value: ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 14, padding: '10px 0', borderBottom: last ? 'none' : '1px solid #F4F1EC', alignItems: 'start' }}>
      <div style={{ fontSize: 14.5, color: '#717171' }}>{label}</div>
      <div style={{ fontSize: 14.5, color: '#222222', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

// —— Statutory Bonus ————————————————————————————————————————————————————
type WageRow = { id: string; category: string; minWage: string; effectiveFrom: string };
type BonusState = { state: string; wages: WageRow[] };
type BonusConfig = { frequency: 'monthly' | 'yearly'; percent: string; states: BonusState[] };
const MOCK_BONUS: BonusConfig = {
  frequency: 'monthly',
  percent: '8.33',
  states: [
    { state: 'Haryana', wages: [
      { id: 'h1', category: 'Skilled', minWage: '13372.67', effectiveFrom: '2024-10' },
      { id: 'h2', category: 'Highly Skilled', minWage: '14041.3', effectiveFrom: '2024-10' },
    ] },
    { state: 'Delhi', wages: [] },
  ],
};
function BonusTab() {
  const { flash } = useStore();
  const [cfg, setCfg] = useState<BonusConfig>(MOCK_BONUS);
  const [draft, setDraft] = useState<BonusConfig>(MOCK_BONUS);
  const [editing, setEditing] = useState(false);
  const [seq, setSeq] = useState(100);
  const active = editing ? draft : cfg;
  const freqLabel = active.frequency === 'monthly' ? 'Monthly' : 'Yearly';

  const setWages = (state: string, wages: WageRow[]) => setDraft({ ...draft, states: draft.states.map((s) => (s.state === state ? { ...s, wages } : s)) });
  const addWage = (state: string) => { setWages(state, [...(draft.states.find((s) => s.state === state)?.wages ?? []), { id: `w${seq}`, category: '', minWage: '', effectiveFrom: '2024-10' }]); setSeq(seq + 1); };

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>Statutory Bonus</div>
        {!editing && <button onClick={() => { setDraft(cfg); setEditing(true); }} title="Edit" style={pencilBtn}>✎</button>}
      </div>

      {editing ? (
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#484848', marginBottom: 8 }}>Payment Frequency</div>
          <div style={{ display: 'flex', gap: 26, marginBottom: 18 }}>
            <RadioInline checked={draft.frequency === 'monthly'} onChange={() => setDraft({ ...draft, frequency: 'monthly' })} label="Monthly" />
            <RadioInline checked={draft.frequency === 'yearly'} onChange={() => setDraft({ ...draft, frequency: 'yearly' })} label="Yearly" />
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#484848', marginBottom: 8 }}>{freqLabel} Percentage of Bonus <span style={{ color: '#C4382E' }}>*</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'stretch', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden', maxWidth: 240 }}>
              <input value={draft.percent} onChange={(e) => setDraft({ ...draft, percent: e.target.value })} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, fontFamily: 'inherit', width: 150 }} />
              <span style={{ padding: '9px 14px', background: '#F7F7F9', color: '#717171', fontWeight: 700, borderLeft: '1px solid #EBEBEB' }}>%</span>
            </div>
            <span style={{ fontSize: 15, color: '#717171' }}>of salary or minimum wage earned this year</span>
          </div>
          <div style={{ fontSize: 13.5, color: '#717171', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
            <span style={{ color: '#9197A2' }}>ⓘ</span> Statutory Bonus rate should be in-between <strong>8.33%</strong> and <strong>20%</strong>, based on the Statutory Bonus Act.
          </div>

          <div style={{ background: '#FBF7EF', border: '1px solid #EDE0C7', borderRadius: 10, padding: '13px 16px', margin: '0 0 24px', maxWidth: 780 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#A34B00', letterSpacing: '.03em', marginBottom: 6 }}>NOTE:</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: '#6E6457', lineHeight: 1.6 }}>
              <li>The payment frequency of this statutory bonus is <strong>monthly and taxable</strong>.</li>
              <li>Once you've associated the statutory bonus with an employee, you can change the bonus percentage only at the beginning of the next fiscal year.</li>
            </ul>
          </div>

          <SectionHead title="Minimum Wage in Each State" sub="Statutory Bonus is a percentage of either the minimum wage or Basic + DA (whichever is higher)." />
          {draft.states.map((st) => (
            <div key={st.state} style={{ ...stateCard, marginBottom: 18 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#222222', marginBottom: 14 }}>{st.state}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 40px', gap: 12, fontSize: 12.5, fontWeight: 800, color: '#717171', paddingBottom: 10, borderBottom: '1px solid #F0F0F2' }}>
                <div>EMPLOYMENT CATEGORY</div><div>MIN WAGE <span style={{ fontWeight: 500 }}>(per month)</span></div><div>EFFECTIVE FROM</div><div />
              </div>
              {st.wages.map((w) => (
                <div key={w.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 40px', gap: 12, alignItems: 'center', padding: '10px 0' }}>
                  <input value={w.category} placeholder="e.g. Skilled" onChange={(e) => setWages(st.state, st.wages.map((x) => x.id === w.id ? { ...x, category: e.target.value } : x))} style={miniInput} />
                  <input value={w.minWage} onChange={(e) => setWages(st.state, st.wages.map((x) => x.id === w.id ? { ...x, minWage: e.target.value } : x))} style={miniInput} />
                  <input type="month" value={w.effectiveFrom} onChange={(e) => setWages(st.state, st.wages.map((x) => x.id === w.id ? { ...x, effectiveFrom: e.target.value } : x))} style={miniInput} />
                  <button onClick={() => setWages(st.state, st.wages.filter((x) => x.id !== w.id))} title="Remove" style={{ background: 'none', border: 'none', color: '#C4382E', cursor: 'pointer', fontSize: 18 }}>⊖</button>
                </div>
              ))}
              <button onClick={() => addWage(st.state)} style={{ background: 'none', border: 'none', color: '#0571A6', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', padding: '10px 0 0' }}>+ Add Minimum Wage</button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button onClick={() => { setCfg(draft); setEditing(false); flash('Statutory Bonus saved'); }} style={primaryBtn}>Save</button>
            <button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 60, marginBottom: 30 }}>
            <StatTile icon="📅" bg="#E4EDE0" label="Bonus Payment Cycle" value={freqLabel} />
            <StatTile icon="％" bg="#F7E7CE" label="Percentage of Bonus" value={`${cfg.percent}%`} />
          </div>
          <SectionHead title="Minimum Wage in Each State" sub="Statutory Bonus is a percentage of either the minimum wage or Basic + DA (whichever is higher)." />
          {cfg.states.map((st) => (
            <div key={st.state} style={{ ...stateCard, marginBottom: 18 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#222222', marginBottom: 14 }}>{st.state}</div>
              {st.wages.length > 0 ? (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 12, fontSize: 12.5, fontWeight: 800, color: '#717171', paddingBottom: 12, borderBottom: '1px solid #F0F0F2' }}>
                    <div>EMPLOYMENT CATEGORY</div><div>MIN WAGE <span style={{ fontWeight: 500 }}>(per month)</span></div><div>EFFECTIVE FROM</div>
                  </div>
                  {st.wages.map((w) => (
                    <div key={w.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 12, padding: '14px 0', borderBottom: '1px solid #F4F1EC', fontSize: 15, color: '#222222' }}>
                      <div>{w.category}</div><div>{w.minWage}</div><div>{w.effectiveFrom}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, border: '1px solid #F0F0F2', borderRadius: 10, padding: '26px 18px', background: '#FBFBFC', fontSize: 15, color: '#717171', textAlign: 'center' }}>
                  <span style={{ color: '#E0A64B', fontSize: 18 }}>⚠</span> Minimum wage details are not added for {st.state}
                </div>
              )}
            </div>
          ))}
          <button onClick={() => flash('Disable Statutory Bonus — coming soon')} style={disableBtn}>🗑 Disable Statutory Bonus</button>
        </div>
      )}
    </div>
  );
}
function StatTile({ icon, bg, label, value }: { icon: string; bg: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ width: 46, height: 46, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 14, color: '#717171' }}>{label}</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#222222', marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}
function RadioInline({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 15, color: '#222222' }} onClick={onChange}>
      <span style={{ width: 17, height: 17, borderRadius: '50%', border: `1.5px solid ${checked ? '#0571A6' : '#C7CBD2'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {checked && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#0571A6' }} />}
      </span>{label}
    </span>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>{title}</div>
      <div style={{ fontSize: 14.5, color: '#717171', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

// —— ESI ————————————————————————————————————————————————————————————————
const ESI_CYCLE_INFO = 'Employee State Insurance (ESI) contribution for each month should be deposited to the Employee State Insurance Corporation (ESIC) within the 21st of the following month.';
type EsiConfig = { esiNumber: string; includeEmployer: boolean };
const MOCK_ESI: EsiConfig = { esiNumber: '13-00-125680-000-0911', includeEmployer: true };

function EsiTab() {
  const { flash } = useStore();
  const [cfg, setCfg] = useState<EsiConfig>(MOCK_ESI);
  const [draft, setDraft] = useState<EsiConfig>(MOCK_ESI);
  const [editing, setEditing] = useState(false);
  const set = <K extends keyof EsiConfig>(k: K, v: EsiConfig[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>Employees' State Insurance</div>
        {!editing && <button onClick={() => { setDraft(cfg); setEditing(true); }} title="Edit" style={pencilBtn}>✎</button>}
      </div>

      {editing ? (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 4, maxWidth: 640 }}>
            <Field label="ESI Number" hint="Format: 00-00-000000-000-0000">
              <input value={draft.esiNumber} onChange={(e) => set('esiNumber', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Deduction Cycle" info={ESI_CYCLE_INFO}>
              <input value="Monthly" disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} />
            </Field>
          </div>
          <Field label="Employees' Contribution">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input value="0.75%" disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171', maxWidth: 200 }} />
              <span style={{ fontSize: 15, color: '#717171' }}>of Gross Pay</span>
            </div>
          </Field>
          <Field label="Employer's Contribution">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input value="3.25%" disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171', maxWidth: 200 }} />
              <span style={{ fontSize: 15, color: '#717171' }}>of Gross Pay</span>
            </div>
          </Field>
          <Check checked={draft.includeEmployer} onChange={(v) => set('includeEmployer', v)} label="Include employer's contribution in employee’s salary structure." />

          <div style={{ background: '#FBF7EF', border: '1px solid #EDE0C7', borderRadius: 10, padding: '13px 15px', fontSize: 14, color: '#6E6457', lineHeight: 1.55, margin: '16px 0', maxWidth: 780 }}>
            <strong>Note:</strong> ESI deductions will be made only if the employee’s monthly salary is less than or equal to ₹21,000. If the employee gets a salary revision which increases their monthly salary above ₹21,000, they would have to continue making ESI contributions till the end of the contribution period in which the salary was revised (April–September or October–March).
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button onClick={() => { setCfg(draft); setEditing(false); flash('ESI settings saved'); }} style={primaryBtn}>Save</button>
            <button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <Row label="ESI Number" value={cfg.esiNumber} />
          <Row label="Deduction Cycle" value="Monthly" />
          <Row label="Employees' Contribution" value="0.75% of Gross Pay" />
          <Row label="Employer's Contribution" value="3.25% of Gross Pay" />
          <Row label="Other Details" value={cfg.includeEmployer ? "Employer's contribution is included in employee’s salary structure." : "Employer's contribution is not included in employee’s salary structure."} last />
          <button onClick={() => flash('Disable ESI — coming soon')} style={disableBtn}>🗑 Disable ESI</button>
        </div>
      )}
    </div>
  );
}

// —— EPF read view ——————————————————————————————————————————————————————
function EpfReadView({ cfg, onDisable }: { cfg: EpfConfig; onDisable: () => void }) {
  return (
    <div>
      <Row label="EPF Number" value={cfg.epfNumber} />
      <Row label="Deduction Cycle" value="Monthly" />
      <Row label="Employee Contribution Rate" value={cfg.employeeRate} />
      <Row label="Employer Contribution Rate" value={<span>{cfg.employerRate} <Splitup /></span>} />
      <Row label={<span>Contribution Preferences<br /><span style={{ fontSize: 13, color: '#9197A2' }}>(Included in Salary Structure)</span></span>}
        value={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Pref on={cfg.includeEmployer} text="Employer's PF contribution" />
            <Pref on={cfg.includeEDLI} text="EDLI contribution" />
            <Pref on={cfg.includeAdmin} text="Admin charges" />
          </div>
        } />
      <Row label="Allow Employee level Override" value={cfg.overrideAtEmployee ? 'Yes' : 'No'} />
      <Row label="Pro-rate Restricted PF Wage" value={cfg.proRateRestricted ? 'Yes' : 'No'} />
      <Row label="Consider applicable salary components based on LOP" value={cfg.considerLOP ? 'Yes (when PF wage is less than ₹15,000)' : 'No'} />
      <Row label="Eligible for ABRY Scheme" value="No" last />
      <button onClick={onDisable} style={disableBtn}>🗑 Disable EPF</button>
    </div>
  );
}

function Row({ label, value, last }: { label: ReactNode; value: ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, padding: '14px 0', borderBottom: last ? 'none' : '1px solid #F0F0F2', alignItems: 'start' }}>
      <div style={{ fontSize: 15, color: '#717171' }}>{label}</div>
      <div style={{ fontSize: 15, color: '#222222', fontWeight: 600 }}>{value}</div>
    </div>
  );
}
function Pref({ on, text }: { on: boolean; text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, color: '#222222', fontWeight: 600 }}>
      <span style={{ color: on ? '#4F7A52' : '#C4382E', fontWeight: 800 }}>{on ? '✓' : '✕'}</span>{text}
    </span>
  );
}

// —— View Splitup popover ————————————————————————————————————————————————
function Splitup() {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: '#0571A6', fontWeight: 700, fontSize: 14, cursor: 'pointer', padding: 0, marginLeft: 4 }}>View Splitup</button>
      {open && (
        <div style={splitCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #F0F0F2' }}>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.04em', color: '#9197A2' }}>CONTRIBUTION RATE</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#C4382E', cursor: 'pointer', fontSize: 15 }}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, padding: '4px 16px 14px' }}>
            <div style={splitHead}>SUB COMPONENTS</div>
            <div style={{ ...splitHead, textAlign: 'right' }}>EMPLOYER'S CONTRIBUTION</div>
            <div style={splitCell}>Employees' Provident Fund (EPF)</div>
            <div style={{ ...splitCell, textAlign: 'right' }}>3.67% of PF Wage</div>
            <div style={splitCell}>Employees' Pension Scheme</div>
            <div style={{ ...splitCell, textAlign: 'right' }}>8.33% of PF Wage <Info text="Maximum Employer Contribution for EPS is ₹ 1,250." /></div>
          </div>
        </div>
      )}
    </span>
  );
}

// —— EPF edit form ——————————————————————————————————————————————————————
function EpfEditForm({ draft, setDraft, onSave, onCancel }: { draft: EpfConfig; setDraft: (c: EpfConfig) => void; onSave: () => void; onCancel: () => void }) {
  const set = <K extends keyof EpfConfig>(k: K, v: EpfConfig[K]) => setDraft({ ...draft, [k]: v });
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
        <Field label="EPF Number" hint="Format: AA/AAA/0000000/XXX">
          <input value={draft.epfNumber} onChange={(e) => set('epfNumber', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Deduction Cycle" info="EPF is deducted from the employee's salary every month; this cycle can't be changed.">
          <input value="Monthly" disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} />
        </Field>
      </div>

      <Field label="Employee Contribution Rate">
        <select value={draft.employeeRate} onChange={(e) => set('employeeRate', e.target.value)} style={{ ...inputStyle, maxWidth: 380 }}>
          {EPF_RATES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
        <label style={fieldLabel}>Employer Contribution Rate</label>
        <Splitup />
      </div>
      <select value={draft.employerRate} onChange={(e) => set('employerRate', e.target.value)} style={{ ...inputStyle, maxWidth: 380, marginTop: 6, marginBottom: 14 }}>
        {EPF_RATES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>

      <Check checked={draft.includeEmployer} onChange={(v) => set('includeEmployer', v)} label="Include employer's contribution in employee’s salary structure." />
      {draft.includeEmployer && (
        <div style={{ marginLeft: 26 }}>
          <Check checked={draft.includeEDLI} onChange={(v) => set('includeEDLI', v)} label="Include employer's EDLI contribution in employee’s salary structure." info="Employees' Deposit Linked Insurance — a life-cover benefit. The employer contributes 0.50% of the PF wage." />
          <Check checked={draft.includeAdmin} onChange={(v) => set('includeAdmin', v)} label="Include admin charges in employee’s salary structure." info="EPF administrative charges paid by the employer — 0.50% of the PF wage (minimum ₹500)." />
        </div>
      )}
      <Check checked={draft.overrideAtEmployee} onChange={(v) => set('overrideAtEmployee', v)} label="Override PF contribution rate at employee level" />

      <div style={{ fontSize: 15, fontWeight: 800, color: '#222222', margin: '18px 0 8px' }}>PF Configuration when LOP Applied</div>
      <Check checked={draft.proRateRestricted} onChange={(v) => set('proRateRestricted', v)} label="Pro-rate Restricted PF Wage"
        sub="PF contribution will be pro-rated based on the number of days worked by the employee." />
      <Check checked={draft.considerLOP} onChange={(v) => set('considerLOP', v)} label="Consider all applicable salary components if PF wage is less than ₹15,000 after Loss of Pay"
        sub="PF wage will be computed using the salary earned in that particular month (based on LOP) rather than the actual amount mentioned in the salary structure." />

      <div style={{ display: 'flex', gap: 10, marginTop: 22, paddingTop: 16, borderTop: '1px solid #F0F0F2' }}>
        <button onClick={onSave} style={primaryBtn}>Save</button>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}

// —— Sample EPF Calculation panel ————————————————————————————————————————
function epfSample(cfg: EpfConfig) {
  const empEPF = 1800; // 12% of 15,000
  const eps = 1250; // 8.33% of 15,000, capped
  const emprEPF = 550; // 12% of 15,000 − EPS
  const edli = cfg.includeEDLI ? 75 : 0; // 0.50% of 15,000
  const admin = cfg.includeAdmin ? 75 : 0; // 0.50% of 15,000
  return { empEPF, eps, emprEPF, edli, admin, total: emprEPF + eps + edli + admin };
}
function EpfSamplePanel({ cfg, onPreview }: { cfg: EpfConfig; onPreview: () => void }) {
  const s = epfSample(cfg);
  return (
    <div style={{ background: '#FBF7EF', border: '1px solid #EDE0C7', borderTop: '3px solid #E0A64B', borderRadius: 14, padding: '18px 20px', position: 'sticky', top: 8 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: '#222222' }}>Sample EPF Calculation</div>
      <div style={{ fontSize: 14, color: '#6E6457', marginTop: 6, lineHeight: 1.5 }}>Let's assume the PF wage is ₹ 20,000. The breakup of contribution will be:</div>

      <div style={{ background: '#fff', border: '1px solid #EBEBEB', borderRadius: 12, padding: '16px 18px', marginTop: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#222222' }}>Employee's Contribution</div>
        <CalcLine label="EPF (12% of 15000)" value={s.empEPF} />
        <div style={{ height: 1, background: '#F0F0F2', margin: '12px 0' }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: '#222222' }}>Employer's Contribution</div>
        <CalcLine label="EPS (8.33% of 15000 (Max of ₹ 15,000))" value={s.eps} />
        <CalcLine label="EPF (12% of 15000 - EPS)" value={s.emprEPF} />
        {cfg.includeEDLI && <CalcLine label="EDLI Contribution (0.50% of 15000)" value={s.edli} />}
        {cfg.includeAdmin && <CalcLine label="Admin Charges (0.50% of 15000)" value={s.admin} />}
        <div style={{ height: 1, background: '#F0F0F2', margin: '12px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800, color: '#222222' }}>
          <span>Total</span><span>₹ {s.total}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, fontSize: 14, color: '#6E6457', lineHeight: 1.5 }}>
        <span>💡</span>
        <span>Do you want to preview EPF calculation for multiple cases, based on the preferences you have configured?</span>
      </div>
      <button onClick={onPreview} style={{ background: 'none', border: 'none', color: '#0571A6', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', padding: '8px 0 0', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        👁 Preview EPF Calculation
      </button>
    </div>
  );
}
function CalcLine({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 8, fontSize: 14 }}>
      <span style={{ color: '#6E6457' }}>{label}</span>
      <span style={{ color: '#222222', fontWeight: 600, whiteSpace: 'nowrap' }}>₹ {value}</span>
    </div>
  );
}

// —— Preview EPF Calculation modal ————————————————————————————————————————
type Pkg = { basic: number; transport: number; telephone: number };
const PKGS: Pkg[] = [
  { basic: 12500, transport: 2000, telephone: 1750 },
  { basic: 9000, transport: 1000, telephone: 1500 },
  { basic: 6000, transport: 750, telephone: 500 },
];
const pkgEpf = (p: Pkg) => Math.round(0.12 * Math.min(15000, p.basic + p.transport + p.telephone));
function EpfPreviewModal({ cfg, onClose }: { cfg: EpfConfig; onClose: () => void }) {
  const [withLOP, setWithLOP] = useState(true);
  const [showCfg, setShowCfg] = useState(false);
  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 244, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 14px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.4)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={{ ...modalCard, width: 'min(920px, 100%)' }}>
        <div style={modalHead}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>EPF Sample Calculation</div>
          <CloseButton onClose={onClose} />
        </div>
        <div className="scry" style={{ padding: '20px 26px', overflowY: 'auto', flex: 1 }}>
          <div style={{ fontSize: 15, color: '#484848', lineHeight: 1.55 }}>Let's assume the salary packages considered for EPF is as shown below; the calculation is based on the settings we've configured.</div>
          <button onClick={() => setShowCfg((s) => !s)} style={{ background: 'none', border: 'none', color: '#0571A6', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', padding: '10px 0 0' }}>
            Show current configuration {showCfg ? '⌃' : '⌄'}
          </button>
          {showCfg && (
            <div style={{ background: '#F7F7F9', border: '1px solid #EBEBEB', borderRadius: 10, padding: '12px 14px', margin: '10px 0 4px', fontSize: 13.5, color: '#484848', lineHeight: 1.6 }}>
              Employee rate: {cfg.employeeRate}<br />Employer rate: {cfg.employerRate}<br />
              EDLI: {cfg.includeEDLI ? 'Included' : 'Not included'} · Admin charges: {cfg.includeAdmin ? 'Included' : 'Not included'}<br />
              Consider salary components based on LOP: {cfg.considerLOP ? 'Yes' : 'No'}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 0 12px' }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Salary and EPF Calculation</div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14.5, color: '#222222', cursor: 'pointer' }}>
              <input type="checkbox" checked={withLOP} onChange={(e) => setWithLOP(e.target.checked)} /> With 15 days LOP
            </label>
          </div>

          <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', background: '#F7F7F9', padding: '13px 16px', fontSize: 12.5, fontWeight: 800, color: '#717171' }}>
              <div>SALARY COMPONENTS {withLOP && <Badge>WITH 15 DAYS LOP</Badge>}</div>
              <div style={{ textAlign: 'right' }}>PACKAGE 1</div>
              <div style={{ textAlign: 'right' }}>PACKAGE 2</div>
              <div style={{ textAlign: 'right' }}>PACKAGE 3</div>
            </div>
            <PkgRow name="Basic" note="Always considered for EPF" values={PKGS.map((p) => p.basic)} />
            <PkgRow name="Transport Allowance" note="Considered for EPF only when PF wage < ₹ 15,000" values={PKGS.map((p) => p.transport)} />
            <PkgRow name="Telephone Allowance" note="Considered for EPF only when PF wage < ₹ 15,000" values={PKGS.map((p) => p.telephone)} last />
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', background: '#F7F7F9', padding: '16px', alignItems: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#222222' }}>EPF Contribution {withLOP && <Badge>WITH 15 DAYS LOP</Badge>}</div>
              {PKGS.map((p, i) => {
                const wage = Math.min(15000, p.basic + p.transport + p.telephone);
                return (
                  <div key={i} style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#222222' }}>₹ {pkgEpf(p)}</div>
                    <div style={{ fontSize: 12.5, color: '#717171' }}>12% of {wage}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div style={modalFoot}>
          <button onClick={onClose} style={ghostBtn}>Okay, Got It!</button>
        </div>
      </div>
    </div>
  );
}
function PkgRow({ name, note, values, last }: { name: string; note: string; values: number[]; last?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '16px', borderBottom: last ? 'none' : '1px solid #F0F0F2', alignItems: 'start' }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#222222' }}>{name}</div>
        <div style={{ fontSize: 13, color: '#8B6BB0', marginTop: 3 }}>{note}</div>
      </div>
      {values.map((v, i) => <div key={i} style={{ textAlign: 'right', fontSize: 15, color: '#222222' }}>₹ {v}</div>)}
    </div>
  );
}
function Badge({ children }: { children: ReactNode }) {
  return <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, letterSpacing: '.03em', color: '#A34B00', background: '#F7E7CE', borderRadius: 6, padding: '2px 7px', verticalAlign: 'middle' }}>{children}</span>;
}

// —— shared bits ————————————————————————————————————————————————————————
function Info({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{ color: '#9197A2', cursor: 'help', fontSize: 13, marginLeft: 5 }}>ⓘ</span>
      {show && <span style={tooltipStyle}>{text}</span>}
    </span>
  );
}
function Field({ label, hint, info, children }: { label: string; hint?: string; info?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={fieldLabel}>{label}{info && <Info text={info} />}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: '#9197A2', marginTop: 5 }}>{hint}</div>}
    </div>
  );
}
function Check({ checked, onChange, label, sub, info }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string; info?: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '7px 0' }}>
      <button type="button" onClick={() => onChange(!checked)}
        style={{ flexShrink: 0, width: 18, height: 18, marginTop: 2, borderRadius: 5, cursor: 'pointer', border: `1.5px solid ${checked ? '#0571A6' : '#C7CBD2'}`, background: checked ? '#0571A6' : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, lineHeight: 1, padding: 0 }}>
        {checked ? '✓' : ''}
      </button>
      <div>
        <div style={{ fontSize: 15, color: '#222222' }}>{label}{info && <Info text={info} />}</div>
        {sub && <div style={{ fontSize: 13, color: '#717171', marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
      </div>
    </div>
  );
}

const tabBar: CSSProperties = { display: 'flex', gap: 4, borderBottom: '1px solid #EBEBEB', marginBottom: 24 };
const tabBtn: CSSProperties = { background: 'none', border: 'none', borderBottom: '2.5px solid transparent', padding: '0 4px 11px', marginRight: 22, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit' };
const fieldLabel: CSSProperties = { display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 6, color: '#484848' };
const tooltipStyle: CSSProperties = { position: 'absolute', bottom: '150%', left: '50%', transform: 'translateX(-50%)', background: '#222222', color: '#fff', fontSize: 12.5, lineHeight: 1.45, borderRadius: 8, padding: '9px 12px', width: 230, zIndex: 60, boxShadow: '0 8px 22px rgba(0,0,0,.25)', fontWeight: 500, textAlign: 'left', whiteSpace: 'normal' };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const primaryBtn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 18px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const pencilBtn: CSSProperties = { width: 30, height: 30, borderRadius: '50%', border: '1px solid #EBEBEB', background: '#fff', color: '#717171', cursor: 'pointer', fontSize: 14 };
const cardGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 22, maxWidth: 1120 };
const stateCard: CSSProperties = { background: '#fff', border: '1px solid #EBEBEB', borderRadius: 14, padding: '20px 22px' };
const miniInput: CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #EBEBEB', borderRadius: 8, fontSize: 15, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const disableBtn: CSSProperties = { background: 'none', border: 'none', color: '#0571A6', fontWeight: 700, fontSize: 15, cursor: 'pointer', padding: 0, marginTop: 22 };
const splitCard: CSSProperties = { position: 'absolute', top: '120%', left: 0, zIndex: 20, width: 420, background: '#fff', border: '1px solid #EBEBEB', borderRadius: 12, boxShadow: '0 12px 34px rgba(34,34,34,.16)' };
const splitHead: CSSProperties = { fontSize: 11.5, fontWeight: 800, letterSpacing: '.03em', color: '#9197A2', padding: '10px 0 6px' };
const splitCell: CSSProperties = { fontSize: 14, color: '#222222', padding: '10px 0', borderTop: '1px solid #F0F0F2' };
const modalCard: CSSProperties = { position: 'relative', width: '100%', maxHeight: '92vh', background: '#fff', borderRadius: 20, boxShadow: '0 30px 70px rgba(60,40,24,.3)', animation: 'pop .2s ease both', display: 'flex', flexDirection: 'column' };
const modalHead: CSSProperties = { padding: '20px 26px', borderBottom: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 };
const modalFoot: CSSProperties = { padding: '14px 26px', borderTop: '1px solid #EBEBEB', display: 'flex', justifyContent: 'flex-start', background: '#fff', borderBottomLeftRadius: 20, borderBottomRightRadius: 20, flexShrink: 0 };
