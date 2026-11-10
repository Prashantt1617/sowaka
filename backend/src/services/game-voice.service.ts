import type { Socket } from 'socket.io';
import { companies } from '../config/db';
import { logger } from '../utils/logger';

/**
 * Walkie-talkie voice for a game's table: hold the mic to talk, let go and the
 * clip goes to everyone else at the table, who hear it at once. One person
 * holds the mic at a time.
 *
 * Built once and attached to a game's socket namespace (Pool Table first):
 * the game says who is seated at the caller's table and how to reach a
 * person; this file owns the mic, the limits and the relay. Nothing is stored:
 * a clip passes through memory to the others' sockets and is gone.
 *
 * Events (client → server, acked `{ok, data}` / `{ok:false, status, message}`):
 * - `voice:hold` → `{until}` the mic is yours until then, or 409 with who has it
 * - `voice:clip {data, mime, ms}` → `{}` the recording (base64), sent to the table
 * - `voice:release` → `{}` let go without sending (a tap too short to keep)
 * Server → client: `voice:floor {userId, name, until} | {userId: null}` and
 * `voice:clip {userId, name, mime, ms, data}`.
 * The company switch is `companies.features.gameVoice`.
 */

/** The longest message: the app stops recording at 15 s; a little slack for the upload. */
export const VOICE_MAX_MS = 15_000;
const FLOOR_MS = VOICE_MAX_MS + 2_000;
/** Shorter than this is a tap, not a message. */
const VOICE_MIN_MS = 400;
/** 15 s of voice-quality AAC is about 45 KB; base64 adds a third. */
const MAX_CLIP_CHARS = 160_000;
const MIMES = new Set(['audio/mp4', 'audio/aac', 'audio/m4a', 'audio/x-m4a', 'audio/mpeg', 'audio/webm', 'audio/ogg']);

/** Who is at the caller's table, as the game knows it. */
export interface VoiceTable {
  /** Unique per table across games: `pool:sowaka:4821`. */
  channel: string;
  /** Everyone seated there now, the caller included. */
  members: string[];
}

export interface VoiceGame {
  /** The caller's table, or null when they are not seated at one. */
  tableOf(org: string, userId: string): Promise<VoiceTable | null>;
  /** Sends an event to every socket of one person. */
  emitTo(userId: string, event: string, payload: unknown): void;
}

interface Floor {
  userId: string;
  name: string;
  until: number;
  /** The table as it was when the mic was taken: who to tell when it is let go, even after the holder has left it. */
  table: VoiceTable;
}

/**
 * Who holds the mic, by table, and which table each holder holds it at. One
 * API process holds this (the backend runs a single process; a second would
 * need it in Redis); a restart frees every mic.
 */
const floors = new Map<string, Floor>();
const holding = new Map<string, string>();
const holderKey = (org: string, userId: string) => `${org}:${userId}`;

export class VoiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const switchCache = new Map<string, { on: boolean; at: number }>();
/** Whether the company has game voice on (companies.features.gameVoice), held a minute. */
export async function voiceOn(org: string): Promise<boolean> {
  const held = switchCache.get(org);
  if (held && Date.now() - held.at < 60_000) return held.on;
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, features: 1 } });
  const on = company?.features?.gameVoice === true;
  switchCache.set(org, { on, at: Date.now() });
  return on;
}

function holderOf(channel: string): Floor | null {
  const floor = floors.get(channel);
  if (!floor) return null;
  if (floor.until <= Date.now()) {
    floors.delete(channel);
    return null;
  }
  return floor;
}

function tellTable(game: VoiceGame, table: VoiceTable, except: string, event: string, payload: unknown) {
  for (const userId of table.members) if (userId !== except) game.emitTo(userId, event, payload);
}

async function tableFor(game: VoiceGame, org: string, userId: string): Promise<VoiceTable> {
  if (!(await voiceOn(org))) throw new VoiceError(403, 'Voice is not on at your company.');
  const table = await game.tableOf(org, userId);
  if (!table || !table.members.includes(userId)) throw new VoiceError(409, 'Take a seat at a table to talk.');
  return table;
}

