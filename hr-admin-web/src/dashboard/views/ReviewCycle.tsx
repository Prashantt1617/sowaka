// Performance › Cycle — the day each monthly review cycle opens, and where that
// currently puts the org. Read-only: moving the boundary re-files which cycle
// new feedback and assignments land in, so it is not something to change while
// a cycle is running.
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { getCompanySettings } from '../../services/hrms';
import type { CompanySettings } from '../../services/hrms';
import { Card } from '../ui';
import { cycleRange, periodLabel } from '../period';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ordinal(d: number): string {
  if (d % 100 >= 11 && d % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][d % 10] ?? 'th';
}

export function ReviewCycle() {
  const { flash } = useStore();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCompanySettings()
      .then(setSettings)
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const day = settings?.reviewCycleStartDay;
  const now = new Date();
  const monthA = MONTHS_SHORT[now.getMonth()];
  const monthB = MONTHS_SHORT[(now.getMonth() + 1) % 12];

  return (
    <div style={{ maxWidth: 760 }}>
      <Card style={{ padding: 22, marginBottom: 18 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>Review cycle</div>
        <div style={{ fontSize: 14, color: '#717171', marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
          The day each monthly review cycle opens. A cycle is named after the month it starts in, so
          the cycle called “{monthA} {now.getFullYear()}” runs from this day in {monthA} to the same
          day in {monthB}.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16, color: '#484848', fontWeight: 600 }}>Opens on day</span>
          <input
            value={loading ? '' : String(day ?? '')}
            disabled
            aria-label="Day of month the review cycle opens"
            style={{
              width: 74, border: '1px solid #EBEBEB', borderRadius: 10, padding: '9px 12px',
              fontSize: 16, fontFamily: 'inherit', background: '#F7F7F9', color: '#717171',
              fontWeight: 700, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
            }}
          />
          <span style={{ fontSize: 15, color: '#717171' }}>
            of each month{day != null && <> — the {day}{ordinal(day)}</>}
          </span>
        </div>
        <div style={{ fontSize: 13, color: '#9197A2', marginTop: 12, lineHeight: 1.5 }}>
          Fixed for now — moving the boundary re-files which cycle new feedback and assignments
          land in, so it is not something to change while a cycle is running.
          {settings && (
            <>
              {' '}Current cycle is <strong style={{ color: '#717171' }}>{periodLabel(settings.currentCycle.period)}</strong>,
              running {cycleRange(settings.currentCycle.start, settings.currentCycle.end)}.
            </>
          )}
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 12, padding: '14px 16px' }}>
        <span style={{ fontSize: 16, lineHeight: 1.3 }}>ℹ️</span>
        <div style={{ fontSize: 14, color: '#3A5A6B', lineHeight: 1.55 }}>
          Everything under Performance is scoped to this cycle. A cycle that has opened is frozen:
          KPI wording edits and new assignments land in the <strong>next</strong> one, so a manager
          scoring right now never has the form change underneath them.
        </div>
      </div>
    </div>
  );
}
