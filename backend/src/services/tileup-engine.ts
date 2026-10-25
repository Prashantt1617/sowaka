import type {
  TileUpFeedItem,
  TileUpLastMove,
  TileUpPlayer,
  TileUpRoom,
  TileUpView,
} from '../models/tileup.model';
import { emptyBoard, evaluate, hasWord, N, newBag, PlacedTile, rackValue } from './tileup-rules';

/**
 * Tile Up's game, with no I/O: Scribble's room engine (players, host, invites,
 * removals, idle rooms) with Scrabble turns in place of drawing.
 *
 * Everything here takes a room record and a clock and says what should be
 * true now. The store layer applies it under a compare-and-set, the socket
 * layer sends what comes out, and the check script runs it against a clock
 * it moves by hand. The turn rules are the page's stand-in server's, unchanged
 * (`game-pages/tile-up.html`): a refused play is not a turn, the clock running
 * out passes the turn, swaps are 1 to 3 tiles while the bag has 7 or more,
 * and the game ends when someone plays their last tile with the bag empty
 * (they get the value of everyone else's tiles, everyone else loses their own)
 * or when every player has gone twice in a row without scoring.
 */

export const TILEUP = {
  /** How long a removed player waits before the code lets them back in; a fresh invite lets them in at once. */
  kickCooldownMs: 60_000,
  minPlayers: 2,
  maxPlayers: 4,
  /** A turn's time, in seconds: the host picks one of these in the lobby. */
  secsOptions: [60, 120] as readonly number[],
  secs: 60,
  /** The clock the page shows runs out this long before the server's, so a play made at 0 still counts. */
  graceSec: 2,
  tilesEach: 7,
  /** House rule: up to 3 tiles a swap (official Scrabble allows all 7). */
  maxSwap: 3,
  /** A host offline this long hands the role to the longest-present online player. */
  hostGoneMs: 30_000,
  /** A lobby with nobody online this long is deleted. */
  lobbyIdleMs: 10 * 60_000,
  /** A finished room stays for "Play again" this long. */
  overKeepMs: 15 * 60_000,
  /** No room outlives this (a four-player game at two minutes a turn can run long). */
  roomMaxMs: 4 * 60 * 60_000,
  invitesPerGame: 20,
  /** One push per inviter per invitee this often, whatever the room. */
  invitePushEveryMs: 10 * 60_000,
  /** How many rooms one person may open in `hostWindowMs`. */
  hostsPerWindow: 3,
  hostWindowMs: 10 * 60_000,
} as const;

/** Room codes: four digits, 1000–9999, per company. */
export const CODE_PATTERN = /^[1-9]\d{3}$/;

export type Random = () => number;

export function makeCode(random: Random): string {
  return String(1000 + (Math.floor(random() * 9000) % 9000));
}

/** `room:4827` or `4827` → `4827`; anything else null. */
export function parseCode(raw: unknown): string | null {
  const match = /^(?:room:)?([1-9]\d{3})$/i.exec(String(raw ?? '').trim());
  return match ? match[1] : null;
}

function shuffled<T>(list: T[], random: Random): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const firstName = (name: string) => String(name ?? '').trim().split(/\s+/)[0] || 'Someone';

export function playerOf(room: TileUpRoom, userId: string): TileUpPlayer | undefined {
  return room.players.find((p) => p.userId === userId);
}

export const turnIdOf = (room: TileUpRoom): string | null => (room.status === 'playing' ? room.order[room.turnIdx] ?? null : null);

// ---------------------------------------------------------------- removals and invites

/** Removed, and still inside the cool-down. */
export function stillKicked(room: TileUpRoom, userId: string, now: number): boolean {
  return room.kicked.some((k) => k.userId === userId && k.at + TILEUP.kickCooldownMs > now);
}

/** Removed by the host at some point, however long ago. */
export const wasKicked = (room: TileUpRoom, userId: string): boolean => room.kicked.some((k) => k.userId === userId);

/** Ends any removal of this person (the host invited them again). */
export function forgetKick(room: TileUpRoom, userId: string): void {
  room.kicked = room.kicked.filter((k) => k.userId !== userId);
}

/** Whether a pending invite is still worth showing: the room is in its lobby, the invite has not run out, and they are not in it. */
export function inviteOpen(
  invite: { expiresAt: number },
  room: { status: string; players: Array<{ userId: string }> } | null,
  userId: string,
  now: number,
): boolean {
  if (!room || room.status !== 'lobby') return false;
  if (invite.expiresAt <= now) return false;
  return !room.players.some((p) => p.userId === userId);
}

