/**
 * The monthly leave credit for balances matched to another system mid-year.
 *
 * A yearly leave type's total is its monthly rate times twelve plus what last
 * year's close carried (`leave_year_ends`). When a company's balances were
 * matched to their old HR system part-way through a year, `carried` was worked
 * back so that total equalled the balance that day, which leaves no room for
 * the months still to come: they were never credited. Those rows carry
 * `monthlyCredits`, and this adds each new month's credit to them, at the rate
 * on the person's own template, as the month turns.
 *
 * Runs every hour and is idempotent: a row already credited for the month is
 * skipped, so a missed hour (a restart, a deploy) is made up on the next one.
 * Only rows feeding this year's balance (last year's close) are touched, so
 * once this year closes normally the credits stop by themselves.
 */
import { leaveYearEnds, users } from '../config/db';
import { leaveTypeRulesFor } from './shift.service';
import { istParts } from './notification-time';
import { logger } from '../utils/logger';

export interface MonthlyCreditResult {
  month: string;
  credited: number;
  people: number;
}

/** Adds this IST month's credit to every matched balance not yet credited for it. */
export async function creditMatchedBalances(now = new Date()): Promise<MonthlyCreditResult> {
  const { year, month: m } = istParts(now);
  const month = `${year}-${String(m).padStart(2, '0')}`;
  const rows = await leaveYearEnds()
    .find({ year: year - 1, monthlyCredits: { $exists: true }, 'monthlyCredits.month': { $ne: month } })
    .toArray();
  if (rows.length === 0) return { month, credited: 0, people: 0 };

  const ids = [...new Set(rows.map((row) => row.userId))];
  const gone = new Set(
    (await users().find({ userId: { $in: ids }, lifecycleStatus: { $in: ['offboarded', 'terminated'] } }, { projection: { _id: 0, userId: 1 } }).toArray())
      .map((user) => user.userId),
  );
  const at = new Date();
  let credited = 0;
  const people = new Set<string>();
  for (const userId of ids) {
    if (gone.has(userId)) continue;
    const rules = await leaveTypeRulesFor(userId).catch(() => null);
    if (!rules) continue;
    for (const row of rows.filter((r) => r.userId === userId)) {
      const rule = rules.find((r) => r.key === row.type);
      // A type taken off their template, unpaid leave, a monthly-reset type or one with no rate gets nothing.
      if (!rule || rule.unpaid || rule.resetOn === 'monthly' || !(rule.perMonth > 0)) continue;
      const res = await leaveYearEnds().updateOne(
        { _id: row._id, 'monthlyCredits.month': { $ne: month } },
        { $inc: { carried: rule.perMonth }, $push: { monthlyCredits: { month, days: rule.perMonth, at } } },
      );
      if (res.modifiedCount) { credited += 1; people.add(userId); }
    }
  }
  if (credited) logger.info('Monthly leave credit added', { month, credited, people: people.size });
  return { month, credited, people: people.size };
}
