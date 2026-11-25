/**
 * The days a payslip did not pay, told apart: loss of pay (absences, half
 * days, leave without pay, the template's rules, or the figure HR typed) and
 * the days the person was not employed (before joining, after leaving).
 *
 * The run counts both in `inputs.lopDays` and pays them the same way (a day
 * not paid is a day not paid), so the amounts never change here; only what a
 * payslip, a screen or a report calls them. Old payslips work as stored: the
 * run has always written the not-employed days as their own
 * attendanceDeductions lines ('Before joining', 'After leaving').
 */

export const BEFORE_JOINING = 'Before joining';
export const AFTER_LEAVING = 'After leaving';

/** What these helpers read of a payslip's inputs. */
export interface PayslipDayInputs {
  workingDays?: number;
  lopDays?: number;
  lopEnteredByHr?: boolean;
  attendanceDeductions?: { label: string; days: number }[];
}

/** What they read of a payslip: its earnings (full and paid) and its inputs. */
export interface PayslipForDays {
  earnings: { fullPaise?: number; paidPaise?: number }[];
  inputs?: PayslipDayInputs | null;
}

const linesDays = (inputs: PayslipDayInputs | null | undefined, label: string) =>
  (inputs?.attendanceDeductions ?? []).filter((l) => l.label === label).reduce((t, l) => t + (l.days > 0 ? l.days : 0), 0);

/**
 * The days before joining and after leaving in this payslip's not-paid days.
 * None when HR typed the loss of pay: their figure is what the slip says.
 */
export function notEmployedOf(inputs: PayslipDayInputs | null | undefined): { beforeJoining: number; afterLeaving: number; days: number } {
  // HR's typed figure counts too (a company paying joiners by the calendar month types it): of the
  // days it leaves unpaid, those up to the days before joining / after leaving are not employed, the rest LOP.
  if (!inputs) return { beforeJoining: 0, afterLeaving: 0, days: 0 };
  const lop = Math.max(0, inputs.lopDays ?? 0);
  // Never more than the days the run did not pay (it caps them at the base days).
  const beforeJoining = Math.min(linesDays(inputs, BEFORE_JOINING), lop);
  const afterLeaving = Math.min(linesDays(inputs, AFTER_LEAVING), lop - beforeJoining);
  return { beforeJoining, afterLeaving, days: beforeJoining + afterLeaving };
}

/** Days not paid because the person was not employed then (before joining, after leaving). */
export function notEmployedDaysOf(inputs: PayslipDayInputs | null | undefined): number {
  return notEmployedOf(inputs).days;
}

/**
 * The days the person was employed in the period: its base days less the days
 * not employed. What paid days are out of (16 for someone who joined on 16 Oct),
 * never the whole month.
 */
export function employedDaysOf(inputs: PayslipDayInputs | null | undefined): number {
  return Math.max(0, (inputs?.workingDays ?? 0) - notEmployedDaysOf(inputs));
}

/** Real loss of pay: the days not paid less the days not employed. */
export function lossOfPayDaysOf(inputs: PayslipDayInputs | null | undefined): number {
  return Math.max(0, (inputs?.lopDays ?? 0) - notEmployedDaysOf(inputs));
}

/** What every not-paid day cost together: full-month earnings less those paid. */
export function unpaidPaiseOf(slip: PayslipForDays): number {
  const full = slip.earnings.reduce((t, e) => t + (e.fullPaise ?? 0), 0);
  const paid = slip.earnings.reduce((t, e) => t + (e.paidPaise ?? 0), 0);
  return Math.max(0, full - paid);
}

/** The part of the unpaid amount for the days not employed, in whole paise, in proportion to the days. */
export function notEmployedPaiseOf(slip: PayslipForDays): number {
  const total = unpaidPaiseOf(slip);
  const lop = slip.inputs?.lopDays ?? 0;
  const days = notEmployedDaysOf(slip.inputs);
  if (total <= 0 || lop <= 0 || days <= 0) return 0;
  if (days >= lop) return total;
  return Math.round((total * days) / lop);
}

/** The rest: the real loss of pay's amount. With notEmployedPaiseOf it adds up to unpaidPaiseOf. */
export function lossOfPayPaiseOf(slip: PayslipForDays): number {
  return unpaidPaiseOf(slip) - notEmployedPaiseOf(slip);
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A Date or an ISO day → "16 Oct"; '' when missing. */
export function shortDayLabel(value: Date | string | null | undefined): string {
  if (!value) return '';
  const iso = value instanceof Date ? (Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)) : String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  return `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/**
 * The not-employed days in words, for a payslip line or a report cell:
 * "15 days before joining (joined 16 Oct)", "6 days after leaving (left 25 Oct)".
 * `leftOn` is known on new runs only (inputs.leftOn); older ones say no date.
 */
export function notEmployedWords(inputs: PayslipDayInputs | null | undefined, joiningDate?: Date | string | null, leftOn?: string | null): string {
  const n = notEmployedOf(inputs);
  const parts: string[] = [];
  const joined = shortDayLabel(joiningDate);
  const left = shortDayLabel(leftOn);
  if (n.beforeJoining > 0) parts.push(`${days(n.beforeJoining)} before joining${joined ? ` (joined ${joined})` : ''}`);
  if (n.afterLeaving > 0) parts.push(`${days(n.afterLeaving)} after leaving${left ? ` (left ${left})` : ''}`);
  return parts.join(' · ');
}

/** "joined 16 Oct" / "left 25 Oct" / both, for a line's name; '' when neither is known. */
export function notEmployedWhen(inputs: PayslipDayInputs | null | undefined, joiningDate?: Date | string | null, leftOn?: string | null): string {
  const n = notEmployedOf(inputs);
  const joined = shortDayLabel(joiningDate);
  const left = shortDayLabel(leftOn);
  return [n.beforeJoining > 0 && joined ? `joined ${joined}` : '', n.afterLeaving > 0 && left ? `left ${left}` : ''].filter(Boolean).join(', ');
}

// —— A period paid on more than one salary, and arrears (salary revisions, 25 Nov 2026) ——
const inrYear = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')} a year`;
const dayList = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** "26 Oct – 17 Nov on ₹12,00,000 a year; 18 Nov – 25 Nov on ₹15,00,000 a year"; '' for one salary. */
export function salarySplitText(inputs: { salarySegments?: { from: string; to: string; annualCtcPaise: number; lopDays: number }[] } | null | undefined): string {
  const parts = inputs?.salarySegments ?? [];
  if (parts.length < 2) return '';
  return parts.map((p) => `${shortDayLabel(p.from)} – ${shortDayLabel(p.to)} on ${inrYear(p.annualCtcPaise)}${p.lopDays > 0 ? ` (${p.lopDays} LOP)` : ''}`).join('; ');
}

/** One arrears item in words: which days, how many paid, old vs new. */
export function arrearsItemText(item: { from: string; to: string; days: number; paidDays: number; lopDays: number; previousCtcPaise: number; annualCtcPaise: number; notInSowaka?: true }): string {
  if (item.notInSowaka) return `${shortDayLabel(item.from)} – ${shortDayLabel(item.to)} was not paid in Sowaka: enter any arrears for it by hand`;
  return `${shortDayLabel(item.from)} – ${shortDayLabel(item.to)}: ${dayList(item.days)}${item.lopDays > 0 ? `, ${item.lopDays} LOP` : ''}, paid on ${inrYear(item.previousCtcPaise)}, revised to ${inrYear(item.annualCtcPaise)}`;
}
