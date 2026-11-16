/**
 * Scratch-database check of notification sounds and pictures: the push each
 * platform gets (Android channel and picture, APNs sound, mutable-content and
 * fcm_options.image, the kind in data), the fallbacks (a phone without the
 * sound, an old build, a look switched off, a key outside Connect media), the
 * WAV checks, the looks' layering (company, Sowaka-wide, Sowaka's default),
 * the contest closing and results jobs (once each, even run side by side, and
 * never claimed for an org this process may not notify), the device's sound
 * report, the sound manifest and file, and the admin routes (dashboard admins
 * only). Pushes are captured instead of sent. It drops and recreates its own
 * database, refuses any other, and drops it again at the end. Run with
 *   MONGODB_URI=mongodb://127.0.0.1:27133 npm run notifications:look-check
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { MulticastMessage } from 'firebase-admin/messaging';
import { app } from '../app';
import { authSessions, closeDb, connectDb, connectPosts, deviceTokens, getDb, notifications, users } from '../config/db';
import { env } from '../config/env';
import type { ConnectPost } from '../models/connect.model';
import { hashSessionToken } from '../services/auth.service';
import { notifyPostPublished } from '../services/connect-notifications.service';
import { closingCopy, resultsCopy, runContestNotifications, timeLeft } from '../services/contest-notifications.service';
import {
  BUILT_IN_SOUNDS,
  DEFAULT_CHANNEL_ID,
  SOWAKA_DEFAULT_LOOKS,
  buildPushMessages,
  chooseImage,
  deviceVariant,
  forgetNotificationLooks,
  kindOfScenario,
  mergeSounds,
  parseWav,
  pictureUrl,
  resolveLooks,
  soundKeyFrom,
  type PushContent,
} from '../services/notification-look.service';
import { capturePushesForCheck, cleanSoundTags, notifyUsers } from '../services/notification.service';

const DB_NAME = 'notif_look_check';
const ORG = 'notif-look-check';
const ELSEWHERE = 'notif-look-elsewhere';

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (ok) passed += 1;
  else failed += 1;
}

/** A WAV of silence: `seconds` long, 16-bit mono at 22.05 kHz, or with another format code. */
function wav(seconds: number, format = 1): Buffer {
  const rate = 22050;
  const data = Math.round(rate * seconds) * 2;
  const out = Buffer.alloc(44 + data);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + data, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(format, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(data, 40);
  return out;
}

const captured: MulticastMessage[] = [];
const sender = {
  async sendEachForMulticast(message: MulticastMessage) {
    captured.push(structuredClone(message));
    return { successCount: message.tokens.length, failureCount: 0, responses: message.tokens.map(() => ({ success: true })) };
  },
};
/** The captured message that went to this token. */
const toToken = (token: string) => captured.find((message) => message.tokens.includes(token));

const tokens: Record<string, string> = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
let base = '';
async function call(who: string | null, method: string, path: string, body?: unknown | FormData): Promise<{ status: number; body: Json; raw?: Buffer }> {
  const form = body instanceof FormData;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}),
      ...(body !== undefined && !form ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : form ? (body as FormData) : JSON.stringify(body),
  });
  if ((res.headers.get('content-type') ?? '').startsWith('audio/')) {
    return { status: res.status, body: {}, raw: Buffer.from(await res.arrayBuffer()) };
  }
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

const person = (userId: string, extra: Record<string, unknown> = {}) => ({
  userId, name: userId.replace(/^\w/, (c) => c.toUpperCase()), email: `${userId}@${ORG}.test`, org: ORG, lifecycleStatus: 'active', ...extra,
});

