import type { ReactNode } from 'react';
import { useStore } from '../store';
import { STAT } from '../theme';
import { Avatar, LoadError, LoadingFigure, Pill, SkeletonRows } from '../ui';
import type { LoadState } from '../ui';
import { IconChevronRight } from '../icons';
import { SuwiOverviewCards } from '../suwi/SuwiNoticed';

function StatCard({
  icon,
  iconBg,
  value,
  label,
  onClick,
}: {
  icon: ReactNode;
  iconBg: string;
  value: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        cursor: 'pointer',
        background: 'var(--surface)',
        border: '1px solid transparent',
        borderRadius: 'var(--r-lg)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14, boxShadow: 'var(--shadow)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
        <IconChevronRight />
      </div>
      <div>
        <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-1px', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', fontWeight: 400, marginTop: 5 }}>{label}</div>
      </div>
    </button>
  );
}

const leaveGlyph = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--accent-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
    <path d="M3 9h18M8 2.5v4M16 2.5v4" />
  </svg>
);
const claimGlyph = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--t-olive-i)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z" />
    <path d="M9 8h6M9 12h6" />
  </svg>
);
const feedbackGlyph = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--t-lilac-i)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-9 8.3 8.5 8.5 0 0 1-3.8-.9L3 20.5l1.6-4.2A8.4 8.4 0 0 1 12 3.2a8.38 8.38 0 0 1 9 8.3z" />
  </svg>
);

export function Overview() {
  const s = useStore();
  const leavesPending = s.leaves.filter((l) => l.status === 'Pending').length;
  const claims = s.rbs.filter((r) => r.status === 'Pending').length;
  const reviewsPending = s.fbMgrs.reduce((a, m) => a + (m.total - m.done), 0);

  const weekRows = s.leaves.filter((l) => l.status === 'Approved').slice(0, 3);
  const ovOvertime = s.ots.slice().sort((a, b) => b.ord - a.ord).slice(0, 4);
  const leaveState = s.listState('leaves');
  const claimState = s.listState('claims');
  const fbState = s.listState('feedback');
  const otState = s.listState('overtime');
  // A panel still loading shows rows shaped like its own; a failed one says so.
  const pending = (state: LoadState, rows: number) =>
    state === 'error'
      ? <LoadError compact text="This could not be loaded." onRetry={() => void s.reload()} />
      : <SkeletonRows rows={rows} cols={1} rowHeight={53} pad={0} />;

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 22 }}>
        <StatCard icon={leaveGlyph} iconBg="var(--accent-soft)" value={<LoadingFigure state={leaveState} w={36} h={28}>{leavesPending}</LoadingFigure>} label="Leaves pending" onClick={() => s.setView('leave')} />
        <StatCard icon={claimGlyph} iconBg="var(--t-olive)" value={<LoadingFigure state={claimState} w={36} h={28}>{claims}</LoadingFigure>} label="Claims to review" onClick={() => s.setView('reimbursements')} />
        <StatCard icon={feedbackGlyph} iconBg="var(--t-lilac)" value={<LoadingFigure state={fbState} w={36} h={28}>{reviewsPending}</LoadingFigure>} label="Feedbacks pending" onClick={() => s.setView('feedback')} />
      </div>

      {/* Suwi: what it noticed, and today's digest; hidden when there is nothing (or Suwi is off). */}
      <SuwiOverviewCards />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
        {/* On leave this week */}
        <div style={{ background: 'var(--surface)', border: '1px solid transparent', borderRadius: 'var(--r-lg)', padding: '18px 20px', boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>On leave this week</div>
            <button onClick={() => s.setView('leave')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--accent-ink)' }}>View all</button>
          </div>
          {leaveState !== 'ready' ? pending(leaveState, 3) : weekRows.map((w) => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
              <Avatar name={w.name} size={34} font={12} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{w.name}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400, marginTop: 1 }}>
                  {w.from === w.to ? w.from : `${w.from} – ${w.to}`} · {w.days}
                </div>
              </div>
              <Pill label={w.type} tone={STAT[w.status]} fontSize={11} padding="3px 9px" />
            </div>
          ))}
        </div>

        {/* Overtime requests */}
        <div style={{ background: 'var(--surface)', border: '1px solid transparent', borderRadius: 'var(--r-lg)', padding: '18px 20px', boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Overtime requests</div>
            <button onClick={() => s.setView('overtime')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--accent-ink)' }}>View all</button>
          </div>
          {otState !== 'ready' ? pending(otState, 4) : ovOvertime.map((o) => (
            <div key={o.id} onClick={() => s.goOvertimeRow(o.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
              <Avatar name={o.name} size={34} font={12} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{o.name}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400, marginTop: 1 }}>
                  {o.duration} · {o.otDate} ({o.day})
                </div>
              </div>
              <Pill label={o.byAdmin ? `${o.status} · by admin` : o.status} tone={STAT[o.status]} fontSize={11} padding="3px 9px" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
