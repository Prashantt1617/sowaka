/**
 * The tournament TV on a public link, no sign-in: `GET /cup/tv/<token>` (the
 * page), `/cup/tv/<token>/state` (its poll) and `/cup/tv/<token>/face/<pid>/<v>.webp`.
 *
 * The link is the credential, made by the host (`cup-event.ts tv-link --id <event>`):
 * 256 bits, derived from a random nonce kept per event (`cup_tv_links`) and this
 * server's secret, so the host can print the same link again; only its hash is
 * looked up. It is read only, for that one event, and has no expiry: it works
 * until the host switches it off (`tv-link --revoke true`) or makes a new one
 * (`--new true`). An event removed while its link is on shows a calm "This
 * tournament has ended" screen (nothing else).
 *
 * The payload is the dashboard TV's state (`tvStateFor`), made safe to show to
 * anyone holding the link: first names and faces only. Every userId becomes a
 * short opaque id for this event (the same in every poll), the event id leaves
 * every match id, and anything about the person or the company beyond their
 * first name is dropped (`publicTvPayload`). It is built once a second per
 * event, whoever is polling, and the faces map travels only when it changed.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Collection } from 'mongodb';
import { getDb } from '../config/db';
import { env } from '../config/env';
import type { CupEvent } from '../models/cup.model';
import { logger } from '../utils/logger';
import { tvStateFor } from './cup-bets.service';
import { cupEvents, cupThumb, type CupViewer } from './cup.service';

// ---------------------------------------------------------------- the link

interface CupTvLink {
  _id: string;
  eventId: string;
  /** With this server's secret, gives the token back (`tvLinkFor`). */
  nonce: string;
  /** sha256 of the token, hex: what a request is looked up by. */
  hash: string;
  createdAt: Date;
}

export function cupTvLinks(): Collection<CupTvLink> {
  return getDb().collection<CupTvLink>('cup_tv_links');
}

/** The public address: livetv.getsowaka.com's CloudFront sends `/tv/*` to this server; `--tv-base` for another. */
export const TV_BASE = 'https://livetv.getsowaka.com/tv';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

