// Payroll › Statutory & tax settings: every statutory and income-tax figure
// payroll uses, per financial year, as stored in the database
// (docs/payroll-config-api.md). Nothing falls back to a figure in code: a year
// without its rows cannot be paid, and this page says so.
//
//   Income tax — per regime: slabs, standard deduction, 87A rebate, surcharge,
//                cess, the old regime's limits (80C, 80CCD(1B), 80D, 24(b),
//                80TTA) and the HRA exemption rule (tds_configs).
//   PF & ESI   — PF employee / employer / EPS / EDLI / admin rates and the wage
//                ceiling through the year; ESI rates and the gross ceiling.
//   Bonus & meal card — the Payment of Bonus Act's rate band, wage floor and
//                eligibility ceiling; the Meal Card's tax-free amount.
//   Professional tax & LWF — per state.
//
// The rows are national: everyone with payroll access reads them; only a
// platform admin edits them (the server says which with `canEdit`).
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import {
  copyStatutoryConfig, copyTdsConfig, getStatutoryConfig, getTdsConfig, listStatutoryConfigYears, listTdsConfigYears, saveStatutoryConfig, saveTdsConfig,
} from '../../services/payroll';
import type { ConfigStatus, LwfRule, StatutoryConfig, TaxRegime, TdsConfig, TdsConfigYear } from '../../services/payroll';
import { Card, LoadError, Pill, SelectBox, SkeletonForm, StatusTabs } from '../ui';
import * as Lk from './look';
import './look.css';

type Tab = 'tax' | 'pf' | 'other' | 'states';
type Errors = Record<string, string>;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// —— Years ——
function fyOf(d: Date): string {
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return fyFrom(start);
}
const fyFrom = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
const fyStart = (fy: string) => Number(fy.slice(0, 4));
const shiftFy = (fy: string, by: number) => fyFrom(fyStart(fy) + by);

// —— Numbers as typed ↔ as stored ——
const pctOfFraction = (f: number) => String(+(f * 100).toFixed(4));
const rupeesOf = (paise: number | null | undefined) => (paise == null ? '' : String(paise / 100));

/** Reads typed values into stored ones, collecting what is wrong by field path. */
class Reader {
  errors: Errors = {};
  num(path: string, raw: string, label: string, opts: { min?: number; max?: number; gt0?: boolean } = {}): number {
    const t = raw.trim();
    const n = Number(t);
    if (t === '' || !Number.isFinite(n)) { this.errors[path] = `${label}: enter a number`; return 0; }
    if (opts.gt0 && !(n > 0)) this.errors[path] = `${label} must be more than 0`;
    else if (opts.min !== undefined && n < opts.min) this.errors[path] = `${label} must be at least ${opts.min}`;
    else if (opts.max !== undefined && n > opts.max) this.errors[path] = `${label} must be at most ${opts.max}`;
    return n;
  }
  /** Rupees typed → paise; whole paise, not negative. */
  paise(path: string, raw: string, label: string, opts: { gt0?: boolean } = {}): number {
    const n = this.num(path, raw, label, { min: 0, ...opts });
    const p = Math.round(n * 100);
    if (!this.errors[path] && Math.abs(p - n * 100) > 1e-6) this.errors[path] = `${label}: at most two decimals`;
    return p;
  }
  /** A percentage typed (0–100) → a fraction 0–1. */
  fraction(path: string, raw: string, label: string): number {
    return +(this.num(path, raw, label, { min: 0, max: 100 }) / 100).toFixed(6);
  }
  percent(path: string, raw: string, label: string): number {
    return this.num(path, raw, label, { min: 0, max: 100 });
  }
  fail(path: string, message: string) { if (!this.errors[path]) this.errors[path] = message; }
  get ok() { return Object.keys(this.errors).length === 0; }
}

// —— Statutory: the form ——
type PtSlabForm = { upTo: string; amount: string; overrideMonth: string; overrideAmount: string };
type ShareForm = { mode: 'percentage' | 'flat' | 'multiple_of_employee'; percent: string; cap: string; amount: string; factor: string };
type LwfForm = { cycle: 'monthly' | 'half_yearly'; months: number[]; employee: ShareForm; employer: ShareForm };
type StateForm = { key: number; state: string; pt: PtSlabForm[] | null; lwf: LwfForm | null };
type StatForm = {
  status: ConfigStatus; source: string;
  epf: { employeeRate: string; employerRate: string; epsRate: string; edliRate: string; adminRate: string; ceilings: { from: string; ceiling: string }[] };
  esi: { employeeRate: string; employerRate: string; grossCeiling: string };
  bonus: { minRate: string; maxRate: string; wageFloor: string; eligibilityCeiling: string };
  meal: string;
  states: StateForm[];
};
let stateKey = 1;
const shareForm = (s: LwfRule['employee'] | LwfRule['employer']): ShareForm => ({
  mode: s.mode,
  percent: s.mode === 'percentage' ? String(s.percent) : '',
  cap: s.mode === 'percentage' && s.capPaise != null ? rupeesOf(s.capPaise) : '',
  amount: s.mode === 'flat' ? rupeesOf(s.amountPaise) : '',
  factor: s.mode === 'multiple_of_employee' ? String(s.factor) : '',
});
function statFormOf(c: StatutoryConfig): StatForm {
  return {
    status: c.status, source: c.source ?? '',
    epf: {
      employeeRate: pctOfFraction(c.epf.employeeRate), employerRate: pctOfFraction(c.epf.employerRate), epsRate: pctOfFraction(c.epf.epsRate),
      edliRate: pctOfFraction(c.epf.edliRate), adminRate: pctOfFraction(c.epf.adminRate),
      ceilings: c.epf.wageCeilings.map((w) => ({ from: w.from, ceiling: rupeesOf(w.ceilingPaise) })),
    },
    esi: { employeeRate: pctOfFraction(c.esi.employeeRate), employerRate: pctOfFraction(c.esi.employerRate), grossCeiling: rupeesOf(c.esi.grossCeilingPaise) },
    bonus: { minRate: pctOfFraction(c.bonus.minRate), maxRate: pctOfFraction(c.bonus.maxRate), wageFloor: rupeesOf(c.bonus.wageFloorPaise), eligibilityCeiling: rupeesOf(c.bonus.eligibilityCeilingPaise) },
    meal: rupeesOf(c.mealCard.exemptMonthlyPaise),
    states: c.states.map((s) => ({
      key: stateKey++,
      state: s.state,
      pt: s.pt ? s.pt.slabs.map((sl) => ({ upTo: rupeesOf(sl.upToPaise), amount: rupeesOf(sl.amountPaise), overrideMonth: sl.monthOverride ? String(sl.monthOverride.month) : '', overrideAmount: sl.monthOverride ? rupeesOf(sl.monthOverride.amountPaise) : '' })) : null,
      lwf: s.lwf ? { cycle: s.lwf.cycle, months: [...s.lwf.deductionMonths], employee: shareForm(s.lwf.employee), employer: shareForm(s.lwf.employer) } : null,
    })),
  };
}
const blankShare = (mode: ShareForm['mode']): ShareForm => ({ mode, percent: '', cap: '', amount: '', factor: '' });

