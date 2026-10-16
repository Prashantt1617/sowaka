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
import { authSessions, companies, connectDb, connectPosts, gameCatalog, getDb, users } from '../config/db';
import type { User } from '../models/user.model';
import type { SquadSession } from '../models/secret-squad.model';
import { initConnectRealtime } from '../services/connect-realtime.service';
import { hashSessionToken } from '../services/auth.service';
import { mintTicket } from '../services/scribble-ticket.service';
import {
  SQUAD,
  SquadRuleError,
  advance,
  bonusFor,
  codeFor,
  codeWindowOf,
  dealRound,
  holderOf,
  joinSession,
  leaveSession,
  markOffline,
  markOnline,
  newSession,
  qrFor,
  scan,
  sessionViewFor,
  squadSizes,
  standingsOf,
  timeBonusAt,
} from '../services/secret-squad-engine';
import { configureSquad, openDueSessions, payPoints, roundConfig, squadPayouts, squadPointsFor, squadSchedules, tickSquad } from '../services/secret-squad.service';
import { initSquadRealtime, closeSquadRealtime } from '../services/secret-squad-realtime.service';
import { readSession, resetSquadMemory } from '../services/secret-squad-store';
import { SQUAD_BANK, categoryNamed, planNamed } from '../services/secret-squad-packs';
import type { NotificationInput } from '../services/notification.service';
import { pointEvents } from '../services/points-ledger.service';

if (!/scratch|check/i.test(env.mongoDbName)) {
  console.error(`Refusing to run against database "${env.mongoDbName}". Use MONGODB_DB=secret_squad_scratch.`);
  process.exit(1);
}