// ---------------------------------------------------------------- the view

/** One player's screen: the board, the bag's size, everyone's score and tile count, and only their own tiles. */
export function viewFor(room: TileUpRoom, userId: string, now: number): TileUpView {
  const over = room.status === 'over';
  return {
    code: room.code,
    you: userId,
    hostId: room.hostId,
    status: room.status,
    min: TILEUP.minPlayers,
    max: TILEUP.maxPlayers,
    secs: room.secs,
    turnId: turnIdOf(room),
    turnNo: room.turnNo,
    endsAt: room.endsAt,
    serverNow: now,
    gameId: room.gameId,
    board: room.board,
    bag: room.bag.length,
    rack: room.racks[userId] ? room.racks[userId].slice() : null,
    players: room.players.map((p) => ({
      userId: p.userId,
      name: p.name,
      photoUrl: p.photoUrl,
      score: p.score,
      online: p.online,
      tiles: (room.racks[p.userId] ?? []).length,
    })),
    invited: room.invited,
    removed: room.kicked.flatMap((k) => (k.at + TILEUP.kickCooldownMs > now ? [{ userId: k.userId, until: k.at + TILEUP.kickCooldownMs }] : [])),
    last: room.last,
    bestWord: over ? room.bestWord : null,
    ending: over ? room.ending : null,
    awards: null,
  };
}

/** The view without its clock, for "did anything change" comparisons. */
export function viewFingerprint(view: TileUpView): string {
  const { serverNow, ...rest } = view;
  void serverNow;
  return JSON.stringify(rest);
}

// ---------------------------------------------------------------- the state machine

/** What a change asks the socket layer to do besides sending everyone their view. */
export type Effect =
  /** A feed line to the whole room. */
  | { type: 'feed'; item: TileUpFeedItem }
  | { type: 'kicked'; userId: string; by: { userId: string; name: string } }
  | { type: 'invite'; userId: string; from: { userId: string; name: string; photoUrl: string | null }; code: string }
  /** Push a notification to the invitee. */
  | { type: 'notify'; userId: string; code: string; fromName: string }
  /** The game ended: record the final scores. */
  | { type: 'finished' }
  /** The room is gone; whoever was in it is told so. */
  | { type: 'delete'; players: string[] };

export function newRoom(code: string, org: string, host: Pick<TileUpPlayer, 'userId' | 'name' | 'photoUrl'>, now: number): TileUpRoom {
  return {
    code,
    org,
    gameKey: 'tile-up',
    hostId: host.userId,
    status: 'lobby',
    createdAt: now,
    updatedAt: now,
    players: [{ ...host, score: 0, joinedAt: now, online: true, offlineAt: null }],
    invited: [],
    kicked: [],
    invitesSent: 0,
    secs: TILEUP.secs,
    gameId: null,
    board: emptyBoard(),
    bag: [],
    racks: {},
    order: [],
    turnIdx: 0,
    turnNo: 0,
    endsAt: 0,
    scoreless: 0,
    last: null,
    bestWord: null,
    ending: null,
    finishedAt: null,
    recorded: false,
    version: 0,
  };
}

const onlinePlayers = (room: TileUpRoom) => room.players.filter((p) => p.online);

/** Starts a game from the lobby: the bag shuffled, seven each, a random first player. */
export function startGame(room: TileUpRoom, now: number, random: Random, gameId: string): Effect[] {
  room.gameId = gameId;
  room.board = emptyBoard();
  room.bag = shuffled(newBag(), random);
  room.racks = {};
  room.order = shuffled(onlinePlayers(room).map((p) => p.userId), random);
  for (const id of room.order) room.racks[id] = room.bag.splice(0, TILEUP.tilesEach);
  for (const p of room.players) p.score = 0;
  room.turnIdx = 0;
  room.turnNo = 0;
  room.scoreless = 0;
  room.last = null;
  room.bestWord = null;
  room.ending = null;
  room.finishedAt = null;
  room.recorded = false;
  room.invited = [];
  room.invitesSent = 0;
  room.status = 'playing';
  beginTurn(room, now);
  return [];
}

