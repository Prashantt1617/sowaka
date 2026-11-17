/**
 * Notification sounds and pictures, the way Uber and Zomato do them: the
 * server writes the words, picks the picture (an S3 link the phone fetches
 * itself) and names the sound, per kind of notification.
 *
 * Sounds. A few ship inside the app (BUILT_IN_SOUNDS); more can be uploaded
 * from the dashboard, and the app downloads them (GET /notifications/sounds)
 * into iOS `Library/Sounds` and, on Android, one notification channel per
 * sound and version: a channel's sound is fixed when the channel is made. The
 * app tells the server which sounds it has when it registers its token, and a
 * phone without the sound asked for gets the plain push (channel
 * `sowaka_notifications`, the phone's own sound), so an old build, or one
 * that has not downloaded a new sound yet, still rings.
 *
 * Pictures. Android shows `imageUrl` by itself. iOS needs the app's
 * Notification Service Extension (from the release that adds it), which reads
 * `fcm_options.image` when `mutable-content` is 1; an older iPhone build shows
 * the same push without the picture. The link is this API's `/media/<key>`,
 * which needs no sign-in, at the 1080 px copy.
 *
 * Every lookup here fails soft: a push is never held up or lost over its look.
 */
import { randomUUID } from 'node:crypto';
import type { MulticastMessage } from 'firebase-admin/messaging';
import { getDb } from '../config/db';
import { env } from '../config/env';
import {
  NOTIFICATION_KINDS,
  type KindLook,
  type NotificationKind,
  type NotificationLookDoc,
  type NotificationSoundRecord,
} from '../models/notification-look.model';
import { logger } from '../utils/logger';
import {
  NOTIFICATION_SOUND_PREFIX,
  isConnectMediaKey,
  mediaPath,
  putConnectObject,
  readNotificationSoundObject,
  s3Configured,
  uploadConnectMedia,
} from './s3-connect-media.service';

// ------------------------------------------------------------ the catalog

/** The channel and sound every push used before sounds could be chosen, and still the fallback. */
export const DEFAULT_CHANNEL_ID = 'sowaka_notifications';
export const DEFAULT_APNS_SOUND = 'default';

/** Shipped in the app: Android `res/raw/<key>.wav`, iOS `<key>.caf` copied into Library/Sounds. */
export const BUILT_IN_SOUNDS = [
  { key: 'chime', name: 'Chime' },
  { key: 'pop', name: 'Pop' },
  { key: 'fanfare', name: 'Fanfare' },
  { key: 'tick', name: 'Tick' },
  { key: 'whoosh', name: 'Whoosh' },
  { key: 'bell', name: 'Bell' },
] as const;
export const BUILT_IN_VERSION = 1;

export const KIND_INFO: Record<NotificationKind, { label: string; when: string; hasOwnPicture: boolean }> = {
  contest_posted: { label: 'A contest is posted', when: 'To everyone it is open to, as it is posted', hasOwnPicture: true },
  contest_closing: { label: 'Contest closing soon', when: '2 hours before it closes, to people who have not entered', hasOwnPicture: true },
  contest_results: { label: 'Contest results', when: 'When it closes, to everyone who entered or voted', hasOwnPicture: true },
  cup_lobby: { label: 'Tournament lobby opens', when: 'To everyone the tournament would enter', hasOwnPicture: true },
  cup_match_open: { label: 'Your match is on', when: 'To the two players, as their match opens', hasOwnPicture: true },
  cup_betting_open: { label: 'Bets are open', when: 'To everyone watching, as a top match opens for bets', hasOwnPicture: true },
  cup_champion: { label: 'A champion', when: 'To everyone in the tournament, after the final', hasOwnPicture: true },
  other: { label: 'Everything else', when: 'Leave, approvals, reminders, the feed and the rest', hasOwnPicture: false },
};

/**
 * Sowaka's own choice for every company, until a company (or the Sowaka-wide
 * row) says otherwise. `other` is exactly the push as it was before looks.
 */
