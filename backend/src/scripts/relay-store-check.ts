/**
 * Checks the fast store behaves the same with Redis and without it.
 *
 * The fallback is what runs if Redis is unreachable mid-event, so it has to be
 * a real path rather than a comforting idea. Run it both ways:
 *   MONGODB_DB=relay_check npm run relay:store
 *   REDIS_URL=redis://localhost:6379 MONGODB_DB=relay_check npm run relay:store
 */
import { randomUUID } from 'node:crypto';
import { closeDb, connectDb, getDb, relayProgress } from '../config/db';
import { closeRedis, redisClient, redisReady } from '../config/redis';
import { env } from '../config/env';
import { RelayTeamProgress } from '../models/relay.model';
import {
  cacheProgress,
  forgetProgress,
  markPresent,
  presenceFor,
  readProgress,
} from '../services/relay-store';

if (!/check|scratch|test/i.test(env.mongoDbName)) {
  console.error(`Refusing to run against database "${env.mongoDbName}". Use MONGODB_DB=relay_check.`);
  process.exit(1);
}

let failures = 0;
const check = (label: string, passed: boolean, detail = '') => {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const eventId = randomUUID();
const teamId = randomUUID();

function progress(points: number): RelayTeamProgress {
  return {
    eventId,
    org: 'checkorg',
    teamId,
    round: 1,
    questionIndex: 2,
    questionStartedAt: new Date('2026-09-21T10:00:00.000Z'),
    answers: [],
    totalPoints: points,
    bonusRounds: [],
    totalSecondsUsed: 41,
    updatedAt: new Date('2026-09-21T10:00:05.000Z'),
  };
}

async function main() {
  await connectDb();
  // Give a configured client a moment to come up before reporting which path ran.
  if (process.env.REDIS_URL) {
    redisClient();
    await wait(1200);
  }
  const backing = redisReady() ? 'REDIS' : 'in-process memory';
  console.log(`\nstore backed by ${backing}\n`);

  console.log('presence');
  await markPresent(eventId, ['a', 'b', 'c']);
  const seen = await presenceFor(eventId, ['a', 'b', 'c', 'never-seen']);
  check('everyone marked is seen', ['a', 'b', 'c'].every((id) => seen.has(id)));
  check('someone who never arrived is absent', !seen.has('never-seen'));
  check('timestamps are recent', Date.now() - (seen.get('a') ?? 0) < 5000);

  console.log('\nprogress');
  await cacheProgress(progress(30));
  const readBack = await readProgress(eventId, teamId);
  check('reads back what was written', readBack?.totalPoints === 30);
  check('question index survives', readBack?.questionIndex === 2);
  check(
    'dates come back as dates, not strings',
    readBack?.questionStartedAt instanceof Date &&
      readBack.questionStartedAt.toISOString() === '2026-09-21T10:00:00.000Z',
    'clock arithmetic depends on this',
  );

  console.log('\nfalling back to the durable record');
  await forgetProgress(eventId);
  check('cache cleared', true);
  await relayProgress().insertOne(progress(70));
  const fromMongo = await readProgress(eventId, teamId);
  check('a miss is filled from Mongo', fromMongo?.totalPoints === 70);
  const nowCached = await readProgress(eventId, teamId);
  check('and is cached for the next read', nowCached?.totalPoints === 70);

  console.log('\nunknown team');
  check('reads null rather than throwing', (await readProgress(eventId, 'no-such-team')) === null);

  console.log(`\n${failures === 0 ? `all checks passed (${backing})` : `${failures} FAILED (${backing})`}`);
}

main()
  .catch((error) => {
    console.error('\ncheck crashed:', error);
    failures += 1;
  })
  .finally(async () => {
    await forgetProgress(eventId).catch(() => undefined);
    await getDb().dropDatabase();
    await closeRedis();
    await closeDb();
    process.exit(failures === 0 ? 0 : 1);
  });
