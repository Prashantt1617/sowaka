// How a day comes out — the grid HR fills in for an org policy and for a shift
// template alike. One component, because the two are the same question asked at
// two scopes: a template answers it for the people it covers, the org policy for
// everyone else, and they must not drift apart in wording or in behaviour.
import type { CSSProperties, ReactNode } from 'react';
import type { CorrectionOutcome, DayMark } from '../../services/hrms';

/** The four ways a day can land, in the order the punches happen. */
export const TRIGGERS = [
  'Missing punch-in',
  'Missing punch-out',
  'Both punches missing',
  'Both punches present',
];

/** What a day is marked as when a punch never arrived. */
export const MARK_OPTIONS: DayMark[] = ['Absent', 'Half Day', 'Present'];

/** What an absent day may be asked to become. */
export const OUTCOMES: CorrectionOutcome[] = ['Full day', 'Half day', 'Leave'];

const YES_NO = ['Yes', 'No'] as const;

/** Stored values keep their meaning; the labels say it in day terms. */
export const markLabel = (mark: DayMark) =>
  mark === 'Present' ? 'Full day' : mark === 'Half Day' ? 'Half day' : mark;

export type DayOutcomeGridProps = {
  /** One punch makes the day, so there is no punch-out to be missing. */
  singlePunch: boolean;
  /** Nobody punches at all, so there is nothing here to decide. */
  autoPresent: boolean;
  missingPunchIn: DayMark;
  missingPunchOut: DayMark;
  missingBoth: DayMark;
  onMissingPunchIn: (value: DayMark) => void;
  onMissingPunchOut: (value: DayMark) => void;
  onMissingBoth: (value: DayMark) => void;
  /** Which of the four outcomes an employee may raise a correction against. */
  triggers: Record<string, boolean>;
  onTrigger: (trigger: string, allowed: boolean) => void;
  absentOutcomes: CorrectionOutcome[];
  onToggleOutcome: (outcome: CorrectionOutcome) => void;
  /** The thresholds a complete day is graded against, for the note. */
  minHalfDayHours: number | null;
  minFullDayHours: number | null;
  /** Where the thresholds are edited, named in the note. */
  thresholdsLocation: string;
};

