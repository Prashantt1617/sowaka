import words from '../content/scribble-words.json';
import {
  ScribbleChoice,
  ScribbleFeedItem,
  ScribbleOp,
  ScribblePlayer,
  ScribbleRoom,
  ScribbleStatus,
  ScribbleTurnEnd,
  ScribbleView,
  ScribbleWordLevel,
} from '../models/scribble.model';
import { editDistance } from './relay-engine';

/**
 * Scribble's rules, with no I/O.
 *
 * Everything here takes a room record and a clock and says what should be
 * true now. The store layer applies it under a compare-and-set, the socket
 * layer sends what comes out, and the check script runs it against a clock
 * it moves by hand. Timings are constants rather than per-room settings: one
 * game for everyone, easy to tune in one place. The host sets only two things,
 * in the lobby: how hard the words are and how many rounds.
 */

export const SCRIBBLE = {
  /** How long a removed player waits before the code lets them back in; a fresh invite lets them in at once. */
  kickCooldownMs: 60_000,
  minPlayers: 3,
  maxPlayers: 8,
  /** Rounds when the host has not chosen; the host may pick from `minRounds` to `maxRounds`. */
  rounds: 2,
  minRounds: 2,
  maxRounds: 5,
  /** Word level when the host has not chosen. */
  level: 'medium' as ScribbleWordLevel,
  turnMs: 70_000,
  pickMs: 10_000,
  revealMs: 6_000,
  /** The turn ends this long after the last online guesser has the word. */
  earlyEndMs: 700,
  /** A drawer offline this long ends their turn. */
  drawerGoneMs: 10_000,
  /** A host offline this long hands the role to the longest-present online player. */
  hostGoneMs: 30_000,
  /** A lobby with nobody online this long is deleted. */
  lobbyIdleMs: 10 * 60_000,
  /** A finished room stays for "Play again" this long. */
  overKeepMs: 15 * 60_000,
  /** No room outlives this. */
  roomMaxMs: 2 * 60 * 60_000,
  guesserBase: 50,
  guesserBonus: 250,
  drawerPerGuess: 50,
  maxGuessChars: 40,
  invitesPerGame: 20,
  /** One push per inviter per invitee this often, whatever the room. */
  invitePushEveryMs: 10 * 60_000,
  /** How many rooms one person may open in `hostWindowMs`. */
  hostsPerWindow: 3,
  hostWindowMs: 10 * 60_000,
  /** Stroke limits; see PROTOCOL.md §7. */
  maxPointsPerMessage: 300,
  maxDrawPerSecond: 25,
  maxPointsPerTurn: 20_000,
  maxFillsPerTurn: 150,
  board: 1000,
} as const;

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_PATTERN = /^[A-HJKMNP-Z2-9]{5}$/;

export type Random = () => number;

export function makeCode(random: Random): string {
  let code = '';
  for (let i = 0; i < 5; i += 1) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return code;
}

/** `room:K7QXP` or `K7QXP` → `K7QXP`; anything else null. */
export function parseCode(raw: unknown): string | null {
  const match = /^(?:room:)?([A-HJKMNP-Z2-9]{5})$/i.exec(String(raw ?? '').trim());
  return match ? match[1].toUpperCase() : null;
}

// ---------------------------------------------------------------- words and guesses

export const WORDS: Record<ScribbleWordLevel, string[]> = words as Record<ScribbleWordLevel, string[]>;
const LEVELS: ScribbleWordLevel[] = ['easy', 'medium', 'hard'];

export const isWordLevel = (value: unknown): value is ScribbleWordLevel => LEVELS.includes(value as ScribbleWordLevel);

/** The room's word level, or the default for a room written before the host could choose. */
export const levelOf = (room: Pick<ScribbleRoom, 'level'>): ScribbleWordLevel => (isWordLevel(room.level) ? room.level : SCRIBBLE.level);

