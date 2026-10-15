/**
 * Secret Squad's rules, as pure functions over a session (docs/secret-squad.md).
 *
 * Nothing here reads a clock, a database or a socket: the service passes
 * `now` and a random source in, and stores what comes back. That keeps every
 * rule testable on its own, and lets any API instance move a session on.
 */
import { createHash, randomUUID } from 'node:crypto';
import type {
  SquadPlayer,
  SquadResultKind,
  SquadRoundConfig,
  SquadRoundState,
  SquadSession,
  SquadNoticeKind,
} from '../models/secret-squad.model';

export const SQUAD = {
  dealMs: 10_000,
  codeWindowMs: 20_000,
  askMs: 20_000,
  awayMs: 60_000,
  minPlayers: 4,
  minSquadSize: 2,
  // Every theme has 24 words: a bigger squad could not each get a different one.
  maxSquadSize: 24,
  /** A finished session stays readable this long, for late results screens. */
  keepAfterMs: 2 * 60 * 60_000,
  defaults: {
    lobbyMs: 3 * 60_000,
    huntMs: 17 * 60_000,
    breakMs: 2 * 60_000,
    lockMs: 45_000,
    pointsPerMember: 40,
    timeBonusPerSecond: 0.5,
  },
} as const;

/** A rule refused: `status` is the HTTP-ish code, `message` is for the player. */
export class SquadRuleError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'SquadRuleError';
  }
}

export type Random = () => number;

export interface SquadThemePick {
  theme: string;
  packId: string;
  /** Trickiest first; the round uses as many as the squad needs. */
  words: string[];
}

// ------------------------------------------------------------------ helpers

