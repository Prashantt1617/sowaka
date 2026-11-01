// Payroll › Dashboard — the month at a glance, as Zoho's payroll home shows
// it: the run that needs attention, what is owed to the government for the
// last finished month, who is on payroll and whose set-up is incomplete, what
// is waiting on HR, the payroll cost month by month, and Payroll in the
// employee app (its switch and deadlines).
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { Card, EmptyRow, LoadError, Skeleton, SkeletonFrame, SkeletonLines } from '../ui';
import { useLoad } from '../useLoad';
import { getPayrollDashboard, type CostRange, type PayrollDashboardReport } from '../../services/payroll';
import { OPEN_REPORT_KEY } from './PayrollReports';
import { EmployeeAppSettingsCard } from './EmployeeAppSettings';
import * as Lk from './look';

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  not_started: { label: 'Not started', ...Lk.TONES.mute },
  draft: { label: 'Draft', ...Lk.TONES.mute },
  pending_approval: { label: 'Awaiting approval', ...Lk.TONES.warn },
  approved: { label: 'Approved', ...Lk.TONES.ok },
  paid: { label: 'Paid', ...Lk.TONES.ok },
};
const RANGES: { key: CostRange; label: string }[] = [
  { key: 'this_year', label: 'This year' }, { key: 'this_quarter', label: 'This quarter' },
  { key: 'previous_year', label: 'Previous year' }, { key: 'previous_quarter', label: 'Previous quarter' },
];
// The cost bar, bottom to top: what reached employees, then what went elsewhere.
const SERIES = [
  { key: 'netPayPaise', label: 'Net pay', color: 'var(--p-green)' },
  { key: 'taxesPaise', label: 'Taxes (TDS)', color: 'var(--p-yellow)' },
  { key: 'deductionsPaise', label: 'Deductions (PF, PT, LWF, others)', color: 'var(--p-blue)' },
  { key: 'employerPaise', label: 'Employer contributions', color: 'var(--p-orange)' },
] as const;