/** The room's number of rounds, held to what the host may choose. */
export function roundsOf(room: Pick<ScribbleRoom, 'rounds'>): number {
  const n = room.rounds;
  return typeof n === 'number' && Number.isInteger(n) && n >= SCRIBBLE.minRounds && n <= SCRIBBLE.maxRounds ? n : SCRIBBLE.rounds;
}

/**
 * The drawer's three words. With a level, three different words of that
 * level; without one, one word of each level. None used in this game yet
 * while the list has any left.
 */
export function chooseWords(used: string[], random: Random, level?: ScribbleWordLevel): ScribbleChoice[] {
  const taken = new Set(used);
  const pickFrom = (lv: ScribbleWordLevel, also: Set<string>) => {
    const fresh = WORDS[lv].filter((word) => !taken.has(word) && !also.has(word));
    const from = fresh.length > 0 ? fresh : WORDS[lv].filter((word) => !also.has(word));
    return from[Math.floor(random() * from.length) % from.length];
  };
  if (!level) return LEVELS.map((lv) => ({ word: pickFrom(lv, new Set()), level: lv }));
  const picked = new Set<string>();
  return [0, 1, 2].map(() => {
    const word = pickFrom(level, picked);
    picked.add(word);
    return { word, level };
  });
}

/**
 * Case, punctuation and extra spaces do not matter; a hyphen is a space.
 * Letters of any script stay (with their combining marks, so Devanagari
 * vowel signs survive): a Hindi guess is a wrong guess, not an empty one.
 */
export function normalizeGuess(text: string): string {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s-]+/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N} ]/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export type GuessOutcome = 'correct' | 'close' | 'wrong' | 'empty';

/**
 * Exact after normalising, or the word as a whole word inside the guess
 * (`a giraffe`). One letter off, for guesses of four letters or more, is
 * "close" — a hint only the guesser hears.
 */
export function guessOutcome(text: string, word: string): GuessOutcome {
  const typed = normalizeGuess(text);
  const target = normalizeGuess(word);
  if (!typed) return 'empty';
  if (typed === target) return 'correct';
  if (target.length > 0 && ` ${typed} `.includes(` ${target} `)) return 'correct';
  if (typed.length >= 4 && editDistance(typed, target) === 1) return 'close';
  return 'wrong';
}

export function guessPoints(leftMs: number, turnMs = SCRIBBLE.turnMs): number {
  const fraction = Math.max(0, Math.min(1, leftMs / turnMs));
  return Math.round(SCRIBBLE.guesserBase + SCRIBBLE.guesserBonus * fraction);
}

/** Indexes of the letters in a word (spaces are not letters). */
export function letterSlots(word: string): number[] {
  return [...word].map((ch, i) => (ch === ' ' ? -1 : i)).filter((i) => i >= 0);
}

/**
 * How many letters should be showing when `elapsedFraction` of the turn has
 * passed: one at half time, a second at three quarters for five letters or
 * more, never more than half the letters.
 */
export function hintsWanted(word: string, elapsedFraction: number): number {
  const letters = letterSlots(word).length;
  const due = (elapsedFraction >= 0.5 ? 1 : 0) + (elapsedFraction >= 0.75 && letters >= 5 ? 1 : 0);
  return Math.min(Math.floor(letters / 2), due);
}

/** `"__a__"`: one character per letter, spaces kept, hints shown. */
export function maskOf(word: string, revealed: number[]): string {
  const shown = new Set(revealed);
  return [...word].map((ch, i) => (ch === ' ' ? ' ' : shown.has(i) ? ch : '_')).join('');
}

// ---------------------------------------------------------------- strokes

