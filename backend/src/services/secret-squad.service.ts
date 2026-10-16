/**
 * Secret Squad sessions: opening them on schedule, joining, scans, the clock,
 * pushing each phone what it should see, and paying points
 * (docs/secret-squad.md). The rules are in secret-squad-engine.ts; this file
 * is everything that touches a clock, the store, Mongo or a socket.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { connectPosts, getDb, users } from '../config/db';
import type {
  SquadOfficeAssignment,
  SquadPayout,
  SquadPlayer,
  SquadRoundConfig,
  SquadSchedule,
  SquadSession,
} from '../models/secret-squad.model';
import type { User } from '../models/user.model';
import {
  SQUAD,
  SquadRuleError,
  SquadViewContext,
  advance,
  codeWindowOf,
  dealRound,
  joinSession,
  leaveSession,
  markOffline,
  markOnline,
  newSession,
  roundsOf,
  scan,
  sessionViewFor,
  standingsOf as rankedStandings,
  viewContext,
} from './secret-squad-engine';
import { SQUAD_BANK, SquadCategory } from './secret-squad-packs';
import {
  createSession,
  deleteSession,
  forgetLiveSession,
  leaseSession,
  liveSessions,
  mutateSession,
  readSession,
  releaseSession,
} from './secret-squad-store';
import { notifyUsers } from './notification.service';
import { recordPointChanges } from './points-ledger.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export { SquadRuleError } from './secret-squad-engine';

export const squadSchedules = () => getDb().collection<SquadSchedule>('secret_squad_sessions');
export const squadOffices = () => getDb().collection<SquadOfficeAssignment>('secret_squad_offices');
/** One row per round paid to the org leaderboard: what makes paying idempotent across instances and restarts. */
export const squadPayouts = () => getDb().collection<SquadPayout>('secret_squad_payouts');

const GAME_KEY = 'secret-squad';

// ------------------------------------------------------------- dependencies

interface SquadDeps {
  now: () => number;
  random: () => number;
  bank: () => SquadCategory[];
  notify: typeof notifyUsers;
  /** Pays one round's net points (each player's, can be below 0) to the org leaderboard. */
  awardPoints: (session: SquadSession, roundIndex: number, points: Record<string, number>) => Promise<void>;
}

const defaults: SquadDeps = {
  now: () => Date.now(),
  random: Math.random,
  bank: () => SQUAD_BANK,
  notify: notifyUsers,
  awardPoints: payPoints,
};
let deps: SquadDeps = { ...defaults };

/** For checks: a hand-moved clock, a fixed die, a word bank of their own, captured pushes. */
export function configureSquad(overrides: Partial<SquadDeps> | null): void {
  deps = overrides ? { ...defaults, ...overrides } : { ...defaults };
}

export interface SquadEmitter {
  toUser(userId: string, event: string, payload: unknown): void;
  /** Everyone watching an office's game, except the people named. */
  toOffice(org: string, office: string, except: string[], event: string, payload: unknown): void;
}
let emitter: SquadEmitter | null = null;
export function setSquadEmitter(next: SquadEmitter | null): void {
  emitter = next;
}

// ------------------------------------------------------------------ offices

export interface SquadViewer {
  userId: string;
  org: string;
  name: string;
  initials: string;
  office: string | null;
  department?: string;
  photoKey?: string;
}

export const initialsOf = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('') || '?';

/** Office names compare without case or surrounding space. */
export const officeKey = (office: string) => office.trim().toLowerCase();

/** Which office this person plays in: the office list first, else their profile's location. */
export async function officeOf(user: Pick<User, 'userId' | 'org' | 'location'>): Promise<string | null> {
  if (!user.org) return null;
  const assigned = await squadOffices().findOne({ org: user.org, userId: user.userId });
  const office = assigned?.office ?? user.location ?? '';
  return office.trim() || null;
}

/** Everyone who plays in an office, by the same rule. */
export async function officeMembers(org: string, office: string): Promise<User[]> {
  const assignments = await squadOffices().find({ org }).toArray();
  const assignedHere = new Set(assignments.filter((row) => officeKey(row.office) === officeKey(office)).map((row) => row.userId));
  const assignedAnywhere = new Set(assignments.map((row) => row.userId));
  const roster = await users()
    .find({ org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } })
    .project<User>({ _id: 0, userId: 1, name: 1, org: 1, location: 1, department: 1 })
    .toArray();
  return roster.filter((user) =>
    assignedHere.has(user.userId)
    || (!assignedAnywhere.has(user.userId) && officeKey(user.location ?? '') === officeKey(office)),
  );
}

