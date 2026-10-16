/**
 * Checks Secret Squad end to end on a scratch database: the rules on their
 * own, then a whole session over real sockets with a hand-moved clock, then
 * the page routes. Refuses any database that isn't plainly a scratch one, and
 * drops it at the end.
 *
 *   MONGODB_DB=secret_squad_scratch NOTIFY_ORGS=sowaka EMAIL_ORGS=nobody-scratch npx tsx src/scripts/secret-squad-check.ts
 */
import { randomUUID } from 'node:crypto';
import { io as connect, Socket as ClientSocket } from 'socket.io-client';
import { app } from '../app';
import { env } from '../config/env';
import { authSessions, companies, connectDb, gameCatalog, getDb, users } from '../config/db';
import type { User } from '../models/user.model';
import type { SquadSession } from '../models/secret-squad.model';
import { initConnectRealtime } from '../services/connect-realtime.service';
import { hashSessionToken } from '../services/auth.service';
import { mintTicket } from '../services/scribble-ticket.service';
import {
  SQUAD,
  answerCheck,
  advance,
  codeFor,
  dealRound,
  holderOf,
  joinSession,
  leaveSession,
  markOffline,
  markOnline,
  newSession,
  planNextRound,
  squadSizes,
  startCheck,
  sessionViewFor,
} from '../services/secret-squad-engine';
import { chooseThemes, configureSquad, openDueSessions, roundConfig, squadSchedules, tickSquad } from '../services/secret-squad.service';
import { initSquadRealtime, closeSquadRealtime } from '../services/secret-squad-realtime.service';
import { readSession, resetSquadMemory } from '../services/secret-squad-store';
import type { SquadPack } from '../services/secret-squad-packs';
import type { NotificationInput } from '../services/notification.service';

if (!/scratch|check/i.test(env.mongoDbName)) {
  console.error(`Refusing to run against database "${env.mongoDbName}". Use MONGODB_DB=secret_squad_scratch.`);
  process.exit(1);
}

