/**
 * Most Likely's board says who tagged each person ("Tag by" on the Entries
 * page): every row carries its taggers, latest first, as they are on the
 * roster now — and a colleague the viewer blocked is gone from it the same
 * way they are gone from the board's counts.
 *
 * Runs against a scratch database, dropped after:
 *   MONGODB_DB=most_likely_taggers_scratch npx tsx src/scripts/most-likely-taggers-check.ts
 */
import { randomUUID } from 'node:crypto';
import { closeDb, connectDb, connectPosts, getDb, users } from '../config/db';
import { env } from '../config/env';
import type { ConnectCaptionEntry, ConnectPost } from '../models/connect.model';
import type { User } from '../models/user.model';
import { blockConnectPerson } from '../services/connect-blocks.service';
import { getConnectPost } from '../services/connect.service';

let failures = 0;
function check(label: string, passed: boolean, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

interface BoardRow {
  userId: string;
  votes: number;
  points: number;
  rank: number;
  taggedBy: Array<{
    userId: string;
    name: string;
    initials: string;
    designation: string;
    department: string;
    location: string;
    taggedAt?: Date;
  }>;
}

async function checks() {
  await connectDb();
  console.log(`\nusing scratch database "${env.mongoDbName}"`);
  const org = 'sowaka';
  const person = (userId: string, name: string, extra: Partial<User> = {}) =>
    ({
      userId,
      name,
      email: `${userId}@sowaka.check`,
      employeeId: userId,
      org,
      lifecycleStatus: 'active',
      ...extra,
    }) as unknown as User;
  await users().insertMany([
    person('viewer', 'Vera Viewer'),
    person('aarav', 'Aarav Mehta', { designation: '3D Artist', department: '3D', location: 'Gurugram' }),
    person('ishita', 'Ishita Rao', { designation: '3D Generalist', department: '3D', location: 'Gurugram' }),
    person('meera', 'Meera Nair', { designation: 'Rigging Artist', department: '3D' }),
    person('manav', 'Manav Shah'),
    person('kiran', 'Kiran Das'),
  ]);

  const start = Date.now() - 3_600_000;
  const tag = (by: string, byName: string, taggedUserId: string, taggedName: string, minute: number): ConnectCaptionEntry => ({
    id: randomUUID(),
    userId: by,
    // Stored at tag time; the board should read the roster instead.
    name: `${byName} (old)`,
    initials: '??',
    text: '',
    taggedUserId,
    taggedName,
    taggedInitials: taggedName.slice(0, 1),
    taggedDesignation: '',
    createdAt: new Date(start + minute * 60_000),
  });
  const postId = randomUUID();
  const post: ConnectPost = {
    id: postId,
    org,
    type: 'most_likely',
    tag: 'Most Likely',
    tagIcon: '',
    tagColor: '',
    tagTint: '',
    author: { userId: 'viewer', name: 'Vera Viewer', initials: 'VV', designation: '', avatarColor: '#000' },
    audience: { label: 'Public', org },
    body: {
      title: 'Lunch Thief',
      question: 'Who is most likely to steal your lunch?',
      pointsPerVote: 10,
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
    likedBy: [],
    comments: [],
    captionEntries: [
      tag('aarav', 'Aarav Mehta', 'manav', 'Manav Shah', 1),
      tag('ishita', 'Ishita Rao', 'manav', 'Manav Shah', 5),
      tag('meera', 'Meera Nair', 'kiran', 'Kiran Das', 3),
      // Someone since gone from the roster: their stored name stands in.
      tag('gone', 'Gone Person', 'manav', 'Manav Shah', 2),
      tag('kiran', 'Kiran Das', 'viewer', 'Vera Viewer', 4),
    ],
    captionVotes: {},
    publishedAt: new Date(start),
    createdAt: new Date(start),
    updatedAt: new Date(start),
  } as ConnectPost;
  await connectPosts().insertOne(post);

  const board = async (viewer: string) => {
    const view = await getConnectPost(viewer, postId);
    return ((view as { body: Record<string, unknown> }).body.leaderboard ?? []) as BoardRow[];
  };

  console.log('\nEvery row says who tagged them');
  const rows = await board('viewer');
  const manav = rows.find((row) => row.userId === 'manav');
  check('Manav leads with three tags', manav?.rank === 1 && manav.votes === 3 && manav.points === 30);
  check(
    'his taggers, latest first',
    JSON.stringify(manav?.taggedBy.map((t) => t.userId)) === JSON.stringify(['ishita', 'gone', 'aarav']),
    JSON.stringify(manav?.taggedBy.map((t) => t.userId)),
  );
  const aarav = manav?.taggedBy.find((t) => t.userId === 'aarav');
  check('a tagger is read from the roster, not the tag', aarav?.name === 'Aarav Mehta' && aarav.initials === 'AM');
  check(
    "with the sheet's role line parts",
    aarav?.designation === '3D Artist' && aarav.department === '3D' && aarav.location === 'Gurugram',
  );
  const gone = manav?.taggedBy.find((t) => t.userId === 'gone');
  check('someone off the roster keeps the name stored with the tag', gone?.name === 'Gone Person (old)');
  check('each tagger has when they tagged', manav?.taggedBy.every((t) => t.taggedAt instanceof Date) === true);
  const mine = rows.find((row) => row.userId === 'viewer');
  check('the person named sees who tagged them too', mine?.taggedBy.map((t) => t.userId).join() === 'kiran');

  console.log('\nBlocking hides the same people the board already hides');
  await blockConnectPerson('viewer', 'ishita');
  await blockConnectPerson('viewer', 'kiran');
  const blocked = await board('viewer');
  const manavNow = blocked.find((row) => row.userId === 'manav');
  check(
    "a blocked tagger's tag neither counts nor shows",
    manavNow?.votes === 2 && !manavNow.taggedBy.some((t) => t.userId === 'ishita'),
    JSON.stringify(manavNow?.taggedBy.map((t) => t.userId)),
  );
  check('a blocked colleague has no row', !blocked.some((row) => row.userId === 'kiran'));
  check(
    'nor appears as a tagger on anyone else',
    !blocked.some((row) => row.taggedBy.some((t) => t.userId === 'kiran')),
  );
  const other = await board('aarav');
  check(
    "someone else's view is unaffected by the viewer's blocks",
    other.find((row) => row.userId === 'manav')?.taggedBy.length === 3 && other.some((row) => row.userId === 'kiran'),
  );
}

async function main() {
  if (!/scratch/i.test(env.mongoDbName)) {
    console.log(`\nskipping: "${env.mongoDbName}" is not a scratch database (MONGODB_DB=most_likely_taggers_scratch)`);
    return;
  }
  try {
    await checks();
  } finally {
    await getDb().dropDatabase();
    console.log(`\ndropped scratch database "${env.mongoDbName}"`);
    await closeDb();
  }
}

main()
  .catch((error) => {
    console.error('\ncheck crashed:', error);
    failures += 1;
  })
  .finally(() => {
    console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  });
