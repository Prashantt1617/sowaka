// The kinds of date in the engagement plan, and the day it defaults to.
import type { PlanKind } from '../../../../services/engagement-contests';

export const KIND_LABEL: Record<PlanKind, string> = {
  contest: 'Contest',
  tournament: 'Tournament',
  game: 'Game',
  poll: 'Poll',
};

/** The next Friday after today, YYYY-MM-DD in India time: the plan's usual day. */
export function nextFriday() {
  const d = new Date(Date.now() + 330 * 60_000);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