let failures = 0;
const check = (label: string, passed: boolean, detail = '') => {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail && !passed ? ` — ${detail}` : ''}`);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(label: string, predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await wait(25);
  }
  check(label, false, `timed out after ${timeoutMs}ms`);
  return false;
}

/** 40 themes of 26 words in 10 packs, so any round size can be dealt. */
const PACKS: SquadPack[] = Array.from({ length: 10 }, (_, p) => ({
  id: `pack-${p + 1}`,
  name: `Pack ${p + 1}`,
  difficulty: 'medium' as const,
  themes: Array.from({ length: 4 }, (_, t) => ({
    name: `Theme ${p + 1}.${t + 1}`,
    words: Array.from({ length: 26 }, (_, w) => `W${p + 1}${String.fromCharCode(65 + t)}${w + 1}`),
    traps: '',
  })),
}));

let seed = 7;
const die = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

// ------------------------------------------------------------- the rules

function unitChecks() {
  console.log('\nsquad sizes');
  const same = (a: number[], b: number[]) => JSON.stringify(a) === JSON.stringify(b);
  check('20 players, squads of 5 → 5,5,5,5', same(squadSizes(20, 5), [5, 5, 5, 5]));
  check('7 players, squads of 5 → 4,3', same(squadSizes(7, 5), [4, 3]));
  check('4 players, squads of 5 → 2,2', same(squadSizes(4, 5), [2, 2]));
  const big = squadSizes(155, 20);
  check('155 players, squads of 20 → 8 squads of 19–20', big.length === 8 && big.reduce((a, b) => a + b, 0) === 155 && Math.max(...big) - Math.min(...big) <= 1, String(big));
  const pairs = squadSizes(155, 2);
  check('155 players in pairs → 77 squads, one of 3', pairs.length === 77 && pairs.filter((n) => n === 3).length === 1, String(pairs.length));
  check('at most N squads when themes run short', squadSizes(155, 2, 40).length === 40);

  console.log('\nthemes');
  configureSquad({ packs: () => PACKS, random: die });
  const themes = chooseThemes(6, 20, [], new Map(), die);
  check('6 themes picked from whole packs', themes.length === 6 && new Set(themes.map((t) => t.packId)).size === 2);
  const fresh = chooseThemes(4, 20, ['pack-1', 'pack-2'], new Map(), die);
  check('packs already used this session come last', fresh.every((t) => t.packId !== 'pack-1' && t.packId !== 'pack-2'));
  const recent = chooseThemes(4, 20, [], new Map(PACKS.slice(0, 9).map((p, i) => [p.id, i])), die);
  check('packs used lately at the company come after unused ones', recent.every((t) => t.packId === 'pack-10'));

  console.log('\ncodes');
  const t0 = Date.UTC(2026, 9, 16, 10, 0, 0);
  const s = newSession({ id: 'u1', org: 'o', office: 'X', lobbyOpensAt: t0, startsAt: t0 + 1000, rounds: [roundConfig({ squadSize: 5 })], codeSeed: 'seed', now: t0 });
  for (let i = 0; i < 250; i += 1) joinSession(s, { userId: `p${i}`, name: `P ${i}`, initials: 'P', department: `D${i % 7}` }, t0);
  // 40 test themes: 250 players aiming at 5 get 40 squads of 6–7 instead.
  const sizes = planNextRound(s, t0 + 1000, 40);
  dealRound(s, t0 + 1000, sizes, chooseThemes(sizes.length, Math.max(...sizes), [], new Map(), die), die);
  check('250 players, 40 themes → 40 squads of 6–7', s.round!.squads.length === 40 && s.status === 'dealing' && s.round!.squads.every((sq) => sq.members.length >= 6 && sq.members.length <= 7));
  advance(s, s.phaseEndsAt);
  const at = s.round!.huntStartsAt + 5_000;
  const codes = s.players.map((p) => codeFor(s, p.userId, at)!.code);
  check('every code is different', new Set(codes).size === 250);
  check('a code finds its holder', s.players.every((p, i) => holderOf(s, codes[i], at) === p.userId));
  check('the previous code still works for one window', holderOf(s, codes[0], at + SQUAD.codeWindowMs) === 'p0');
  check('a code two windows old does not', holderOf(s, codes[0], at + 2 * SQUAD.codeWindowMs) !== 'p0' || codeFor(s, 'p0', at + 2 * SQUAD.codeWindowMs)!.code === codes[0]);
  const departments = s.round!.squads.map((sq) => new Set(sq.members.map((id) => s.players.find((p) => p.userId === id)!.department)).size);
  check('teams spread across squads (7 departments, no two teammates in a squad of ≤7)', departments.every((n, i) => n === Math.min(7, s.round!.squads[i].members.length)), String(departments.slice(0, 8)));

  console.log('\nchecks, locks, away, finishing, points');
  const q = newSession({ id: 'u2', org: 'o', office: 'X', lobbyOpensAt: t0, startsAt: t0 + 1000, rounds: [roundConfig({ squadSize: 3, huntMs: 600_000, breakMs: 60_000 }), roundConfig({ squadSize: 2, huntMs: 300_000 })], codeSeed: 'q', now: t0 });
  for (let i = 0; i < 9; i += 1) joinSession(q, { userId: `q${i}`, name: `Q ${i}`, initials: 'Q', department: `D${i}` }, t0);
  check('advance at the start asks for a deal', advance(q, t0 + 1000).kind === 'deal');
  const qs = planNextRound(q, t0 + 1000, 999);
  dealRound(q, t0 + 1000, qs, chooseThemes(qs.length, 3, [], new Map(), die), die);
  advance(q, q.phaseEndsAt);
  const T = q.round!.huntStartsAt + 1000;
  const sq0 = q.round!.squads[0].members;
  const otherSquad = q.round!.squads[1].members;
  const code = (id: string, now = T) => codeFor(q, id, now)!.code;
  const ask = startCheck(q, sq0[0], { code: code(sq0[1]) }, T) as { askId: string };
  check('a check asks the other person first', typeof ask.askId === 'string' && sessionViewFor(q, sq0[1], T).round?.ask !== null);
  let refused = '';
  try { startCheck(q, sq0[0], { code: code(sq0[2]) }, T); } catch (error) { refused = (error as Error).message; }
  check('one open check at a time', /Finish the check/.test(refused), refused);
  answerCheck(q, sq0[1], ask.askId, true, T + 1000);
  check('allowed, same squad → linked, both see each other\'s word', q.round!.edges.length === 1 && (sessionViewFor(q, sq0[0], T).round?.squad as { linked: unknown[] }).linked.length === 2);
  const again = startCheck(q, sq0[1], { code: code(sq0[0]) }, T + 2000);
  check('checking someone already linked costs nothing', 'already' in again && q.round!.asks.length === 0);
  const wrong = startCheck(q, sq0[0], { code: code(otherSquad[0]) }, T + 3000) as { askId: string };
  answerCheck(q, otherSquad[0], wrong.askId, true, T + 4000);
  const lockA = q.players.find((p) => p.userId === sq0[0])!.lockedUntil;
  check('different squads → both locked for the lock time', lockA === T + 4000 + 45_000 && q.players.find((p) => p.userId === otherSquad[0])!.lockedUntil === lockA);
  refused = '';
  try { startCheck(q, sq0[0], { code: code(sq0[2]) }, T + 5000); } catch (error) { refused = (error as Error).message; }
  check('a locked player cannot check', /paused/.test(refused), refused);
  const intoLocked = startCheck(q, sq0[2], { code: code(sq0[0], T + 6000) }, T + 6000) as { askId: string };
  check('…but a locked player can still be checked', typeof intoLocked.askId === 'string');
  answerCheck(q, sq0[0], intoLocked.askId, false, T + 7000);
  check('turning a check down tells the asker', (sessionViewFor(q, sq0[2], T + 7000).round?.result as { kind: string }).kind === 'declined');
  const timeout = startCheck(q, sq0[2], { code: code(sq0[1], T + 8000) }, T + 8000) as { askId: string };
  advance(q, T + 8000 + SQUAD.askMs + 1);
  check('an unanswered check expires', (sessionViewFor(q, sq0[2], T + 30_000).round?.result as { kind: string }).kind === 'expired' && !q.round!.asks.some((a) => a.id === timeout.askId));

  // Away: sq0[2] goes offline for a minute; the squad of 3 needs only the 2 already linked.
  markOffline(q, sq0[2], T + 31_000);
  advance(q, T + 31_000 + SQUAD.awayMs + 1);
  const finished = q.round!.squads[0];
  check('60 s offline → away, and a squad linked except for them is finished', q.players.find((p) => p.userId === sq0[2])!.away && Boolean(finished.finishedAt) && finished.place === 1);
  const teammateNotice = sessionViewFor(q, sq0[0], T + 95_000).round?.notice as { kind: string; word: string } | null;
  check('their squad is told, with their word', teammateNotice?.kind === 'teammate_away' && Boolean(teammateNotice.word));
  markOnline(q, sq0[2], T + 100_000);
  check('coming back to a finished squad keeps it finished', Boolean(q.round!.squads[0].finishedAt));

  // Away and back while the squad is still hunting: back unlinked.
  const sq1 = q.round!.squads[1].members;
  const link = startCheck(q, sq1[1], { code: code(sq1[2], T + 101_000) }, T + 101_000) as { askId: string };
  answerCheck(q, sq1[2], link.askId, true, T + 102_000);
  markOffline(q, sq1[2], T + 103_000);
  advance(q, T + 103_000 + SQUAD.awayMs + 1);
  markOnline(q, sq1[2], T + 170_000);
  check('back before the end → present again but unlinked', !q.round!.edges.some((e) => e.a === sq1[2] || e.b === sq1[2]) && !q.players.find((p) => p.userId === sq1[2])!.away);

  // Time runs out.
  const end = advance(q, q.round!.endsAt);
  check('at 0:00 the round ends and goes to its break', end.kind === 'roundEnded' && q.status === 'break');
  const pts = q.round!.points!;
  const expected = 40 * 2 + Math.floor((q.round!.endsAt - finished.finishedAt!) / 1000 * 0.5);
  check('points: 40 per linked member + half the seconds left', pts[sq0[0]] === expected && pts[sq0[2]] === expected, `${pts[sq0[0]]} vs ${expected}`);
  check('an unfinished squad with nobody linked earns 0', q.round!.squads.slice(2).every((sq) => sq.members.every((id) => pts[id] === 0)));
  const results = sessionViewFor(q, sq0[0], q.round!.endsAt).round?.results as { squads: Array<{ place: number; theme: string; mine: boolean }>; points: number };
  check('the break shows every theme, places and my points', results.squads.length === 3 && results.squads[0].mine && results.squads[0].place === 1 && results.points === expected);
  check('the break ends in a new deal', advance(q, q.phaseEndsAt).kind === 'deal');
  const next = planNextRound(q, q.phaseEndsAt, 999);
  dealRound(q, q.phaseEndsAt, next, chooseThemes(next.length, Math.max(...next), q.packIds, new Map(), die), die);
  check('round 2 deals pairs with new words', q.roundIndex === 1 && q.round!.squads.every((sq) => sq.members.length >= 2 && sq.members.length <= 3) && q.history.length === 1);
  advance(q, q.phaseEndsAt);
  advance(q, q.round!.endsAt);
  check('the last round ends the session', q.status === 'over');
  check('totals add up across rounds', q.totals[sq0[0]] === expected + (q.round!.points![sq0[0]] ?? 0));

  console.log('\nfrom the review');
  // Leaving in a break keeps the player on the list (their old squad names
  // them): everyone's view still builds, and they are not dealt again.
  const lb = newSession({ id: 'u4', org: 'o', office: 'X', lobbyOpensAt: t0, startsAt: t0, rounds: [roundConfig({ squadSize: 3, huntMs: 60_000, breakMs: 30_000 }), roundConfig({ squadSize: 3 })], codeSeed: 'lb', now: t0 });
  for (let i = 0; i < 9; i += 1) joinSession(lb, { userId: `l${i}`, name: `L ${i}`, initials: 'L' }, t0);
  const lbs = planNextRound(lb, t0, 999);
  dealRound(lb, t0, lbs, chooseThemes(lbs.length, 3, [], new Map(), die), die);
  advance(lb, lb.phaseEndsAt);
  const ls0 = lb.round!.squads[0].members;
  const lk = startCheck(lb, ls0[0], { code: codeFor(lb, ls0[1], lb.round!.huntStartsAt + 1000)!.code }, lb.round!.huntStartsAt + 1000) as { askId: string };
  answerCheck(lb, ls0[1], lk.askId, true, lb.round!.huntStartsAt + 2000);
  advance(lb, lb.round!.endsAt);
  leaveSession(lb, ls0[1]);
  let threw = '';
  try { lb.players.forEach((p) => sessionViewFor(lb, p.userId, lb.round!.endsAt + 1000)); } catch (error) { threw = (error as Error).message; }
  check('someone leaving in a break: every view still builds', threw === '', threw);
  check('…and they stay listed, marked as left', lb.players.some((p) => p.userId === ls0[1] && p.left));
  advance(lb, lb.phaseEndsAt);
  const lbn = planNextRound(lb, lb.phaseEndsAt, 999);
  dealRound(lb, lb.phaseEndsAt, lbn, chooseThemes(lbn.length, Math.max(...lbn), lb.packIds, new Map(), die), die);
  check('…and are not dealt into the next round', !lb.round!.squads.some((sq) => sq.members.includes(ls0[1])));

  // Codes come from fixed seats: someone leaving doesn't move anyone's code.
  advance(lb, lb.phaseEndsAt);
  const at2 = lb.round!.huntStartsAt + 1000;
  const before = lb.players.filter((p) => p.playing).map((p) => codeFor(lb, p.userId, at2)!.code);
  joinSession(lb, { userId: 'late', name: 'Late', initials: 'L' }, at2);
  leaveSession(lb, 'late');
  const after = lb.players.filter((p) => p.playing).map((p) => codeFor(lb, p.userId, at2)!.code);
  check('codes don\'t move when someone joins or leaves mid-round', JSON.stringify(before) === JSON.stringify(after));
  const nextWindow = at2 + SQUAD.codeWindowMs;
  const renewed = lb.players.filter((p) => p.playing).map((p) => codeFor(lb, p.userId, nextWindow)!.code);
  check('a just-changed code can never be someone else\'s new one', before.every((c) => !renewed.includes(c)) && before.every((c, i) => holderOf(lb, c, nextWindow) === lb.players.filter((p) => p.playing)[i].userId));

  // Squads never bigger than a theme has words for.
  check('squads of 24 for 155 people stay at 24 or under', Math.max(...squadSizes(155, 24)) <= 24 && squadSizes(155, 24).reduce((a, b) => a + b, 0) === 155);
  check('squads of 20 for 49 people stay at 24 or under', Math.max(...squadSizes(49, 20)) <= 24);

  const few = newSession({ id: 'u3', org: 'o', office: 'X', lobbyOpensAt: t0, startsAt: t0, rounds: [roundConfig({ squadSize: 5 })], codeSeed: 'f', now: t0 });
  for (let i = 0; i < 3; i += 1) joinSession(few, { userId: `f${i}`, name: 'F', initials: 'F' }, t0);
  dealRound(few, t0, planNextRound(few, t0, 999), [], die);
  check('fewer than 4 players skips the round', Boolean(few.round?.skipped) && few.status === 'over');
}

// ------------------------------------------------------------- live, over sockets

const ORG = 'sowaka';
const PORT = 4318;
const BASE = `http://localhost:${PORT}`;
const clock = { now: Date.UTC(2026, 9, 16, 10, 0, 0) };
const pushes: Array<{ userIds: string[]; input: NotificationInput }> = [];
const awarded: Array<{ round: number; points: Record<string, number> }> = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = { v: number; session: any; next: unknown; office: string };
interface Client { userId: string; socket: ClientSocket; states: State[]; fatal: unknown[] }
const latest = (c: Client) => c.states.at(-1)?.session ?? null;