const money = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortMonth = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' });
const dateLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function PayrollDashboard() {
  const s = useStore();
  const [range, setRange] = useState<CostRange>('this_year');
  const [includeDrafts, setIncludeDrafts] = useState(false);
  // Keyed by range and drafts: another choice shows skeletons in the cards
  // (the controls stay put), never the last choice's figures.
  const report = useLoad(() => getPayrollDashboard(range, includeDrafts), [range, includeDrafts]);
  const data = report.data;
  useEffect(() => {
    if (report.state === 'error') s.flash(report.error instanceof ApiError ? report.error.message : 'Could not load the payroll dashboard', 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.state]);

  const openReport = (key: string) => {
    try { localStorage.setItem(OPEN_REPORT_KEY, key); } catch { /* storage blocked: reports opens on its first report */ }
    s.setView('payrollreports');
  };

  if (report.state === 'error') return <Card><LoadError text="The payroll dashboard could not load." onRetry={report.retry} /></Card>;
  const run = data?.currentRun;
  const st = run ? STATUS[run.status] ?? STATUS.draft : STATUS.draft;
  const pending = <SkeletonLines lines={4} style={{ padding: '16px 22px' }} />;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
          <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} /> Include draft runs in the figures
        </label>
      </div>

      <Card style={{ padding: 20 }}>
        {!run ? <SkeletonLines lines={2} /> : <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200, flex: 1 }}>
            <div style={label}>Pay run</div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.02em', marginTop: 4 }}>{monthLabel(run.period)} <span style={{ ...pill, background: st.bg, color: st.fg }}><span aria-hidden style={Lk.pillDot} />{st.label}</span></div>
          </div>
          <Stat title="Employees" value={run.status === 'not_started' ? '—' : String(run.employees)} />
          <Stat title="Net pay" value={run.status === 'not_started' ? '—' : money(run.netPayPaise)} />
          <Stat title="Pay date" value={dateLabel(run.payDate)} />
          <button onClick={() => s.setView('payruns')} className="lk-btn-p" style={primary}>{run.status === 'not_started' ? 'Create run' : 'Open run'}</button>
        </div>}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 20 }}>
        <Card>
          <CardHead title="Benefits and deductions" right={data?.dues ? `${monthLabel(data.dues.period)}${data.dues.status === 'approved' || data.dues.status === 'paid' ? '' : ' · draft'}` : ''} />
          {!data ? pending : !data.dues ? <EmptyRow text="No finished run yet." /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 0 }}>
              <Due title="EPF" sub="Employee + employer, EPS, EDLI, admin" value={data.dues.epfPaise} onView={() => openReport('liability')} />
              <Due title="ESI" sub="Employee + employer" value={data.dues.esiPaise} onView={() => openReport('liability')} />
              <Due title="TDS" sub="Income tax withheld" value={data.dues.tdsPaise} onView={() => openReport('liability')} />
              <Due title="Professional Tax" sub="By state" value={data.dues.ptPaise} onView={() => openReport('pt')} />
              <Due title="Labour Welfare Fund" sub="Employee + employer" value={data.dues.lwfPaise} onView={() => openReport('liability')} />
            </div>
          )}
        </Card>
        <div style={{ display: 'grid', gap: 20 }}>
          <Card>
            <CardHead title="Employees" />
            {!data ? pending : <div style={{ padding: '0 20px 12px' }}>
              <Row label="Active employees" value={data.people.active} />
              <Row label="On payroll (salary assigned)" value={data.people.withSalary} />
              <Row label="No salary assigned" value={data.people.noSalary} warn={data.people.noSalary > 0} />
              <Row label="On payroll, no bank account" value={data.people.noBankAccount} warn={data.people.noBankAccount > 0} />
              <Row label="On payroll, no PAN" value={data.people.noPan} warn={data.people.noPan > 0} />
            </div>}
          </Card>
          <Card>
            <CardHead title="To do" />
            {!data ? pending : <div style={{ padding: '0 20px 12px' }}>
              {data.todo.pendingClaims + data.todo.runsAwaitingApproval === 0 ? <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: '8px 0' }}>Nothing waiting.</div> : (
                <>
                  {data.todo.runsAwaitingApproval > 0 && <Row label="Runs awaiting approval" value={data.todo.runsAwaitingApproval} onClick={() => s.setView('payruns')} />}
                  {data.todo.pendingClaims > 0 && <Row label="Reimbursement claims to review" value={data.todo.pendingClaims} onClick={() => s.setView('reimbursements')} />}
                </>
              )}
            </div>}
          </Card>
        </div>
      </div>

      <Card>
        <CardHead title="Payroll cost summary" right={
          <select value={range} onChange={(e) => setRange(e.target.value as CostRange)} style={select}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        } />
        {!data ? (
          <SkeletonFrame style={{ display: 'flex', alignItems: 'flex-end', gap: 28, height: 250, padding: '24px 40px 30px 80px' }}>
            {[52, 70, 38, 84, 60, 46, 76, 58, 66, 42, 72, 50].map((h, i) => <Skeleton key={i} h={0} r={4} style={{ height: `${h}%`, flex: 1, width: 'auto' }} />)}
          </SkeletonFrame>
        ) : <CostChart months={data.cost.months} />}
        <div style={{ display: 'flex', gap: '8px 16px', flexWrap: 'wrap', padding: '0 20px 20px', fontSize: 12.5, color: 'var(--ink-2)' }}>
          {SERIES.map((x) => <span key={x.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: x.color }} />{x.label}</span>)}
          {data && <span style={{ color: 'var(--ink-3)' }}>{data.cost.label} · finished runs{includeDrafts ? ' and drafts' : ''}</span>}
        </div>
      </Card>

      <EmployeeAppSettingsCard />
    </div>
  );
}

