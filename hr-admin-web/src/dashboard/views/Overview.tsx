import type { ReactNode } from 'react';
import { useStore } from '../store';
import { STAT } from '../theme';
import { Avatar, Pill } from '../ui';
import { btn, btnClass, cardTitle, TILE } from '../ds';
import { SuwiOverviewCards } from '../suwi/SuwiNoticed';

/** A linked KPI tile, as the prototype draws one: label, a light number and a round ↗ in the corner. */
function StatCard({
  value,
  label,
  onClick,
}: {
  value: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="ds-tile ds-tile-go" style={{ ...TILE, textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', width: '100%' }}>
      <span style={{ fontSize: 12.5, lineHeight: '18.75px', color: 'var(--ink-2)', fontWeight: 400, paddingRight: 44 }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span aria-hidden className="ds-go" style={{ position: 'absolute', top: 16, right: 16, width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--line-2)', display: 'grid', placeItems: 'center', color: 'var(--ink)' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </button>
  );
}

/** "View all" in a card head: the prototype's small ghost button with an arrow. */
function ViewAll({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className={btnClass('ghost')} style={btn('ghost', 'sm')}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
      View all
    </button>
  );
}

const card = { background: 'var(--surface)', border: '1px solid transparent', borderRadius: 'var(--r-lg)', padding: 20, boxShadow: 'var(--shadow)', minWidth: 0 } as const;
const cardHead = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 } as const;
const li = (last: boolean) => ({ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: last ? 'none' : '1px solid var(--line)' }) as const;

export function Overview() {
  const s = useStore();
  const leavesPending = s.leaves.filter((l) => l.status === 'Pending').length;
  const claims = s.rbs.filter((r) => r.status === 'Pending').length;
  const reviewsPending = s.fbMgrs.reduce((a, m) => a + (m.total - m.done), 0);

  const weekRows = s.leaves.filter((l) => l.status === 'Approved').slice(0, 3);
  const ovOvertime = s.ots.slice().sort((a, b) => b.ord - a.ord).slice(0, 4);

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 20 }}>
        <StatCard value={leavesPending} label="Leaves pending" onClick={() => s.setView('leave')} />
        <StatCard value={claims} label="Claims to review" onClick={() => s.setView('reimbursements')} />
        <StatCard value={reviewsPending} label="Feedbacks pending" onClick={() => s.setView('feedback')} />
      </div>

      {/* Suwi: what it noticed, and today's digest; hidden when there is nothing (or Suwi is off). */}
      <SuwiOverviewCards />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
        {/* On leave this week */}
        <div style={card}>
          <div style={cardHead}>
            <h2 style={cardTitle}>On leave this week</h2>
            <ViewAll onClick={() => s.setView('leave')} />
          </div>
          {weekRows.map((w, i) => (
            <div key={w.id} style={li(i === weekRows.length - 1)}>
              <Avatar name={w.name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>{w.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, lineHeight: 1.5 }}>
                  {w.from === w.to ? w.from : `${w.from} – ${w.to}`} · {w.days}
                </div>
              </div>
              <Pill label={w.type} tone={STAT[w.status]} />
            </div>
          ))}
        </div>

        {/* Overtime requests */}
        <div style={card}>
          <div style={cardHead}>
            <h2 style={cardTitle}>Overtime requests</h2>
            <ViewAll onClick={() => s.setView('overtime')} />
          </div>
          {ovOvertime.map((o, i) => (
            <div key={o.id} onClick={() => s.goOvertimeRow(o.id)} style={{ ...li(i === ovOvertime.length - 1), cursor: 'pointer' }}>
              <Avatar name={o.name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>{o.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, lineHeight: 1.5 }}>
                  {o.duration} · {o.otDate} ({o.day})
                </div>
              </div>
              <Pill label={o.byAdmin ? `${o.status} · by admin` : o.status} tone={STAT[o.status]} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