export const SOWAKA_DEFAULT_LOOKS: Record<NotificationKind, KindLook> = {
  contest_posted: { enabled: true, sound: 'chime', ownPicture: true, pictureKey: null },
  contest_closing: { enabled: true, sound: 'tick', ownPicture: true, pictureKey: null },
  contest_results: { enabled: true, sound: 'fanfare', ownPicture: true, pictureKey: null },
  cup_lobby: { enabled: true, sound: 'bell', ownPicture: true, pictureKey: null },
  cup_match_open: { enabled: true, sound: 'whoosh', ownPicture: true, pictureKey: null },
  cup_betting_open: { enabled: true, sound: 'pop', ownPicture: true, pictureKey: null },
  cup_champion: { enabled: true, sound: 'fanfare', ownPicture: true, pictureKey: null },
  other: { enabled: true, sound: null, ownPicture: false, pictureKey: null },
};

const CONTEST_POSTED = /^post_published_(caption_challenge|photo_story_challenge|most_likely)$/;

/** Which look a notification takes, from its scenario. */
export function kindOfScenario(scenario: string): NotificationKind {
  if (CONTEST_POSTED.test(scenario)) return 'contest_posted';
  // "You're up next" and a tie's replay are your match too.
  if (scenario === 'cup_up_next' || scenario === 'cup_replay') return 'cup_match_open';
  return (NOTIFICATION_KINDS as readonly string[]).includes(scenario) && scenario !== 'other'
    ? (scenario as NotificationKind)
    : 'other';
}

// ------------------------------------------------------------ sounds

export interface SoundEntry {
  key: string;
  name: string;
  version: number;
  builtIn: boolean;
  /** Where the app downloads it (a path on this API); null for a built-in one. */
  url: string | null;
}

/** Android: one channel per sound and version (a channel's sound cannot change). */
export function channelIdFor(key: string, version: number) {
  return `snd_${key}_v${version}`;
}
/** What the app reports for a sound it has, and the server matches on. */
export function soundTag(key: string, version: number) {
  return `${key}@${version}`;
}
/** The file name iOS looks for in Library/Sounds: built-ins are CAF, uploads WAV. */
export function iosSoundFile(entry: Pick<SoundEntry, 'key' | 'builtIn'>) {
  return `${entry.key}.${entry.builtIn ? 'caf' : 'wav'}`;
}

export const SOUND_KEY = /^[a-z][a-z0-9_]{1,23}$/;
/** iOS plays nothing longer than 30 seconds. */
export const MAX_SOUND_MS = 30_000;
export const MAX_SOUND_BYTES = 1024 * 1024;

const looksCollection = () => getDb().collection<NotificationLookDoc>('notification_looks');
const soundsCollection = () => getDb().collection<NotificationSoundRecord>('notification_sounds');
const soundFiles = () =>
  getDb().collection<{ objectKey: string; bytes: Buffer; createdAt: Date }>('notification_sound_files');

const CACHE_MS = 60_000;
const soundCache = new Map<string, { at: number; value: SoundEntry[] }>();
const lookCache = new Map<string, { at: number; value: Record<NotificationKind, KindLook> }>();

/** Forgets what was read, so the next push reads the looks and sounds again. */
export function forgetNotificationLooks() {
  soundCache.clear();
  lookCache.clear();
}

export function soundFileUrl(id: string) {
  return `/notifications/sounds/file/${encodeURIComponent(id)}`;
}

/** Built-ins with any uploaded version laid over them: the newest version of each key wins. */
export function mergeSounds(uploads: NotificationSoundRecord[]): SoundEntry[] {
  const byKey = new Map<string, SoundEntry>();
  for (const sound of BUILT_IN_SOUNDS) {
    byKey.set(sound.key, { key: sound.key, name: sound.name, version: BUILT_IN_VERSION, builtIn: true, url: null });
  }
  for (const row of uploads) {
    const have = byKey.get(row.key);
    if (have && have.version >= row.version) continue;
    byKey.set(row.key, { key: row.key, name: row.name, version: row.version, builtIn: false, url: soundFileUrl(row.id) });
  }
  return [...byKey.values()];
}