function contest(partial: Partial<ConnectPost> & { body: Record<string, unknown> }): ConnectPost {
  const now = new Date();
  return {
    id: randomUUID(), org: ORG, type: 'caption_challenge', tag: '', tagIcon: '', tagColor: '', tagTint: '',
    author: { userId: 'hr', name: 'Hema', initials: 'H', designation: '', avatarColor: '' },
    audience: { label: 'Company', org: ORG }, likedBy: [], comments: [], actionBy: {}, pollVotes: {},
    captionEntries: [], captionVotes: {},
    publishedAt: new Date(now.getTime() - 86_400_000), createdAt: now, updatedAt: now, ...partial,
  } as ConnectPost;
}

const content = (over: Partial<PushContent> = {}): PushContent => ({
  scenario: 'contest_closing', kind: 'contest_closing', title: 'Give Bruno a caption', body: '2 hours left',
  data: { destination: 'connect_post', postId: 'p1' }, imageUrl: 'https://img.example/c.jpg', ...over,
});

(async () => {
  let server: Server | undefined;
  try {
    if (env.mongoDbName !== DB_NAME) throw new Error(`refusing to run against ${env.mongoDbName}: use MONGODB_DB=${DB_NAME}`);
    await connectDb();
    const db = getDb();
    if (db.databaseName !== DB_NAME) throw new Error(`refusing to run against ${db.databaseName}`);
    await db.dropDatabase();
    await connectDb();
    capturePushesForCheck(sender);

    // ------------------------------------------------------------ pure
    console.log('kinds');
    check('a caption contest posted is contest_posted', kindOfScenario('post_published_caption_challenge') === 'contest_posted');
    check('Most Likely posted is contest_posted', kindOfScenario('post_published_most_likely') === 'contest_posted');
    check('an announcement is other', kindOfScenario('post_published_hr_announcement') === 'other');
    check('cup_up_next and cup_replay look like your match', kindOfScenario('cup_up_next') === 'cup_match_open' && kindOfScenario('cup_replay') === 'cup_match_open');
    check('cup_champion is its own kind', kindOfScenario('cup_champion') === 'cup_champion');
    check('a leave decision is other', kindOfScenario('leave_decided') === 'other');
    check('"other" itself is other', kindOfScenario('other') === 'other');

    console.log('sound files');
    const ok = parseWav(wav(0.8));
    check('a 0.8 s PCM WAV reads', !('error' in ok) && ok.durationMs === 800 && ok.sampleRate === 22050, ok);
    check('not a WAV is refused', 'error' in parseWav(Buffer.from('ID3 this is an mp3 honest'.padEnd(64, ' '))));
    check('a compressed WAV is refused', 'error' in parseWav(wav(0.5, 2)));
    check('over 30 s is refused', 'error' in parseWav(wav(31)));
    check('a key from a name', soundKeyFrom('Diwali Drum!') === 'diwali_drum' && soundKeyFrom('9') === '');
    check('device sound tags are cleaned', JSON.stringify(cleanSoundTags(['chime@1', 'Chime@1', 'pop@x', 'bell@2', 'chime@1', 5])) === JSON.stringify(['chime@1', 'bell@2']));
    check('no list is "not reported"', cleanSoundTags(undefined) === undefined);

    console.log('sounds and versions');
    const builtIns = mergeSounds([]);
    check('six built-in sounds at version 1', builtIns.length === BUILT_IN_SOUNDS.length && builtIns.every((s) => s.builtIn && s.version === 1 && s.url === null));
    const merged = mergeSounds([
      { id: 'a', org: ORG, key: 'chime', name: 'Our chime', version: 2, objectKey: 'x', contentType: 'audio/wav', size: 1, durationMs: 1, createdAt: new Date(), createdBy: 'hr' },
      { id: 'b', org: ORG, key: 'drum', name: 'Drum', version: 1, objectKey: 'y', contentType: 'audio/wav', size: 1, durationMs: 1, createdAt: new Date(), createdBy: 'hr' },
    ]);
    const chime2 = merged.find((s) => s.key === 'chime')!;
    check('an upload under a built-in key is its next version, downloaded', chime2.version === 2 && !chime2.builtIn && chime2.url === '/notifications/sounds/file/a');
    check('a new key is added', merged.some((s) => s.key === 'drum' && s.version === 1));

    console.log('payload per platform');
    const look = SOWAKA_DEFAULT_LOOKS.contest_closing; // tick, own picture
    const tick = builtIns.find((s) => s.key === 'tick')!;
    const variantHas = deviceVariant(look, tick, { token: 'a', platform: 'android', sounds: ['tick@1'] });
    check('a phone with the sound gets its channel and file', variantHas.channelId === 'snd_tick_v1' && variantHas.apnsSound === 'tick.caf', variantHas);
    const variantOld = deviceVariant(look, tick, { token: 'b', platform: 'android' });
    check('an old build (no sounds reported) gets the plain channel and sound', variantOld.channelId === DEFAULT_CHANNEL_ID && variantOld.apnsSound === 'default', variantOld);
    const variantOtherVersion = deviceVariant(look, { ...tick, version: 2, builtIn: false }, { token: 'c', platform: 'ios', sounds: ['tick@1'] });
    check('a phone with an older version gets the plain push until it downloads', variantOtherVersion.channelId === DEFAULT_CHANNEL_ID);
    const variantUpload = deviceVariant({ ...look, sound: 'drum' }, merged.find((s) => s.key === 'drum'), { token: 'd', platform: 'ios', sounds: ['drum@1'] });
    check('an uploaded sound plays from Library/Sounds as WAV', variantUpload.apnsSound === 'drum.wav' && variantUpload.channelId === 'snd_drum_v1', variantUpload);
    const variantOff = deviceVariant({ ...look, enabled: false }, tick, { token: 'e', platform: 'android', sounds: ['tick@1'] });
    check('a look switched off sends the plain sound', variantOff.channelId === DEFAULT_CHANNEL_ID);

    const devices = [
      { token: 'and-has', platform: 'android' as const, sounds: ['tick@1'] },
      { token: 'ios-has', platform: 'ios' as const, sounds: ['tick@1', 'chime@1'] },
      { token: 'and-old', platform: 'android' as const },
      { token: 'ios-old', platform: 'ios' as const },
    ];
    const messages = buildPushMessages(content(), look, tick, devices);
    check('two messages: with the sound, and plain', messages.length === 2, messages.map((m) => m.tokens));
    const rich = messages.find((m) => m.tokens.includes('and-has'))!;
    check('Android: the sound’s channel and the picture', rich.android?.notification?.channelId === 'snd_tick_v1' && rich.android?.notification?.imageUrl === 'https://img.example/c.jpg', rich.android);
    check('Android: high priority as before', rich.android?.priority === 'high');
    check('APNs: tick.caf, mutable-content and fcm_options.image', rich.apns?.payload?.aps?.sound === 'tick.caf' && rich.apns?.payload?.aps?.mutableContent === true && rich.apns?.fcmOptions?.imageUrl === 'https://img.example/c.jpg', rich.apns);
    check('the notification carries title, text and picture', rich.notification?.title === 'Give Bruno a caption' && rich.notification?.imageUrl === 'https://img.example/c.jpg');
    check('data: kind, scenario, destination and picture', rich.data?.kind === 'contest_closing' && rich.data?.scenario === 'contest_closing' && rich.data?.destination === 'connect_post' && rich.data?.imageUrl === 'https://img.example/c.jpg', rich.data);
    const plain = messages.find((m) => m.tokens.includes('and-old'))!;
    check('the plain message still has the picture', plain.android?.notification?.channelId === DEFAULT_CHANNEL_ID && plain.apns?.payload?.aps?.sound === 'default' && plain.android?.notification?.imageUrl === 'https://img.example/c.jpg');
    check('iOS and Android with the same sound share a message', JSON.stringify(rich.tokens.sort()) === JSON.stringify(['and-has', 'ios-has']));
    const noPicture = buildPushMessages(content({ imageUrl: null }), look, tick, devices.slice(0, 1))[0];
    check('no picture: no imageUrl, no mutable-content, no fcm_options', !noPicture.notification?.imageUrl && !noPicture.android?.notification?.imageUrl && noPicture.apns?.payload?.aps?.mutableContent === undefined && noPicture.apns?.fcmOptions === undefined && noPicture.data?.imageUrl === undefined, noPicture);
    const many = buildPushMessages(content(), look, tick, Array.from({ length: 1200 }, (_, i) => ({ token: `t${i}`, platform: 'android' as const })));
    check('1,200 phones go in slices of at most 500', many.length === 3 && many.every((m) => m.tokens.length <= 500) && many.reduce((n, m) => n + m.tokens.length, 0) === 1200);
    const other = buildPushMessages(content({ scenario: 'leave_decided', kind: 'other', imageUrl: null }), SOWAKA_DEFAULT_LOOKS.other, undefined, devices)[0];
    check('every other push is exactly the old plain push', messages.length > 0 && other.tokens.length === 4 && other.android?.notification?.channelId === DEFAULT_CHANNEL_ID && other.apns?.payload?.aps?.sound === 'default' && Object.keys(other.apns ?? {}).length === 1);

    console.log('pictures');
    const prefix = env.s3.connectMediaPrefix.replace(/^\/+|\/+$/g, '');
    const key = `${prefix}/hr/2026/11/abc-cover.jpg`;
    check('a Connect key is the public /media link at 1080 px', pictureUrl(key) === `${env.publicApiUrl}/media/${encodeURIComponent(key)}?w=1080`, pictureUrl(key));
    check('a Mongo-held picture too', (pictureUrl('mongo/123') ?? '').endsWith('/media/mongo%2F123?w=1080'));
    check('a key outside Connect media (a receipt) is no picture', pictureUrl('reimbursements/receipts/x.jpg') === null);
    check('an https link passes', pictureUrl('https://cdn.example/banner.jpg') === 'https://cdn.example/banner.jpg');
    check('a bundled asset is no picture', pictureUrl('assets/games/pool.png') === null);
    check('own picture first', chooseImage({ enabled: true, sound: null, ownPicture: true, pictureKey: 'mongo/fixed' }, key)?.includes('abc-cover') === true);
    check('then the look’s own', chooseImage({ enabled: true, sound: null, ownPicture: true, pictureKey: 'mongo/fixed' }, null)?.includes('mongo%2Ffixed') === true);
    check('a look switched off has no picture', chooseImage({ enabled: false, sound: null, ownPicture: true, pictureKey: 'mongo/fixed' }, key) === null);

    console.log('layering');
    const layered = resolveLooks(
      { org: ORG, kinds: { cup_lobby: { enabled: true, sound: 'pop', ownPicture: false, pictureKey: null } }, updatedAt: new Date(), updatedBy: 'hr' },
      { org: '*', kinds: { cup_lobby: { enabled: true, sound: 'bell', ownPicture: true, pictureKey: null }, cup_champion: { enabled: false, sound: null, ownPicture: false, pictureKey: null } }, updatedAt: new Date(), updatedBy: 'sowaka' },
    );
    check('the company’s look wins', layered.cup_lobby.sound === 'pop');
    check('then the Sowaka-wide row', layered.cup_champion.enabled === false);
    check('then Sowaka’s default', layered.contest_posted.sound === 'chime');

    console.log('copy');
    const now = new Date('2026-11-20T10:35:00.000Z'); // 4:05 pm IST
    const closesAt = new Date(now.getTime() + 115 * 60_000);
    const copyPost = contest({ body: { title: 'Give Bruno’s Monday face a caption 🐶', closesAt: closesAt.toISOString() }, captionEntries: [
      { id: 'e1', userId: 'a', name: 'Asha', text: 'x', createdAt: now }, { id: 'e2', userId: 'b', name: 'Bala', text: 'y', createdAt: now },
    ] as never });
    const closing = closingCopy(copyPost, now);
    check('closing: the contest’s own title, word for word', closing.title === 'Give Bruno’s Monday face a caption 🐶', closing);
    check('closing: time left, entries so far, closing time', closing.body === '2 hours left · 2 entries so far. Get yours in before 6:00 pm.', closing.body);
    check('time left reads naturally', timeLeft(40 * 60_000) === '40 minutes left' && timeLeft(65 * 60_000) === '1 hour left');
    const results = resultsCopy({ ...copyPost, captionVotes: { c: 'e2', d: 'e2', a: 'e2', b: 'e1' } });
    check('results: the winner and their votes', results?.body === 'Results are in: Bala won with 3 votes. See the results.', results);
    check('results: to everyone who entered or voted', JSON.stringify(results?.recipients.sort()) === JSON.stringify(['a', 'b', 'c', 'd']));
    check('results: nobody took part, nothing to say', resultsCopy(contest({ body: { title: 'Empty' } })) === null);

    // ------------------------------------------------------------ the database
    await users().insertMany([
      person('hr', { dashboardAccess: true, dashboardAdmin: true }),
      person('lena', { dashboardAccess: true, dashboardTabs: ['leave'] }),
      person('a'), person('b'), person('c'),
      person('gone', { lifecycleStatus: 'offboarded' }),
      { ...person('x'), org: ELSEWHERE, email: 'x@elsewhere.test' },
    ] as never[]);
    const at = new Date();
    for (const userId of ['hr', 'lena', 'a', 'x']) {
      tokens[userId] = `tok-${randomUUID()}`;
      await authSessions().insertOne({ tokenHash: hashSessionToken(tokens[userId]), userId, createdAt: at, expiresAt: new Date(Date.now() + 3_600_000) });
    }
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    console.log('device registration');
    let reply = await call('a', 'POST', '/notifications/devices', { token: 'tok-a-android', platform: 'android', sounds: ['chime@1', 'tick@1', 'nonsense'] });
    check('a phone registers with its sounds', reply.status === 200 && reply.body.sounds === 2, reply);
    check('they are stored', JSON.stringify((await deviceTokens().findOne({ token: 'tok-a-android' }))?.sounds) === JSON.stringify(['chime@1', 'tick@1']));
    reply = await call('a', 'POST', '/notifications/devices', { token: 'tok-a-android', platform: 'android' });
    check('a later registration without sounds keeps them', (await deviceTokens().findOne({ token: 'tok-a-android' }))?.sounds?.length === 2);
    await deviceTokens().insertMany([
      { userId: 'b', token: 'tok-b-ios-old', platform: 'ios', createdAt: at, updatedAt: at },
      { userId: 'c', token: 'tok-c-ios', platform: 'ios', sounds: ['chime@2', 'tick@1', 'fanfare@1'], createdAt: at, updatedAt: at },
      { userId: 'hr', token: 'tok-hr', platform: 'android', sounds: ['chime@1'], createdAt: at, updatedAt: at },
    ]);

    console.log('admin routes');
    reply = await call(null, 'GET', '/admin/notification-look');
    check('no sign-in: 401', reply.status === 401, reply.status);
    reply = await call('a', 'GET', '/admin/notification-look');
    check('an employee: 403', reply.status === 403, reply.status);
    reply = await call('lena', 'GET', '/admin/notification-look');
    check('dashboard access without admin: 403', reply.status === 403, reply.status);
    reply = await call('lena', 'PUT', '/admin/notification-look', { kinds: { other: { enabled: true, sound: 'pop', ownPicture: false, pictureKey: null } } });
    check('…and cannot set a look', reply.status === 403);
    reply = await call('hr', 'GET', '/admin/notification-look');
    check('an admin reads every kind', reply.status === 200 && reply.body.kinds?.length === 8 && reply.body.kinds.every((k: Json) => k.isDefault), reply.body.kinds?.length);
    check('…and the six built-in sounds', reply.body.sounds?.filter((s: Json) => s.builtIn).length === 6);
    reply = await call('hr', 'PUT', '/admin/notification-look', { kinds: { nope: { enabled: true } } });
    check('an unknown kind is refused', reply.status === 400, reply);
    reply = await call('hr', 'PUT', '/admin/notification-look', { kinds: { cup_lobby: { enabled: true, sound: 'kazoo', ownPicture: true, pictureKey: null } } });
    check('an unknown sound is refused', reply.status === 400 && /kazoo/.test(reply.body.message), reply);
    reply = await call('hr', 'PUT', '/admin/notification-look', { kinds: { cup_lobby: { enabled: true, sound: 'bell', ownPicture: true, pictureKey: 'reimbursements/receipts/r.jpg' } } });
    check('a picture outside Connect media is refused', reply.status === 400, reply);

    const form = new FormData();
    form.append('name', 'Diwali drum');
    form.append('file', new Blob([new Uint8Array(wav(0.6))], { type: 'audio/wav' }), 'drum.wav');
    reply = await call('hr', 'POST', '/admin/notification-look/sounds', form);
    check('an admin uploads a sound', reply.status === 201 && reply.body.sound?.key === 'diwali_drum' && reply.body.sound.version === 1, reply);
    const drumUrl = String(reply.body.sound?.url ?? '');
    const badForm = new FormData();
    badForm.append('name', 'Not a sound');
    badForm.append('file', new Blob([new Uint8Array(Buffer.from('not a wav file at all'.padEnd(64, '.')))], { type: 'audio/wav' }), 'x.wav');
    reply = await call('hr', 'POST', '/admin/notification-look/sounds', badForm);
    check('a file that is not a WAV is refused', reply.status === 400, reply);
    const chimeForm = new FormData();
    chimeForm.append('name', 'Our chime');
    chimeForm.append('key', 'chime');
    chimeForm.append('file', new Blob([new Uint8Array(wav(0.4))], { type: 'audio/wav' }), 'chime.wav');
    reply = await call('hr', 'POST', '/admin/notification-look/sounds', chimeForm);
    check('a sound under the built-in key is chime v2', reply.status === 201 && reply.body.sound?.key === 'chime' && reply.body.sound.version === 2, reply);
    reply = await call('a', 'POST', '/admin/notification-look/sounds', form);
    check('an employee cannot upload', reply.status === 403);

    reply = await call('a', 'GET', '/notifications/sounds');
    const manifest = (reply.body.sounds ?? []) as Json[];
    check('the manifest: key, name, url, version', reply.status === 200 && manifest.every((s) => 'key' in s && 'name' in s && 'url' in s && 'version' in s), manifest);
    check('…with the company’s drum and chime v2', manifest.some((s) => s.key === 'diwali_drum' && s.url) && manifest.find((s) => s.key === 'chime')?.version === 2);
    reply = await call('x', 'GET', '/notifications/sounds');
    check('another company does not see them', !(reply.body.sounds as Json[]).some((s) => s.key === 'diwali_drum') && (reply.body.sounds as Json[]).find((s) => s.key === 'chime')?.version === 1);
    reply = await call(null, 'GET', '/notifications/sounds');
    check('the manifest needs sign-in', reply.status === 401);
    reply = await call(null, 'GET', drumUrl);
    check('a sound’s file is served without sign-in', reply.status === 200 && reply.raw?.subarray(0, 4).toString('ascii') === 'RIFF', reply.status);
    reply = await call(null, 'GET', '/notifications/sounds/file/00000000-0000-0000-0000-000000000000');
    check('an unknown sound is 404', reply.status === 404);

    reply = await call('hr', 'PUT', '/admin/notification-look', { kinds: {
      contest_closing: { enabled: true, sound: 'tick', ownPicture: true, pictureKey: 'mongo/closing-fallback' },
      cup_lobby: { enabled: true, sound: 'diwali_drum', ownPicture: true, pictureKey: null },
      other: { enabled: true, sound: 'pop', ownPicture: true, pictureKey: null },
    } });
    check('an admin sets three looks', reply.status === 200 && reply.body.kinds.find((k: Json) => k.kind === 'cup_lobby').look.sound === 'diwali_drum', reply.body);
    check('"Everything else" never takes an own picture', reply.body.kinds.find((k: Json) => k.kind === 'other').look.ownPicture === false);
    check('…and is no longer the default', reply.body.kinds.find((k: Json) => k.kind === 'other').isDefault === false);
    reply = await call('hr', 'PUT', '/admin/notification-look', { kinds: { other: null } });
    check('null puts a kind back to the default', reply.body.kinds.find((k: Json) => k.kind === 'other').isDefault === true && reply.body.kinds.find((k: Json) => k.kind === 'other').look.sound === null);
    reply = await call('x', 'GET', '/admin/notification-look');
    check('another company’s admin route is 403 for a non-admin', reply.status === 403);
    forgetNotificationLooks();

    console.log('end to end: a contest is posted');
    const prefixKey = `${prefix}/hr/2026/11/bruno.jpg`;
    const posted = contest({ body: { title: 'Caption this', closesAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), mediaObjectKeys: [prefixKey] } });
    await connectPosts().insertOne(posted as never);
    captured.length = 0;
    await notifyPostPublished(posted);
    const toA = toToken('tok-a-android');
    check('Android with only chime@1, now replaced by v2: the plain channel, still the contest’s photo', toA?.android?.notification?.channelId === DEFAULT_CHANNEL_ID && String(toA?.android?.notification?.imageUrl).includes(encodeURIComponent(prefixKey)), toA?.android);
    const toC = toToken('tok-c-ios');
    check('the iPhone with chime@2 plays the company’s chime.wav', toC?.apns?.payload?.aps?.sound === 'chime.wav' && toC?.apns?.fcmOptions?.imageUrl === toA?.android?.notification?.imageUrl, toC?.apns);
    const toOld = toToken('tok-b-ios-old');
    check('an old iPhone build: default sound, picture link for when it can', toOld?.apns?.payload?.aps?.sound === 'default' && toOld?.apns?.payload?.aps?.mutableContent === true, toOld?.apns);
    check('the author is not pushed', !toToken('tok-hr'));
    check('the kind is in data', toA?.data?.kind === 'contest_posted' && toA?.data?.postId === posted.id);

    console.log('end to end: a plain push');
    captured.length = 0;
    await notifyUsers(['a', 'c'], { scenario: 'leave_decided', title: 'Leave approved', body: '3 Dec', data: { destination: 'leave' } });
    check('one plain message, as before', captured.length === 1 && captured[0].android?.notification?.channelId === DEFAULT_CHANNEL_ID && captured[0].apns?.payload?.aps?.sound === 'default' && !captured[0].notification?.imageUrl, captured);
    captured.length = 0;
    await notifyUsers(['a'], { scenario: 'cup_lobby', title: 'Lobby', body: 'Open', data: { destination: 'game_challenge' }, picture: 'reimbursements/receipts/secret.jpg' });
    check('a picture outside Connect media is never linked', captured.length === 1 && !captured[0].notification?.imageUrl);
    check('a phone without the drum gets the plain sound', captured[0].android?.notification?.channelId === DEFAULT_CHANNEL_ID);

    console.log('contest jobs');
    const t0 = new Date();
    const soon = contest({ body: { title: 'Closing soon', closesAt: new Date(t0.getTime() + 110 * 60_000).toISOString(), mediaObjectKeys: [prefixKey] },
      captionEntries: [{ id: 'e1', userId: 'a', name: 'A', text: 'mine', createdAt: t0 }] as never });
    const late = contest({ body: { title: 'Posted late', closesAt: new Date(t0.getTime() + 90 * 60_000).toISOString() }, publishedAt: new Date(t0.getTime() - 20 * 60_000) });
    const far = contest({ body: { title: 'Far off', closesAt: new Date(t0.getTime() + 5 * 3_600_000).toISOString() } });
    const elsewhere = contest({ org: ELSEWHERE, audience: { label: 'Company', org: ELSEWHERE } as never, body: { title: 'Not ours', closesAt: new Date(t0.getTime() + 100 * 60_000).toISOString() } });
    const ended = contest({ body: { title: 'Ended', closesAt: new Date(t0.getTime() - 10 * 60_000).toISOString() },
      captionEntries: [{ id: 'e1', userId: 'a', name: 'Asha', text: 'mine', createdAt: t0 }, { id: 'e2', userId: 'b', name: 'Bala', text: 'his', createdAt: t0 }] as never,
      captionVotes: { c: 'e1', b: 'e1' } });
    const longAgo = contest({ body: { title: 'Long ago', closesAt: new Date(t0.getTime() - 2 * 86_400_000).toISOString() },
      captionEntries: [{ id: 'e1', userId: 'a', name: 'A', text: 'x', createdAt: t0 }] as never });
    await connectPosts().insertMany([soon, late, far, elsewhere, ended, longAgo] as never[]);
    captured.length = 0;
    // Two runners at once, as two processes would tick.
    const [first, second] = await Promise.all([runContestNotifications(t0), runContestNotifications(t0)]);
    const closingRows = await notifications().find({ scenario: 'contest_closing' }).toArray();
    check('closing goes once, however many runners', first.closing + second.closing === 1, { first, second });
    check('…to those who have not entered (not the author, not a leaver)', JSON.stringify(closingRows.map((r) => r.userId).sort()) === JSON.stringify(['b', 'c', 'lena']), closingRows.map((r) => r.userId));
    check('…titled with the contest’s own title', closingRows.every((r) => r.title === 'Closing soon' && /^2 hours left · 1 entry so far\. Get yours in before /.test(r.body)), closingRows[0]);
    check('a contest posted inside the two hours gets no reminder', !closingRows.some((r) => r.data.postId === late.id));
    check('nor one closing later', !closingRows.some((r) => r.data.postId === far.id));
    check('an org this process may not notify is not even claimed', !(await getDb().collection('notification_once').findOne({ _id: `contest_closing:${elsewhere.id}` as never })));
    const closingPush = toToken('tok-c-ios');
    check('the closing push: tick.caf on the iPhone that has it, with the contest’s photo', closingPush?.apns?.payload?.aps?.sound === 'tick.caf' && closingPush?.data?.kind === 'contest_closing' && String(closingPush?.apns?.fcmOptions?.imageUrl).includes('bruno.jpg'), closingPush?.apns);
    const resultRows = await notifications().find({ scenario: 'contest_results' }).toArray();
    check('results go once, to everyone who entered or voted', first.results + second.results === 1 && JSON.stringify(resultRows.map((r) => r.userId).sort()) === JSON.stringify(['a', 'b', 'c']), resultRows.map((r) => r.userId));
    check('…saying who won', resultRows[0]?.title === 'Ended' && resultRows[0]?.body === 'Results are in: Asha won with 2 votes. See the results.', resultRows[0]);
    check('a contest that closed days ago gets no results', !resultRows.some((r) => r.data.postId === longAgo.id));
    const again = await runContestNotifications(new Date(t0.getTime() + 5 * 60_000));
    check('the next tick sends nothing more', again.closing === 0 && again.results === 0 && (await notifications().countDocuments({ scenario: { $in: ['contest_closing', 'contest_results'] } })) === closingRows.length + resultRows.length, again);
  } catch (error) {
    failed += 1;
    console.error(error);
  } finally {
    capturePushesForCheck(undefined);
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    try { await getDb().dropDatabase(); } catch { /* not connected */ }
    await closeDb().catch(() => undefined);
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
