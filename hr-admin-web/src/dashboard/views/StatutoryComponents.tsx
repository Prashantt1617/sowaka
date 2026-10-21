// Payroll › Statutory Components — EPF / ESI / Professional Tax / Labour Welfare
// Fund / Statutory Bonus. One set of settings for the whole company, read and
// saved through /admin/payroll/statutory-settings; every payroll run applies it
// to each person by their pay and work state.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { getStatutorySettings, updateStatutorySettings, upsertStatutoryRule } from '../../services/payroll';
import type { BonusSettings, EpfSettings, EsiSettings, LwfRule, PtRule, PtSlab, StatutoryOverview, StatutorySettingsInput } from '../../services/payroll';
import { Card } from '../ui';
import { CloseButton } from '../drawers/shell';

type StatTab = 'epf' | 'esi' | 'pt' | 'lwf' | 'bonus' | 'tds';
const TABS: { key: StatTab; label: string }[] = [
  { key: 'epf', label: 'EPF' },
  { key: 'esi', label: 'ESI' },
  { key: 'pt', label: 'Professional Tax' },
  { key: 'lwf', label: 'Labour Welfare Fund' },
  { key: 'bonus', label: 'Statutory Bonus' },
  { key: 'tds', label: 'Income Tax (TDS)' },
];

/** What every tab gets: the org's settings and a way to save part of them. */
type TabProps = { overview: StatutoryOverview; apply: (input: StatutorySettingsInput, done: string) => Promise<boolean>; saving: boolean };

export function StatutoryComponents() {
  const { flash } = useStore();
  const [tab, setTab] = useState<StatTab>('epf');
  const [overview, setOverview] = useState<StatutoryOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getStatutorySettings().then(setOverview).catch((e) => {
      setFailed(true);
      flash(e instanceof ApiError ? e.message : 'Could not load statutory settings');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async (input: StatutorySettingsInput, done: string) => {
    if (saving) return false;
    setSaving(true);
    try {
      setOverview(await updateStatutorySettings(input));
      flash(done);
      return true;
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save');
      return false;
    } finally {
      setSaving(false);
    }
  };

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
      {!overview ? (
        <Card style={{ padding: '40px 22px', textAlign: 'center', color: '#717171', fontSize: 15 }}>{failed ? 'Statutory settings could not be loaded.' : 'Loading…'}</Card>
      ) : tab === 'epf' ? <EpfTab overview={overview} apply={apply} saving={saving} />
        : tab === 'esi' ? <EsiTab overview={overview} apply={apply} saving={saving} />
        : tab === 'pt' ? <PtTab overview={overview} onSaved={() => getStatutorySettings().then(setOverview)} />
        : tab === 'lwf' ? <LwfTab overview={overview} apply={apply} saving={saving} />
        : tab === 'tds' ? <TdsTab overview={overview} apply={apply} saving={saving} />
        : <BonusTab overview={overview} apply={apply} saving={saving} />}
    </div>
  );
}

/** "1,500" from paise. */
const rupees = (paise: number) => (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// —— EPF ————————————————————————————————————————————————————————————————
const EPF_RATES = ['12% of Actual PF Wage', 'Restrict Contribution to ₹25,000 of PF Wage'];
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
const RATE_TEXT: Record<EpfSettings['employeeRate'], string> = { actual: EPF_RATES[0], restricted: EPF_RATES[1] };
const rateMode = (text: string): EpfSettings['employeeRate'] => (text === EPF_RATES[0] ? 'actual' : 'restricted');
function toEpfConfig(s: EpfSettings): EpfConfig {
  return {
    epfNumber: s.epfNumber ?? '',
    employeeRate: RATE_TEXT[s.employeeRate],
    employerRate: RATE_TEXT[s.employerRate],
    includeEmployer: s.includeEmployer,
    includeEDLI: s.includeEDLI,
    includeAdmin: s.includeAdmin,
    overrideAtEmployee: s.overrideAtEmployee,
    proRateRestricted: s.proRateRestricted,
    considerLOP: s.considerLOP,
  };
}
function fromEpfConfig(c: EpfConfig): Partial<EpfSettings> {
  return {
    enabled: true,
    epfNumber: c.epfNumber.trim(),
    employeeRate: rateMode(c.employeeRate),
    employerRate: rateMode(c.employerRate),
    includeEmployer: c.includeEmployer,
    includeEDLI: c.includeEDLI,
    includeAdmin: c.includeAdmin,
    overrideAtEmployee: c.overrideAtEmployee,
    proRateRestricted: c.proRateRestricted,
    considerLOP: c.considerLOP,
  };
}

function EpfTab({ overview, apply, saving }: TabProps) {
  const cfg = toEpfConfig(overview.settings.epf);
  const enabled = overview.settings.epf.enabled;
  const [draft, setDraft] = useState<EpfConfig>(cfg);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);

  const startEdit = () => { setDraft(cfg); setEditing(true); };
  const save = async () => { if (await apply({ epf: fromEpfConfig(draft) }, 'EPF settings saved')) setEditing(false); };
  const active = editing ? draft : cfg;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 372px', gap: 24, alignItems: 'start' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>Employees' Provident Fund</div>
          {!editing && enabled && <button onClick={startEdit} title="Edit" style={pencilBtn}>✎</button>}
        </div>

        {!enabled ? (
          <DisabledNote what="Employees' Provident Fund" detail="No PF is deducted or contributed for anyone until it is enabled." onEnable={() => void apply({ epf: { enabled: true } }, 'EPF enabled')} saving={saving} />
        ) : editing ? (
          <EpfEditForm draft={draft} setDraft={setDraft} onSave={() => void save()} onCancel={() => setEditing(false)} saving={saving} />
        ) : (
          <EpfReadView cfg={cfg} onDisable={() => void apply({ epf: { enabled: false } }, 'EPF disabled')} />
        )}
      </div>

      <EpfSamplePanel cfg={active} onPreview={() => setPreview(true)} />

      {preview && <EpfPreviewModal cfg={active} onClose={() => setPreview(false)} />}
    </div>
  );
}

