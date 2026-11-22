/**
 * Onboarding · Final designs (docs/lifecycle/FINAL-DESIGNS.md §2): a design row's timing is its
 * stage, and only this file turns a stage into dates, rules and steps, so the dashboard, the
 * joiner's app, the teammates' and HR's all place a row the same way.
 *
 * Steps (the teammates' strip, and the joiner's from Day 1): 0 Before Day 1, 1 Day 1, 2 Week 1,
 * 3 Month 1 … 2 + n Month n, 3 + n Confirmed (n = probation months, extensions included).
 */
import type { DesignItem, DesignStage, DueRule, Journey, MeetWith, TeamRole } from '../../models/lifecycle.model';
import { addDaysKey, daysBetween, probationMonthEnd, probationMonthStart } from './dueRules';

const tj = (offset: number): DueRule => ({ anchor: 'tj', offset, unit: 'days' });
const monthStart = (month: DueRule['month']): DueRule => ({ anchor: 'month_start', month, offset: 0, unit: 'days' });
const monthEnd = (month: DueRule['month'], offset = 0): DueRule => ({ anchor: 'month_end', month, offset, unit: 'days' });
const FINALISED: DueRule = { anchor: 'finalised', offset: 0, unit: 'days' };

/** The engine's rules for a row that becomes a journey task (a joiner task or an access). */
export function rulesOfStage(design: Pick<DesignItem, 'section' | 'stage'>): { opensRule: DueRule | null; dueRule: DueRule | null; phase: 'pre_boarding' | 'first_week' | 'probation' } {
  if (design.section === 'access') return { opensRule: FINALISED, dueRule: tj(6), phase: 'first_week' };
  switch (design.stage) {
    case 'pre': return { opensRule: FINALISED, dueRule: tj(-1), phase: 'pre_boarding' };
    case 'd1': return { opensRule: tj(0), dueRule: tj(0), phase: 'first_week' };
    case 'w1': return { opensRule: tj(0), dueRule: tj(6), phase: 'first_week' };
    case 'm1': return { opensRule: tj(7), dueRule: monthEnd(1), phase: 'probation' };
    case 'mid': return { opensRule: monthStart(2), dueRule: monthEnd(2), phase: 'probation' };
    case 'fin': return { opensRule: monthStart('last'), dueRule: monthEnd('last'), phase: 'probation' };
  }
}

/** The step a stage falls on (month: an every-month row's own month). */
export function stepOfStage(stage: DesignStage, months: number, month?: number): number {
  if (month) return 2 + Math.min(Math.max(month, 1), months);
  switch (stage) {
    case 'pre': return 0;
    case 'd1': return 1;
    case 'w1': return 2;
    case 'm1': return 3;
    case 'mid': return Math.min(4, 2 + months);
    case 'fin': return 2 + months;
  }
}

/** The day a row is due (YYYY-MM-DD), from Tj; access rows by the end of Week 1. */
export function dueDayOf(design: Pick<DesignItem, 'section' | 'stage'>, tjKey: string, months: number, month?: number): string {
  if (design.section === 'access') return addDaysKey(tjKey, 6);
  if (month) return probationMonthEnd(tjKey, month);
  switch (design.stage) {
    case 'pre': return addDaysKey(tjKey, -1);
    case 'd1': return tjKey;
    case 'w1': return addDaysKey(tjKey, 6);
    case 'm1': return probationMonthEnd(tjKey, 1);
    case 'mid': return probationMonthEnd(tjKey, Math.min(2, months));
    case 'fin': return probationMonthEnd(tjKey, months);
  }
}

/** The day a row opens (YYYY-MM-DD); before Day 1 rows are open from the offer. */
export function opensDayOf(design: Pick<DesignItem, 'section' | 'stage'>, tjKey: string, months: number, month?: number): string | undefined {
  if (design.section === 'access' || design.stage === 'pre') return undefined;
  // An every-month row: its month's start, and never before Month 1 begins (Tj + 7, "Opens in Month 1").
  if (month) { const start = probationMonthStart(tjKey, month); const m1 = addDaysKey(tjKey, 7); return start < m1 ? m1 : start; }
  switch (design.stage) {
    case 'd1': case 'w1': return tjKey;
    case 'm1': return addDaysKey(tjKey, 7);
    case 'mid': return probationMonthStart(tjKey, Math.min(2, months));
    case 'fin': return probationMonthStart(tjKey, months);
  }
  return undefined;
}

/** A check-in opens two days before its due day ("End of Week 1"); the end of probation one at confirmation. */
export function checkinOpensDay(stage: DesignStage, tjKey: string, months: number): string | null {
  if (stage === 'fin') return null;
  const due = dueDayOf({ section: 'checkin', stage }, tjKey, months);
  return stage === 'd1' ? tjKey : addDaysKey(due, -2);
}

/** Step labels: Before Day 1 ("Joins 1 Dec" before joining, set by the caller), Day 1, Week 1, Month n, Confirmed. */
export function stepLabels(months: number): string[] {
  return ['Before Day 1', 'Day 1', 'Week 1', ...Array.from({ length: months }, (_, i) => `Month ${i + 1}`), 'Confirmed'];
}

/** The joiner's step keys (their strip starts at Day 1). */
export function stepKey(step: number, months: number): string {
  if (step <= 1) return 'd1';
  if (step === 2) return 'w1';
  if (step >= 3 + months) return 'confirmed';
  return `m${step - 2}`;
}

export const STAGE_LABEL = (stage: DesignStage, months: number): string => {
  switch (stage) {
    case 'pre': return 'Before joining';
    case 'd1': return 'Day 1';
    case 'w1': return 'Week 1';
    case 'm1': return 'Month 1';
    case 'mid': return months > 3 ? `Months 2 to ${months - 1}` : 'Month 2';
    case 'fin': return `Month ${months}`;
  }
};

export const ROLE_OF_MEETING: Record<MeetWith, TeamRole> = { hr: 'hr', manager: 'manager', buddy: 'buddy', it: 'it', head_of_department: 'head_of_department' };
export const MEET_ROLE_LABEL: Record<MeetWith, string> = { hr: 'HR', manager: 'Your manager', buddy: 'Your buddy', it: 'IT & admin', head_of_department: 'Head of department' };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (key: string) => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;

/** HR's and IT's due pill: late (red), today (amber), else grey. */
export function dueText(due: string, today: string): { text: string; tone: 'red' | 'amber' | 'grey'; late: boolean } {
  const d = daysBetween(today, due);
  if (d < 0) return { text: d === -1 ? '1 day late' : `${-d} days late`, tone: 'red', late: true };
  if (d === 0) return { text: 'Due today', tone: 'amber', late: false };
  if (d === 1) return { text: 'Due tomorrow', tone: 'grey', late: false };
  if (d <= 5) {
    const at = new Date(`${due}T00:00:00Z`);
    return { text: `Due ${WEEKDAYS[at.getUTCDay()]}`, tone: 'grey', late: false };
  }
  return { text: `Due ${shortDay(due)}`, tone: 'grey', late: false };
}

/** Rows a journey's probation length leaves out: none (every stage maps to a step), kept for symmetry with stepOfRule. */
export const monthsOfJourney = (j: Pick<Journey, 'probation' | 'templateSnapshot'>): number =>
  (j.probation?.months ?? j.templateSnapshot?.settings?.probationMonths ?? 6) + (j.probation?.extendedBy ?? 0);
