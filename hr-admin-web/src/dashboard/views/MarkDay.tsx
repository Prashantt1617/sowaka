// The Company calendar's Correct dialog: the colours each kind of day is drawn
// in, and the dialog that picks what a day was. The same look and flow as the
// employee's Calendar tab (EmployeeProfile keeps its own copy, unchanged).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { CalendarDayDTO, CalendarDayStatus, HrDayStatus } from '../../services/hrms';
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

/** Pick what one day was. Shows what it is now and, when HR already marked it, what it was before. */
export function MarkDay({ day, saving, onClose, onSave }: { day: CalendarDayDTO; saving: boolean; onClose: () => void; onSave: (status: HrDayStatus | null, note: string) => void }) {
  const [status, setStatus] = useState<HrDayStatus>(day.hr && HR_CHOICES.includes(day.status as HrDayStatus) ? (day.status as HrDayStatus) : 'present');
  const [note, setNote] = useState(day.hr?.note ?? '');
  const recorded = day.hr ? CAL_TONE[day.hr.previousStatus] : CAL_TONE[day.status];
  const when = new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
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
              {day.hr && <> · now <strong style={{ color: CAL_TONE[day.status].fg }}>{CAL_TONE[day.status].label}</strong>, marked by {day.hr.setByName ?? 'HR'}</>}
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
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note (optional), e.g. client visit approved by email"
            className="pd-inp" style={{ width: '100%' }} />
        </div>
        <div className="pd-md-f">
          {day.hr && <button type="button" disabled={saving} onClick={() => onSave(null, '')} className="pd-btn ghost" style={{ color: 'var(--bad)', paddingLeft: 0 }}>Remove mark</button>}
          <button type="button" onClick={onClose} className="pd-btn" style={{ marginLeft: 'auto' }}>Cancel</button>
          <button type="button" disabled={saving} onClick={() => onSave(status, note)} className="pd-btn primary">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