function int(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** A structurally valid op, or null. Ranges are PROTOCOL.md §7. */
export function validateOp(raw: unknown): ScribbleOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const op = raw as Record<string, unknown>;
  const B = SCRIBBLE.board;
  switch (op.t) {
    case 'c':
      return { t: 'c' };
    case 'u':
    case 'r': {
      const id = int(op.id, 1, 1_000_000);
      return id === null ? null : { t: op.t, id };
    }
    case 'b': {
      const id = int(op.id, 1, 1_000_000);
      const k = int(op.k ?? 0, 0, 2);
      const c = int(op.c, 0, 15);
      const w = int(op.w ?? 0, 0, 3);
      const x = int(op.x, 0, B);
      const y = int(op.y, 0, B);
      if (id === null || k === null || c === null || w === null || x === null || y === null) return null;
      return { t: 'b', id, k, c, w, x, y };
    }
    case 'f': {
      const id = int(op.id, 1, 1_000_000);
      const c = int(op.c, 0, 15);
      const x = int(op.x, 0, B);
      const y = int(op.y, 0, B);
      if (id === null || c === null || x === null || y === null) return null;
      return { t: 'f', id, c, x, y };
    }
    case 'p': {
      const id = int(op.id, 1, 1_000_000);
      const pts = op.pts;
      if (id === null || !Array.isArray(pts) || pts.length === 0 || pts.length % 2 !== 0 || pts.length > 2 * SCRIBBLE.maxPointsPerMessage) return null;
      if (!pts.every((v) => int(v, 0, B) !== null)) return null;
      return { t: 'p', id, pts: pts as number[] };
    }
    default:
      return null;
  }
}

/** How many points a message carries: a `p` op's pairs, one for anything else. */
export function pointsIn(ops: ScribbleOp[]): number {
  return ops.reduce((n, op) => n + (op.t === 'p' ? op.pts.length / 2 : 1), 0);
}

// ---------------------------------------------------------------- the view

export function turnKeyOf(room: ScribbleRoom): string | null {
  return room.gameId ? `${room.gameId}:${room.round}:${room.turnIdx}` : null;
}

export function playerOf(room: ScribbleRoom, userId: string): ScribblePlayer | undefined {
  return room.players.find((p) => p.userId === userId);
}

// ---------------------------------------------------------------- removals

type KickRecord = ScribbleRoom['kicked'][number];
/** Who a removal names; a bare string is a removal from before the cool-down. */
export const kickedId = (k: KickRecord): string => (typeof k === 'string' ? k : k?.userId);
/** When a removal's cool-down ends, or null for one with no expiry (an old bare id). */
const kickEnds = (k: KickRecord): number | null => (typeof k === 'string' ? null : k.at + SCRIBBLE.kickCooldownMs);
const kicksOf = (room: ScribbleRoom): KickRecord[] =>
  Array.isArray(room.kicked) ? room.kicked.filter((k) => typeof k === 'string' || (!!k && typeof k === 'object')) : [];

/** Removed by the host at some point, however long ago. */
export const wasKicked = (room: ScribbleRoom, userId: string): boolean => kicksOf(room).some((k) => kickedId(k) === userId);

/** Removed, and still inside the cool-down (an old bare id never runs out). */
export function stillKicked(room: ScribbleRoom, userId: string, now: number): boolean {
  return kicksOf(room).some((k) => {
    if (kickedId(k) !== userId) return false;
    const ends = kickEnds(k);
    return ends === null || ends > now;
  });
}

/** Ends any removal of this person (the host invited them again). */
export function forgetKick(room: ScribbleRoom, userId: string): void {
  room.kicked = kicksOf(room).filter((k) => kickedId(k) !== userId);
}

/**
 * Whether a pending invite is still worth showing its invitee: the room is
 * still there and still in its lobby, the invite has not run out, and they
 * are not already sitting in it. Judged on the game's clock.
 */
export function inviteOpen(
  invite: { expiresAt: number },
  room: { status: ScribbleStatus; players: Array<{ userId: string }> } | null,
  userId: string,
  now: number,
): boolean {
  if (!room || room.status !== 'lobby') return false;
  if (invite.expiresAt <= now) return false;
  return !room.players.some((p) => p.userId === userId);
}

