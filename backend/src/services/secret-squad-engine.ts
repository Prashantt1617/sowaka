/**
 * Secret Squad's rules, as pure functions over a session (docs/secret-squad.md).
 *
 * Nothing here reads a clock, a database or a socket: the service passes
 * `now` and a random source in, and stores what comes back. That keeps every
 * rule testable on its own, and lets any API instance move a session on.
 */
import { createHash, randomUUID } from 'node:crypto';
import type {
  SquadNoticeKind,
  SquadPlayer,
  SquadRoundConfig,
  SquadRoundState,
  SquadScanResult,
  SquadSession,
  SquadTeam,
} from '../models/secret-squad.model';
import type { SquadCategory } from './secret-squad-packs';

export const SQUAD = {
  /** The word reveal: "Hunt starts in" counts down this long. */
  dealMs: 10_000,
  /** Each player's QR changes this often. The current and the previous one scan. */
  codeWindowMs: 20_000,
  /** Offline this long in the hunt: away. */
  awayMs: 60_000,
  minPlayers: 4,
  minSquadSize: 2,
  /** No category has more than 10 words: a bigger squad could not each get a different one. */
  maxSquadSize: 10,
  /**
   * Scan only (the handoff): a typed `{ code }` check is refused. Set true to
   * bring typed codes back (the page then also shows `me.code`).
   */
  typedCodes: false,
  points: {
    /** A right scan, to both players. */
    right: 100,
    /** A wrong scan, to both players. */
    wrong: -25,
    /** Every member of a complete squad, for a squad of the round's standard size. */
    squadBonus: 200,
    /** Added per member a squad is short of the standard size (taken off per member over). */
    perMissing: 100,
    /** Each member of a squad that completes also gets this per second left on the round clock (rounded down). */
    timeBonusPerSecond: 0.5,
  },
  /** A finished session stays readable this long, for late results screens. */
  keepAfterMs: 2 * 60 * 60_000,
  /** The office top list in breaks. */
  topCount: 5,
  defaults: {
    lobbyMs: 5 * 60_000,
    huntMs: 8 * 60_000,
    breakMs: 60_000,
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

const nameKey = (name: string) => name.trim().toLowerCase();

/** The squad bonus for a squad of `size` in a round whose standard size is `standard`. */
export const bonusFor = (size: number, standard: number) =>
  Math.max(0, SQUAD.points.squadBonus + SQUAD.points.perMissing * (standard - size));

/**
 * Squad sizes for `n` players aiming at `target` per squad: as even as
 * possible (sizes differ by at most one), at least 2 squads, at least 2 each, at most `maxSize`
 * each, and at most `maxSquads` squads. Players who don't fit at all (more
 * than maxSquads × maxSize) are left out: the sizes then sum to less than n.
 */
export function squadSizes(
  n: number,
  target: number,
  maxSquads = Number.POSITIVE_INFINITY,
  maxSize: number = SQUAD.maxSquadSize,
): number[] {
  if (n < 2) return [];
  // At least two squads: with one, nobody could scan wrong.
  let k = Math.max(2, Math.round(n / Math.max(SQUAD.minSquadSize, target)));
  // Never a squad bigger than a category has words for.
  k = Math.max(k, Math.ceil(n / maxSize));
  k = Math.min(k, Math.floor(n / 2), Math.max(1, maxSquads));
  const dealt = Math.min(n, k * maxSize);
  const base = Math.floor(dealt / k);
  const extra = dealt % k;
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
    delete existing.left;
    return existing;
  }
  const seat = session.nextSeat ?? seatsUsed(session);
  if (seat >= CODE_SPACE) throw new SquadRuleError(409, 'This lobby is full.');
  session.nextSeat = seat + 1;
  const player: SquadPlayer = {
    seat,
    userId: profile.userId,
    name: profile.name,
    initials: profile.initials,
    photoKey: profile.photoKey,
    department: profile.department,
    joinedAt: now,
    online: true,
    playing: false,
    away: false,
  };
  session.players.push(player);
  return player;
}

/**
 * Leaves the session. Before anything is dealt the player simply goes; once
 * they have been in a round they stay on the list marked as left, because
 * that round's squad (and its results) still name them. In the hunt, closing
 * the page is what "away" is for.
 */
export function leaveSession(session: SquadSession, userId: string): void {
  const player = playerOf(session, userId);
  if (!player) return;
  if (session.status !== 'lobby' && session.status !== 'break' && player.playing) {
    throw new SquadRuleError(409, 'You can leave between rounds.');
  }
  const dealtBefore = player.squad !== undefined
    || session.history.some((round) => round.squads.some((squad) => squad.members.includes(userId)));
  if (session.status === 'lobby' && !dealtBefore) {
    session.players = session.players.filter((item) => item.userId !== userId);
    return;
  }
  player.left = true;
  player.online = false;
  player.offlineAt = player.offlineAt ?? 0;
}

/** Seats for a session written before seats existed: their place in the list. */
function seatsUsed(session: SquadSession): number {
  return session.players.reduce((max, player, i) => Math.max(max, (player.seat ?? i) + 1), 0);
}

const seatOf = (session: SquadSession, player: SquadPlayer) =>
  player.seat ?? session.players.indexOf(player);

/** Who a round would deal: everyone joined and online, or only just offline. */
export function eligiblePlayers(session: SquadSession, now: number): SquadPlayer[] {
  return session.players.filter(
    (player) => !player.left
      && (player.online || (player.offlineAt !== undefined && now - player.offlineAt < SQUAD.awayMs)),
  );
}

const nextRoundIndex = (session: SquadSession) => (session.status === 'lobby' ? 0 : session.roundIndex + 1);

// --------------------------------------------------------------- categories

/**
 * The categories a round may use, best first:
 *  1. the round's own list (`config.categories`), in its order;
 *  2. then the rest of the bank, in bank order (families sit together there),
 *     those no round of this session plays first, then those a LATER round
 *     plans to use, and last those an EARLIER round already used.
 * The deal takes from the front, so a plan with enough categories is used
 * exactly as written and the fallback only fills a shortfall.
 */
export function rankedCategories(session: SquadSession, index: number, bank: SquadCategory[]): SquadCategory[] {
  const byName = new Map(bank.map((entry) => [nameKey(entry.category), entry]));
  const planned: SquadCategory[] = [];
  for (const name of configFor(session, index).categories ?? []) {
    const entry = byName.get(nameKey(name));
    if (entry && !planned.includes(entry)) planned.push(entry);
  }
  const earlier = new Set(
    [...session.history, ...(session.round ? [session.round] : [])]
      .filter((round) => round.index < index)
      .flatMap((round) => round.squads.map((squad) => nameKey(squad.category))),
  );
  const later = new Set(
    session.rounds.slice(index + 1).flatMap((config) => (config.categories ?? []).map(nameKey)),
  );
  const rank = (entry: SquadCategory) =>
    (earlier.has(nameKey(entry.category)) ? 2 : later.has(nameKey(entry.category)) ? 1 : 0);
  const rest = bank
    .map((entry, order) => ({ entry, order }))
    .filter(({ entry }) => !planned.includes(entry))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || a.order - b.order)
    .map(({ entry }) => entry);
  return [...planned, ...rest].filter((entry) => entry.words.length >= SQUAD.minSquadSize);
}