export async function viewerFor(userId: string): Promise<SquadViewer | null> {
  const user = await users().findOne(
    { userId, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } },
    { projection: { _id: 0, userId: 1, name: 1, org: 1, location: 1, department: 1, profilePhotoKey: 1 } },
  );
  if (!user?.org) return null;
  return {
    userId: user.userId,
    org: user.org,
    name: user.name || 'Someone',
    initials: initialsOf(user.name || '?'),
    office: await officeOf(user),
    department: user.department,
    photoKey: user.profilePhotoKey,
  };
}

// ------------------------------------------------------------------- state

/** The live session for an office: the newest one still running or showing results. */
async function liveSessionFor(org: string, office: string): Promise<SquadSession | null> {
  let best: SquadSession | null = null;
  for (const entry of await liveSessions()) {
    if (entry.org !== org) continue;
    const session = await readSession(entry.org, entry.id);
    if (!session || officeKey(session.office) !== officeKey(office)) continue;
    if (!best || session.lobbyOpensAt > best.lobbyOpensAt) best = session;
  }
  return best;
}

async function nextFor(org: string, office: string) {
  const now = new Date(deps.now());
  const upcoming = await squadSchedules()
    .find({ org, status: 'scheduled', startsAt: { $gt: now } })
    .sort({ startsAt: 1 })
    .toArray();
  const schedule = upcoming.find((item) => officeKey(item.office) === officeKey(office));
  if (!schedule) return null;
  return {
    sessionId: schedule.id,
    lobbyOpensAt: schedule.startsAt.getTime() - schedule.lobbyMs,
    startsAt: schedule.startsAt.getTime(),
    rounds: schedule.rounds.map((round) => ({ squadSize: round.squadSize, huntMs: round.huntMs, breakMs: round.breakMs })),
  };
}

/** How long a finished game's results stay up before the next game shows instead. */
const RESULTS_FIRST_MS = 15 * 60_000;

/** When a game ended: its last round's end, else the clock its record expires on less the time it is kept. */
function endedAt(session: SquadSession): number {
  const last = session.round ?? session.history[session.history.length - 1];
  return last?.overAt ?? session.phaseEndsAt - SQUAD.keepAfterMs;
}

/** A profile photo as this API serves it (as presignConnectMedia does), for the game's faces. */
const photoOf = (photoKey?: string) => (photoKey ? `/media/${encodeURIComponent(photoKey)}` : null);

const viewOptions = { photoUrl: (player: SquadPlayer) => photoOf(player.photoKey) };

function stateOf(
  session: SquadSession | null,
  viewer: (Pick<SquadViewer, 'userId' | 'name' | 'initials'> & { photoKey?: string }) | null,
  office: string,
  next: unknown,
  context?: SquadViewContext,
) {
  const now = deps.now();
  return {
    v: session?.version ?? 0,
    now,
    office,
    me: viewer ? { userId: viewer.userId, name: viewer.name, initials: viewer.initials, photoUrl: photoOf(viewer.photoKey) } : null,
    next: session ? null : next,
    session: session
      ? sessionViewFor(session, viewer?.userId ?? '', now, viewOptions, context ?? viewContext(session, viewOptions))
      : null,
  };
}

/**
 * An office's game while its lobby is open or it is being played, for the
 * Games tab's Live section; null before the lobby opens and once it is over.
 */
export async function liveSquadFor(user: Pick<User, 'userId' | 'org' | 'location'>) {
  if (!user.org) return null;
  const office = await officeOf(user);
  if (!office) return null;
  const session = await liveSessionFor(user.org, office);
  if (!session || session.status === 'over' || session.status === 'cancelled') return null;
  return {
    sessionId: session.id,
    office: session.office,
    phase: session.status === 'lobby' ? ('lobby' as const) : ('live' as const),
    startsAt: session.startsAt,
    players: session.players.filter((player) => !player.left).length,
    round: session.roundIndex + 1,
    rounds: session.rounds.length,
  };
}

