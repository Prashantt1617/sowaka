import type { ReactNode } from 'react';
import { useStore } from '../store';
import { LoadingFigure } from '../ui';
import { TILE } from '../ds';
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

export function Overview() {
  const s = useStore();
  // Everyone still at the company: offboarded and terminated people are left out.
  const activeEmployees = s.empRaw.filter((e) => e.lifecycleStatus !== 'offboarded' && e.lifecycleStatus !== 'terminated').length;
  const empState = s.listState('employees');
  const leavesPending = s.leaves.filter((l) => l.status === 'Pending').length;
  const claims = s.rbs.filter((r) => r.status === 'Pending').length;
  const reviewsPending = s.fbMgrs.reduce((a, m) => a + (m.total - m.done), 0);

  const leaveState = s.listState('leaves');
  const claimState = s.listState('claims');
  const fbState = s.listState('feedback');

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        <StatCard value={<LoadingFigure state={empState} w={36} h={28}>{activeEmployees}</LoadingFigure>} label="Active employees" onClick={() => s.setView('employees')} />
        <StatCard value={<LoadingFigure state={leaveState} w={36} h={28}>{leavesPending}</LoadingFigure>} label="Leaves pending" onClick={() => s.setView('leave')} />
        <StatCard value={<LoadingFigure state={claimState} w={36} h={28}>{claims}</LoadingFigure>} label="Claims to review" onClick={() => s.setView('reimbursements')} />
        <StatCard value={<LoadingFigure state={fbState} w={36} h={28}>{reviewsPending}</LoadingFigure>} label="Feedbacks pending" onClick={() => s.setView('feedback')} />
      </div>

      {/* Suwi: what it noticed; hidden when there is nothing (or Suwi is off). */}
      <SuwiOverviewCards />
    </div>
  );
}
