/**
 * The step a probation card leads with (H1c): Month 1 and Months 2–5 lead with this month's own
 * step (its check-in, even before it opens, or an open pulse survey), Confirmed with the
 * confirmation letter. A leftover from week 1 ("Set up laptop and login") never leads these cards;
 * it follows the stage's step. The final month already leads with the confirmation discussion
 * (board.ts waitingOnOf). Kept apart from board.ts so the board's own reads stay as they are.
 */
import type { Journey, JourneyTask, OnboardingBoardColumn, SystemTaskKey } from '../../models/lifecycle.model';
import { ACTIVE_STATUSES, currentMonth, isCounted, taskLate } from './engine';
import { companyTimeZone, keyOfDay, todayKey } from './dueRules';
import { nudgeTarget } from './nudges';
import type { WaitingOn } from './board';

// This month's steps. The card leads with the check-in (H1c "Month-1 check-in · Manager · Fri 5 Dec"),
// even before it opens in the month's last days; an open pulse survey comes before a check-in that has
// not opened yet; after the check-in, the month's review; goals only when nothing else is left.
const MONTH_STEPS: SystemTaskKey[] = ['monthly_goals', 'monthly_checkin', 'pulse_survey', 'monthly_review'];
function rank(t: JourneyTask): number {
  const open = ACTIVE_STATUSES.includes(t.status);
  switch (t.systemKey) {
    case 'monthly_checkin': return open ? 5 : 3;
    case 'pulse_survey': return open ? 4 : 0;
    case 'monthly_review': return 2;
    default: return 1;
  }
}
const MONTH_TITLE: Partial<Record<SystemTaskKey, (m: number) => string>> = {
  monthly_goals: (m) => `Month ${m} goals`,
  monthly_checkin: (m) => `Month ${m} check-in`,
  pulse_survey: (m) => `Month ${m} pulse survey`,
  monthly_review: (m) => `Month ${m} review`,
};
const FINISHED: Array<JourneyTask['status']> = ['done', 'skipped', 'cancelled'];

function asWaiting(j: Journey, t: JourneyTask, names: Map<string, string>, today: string, title: string): WaitingOn {
  const ownerName = t.ownerUserId ? names.get(t.ownerUserId) : t.ownerRole === 'employee' ? j.candidate?.name : undefined;
  return {
    taskId: t.id, ownerRole: t.ownerRole, ...(ownerName ? { ownerName } : {}), title,
    ...(t.dueAt ? { dueAt: t.dueAt.toISOString() } : {}), ...(taskLate(t, today) ? { late: true } : {}),
    canNudge: !('reason' in nudgeTarget(j, t)),
  };
}

/** The stage's own step for a Month 1, Months 2–5 or Confirmed card, with the title the card shows. */
export function stageStepOf(j: Journey, tasks: JourneyTask[], column: OnboardingBoardColumn, today: string): { task: JourneyTask; title: string } | null {
  // A task the board read as its status alone (board.ts ifOpen) cannot be shown: it has no id or date.
  const left = tasks.filter((t) => t.phase === 'probation' && !FINISHED.includes(t.status) && isCounted(t) && !!t.id);
  if (column === 'confirmed') {
    const letter = left.find((t) => t.systemKey === 'confirmation_letter');
    return letter ? { task: letter, title: 'Confirmation letter' } : null;
  }
  if (column !== 'month1' && column !== 'months_2_5') return null;
  const m = Math.max(1, currentMonth(j, today));
  const due = (t: JourneyTask) => (t.dueAt ? keyOfDay(t.dueAt) : '9999-12-31');
  const step = left
    .filter((t) => t.month === m && t.systemKey && MONTH_STEPS.includes(t.systemKey))
    .sort((a, b) => rank(b) - rank(a) || due(a).localeCompare(due(b)))[0];
  return step ? { task: step, title: MONTH_TITLE[step.systemKey!]!(m) } : null;
}

/**
 * A probation card's waiting list with the stage's step first. Once the confirmation letter is sent
 * the card has nothing of its stage left: older leftovers stay in the panel, not on the card.
 */
export function leadWithStageStep(j: Journey, tasks: JourneyTask[], names: Map<string, string>, now: Date, column: OnboardingBoardColumn, waiting: WaitingOn[], limit = 3): WaitingOn[] {
  if (column !== 'month1' && column !== 'months_2_5' && column !== 'confirmed') return waiting;
  const today = todayKey(now, companyTimeZone(j.org));
  const step = stageStepOf(j, tasks, column, today);
  if (!step) {
    if (column !== 'confirmed') return waiting;
    const phase = new Map(tasks.map((t) => [t.id, t.phase]));
    return waiting.filter((w) => phase.get(w.taskId) === 'probation');
  }
  return [asWaiting(j, step.task, names, today, step.title), ...waiting.filter((w) => w.taskId !== step.task.id)].slice(0, limit);
}
