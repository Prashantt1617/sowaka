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
import * as L from './look';

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
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.65fr) minmax(0,1fr)', gap: 20, alignItems: 'stretch' }}>
      <Card style={{ padding: 20 }}>
        <div style={L.cardTitle}>Review cycle</div>
        <div style={{ ...L.cardNote, marginTop: 2, marginBottom: 16, lineHeight: 1.5 }}>
          The day each monthly review cycle opens. A cycle is named after the month it starts in, so
          the cycle called “{monthA} {now.getFullYear()}” runs from this day in {monthA} to the same
          day in {monthB}.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 400 }}>Opens on day</span>
          <input
            value={loading ? '' : String(day ?? '')}
            disabled
            aria-label="Day of month the review cycle opens"
            style={{
              width: 80, height: 42, border: '1px solid var(--line-2)', borderRadius: 12, padding: '0 12px',
              fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)',
              fontWeight: 400, textAlign: 'left', fontVariantNumeric: 'tabular-nums',
            }}
          />
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            of each month{day != null && <> — the {day}{ordinal(day)}</>}
          </span>
          {loading && <Spinner />}
          {failed && <LoadError compact text="The review cycle could not be loaded." onRetry={() => setAttempt((n) => n + 1)} />}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 12, lineHeight: 1.5 }}>
          Fixed for now — moving the boundary re-files which cycle new feedback and assignments
          land in, so it is not something to change while a cycle is running.
          {settings && (
            <>
              {' '}Current cycle is <strong style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{periodLabel(settings.currentCycle.period)}</strong>,
              running {cycleRange(settings.currentCycle.start, settings.currentCycle.end)}.
            </>
          )}
        </div>
      </Card>

      <Card style={{ padding: 20 }}>
      <div style={L.note}>
        <span style={{ fontSize: 13, lineHeight: 1.5 }}>ℹ️</span>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Everything under Performance is scoped to this cycle. A cycle that has opened is frozen:
          KPI wording edits and new assignments land in the <strong>next</strong> one, so a manager
          scoring right now never has the form change underneath them.
        </div>
      </div>
      </Card>
    </div>
  );
}