/**
 * One category for each squad size (largest squads first), from `ranked` in
 * order, each with at least as many words as its squad. Returns them aligned
 * with `sizes`; a squad no category is big enough for gets the largest left
 * and is cut to its word count (`sizes` is changed in place).
 */
export function chooseCategories(sizes: number[], ranked: SquadCategory[]): SquadCategory[] {
  const out: SquadCategory[] = new Array(sizes.length);
  const left = [...ranked];
  const order = sizes.map((size, i) => ({ size, i })).sort((a, b) => b.size - a.size || a.i - b.i);
  for (const { size, i } of order) {
    let at = left.findIndex((entry) => entry.words.length >= size);
    if (at < 0) {
      at = left.reduce((best, entry, j) => (entry.words.length > left[best].words.length ? j : best), 0);
      sizes[i] = Math.min(size, left[at]?.words.length ?? 0);
    }
    out[i] = left[at];
    left.splice(at, 1);
  }
  return out;
}

// ------------------------------------------------------------------- squads

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** How many earlier rounds of this session each two players shared a squad in. */
export function metCounts(session: SquadSession): Map<string, number> {
  const met = new Map<string, number>();
  for (const round of [...session.history, ...(session.round ? [session.round] : [])]) {
    for (const squad of round.squads) {
      for (let i = 0; i < squad.members.length; i += 1) {
        for (let j = i + 1; j < squad.members.length; j += 1) {
          const key = pairKey(squad.members[i], squad.members[j]);
          met.set(key, (met.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return met;
}

/** A repeat pairing costs this much more than two people from one department. */
const REPEAT_COST = 1000;

/**
 * Splits `players` into squads of `sizes`, avoiding repeat partners first and
 * same-department squadmates second (docs/secret-squad.md, "Squads"):
 *
 *  - cost of two people together = 1000 × the rounds they've already shared,
 *    + 1 if they're in the same department;
 *  - greedy: the most-met players first (shuffled otherwise), each into the
 *    open squad where they add the least cost (emptier squads, then random,
 *    on a tie);
 *  - then swaps: any two players in different squads trade places while that
 *    lowers the total, until no swap helps;
 *  - several random restarts (more for small offices), keeping the cheapest;
 *    stops early once no pair repeats.
 */
export function formSquads(
  players: Array<Pick<SquadPlayer, 'userId' | 'department'>>,
  sizes: number[],
  met: Map<string, number>,
  random: Random,
): string[][] {
  const n = players.length;
  const k = sizes.length;
  if (k === 0) return [];
  const dept = players.map((player) => player.department?.trim().toLowerCase() || '');
  const cost = new Float64Array(n * n);
  const metBy = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const times = met.get(pairKey(players[i].userId, players[j].userId)) ?? 0;
      const c = times * REPEAT_COST + (dept[i] && dept[i] === dept[j] ? 1 : 0);
      cost[i * n + j] = c;
      cost[j * n + i] = c;
      metBy[i] += times;
      metBy[j] += times;
    }
  }
  const attempts = n <= 30 ? 60 : n <= 60 ? 12 : n <= 120 ? 4 : 2;
  let best: number[][] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const order = shuffle(Array.from({ length: n }, (_, i) => i), random).sort((a, b) => metBy[b] - metBy[a]);
    const squads: number[][] = sizes.map(() => []);
    for (const p of order) {
      let pick = -1;
      let pickCost = Number.POSITIVE_INFINITY;
      let pickTie = 0;
      for (let s = 0; s < k; s += 1) {
        if (squads[s].length >= sizes[s]) continue;
        let c = 0;
        for (const q of squads[s]) c += cost[p * n + q];
        // Fill emptier squads first on a tie, then at random.
        const tie = squads[s].length + random() * 0.5;
        if (c < pickCost || (c === pickCost && tie < pickTie)) {
          pick = s;
          pickCost = c;
          pickTie = tie;
        }
      }
      if (pick < 0) break; // more players than places: the rest sit out
      squads[pick].push(p);
    }
    // Swaps until nothing improves.
    const where = new Int32Array(n).fill(-1);
    squads.forEach((members, s) => members.forEach((p) => { where[p] = s; }));
    const placed = squads.flat();
    const with_ = (p: number, s: number, except: number) => {
      let c = 0;
      for (const q of squads[s]) if (q !== p && q !== except) c += cost[p * n + q];
      return c;
    };
    for (let pass = 0; pass < 40; pass += 1) {
      let improved = false;
      for (let x = 0; x < placed.length; x += 1) {
        for (let y = x + 1; y < placed.length; y += 1) {
          const p = placed[x];
          const q = placed[y];
          const a = where[p];
          const b = where[q];
          if (a === b) continue;
          const delta = with_(p, b, q) + with_(q, a, p) - with_(p, a, p) - with_(q, b, q);
          if (delta < -1e-9) {
            squads[a][squads[a].indexOf(p)] = q;
            squads[b][squads[b].indexOf(q)] = p;
            where[p] = b;
            where[q] = a;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    let total = 0;
    for (const members of squads) {
      for (let i = 0; i < members.length; i += 1) {
        for (let j = i + 1; j < members.length; j += 1) total += cost[members[i] * n + members[j]];
      }
    }
    if (total < bestCost) {
      bestCost = total;
      best = squads.map((members) => [...members]);
    }
    if (bestCost < REPEAT_COST && n > 30) break;
    if (bestCost === 0) break;
  }
  return (best ?? []).map((members) => members.map((i) => players[i].userId));
}

function emptyRound(index: number, now: number, huntMs: number): SquadRoundState {
  return {
    index,
    dealtAt: now,
    huntStartsAt: now + SQUAD.dealMs,
    endsAt: now + SQUAD.dealMs + huntMs,
    squads: [],
    edges: [],
    scans: {},
    completions: {},
    notices: {},
    missesAgainst: {},
    points: {},
  };
}

/**
 * Deals the next round from everyone in the lobby: squad sizes as even as
 * possible around the round's size, people who've been together before kept
 * apart, one category per squad (`rankedCategories`), each member the
 * category's next word in its listed order. Too few players skips the round.
 */
export function dealRound(session: SquadSession, now: number, bank: SquadCategory[], random: Random): void {
  const index = nextRoundIndex(session);
  const config = configFor(session, index);
  const ranked = rankedCategories(session, index, bank);
  const met = metCounts(session);
  if (session.round) session.history.push(session.round);
  session.roundIndex = index;
  const round = emptyRound(index, now, config.huntMs);
  session.round = round;
  for (const player of session.players) {
    player.playing = false;
    player.away = false;
    delete player.squad;
    delete player.word;
  }

  const eligible = eligiblePlayers(session, now);
  const biggest = Math.max(0, ...ranked.map((entry) => entry.words.length));
  const sizes = eligible.length >= SQUAD.minPlayers
    ? squadSizes(eligible.length, config.squadSize, ranked.length, Math.min(SQUAD.maxSquadSize, biggest))
    : [];
  if (sizes.length === 0) {
    round.skipped = true;
    round.overAt = now;
    endPhaseAfterRound(session, now);
    return;
  }
  const categories = chooseCategories(sizes, ranked);
  const members = formSquads(eligible, sizes, met, random);
  round.squads = members.map((ids, squadIndex): SquadTeam => {
    const category = categories[squadIndex];
    const dealt = shuffle(ids, random).slice(0, Math.min(ids.length, category.words.length));
    const words = category.words.slice(0, dealt.length);
    dealt.forEach((id, i) => {
      const player = playerOf(session, id)!;
      player.playing = true;
      player.squad = squadIndex;
      player.word = words[i];
      round.points[id] = 0;
    });
    return { category: category.category, words, members: dealt, bonus: bonusFor(dealt.length, config.squadSize) };
  });
  session.status = 'dealing';
  session.phaseEndsAt = round.huntStartsAt;
}

// -------------------------------------------------------------------- codes

const permutations = new Map<string, Uint16Array>();

/**
 * Codes come from 0000–9999 split in two halves: even windows use 0000–4999,
 * odd ones 5000–9999. Within a window every seat gets a different code, and
 * a code read just before it changed (the previous window, the other half)
 * can never be someone else's current code.
 */
const CODE_SPACE = 5_000;

/** A shuffle of the half's codes for one window of one round. */
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
  const values = new Uint16Array(CODE_SPACE);
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

const codeIn = (session: SquadSession, roundIndex: number, window: number, seat: number) =>
  (window % 2) * CODE_SPACE + permutationFor(session.codeSeed, roundIndex, window)[seat];

/** A player's current code and when it changes, or null if their QR is off (not hunting, away, or squad complete). */
export function codeFor(session: SquadSession, userId: string, now: number): { code: string; expiresAt: number } | null {
  return codeOfPlayer(session, playerOf(session, userId), now);
}

/** `codeFor` for a player already in hand (a view of every phone must not look each one up again). */
function codeOfPlayer(session: SquadSession, player: SquadPlayer | undefined, now: number): { code: string; expiresAt: number } | null {
  const round = session.round;
  if (!round || session.status !== 'hunt') return null;
  if (!player?.playing || player.away || player.left || player.squad === undefined) return null;
  if (round.squads[player.squad]?.finishedAt) return null;
  const seat = seatOf(session, player);
  if (seat < 0 || seat >= CODE_SPACE) return null;
  const window = codeWindowOf(now);
  return { code: String(codeIn(session, round.index, window, seat)).padStart(4, '0'), expiresAt: (window + 1) * SQUAD.codeWindowMs };
}

/** Whose seat `code` is in this window or the previous one, whatever their state. */
function seatHolderOf(session: SquadSession, code: string, now: number): SquadPlayer | null {
  const round = session.round;
  if (!round || !/^\d{4}$/.test(code)) return null;
  const value = Number(code);
  const window = codeWindowOf(now);
  for (const w of [window, window - 1]) {
    // Each window owns one half: a code is only ever looked for in its own.
    if (Math.floor(value / CODE_SPACE) !== w % 2) continue;
    const seat = permutationFor(session.codeSeed, round.index, w).indexOf(value - (w % 2) * CODE_SPACE);
    if (seat < 0) continue;
    const holder = session.players.find((player) => seatOf(session, player) === seat);
    if (holder) return holder;
  }
  return null;
}

/** Who holds `code` now, or held it in the previous window (a code read just as it changed), with their QR on. */
export function holderOf(session: SquadSession, code: string, now: number): string | null {
  const holder = seatHolderOf(session, code, now);
  if (!holder) return null;
  const window = codeWindowOf(now);
  for (const w of [window, window - 1]) {
    const current = codeFor(session, holder.userId, w * SQUAD.codeWindowMs);
    if (current?.code === code) return holder.userId;
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

/** Everyone linked with `userId` this round, directly or through the chain (themselves included). */
export function linkedWith(session: SquadSession, userId: string): string[] {
  const player = playerOf(session, userId);
  const round = session.round;
  if (!round || player?.squad === undefined || !round.squads[player.squad]) return [userId];
  const groups = groupsIn(round, player.squad);
  const mine = groups.get(userId);
  return round.squads[player.squad].members.filter((id) => groups.get(id) === mine);
}

function largestGroup(round: SquadRoundState, squadIndex: number): number {
  const counts = new Map<string, number>();
  for (const root of groupsIn(round, squadIndex).values()) counts.set(root, (counts.get(root) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

const presentMembers = (
  session: SquadSession,
  squadIndex: number,
  lookup: (id: string) => SquadPlayer | undefined = (id) => playerOf(session, id),
) => session.round!.squads[squadIndex].members.filter((id) => !lookup(id)?.away);

/** Looks players up by id in one pass over the list (the first with an id wins, as `playerOf` finds it). */
function playerIndex(session: SquadSession): Map<string, SquadPlayer> {
  const byId = new Map<string, SquadPlayer>();
  for (const player of session.players) if (!byId.has(player.userId)) byId.set(player.userId, player);
  return byId;
}

/** Adds points to a player's session total and this round's net. */
function credit(session: SquadSession, userId: string, delta: number): { before: number; after: number } {
  const before = session.totals[userId] ?? 0;
  const after = before + delta;
  session.totals[userId] = after;
  const round = session.round!;
  round.points[userId] = (round.points[userId] ?? 0) + delta;
  return { before, after };
}

/** The time bonus for completing at `now`: floor(seconds left on the round clock × 0.5). */
export const timeBonusAt = (round: Pick<SquadRoundState, 'endsAt'>, now: number) => {
  const secondsLeft = Math.max(0, Math.floor((round.endsAt - now) / 1000));
  return { secondsLeft, timeBonus: Math.floor(secondsLeft * SQUAD.points.timeBonusPerSecond) };
};

/**
 * Marks a squad complete once every member still in the game is in one linked
 * group, and pays everyone in that group (an away member who was linked in
 * counts; one who wasn't, doesn't) the squad bonus plus the time bonus.
 * True if it just completed.
 */
function settleSquad(session: SquadSession, squadIndex: number, now: number): boolean {
  const round = session.round!;
  const squad = round.squads[squadIndex];
  if (squad.finishedAt) return false;
  const present = presentMembers(session, squadIndex);
  if (present.length < 2) {
    if (present.length === 1) notify(round, [present[0]], 'squad_left', present[0], now);
    return false;
  }
  const groups = groupsIn(round, squadIndex);
  const root = groups.get(present[0]);
  if (!present.every((id) => groups.get(id) === root)) return false;
  squad.finishedAt = now;
  squad.place = round.squads.filter((item) => item.finishedAt).length;
  const { secondsLeft, timeBonus } = timeBonusAt(round, now);
  squad.timeBonus = timeBonus;
  for (const id of squad.members.filter((member) => groups.get(member) === root)) {
    const { before, after } = credit(session, id, squad.bonus + timeBonus);
    round.completions[id] = { at: now, bonus: squad.bonus, timeBonus, secondsLeft, before, after };
  }
  return true;
}

function notify(round: SquadRoundState, to: string[], kind: SquadNoticeKind, about: string, now: number): void {
  for (const id of to) {
    const last = round.notices[id];
    if (last && last.kind === kind && last.userId === about) continue;
    round.notices[id] = { kind, userId: about, at: now };
  }
}

// -------------------------------------------------------------------- scans

function requireHunter(session: SquadSession, userId: string): SquadPlayer {
  if (session.status !== 'hunt' || !session.round) throw new SquadRuleError(409, 'Scanning opens when the hunt starts.');
  const player = playerOf(session, userId);
  if (!player?.playing || player.squad === undefined) throw new SquadRuleError(403, "You're not in this round. You'll play the next one.");
  if (player.away) throw new SquadRuleError(409, 'Reconnecting… try again in a moment.');
  return player;
}

export interface ScanOutcome {
  result: SquadScanResult;
  /** What this scan moved for each of the two players (+100, −25 or 0). */
  delta: number;
  /** The scanner's session total after it (the bonus included, if it completed the squad). */
  total: number;
  otherName: string;
  otherWord: string | null;
  /** It completed the squad. */
  completed: boolean;
}

/**
 * One player scans another's QR, and it resolves at once for both phones:
 *  - already linked (directly or through the chain): nothing changes, 0 points;
 *  - same squad: linked, +100 each; the squad may complete (squad bonus +
 *    time bonus to each member);
 *  - different squads: −25 each. Nothing is locked or paused, ever.
 * A complete squad's QRs don't scan, and its members can't scan.
 */
export function scan(
  session: SquadSession,
  fromId: string,
  input: { code?: string; qr?: string },
  now: number,
): ScanOutcome {
  const from = requireHunter(session, fromId);
  const round = session.round!;
  if (round.squads[from.squad!].finishedAt) throw new SquadRuleError(409, 'Your squad is complete. Your QR and scanner are off for the rest of the round.');

  let code: string | null;
  if (input.qr !== undefined) {
    code = codeFromQr(session, String(input.qr));
    if (!code) throw new SquadRuleError(404, "That QR isn't from this round of Secret Squad.");
  } else {
    if (!SQUAD.typedCodes) throw new SquadRuleError(400, 'Scan their QR code.');
    code = String(input.code ?? '').trim();
    if (!/^\d{4}$/.test(code)) throw new SquadRuleError(400, 'Codes are 4 digits.');
  }
  const to = seatHolderOf(session, code, now);
  if (!to || !to.playing || to.left || to.squad === undefined) {
    throw new SquadRuleError(404, 'That QR has expired. Scan it again: it changes every 20 seconds.');
  }
  if (to.userId === fromId) throw new SquadRuleError(400, "That's your own QR.");
  if (round.squads[to.squad].finishedAt) throw new SquadRuleError(409, `${to.name}'s squad is complete: their QR has stopped working.`);
  if (to.away || holderOf(session, code, now) !== to.userId) {
    throw new SquadRuleError(404, 'That QR has expired. Scan it again: it changes every 20 seconds.');
  }

  const event = (userId: string, result: SquadScanResult, role: 'scanner' | 'scanned', otherId: string, delta: number, before: number, after: number) => {
    round.scans[userId] = { id: randomUUID(), result, role, otherId, delta, before, after, completed: false, at: now };
  };
  const outcome = (result: SquadScanResult, delta: number, completed: boolean): ScanOutcome => ({
    result,
    delta,
    total: session.totals[fromId] ?? 0,
    otherName: to.name,
    otherWord: to.word ?? null,
    completed,
  });

  if (linkedWith(session, fromId).includes(to.userId)) {
    const total = session.totals[fromId] ?? 0;
    event(fromId, 'already', 'scanner', to.userId, 0, total, total);
    return outcome('already', 0, false);
  }

  if (from.squad === to.squad) {
    round.edges.push({ a: from.userId, b: to.userId, at: now });
    const mine = credit(session, from.userId, SQUAD.points.right);
    const theirs = credit(session, to.userId, SQUAD.points.right);
    event(from.userId, 'right', 'scanner', to.userId, SQUAD.points.right, mine.before, mine.after);
    event(to.userId, 'right', 'scanned', from.userId, SQUAD.points.right, theirs.before, theirs.after);
    const completed = settleSquad(session, from.squad!, now);
    if (completed) {
      round.scans[from.userId].completed = true;
      round.scans[to.userId].completed = true;
    }
    maybeEndRound(session, now);
    return outcome('right', SQUAD.points.right, completed);
  }

  const mine = credit(session, from.userId, SQUAD.points.wrong);
  const theirs = credit(session, to.userId, SQUAD.points.wrong);
  event(from.userId, 'wrong', 'scanner', to.userId, SQUAD.points.wrong, mine.before, mine.after);
  event(to.userId, 'wrong', 'scanned', from.userId, SQUAD.points.wrong, theirs.before, theirs.after);
  round.missesAgainst[to.userId] = (round.missesAgainst[to.userId] ?? 0) + 1;
  return outcome('wrong', SQUAD.points.wrong, false);
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
  // Back, but unlinked: their squad scans them back in (their points stay).
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
  | { kind: 'deal' } // the service calls dealRound
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
  for (const player of session.players) {
    if (!player.playing || player.away || player.online || player.offlineAt === undefined) continue;
    if (now - player.offlineAt < SQUAD.awayMs) continue;
    player.away = true;
    changed = true;
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

/** Ends the round at 0:00, or once every squad is complete (or can't be: one member left). */
function maybeEndRound(session: SquadSession, now: number): boolean {
  const round = session.round!;
  if (session.status !== 'hunt') return false;
  const byId = playerIndex(session);
  const open = round.squads.some(
    (squad, index) => !squad.finishedAt && presentMembers(session, index, (id) => byId.get(id)).length >= 2,
  );
  if (now < round.endsAt && open) return false;
  round.overAt = now;
  placeSquads(round);
  endPhaseAfterRound(session, now);
  return true;
}

/** Places the unfinished squads after the complete ones, by their largest linked group. */
function placeSquads(round: SquadRoundState): void {
  const finishedCount = round.squads.filter((squad) => squad.finishedAt).length;
  round.squads
    .map((squad, index) => ({ squad, size: largestGroup(round, index) }))
    .filter((entry) => !entry.squad.finishedAt)
    .sort((x, y) => y.size - x.size)
    .forEach((entry, i) => { entry.squad.place = finishedCount + i + 1; });
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
}

/** Every round played or being played, oldest first. */
export const roundsOf = (session: SquadSession): SquadRoundState[] =>
  [...session.history, ...(session.round ? [session.round] : [])];

// ---------------------------------------------------------------- standings

export interface SquadStanding {
  userId: string;
  name: string;
  initials: string;
  photoUrl: string | null;
  points: number;
  rank: number;
}

/**
 * Everyone dealt into a round (someone who only sat in the lobby did not
 * play), most points first (points can be below 0), then by name; ranked
 * 1, 2, 2, 4 on a tie.
 */
export function standingsOf(session: SquadSession, photoUrl: (player: SquadPlayer) => string | null = () => null): SquadStanding[] {
  const dealt = new Set(roundsOf(session).flatMap((round) => round.squads.flatMap((squad) => squad.members)));
  const rows = session.players
    .filter((player) => dealt.has(player.userId))
    .map((player) => ({
      userId: player.userId,
      name: player.name,
      initials: player.initials,
      photoUrl: photoUrl(player),
      points: session.totals[player.userId] ?? 0,
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  let rank = 0;
  return rows.map((row, index) => {
    if (index === 0 || rows[index - 1].points !== row.points) rank = index + 1;
    return { ...row, rank };
  });
}

// -------------------------------------------------------------------- views

export interface SquadViewOptions {
  photoUrl?: (player: SquadPlayer) => string | null;
}

type Photo = (player: SquadPlayer) => string | null;
type Short = { userId: string; name: string; initials: string };
type Person = Short & { photoUrl: string | null; word: string | null };

/**
 * What every view of one push shares, worked out once per push and not once
 * per phone (a big office has hundreds): the player index, each squad's
 * linked groups, the board, the standings, and every office-wide part of
 * the view. Built for one session object, read-only, and only as far as the
 * views ask (the standings, say, only once a round has results).
 */
export class SquadViewContext {
  readonly byId: Map<string, SquadPlayer>;
  private standingsMemo?: SquadStanding[];
  private rankMemo?: Map<string, SquadStanding>;
  private readonly groupsMemo = new Map<SquadRoundState, Map<number, Map<string, string>>>();
  private readonly presentMemo = new Map<number, string[]>();
  private readonly largestMemo = new Map<number, number>();
  private readonly personMemo = new Map<string, Person | null>();
  private sharedMemo?: ReturnType<SquadViewContext['buildShared']>;
  private lastSquadMemo?: Map<string, { round: SquadRoundState; index: number }>;

  /** A player's face for this context's options (null without one). */
  readonly photo: Photo;

  constructor(readonly session: SquadSession, readonly options: SquadViewOptions = {}) {
    this.byId = playerIndex(session);
    this.photo = (player) => options.photoUrl?.(player) ?? null;
  }

  get standings(): SquadStanding[] {
    return (this.standingsMemo ??= standingsOf(this.session, this.options.photoUrl));
  }

  get rankOf(): Map<string, SquadStanding> {
    return (this.rankMemo ??= new Map(this.standings.map((row) => [row.userId, row])));
  }

  player(id: string): SquadPlayer | undefined {
    return this.byId.get(id);
  }

  /** `groupsIn`, once per squad. */
  groups(round: SquadRoundState, squadIndex: number): Map<string, string> {
    let byRound = this.groupsMemo.get(round);
    if (!byRound) this.groupsMemo.set(round, (byRound = new Map()));
    let groups = byRound.get(squadIndex);
    if (!groups) byRound.set(squadIndex, (groups = groupsIn(round, squadIndex)));
    return groups;
  }

  /** `presentMembers` of the current round, once per squad. */
  present(squadIndex: number): string[] {
    let present = this.presentMemo.get(squadIndex);
    if (!present) this.presentMemo.set(squadIndex, (present = presentMembers(this.session, squadIndex, (id) => this.byId.get(id))));
    return present;
  }

  /** `largestGroup` of the current round, once per squad. */
  largest(round: SquadRoundState, squadIndex: number): number {
    if (round !== this.session.round) return largestGroup(round, squadIndex);
    let size = this.largestMemo.get(squadIndex);
    if (size === undefined) {
      const counts = new Map<string, number>();
      for (const root of this.groups(round, squadIndex).values()) counts.set(root, (counts.get(root) ?? 0) + 1);
      this.largestMemo.set(squadIndex, (size = Math.max(0, ...counts.values())));
    }
    return size;
  }

  /** A player as a squad shows them: who, their face and their word. */
  person(id: string): Person | null {
    let person = this.personMemo.get(id);
    if (person === undefined) {
      const player = this.byId.get(id);
      person = player ? { ...short(player), photoUrl: this.photo(player), word: player.word ?? null } : null;
      this.personMemo.set(id, person);
    }
    return person;
  }

  /** The latest round each player was dealt into, and their squad in it. */
  lastSquadOf(userId: string): { round: SquadRoundState; index: number } | undefined {
    if (!this.lastSquadMemo) {
      const memo = new Map<string, { round: SquadRoundState; index: number }>();
      for (const round of roundsOf(this.session).reverse()) {
        round.squads.forEach((squad, index) => {
          for (const id of squad.members) if (!memo.has(id)) memo.set(id, { round, index });
        });
      }
      this.lastSquadMemo = memo;
    }
    return this.lastSquadMemo.get(userId);
  }

  /** The parts of the view that are the same on every phone in the office. */
  shared() {
    return (this.sharedMemo ??= this.buildShared());
  }

  private buildShared() {
    const photo = this.photo;
    const session = this.session;
    const round = session.round;
    const status = session.status;
    return {
      rounds: session.rounds.map((config) => ({ squadSize: config.squadSize, huntMs: config.huntMs, breakMs: config.breakMs })),
      rules: rulesView(),
      clock: {
        lobbyEndsAt: status === 'lobby' ? session.startsAt : null,
        revealEndsAt: status === 'dealing' && round ? round.huntStartsAt : null,
        huntEndsAt: status === 'hunt' && round ? round.endsAt : null,
        breakEndsAt: status === 'break' ? session.phaseEndsAt : null,
      },
      players: status === 'lobby'
        ? session.players.filter((player) => !player.left).length
        : session.players.filter((player) => player.playing).length,
      faces: status === 'lobby'
        ? session.players.slice(-12).reverse().map((player) => ({ ...short(player), photoUrl: photo(player) }))
        : [],
      board: round
        ? {
          squads: round.squads.length,
          complete: round.squads.filter((squad) => squad.finishedAt).length,
          hunting: round.squads.filter((squad, i) => !squad.finishedAt && this.present(i).length >= 2).length,
          stuck: round.squads.filter((squad, i) => !squad.finishedAt && this.present(i).length < 2).length,
        }
        : null,
      results: round ? this.sharedResults(round) : null,
    };
  }

  /** A round's results as everyone sees them; built only once the round has ended. */
  private sharedResults(round: SquadRoundState) {
    let memo: { top: SquadStanding[]; squads: Array<{ index: number; row: Record<string, unknown> }>; trickiest: { word: string; scans: number } | null } | undefined;
    return () => {
      if (memo) return memo;
      const [trickiestId, scans] = Object.entries(round.missesAgainst).sort((a, b) => b[1] - a[1])[0] ?? [];
      memo = {
        top: this.standings.slice(0, SQUAD.topCount),
        squads: round.squads
          .map((squad, index) => ({
            index,
            row: {
              place: squad.place ?? 0,
              category: squad.category,
              words: squad.words,
              size: squad.members.length,
              linked: this.largest(round, index),
              complete: Boolean(squad.finishedAt),
              finishedAt: squad.finishedAt ?? null,
            },
          }))
          .sort((a, b) => (a.row.place as number) - (b.row.place as number)),
        trickiest: trickiestId ? { word: this.byId.get(trickiestId)?.word ?? '', scans } : null,
      };
      return memo;
    };
  }
}

export function viewContext(session: SquadSession, options: SquadViewOptions = {}): SquadViewContext {
  return new SquadViewContext(session, options);
}

/** The rules a page shows ("+100 / −25", the squad bonus, the time bonus). */
export const rulesView = () => ({
  right: SQUAD.points.right,
  wrong: SQUAD.points.wrong,
  squadBonus: SQUAD.points.squadBonus,
  perMissing: SQUAD.points.perMissing,
  timeBonusPerSecond: SQUAD.points.timeBonusPerSecond,
  dealMs: SQUAD.dealMs,
  qrWindowMs: SQUAD.codeWindowMs,
  awayMs: SQUAD.awayMs,
  typedCodes: SQUAD.typedCodes,
});

/**
 * What one person sees: the per-player `session` part of `squad:state`.
 * Office-wide parts come from `context` (pass one per push, so they are
 * worked out once for every phone); the objects in them are shared between
 * views, so a view is for sending, not for changing.
 */
export function sessionViewFor(
  session: SquadSession,
  userId: string,
  now: number,
  options: SquadViewOptions = {},
  context?: SquadViewContext,
) {
  // A context is for one session object and one set of options.
  const ctx = context && context.session === session && context.options.photoUrl === options.photoUrl
    ? context
    : viewContext(session, options);
  const me = ctx.player(userId);
  const round = session.round;
  const photo = ctx.photo;
  const shared = ctx.shared();
  const status = session.status;
  return {
    id: session.id,
    status,
    lobbyOpensAt: session.lobbyOpensAt,
    startsAt: session.startsAt,
    phaseEndsAt: session.phaseEndsAt,
    roundIndex: session.roundIndex,
    roundNumber: session.roundIndex + 1,
    roundCount: session.rounds.length,
    rounds: shared.rounds,
    rules: shared.rules,
    clock: shared.clock,
    joined: Boolean(me) && !me?.left,
    playing: Boolean(me?.playing) && Boolean(round) && !round?.skipped,
    players: shared.players,
    faces: shared.faces,
    totalPoints: me ? session.totals[userId] ?? 0 : 0,
    cancelReason: session.cancelReason ?? null,
    round: round ? roundViewFor(session, round, me, now, photo, ctx, shared) : null,
    final: status === 'over' ? finalViewFor(session, me, photo, ctx) : null,
  };
}

export type SquadSessionView = ReturnType<typeof sessionViewFor>;

const short = (player: SquadPlayer): Short => ({ userId: player.userId, name: player.name, initials: player.initials });

function roundViewFor(
  session: SquadSession,
  round: SquadRoundState,
  me: SquadPlayer | undefined,
  now: number,
  photo: Photo,
  ctx: SquadViewContext,
  shared: ReturnType<SquadViewContext['shared']>,
) {
  const done = session.status === 'break' || session.status === 'over' || Boolean(round.overAt);
  const config = configFor(session, round.index);
  const view = {
    index: round.index,
    number: round.index + 1,
    squadSize: config.squadSize,
    skipped: Boolean(round.skipped),
    dealtAt: round.dealtAt,
    huntStartsAt: round.huntStartsAt,
    endsAt: round.endsAt,
    overAt: round.overAt ?? null,
    board: shared.board!,
    me: null as null | Record<string, unknown>,
    squad: null as null | Record<string, unknown>,
    scan: null as null | Record<string, unknown>,
    notice: null as null | Record<string, unknown>,
    results: null as null | Record<string, unknown>,
  };
  const dealtMe = me?.playing && me.squad !== undefined && !round.skipped && round.squads[me.squad] ? me : undefined;
  if (done) view.results = resultsFor(session, round, dealtMe, photo, ctx, shared.results!());
  if (!dealtMe) return view;

  const squad = round.squads[dealtMe.squad!];
  const code = codeOfPlayer(session, dealtMe, now);
  view.me = {
    word: dealtMe.word ?? null,
    qr: code ? qrFor(session, code.code) : null,
    qrExpiresAt: code?.expiresAt ?? null,
    code: code && SQUAD.typedCodes ? code.code : null,
    away: dealtMe.away,
    roundPoints: round.points[dealtMe.userId] ?? 0,
  };
  // linkedWith, from the squad's groups worked out once for the push.
  const groups = ctx.groups(round, dealtMe.squad!);
  const mine = groups.get(dealtMe.userId);
  const linkedIds = squad.members.filter((id) => groups.get(id) === mine);
  const members = linkedIds.flatMap((id) => {
    const p = ctx.person(id);
    const player = ctx.player(id);
    return p ? [{ ...p, me: id === dealtMe.userId, away: Boolean(player?.away || player?.left) }] : [];
  });
  const awayMembers = squad.members
    .filter((id) => !linkedIds.includes(id) && ctx.player(id)?.away)
    .flatMap((id) => {
      const p = ctx.person(id);
      return p ? [p] : [];
    });
  const needed = ctx.present(dealtMe.squad!).length;
  const linkedPresent = linkedIds.filter((id) => !ctx.player(id)?.away).length;
  const completion = round.completions[dealtMe.userId];
  const reveal = Boolean(squad.finishedAt) || done;
  view.squad = {
    size: squad.members.length,
    bonus: squad.bonus,
    needed,
    more: squad.finishedAt ? 0 : Math.max(0, needed - linkedPresent),
    members,
    awayMembers,
    unknown: Math.max(0, squad.members.length - members.length - awayMembers.length),
    complete: squad.finishedAt
      ? {
        at: squad.finishedAt,
        place: squad.place ?? 0,
        category: squad.category,
        bonus: completion?.bonus ?? 0,
        timeBonus: completion?.timeBonus ?? 0,
        secondsLeft: completion?.secondsLeft ?? 0,
        before: completion?.before ?? session.totals[dealtMe.userId] ?? 0,
        after: completion?.after ?? session.totals[dealtMe.userId] ?? 0,
      }
      : null,
    category: reveal ? squad.category : null,
    words: reveal ? squad.words : null,
  };
  const last = round.scans[dealtMe.userId];
  if (last) {
    const other = ctx.person(last.otherId);
    view.scan = {
      id: last.id,
      result: last.result,
      role: last.role,
      other: other ?? { userId: last.otherId, name: 'A colleague', initials: '?', photoUrl: null, word: null },
      delta: last.delta,
      before: last.before,
      after: last.after,
      completed: last.completed,
      at: last.at,
    };
  }
  const notice = round.notices[dealtMe.userId];
  if (notice) {
    const about = ctx.player(notice.userId);
    view.notice = { kind: notice.kind, name: about?.name ?? 'A teammate', word: about?.word ?? null, at: notice.at };
  }
  return view;
}

/** A squad as the results show it: its category, words in order, and who held each. */
function squadCard(round: SquadRoundState, squadIndex: number, me: SquadPlayer | undefined, photo: Photo, ctx: SquadViewContext) {
  const squad = round.squads[squadIndex];
  const groups = ctx.groups(round, squadIndex);
  const myGroup = me ? groups.get(me.userId) : undefined;
  return {
    roundNumber: round.index + 1,
    category: squad.category,
    words: squad.words,
    size: squad.members.length,
    bonus: squad.bonus,
    timeBonus: squad.timeBonus ?? 0,
    complete: Boolean(squad.finishedAt),
    place: squad.place ?? 0,
    members: squad.members.flatMap((id, i) => {
      const player = ctx.player(id);
      return player
        ? [{ ...short(player), photoUrl: photo(player), word: squad.words[i] ?? player.word ?? null, me: id === me?.userId, linked: myGroup !== undefined && groups.get(id) === myGroup }]
        : [];
    }),
  };
}

function resultsFor(
  session: SquadSession,
  round: SquadRoundState,
  me: SquadPlayer | undefined,
  photo: Photo,
  ctx: SquadViewContext,
  shared: ReturnType<ReturnType<SquadViewContext['shared']>['results'] & object>,
) {
  const mine = me ? ctx.rankOf.get(me.userId) : undefined;
  return {
    skipped: Boolean(round.skipped),
    rank: mine?.rank ?? null,
    of: ctx.standings.length,
    roundPoints: me ? round.points[me.userId] ?? 0 : 0,
    total: me ? session.totals[me.userId] ?? 0 : 0,
    squad: me && me.squad !== undefined ? squadCard(round, me.squad, me, photo, ctx) : null,
    top: shared.top,
    squads: shared.squads.map(({ index, row }) => ({ ...row, mine: me?.squad === index })),
    trickiest: shared.trickiest,
  };
}

function finalViewFor(
  session: SquadSession,
  me: SquadPlayer | undefined,
  photo: Photo,
  ctx: SquadViewContext,
) {
  const mine = me ? ctx.rankOf.get(me.userId) : undefined;
  // My last squad: the latest round I was dealt into.
  const last = me ? ctx.lastSquadOf(me.userId) : undefined;
  return {
    rank: mine?.rank ?? null,
    of: ctx.standings.length,
    total: me ? session.totals[me.userId] ?? 0 : 0,
    lastSquad: last ? squadCard(last.round, last.index, me, photo, ctx) : null,
    leaderboard: ctx.standings,
  };
}

/**
 * The parts of a view that are one person's own. Everything else in it is
 * the same on every phone in the office, and equal to what a watcher (no
 * player) sees: so two views of one push differ only here, and a phone's
 * view changed only if this or the watchers' view did. The check
 * (secret-squad-check.ts) holds this to every field.
 */
export function personalPartsOf(view: SquadSessionView) {
  const round = view.round;
  const results = round?.results as null | { rank: unknown; roundPoints: unknown; total: unknown; squad: unknown; squads: Array<{ mine: boolean }> };
  return [
    view.joined,
    view.playing,
    view.totalPoints,
    round ? [round.me, round.squad, round.scan, round.notice] : null,
    results ? [results.rank, results.roundPoints, results.total, results.squad, results.squads.findIndex((squad) => squad.mine)] : null,
    view.final ? [view.final.rank, view.final.total, view.final.lastSquad] : null,
  ];
}
