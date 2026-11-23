// The days a payslip did not pay, told apart: loss of pay, and the days the
// person was not employed (before joining, after leaving). The run counts both
// in inputs.lopDays and pays them the same way; only what they are called
// differs. Mirrors backend/src/services/payslipDays.ts, and works on old
// payslips as stored (the run has always written the not-employed days as
// 'Before joining' / 'After leaving' attendanceDeductions lines).
import { type PayslipDTO } from '../services/payroll';

export const BEFORE_JOINING = 'Before joining';
export const AFTER_LEAVING = 'After leaving';

type Inputs = (Pick<PayslipDTO['inputs'], 'lopDays' | 'lopEnteredByHr' | 'attendanceDeductions'> & { workingDays?: number }) | null | undefined;
type SlipForDays = { earnings: { fullPaise: number; paidPaise: number }[]; inputs: Inputs };

const linesDays = (inputs: Inputs, label: string) =>
  (inputs?.attendanceDeductions ?? []).filter((l) => l.label === label).reduce((t, l) => t + (l.days > 0 ? l.days : 0), 0);

/** The days before joining and after leaving; none when HR typed the loss of pay. */
export function notEmployedOf(inputs: Inputs): { beforeJoining: number; afterLeaving: number; days: number } {
  // HR's typed figure counts too (a company paying joiners by the calendar month types it): of the
  // days it leaves unpaid, those up to the days before joining / after leaving are not employed, the rest LOP.
  if (!inputs) return { beforeJoining: 0, afterLeaving: 0, days: 0 };
  const lop = Math.max(0, inputs.lopDays ?? 0);
  const beforeJoining = Math.min(linesDays(inputs, BEFORE_JOINING), lop);
  const afterLeaving = Math.min(linesDays(inputs, AFTER_LEAVING), lop - beforeJoining);
  return { beforeJoining, afterLeaving, days: beforeJoining + afterLeaving };
}

/** The days employed in the period: what paid days are out of (16 for a 16 Oct joiner), never the whole month. */
export const employedDaysOf = (inputs: Inputs) => Math.max(0, (inputs?.workingDays ?? 0) - notEmployedOf(inputs).days);

/** Real loss of pay: the days not paid less the days not employed. */
export const lossOfPayDaysOf = (inputs: Inputs) => Math.max(0, (inputs?.lopDays ?? 0) - notEmployedOf(inputs).days);

/** Whether an attendanceDeductions line is a not-employed one (and so not loss of pay). */
export const isNotEmployedLine = (inputs: Inputs, l: { label: string }) =>
  notEmployedOf(inputs).days > 0 && (l.label === BEFORE_JOINING || l.label === AFTER_LEAVING);

const unpaidPaiseOf = (slip: SlipForDays) => Math.max(0, slip.earnings.reduce((t, e) => t + (e.fullPaise - e.paidPaise), 0));

/** The unpaid amount for the days not employed, in whole paise, in proportion to the days. */
export function notEmployedPaiseOf(slip: SlipForDays): number {
  const total = unpaidPaiseOf(slip);
  const lop = slip.inputs?.lopDays ?? 0;
  const days = notEmployedOf(slip.inputs).days;
  if (total <= 0 || lop <= 0 || days <= 0) return 0;
  if (days >= lop) return total;
  return Math.round((total * days) / lop);
}

/** The real loss of pay's amount; with notEmployedPaiseOf it adds up to what the earnings lost. */
export const lossOfPayPaiseOf = (slip: SlipForDays) => unpaidPaiseOf(slip) - notEmployedPaiseOf(slip);

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-16" → "16 Oct"; '' when missing. */
export const shortDay = (iso?: string | null) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1]}` : '';

const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** "Joined 16 Oct", "Left 25 Oct" (the day count when the date is not known); '' when neither. */
export function notEmployedNote(slip: { joiningDate?: string; inputs: Inputs & { leftOn?: string } }): string {
  const n = notEmployedOf(slip.inputs);
  const parts: string[] = [];
  if (n.beforeJoining > 0) parts.push(slip.joiningDate ? `Joined ${shortDay(slip.joiningDate)}` : `${dayWord(n.beforeJoining)} before joining`);
  if (n.afterLeaving > 0) parts.push(slip.inputs?.leftOn ? `Left ${shortDay(slip.inputs.leftOn)}` : `${dayWord(n.afterLeaving)} after leaving`);
  return parts.join(' · ');
}