function readShare(r: Reader, path: string, f: ShareForm, label: string): LwfRule['employer'] {
  if (f.mode === 'flat') return { mode: 'flat', amountPaise: r.paise(`${path}.amount`, f.amount, `${label} amount`) };
  if (f.mode === 'multiple_of_employee') return { mode: 'multiple_of_employee', factor: r.num(`${path}.factor`, f.factor, `${label} multiple`, { gt0: true }) };
  const percent = r.percent(`${path}.percent`, f.percent, `${label} percentage`);
  return { mode: 'percentage', percent, ...(f.cap.trim() !== '' ? { capPaise: r.paise(`${path}.cap`, f.cap, `${label} cap`) } : {}) };
}

function readStat(fy: string, f: StatForm): { errors: Errors; value: Omit<StatutoryConfig, 'fy'> } {
  const r = new Reader();
  const epf = {
    employeeRate: r.fraction('epf.employeeRate', f.epf.employeeRate, 'PF employee rate'),
    employerRate: r.fraction('epf.employerRate', f.epf.employerRate, 'PF employer rate'),
    epsRate: r.fraction('epf.epsRate', f.epf.epsRate, 'EPS rate'),
    edliRate: r.fraction('epf.edliRate', f.epf.edliRate, 'EDLI rate'),
    adminRate: r.fraction('epf.adminRate', f.epf.adminRate, 'PF admin charges'),
    wageCeilings: f.epf.ceilings.map((w, i) => ({ from: w.from, ceilingPaise: r.paise(`epf.ceilings.${i}.ceiling`, w.ceiling, 'PF wage ceiling', { gt0: true }) })),
  };
  if (epf.epsRate > epf.employerRate) r.fail('epf.epsRate', 'EPS cannot be more than the employer rate (it is carved out of it)');
  const first = `${fyStart(fy)}-04-01`;
  const last = `${fyStart(fy) + 1}-03-31`;
  if (epf.wageCeilings.length === 0) r.fail('epf.ceilings', 'Add the PF wage ceiling');
  epf.wageCeilings.forEach((w, i) => {
    if (i === 0 && w.from !== first) r.fail(`epf.ceilings.${i}.from`, `The first ceiling starts on the year's first day, ${first}`);
    if (i > 0 && !(w.from > epf.wageCeilings[i - 1].from)) r.fail(`epf.ceilings.${i}.from`, 'Each change starts after the one above it');
    if (w.from < first || w.from > last) r.fail(`epf.ceilings.${i}.from`, `Within FY ${fy}`);
  });
  const esi = {
    employeeRate: r.fraction('esi.employeeRate', f.esi.employeeRate, 'ESI employee rate'),
    employerRate: r.fraction('esi.employerRate', f.esi.employerRate, 'ESI employer rate'),
    grossCeilingPaise: r.paise('esi.grossCeiling', f.esi.grossCeiling, 'ESI gross ceiling', { gt0: true }),
  };
  const bonus = {
    minRate: r.fraction('bonus.minRate', f.bonus.minRate, 'Minimum bonus'),
    maxRate: r.fraction('bonus.maxRate', f.bonus.maxRate, 'Maximum bonus'),
    wageFloorPaise: r.paise('bonus.wageFloor', f.bonus.wageFloor, 'Bonus wage floor', { gt0: true }),
    eligibilityCeilingPaise: r.paise('bonus.eligibilityCeiling', f.bonus.eligibilityCeiling, 'Bonus eligibility ceiling', { gt0: true }),
  };
  if (bonus.maxRate < bonus.minRate) r.fail('bonus.maxRate', 'The maximum cannot be below the minimum');
  const mealCard = { exemptMonthlyPaise: r.paise('meal', f.meal, 'Meal Card exemption') };
  const seen = new Set<string>();
  const states = f.states.map((s, i) => {
    const name = s.state.trim().toLowerCase();
    if (!name) r.fail(`states.${i}.state`, 'Name the state');
    else if (seen.has(name)) r.fail(`states.${i}.state`, 'This state is listed twice');
    seen.add(name);
    if (!s.pt && !s.lwf) r.fail(`states.${i}.state`, 'Give it Professional Tax, LWF or both');
    const out: StatutoryConfig['states'][number] = { state: name };
    if (s.pt) {
      if (s.pt.length === 0) r.fail(`states.${i}.pt`, 'Add at least one slab');
      out.pt = {
        slabs: s.pt.map((sl, j) => {
          const lastSlab = j === s.pt!.length - 1;
          let upTo: number | null = null;
          if (lastSlab) { if (sl.upTo.trim() !== '') r.fail(`states.${i}.pt.${j}.upTo`, 'The last slab is “and above”: leave it empty'); }
          else upTo = r.paise(`states.${i}.pt.${j}.upTo`, sl.upTo, 'Gross up to', { gt0: true });
          const prev = j > 0 ? s.pt![j - 1].upTo : '';
          if (!lastSlab && j > 0 && prev.trim() !== '' && Number(sl.upTo) <= Number(prev)) r.fail(`states.${i}.pt.${j}.upTo`, 'Higher than the slab above');
          const slab: { upToPaise: number | null; amountPaise: number; monthOverride?: { month: number; amountPaise: number } } = {
            upToPaise: upTo, amountPaise: r.paise(`states.${i}.pt.${j}.amount`, sl.amount, 'Tax a month'),
          };
          if (sl.overrideMonth !== '' || sl.overrideAmount.trim() !== '') {
            const month = r.num(`states.${i}.pt.${j}.overrideMonth`, sl.overrideMonth, 'Month', { min: 1, max: 12 });
            slab.monthOverride = { month, amountPaise: r.paise(`states.${i}.pt.${j}.overrideAmount`, sl.overrideAmount, 'That month’s tax') };
          }
          return slab;
        }),
      };
    }
    if (s.lwf) {
      if (s.lwf.months.length === 0) r.fail(`states.${i}.lwf.months`, 'Pick the months it is deducted in');
      const employee = readShare(r, `states.${i}.lwf.employee`, s.lwf.employee, 'Employee');
      if (employee.mode === 'multiple_of_employee') r.fail(`states.${i}.lwf.employee.factor`, 'The employee share cannot be a multiple of itself');
      out.lwf = {
        cycle: s.lwf.cycle,
        deductionMonths: [...s.lwf.months].sort((a, b) => a - b),
        employee: employee as LwfRule['employee'],
        employer: readShare(r, `states.${i}.lwf.employer`, s.lwf.employer, 'Employer'),
      };
    }
    return out;
  });
  return { errors: r.errors, value: { status: f.status, source: f.source.trim() || null, epf, esi, bonus, mealCard, states } };
}

