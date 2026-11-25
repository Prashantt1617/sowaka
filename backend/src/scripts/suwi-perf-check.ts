/**
 * Checks Suwi's performance and feed skills (24 Nov): KPI parameters (add, reword, rename, retire,
 * delete-or-retire, with Undo), drafting a review (saves nothing) and saving it as a draft for one's own
 * direct report, moderating reported posts and comments, pinning posts within the limit, and starting a
 * Most Likely contest. Each runs the tool, then the card's Confirm (and Undo), and reads the database.
 * On a scratch database only:
 *   npm run suwi-perf:check
 */
import { ObjectId } from 'mongodb';
import { connectDb, connectPosts, contentReports, feedbackRecords, getDb, kpiAssignments, kpiParameters, users } from '../config/db';
import type { User } from '../models/user.model';
import { currentPeriodFor, previousPeriod } from '../services/cycle';
import { confirmProposal, getProposal, undoProposal } from '../suwi/proposals';
import '../suwi/registry';
import { contextFor, SUWI_AREAS, toolByName, type SuwiArea, type SuwiLevel } from '../suwi/tools';
import { reviewDraftModel } from '../suwi/tools/review-draft';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
async function refused(run: () => Promise<unknown>) {
  try { await run(); return null; } catch (e) { return (e as Error).message; }
}
const ORG = 'acme';
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId[0].toUpperCase() + userId.slice(1), email: `${userId}@x.test`, org: ORG, lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), employeeId: `E-${userId}`, managerUserId: 'founder', ...extra,
} as User);
const post = (id: string, authorId: string, text: string, extra: Record<string, unknown> = {}) => ({
  id, org: ORG, type: 'new_post', tag: 'Post', tagIcon: '', tagColor: '', tagTint: '',
  author: { userId: authorId, name: authorId[0].toUpperCase() + authorId.slice(1), initials: 'X', designation: '', avatarColor: '' },
  audience: { label: 'Public', org: ORG }, body: { postKind: 'text', text }, likedBy: [], comments: [], actionBy: {}, pollVotes: {},
  publishedAt: new Date(Date.now() - 86_400_000), createdAt: new Date(), updatedAt: new Date(), ...extra,
});
const report = (id: string, postId: string, authorId: string, excerpt: string, commentId?: string) => ({
  id, org: ORG, postId, ...(commentId ? { commentId } : {}), reason: 'spam', reporterUserId: 'ravi', reporterName: 'Ravi',
  authorUserId: authorId, authorName: authorId[0].toUpperCase() + authorId.slice(1), excerpt, postTag: 'Post', status: 'open', createdAt: new Date(),
});

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  await users().insertMany([
    person('founder', { dashboardAccess: true, dashboardAdmin: true, canCreateContests: true, managerUserId: undefined }),
    person('rohan', { name: 'Rohan Mehta', designation: 'Engineer' }), person('asha'), person('ravi'),
    person('manav'), person('kiran', { managerUserId: 'manav' }),
  ]);
  const levels = Object.fromEntries(SUWI_AREAS.map((a) => [a.key, 'act'])) as Record<SuwiArea, SuwiLevel>;
  const ctx = contextFor((await users().findOne({ userId: 'founder' }))!, levels, today);
  const manavCtx = contextFor((await users().findOne({ userId: 'manav' }))!, levels, today);
  for (const n of ['prepare_kpi_parameters', 'review_draft', 'prepare_save_review_draft', 'prepare_moderate_reports', 'prepare_pin_posts', 'prepare_contest']) ok(`${n} is registered`, Boolean(toolByName(n)));

  // —— KPI parameters ——
  const period = await currentPeriodFor(ORG);
  const prev = previousPeriod(period);
  const ids = { ownership: new ObjectId(), punctuality: new ObjectId(), quality: new ObjectId(), old: new ObjectId(), spare: new ObjectId(), spare2: new ObjectId() };
  const param = (_id: ObjectId, title: string, description: string) => ({ _id, org: ORG, title, description, archived: false, createdAt: new Date(), updatedAt: new Date() });
  await kpiParameters().insertMany([
    param(ids.ownership, 'Ownership', 'Takes work end to end without being chased.'),
    param(ids.punctuality, 'Punctuality', 'On time, every day.'),
    param(ids.quality, 'Quality', 'Work that needs little rework.'),
    param(ids.old, 'Old metric', 'No longer used.'),
    param(ids.spare, 'Spare', 'Unused.'),
    param(ids.spare2, 'Spare two', 'Unused too.'),
  ] as never[]);
  const hex = (o: ObjectId) => o.toHexString();
  await kpiAssignments().insertMany([
    { org: ORG, userId: 'rohan', period, parameterIds: [hex(ids.ownership), hex(ids.punctuality)], weights: { [hex(ids.ownership)]: 60, [hex(ids.punctuality)]: 40 } },
    { org: ORG, userId: 'kiran', period, parameterIds: [hex(ids.ownership)], weights: { [hex(ids.ownership)]: 100 } },
  ] as never[]);

  console.log('KPI parameters: one card for many changes');
  const kp = toolByName('prepare_kpi_parameters')!;
  const k = await kp.run(ctx, { changes: [
    { action: 'add', title: 'Client feedback', guidance: 'What clients said about the work this cycle.' },
    { action: 'guidance', title: 'Quality', guidance: 'Work that ships right the first time.' },
    { action: 'retire', title: 'Old metric' },
    { action: 'delete', title: 'Ownership' },
    { action: 'delete', title: 'Spare' },
    { action: 'rename', title: 'Spare two', newTitle: 'Initiative' },
    { action: 'rename', title: 'Ownership', newTitle: 'Accountability' },
  ] });
  const kc = await getProposal('founder', ORG, k.proposalId!);
  ok('one card for six changes', /6 KPI parameter changes/.test(kc.title), kc.title);
  ok('the in-use parameter is retired, not deleted, and the card says so', kc.lines.some((l) => /"Ownership" is not deleted/.test(l.text) && /being reviewed on it/.test(l.text)), kc.lines);
  ok('renaming a parameter in use is left out with the reason', kc.lines.some((l) => /Left out: .*Ownership.*title is fixed/.test(l.text)), kc.lines);
  ok('the new guidance waits for the next cycle', kc.lines.some((l) => /"Quality": new guidance .* from the/.test(l.text)), kc.lines);
  ok('nothing changes before Confirm', (await kpiParameters().countDocuments({ org: ORG })) === 6 && !(await kpiParameters().findOne({ _id: ids.quality }))?.pendingEdit);
  const kd = await confirmProposal('founder', ORG, k.proposalId!);
  const P = async (title: string) => kpiParameters().findOne({ org: ORG, title });
  ok('Confirm adds Client feedback', Boolean(await P('Client feedback')), kd.message);
  ok('Quality gets a staged edit', (await kpiParameters().findOne({ _id: ids.quality }))?.pendingEdit?.description === 'Work that ships right the first time.');
  ok('Old metric is retired', (await kpiParameters().findOne({ _id: ids.old }))?.archived === true);
  ok('Ownership is retired and still there', (await kpiParameters().findOne({ _id: ids.ownership }))?.archived === true);
  ok('Spare is deleted', !(await kpiParameters().findOne({ _id: ids.spare })));
  ok('Spare two is now Initiative', !(await P('Spare two')) && Boolean(await P('Initiative')));
  const ku = await undoProposal('founder', ORG, k.proposalId!);
  ok('Undo removes Client feedback and Initiative, brings back Spare and Spare two', !(await P('Client feedback')) && !(await P('Initiative')) && Boolean(await P('Spare')) && Boolean(await P('Spare two')), ku.message);
  ok('Undo un-retires Ownership and Old metric, drops the staged edit', (await kpiParameters().findOne({ _id: ids.ownership }))?.archived === false && (await kpiParameters().findOne({ _id: ids.old }))?.archived === false && !(await kpiParameters().findOne({ _id: ids.quality }))?.pendingEdit, ku.message);

  // —— Review draft ——
  console.log('Draft a review: saves nothing');
  await feedbackRecords().insertOne({
    managerUserId: 'founder', employeeUserId: 'rohan', period: prev, status: 'sent', overallScore: 3.6, extra: 'Solid month.',
    parameters: [
      { parameterId: hex(ids.ownership), name: 'Ownership', weight: 60, score: 4, note: 'Took the billing migration end to end and kept everyone informed.' },
      { parameterId: hex(ids.punctuality), name: 'Punctuality', weight: 40, score: 3, note: 'A few late starts on Mondays.' },
    ],
    createdAt: new Date(), updatedAt: new Date(), sentAt: new Date(),
  } as never);
  await connectPosts().insertOne(post('kudos-1', 'asha', '', { type: 'kudos', tag: 'Kudos', body: { text: 'Thanks for staying late to fix the release.', personName: 'Rohan Mehta', personUserId: 'rohan' }, publishedAt: new Date() }) as never);
  reviewDraftModel.configured = () => false;
  const rd = await toolByName('review_draft')!.run(ctx, { person: 'Rohan' });
  const draft = rd.data as { drafted: boolean; saved: boolean; draft: { parameter: string; suggestedScore: number; comment: string }[]; canSaveAsDraft: boolean };
  ok('a draft for both parameters', draft.drafted && draft.draft.length === 2, rd.data);
  ok('every comment is at least 75 characters', draft.draft.every((d) => d.comment.length >= 75), draft.draft.map((d) => d.comment.length));
  ok('every score is 1 to 5', draft.draft.every((d) => d.suggestedScore >= 1 && d.suggestedScore <= 5));
  ok('grounded: the earlier score and the shout-out are quoted', /scored Rohan 4 of 5/.test(draft.draft[0].comment) && /Shout-out on Connect from Asha/.test(draft.draft[0].comment), draft.draft[0].comment);
  ok('nothing is saved', !draft.saved && (await feedbackRecords().countDocuments({ period })) === 0);
  ok('the asker is Rohan\'s manager, so it can be saved', draft.canSaveAsDraft === true);

  reviewDraftModel.configured = () => true;
  reviewDraftModel.call = async () => ({ content: [{ type: 'text', text: JSON.stringify({ parameters: [{ id: hex(ids.ownership), score: 5, comment: 'Rohan carried last cycle\'s ownership into this one; a colleague thanked him on Connect for staying late to fix the release.' }, { id: hex(ids.punctuality), score: 1, comment: 'Too short.' }], closingNote: 'A steady cycle.' }) }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 }, model: 'stub' });
  const rm = await toolByName('review_draft')!.run({ ...ctx }, { person: 'rohan', period });
  const dm = (rm.data as { draft: { suggestedScore: number; comment: string }[]; closingNote: string | null }).draft;
  ok('the model\'s comment is used where it is long enough', /thanked him on Connect/.test(dm[0].comment) && dm[0].suggestedScore === 5, dm[0]);
  ok('a too-short model comment falls back to the facts', dm[1].comment.length >= 75 && dm[1].suggestedScore !== 1, dm[1]);

  console.log('Save the draft for a direct report');
  const s1 = await toolByName('prepare_save_review_draft')!.run(ctx, { person: 'Rohan', parameters: [{ parameter: 'Punctuality', score: 3, comment: 'Mostly on time this cycle; keep the Monday starts as steady as the rest of the week please.' }] });
  const s1c = await getProposal('founder', ORG, s1.proposalId!);
  ok('the card says it is a draft, not sent', /NOT sent/.test(s1c.summary) && s1c.lines.some((l) => /Punctuality \(40%\): 3 of 5/.test(l.text)), s1c);
  ok('no Undo offered when there was no earlier draft', s1c.undoable === false);
  ok('nothing saved before Confirm', (await feedbackRecords().countDocuments({ period })) === 0);
  await confirmProposal('founder', ORG, s1.proposalId!);
  const rec = await feedbackRecords().findOne({ employeeUserId: 'rohan', period });
  ok('Confirm saves a draft (status saved, never sent)', rec?.status === 'saved' && !rec.sentAt && rec.parameters.length === 2 && rec.parameters[1].score === 3, rec);
  const s2 = await toolByName('prepare_save_review_draft')!.run(ctx, { person: 'Rohan', parameters: [{ parameter: 'Ownership', score: 2, comment: 'x'.repeat(80) }, { parameter: 'Punctuality', score: 4, comment: 'y'.repeat(80) }] });
  ok('replacing a draft offers Undo', (await getProposal('founder', ORG, s2.proposalId!)).undoable === true);
  await confirmProposal('founder', ORG, s2.proposalId!);
  ok('the new draft is saved', (await feedbackRecords().findOne({ employeeUserId: 'rohan', period }))?.parameters[0].score === 2);
  await undoProposal('founder', ORG, s2.proposalId!);
  ok('Undo puts the earlier draft back', (await feedbackRecords().findOne({ employeeUserId: 'rohan', period }))?.parameters[1].score === 3);
  ok('someone else\'s report is refused', /own manager/.test(await refused(() => toolByName('prepare_save_review_draft')!.run(ctx, { person: 'Kiran' })) ?? ''));
  await feedbackRecords().updateOne({ employeeUserId: 'rohan', period }, { $set: { status: 'sent', sentAt: new Date() } });
  ok('a review already sent is never overwritten', /already sent/.test(await refused(() => toolByName('prepare_save_review_draft')!.run(ctx, { person: 'Rohan' })) ?? ''));

  // —— Moderation ——
  console.log('Moderate reported content');
  await connectPosts().insertMany([
    post('p1', 'asha', 'Team lunch on Friday', { comments: [
      { id: 'c1', userId: 'kiran', name: 'Kiran', text: 'Buy my crypto course!!!', createdAt: new Date(), likedBy: [] },
      { id: 'c1r', userId: 'asha', name: 'Asha', text: 'Not here please', createdAt: new Date(), likedBy: [], parentId: 'c1' },
      { id: 'c2', userId: 'ravi', name: 'Ravi', text: 'Count me in', createdAt: new Date(), likedBy: [] },
    ] }),
    post('p2', 'kiran', 'Spam spam spam'),
    post('p3', 'asha', 'Who else thinks the new chairs are bad?'),
  ] as never[]);
  await contentReports().insertMany([
    report('r1', 'p1', 'kiran', 'Buy my crypto course!!!', 'c1'), report('r2', 'p2', 'kiran', 'Spam spam spam'),
    report('r3', 'p2', 'kiran', 'Spam spam spam'), report('r4', 'p3', 'asha', 'Who else thinks the new chairs are bad?'),
  ] as never[]);
  const mod = toolByName('prepare_moderate_reports')!;
  ok('"hide" is explained, not faked', /no hide/.test(await refused(() => mod.run(ctx, { action: 'hide', reportIds: ['r1'] })) ?? ''));
  const m1 = await mod.run(ctx, { action: 'remove', reportIds: ['r1'] });
  const m1c = await getProposal('founder', ORG, m1.proposalId!);
  ok('the card quotes the comment and says removal cannot be undone', m1c.lines.some((l) => /Kiran's comment: "Buy my crypto course!!!"/.test(l.text)) && m1c.undoable === false && m1c.lines.some((l) => /cannot be undone/.test(l.text)), m1c.lines);
  ok('nothing removed before Confirm', (await connectPosts().findOne({ id: 'p1' }))?.comments.length === 3);
  await confirmProposal('founder', ORG, m1.proposalId!);
  const p1 = await connectPosts().findOne({ id: 'p1' });
  ok('Confirm removes the comment and its reply, the post and other comment stay', p1?.comments.map((c) => c.id).join() === 'c2', p1?.comments);
  ok('its report is closed as actioned', (await contentReports().findOne({ id: 'r1' }))?.status === 'actioned');
  const m2 = await mod.run(ctx, { action: 'remove', reportIds: ['r2', 'r3'] });
  ok('two reports on one post: one removal', /Remove 1 reported post/.test((await getProposal('founder', ORG, m2.proposalId!)).title));
  await confirmProposal('founder', ORG, m2.proposalId!);
  ok('the post is gone and both reports closed', !(await connectPosts().findOne({ id: 'p2' })) && (await contentReports().countDocuments({ id: { $in: ['r2', 'r3'] }, status: 'actioned' })) === 2);
  const m3 = await mod.run(ctx, { action: 'dismiss', reportIds: ['r4', 'r1'], note: 'Fair comment' });
  const m3c = await getProposal('founder', ORG, m3.proposalId!);
  ok('an already-closed report is left out', m3c.preview?.skipped.some((s) => /Already actioned/.test(s.reason)) === true, m3c.preview);
  await confirmProposal('founder', ORG, m3.proposalId!);
  ok('dismiss closes the report and keeps the post', (await contentReports().findOne({ id: 'r4' }))?.status === 'dismissed' && Boolean(await connectPosts().findOne({ id: 'p3' })));
  await undoProposal('founder', ORG, m3.proposalId!);
  ok('Undo reopens it', (await contentReports().findOne({ id: 'r4' }))?.status === 'open');

  // —— Pins ——
  console.log('Pin within the limit of three');
  const later = new Date(Date.now() + 3 * 86_400_000);
  await connectPosts().insertMany([
    post('pa', 'asha', 'Pinned A', { pinnedUntil: later }), post('pb', 'asha', 'Pinned B', { pinnedUntil: later }), post('pc', 'asha', 'Pinned C', { pinnedUntil: later }),
  ] as never[]);
  const pin = toolByName('prepare_pin_posts')!;
  ok('a fourth pin is refused, naming the three', /3 posts can be pinned at once.*Pinned A/.test(await refused(() => pin.run(ctx, { pin: ['p3'] })) ?? ''));
  const until = new Date(Date.now() + 5 * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const pn = await pin.run(ctx, { pin: ['new chairs'], unpin: ['pa'], until });
  const pnc = await getProposal('founder', ORG, pn.proposalId!);
  ok('one card unpins A and pins the chairs post', /Unpin 1 post and pin 1 post/.test(pnc.title) && pnc.lines.some((l) => /Pinned after this: 3 of 3/.test(l.text)), pnc);
  ok('nothing changes before Confirm', !(await connectPosts().findOne({ id: 'p3' }))?.pinnedUntil);
  await confirmProposal('founder', ORG, pn.proposalId!);
  const p3 = await connectPosts().findOne({ id: 'p3' });
  ok('Confirm pins the chairs post until 18:00 IST that day, and unpins A', p3?.pinnedUntil?.toISOString() === new Date(`${until}T18:00:00+05:30`).toISOString() && !(await connectPosts().findOne({ id: 'pa' }))?.pinnedUntil, p3?.pinnedUntil);
  await undoProposal('founder', ORG, pn.proposalId!);
  ok('Undo puts the pins back', !(await connectPosts().findOne({ id: 'p3' }))?.pinnedUntil && (await connectPosts().findOne({ id: 'pa' }))?.pinnedUntil?.getTime() === later.getTime());

  // —— Contest ——
  console.log('Start a Most Likely contest');
  const contest = toolByName('prepare_contest')!;
  const friday = new Date(Date.now() + 3 * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
  ok('Caption this points to the composer', /needs the picture/.test(await refused(() => contest.run(ctx, { type: 'caption_this', text: 'Caption this' })) ?? ''));
  ok('someone without "Can create contests" is refused', /not allowed to start contests/.test(await refused(() => contest.run(manavCtx, { type: 'most_likely', text: 'x', closesOn: friday })) ?? ''));
  const ct = await contest.run(ctx, { type: 'most_likely', text: 'most likely to fix the printer', closesOn: friday });
  const ctc = await getProposal('founder', ORG, ct.proposalId!);
  ok('the card shows the post as it will appear and when it closes', /Sowaka Engagement · 10 pts per vote received\nMost likely to fix the printer\nNominate the teammate who fits this tag\nCloses \w+day, 6 pm/.test(ctc.summary), ctc.summary);
  ok('nothing is posted before Confirm', (await connectPosts().countDocuments({ type: 'most_likely' })) === 0);
  await confirmProposal('founder', ORG, ct.proposalId!);
  const live = await connectPosts().findOne({ type: 'most_likely' });
  ok('Confirm posts it with the tag, closing time and points', live?.body.title === 'Most likely to fix the printer' && live.body.closesAt === new Date(`${friday}T18:00:00+05:30`).toISOString() && live.body.pointsPerVote === 10 && live.body.official === true, live?.body);
  await undoProposal('founder', ORG, ct.proposalId!);
  ok('Undo deletes it', (await connectPosts().countDocuments({ type: 'most_likely' })) === 0);

  await db.dropDatabase();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