let failures = 0;
let passes = 0;
const check = (label: string, passed: boolean, detail = '') => {
  if (!passed) failures += 1;
  else passes += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail && !passed ? ` — ${detail}` : ''}`);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(label: string, predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true;
    await wait(25);
  }
  check(label, false, `timed out after ${timeoutMs}ms`);
  return false;
}

let seed = 7;
const die = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const seeded = (start: number) => {
  let x = start;
  return () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
};

// ------------------------------------------------------------- the rules

const t0 = Date.UTC(2026, 9, 16, 10, 0, 0);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const planRounds = (name: string) => planNamed(name)!.rounds.map((round) => roundConfig(round));
const session = (id: string, rounds: ReturnType<typeof roundConfig>[], players: number, prefix = id, department?: (i: number) => string) => {
  const s = newSession({ id, org: 'o', office: 'X', lobbyOpensAt: t0, startsAt: t0, rounds, codeSeed: id, now: t0 });
  for (let i = 0; i < players; i += 1) joinSession(s, { userId: `${prefix}${i}`, name: `${prefix.toUpperCase()} ${i}`, initials: 'P', department: department?.(i) }, t0);
  return s;
};
/** Deals the next round and moves into its hunt; returns when the hunt starts. */
const hunt = (s: SquadSession, at: number, random = die) => {
  dealRound(s, at, SQUAD_BANK, random);
  advance(s, s.phaseEndsAt);
  return s.round!.huntStartsAt;
};
const qrOf = (s: SquadSession, id: string, now: number) => qrFor(s, codeFor(s, id, now)!.code);
const refusal = (fn: () => unknown): SquadRuleError | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return error as SquadRuleError;
  }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const view = (s: SquadSession, id: string, now: number): any => sessionViewFor(s, id, now);
const partnersOf = (s: SquadSession) => {
  const out = new Map<string, string[]>();
  for (const round of [...s.history, ...(s.round ? [s.round] : [])]) {
    for (const squad of round.squads) for (const id of squad.members) out.set(id, [...(out.get(id) ?? []), ...squad.members.filter((m) => m !== id)]);
  }
  return out;
};
const repeatPairs = (s: SquadSession) => {
  const seen = new Map<string, number>();
  for (const round of [...s.history, ...(s.round ? [s.round] : [])]) {
    for (const squad of round.squads) {
      for (let i = 0; i < squad.members.length; i += 1) {
        for (let j = i + 1; j < squad.members.length; j += 1) {
          const key = [squad.members[i], squad.members[j]].sort().join('|');
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return [...seen.values()].filter((n) => n > 1).length;
};
/** Plays every round of a session to its clock, no scans. */
const playOut = (s: SquadSession, random: () => number) => {
  let at = s.startsAt;
  while (s.status !== 'over') {
    hunt(s, at, random);
    advance(s, s.round!.endsAt);
    at = s.phaseEndsAt;
  }
};

function unitChecks() {
  console.log('\nsquad sizes and bonuses');
  check('140 players, squads of 10 → 14 × 10', same(squadSizes(140, 10), Array(14).fill(10)));
  check('43 players, squads of 6 → one 7 and six 6s', same(squadSizes(43, 6), [7, 6, 6, 6, 6, 6, 6]));
  check('13 players in pairs → five pairs and a trio', same(squadSizes(13, 2), [3, 2, 2, 2, 2, 2]));
  check('14 players in pairs → 7 pairs', same(squadSizes(14, 2), Array(7).fill(2)));
  check('7 players, squads of 5 → 4, 3', same(squadSizes(7, 5), [4, 3]));
  check('146 players, squads of 10 → 15 squads, none over 10 words', squadSizes(146, 10).length === 15 && Math.max(...squadSizes(146, 10)) <= 10);
  check('squads cap at the categories there are (250 in 5s, 42 categories → 42 squads)', squadSizes(250, 5, 42).length === 42);
  check('bonus: standard squad +200', bonusFor(5, 5) === 200);
  check('bonus: a squad of 4 in a round of 5s +300', bonusFor(4, 5) === 300);
  check('bonus: a trio in a round of pairs +100', bonusFor(3, 2) === 100);
  check('time bonus: 90 s left → +45 (and 91.9 s → +45)', timeBonusAt({ endsAt: t0 + 90_000 }, t0).timeBonus === 45 && timeBonusAt({ endsAt: t0 + 91_900 }, t0).timeBonus === 45);

  console.log('\ncategories and words from the plan');
  const k = session('k', planRounds('Kolkata'), 14);
  hunt(k, t0);
  const kolkata1 = planNamed('Kolkata')!.rounds[0].categories;
  check('Kolkata round 1: 7 pairs, the plan\'s 7 categories in list order', same(k.round!.squads.map((sq) => sq.category), kolkata1));
  check('each squad has its category\'s first words, member i holds word i', k.round!.squads.every((sq) =>
    same(sq.words, categoryNamed(sq.category)!.words.slice(0, sq.members.length))
    && sq.members.every((id, i) => k.players.find((p) => p.userId === id)!.word === sq.words[i])));
  const words = k.round!.squads.flatMap((sq) => sq.words);
  check('a word is used once per round', new Set(words).size === words.length);
  check('the category is secret during the hunt', view(k, 'k0', k.round!.huntStartsAt + 1).round.squad.category === null);
  const n = session('n', planRounds('Noida'), 43);
  hunt(n, t0);
  check('Noida round 1: the squad of 7 takes the first category (Pets, 7 words)', n.round!.squads[0].members.length === 7 && n.round!.squads[0].category === 'Pets' && n.round!.squads[0].words.length === 7);
  check('…and each squad of 6 its bonus +200, the 7 one +100', n.round!.squads[0].bonus === 100 && n.round!.squads.slice(1).every((sq) => sq.bonus === 200));
  const k16 = session('k16', planRounds('Kolkata'), 16);
  hunt(k16, t0);
  const kolkataAll = new Set(planNamed('Kolkata')!.rounds.flatMap((round) => round.categories));
  const extra = k16.round!.squads.map((sq) => sq.category).filter((c) => !kolkata1.includes(c));
  check('a short plan falls back to a bank category no Kolkata round plays', extra.length === 1 && !kolkataAll.has(extra[0]), extra.join());
  const hq = session('hq', planRounds('HQ'), 146);
  hunt(hq, t0);
  const hq1 = planNamed('HQ')!.rounds[0].categories;
  const hqExtra = hq.round!.squads.map((sq) => sq.category).filter((c) => !hq1.includes(c));
  check('HQ with 146: all 14 planned + 1 borrowed from a later round\'s list', hq.round!.squads.length === 15 && hqExtra.length === 1 && planNamed('HQ')!.rounds[1].categories.includes(hqExtra[0]), hqExtra.join());
  const loose = session('loose', [roundConfig({ squadSize: 3 })], 9);
  hunt(loose, t0);
  check('no plan: categories from the bank in order', same(loose.round!.squads.map((sq) => sq.category), SQUAD_BANK.slice(0, 3).map((c) => c.category)));

  console.log('\nsquads: no repeat partners');
  let kolkataOk = 0;
  let gurgaonOk = 0;
  const seeds = 20;
  for (let i = 0; i < seeds; i += 1) {
    const ks = session(`kr${i}`, planRounds('Kolkata'), 14);
    playOut(ks, seeded(101 + i));
    const partners = partnersOf(ks);
    if (ks.history.length + 1 === 5 && [...partners.values()].every((list) => list.length === 5 && new Set(list).size === 5)) kolkataOk += 1;
    const gs = session(`gr${i}`, planRounds('Gurgaon'), 13);
    playOut(gs, seeded(501 + i));
    if (repeatPairs(gs) === 0 && [...partnersOf(gs).values()].every((list) => new Set(list).size >= 5)) gurgaonOk += 1;
  }
  check(`14 people, 5 pair rounds: everyone has 5 different partners (${kolkataOk}/${seeds} seeds)`, kolkataOk === seeds);
  check(`13 people, 5 rounds of pairs + a trio: no pair twice (${gurgaonOk}/${seeds} seeds)`, gurgaonOk === seeds);
  const hqStarted = Date.now();
  const hqs = session('hqs', planRounds('HQ'), 140, 'h', (i) => `D${i % 12}`);
  playOut(hqs, seeded(9));
  check(`HQ 140: round 2's squads of 5 share no pair with round 1's squads of 10 (${Date.now() - hqStarted} ms for both deals)`, repeatPairs(hqs) === 0);

  console.log('\nscans');
  const q = session('q', [roundConfig({ squadSize: 4, huntMs: 600_000, breakMs: 60_000 }), roundConfig({ squadSize: 2, huntMs: 300_000 })], 12, 'q', (i) => `D${i}`);
  const T = hunt(q, t0) + 1000;
  const [A, B, C, D] = q.round!.squads[0].members;
  const [X, Y, Z, W] = q.round!.squads[1].members;
  const nameOf = (id: string) => q.players.find((p) => p.userId === id)!.name;
  const wordOf = (id: string) => q.players.find((p) => p.userId === id)!.word;
  const typed = refusal(() => scan(q, A, { code: codeFor(q, B, T)!.code }, T));
  check('a typed code is refused (scan only)', typed?.status === 400, typed?.message);
  check('the state carries no code to type', view(q, A, T).round.me.code === null && /^SQ1:/.test(view(q, A, T).round.me.qr));
  const right = scan(q, A, { qr: qrOf(q, B, T) }, T);
  check('right scan: +100 to both', right.result === 'right' && right.delta === 100 && q.totals[A] === 100 && q.totals[B] === 100);
  const scannedB = view(q, B, T).round.scan;
  check('the scanned player sees "[Name] scanned you", the same result and points', scannedB.role === 'scanned' && scannedB.result === 'right' && scannedB.other.name === nameOf(A) && scannedB.other.word === wordOf(A) && scannedB.delta === 100 && scannedB.before === 0 && scannedB.after === 100);
  const scannerA = view(q, A, T).round.scan;
  check('the scanner sees the other\'s name and word', scannerA.role === 'scanner' && scannerA.other.word === wordOf(B) && typeof scannerA.id === 'string');
  const again = scan(q, A, { qr: qrOf(q, B, T + 1000) }, T + 1000);
  check('re-scanning someone linked costs nothing and says so', again.result === 'already' && again.delta === 0 && q.totals[A] === 100 && view(q, A, T + 1000).round.scan.result === 'already');
  scan(q, B, { qr: qrOf(q, C, T + 2000) }, T + 2000);
  const chain = scan(q, A, { qr: qrOf(q, C, T + 3000) }, T + 3000);
  const aSquad = view(q, A, T + 3000).round.squad;
  check('a chain link: A–B and B–C makes A–C linked (A scanning C is "already")', chain.result === 'already' && aSquad.members.length === 3 && aSquad.members.some((m: { userId: string; word: string }) => m.userId === C && m.word === wordOf(C)) && aSquad.more === 1);
  for (let i = 0; i < 4; i += 1) {
    const r = refusal(() => scan(q, A, { qr: qrOf(q, X, T + 4000 + i * 100) }, T + 4000 + i * 100));
    if (r) check(`wrong scan ${i + 1} is allowed`, false, r.message);
  }
  check('wrong scans: −25 to both, every time, with no pause (4 in a row)', q.totals[A] === 0 && q.totals[X] === -100);
  check('a score can go below 0', q.totals[X] < 0 && view(q, X, T + 4500).totalPoints === -100);
  const wrongX = view(q, X, T + 4500).round.scan;
  check('the wrongly scanned player sees it too, counting down', wrongX.result === 'wrong' && wrongX.role === 'scanned' && wrongX.delta === -25 && wrongX.before === -75 && wrongX.after === -100);
  check('no pause fields in the state', !('pausedUntil' in view(q, A, T + 4500).round.me) && !('wrongInARow' in view(q, A, T + 4500).round.me));
  const oldQrOfD = qrOf(q, D, T + 5000);
  const aQr = qrOf(q, A, T + 5000);
  const later = (codeWindowOf(T + 5000) + 1) * SQUAD.codeWindowMs + 100;
  const completing = scan(q, A, { qr: oldQrOfD }, later);
  const tb = timeBonusAt(q.round!, later).timeBonus;
  check('the previous window\'s QR still scans', completing.result === 'right');
  check('the last link completes the squad: +100 and +200 + the time bonus to each member', completing.completed && q.totals[A] === 0 + 100 + 200 + tb && q.totals[B] === 200 + 200 + tb && q.totals[C] === 100 + 200 + tb && q.totals[D] === 100 + 200 + tb, `tb ${tb}, A ${q.totals[A]}`);
  const done = view(q, B, later).round.squad;
  check('"squad complete" carries the category, the bonus and the time bonus apart', done.complete?.category === q.round!.squads[0].category && done.complete.bonus === 200 && done.complete.timeBonus === tb && done.complete.timeBonus > 0 && done.complete.after - done.complete.before === 200 + tb && done.category === q.round!.squads[0].category);
  check('both phones\' scan events say it completed', view(q, A, later).round.scan.completed === true && view(q, D, later).round.scan.completed === true);
  check('a complete squad\'s QRs stop', codeFor(q, A, later) === null && view(q, A, later).round.me.qr === null);
  const deadQr = refusal(() => scan(q, X, { qr: aQr }, later));
  check('…scanning one is refused, no points', deadQr?.status === 409 && /complete/.test(deadQr.message) && q.totals[X] === -100, deadQr?.message);
  check('…and its members can\'t scan', refusal(() => scan(q, A, { qr: qrOf(q, X, later) }, later))?.status === 409);
  check('holderOf finds nobody for a complete squad\'s code', holderOf(q, aQr.split(':')[3], later) === null);

  // Away: one of squad 3 goes offline a minute; the squad needs one fewer and sees their word.
  const [E, F, G, H] = q.round!.squads[2].members;
  markOffline(q, E, later);
  advance(q, later + SQUAD.awayMs + 1);
  const fSquad = view(q, F, later + SQUAD.awayMs + 1).round;
  check('60 s offline → away; their squad needs one fewer and sees their word', fSquad.squad.needed === 3 && fSquad.squad.awayMembers.some((m: { userId: string; word: string }) => m.userId === E && m.word === wordOf(E)) && fSquad.notice?.kind === 'teammate_away');
  const t2 = later + SQUAD.awayMs + 2000;
  scan(q, F, { qr: qrOf(q, G, t2) }, t2);
  scan(q, F, { qr: qrOf(q, H, t2) }, t2);
  check('…and completes without them; the away member gets no bonus', Boolean(q.round!.squads[2].finishedAt) && !q.round!.completions[E] && Boolean(q.round!.completions[F]));
  check('the round goes on while a squad is still hunting', q.status === 'hunt');
  scan(q, X, { qr: qrOf(q, Y, t2) }, t2);
  scan(q, X, { qr: qrOf(q, Z, t2) }, t2);
  scan(q, W, { qr: qrOf(q, Z, t2) }, t2);
  check('every squad complete ends the round early, into its break', q.status === 'break' && q.round!.overAt === t2 && t2 < q.round!.endsAt);
  const brk = view(q, B, t2);
  check('the break: rank in the office, points so far, my squad\'s category and words, top 5, countdown', brk.round.results.rank >= 1 && brk.round.results.total === q.totals[B] && brk.round.results.squad.category === q.round!.squads[0].category && same(brk.round.results.squad.words, q.round!.squads[0].words) && brk.round.results.top.length === 5 && brk.clock.breakEndsAt === t2 + 60_000);
  check('…the top 5 ranked by total, with ties', brk.round.results.top.every((row: { points: number }, i: number, all: Array<{ points: number }>) => i === 0 || all[i - 1].points >= row.points));
  markOnline(q, E, t2 + 1);
  advance(q, q.phaseEndsAt);
  const T2 = hunt(q, q.phaseEndsAt);
  void T2;
  const met = partnersOf({ ...q, round: null, history: q.history } as SquadSession);
  check('round 2 pairs avoid round 1 squadmates', q.round!.squads.every((sq) => !(met.get(sq.members[0]) ?? []).includes(sq.members[1])));
  advance(q, q.round!.endsAt);
  check('time out on the last round ends the game', q.status === 'over');
  check('a squad that never completes gets no time bonus', q.round!.squads.every((sq) => !sq.finishedAt && sq.timeBonus === undefined));
  const fin = view(q, A, q.round!.endsAt);
  check('the final: rank, total, my last squad, the whole office ranked', fin.final.rank >= 1 && fin.final.total === q.totals[A] && fin.final.lastSquad.roundNumber === 2 && fin.final.leaderboard.length === 12);

  console.log('\nodd-sized squads, ranks, the lobby');
  const odd = session('odd', [roundConfig({ squadSize: 5, huntMs: 300_000 })], 7);
  const To = hunt(odd, t0) + 1000;
  const trio = odd.round!.squads.find((sq) => sq.members.length === 3)!;
  check('7 players in a round of 5s: a 4 (+300) and a 3 (+400)', same(odd.round!.squads.map((sq) => sq.bonus).sort(), [300, 400]));
  scan(odd, trio.members[0], { qr: qrOf(odd, trio.members[1], To) }, To);
  scan(odd, trio.members[0], { qr: qrOf(odd, trio.members[2], To) }, To);
  const oddTb = timeBonusAt(odd.round!, To).timeBonus;
  check('the short squad completing pays +400 + time bonus each', odd.round!.completions[trio.members[1]]?.bonus === 400 && odd.totals[trio.members[1]] === 100 + 400 + oddTb);
  const g = session('g', planRounds('Gurgaon'), 13);
  hunt(g, t0);
  check('13 in pairs: the trio\'s bonus is +100', g.round!.squads.find((sq) => sq.members.length === 3)?.bonus === 100);
  const r = session('r', [roundConfig({ squadSize: 2 })], 4);
  hunt(r, t0);
  r.totals = { r0: 300, r1: 100, r2: 100, r3: -25 };
  check('ranks 1, 2, 2, 4, with a negative last', same(standingsOf(r).map((row) => [row.userId, row.rank]), [['r0', 1], ['r1', 2], ['r2', 2], ['r3', 4]]));
  const lob = session('lob', [roundConfig({ squadSize: 2 })], 5);
  leaveSession(lob, 'lob4');
  check('leaving the lobby removes the player', lob.players.length === 4);
  const few = session('few', [roundConfig({ squadSize: 5 })], 3);
  dealRound(few, t0, SQUAD_BANK, die);
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
    socket.on('squad:state', (state: State) => client.states.push(state));
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
const dataOf = (ack: Ack) => (ack.ok ? ack.data : {}) as Record<string, unknown>;

async function liveChecks() {
  console.log('\na session over sockets');
  const people: User[] = Array.from({ length: 12 }, (_, i) => ({
    userId: `sq-${i + 1}`,
    name: `Player ${i + 1}`,
    email: `sq${i + 1}@sowaka.local`,
    org: ORG,
    location: i < 11 ? 'Gurgaon' : 'Noida',
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
  const round1 = ['Pets', 'Predators', 'Herbivores'];
  await squadSchedules().insertOne({
    id: 'live-1', org: ORG, office: 'Gurgaon', startsAt: new Date(startsAt), lobbyMs: SQUAD.defaults.lobbyMs,
    rounds: [
      roundConfig({ squadSize: 3, huntMs: 10 * 60_000, breakMs: 60_000, categories: round1 }),
      roundConfig({ squadSize: 2, huntMs: 5 * 60_000, categories: planNamed('Kolkata')!.rounds[1].categories }),
    ],
    status: 'scheduled', createdAt: new Date(), updatedAt: new Date(),
  });
  await connectPosts().insertOne({
    id: 'post-live-1', org: ORG, type: 'secret_squad', body: { sessionId: 'live-1', office: 'Gurgaon', status: 'scheduled' },
    author: { userId: 'sq-1', name: 'HR' }, publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  } as never);

  const ticket = (u: User) => mintTicket({ userId: u.userId, org: ORG, name: u.name });
  const gurgaon = people.filter((p) => p.location === 'Gurgaon' && p.userId !== 'sq-10' && p.userId !== 'sq-11');
  const clients: Client[] = [];
  clients.push(await open(gurgaon[0], { token }));
  for (const u of gurgaon.slice(1)) clients.push(await open(u, { ticket: ticket(u) }));
  const noida = await open(people[9], { ticket: ticket(people[9]) });
  const lateComer = await open(people[10], { ticket: ticket(people[10]) });
  await waitFor('everyone gets a first state', () => clients.every((c) => c.states.length > 0) && noida.states.length > 0 && lateComer.states.length > 0, 20_000);
  check('a browser token signs in too', clients[0].states.length > 0);
  check('before the lobby: no session, the next one is shown', clients[1].states[0].session === null && Boolean(clients[1].states[0].next));
  check('the office list wins over the profile (player 10 is in Noida)', noida.states[0].office === 'Noida' && noida.states[0].next === null);

  clock.now = startsAt - 5 * 60_000;
  await openDueSessions();
  check('the lobby opens 5 minutes before (the default), once', (await openDueSessions()) === 0 && Boolean(await readSession(ORG, 'live-1')));
  const push = pushes.at(-1);
  check('Gurgaon gets the push, Noida does not', Boolean(push) && push!.userIds.length === 10 && !push!.userIds.includes('sq-10') && push!.input.data.gameKey === 'secret-squad');
  await waitFor('watchers see the lobby open', () => latest(clients[1])?.status === 'lobby');
  check('Noida sees nothing of it', noida.states.every((s) => s.session === null));

  for (const c of clients) {
    const ack = await request(c, 'squad:join');
    if (!ack.ok) check(`join ${c.userId}`, false, ack.message);
  }
  await waitFor('the lobby counts 9', () => latest(clients[0])?.players === 9 && latest(clients[0])?.joined === true);
  await request(clients[8], 'squad:leave');
  await waitFor('leaving the lobby: 8', () => latest(clients[0])?.players === 8);
  await request(clients[8], 'squad:join');
  await waitFor('…and back: 9', () => latest(clients[0])?.players === 9);
  const late = await request(noida, 'squad:join');
  check('someone from another office cannot join', !late.ok && late.status === 404);

  await move(5 * 60_000);
  await waitFor('dealt: everyone has a word', () => clients.every((c) => Boolean(latest(c)?.round?.me?.word)));
  const dealt = latest(clients[0])!;
  check('the word reveal: round 1 of 2, squads of 3, a 10 s countdown', dealt.status === 'dealing' && dealt.roundNumber === 1 && dealt.roundCount === 2 && dealt.round.squadSize === 3 && dealt.clock.revealEndsAt === startsAt + SQUAD.dealMs);
  check('the rules ride along (+100 / −25 / +200 / ½ point a second)', dealt.rules.right === 100 && dealt.rules.wrong === -25 && dealt.rules.squadBonus === 200 && dealt.rules.timeBonusPerSecond === 0.5 && dealt.rules.typedCodes === false);
  check('no QR while dealing', clients.every((c) => latest(c)?.round?.me?.qr === null));
  const held = (await readSession(ORG, 'live-1'))!;
  check('the round\'s categories are the configured list, words in order', same(held.round!.squads.map((sq) => sq.category), round1) && held.round!.squads.every((sq) => same(sq.words, categoryNamed(sq.category)!.words.slice(0, 3))));
  await move(SQUAD.dealMs);
  await waitFor('the hunt starts with QRs and a clock', () => clients.every((c) => Boolean(latest(c)?.round?.me?.qr)) && latest(clients[0])?.clock.huntEndsAt === held.round!.endsAt);

  const byId = new Map(clients.map((c) => [c.userId, c]));
  const squadOf = (userId: string) => held.round!.squads.findIndex((sq) => sq.members.includes(userId));
  const a = clients[0];
  const mates = held.round!.squads[squadOf(a.userId)].members.filter((id) => id !== a.userId).map((id) => byId.get(id)!);
  const stranger = clients.find((c) => squadOf(c.userId) !== squadOf(a.userId))!;

  const right = await request(a, 'squad:scan', { qr: latest(mates[0])!.round!.me.qr });
  check('squad:scan resolves at once: right, +100', right.ok && dataOf(right).result === 'right' && dataOf(right).delta === 100 && dataOf(right).total === 100, JSON.stringify(right));
  await waitFor('the scanned phone shows "Player 1 scanned you", +100', () => latest(mates[0])?.round?.scan?.role === 'scanned' && latest(mates[0])?.round?.scan?.other?.name === 'Player 1' && latest(mates[0])?.totalPoints === 100);
  check('…both see each other\'s word', latest(a)!.round!.squad.members.length === 2 && latest(a)!.round!.scan.other.word === latest(mates[0])!.round!.me.word);
  const typed = await request(a, 'squad:check', { code: '1234' });
  check('a typed code is refused', !typed.ok && typed.status === 400);
  for (let i = 0; i < 3; i += 1) {
    const wrong = await request(a, 'squad:scan', { qr: latest(stranger)!.round!.me.qr });
    if (!wrong.ok || dataOf(wrong).result !== 'wrong') check(`wrong scan ${i + 1}`, false, JSON.stringify(wrong));
  }
  await waitFor('3 wrong scans: −25 each to both, no pause, below 0 for the stranger', () => latest(a)?.totalPoints === 25 && latest(stranger)?.totalPoints === -75 && latest(stranger)?.round?.scan?.result === 'wrong');
  await wait(1100); // the socket's own rate limit (2 a second, bursts of 5), not a game rule
  const fourth = await request(a, 'squad:scan', { qr: latest(stranger)!.round!.me.qr });
  check('a 4th wrong scan in a row is still allowed', fourth.ok && dataOf(fourth).result === 'wrong', JSON.stringify(fourth));

  const before = latest(mates[1])!.round!.me.qr;
  await move(SQUAD.codeWindowMs);
  await waitFor('the QR changes every 20 s', () => latest(mates[1])!.round!.me.qr !== before);
  const aOldQr = latest(a)!.round!.me.qr;
  const third = await request(mates[1], 'squad:scan', { qr: aOldQr });
  check('the third member scans in: right, and the squad completes', third.ok && dataOf(third).completed === true, JSON.stringify(third));
  await waitFor('"squad complete" with its category, +200 and the time bonus', () => latest(a)?.round?.squad?.complete?.category === held.round!.squads[squadOf(a.userId)].category && latest(a)?.round?.squad?.complete?.bonus === 200 && latest(a)?.round?.squad?.complete?.timeBonus > 0);
  const complete = latest(a)!.round!.squad.complete;
  check('the time bonus is ½ point per second left', complete.timeBonus === Math.floor(complete.secondsLeft * 0.5) && complete.after === complete.before + 200 + complete.timeBonus);
  check('a complete squad\'s QRs stop', latest(a)!.round!.me.qr === null);
  const dead = await request(stranger, 'squad:scan', { qr: aOldQr });
  check('…scanning one is refused', !dead.ok && dead.status === 409);

  const leaver = clients.find((c) => squadOf(c.userId) !== squadOf(a.userId) && c !== stranger)!;
  const leaverSquad = held.round!.squads[squadOf(leaver.userId)].members.filter((id) => id !== leaver.userId).map((id) => byId.get(id)!);
  leaver.socket.close();
  await wait(200);
  await move(SQUAD.awayMs + 1000);
  await waitFor('their squad is told they\'re away, and sees their word', () => latest(leaverSquad[0])?.round?.notice?.kind === 'teammate_away' && latest(leaverSquad[0])?.round?.squad?.awayMembers?.[0]?.word);
  check('…and now needs one fewer', latest(leaverSquad[0])!.round!.squad.needed === 2);

  await move(10 * 60_000);
  await waitFor('time out: the break, with results', () => latest(a)?.status === 'break' && Boolean(latest(a)?.round?.results));
  const res = latest(a)!.round!.results;
  check('the break: my rank, total, squad category and words, office top 5', res.rank >= 1 && res.total === latest(a)!.totalPoints && Boolean(res.squad.category) && res.squad.words.length === 3 && res.top.length === 5 && latest(a)!.clock.breakEndsAt > clock.now);
  await move(1000);
  await move(1000);
  check('nothing reaches the org leaderboard mid-game', awarded.length === 0 && (await squadPayouts().countDocuments({ sessionId: 'live-1' })) === 0, JSON.stringify(awarded));

  await move(60_000);
  await waitFor('round 2 dealt in pairs', () => latest(a)?.roundIndex === 1 && latest(a)?.status === 'dealing');
  check('the away player is not dealt in', latest(a)!.players === 8);
  await move(SQUAD.dealMs);
  await waitFor('round 2 hunt with QRs', () => latest(a)?.status === 'hunt' && Boolean(latest(a)?.round?.me?.qr));
  await request(lateComer, 'squad:join');
  await waitFor('someone joining mid-round waits for the next one', () => latest(lateComer)?.joined === true && latest(lateComer)?.playing === false);
  const second = (await readSession(ORG, 'live-1'))!;
  const met = new Map<string, string[]>();
  for (const sq of second.history[0].squads) for (const id of sq.members) met.set(id, sq.members);
  check('round 2 pairs avoid round 1 squadmates', second.round!.squads.every((sq) => !(met.get(sq.members[0]) ?? []).includes(sq.members[1])));
  for (const squad of second.round!.squads) {
    const [first, ...rest] = squad.members.map((id) => byId.get(id)!);
    for (const other of rest) {
      const ack = await request(first, 'squad:scan', { qr: latest(other)!.round!.me.qr });
      if (!ack.ok) check(`round 2 scan ${first.userId} → ${other.userId}`, false, JSON.stringify(ack));
    }
  }
  await waitFor('everyone complete ends the last round, and the game', () => latest(a)?.status === 'over');
  const final = latest(a)!.final;
  check('the final: rank, total, last squad, the office leaderboard (9 dealt in)', final.rank >= 1 && final.total === latest(a)!.totalPoints && final.lastSquad.roundNumber === 2 && Boolean(final.lastSquad.category) && final.leaderboard.length === 9);
  const ended = (await readSession(ORG, 'live-1'))!;
  await waitFor('the card has its final standings', async () => {
    const card = await connectPosts().findOne({ id: 'post-live-1' });
    const body = (card?.body ?? {}) as { status?: string; results?: unknown[] };
    return body.status === 'over' && Array.isArray(body.results) && body.results.length === 9;
  });
  const card = (await connectPosts().findOne({ id: 'post-live-1' }))!.body as { endsAt: string; results: Array<Record<string, unknown>> };
  check('card results: {userId, name, initials, photoUrl, points, rank}, the session totals', card.results.every((row) => same(Object.keys(row).sort(), ['initials', 'name', 'photoUrl', 'points', 'rank', 'userId']) && row.points === (ended.totals[String(row.userId)] ?? 0)), JSON.stringify(card.results[0]) + JSON.stringify(ended.totals));
  check('…only those dealt in (not the mid-round joiner)', !card.results.some((row) => row.userId === 'sq-11'));
  check('…most points first, ranked 1, 2, 2, 4 on ties', card.results.every((row, i, all) => i === 0 || ((all[i - 1].points as number) >= (row.points as number) && row.rank === (all[i - 1].points === row.points ? all[i - 1].rank : i + 1))));
  check('…endsAt is the real end', card.endsAt === new Date(ended.round!.overAt!).toISOString());
  const finalPaid = awarded.filter((x) => x.round === -1);
  const aTotal = (card.results as Array<{ userId: string; points: number }>).find((r) => r.userId === a.userId)!.points;
  check('the game is paid once, at the end, as the other games: score ÷ 100, at most 25, never below 0',
    awarded.length === 1 && finalPaid.length === 1 && finalPaid[0].points[a.userId] === squadPointsFor(aTotal)
      && Object.values(finalPaid[0].points).every((v) => v >= 0 && v <= 25), JSON.stringify(awarded));
  check('…with its payout row in Mongo (survives restarts)', (await squadPayouts().countDocuments({ sessionId: 'live-1' })) === 1);
  check('squadPointsFor: 1,240 → 12, 3,000 → 25, −40 → 0', squadPointsFor(1240) === 12 && squadPointsFor(3000) === 25 && squadPointsFor(-40) === 0);
  const board = await request(a, 'squad:board', { sessionId: 'live-1' });
  check('squad:board gives the same standings', board.ok && same(dataOf(board).results, card.results), JSON.stringify(board).slice(0, 200));
  const elsewhere = await request(noida, 'squad:board', { sessionId: 'live-1' });
  check('…but not to another office', !elsewhere.ok && elsewhere.status === 404);
  for (const c of [...clients, noida, lateComer]) c.socket.close();

  // The real payout: a negative game adds nothing (never takes points away); a positive one adds its points.
  const before1 = (await users().findOne({ userId: 'sq-1' }))?.points ?? 0;
  const before2 = (await users().findOne({ userId: 'sq-2' }))?.points ?? 0;
  await payPoints(ended, -1, { 'sq-1': squadPointsFor(-40), 'sq-2': squadPointsFor(1240) });
  await wait(300);
  const [p1, p2] = await Promise.all([users().findOne({ userId: 'sq-1' }), users().findOne({ userId: 'sq-2' })]);
  const rows = await pointEvents().find({ refId: 'live-1' }).toArray();
  check('payPoints: a negative game leaves the balance, 1,240 adds 12, one ledger row', (p1?.points ?? 0) === before1 && (p2?.points ?? 0) === before2 + 12 && rows.length === 1 && rows[0].delta === 12, JSON.stringify(rows));
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
    console.log(failures ? `\n${failures} failed, ${passes} passed` : `\nall ${passes} checks passed`);
    process.exit(failures ? 1 : 0);
  }
})();