// —— Income tax: the form ——
const LIMITS: { key: keyof TdsConfig['limits']; label: string }[] = [
  { key: 'sec80C', label: '80C (PF, PPF, ELSS, life insurance…)' },
  { key: 'sec80CCD1B', label: '80CCD(1B), own NPS' },
  { key: 'sec80DSelf', label: '80D, self and family' },
  { key: 'sec80DSelfSenior', label: '80D, self a senior citizen' },
  { key: 'sec80DParents', label: '80D, parents' },
  { key: 'sec80DParentsSenior', label: '80D, parents senior citizens' },
  { key: 'sec24bHomeLoan', label: '24(b), home loan interest' },
  { key: 'sec80TTA', label: '80TTA, savings interest' },
];
type TdsForm = {
  status: ConfigStatus; source: string; standardDeduction: string;
  slabs: { upTo: string; rate: string }[];
  rebateLimit: string; rebateMax: string; marginalRelief: boolean;
  surcharge: { above: string; rate: string }[];
  cess: string;
  limits: Record<keyof TdsConfig['limits'], string>;
  ptDeductible: boolean; hraExemption: boolean;
  hraMetro: string; hraNonMetro: string; hraRentOver: string;
};
function tdsFormOf(c: TdsConfig | null): TdsForm {
  const lim = Object.fromEntries(LIMITS.map((l) => [l.key, c ? rupeesOf(c.limits[l.key]) : ''])) as TdsForm['limits'];
  return {
    status: c?.status ?? 'to_confirm', source: c?.source ?? '', standardDeduction: c ? rupeesOf(c.standardDeductionPaise) : '',
    slabs: c ? c.slabs.map((s) => ({ upTo: rupeesOf(s.upToPaise), rate: String(s.ratePercent) })) : [{ upTo: '', rate: '' }],
    rebateLimit: c ? rupeesOf(c.rebate.incomeLimitPaise) : '', rebateMax: c ? rupeesOf(c.rebate.maxRebatePaise) : '', marginalRelief: c?.rebate.marginalRelief ?? false,
    surcharge: c ? c.surcharge.map((s) => ({ above: rupeesOf(s.abovePaise), rate: String(s.ratePercent) })) : [],
    cess: c ? String(c.cessPercent) : '',
    limits: lim,
    ptDeductible: c?.ptDeductible ?? false, hraExemption: c?.hraExemption ?? false,
    hraMetro: c?.hra ? String(c.hra.metroPercentOfBasic) : '', hraNonMetro: c?.hra ? String(c.hra.nonMetroPercentOfBasic) : '', hraRentOver: c?.hra ? String(c.hra.rentOverPercentOfBasic) : '',
  };
}
function readTds(f: TdsForm): { errors: Errors; value: Omit<TdsConfig, 'fy' | 'regime'> } {
  const r = new Reader();
  if (f.slabs.length === 0) r.fail('slabs', 'Add at least one slab');
  const slabs = f.slabs.map((s, i) => {
    const last = i === f.slabs.length - 1;
    let upTo: number | null = null;
    if (last) { if (s.upTo.trim() !== '') r.fail(`slabs.${i}.upTo`, 'The top slab is “and above”: leave it empty'); }
    else upTo = r.paise(`slabs.${i}.upTo`, s.upTo, 'Income up to', { gt0: true });
    if (!last && i > 0 && f.slabs[i - 1].upTo.trim() !== '' && Number(s.upTo) <= Number(f.slabs[i - 1].upTo)) r.fail(`slabs.${i}.upTo`, 'Higher than the slab above');
    return { upToPaise: upTo, ratePercent: r.percent(`slabs.${i}.rate`, s.rate, 'Rate') };
  });
  const surcharge = f.surcharge.map((s, i) => {
    const above = r.paise(`surcharge.${i}.above`, s.above, 'Income above', { gt0: true });
    if (i > 0 && Number(s.above) <= Number(f.surcharge[i - 1].above)) r.fail(`surcharge.${i}.above`, 'Higher than the row above');
    return { abovePaise: above, ratePercent: r.percent(`surcharge.${i}.rate`, s.rate, 'Surcharge') };
  });
  const limits = Object.fromEntries(LIMITS.map((l) => [l.key, r.paise(`limits.${l.key}`, f.limits[l.key], l.label)])) as TdsConfig['limits'];
  return {
    errors: r.errors,
    value: {
      status: f.status, source: f.source.trim() || null,
      standardDeductionPaise: r.paise('standardDeduction', f.standardDeduction, 'Standard deduction'),
      slabs,
      rebate: { incomeLimitPaise: r.paise('rebateLimit', f.rebateLimit, 'Rebate income limit'), maxRebatePaise: r.paise('rebateMax', f.rebateMax, 'Most rebate'), marginalRelief: f.marginalRelief },
      surcharge,
      cessPercent: r.percent('cess', f.cess, 'Cess'),
      limits,
      ptDeductible: f.ptDeductible, hraExemption: f.hraExemption,
      hra: {
        metroPercentOfBasic: r.percent('hraMetro', f.hraMetro, 'Metro'),
        nonMetroPercentOfBasic: r.percent('hraNonMetro', f.hraNonMetro, 'Non-metro'),
        rentOverPercentOfBasic: r.percent('hraRentOver', f.hraRentOver, 'Rent over'),
      },
    },
  };
}

// —— The page ——
type Loaded<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'missing'; message: string } | { state: 'ready'; data: T };