const inPlay = (room: ScribbleRoom) => room.status === 'picking' || room.status === 'drawing' || room.status === 'reveal';

/**
 * One player's screen. The word reaches the drawer while drawing, a guesser
 * once they have it, and everyone at the reveal and the podium; the choices
 * reach only the drawer while picking. Nobody else is ever sent either.
 */
export function viewFor(room: ScribbleRoom, userId: string, now: number): ScribbleView {
  const drawing = room.drawerId === userId;
  const got = Object.prototype.hasOwnProperty.call(room.guessed, userId);
  const showWord = room.status === 'reveal' || room.status === 'over' || (room.status === 'drawing' && (drawing || got));
  return {
    code: room.code,
    you: userId,
    hostId: room.hostId,
    status: room.status,
    min: SCRIBBLE.minPlayers,
    max: SCRIBBLE.maxPlayers,
    rounds: roundsOf(room),
    level: levelOf(room),
    round: room.round,
    turn: room.turnIdx + 1,
    turns: room.order.length,
    turnKey: turnKeyOf(room),
    gameId: room.gameId,
    drawerId: inPlay(room) ? room.drawerId : null,
    turnSec: SCRIBBLE.turnMs / 1000,
    pickSec: SCRIBBLE.pickMs / 1000,
    revealSec: SCRIBBLE.revealMs / 1000,
    endsAt: room.endsAt,
    serverNow: now,
    players: room.players.map((p) => ({
      userId: p.userId,
      name: p.name,
      photoUrl: p.photoUrl,
      score: p.score,
      online: p.online,
      guessed: Object.prototype.hasOwnProperty.call(room.guessed, p.userId),
    })),
    invited: room.invited,
    removed: kicksOf(room).flatMap((k) => {
      const until = kickEnds(k);
      return until === null || until > now ? [{ userId: kickedId(k), until }] : [];
    }),
    choices: room.status === 'picking' && drawing ? room.choices : null,
    word: showWord ? room.word : null,
    mask: room.status === 'drawing' && room.word ? maskOf(room.word, room.revealed) : null,
    last: room.status === 'reveal' || room.status === 'over' ? room.last : null,
    // Engagement points are not paid for Scribble yet; the page shows nothing for null.
    awards: null,
  };
}

/** The view without its clock, for "did anything change" comparisons. */
export function viewFingerprint(view: ScribbleView): string {
  const { serverNow, ...rest } = view;
  void serverNow;
  return JSON.stringify(rest);
}

// ---------------------------------------------------------------- the state machine

/** What a change asks the socket layer to do besides sending everyone their view. */
export type Effect =
  /** A feed line to the whole room, or only to `to`. */
  | { type: 'feed'; item: ScribbleFeedItem; to?: string[] }
  | { type: 'close'; userId: string; text: string }
  | { type: 'kicked'; userId: string; by: { userId: string; name: string } }
  | { type: 'invite'; userId: string; from: { userId: string; name: string; photoUrl: string | null }; code: string }
  /** Push a notification to the invitee. */
  | { type: 'notify'; userId: string; code: string; fromName: string }
  /** Empty the stroke log; the next state push carries `strokes: []`. */
  | { type: 'clearStrokes' }
  /** The game ended: record the final scores. */
  | { type: 'finished' }
  /** The room is gone; whoever was in it is told so. */
  | { type: 'delete'; players: string[] };

export const firstName = (name: string) => String(name ?? '').trim().split(/\s+/)[0] || 'Someone';

