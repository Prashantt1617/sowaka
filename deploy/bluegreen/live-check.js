#!/usr/bin/env node
/**
 * What is live right now, for bluegreen.sh to decide whether a switch may go ahead.
 * Read-only: counts in Redis and Mongo, printed as one JSON line; exit 0 = may switch, 2 = must not.
 *
 *   node deploy/bluegreen/live-check.js [--env backend/.env] [--strict]
 *
 * Refuses (exit 2):
 *   - a Diwali Cup event in its lobby or running: live scores and boards are held in the serving
 *     process's memory and written to the match only every few seconds (cup.service.ts), so a
 *     switch would lose the last seconds of every player's score;
 *   - with --strict, any open Speed Poker or Pool room (today's single-process rule).
 * Everything else is Redis-backed and survives a switch (docs/deploy/bluegreen.md): it is reported.
 */
const path = require('node:path');
const args = process.argv.slice(2);
const envPath = args.includes('--env') ? args[args.indexOf('--env') + 1] : path.resolve(__dirname, '../../backend/.env');
require('dotenv').config({ path: envPath });
const { MongoClient } = require('mongodb');
const Redis = require('ioredis');

const strict = args.includes('--strict');

(async () => {
  const out = { cupLive: [], pokerTables: 0, pokerRooms: 0, poolRooms: 0, tileupRooms: 0, scribbleRooms: 0, squadSessions: 0, relayEvents: 0, pokerEvents: 0 };
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB);
    out.cupLive = (await db.collection('cup_events').find({ active: true, phase: { $in: ['lobby', 'running'] } }, { projection: { _id: 0, id: 1, org: 1, phase: 1 } }).toArray())
      .map((e) => `${e.org}/${e.id} (${e.phase})`);
    out.relayEvents = await db.collection('relay_events').countDocuments({ status: 'live' });
    out.pokerEvents = await db.collection('poker_events').countDocuments({ status: 'live' });
  } finally {
    await client.close();
  }
  if (process.env.REDIS_URL) {
    const redis = new Redis(process.env.REDIS_URL, { connectTimeout: 3000, maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
    try {
      const [t, r, p, tu, s, q] = await Promise.all(['poker:live', 'poker:rooms', 'pool:live', 'tileup:live', 'scribble:live', 'squad:live'].map((k) => redis.scard(k)));
      Object.assign(out, { pokerTables: t, pokerRooms: r, poolRooms: p, tileupRooms: tu, scribbleRooms: s, squadSessions: q });
    } finally {
      redis.disconnect();
    }
  } else {
    out.redis = 'off: rooms are in process memory and would be lost';
  }
  const refuse = [];
  if (out.cupLive.length) refuse.push(`Diwali Cup live: ${out.cupLive.join(', ')}`);
  if (!process.env.REDIS_URL) refuse.push('REDIS_URL not set: every room is in process memory');
  if (strict && out.pokerRooms + out.pokerTables + out.poolRooms > 0) refuse.push(`--strict: ${out.pokerRooms + out.pokerTables} poker / ${out.poolRooms} pool open`);
  out.refuse = refuse;
  console.log(JSON.stringify(out));
  process.exit(refuse.length ? 2 : 0);
})().catch((error) => {
  console.log(JSON.stringify({ error: String(error && error.message || error), refuse: ['live check failed'] }));
  process.exit(2);
});