/** The whole `squad:state` for one person, read fresh. */
export async function stateFor(viewer: SquadViewer) {
  if (!viewer.office) return stateOf(null, viewer, '', null);
  const held = await liveSessionFor(viewer.org, viewer.office);
  const next = held && held.status !== 'over' ? null : await nextFor(viewer.org, viewer.office);
  // A finished game's results stay up a while, then give way to the next
  // game on the schedule.
  const overFor = held && held.status === 'over' ? deps.now() - endedAt(held) : 0;
  const session = held && held.status === 'over' && next && overFor > RESULTS_FIRST_MS ? null : held;
  return stateOf(session, viewer, session?.office ?? viewer.office, session ? null : next);
}

// -------------------------------------------------------------------- push

const lastSent = new Map<string, string>();

/** Forgets everything kept in this process for a session that has ended. */
function forgetSession(id: string): void {
  for (const key of lastSent.keys()) if (key.startsWith(`${id}:`)) lastSent.delete(key);
  codeWindows.delete(id);
  cancelPushed.delete(id);
  for (const key of paidRounds) if (key.startsWith(`${id}:`)) paidRounds.delete(key);
}

/** Forgets what was last sent to someone, so their next push goes out whole. */
export function forgetSquadSent(userId: string): void {
  for (const key of lastSent.keys()) if (key.endsWith(`:${userId}`)) lastSent.delete(key);
}

/**
 * Sends each player what they now see, skipping anyone whose view is the same
 * as last time; everyone else watching that office (not joined) gets one
 * shared view, since nothing in it is theirs.
 */
export function pushSession(session: SquadSession): void {
  if (!emitter) return;
  // The standings every view ranks from: once per push, not once per phone.
  const context = viewContext(session, viewOptions);
  for (const player of session.players) {
    if (player.left) continue;
    let state: ReturnType<typeof stateOf>;
    try {
      state = stateOf(session, player, session.office, null, context);
    } catch (error) {
      // One player's view failing must not cost everyone after them theirs.
      logger.error('Secret Squad view failed', { sessionId: session.id, userId: player.userId }, error);
      continue;
    }
    // What they see, not when: the version and the clock change on every
    // action anywhere in the office, and must not send an update by themselves.
    const print = JSON.stringify({ ...state, now: 0, v: 0 });
    const key = `${session.id}:${player.userId}`;
    if (lastSent.get(key) === print) continue;
    lastSent.set(key, print);
    emitter.toUser(player.userId, 'squad:state', state);
  }
  const watchers = stateOf(session, null, session.office, null, context);
  const print = JSON.stringify({ ...watchers, now: 0, v: 0 });
  const key = `${session.id}:*`;
  if (lastSent.get(key) !== print) {
    lastSent.set(key, print);
    emitter.toOffice(session.org, session.office, session.players.filter((player) => !player.left).map((player) => player.userId), 'squad:state', watchers);
  }
}

async function change<T>(org: string, id: string, fn: (session: SquadSession) => T | null) {
  const out = await mutateSession(org, id, fn);
  if (out) pushSession(out.session);
  return out;
}

// ------------------------------------------------------------------ actions

async function requireLive(viewer: SquadViewer): Promise<SquadSession> {
  if (!viewer.office) throw new SquadRuleError(404, "You're not on an office list for Secret Squad yet.");
  const session = await liveSessionFor(viewer.org, viewer.office);
  if (!session) throw new SquadRuleError(404, 'No Secret Squad session is open right now.');
  return session;
}

export async function joinSquad(viewer: SquadViewer) {
  const session = await requireLive(viewer);
  const now = deps.now();
  await change(session.org, session.id, (s) => {
    joinSession(s, { userId: viewer.userId, name: viewer.name, initials: viewer.initials, department: viewer.department, photoKey: viewer.photoKey }, now);
    return true;
  });
  return {};
}

export async function leaveSquad(viewer: SquadViewer) {
  const session = await requireLive(viewer);
  await change(session.org, session.id, (s) => {
    leaveSession(s, viewer.userId);
    return true;
  });
  return {};
}

/** A scan of someone's QR (`{ qr }`; `{ code }` only while typed codes are on): resolves at once for both phones. */
export async function scanSquad(viewer: SquadViewer, input: { code?: unknown; qr?: unknown }) {
  const session = await requireLive(viewer);
  const now = deps.now();
  const out = await change(session.org, session.id, (s) =>
    scan(s, viewer.userId, {
      code: input.code === undefined ? undefined : String(input.code),
      qr: input.qr === undefined ? undefined : String(input.qr),
    }, now),
  );
  // A scan can complete the last squad and so end the round (or the game).
  await afterChange(out?.session);
  return out?.result ?? {};
}

