/**
 * Checks scripts/app-opens-backfill against a scratch database: what it
 * counts and leaves out, that --apply writes once (a second run adds
 * nothing), that it never touches a really tracked day or row, that --undo
 * takes only its own rows away, and that App usage shows the estimated days.
 *
 * Never against a real database: it drops `MONGODB_DB` first.
 *
 *   env -u REDIS_URL MONGODB_URI=mongodb://127.0.0.1:<port> MONGODB_DB=scratch_appopens \
 *     NOTIFY_ORGS=nobody-scratch EMAIL_ORGS=nobody-scratch AWS_S3_BUCKET= npm run app-opens-backfill:check
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { connectDb, getDb } from '../config/db';
import { env } from '../config/env';
import { usageSummary, usageTrend, usageWhen } from '../services/engagement-usage.service';

const ORG = 'scratchco';
const IST = 330 * 60_000;
/** A moment on an IST day at an IST hour. */
const at = (day: string, hour: number) => new Date(Date.parse(`${day}T${String(hour).padStart(2, '0')}:15:00Z`) - IST);
const SCRIPT = path.join(__dirname, 'app-opens-backfill.ts');

function run(...args: string[]): string {
  return execFileSync(process.execPath, ['--import', 'tsx', SCRIPT, ...args], { env: process.env, encoding: 'utf8' });
}