export function newRoom(code: string, org: string, host: Omit<ScribblePlayer, 'score' | 'joinedAt' | 'online' | 'offlineAt'>, now: number): ScribbleRoom {
  return {
    code,
    org,
    gameKey: 'scribble',
    hostId: host.userId,
    status: 'lobby',
    createdAt: now,
    updatedAt: now,
    players: [{ ...host, score: 0, joinedAt: now, online: true, offlineAt: null }],
    invited: [],
    kicked: [],
    invitesSent: 0,
    level: SCRIBBLE.level,
    rounds: SCRIBBLE.rounds,
    gameId: null,
    round: 0,
    turnIdx: -1,
    order: [],
    drawerId: null,
    choices: null,
    word: null,
    revealed: [],
    turnStartedAt: 0,
    endsAt: 0,
    pendingEndAt: null,
    guessed: {},
    drawerGain: 0,
    usedWords: [],
    last: null,
    finishedAt: null,
    recorded: false,
    version: 0,
  };
}

const onlinePlayers = (room: ScribbleRoom) => room.players.filter((p) => p.online);

/** Every online guesser has the word (and there is at least one). */
export function allGuessed(room: ScribbleRoom): boolean {
  const guessers = room.players.filter((p) => p.online && p.userId !== room.drawerId);
  return guessers.length > 0 && guessers.every((p) => Object.prototype.hasOwnProperty.call(room.guessed, p.userId));
}

/** Starts a game from the lobby (or the podium, via `again`). */
export function startGame(room: ScribbleRoom, now: number, random: Random, gameId: string): Effect[] {
  room.gameId = gameId;
  room.round = 1;
  room.turnIdx = 0;
  room.order = onlinePlayers(room).map((p) => p.userId);
  room.usedWords = [];
  room.invited = [];
  room.invitesSent = 0;
  room.last = null;
  room.finishedAt = null;
  room.recorded = false;
  for (const p of room.players) p.score = 0;
  return beginPick(room, now, random);
}

/**
 * Opens the pick for the drawer at `turnIdx`, skipping anyone offline; at the
 * end of the order the next round begins with the order rebuilt from who is
 * here now (a late joiner draws from the next round); after the last round,
 * the podium. A room down to one online player cannot go on and finishes.
 */
export function beginPick(room: ScribbleRoom, now: number, random: Random): Effect[] {
  for (;;) {
    while (room.turnIdx < room.order.length && !playerOf(room, room.order[room.turnIdx])?.online) room.turnIdx += 1;
    if (room.turnIdx < room.order.length) break;
    room.round += 1;
    room.turnIdx = 0;
    room.order = onlinePlayers(room).map((p) => p.userId);
    if (room.round > roundsOf(room) || room.order.length < 2) return finishGame(room, now);
  }
  if (onlinePlayers(room).length < 2) return finishGame(room, now);
  room.drawerId = room.order[room.turnIdx];
  room.choices = chooseWords(room.usedWords, random, levelOf(room));
  room.word = null;
  room.status = 'picking';
  room.turnStartedAt = now;
  room.endsAt = now + SCRIBBLE.pickMs;
  room.pendingEndAt = null;
  room.guessed = {};
  room.revealed = [];
  room.drawerGain = 0;
  room.last = null;
  return [{ type: 'clearStrokes' }];
}

export function chooseWord(room: ScribbleRoom, index: number, now: number): Effect[] {
  const choice = room.choices?.[index] ?? room.choices?.[0];
  if (!choice) return finishGame(room, now);
  room.word = choice.word;
  room.usedWords.push(choice.word);
  room.choices = null;
  room.status = 'drawing';
  room.turnStartedAt = now;
  room.endsAt = now + SCRIBBLE.turnMs;
  room.revealed = [];
  return [];
}

export function endTurn(room: ScribbleRoom, why: ScribbleTurnEnd, now: number): Effect[] {
  const gains = Object.entries(room.guessed).map(([userId, points]) => ({ userId, points }));
  if (room.drawerId) gains.push({ userId: room.drawerId, points: room.drawerGain });
  room.last = { word: room.word ?? '', drawerId: room.drawerId ?? '', why, gains };
  room.status = 'reveal';
  room.endsAt = now + SCRIBBLE.revealMs;
  room.pendingEndAt = null;
  room.choices = null;
  return [];
}