export function PayrollConfig() {
  const { flash } = useStore();
  const thisFy = fyOf(new Date());
  const [fy, setFy] = useState(thisFy);
  const [tab, setTab] = useState<Tab>('tax');
  const [years, setYears] = useState<{ stat: string[]; tds: string[]; canEdit: boolean } | null>(null);
  const [stat, setStat] = useState<Loaded<StatutoryConfig>>({ state: 'loading' });
  const [tds, setTds] = useState<Loaded<TdsConfigYear>>({ state: 'loading' });
  const [canEdit, setCanEdit] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([listStatutoryConfigYears(), listTdsConfigYears()])
      .then(([s, t]) => { if (live) { setYears({ stat: s.years.map((y) => y.fy), tds: t.years.map((y) => y.fy), canEdit: s.canEdit }); setCanEdit(s.canEdit); } })
      .catch(() => { if (live) setYears({ stat: [], tds: [], canEdit: false }); });
    return () => { live = false; };
  }, [attempt]);

  useEffect(() => {
    let live = true;
    setStat({ state: 'loading' });
    setTds({ state: 'loading' });
    const failure = (e: unknown): Loaded<never> => (e instanceof ApiError && e.status === 404
      ? { state: 'missing', message: e.message }
      : { state: 'error', message: e instanceof ApiError ? e.message : 'Could not be loaded' });
    getStatutoryConfig(fy).then((r) => { if (live) { setStat({ state: 'ready', data: r.config }); setCanEdit(r.canEdit); } }).catch((e) => { if (live) setStat(failure(e)); });
    getTdsConfig(fy).then((r) => { if (live) { setTds({ state: 'ready', data: r }); setCanEdit(r.canEdit); } }).catch((e) => { if (live) setTds(failure(e)); });
    return () => { live = false; };
  }, [fy, attempt]);

  const fyOptions = useMemo(() => {
    const all = new Set<string>([shiftFy(thisFy, 1), thisFy, shiftFy(thisFy, -1), ...(years?.stat ?? []), ...(years?.tds ?? []), fy]);
    return [...all].sort().reverse();
  }, [years, thisFy, fy]);
  const prevFy = shiftFy(fy, -1);

  const copy = async (what: 'stat' | 'tds') => {
    setCopying(true);
    try {
      if (what === 'stat') { const r = await copyStatutoryConfig(fy, prevFy); setStat({ state: 'ready', data: r.config }); }
      else { const r = await copyTdsConfig(fy, prevFy); setTds({ state: 'ready', data: r }); }
      flash(`FY ${fy} started from FY ${prevFy}: check each figure, then mark it confirmed`);
      setAttempt((n) => n + 1);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not copy the year', 'error');
    } finally {
      setCopying(false);
    }
  };

  const statusPill = (label: string, l: Loaded<{ status?: ConfigStatus } | TdsConfigYear>) => {
    if (l.state === 'loading') return null;
    if (l.state !== 'ready') return <Pill label={`${label}: not set up`} tone={Lk.TONES.bad} />;
    const st = 'configs' in l.data ? (Object.values(l.data.configs).some((c) => !c || c.status === 'to_confirm') ? 'to_confirm' : 'confirmed') : l.data.status;
    return <Pill label={`${label}: ${st === 'confirmed' ? 'confirmed' : 'to confirm'}`} tone={st === 'confirmed' ? Lk.TONES.ok : Lk.TONES.warn} />;
  };

  return (
    <div style={{ display: 'grid', gap: 20, animation: 'fade .3s ease both' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <SelectBox value={fy} onChange={setFy}>
          {fyOptions.map((f) => <option key={f} value={f}>FY {f}{f === thisFy ? ' (this year)' : ''}</option>)}
        </SelectBox>
        {statusPill('Income tax', tds)}
        {statusPill('Statutory', stat)}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink-3)' }}>
          {canEdit ? 'The same figures for every company on Sowaka.' : 'Read only: these figures are the same for every company and are kept by Sowaka.'}
        </span>
      </div>

      {[{ key: 'tds' as const, l: tds, name: 'Income tax settings' }, { key: 'stat' as const, l: stat, name: 'Statutory settings' }].map(({ key, l, name }) => l.state === 'missing' && (
        <div key={key} role="alert" style={{ ...Lk.note, background: 'var(--bad-bg)', borderColor: 'transparent', color: 'var(--ink)', alignItems: 'center' }}>
          <span aria-hidden style={{ fontWeight: 700, color: 'var(--bad)' }}>!</span>
          <span style={{ flex: 1 }}>
            <strong style={{ fontWeight: 600 }}>{name} for FY {fy} are not set up.</strong> Payroll cannot run for any month of this year
            {key === 'tds' ? ' where income tax is worked out' : ''} until they are.
          </span>
          {canEdit && (key === 'stat' ? years?.stat : years?.tds)?.includes(prevFy) && (
            <button type="button" onClick={() => void copy(key)} disabled={copying} className="lk-btn-p" style={Lk.btnSmPrimary}>{copying ? 'Copying…' : `Start from FY ${prevFy}`}</button>
          )}
        </div>
      ))}

      <div>
        <StatusTabs<Tab>
          options={['tax', 'pf', 'other', 'states']}
          active={tab}
          onSelect={setTab}
          labels={{ tax: 'Income tax', pf: 'PF & ESI', other: 'Bonus & meal card', states: 'Professional tax & LWF' }}
        />
      </div>

      {tab === 'tax'
        ? <TaxTab fy={fy} loaded={tds} canEdit={canEdit} onSaved={(d) => setTds({ state: 'ready', data: d })} onRetry={() => setAttempt((n) => n + 1)} />
        : <StatTab key={`${fy}-${stat.state}`} fy={fy} tab={tab} loaded={stat} canEdit={canEdit} onSaved={(c) => setStat({ state: 'ready', data: c })} onRetry={() => setAttempt((n) => n + 1)} />}
    </div>
  );
}

// —— Income tax tab ——
function TaxTab({ fy, loaded, canEdit, onSaved, onRetry }: { fy: string; loaded: Loaded<TdsConfigYear>; canEdit: boolean; onSaved: (d: TdsConfigYear) => void; onRetry: () => void }) {
  const [regime, setRegime] = useState<TaxRegime>('new');
  if (loaded.state === 'loading') return <Card style={{ padding: 22 }}><SkeletonForm fields={8} /></Card>;
  if (loaded.state === 'error') return <Card><LoadError text={loaded.message} onRetry={onRetry} /></Card>;
  const configs = loaded.state === 'ready' ? loaded.data.configs : { new: null, old: null };
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={Lk.seg}>
        {(['new', 'old'] as TaxRegime[]).map((r) => (
          <button key={r} type="button" onClick={() => setRegime(r)} style={Lk.segBtn(regime === r)}>
            {r === 'new' ? 'New regime' : 'Old regime'}{!configs[r] && <span style={{ ...Lk.segCount, color: regime === r ? 'inherit' : 'var(--bad)' }}>not set up</span>}
          </button>
        ))}
      </div>
      <TdsEditor key={`${fy}-${regime}-${configs[regime]?.updatedAt ?? 'none'}`} fy={fy} regime={regime} config={configs[regime]} canEdit={canEdit} onSaved={onSaved} />
    </div>
  );
}