export function DayOutcomeGrid({
  singlePunch,
  autoPresent,
  missingPunchIn,
  missingPunchOut,
  missingBoth,
  onMissingPunchIn,
  onMissingPunchOut,
  onMissingBoth,
  triggers,
  onTrigger,
  absentOutcomes,
  onToggleOutcome,
  minHalfDayHours,
  minFullDayHours,
  thresholdsLocation,
}: DayOutcomeGridProps) {
  if (autoPresent) {
    return (
      <div style={{ padding: '18px 22px' }}>
        <div style={fixedValue}>
          <span>Full day</span>
          <span style={fixedTag}>marked automatically</span>
        </div>
        <div style={note}>
          With auto punch there are no punches to grade and none to be missing,
          so there is nothing here to configure. A day that should have been
          leave or an absence is adjusted by HR, or by the employee raising a
          correction from their calendar.
        </div>
      </div>
    );
  }

  const cases: {
    trigger: string;
    hasIn: boolean;
    hasOut: boolean;
    value?: DayMark;
    set?: (value: DayMark) => void;
  }[] = singlePunch
    ? [
        { trigger: 'Both punches missing', hasIn: false, hasOut: false, value: missingBoth, set: onMissingBoth },
        { trigger: 'Both punches present', hasIn: true, hasOut: true },
      ]
    : [
        { trigger: 'Missing punch-in', hasIn: false, hasOut: true, value: missingPunchIn, set: onMissingPunchIn },
        { trigger: 'Missing punch-out', hasIn: true, hasOut: false, value: missingPunchOut, set: onMissingPunchOut },
        { trigger: 'Both punches missing', hasIn: false, hasOut: false, value: missingBoth, set: onMissingBoth },
        { trigger: 'Both punches present', hasIn: true, hasOut: true },
      ];

  /** What this row's day may be asked to become. */
  const outcomesFor = (row: (typeof cases)[number]) => {
    if (!triggers[row.trigger]) return <span style={muted}>Not correctable</span>;
    if (row.trigger === 'Both punches present') {
      // Graded on hours, so the outcome follows the grade: a half day is
      // argued up to a full day, a full day only down.
      return <span style={muted}>Depends how the day is graded</span>;
    }
    if (row.value === 'Half Day') {
      return (
        <div style={fixedValue}>
          <span>Full day</span>
          <span style={fixedTag}>fixed</span>
        </div>
      );
    }
    if (row.value === 'Absent') {
      return <Chips options={OUTCOMES} selected={absentOutcomes} onToggle={onToggleOutcome} />;
    }
    // Marked a full day already, so there is nothing to argue up to.
    return <span style={muted}>Half day or leave</span>;
  };

  return (
    <div style={{ padding: '4px 22px 18px', overflowX: 'auto' }}>
      <table style={caseTable}>
        <thead>
          <tr>
            <Th center width={100}>{singlePunch ? 'Punch' : 'Punch in'}</Th>
            {!singlePunch && <Th center width={100}>Punch out</Th>}
            <Th>Marked as</Th>
            <Th width={150}>Correction allowed?</Th>
            <Th width={230}>Can be corrected to</Th>
          </tr>
        </thead>
        <tbody>
          {cases.map((row) => (
            <tr key={row.trigger}>
              <Td center><Mark on={row.hasIn} /></Td>
              {!singlePunch && <Td center><Mark on={row.hasOut} /></Td>}
              <Td>
                {row.trigger === 'Both punches present' ? (
                  // Not a choice: a complete day is half or full on the hours
                  // worked. With a single punch there are no hours to grade,
                  // so it is a full day outright.
                  <div style={fixedValue}>
                    <span>{singlePunch ? 'Full day' : 'Half day or full day'}</span>
                    <span style={fixedTag}>{singlePunch ? 'punch recorded' : 'by hours worked'}</span>
                  </div>
                ) : (
                  <Select value={row.value!} onChange={row.set!} options={MARK_OPTIONS} render={markLabel} />
                )}
              </Td>
              <Td>
                <Select
                  value={triggers[row.trigger] ? 'Yes' : 'No'}
                  onChange={(value) => onTrigger(row.trigger, value === 'Yes')}
                  options={YES_NO}
                />
              </Td>
              <Td>{outcomesFor(row)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={note}>
        {singlePunch ? (
          'A recorded punch is a full day: with nothing to measure against, there are no hours to grade.'
        ) : minFullDayHours == null || minHalfDayHours == null ? (
          `A day with both punches is graded on the hours worked, against the thresholds in ${thresholdsLocation}.`
        ) : (
          <>
            A day with both punches is graded on the hours worked, against{' '}
            {thresholdsLocation}: <strong>{minFullDayHours}h</strong> or more is a full day,{' '}
            <strong>{minHalfDayHours}h</strong> up to {minFullDayHours}h is a half day, and anything
            shorter is flagged for correction.
          </>
        )}{' '}
        A half day can only be raised as a full day — there is nothing else it could be. What an
        absent day may become is yours to choose, and every absent row shares that choice.
      </div>
    </div>
  );
}

/** Multi-select as toggles: all of them are on offer, any number can be on. */
function Chips({ options, selected, onToggle }: {
  options: readonly CorrectionOutcome[];
  selected: CorrectionOutcome[];
  onToggle: (value: CorrectionOutcome) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((option) => {
        const on = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(option)}
            style={{
              padding: '6px 12px', borderRadius: 20, fontSize: 13.5, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${on ? '#0571A6' : '#EBEBEB'}`,
              background: on ? '#E6F1F8' : '#fff',
              color: on ? '#0571A6' : '#717171',
            }}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function Select<T extends string>({ value, onChange, options, render }: {
  value: T; onChange: (v: T) => void; options: readonly T[]; render?: (v: T) => string;
}) {
  return (
    <select value={value} onChange={(ev) => onChange(ev.target.value as T)} style={selectStyle}>
      {options.map((o) => <option key={o} value={o}>{render ? render(o) : o}</option>)}
    </select>
  );
}

/** A tick or a cross for whether that punch is there in this case. */
function Mark({ on }: { on: boolean }) {
  return on ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4F7A52" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label="present">
      <path d="M4 12.5 9.5 18 20 6.5" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C4382E" strokeWidth="3" strokeLinecap="round" aria-label="missing">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function Th({ children, center, width }: { children: ReactNode; center?: boolean; width?: number }) {
  return (
    <th style={{
      textAlign: center ? 'center' : 'left', width,
      fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171',
      fontWeight: 700, padding: '11px 12px', borderBottom: '1px solid #EBEBEB',
    }}>{children}</th>
  );
}

function Td({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <td style={{
      padding: '12px', borderBottom: '1px solid #F0F0F2',
      textAlign: center ? 'center' : 'left', verticalAlign: 'middle',
    }}>{children}</td>
  );
}

const selectStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222', cursor: 'pointer' };
const fixedValue: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, background: '#F7F7F9', color: '#717171' };
const fixedTag: CSSProperties = { marginLeft: 'auto', fontSize: 11.5, fontWeight: 800, letterSpacing: '.02em', color: '#717171', background: '#EDEDF0', borderRadius: 20, padding: '2px 9px', whiteSpace: 'nowrap' };
const note: CSSProperties = { marginTop: 16, fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '11px 14px', lineHeight: 1.55 };
const muted: CSSProperties = { fontSize: 13.5, color: '#9A9AA5' };
const caseTable: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 15 };