export function finishGame(room: ScribbleRoom, now: number): Effect[] {
  room.status = 'over';
  room.drawerId = null;
  room.choices = null;
  room.word = null;
  room.endsAt = 0;
  room.pendingEndAt = null;
  room.finishedAt = now;
  return [{ type: 'finished' }];
}

/** Back to the lobby from the podium, scores at zero, paper clean. */
export function resetToLobby(room: ScribbleRoom): Effect[] {
  room.status = 'lobby';
  room.gameId = null;
  room.round = 0;
  room.turnIdx = -1;
  room.order = [];
  room.drawerId = null;
  room.choices = null;
  room.word = null;
  room.revealed = [];
  room.endsAt = 0;
  room.pendingEndAt = null;
  room.guessed = {};
  room.drawerGain = 0;
  room.last = null;
  room.finishedAt = null;
  room.recorded = false;
  for (const p of room.players) p.score = 0;
  return [{ type: 'clearStrokes' }];
}

export interface GuessResult {
  correct: boolean;
  close?: boolean;
  points?: number;
  /** Not shown to the room: the sender sees it greyed. */
  blocked?: boolean;
}

/**
 * Judges a guess and banks it. A stale `turn`, the drawer, or someone who
 * already has the word gets a plain "not correct" and nothing is broadcast.
 */
export function applyGuess(
  room: ScribbleRoom,
  userId: string,
  text: string,
  turn: unknown,
  now: number,
  blocked: (normalized: string) => boolean,
): { result: GuessResult; effects: Effect[]; changed: boolean } {
  const player = playerOf(room, userId);
  const trimmed = String(text ?? '').slice(0, SCRIBBLE.maxGuessChars);
  if (
    !player ||
    room.status !== 'drawing' ||
    !room.word ||
    room.drawerId === userId ||
    Object.prototype.hasOwnProperty.call(room.guessed, userId) ||
    turn !== turnKeyOf(room)
  ) {
    return { result: { correct: false }, effects: [], changed: false };
  }
  const outcome = guessOutcome(trimmed, room.word);
  if (outcome === 'empty') return { result: { correct: false }, effects: [], changed: false };
  if (outcome === 'correct') {
    const points = guessPoints(Math.max(0, room.endsAt - now));
    room.guessed[userId] = points;
    player.score += points;
    const drawer = room.drawerId ? playerOf(room, room.drawerId) : undefined;
    if (drawer) {
      drawer.score += SCRIBBLE.drawerPerGuess;
      room.drawerGain += SCRIBBLE.drawerPerGuess;
    }
    const effects: Effect[] = [{ type: 'feed', item: { kind: 'correct', userId, name: player.name } }];
    if (allGuessed(room)) room.pendingEndAt = now + SCRIBBLE.earlyEndMs;
    return { result: { correct: true, points }, effects, changed: true };
  }
  if (outcome === 'close') {
    return { result: { correct: false, close: true }, effects: [{ type: 'close', userId, text: trimmed }], changed: false };
  }
  if (blocked(normalizeGuess(trimmed))) {
    return { result: { correct: false, blocked: true }, effects: [], changed: false };
  }
  return {
    result: { correct: false },
    effects: [{ type: 'feed', item: { kind: 'guess', userId, name: player.name, text: trimmed } }],
    changed: false,
  };
}

/** Whether this player's line is a guess at the word now: a guesser, mid-turn, who does not have it yet. */
export function guessing(room: ScribbleRoom, userId: string): boolean {
  return room.status === 'drawing' && !!room.word && room.drawerId !== userId && !Object.prototype.hasOwnProperty.call(room.guessed, userId);
}

/**
 * A chat line: anything typed by someone who is not guessing right now, in
 * any phase. While a word is being drawn, the drawer and those who have
 * guessed it may talk, but only among themselves, so the word cannot leak;
 * otherwise the whole room sees it. A line on the block-list goes nowhere.
 */