function TdsEditor({ fy, regime, config, canEdit, onSaved }: { fy: string; regime: TaxRegime; config: TdsConfig | null; canEdit: boolean; onSaved: (d: TdsConfigYear) => void }) {
  const { flash } = useStore();
  const [form, setForm] = useState<TdsForm>(() => tdsFormOf(config));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [started, setStarted] = useState(config !== null);
  const original = useMemo(() => JSON.stringify(tdsFormOf(config)), [config]);
  const dirty = JSON.stringify(form) !== original;
  const ro = !canEdit;
  const set = <K extends keyof TdsForm>(k: K, v: TdsForm[K]) => setForm({ ...form, [k]: v });

  if (!started) {
    return (
      <Card padded>
        <div style={Lk.cardTitle}>{regime === 'new' ? 'New regime' : 'Old regime'} · FY {fy}</div>
        <div style={{ ...Lk.note, marginTop: 12, background: 'var(--bad-bg)', borderColor: 'transparent', color: 'var(--ink)' }}>
          Not set up. Income tax for this regime cannot be worked out for FY {fy} until it is.
        </div>
        {canEdit && <button type="button" onClick={() => setStarted(true)} className="lk-btn-p" style={{ ...Lk.btnPrimary, marginTop: 14 }}>Set it up</button>}
      </Card>
    );
  }

  const save = async () => {
    const { errors: errs, value } = readTds(form);
    setErrors(errs);
    if (Object.keys(errs).length) return flash(`${Object.keys(errs).length === 1 ? 'One figure needs' : `${Object.keys(errs).length} figures need`} fixing`, 'error');
    setSaving(true);
    try {
      onSaved(await saveTdsConfig(fy, regime, value));
      flash(`Income tax, ${regime} regime, saved for FY ${fy}`);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card padded>
        <SectionHead title="Slabs" note="On taxable income for the year. The top slab has no upper limit." />
        <RowsTable
          head={['Income up to', 'Rate', '']}
          rows={form.slabs.map((s, i) => [
            i === form.slabs.length - 1
              ? <span key="u" style={{ color: 'var(--ink-3)', fontSize: 13 }}>and above</span>
              : <Num key="u" prefix="₹" value={s.upTo} onChange={(v) => set('slabs', form.slabs.map((x, j) => (j === i ? { ...x, upTo: v } : x)))} error={errors[`slabs.${i}.upTo`]} disabled={ro} label={`Slab ${i + 1} up to`} />,
            <Num key="r" suffix="%" value={s.rate} onChange={(v) => set('slabs', form.slabs.map((x, j) => (j === i ? { ...x, rate: v } : x)))} error={errors[`slabs.${i}.rate`]} disabled={ro} label={`Slab ${i + 1} rate`} />,
            !ro && form.slabs.length > 1 ? <RemoveBtn key="x" onClick={() => set('slabs', form.slabs.filter((_, j) => j !== i))} /> : null,
          ])}
        />
        {!ro && <AddBtn onClick={() => set('slabs', [...form.slabs.slice(0, -1), { upTo: '', rate: '' }, form.slabs[form.slabs.length - 1]])}>Add a slab below the top one</AddBtn>}
        {errors.slabs && <Err text={errors.slabs} />}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <Card padded>
          <SectionHead title="Deductions, rebate and cess" />
          <Grid>
            <Num label="Standard deduction" prefix="₹" suffix="a year" value={form.standardDeduction} onChange={(v) => set('standardDeduction', v)} error={errors.standardDeduction} disabled={ro} />
            <Num label="87A rebate: income up to" prefix="₹" value={form.rebateLimit} onChange={(v) => set('rebateLimit', v)} error={errors.rebateLimit} disabled={ro} />
            <Num label="87A rebate: at most" prefix="₹" value={form.rebateMax} onChange={(v) => set('rebateMax', v)} error={errors.rebateMax} disabled={ro} />
            <Num label="Health and education cess" suffix="% of tax" value={form.cess} onChange={(v) => set('cess', v)} error={errors.cess} disabled={ro} />
          </Grid>
          <Tick checked={form.marginalRelief} onChange={(v) => set('marginalRelief', v)} disabled={ro} label="Marginal relief just above the rebate limit" />
        </Card>
        <Card padded>
          <SectionHead title="Surcharge" note="On tax, by taxable income; marginal relief at each threshold." />
          {form.surcharge.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 8 }}>No surcharge.</div>}
          <RowsTable
            head={form.surcharge.length ? ['Income above', 'Surcharge', ''] : []}
            rows={form.surcharge.map((s, i) => [
              <Num key="a" prefix="₹" value={s.above} onChange={(v) => set('surcharge', form.surcharge.map((x, j) => (j === i ? { ...x, above: v } : x)))} error={errors[`surcharge.${i}.above`]} disabled={ro} label={`Surcharge ${i + 1} above`} />,
              <Num key="r" suffix="%" value={s.rate} onChange={(v) => set('surcharge', form.surcharge.map((x, j) => (j === i ? { ...x, rate: v } : x)))} error={errors[`surcharge.${i}.rate`]} disabled={ro} label={`Surcharge ${i + 1} rate`} />,
              !ro ? <RemoveBtn key="x" onClick={() => set('surcharge', form.surcharge.filter((_, j) => j !== i))} /> : null,
            ])}
          />
          {!ro && <AddBtn onClick={() => set('surcharge', [...form.surcharge, { above: '', rate: '' }])}>Add a surcharge band</AddBtn>}
        </Card>
      </div>

      <Card padded>
        <SectionHead title={regime === 'old' ? 'Deduction limits' : 'Deduction limits (old regime figures; usually 0 here)'} note="The most each section can take off taxable income in a year." />
        <Grid min={230}>
          {LIMITS.map((l) => <Num key={l.key} label={l.label} prefix="₹" value={form.limits[l.key]} onChange={(v) => set('limits', { ...form.limits, [l.key]: v })} error={errors[`limits.${l.key}`]} disabled={ro} />)}
        </Grid>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 4 }}>
          <Tick checked={form.ptDeductible} onChange={(v) => set('ptDeductible', v)} disabled={ro} label="Professional Tax paid is deductible (16(iii))" />
          <Tick checked={form.hraExemption} onChange={(v) => set('hraExemption', v)} disabled={ro} label="HRA exemption applies (10(13A))" />
        </div>
      </Card>

      <Card padded>
        <SectionHead title="HRA exemption rule" note="The least of: HRA received, rent paid minus a share of Basic, and a share of Basic by city." />
        <Grid>
          <Num label="Metro city" suffix="% of Basic" value={form.hraMetro} onChange={(v) => set('hraMetro', v)} error={errors.hraMetro} disabled={ro} />
          <Num label="Other cities" suffix="% of Basic" value={form.hraNonMetro} onChange={(v) => set('hraNonMetro', v)} error={errors.hraNonMetro} disabled={ro} />
          <Num label="Rent paid minus" suffix="% of Basic" value={form.hraRentOver} onChange={(v) => set('hraRentOver', v)} error={errors.hraRentOver} disabled={ro} />
        </Grid>
      </Card>

      <SaveBar
        status={form.status} onStatus={(s) => set('status', s)} source={form.source} onSource={(s) => set('source', s)}
        dirty={dirty || !config} saving={saving} canEdit={canEdit} errors={errors}
        onSave={() => void save()} onReset={() => { setForm(tdsFormOf(config)); setErrors({}); }}
        updatedAt={config?.updatedAt} label={`Save the ${regime} regime`}
      />
    </div>
  );
}