/** A socket of theirs arrived or the last one left. */
export async function squadPresence(viewer: SquadViewer, online: boolean): Promise<void> {
  if (!viewer.office) return;
  const session = await liveSessionFor(viewer.org, viewer.office);
  if (!session || !session.players.some((player) => player.userId === viewer.userId)) return;
  const now = deps.now();
  await change(session.org, session.id, (s) => {
    if (online) markOnline(s, viewer.userId, now);
    else markOffline(s, viewer.userId, now);
    return true;
  });
}

/**
 * Once the game is over: pays the org leaderboard (once) and gives the card
 * its final standings. Called after anything that can end it: the clock, and
 * a scan completing the last squad.
 */
async function afterChange(session: SquadSession | undefined): Promise<void> {
  if (!session) return;
  if (session.status === 'over') await awardOnce(session, FINAL_PAYOUT, leaderboardPointsOf(session));
  // The last squad linking up ends the game in a scan, not the clock:
  // the card gets its standings either way (a second write is a no-op).
  if (session.status === 'over') await syncCard(session, 'over');
}

// -------------------------------------------------------------------- points

/**
 * Pays a round's net points once, across every instance and restart: the
 * round's row in `secret_squad_payouts` is written first (its id is
 * session:round, so a second writer gets a duplicate-key error and stops),
 * then the points move. Points are earned live in the game, but reach the org
 * leaderboard per round, as each player's net for it.
 */
/**
 * What a finished game adds to the org leaderboard, as the other games do:
 * the player's game score ÷ 100, rounded, at most 25, never below 0. The game
 * score itself can go below 0; the leaderboard never loses points to it.
 */
export const SQUAD_POINTS_PER_SCORE = 100;
export const SQUAD_POINTS_MAX = 25;
export const squadPointsFor = (score: number): number =>
  Math.max(0, Math.min(SQUAD_POINTS_MAX, Math.round(score / SQUAD_POINTS_PER_SCORE)));

/** The payout row of a whole game (rounds are not paid one by one). */
const FINAL_PAYOUT = -1;

function leaderboardPointsOf(session: SquadSession): Record<string, number> {
  return Object.fromEntries(standingsOf(session).map((row) => [row.userId, squadPointsFor(row.points)]));
}

/** Games this process knows are paid (Mongo is the truth; this saves asking it again on every scan). */
const paidRounds = new Set<string>();

async function awardOnce(session: SquadSession, roundIndex: number, points: Record<string, number>): Promise<void> {
  const key = roundIndex === FINAL_PAYOUT ? `${session.id}:final` : `${session.id}:${roundIndex}`;
  if (paidRounds.has(key)) return;
  try {
    await squadPayouts().insertOne({
      _id: roundIndex === FINAL_PAYOUT ? `${session.id}:final` : `${session.id}:${roundIndex}`,
      org: session.org,
      sessionId: session.id,
      roundIndex,
      points,
      paidAt: new Date(deps.now()),
    });
    paidRounds.add(key);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      paidRounds.add(key); // paid already
      return;
    }
    logger.error('Secret Squad payout claim failed', { sessionId: session.id, roundIndex }, error);
    return; // try again on the next pass
  }
  try {
    await deps.awardPoints(session, roundIndex, points);
  } catch (error) {
    // Claimed but not paid: logged rather than retried, so nobody is paid twice.
    logger.error('Secret Squad points failed', { sessionId: session.id, roundIndex }, error);
  }
}

/** Each player's leaderboard points for the game, to `users.points` and the ledger. Never below 0. */
export async function payPoints(session: SquadSession, roundIndex: number, points: Record<string, number>): Promise<void> {
  const paid = Object.entries(points).filter(([, value]) => Number.isFinite(value) && value > 0);
  if (paid.length === 0) return;
  await users().bulkWrite(paid.map(([userId, value]) => ({
    updateOne: { filter: { userId }, update: { $inc: { points: value } } },
  })));
  recordPointChanges(paid.map(([userId, value]) => ({
    userId,
    org: session.org,
    delta: value,
    source: 'game_challenge' as const,
    reason: 'game' as const,
    refId: roundIndex === FINAL_PAYOUT ? session.id : `${session.id}:${roundIndex}`,
    gameKey: GAME_KEY,
    title: 'Secret Squad',
    note: roundIndex === FINAL_PAYOUT ? session.office : `${session.office} · round ${roundIndex + 1}`,
  })));
}

