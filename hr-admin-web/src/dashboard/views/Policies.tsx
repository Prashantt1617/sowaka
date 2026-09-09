// Shifts › Policies — request & attendance policies, split across horizontal
// tabs (one respective policy per tab). Prototype.
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { AttendanceCorrection } from './AttendanceCorrection';
import { HalfDayPolicy } from './HalfDayPolicy';
import { LatePolicy } from './LatePolicy';
import { LeaveControls } from './LeaveControls';
import { OvertimePolicy } from './OvertimePolicy';
import { ShiftPolicy } from './ShiftPolicy';

// This is where the shift setup is done. The org saves one policy here and
// every shift inherits it; a Shift Template only adds the working window it
// opens and closes on, and is how the policy gets assigned to people.
const TABS = ['Shift', 'Attendance correction', 'Leaves', 'Overtime', 'Late', 'Half day'] as const;
type Tab = (typeof TABS)[number];

export function Policies() {
  const [tab, setTab] = useState<Tab>('Shift');
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #EBEBEB', marginBottom: 20 }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>{t}</button>
        ))}
      </div>
      {tab === 'Shift' ? <ShiftPolicy /> : tab === 'Attendance correction' ? <AttendanceCorrection /> : tab === 'Leaves' ? <LeaveControls /> : tab === 'Overtime' ? <OvertimePolicy /> : tab === 'Late' ? <LatePolicy /> : tab === 'Half day' ? <HalfDayPolicy /> : <ComingSoon tab={tab} />}
    </div>
  );
}

function ComingSoon({ tab }: { tab: Tab }) {
  return (
    <div style={{ padding: '56px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#484848' }}>{tab} policy</div>
      <div style={{ fontSize: 14, color: '#9197A2', marginTop: 6 }}>We’ll define this together — not built yet.</div>
    </div>
  );
}

function tabStyle(active: boolean): CSSProperties {
  return {
    padding: '10px 18px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    color: active ? '#0571A6' : '#717171',
    borderBottom: `2px solid ${active ? '#0571A6' : 'transparent'}`,
    marginBottom: -1,
  };
}
