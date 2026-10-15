/**
 * Birthday and anniversary cards in the feed: the celebrant's own card pinned
 * at the top of their feed for their day only, paging around it, and the key
 * everyone else's app clubs one day's cards by.
 *
 * The rules in `services/connect-celebrations.ts` are pure and run without a
 * database. The feed itself runs against a scratch database, dropped after:
 *   MONGODB_DB=connect_celebrations_scratch npx tsx src/scripts/connect-celebrations-check.ts
 * Without a scratch name only the pure part runs.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, connectDb, connectPosts, getDb, users } from '../config/db';
import { env } from '../config/env';
import type { ConnectPost, ConnectPostType } from '../models/connect.model';
import type { User } from '../models/user.model';
import {
  celebrantPinKeys,
  celebrationGroupFor,
  isPinnedForCelebrant,
  istDateKey,
} from '../services/connect-celebrations';
import { getConnectFeed } from '../services/connect.service';

let failures = 0;
function check(label: string, passed: boolean, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

// ------------------------------------------------------------- the rules

console.log('\nThe day is the India day');
// Midnight in India is 18:30 UTC the evening before.
check('18:29 UTC is still the 14th', istDateKey(new Date('2026-10-14T18:29:59Z')) === '2026-10-14');
check('18:30 UTC is already the 15th', istDateKey(new Date('2026-10-14T18:30:00Z')) === '2026-10-15');
check(
  "a person's pin keys are today's birthday and anniversary",
  JSON.stringify(celebrantPinKeys('u1', new Date('2026-10-15T05:00:00Z'))) ===
    JSON.stringify(['birthday:u1:2026-10-15', 'anniversary:u1:2026-10-15']),
);

const card = (type: ConnectPostType, personUserId: string, day: string, org = 'sowaka') =>
  ({
    type,
    org,
    systemKey: `${type}:${personUserId}:${day}`,
    body: { personUserId },
    publishedAt: new Date(`${day}T00:31:00Z`),
  }) as Pick<ConnectPost, 'type' | 'org' | 'systemKey' | 'body' | 'publishedAt'>;

console.log('\nPinned for the celebrant, on their day only');
const morning = new Date('2026-10-15T03:00:00Z');
check('their birthday today is pinned for them', isPinnedForCelebrant(card('birthday', 'u1', '2026-10-15'), 'u1', morning));
check('their anniversary today is pinned for them', isPinnedForCelebrant(card('anniversary', 'u1', '2026-10-15'), 'u1', morning));
check('not for anyone else', !isPinnedForCelebrant(card('birthday', 'u1', '2026-10-15'), 'u2', morning));
check(
  'not once the day ends in India',
  !isPinnedForCelebrant(card('birthday', 'u1', '2026-10-15'), 'u1', new Date('2026-10-15T18:30:00Z')),
);
check('not last year’s card', !isPinnedForCelebrant(card('birthday', 'u1', '2025-10-15'), 'u1', morning));

console.log('\nClubbed for everyone else');
const group = celebrationGroupFor(card('birthday', 'u1', '2026-10-15'), 'u9');
check('a birthday is clubbed by company and day', group === 'celebrations:sowaka:2026-10-15', String(group));
check(
  "an anniversary the same day joins the birthday's club",
  celebrationGroupFor(card('anniversary', 'u2', '2026-10-15'), 'u9') === group,
);
check(
  'another day is another club',
  celebrationGroupFor(card('birthday', 'u3', '2026-10-14'), 'u9') !== group,
);
check(
  'another company is another club',
  celebrationGroupFor(card('birthday', 'u4', '2026-10-15', 'convrse'), 'u9') !== group,
);
check("the celebrant's own card is never clubbed", celebrationGroupFor(card('birthday', 'u1', '2026-10-15'), 'u1') === null);
check(
  'other posts are never clubbed',
  celebrationGroupFor({ ...card('birthday', 'u1', '2026-10-15'), type: 'kudos' }, 'u9') === null,
);
const legacy = { ...card('birthday', 'u5', '2026-10-15'), systemKey: undefined, publishedAt: new Date('2026-10-14T20:00:00Z') };
check('a card without a key is clubbed by the India day it went up', celebrationGroupFor(legacy, 'u9') === group);

// ------------------------------------------------------------- the feed

async function feedChecks() {
  await connectDb();
  console.log(`\nusing scratch database "${env.mongoDbName}"`);
  const org = 'sowaka';
  const now = new Date();
  const today = istDateKey(now);
  const yesterday = istDateKey(new Date(now.getTime() - 86_400_000));
  const person = (userId: string) =>
    ({ userId, name: `Person ${userId}`, email: `${userId}@sowaka.check`, employeeId: userId, org, lifecycleStatus: 'active' }) as unknown as User;
  await users().insertMany([person('cel'), person('cel2'), person('viewer')]);

  // Oldest first: the celebration cards went up at the start of the day and
  // sixty posts since push them past the first page.
  let clock = now.getTime() - 3 * 3_600_000;
  const at = () => new Date((clock += 1_000));
  const post = (type: ConnectPostType, extra: Partial<ConnectPost> = {}): ConnectPost => {
    const when = at();
    return {
      id: randomUUID(),
      org,
      type,
      tag: type,
      tagIcon: '',
      tagColor: '',
      tagTint: '',
      author: { userId: 'viewer', name: 'Person viewer', initials: 'PV', designation: '', avatarColor: '#000' },
      audience: { label: 'Public', org },
      body: { text: type },
      likedBy: [],
      comments: [],
      actionBy: {},
      pollVotes: {},
      publishedAt: when,
      createdAt: when,
      updatedAt: when,
      ...extra,
    } as ConnectPost;
  };
  const celebration = (type: 'birthday' | 'anniversary', userId: string, day: string) =>
    post(type, {
      systemKey: `${type}:${userId}:${day}`,
      author: { name: 'Sowaka', initials: 'S', designation: 'Auto · HRIS', avatarColor: '#C98A2E' },
      body: { personUserId: userId, personName: `Person ${userId}` },
    });

  const oldOwn = celebration('birthday', 'cel', yesterday);
  const birthday = celebration('birthday', 'cel', today);
  const anniversary = celebration('anniversary', 'cel2', today);
  const regular = Array.from({ length: 60 }, () => post('new_post'));
  const pinnedUntil = new Date(now.getTime() + 86_400_000);
  const orgPins = Array.from({ length: 3 }, () => post('hr_announcement', { pinnedUntil }));
  const all = [oldOwn, birthday, anniversary, ...regular, ...orgPins];
  await connectPosts().insertMany(all);

  async function pages(viewer: string, limit: number) {
    const seen: Array<{ id: string; body: Record<string, unknown> }> = [];
    let cursor: string | undefined;
    let first: typeof seen = [];
    for (let i = 0; i < 20; i += 1) {
      const page = await getConnectFeed(viewer, { limit, cursor });
      const posts = page.posts as unknown as typeof seen;
      if (i === 0) first = posts;
      seen.push(...posts);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return { first, seen };
  }

  console.log('\nThe celebrant');
  const mine = await pages('cel', 20);
  check('their birthday leads the first page', mine.first[0]?.id === birthday.id);
  check('it says it is pinned for them', mine.first[0]?.body.pinnedForCelebrant === true);
  check('and is not clubbed', mine.first[0]?.body.celebrationGroup === undefined);
  check(
    "the company's pins follow it",
    orgPins.every((pin) => mine.first.slice(1, 4).some((p) => p.id === pin.id)),
  );
  check(
    'every post shows once across the pages',
    mine.seen.length === all.length && new Set(mine.seen.map((p) => p.id)).size === all.length,
    `${mine.seen.length} shown of ${all.length}`,
  );
  const old = mine.seen.find((p) => p.id === oldOwn.id);
  check("yesterday's card is in the list, not pinned", mine.first[0]?.id !== oldOwn.id && old?.body.pinnedForCelebrant === undefined);
  check('the other celebrant’s card is clubbed for them', mine.seen.find((p) => p.id === anniversary.id)?.body.celebrationGroup === `celebrations:${org}:${today}`);

  console.log('\nEveryone else');
  const theirs = await pages('viewer', 20);
  check("the company's pins lead, the birthday does not", theirs.first.slice(0, 3).every((p) => orgPins.some((pin) => pin.id === p.id)) && !theirs.first.some((p) => p.id === birthday.id));
  const b = theirs.seen.find((p) => p.id === birthday.id);
  const a = theirs.seen.find((p) => p.id === anniversary.id);
  check('the birthday and anniversary share a club', b?.body.celebrationGroup === `celebrations:${org}:${today}` && a?.body.celebrationGroup === b?.body.celebrationGroup);
  check('neither is pinned for them', b?.body.pinnedForCelebrant === undefined && a?.body.pinnedForCelebrant === undefined);
  check('every post shows once across the pages', theirs.seen.length === all.length && new Set(theirs.seen.map((p) => p.id)).size === all.length);

  console.log('\nHR pins the birthday too');
  await connectPosts().updateOne({ id: birthday.id }, { $set: { pinnedUntil } });
  const both = await pages('cel', 20);
  check('it shows once, at the top', both.first[0]?.id === birthday.id && both.seen.filter((p) => p.id === birthday.id).length === 1);
  check('nothing is lost or repeated', both.seen.length === all.length && new Set(both.seen.map((p) => p.id)).size === all.length);

  console.log('\nA celebrant with both on one day');
  await connectPosts().insertOne(celebration('anniversary', 'cel', today));
  const two = await pages('cel', 20);
  const lead = two.first.slice(0, 2).map((p) => p.id);
  check('both of their cards lead', lead.includes(birthday.id) && two.first.slice(0, 2).every((p) => p.body.pinnedForCelebrant === true));
  check('nothing is lost or repeated', two.seen.length === all.length + 1 && new Set(two.seen.map((p) => p.id)).size === all.length + 1);
}

async function main() {
  if (!/scratch/i.test(env.mongoDbName)) {
    console.log(`\nskipping the feed: "${env.mongoDbName}" is not a scratch database (MONGODB_DB=connect_celebrations_scratch)`);
    return;
  }
  try {
    await feedChecks();
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
    console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  });
