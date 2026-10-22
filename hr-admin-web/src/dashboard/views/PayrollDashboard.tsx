// Payroll › Dashboard — the month at a glance, as Zoho's payroll home shows
// it: the run that needs attention, what is owed to the government for the
// last finished month, who is on payroll and whose set-up is incomplete, what
// is waiting on HR, and the payroll cost month by month.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { Card, EmptyRow } from '../ui';
import { getPayrollDashboard, type CostRange, type PayrollDashboardReport } from '../../services/payroll';
import { OPEN_REPORT_KEY } from './PayrollReports';

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  not_started: { label: 'Not started', bg: 'var(--surface-2)', fg: 'var(--ink-2)' },
  draft: { label: 'Draft', bg: 'var(--warn-bg)', fg: 'var(--warn)' },
  pending_approval: { label: 'Awaiting approval', bg: 'var(--accent-soft)', fg: 'var(--t-sky-i)' },
  approved: { label: 'Approved', bg: 'var(--ok-bg)', fg: 'var(--ok)' },
  paid: { label: 'Paid', bg: 'var(--ok-bg)', fg: 'var(--ok)' },
};
const RANGES: { key: CostRange; label: string }[] = [
  { key: 'this_year', label: 'This year' }, { key: 'this_quarter', label: 'This quarter' },
  { key: 'previous_year', label: 'Previous year' }, { key: 'previous_quarter', label: 'Previous quarter' },
];
// The cost bar, bottom to top: what reached employees, then what went elsewhere.
const SERIES = [
  { key: 'netPayPaise', label: 'Net pay', color: '#1FA971' },
  { key: 'taxesPaise', label: 'Taxes (TDS)', color: '#F2B233' },
  { key: 'deductionsPaise', label: 'Deductions (PF, PT, LWF, others)', color: '#6B8BEF' },
  { key: 'employerPaise', label: 'Employer contributions', color: '#E7795B' },
] as const;