// —— Statutory tabs (one row: saved together) ——
function StatTab({ fy, tab, loaded, canEdit, onSaved, onRetry }: { fy: string; tab: Exclude<Tab, 'tax'>; loaded: Loaded<StatutoryConfig>; canEdit: boolean; onSaved: (c: StatutoryConfig) => void; onRetry: () => void }) {
  const { flash } = useStore();
  const config = loaded.state === 'ready' ? loaded.data : null;
  const blank: StatForm = {
    status: 'to_confirm', source: '',
    epf: { employeeRate: '', employerRate: '', epsRate: '', edliRate: '', adminRate: '', ceilings: [{ from: `${fyStart(fy)}-04-01`, ceiling: '' }] },
    esi: { employeeRate: '', employerRate: '', grossCeiling: '' },
    bonus: { minRate: '', maxRate: '', wageFloor: '', eligibilityCeiling: '' },
    meal: '', states: [],
  };
  const [form, setForm] = useState<StatForm>(() => (config ? statFormOf(config) : blank));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [started, setStarted] = useState(config !== null);
  const original = useMemo(() => sameStat(config ? statFormOf(config) : null), [config]);

  if (loaded.state === 'loading') return <Card style={{ padding: 22 }}><SkeletonForm fields={8} /></Card>;
  if (loaded.state === 'error') return <Card><LoadError text={loaded.message} onRetry={onRetry} /></Card>;
  if (!started) {
    return (
      <Card padded>
        <div style={Lk.cardTitle}>Statutory settings · FY {fy}</div>
        <div style={{ ...Lk.note, marginTop: 12, background: 'var(--bad-bg)', borderColor: 'transparent', color: 'var(--ink)' }}>Not set up: payroll cannot run for FY {fy} until it is. Start from the previous year above, or enter every figure.</div>
        {canEdit && <button type="button" onClick={() => setStarted(true)} className="lk-btn-p" style={{ ...Lk.btnPrimary, marginTop: 14 }}>Enter the figures</button>}
      </Card>
    );
  }
  const ro = !canEdit;
  const dirty = !config || sameStat(form) !== original;
  const setEpf = (p: Partial<StatForm['epf']>) => setForm({ ...form, epf: { ...form.epf, ...p } });
  const setEsi = (p: Partial<StatForm['esi']>) => setForm({ ...form, esi: { ...form.esi, ...p } });
  const setBonus = (p: Partial<StatForm['bonus']>) => setForm({ ...form, bonus: { ...form.bonus, ...p } });
  const setState = (i: number, p: Partial<StateForm>) => setForm({ ...form, states: form.states.map((s, j) => (j === i ? { ...s, ...p } : s)) });

  const save = async () => {
    const { errors: errs, value } = readStat(fy, form);
    setErrors(errs);
    if (Object.keys(errs).length) return flash(`${Object.keys(errs).length === 1 ? 'One figure needs' : `${Object.keys(errs).length} figures need`} fixing${Object.keys(errs).some((k) => tabOfPath(k) !== tab) ? ', some on the other tabs' : ''}`, 'error');
    setSaving(true);
    try {
      const r = await saveStatutoryConfig(fy, value);
      onSaved(r.config);
      flash(`Statutory settings saved for FY ${fy}`);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {tab === 'pf' && (
        <>
          <Card padded>
            <SectionHead title="Provident fund (EPF)" note="Rates on the PF wage. EPS is carved out of the employer's share and always on the capped wage; EDLI too." />
            <Grid>
              <Num label="Employee contribution" suffix="%" value={form.epf.employeeRate} onChange={(v) => setEpf({ employeeRate: v })} error={errors['epf.employeeRate']} disabled={ro} />
              <Num label="Employer contribution" suffix="%" value={form.epf.employerRate} onChange={(v) => setEpf({ employerRate: v })} error={errors['epf.employerRate']} disabled={ro} />
              <Num label="of which pension (EPS)" suffix="%" value={form.epf.epsRate} onChange={(v) => setEpf({ epsRate: v })} error={errors['epf.epsRate']} disabled={ro} />
              <Num label="EDLI" suffix="%" value={form.epf.edliRate} onChange={(v) => setEpf({ edliRate: v })} error={errors['epf.edliRate']} disabled={ro} />
              <Num label="Admin charges" suffix="%" value={form.epf.adminRate} onChange={(v) => setEpf({ adminRate: v })} error={errors['epf.adminRate']} disabled={ro} />
            </Grid>
            <div style={{ ...Lk.eyebrow, margin: '8px 0 10px' }}>PF wage ceiling through the year</div>
            <RowsTable
              head={['From', 'Ceiling a month', '']}
              rows={form.epf.ceilings.map((w, i) => [
                <DateIn key="f" value={w.from} disabled={ro || i === 0} min={`${fyStart(fy)}-04-01`} max={`${fyStart(fy) + 1}-03-31`} onChange={(v) => setEpf({ ceilings: form.epf.ceilings.map((x, j) => (j === i ? { ...x, from: v } : x)) })} error={errors[`epf.ceilings.${i}.from`]} label={`Ceiling ${i + 1} from`} />,
                <Num key="c" prefix="₹" value={w.ceiling} onChange={(v) => setEpf({ ceilings: form.epf.ceilings.map((x, j) => (j === i ? { ...x, ceiling: v } : x)) })} error={errors[`epf.ceilings.${i}.ceiling`]} disabled={ro} label={`Ceiling ${i + 1}`} />,
                !ro && i > 0 ? <RemoveBtn key="x" onClick={() => setEpf({ ceilings: form.epf.ceilings.filter((_, j) => j !== i) })} /> : null,
              ])}
            />
            {!ro && <AddBtn onClick={() => setEpf({ ceilings: [...form.epf.ceilings, { from: '', ceiling: '' }] })}>Add a change during the year</AddBtn>}
            {errors['epf.ceilings'] && <Err text={errors['epf.ceilings']} />}
            <div style={{ ...Lk.cardNote, marginTop: 8 }}>A month with a change is paid day-weighted. The first ceiling starts on 1 April {fyStart(fy)}.</div>
          </Card>
          <Card padded>
            <SectionHead title="Employees' State Insurance (ESI)" note="On gross pay, for people whose monthly wage is at or under the ceiling." />
            <Grid>
              <Num label="Employee contribution" suffix="%" value={form.esi.employeeRate} onChange={(v) => setEsi({ employeeRate: v })} error={errors['esi.employeeRate']} disabled={ro} />
              <Num label="Employer contribution" suffix="%" value={form.esi.employerRate} onChange={(v) => setEsi({ employerRate: v })} error={errors['esi.employerRate']} disabled={ro} />
              <Num label="Gross ceiling" prefix="₹" suffix="a month" value={form.esi.grossCeiling} onChange={(v) => setEsi({ grossCeiling: v })} error={errors['esi.grossCeiling']} disabled={ro} />
            </Grid>
          </Card>
        </>
      )}

      {tab === 'other' && (
        <>
          <Card padded>
            <SectionHead title="Statutory bonus" note="Payment of Bonus Act. A company's bonus rate must stay within the band." />
            <Grid>
              <Num label="Minimum rate" suffix="%" value={form.bonus.minRate} onChange={(v) => setBonus({ minRate: v })} error={errors['bonus.minRate']} disabled={ro} />
              <Num label="Maximum rate" suffix="%" value={form.bonus.maxRate} onChange={(v) => setBonus({ maxRate: v })} error={errors['bonus.maxRate']} disabled={ro} />
              <Num label="Bonus wage floor" prefix="₹" suffix="a month" hint="The bonus wage: the lower of Basic and this, or the state minimum wage if higher" value={form.bonus.wageFloor} onChange={(v) => setBonus({ wageFloor: v })} error={errors['bonus.wageFloor']} disabled={ro} />
              <Num label="Eligible up to" prefix="₹" suffix="Basic a month" hint="No bonus when Basic is above this" value={form.bonus.eligibilityCeiling} onChange={(v) => setBonus({ eligibilityCeiling: v })} error={errors['bonus.eligibilityCeiling']} disabled={ro} />
            </Grid>
          </Card>
          <Card padded>
            <SectionHead title="Meal Card" note="The part of a Meal Card that is tax free each month." />
            <Grid>
              <Num label="Tax free" prefix="₹" suffix="a month" value={form.meal} onChange={(v) => setForm({ ...form, meal: v })} error={errors.meal} disabled={ro} />
            </Grid>
          </Card>
        </>
      )}

      {tab === 'states' && (
        <>
          {form.states.length === 0 && <Card padded><div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No state has Professional Tax or LWF here yet.</div></Card>}
          {form.states.map((s, i) => (
            <StateCard key={s.key} s={s} i={i} errors={errors} ro={ro} onChange={(p) => setState(i, p)} onRemove={() => setForm({ ...form, states: form.states.filter((_, j) => j !== i) })} />
          ))}
          {!ro && <div><button type="button" onClick={() => setForm({ ...form, states: [...form.states, { key: stateKey++, state: '', pt: [{ upTo: '', amount: '', overrideMonth: '', overrideAmount: '' }], lwf: null }] })} className="lk-btn" style={Lk.btn}>+ Add a state</button></div>}
          <div style={Lk.cardNote}>A company can still set its own rule for a state in Statutory Components; that wins over this row for that company.</div>
        </>
      )}

      <SaveBar
        status={form.status} onStatus={(st) => setForm({ ...form, status: st })} source={form.source} onSource={(src) => setForm({ ...form, source: src })}
        dirty={dirty} saving={saving} canEdit={canEdit} errors={errors}
        onSave={() => void save()} onReset={() => { setForm(config ? statFormOf(config) : blank); setErrors({}); }}
        updatedAt={config?.updatedAt} label="Save statutory settings" note="PF, ESI, bonus, meal card and the states are one row: saved together."
      />
    </div>
  );
}
/** A statutory form as text to compare, without the list keys React needs. */
const sameStat = (f: StatForm | null) => JSON.stringify(f && { ...f, states: f.states.map((st) => ({ state: st.state, pt: st.pt, lwf: st.lwf })) });
/** Which tab a field's error is on. */
const tabOfPath = (path: string): Exclude<Tab, 'tax'> => (path.startsWith('epf') || path.startsWith('esi') ? 'pf' : path.startsWith('states') ? 'states' : 'other');

function StateCard({ s, i, errors, ro, onChange, onRemove }: { s: StateForm; i: number; errors: Errors; ro: boolean; onChange: (p: Partial<StateForm>) => void; onRemove: () => void }) {
  const e = (k: string) => errors[`states.${i}.${k}`];
  const setSlab = (j: number, p: Partial<PtSlabForm>) => onChange({ pt: s.pt!.map((x, k) => (k === j ? { ...x, ...p } : x)) });
  const lwf = s.lwf;
  const setLwf = (p: Partial<LwfForm>) => onChange({ lwf: { ...lwf!, ...p } });
  return (
    <Card padded>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{ width: 260 }}>
          <Text label="State" value={s.state} onChange={(v) => onChange({ state: v })} disabled={ro} error={e('state')} placeholder="e.g. karnataka" />
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 28 }}>
          <Tick checked={s.pt !== null} disabled={ro} onChange={(v) => onChange({ pt: v ? [{ upTo: '', amount: '', overrideMonth: '', overrideAmount: '' }] : null })} label="Professional Tax" />
          <Tick checked={lwf !== null} disabled={ro} onChange={(v) => onChange({ lwf: v ? { cycle: 'monthly', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], employee: blankShare('flat'), employer: blankShare('multiple_of_employee') } : null })} label="Labour Welfare Fund" />
        </div>
        {!ro && <button type="button" onClick={onRemove} className="lk-btn" style={{ ...Lk.btnDanger, marginLeft: 'auto', marginTop: 24 }}>Remove state</button>}
      </div>
      {s.pt && (
        <>
          <div style={{ ...Lk.eyebrow, margin: '6px 0 10px' }}>Professional Tax · on monthly gross</div>
          <RowsTable
            head={['Gross up to', 'Tax a month', 'Different in month', 'That month', '']}
            rows={s.pt.map((sl, j) => [
              j === s.pt!.length - 1 ? <span key="u" style={{ color: 'var(--ink-3)', fontSize: 13 }}>and above</span>
                : <Num key="u" prefix="₹" value={sl.upTo} onChange={(v) => setSlab(j, { upTo: v })} error={e(`pt.${j}.upTo`)} disabled={ro} label={`Slab ${j + 1} up to`} />,
              <Num key="a" prefix="₹" value={sl.amount} onChange={(v) => setSlab(j, { amount: v })} error={e(`pt.${j}.amount`)} disabled={ro} label={`Slab ${j + 1} tax`} />,
              <select key="m" value={sl.overrideMonth} disabled={ro} onChange={(ev) => setSlab(j, { overrideMonth: ev.target.value })} aria-label={`Slab ${j + 1} different month`} style={{ ...Lk.input, cursor: ro ? 'default' : 'pointer' }}>
                <option value="">No</option>
                {MONTHS.map((m, k) => <option key={m} value={String(k + 1)}>{m}</option>)}
              </select>,
              sl.overrideMonth ? <Num key="o" prefix="₹" value={sl.overrideAmount} onChange={(v) => setSlab(j, { overrideAmount: v })} error={e(`pt.${j}.overrideAmount`)} disabled={ro} label={`Slab ${j + 1} that month`} /> : <span key="o" />,
              !ro && s.pt!.length > 1 ? <RemoveBtn key="x" onClick={() => onChange({ pt: s.pt!.filter((_, k) => k !== j) })} /> : null,
            ])}
          />
          {!ro && <AddBtn onClick={() => onChange({ pt: [...s.pt!.slice(0, -1), { upTo: '', amount: '', overrideMonth: '', overrideAmount: '' }, s.pt![s.pt!.length - 1]] })}>Add a slab below the top one</AddBtn>}
          {e('pt') && <Err text={e('pt')!} />}
        </>
      )}
      {lwf && (
        <>
          <div style={{ ...Lk.eyebrow, margin: '16px 0 10px' }}>Labour Welfare Fund</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'block' }}>
              <span style={Lk.label}>Cycle</span>
              <select value={lwf.cycle} disabled={ro} onChange={(ev) => setLwf({ cycle: ev.target.value as LwfForm['cycle'] })} style={{ ...Lk.input, width: 160 }}>
                <option value="monthly">Monthly</option>
                <option value="half_yearly">Half-yearly</option>
              </select>
            </label>
            <div>
              <span style={Lk.label}>Deducted in</span>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {MONTHS.map((m, k) => {
                  const on = lwf.months.includes(k + 1);
                  return <button key={m} type="button" disabled={ro} onClick={() => setLwf({ months: on ? lwf.months.filter((x) => x !== k + 1) : [...lwf.months, k + 1] })} style={{ ...Lk.chip(on), height: 30, padding: '0 10px' }}>{m}</button>;
                })}
              </div>
              {e('lwf.months') && <Err text={e('lwf.months')!} />}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginTop: 14 }}>
            <ShareEditor title="Employee" f={lwf.employee} modes={['flat', 'percentage']} ro={ro} err={(k) => e(`lwf.employee.${k}`)} onChange={(f) => setLwf({ employee: f })} />
            <ShareEditor title="Employer" f={lwf.employer} modes={['multiple_of_employee', 'flat', 'percentage']} ro={ro} err={(k) => e(`lwf.employer.${k}`)} onChange={(f) => setLwf({ employer: f })} />
          </div>
        </>
      )}
    </Card>
  );
}