/** The mic, if nobody else holds it. */
export async function holdMic(game: VoiceGame, who: { org: string; userId: string; name: string }) {
  const table = await tableFor(game, who.org, who.userId);
  const current = holderOf(table.channel);
  if (current && current.userId !== who.userId) throw new VoiceError(409, `${firstName(current.name)} is talking`);
  const floor = { userId: who.userId, name: who.name, until: Date.now() + FLOOR_MS, table };
  floors.set(table.channel, floor);
  holding.set(holderKey(who.org, who.userId), table.channel);
  tellTable(game, table, who.userId, 'voice:floor', { userId: floor.userId, name: floor.name, until: floor.until });
  return { until: floor.until, maxMs: VOICE_MAX_MS };
}

/** The recording, to everyone else at the table; the mic is free again. */
export async function sendClip(game: VoiceGame, who: { org: string; userId: string; name: string }, raw: Record<string, unknown>) {
  const table = await tableFor(game, who.org, who.userId);
  const current = holderOf(table.channel);
  if (!current || current.userId !== who.userId) throw new VoiceError(409, 'Hold the mic to talk.');
  const data = typeof raw.data === 'string' ? raw.data : '';
  const mime = typeof raw.mime === 'string' ? raw.mime.toLowerCase() : '';
  const ms = Math.round(Number(raw.ms));
  release(game, who.org, who.userId);
  if (!data || data.length > MAX_CLIP_CHARS || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new VoiceError(400, 'That message could not be sent.');
  if (!MIMES.has(mime)) throw new VoiceError(400, 'That recording format is not supported.');
  if (!Number.isFinite(ms) || ms < VOICE_MIN_MS) throw new VoiceError(400, 'Hold the mic a little longer to talk.');
  tellTable(game, table, who.userId, 'voice:clip', { userId: who.userId, name: who.name, mime, ms: Math.min(ms, VOICE_MAX_MS), data });
  return {};
}

/** Let go without sending. Works after the holder has left the table too: the mic remembers where it was taken. */
export async function releaseMic(game: VoiceGame, who: { org: string; userId: string }) {
  release(game, who.org, who.userId);
  return {};
}

function release(game: VoiceGame, org: string, userId: string) {
  const key = holderKey(org, userId);
  const channel = holding.get(key);
  if (!channel) return;
  holding.delete(key);
  const current = floors.get(channel);
  if (!current || current.userId !== userId) return;
  floors.delete(channel);
  tellTable(game, current.table, userId, 'voice:floor', { userId: null });
}

/** A socket that goes away, or a player who leaves the table, lets go of any mic they held. */
export async function dropMic(game: VoiceGame, org: string, userId: string) {
  try {
    release(game, org, userId);
  } catch (error) {
    logger.error('Voice release failed', { userId, org }, error);
  }
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'Someone';

/** For checks: forget every mic and switch. */
export function resetVoice(): void {
  floors.clear();
  holding.clear();
  switchCache.clear();
}

/** A socket's own voice limits: the mic twice a second at most, a clip every 2 s after a burst of three. Letting go is never limited. */
export function voiceBuckets() {
  return { hold: new RateBucket(2, 3), clip: new RateBucket(1 / 2, 3), release: new RateBucket(50, 50) };
}

export class RateBucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly rate: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Registers the three voice events on a game's socket. */
export function listenForVoice(
  socket: Socket,
  game: VoiceGame,
  who: () => Promise<{ org: string; userId: string; name: string } | null>,
) {
  const buckets = voiceBuckets();
  const on = (event: string, bucket: RateBucket, run: (person: { org: string; userId: string; name: string }, payload: Record<string, unknown>) => Promise<unknown>) => {
    socket.on(event, async (payload: unknown, ack: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (value: unknown) => void) : () => undefined;
      if (!bucket.take()) {
        reply({ ok: false, status: 429, message: 'Slow down a little and try again.' });
        return;
      }
      try {
        const person = await who();
        if (!person) {
          reply({ ok: false, status: 403, message: 'Close and reopen the game to talk.' });
          return;
        }
        const data = await run(person, payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {});
        reply({ ok: true, data: data ?? {} });
      } catch (error) {
        if (error instanceof VoiceError) {
          reply({ ok: false, status: error.status, message: error.message });
          return;
        }
        logger.error('Voice request failed', { event, userId: socket.data.userId }, error);
        reply({ ok: false, status: 500, message: 'Something went wrong. Try again.' });
      }
    });
  };
  on('voice:hold', buckets.hold, (person) => holdMic(game, person));
  on('voice:clip', buckets.clip, (person, payload) => sendClip(game, person, payload));
  on('voice:release', buckets.release, (person) => releaseMic(game, person));
}