/** The sounds a company's phones may have: the built-ins, Sowaka-wide uploads and the company's own. */
export async function soundsFor(org: string): Promise<SoundEntry[]> {
  const hit = soundCache.get(org);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const uploads = await soundsCollection()
    .find({ org: { $in: ['*', org] } }, { projection: { _id: 0 } })
    .sort({ version: 1 })
    .toArray();
  const value = mergeSounds(uploads);
  soundCache.set(org, { at: Date.now(), value });
  return value;
}

export type WavInfo = { channels: number; sampleRate: number; bitsPerSample: number; durationMs: number };

/**
 * Reads a WAV file's header: linear PCM, 8 or 16 bit, mono or stereo, which
 * both iOS (as a notification sound) and Android (as a channel's) play.
 */
export function parseWav(bytes: Buffer): WavInfo | { error: string } {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    return { error: 'A sound must be a WAV file' };
  }
  let at = 12;
  let fmt: { format: number; channels: number; sampleRate: number; byteRate: number; bits: number } | undefined;
  let dataSize: number | undefined;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      fmt = {
        format: bytes.readUInt16LE(body),
        channels: bytes.readUInt16LE(body + 2),
        sampleRate: bytes.readUInt32LE(body + 4),
        byteRate: bytes.readUInt32LE(body + 8),
        bits: bytes.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataSize = Math.min(size, bytes.length - body);
      break;
    }
    // Chunks are padded to an even length.
    at = body + size + (size % 2);
  }
  if (!fmt || dataSize === undefined) return { error: 'The WAV file has no sound in it' };
  // 0xFFFE is WAVE_FORMAT_EXTENSIBLE, which iOS reads as PCM when it is PCM; only plain PCM is taken.
  if (fmt.format !== 1) return { error: 'The WAV file must be plain PCM (not compressed)' };
  if (![8, 16].includes(fmt.bits)) return { error: 'The WAV file must be 8 or 16 bit' };
  if (![1, 2].includes(fmt.channels)) return { error: 'The WAV file must be mono or stereo' };
  if (fmt.sampleRate < 8000 || fmt.sampleRate > 48000 || fmt.byteRate <= 0) return { error: 'The WAV file’s sample rate must be 8 to 48 kHz' };
  const durationMs = Math.round((dataSize / fmt.byteRate) * 1000);
  if (durationMs <= 0) return { error: 'The WAV file has no sound in it' };
  if (durationMs > MAX_SOUND_MS) return { error: 'A sound must be 30 seconds or shorter' };
  return { channels: fmt.channels, sampleRate: fmt.sampleRate, bitsPerSample: fmt.bits, durationMs };
}

export class NotificationLookError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

/** A key from a name: "Diwali drum!" → `diwali_drum`. */
export function soundKeyFrom(name: string) {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9_]+/, '')
    .slice(0, 24);
  return slug.length >= 2 ? slug : '';
}

/**
 * Stores an uploaded sound as the next version of its key, for this company
 * only. Uploading under a built-in key ("chime") replaces that sound for the
 * company: its phones download the new one, and pushes use it once they have.
 */