const money = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortMonth = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' });
const dateLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function PayrollDashboard() {
  const s = useStore();
  const [range, setRange] = useState<CostRange>('this_year');
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [data, setData] = useState<PayrollDashboardReport | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setData(undefined);
    void getPayrollDashboard(range, includeDrafts)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) { setData(null); s.flash(e instanceof ApiError ? e.message : 'Could not load the payroll dashboard', 'error'); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, includeDrafts]);

  const openReport = (key: string) => {
    try { localStorage.setItem(OPEN_REPORT_KEY, key); } catch { /* storage blocked: reports opens on its first report */ }
    s.setView('payrollreports');
  };

  if (data === undefined) return <Card><EmptyRow text="Loading…" /></Card>;
  if (data === null) return <Card><EmptyRow text="The payroll dashboard could not load." /></Card>;
  const run = data.currentRun;
  const st = STATUS[run.status] ?? STATUS.draft;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-2)' }}>
          <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} /> Include draft runs in the figures
        </label>
      </div>

      <Card style={{ padding: '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200, flex: 1 }}>
            <div style={label}>Pay run</div>
            <div style={{ fontSize: 17, fontWeight: 600, marginTop: 4 }}>{monthLabel(run.period)} <span style={{ ...pill, background: st.bg, color: st.fg }}>{st.label}</span></div>
          </div>
          <Stat title="Employees" value={run.status === 'not_started' ? '—' : String(run.employees)} />
          <Stat title="Net pay" value={run.status === 'not_started' ? '—' : money(run.netPayPaise)} />
          <Stat title="Pay date" value={dateLabel(run.payDate)} />
          <button onClick={() => s.setView('payruns')} style={primary}>{run.status === 'not_started' ? 'Create run' : 'Open run'}</button>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
        <Card>
          <CardHead title="Benefits and deductions" right={data.dues ? `${monthLabel(data.dues.period)}${data.dues.status === 'approved' || data.dues.status === 'paid' ? '' : ' · draft'}` : ''} />
          {!data.dues ? <EmptyRow text="No finished run yet." /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 0 }}>
              <Due title="EPF" sub="Employee + employer, EPS, EDLI, admin" value={data.dues.epfPaise} onView={() => openReport('liability')} />
              <Due title="ESI" sub="Employee + employer" value={data.dues.esiPaise} onView={() => openReport('liability')} />
              <Due title="TDS" sub="Income tax withheld" value={data.dues.tdsPaise} onView={() => openReport('liability')} />
              <Due title="Professional Tax" sub="By state" value={data.dues.ptPaise} onView={() => openReport('pt')} />
              <Due title="Labour Welfare Fund" sub="Employee + employer" value={data.dues.lwfPaise} onView={() => openReport('liability')} />
            </div>
          )}
        </Card>
        <div style={{ display: 'grid', gap: 18 }}>
          <Card>
            <CardHead title="Employees" />
            <div style={{ padding: '6px 22px 16px' }}>
              <Row label="Active employees" value={data.people.active} />
              <Row label="On payroll (salary assigned)" value={data.people.withSalary} />
              <Row label="No salary assigned" value={data.people.noSalary} warn={data.people.noSalary > 0} />
              <Row label="On payroll, no bank account" value={data.people.noBankAccount} warn={data.people.noBankAccount > 0} />
              <Row label="On payroll, no PAN" value={data.people.noPan} warn={data.people.noPan > 0} />
            </div>
          </Card>
          <Card>
            <CardHead title="To do" />
            <div style={{ padding: '6px 22px 16px' }}>
              {data.todo.pendingClaims + data.todo.runsAwaitingApproval === 0 ? <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: '8px 0' }}>Nothing waiting.</div> : (
                <>
                  {data.todo.runsAwaitingApproval > 0 && <Row label="Runs awaiting approval" value={data.todo.runsAwaitingApproval} onClick={() => s.setView('payruns')} />}
                  {data.todo.pendingClaims > 0 && <Row label="Reimbursement claims to review" value={data.todo.pendingClaims} onClick={() => s.setView('reimbursements')} />}
                </>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHead title="Payroll cost summary" right={
          <select value={range} onChange={(e) => setRange(e.target.value as CostRange)} style={select}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        } />
        <CostChart months={data.cost.months} />
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '0 22px 18px', fontSize: 12.5, color: 'var(--ink-2)' }}>
          {SERIES.map((x) => <span key={x.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: x.color }} />{x.label}</span>)}
          <span style={{ color: 'var(--ink-4)' }}>{data.cost.label} · finished runs{includeDrafts ? ' and drafts' : ''}</span>
        </div>
      </Card>
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
    <div style={{ padding: '10px 14px 4px', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 560, display: 'block' }} role="img" aria-label="Payroll cost by month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 12} y1={y(t)} y2={y(t)} stroke="var(--line-2)" strokeDasharray={t ? '4 4' : undefined} />
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
                return <rect key={sr.key} x={x} y={y1} width={barW} height={Math.max(0.5, y0 - y1)} fill={sr.color} />;
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
    <div style={{ display: 'flex', alignItems: 'center', padding: '14px 22px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ fontSize: 14.5, fontWeight: 600, flex: 1 }}>{title}</div>
      {right && <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{right}</div>}
    </div>
  );
}
function Stat({ title, value }: { title: string; value: string }) {
  return <div><div style={label}>{title}</div><div style={{ fontSize: 15, fontWeight: 500, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div></div>;
}
function Due({ title, sub, value, onView }: { title: string; sub: string; value: number; onView: () => void }) {
  return (
    <div style={{ padding: '16px 22px', borderRight: '1px solid var(--line)' }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>{title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2 }}>{sub}</div>
      <div style={{ fontSize: 17, fontWeight: 600, margin: '8px 0 6px', fontVariantNumeric: 'tabular-nums' }}>{money(value)}</div>
      <button onClick={onView} style={link}>View details</button>
    </div>
  );
}
function Row({ label: text, value, warn, onClick }: { label: string; value: number; warn?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)', cursor: onClick ? 'pointer' : undefined }}>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-2)' }}>{text}</span>
      <strong style={{ fontSize: 14, color: warn ? 'var(--bad)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
    </div>
  );
}

const label: CSSProperties = { fontSize: 11.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-4)' };
const pill: CSSProperties = { fontSize: 12, fontWeight: 500, borderRadius: 7, padding: '3px 9px', marginLeft: 8, verticalAlign: 'middle' };
const primary: CSSProperties = { background: 'var(--accent-grad)', color: 'var(--on-accent)', border: 'none', padding: '10px 18px', borderRadius: 999, fontSize: 13.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' };
const link: CSSProperties = { background: 'none', border: 'none', padding: 0, color: 'var(--accent-ink)', fontWeight: 500, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' };
const select: CSSProperties = { padding: '6px 10px', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: 'var(--surface)' };
