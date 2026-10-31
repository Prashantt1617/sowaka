/**
 * Scratch-database check of several entries per person in a contest:
 *
 *   MONGODB_DB=contest_entries_scratch NOTIFY_ORGS=nobody-scratch npm run contest-entries:check
 *
 * Up to MAX_ENTRIES_PER_PERSON (5) entries each in a caption or photo
 * contest, Most Likely still one; the app's "add" stays offered (myEntryId
 * null) until the limit; deleting takes the entry named, or the latest from
 * an app that does not name one; one vote each, never for one's own.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, connectDb, connectPosts, getDb, users } from '../config/db';
import { addCaptionEntry, MAX_ENTRIES_PER_PERSON, removeCaptionEntry, voteOnCaptionEntry } from '../services/connect.service';

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
const person = (userId: string, name: string) => ({ userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active' });
const contest = (type: string) => ({
  id: randomUUID(), org: ORG, type, tag: 'Contest',
  author: { userId: 'hr', name: 'HR', initials: 'H' },
  audience: { kind: 'public', label: 'Public' },
  body: { title: 'Caption this', task: 'Write one', pointsPerVote: 10, captionLimit: 140, closesAt: new Date(Date.now() + 86_400_000).toISOString() },
  likedBy: [], comments: [], captionEntries: [], captionVotes: {},
  publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
});

type View = { body: { myEntryId?: string | null; myEntryIds?: string[]; maxEntries?: number; entries?: { id: string; text: string; isMine: boolean }[] } };

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'contest_entries_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany([person('hr', 'HR'), person('asha', 'Asha'), person('bala', 'Bala')] as never[]);
  const caption = contest('caption_challenge');
  const likely = contest('most_likely');
  await connectPosts().insertMany([caption, likely] as never[]);

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

  await db.dropDatabase();
  await closeDb();
  console.log(failed === 0 ? '\nall contest-entries checks passed' : `\n${failed} check(s) failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