function beginTurn(room: TileUpRoom, now: number): void {
  room.turnNo += 1;
  room.endsAt = now + (room.secs + TILEUP.graceSec) * 1000;
}

function nextTurn(room: TileUpRoom, now: number): void {
  if (room.status !== 'playing') return;
  room.turnIdx = (room.turnIdx + 1) % room.order.length;
  beginTurn(room, now);
}

/** The game is over: whoever went out takes the value of everyone else's tiles, everyone else loses their own. */
export function finish(room: TileUpRoom, outId: string | null, now: number): Effect[] {
  const left: Record<string, number> = {};
  let sum = 0;
  for (const p of room.players) {
    const v = rackValue(room.racks[p.userId] ?? []);
    left[p.userId] = v;
    if (p.userId !== outId) {
      p.score -= v;
      sum += v;
    }
  }
  const out = outId ? playerOf(room, outId) : undefined;
  if (out) out.score += sum;
  room.ending = { outId: out ? outId : null, outName: out ? out.name : null, bonus: out ? sum : 0, left };
  room.status = 'over';
  room.endsAt = 0;
  room.finishedAt = now;
  return [{ type: 'finished' }];
}

type Move = Omit<TileUpLastMove, 'userId' | 'name' | 'turnNo'>;

/** After any move: the scoreless count, the end of the game, or the next player. */
function afterMove(room: TileUpRoom, userId: string, move: Move, now: number): Effect[] {
  if (room.status !== 'playing' || turnIdOf(room) !== userId) return [];
  const player = playerOf(room, userId);
  room.last = { userId, name: player ? player.name : 'Someone', turnNo: room.turnNo, ...move };
  if (move.kind === 'play') {
    room.scoreless = 0;
    if (!room.bestWord || (move.score ?? 0) > room.bestWord.score) {
      room.bestWord = { userId, name: room.last.name, word: move.word ?? '', score: move.score ?? 0 };
    }
  } else {
    room.scoreless += 1;
  }
  const rack = room.racks[userId] ?? [];
  if (move.kind === 'play' && rack.length === 0 && room.bag.length === 0) return finish(room, userId, now);
  if (room.scoreless >= room.order.length * 2) return finish(room, null, now);
  const effects: Effect[] = [];
  if (move.kind !== 'play') effects.push({ type: 'feed', item: { kind: move.kind, userId, name: room.last.name, count: move.count ?? 0 } });
  nextTurn(room, now);
  return effects;
}

export type PlayWhy = 'word' | 'line' | 'gap' | 'centre' | 'short' | 'alone' | 'taken' | 'rack' | 'turn' | 'late' | 'empty';

export interface PlayVerdict {
  ok: boolean;
  why?: PlayWhy;
  score?: number;
  words?: Array<{ word: string; score: number; known: boolean | null }>;
  bad?: string[];
  all7?: boolean;
  rack?: string[];
}

/** Reads the tiles a page sent, or null when they cannot be tiles at all. */
export function parseTiles(raw: unknown): PlacedTile[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > TILEUP.tilesEach) return null;
  const out: PlacedTile[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') return null;
    const { r, c, ch, blank } = t as Record<string, unknown>;
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    if ((r as number) < 0 || (c as number) < 0 || (r as number) >= N || (c as number) >= N) return null;
    out.push({ r: r as number, c: c as number, ch: String(ch ?? '').toLowerCase(), blank: blank === true });
  }
  return out;
}

/**
 * A play on `userId`'s turn. Refused plays (a word not in the dictionary, a
 * bad shape, tiles not in the rack) leave the room untouched and it is still
 * their turn. On a good play the tiles go down, the rack refills from the bag
 * and the turn moves on (or the game ends).
 */