/** Stacked monthly bars, drawn to one scale; hover a bar for its figures. */
function CostChart({ months }: { months: PayrollDashboardReport['cost']['months'] }) {
  const totals = months.map((m) => SERIES.reduce((t, x) => t + m[x.key], 0));
  const maxPaise = Math.max(...totals, 0);
  if (maxPaise === 0) return <EmptyRow text="No finished runs in this period." />;
  // A round axis top: 1, 2 or 5 × a power of ten, in rupees.
  const maxR = maxPaise / 100;
  const pow = 10 ** Math.floor(Math.log10(maxR));
  const top = [1, 2, 5, 10].map((f) => f * pow).find((v) => v >= maxR)!;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const W = 900, H = 280, L = 70, B = 30, T = 12;
  const plotW = W - L - 12, plotH = H - B - T;
  const slot = plotW / months.length;
  const barW = Math.min(46, slot * 0.55);
  const y = (rupees: number) => T + plotH - (rupees / top) * plotH;
  const fmt = (r: number) => (r >= 1e7 ? `${(r / 1e7).toFixed(r % 1e7 ? 1 : 0)} Cr` : r >= 1e5 ? `${(r / 1e5).toFixed(r % 1e5 ? 1 : 0)} L` : r >= 1e3 ? `${Math.round(r / 1e3)} K` : String(r));
  return (
    <div style={{ padding: '0 12px 4px', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 560, display: 'block' }} role="img" aria-label="Payroll cost by month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 12} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t ? '4 4' : undefined} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--ink-3)">{fmt(t)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = L + slot * i + (slot - barW) / 2;
          let acc = 0;
          return (
            <g key={m.period}>
              <title>{`${monthLabel(m.period)}${m.status ? '' : ' · no run'}\n${SERIES.map((sr) => `${sr.label}: ${money(m[sr.key])}`).join('\n')}`}</title>
              {SERIES.map((sr) => {
                const v = m[sr.key] / 100;
                if (v <= 0) return null;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                return <rect key={sr.key} x={x} y={y1} width={barW} height={Math.max(0.5, y0 - y1)} rx={Math.min(4, Math.max(0, (y0 - y1) / 2))} fill={sr.color} />;
              })}
              <text x={x + barW / 2} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--ink-2)">{shortMonth(m.period)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function CardHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '20px 20px 12px' }}>
      <div style={{ ...Lk.cardTitle, flex: 1 }}>{title}</div>
      {right && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{right}</div>}
    </div>
  );
}
function Stat({ title, value }: { title: string; value: string }) {
  return <div><div style={label}>{title}</div><div style={{ fontSize: 14, fontWeight: 500, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div></div>;
}
function Due({ title, sub, value, onView }: { title: string; sub: string; value: number; onView: () => void }) {
  return (
    <div style={{ padding: '4px 20px 20px', borderRight: '1px solid var(--line)' }}>
      <div style={{ fontSize: 12.5, fontWeight: 400, color: 'var(--ink-2)' }}>{title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div>
      <div style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', margin: '8px 0 6px', fontVariantNumeric: 'tabular-nums' }}>{money(value)}</div>
      <button onClick={onView} style={link}>View details</button>
    </div>
  );
}
function Row({ label: text, value, warn, onClick }: { label: string; value: number; warn?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)', cursor: onClick ? 'pointer' : undefined }}>
      <span style={{ flex: 1, fontSize: 13.5, color: 'var(--ink-2)' }}>{text}</span>
      <strong style={{ fontSize: 14, fontWeight: 500, color: warn ? 'var(--bad)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
    </div>
  );
}

const label: CSSProperties = { ...Lk.kvDt };
const pill: CSSProperties = { ...Lk.pill('mute'), marginLeft: 8, verticalAlign: 'middle', letterSpacing: 0 };
const primary: CSSProperties = { ...Lk.btnPrimary };
const link: CSSProperties = { background: 'none', border: 'none', padding: 0, color: 'var(--accent-ink)', fontWeight: 500, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' };
const select: CSSProperties = { height: 32, padding: '0 10px', border: '1px solid var(--line-2)', borderRadius: 999, fontSize: 12, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' };