function ShareEditor({ title, f, modes, ro, err, onChange }: { title: string; f: ShareForm; modes: ShareForm['mode'][]; ro: boolean; err: (k: string) => string | undefined; onChange: (f: ShareForm) => void }) {
  const label: Record<ShareForm['mode'], string> = { flat: 'A fixed amount', percentage: 'A percentage of gross', multiple_of_employee: "A multiple of the employee's" };
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{title}</span>
        <select value={f.mode} disabled={ro} onChange={(ev) => onChange({ ...blankShare(ev.target.value as ShareForm['mode']) })} style={{ ...Lk.input, width: 220, minHeight: 36, padding: '6px 10px' }}>
          {modes.map((m) => <option key={m} value={m}>{label[m]}</option>)}
        </select>
      </div>
      <Grid min={130}>
        {f.mode === 'flat' && <Num label="Amount" prefix="₹" value={f.amount} onChange={(v) => onChange({ ...f, amount: v })} error={err('amount')} disabled={ro} />}
        {f.mode === 'percentage' && <Num label="Percentage" suffix="%" value={f.percent} onChange={(v) => onChange({ ...f, percent: v })} error={err('percent')} disabled={ro} />}
        {f.mode === 'percentage' && <Num label="Capped at (optional)" prefix="₹" value={f.cap} onChange={(v) => onChange({ ...f, cap: v })} error={err('cap')} disabled={ro} />}
        {f.mode === 'multiple_of_employee' && <Num label="Times the employee's" suffix="×" value={f.factor} onChange={(v) => onChange({ ...f, factor: v })} error={err('factor')} disabled={ro} />}
      </Grid>
    </div>
  );
}