let linkKey: Buffer | null = null;
const keyOf = () => (linkKey ??= createHash('sha256').update(`cup-tv-link:${env.scribbleTicketSecret || env.mongoUri}`).digest());
const tokenOf = (eventId: string, nonce: string) => createHmac('sha256', keyOf()).update(`${eventId}:${nonce}`).digest('base64url');
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * The event's TV token: the one made before, or (none yet, or `rotate`) a new
 * one, which ends the old. Throws when the one kept was made with another
 * secret (another machine's .env): `rotate` then.
 */
export async function tvLinkFor(eventId: string, rotate = false): Promise<{ token: string; created: boolean }> {
  const kept = await cupTvLinks().findOne({ _id: eventId });
  if (kept && !rotate) {
    const token = tokenOf(eventId, kept.nonce);
    if (hashOf(token) !== kept.hash) throw new Error('The TV link kept for this event was made with another secret: run again with --new true');
    return { token, created: false };
  }
  const nonce = randomBytes(18).toString('base64url');
  const token = tokenOf(eventId, nonce);
  await cupTvLinks().updateOne({ _id: eventId }, { $set: { eventId, nonce, hash: hashOf(token), createdAt: new Date() } }, { upsert: true });
  forgetTvLinks();
  return { token, created: true };
}

/** Switches an event's TV link off (no link works for it until a new one is made). */
export async function revokeTvLink(eventId: string): Promise<boolean> {
  const { deletedCount } = await cupTvLinks().deleteOne({ _id: eventId });
  forgetTvLinks();
  return deletedCount > 0;
}

/**
 * What `cup-event.ts tv-link` prints: the link at `--tv-base` (default the public
 * livetv address, which forwards to `/cup/tv/`); `--link-base <api>` prints the
 * API's own `/cup/tv/` address instead. `--revoke true` switches it off.
 */
export async function tvLinkCommand(event: Pick<CupEvent, 'id'>, flags: Record<string, string>): Promise<string> {
  if (flags.revoke === 'true') {
    return (await revokeTvLink(event.id))
      ? `TV link for ${event.id} switched off: it stops within 5 seconds (screens on it say it no longer works). A new one: tv-link --id ${event.id}`
      : `No TV link to switch off for ${event.id}.`;
  }
  const { token, created } = await tvLinkFor(event.id, flags.new === 'true');
  const base = flags['tv-base'] ? flags['tv-base'].replace(/\/+$/, '') : flags['link-base'] ? `${flags['link-base'].replace(/\/+$/, '')}/cup/tv` : TV_BASE;
  const url = `${base}/${token}`;
  return [
    `${created ? 'New TV link' : 'TV link'} for ${event.id} (read only, no sign-in; anyone with it sees first names and faces):`,
    `  ${url}`,
    `  stream view: ${url}?stream=1`,
    'It has no expiry. Switch it off: --revoke true · a new one (the old stops at once): --new true',
  ].join('\n');
}

interface Resolved {
  /** The link is on but its event was removed: the page says the tournament has ended, nothing more. */
  ended?: true;
  eventId: string;
  org: string;
  /** Everyone the event knows, by userId: their full name (to keep it out of the payload). */
  people: Map<string, string>;
}
const resolved = new Map<string, { at: number; value: Resolved | null }>();
/** Tokens that worked lately: looked up again even from an address that has tried too many wrong ones. */
const knownGood = new Map<string, number>();
const RESOLVE_MS = 5000;

export function forgetTvLinks(): void {
  resolved.clear();
}

/** The event a token opens, if it still works. Re-checked every few seconds (a removed event stops within 5 s). */
export async function resolveTvToken(token: string, ip: string): Promise<Resolved | null> {
  if (!TOKEN.test(token)) {
    countBad(ip);
    return null;
  }
  const hash = hashOf(token);
  const now = Date.now();
  const kept = resolved.get(hash);
  if (kept && now - kept.at < RESOLVE_MS) {
    if (kept.value) knownGood.set(hash, now);
    return kept.value;
  }
  if (!knownGood.has(hash) && isLimited(`bad:${ip}`, LIMITS.badToken)) throw new TvLimited();
  const link = await cupTvLinks().findOne({ hash }, { projection: { _id: 0, eventId: 1 } });
  const event = link
    ? await cupEvents().findOne(
        { id: link.eventId },
        { projection: { _id: 0, id: 1, org: 1, startAt: 1, finishedAt: 1, phase: 1, updatedAt: 1, entrants: 1, lobbyJoined: 1, includeUserIds: 1 } },
      )
    : null;
  const value: Resolved | null = event
    ? { eventId: event.id, org: event.org, people: new Map((event.entrants ?? []).map((e) => [e.userId, e.name])) }
    : link
      ? { ended: true, eventId: link.eventId, org: '', people: new Map() }
      : null;
  if (value && !value.ended) {
    for (const id of [...(event?.lobbyJoined ?? []), ...(event?.includeUserIds ?? [])]) if (!value.people.has(id)) value.people.set(id, '');
    knownGood.set(hash, now);
    if (knownGood.size > 200) knownGood.clear();
  } else countBad(ip);
  if (resolved.size > 2000) resolved.clear();
  resolved.set(hash, { at: now, value });
  return value;
}

// ---------------------------------------------------------------- rate limits (per address, in memory)

export class TvLimited extends Error {
  constructor() {
    super('Too many requests');
  }
}

/**
 * Per client address, per minute (the page polls every 2.5 s: 24 a minute a screen). Every viewer
 * comes through Vercel and CloudFront, so many screens share an address: high per address, and the
 * event-wide cap is the real guard (the payload is built at most once a second however many poll).
 */
export const LIMITS = {
  page: { max: 2000, windowMs: 60_000 },
  state: { max: 6000, windowMs: 60_000 },
  face: { max: 60_000, windowMs: 60_000 },
  /** Wrong tokens: after this many in 10 minutes, an address gets no more lookups (a token that worked lately still does). */
  badToken: { max: 30, windowMs: 10 * 60_000 },
  /** One event's polls, all addresses together (500 screens). */
  event: { max: 12_000, windowMs: 60_000 },
};

const buckets = new Map<string, { count: number; resetAt: number }>();

function bucket(key: string, windowMs: number, now: number) {
  let entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(key, entry);
    if (buckets.size > 20_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  return entry;
}

const isLimited = (key: string, limit: { max: number; windowMs: number }) => bucket(key, limit.windowMs, Date.now()).count >= limit.max;
const countBad = (ip: string) => {
  bucket(`bad:${ip}`, LIMITS.badToken.windowMs, Date.now()).count += 1;
};

/** Counts one call; throws `TvLimited` past the limit. */
export function rateLimitTv(kind: 'page' | 'state' | 'face', ip: string, eventId?: string): void {
  const now = Date.now();
  const mine = bucket(`${kind}:${ip}`, LIMITS[kind].windowMs, now);
  mine.count += 1;
  if (mine.count > LIMITS[kind].max) throw new TvLimited();
  if (eventId && kind === 'state') {
    const all = bucket(`event:${eventId}`, LIMITS.event.windowMs, now);
    all.count += 1;
    if (all.count > LIMITS.event.max) throw new TvLimited();
  }
}

export function resetTvRateLimits(): void {
  buckets.clear();
  knownGood.clear();
}

// ---------------------------------------------------------------- the payload

/** The viewer the engine is asked as: nobody in the event, not HR (its `me` part is dropped anyway). */
const tvViewer = (org: string): CupViewer => ({ userId: 'cup-tv-public', name: 'TV', org, hr: false });

type Source = (eventId: string, org: string) => Promise<Record<string, unknown>>;
let source: Source = (eventId, org) => tvStateFor(tvViewer(org), eventId);
/** For the checks: where the raw state comes from (fixtures instead of the engine). */
export function setCupTvSourceForChecks(next: Source | null): void {
  source = next ?? ((eventId, org) => tvStateFor(tvViewer(org), eventId));
  built.clear();
}

/** Keys never sent, wherever they are. */
const DROP = new Set([
  'success', 'me', 'mine', 'email', 'emails', 'employeeId', 'employeeCode', 'empId', 'phone', 'mobile', 'designation', 'department',
  'org', 'orgName', 'managerId', 'lifecycleStatus', 'excludeUserIds', 'includeUserIds', 'lobbySeen', 'linkBase', 'linkUntil', 'imageKey',
  'profilePhotoKey', 'profilePhotoUrl', 'faceVer', 'boardRank', 'lastName', 'surname', 'fullName', 'hr', 'balance', 'photosV', 'catalogKey',
]);
/** Keys holding a person's name: the first name only. */
const NAME_KEYS = new Set(['name', 'firstName', 'displayName']);
/** A face's address as the engine makes it. */
const THUMB = /^\/cup\/api\/thumb\/([^/]+)\/([^/]+)\/([kd][A-Za-z0-9_-]{1,20})\/([A-Za-z0-9_-]+)\.webp$/;

export const firstNameOf = (name: unknown) => (typeof name === 'string' ? name.trim().split(/\s+/)[0] ?? '' : '');

interface Face {
  userId: string;
  v: string;
  sig: string;
}

export interface PublicTv {
  /** The state, faces map apart; no `serverNow` (added per answer). */
  body: string;
  /** opaque id → face version (null: no photo), as JSON. */
  faces: string;
  /** Versions, for `?h=` and `?pv=`. */
  hash: string;
  facesV: string;
  /** opaque id → the engine's face, for the face route. */
  faceMap: Map<string, Face>;
}

/**
 * The raw TV state made public: userIds to opaque ids (keys, values, inside
 * strings), names to first names, faces to `{ pid: version }`, the event id
 * out of every id, and everything personal or about the company dropped.
 * Pure (for the checks): `pidOf` names each person.
 */
export function publicTvPayload(raw: Record<string, unknown>, eventId: string, people: Map<string, string>, pidOf: (userId: string) => string): Omit<PublicTv, 'hash' | 'facesV'> {
  const ids = new Map<string, string>();
  const names = new Map<string, string>(people);
  const learn = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(learn);
    else if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (typeof o.userId === 'string' && o.userId) {
        const full = typeof o.name === 'string' ? o.name : typeof o.firstName === 'string' ? o.firstName : '';
        if (!names.get(o.userId)) names.set(o.userId, full);
      }
      Object.values(o).forEach(learn);
    }
  };
  learn(raw);
  const photos = (raw.photos && typeof raw.photos === 'object' ? raw.photos : {}) as Record<string, unknown>;
  for (const id of [...names.keys(), ...Object.keys(photos)]) if (id && !ids.has(id)) ids.set(id, pidOf(id));
  // Longest first, so one id inside another is never half replaced.
  const long = [...ids.keys()].filter((id) => id.length >= 6).sort((a, b) => b.length - a.length);
  const evLong = eventId.length >= 4;
  const str = (s: string): string => {
    const exact = ids.get(s);
    if (exact) return exact;
    let out = s;
    if (evLong && out.includes(eventId)) out = out.split(`${eventId}-`).join('').split(eventId).join('ev');
    for (const id of long) if (out.includes(id)) out = out.split(id).join(ids.get(id)!);
    return out;
  };
  const faceMap = new Map<string, Face>();
  const faces: Record<string, string | null> = {};
  const faceOf = (userId: string, url: unknown) => {
    const pid = ids.get(userId) ?? pidOf(userId);
    const m = typeof url === 'string' ? THUMB.exec(url) : null;
    if (m && decodeURIComponent(m[1]) === eventId && decodeURIComponent(m[2]) === userId) {
      faceMap.set(pid, { userId, v: m[3], sig: m[4] });
      faces[pid] = m[3];
    } else if (!(pid in faces)) faces[pid] = null;
  };
  for (const [userId, url] of Object.entries(photos)) faceOf(userId, url);
  const walk = (node: unknown, person: boolean): unknown => {
    if (typeof node === 'string') return str(node);
    if (Array.isArray(node)) return node.map((x) => walk(x, false));
    if (!node || typeof node !== 'object') return node;
    const o = node as Record<string, unknown>;
    const isPerson = typeof o.userId === 'string';
    if (isPerson && 'photoUrl' in o) faceOf(o.userId as string, o.photoUrl);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (DROP.has(k) || k === 'photoUrl' || k === 'photos') continue;
      const key = str(k);
      if ((isPerson || person) && NAME_KEYS.has(k)) out[key] = firstNameOf(v);
      else out[key] = walk(v, false);
    }
    return out;
  };
  const state = walk(raw, false) as Record<string, unknown>;
  const event = state.event as Record<string, unknown> | null | undefined;
  if (event && typeof event === 'object') {
    delete event.id;
    // The event's own name is the tournament's, not a person's: as it is.
    const rawEvent = raw.event as Record<string, unknown> | null | undefined;
    if (rawEvent && typeof rawEvent.name === 'string') event.name = rawEvent.name;
  }
  if (state.bets && typeof state.bets === 'object') {
    const bets = state.bets as Record<string, unknown>;
    state.bets = bets.onStage ? { onStage: bets.onStage } : {};
  }
  let body = JSON.stringify(state);
  // Last: no full name anywhere (a name in a sentence, say). The first name stays.
  for (const full of names.values()) {
    const first = firstNameOf(full);
    if (full && full.trim() !== first && body.includes(full.trim())) {
      logger.warn('Cup TV: a full name was in the public state; cut to the first name');
      body = body.split(full.trim()).join(first);
    }
  }
  return { body, faces: JSON.stringify(faces), faceMap };
}

