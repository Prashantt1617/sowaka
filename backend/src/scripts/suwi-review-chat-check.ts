/**
 * Scratch-database check of writing a review with Suwi (suwi/reviewChat.ts, suwi/reviewChatText.ts): asking who
 * when no name is given; a direct report named with a review word; each KPI's score and then its comment, a comment
 * under FEEDBACK_NOTE_MIN characters asked to grow (the next message added to it); everything pasted at once, with
 * what is missing or wrong listed (a KPI given twice, a name that is no KPI, a short comment, a KPI left out); changes
 * ("make ownership 5", "change the quality comment"), back, keep, skip, what's left, save draft; a draft and a sent
 * review picked up again; someone else's report; several people of one name; last month; a question about something
 * else while the review waits; a long pause. With a stub for the quick model: its rewording used only when it keeps
 * the facts, its split used only when the comments are the manager's own words, and at most one call a message.
 * All names are invented.
 *
 *   MONGODB_DB=suwi_review_chat_scratch NOTIFY_ORGS=nobody-scratch npm run suwi-review-chat:check
 */
import { ObjectId } from 'mongodb';
import { closeDb, connectDb, feedbackRecords, getDb, kpiAssignments, kpiParameters, users } from '../config/db';
import { currentPeriodFor, previousPeriod } from '../services/cycle';
import { reviewChat } from '../suwi/reviewChat';
import { reviewChatModel } from '../suwi/reviewChatText';
import { confirmProposal } from '../suwi/proposals';
import { contextFor, toolsFor } from '../suwi/tools';
import '../suwi/registry';
import { DEFAULT_LEVELS } from '../suwi/store';
import type { SuwiAnswer } from '../suwi/agent';
import type { LlmReply } from '../suwi/llm';
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

