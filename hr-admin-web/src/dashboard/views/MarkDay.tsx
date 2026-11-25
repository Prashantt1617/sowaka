// The Company calendar's Correct dialog: the colours each kind of day is drawn
// in, and the dialog that picks what a day was. The same look and flow as the
// employee's Calendar tab (EmployeeProfile keeps its own copy, unchanged).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getEmployeeLeaveBalance } from '../../services/hrms';
import type { CalendarDayDTO, CalendarDayStatus, HrDayStatus, LeaveBalanceItemDTO } from '../../services/hrms';
import './people.css';

// —— Calendar: one month, every day named ————————————————————————————————
export const CAL_TONE: Record<CalendarDayStatus, { bg: string; fg: string; label: string }> = {
  present: { bg: 'var(--ok-bg)', fg: 'var(--ok)', label: 'Present' },
  half_day: { bg: 'var(--warn-bg)', fg: 'var(--warn)', label: 'Half day' },
  missed_punch: { bg: 'var(--t-peach)', fg: 'var(--warn)', label: 'Missed punch' },
  absent: { bg: 'var(--bad-bg)', fg: 'var(--bad)', label: 'Absent' },
  on_leave: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)', label: 'On leave' },
  // Its own day: unpaid, so neither leave nor an absence.
  unpaid_leave: { bg: 'var(--t-plum)', fg: 'var(--t-plum-i)', label: 'Leave without pay' },
  week_off: { bg: 'var(--surface-2)', fg: 'var(--ink-4)', label: 'Week off' },
  holiday: { bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)', label: 'Holiday' },
  upcoming: { bg: 'var(--surface)', fg: 'var(--ink-4)', label: 'Upcoming' },
  // Not theirs yet: an empty day, like one still to come.
  before_joining: { bg: 'var(--surface)', fg: 'var(--ink-4)', label: 'Before joining' },
};

// What HR can mark a day as, in the order the dialog offers them.
export const HR_CHOICES: HrDayStatus[] = ['present', 'half_day', 'absent', 'on_leave', 'week_off', 'holiday'];

/**
 * Pick what one day was. Shows what it is now and, when HR already marked it, what it was before.
 * "On leave" asks which leave the day comes out of (24 Nov 2026): the server takes one day from that
 * balance, so the picker shows what is left of each type. A day an approved leave already covers needs no
 * choice. Used by the Company calendar and the employee's Calendar tab alike.
 */
export function MarkDay({ day, userId, saving, onClose, onSave }: { day: CalendarDayDTO; userId: string; saving: boolean; onClose: () => void; onSave: (status: HrDayStatus | null, note: string, leaveType?: string) => void }) {
  const [status, setStatus] = useState<HrDayStatus>(day.hr && HR_CHOICES.includes(day.status as HrDayStatus) ? (day.status as HrDayStatus) : 'present');
  const [note, setNote] = useState(day.hr?.note ?? '');
  const recorded = day.hr ? CAL_TONE[day.hr.previousStatus] : CAL_TONE[day.status];
  const when = new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  // Already on approved leave that day (their own request): left alone it takes nothing more; picking another
  // type swaps it (25 Nov 2026: HR could not turn an approved leave without pay into casual leave from here).
  const covered = !day.hr && (day.status === 'on_leave' || day.status === 'unpaid_leave');
  const askType = status === 'on_leave';
  const [types, setTypes] = useState<LeaveBalanceItemDTO[] | null>(null);
  const [typeError, setTypeError] = useState('');
  const [leaveType, setLeaveType] = useState('');
  useEffect(() => {
    if (!askType || types) return;
    getEmployeeLeaveBalance(userId)
      .then((b) => {
        setTypes(b.types);
        const kept = b.types.find((t) => t.name === day.hr?.leaveType || t.key === day.hr?.leaveType);
        if (kept) setLeaveType(kept.key);
      })
      .catch(() => setTypeError('Could not load their leave balance'));
  }, [askType, types, userId, day.hr?.leaveType]);
  const usable = (t: LeaveBalanceItemDTO) => t.unpaid || t.unlimited || t.remaining >= 1 || t.name === day.hr?.leaveType;
  const canSave = !askType || covered || Boolean(leaveType);
  // On the page body, not inside the calendar: the page fades in with a transform, which would pin a
  // fixed overlay to the top of the page instead of the screen.
  return createPortal(
    <div className="pd-scrim">
      <div className="bg" onClick={onClose} />
      <div className="pd-modal" style={{ width: 'min(440px, 100%)' }}>
        <div className="pd-md-h">
          <div>
            <h3>{when}</h3>
            <div className="pd-md-sub">
              Recorded as <strong style={{ color: recorded.fg }}>{recorded.label}</strong>
              {day.hr && <> · now <strong style={{ color: CAL_TONE[day.status].fg }}>{CAL_TONE[day.status].label}</strong>{day.hr.leaveType ? ` (${day.hr.leaveType})` : ''}, marked by {day.hr.setByName ?? 'HR'}</>}
            </div>
          </div>
        </div>
        <div className="pd-md-b">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {HR_CHOICES.map((choice) => {
              const tone = CAL_TONE[choice];
              const on = status === choice;
              return (
                <button key={choice} type="button" onClick={() => setStatus(choice)}
                  style={{ border: `1.5px solid ${on ? tone.fg : 'transparent'}`, background: tone.bg, color: tone.fg, borderRadius: 999, height: 40, padding: '0 6px', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {tone.label}
                </button>
              );
            })}
          </div>
          {status === 'on_leave' && covered && (
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Already on approved leave that day{day.label ? ` (${day.label})` : ''}. Leave it as it is, or pick another type below: their request is cancelled and the day comes out of the type you pick.</div>
          )}
          {askType && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>Which leave? <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>One day is taken from this balance.</span></div>
              {typeError ? <div style={{ fontSize: 12.5, color: 'var(--bad)' }}>{typeError}</div>
                : !types ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Loading their leave balance…</div>
                : (
                  <div role="radiogroup" aria-label="Leave type" style={{ display: 'grid', gap: 6 }}>
                    {types.map((t) => {
                      const ok = usable(t);
                      const on = leaveType === t.key;
                      return (
                        <button key={t.key} type="button" role="radio" aria-checked={on} disabled={!ok} onClick={() => setLeaveType(t.key)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--accent-soft)' : 'var(--surface)', color: ok ? 'var(--ink)' : 'var(--ink-4)', cursor: ok ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 13, textAlign: 'left' }}>
                          <span>{t.name}</span>
                          <span style={{ fontSize: 12, color: ok ? 'var(--ink-3)' : 'var(--ink-4)' }}>{t.unpaid || t.unlimited ? 'Unpaid · docked from pay' : `${t.remaining} left of ${t.total}`}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
            </div>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note (optional), e.g. client visit approved by email"
            className="pd-inp" style={{ width: '100%' }} />
        </div>
        <div className="pd-md-f">
          {day.hr && <button type="button" disabled={saving} onClick={() => onSave(null, '')} className="pd-btn ghost" style={{ color: 'var(--bad)', paddingLeft: 0 }}>Remove mark</button>}
          <button type="button" onClick={onClose} className="pd-btn" style={{ marginLeft: 'auto' }}>Cancel</button>
          <button type="button" disabled={saving || !canSave} title={canSave ? undefined : 'Pick which leave'} onClick={() => onSave(status, note, askType && leaveType ? leaveType : undefined)} className="pd-btn primary">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