async function main() {
  if (!/scratch/.test(env.mongoDbName) || !/127\.0\.0\.1|localhost/.test(env.mongoUri)) {
    throw new Error('Run against a local scratch database (MONGODB_DB must contain "scratch")');
  }
  await connectDb();
  const db = getDb();
  await db.dropDatabase();
  await connectDb();

  const user = (userId: string, extra: Record<string, unknown> = {}) => ({
    userId, employeeId: userId.toUpperCase(), name: userId, email: `${userId}@scratch.test`, org: ORG, role: 'employee',
    lifecycleStatus: 'active', createdAt: new Date(), updatedAt: new Date(), ...extra,
  });
  await db.collection('users').insertMany([
    user('ana', { managerUserId: 'mo' }),
    user('ben', { managerUserId: 'mo' }),
    user('mo'),
    user('hr', { dashboardAccess: true }),
    user('demo', { demoSeed: true }),
  ]);
  // Tracking began on 11 Nov: real rows there and after.
  await db.collection('appActivity').insertMany([
    { org: ORG, userId: 'ana', day: '2026-11-11', hours: [18], did: ['payslips'], firstAt: at('2026-11-11', 18) },
    { org: ORG, userId: 'ben', day: '2026-11-12', hours: [9], did: [], firstAt: at('2026-11-12', 9) },
  ]);
  await db.collection('attendance_records').insertMany([
    // Ana punched in and out on the app on 5 Nov (in and out: one person-day).
    { employeeId: 'ANA', userId: 'ana', workDate: '2026-11-05', punchIn: at('2026-11-05', 9), punchOut: at('2026-11-05', 18), punchInLocation: { latitude: 1 }, punchOutLocation: { latitude: 1 }, source: 'manual', sourceKey: 'manual|ANA|2026-11-05', importedAt: new Date(), updatedAt: new Date() },
    // Ben's 5 Nov came from the biometric import: not the app.
    { employeeId: 'BEN', userId: 'ben', workDate: '2026-11-05', punchIn: at('2026-11-05', 9), punchOut: at('2026-11-05', 18), source: 'sql_import', sourceKey: 'sql|1', importedAt: new Date(), updatedAt: new Date() },
    // An approved fix wrote Ben's 6 Nov hours: not the app either.
    { employeeId: 'BEN', userId: 'ben', workDate: '2026-11-06', punchIn: at('2026-11-06', 9), punchOut: at('2026-11-06', 18), source: 'manual', sourceKey: 'regularization|BEN|2026-11-06', importedAt: new Date(), updatedAt: new Date() },
    // Ana's app punch on 11 Nov, already a tracked day: never written.
    { employeeId: 'ANA', userId: 'ana', workDate: '2026-11-11', punchIn: at('2026-11-11', 9), punchInLocation: { latitude: 1 }, source: 'manual', sourceKey: 'manual|ANA|2026-11-11', importedAt: new Date(), updatedAt: new Date() },
    // A demo person's punch: left out.
    { employeeId: 'DEMO', userId: 'demo', workDate: '2026-11-05', punchIn: at('2026-11-05', 9), punchInLocation: { latitude: 1 }, source: 'manual', sourceKey: 'manual|DEMO|2026-11-05', importedAt: new Date(), updatedAt: new Date() },
  ]);
  await db.collection('leaves').insertMany([
    // Ben applied on 6 Nov (epoch ms, as leave stores it); Mo approved it on the app on 7 Nov.
    { userId: 'ben', type: 'casual', startDate: '2026-11-20', endDate: '2026-11-20', days: 1, status: 'approved', createdAt: at('2026-11-06', 14).getTime(), decidedAt: at('2026-11-07', 10), decidedByRole: 'manager', decidedByUserId: 'mo' },
    // HR decided this one on the dashboard: not Mo, not the app.
    { userId: 'ana', type: 'casual', startDate: '2026-11-21', endDate: '2026-11-21', days: 1, status: 'approved', createdAt: at('2026-11-05', 11).getTime(), decidedAt: at('2026-11-08', 10), decidedByRole: 'admin', decidedByUserId: 'hr' },
  ]);
  await db.collection('connect_posts').insertOne({
    id: 'p1', org: ORG, type: 'new_post', author: { userId: 'mo', designation: 'Lead' }, audience: {}, body: {}, likedBy: ['ben'],
    comments: [{ id: 'c1', userId: 'ben', name: 'ben', text: 'nice', createdAt: at('2026-11-08', 20), likedBy: [] }],
    publishedAt: at('2026-11-03', 12), createdAt: at('2026-11-03', 12), updatedAt: at('2026-11-08', 20),
  });
  await db.collection('notifications').insertOne({ id: 'n1', userId: 'mo', org: ORG, scenario: 'x', title: 't', body: 'b', data: {}, createdAt: at('2026-11-08', 9), readAt: at('2026-11-09', 22) });
  await db.collection('auth_sessions').insertMany([
    { tokenHash: 'a', userId: 'ana', createdAt: at('2026-11-02', 8), expiresAt: new Date(Date.now() + 1e10) },
    // HR signs in to the dashboard through the same door: left out.
    { tokenHash: 'b', userId: 'hr', createdAt: at('2026-11-02', 8), expiresAt: new Date(Date.now() + 1e10) },
  ]);
  await db.collection('point_events').insertOne({ userId: 'ana', org: ORG, delta: 5, source: 'game_challenge', reason: 'game', createdAt: at('2026-11-05', 22) });
  await db.collection('device_tokens').insertOne({ userId: 'hr', token: 'w', platform: 'web', createdAt: at('2026-11-04', 9), updatedAt: at('2026-11-04', 9) });

  const expected = [
    'ana|2026-11-02', // signed in
    'ana|2026-11-05', // app punch, leave applied, a game
    'ben|2026-11-06', // leave applied
    'mo|2026-11-03', // post
    'mo|2026-11-07', // approved on the app
    'ben|2026-11-08', // comment
    'mo|2026-11-09', // read a notification
  ].sort();
  const flags = ['--from=2026-11-01', `--org=${ORG}`];
  const rowsNow = async () => (await db.collection('appActivity').find({}, { projection: { _id: 0 } }).toArray());
  const estimated = async () => (await db.collection('appActivity').find({ inferred: true }).toArray()).map((r) => `${r.userId}|${r.day}`).sort();

  // Dry run: counts, no writes.
  const dry = run(...flags, '--compare');
  assert.match(dry, /dry run/);
  assert.match(dry, /Total: 7 person-days · 7 new/);
  assert.match(dry, /2026-11-05 \| 1 \|/);
  assert.deepEqual(await estimated(), [], 'a dry run writes nothing');
  console.log('ok  dry run counts 7 person-days and writes nothing');

  // A --to past tracking is pulled back.
  assert.match(run(...flags, '--to=2026-11-12'), /--to moved back to 2026-11-10/);

  const before = await db.collection('appActivity').find({ inferred: { $exists: false } }).toArray();
  const applied = run(...flags, '--apply');
  assert.match(applied, /Written: 7 new rows/);
  assert.deepEqual(await estimated(), expected);
  const anaFifth = await db.collection('appActivity').findOne({ userId: 'ana', day: '2026-11-05' });
  assert.deepEqual(anaFifth?.hours, [9, 11, 18, 22]);
  assert.deepEqual(anaFifth?.sources, ['game-points', 'leave', 'punch-in', 'punch-out']);
  assert.deepEqual(anaFifth?.did, []);
  assert.equal(anaFifth?.inferred, true);
  console.log('ok  --apply writes the 7 rows, marked inferred, with hours and sources');

  // Real rows untouched; nothing on or after 11 Nov.
  const after = await db.collection('appActivity').find({ inferred: { $exists: false } }).toArray();
  assert.deepEqual(after, before, 'real rows are not changed');
  assert.equal(await db.collection('appActivity').countDocuments({ inferred: true, day: { $gte: '2026-11-11' } }), 0);
  console.log('ok  tracked rows and days are left as they were');

  // Again: nothing new, nothing doubled.
  const total = (await rowsNow()).length;
  assert.match(run(...flags, '--apply'), /Written: 0 new rows/);
  assert.equal((await rowsNow()).length, total);
  assert.deepEqual(await estimated(), expected);
  console.log('ok  a second --apply adds nothing');

  // A signal gone (the comment deleted): the next run takes its row away.
  await db.collection('connect_posts').updateOne({ id: 'p1' }, { $set: { comments: [] } });
  assert.match(run(...flags, '--apply'), /1 removed/);
  assert.deepEqual(await estimated(), expected.filter((k) => k !== 'ben|2026-11-08'));
  console.log('ok  an estimate no longer backed is removed on the next run');

  // App usage: the estimated days read as data, marked estimated.
  const trend = await usageTrend(ORG, { gran: 'date', from: '2026-11-01', to: '2026-11-12' });
  const day = (d: string) => trend.buckets.find((b) => b.from === d)!;
  assert.equal(trend.trackingSince, '2026-11-02');
  assert.equal(trend.estimatedUntil, '2026-11-09');
  assert.equal(day('2026-11-01').untracked, true);
  assert.equal(day('2026-11-05').untracked, false);
  assert.equal(day('2026-11-05').estimated, true);
  assert.equal(day('2026-11-05').app + day('2026-11-05').bio + day('2026-11-05').present, 1);
  assert.equal(day('2026-11-11').estimated, false);
  assert.equal(day('2026-11-11').app + day('2026-11-11').bio + day('2026-11-11').present, 1);
  const summary = await usageSummary({ userId: 'hr', org: ORG }, { from: '2026-11-01', to: '2026-11-09' });
  assert.equal(summary.trackingSince, '2026-11-02');
  assert.equal(summary.estimatedUntil, '2026-11-09');
  assert.deepEqual(summary.people.filter((p) => p.opened).map((p) => p.id).sort(), ['ana', 'ben', 'mo']);
  const when = await usageWhen(ORG, { from: '2026-11-01', to: '2026-11-12' });
  assert.equal(when.trackingSince, '2026-11-11', '"when" reads tracked days only');
  assert.equal(when.hours.reduce((s, n) => s + n, 0), 2);
  console.log('ok  App usage shows the estimated days (trend, summary), and "when" keeps to tracked days');

  // Undo: a dry run first, then only the estimated rows go.
  assert.match(run(...flags, '--undo'), /Would remove 6 estimated rows/);
  assert.equal((await estimated()).length, 6);
  assert.match(run(...flags, '--undo', '--apply'), /Removed 6 estimated rows/);
  assert.deepEqual(await estimated(), []);
  assert.deepEqual(await db.collection('appActivity').find({}).toArray(), before);
  console.log('ok  --undo removes only the estimated rows');

  await db.dropDatabase();
  console.log('all app-opens backfill checks passed');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
