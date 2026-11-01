/**
 * Scratch-database check of several entries per person in a contest:
 *
 *   MONGODB_DB=contest_entries_scratch NOTIFY_ORGS=nobody-scratch npm run contest-entries:check
 *
 * Up to MAX_ENTRIES_PER_PERSON (5) entries each in a caption or photo
 * contest, Most Likely still one; the app's "add" stays offered (myEntryId
 * null) until the limit; deleting takes the entry named, or the latest from
 * an app that does not name one; one vote each, never for one's own.
 *
 * Also: who voted for an entry (the "Voted by" list), shown to anyone who
 * can see the contest, without anyone the viewer has blocked; a photo entry
 * deleted by its id; and colleagues tagged with "@" in an entry's words,
 * kept only while their name is in the text and never paid its points.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, connectBlocks, connectDb, connectPosts, getDb, users } from '../config/db';
import {
  addCaptionEntry,
  getCaptionEntryVoters,
  MAX_ENTRIES_PER_PERSON,
  removeCaptionEntry,
  voteOnCaptionEntry,
} from '../services/connect.service';

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

const ORG = 'contest-scratch';
const person = (userId: string, name: string, org = ORG) => ({ userId, name, email: `${userId}@sowaka.test`, org, lifecycleStatus: 'active', points: 0 });
const contest = (type: string) => ({
  id: randomUUID(), org: ORG, type, tag: 'Contest',
  author: { userId: 'hr', name: 'HR', initials: 'H' },
  audience: { kind: 'public', label: 'Public' },
  body: { title: 'Caption this', task: 'Write one', pointsPerVote: 10, captionLimit: 140, closesAt: new Date(Date.now() + 86_400_000).toISOString() },
  likedBy: [], comments: [], captionEntries: [], captionVotes: {},
  publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
});

type Mention = { userId: string; name: string };
type View = {
  body: {
    myEntryId?: string | null;
    myEntryIds?: string[];
    maxEntries?: number;
    entries?: { id: string; text: string; isMine: boolean; votes: number; mentions?: Mention[] }[];
    leaderboard?: { id: string; mentions?: Mention[] }[];
  };
};

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'contest_entries_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany([
    person('hr', 'HR'), person('asha', 'Asha'), person('bala', 'Bala'),
    person('chitra', 'Chitra Rao'), person('dev', 'Dev'), person('zed', 'Zed', 'other-scratch'),
  ] as never[]);
  const caption = contest('caption_challenge');
  const likely = contest('most_likely');
  const photo = contest('photo_story_challenge');
  const poll = { ...contest('caption_challenge'), id: randomUUID(), type: 'poll' };
  await connectPosts().insertMany([caption, likely, photo, poll] as never[]);

  let view: View | null = null;
  for (let i = 1; i <= MAX_ENTRIES_PER_PERSON; i++) {
    view = (await addCaptionEntry('asha', caption.id, `Asha's entry ${i}`)) as unknown as View;
    if (i < MAX_ENTRIES_PER_PERSON) {
      check(`after entry ${i}, the app still offers another (myEntryId null)`, view.body.myEntryId === null && view.body.myEntryIds?.length === i, view.body);
    }
  }
  check('five entries in', view?.body.myEntryIds?.length === 5 && view.body.maxEntries === 5, view?.body);
  check('at five, the app stops offering (myEntryId set)', typeof view?.body.myEntryId === 'string', view?.body.myEntryId);
  check('all marked as hers', view?.body.entries?.filter((e) => e.isMine).length === 5, view?.body.entries);
  const sixth = await refusal(() => addCaptionEntry('asha', caption.id, 'one more'));
  check('a sixth is refused, saying the limit', sixth?.status === 409 && /5 times/.test(sixth.message ?? ''), sixth);

  const second = view!.body.myEntryIds![1];
  const afterNamed = (await removeCaptionEntry('asha', caption.id, second)) as unknown as View;
  check('deleting a named entry takes that one', !afterNamed.body.myEntryIds?.includes(second) && afterNamed.body.myEntryIds?.length === 4, afterNamed.body.myEntryIds);
  check('below five again: the app offers another', afterNamed.body.myEntryId === null, afterNamed.body.myEntryId);
  const afterOld = (await removeCaptionEntry('asha', caption.id)) as unknown as View;
  const texts = afterOld.body.entries?.filter((e) => e.isMine).map((e) => e.text);
  check("an old app's delete (no id) takes the latest", texts?.length === 3 && !texts.includes("Asha's entry 5"), texts);
  check("someone else's entry cannot be deleted by naming it", (await refusal(() => removeCaptionEntry('bala', caption.id, afterOld.body.myEntryIds![0])))?.status === 404);

  const own = await refusal(() => voteOnCaptionEntry('asha', caption.id, afterOld.body.myEntryIds![0]));
  check('never a vote for one of her own', own?.status === 400, own);
  await voteOnCaptionEntry('bala', caption.id, afterOld.body.myEntryIds![0]);
  const moved = (await voteOnCaptionEntry('bala', caption.id, afterOld.body.myEntryIds![1])) as unknown as { body: { myVoteEntryId?: string } };
  check('one vote each: voting again moves it', moved.body.myVoteEntryId === afterOld.body.myEntryIds![1], moved.body);

  await addCaptionEntry('asha', likely.id, '', undefined, 'bala');
  const again = await refusal(() => addCaptionEntry('asha', likely.id, '', undefined, 'hr'));
  check('Most Likely stays one nomination each', again?.status === 409 && /already tagged/.test(again.message ?? ''), again);

  // ---- Who voted for whom ------------------------------------------------
  const target = afterOld.body.myEntryIds![1]; // Bala's vote is already here.
  await voteOnCaptionEntry('dev', caption.id, target);
  await voteOnCaptionEntry('chitra', caption.id, afterOld.body.myEntryIds![0]);
  const voters = await getCaptionEntryVoters('hr', caption.id, target);
  check('voted by: everyone who voted for it, A-Z, as anyone in the contest sees it',
    JSON.stringify(voters.map((v) => v.userId)) === JSON.stringify(['bala', 'dev']), voters);
  check('voted by: rows carry a name, initials and department like the likes list',
    voters[0]?.name === 'Bala' && voters[0]?.initials === 'B' && 'department' in voters[0], voters[0]);
  const forOwner = await getCaptionEntryVoters('asha', caption.id, target);
  check("voted by: the entry's owner sees the same list", forOwner.length === 2, forOwner);
  const other = await getCaptionEntryVoters('hr', caption.id, afterOld.body.myEntryIds![0]);
  check('voted by: only the votes on that entry', JSON.stringify(other.map((v) => v.userId)) === JSON.stringify(['chitra']), other);
  await connectBlocks().insertOne({ userId: 'hr', blockedUserId: 'dev', org: ORG, createdAt: new Date() } as never);
  const blockedOut = await getCaptionEntryVoters('hr', caption.id, target);
  check('voted by: someone the viewer blocked is left out',
    JSON.stringify(blockedOut.map((v) => v.userId)) === JSON.stringify(['bala']), blockedOut);
  await connectBlocks().insertOne({ userId: 'chitra', blockedUserId: 'asha', org: ORG, createdAt: new Date() } as never);
  const ofBlocked = await refusal(() => getCaptionEntryVoters('chitra', caption.id, target));
  check("voted by: an entry by someone the viewer blocked is not found", ofBlocked?.status === 404, ofBlocked);
  check('voted by: an unknown entry is not found', (await refusal(() => getCaptionEntryVoters('hr', caption.id, 'nope')))?.status === 404);
  check('voted by: not a contest, refused', (await refusal(() => getCaptionEntryVoters('hr', poll.id, target)))?.status === 400);
  check('voted by: a colleague from another company cannot read it', (await refusal(() => getCaptionEntryVoters('zed', caption.id, target)))?.status === 404);
  const freshEntry = ((await addCaptionEntry('bala', caption.id, 'No votes yet')) as unknown as View).body.entries!.find((e) => e.text === 'No votes yet')!;
  check('voted by: an entry with no votes lists nobody', (await getCaptionEntryVoters('hr', caption.id, freshEntry.id)).length === 0);

  // ---- Deleting one of several photo entries ------------------------------
  // Put in as the upload would leave them, without a picture in a bucket.
  const photoEntry = (id: string, at: number) => ({ id, userId: 'asha', name: 'Asha', initials: 'A', text: `Snap ${id}`, createdAt: new Date(at) });
  await connectPosts().updateOne({ id: photo.id }, { $set: { captionEntries: [photoEntry('p1', 1000), photoEntry('p2', 2000), photoEntry('p3', 3000)] } });
  await voteOnCaptionEntry('bala', photo.id, 'p1');
  const afterPhoto = (await removeCaptionEntry('asha', photo.id, 'p1')) as unknown as View;
  check('a photo entry is deleted by its id, not the latest',
    JSON.stringify(afterPhoto.body.myEntryIds) === JSON.stringify(['p2', 'p3']), afterPhoto.body.myEntryIds);
  const released = await voteOnCaptionEntry('bala', photo.id, 'p2') as unknown as { body: { myVoteEntryId?: string } };
  check('its vote is released to go elsewhere', released.body.myVoteEntryId === 'p2', released.body);

  // ---- Tagging a colleague in an entry's words ----------------------------
  const ashaBefore = (await users().findOne({ userId: 'asha' }))?.points ?? 0;
  const chitraBefore = (await users().findOne({ userId: 'chitra' }))?.points ?? 0;
  await removeCaptionEntry('bala', caption.id, freshEntry.id);
  const tagged = (await addCaptionEntry(
    'bala', caption.id, 'Me and @Chitra Rao after the offsite, @Asha took it',
    undefined, undefined, ['chitra', 'asha', 'dev', 'bala', 'zed'],
  )) as unknown as View;
  const taggedEntry = tagged.body.entries!.find((e) => e.text.startsWith('Me and'))!;
  const names = (taggedEntry.mentions ?? []).map((m) => m.userId).sort();
  check('tags: kept only for names in the text, never the writer or another company',
    JSON.stringify(names) === JSON.stringify(['asha', 'chitra']), taggedEntry.mentions);
  check('tags: the name is the one the roster has', taggedEntry.mentions?.find((m) => m.userId === 'chitra')?.name === 'Chitra Rao', taggedEntry.mentions);
  check('tags: carried on the leaderboard too', (tagged.body.leaderboard?.find((e) => e.id === taggedEntry.id)?.mentions ?? []).length === 2, tagged.body.leaderboard);
  const balaBefore = (await users().findOne({ userId: 'bala' }))?.points ?? 0;
  // HR has not voted on this contest yet, so nobody else's points move.
  await voteOnCaptionEntry('hr', caption.id, taggedEntry.id);
  const points = {
    asha: [ashaBefore, (await users().findOne({ userId: 'asha' }))?.points ?? 0],
    chitra: [chitraBefore, (await users().findOne({ userId: 'chitra' }))?.points ?? 0],
    bala: [balaBefore, (await users().findOne({ userId: 'bala' }))?.points ?? 0],
  };
  check('tags: a vote pays the writer, not the people tagged',
    points.asha[0] === points.asha[1] && points.chitra[0] === points.chitra[1] && points.bala[1] === points.bala[0] + 10, points);
  const plain = (await addCaptionEntry('dev', caption.id, 'No tags here', undefined, undefined)) as unknown as View;
  check('tags: an entry from an app that sends none has no mentions field',
    plain.body.entries!.find((e) => e.text === 'No tags here')?.mentions === undefined, plain.body.entries);
  const notInText = (await addCaptionEntry('chitra', caption.id, 'A tag I deleted', undefined, undefined, ['dev'])) as unknown as View;
  check('tags: a tag deleted while typing is not sent', notInText.body.entries!.find((e) => e.text === 'A tag I deleted')?.mentions === undefined);

  await db.dropDatabase();
  await closeDb();
  console.log(failed === 0 ? '\nall contest-entries checks passed' : `\n${failed} check(s) failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
