/**
 * The Diwali Cup: the event, the draw, the runner that moves it along, the
 * matches as the players play them, and what each person's page shows. The
 * rules themselves (seeding, free passes, how a match is decided) are in
 * `cup-rules.ts`; bets and points are `cup-bets.service.ts`, which plugs in
 * through `cupHooks`.
 *
 * Nobody signs up: everyone active at the company is in, bar the people the
 * event leaves out (`excludeUserIds`, the Support account). Until the draw the
 * list is read live; the draw (when the lobby opens) fixes it.
 *
 * The page reaches this API with a signed ticket (`X-Cup-Ticket`), never the
 * session: from the Games tab after its one reload to `/play/diwali-cup?ticket=`
 * (as Scribble does), and from the feed post through a link of its own per
 * viewer (`/cup/<event>?ticket=`). Either way the ticket names one person at
 * one company, and the event must be that company's.
 *
 * Nothing happens while an event's switch (`active`) is off: the page says the
 * Cup is not on, and the runner leaves it alone. The runner moves only the
 * orgs `CUP_RUNNER_ORGS` allows (see `env.cupRunnerOrgs`); every move it makes
 * is an update conditional on what it read, so two runners on one database
 * never move a match twice.
 *
 * Live scores come a few times a second from each player. They are kept in
 * this process and written to the match at most every few seconds; the
 * pages read them from here. Production runs one instance.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Collection } from 'mongodb';
import { env } from '../config/env';
import { companies, gameScores, getDb, users } from '../config/db';
import type { CupDecision, CupEntrant, CupEvent, CupMatch, CupRound, CupBet } from '../models/cup.model';
import { catalogScoreId } from '../models/game-catalog.model';
import type { User } from '../models/user.model';
import { hasAllDashboardTabs } from '../middleware/admin.middleware';
import { logger } from '../utils/logger';
import {
  buildDraw,
  cryptoRng,
  matchLabel,
  mayJoin,
  mayScore,
  mayStartSolo,
  nextStep,
  parseRef,
  parseLiveBoard,
  parseScore,
  seedOrderOf,
  type LiveBoard,
  type MatchStep,
} from './cup-rules';
import { newSeed } from './game-challenge-rules';
import { notifyUsers } from './notification.service';
import { mintTicket, verifyTicket } from './scribble-ticket.service';

export class CupError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'CupError';
  }
}

export function cupEvents(): Collection<CupEvent> {
  return getDb().collection<CupEvent>('cup_events');
}
export function cupMatches(): Collection<CupMatch> {
  return getDb().collection<CupMatch>('cup_matches');
}
export function cupBets(): Collection<CupBet> {
  return getDb().collection<CupBet>('cup_bets');
}

/**
 * The indexes the Cup's queries would like. NOT called: the cluster is shared
 * with production, so indexes go in by hand once approved. Each collection
 * stays small (one event, a few hundred matches, a few thousand bets), so the
 * Cup works without them.
 */
export async function proposedCupIndexes(): Promise<void> {
  await cupEvents().createIndex({ id: 1 }, { unique: true });
  await cupEvents().createIndex({ org: 1, active: 1, lobbyAt: -1 });
  await cupMatches().createIndex({ id: 1 }, { unique: true });
  await cupMatches().createIndex({ eventId: 1, status: 1 });
  await cupBets().createIndex({ matchId: 1 });
  await cupBets().createIndex({ eventId: 1, userId: 1 });
}

// ---------------------------------------------------------------- hooks for bets

/**
 * Where `cup-bets.service.ts` plugs in, by setting these when it loads. The
 * engine calls them after it has moved a match; a failure is logged and
 * never undoes the move. `state` adds the bet parts of a person's state.
 */
export const cupHooks: {
  onMatchDecided?: (match: CupMatch, event: CupEvent) => Promise<void>;
  onMatchReplayed?: (match: CupMatch, event: CupEvent) => Promise<void>;
  onMatchVoided?: (match: CupMatch, event: CupEvent, byUserId: string) => Promise<void>;
  state?: (viewer: CupViewer, event: CupEvent, current: { matchId: string; kind: 'betting' | 'live' } | null) => Promise<Record<string, unknown>>;
  balance?: (viewer: CupViewer) => Promise<number>;
  /** Settles whatever a lost hook call left behind; the runner calls it every so often while bets are taken. */
  reconcile?: (eventId: string) => Promise<number>;
} = {};

const RECONCILE_EVERY_MS = 15_000;
const lastReconcile = new Map<string, number>();

async function hook(name: string, run: (() => Promise<void> | undefined) | undefined) {
  if (!run) return;
  try {
    await run();
  } catch (error) {
    logger.error('Cup hook failed', { hook: name }, error);
  }
}

// ---------------------------------------------------------------- who is asking

const INACTIVE = ['offboarded', 'terminated'] as User['lifecycleStatus'][];

export interface CupViewer {
  userId: string;
  name: string;
  org: string;
  /** May void a result: HR with the whole dashboard. */
  hr: boolean;
}

type ViewerRow = Pick<User, 'userId' | 'name' | 'org' | 'lifecycleStatus' | 'dashboardAccess' | 'dashboardAdmin' | 'dashboardTabs'>;
const viewerCache = new Map<string, { row: ViewerRow | null; at: number }>();

async function viewerRow(userId: string): Promise<ViewerRow | null> {
  const kept = viewerCache.get(userId);
  if (kept && Date.now() - kept.at < 60_000) return kept.row;
  const row = await users().findOne(
    { userId },
    { projection: { _id: 0, userId: 1, name: 1, org: 1, lifecycleStatus: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1 } },
  );
  if (viewerCache.size > 5000) viewerCache.clear();
  viewerCache.set(userId, { row, at: Date.now() });
  return row;
}

/**
 * The person a page's ticket names, provided they are still at the company
 * it was signed for. A ticket from another company, or someone who has left,
 * is refused.
 */
export async function viewerFromTicket(raw: unknown): Promise<CupViewer> {
  const verdict = verifyTicket(raw, 'ticket');
  if (!verdict.ok) throw new CupError(401, 'Close and reopen the tournament.');
  const row = await viewerRow(verdict.ticket.userId);
  if (!row || INACTIVE.includes(row.lifecycleStatus) || row.org !== verdict.ticket.org) {
    throw new CupError(401, 'Close and reopen the tournament.');
  }
  return { userId: row.userId, name: row.name, org: row.org, hr: row.dashboardAccess === true && hasAllDashboardTabs(row) };
}

// ---------------------------------------------------------------- the event in memory

/**
 * One event as this process holds it: the event, every match (refreshed each
 * second for the ones not yet decided), the live scores reported here, and a
 * revision that goes up with any change a page would draw.
 */
interface Runtime {
  event: CupEvent;
  matches: Map<string, CupMatch>;
  /** Live scores by `${matchId}:${attempt}:${userId}`. */
  live: Map<string, { score: number; at: number }>;
  /** Where each player is in the match's boards (memory only), by the same key: for viewers to draw both boards. */
  boards: Map<string, LiveBoard & { at: number }>;
  persisted: Map<string, number>;
  rev: number;
  refreshedAt: number;
  refreshing: Promise<Runtime | null> | null;
  shared?: { rev: number; count: number; json: string; current: CurrentStage | null };
  /** The company's name, for the page's header. */
  orgName?: string;
  standings?: { rev: number; rows: Standing[] };
  /** Everyone's photo address (null for none), for whoever is in the draw (or would be, before it). */
  photos?: { at: number; key: string; map: Map<string, string | null> };
}

const runtimes = new Map<string, Runtime>();
const REFRESH_MS = 1000;

/**
 * The event's runtime. A page's request never waits on the database when
 * there is one already: an old one is answered from, and refreshed behind
 * it (a slow moment on the link must not hold every player's score up).
 * The runner asks for a `fresh` one, and waits.
 */
async function runtime(eventId: string, fresh = false): Promise<Runtime | null> {
  const kept = runtimes.get(eventId);
  if (kept && !fresh) {
    if (Date.now() - kept.refreshedAt >= REFRESH_MS) void refresh(eventId).catch((error) => logger.error('Cup refresh failed', { eventId }, error));
    return kept;
  }
  return refresh(eventId);
}

/** Which draw an event is on: none yet, or the one made at `drawnAt`. */
const drawKey = (event: Pick<CupEvent, 'drawnAt'>) => (event.drawnAt ? new Date(event.drawnAt).getTime() : 0);

