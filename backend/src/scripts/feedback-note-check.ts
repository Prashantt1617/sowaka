/**
 * Scratch-database check of the comment rule on reviews: sending needs at
 * least FEEDBACK_NOTE_MIN characters in every parameter's comment; a draft
 * may be shorter; and the refusal names the parameter, so the current app,
 * which shows the server's message as it is, tells the manager what to fix.
 *
 *   MONGODB_DB=feedback_note_scratch NOTIFY_ORGS=nobody-scratch npm run feedback-note:check
 */
import { ObjectId } from 'mongodb';
import { closeDb, connectDb, feedbackRecords, getDb, kpiAssignments, kpiParameters, users } from '../config/db';
import { currentPeriodFor } from '../services/cycle';
import { FEEDBACK_NOTE_MIN, upsertFeedback } from '../services/manager.service';

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

const ORG = 'note-scratch';
const person = (userId: string, name: string, managerUserId?: string) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', managerUserId,
});

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'feedback_note_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany([person('mgr', 'Manav'), person('asha', 'Asha', 'mgr')] as never[]);
  const ownership = new ObjectId();
  const quality = new ObjectId();
  await kpiParameters().insertMany([
    { _id: ownership, org: ORG, title: 'Ownership', description: '' },
    { _id: quality, org: ORG, title: 'Quality', description: '' },
  ] as never[]);
  const period = await currentPeriodFor(ORG);
  await kpiAssignments().insertOne({ org: ORG, userId: 'asha', period, parameterIds: [ownership.toHexString(), quality.toHexString()] } as never);

  const long = 'Took the launch checklist end to end and kept every stakeholder informed through the week.';
  const short = 'Good month.';
  const lines = (a: string, b: string) => [
    { parameterId: ownership.toHexString(), score: 4, note: a },
    { parameterId: quality.toHexString(), score: 3, note: b },
  ];
  check('the line is 75', FEEDBACK_NOTE_MIN === 75 && long.length >= 75);

  const draft = await upsertFeedback('mgr', 'asha', { status: 'saved', parameters: lines(long, short) });
  check('a draft may have a short comment', (draft as { status?: string } | null)?.status === 'saved', draft);

  const refused = await refusal(() => upsertFeedback('mgr', 'asha', { status: 'sent', parameters: lines(long, short) }));
  check('sending with a short comment is refused, naming it', refused?.status === 400 && /at least 75 characters/.test(refused.message ?? '') && Boolean(refused.message?.includes('"Quality" has 11')), refused);
  check('and nothing is sent', (await feedbackRecords().findOne({ employeeUserId: 'asha' }))?.status === 'saved');

  const blank = await refusal(() => upsertFeedback('mgr', 'asha', { status: 'sent', parameters: lines('   ', long) }));
  check('a blank comment is refused too (spaces do not count)', blank?.status === 400 && Boolean(blank.message?.includes('"Ownership" has 0')), blank);

  const exactly = 'x'.repeat(75);
  await upsertFeedback('mgr', 'asha', { status: 'sent', parameters: lines(long, exactly) });
  check('75 characters in every comment: sent', (await feedbackRecords().findOne({ employeeUserId: 'asha' }))?.status === 'sent');

  const editShort = await refusal(() => upsertFeedback('mgr', 'asha', { status: 'saved', parameters: lines(long, short) }));
  check('a sent review edited later keeps the rule', editShort?.status === 400, editShort);

  await db.dropDatabase();
  await closeDb();
  console.log(failed === 0 ? '\nall feedback-note checks passed' : `\n${failed} check(s) failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