function shuffle<T>(items: T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const playerOf = (session: SquadSession, userId: string): SquadPlayer | undefined =>
  session.players.find((player) => player.userId === userId);

export const configFor = (session: SquadSession, index = session.roundIndex): SquadRoundConfig =>
  session.rounds[Math.min(index, session.rounds.length - 1)];

/** Squad sizes for `n` players aiming at `target` per squad: as even as possible, at least 2 each, at most `maxSquads` squads. */
export function squadSizes(n: number, target: number, maxSquads = Number.POSITIVE_INFINITY): number[] {
  if (n < 2) return [];
  let k = Math.max(2, Math.round(n / Math.max(SQUAD.minSquadSize, target)));
  k = Math.min(k, Math.floor(n / 2), Math.max(1, maxSquads));
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

// -------------------------------------------------------------- the session

export function newSession(input: {
  id: string;
  org: string;
  office: string;
  lobbyOpensAt: number;
  startsAt: number;
  rounds: SquadRoundConfig[];
  codeSeed: string;
  now: number;
}): SquadSession {
  return {
    id: input.id,
    org: input.org,
    office: input.office,
    status: 'lobby',
    lobbyOpensAt: input.lobbyOpensAt,
    startsAt: input.startsAt,
    phaseEndsAt: input.startsAt,
    rounds: input.rounds,
    roundIndex: 0,
    round: null,
    history: [],
    players: [],
    totals: {},
    codeSeed: input.codeSeed,
    packIds: [],
    version: 0,
    createdAt: input.now,
  };
}

export interface JoinProfile {
  userId: string;
  name: string;
  initials: string;
  photoKey?: string;
  department?: string;
}

/** Joins the session. In the lobby or a break you play the next round; mid-round you wait for the one after. */
export function joinSession(session: SquadSession, profile: JoinProfile, now: number): SquadPlayer {
  if (session.status === 'over' || session.status === 'cancelled') {
    throw new SquadRuleError(409, 'This session has ended.');
  }
  const existing = playerOf(session, profile.userId);
  if (existing) {
    existing.online = true;
    delete existing.offlineAt;
    return existing;
  }
  const player: SquadPlayer = {
    userId: profile.userId,
    name: profile.name,
    initials: profile.initials,
    photoKey: profile.photoKey,
    department: profile.department,
    joinedAt: now,
    online: true,
    playing: false,
    away: false,
    lockedUntil: 0,
  };
  session.players.push(player);
  return player;
}

/** Leaves before a round is dealt. Once dealt, closing the page is what "away" is for. */
export function leaveSession(session: SquadSession, userId: string): void {
  const player = playerOf(session, userId);
  if (!player) return;
  if (session.status !== 'lobby' && session.status !== 'break' && player.playing) {
    throw new SquadRuleError(409, 'You can leave between rounds.');
  }
  session.players = session.players.filter((item) => item.userId !== userId);
}

/** Who a round would deal: everyone joined and online, or only just offline. */
export function eligiblePlayers(session: SquadSession, now: number): SquadPlayer[] {
  return session.players.filter(
    (player) => player.online || (player.offlineAt !== undefined && now - player.offlineAt < SQUAD.awayMs),
  );
}

/** The squad sizes the next round would use, for the service to pick enough themes. */
export function planNextRound(session: SquadSession, now: number, maxSquads: number): number[] {
  const index = session.status === 'lobby' ? 0 : session.roundIndex + 1;
  const players = eligiblePlayers(session, now);
  if (players.length < SQUAD.minPlayers) return [];
  return squadSizes(players.length, configFor(session, index).squadSize, maxSquads);
}

function emptyRound(index: number, now: number, huntMs: number): SquadRoundState {
  return {
    index,
    dealtAt: now,
    huntStartsAt: now + SQUAD.dealMs,
    endsAt: now + SQUAD.dealMs + huntMs,
    squads: [],
    edges: [],
    asks: [],
    results: {},
    notices: {},
    missesAgainst: {},
  };
}

/**
 * Deals the next round: squads of `sizes`, one theme each from `themes`
 * (each with at least as many words as its squad), people from one department
 * spread across squads. Too few players skips the round.
 */
export function dealRound(
  session: SquadSession,
  now: number,
  sizes: number[],
  themes: SquadThemePick[],
  random: Random,
): void {
  const index = session.status === 'lobby' ? 0 : session.roundIndex + 1;
  if (session.round) session.history.push(session.round);
  session.roundIndex = index;
  const config = configFor(session, index);
  const round = emptyRound(index, now, config.huntMs);
  session.round = round;
  for (const player of session.players) {
    player.playing = false;
    player.away = false;
    player.lockedUntil = 0;
    delete player.squad;
    delete player.word;
  }

  const eligible = eligiblePlayers(session, now);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (sizes.length === 0 || eligible.length < SQUAD.minPlayers || total !== eligible.length || themes.length < sizes.length) {
    round.skipped = true;
    round.overAt = now;
    endPhaseAfterRound(session, now);
    return;
  }

  // Department by department, each shuffled, then dealt round-robin: a team is
  // spread across squads rather than landing in one.
  const byDepartment = new Map<string, SquadPlayer[]>();
  for (const player of shuffle(eligible, random)) {
    const key = player.department?.trim().toLowerCase() || '';
    byDepartment.set(key, [...(byDepartment.get(key) ?? []), player]);
  }
  const ordered = shuffle([...byDepartment.values()], random).flat();
  const members: string[][] = sizes.map(() => []);
  let cursor = 0;
  for (const player of ordered) {
    while (members[cursor % sizes.length].length >= sizes[cursor % sizes.length]) cursor += 1;
    members[cursor % sizes.length].push(player.userId);
    cursor += 1;
  }

  const picked = shuffle(themes.slice(0, sizes.length), random);
  round.squads = members.map((ids, squadIndex) => {
    const theme = picked[squadIndex];
    // The trickiest words, with a little variety: a few spares, shuffled.
    const pool = shuffle(theme.words.slice(0, Math.min(theme.words.length, ids.length + 4)), random);
    const words = pool.slice(0, ids.length);
    ids.forEach((id, i) => {
      const player = playerOf(session, id)!;
      player.playing = true;
      player.squad = squadIndex;
      player.word = words[i];
    });
    return { theme: theme.theme, packId: theme.packId, words, members: ids };
  });
  session.packIds = [...new Set([...session.packIds, ...picked.map((theme) => theme.packId)])];
  session.status = 'dealing';
  session.phaseEndsAt = round.huntStartsAt;
}

// -------------------------------------------------------------------- codes

const permutations = new Map<string, Uint16Array>();

/** A shuffle of 0000–9999 for one window of one round: every player's code differs. */
function permutationFor(seed: string, round: number, window: number): Uint16Array {
  const key = `${seed}:${round}:${window}`;
  const cached = permutations.get(key);
  if (cached) return cached;
  const digest = createHash('sha256').update(key).digest();
  let a = digest.readUInt32LE(0), b = digest.readUInt32LE(4), c = digest.readUInt32LE(8), d = digest.readUInt32LE(12);
  // sfc32: a small, well-mixed PRNG, seeded from the hash.
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const out = (t + d) | 0;
    c = (c + out) | 0;
    return (out >>> 0) / 4294967296;
  };
  const values = new Uint16Array(10_000);
  for (let i = 0; i < values.length; i += 1) values[i] = i;
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const swap = values[i];
    values[i] = values[j];
    values[j] = swap;
  }
  if (permutations.size > 256) permutations.delete(permutations.keys().next().value as string);
  permutations.set(key, values);
  return values;
}

