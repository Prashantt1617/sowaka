// Shifts, Performance and Payroll › Bulk Assign. Bulk assign runs only
// through Suwi: opening the tab opens Suwi with this section's guide, and the
// page says what to type in case the panel was closed.
import { useEffect } from 'react';
import { useStore, type SuwiBulkArea } from '../store';
import { BULK_GUIDES } from '../suwi/bulkGuide';
import { SuwiOrb } from '../suwi/SuwiPanel';
import * as L from './look';
import './look.css';

function BulkAssign({ area }: { area: SuwiBulkArea }) {
  const s = useStore();
  const guide = BULK_GUIDES[area];
  // Opening the tab is asking for Bulk assign.
  useEffect(() => { s.openSuwiBulk(area); }, [area]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ animation: 'fade .3s ease both', maxWidth: 760 }}>
      <div className="lk-card" style={{ background: 'var(--surface)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SuwiOrb size={36} />
          <div>
            <div style={{ ...L.cardTitle }}>Bulk assign is done through Suwi</div>
            <div style={{ ...L.cardNote, fontSize: 13 }}>{guide.intro}</div>
          </div>
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}><b style={{ color: 'var(--ink)', fontWeight: 600 }}>Who this is for:</b> {guide.whoFor}</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)' }}><b style={{ color: 'var(--ink)', fontWeight: 600 }}>How to type it:</b> say what to assign, then who gets it.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {guide.examples.map((e) => (
            <button key={e} type="button" onClick={() => { s.openSuwiBulk(area); s.setSuwiDraft(e); }} className="suwi-guide-ex">“{e}”</button>
          ))}
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}><b style={{ color: 'var(--ink)', fontWeight: 600 }}>Picking employees:</b> {guide.picking}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{guide.cannot}</div>
        <div><button type="button" className="lk-btn-p" style={L.btnPrimary} onClick={() => s.openSuwiBulk(area)}>Open Bulk assign in Suwi</button></div>
      </div>
    </div>
  );
}

export const ShiftBulkAssign = () => <BulkAssign area="shifts" />;
export const PerformanceBulkAssign = () => <BulkAssign area="performance" />;
export const PayrollBulkAssign = () => <BulkAssign area="payroll" />;