/**
 * The session's final standings for its card ("Game over": the top 10 and
 * your own rank) and the full leaderboard: everyone dealt into a round, most
 * points first (can be below 0), ranked 1, 2, 2, 4 on a tie. Each row is
 * `{ userId, name, initials, photoUrl, points, rank }`.
 */
function standingsOf(session: SquadSession) {
  return rankedStandings(session, (player) => photoOf(player.photoKey));
}

/**
 * View Full Leaderboard: a game's final standings, for its page. The game
 * itself while it is still held, else what its card kept; without a
 * session id, the viewer's office's last finished game.
 */
export async function squadBoard(viewer: SquadViewer, input: { sessionId?: unknown }) {
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  if (sessionId) {
    const session = await readSession(viewer.org, sessionId);
    if (session && session.status === 'over') {
      if (officeKey(session.office) !== officeKey(viewer.office ?? '')) throw new SquadRuleError(404, 'There is no leaderboard for that game yet.');
      return { sessionId, office: session.office, endsAt: new Date(endedAt(session)).toISOString(), results: standingsOf(session) };
    }
  }
  // Your own office's games only.
  const posts = await connectPosts()
    .find(
      sessionId
        ? { org: viewer.org, type: 'secret_squad', 'body.sessionId': sessionId }
        : { org: viewer.org, type: 'secret_squad', 'body.status': 'over' },
      { sort: { publishedAt: -1 }, projection: { _id: 0, body: 1 } },
    )
    .limit(sessionId ? 1 : 50)
    .toArray();
  const post = posts.find((p) => officeKey(String((p.body as Record<string, unknown>).office ?? '')) === officeKey(viewer.office ?? ''));
  const body = (post?.body ?? {}) as Record<string, unknown>;
  if (!post || !Array.isArray(body.results)) throw new SquadRuleError(404, 'There is no leaderboard for that game yet.');
  return {
    sessionId: String(body.sessionId ?? sessionId),
    office: String(body.office ?? ''),
    endsAt: body.endsAt ?? null,
    results: body.results,
  };
}

async function syncCard(session: SquadSession, status: 'lobby' | 'playing' | 'over' | 'cancelled'): Promise<void> {
  const set: Record<string, unknown> = { 'body.status': status, updatedAt: new Date(deps.now()) };
  if (status === 'over') {
    // The real end: when the last round ended, not when this write ran.
    set['body.endsAt'] = new Date(endedAt(session)).toISOString();
    set['body.results'] = standingsOf(session);
  }
  await connectPosts()
    .updateOne({ org: session.org, type: 'secret_squad', 'body.sessionId': session.id, 'body.status': { $ne: status } }, { $set: set })
    .catch((error) => logger.error('Secret Squad card sync failed', { id: session.id }, error));
}

// --------------------------------------------------------------------- clock

const INSTANCE = randomUUID();
const codeWindows = new Map<string, number>();
/** Cancelled sessions whose phones have been told. */
const cancelPushed = new Set<string>();

/** Moves every live session on: dealing, the hunt's clock, breaks, the end. */
export async function tickSquad(): Promise<void> {
  const now = deps.now();
  for (const { org, id } of await liveSessions()) {
    if (!(await leaseSession(org, id, INSTANCE, 1_500))) continue;
    try {
      await tickOne(org, id, now);
    } catch (error) {
      logger.error('Secret Squad tick failed', { org, id }, error);
    } finally {
      await releaseSession(org, id, INSTANCE);
    }
  }
}