export const codeWindowOf = (now: number) => Math.floor(now / SQUAD.codeWindowMs);

/** A player's current code and when it changes, or null if they have none. */
export function codeFor(session: SquadSession, userId: string, now: number): { code: string; expiresAt: number } | null {
  const round = session.round;
  if (!round || session.status !== 'hunt') return null;
  const index = session.players.findIndex((player) => player.userId === userId);
  const player = session.players[index];
  if (!player?.playing || player.away || player.squad === undefined) return null;
  if (round.squads[player.squad]?.finishedAt) return null;
  const window = codeWindowOf(now);
  const code = permutationFor(session.codeSeed, round.index, window)[index];
  return { code: String(code).padStart(4, '0'), expiresAt: (window + 1) * SQUAD.codeWindowMs };
}

/** Who holds `code` now, or held it in the previous window (a code read just as it changed). */
export function holderOf(session: SquadSession, code: string, now: number): string | null {
  const round = session.round;
  if (!round || !/^\d{4}$/.test(code)) return null;
  const value = Number(code);
  const window = codeWindowOf(now);
  for (const w of [window, window - 1]) {
    const index = permutationFor(session.codeSeed, round.index, w).indexOf(value);
    if (index >= 0 && index < session.players.length) {
      const holder = session.players[index];
      if (codeFor(session, holder.userId, w * SQUAD.codeWindowMs)) return holder.userId;
    }
  }
  return null;
}

export const qrFor = (session: SquadSession, code: string) => `SQ1:${session.id}:${session.round?.index ?? 0}:${code}`;

/** The code inside a scanned QR, if it belongs to this session's current round. */
export function codeFromQr(session: SquadSession, text: string): string | null {
  const match = /^SQ1:([^:]+):(\d+):(\d{4})$/.exec(text.trim());
  if (!match || match[1] !== session.id || Number(match[2]) !== session.round?.index) return null;
  return match[3];
}

// ------------------------------------------------------------------- groups

