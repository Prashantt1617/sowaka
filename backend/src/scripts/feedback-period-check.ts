/**
 * Scratch-database check that a review can be written for the previous cycle
 * as well as the live one, and for nothing older or later; that the comment
 * rule holds there too; and that the workspace hands the app what the
 * manager saved or sent for that cycle, on that cycle's parameters.
 *
 *   MONGODB_DB=feedback_period_scratch NOTIFY_ORGS=nobody-scratch npm run feedback-period:check
 *
 * Manav heads Asha and Bala; Asha heads Chetan. Asha has parameters assigned
 * for this cycle and the last; Bala only for this one. Drops and recreates its
 * own database and refuses any other.
 */
import { ObjectId } from 'mongodb';
import { closeDb, connectDb, feedbackRecords, getDb, kpiAssignments, kpiParameters, users } from '../config/db';
import { currentPeriodFor, nextPeriod, previousPeriod } from '../services/cycle';
import { getManagerWorkspace, reviewablePeriod, upsertFeedback } from '../services/manager.service';

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}
async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message };
  }
}

const ORG = 'period-scratch';
const person = (userId: string, name: string, managerUserId?: string) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', managerUserId,
});

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'feedback_period_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany([
    person('mgr', 'Manav'),
    person('asha', 'Asha', 'mgr'),
    person('bala', 'Bala', 'mgr'),
    person('chetan', 'Chetan', 'asha'),
  ] as never[]);
  const ownership = new ObjectId();
  const quality = new ObjectId();
  const delivery = new ObjectId();
  await kpiParameters().insertMany([
    { _id: ownership, org: ORG, title: 'Ownership', description: '' },
    { _id: quality, org: ORG, title: 'Quality', description: '' },
    { _id: delivery, org: ORG, title: 'Delivery', description: '' },
  ] as never[]);
  const current = await currentPeriodFor(ORG);
  const last = previousPeriod(current);
  const older = previousPeriod(last);
  // Last cycle Asha was scored on Ownership and Delivery; this one on
  // Ownership and Quality — the form for each cycle is that cycle's own.
  await kpiAssignments().insertMany([
    { org: ORG, userId: 'asha', period: last, parameterIds: [ownership.toHexString(), delivery.toHexString()] },
    { org: ORG, userId: 'asha', period: current, parameterIds: [ownership.toHexString(), quality.toHexString()] },
    { org: ORG, userId: 'bala', period: current, parameterIds: [ownership.toHexString()] },
  ] as never[]);

  const long = 'Took the launch checklist end to end and kept every stakeholder informed through the week.';
  const longer = `${long} Picked up the handover too.`;
  const lastLines = (a: string, b: string) => [
    { parameterId: ownership.toHexString(), score: 4, note: a },
    { parameterId: delivery.toHexString(), score: 3, note: b },
  ];

  check('the live cycle by default', (await reviewablePeriod(ORG)) === current);
  check('the previous cycle when asked', (await reviewablePeriod(ORG, last)) === last);
  for (const [label, period] of [['two cycles back', older], ['the next cycle', nextPeriod(current)], ['nonsense', 'soon']] as const) {
    const r = await refusal(() => upsertFeedback('mgr', 'asha', { status: 'saved', parameters: lastLines(long, long), period }));
    check(`${label} is refused`, r?.status === 400 && /this cycle or the previous one/.test(r.message ?? ''), r);
  }
  check('and nothing was written for them', (await feedbackRecords().countDocuments({ period: { $ne: last } })) === 0);

  const draft = await upsertFeedback('mgr', 'asha', { status: 'saved', parameters: lastLines(long, 'Short.'), period: last });
  check('a draft for the previous cycle, keyed to it', draft?.period === last && draft?.status === 'saved', draft);

  const short = await refusal(() => upsertFeedback('mgr', 'asha', { status: 'sent', parameters: lastLines(long, 'Short.'), period: last }));
  check('the 75-character rule holds for the previous cycle', short?.status === 400 && Boolean(short.message?.includes('"Delivery" has 6')), short);

  const wrongForm = await refusal(() => upsertFeedback('mgr', 'asha', {
    status: 'sent',
    parameters: [
      { parameterId: ownership.toHexString(), score: 4, note: long },
      { parameterId: quality.toHexString(), score: 4, note: long },
    ],
    period: last,
  }));
  check("this cycle's parameters do not fit last cycle's review", wrongForm?.status === 409, wrongForm);

  const sent = await upsertFeedback('mgr', 'asha', { status: 'sent', parameters: lastLines(long, long), period: last });
  check('sent for the previous cycle', sent?.period === last && sent?.status === 'sent' && Boolean(sent?.sentAt), sent);
  check("on that cycle's parameters", JSON.stringify(sent?.parameters.map((p) => p.name)) === JSON.stringify(['Ownership', 'Delivery']), sent?.parameters);

  const edited = await upsertFeedback('mgr', 'asha', { status: 'saved', parameters: lastLines(longer, long), period: last });
  check('editable afterwards, and stays sent', edited?.status === 'sent' && edited?.parameters[0]?.note === longer, edited);
  check('still one record for that cycle', (await feedbackRecords().countDocuments({ employeeUserId: 'asha', period: last })) === 1);
  check('the live cycle untouched', (await feedbackRecords().countDocuments({ employeeUserId: 'asha', period: current })) === 0);

  const unassigned = await refusal(() => upsertFeedback('mgr', 'bala', {
    status: 'saved',
    parameters: [{ parameterId: ownership.toHexString(), score: 3, note: long }],
    period: last,
  }));
  check('no parameters assigned for the previous cycle: refused as for any cycle', unassigned?.status === 409, unassigned);

  const notMine = await refusal(() => upsertFeedback('mgr', 'chetan', { status: 'saved', parameters: lastLines(long, long), period: last }));
  check("a report's report is not the viewer's to review, in any cycle", notMine?.status === 403, notMine);

  // What the app reads.
  type Row = { userId: string; previousCycle: null | { period: string; feedbackStatus: string; parameters: { name: string; note: string }[]; extra: string } };
  const workspace = await getManagerWorkspace('mgr');
  const team = workspace.team as unknown as Row[];
  const asha = team.find((row) => row.userId === 'asha');
  const bala = team.find((row) => row.userId === 'bala');
  check('the workspace carries the previous cycle for a direct report', asha?.previousCycle?.period === last && asha.previousCycle.feedbackStatus === 'sent', asha?.previousCycle);
  check('with what was written, on that cycle\'s parameters', JSON.stringify(asha?.previousCycle?.parameters.map((p) => [p.name, p.note])) === JSON.stringify([['Ownership', longer], ['Delivery', long]]), asha?.previousCycle);
  check('nothing written yet: pending, with no parameters when none are assigned', bala?.previousCycle?.feedbackStatus === 'pending' && bala.previousCycle.parameters.length === 0, bala?.previousCycle);
  const asAsha = (await getManagerWorkspace('asha')).team as unknown as Row[];
  check('not for the viewer themselves or their manager', asAsha.filter((row) => row.userId !== 'chetan').every((row) => row.previousCycle === null), asAsha.map((row) => [row.userId, row.previousCycle]));
  check('but for their own report', asAsha.find((row) => row.userId === 'chetan')?.previousCycle?.period === last);

  await db.dropDatabase();
  await closeDb();
  console.log(failed === 0 ? '\nall feedback-period checks passed' : `\n${failed} check(s) failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