let pidKey: Buffer | null = null;
const pidOfIn = (eventId: string) => (userId: string) =>
  `p${createHmac('sha256', (pidKey ??= createHash('sha256').update(`cup-tv-pid:${env.scribbleTicketSecret || env.mongoUri}`).digest())).update(`${eventId}:${userId}`).digest('base64url').slice(0, 11)}`;

const BUILD_MS = 1000;
const built = new Map<string, { at: number; value: PublicTv }>();
const building = new Map<string, Promise<PublicTv>>();
const short = (s: string) => createHash('sha256').update(s).digest('base64url').slice(0, 12);

/** The public state of an event, built at most once a second whoever asks. */
export async function publicTvFor(link: Resolved): Promise<PublicTv> {
  const kept = built.get(link.eventId);
  if (kept && Date.now() - kept.at < BUILD_MS) return kept.value;
  let making = building.get(link.eventId);
  if (!making) {
    making = (async () => {
      const raw = await source(link.eventId, link.org);
      const out = publicTvPayload(raw, link.eventId, link.people, pidOfIn(link.eventId));
      const value: PublicTv = { ...out, hash: short(out.body), facesV: short(out.faces) };
      if (built.size > 50) built.clear();
      built.set(link.eventId, { at: Date.now(), value });
      return value;
    })().finally(() => building.delete(link.eventId));
    building.set(link.eventId, making);
  }
  return making;
}

/** One answer of the poll: unchanged when the page holds this version; the faces only when it lacks them. */
export function tvAnswer(tv: PublicTv, held: { h?: unknown; pv?: unknown }): string {
  const now = JSON.stringify(new Date());
  if (held.h === tv.hash && held.pv === tv.facesV) return `{"unchanged":true,"serverNow":${now},"h":"${tv.hash}"}`;
  const faces = held.pv === tv.facesV ? '' : `,"faces":${tv.faces},"facesV":"${tv.facesV}"`;
  return `{"serverNow":${now},"h":"${tv.hash}"${faces},${tv.body.slice(1)}`;
}

/** A face for the TV: only someone this event's public state shows, at the version it shows. */
export async function tvFace(link: Resolved, pid: string, v: string): Promise<Buffer | null> {
  if (!/^p[A-Za-z0-9_-]{11}$/.test(pid) || !/^[kd][A-Za-z0-9_-]{1,20}$/.test(v)) return null;
  const tv = await publicTvFor(link);
  const face = tv.faceMap.get(pid);
  if (!face || face.v !== v) return null;
  return cupThumb(link.eventId, face.userId, face.v, face.sig);
}