const STUCK_MS = 15_000;
const refreshStarted = new Map<string, number>();

async function refresh(eventId: string): Promise<Runtime | null> {
  const kept = runtimes.get(eventId);
  if (kept?.refreshing && Date.now() - (refreshStarted.get(eventId) ?? 0) < STUCK_MS) return kept.refreshing;
  refreshStarted.set(eventId, Date.now());
  const load = (async () => {
    const event = await cupEvents().findOne({ id: eventId }, { projection: { _id: 0 } });
    if (!event) {
      runtimes.delete(eventId);
      return null;
    }
    let rt = runtimes.get(eventId);
    // A new draw (a test's `reset`, then the lobby again): what this process held of the old one is gone.
    if (rt && drawKey(rt.event) !== drawKey(event)) {
      runtimes.delete(eventId);
      rt = undefined;
    }
    // The first time, every match; after that the undecided ones and any written lately (decided or voided elsewhere).
    const query = !rt
      ? { eventId }
      : { eventId, $or: [{ status: { $ne: 'done' as const } }, { updatedAt: { $gte: new Date(rt.refreshedAt - 5000) } }] };
    const rows = await cupMatches().find(query, { projection: { _id: 0 } }).toArray();
    if (!rt) {
      rt = { event, matches: new Map(), live: new Map(), boards: new Map(), persisted: new Map(), rev: Date.now(), refreshedAt: 0, refreshing: null };
      runtimes.set(eventId, rt);
    }
    if (rt.event.version !== event.version || rt.event.active !== event.active) rt.rev += 1;
    if (rt.orgName === undefined) {
      const company = await companies().findOne({ id: event.org }, { projection: { _id: 0, name: 1 } });
      rt.orgName = company?.name ?? '';
    }
    rt.event = event;
    for (const row of rows) {
      const had = rt.matches.get(row.id);
      if (!had || had.updatedAt.getTime() !== row.updatedAt.getTime()) rt.rev += 1;
      rt.matches.set(row.id, row);
    }
    await refreshPhotos(rt).catch((error) => logger.error('Cup photos failed', { eventId }, error));
    rt.refreshedAt = Date.now();
    return rt;
  })();
  if (kept) kept.refreshing = load;
  try {
    return await load;
  } finally {
    const rt = runtimes.get(eventId);
    if (rt) rt.refreshing = null;
  }
}

/** Something changed that pages should see. */
export function touchCup(eventId: string): void {
  const rt = runtimes.get(eventId);
  if (rt) rt.rev += 1;
}

/** Puts a match as written back into the runtime. */
function keep(rt: Runtime, match: CupMatch) {
  rt.matches.set(match.id, match);
  rt.rev += 1;
}

async function reloadMatch(rt: Runtime, id: string): Promise<CupMatch | null> {
  const row = await cupMatches().findOne({ id }, { projection: { _id: 0 } });
  if (row) keep(rt, row);
  return row;
}

export async function loadEvent(id: string): Promise<CupEvent | null> {
  return (await runtime(id))?.event ?? null;
}

const orgEventCache = new Map<string, { id: string | null; at: number }>();

/**
 * The event a page is about: the one asked for, when it is the viewer's
 * company's and switched on; else the company's switched-on event, the
 * latest first. Null when there is none: the Cup is not on.
 */
async function runtimeFor(viewer: CupViewer, askedId?: unknown): Promise<Runtime | null> {
  let id: string | null = null;
  if (typeof askedId === 'string' && askedId) id = askedId;
  else {
    const kept = orgEventCache.get(viewer.org);
    if (kept && Date.now() - kept.at < 5000) id = kept.id;
    else {
      const row = await cupEvents()
        .find({ org: viewer.org, active: true }, { projection: { _id: 0, id: 1 } })
        .sort({ lobbyAt: -1 })
        .limit(1)
        .next();
      id = row?.id ?? null;
      orgEventCache.set(viewer.org, { id, at: Date.now() });
    }
  }
  if (!id || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  const rt = await runtime(id);
  return rt && rt.event.org === viewer.org && rt.event.active ? rt : null;
}

// ---------------------------------------------------------------- photos

/**
 * Photos for the page, as addresses it can load under its policy (same
 * origin): a photo held as media is `/media/<key>`, as the app's feed shows
 * it; an old inline photo (a `data:` URI on the user) is served by
 * `/cup/api/photo/…`, signed so that only an address this API handed out
 * (to someone at the same company, in their state) opens it. No photo: null.
 * Read for the whole draw every few minutes, never per poll.
 */
const PHOTOS_EVERY_MS = 5 * 60_000;

let photoSigningKey: Buffer | null = null;
function photoSignature(eventId: string, userId: string, v: string): string {
  photoSigningKey ??= createHash('sha256').update(`cup-photo:${env.scribbleTicketSecret || env.mongoUri}`).digest();
  return createHmac('sha256', photoSigningKey).update(`${eventId}:${userId}:${v}`).digest('base64url').slice(0, 24);
}

async function refreshPhotos(rt: Runtime): Promise<void> {
  const event = rt.event;
  const ids = event.phase === 'scheduled' ? (await rosterPreview(event)).map((row) => row.userId) : event.entrants.map((e) => e.userId);
  const key = `${drawKey(event)}:${ids.length}`;
  if (rt.photos && rt.photos.key === key && Date.now() - rt.photos.at < PHOTOS_EVERY_MS) return;
  const rows = ids.length
    ? await users()
        .aggregate<{ userId: string; profilePhotoKey?: string; head: string; size: number; https: string }>([
          { $match: { org: event.org, userId: { $in: ids } } },
          {
            $project: {
              _id: 0,
              userId: 1,
              profilePhotoKey: 1,
              head: { $substrCP: [{ $ifNull: ['$profilePhotoUrl', ''] }, 0, 16] },
              size: { $strLenBytes: { $ifNull: ['$profilePhotoUrl', ''] } },
              https: {
                $cond: [{ $eq: [{ $substrCP: [{ $ifNull: ['$profilePhotoUrl', ''] }, 0, 8] }, 'https://'] }, '$profilePhotoUrl', ''],
              },
            },
          },
        ])
        .toArray()
    : [];
  const map = new Map<string, string | null>();
  for (const row of rows) {
    let url: string | null = null;
    if (row.profilePhotoKey) url = `/media/${encodeURIComponent(row.profilePhotoKey)}`;
    else if (row.https && row.https.length <= 2048) url = row.https;
    else if (/^data:image\//.test(row.head)) {
      const v = String(row.size);
      url = `/cup/api/photo/${encodeURIComponent(event.id)}/${encodeURIComponent(row.userId)}?v=${v}&s=${photoSignature(event.id, row.userId, v)}`;
    }
    map.set(row.userId, url);
  }
  const changed = !rt.photos || rt.photos.map.size !== map.size || [...map].some(([id, url]) => rt.photos!.map.get(id) !== url);
  rt.photos = { at: Date.now(), key, map };
  if (changed) rt.rev += 1;
}

const photoOf = (rt: Runtime, userId: string | null | undefined): string | null => (userId ? rt.photos?.map.get(userId) ?? null : null);

/** A person's photo address in this event, for the bets' parts of the state (tipsters, the stage). Null for none. */
export function cupPhotoUrl(eventId: string, userId: string): string | null {
  const rt = runtimes.get(eventId);
  return rt ? photoOf(rt, userId) : null;
}

/**
 * An old inline photo, for `GET /cup/api/photo/:eventId/:userId?v=&s=`: only
 * with the signature this API put in the address, only for someone in that
 * event, at its company. Null when there is nothing to show.
 */
export async function inlinePhoto(eventId: string, userId: string, v: unknown, sig: unknown): Promise<{ type: string; bytes: Buffer } | null> {
  if (typeof v !== 'string' || typeof sig !== 'string' || !/^\d{1,9}$/.test(v)) return null;
  const expected = Buffer.from(photoSignature(eventId, userId, v));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(eventId)) return null;
  const rt = await runtime(eventId);
  if (!rt) return null;
  const event = rt.event;
  const inIt = event.phase === 'scheduled' ? (await rosterPreview(event)).some((row) => row.userId === userId) : event.entrants.some((e) => e.userId === userId);
  if (!inIt) return null;
  const row = await users().findOne({ userId, org: event.org }, { projection: { _id: 0, profilePhotoUrl: 1 } });
  const parsed = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(row?.profilePhotoUrl ?? '');
  if (!parsed) return null;
  return { type: parsed[1], bytes: Buffer.from(parsed[2], 'base64') };
}