export function applyChat(
  room: ScribbleRoom,
  userId: string,
  text: string,
  blocked: (normalized: string) => boolean,
): { result: GuessResult; effects: Effect[] } {
  const player = playerOf(room, userId);
  const trimmed = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, SCRIBBLE.maxGuessChars);
  if (!player || !trimmed) return { result: { correct: false }, effects: [] };
  if (blocked(normalizeGuess(trimmed))) return { result: { correct: false, blocked: true }, effects: [] };
  const item: ScribbleFeedItem = { kind: 'chat', userId, name: player.name, text: trimmed };
  // The drawer picking a word knows three that nobody else does: a line
  // that names one (or nearly) stays with the drawer.
  if (room.status === 'picking' && room.drawerId === userId && (room.choices ?? []).some((c) => guessOutcome(trimmed, c.word) !== 'wrong')) {
    return { result: { correct: false }, effects: [{ type: 'feed', item: { ...item, private: true }, to: [userId] }] };
  }
  if (room.status === 'drawing' && room.word) {
    const knowers = room.players
      .map((p) => p.userId)
      .filter((id) => id === room.drawerId || Object.prototype.hasOwnProperty.call(room.guessed, id));
    return { result: { correct: false }, effects: [{ type: 'feed', item: { ...item, private: true }, to: knowers }] };
  }
  return { result: { correct: false }, effects: [{ type: 'feed', item }] };
}

/**
 * The host's lobby settings: a word level and a number of rounds, either or
 * both. Anything invalid refuses the whole change (null); otherwise returns
 * whether the room changed.
 */
export function applySettings(room: ScribbleRoom, input: { level?: unknown; rounds?: unknown }): boolean | null {
  const { level, rounds } = input;
  if (level === undefined && rounds === undefined) return null;
  if (level !== undefined && !isWordLevel(level)) return null;
  if (rounds !== undefined && (typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < SCRIBBLE.minRounds || rounds > SCRIBBLE.maxRounds)) return null;
  let changed = false;
  if (level !== undefined && room.level !== level) {
    room.level = level;
    changed = true;
  }
  if (rounds !== undefined && room.rounds !== rounds) {
    room.rounds = rounds as number;
    changed = true;
  }
  return changed;
}

/** The longest-present online player, else the longest-present at all. */
export function nextHost(room: ScribbleRoom, except?: string): ScribblePlayer | undefined {
  return [...room.players]
    .filter((p) => p.userId !== except)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.joinedAt - b.joinedAt)[0];
}

/**
 * Takes a player out, by their own choice or the host's. The host role passes
 * on; a drawer leaving mid-turn ends the turn, and one leaving before they
 * picked hands the pick straight to the next drawer (there is no word to
 * reveal); a turn everyone left has finished ends; an empty room is deleted.
 */
export function removePlayer(room: ScribbleRoom, userId: string, how: 'leave' | 'kick', by: ScribblePlayer | null, now: number, random: Random): Effect[] {
  const player = playerOf(room, userId);
  if (!player) return [];
  room.players = room.players.filter((p) => p.userId !== userId);
  if (how === 'kick') room.kicked = kicksOf(room).filter((k) => kickedId(k) !== userId).concat({ userId, at: now });
  const effects: Effect[] = [];
  if (how === 'kick' && by) effects.push({ type: 'kicked', userId, by: { userId: by.userId, name: by.name } });
  effects.push({
    type: 'feed',
    item: { kind: 'leave', userId, name: player.name, text: `${firstName(player.name)} ${how === 'kick' ? 'was removed' : 'left'}` },
  });
  if (room.players.length === 0) return [...effects, { type: 'delete', players: [userId] }];
  if (room.hostId === userId) {
    const next = nextHost(room);
    if (next) {
      room.hostId = next.userId;
      effects.push({ type: 'feed', item: { kind: 'host', userId: next.userId, name: next.name } });
    }
  }
  if (room.drawerId === userId && room.status === 'drawing') {
    return [...effects, ...endTurn(room, 'drawer_left', now)];
  }
  if (room.drawerId === userId && room.status === 'picking') {
    room.turnIdx += 1;
    return [...effects, ...beginPick(room, now, random)];
  }
  if (room.status === 'drawing' && allGuessed(room)) room.pendingEndAt ??= now + SCRIBBLE.earlyEndMs;
  return effects;
}

