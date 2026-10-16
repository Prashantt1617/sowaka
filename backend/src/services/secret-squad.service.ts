/**
 * Secret Squad sessions: opening them on schedule, joining, checks, the clock,
 * pushing each phone what it should see, and paying points
 * (docs/secret-squad.md). The rules are in secret-squad-engine.ts; this file
 * is everything that touches a clock, the store, Mongo or a socket.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { connectPosts, getDb, users } from '../config/db';
import type {
  SquadOfficeAssignment,
  SquadPlayer,
  SquadRoundConfig,
  SquadSchedule,
  SquadSession,
} from '../models/secret-squad.model';
import type { User } from '../models/user.model';
import {
  SQUAD,
  SquadRuleError,
  SquadThemePick,
  answerCheck,
  advance,
  codeWindowOf,
  dealRound,
  joinSession,
  leaveSession,
  markOffline,
  markOnline,
  newSession,
  planNextRound,
  sessionViewFor,
  startCheck,
} from './secret-squad-engine';
import { SQUAD_PACKS, SquadPack } from './secret-squad-packs';
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
import { claimOnce } from './scribble-store';
import { notifyUsers } from './notification.service';
import { recordPointChanges } from './points-ledger.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export { SquadRuleError } from './secret-squad-engine';

export const squadSchedules = () => getDb().collection<SquadSchedule>('secret_squad_sessions');
export const squadOffices = () => getDb().collection<SquadOfficeAssignment>('secret_squad_offices');
const packUsage = () => getDb().collection<{ org: string; packId: string; lastUsedAt: Date }>('secret_squad_pack_usage');

const GAME_KEY = 'secret-squad';

// ------------------------------------------------------------- dependencies

interface SquadDeps {
  now: () => number;
  random: () => number;
  packs: () => SquadPack[];
  notify: typeof notifyUsers;
  awardPoints: (session: SquadSession, roundIndex: number, points: Record<string, number>) => Promise<void>;
}

const defaults: SquadDeps = {
  now: () => Date.now(),
  random: Math.random,
  packs: () => SQUAD_PACKS,
  notify: notifyUsers,
  awardPoints: payPoints,
};
let deps: SquadDeps = { ...defaults };

/** For checks: a hand-moved clock, a fixed die, packs of their own, captured pushes. */
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
    rounds: schedule.rounds.map((round) => ({ squadSize: round.squadSize, huntMs: round.huntMs })),
  };
}

/** A profile photo as this API serves it (as presignConnectMedia does), for the game's faces. */
const photoOf = (photoKey?: string) => (photoKey ? `/media/${encodeURIComponent(photoKey)}` : null);