// ---------------------------------------------------------------- who is in

export interface RosterRow {
  userId: string;
  name: string;
  best: number | null;
}

/**
 * Everyone the event would enter now: active at the company, not a
 * counsellor, not left out; with only `includeUserIds` when a test names
 * them. With each one's best score on the game's leaderboard.
 */
export async function rosterOf(event: Pick<CupEvent, 'org' | 'gameKey' | 'excludeUserIds' | 'includeUserIds'>): Promise<RosterRow[]> {
  const people = await users()
    .find(
      {
        org: event.org,
        lifecycleStatus: { $nin: INACTIVE },
        isCounsellor: { $ne: true },
        userId: event.includeUserIds.length ? { $in: event.includeUserIds, $nin: event.excludeUserIds } : { $nin: event.excludeUserIds },
      },
      { projection: { _id: 0, userId: 1, name: 1 } },
    )
    .toArray();
  const scores = await gameScores()
    .find({ gameId: catalogScoreId(event.gameKey), org: event.org }, { projection: { _id: 0, userId: 1, score: 1 } })
    .toArray();
  const best = new Map(scores.map((row) => [row.userId, row.score]));
  return people.map((p) => ({ userId: p.userId, name: p.name || 'Colleague', best: best.get(p.userId) ?? null }));
}

/** Each person's place on the company's whole board (ties share a place), from all its scores. */
async function boardRanks(event: CupEvent): Promise<Map<string, number>> {
  const scores = await gameScores()
    .find({ gameId: catalogScoreId(event.gameKey), org: event.org }, { projection: { _id: 0, userId: 1, score: 1 } })
    .toArray();
  scores.sort((a, b) => b.score - a.score);
  const ranks = new Map<string, number>();
  scores.forEach((row, i) => ranks.set(row.userId, i > 0 && scores[i - 1].score === row.score ? ranks.get(scores[i - 1].userId)! : i + 1));
  return ranks;
}

const rosterCache = new Map<string, { rows: RosterRow[]; at: number }>();

/** The roster before the draw, kept half a minute: every page asks for it. */
async function rosterPreview(event: CupEvent): Promise<RosterRow[]> {
  const kept = rosterCache.get(event.id);
  if (kept && Date.now() - kept.at < 30_000) return kept.rows;
  const rows = await rosterOf(event);
  rows.sort((a, b) => (b.best ?? -1) - (a.best ?? -1) || a.name.localeCompare(b.name));
  rosterCache.set(event.id, { rows, at: Date.now() });
  return rows;
}

// ---------------------------------------------------------------- the draw

const matchId = (eventId: string, round: number, slot: number) => `${eventId}-r${round}-m${slot}`;