// —— Shared bits ——
function SaveBar({ status, onStatus, source, onSource, dirty, saving, canEdit, errors, onSave, onReset, updatedAt, label, note }: {
  status: ConfigStatus; onStatus: (s: ConfigStatus) => void; source: string; onSource: (s: string) => void;
  dirty: boolean; saving: boolean; canEdit: boolean; errors: Errors; onSave: () => void; onReset: () => void; updatedAt?: string; label: string; note?: string;
}) {
  const count = Object.keys(errors).length;
  return (
    <Card padded style={{ position: 'sticky', bottom: 12, zIndex: 5 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'block' }}>
          <span style={Lk.label}>Checked against the law</span>
          <select value={status} disabled={!canEdit} onChange={(e) => onStatus(e.target.value as ConfigStatus)} style={{ ...Lk.input, width: 190 }}>
            <option value="to_confirm">To confirm</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </label>
        <div style={{ flex: 1, minWidth: 260 }}>
          <Text label="Source" value={source} onChange={onSource} disabled={!canEdit} placeholder="e.g. Finance Act 2025; EPFO circular of …" />
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8 }}>
            {dirty && <button type="button" onClick={onReset} disabled={saving} className="lk-btn" style={Lk.btn}>Undo changes</button>}
            <button type="button" onClick={onSave} disabled={saving || !dirty} className="lk-btn-p" style={{ ...Lk.btnPrimary, opacity: dirty ? 1 : 0.5 }}>{saving ? 'Saving…' : label}</button>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12, color: 'var(--ink-3)', flexWrap: 'wrap' }}>
        {count > 0 && <span style={{ color: 'var(--bad)' }}>{count === 1 ? 'One figure needs' : `${count} figures need`} fixing: {Object.values(errors).slice(0, 2).join('; ')}{count > 2 ? '…' : ''}</span>}
        {note && <span>{note}</span>}
        {updatedAt && <span style={{ marginLeft: 'auto' }}>Last saved {new Date(updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
      </div>
    </Card>
  );
}

function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={Lk.cardTitle}>{title}</div>
      {note && <div style={{ ...Lk.cardNote, marginTop: 2 }}>{note}</div>}
    </div>
  );
}
function Grid({ children, min = 200 }: { children: ReactNode; min?: number }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: '4px 16px' }}>{children}</div>;
}
function Err({ text }: { text: string }) {
  return <div style={{ fontSize: 11.5, color: 'var(--bad)', marginTop: 4 }}>{text}</div>;
}
/** A number with an optional ₹ before and a unit after; the label sits above unless it is only for screen readers. */
function Num({ label, value, onChange, prefix, suffix, error, disabled, hint }: {
  label: string; value: string; onChange: (v: string) => void; prefix?: string; suffix?: string; error?: string; disabled?: boolean; hint?: string;
}) {
  const inRow = !hint && label.match(/^(Slab|Surcharge|Ceiling) \d/);
  return (
    <label style={{ display: 'block', marginBottom: inRow ? 0 : 12 }}>
      {!inRow && <span style={Lk.label}>{label}</span>}
      <span className="lk-field" style={{ ...box, borderColor: error ? 'var(--bad)' : 'var(--line-2)', background: disabled ? 'var(--surface-2)' : 'var(--surface)' }}>
        {prefix && <span style={{ ...affix, borderRight: '1px solid var(--line-2)' }}>{prefix}</span>}
        <input type="number" inputMode="decimal" value={value} disabled={disabled} aria-label={label} placeholder={disabled ? '' : 'Not set'} onChange={(e) => onChange(e.target.value)} style={inner} />
        {suffix && <span style={{ ...affix, borderLeft: '1px solid var(--line-2)' }}>{suffix}</span>}
      </span>
      {error ? <Err text={error} /> : hint ? <span style={{ display: 'block', ...Lk.cardNote, fontSize: 11.5, marginTop: 4 }}>{hint}</span> : null}
    </label>
  );
}
function Text({ label, value, onChange, disabled, error, placeholder }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; error?: string; placeholder?: string }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={Lk.label}>{label}</span>
      <input value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="lk-in" style={{ ...Lk.input, borderColor: error ? 'var(--bad)' : undefined, background: disabled ? 'var(--surface-2)' : undefined }} />
      {error && <Err text={error} />}
    </label>
  );
}
function DateIn({ value, onChange, disabled, error, min, max, label }: { value: string; onChange: (v: string) => void; disabled?: boolean; error?: string; min: string; max: string; label: string }) {
  return (
    <span style={{ display: 'block' }}>
      <input type="date" value={value} min={min} max={max} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value)} className="lk-in" style={{ ...Lk.input, borderColor: error ? 'var(--bad)' : undefined, background: disabled ? 'var(--surface-2)' : undefined }} />
      {error && <Err text={error} />}
    </span>
  );
}
function Tick({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', cursor: disabled ? 'default' : 'pointer' }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
function RowsTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (rows.length === 0) return null;
  return (
    <table className="lk-t" style={{ ...Lk.table, marginBottom: 6 }}>
      {head.length > 0 && <thead><tr>{head.map((h, i) => <th key={i} style={{ ...Lk.th, width: i === head.length - 1 && h === '' ? 44 : undefined }}>{h}</th>)}</tr></thead>}
      <tbody>{rows.map((cells, i) => <tr key={i}>{cells.map((c, j) => <td key={j} style={{ ...Lk.td, padding: '8px 12px', verticalAlign: 'top' }}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}
function RemoveBtn({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} title="Remove" style={{ border: 'none', background: 'none', color: 'var(--bad)', fontSize: 15, cursor: 'pointer', padding: '10px 4px' }}>✕</button>;
}
function AddBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} style={{ ...Lk.btnGhost, padding: '0 4px' }}>+ {children}</button>;
}

const box: CSSProperties = { display: 'flex', alignItems: 'stretch', height: 42, border: '1px solid var(--line-2)', borderRadius: 12, overflow: 'hidden' };
const affix: CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 12, color: 'var(--ink-3)', background: 'var(--surface-2)', whiteSpace: 'nowrap' };
const inner: CSSProperties = { border: 'none', outline: 'none', padding: '0 12px', fontSize: 13, width: '100%', minWidth: 0, color: 'var(--ink)', background: 'transparent', fontFamily: 'inherit' };