/** A statutory component switched off for the whole company. */
function DisabledNote({ what, detail, onEnable, saving }: { what: string; detail: string; onEnable: () => void; saving: boolean }) {
  return (
    <div style={{ border: '1px dashed #D9DCE1', borderRadius: 12, padding: '22px 24px', maxWidth: 640 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#222222' }}>{what} is disabled</div>
      <div style={{ fontSize: 14.5, color: '#717171', marginTop: 4, lineHeight: 1.5 }}>{detail}</div>
      <button onClick={onEnable} disabled={saving} style={{ ...primaryBtn, marginTop: 16 }}>Enable</button>
    </div>
  );
}

// —— Professional Tax ——————————————————————————————————————————————————
// One card per work location on the roster, with its state's slabs.
function ptSlabText(rule: PtRule): string[] {
  const sorted = [...rule.slabs].sort((a, b) => (a.upToPaise ?? Infinity) - (b.upToPaise ?? Infinity));
  return sorted.map((slab, i) => {
    const prev = i > 0 ? sorted[i - 1].upToPaise : null;
    const range = slab.upToPaise === null
      ? `Above ₹${rupees(prev ?? 0)}`
      : prev === null ? `Up to ₹${rupees(slab.upToPaise)}` : `₹${rupees(prev + 1)} – ₹${rupees(slab.upToPaise)}`;
    const extra = slab.monthOverride ? ` (₹${rupees(slab.monthOverride.amountPaise)} in month ${slab.monthOverride.month})` : '';
    return `${range}: ₹${rupees(slab.amountPaise)} / month${extra}`;
  });
}
function PtTab({ overview, onSaved }: { overview: StatutoryOverview; onSaved: () => Promise<unknown> }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div>
      <SectionHead title="Professional Tax" sub="This tax is levied on an employee’s income by the State Government. Tax slabs differ in each state." />
      {overview.pt.length === 0 && <EmptyStates />}
      <div style={cardGrid}>
        {overview.pt.map((l) => (
          <div key={l.location} style={stateCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1, fontSize: 18, fontWeight: 700, color: '#222222' }}>{l.location}</div>
              {editing !== l.location && (
                <button type="button" onClick={() => setEditing(l.location)} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 14 }}>✎ Edit slabs</button>
              )}
            </div>
            {editing === l.location ? (
              <PtSlabEditor state={l.state} rule={l.pt} onDone={async (saved) => { if (saved) await onSaved(); setEditing(null); }} />
            ) : l.pt ? (
              <div>
                <div style={{ fontSize: 13, color: '#9197A2', marginBottom: 8 }}>Monthly gross in <strong style={{ color: '#484848' }}>{l.state}</strong></div>
                {ptSlabText(l.pt).map((line) => (
                  <div key={line} style={{ fontSize: 14.5, color: '#222222', padding: '8px 0', borderTop: '1px solid #F4F1EC' }}>{line}</div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, border: '1px dashed #D9DCE1', borderRadius: 10, padding: '16px 18px', background: '#FFFFFF' }}>
                <NoEntry />
                <div style={{ fontSize: 14.5, color: '#717171', lineHeight: 1.5 }}>
                  Professional Tax is not applicable for your work location in <strong style={{ color: '#484848' }}>{l.state}</strong>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
/** Edit one state's Professional Tax slabs; saved for this company only. */
function PtSlabEditor({ state, rule, onDone }: { state: string; rule: PtRule | null | undefined; onDone: (saved: boolean) => void }) {
  const { flash } = useStore();
  type Draft = { upTo: string; amount: string; febAmount: string };
  const toDraft = (s: PtSlab): Draft => ({
    upTo: s.upToPaise === null ? '' : String(s.upToPaise / 100),
    amount: String(s.amountPaise / 100),
    febAmount: s.monthOverride ? String(s.monthOverride.amountPaise / 100) : '',
  });
  const sorted = [...(rule?.slabs ?? [])].sort((a, b) => (a.upToPaise ?? Infinity) - (b.upToPaise ?? Infinity));
  const [rows, setRows] = useState<Draft[]>(sorted.length ? sorted.map(toDraft) : [{ upTo: '', amount: '0', febAmount: '' }]);
  const [saving, setSaving] = useState(false);
  const patch = (i: number, p: Partial<Draft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const save = async () => {
    const slabs: PtSlab[] = [];
    for (const [i, r] of rows.entries()) {
      const last = i === rows.length - 1;
      const upTo = r.upTo.trim() === '' ? null : Number(r.upTo);
      if (!last && (upTo === null || !(upTo > 0))) return flash(`Slab ${i + 1}: enter the monthly gross it goes up to`);
      if (upTo !== null && !(upTo > 0)) return flash(`Slab ${i + 1}: the limit must be more than 0`);
      if (i > 0 && upTo !== null && slabs[i - 1].upToPaise !== null && upTo * 100 <= slabs[i - 1].upToPaise!) return flash(`Slab ${i + 1} must go higher than the one above it`);
      const amount = Number(r.amount);
      if (!(amount >= 0)) return flash(`Slab ${i + 1}: enter the tax a month (0 for none)`);
      const feb = r.febAmount.trim() === '' ? undefined : Number(r.febAmount);
      if (feb !== undefined && !(feb >= 0)) return flash(`Slab ${i + 1}: the February amount must be 0 or more`);
      slabs.push({ upToPaise: last ? (upTo === null ? null : Math.round(upTo * 100)) : Math.round(upTo! * 100), amountPaise: Math.round(amount * 100), ...(feb !== undefined ? { monthOverride: { month: 2, amountPaise: Math.round(feb * 100) } } : {}) });
    }
    setSaving(true);
    try {
      await upsertStatutoryRule(state, { pt: { slabs } });
      flash(`Professional Tax saved for ${state}`);
      onDone(true);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the slabs');
    } finally {
      setSaving(false);
    }
  };
  const cell: CSSProperties = { width: '100%', padding: '7px 9px', border: '1px solid #D9DCE1', borderRadius: 8, fontSize: 14.5, fontFamily: 'inherit' };
  return (
    <div>
      <div style={{ fontSize: 13, color: '#9197A2', marginBottom: 8 }}>Monthly gross in <strong style={{ color: '#484848' }}>{state}</strong>. Leave the last slab’s limit empty for “and above”.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) 28px', gap: 8, fontSize: 12, fontWeight: 700, color: '#717171', marginBottom: 6 }}>
        <span>Gross up to ₹</span><span>Tax ₹ / month</span><span>February ₹ (if different)</span><span />
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) 28px', gap: 8, marginBottom: 8 }}>
          <input type="number" min="0" placeholder={i === rows.length - 1 ? 'and above' : ''} value={r.upTo} onChange={(e) => patch(i, { upTo: e.target.value })} style={cell} aria-label={`Slab ${i + 1} gross up to`} />
          <input type="number" min="0" value={r.amount} onChange={(e) => patch(i, { amount: e.target.value })} style={cell} aria-label={`Slab ${i + 1} tax a month`} />
          <input type="number" min="0" value={r.febAmount} onChange={(e) => patch(i, { febAmount: e.target.value })} style={cell} aria-label={`Slab ${i + 1} February tax`} />
          <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length === 1} title="Remove slab" style={{ border: 'none', background: 'none', color: '#A8475F', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => setRows([...rows, { upTo: '', amount: '0', febAmount: '' }])} style={{ border: 'none', background: 'none', color: '#0571A6', fontWeight: 700, fontSize: 14, cursor: 'pointer', padding: '4px 0' }}>+ Add slab</button>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" onClick={() => void save()} disabled={saving} style={{ ...primaryBtn, padding: '7px 16px', fontSize: 15 }}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={() => onDone(false)} disabled={saving} style={{ ...ghostBtn, padding: '7px 16px', fontSize: 15 }}>Cancel</button>
      </div>
    </div>
  );
}

function EmptyStates() {
  return (
    <Card style={{ padding: '26px 22px', color: '#717171', fontSize: 15, marginBottom: 18 }}>
      No work locations yet. Set each person’s work location and state on their profile; the rules for those states appear here.
    </Card>
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
function lwfEmployeeText(rule: LwfRule): { main: string; sub?: string } {
  const e = rule.employee;
  if (e.mode === 'flat') return { main: `₹ ${rupees(e.amountPaise)}` };
  return { main: `${e.percent}% of Gross Pay`, sub: e.capPaise !== undefined ? `Max Limit : ₹ ${rupees(e.capPaise)}` : undefined };
}
function lwfEmployerText(rule: LwfRule): string {
  const e = rule.employer;
  if (e.mode === 'flat') return `₹ ${rupees(e.amountPaise)}`;
  if (e.mode === 'multiple_of_employee') return `${e.factor} * Employees' Contribution`;
  return `${e.percent}% of Gross Pay${e.capPaise !== undefined ? ` (Max Limit : ₹ ${rupees(e.capPaise)})` : ''}`;
}
function LwfTab({ overview, apply, saving }: TabProps) {
  return (
    <div>
      <SectionHead title="Labour Welfare Fund" sub="Labour Welfare Fund act ensures social security and improves working conditions for employees." />
      {overview.lwf.length === 0 && <EmptyStates />}
      <div style={cardGrid}>
        {overview.lwf.map((s) => (
          <div key={s.state} style={stateCard}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#222222', marginBottom: 16 }}>{s.state}</div>
            {s.rule ? (
              <>
                <LwfRow label="Employees' Contribution" value={(() => { const t = lwfEmployeeText(s.rule); return <span>{t.main}{t.sub && <><br /><span style={{ fontSize: 13, color: '#9197A2' }}>({t.sub})</span></>}</span>; })()} />
                <LwfRow label="Employer's Contribution" value={lwfEmployerText(s.rule)} />
                <LwfRow label="Deduction Cycle" value={s.rule.cycle === 'monthly' ? 'Monthly' : 'Half Yearly'} />
                <LwfRow label="Status" value={
                  <span>
                    <span style={{ color: s.enabled ? '#4F7A52' : '#C4382E', fontWeight: 700 }}>{s.enabled ? 'Enabled' : 'Disabled'}</span>{' '}
                    <button disabled={saving} onClick={() => void apply({ lwf: { state: s.state, enabled: !s.enabled } }, `LWF ${s.enabled ? 'disabled' : 'enabled'} for ${s.state}`)}
                      style={{ background: 'none', border: 'none', color: '#0571A6', fontWeight: 700, fontSize: 15, cursor: 'pointer', padding: 0 }}>
                      ({s.enabled ? 'Disable' : 'Enable'})
                    </button>
                  </span>
                } last />
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, border: '1px dashed #D9DCE1', borderRadius: 10, padding: '16px 18px' }}>
                <NoEntry />
                <div style={{ fontSize: 14.5, color: '#717171', lineHeight: 1.5 }}>Labour Welfare Fund is not applicable for your work state in <strong style={{ color: '#484848' }}>{s.state}</strong></div>
              </div>
            )}
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
function toBonusConfig(b: BonusSettings, states: string[]): BonusConfig {
  return {
    frequency: b.frequency,
    percent: String(b.ratePercent),
    states: states.map((state) => ({
      state,
      wages: (b.minWages[state.toLowerCase()] ?? []).map((w, i) => ({ id: `${state}-${i}`, category: w.category, minWage: String(w.minWagePaise / 100), effectiveFrom: w.effectiveFrom })),
    })),
  };
}
function fromBonusConfig(c: BonusConfig): Partial<BonusSettings> {
  const minWages: BonusSettings['minWages'] = {};
  for (const st of c.states) {
    minWages[st.state.toLowerCase()] = st.wages.map((w) => ({ category: w.category.trim(), minWagePaise: Math.round((Number(w.minWage) || 0) * 100), effectiveFrom: w.effectiveFrom }));
  }
  return { enabled: true, frequency: c.frequency, ratePercent: Number(c.percent), minWages };
}
// —— Income tax (TDS) ——————————————————————————————————————————————————
// Off: income tax is only what HR types on each run. On: a run works out
// each person's monthly TDS when HR hasn't typed one, from their regime and
// declarations (Salary details › Income tax) and the FY's slabs.
function TdsTab({ overview, apply, saving }: TabProps) {
  const t = overview.settings.tds ?? { enabled: false, defaultRegime: 'new' as const };
  return (
    <Card style={{ padding: '22px 24px' }}>
      <div style={{ fontSize: 17, fontWeight: 800 }}>Income tax (TDS on salary)</div>
      <div style={{ fontSize: 14, color: '#717171', marginTop: 4, maxWidth: 720, lineHeight: 1.5 }}>
        When on, each payroll run works out a person&rsquo;s income tax unless you type it: projected yearly taxable salary (this year&rsquo;s payslips so far plus the structure for the months left), less the standard deduction and, in the old regime, their declarations; tax by the year&rsquo;s slabs, the section 87A rebate, surcharge and 4% cess; minus the tax already withheld, spread over the months left.
      </div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginTop: 18, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700 }}>
          <input type="checkbox" checked={t.enabled} disabled={saving} onChange={(e) => void apply({ tds: { enabled: e.target.checked, defaultRegime: t.defaultRegime } }, e.target.checked ? 'TDS engine on' : 'TDS engine off')} />
          Work out TDS on each payroll run
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}>
          Regime for people without a declaration
          <select value={t.defaultRegime} disabled={saving} onChange={(e) => void apply({ tds: { enabled: t.enabled, defaultRegime: e.target.value as 'new' | 'old' } }, 'Default regime saved')} style={{ padding: '7px 10px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 15 }}>
            <option value="new">New regime (default by law)</option>
            <option value="old">Old regime</option>
          </select>
        </label>
      </div>
      <div style={{ marginTop: 16, background: '#F6E9D5', border: '1px solid #ECD9B4', borderRadius: 10, padding: '12px 14px', fontSize: 14, color: '#8A6A20', lineHeight: 1.5 }}>
        FY 2026-27 slabs and limits are confirmed: Budget 2026 left them as they were in FY 2025-26. Meal cards are tax-free up to ₹200 a meal (₹8,800 a month). The rules are re-checked on the 1st of every month. A figure typed on a run always wins over the engine.
      </div>
    </Card>
  );
}

function BonusTab({ overview, apply, saving }: TabProps) {
  const cfg = toBonusConfig(overview.settings.bonus, overview.states);
  const enabled = overview.settings.bonus.enabled;
  const [draft, setDraft] = useState<BonusConfig>(cfg);
  const [editing, setEditing] = useState(false);
  const [seq, setSeq] = useState(100);
  const active = editing ? draft : cfg;
  const freqLabel = active.frequency === 'monthly' ? 'Monthly' : 'Yearly';

  const setWages = (state: string, wages: WageRow[]) => setDraft({ ...draft, states: draft.states.map((s) => (s.state === state ? { ...s, wages } : s)) });
  const addWage = (state: string) => { setWages(state, [...(draft.states.find((s) => s.state === state)?.wages ?? []), { id: `w${seq}`, category: '', minWage: '', effectiveFrom: new Date().toISOString().slice(0, 7) }]); setSeq(seq + 1); };
  const save = async () => { if (await apply({ bonus: fromBonusConfig(draft) }, 'Statutory Bonus saved')) setEditing(false); };

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
          {draft.states.length === 0 && <EmptyStates />}
          {draft.states.map((st) => (
            <div key={st.state} style={{ ...stateCard, marginBottom: 18 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#222222', marginBottom: 14 }}>{st.state}</div>
              {st.wages.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, border: '1px solid #F0F0F2', borderRadius: 10, padding: '24px 18px', fontSize: 15, color: '#484848', textAlign: 'center' }}>
                  <span><span style={{ color: '#E0A64B', fontSize: 17, marginRight: 8 }}>⚠</span>Minimum wage details are not added for {st.state}</span>
                  <button onClick={() => addWage(st.state)} style={{ background: '#EAF2FB', border: 'none', borderRadius: 6, color: '#0571A6', fontWeight: 700, fontSize: 14, cursor: 'pointer', padding: '7px 12px' }}>+ Add Minimum Wage</button>
                </div>
              ) : (<>
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
              </>)}
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button onClick={() => void save()} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          {!enabled && (
            <div style={{ background: '#FBF7EF', border: '1px solid #EDE0C7', borderRadius: 10, padding: '12px 16px', fontSize: 14, color: '#6E6457', marginBottom: 22, maxWidth: 780 }}>
              Statutory Bonus is <strong>disabled</strong>: no bonus line is added to anyone’s payslip. Edit and save to enable it.
            </div>
          )}
          <div style={{ display: 'flex', gap: 60, marginBottom: 30 }}>
            <StatTile icon="📅" bg="#E4EDE0" label="Bonus Payment Cycle" value={freqLabel} />
            <StatTile icon="％" bg="#F7E7CE" label="Percentage of Bonus" value={`${cfg.percent}%`} />
          </div>
          <SectionHead title="Minimum Wage in Each State" sub="Statutory Bonus is a percentage of either the minimum wage or Basic + DA (whichever is higher)." />
          {cfg.states.length === 0 && <EmptyStates />}
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
          {enabled && <button disabled={saving} onClick={() => void apply({ bonus: { enabled: false } }, 'Statutory Bonus disabled')} style={disableBtn}>🗑 Disable Statutory Bonus</button>}
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
const toEsiConfig = (s: EsiSettings): EsiConfig => ({ esiNumber: s.esiNumber ?? '', includeEmployer: s.includeEmployer });

function EsiTab({ overview, apply, saving }: TabProps) {
  const cfg = toEsiConfig(overview.settings.esi);
  const enabled = overview.settings.esi.enabled;
  const [draft, setDraft] = useState<EsiConfig>(cfg);
  const [editing, setEditing] = useState(false);
  const set = <K extends keyof EsiConfig>(k: K, v: EsiConfig[K]) => setDraft({ ...draft, [k]: v });
  const save = async () => { if (await apply({ esi: { enabled: true, esiNumber: draft.esiNumber.trim(), includeEmployer: draft.includeEmployer } }, 'ESI settings saved')) setEditing(false); };

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>Employees' State Insurance</div>
        {!editing && enabled && <button onClick={() => { setDraft(cfg); setEditing(true); }} title="Edit" style={pencilBtn}>✎</button>}
      </div>

      {!enabled ? (
        <DisabledNote what="Employees' State Insurance" detail="No ESI is deducted for anyone, whatever they earn, until it is enabled." onEnable={() => void apply({ esi: { enabled: true } }, 'ESI enabled')} saving={saving} />
      ) : editing ? (
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
            <button onClick={() => void save()} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <Row label="ESI Number" value={cfg.esiNumber || '—'} />
          <Row label="Deduction Cycle" value="Monthly" />
          <Row label="Employees' Contribution" value="0.75% of Gross Pay" />
          <Row label="Employer's Contribution" value="3.25% of Gross Pay" />
          <Row label="Other Details" value={cfg.includeEmployer ? "Employer's contribution is included in employee’s salary structure." : "Employer's contribution is not included in employee’s salary structure."} last />
          <button disabled={saving} onClick={() => void apply({ esi: { enabled: false } }, 'ESI disabled')} style={disableBtn}>🗑 Disable ESI</button>
        </div>
      )}
    </div>
  );
}

// —— EPF read view ——————————————————————————————————————————————————————
function EpfReadView({ cfg, onDisable }: { cfg: EpfConfig; onDisable: () => void }) {
  return (
    <div>
      <Row label="EPF Number" value={cfg.epfNumber || '—'} />
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
      <Row label="Consider applicable salary components based on LOP" value={cfg.considerLOP ? 'Yes (when PF wage is less than ₹25,000)' : 'No'} />
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
            <div style={{ ...splitCell, textAlign: 'right' }}>8.33% of PF Wage <Info text="Maximum Employer Contribution for EPS is ₹ 2,083." /></div>
          </div>
        </div>
      )}
    </span>
  );
}

// —— EPF edit form ——————————————————————————————————————————————————————
function EpfEditForm({ draft, setDraft, onSave, onCancel, saving }: { draft: EpfConfig; setDraft: (c: EpfConfig) => void; onSave: () => void; onCancel: () => void; saving: boolean }) {
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
      <Check checked={draft.considerLOP} onChange={(v) => set('considerLOP', v)} label="Consider all applicable salary components if PF wage is less than ₹25,000 after Loss of Pay"
        sub="PF wage will be computed using the salary earned in that particular month (based on LOP) rather than the actual amount mentioned in the salary structure." />

      <div style={{ display: 'flex', gap: 10, marginTop: 22, paddingTop: 16, borderTop: '1px solid #F0F0F2' }}>
        <button onClick={onSave} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}

// —— Sample EPF Calculation panel ————————————————————————————————————————
function epfSample(cfg: EpfConfig) {
  // PF wage ₹30,000, above the ₹25,000 ceiling.
  const empEPF = 3000; // 12% of 25,000
  const eps = 2083; // 8.33% of 25,000, capped
  const emprEPF = 917; // 12% of 25,000 − EPS
  const edli = cfg.includeEDLI ? 125 : 0; // 0.50% of 25,000
  const admin = cfg.includeAdmin ? 125 : 0; // 0.50% of 25,000
  return { empEPF, eps, emprEPF, edli, admin, total: emprEPF + eps + edli + admin };
}
function EpfSamplePanel({ cfg, onPreview }: { cfg: EpfConfig; onPreview: () => void }) {
  const s = epfSample(cfg);
  return (
    <div style={{ background: '#FBF7EF', border: '1px solid #EDE0C7', borderTop: '3px solid #E0A64B', borderRadius: 14, padding: '18px 20px', position: 'sticky', top: 8 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: '#222222' }}>Sample EPF Calculation</div>
      <div style={{ fontSize: 14, color: '#6E6457', marginTop: 6, lineHeight: 1.5 }}>Let's assume the PF wage is ₹ 30,000. The breakup of contribution will be:</div>

      <div style={{ background: '#fff', border: '1px solid #EBEBEB', borderRadius: 12, padding: '16px 18px', marginTop: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#222222' }}>Employee's Contribution</div>
        <CalcLine label="EPF (12% of 25000)" value={s.empEPF} />
        <div style={{ height: 1, background: '#F0F0F2', margin: '12px 0' }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: '#222222' }}>Employer's Contribution</div>
        <CalcLine label="EPS (8.33% of 25000 (Max of ₹ 25,000))" value={s.eps} />
        <CalcLine label="EPF (12% of 25000 - EPS)" value={s.emprEPF} />
        {cfg.includeEDLI && <CalcLine label="EDLI Contribution (0.50% of 25000)" value={s.edli} />}
        {cfg.includeAdmin && <CalcLine label="Admin Charges (0.50% of 25000)" value={s.admin} />}
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
  { basic: 22500, transport: 2000, telephone: 1750 },
  { basic: 9000, transport: 1000, telephone: 1500 },
  { basic: 6000, transport: 750, telephone: 500 },
];
const pkgEpf = (p: Pkg) => Math.round(0.12 * Math.min(25000, p.basic + p.transport + p.telephone));
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
            <PkgRow name="Transport Allowance" note="Considered for EPF only when PF wage < ₹ 25,000" values={PKGS.map((p) => p.transport)} />
            <PkgRow name="Telephone Allowance" note="Considered for EPF only when PF wage < ₹ 25,000" values={PKGS.map((p) => p.telephone)} last />
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', background: '#F7F7F9', padding: '16px', alignItems: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#222222' }}>EPF Contribution {withLOP && <Badge>WITH 15 DAYS LOP</Badge>}</div>
              {PKGS.map((p, i) => {
                const wage = Math.min(25000, p.basic + p.transport + p.telephone);
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