/** Seeds by userId, for the rules. Someone not in the draw ranks below everyone. */
function seedLookup(event: CupEvent): (userId: string) => number {
  const seeds = new Map(event.entrants.map((e) => [e.userId, e.seed]));
  return (userId) => seeds.get(userId) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Makes the draw: everyone in, seeded, the whole bracket laid out, and round
 * 1's matches written (waiting for the start). Only one caller gets to make
 * it: the event moves from 'scheduled' to 'lobby' once.
 */
async function makeDraw(rt: Runtime, now: Date): Promise<void> {
  const event = rt.event;
  const roster = await rosterOf(event);
  const ranks = await boardRanks(event);
  const ordered = seedOrderOf(roster, event.seeding, cryptoRng);
  const entrants: CupEntrant[] = ordered.map((p, i) => ({
    userId: p.userId,
    name: p.name,
    seed: i + 1,
    best: p.best,
    boardRank: ranks.get(p.userId) ?? null,
  }));
  const rounds = buildDraw(entrants.length, event.topN);
  const single = entrants.length < 2;
  const claimed = await cupEvents().findOneAndUpdate(
    { id: event.id, phase: 'scheduled', active: true },
    {
      $set: {
        phase: single ? 'done' : 'lobby',
        entrants,
        rounds,
        drawnAt: now,
        round: 0,
        updatedAt: now,
        ...(single ? { championId: entrants[0]?.userId, finishedAt: now } : {}),
      },
      $inc: { version: 1 },
    },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!claimed) return;
  rt.event = claimed;
  rt.rev += 1;
  rosterCache.delete(event.id);
  logger.info('Cup draw made', { eventId: event.id, entrants: entrants.length, rounds: rounds.length });
  if (single) return;
  await createRoundMatches(rt, 1, now, 'scheduled');
  if (event.pushAtLobby) void pushLobby(rt).catch((error) => logger.error('Cup lobby push failed', { eventId: event.id }, error));
}

/** The player a place in the draw holds, once known: an entrant, or the winner of an earlier place. */
function holderOf(rt: Runtime, ref: string): string | null {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const event = rt.event;
  if (parsed.kind === 'e') return event.entrants[parsed.seed - 1]?.userId ?? null;
  const round = event.rounds[parsed.round - 1];
  const node = round?.nodes.find((n) => n.slot === parsed.slot);
  if (!node) return null;
  if (node.feeders.length === 1) return holderOf(rt, node.feeders[0]);
  const match = rt.matches.get(matchId(event.id, parsed.round, parsed.slot));
  return match?.status === 'done' ? match.winnerId ?? null : null;
}

/**
 * Writes the matches of round `n` that do not exist yet, as `status`. Safe to
 * call again: a match that exists is left alone (its id is fixed by place).
 */
async function createRoundMatches(rt: Runtime, n: number, now: Date, status: 'scheduled' | 'open'): Promise<void> {
  const event = rt.event;
  const round = event.rounds[n - 1];
  if (!round) return;
  const seedOf = seedLookup(event);
  const docs: CupMatch[] = [];
  let number = 0;
  for (const node of round.nodes) {
    if (node.feeders.length < 2) continue;
    number += 1;
    const id = matchId(event.id, n, node.slot);
    if (rt.matches.has(id)) continue;
    const [p, q] = node.feeders.map((ref) => holderOf(rt, ref));
    if (!p || !q) continue;
    const players: [string, string] = seedOf(p) <= seedOf(q) ? [p, q] : [q, p];
    docs.push({
      id,
      eventId: event.id,
      org: event.org,
      round: n,
      slot: node.slot,
      label: matchLabel(round, number),
      kind: round.kind,
      players,
      status,
      seed: newSeed(),
      attempt: 0,
      joined: {},
      live: {},
      finals: {},
      ...(status === 'open' ? { openedAt: now, deadlineAt: new Date(now.getTime() + event.startWindowSec * 1000) } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
  if (!docs.length) return;
  try {
    // `_id` is the match id: with no index on `id` (none may be made on the shared cluster), the primary key is what
    // stops two runners writing the same match twice.
    await cupMatches().insertMany(docs.map((d) => ({ _id: d.id, ...d }) as unknown as CupMatch), { ordered: false });
    for (const doc of docs) rt.matches.set(doc.id, doc);
  } catch (error) {
    // Another runner wrote some of them first: theirs stand (their boards, their times), so read them all back.
    const code = (error as { code?: number; writeErrors?: unknown }).code;
    if (code !== 11000 && !/E11000/.test(String((error as Error).message))) throw error;
    const rows = await cupMatches().find({ id: { $in: docs.map((d) => d.id) } }, { projection: { _id: 0 } }).toArray();
    for (const row of rows) rt.matches.set(row.id, row);
  }
  rt.rev += 1;
}

// ---------------------------------------------------------------- pushes

const nameOf = (event: CupEvent, userId: string) => event.entrants.find((e) => e.userId === userId)?.name ?? 'your opponent';

/** A push that opens the Cup in the Games tab. Never holds anything up. */
async function pushCup(event: CupEvent, userIds: string[], scenario: string, title: string, body: string) {
  try {
    await notifyUsers(userIds, {
      scenario,
      title,
      body,
      // The app opens the game named here, on no challenge in particular: the Cup page.
      data: { destination: 'game_challenge', gameKey: event.catalogKey, challengeId: '' },
    });
  } catch (error) {
    logger.error('Cup push failed', { eventId: event.id, scenario }, error);
  }
}

const hhmm = (date: Date) => date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });

/** Everyone their first match, as the lobby opens. */
async function pushLobby(rt: Runtime) {
  const event = rt.event;
  const at = hhmm(event.startAt);
  for (const match of [...rt.matches.values()].filter((m) => m.round === 1)) {
    for (const [me, them] of [match.players, [match.players[1], match.players[0]]]) {
      await pushCup(event, [me], 'cup_lobby', `${event.name}: you're in!`, `Round 1 at ${at}: you v ${nameOf(event, them)}. Be there to play.`);
    }
  }
  const round1 = event.rounds[0];
  for (const node of round1?.nodes ?? []) {
    if (node.feeders.length !== 1) continue;
    const who = holderOf(rt, node.feeders[0]);
    if (who) await pushCup(event, [who], 'cup_lobby', `${event.name}: you're in!`, 'You were the top seed, so you skip round 1.');
  }
}

/** The two players, as their match opens. */
async function pushOpen(event: CupEvent, match: CupMatch) {
  const window = event.startWindowSec >= 60 ? `${Math.round(event.startWindowSec / 60)} minutes` : `${event.startWindowSec} seconds`;
  for (const [me, them] of [match.players, [match.players[1], match.players[0]]]) {
    await pushCup(event, [me], 'cup_match_open', `Your ${event.name} match is on!`, `${match.label}: you v ${nameOf(event, them)}. Join in the next ${window}.`);
  }
}

// ---------------------------------------------------------------- the runner

let ticker: NodeJS.Timeout | undefined;
let ticking = false;
let activeIds: { ids: string[]; at: number } = { ids: [], at: 0 };

const runnerMoves = (org: string) => env.cupRunnerOrgs.length === 0 || env.cupRunnerOrgs.includes(org);

/** One pass over every switched-on event this process may move. */
export async function tickCups(): Promise<void> {
  if (Date.now() - activeIds.at > 5000) {
    const rows = await cupEvents().find({ active: true, phase: { $ne: 'done' } }, { projection: { _id: 0, id: 1, org: 1 } }).toArray();
    activeIds = { ids: rows.filter((r) => runnerMoves(r.org)).map((r) => r.id), at: Date.now() };
  }
  // Side by side: one event's slow pass (a 113-match round) must not hold another's clock up.
  await Promise.all(activeIds.ids.map((id) => tickOnce(id, false)));
}

/** Events being stepped now, each with whether it should go again straight after (something was decided meanwhile). */
const eventTicks = new Map<string, { again: boolean }>();

/** Steps one event, never twice at once in this process. */
async function tickOnce(id: string, again: boolean): Promise<void> {
  const running = eventTicks.get(id);
  if (running) {
    if (again) running.again = true;
    return;
  }
  const mine = { again: false };
  eventTicks.set(id, mine);
  try {
    do {
      mine.again = false;
      await tickEvent(id).catch((error) => logger.error('Cup tick failed', { eventId: id }, error));
    } while (mine.again);
  } finally {
    eventTicks.delete(id);
  }
}

/**
 * A match was just decided (or voided) here: step its event now rather than
 * on the next tick, so the next round, or the next top-N match's lobby, opens
 * at once. Only where the runner runs.
 */
function kick(rt: Runtime) {
  if (!ticker || !runnerMoves(rt.event.org) || !rt.event.active) return;
  void tickOnce(rt.event.id, true);
}

export function startCupRunner(intervalMs = 1000) {
  if (ticker || !env.cupRunner) return;
  ticker = setInterval(() => {
    if (ticking) return;
    ticking = true;
    tickCups()
      .catch((error) => logger.error('Cup runner failed', {}, error))
      .finally(() => {
        ticking = false;
      });
  }, intervalMs);
  ticker.unref();
}

export function stopCupRunner() {
  if (ticker) clearInterval(ticker);
  ticker = undefined;
}

/**
 * One event's step. The time is read afresh for every move, never once per
 * pass: a pass over several events (or a round of 113 matches over a slow
 * link) takes seconds, and a stale clock would cut that much off every
 * window it opens (betting lobbies, start windows, a lone player's start).
 */
async function tickEvent(id: string): Promise<void> {
  const rt = await runtime(id, true);
  if (!rt || !rt.event.active || !runnerMoves(rt.event.org)) return;
  let now = new Date();
  const event = rt.event;
  if (event.phase === 'scheduled') {
    if (now >= event.lobbyAt) await makeDraw(rt, now);
    return;
  }
  if (event.phase === 'lobby') {
    if (now >= event.startAt) await openRound(rt, 1, now);
    return;
  }
  if (event.phase !== 'running') return;
  const n = event.round;
  const round = event.rounds[n - 1];
  if (!round) return;
  // A crash between claiming the round and writing its matches: write them now.
  await createRoundMatches(rt, n, now, round.kind === 'sequential' ? 'scheduled' : 'open');
  const inRound = [...rt.matches.values()].filter((m) => m.round === n);
  // Round 1's start window closes on all its matches at once: a few at a time, not one by one.
  await inBatches(inRound, 16, (match) => advance(rt, match, new Date()));
  if (round.kind === 'sequential') {
    await stage(rt, n, new Date());
    if (cupHooks.reconcile && Date.now() - (lastReconcile.get(id) ?? 0) >= RECONCILE_EVERY_MS) {
      lastReconcile.set(id, Date.now());
      await hook('reconcile', async () => {
        await cupHooks.reconcile?.(id);
      });
    }
  }
  const wanted = round.nodes.filter((node) => node.feeders.length === 2).length;
  const decided = [...rt.matches.values()].filter((m) => m.round === n && m.status === 'done').length;
  if (decided >= wanted) {
    now = new Date();
    if (n >= event.rounds.length) await finish(rt, now);
    else await openRound(rt, n + 1, now);
  }
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map((item) => run(item).catch((error) => logger.error('Cup match step failed', {}, error))));
  }
}

/**
 * Opens round `n`: claims it on the event (once), notes its free passes,
 * and writes and opens its matches. A sequential round opens one match at a
 * time from `stage`.
 */
async function openRound(rt: Runtime, n: number, now: Date): Promise<void> {
  const event = rt.event;
  const round = event.rounds[n - 1];
  if (!round) return;
  const byes = round.nodes.filter((node) => node.feeders.length === 1).map((node) => holderOf(rt, node.feeders[0])).filter((u): u is string => !!u);
  // Conditional on the version the decided matches were read with: an HR void writes the match, then bumps the
  // version, so a round is never opened on a result that was voided meanwhile (see voidMatchResult).
  const claimed = await cupEvents().findOneAndUpdate(
    { id: event.id, round: n - 1, phase: n === 1 ? 'lobby' : 'running', active: true, ...(n > 1 ? { version: event.version } : {}) },
    {
      $set: {
        round: n,
        phase: 'running',
        [`rounds.${n - 1}.openedAt`]: now,
        [`rounds.${n - 1}.byes`]: byes,
        ...(n > 1 ? { [`rounds.${n - 2}.closedAt`]: now } : {}),
        updatedAt: now,
      },
      $inc: { version: 1 },
    },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!claimed) return;
  rt.event = claimed;
  rt.rev += 1;
  logger.info('Cup round opened', { eventId: event.id, round: n, kind: round.kind });
  now = new Date();
  if (round.kind === 'sequential') {
    await createRoundMatches(rt, n, now, 'scheduled');
    await stage(rt, n, now);
    return;
  }
  if (n === 1) {
    // Round 1 was written at the draw, waiting: open it all at once.
    const deadlineAt = new Date(now.getTime() + event.startWindowSec * 1000);
    await cupMatches().updateMany(
      { eventId: event.id, round: 1, status: 'scheduled' },
      { $set: { status: 'open', openedAt: now, deadlineAt, updatedAt: now } },
    );
    for (const m of [...rt.matches.values()].filter((x) => x.round === 1 && x.status === 'scheduled')) {
      rt.matches.set(m.id, { ...m, status: 'open', openedAt: now, deadlineAt, updatedAt: now });
    }
    rt.rev += 1;
  } else {
    await createRoundMatches(rt, n, now, 'open');
  }
  const opened = [...rt.matches.values()].filter((m) => m.round === n && m.status === 'open');
  void (async () => {
    for (const m of opened) await pushOpen(rt.event, m);
  })();
}

/**
 * A sequential round's stage: one match at a time. When nothing is on, the
 * next one by place gets its betting lobby; when its lobby closes, it opens.
 */
async function stage(rt: Runtime, n: number, now: Date): Promise<void> {
  const event = rt.event;
  const inRound = [...rt.matches.values()].filter((m) => m.round === n).sort((a, b) => a.slot - b.slot);
  const on = inRound.find((m) => m.status === 'betting' || m.status === 'open' || m.status === 'live' || m.status === 'solo');
  if (on) {
    if (on.status === 'betting' && on.bettingEndsAt && now >= on.bettingEndsAt) {
      const deadlineAt = new Date(now.getTime() + event.startWindowSec * 1000);
      const moved = await cupMatches().findOneAndUpdate(
        { id: on.id, status: 'betting' },
        { $set: { status: 'open', openedAt: now, deadlineAt, updatedAt: now } },
        { returnDocument: 'after', projection: { _id: 0 } },
      );
      if (moved) {
        keep(rt, moved);
        void pushOpen(event, moved);
      }
    }
    return;
  }
  const next = inRound.find((m) => m.status === 'scheduled');
  if (!next) return;
  now = new Date();
  const bettingEndsAt = new Date(now.getTime() + event.bettingSec * 1000);
  const moved = await cupMatches().findOneAndUpdate(
    { id: next.id, status: 'scheduled' },
    { $set: { status: 'betting', bettingAt: now, bettingEndsAt, updatedAt: now } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!moved) return;
  keep(rt, moved);
  const secs = event.bettingSec >= 60 ? `${Math.round(event.bettingSec / 60)} minute${event.bettingSec >= 120 ? 's' : ''}` : `${event.bettingSec} seconds`;
  for (const [me, them] of [moved.players, [moved.players[1], moved.players[0]]]) {
    void pushCup(event, [me], 'cup_up_next', `You're up next in the ${event.name}`, `${moved.label}: you v ${nameOf(event, them)} starts in ${secs}. Everyone's watching.`);
  }
}

/** The match with this process's live scores in it, for deciding a round that ran out. */
function withLive(rt: Runtime, match: CupMatch): CupMatch {
  const live = { ...(match.live ?? {}) };
  for (const p of match.players) {
    const mem = rt.live.get(`${match.id}:${match.attempt}:${p}`);
    if (mem && (!live[p] || mem.score >= live[p].score)) live[p] = { score: mem.score, at: new Date(mem.at) };
  }
  return { ...match, live };
}

/** Moves one match on, if its time has come. */
async function advance(rt: Runtime, match: CupMatch, now: Date): Promise<void> {
  if (match.status !== 'open' && match.status !== 'live' && match.status !== 'solo') return;
  const step = nextStep(withLive(rt, match), rt.event, now, seedLookup(rt.event));
  await apply(rt, match, step, now);
}

async function apply(rt: Runtime, match: CupMatch, step: MatchStep, now: Date): Promise<void> {
  const event = rt.event;
  // As read: a final, a join or a void written since (here or by another instance) makes this a no-op until the next look.
  const where = { id: match.id, status: match.status, attempt: match.attempt, updatedAt: match.updatedAt };
  const write = async (update: Record<string, unknown>) => {
    const after = await cupMatches().findOneAndUpdate(where, update, { returnDocument: 'after', projection: { _id: 0 } });
    if (after) keep(rt, after);
    return after;
  };
  switch (step.kind) {
    case 'none':
      return;
    case 'start':
      await write({ $set: { status: 'live', startAt: step.startAt, updatedAt: now } });
      return;
    case 'solo':
      await write({ $set: { status: 'solo', soloUntil: step.soloUntil, updatedAt: now } });
      return;
    case 'replay': {
      const after = await write({
        $set: {
          status: 'open',
          seed: newSeed(),
          joined: {},
          live: {},
          finals: {},
          openedAt: now,
          deadlineAt: new Date(now.getTime() + event.startWindowSec * 1000),
          updatedAt: now,
        },
        $unset: { startAt: '', soloUntil: '' },
        $inc: { attempt: 1 },
        $push: { history: { attempt: match.attempt, scores: step.scores } },
      });
      if (after) {
        logger.info('Cup match tied: replay', { matchId: match.id, attempt: after.attempt });
        await hook('onMatchReplayed', () => cupHooks.onMatchReplayed?.(after, event));
        for (const [me, them] of [after.players, [after.players[1], after.players[0]]]) {
          void pushCup(event, [me], 'cup_replay', `It's a tie! Replay now`, `${after.label}: you and ${nameOf(event, them)} tied. Join the replay.`);
        }
      }
      return;
    }
    case 'decide':
      await decide(rt, match, step.winnerId, step.decidedBy, step.result, now, write);
      return;
  }
}

async function decide(
  rt: Runtime,
  match: CupMatch,
  winnerId: string,
  decidedBy: CupDecision,
  result: Record<string, number>,
  now: Date,
  write: (update: Record<string, unknown>) => Promise<CupMatch | null>,
) {
  const after = await write({ $set: { status: 'done', winnerId, decidedBy, result, decidedAt: now, updatedAt: now } });
  if (!after) return;
  logger.info('Cup match decided', { matchId: match.id, winnerId, decidedBy });
  await hook('onMatchDecided', () => cupHooks.onMatchDecided?.(after, rt.event));
}

/** The last match is decided: the champion, and the event is over. */
async function finish(rt: Runtime, now: Date): Promise<void> {
  const event = rt.event;
  const last = event.rounds[event.rounds.length - 1];
  const champion = last ? holderOf(rt, nodeRefOfLast(last)) : null;
  const claimed = await cupEvents().findOneAndUpdate(
    { id: event.id, phase: 'running', round: event.rounds.length, active: true, version: event.version },
    {
      $set: { phase: 'done', championId: champion ?? undefined, finishedAt: now, [`rounds.${event.rounds.length - 1}.closedAt`]: now, updatedAt: now },
      $inc: { version: 1 },
    },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!claimed) return;
  rt.event = claimed;
  rt.rev += 1;
  await hook('reconcile', async () => {
    await cupHooks.reconcile?.(event.id);
  });
  logger.info('Cup finished', { eventId: event.id, championId: champion });
  if (champion) void pushCup(claimed, claimed.entrants.map((e) => e.userId), 'cup_champion', `${nameOf(claimed, champion)} wins the ${claimed.name}!`, 'See the final standings and the top tipsters.');
}

const nodeRefOfLast = (round: CupRound) => `n:${round.n}:${round.nodes[0]?.slot ?? 1}`;

// ---------------------------------------------------------------- playing a match

/** The match, provided it is this viewer's and in their company's switched-on event. */
async function playersMatch(viewer: CupViewer, id: string): Promise<{ rt: Runtime; match: CupMatch }> {
  const eventId = /^(.+)-r\d+-m\d+$/.exec(id)?.[1];
  const rt = eventId ? await runtime(eventId) : null;
  if (!rt || rt.event.org !== viewer.org || !rt.event.active) throw new CupError(404, 'Match not found');
  const match = rt.matches.get(id);
  if (!match) throw new CupError(404, 'Match not found');
  if (!match.players.includes(viewer.userId)) throw new CupError(403, 'This is not your match');
  return { rt, match };
}

function refuse(verdict: { ok: true } | { ok: false; status: number; message: string }) {
  if (!verdict.ok) throw new CupError(verdict.status, verdict.message);
}

/** "I'm here": joins the match; the second to join starts it for both, after the countdown. */
export async function joinMatch(viewer: CupViewer, id: string) {
  const { rt, match } = await playersMatch(viewer, id);
  const now = new Date();
  refuse(mayJoin(match, viewer.userId, now));
  let current = match;
  if (!match.joined?.[viewer.userId]) {
    const after = await cupMatches().findOneAndUpdate(
      { id, status: 'open', attempt: match.attempt, deadlineAt: { $gt: now }, [`joined.${viewer.userId}`]: { $exists: false } },
      { $set: { [`joined.${viewer.userId}`]: now, updatedAt: now } },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    current = after ?? (await reloadMatch(rt, id)) ?? match;
    if (after) keep(rt, after);
  }
  if (current.status === 'open' && current.players.every((p) => current.joined?.[p])) {
    const startAt = new Date(now.getTime() + rt.event.countdownSec * 1000);
    const started = await cupMatches().findOneAndUpdate(
      { id, status: 'open', attempt: current.attempt, startAt: { $exists: false } },
      { $set: { status: 'live', startAt, updatedAt: now } },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    current = started ?? (await reloadMatch(rt, id)) ?? current;
    if (started) keep(rt, started);
  }
  return { serverNow: new Date(), match: myMatchView(rt, current, viewer.userId) };
}

/** A lone player, after the window: starts their round now. */
export async function startSolo(viewer: CupViewer, id: string) {
  const { rt, match } = await playersMatch(viewer, id);
  const now = new Date();
  refuse(mayStartSolo(match, viewer.userId, now));
  let current = match;
  if (!match.startAt) {
    const startAt = new Date(now.getTime() + rt.event.countdownSec * 1000);
    const after = await cupMatches().findOneAndUpdate(
      { id, status: 'solo', attempt: match.attempt, startAt: { $exists: false }, soloUntil: { $gt: now } },
      { $set: { startAt, updatedAt: now } },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    current = after ?? (await reloadMatch(rt, id)) ?? match;
    if (after) keep(rt, after);
  }
  return { serverNow: new Date(), match: myMatchView(rt, current, viewer.userId) };
}

const PERSIST_EVERY_MS = 3000;

/**
 * A score mid-round: kept here for both pages, written to the match every few seconds.
 * `progress` (the request body's `board`, `tap`, `ok`; optional) is where the player is in the boards, kept in memory only.
 */
export async function reportLive(viewer: CupViewer, id: string, raw: unknown, progress?: unknown): Promise<void> {
  const { rt, match } = await playersMatch(viewer, id);
  const now = new Date();
  refuse(mayScore(match, viewer.userId, rt.event, now, false));
  const score = parseScore(raw, rt.event.maxScore);
  if (score === null) throw new CupError(400, 'Score is invalid');
  const key = `${match.id}:${match.attempt}:${viewer.userId}`;
  const board = parseLiveBoard(progress);
  if (board) {
    const was = rt.boards.get(key);
    if (!was || was.board !== board.board || was.tap !== board.tap || was.ok !== board.ok) {
      rt.boards.set(key, { ...board, at: now.getTime() });
      rt.rev += 1;
    }
  }
  const had = rt.live.get(key);
  if (had && score <= had.score) return;
  rt.live.set(key, { score, at: now.getTime() });
  rt.rev += 1;
  if (now.getTime() - (rt.persisted.get(key) ?? 0) < PERSIST_EVERY_MS) return;
  rt.persisted.set(key, now.getTime());
  await cupMatches().updateOne(
    { id, attempt: match.attempt, status: { $in: ['live', 'solo'] }, [`finals.${viewer.userId}`]: { $exists: false } },
    { $max: { [`live.${viewer.userId}.score`]: score }, $set: { [`live.${viewer.userId}.at`]: now } },
  );
}

/** The round's final score. With both in, the match is decided at once. */
export async function reportFinal(viewer: CupViewer, id: string, raw: unknown) {
  const { rt } = await playersMatch(viewer, id);
  const match = (await reloadMatch(rt, id))!;
  const now = new Date();
  if (match.finals?.[viewer.userId]) return { serverNow: now, match: myMatchView(rt, match, viewer.userId) };
  refuse(mayScore(match, viewer.userId, rt.event, now, true));
  const score = parseScore(raw, rt.event.maxScore);
  if (score === null) throw new CupError(400, 'Score is invalid');
  const after = await cupMatches().findOneAndUpdate(
    { id, attempt: match.attempt, status: match.status, [`finals.${viewer.userId}`]: { $exists: false } },
    // The live score keeps its best: a page reopened mid-round restarted from 0.
    { $set: { [`finals.${viewer.userId}`]: { score, at: now }, [`live.${viewer.userId}.at`]: now, updatedAt: now }, $max: { [`live.${viewer.userId}.score`]: score } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  let current = after ?? (await reloadMatch(rt, id)) ?? match;
  if (after) {
    keep(rt, after);
    const key = `${id}:${after.attempt}:${viewer.userId}`;
    rt.live.set(key, { score: Math.max(score, rt.live.get(key)?.score ?? 0), at: now.getTime() });
    if (runnerMoves(rt.event.org)) {
      await apply(rt, after, nextStep(withLive(rt, after), rt.event, now, seedLookup(rt.event)), now);
      current = rt.matches.get(id) ?? current;
      if (current.status === 'done') kick(rt);
    }
  }
  return { serverNow: new Date(), match: myMatchView(rt, current, viewer.userId) };
}

// ---------------------------------------------------------------- void (for HR, through cup-bets)

/**
 * Voids a match's result, or a match in play: it is played again from the
 * start (a top-N match gets a new betting lobby, in its turn). Refused once
 * its winner has been drawn into a later round. Bets are refunded by the
 * `onMatchVoided` hook.
 */
export async function voidMatchResult(viewer: CupViewer, id: string) {
  if (!viewer.hr) throw new CupError(403, 'Only HR can void a result');
  const eventId = /^(.+)-r\d+-m\d+$/.exec(id)?.[1];
  const rt = eventId ? await runtime(eventId, true) : null;
  if (!rt || rt.event.org !== viewer.org) throw new CupError(404, 'Match not found');
  const match = rt.matches.get(id);
  if (!match) throw new CupError(404, 'Match not found');
  if (match.status === 'scheduled' || match.status === 'betting') throw new CupError(409, 'This match has not been played yet');
  const event = rt.event;
  const tooLate = () => new CupError(409, `Too late: ${match.winnerId ? nameOf(event, match.winnerId) : 'the winner'} is already in the next round`);
  // Once the next round is open, every winner of this one is in it (a match or a free pass).
  if (match.round < event.round) throw tooLate();
  if (match.status === 'done' && match.winnerId) {
    const later = [...rt.matches.values()].some((m) => m.round > match.round && m.players.includes(match.winnerId!));
    const passed = event.rounds.slice(match.round).some((r) => r.byes?.includes(match.winnerId!));
    if (later || passed) throw tooLate();
  }
  const now = new Date();
  const sequential = match.kind === 'sequential';
  const after = await cupMatches().findOneAndUpdate(
    { id, status: match.status, attempt: match.attempt },
    {
      $set: {
        status: sequential ? 'scheduled' : 'open',
        seed: newSeed(),
        joined: {},
        live: {},
        finals: {},
        updatedAt: now,
        ...(sequential ? {} : { openedAt: now, deadlineAt: new Date(now.getTime() + event.startWindowSec * 1000) }),
      },
      $unset: {
        startAt: '',
        soloUntil: '',
        winnerId: '',
        decidedBy: '',
        decidedAt: '',
        result: '',
        bettingAt: '',
        bettingEndsAt: '',
        // A fresh play: earlier ties no longer count towards the replay limit.
        history: '',
        ...(sequential ? { openedAt: '', deadlineAt: '' } : {}),
      },
      $inc: { attempt: 1 },
      $push: { voids: { by: viewer.userId, at: now } },
    },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!after) throw new CupError(409, 'The match changed: try again');
  // Then the event, on the version read above: if a runner opened the next round (or finished the Cup) on the
  // result in the meantime, this fails and the void is undone. A runner that reads after this sees the match again.
  const final = event.phase === 'done' && match.round === event.rounds.length;
  const moved = await cupEvents().findOneAndUpdate(
    { id: event.id, version: event.version, round: event.round, phase: event.phase },
    final
      ? { $set: { phase: 'running', updatedAt: now }, $unset: { championId: '', finishedAt: '', [`rounds.${match.round - 1}.closedAt`]: '' }, $inc: { version: 1 } }
      : { $set: { updatedAt: now }, $inc: { version: 1 } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!moved) {
    const back = await cupMatches().findOneAndReplace(
      { id, attempt: after.attempt, status: after.status, updatedAt: after.updatedAt },
      { ...match },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    if (back) keep(rt, back);
    else logger.error('Cup void could not be undone', { matchId: id });
    throw new CupError(409, 'The tournament moved on meanwhile: look again and try again');
  }
  keep(rt, after);
  rt.event = moved;
  activeIds.at = 0;
  logger.info('Cup match voided', { matchId: id, by: viewer.userId });
  kick(rt);
  await hook('onMatchVoided', () => cupHooks.onMatchVoided?.(after, rt.event, viewer.userId));
  if (!sequential) void pushOpen(rt.event, after);
  return { match: matchView(rt, after) };
}

// ---------------------------------------------------------------- what a page shows

type CurrentStage = { matchId: string; kind: 'betting' | 'live' };

const person = (rt: Runtime, userId: string | null) => {
  if (!userId) return null;
  const e = rt.event.entrants.find((x) => x.userId === userId);
  return { userId, name: e?.name ?? 'Colleague', seed: e?.seed ?? null, photoUrl: photoOf(rt, userId) };
};

function liveOf(rt: Runtime, match: CupMatch): Record<string, number> | undefined {
  if (match.status !== 'live' && match.status !== 'solo') return undefined;
  const out: Record<string, number> = {};
  for (const p of match.players) {
    const mem = rt.live.get(`${match.id}:${match.attempt}:${p}`)?.score;
    const db = match.finals?.[p]?.score ?? match.live?.[p]?.score;
    const best = Math.max(mem ?? -1, db ?? -1);
    if (best >= 0) out[p] = best;
  }
  return out;
}

/**
 * Each player's board, for a match in play: `{}` until their page reports one (an old page never does, and viewers show scores only).
 * Memory only: after a restart it fills again with the next tap.
 */
function liveBoardOf(rt: Runtime, match: CupMatch): Record<string, LiveBoard & { at: string }> | undefined {
  if (match.status !== 'live' && match.status !== 'solo') return undefined;
  const out: Record<string, LiveBoard & { at: string }> = {};
  for (const p of match.players) {
    const b = p ? rt.boards.get(`${match.id}:${match.attempt}:${p}`) : undefined;
    if (b) out[p] = { board: b.board, ...(b.tap !== undefined ? { tap: b.tap, ok: b.ok } : {}), at: new Date(b.at).toISOString() };
  }
  return out;
}

/** One match as the bracket and the watch list show it. */
function matchView(rt: Runtime, match: CupMatch) {
  const event = rt.event;
  const liveBoard = liveBoardOf(rt, match);
  return {
    id: match.id,
    slot: match.slot,
    label: match.label,
    status: match.status,
    a: person(rt, match.players[0]),
    b: person(rt, match.players[1]),
    live: liveOf(rt, match),
    boardSeed: liveBoard ? match.seed : undefined,
    liveBoard,
    result: match.result,
    winnerId: match.winnerId,
    decidedBy: match.decidedBy,
    bettingEndsAt: match.bettingEndsAt,
    deadlineAt: match.deadlineAt,
    startAt: match.startAt,
    soloUntil: match.soloUntil,
    joined: match.players.filter((p) => match.joined?.[p]),
    attempt: match.attempt,
    history: match.history,
  };
}

/** The whole draw: every round, its matches (played, in play, or still waiting for its players) and free passes. */
function roundsView(rt: Runtime) {
  const event = rt.event;
  return event.rounds.map((round) => {
    let number = 0;
    const matches = round.nodes
      .filter((node) => node.feeders.length === 2)
      .map((node) => {
        number += 1;
        const real = rt.matches.get(matchId(event.id, round.n, node.slot));
        if (real) return matchView(rt, real);
        const [p, q] = node.feeders.map((ref) => holderOf(rt, ref));
        return {
          slot: node.slot,
          label: matchLabel(round, number),
          status: 'pending' as const,
          a: person(rt, p),
          b: person(rt, q),
          feedsFrom: { a: p ? undefined : feederName(rt, node.feeders[0]), b: q ? undefined : feederName(rt, node.feeders[1]) },
          attempt: 0,
        };
      });
    const byes =
      round.byes ??
      round.nodes.filter((node) => node.feeders.length === 1).map((node) => holderOf(rt, node.feeders[0])).filter((u): u is string => !!u);
    return { n: round.n, label: round.label, short: round.short, kind: round.kind, openedAt: round.openedAt, closedAt: round.closedAt, byes, freePasses: round.nodes.filter((node) => node.feeders.length === 1).length, matches };
  });
}

/** "Winner of QF2": where a place's player will come from, past any free pass. */
function feederName(rt: Runtime, ref: string): string | undefined {
  const parsed = parseRef(ref);
  if (!parsed || parsed.kind !== 'n') return undefined;
  const round = rt.event.rounds[parsed.round - 1];
  const node = round?.nodes.find((x) => x.slot === parsed.slot);
  if (!round || !node) return undefined;
  if (node.feeders.length === 1) return feederName(rt, node.feeders[0]);
  const number = round.nodes.filter((x) => x.feeders.length === 2 && x.slot <= node.slot).length;
  return `Winner of ${matchLabel(round, number)}`;
}

/** The top-N match on stage, if any. */
function currentStage(rt: Runtime): CurrentStage | null {
  const n = rt.event.round;
  const round = rt.event.rounds[n - 1];
  if (!round || round.kind !== 'sequential' || rt.event.phase !== 'running') return null;
  const on = [...rt.matches.values()].find((m) => m.round === n && ['betting', 'open', 'live', 'solo'].includes(m.status));
  if (!on) return null;
  return { matchId: on.id, kind: on.status === 'betting' ? 'betting' : 'live' };
}

/** The part of the state everyone shares, serialised once per revision. */
function shared(rt: Runtime, rosterCount: number) {
  if (rt.shared && rt.shared.rev === rt.rev && rt.shared.count === rosterCount) return rt.shared;
  const event = rt.event;
  const view = {
    id: event.id,
    name: event.name,
    phase: event.phase,
    round: event.round,
    lobbyAt: event.lobbyAt,
    startAt: event.startAt,
    topN: event.topN,
    orgName: rt.orgName || undefined,
    // Before the draw, everyone who would be in now.
    entrantCount: event.phase === 'scheduled' ? rosterCount : event.entrants.length,
    seeding: event.seeding,
    startWindowSec: event.startWindowSec,
    soloStartSec: event.soloStartSec,
    bettingSec: event.bettingSec,
    countdownSec: event.countdownSec,
    roundSec: event.roundSec,
    finishGraceSec: event.finishGraceSec,
    minPlaySec: event.minPlaySec,
    maxScore: event.maxScore,
    championId: event.championId,
    rounds: roundsView(rt),
  };
  rt.shared = { rev: rt.rev, count: rosterCount, json: JSON.stringify(view), current: currentStage(rt) };
  return rt.shared;
}

/** How far each person got, best first: the champion, the runner-up, then by the round they went out in. */
export interface Standing {
  userId: string;
  name: string;
  photoUrl: string | null;
  seed: number;
  reached: string;
  place: number;
  alive: boolean;
}

function reachedName(round: CupRound | undefined): string {
  if (!round) return 'Round 1';
  if (round.short === 'F') return 'Final';
  if (round.short === 'SF') return 'Semi-final';
  if (round.short === 'QF') return 'Quarter-final';
  const players = round.nodes.reduce((sum, node) => sum + node.feeders.length, 0);
  return (players & (players - 1)) === 0 && players >= 16 ? `Round of ${players}` : round.label;
}

/** Where each entrant went out: the round, by userId. Absent for anyone still in. */
function eliminations(rt: Runtime): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of rt.matches.values()) {
    if (m.status !== 'done' || !m.winnerId) continue;
    const loser = m.players[0] === m.winnerId ? m.players[1] : m.players[0];
    out.set(loser, m.round);
  }
  return out;
}

export function standingsOf(rt: Runtime): Standing[] {
  if (rt.standings && rt.standings.rev === rt.rev) return rt.standings.rows;
  const event = rt.event;
  const out = eliminations(rt);
  const total = event.rounds.length;
  const rows = event.entrants.map((e) => {
    const round = out.get(e.userId);
    const champion = event.championId === e.userId;
    const reached = champion ? 'Champion' : round ? reachedName(event.rounds[round - 1]) : `In ${event.rounds[Math.max(0, event.round - 1)]?.label ?? 'Round 1'}`;
    return { userId: e.userId, name: e.name, seed: e.seed, reached, alive: !round, depth: champion ? total + 2 : round ?? total + 1, place: 0 };
  });
  rows.sort((a, b) => b.depth - a.depth || a.seed - b.seed);
  rows.forEach((row, i) => {
    row.place = i > 0 && rows[i - 1].depth === row.depth ? rows[i - 1].place : i + 1;
  });
  const result: Standing[] = rows.map((row) => ({ userId: row.userId, name: row.name, photoUrl: photoOf(rt, row.userId), seed: row.seed, reached: row.reached, place: row.place, alive: row.alive }));
  rt.standings = { rev: rt.rev, rows: result };
  return result;
}

/** The viewer's own match, as their card and their round need it. */
function myMatchView(rt: Runtime, match: CupMatch, userId: string) {
  const event = rt.event;
  const them = match.players[0] === userId ? match.players[1] : match.players[0];
  const entrant = event.entrants.find((e) => e.userId === them);
  const live = liveOf(rt, match) ?? {};
  const playing = match.status === 'live' || match.status === 'solo';
  return {
    id: match.id,
    label: match.label,
    round: match.round,
    kind: match.kind,
    status: match.status,
    opponent: entrant ? { userId: them, name: entrant.name, seed: entrant.seed, best: entrant.best, photoUrl: photoOf(rt, them) } : null,
    bettingEndsAt: match.bettingEndsAt,
    deadlineAt: match.deadlineAt,
    startAt: match.startAt,
    soloUntil: match.soloUntil,
    boardSeed: playing && match.startAt ? match.seed : undefined,
    attempt: match.attempt,
    joined: !!match.joined?.[userId],
    opponentJoined: !!match.joined?.[them],
    myLive: live[userId],
    opponentLive: live[them],
    liveBoard: playing ? liveBoardOf(rt, match) : undefined,
    myFinal: match.finals?.[userId]?.score,
    result: match.result,
    winnerId: match.winnerId,
    decidedBy: match.decidedBy,
    history: match.history,
    lastTie: match.history?.length ? match.history[match.history.length - 1].scores : undefined,
    roundSec: event.roundSec,
    countdownSec: event.countdownSec,
  };
}

/** The viewer's free pass through round `round` or later, once it is known to be theirs. */
function freePassOf(rt: Runtime, userId: string) {
  const event = rt.event;
  const from = Math.max(1, event.round);
  for (const round of event.rounds.slice(from - 1)) {
    for (const node of round.nodes) {
      if (node.feeders.length !== 1) continue;
      if (holderOf(rt, node.feeders[0]) !== userId) continue;
      const e = event.entrants.find((x) => x.userId === userId)!;
      return { round: round.n, roundLabel: round.label, boardRank: e.boardRank, seed: e.seed, seeding: event.seeding };
    }
  }
  return null;
}

const balanceCache = new Map<string, { value: number; at: number }>();

async function balanceOf(viewer: CupViewer): Promise<number> {
  if (cupHooks.balance) return cupHooks.balance(viewer);
  const kept = balanceCache.get(viewer.userId);
  if (kept && Date.now() - kept.at < 3000) return kept.value;
  const row = await users().findOne({ userId: viewer.userId }, { projection: { _id: 0, points: 1 } });
  const value = Math.max(0, Math.floor(row?.points ?? 0));
  if (balanceCache.size > 5000) balanceCache.clear();
  balanceCache.set(viewer.userId, { value, at: Date.now() });
  return value;
}

/** The viewer's part of the state. */
async function meOf(rt: Runtime, viewer: CupViewer) {
  const event = rt.event;
  // Read from the runtime first, with no wait in between, so the viewer's part matches the event part; the balance last.
  const base = { userId: viewer.userId, name: viewer.name, photoUrl: photoOf(rt, viewer.userId), hr: viewer.hr };
  if (event.phase === 'scheduled') {
    const roster = await rosterPreview(event);
    const mine = roster.find((row) => row.userId === viewer.userId);
    return { ...base, entered: !!mine, alive: !!mine, best: mine?.best ?? null, balance: await balanceOf(viewer) };
  }
  const entrant = event.entrants.find((e) => e.userId === viewer.userId);
  if (!entrant) return { ...base, entered: false, alive: false, balance: await balanceOf(viewer) };
  const outIn = eliminations(rt).get(viewer.userId);
  const mine = [...rt.matches.values()]
    .filter((m) => m.players.includes(viewer.userId))
    .sort((a, b) => b.round - a.round)[0];
  // Their latest match: this round's (round 1's in the lobby), else the last one they played.
  const showing = mine;
  const me = {
    ...base,
    entered: true,
    seed: entrant.seed,
    boardRank: entrant.boardRank,
    best: entrant.best,
    alive: !outIn,
    eliminatedIn: outIn ? { round: outIn, label: event.rounds[outIn - 1]?.label } : undefined,
    champion: event.championId === viewer.userId || undefined,
    freePass: outIn ? undefined : freePassOf(rt, viewer.userId) ?? undefined,
    match: showing ? myMatchView(rt, showing, viewer.userId) : undefined,
  };
  return { ...me, balance: await balanceOf(viewer) };
}

/**
 * Everything one person's page draws, in one round trip. With `since` equal
 * to the current version, just that nothing changed.
 */
export async function stateFor(viewer: CupViewer, askedId: unknown, since: unknown): Promise<string> {
  const now = new Date();
  const rt = await runtimeFor(viewer, askedId);
  if (!rt) {
    return JSON.stringify({ success: true, serverNow: now, version: 0, event: null, me: { userId: viewer.userId, name: viewer.name, photoUrl: null, hr: viewer.hr, entered: false, alive: false, balance: await balanceOf(viewer) } });
  }
  if (since !== undefined && String(since) === String(rt.rev)) {
    return JSON.stringify({ success: true, unchanged: true, version: rt.rev, serverNow: now });
  }
  const rosterCount = rt.event.phase === 'scheduled' ? (await rosterPreview(rt.event)).length : 0;
  // The version and the event part read together, with no wait between: the page never holds a version newer than what it drew.
  const version = rt.rev;
  const common = shared(rt, rosterCount);
  const me = await meOf(rt, viewer);
  const extra: Record<string, unknown> = { current: common.current ?? undefined };
  if (rt.event.phase === 'done') extra.standings = standingsOf(rt);
  if (cupHooks.state) {
    try {
      Object.assign(extra, await cupHooks.state(viewer, rt.event, common.current));
    } catch (error) {
      logger.error('Cup bets state failed', { eventId: rt.event.id }, error);
    }
  }
  const head = JSON.stringify({ success: true, serverNow: now, version });
  const tail = JSON.stringify({ me, ...extra });
  // The event part is the same for everyone, so it is serialised once per revision.
  return `${head.slice(0, -1)},"event":${common.json},${tail.slice(1)}`;
}

/** Who is in, for the list on the page: before the draw by best score, after it by seed. */
export async function entrantsFor(viewer: CupViewer, askedId?: unknown) {
  const rt = await runtimeFor(viewer, askedId);
  if (!rt) throw new CupError(404, 'The tournament is not on');
  if (rt.event.phase === 'scheduled') {
    const roster = await rosterPreview(rt.event);
    return { entrants: roster.map((row) => ({ userId: row.userId, name: row.name, photoUrl: photoOf(rt, row.userId), best: row.best, seed: null })) };
  }
  return { entrants: rt.event.entrants.map((e) => ({ userId: e.userId, name: e.name, photoUrl: photoOf(rt, e.userId), best: e.best, seed: e.seed, boardRank: e.boardRank })) };
}

/**
 * The Cup's standings for the feed post's leaderboard button
 * (`/connect/games/<eventId>`): how far each person got, as rank, name and
 * "score" (the round reached). Null when `gameId` is not a Cup at this company.
 */
export async function cupBoardFor(org: string, gameId: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(gameId)) return null;
  const rt = await runtime(gameId);
  if (!rt || rt.event.org !== org) return null;
  const event = rt.event;
  const rows = event.phase === 'scheduled' || event.phase === 'lobby'
    ? event.entrants.slice(0, 20).map((e) => ({ rank: e.seed, userId: e.userId, playerName: e.name, score: `Seed ${e.seed}` }))
    : standingsOf(rt).slice(0, 20).map((s) => ({ rank: s.place, userId: s.userId, playerName: s.name, score: s.reached }));
  return {
    game: { id: event.id, name: event.name, description: 'Odd One Out knockout', hostedUrl: '', active: event.active },
    leaderboard: rows,
  };
}

// ---------------------------------------------------------------- links

/** An https address, or a local one for a test on this machine. */
const LINK_BASE = /^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

/** The address the app opens for a Cup feed post, signed for this viewer. Null when the post has no event. */
export function cupLinkFor(body: Record<string, unknown>, viewer: { userId: string; org: string }, now = Date.now()): string | null {
  const eventId = typeof body.cupEventId === 'string' ? body.cupEventId : '';
  const base = typeof body.cupLinkBase === 'string' ? body.cupLinkBase.replace(/\/+$/, '') : '';
  const until = body.cupLinkUntil ? new Date(body.cupLinkUntil as string).getTime() : Number.NaN;
  if (!eventId || !LINK_BASE.test(base) || !Number.isFinite(until) || until <= now || !viewer.org) return null;
  const ticket = mintTicket({ userId: viewer.userId, org: viewer.org, name: '' }, { kind: 'cup-link', ttlMs: until - now, now });
  return `${base}/cup/${encodeURIComponent(eventId)}?ticket=${encodeURIComponent(ticket)}`;
}