// The quick model, stubbed: off unless a check turns it on; each call answers from the queue (or throws).
const realModel = { ...reviewChatModel };
let modelOn = false;
let calls: string[] = [];
let queue: (string | Error)[] = [];
reviewChatModel.configured = () => modelOn;
reviewChatModel.call = async (input) => {
  calls.push(input.system.startsWith('You read one chat message') ? 'parse' : 'phrase');
  const next = queue.shift();
  if (next instanceof Error) throw next;
  const draft = (() => { try { return String(JSON.parse(String(input.messages[0].content)).DRAFT ?? ''); } catch { return ''; } })();
  const text = (next ?? '{"reply":""}').replace('<DRAFT>', draft.replace(/"/g, '\\"'));
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 }, model: 'stub-small' } satisfies LlmReply;
};

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'suwi_review_chat_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany([
    { ...person('mgr', 'Arjun Kapoor'), dashboardScope: 'team' }, person('mee', 'Meera Joshi', 'mgr'), person('rom', 'Rohan Mehta', 'mgr'), person('rod', 'Rohan Das', 'mgr'),
    person('kav', 'Kavya Menon', 'mgr'), person('sam', 'Sameer Khan', 'mgr'), person('pri', 'Priya Nair'), person('dee', 'Deepa Iyer', 'mee'),
    person('hrx', 'Nisha Verma'), person('tar', 'Tara Bose', 'hrx'),
  ] as never[]);
  await getDb().collection('suwi_settings').insertOne({ org: ORG, enabled: true, monthlyBudgetUsd: 50, levels: { ...DEFAULT_LEVELS, performance: 'act' } } as never);
  const own = new ObjectId();
  const qual = new ObjectId();
  const hir = new ObjectId();
  const ups = new ObjectId();
  const qow = new ObjectId();
  await kpiParameters().insertMany([
    { _id: own, org: ORG, title: 'Ownership', description: 'Takes work end to end' },
    { _id: qual, org: ORG, title: 'Quality', description: '' },
    { _id: hir, org: ORG, title: 'Hiring', description: 'Roles filled on time with the right people' },
    { _id: ups, org: ORG, title: 'Upskilling', description: '' },
    { _id: qow, org: ORG, title: 'Quality of work', description: '' },
  ] as never[]);
  const period = await currentPeriodFor(ORG);
  const last = previousPeriod(period);
  for (const p of [period, last]) {
    for (const u of ['mee', 'sam', 'rod']) await kpiAssignments().insertOne({ org: ORG, userId: u, period: p, parameterIds: [own.toHexString(), qual.toHexString()] } as never);
    await kpiAssignments().insertOne({ org: ORG, userId: 'kav', period: p, parameterIds: [hir, ups, qow].map((x) => x.toHexString()), weights: { [hir.toHexString()]: 40, [ups.toHexString()]: 30, [qow.toHexString()]: 30 } } as never);
  }
  const LONG_OWN = 'Took the vendor migration end to end, kept every stakeholder updated weekly, no slips at all.';
  const LONG_QUAL = 'Two releases needed hotfixes this month; tests before merging would have caught both of them.';
  await feedbackRecords().insertOne({
    managerUserId: 'mgr', employeeUserId: 'sam', period, status: 'sent', extra: '', overallScore: 4, createdAt: new Date(), updatedAt: new Date(), sentAt: new Date(),
    parameters: [{ parameterId: own.toHexString(), name: 'Ownership', score: 4, note: LONG_OWN }, { parameterId: qual.toHexString(), name: 'Quality', score: 4, note: LONG_QUAL }],
  } as never);
  const mgr = (await users().findOne({ userId: 'mgr' })) as unknown as Omit<User, 'profilePhotoUrl'>;
  let last_: Awaited<ReturnType<typeof reviewChat>> = null;
  const ask = async (q: string): Promise<SuwiAnswer | null> => { last_ = await reviewChat(mgr, q); return last_ && 'answer' in last_ ? last_.answer : null; };
  // The last result as it came (an answer, an aside or null); a function, as TypeScript cannot follow the closure.
  const aside = (): string | undefined => { const r = last_ as Awaited<ReturnType<typeof reviewChat>>; return r && 'aside' in r ? r.aside : undefined; };
  const state = () => getDb().collection('suwi_review_chats').findOne({ _id: 'mgr' } as never) as Promise<{ answers: { score?: number; note?: string }[]; mode?: string; index: number; step: string } | null>;
  // Suwi says the same thing in a few ways (so it does not repeat itself): any of them will do.
  const took = (text: string, n: number, kpi: string) => new RegExp(`${n} on \\*\\*${kpi}\\*\\*|${n} for \\*\\*${kpi}\\*\\*|\\*\\*${kpi}\\*\\*: ${n}`).test(text);
  const month = (p: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${p}-01T00:00:00Z`));

  // --- Who, and whose review.
  check('an ordinary question is left to the rest of Suwi', (await ask('who is late today')) === null && last_ === null);
  let a = await ask('give review to Priya');
  check('someone outside the team: only their own manager, and nothing about them', Boolean(a && /own manager/.test(a.text) && !/Nair/.test(a.text) && /Meera Joshi/.test(a.text)), a?.text);
  a = await ask('give review to Deepa');
  check('someone further down the team: named with the manager who writes it', Boolean(a && /\*\*Deepa Iyer\*\* reports to \*\*Meera Joshi\*\*/.test(a.text)), a?.text);
  a = await ask('fill feedback');
  check('no name: asks who, listing who still needs a review', Boolean(a && /Who is the review for/.test(a.text) && /\*\*Meera Joshi\*\*/.test(a.text) && /\*\*Kavya Menon\*\*/.test(a.text) && /Already sent: Sameer Khan/.test(a.text) && /not ready for a review: Rohan Mehta/.test(a.text)), a?.text);
  a = await ask('meera');
  check('the reply names them: the review starts on the first KPI', Boolean(a && /Meera Joshi/.test(a.text) && /\*\*Ownership\*\* · KPI 1 of 2/.test(a.text) && /from 1 to 5/.test(a.text) && /all in one message/.test(a.text)), a?.text);

  // --- One KPI at a time.
  a = await ask('seven');
  check('a word that is not a score asks again', Boolean(a && /score/.test(a.text) && /cancel/.test(a.text)), a?.text);
  a = await ask('6');
  check('a score over 5 is refused', Boolean(a && /1 to 5/.test(a.text)), a?.text);
  a = await ask('4.5');
  check('a score that is not whole is refused', Boolean(a && /whole number/.test(a.text)), a?.text);
  a = await ask('4');
  check('a score, then the comment is asked for, at least 75 characters', Boolean(a && took(a.text, 4, 'Ownership') && /75/.test(a.text)), a?.text);
  a = await ask('Good month.');
  check('a short comment asks for more, saying how many', Boolean(a && /11 characters/.test(a.text) && /64 more/.test(a.text)), a?.text);
  a = await ask('Took the vendor migration end to end and kept everyone updated.');
  check('the next message is added, and the next KPI starts', Boolean(a && /\*\*Quality\*\* · KPI 2 of 2/.test(a.text)), a?.text);
  check('the comment is the manager\'s two messages, nothing added', (await state())?.answers[0].note === 'Good month. Took the vendor migration end to end and kept everyone updated.', (await state())?.answers[0]);
  a = await ask("what's left?");
  check("what's left lists each KPI", Boolean(a && /\*\*Ownership\*\*: 4 of 5, comment done/.test(a.text) && /\*\*Quality\*\*: no score yet/.test(a.text)), a?.text);
  a = await ask('back');
  check('back reopens the last KPI, offering keep', Boolean(a && /back to \*\*Ownership\*\*/.test(a.text) && /It's 4 now; say \*\*keep\*\*/.test(a.text)), a?.text);
  a = await ask('keep');
  check('keep puts back its score and comment and moves on', Boolean(a && /Kept 4/.test(a.text) && /\*\*Quality\*\* · KPI 2 of 2/.test(a.text)), a?.text);
  a = await ask('make ownership 5');
  check('"make ownership 5" changes it and carries on with Quality', Boolean(a && /\*\*Ownership\*\* is now 5/.test(a.text) && /Quality/.test(a.text) && (await state())?.answers[0].score === 5), a?.text);
  a = await ask('3');
  a = await ask(LONG_QUAL);
  const prop = a?.proposals[0];
  const link = a?.links[0];
  check('the end shows the review, overall weighted', Boolean(a && /\| Ownership \(50%\) \| 5 of 5/.test(a.text) && /\*\*4 of 5\*\*/.test(a.text)), a?.text);
  check('a card to save it as a draft', Boolean(prop && /as a draft/.test(prop.title)), prop);
  check('a link to the review page filled in', Boolean(link?.review && link.review.userId === 'mee' && link.review.period === period && link.review.parameters.length === 2 && link.review.parameters[0].score === 5), link);
  check('nothing is saved before confirming', !(await feedbackRecords().findOne({ employeeUserId: 'mee' })));
  a = await ask('make quality 4');
  const prop2 = a?.proposals[0];
  check('a change after the end makes a new card, overall again', Boolean(a && prop2 && prop2.id !== prop!.id && /\*\*4.5 of 5\*\*|4.5 of 5/.test(a.text)), a?.text);
  check('the earlier card is cancelled', (await getDb().collection('suwi_proposals').findOne({ _id: new ObjectId(prop!.id) } as never))?.status === 'cancelled');
  check('the conversation then ends on anything else', (await ask('4')) === null && last_ === null);
  await confirmProposal('mgr', ORG, prop2!.id);
  const saved = await feedbackRecords().findOne({ managerUserId: 'mgr', employeeUserId: 'mee', period });
  check('confirming saves a draft, not sent', saved?.status === 'saved' && saved.parameters.length === 2 && saved.parameters[1].score === 4, saved);

  // --- A draft picked up again; last month; this month.
  a = await ask('give review to meera');
  check('a complete draft is shown, asking what to change', Boolean(a && /draft/.test(a.text) && /\| Quality \(50%\) \| 4 of 5/.test(a.text) && /What would you like to change/.test(a.text)), a?.text);
  a = await ask("write meera's review for last month");
  check('last month when asked', Boolean(a && new RegExp(month(last)).test(a.text) && /KPI 1 of 2/.test(a.text)), a?.text);
  a = await ask('this month');
  check('"this month" switches back, to the saved draft', Boolean(a && /Switching to/.test(a.text) && new RegExp(month(period)).test(a.text)), a?.text);
  a = await ask('cancel');
  check('cancel leaves it as it is', Boolean(a && /stays as it is/.test(a.text)) && !(await state()), a?.text);

  // --- Several people of one name, and no KPIs.
  a = await ask('help me write a review for someone in my team');
  check('"for someone in my team" asks who', Boolean(a && /Who is the review for/.test(a.text)), a?.text);
  a = await ask('rohan');
  check('two people of that name: asks which', Boolean(a && /Rohan Mehta/.test(a.text) && /Rohan Das/.test(a.text) && /Which one/.test(a.text)), a?.text);
  a = await ask('Rohan Mehta');
  check('no KPIs: says so', Boolean(a && /no KPIs assigned/.test(a.text)), a?.text);

  // --- Everything pasted at once.
  a = await ask('give review to kavya');
  check('a three-KPI review starts', Boolean(a && /Hiring \(40%\)/.test(a.text) && /\*\*Hiring\*\* · KPI 1 of 3/.test(a.text)), a?.text);
  a = await ask([
    'Hiring 4 - hired three designers this month and got all of them productive inside their first two weeks.',
    'Upskiling: 3, did one course',
    'Teamwork 5: always helps',
    'Hiring 3 - on second thought: she hired three designers this month and onboarded every one of them well.',
  ].join('\n'));
  check('pasted: takes what it can', Boolean(a && /I've taken \*\*Hiring\*\* \(3\) and \*\*Upskilling\*\* \(3\)/.test(a.text)), a?.text);
  check('pasted: a KPI given twice (the last kept)', Boolean(a && /\*\*Hiring\*\* came up twice; I went with the last one \(3\)/.test(a.text)), a?.text);
  check('pasted: a short comment, with how many more', Boolean(a && /\*\*Upskilling\*\*: the comment is 14 characters; it needs 61 more/.test(a.text)), a?.text);
  check('pasted: a KPI left out', Boolean(a && /\*\*Quality of work\*\*: not in your message yet/.test(a.text)), a?.text);
  check('pasted: a name that is no KPI, with the real ones', Boolean(a && /"Teamwork" isn't one of Kavya's KPIs this cycle \(they are Hiring, Upskilling and Quality of work\)/.test(a.text)), a?.text);
  check('pasted: then asks for the first gap, the short comment', Boolean(a && /about 61 more/.test(a.text)) && (await state())?.index === 1 && (await state())?.step === 'comment', a?.text);
  a = await ask('She finished the advanced animation course and now mentors two juniors on rigging.');
  check('the rest is added; the KPI left out is asked for', Boolean(a && /\*\*Quality of work\*\* · KPI 3 of 3/.test(a.text)), a?.text);
  check('the comment is joined to what was written', (await state())?.answers[1].note === 'did one course She finished the advanced animation course and now mentors two juniors on rigging.', (await state())?.answers[1]);
  a = await ask('Quality of work 2: two deliveries came back with rework this month, both from skipped review steps before handoff.');
  check('the KPI named with its score and comment ends the review', Boolean(a && /\| Quality of work \(30%\) \| 2 of 5 \| two deliveries/.test(a.text) && a.proposals.length === 1), a?.text);
  a = await ask('cancel');
  check('cancel after the end closes it', Boolean(a && /Nothing is saved unless you press \*\*Confirm\*\*/.test(a.text)), a?.text);

  // --- Partial input mid-way, skip, save draft.
  a = await ask('give review to kavya');
  a = await ask('4 - Hired three designers this month and got all of them productive inside two weeks. Upskilling 3: Finished the advanced animation course and now mentors two juniors on rigging.');
  check('asked for KPI 1, given 1 and 2: both taken, KPI 3 asked for', Boolean(a && /\*\*Hiring\*\* \(4\) and \*\*Upskilling\*\* \(3\)/.test(a.text) && /\*\*Quality of work\*\*: not in your message yet/.test(a.text)) && (await state())?.index === 2, a?.text);
  a = await ask('skip');
  check('skip with one left says so', Boolean(a && /only one left/.test(a.text) && /save draft/.test(a.text)), a?.text);
  a = await ask('save draft');
  check('save draft: an unfinished draft card', Boolean(a && a.proposals[0] && /unfinished/.test(a.proposals[0].title) && /not scored/.test(a.text)), a?.text);
  a = await ask('thanks');
  check('then the conversation ends', a === null);

  // --- A question about something else; a long pause; a very long one.
  a = await ask('give review to kavya');
  await ask('who is late today?');
  check('a question mid-review goes to the rest of Suwi, the review waits', /still open/.test(aside() ?? '') && /\*\*Hiring\*\*/.test(aside() ?? '') && Boolean(await state()), last_);
  a = await ask('4');
  check('and the next answer carries on', Boolean(a && took(a.text, 4, 'Hiring')), a?.text);
  await getDb().collection('suwi_review_chats').updateOne({ _id: 'mgr' } as never, { $set: { updatedAt: new Date(Date.now() - 3 * 3600_000) } });
  a = await ask('Hired three designers this month and got all of them productive inside their first two weeks.');
  check('after a long pause: welcome back, and it carries on', Boolean(a && /^Welcome back!/.test(a.text) && /Upskilling/.test(a.text)), a?.text);
  await getDb().collection('suwi_review_chats').updateOne({ _id: 'mgr' } as never, { $set: { updatedAt: new Date(Date.now() - 4 * 24 * 3600_000) } });
  check('after days, it is forgotten', (await ask('3')) === null && !(await state()));

  // --- Mid-review, a message that starts like a new request but names nobody is an answer.
  a = await ask('give review to kavya');
  a = await ask('rate it 4');
  check('mid-review, "rate it 4" is the score', Boolean(a && took(a.text, 4, 'Hiring')), a?.text);
  a = await ask('Do more code reviews before handoff.');
  check('mid-review, a short comment that sounds like a request is a comment', Boolean(a && /36 characters/.test(a.text)) && (await state())?.answers[0].note === 'Do more code reviews before handoff.', a?.text);
  await ask('cancel');
  const hr = (await users().findOne({ userId: 'hrx' })) as unknown as Omit<User, 'profilePhotoUrl'>;
  check("HR asking for someone else's report goes on to the rest of Suwi (review_draft)", (await reviewChat(hr, "draft priya's review")) === null);

  // --- A sent review: shown, a comment changed, kept.
  a = await ask("edit sameer's review");
  check('a sent review is shown, asking what to change', Boolean(a && /already sent/.test(a.text) && /\| Ownership \(50%\) \| 4 of 5/.test(a.text)), a?.text);
  a = await ask('change the quality comment');
  check('"change the quality comment" asks for it, showing the one there', Boolean(a && /redo the \*\*Quality\*\* comment/.test(a.text) && /\*\*keep\*\*/.test(a.text) && /The comment now: "Two releases/.test(a.text)), a?.text);
  a = await ask('Too short.');
  check('a short new comment asks for more', Boolean(a && /10 characters/.test(a.text) && /65 more/.test(a.text)), a?.text);
  a = await ask('clear');
  a = await ask('keep');
  check('keep puts the sent comment back; the card updates the sent review', Boolean(a && /Kept the \*\*Quality\*\* comment/.test(a.text) && a.proposals[0] && /^Update/.test(a.proposals[0].title)), a?.text);
  await ask('cancel');

  // --- The quick model (stubbed): rewording kept only when it keeps the facts; one call a message.
  modelOn = true;
  calls = []; queue = ['{"reply":"Of course! <DRAFT>"}'];
  a = await ask('give review to kavya');
  check('model: a good rewording is used', Boolean(a && /^Of course! Sure, let's do \*\*Kavya Menon\*\*/.test(a.text)) && calls.join() === 'phrase', { text: a?.text, calls });
  calls = []; queue = ['{"reply":"Got it. How would you rate Kavya on **Hiring**, from 1 to 7?"}'];
  a = await ask('hmm');
  check('model: a rewording that changes a number is not used', Boolean(a && !/1 to 7/.test(a.text) && /1 to 5/.test(a.text)), a?.text);
  calls = []; queue = [new Error('down')];
  a = await ask('4');
  check('model: a failed call falls back to the plain reply', Boolean(a && took(a.text, 4, 'Hiring')), a?.text);
  await ask('back');
  calls = []; queue = ['{"aside":false,"parts":[{"kpi":"current","named":"","score":4,"outOf":null,"comment":"She is a superstar who hired brilliantly"}]}'];
  a = await ask('She did really well on hiring this cycle, I would go with four overall');
  const st = await state();
  check('model: a split whose comment is not the manager\'s words is not used', Boolean(a && st && st.answers[0].score === 4 && !/superstar/.test(st.answers[0].note ?? '')) && calls.join() === 'parse', { text: a?.text, note: st?.answers[0], calls });
  await ask('clear');
  calls = []; queue = [JSON.stringify({ aside: false, parts: [
    { kpi: hir.toHexString(), named: 'hiring', score: 4, outOf: null, comment: 'hired three designers this month and got all of them productive inside their first two weeks' },
    { kpi: ups.toHexString(), named: 'upskilling', score: 3, outOf: null, comment: 'finished the advanced animation course and now mentors two juniors on rigging' },
  ] })];
  a = await ask('On hiring I would say 4, she hired three designers this month and got all of them productive inside their first two weeks; and for upskilling a 3 since she finished the advanced animation course and now mentors two juniors on rigging');
  check('model: prose with two KPIs is split; only the gap is asked for', Boolean(a && /\*\*Hiring\*\* \(4\) and \*\*Upskilling\*\* \(3\)/.test(a.text) && /Quality of work/.test(a.text)) && calls.join() === 'parse', { text: a?.text, calls });
  calls = []; queue = ['{"aside":true,"parts":[]}'];
  await ask('Also, how many leaves does Kavya have left in quality of work season');
  check('model: a message it reads as another question waits as an aside', Boolean(aside()) && calls.join() === 'parse', { last_, calls });
  await ask('cancel');
  modelOn = false;
  Object.assign(reviewChatModel, realModel);

  // A manager's tools: only the team-safe ones.
  const ctx = contextFor({ ...mgr, dashboardScope: 'team' } as never, { ...DEFAULT_LEVELS, performance: 'act' }, new Date().toISOString().slice(0, 10));
  const names = toolsFor(ctx).map((t) => t.name).sort();
  check('a manager gets the team tools only', names.every((n) => ['attendance_summary', 'dashboard_help', 'person_details', 'prepare_save_review_draft', 'review_draft', 'search_people'].includes(n)) && names.includes('review_draft'), names);
  const search = (await import('../suwi/tools')).toolByName('search_people')!;
  const out = await search.run(ctx, {}) as { data: { rows?: { name: string }[]; people?: { name: string }[] } };
  const listed = JSON.stringify(out.data);
  check('people search sees their subtree only', /Meera/.test(listed) && /Deepa/.test(listed) && !/Priya/.test(listed), listed.slice(0, 300));

  await db.dropDatabase();
  await closeDb();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await closeDb().catch(() => undefined); process.exit(1); });