/** Each member's linked group in a squad, as a map from member to group id. */
function groupsIn(round: SquadRoundState, squadIndex: number): Map<string, string> {
  const members = round.squads[squadIndex].members;
  const parent = new Map(members.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const edge of round.edges) {
    if (!parent.has(edge.a) || !parent.has(edge.b)) continue;
    const ra = find(edge.a);
    const rb = find(edge.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return new Map(members.map((id) => [id, find(id)]));
}

export function linkedWith(session: SquadSession, userId: string): string[] {
  const player = playerOf(session, userId);
  const round = session.round;
  if (!round || player?.squad === undefined) return [userId];
  const groups = groupsIn(round, player.squad);
  const mine = groups.get(userId);
  return round.squads[player.squad].members.filter((id) => groups.get(id) === mine);
}

function largestGroup(round: SquadRoundState, squadIndex: number): number {
  const counts = new Map<string, number>();
  for (const root of groupsIn(round, squadIndex).values()) counts.set(root, (counts.get(root) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

const presentMembers = (session: SquadSession, squadIndex: number) =>
  session.round!.squads[squadIndex].members.filter((id) => !playerOf(session, id)?.away);

/** Marks a squad finished when every member still in the game is in one group. */
function settleSquad(session: SquadSession, squadIndex: number, now: number): void {
  const round = session.round!;
  const squad = round.squads[squadIndex];
  if (squad.finishedAt) return;
  const present = presentMembers(session, squadIndex);
  if (present.length < 2) {
    if (present.length === 1) notify(round, [present[0]], 'squad_left', present[0], now);
    return;
  }
  const groups = groupsIn(round, squadIndex);
  const root = groups.get(present[0]);
  if (present.every((id) => groups.get(id) === root)) {
    squad.finishedAt = now;
    squad.place = round.squads.filter((item) => item.finishedAt).length;
  }
}

function notify(round: SquadRoundState, to: string[], kind: SquadNoticeKind, about: string, now: number): void {
  for (const id of to) {
    const last = round.notices[id];
    if (last && last.kind === kind && last.userId === about) continue;
    round.notices[id] = { kind, userId: about, at: now };
  }
}

function result(round: SquadRoundState, userId: string, kind: SquadResultKind, otherId: string, now: number): void {
  round.results[userId] = { id: randomUUID(), kind, otherId, at: now };
}

// ------------------------------------------------------------------- checks

function requireHunter(session: SquadSession, userId: string): SquadPlayer {
  if (session.status !== 'hunt' || !session.round) throw new SquadRuleError(409, 'Checks open when the hunt starts.');
  const player = playerOf(session, userId);
  if (!player?.playing || player.squad === undefined) throw new SquadRuleError(403, "You're not in this round. You'll play the next one.");
  if (player.away) throw new SquadRuleError(409, 'Reconnecting… try again in a moment.');
  return player;
}

const openAskOf = (round: SquadRoundState, userId: string) =>
  round.asks.find((ask) => ask.from === userId || ask.to === userId);

/**
 * One player checks another by code (typed, or read from a QR). Already
 * linked answers at once; otherwise the other player is asked to allow it.
 */
export function startCheck(
  session: SquadSession,
  fromId: string,
  input: { code?: string; qr?: string },
  now: number,
): { askId: string } | { already: true } {
  const from = requireHunter(session, fromId);
  const round = session.round!;
  if (round.squads[from.squad!].finishedAt) throw new SquadRuleError(409, 'Your squad is complete. Watch the board!');
  if (from.lockedUntil > now) {
    throw new SquadRuleError(409, `Checks are paused for ${Math.ceil((from.lockedUntil - now) / 1000)} s.`);
  }
  if (openAskOf(round, fromId)) throw new SquadRuleError(409, 'Finish the check you have open first.');

  const code = input.qr !== undefined ? codeFromQr(session, String(input.qr)) : String(input.code ?? '').trim();
  if (!code) throw new SquadRuleError(404, "That QR isn't from this round.");
  if (!/^\d{4}$/.test(code)) throw new SquadRuleError(400, 'Codes are 4 digits.');
  const toId = holderOf(session, code, now);
  if (!toId) throw new SquadRuleError(404, 'No one has that code right now. Codes change every 20 seconds.');
  if (toId === fromId) throw new SquadRuleError(400, "That's your own code.");

  if (linkedWith(session, fromId).includes(toId)) {
    result(round, fromId, 'already', toId, now);
    return { already: true };
  }
  if (openAskOf(round, toId)) throw new SquadRuleError(409, "They're answering another check. Try again in a moment.");
  const ask = { id: randomUUID(), from: fromId, to: toId, expiresAt: now + SQUAD.askMs };
  round.asks.push(ask);
  return { askId: ask.id };
}

/** The other player allows or turns down a check. Allowing compares squads. */
export function answerCheck(session: SquadSession, toId: string, askId: string, allow: boolean, now: number): void {
  const round = session.round;
  const ask = round?.asks.find((item) => item.id === askId && item.to === toId);
  if (!round || !ask) throw new SquadRuleError(404, 'That check has expired.');
  round.asks = round.asks.filter((item) => item.id !== askId);
  const from = playerOf(session, ask.from);
  const to = playerOf(session, ask.to);
  if (session.status !== 'hunt' || !from?.playing || !to?.playing || from.away || to.away) {
    result(round, ask.from, 'expired', ask.to, now);
    return;
  }
  if (!allow) {
    result(round, ask.from, 'declined', ask.to, now);
    return;
  }
  if (from.squad === to.squad) {
    round.edges.push({ a: from.userId, b: to.userId, at: now });
    result(round, from.userId, 'match', to.userId, now);
    result(round, to.userId, 'match', from.userId, now);
    settleSquad(session, from.squad!, now);
  } else {
    const lockMs = configFor(session).lockMs;
    from.lockedUntil = Math.max(from.lockedUntil, now + lockMs);
    to.lockedUntil = Math.max(to.lockedUntil, now + lockMs);
    result(round, from.userId, 'miss', to.userId, now);
    result(round, to.userId, 'miss', from.userId, now);
    round.missesAgainst[to.userId] = (round.missesAgainst[to.userId] ?? 0) + 1;
  }
  maybeEndRound(session, now);
}

// ----------------------------------------------------------------- presence

export function markOnline(session: SquadSession, userId: string, now: number): void {
  const player = playerOf(session, userId);
  if (!player) return;
  player.online = true;
  delete player.offlineAt;
  if (!player.away) return;
  player.away = false;
  const round = session.round;
  if (!round || player.squad === undefined) return;
  const squad = round.squads[player.squad];
  if (squad.finishedAt) return;
  // Back, but unlinked: their squad checks them back in.
  round.edges = round.edges.filter((edge) => edge.a !== userId && edge.b !== userId);
  notify(round, squad.members.filter((id) => id !== userId), 'teammate_back', userId, now);
}

export function markOffline(session: SquadSession, userId: string, now: number): void {
  const player = playerOf(session, userId);
  if (!player) return;
  player.online = false;
  player.offlineAt = now;
}

// ------------------------------------------------------------- the clock

export type AdvanceOutcome =
  | { kind: 'none' }
  | { kind: 'changed' }
  | { kind: 'deal' } // the service picks themes and calls dealRound
  | { kind: 'roundEnded'; index: number }
  | { kind: 'expire' };

/** Moves the session on to wherever `now` says it should be. */
export function advance(session: SquadSession, now: number): AdvanceOutcome {
  switch (session.status) {
    case 'lobby':
      return now >= session.startsAt ? { kind: 'deal' } : { kind: 'none' };
    case 'dealing':
      if (now < session.phaseEndsAt) return { kind: 'none' };
      session.status = 'hunt';
      session.phaseEndsAt = session.round!.endsAt;
      return { kind: 'changed' };
    case 'hunt':
      return advanceHunt(session, now);
    case 'break':
      return now >= session.phaseEndsAt ? { kind: 'deal' } : { kind: 'none' };
    case 'over':
    case 'cancelled':
      return now >= session.phaseEndsAt ? { kind: 'expire' } : { kind: 'none' };
  }
}

function advanceHunt(session: SquadSession, now: number): AdvanceOutcome {
  const round = session.round!;
  let changed = false;
  for (const ask of round.asks.filter((item) => item.expiresAt <= now)) {
    result(round, ask.from, 'expired', ask.to, now);
    changed = true;
  }
  round.asks = round.asks.filter((item) => item.expiresAt > now);

  for (const player of session.players) {
    if (!player.playing || player.away || player.online || player.offlineAt === undefined) continue;
    if (now - player.offlineAt < SQUAD.awayMs) continue;
    player.away = true;
    changed = true;
    round.asks = round.asks.filter((ask) => ask.from !== player.userId && ask.to !== player.userId);
    const squad = round.squads[player.squad!];
    if (!squad.finishedAt) {
      notify(round, squad.members.filter((id) => id !== player.userId), 'teammate_away', player.userId, now);
      settleSquad(session, player.squad!, now);
    }
  }
  const ended = maybeEndRound(session, now);
  if (ended) return { kind: 'roundEnded', index: round.index };
  return changed ? { kind: 'changed' } : { kind: 'none' };
}

/** Ends the round at 0:00, or once no squad can still finish. */
function maybeEndRound(session: SquadSession, now: number): boolean {
  const round = session.round!;
  if (session.status !== 'hunt') return false;
  const open = round.squads.some(
    (squad, index) => !squad.finishedAt && presentMembers(session, index).length >= 2,
  );
  if (now < round.endsAt && open) return false;
  round.overAt = now;
  round.asks = [];
  scoreRound(session);
  endPhaseAfterRound(session, now);
  return true;
}

/** Places the unfinished squads and works out every player's points for the round. */
function scoreRound(session: SquadSession): void {
  const round = session.round!;
  const config = configFor(session, round.index);
  const finishedCount = round.squads.filter((squad) => squad.finishedAt).length;
  const unfinished = round.squads
    .map((squad, index) => ({ squad, size: largestGroup(round, index) }))
    .filter((entry) => !entry.squad.finishedAt)
    .sort((x, y) => y.size - x.size);
  unfinished.forEach((entry, i) => { entry.squad.place = finishedCount + i + 1; });

  round.points = {};
  round.squads.forEach((squad, index) => {
    const group = largestGroup(round, index);
    const base = group >= 2 ? config.pointsPerMember * group : 0;
    const bonus = squad.finishedAt
      ? Math.floor(((round.endsAt - squad.finishedAt) / 1000) * config.timeBonusPerSecond)
      : 0;
    for (const id of squad.members) {
      round.points![id] = base + bonus;
      session.totals[id] = (session.totals[id] ?? 0) + base + bonus;
    }
  });
}

function endPhaseAfterRound(session: SquadSession, now: number): void {
  const last = session.roundIndex >= session.rounds.length - 1;
  if (last) {
    session.status = 'over';
    session.phaseEndsAt = now + SQUAD.keepAfterMs;
  } else {
    session.status = 'break';
    session.phaseEndsAt = now + configFor(session).breakMs;
  }
}

export function cancelSession(session: SquadSession, reason: string, now: number): void {
  session.status = 'cancelled';
  session.cancelReason = reason;
  session.phaseEndsAt = now + SQUAD.keepAfterMs;
  if (session.round) session.round.asks = [];
}

// -------------------------------------------------------------------- views

export interface SquadViewOptions {
  photoUrl?: (player: SquadPlayer) => string | null;
}

const short = (player: SquadPlayer | undefined) =>
  player ? { userId: player.userId, name: player.name, initials: player.initials } : null;

/** What one person sees: the per-player `session` part of `squad:state`. */
export function sessionViewFor(session: SquadSession, userId: string, now: number, options: SquadViewOptions = {}) {
  const me = playerOf(session, userId);
  const round = session.round;
  const lobbyFaces = session.status === 'lobby'
    ? session.players.slice(-12).reverse().map((player) => ({
      ...short(player)!,
      photoUrl: options.photoUrl?.(player) ?? null,
    }))
    : [];
  return {
    id: session.id,
    status: session.status,
    lobbyOpensAt: session.lobbyOpensAt,
    startsAt: session.startsAt,
    phaseEndsAt: session.phaseEndsAt,
    roundIndex: session.roundIndex,
    roundCount: session.rounds.length,
    rounds: session.rounds.map((config) => ({ squadSize: config.squadSize, huntMs: config.huntMs })),
    joined: Boolean(me),
    playing: Boolean(me?.playing) && Boolean(round) && !round?.skipped,
    players: session.status === 'lobby'
      ? session.players.length
      : session.players.filter((player) => player.playing).length,
    faces: lobbyFaces,
    totalPoints: me ? session.totals[userId] ?? 0 : 0,
    cancelReason: session.cancelReason ?? null,
    round: round ? roundViewFor(session, round, me, now) : null,
  };
}

function roundViewFor(session: SquadSession, round: SquadRoundState, me: SquadPlayer | undefined, now: number) {
  const done = session.status === 'break' || session.status === 'over';
  const board = {
    squads: round.squads.length,
    finished: round.squads.filter((squad) => squad.finishedAt).length,
    hunting: round.squads.filter((squad, i) => !squad.finishedAt && presentMembers(session, i).length >= 2).length,
    stuck: round.squads.filter((squad, i) => !squad.finishedAt && presentMembers(session, i).length < 2).length,
  };
  const view = {
    index: round.index,
    skipped: Boolean(round.skipped),
    huntStartsAt: round.huntStartsAt,
    endsAt: round.endsAt,
    board,
    player: null as null | Record<string, unknown>,
    squad: null as null | Record<string, unknown>,
    ask: null as null | Record<string, unknown>,
    asking: null as null | Record<string, unknown>,
    result: null as null | Record<string, unknown>,
    notice: null as null | Record<string, unknown>,
    results: done ? resultsFor(session, round, me) : null,
  };
  if (!me?.playing || me.squad === undefined || round.skipped) return view;

  const squad = round.squads[me.squad];
  const code = codeFor(session, me.userId, now);
  view.player = {
    word: me.word,
    code: code?.code ?? null,
    codeExpiresAt: code?.expiresAt ?? null,
    qr: code ? qrFor(session, code.code) : null,
    lockedUntil: me.lockedUntil > now ? me.lockedUntil : 0,
    away: me.away,
  };
  const linkedIds = linkedWith(session, me.userId);
  const linked = linkedIds.map((id) => {
    const player = playerOf(session, id)!;
    return { ...short(player)!, word: player.word, me: id === me.userId, away: player.away };
  });
  const awayWords = squad.members
    .filter((id) => !linkedIds.includes(id) && playerOf(session, id)?.away)
    .map((id) => ({ name: playerOf(session, id)!.name, word: playerOf(session, id)!.word }));
  view.squad = {
    size: squad.members.length,
    needed: presentMembers(session, me.squad).length,
    linked,
    awayWords,
    unknown: squad.members.length - linked.length - awayWords.length,
    finishedAt: squad.finishedAt ?? 0,
    place: squad.finishedAt || done ? squad.place ?? 0 : 0,
    theme: squad.finishedAt || done ? squad.theme : null,
  };
  const incoming = round.asks.find((ask) => ask.to === me.userId);
  if (incoming) {
    const from = playerOf(session, incoming.from);
    view.ask = { id: incoming.id, fromName: from?.name ?? 'A colleague', fromInitials: from?.initials ?? '?', expiresAt: incoming.expiresAt };
  }
  const outgoing = round.asks.find((ask) => ask.from === me.userId);
  if (outgoing) {
    view.asking = { id: outgoing.id, toName: playerOf(session, outgoing.to)?.name ?? 'A colleague', expiresAt: outgoing.expiresAt };
  }
  const last = round.results[me.userId];
  if (last) {
    const other = playerOf(session, last.otherId);
    const showWord = last.kind === 'match' || last.kind === 'miss' || last.kind === 'already';
    view.result = { id: last.id, kind: last.kind, otherName: other?.name ?? 'A colleague', otherWord: showWord ? other?.word ?? null : null, at: last.at };
  }
  const notice = round.notices[me.userId];
  if (notice) {
    const about = playerOf(session, notice.userId);
    view.notice = { kind: notice.kind, name: about?.name ?? 'A teammate', word: about?.word ?? null, at: notice.at };
  }
  return view;
}

function resultsFor(session: SquadSession, round: SquadRoundState, me: SquadPlayer | undefined) {
  const squads = round.squads
    .map((squad, index) => ({
      place: squad.place ?? 0,
      theme: squad.theme,
      words: squad.words,
      finishedAt: squad.finishedAt ? squad.finishedAt - round.huntStartsAt : null,
      linked: largestGroup(round, index),
      size: squad.members.length,
      points: round.points?.[squad.members[0]] ?? 0,
      mine: me?.squad === index && Boolean(me?.playing),
    }))
    .sort((a, b) => a.place - b.place);
  const [trickiestId, checks] = Object.entries(round.missesAgainst).sort((a, b) => b[1] - a[1])[0] ?? [];
  const trickiest = trickiestId ? { word: playerOf(session, trickiestId)?.word ?? '', checks } : null;
  return {
    skipped: Boolean(round.skipped),
    squads,
    trickiest,
    points: me ? round.points?.[me.userId] ?? 0 : 0,
  };
}