export async function uploadNotificationSound(
  org: string,
  userId: string,
  input: { name: string; key?: string; bytes: Buffer },
): Promise<SoundEntry> {
  const name = input.name.trim().slice(0, 40);
  const key = (input.key?.trim().toLowerCase() || soundKeyFrom(name));
  if (!name) throw new NotificationLookError(400, 'Give the sound a name');
  if (!SOUND_KEY.test(key)) throw new NotificationLookError(400, 'A sound’s key is 2 to 24 lowercase letters, digits or _, starting with a letter');
  if (input.bytes.length > MAX_SOUND_BYTES) throw new NotificationLookError(413, 'A sound must be 1 MB or smaller');
  const wav = parseWav(input.bytes);
  if ('error' in wav) throw new NotificationLookError(400, wav.error);
  const latest = (await soundsFor(org)).find((sound) => sound.key === key);
  const version = (latest?.version ?? 0) + 1;
  const id = randomUUID();
  const file = { bytes: input.bytes, contentType: 'audio/wav', size: input.bytes.length };
  let objectKey = `mongo-sound/${id}`;
  const keepInMongo = async () => {
    await soundFiles().insertOne({ objectKey, bytes: input.bytes, createdAt: new Date() });
  };
  if (s3Configured()) {
    const s3Key = `${NOTIFICATION_SOUND_PREFIX}${org.replace(/[^a-zA-Z0-9_-]/g, '_')}/${key}-v${version}-${id}.wav`;
    try {
      await putConnectObject(s3Key, file);
      objectKey = s3Key;
    } catch (error) {
      // As media does: no explicit key means an instance role was expected, and
      // none resolving means this is not on AWS (local work), not a real failure.
      if (env.s3.accessKeyId) throw error;
      await keepInMongo();
    }
  } else {
    await keepInMongo();
  }
  const record: NotificationSoundRecord = {
    id, org, key, name, version, objectKey, contentType: 'audio/wav', size: input.bytes.length,
    durationMs: wav.durationMs, createdAt: new Date(), createdBy: userId,
  };
  await soundsCollection().insertOne({ ...record });
  forgetNotificationLooks();
  return { key, name, version, builtIn: false, url: soundFileUrl(id) };
}

/** One uploaded sound's bytes, for the app's download and the dashboard's ▶. */
export async function readNotificationSound(id: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const record = await soundsCollection().findOne({ id }, { projection: { _id: 0 } });
  if (!record) return null;
  if (record.objectKey.startsWith('mongo-sound/')) {
    const row = await soundFiles().findOne({ objectKey: record.objectKey });
    if (!row) return null;
    // Mongo hands a stored Buffer back as a Binary.
    const raw = row.bytes as unknown as { buffer: ArrayBuffer } | Buffer;
    return { bytes: Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer), contentType: record.contentType };
  }
  return { bytes: await readNotificationSoundObject(record.objectKey), contentType: record.contentType };
}

/** What the app downloads: every sound a phone at this company may be asked to play. */
export async function soundManifest(org: string) {
  return (await soundsFor(org)).map(({ key, name, url, version, builtIn }) => ({ key, name, url, version, builtIn }));
}

// ------------------------------------------------------------ looks

function cleanLook(raw: unknown): KindLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<KindLook>;
  return {
    enabled: value.enabled !== false,
    sound: typeof value.sound === 'string' && value.sound ? value.sound : null,
    ownPicture: value.ownPicture === true,
    pictureKey: typeof value.pictureKey === 'string' && value.pictureKey ? value.pictureKey : null,
  };
}

/** Company row first, then the Sowaka-wide row, then Sowaka's defaults, kind by kind. */
export function resolveLooks(
  company: NotificationLookDoc | null,
  sowaka: NotificationLookDoc | null,
): Record<NotificationKind, KindLook> {
  return Object.fromEntries(
    NOTIFICATION_KINDS.map((kind) => [
      kind,
      cleanLook(company?.kinds?.[kind]) ?? cleanLook(sowaka?.kinds?.[kind]) ?? { ...SOWAKA_DEFAULT_LOOKS[kind] },
    ]),
  ) as Record<NotificationKind, KindLook>;
}

export async function looksFor(org: string): Promise<Record<NotificationKind, KindLook>> {
  const hit = lookCache.get(org);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const rows = await looksCollection().find({ org: { $in: [org, '*'] } }, { projection: { _id: 0 } }).toArray();
  const value = resolveLooks(rows.find((row) => row.org === org) ?? null, rows.find((row) => row.org === '*') ?? null);
  lookCache.set(org, { at: Date.now(), value });
  return value;
}

/** A Connect media key or a picture link this API can hand a phone; anything else is no picture. */
function mediaKeyAllowed(key: string) {
  return key.startsWith('mongo/') || isConnectMediaKey(key);
}

