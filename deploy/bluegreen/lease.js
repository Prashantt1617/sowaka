#!/usr/bin/env node
/**
 * The background-jobs lease (backend/src/services/leader.ts), from the command line.
 *
 *   node deploy/bluegreen/lease.js show
 *   node deploy/bluegreen/lease.js hold-legacy [minutes]   once, during the migration: the old single
 *        `sowaka-backend` runs its jobs without asking for the lease, so the lease is held in its
 *        name until it is stopped; the new copy waits instead of running the same jobs beside it
 *   node deploy/bluegreen/lease.js release-legacy           after it has stopped: the new copy takes over
 */
const path = require('node:path');
const args = process.argv.slice(2);
const envPath = args.includes('--env') ? args[args.indexOf('--env') + 1] : path.resolve(__dirname, '../../backend/.env');
require('dotenv').config({ path: envPath });
const { MongoClient } = require('mongodb');

const NAME = 'background-jobs';
const LEGACY = 'legacy-sowaka-backend';

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const leases = client.db(process.env.MONGODB_DB).collection('leases');
  const cmd = args[0] || 'show';
  try {
    if (cmd === 'hold-legacy') {
      const minutes = Number(args[1] || 20);
      const now = new Date();
      // Only when nobody holds it (the first migration): never takes it from a running copy.
      const res = await leases.updateOne(
        { _id: NAME, $or: [{ until: { $lte: now } }, { holder: LEGACY }] },
        { $set: { holder: LEGACY, until: new Date(now.getTime() + minutes * 60000), renewedAt: now, acquiredAt: now, pid: 0, port: 4000, color: 'legacy' } },
        { upsert: true },
      ).catch((e) => { if (e.code === 11000) return { matchedCount: 0, upsertedCount: 0 }; throw e; });
      if (!res.matchedCount && !res.upsertedCount) { console.log('lease held by a running copy: not held for legacy'); process.exitCode = 1; }
      else console.log(`lease held for ${LEGACY} for ${minutes} min`);
    } else if (cmd === 'release-legacy') {
      const res = await leases.updateOne({ _id: NAME, holder: LEGACY }, { $set: { until: new Date(0), releasedAt: new Date() } });
      console.log(res.matchedCount ? 'legacy hold released' : 'no legacy hold');
    }
    console.log(JSON.stringify(await leases.findOne({ _id: NAME })));
  } finally {
    await client.close();
  }
})().catch((error) => { console.error(String(error && error.message || error)); process.exit(1); });