async function tickOne(org: string, id: string, now: number): Promise<void> {
  const current = await readSession(org, id);
  if (!current) {
    await forgetLiveSession(org, id);
    forgetSession(id);
    return;
  }
  // Called off from a script: tell every phone once, and the card.
  if (current.status === 'cancelled' && !cancelPushed.has(id)) {
    cancelPushed.add(id);
    pushSession(current);
    await syncCard(current, 'cancelled');
  }
  const out = await mutateSession(org, id, (session) => {
    const step = advance(session, now);
    if (step.kind === 'none') return null;
    if (step.kind === 'deal') {
      dealRound(session, now, deps.bank(), deps.random);
      return { kind: 'dealt' as const };
    }
    return step;
  });

  if (!out) {
    // Nothing moved; the code still changes every 20 seconds in the hunt.
    if (current.status === 'hunt') {
      const window = codeWindowOf(now);
      if (codeWindows.get(id) !== window) {
        codeWindows.set(id, window);
        pushSession(current);
      }
    }
    return;
  }
  const { session, result } = out;
  if (result.kind === 'expire') {
    await deleteSession(org, id);
    forgetSession(id);
    return;
  }
  codeWindows.set(id, codeWindowOf(now));
  pushSession(session);
  if (result.kind === 'dealt' && session.roundIndex === 0) await syncCard(session, 'playing');
  if (session.status === 'over') await syncCard(session, 'over');
  await afterChange(session);
}

// ---------------------------------------------------------------- schedule

/** The companies a local backend may open sessions for (SQUAD_LOCAL_ORGS, default sowaka). */
const localOrgs = () => (process.env.SQUAD_LOCAL_ORGS ?? 'sowaka').split(',').map((org) => org.trim()).filter(Boolean);

/** Opens the lobby of every session whose time has come, once, and tells that office. */
export async function openDueSessions(): Promise<number> {
  const now = deps.now();
  const due = await squadSchedules()
    .find({ status: 'scheduled', startsAt: { $gt: new Date(now - 30 * 60_000) } })
    .toArray();
  let opened = 0;
  for (const schedule of due) {
    const lobbyOpensAt = schedule.startsAt.getTime() - schedule.lobbyMs;
    if (lobbyOpensAt > now) continue;
    // A developer's machine shares the database with production: it opens
    // only the test companies' sessions, never a real one.
    if (env.isLocal && !localOrgs().includes(schedule.org)) continue;
    // Claimed in Mongo, which every server shares (local ones too): exactly
    // one process anywhere opens a session.
    const claimed = await squadSchedules().findOneAndUpdate(
      { id: schedule.id, status: 'scheduled' },
      { $set: { status: 'opened', updatedAt: new Date(now) } },
    );
    if (!claimed) continue;
    const session = newSession({
      id: schedule.id,
      org: schedule.org,
      office: schedule.office,
      lobbyOpensAt,
      startsAt: schedule.startsAt.getTime(),
      rounds: schedule.rounds,
      codeSeed: randomBytes(16).toString('hex'),
      now,
    });
    if (!(await createSession(session))) continue;
    opened += 1;
    pushSession(session);
    await syncCard(session, 'lobby');
    try {
      const members = await officeMembers(schedule.org, schedule.office);
      const minutes = Math.max(1, Math.round((schedule.startsAt.getTime() - now) / 60_000));
      await deps.notify(members.map((member) => member.userId), {
        scenario: 'secret_squad_lobby',
        title: `🎮 Secret Squad starts in ${minutes} minute${minutes === 1 ? '' : 's'}`,
        body: `Join the ${schedule.office} lobby. Everyone in it plays.`,
        data: { destination: 'game_challenge', gameKey: GAME_KEY, challengeId: 'squad', sessionId: schedule.id },
      });
    } catch (error) {
      logger.error('Secret Squad lobby push failed', { id: schedule.id }, error);
    }
  }
  return opened;
}

// ------------------------------------------------------------------ settings

/** A round's settings from partial input, with the defaults filled in and kept in range. */
export function roundConfig(input: Partial<SquadRoundConfig>): SquadRoundConfig {
  const d = SQUAD.defaults;
  const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value as number)) : fallback;
  const config: SquadRoundConfig = {
    squadSize: Math.round(clamp(input.squadSize, 5, SQUAD.minSquadSize, SQUAD.maxSquadSize)),
    huntMs: clamp(input.huntMs, d.huntMs, 60_000, 60 * 60_000),
    // 0 is allowed: a plan's last round has no break (and the last break is never used).
    breakMs: clamp(input.breakMs, d.breakMs, 0, 30 * 60_000),
  };
  const categories = (input.categories ?? []).map((name) => String(name).trim()).filter(Boolean);
  if (categories.length > 0) config.categories = categories;
  return config;
}

export type { SquadPlayer };