export function applyPlay(room: TileUpRoom, userId: string, tiles: PlacedTile[] | null, now: number): { verdict: PlayVerdict; effects: Effect[] } {
  const no = (why: PlayWhy): { verdict: PlayVerdict; effects: Effect[] } => ({ verdict: { ok: false, why }, effects: [] });
  if (room.status !== 'playing') return no('late');
  if (turnIdOf(room) !== userId) return no('turn');
  if (now > room.endsAt) return no('late');
  if (!tiles || !tiles.length || tiles.length > TILEUP.tilesEach) return no('empty');
  const rack = (room.racks[userId] ?? []).slice();
  for (const t of tiles) {
    if (!/^[a-z]$/.test(t.ch)) return no('rack');
    const need = t.blank ? '?' : t.ch;
    const i = rack.indexOf(need);
    if (i < 0) return no('rack');
    rack.splice(i, 1);
  }
  const e = evaluate(room.board, tiles, hasWord);
  const words = e.words.map((w) => ({ word: w.word, score: w.score, known: w.known }));
  if (!e.ok) {
    return {
      verdict: { ok: false, why: (e.why || 'word') as PlayWhy, words, bad: words.filter((w) => w.known === false).map((w) => w.word) },
      effects: [],
    };
  }
  for (const t of tiles) room.board[t.r * N + t.c] = t.blank ? t.ch.toUpperCase() : t.ch;
  while (rack.length < TILEUP.tilesEach && room.bag.length) rack.push(room.bag.shift() as string);
  room.racks[userId] = rack;
  const player = playerOf(room, userId);
  if (player) player.score += e.score;
  const effects = afterMove(
    room,
    userId,
    { kind: 'play', word: e.words[0].word, words: e.words.map((w) => w.word), score: e.score, all7: e.all7, cells: tiles.map((t) => t.r * N + t.c) },
    now,
  );
  return { verdict: { ok: true, score: e.score, words, all7: e.all7, rack: rack.slice() }, effects };
}

export class TileUpMoveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** 1 to 3 tiles back in the bag for new ones, while the bag has 7 or more; it ends the turn. Throws a TileUpMoveError when refused. */
export function applySwap(room: TileUpRoom, userId: string, letters: unknown, now: number, random: Random): { rack: string[]; effects: Effect[] } {
  if (room.status !== 'playing' || turnIdOf(room) !== userId) throw new TileUpMoveError(409, "It isn't your turn.");
  if (room.bag.length < TILEUP.tilesEach) throw new TileUpMoveError(409, 'You can swap only while the bag has 7 or more tiles.');
  if (!Array.isArray(letters) || !letters.length) throw new TileUpMoveError(400, 'Pick the tiles to swap.');
  if (letters.length > TILEUP.maxSwap) throw new TileUpMoveError(400, `You can swap up to ${TILEUP.maxSwap} tiles at a time.`);
  const rack = (room.racks[userId] ?? []).slice();
  const out: string[] = [];
  for (const raw of letters) {
    const ch = String(raw ?? '').toLowerCase();
    const i = rack.indexOf(ch);
    if (i < 0) throw new TileUpMoveError(400, 'Those tiles are not in your rack.');
    out.push(rack.splice(i, 1)[0]);
  }
  while (rack.length < TILEUP.tilesEach && room.bag.length) rack.push(room.bag.shift() as string);
  room.bag = shuffled(room.bag.concat(out), random);
  room.racks[userId] = rack;
  const effects = afterMove(room, userId, { kind: 'swap', count: out.length }, now);
  return { rack: rack.slice(), effects };
}

/** Ends the turn without playing. Throws a TileUpMoveError when it is not their turn. */
export function applyPass(room: TileUpRoom, userId: string, now: number): Effect[] {
  if (room.status !== 'playing' || turnIdOf(room) !== userId) throw new TileUpMoveError(409, "It isn't your turn.");
  return afterMove(room, userId, { kind: 'pass' }, now);
}

/** The host's lobby choice, `{secs: 60|120}`: whether the room changed, or null for a choice that is not allowed. */
export function applySettings(room: TileUpRoom, input: { secs?: unknown }): boolean | null {
  const { secs } = input;
  if (secs === undefined) return null;
  const n = Number(secs);
  if (!TILEUP.secsOptions.includes(n)) return null;
  if (room.secs === n) return false;
  room.secs = n;
  return true;
}

/** Back to the lobby from the podium: scores at zero, a clean board. */
export function resetToLobby(room: TileUpRoom): Effect[] {
  room.status = 'lobby';
  room.gameId = null;
  room.board = emptyBoard();
  room.bag = [];
  room.racks = {};
  room.order = [];
  room.turnIdx = 0;
  room.turnNo = 0;
  room.endsAt = 0;
  room.scoreless = 0;
  room.last = null;
  room.bestWord = null;
  room.ending = null;
  room.finishedAt = null;
  room.recorded = false;
  for (const p of room.players) p.score = 0;
  return [];
}