function open(user: User, auth: Record<string, string>): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(`${BASE}/squad`, { path: '/connect/socket', transports: ['websocket'], auth, reconnection: false });
    const client: Client = { userId: user.userId, socket, states: [], fatal: [] };
    socket.on('squad:state', (state: State) => {
      // A broadcast to watchers carries no `me`; a joined player never gets one.
      client.states.push(state);
    });
    socket.on('squad:fatal', (p: unknown) => client.fatal.push(p));
    socket.on('connect', () => resolve(client));
    socket.on('connect_error', (error: Error) => {
      socket.close();
      reject(error);
    });
  });
}
type Ack = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; message: string };
const request = (c: Client, event: string, payload: Record<string, unknown> = {}) =>
  new Promise<Ack>((resolve) => c.socket.timeout(4000).emit(event, payload, (err: unknown, res: Ack) => resolve(err ? { ok: false, status: 0, message: 'timeout' } : res)));
const move = async (ms: number) => {
  clock.now += ms;
  await tickSquad();
  await wait(80);
};

async function liveChecks() {
  console.log('\na session over sockets');
  const people: User[] = Array.from({ length: 12 }, (_, i) => ({
    userId: `sq-${i + 1}`,
    name: `Player ${i + 1}`,
    email: `sq${i + 1}@sowaka.local`,
    org: ORG,
    location: i < 10 ? 'Gurgaon' : 'Noida',
    department: `Team ${i % 4}`,
    lifecycleStatus: 'active',
  } as User));
  await users().insertMany(people);
  // The office list wins over the profile: player 10 plays in Noida.
  await getDb().collection('secret_squad_offices').insertOne({ org: ORG, userId: 'sq-10', office: 'Noida', updatedAt: new Date() });
  await companies().insertOne({ id: ORG, name: 'Sowaka', enabledTabs: ['games'], enabledGames: ['secret-squad'] } as never);
  await gameCatalog().insertOne({
    key: 'secret-squad', name: 'Secret Squad', kind: 'web', order: 60, active: true,
    html: '<!doctype html><html><head><meta charset="utf-8"><title>Secret Squad</title>\n<!--SQUAD-TICKET-->\n</head><body>page</body></html>',
    createdAt: new Date(), updatedAt: new Date(),
  } as never);
  const token = `tok-${randomUUID()}`;
  await authSessions().insertOne({ tokenHash: hashSessionToken(token), userId: 'sq-1', createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) } as never);

  const startsAt = clock.now + 10 * 60_000;
  await squadSchedules().insertOne({
    id: 'live-1', org: ORG, office: 'Gurgaon', startsAt: new Date(startsAt), lobbyMs: 3 * 60_000,
    rounds: [roundConfig({ squadSize: 3, huntMs: 10 * 60_000, breakMs: 60_000 }), roundConfig({ squadSize: 2, huntMs: 5 * 60_000 })],
    status: 'scheduled', createdAt: new Date(), updatedAt: new Date(),
  });

  const ticket = (u: User) => mintTicket({ userId: u.userId, org: ORG, name: u.name });
  const gurgaon = people.filter((p) => p.location === 'Gurgaon' && p.userId !== 'sq-10');
  const clients: Client[] = [];
  clients.push(await open(gurgaon[0], { token }));
  for (const u of gurgaon.slice(1)) clients.push(await open(u, { ticket: ticket(u) }));
  const noida = await open(people[9], { ticket: ticket(people[9]) });
  // The first state reads the profile, the office and the schedule from Mongo: slow on a remote cluster.
  await waitFor('everyone gets a first state', () => clients.every((c) => c.states.length > 0) && noida.states.length > 0, 20_000);
  check('a browser token signs in too', clients[0].states.length > 0);
  check('before the lobby: no session, the next one is shown', clients[1].states[0].session === null && Boolean(clients[1].states[0].next));
  check('the office list wins over the profile (player 10 is in Noida)', noida.states[0].office === 'Noida' && noida.states[0].next === null);

  clock.now = startsAt - 3 * 60_000;
  await openDueSessions();
  check('the lobby opens 3 minutes before, once', (await openDueSessions()) === 0 && Boolean(await readSession(ORG, 'live-1')));
  const push = pushes.at(-1);
  check('Gurgaon gets the push, Noida does not', Boolean(push) && push!.userIds.length === 9 && !push!.userIds.includes('sq-10') && push!.input.data.gameKey === 'secret-squad');
  await waitFor('watchers see the lobby open', () => latest(clients[1])?.status === 'lobby');
  check('Noida sees nothing of it', noida.states.every((s) => s.session === null));

  for (const c of clients) {
    const ack = await request(c, 'squad:join');
    if (!ack.ok) check(`join ${c.userId}`, false, ack.message);
  }
  await waitFor('the lobby counts 9', () => latest(clients[0])?.players === 9 && latest(clients[0])?.joined === true);
  const late = await request(noida, 'squad:join');
  check('someone from another office cannot join', !late.ok && late.status === 404);

  await move(3 * 60_000);
  await waitFor('dealt: everyone has a word', () => clients.every((c) => Boolean(latest(c)?.round?.player?.word)));
  check('9 players, squads of 3 → 3 squads', latest(clients[0])?.round?.board.squads === 3 && latest(clients[0])?.status === 'dealing');
  check('no codes while dealing', clients.every((c) => latest(c)?.round?.player?.code === null));
  await move(SQUAD.dealMs);
  await waitFor('the hunt starts with codes', () => clients.every((c) => Boolean(latest(c)?.round?.player?.code)));

  const session = (await readSession(ORG, 'live-1'))!;
  const byId = new Map(clients.map((c) => [c.userId, c]));
  const squadOf = (userId: string) => session.round!.squads.findIndex((sq) => sq.members.includes(userId));
  const a = clients[0];
  const mates = session.round!.squads[squadOf(a.userId)].members.filter((id) => id !== a.userId).map((id) => byId.get(id)!);
  const stranger = clients.find((c) => squadOf(c.userId) !== squadOf(a.userId))!;

  const ask1 = await request(a, 'squad:check', { code: latest(mates[0])!.round!.player.code });
  check('a check is sent', ask1.ok && typeof (ask1 as { data: { askId?: string } }).data.askId === 'string', JSON.stringify(ask1));
  await waitFor('the other phone is asked to allow it', () => Boolean(latest(mates[0])?.round?.ask));
  const askId = latest(mates[0])!.round!.ask.id;
  await request(mates[0], 'squad:answer', { askId, allow: true });
  await waitFor('both see "same squad"', () => latest(a)?.round?.result?.kind === 'match' && latest(mates[0])?.round?.result?.kind === 'match');
  check('and each other\'s word', latest(a)!.round!.squad.linked.length === 2 && latest(a)!.round!.result.otherWord === latest(mates[0])!.round!.player.word);

  const bad = await request(a, 'squad:check', { code: '00x0' });
  check('a malformed code is refused politely', !bad.ok && bad.status === 400);
  const qrAsk = await request(a, 'squad:check', { qr: latest(stranger)!.round!.player.qr });
  check('a scanned QR works like a typed code', qrAsk.ok, JSON.stringify(qrAsk));
  await waitFor('the stranger is asked', () => Boolean(latest(stranger)?.round?.ask));
  await request(stranger, 'squad:answer', { askId: latest(stranger)!.round!.ask.id, allow: true });
  await waitFor('different squads: both locked', () => (latest(a)?.round?.player?.lockedUntil ?? 0) > 0 && (latest(stranger)?.round?.player?.lockedUntil ?? 0) > 0);
  const locked = await request(a, 'squad:check', { code: latest(mates[1])!.round!.player.code });
  check('a locked player\'s check is refused with the time left', !locked.ok && /paused/.test((locked as { message: string }).message));

  // The third member links in by checking the first: the squad finishes.
  const before = latest(mates[1])!.round!.player.code;
  await move(SQUAD.codeWindowMs);
  await waitFor('the code changes every 20 s', () => latest(mates[1])!.round!.player.code !== before);
  const ask3 = await request(mates[1], 'squad:check', { code: latest(a)!.round!.player.code });
  check('a locked player can still be checked', ask3.ok, JSON.stringify(ask3));
  await waitFor('asked', () => Boolean(latest(a)?.round?.ask));
  await request(a, 'squad:answer', { askId: latest(a)!.round!.ask.id, allow: true });
  await waitFor('the squad finishes in 1st place with its theme shown', () => latest(a)?.round?.squad?.place === 1 && Boolean(latest(a)?.round?.squad?.theme));
  check('a finished squad\'s codes stop', latest(a)!.round!.player.code === null);

  // Someone in another squad drops: away after a minute, the squad is told.
  const leaver = clients.find((c) => squadOf(c.userId) !== squadOf(a.userId) && c !== stranger)!;
  const leaverSquad = session.round!.squads[squadOf(leaver.userId)].members.filter((id) => id !== leaver.userId).map((id) => byId.get(id)!);
  leaver.socket.close();
  await wait(200);
  await move(SQUAD.awayMs + 1000);
  await waitFor('their squad is told they left, with their word', () => latest(leaverSquad[0])?.round?.notice?.kind === 'teammate_away' && Boolean(latest(leaverSquad[0])?.round?.notice?.word));
  check('…and now needs one fewer', latest(leaverSquad[0])!.round!.squad.needed === 2);

  // Time runs out: the break, results and points, paid once.
  await move(10 * 60_000);
  await waitFor('the round ends into its break with results', () => latest(a)?.status === 'break' && Boolean(latest(a)?.round?.results));
  const res = latest(a)!.round!.results;
  check('results list every squad, mine first', res.squads.length === 3 && res.squads[0].mine && res.points > 0);
  await move(1000);
  check('points paid once for round 1', awarded.filter((x) => x.round === 0).length === 1 && awarded[0].points[a.userId] === res.points);

  // Round 2: pairs; someone joining in the break plays.
  await move(60_000);
  await waitFor('round 2 dealt in pairs', () => latest(a)?.roundIndex === 1 && latest(a)?.status === 'dealing');
  check('the player who left is not dealt in', latest(a)!.players === 8);
  await move(SQUAD.dealMs + 5 * 60_000);
  await waitFor('the last round ends the session', () => latest(a)?.status === 'over');
  check('totals carry across rounds', (latest(a)?.totalPoints ?? 0) >= res.points);
  check('the round count is right', latest(a)!.roundCount === 2);
  for (const c of [...clients, noida]) c.socket.close();
}