/** The link a phone fetches the picture from, with no sign-in: `/media/<key>` at the 1080 px copy, named for its type. */
export function pictureUrl(keyOrUrl: string | null | undefined): string | null {
  const value = String(keyOrUrl ?? '').trim();
  if (!value) return null;
  if (value.startsWith('https://')) return value;
  if (value.startsWith('/media/')) return `${env.publicApiUrl}${value}`;
  if (!mediaKeyAllowed(value)) return null;
  // `push=1`: served under a file name that says its real type (see pushPictureName).
  return `${env.publicApiUrl}${mediaPath(value, 1080)}&push=1`;
}

/** The post's or event's own picture when the look takes it and there is one, else the look's own. */
export function chooseImage(look: KindLook, own?: string | null): string | null {
  if (!look.enabled) return null;
  if (look.ownPicture) {
    const url = pictureUrl(own);
    if (url) return url;
  }
  return pictureUrl(look.pictureKey);
}

// ------------------------------------------------------------ the push

export interface PushDevice {
  token: string;
  platform: 'android' | 'ios' | 'web';
  /** `key@version` of every sound the phone has; absent on builds before sounds. */
  sounds?: string[];
}

export type PushVariant = { channelId: string; apnsSound: string };

/** The sound this phone plays: the look's, if the phone has that version, else the plain one. */
export function deviceVariant(look: KindLook, sound: SoundEntry | undefined, device: PushDevice): PushVariant {
  const plain = { channelId: DEFAULT_CHANNEL_ID, apnsSound: DEFAULT_APNS_SOUND };
  if (!look.enabled || !look.sound || !sound || sound.key !== look.sound) return plain;
  if (!device.sounds?.includes(soundTag(sound.key, sound.version))) return plain;
  return { channelId: channelIdFor(sound.key, sound.version), apnsSound: iosSoundFile(sound) };
}

export interface PushContent {
  scenario: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data: Record<string, string>;
  imageUrl: string | null;
}

/** FCM takes at most 500 tokens a call. */
const SLICE = 500;

/**
 * The FCM messages for one notification: one per sound variant (phones that
 * have the sound, phones that do not), each at most 500 tokens.
 */
export function buildPushMessages(content: PushContent, look: KindLook, sound: SoundEntry | undefined, devices: PushDevice[]): MulticastMessage[] {
  const groups = new Map<string, { variant: PushVariant; tokens: string[] }>();
  for (const device of devices) {
    const variant = deviceVariant(look, sound, device);
    const id = `${variant.channelId}|${variant.apnsSound}`;
    const group = groups.get(id) ?? { variant, tokens: [] };
    group.tokens.push(device.token);
    groups.set(id, group);
  }
  const image = content.imageUrl;
  const data: Record<string, string> = {
    ...content.data,
    scenario: content.scenario,
    kind: content.kind,
    // The app shows the picture itself when the push lands while it is open.
    ...(image ? { imageUrl: image } : {}),
  };
  const messages: MulticastMessage[] = [];
  for (const { variant, tokens } of groups.values()) {
    for (let at = 0; at < tokens.length; at += SLICE) {
      messages.push({
        tokens: tokens.slice(at, at + SLICE),
        notification: { title: content.title, body: content.body, ...(image ? { imageUrl: image } : {}) },
        data,
        android: {
          priority: 'high',
          notification: { channelId: variant.channelId, ...(image ? { imageUrl: image } : {}) },
        },
        apns: {
          // mutable-content lets the app's Notification Service Extension fetch the picture first.
          payload: { aps: { sound: variant.apnsSound, ...(image ? { mutableContent: true } : {}) } },
          ...(image ? { fcmOptions: { imageUrl: image } } : {}),
        },
      });
    }
  }
  return messages;
}

/**
 * Everything one company's push of this kind needs: the look, its sound and
 * the picture. Never throws: should the looks be unreadable, the push goes
 * out as it always did.
 */
export async function lookForPush(org: string, kind: NotificationKind, ownPicture?: string | null) {
  try {
    const [looks, sounds] = await Promise.all([looksFor(org), soundsFor(org)]);
    const look = looks[kind];
    const sound = look.enabled && look.sound ? sounds.find((entry) => entry.key === look.sound) : undefined;
    return { look, sound, imageUrl: chooseImage(look, ownPicture) };
  } catch (error) {
    logger.warn('Notification look not read; sending it plain', { org, kind }, error);
    return { look: { ...SOWAKA_DEFAULT_LOOKS.other }, sound: undefined, imageUrl: null };
  }
}

