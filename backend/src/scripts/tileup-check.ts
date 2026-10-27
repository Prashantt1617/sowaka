/**
 * Checks Tile Up's server half with no database and no Redis: the rules (the
 * page's own, ported), the dictionary, the engine's turns and endings, and the
 * room service with a fake socket, a die and a clock moved by hand.
 *   npx tsx src/scripts/tileup-check.ts
 * Invites look colleagues up in the database; the live test covers them.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import blocked from '../content/scribble-blocked.json';
import { N, MID, evaluate, hasWord, words, rackValue, newBag, BAG } from '../services/tileup-rules';
import {
  TILEUP,
  advance,
  applyPass,
  applyPlay,
  applySwap,
  newRoom,
  removePlayer,
  startGame,
  turnIdOf,
  viewFor,
  TileUpMoveError,
} from '../services/tileup-engine';
import {
  Seat,
  TileUpError,
  configureTileUp,
  hostRoom,
  joinRoom,
  kickFromRoom,
  leaveRoom,
  passMove,
  peekRoom,
  playMove,
  setTileUpEmitter,
  settingsRoom,
  startRoom,
  againRoom,
  swapMove,
  tickTileUp,
} from '../services/tileup-room.service';
import { resetTileUpMemory, mutateRoom } from '../services/tileup-store';
import type { TileUpRoom } from '../models/tileup.model';

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}\n     ${(error as Error).message}`);
  }
}

const at = (r: number, c: number) => r * N + c;
const tiles = (r: number, c: number, word: string, dir: 'h' | 'v' = 'h', blanks: number[] = []) =>
  [...word].map((ch, i) => ({ r: dir === 'h' ? r : r + i, c: dir === 'h' ? c + i : c, ch, blank: blanks.includes(i) }));
/** A deterministic die. */
function die(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function main() {
  // ---------------------------------------------------------------- rules
  await check('dictionary: the page\'s 283,564 words, chai, selfie, qi and za in, xyzzy and rude words out', () => {
    assert.equal(words().size, 283_564);
    assert.ok(hasWord('chai') && hasWord('selfie') && hasWord('cat'));
    assert.ok(hasWord('qi') && hasWord('za') && hasWord('aa') && hasWord('xu') && hasWord('quixotry'));
    for (const word of blocked as string[]) assert.ok(!hasWord(word), `${word} is out`);
    assert.ok(!hasWord('xyzzy'));
  });
  await check('dictionary: the page carries the same list as the server', () => {
    const html = readFileSync(resolve(__dirname, '../../game-pages/tile-up.html'), 'utf8');
    const start = html.indexOf('const FC="') + 10;
    const packed = html.slice(start, html.indexOf('";', start));
    const page = new Set<string>();
    let prev = '';
    let i = 0;
    while (i < packed.length) {
      const k = packed.charCodeAt(i) - 48;
      i++;
      let j = i;
      while (j < packed.length) { const c = packed.charCodeAt(j); if (c >= 48 && c <= 57) break; j++; }
      const w = prev.slice(0, k) + packed.slice(i, j);
      page.add(w);
      prev = w;
      i = j;
    }
    assert.equal(page.size, words().size);
    for (const w of words()) assert.ok(page.has(w), `${w} missing from the page`);
  });
  await check('bag: 100 tiles, 2 blanks; rack value skips blanks', () => {
    assert.equal(newBag().length, 100);
    assert.equal(BAG['?'], 2);
    assert.equal(rackValue(['q', 'z', '?']), 20);
  });
  const empty = Array<string>(N * N).fill('');
  await check('first word must cross the centre, and be 2+ tiles', () => {
    assert.equal(evaluate(empty, tiles(0, 0, 'cat'), hasWord).why, 'centre');
    assert.equal(evaluate(empty, tiles(MID, MID, 'a'), hasWord).why, 'short');
  });
  await check('CAT across the centre scores (3+1+1)×2 = 10 (the centre is a double word)', () => {
    const e = evaluate(empty, tiles(MID, MID, 'cat'), hasWord);
    assert.ok(e.ok);
    assert.equal(e.score, 10);
    assert.deepEqual(e.words.map((w) => w.word), ['cat']);
  });
  await check('a blank scores 0 and the bad word is named', () => {
    const blank = evaluate(empty, tiles(MID, MID, 'cat', 'h', [0]), hasWord);
    assert.equal(blank.score, 4);
    const bad = evaluate(empty, tiles(MID, MID, 'qzx'), hasWord);
    assert.equal(bad.why, 'word');
    assert.equal(bad.words[0].known, false);
  });
  const board = empty.slice();
  for (const t of tiles(MID, MID, 'cat')) board[at(t.r, t.c)] = t.ch;
  await check('shapes: line, gap, alone, taken', () => {
    assert.equal(evaluate(board, [{ r: 8, c: 7, ch: 'a' }, { r: 9, c: 8, ch: 't' }], hasWord).why, 'line');
    assert.equal(evaluate(board, [{ r: 8, c: 7, ch: 'a' }, { r: 10, c: 7, ch: 't' }], hasWord).why, 'gap');
    assert.equal(evaluate(board, tiles(0, 0, 'at'), hasWord).why, 'alone');
    assert.equal(evaluate(board, [{ r: MID, c: MID, ch: 'a' }], hasWord).why, 'taken');
  });
  await check('a play down from C makes CAT/COT-style words and scores cross words', () => {
    const e = evaluate(board, tiles(8, 7, 'ow', 'v'), hasWord); // C + O + W = cow, down from the C
    assert.ok(e.ok, e.why);
    assert.equal(e.words[0].word, 'cow');
  });
  await check('all 7 tiles: +50', () => {
    const e = evaluate(empty, tiles(MID, 4, 'letters'), hasWord);
    assert.ok(e.ok, e.why);
    assert.ok(e.all7);
    assert.equal(e.score, e.words.reduce((n, w) => n + w.score, 0) + 50);
  });

  // ---------------------------------------------------------------- engine
  const A = { userId: 'a', name: 'Ananya Rao', photoUrl: null };
  const B = { userId: 'b', name: 'Bilal Khan', photoUrl: null };
  const C = { userId: 'c', name: 'Chitra Iyer', photoUrl: null };
  const fresh = (): TileUpRoom => {
    const room = newRoom('4821', 'sowaka', A, 0);
    room.players.push({ ...B, score: 0, joinedAt: 1, online: true, offlineAt: null });
    startGame(room, 1000, die(), 'g1');
    return room;
  };
  await check('start: 7 each from a 100-tile bag, a first player, a turn clock of secs + 2', () => {
    const room = fresh();
    assert.equal(room.status, 'playing');
    assert.equal(room.racks.a.length, 7);
    assert.equal(room.racks.b.length, 7);
    assert.equal(room.bag.length, 86);
    assert.equal(room.turnNo, 1);
    assert.equal(room.endsAt, 1000 + (60 + 2) * 1000);
  });
  await check('a view holds only your own tiles', () => {
    const room = fresh();
    const v = viewFor(room, 'a', 1000);
    assert.deepEqual(v.rack, room.racks.a);
    assert.equal(JSON.stringify(v).includes(JSON.stringify(room.racks.b)), false);
    assert.equal(v.players.find((p) => p.userId === 'b')?.tiles, 7);
    assert.equal(v.bag, 86);
  });
  await check('a refused play is not a turn: still yours, nothing written', () => {
    const room = fresh();
    const me = turnIdOf(room)!;
    room.racks[me] = ['q', 'z', 'x', 'a', 'b', 'c', 'd'];
    const { verdict } = applyPlay(room, me, tiles(MID, MID, 'qzx'), 2000);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.why, 'word');
    assert.deepEqual(verdict.bad, ['qzx']);
    assert.equal(turnIdOf(room), me);
    assert.equal(room.board.filter(Boolean).length, 0);
  });
  await check('not your turn / tiles not in your rack / too late', () => {
    const room = fresh();
    const me = turnIdOf(room)!;
    const other = me === 'a' ? 'b' : 'a';
    assert.equal(applyPlay(room, other, tiles(MID, MID, 'at'), 2000).verdict.why, 'turn');
    room.racks[me] = ['b', 'b', 'b', 'b', 'b', 'b', 'b'];
    assert.equal(applyPlay(room, me, tiles(MID, MID, 'at'), 2000).verdict.why, 'rack');
    assert.equal(applyPlay(room, me, tiles(MID, MID, 'bb'), room.endsAt + 1).verdict.why, 'late');
  });
  await check('a good play: on the board, scored, rack refilled from the bag, next turn', () => {
    const room = fresh();
    const me = turnIdOf(room)!;
    room.racks[me] = ['c', 'a', 't', 'e', 'e', 'e', 'e'];
    const bagBefore = room.bag.length;
    const { verdict } = applyPlay(room, me, tiles(MID, MID, 'cat'), 2000);
    assert.ok(verdict.ok);
    assert.equal(verdict.score, 10);
    assert.equal(verdict.rack?.length, 7);
    assert.equal(room.bag.length, bagBefore - 3);
    assert.equal(room.board[at(MID, MID)], 'c');
    assert.notEqual(turnIdOf(room), me);
    assert.equal(room.turnNo, 2);
    assert.equal(room.last?.kind, 'play');
    assert.equal(room.bestWord?.word, 'cat');
  });
  await check('swap: 1 to 3 tiles, bag of 7+, ends the turn; refusals', () => {
    const room = fresh();
    const me = turnIdOf(room)!;
    assert.throws(() => applySwap(room, me, ['x', 'y', 'z', 'w'].slice(0, 4), 2000, die()), TileUpMoveError);
    const rack = room.racks[me];
    const out = applySwap(room, me, [rack[0]], 2000, die());
    assert.equal(out.rack.length, 7);
    assert.notEqual(turnIdOf(room), me);
    assert.equal(room.last?.kind, 'swap');
    const room2 = fresh();
    room2.bag = room2.bag.slice(0, 6);
    assert.throws(() => applySwap(room2, turnIdOf(room2)!, [room2.racks[turnIdOf(room2)!][0]], 2000, die()), /7 or more/);
  });
  await check('every player twice without scoring ends the game; each loses their tiles\' value', () => {
    const room = fresh();
    for (let i = 0; i < 4; i += 1) applyPass(room, turnIdOf(room)!, 2000 + i);
    assert.equal(room.status, 'over');
    assert.equal(room.ending?.outId, null);
    assert.equal(room.players[0].score, -rackValue(room.racks[room.players[0].userId]));
  });
  await check('going out with the bag empty takes everyone else\'s tiles', () => {
    const room = fresh();
    const me = turnIdOf(room)!;
    const other = me === 'a' ? 'b' : 'a';
    room.bag = [];
    room.racks[me] = ['c', 'a', 't'];
    room.racks[other] = ['q', 'z'];
    applyPlay(room, me, tiles(MID, MID, 'cat'), 2000);
    assert.equal(room.status, 'over');
    assert.equal(room.ending?.outId, me);
    assert.equal(room.ending?.bonus, 20);
    assert.equal(room.players.find((p) => p.userId === me)?.score, 10 + 20);
    assert.equal(room.players.find((p) => p.userId === other)?.score, -20);
  });
  await check('the clock running out passes the turn (a timeout)', () => {
    const room = fresh();
    const me = turnIdOf(room)!;
    assert.equal(advance(room, room.endsAt - 1), null);
    const effects = advance(room, room.endsAt);
    assert.ok(effects);
    assert.notEqual(turnIdOf(room), me);
    assert.equal(room.last?.kind, 'timeout');
    assert.ok(effects!.some((e) => e.type === 'feed' && e.item.kind === 'timeout'));
  });
  await check('leaving mid-game: tiles back in the bag; a game down to one ends', () => {
    const room = fresh();
    const bag = room.bag.length;
    removePlayer(room, 'b', 'leave', null, 3000, die());
    assert.equal(room.status, 'over');
    const room3 = newRoom('4821', 'sowaka', A, 0);
    room3.players.push({ ...B, score: 0, joinedAt: 1, online: true, offlineAt: null }, { ...C, score: 0, joinedAt: 2, online: true, offlineAt: null });
    startGame(room3, 1000, die(), 'g2');
    const before = room3.bag.length;
    removePlayer(room3, 'c', 'leave', null, 3000, die());
    assert.equal(room3.status, 'playing');
    assert.equal(room3.bag.length, before + 7);
    assert.equal(room3.order.includes('c'), false);
    void bag;
  });

  // ---------------------------------------------------------------- the room service
  let clock = 100_000;
  const sent: Array<{ to: string; event: string; payload: unknown }> = [];
  const pushes: unknown[] = [];
  const scores: Array<{ userId: string; score: number }> = [];
  const awards: Array<{ userId: string; points: number }> = [];
  configureTileUp({
    now: () => clock,
    random: die(3),
    notify: async (ids, input) => { pushes.push({ ids, input }); },
    recordScore: async (_org, player, score) => { scores.push({ userId: player.userId, score }); },
    awardPoints: async (award) => { awards.push({ userId: award.userId, points: award.points }); },
  });
  setTileUpEmitter({
    toUser: (to, event, payload) => sent.push({ to, event, payload }),
    toRoom: (_org, _code, event, payload) => sent.push({ to: '*', event, payload }),
    seat: () => undefined,
  });
  resetTileUpMemory();
  const sa: Seat = { userId: 'a', org: 'sowaka', name: 'Ananya Rao', photoUrl: null };
  const sb: Seat = { userId: 'b', org: 'sowaka', name: 'Bilal Khan', photoUrl: null };
  const sc: Seat = { userId: 'c', org: 'sowaka', name: 'Chitra Iyer', photoUrl: null };
  const sd: Seat = { userId: 'd', org: 'sowaka', name: 'Dev Shah', photoUrl: null };
  const se: Seat = { userId: 'e', org: 'sowaka', name: 'Esha Roy', photoUrl: null };
  const other: Seat = { userId: 'x', org: 'acme', name: 'Xavier', photoUrl: null };
  let code = '';
  await check('host: a four-digit room, you are its host, in the lobby, 60 s turns', async () => {
    const view = await hostRoom(sa);
    code = view.code;
    assert.match(code, /^[1-9]\d{3}$/);
    assert.equal(view.hostId, 'a');
    assert.equal(view.status, 'lobby');
    assert.equal(view.secs, 60);
    assert.equal(view.min, 2);
    assert.equal(view.max, 4);
  });
  await check('join: by code at your company only; another company\'s code reads as no room', async () => {
    await assert.rejects(joinRoom(other, code), (e: TileUpError) => e.status === 404);
    const view = await joinRoom(sb, code);
    assert.equal(view.players.length, 2);
    assert.ok(sent.some((s) => s.event === 'room:feed' && (s.payload as { kind: string }).kind === 'join'));
  });
  await check('settings: host only, 30, 60 or 120', async () => {
    await assert.rejects(settingsRoom(sb, { secs: 120 }), (e: TileUpError) => e.status === 403);
    await assert.rejects(settingsRoom(sa, { secs: 90 }), (e: TileUpError) => e.status === 400);
    assert.equal((await settingsRoom(sa, { secs: 30 })).secs, 30);
    assert.equal((await settingsRoom(sa, { secs: 120 })).secs, 120);
  });
  await check('full at 4: the fifth gets 409', async () => {
    await joinRoom(sc, code);
    await joinRoom(sd, code);
    await assert.rejects(joinRoom(se, code), (e: TileUpError) => e.status === 409);
    await leaveRoom(sd);
  });
  await check('kick: host only; removed for a minute, told so', async () => {
    await assert.rejects(kickFromRoom(sb, 'c'), (e: TileUpError) => e.status === 403);
    await kickFromRoom(sa, 'c');
    assert.ok(sent.some((s) => s.to === 'c' && s.event === 'room:kicked'));
    await assert.rejects(joinRoom(sc, code), (e: TileUpError) => e.status === 403);
    clock += TILEUP.kickCooldownMs + 1;
    await joinRoom(sc, code);
    await leaveRoom(sc);
  });
  await check('start: host only; then a turn; each player is sent only their own rack', async () => {
    await assert.rejects(startRoom(sb), (e: TileUpError) => e.status === 403);
    sent.length = 0;
    await startRoom(sa);
    const room = (await peekRoom('sowaka', code))!;
    assert.equal(room.status, 'playing');
    const states = sent.filter((s) => s.event === 'room:state') as Array<{ to: string; payload: { room: { rack: string[] } } }>;
    for (const s of states) assert.deepEqual(s.payload.room.rack, room.racks[s.to]);
  });
  await check('play over the socket API: a refused word keeps your turn, a good word scores', async () => {
    const room = (await peekRoom('sowaka', code))!;
    const me = turnIdOf(room)!;
    const seat = me === 'a' ? sa : sb;
    // Put known tiles in the mover's rack through the store, as a test hook.
    await mutateRoom('sowaka', code, (r) => { r.racks[me] = ['c', 'a', 't', 'q', 'z', 'x', 'e']; return true; });
    const bad = await playMove(seat, tiles(MID, MID, 'qzx'));
    assert.equal(bad.ok, false);
    assert.equal(bad.why, 'word');
    const notMine = await playMove(me === 'a' ? sb : sa, tiles(MID, MID, 'cat'));
    assert.equal(notMine.why, 'turn');
    const good = await playMove(seat, tiles(MID, MID, 'cat'));
    assert.ok(good.ok);
    assert.equal(good.score, 10);
    const after = (await peekRoom('sowaka', code))!;
    assert.notEqual(turnIdOf(after), me);
  });
  await check('swap and pass end the turn and reach the feed', async () => {
    const room = (await peekRoom('sowaka', code))!;
    const me = turnIdOf(room)!;
    const seat = me === 'a' ? sa : sb;
    sent.length = 0;
    await swapMove(seat, [room.racks[me][0]]);
    assert.ok(sent.some((s) => s.event === 'room:feed' && (s.payload as { kind: string }).kind === 'swap'));
    const next = turnIdOf((await peekRoom('sowaka', code))!)!;
    await passMove(next === 'a' ? sa : sb);
    assert.ok(sent.some((s) => s.event === 'room:feed' && (s.payload as { kind: string }).kind === 'pass'));
    await assert.rejects(passMove(next === 'a' ? sa : sb), (e: TileUpError) => e.status === 409);
  });
  await check('the tick: a turn past its clock times out', async () => {
    const room = (await peekRoom('sowaka', code))!;
    const me = turnIdOf(room)!;
    clock = room.endsAt + 1;
    await tickTileUp();
    const after = (await peekRoom('sowaka', code))!;
    assert.notEqual(turnIdOf(after), me);
    assert.equal(after.last?.kind, 'timeout');
  });
  await check('game over by passes: scores recorded, points paid once, podium carries the best word', async () => {
    for (let i = 0; i < 8; i += 1) {
      const room = (await peekRoom('sowaka', code))!;
      if (room.status !== 'playing') break;
      const me = turnIdOf(room)!;
      await passMove(me === 'a' ? sa : sb);
    }
    const room = (await peekRoom('sowaka', code))!;
    assert.equal(room.status, 'over');
    await new Promise((r) => setTimeout(r, 20));
    // Only positive scores go on the leaderboard (as Scribble's); every player is paid (0 for a score below 20).
    assert.equal(scores.length, room.players.filter((p) => p.score > 0).length);
    assert.equal(awards.length, 2);
    const view = viewFor(room, 'a', clock);
    assert.equal(view.bestWord?.word, 'cat');
    assert.ok(view.ending);
  });
  await check('play again: host only, back to the lobby with zero scores', async () => {
    await assert.rejects(againRoom(sb), (e: TileUpError) => e.status === 403);
    await againRoom(sa);
    const room = (await peekRoom('sowaka', code))!;
    assert.equal(room.status, 'lobby');
    assert.ok(room.players.every((p) => p.score === 0));
  });
  await check('host leaves: the role passes; the last one out deletes the room', async () => {
    await leaveRoom(sa);
    const room = (await peekRoom('sowaka', code))!;
    assert.equal(room.hostId, 'b');
    await leaveRoom(sb);
    assert.equal(await peekRoom('sowaka', code), null);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