function stateOf(
  session: SquadSession | null,
  viewer: (Pick<SquadViewer, 'userId' | 'name' | 'initials'> & { photoKey?: string }) | null,
  office: string,
  next: unknown,
) {
  const now = deps.now();
  return {
    v: session?.version ?? 0,
    now,
    office,
    me: viewer ? { userId: viewer.userId, name: viewer.name, initials: viewer.initials, photoUrl: photoOf(viewer.photoKey) } : null,
    next: session ? null : next,
    session: session ? sessionViewFor(session, viewer?.userId ?? '', now, { photoUrl: (player) => photoOf(player.photoKey) }) : null,
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
  // A finished game's results give way to the next one on the schedule.
  const session = held && held.status === 'over' && next ? null : held;
  return stateOf(session, viewer, session?.office ?? viewer.office, session ? null : next);
}

// -------------------------------------------------------------------- push

const lastSent = new Map<string, string>();

/** Forgets everything kept in this process for a session that has ended. */
function forgetSession(id: string): void {
  for (const key of lastSent.keys()) if (key.startsWith(`${id}:`)) lastSent.delete(key);
  codeWindows.delete(id);
  cancelPushed.delete(id);
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
  for (const player of session.players) {
    if (player.left) continue;
    let state: ReturnType<typeof stateOf>;
    try {
      state = stateOf(session, player, session.office, null);
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
  const watchers = stateOf(session, null, session.office, null);
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

export async function checkSquad(viewer: SquadViewer, input: { code?: unknown; qr?: unknown }) {
  const session = await requireLive(viewer);
  const now = deps.now();
  const out = await change(session.org, session.id, (s) =>
    startCheck(s, viewer.userId, {
      code: input.code === undefined ? undefined : String(input.code),
      qr: input.qr === undefined ? undefined : String(input.qr),
    }, now),
  );
  return out?.result ?? {};
}

export async function answerSquad(viewer: SquadViewer, input: { askId?: unknown; allow?: unknown }) {
  const session = await requireLive(viewer);
  const now = deps.now();
  const out = await change(session.org, session.id, (s) => {
    answerCheck(s, viewer.userId, String(input.askId ?? ''), input.allow === true, now);
    return true;
  });
  await afterChange(out?.session);
  return {};
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

/** An answer can end a round (the last squad finishing): pay it now rather than on the next tick. */
async function afterChange(session: SquadSession | undefined): Promise<void> {
  if (!session) return;
  for (const round of [...session.history, ...(session.round ? [session.round] : [])]) {
    if (round.points && !round.skipped) await awardOnce(session, round.index, round.points);
  }
}

// ------------------------------------------------------------------- dealing

interface ThemeEntry extends SquadThemePick {
  difficulty: SquadPack['difficulty'];
}

/** Enough themes for the next round, whole packs together, packs not used lately first. */
export function chooseThemes(
  count: number,
  minWords: number,
  sessionPacks: string[],
  recentPacks: Map<string, number>,
  random: () => number,
): SquadThemePick[] {
  const packs = deps.packs()
    .map((pack) => ({
      pack,
      themes: pack.themes.filter((theme) => theme.words.length >= minWords),
      rank: (sessionPacks.includes(pack.id) ? 2 : 0) + (recentPacks.has(pack.id) ? 1 : 0),
      recency: recentPacks.get(pack.id) ?? 0,
      tie: random(),
    }))
    .filter((entry) => entry.themes.length > 0)
    .sort((a, b) => a.rank - b.rank || a.recency - b.recency || a.tie - b.tie);
  const out: ThemeEntry[] = [];
  for (const entry of packs) {
    for (const theme of entry.themes) {
      if (out.length >= count) break;
      out.push({ theme: theme.name, packId: entry.pack.id, words: theme.words, difficulty: entry.pack.difficulty });
    }
    if (out.length >= count) break;
  }
  return out;
}

/** How many themes have at least `minWords` words. */
const themesWith = (minWords: number) =>
  deps.packs().reduce((sum, pack) => sum + pack.themes.filter((theme) => theme.words.length >= minWords).length, 0);

/** Squad sizes and themes for the next round; fewer squads if there aren't enough themes. */
function planDeal(session: SquadSession, now: number, recent: Map<string, number>) {
  let sizes = planNextRound(session, now, Number.POSITIVE_INFINITY);
  for (let pass = 0; pass < 6 && sizes.length > 0; pass += 1) {
    const available = themesWith(Math.max(...sizes));
    if (available >= sizes.length) break;
    sizes = available >= 2 ? planNextRound(session, now, available) : [];
  }
  const themes = sizes.length > 0
    ? chooseThemes(sizes.length, Math.max(...sizes), session.packIds, recent, deps.random)
    : [];
  return { sizes, themes };
}

async function recentPacksOf(org: string): Promise<Map<string, number>> {
  try {
    const since = new Date(deps.now() - 21 * 24 * 60 * 60_000);
    const rows = await packUsage().find({ org, lastUsedAt: { $gte: since } }).toArray();
    return new Map(rows.map((row) => [row.packId, row.lastUsedAt.getTime()]));
  } catch (error) {
    logger.error('Secret Squad pack usage read failed', { org }, error);
    return new Map();
  }
}

async function notePacksUsed(session: SquadSession): Promise<void> {
  const ids = [...new Set(session.round?.squads.map((squad) => squad.packId) ?? [])];
  if (ids.length === 0) return;
  const at = new Date(deps.now());
  await packUsage().bulkWrite(ids.map((packId) => ({
    updateOne: { filter: { org: session.org, packId }, update: { $set: { org: session.org, packId, lastUsedAt: at } }, upsert: true },
  }))).catch((error) => logger.error('Secret Squad pack usage write failed', { org: session.org }, error));
}

// -------------------------------------------------------------------- points

/** Pays a round's points once, across every instance. */
async function awardOnce(session: SquadSession, roundIndex: number, points: Record<string, number>): Promise<void> {
  if (!(await claimOnce(`squad-points:${session.id}:${roundIndex}`, 7 * 24 * 60 * 60_000))) return;
  try {
    await deps.awardPoints(session, roundIndex, points);
  } catch (error) {
    logger.error('Secret Squad points failed', { sessionId: session.id, roundIndex }, error);
  }
}

async function payPoints(session: SquadSession, roundIndex: number, points: Record<string, number>): Promise<void> {
  const paid = Object.entries(points).filter(([, value]) => value > 0);
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
    refId: `${session.id}:${roundIndex}`,
    gameKey: GAME_KEY,
    title: 'Secret Squad',
    note: `${session.office} · round ${roundIndex + 1}`,
  })));
}

/** Keeps the feed card's state in step with the session (lobby, playing, over). */
/**
 * The session's final standings for its card ("Game over": the top 10 and
 * your own rank): everyone who played, most points first, ranked 1, 2, 2, 4
 * on a tie.
 */
function standingsOf(session: SquadSession) {
  const rows = session.players
    .map((player) => ({
      userId: player.userId,
      name: player.name,
      initials: player.initials,
      photoUrl: photoOf(player.photoKey),
      points: session.totals[player.userId] ?? 0,
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return rows.map((row, index) => ({
    ...row,
    rank: index > 0 && rows[index - 1].points === row.points ? rows.findIndex((r) => r.points === row.points) + 1 : index + 1,
  }));
}

async function syncCard(session: SquadSession, status: 'lobby' | 'playing' | 'over' | 'cancelled'): Promise<void> {
  const set: Record<string, unknown> = { 'body.status': status, updatedAt: new Date(deps.now()) };
  if (status === 'over') {
    set['body.endsAt'] = new Date(deps.now()).toISOString();
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
  const dealDue = (current.status === 'lobby' && now >= current.startsAt)
    || (current.status === 'break' && now >= current.phaseEndsAt);
  const recent = dealDue ? await recentPacksOf(org) : new Map<string, number>();

  const out = await mutateSession(org, id, (session) => {
    const step = advance(session, now);
    if (step.kind === 'none') return null;
    if (step.kind === 'deal') {
      const { sizes, themes } = planDeal(session, now, recent);
      dealRound(session, now, sizes, themes, deps.random);
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
  if (result.kind === 'dealt') {
    await notePacksUsed(session);
    if (session.roundIndex === 0) await syncCard(session, 'playing');
  }
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
  return {
    squadSize: Math.round(clamp(input.squadSize, 5, SQUAD.minSquadSize, SQUAD.maxSquadSize)),
    huntMs: clamp(input.huntMs, d.huntMs, 60_000, 60 * 60_000),
    breakMs: clamp(input.breakMs, d.breakMs, 15_000, 30 * 60_000),
    lockMs: clamp(input.lockMs, d.lockMs, 0, 5 * 60_000),
    pointsPerMember: clamp(input.pointsPerMember, d.pointsPerMember, 0, 1000),
    timeBonusPerSecond: clamp(input.timeBonusPerSecond, d.timeBonusPerSecond, 0, 10),
  };
}

export type { SquadPlayer };