/** The longest-present online player, else the longest-present at all. */
export function nextHost(room: TileUpRoom, except?: string): TileUpPlayer | undefined {
  return [...room.players]
    .filter((p) => p.userId !== except)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.joinedAt - b.joinedAt)[0];
}

/**
 * Takes a player out, by their own choice or the host's. The host role passes
 * on; mid-game their tiles go back in the bag and they leave the turn order
 * (their turn, if it was theirs, goes to the next player); a game down to one
 * player ends; an empty room is deleted.
 */
export function removePlayer(room: TileUpRoom, userId: string, how: 'leave' | 'kick', by: TileUpPlayer | null, now: number, random: Random): Effect[] {
  const player = playerOf(room, userId);
  if (!player) return [];
  room.players = room.players.filter((p) => p.userId !== userId);
  if (how === 'kick') room.kicked = room.kicked.filter((k) => k.userId !== userId).concat({ userId, at: now });
  const effects: Effect[] = [];
  if (how === 'kick' && by) effects.push({ type: 'kicked', userId, by: { userId: by.userId, name: by.name } });
  effects.push({ type: 'feed', item: { kind: 'leave', userId, name: player.name } });
  if (room.players.length === 0) return [...effects, { type: 'delete', players: [userId] }];
  if (room.hostId === userId) {
    const next = nextHost(room);
    if (next) {
      room.hostId = next.userId;
      effects.push({ type: 'feed', item: { kind: 'host', userId: next.userId, name: next.name } });
    }
  }
  if (room.status === 'playing') {
    const wasTurn = turnIdOf(room) === userId;
    const i = room.order.indexOf(userId);
    if (i >= 0) {
      room.bag = shuffled(room.bag.concat(room.racks[userId] ?? []), random);
      delete room.racks[userId];
      room.order.splice(i, 1);
      if (i < room.turnIdx) room.turnIdx -= 1;
      if (room.turnIdx >= room.order.length) room.turnIdx = 0;
    }
    if (room.order.length < 2) return [...effects, ...finish(room, null, now)];
    if (wasTurn) beginTurn(room, now);
  }
  return effects;
}

/**
 * Moves a room on to wherever the clock says it should be: a turn whose time
 * ran out passes, an absent host hands over, idle and finished rooms go. Null
 * when nothing is due, so a quiet room costs no write and no push.
 */
export function advance(room: TileUpRoom, now: number): Effect[] | null {
  if (room.players.length === 0) return [{ type: 'delete', players: [] }];
  if (now - room.createdAt >= TILEUP.roomMaxMs) return [{ type: 'delete', players: room.players.map((p) => p.userId) }];
  const effects: Effect[] = [];
  let changed = false;

  const online = onlinePlayers(room);
  const host = playerOf(room, room.hostId);
  if (host && !host.online && host.offlineAt !== null && now - host.offlineAt >= TILEUP.hostGoneMs && online.length > 0) {
    const next = nextHost(room, host.userId);
    if (next?.online) {
      room.hostId = next.userId;
      effects.push({ type: 'feed', item: { kind: 'host', userId: next.userId, name: next.name } });
      changed = true;
    }
  }

  switch (room.status) {
    case 'lobby': {
      if (online.length === 0) {
        const lastSeen = Math.max(room.updatedAt, ...room.players.map((p) => p.offlineAt ?? 0));
        if (now - lastSeen >= TILEUP.lobbyIdleMs) return [{ type: 'delete', players: room.players.map((p) => p.userId) }];
      }
      break;
    }
    case 'playing': {
      if (now >= room.endsAt) {
        const id = turnIdOf(room);
        if (id) effects.push(...afterMove(room, id, { kind: 'timeout' }, now));
        changed = true;
      }
      break;
    }
    case 'over': {
      if (room.finishedAt !== null && now - room.finishedAt >= TILEUP.overKeepMs) {
        return [{ type: 'delete', players: room.players.map((p) => p.userId) }];
      }
      break;
    }
    default:
      break;
  }
  return changed ? effects : null;
}

/** Final standings, best first; ties share the earlier seat's place. */
export function standings(room: TileUpRoom): Array<{ userId: string; name: string; score: number; place: number }> {
  const sorted = [...room.players].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  let place = 0;
  let lastScore: number | null = null;
  return sorted.map((p, i) => {
    if (p.score !== lastScore) {
      place = i + 1;
      lastScore = p.score;
    }
    return { userId: p.userId, name: p.name, score: p.score, place };
  });
}