// ------------------------------------------------------------ the dashboard

/** Setup › Notification sounds and pictures: every kind as it stands, and the sounds to pick from. */
export async function adminNotificationLook(org: string) {
  const rows = await looksCollection().find({ org: { $in: [org, '*'] } }, { projection: { _id: 0 } }).toArray();
  const company = rows.find((row) => row.org === org) ?? null;
  const defaults = resolveLooks(null, rows.find((row) => row.org === '*') ?? null);
  const current = resolveLooks(company, rows.find((row) => row.org === '*') ?? null);
  return {
    kinds: NOTIFICATION_KINDS.map((kind) => ({
      kind,
      ...KIND_INFO[kind],
      look: current[kind],
      defaultLook: defaults[kind],
      isDefault: !cleanLook(company?.kinds?.[kind]),
      pictureUrl: current[kind].pictureKey ? mediaPath(current[kind].pictureKey!, 720) : null,
    })),
    sounds: await soundsFor(org),
    updatedAt: company?.updatedAt ?? null,
  };
}

/**
 * Saves the looks sent, kind by kind; a kind sent as null goes back to
 * Sowaka's default. A sound must be one this company's phones can have, and
 * a picture one of ours.
 */
export async function setNotificationLook(org: string, userId: string, kinds: Record<string, unknown>) {
  if (!kinds || typeof kinds !== 'object' || Array.isArray(kinds)) throw new NotificationLookError(400, 'Send the looks as { kinds: { <kind>: look } }');
  const sounds = new Set((await soundsFor(org)).map((sound) => sound.key));
  const set: Record<string, KindLook> = {};
  const unset: Record<string, ''> = {};
  for (const [kind, raw] of Object.entries(kinds)) {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) throw new NotificationLookError(400, `There is no notification kind "${kind}"`);
    if (raw === null) {
      unset[`kinds.${kind}`] = '';
      continue;
    }
    if (typeof raw !== 'object') throw new NotificationLookError(400, `The look for ${kind} is not valid`);
    const value = raw as Record<string, unknown>;
    if (value.sound != null && (typeof value.sound !== 'string' || !sounds.has(value.sound))) {
      throw new NotificationLookError(400, `There is no sound "${String(value.sound)}"`);
    }
    if (value.pictureKey != null && (typeof value.pictureKey !== 'string' || !mediaKeyAllowed(value.pictureKey))) {
      throw new NotificationLookError(400, 'Upload the picture here first');
    }
    const look = cleanLook(value)!;
    if (!KIND_INFO[kind as NotificationKind].hasOwnPicture) look.ownPicture = false;
    set[`kinds.${kind}`] = look;
  }
  await looksCollection().updateOne(
    { org },
    {
      $set: { ...set, updatedAt: new Date(), updatedBy: userId },
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
      $setOnInsert: { org },
    },
    { upsert: true },
  );
  forgetNotificationLooks();
  return adminNotificationLook(org);
}

/** JPEG and PNG only: what an iPhone attaches to a notification without fuss. */
const PICTURE_TYPES = new Set(['image/jpeg', 'image/png']);
export const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

/** A picture for a kind, kept like a post's photo (with the smaller copies a push links to). */
export async function uploadNotificationPicture(userId: string, file: { originalName: string; contentType: string; bytes: Buffer }) {
  if (!PICTURE_TYPES.has(file.contentType)) throw new NotificationLookError(400, 'A picture must be a JPEG or PNG');
  if (file.bytes.length > MAX_PICTURE_BYTES) throw new NotificationLookError(413, 'A picture must be 5 MB or smaller');
  const stored = await uploadConnectMedia(
    userId,
    { originalName: file.originalName || 'notification.jpg', contentType: file.contentType, size: file.bytes.length, bytes: file.bytes },
    'post',
  );
  return { objectKey: stored.objectKey, url: mediaPath(stored.objectKey, 720) };
}