/**
 * Moves a room on to wherever the clock says it should be. Null when nothing
 * is due, so a quiet room costs no write and no push.
 */
export function advance(room: ScribbleRoom, now: number, random: Random): Effect[] | null {
  if (room.players.length === 0) return [{ type: 'delete', players: [] }];
  if (now - room.createdAt >= SCRIBBLE.roomMaxMs) return [{ type: 'delete', players: room.players.map((p) => p.userId) }];
  const effects: Effect[] = [];
  let changed = false;

  const online = onlinePlayers(room);
  const host = playerOf(room, room.hostId);
  if (host && !host.online && host.offlineAt !== null && now - host.offlineAt >= SCRIBBLE.hostGoneMs && online.length > 0) {
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
        if (now - lastSeen >= SCRIBBLE.lobbyIdleMs) return [{ type: 'delete', players: room.players.map((p) => p.userId) }];
      }
      break;
    }
    case 'picking': {
      const drawer = room.drawerId ? playerOf(room, room.drawerId) : undefined;
      if (!drawer || (!drawer.online && drawer.offlineAt !== null && now - drawer.offlineAt >= SCRIBBLE.drawerGoneMs)) {
        // Nothing was drawn, so nothing to reveal: the next drawer picks.
        room.turnIdx += 1;
        effects.push(...beginPick(room, now, random));
        changed = true;
      } else if (now >= room.endsAt) {
        effects.push(...chooseWord(room, 0, now));
        changed = true;
      }
      break;
    }
    case 'drawing': {
      const drawer = room.drawerId ? playerOf(room, room.drawerId) : undefined;
      if (!drawer || (!drawer.online && drawer.offlineAt !== null && now - drawer.offlineAt >= SCRIBBLE.drawerGoneMs)) {
        effects.push(...endTurn(room, 'drawer_left', now));
        changed = true;
        break;
      }
      // A guesser going offline can leave everyone still here with the word.
      if (room.pendingEndAt === null && allGuessed(room)) {
        room.pendingEndAt = now + SCRIBBLE.earlyEndMs;
        changed = true;
      }
      if (room.pendingEndAt !== null && now >= room.pendingEndAt) {
        effects.push(...endTurn(room, 'all', now));
        changed = true;
        break;
      }
      if (now >= room.endsAt) {
        effects.push(...endTurn(room, 'time', now));
        changed = true;
        break;
      }
      if (room.word) {
        const elapsed = (now - room.turnStartedAt) / SCRIBBLE.turnMs;
        const wanted = hintsWanted(room.word, elapsed);
        while (room.revealed.length < wanted) {
          const hidden = letterSlots(room.word).filter((i) => !room.revealed.includes(i));
          if (hidden.length === 0) break;
          room.revealed.push(hidden[Math.floor(random() * hidden.length) % hidden.length]);
          changed = true;
        }
      }
      break;
    }
    case 'reveal': {
      if (now >= room.endsAt) {
        room.turnIdx += 1;
        effects.push(...beginPick(room, now, random));
        changed = true;
      }
      break;
    }
    case 'over': {
      if (room.finishedAt !== null && now - room.finishedAt >= SCRIBBLE.overKeepMs) {
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
export function standings(room: ScribbleRoom): Array<{ userId: string; name: string; score: number; place: number }> {
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
