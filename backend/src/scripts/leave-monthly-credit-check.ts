/**
 * Leave credited month by month, at the rate on the person's template.
 *
 * A yearly type's balance grows on the 1st of each month from January (or the
 * joining month), a year that has closed counts every month from joining, and
 * applying for a later date may use the credit due by then. On a scratch
 * database:
 *
 *   MONGODB_DB=leave_monthly_credit_scratch npm run leave-monthly-credit:check
 */
import { connectDb, getDb, users } from '../config/db';
import { createShift, setDefaultShift } from '../services/shift.service';
import { applyForLeave, getMyLeaveBalance, LeaveError } from '../services/leave.service';
import { closeYearForUser } from '../services/leave-year-end.service';
import { monthsCredited } from '../models/shift.model';
import type { User } from '../models/user.model';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
const ORG = 'creditcheck';
const person = (userId: string, joined: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@x.test`, org: ORG, lifecycleStatus: 'active', role: 'employee', joiningDate: new Date(`${joined}T00:00:00Z`), ...extra,
} as User);
const d = (iso: string) => new Date(`${iso}T06:00:00Z`);

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();

  console.log('months credited');
  const y0 = new Date(Date.UTC(2026, 0, 1)), y1 = new Date(Date.UTC(2026, 11, 31));
  ok('13 Nov, joined last year: 11', monthsCredited(y0, y1, d('2026-11-13'), d('2025-02-10')) === 11);
  ok('1 Dec: 12', monthsCredited(y0, y1, d('2026-12-01'), null) === 12);
  ok('joined 23 Mar: March to November, 9', monthsCredited(y0, y1, d('2026-11-13'), d('2026-03-23')) === 9);
  ok('a closed year: all 12', monthsCredited(y0, y1, d('2027-02-01'), null) === 12);
  ok('before joining: none', monthsCredited(y0, y1, d('2026-02-01'), d('2026-05-04')) === 0);

  await users().insertMany([person('hr', '2024-01-01', { dashboardAccess: true }), person('old', '2025-02-10'), person('new', '2026-03-23')]);
  const shift = await createShift('hr', {
    name: 'General', punchFormat: 'In-app punch in',
    policy: { leave: { approver: 'Reporting manager', hrOverride: true, balanceTracked: true, types: [
      { key: 'casual', name: 'Casual Leave', perMonth: 0.5, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none', encashLimitDays: 0, advanceDays: 365, allowBackdated: true, backdatedDays: 120 },
      { key: 'earned', name: 'Earned Leave', perMonth: 1.5, resetOn: 'calendar_year', carryForwardDays: 15, encashment: 'none', encashLimitDays: 0, advanceDays: 365, allowBackdated: true, backdatedDays: 120 },
    ] } },
  } as never);
  await setDefaultShift('hr', (shift as { id: string }).id);

  console.log('the balance grows each month');
  const total = async (u: string, key: string, at: string) => (await getMyLeaveBalance(u, 2026, d(at))).types.find((t) => t.key === key)?.total;
  ok('October: 10 × 0.5 = 5 casual', (await total('old', 'casual', '2026-10-20')) === 5);
  ok('November: 5.5 casual, the month credited', (await total('old', 'casual', '2026-11-13')) === 5.5);
  ok('December: 6 casual', (await total('old', 'casual', '2026-12-02')) === 6);
  ok('earned at 1.5 a month: 16.5 in November', (await total('old', 'earned', '2026-11-13')) === 16.5);
  ok('joined in March: 9 × 0.5 = 4.5 in November', (await total('new', 'casual', '2026-11-13')) === 4.5);

  console.log('applying');
  const refusedFor = async (run: () => Promise<unknown>) => { try { await run(); return ''; } catch (e) { return e instanceof LeaveError ? e.message : String(e); } };
  const now = new Date();
  const ahead = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15));
  while (ahead.getUTCDay() === 0 || ahead.getUTCDay() === 6) ahead.setUTCDate(ahead.getUTCDate() + 1);
  const iso = ahead.toISOString().slice(0, 10);
  const balNow = (await getMyLeaveBalance('new', ahead.getUTCFullYear(), now)).types.find((t) => t.key === 'casual')!;
  const balThen = (await getMyLeaveBalance('new', ahead.getUTCFullYear(), ahead)).types.find((t) => t.key === 'casual')!;
  ok('next month\'s credit is due by the leave date', balThen.total === balNow.total + 0.5 || ahead.getUTCFullYear() !== now.getUTCFullYear(), { now: balNow.total, then: balThen.total });
  const tooMuch = await refusedFor(() => applyForLeave('new', { type: 'casual', startDate: iso, endDate: iso, reason: 'x', halfDay: false } as never));
  ok('a day within what is due by then is accepted (or a weekend/holiday refusal unrelated to balance)', !/left in/.test(tooMuch) || balThen.total < 1, tooMuch);

  console.log('the year-end close');
  const closed = await closeYearForUser('new', 2026, d('2027-01-01'), true);
  const casualRow = closed.rows.find((r) => r.type === 'casual');
  ok('closing 2026 for a March joiner: 10 months × 0.5 credited', casualRow?.closing === 5 - (await getMyLeaveBalance('new', 2026, d('2026-12-31'))).types.find((t) => t.key === 'casual')!.used, closed.rows);

  console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
