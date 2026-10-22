// Performance › Cycle — the day each monthly review cycle opens, and where that
// currently puts the org. Read-only: moving the boundary re-files which cycle
// new feedback and assignments land in, so it is not something to change while
// a cycle is running.
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { getCompanySettings } from '../../services/hrms';
import type { CompanySettings } from '../../services/hrms';
import { Card, LoadError, Spinner } from '../ui';
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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoading(true);
    setFailed(false);
    getCompanySettings()
      .then(setSettings)
      .catch((error: Error) => { setFailed(true); flash(error.message); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const day = settings?.reviewCycleStartDay;
  const now = new Date();
  const monthA = MONTHS_SHORT[now.getMonth()];
  const monthB = MONTHS_SHORT[(now.getMonth() + 1) % 12];

  return (
    <div style={{ maxWidth: 760 }}>
      <Card style={{ padding: 22, marginBottom: 18 }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>Review cycle</div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
          The day each monthly review cycle opens. A cycle is named after the month it starts in, so
          the cycle called “{monthA} {now.getFullYear()}” runs from this day in {monthA} to the same
          day in {monthB}.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, color: 'var(--ink-2)', fontWeight: 400 }}>Opens on day</span>
          <input
            value={loading ? '' : String(day ?? '')}
            disabled
            aria-label="Day of month the review cycle opens"
            style={{
              width: 74, border: '1px solid var(--line)', borderRadius: 10, padding: '9px 12px',
              fontSize: 14, fontFamily: 'inherit', background: 'var(--surface-2)', color: 'var(--ink-3)',
              fontWeight: 500, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
            }}
          />
          <span style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>
            of each month{day != null && <> — the {day}{ordinal(day)}</>}
          </span>
          {loading && <Spinner />}
          {failed && <LoadError compact text="The review cycle could not be loaded." onRetry={() => setAttempt((n) => n + 1)} />}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 12, lineHeight: 1.5 }}>
          Fixed for now — moving the boundary re-files which cycle new feedback and assignments
          land in, so it is not something to change while a cycle is running.
          {settings && (
            <>
              {' '}Current cycle is <strong style={{ color: 'var(--ink-3)' }}>{periodLabel(settings.currentCycle.period)}</strong>,
              running {cycleRange(settings.currentCycle.start, settings.currentCycle.end)}.
            </>
          )}
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', borderRadius: 12, padding: '14px 16px' }}>
        <span style={{ fontSize: 14, lineHeight: 1.3 }}>ℹ️</span>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          Everything under Performance is scoped to this cycle. A cycle that has opened is frozen:
          KPI wording edits and new assignments land in the <strong>next</strong> one, so a manager
          scoring right now never has the form change underneath them.
        </div>
      </div>
    </div>
  );
}
