/**
 * Scratch-database check of writing a review with Suwi one KPI at a time (suwi/reviewChat.ts): it starts on a
 * direct report named with a review word, asks each KPI's score and then its comment, refuses a comment under
 * FEEDBACK_NOTE_MIN characters by asking for more (and adds the next message to it), ends with the review as
 * it will be filled in, a card that saves it as a draft and a link that opens the review page filled in. Not
 * for someone outside the asker's direct reports; "cancel" stops; last cycle when asked.
 *
 *   MONGODB_DB=suwi_review_chat_scratch NOTIFY_ORGS=nobody-scratch npm run suwi-review-chat:check
 */
import { ObjectId } from 'mongodb';
import { closeDb, connectDb, feedbackRecords, getDb, kpiAssignments, kpiParameters, users } from '../config/db';
import { currentPeriodFor, previousPeriod } from '../services/cycle';
import { reviewChat } from '../suwi/reviewChat';
import { confirmProposal } from '../suwi/proposals';
import { contextFor, toolsFor } from '../suwi/tools';
import '../suwi/registry';
import { DEFAULT_LEVELS } from '../suwi/store';
import type { User } from '../models/user.model';

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}

const ORG = 'review-chat-scratch';
const person = (userId: string, name: string, managerUserId?: string) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', managerUserId,
});

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'suwi_review_chat_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany([
    person('vik', 'Vikrant Rao'), person('ind', 'Inderjeet Singh', 'vik'), person('ro', 'Rohan Mehta', 'vik'),
    person('other', 'Priya Nair'), person('deep', 'Deepa Iyer', 'ind'),
  ] as never[]);
  await getDb().collection('suwi_settings').insertOne({ org: ORG, enabled: true, levels: { ...DEFAULT_LEVELS, performance: 'act' } } as never);
  const own = new ObjectId();
  const qual = new ObjectId();
  await kpiParameters().insertMany([
    { _id: own, org: ORG, title: 'Ownership', description: 'Takes work end to end' },
    { _id: qual, org: ORG, title: 'Quality', description: '' },
  ] as never[]);
  const period = await currentPeriodFor(ORG);
  const last = previousPeriod(period);
  for (const p of [period, last]) {
    await kpiAssignments().insertOne({ org: ORG, userId: 'ind', period: p, parameterIds: [own.toHexString(), qual.toHexString()]} as never);
  }
  const vik = (await users().findOne({ userId: 'vik' })) as unknown as Omit<User, 'profilePhotoUrl'>;
  const ask = (q: string) => reviewChat(vik, q);

  check('an ordinary question is left to the rest of Suwi', (await ask('who is late today')) === null);
  check('someone outside their direct reports is left to the rest of Suwi', (await ask('give review to Priya')) === null);

  let a = await ask('give review to inderjeet');
  check('starts on the direct report, with the first KPI', Boolean(a && /Inderjeet Singh/.test(a.text) && /1 of 2 · Ownership/.test(a.text) && /from 1 to 5/.test(a.text)), a?.text);
  a = await ask('seven');
  check('a word that is not a score asks again', Boolean(a && /score/.test(a.text) && /cancel/.test(a.text)), a?.text);
  a = await ask('6');
  check('a score over 5 is refused', Boolean(a && /1 to 5/.test(a.text)), a?.text);
  a = await ask('4');
  check('a score, then the comment is asked for', Boolean(a && /Ownership: \*\*4 of 5\*\*/.test(a.text) && /at least 75/.test(a.text)), a?.text);
  a = await ask('Good month.');
  check('a short comment asks for more, saying how many', Boolean(a && /11 characters/.test(a.text) && /about 64 more/.test(a.text)), a?.text);
  a = await ask('Took the vendor migration end to end and kept everyone updated.');
  check('the next message is added, and the next KPI starts', Boolean(a && /2 of 2 · Quality/.test(a.text)), a?.text);
  a = await ask('back');
  check('back redoes the last KPI', Boolean(a && /1 of 2 · Ownership/.test(a.text)), a?.text);
  a = await ask('5, Took the vendor migration end to end, kept every stakeholder updated weekly, no slips at all.');
  check('a score and a long comment in one message moves on', Boolean(a && /2 of 2 · Quality/.test(a.text)), a?.text);
  a = await ask('3');
  a = await ask('Two releases needed hotfixes this month; tests before merging would have caught both of them.');
  const prop = a?.proposals[0];
  const link = a?.links[0];
  check('the end shows the review, overall weighted', Boolean(a && /\| Ownership \(50%\) \| 5 of 5/.test(a.text) && /\*\*4 of 5\*\*/.test(a.text)), a?.text);
  check('a card to save it as a draft', Boolean(prop && /as a draft/.test(prop.title)), prop);
  check('a link to the review page filled in', Boolean(link?.review && link.review.userId === 'ind' && link.review.period === period && link.review.parameters.length === 2 && link.review.parameters[0].score === 5), link);
  check('nothing is saved before confirming', !(await feedbackRecords().findOne({ employeeUserId: 'ind' })));
  check('the conversation has ended', (await ask('4')) === null);
  await confirmProposal('vik', ORG, prop!.id);
  const saved = await feedbackRecords().findOne({ managerUserId: 'vik', employeeUserId: 'ind', period });
  check('confirming saves a draft, not sent', saved?.status === 'saved' && saved.parameters.length === 2, saved);

  a = await ask("write inderjeet's review for last month");
  check('last month when asked', Boolean(a && new RegExp(new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${last}-01T00:00:00Z`))).test(a.text)), a?.text);
  a = await ask('cancel');
  check('cancel stops', Boolean(a && /Nothing was saved/.test(a.text)), a?.text);

  a = await ask('give feedback to rohan');
  check('no KPIs: says so', Boolean(a && /no KPIs assigned/.test(a.text)), a?.text);

  // A manager's tools: only the team-safe ones.
  const ctx = contextFor({ ...vik, dashboardScope: 'team' } as never, { ...DEFAULT_LEVELS, performance: 'act' }, new Date().toISOString().slice(0, 10));
  const names = toolsFor(ctx).map((t) => t.name).sort();
  check('a manager gets the team tools only', names.every((n) => ['attendance_summary', 'dashboard_help', 'person_details', 'prepare_save_review_draft', 'review_draft', 'search_people'].includes(n)) && names.includes('review_draft'), names);
  const search = (await import('../suwi/tools')).toolByName('search_people')!;
  const out = await search.run(ctx, {}) as { data: { rows?: { name: string }[]; people?: { name: string }[] } };
  const listed = JSON.stringify(out.data);
  check('people search sees their subtree only', /Inderjeet/.test(listed) && /Deepa/.test(listed) && !/Priya/.test(listed), listed.slice(0, 300));

  await db.dropDatabase();
  await closeDb();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await closeDb().catch(() => undefined); process.exit(1); });