// ------------------------------------------------------------- the pages

async function pageChecks() {
  console.log('\npages');
  const token = (await authSessions().findOne({ userId: 'sq-1' })) ? null : null;
  void token;
  const web = await fetch(`${BASE}/squad`);
  const webHtml = await web.text();
  check('GET /squad serves the page for a browser', web.status === 200 && webHtml.includes('window.__SQUAD={"web":true}'));
  check('…allowed to reach this server', /connect-src 'self'/.test(web.headers.get('content-security-policy') ?? ''));
  const session = `tok-${randomUUID()}`;
  await authSessions().insertOne({ tokenHash: hashSessionToken(session), userId: 'sq-2', createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) } as never);
  const inApp = await fetch(`${BASE}/play/secret-squad`, { headers: { Authorization: `Bearer ${session}` } });
  const appHtml = await inApp.text();
  check('the app\'s copy carries a ticket and a hop', inApp.status === 200 && /window\.__SQUAD=\{"ticket":"[^"]+","hopTicket":"[^"]+"\}/.test(appHtml));
  const hop = /"hopTicket":"([^"]+)"/.exec(appHtml)?.[1] ?? '';
  const hopped = await fetch(`${BASE}/play/secret-squad?ticket=${encodeURIComponent(hop)}`);
  check('the hop serves it with a fresh ticket and a socket policy', hopped.status === 200 && (await hopped.text()).includes('"ticket"') && /connect-src 'self'/.test(hopped.headers.get('content-security-policy') ?? ''));
}

// ------------------------------------------------------------------ run

(async () => {
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    await connectDb();
    await getDb().dropDatabase();
    await connectDb();
    resetSquadMemory();
    unitChecks();

    configureSquad({
      now: () => clock.now,
      random: die,
      packs: () => PACKS,
      notify: async (userIds: string[], input: NotificationInput) => void pushes.push({ userIds, input }),
      awardPoints: async (_session: SquadSession, round: number, points: Record<string, number>) => void awarded.push({ round, points }),
    });
    server = app.listen(PORT);
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const io = initConnectRealtime(server);
    initSquadRealtime(io);
    await liveChecks();
    await pageChecks();
  } catch (error) {
    failures += 1;
    console.error(error);
  } finally {
    closeSquadRealtime();
    server?.close();
    await getDb().dropDatabase().catch(() => undefined);
    console.log(failures ? `\n${failures} failed` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
  }
})();
