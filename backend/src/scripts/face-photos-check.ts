/**
 * Faces everywhere a person is shown (services/face-photos): an upload is its
 * `/media` copy, a link is the link, an older inline photo is its signed
 * `/faces` address (never the base64 itself), and someone with no photo is
 * null. The inline address opens only with its signature. Notifications keep
 * whose doing they are, and the inbox carries that person's face.
 *
 * Drops and recreates its own database, and refuses any other:
 *   MONGODB_DB=face_photos_scratch NOTIFY_ORGS=facecheck EMAIL_ORGS=nobody-scratch AWS_S3_BUCKET= npm run faces:check
 */
import type { AddressInfo } from 'node:net';
import { connectDb, getDb, notifications, users } from '../config/db';
import { app } from '../app';
import { faceUrlOf, faceUrlOfUser, faceUrlsFor, inlineFace, keptFaceUrlNow, keptFaceUrlsFor } from '../services/face-photos';
import { notifyUsers, withActorFaces } from '../services/notification.service';

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failed += 1;
    console.log(`  FAIL ${label}`, detail ?? '');
  }
}

// A 1×1 PNG, as an older account keeps it.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const INLINE = `data:image/png;base64,${PNG}`;
const now = new Date();
const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
  userId, name, email: `${userId}@facecheck.test`, org: 'facecheck', role: 'employee', createdAt: now, updatedAt: now, ...extra,
});

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'face_photos_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany([
    person('up', 'Uma', { profilePhotoKey: 'connect/up/2026/11/a.jpg' }),
    person('link', 'Lal', { profilePhotoUrl: 'https://cdn.test/lal.jpg' }),
    person('inline', 'Ina', { profilePhotoUrl: INLINE }),
    person('none', 'Nur'),
    person('me', 'Mia'),
  ] as never[]);

  // --- one lean read
  const faces = await faceUrlsFor(['up', 'link', 'inline', 'none', 'ghost', '', null]);
  check('an upload is its small /media copy', faces.get('up') === '/media/connect%2Fup%2F2026%2F11%2Fa.jpg?w=256', faces.get('up'));
  check('a link is the link', faces.get('link') === 'https://cdn.test/lal.jpg', faces.get('link'));
  const inline = faces.get('inline') ?? '';
  check('an inline photo is its signed address, never the base64', /^\/faces\/inline\?v=\d+&s=[\w-]{24}$/.test(inline), inline);
  check('no photo is null', faces.get('none') === null, faces.get('none'));
  check('someone not there is null', faces.has('ghost') && faces.get('ghost') === null);
  check('blank ids are left out', !faces.has('') && faces.size === 5, [...faces.keys()]);
  check('a whole record gives the same address', faceUrlOfUser({ userId: 'inline', profilePhotoUrl: INLINE }) === inline);
  check('an http (not https) link is not sent', faceUrlOf({ userId: 'x', faceLink: undefined, faceHead: 'http://cdn' }) === null);

  // --- the inline address opens only with its signature
  const url = new URL(inline, 'http://local');
  const photo = await inlineFace('inline', url.searchParams.get('v'), url.searchParams.get('s'));
  check('the signed address opens the photo', photo?.type === 'image/png' && photo.bytes.equals(Buffer.from(PNG, 'base64')), photo?.type);
  check('a wrong signature opens nothing', (await inlineFace('inline', url.searchParams.get('v'), 'x'.repeat(24))) === null);
  check("another person's signature opens nothing", (await inlineFace('link', url.searchParams.get('v'), url.searchParams.get('s'))) === null);

  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const served = await fetch(`${base}${inline}`);
  check('GET /faces serves it as an image', served.status === 200 && served.headers.get('content-type') === 'image/png', served.status);
  check('other origins may show it', served.headers.get('cross-origin-resource-policy') === 'cross-origin', served.headers.get('cross-origin-resource-policy'));
  const refused = await fetch(`${base}/faces/inline?v=1&s=${'x'.repeat(24)}`);
  check('GET /faces with a bad signature is a 404', refused.status === 404, refused.status);
  server.close();

  // --- kept faces for polled screens
  const kept = await keptFaceUrlsFor(['up', 'none']);
  check('kept faces read the same', kept.get('up') === faces.get('up') && kept.get('none') === null);
  check('a kept face is there without waiting', keptFaceUrlNow('up') === faces.get('up'));
  await users().updateOne({ userId: 'up' }, { $set: { profilePhotoKey: 'connect/up/2026/11/b.jpg' } });
  check('a kept face stays for a few minutes', keptFaceUrlNow('up') === faces.get('up'));

  // --- notifications keep whose doing they are
  await notifyUsers(['me'], { scenario: 'post_liked', title: 'Ina liked your post', body: '', data: { postId: 'p' }, actorUserId: 'inline', push: false });
  await notifyUsers(['me'], { scenario: 'weekly_attendance_report', title: 'Your week', body: '', data: {}, push: false });
  const rows = await notifications().find({ userId: 'me' }).sort({ createdAt: 1 }).toArray();
  check('the row keeps its actor', rows.find((r) => r.scenario === 'post_liked')?.actorUserId === 'inline', rows.map((r) => r.actorUserId));
  const shown = await withActorFaces(rows);
  check("the inbox row wears the actor's face", shown.find((r) => r.scenario === 'post_liked')?.actorPhotoUrl === inline);
  check('a row about no one has no face', shown.find((r) => r.scenario === 'weekly_attendance_report')?.actorPhotoUrl === undefined);
  const own = await withActorFaces([{ userId: 'up', actorUserId: 'up' }]);
  check("a row never wears the reader's own face", own[0]?.actorPhotoUrl === undefined, own[0]);

  await db.dropDatabase();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
