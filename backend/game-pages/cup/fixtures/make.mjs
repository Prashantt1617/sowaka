#!/usr/bin/env node
/**
 * Writes the Cup page's mock states (fixtures/*.json), one per screen, from
 * one simulated 226-player Cup drawn the way the engine draws it
 * (backend/src/services/cup-rules.ts: 1 v N in round 1, free passes for the
 * top units in round 2, then a standard seeded bracket of 64).
 *
 *   node backend/game-pages/cup/fixtures/make.mjs
 *
 * Every fixture's clock is T0 (its `serverNow`); the mock server moves all
 * of its times by the same amount, so countdowns tick from the moment the
 * page opens. Names are made up.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse('2026-11-06T17:40:00+05:30');
const iso = (ms) => new Date(ms).toISOString();
const sec = (n) => n * 1000;

// ---------------------------------------------------------------- people
const FIRST = ['Aarav', 'Riya', 'Kabir', 'Neha', 'Arjun', 'Dev', 'Anika', 'Zoya', 'Ishaan', 'Pooja', 'Sana', 'Vihaan', 'Meera', 'Rohan', 'Tara', 'Kunal', 'Diya', 'Aditya', 'Nisha', 'Kiran', 'Rahul', 'Simran', 'Yash', 'Priya', 'Varun', 'Ira', 'Manav', 'Kavya', 'Sahil', 'Ananya', 'Nikhil', 'Rhea', 'Om', 'Lavanya', 'Kartik', 'Mira', 'Dhruv', 'Shreya', 'Aman', 'Isha'];
const LAST = ['Kapoor', 'Sethi', 'Arora', 'Mehta', 'Verma', 'Khan', 'Gill', 'Rao', 'Nair', 'Shah', 'Iyer', 'Bose', 'Das', 'Joshi', 'Malhotra', 'Reddy', 'Pillai', 'Bhatt', 'Chopra', 'Sen'];
const N = 226;
const people = [];
for (let i = 0; i < N; i += 1) {
  const name = `${FIRST[(i * 7) % FIRST.length]} ${LAST[(i * 3 + Math.floor(i / FIRST.length)) % LAST.length]}`;
  // Seed i+1: best scores fall with the seed; the last 31 never played.
  const best = i < N - 31 ? Math.round(5200 - i * 22.5 - (i % 3) * 7) : null;
  people.push({ userId: `u${String(i + 1).padStart(3, '0')}`, name, seed: i + 1, best });
}
const bySeed = (s) => people[s - 1];
const byId = new Map(people.map((p) => [p.userId, p]));
const ref = (p) => (p ? { userId: p.userId, name: p.name, seed: p.seed } : null);

// ---------------------------------------------------------------- the draw (cup-rules.ts buildDraw)
function bracketOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}
function buildDraw(entrants, topN) {
  const raw = [];
  const units = Math.ceil(entrants / 2);
  const odd = entrants % 2 === 1;
  const first = [];
  for (let k = 1; k <= units; k += 1) {
    if (odd && k === 1) first.push({ slot: k, feeders: ['e:1'] });
    else first.push({ slot: k, feeders: [`e:${k}`, `e:${odd ? entrants + 2 - k : entrants + 1 - k}`] });
  }
  raw.push(first);
  const size = 2 ** Math.floor(Math.log2(units));
  let places;
  if (units > size) {
    const passes = 2 * size - units;
    const second = [];
    for (let r = 1; r <= size; r += 1) second.push({ slot: r, feeders: r <= passes ? [`n:1:${r}`] : [`n:1:${r}`, `n:1:${2 * size + 1 - r}`] });
    raw.push(second);
    places = second.map((n) => `n:2:${n.slot}`);
  } else places = first.map((n) => `n:1:${n.slot}`);
  let level = bracketOrder(size).map((p) => places[p - 1]);
  while (level.length > 1) {
    const round = raw.length + 1;
    const nodes = [];
    for (let m = 0; m < level.length / 2; m += 1) nodes.push({ slot: m + 1, feeders: [level[2 * m], level[2 * m + 1]] });
    raw.push(nodes);
    level = nodes.map((n) => `n:${round}:${n.slot}`);
  }
  const total = raw.length;
  return raw.map((nodes, i) => {
    const n = i + 1;
    let label = `Round ${n}`;
    let short = `R${n}`;
    if (n === total) [label, short] = ['Final', 'F'];
    else if (n === total - 1) [label, short] = ['Semi-finals', 'SF'];
    else if (n === total - 2) [label, short] = ['Quarter-finals', 'QF'];
    const players = nodes.reduce((s, x) => s + x.feeders.length, 0);
    return { n, label, short, kind: players <= topN ? 'sequential' : 'parallel', nodes };
  });
}

// ---------------------------------------------------------------- one moment of the Cup
let rngState = 7;
const rng = () => {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
};

/**
 * The Cup at one moment. `at` = { round, stage } where stage is
 *   'scheduled' | 'lobby'                       (round 1, nothing played)
 *   'open' | 'live' | 'mixed'                   (a parallel round)
 *   { match: i, kind: 'betting'|'live'|'after' } (a sequential round, its i-th match on stage)
 *   'done'                                      (the final played)
 * `me` is the viewer's seed; `fate[round] = 'win'|'lose'` forces their matches.
 */
function moment({ me: meSeed, at, fate = {}, mine = {} }) {
  rngState = 7;
  const draw = buildDraw(N, 8);
  const total = draw.length;
  const me = bySeed(meSeed);
  const winnerOfNode = new Map(); // `n:r:s` → person
  const rounds = [];
  const curRound = at.stage === 'done' ? total + 1 : at.round;
  let meMatch = null;
  let meEliminatedIn = null;
  let meFreePass = null;
  let current = null;
  const resolve = (r) => (r.startsWith('e:') ? bySeed(Number(r.slice(2))) : winnerOfNode.get(r) ?? null);
  const scoreFor = (p, salt) => Math.round((p.best ?? 2200) * (0.55 + rng() * 0.4) + salt);

  for (const round of draw) {
    const matches = [];
    const byes = [];
    let matchNo = 0;
    const seqIndex = { i: 0 };
    for (const node of round.nodes) {
      const players = node.feeders.map(resolve);
      if (node.feeders.length === 1) {
        if (players[0]) {
          byes.push(players[0].userId);
          if (round.n <= curRound || round.n === curRound) winnerOfNode.set(`n:${round.n}:${node.slot}`, players[0]);
          if (players[0] === me) meFreePass = { round: round.n, boardRank: me.seed, seed: me.seed };
        }
        continue;
      }
      matchNo += 1;
      const [pa, pb] = players;
      const label = round.short === 'F' ? 'Final' : round.short === 'QF' || round.short === 'SF' ? `${round.short}${matchNo}` : `${round.label} · Match ${matchNo}`;
      const m = { id: `m-${round.n}-${node.slot}`, slot: node.slot, label, status: 'pending', a: ref(pa), b: ref(pb), attempt: 0 };
      // Who wins if it is played: forced for the viewer, the top 8 seeds stay in until the QF, else the better seed 70%.
      const decide = () => {
        if (!pa || !pb) return null;
        if (pa === me || pb === me) {
          const f = fate[round.n] ?? 'win';
          return f === 'win' ? me : pa === me ? pb : pa;
        }
        const top = (p) => p.seed <= 8 && round.short !== 'QF' && round.short !== 'SF' && round.short !== 'F';
        if (top(pa) !== top(pb)) return top(pa) ? pa : pb;
        const [hi, lo] = pa.seed < pb.seed ? [pa, pb] : [pb, pa];
        return rng() < 0.7 ? hi : lo;
      };
      const finish = (w) => {
        const l = w === pa ? pb : pa;
        let ws = scoreFor(w, 300);
        let ls = scoreFor(l, 0);
        if (ls >= ws) [ws, ls] = [ls + 140, ws];
        const absent = rng() < 0.06;
        m.status = 'done';
        m.result = { [w.userId]: ws, [l.userId]: absent ? 0 : ls };
        m.winnerId = w.userId;
        m.decidedBy = absent ? 'solo' : 'played';
        winnerOfNode.set(`n:${round.n}:${node.slot}`, w);
      };
      const isSeq = round.kind === 'sequential';
      if (round.n < curRound) finish(decide());
      else if (round.n === curRound && pa && pb) {
        const st = at.stage;
        if (st === 'scheduled' || st === 'lobby') m.status = 'scheduled';
        else if (isSeq) {
          const i = seqIndex.i++;
          const onStage = st.match;
          if (i < onStage || (i === onStage && st.kind === 'after')) finish(decide());
          else if (i === onStage) {
            if (st.kind === 'betting') {
              m.status = 'betting';
              m.bettingEndsAt = iso(T0 + sec(42));
            } else {
              m.status = 'live';
              m.startAt = iso(T0 - sec(27));
              m.live = { [pa.userId]: scoreFor(pa, 0) - 900, [pb.userId]: scoreFor(pb, 0) - 1000 };
            }
            current = { matchId: m.id, kind: st.kind };
          } else if (i === onStage + 1 && st.kind === 'after') {
            m.status = 'betting';
            m.bettingEndsAt = iso(T0 + sec(52));
            current = { matchId: m.id, kind: 'betting' };
          } else m.status = 'scheduled';
        } else if (st === 'open') {
          m.status = 'open';
          m.deadlineAt = iso(T0 + sec(150));
        } else if (st === 'live' || st === 'mixed') {
          const doneNow = st === 'mixed' && (matchNo % 3 !== 0 || pa === me || pb === me);
          if (doneNow) finish(decide());
          else {
            m.status = 'live';
            m.startAt = iso(T0 - sec(Math.floor(rng() * 30)));
            m.live = { [pa.userId]: Math.round(rng() * 1500), [pb.userId]: Math.round(rng() * 1500) };
          }
        }
      }
      if (pa === me || pb === me) {
        const opp = pa === me ? pb : pa;
        meMatch = { m, round: round.n, opp };
        if (m.status === 'done' && m.winnerId !== me.userId) meEliminatedIn = round.label;
      }
      matches.push(m);
    }
    const r = { n: round.n, label: round.label, short: round.short, kind: round.kind, byes, matches };
    if (round.n < curRound) {
      r.openedAt = iso(T0 - sec(60 * (curRound - round.n) * 3));
      r.closedAt = iso(T0 - sec(60 * (curRound - round.n) * 3 - 150));
    } else if (round.n === curRound && at.stage !== 'scheduled' && at.stage !== 'lobby') r.openedAt = iso(T0 - sec(40));
    rounds.push(r);
  }

  let phase = 'running';
  if (at.stage === 'scheduled') phase = 'scheduled';
  else if (at.stage === 'lobby') phase = 'lobby';
  else if (at.stage === 'done') phase = 'done';
  const lobbyAt = phase === 'scheduled' ? T0 + sec(60 * 47 + 12) : T0 - sec(60 * 15);
  const startAt = phase === 'lobby' ? T0 + sec(192) : phase === 'scheduled' ? lobbyAt + sec(300) : T0 - sec(60 * 10);
  const state = {
    success: true,
    serverNow: iso(T0),
    version: 100 + (at.round ?? 0) * 10,
    event: {
      id: 'diwali-2026',
      name: 'Diwali Cup',
      phase,
      round: Math.min(curRound, total),
      lobbyAt: iso(lobbyAt),
      startAt: iso(startAt),
      topN: 8,
      entrantCount: N,
      roundSec: 45,
      startWindowSec: 180,
      bettingSec: 60,
      countdownSec: 4,
      rounds,
    },
    me: {
      userId: me.userId,
      name: me.name,
      hr: false,
      entered: true,
      seed: me.seed,
      boardRank: me.best == null ? null : me.seed,
      best: me.best,
      alive: !meEliminatedIn,
      balance: mine.balance ?? 1250,
    },
  };
  if (meEliminatedIn) state.me.eliminatedIn = meEliminatedIn;
  if (meFreePass) state.me.freePass = meFreePass;
  if (meMatch) {
    const { m, round, opp } = meMatch;
    state.me.match = {
      id: m.id,
      label: m.label,
      round,
      status: m.status,
      opponent: opp ? { userId: opp.userId, name: opp.name, seed: opp.seed, best: opp.best } : null,
      attempt: m.attempt,
      joined: false,
      opponentJoined: false,
    };
    if (m.deadlineAt) state.me.match.deadlineAt = m.deadlineAt;
    if (m.startAt) state.me.match.startAt = m.startAt;
    if (m.result) state.me.match.result = m.result;
    if (m.winnerId) state.me.match.winnerId = m.winnerId;
  }
  if (current) state.current = current;
  return state;
}

// For bets: the on-stage match, and match lookups.
const findMatch = (s, id) => s.event.rounds.flatMap((r) => r.matches).find((m) => m.id === id);
const write = (name, state) => {
  writeFileSync(join(here, `${name}.json`), `${JSON.stringify(state, null, 1)}\n`);
  console.log(name, `${Math.round(JSON.stringify(state).length / 1024)} KB`);
};
const tipsters = (meId) => [
  { userId: 'u011', name: bySeed(11).name, won: 3800, right: 6, of: 7 },
  { userId: 'u023', name: bySeed(23).name, won: 2400, right: 5, of: 7 },
  { userId: 'u052', name: bySeed(52).name, won: 1650, right: 4, of: 6 },
  { userId: 'u077', name: bySeed(77).name, won: 1200, right: 3, of: 4 },
  { userId: 'u090', name: bySeed(90).name, won: 900, right: 4, of: 4 },
  { userId: meId, name: byId.get(meId).name, won: 600, right: 2, of: 2 },
  { userId: 'u131', name: bySeed(131).name, won: 450, right: 2, of: 3 },
  { userId: 'u140', name: bySeed(140).name, won: 120, right: 1, of: 3 },
];

// 1. Before the lobby.
write('scheduled', moment({ me: 41, at: { round: 1, stage: 'scheduled' } }));

// 2. The lobby.
write('lobby', moment({ me: 41, at: { round: 1, stage: 'lobby' } }));

// 3. Your match is open: not joined, opponent has.
{
  const s = moment({ me: 41, at: { round: 1, stage: 'open' } });
  s.me.match.opponentJoined = true;
  write('match-open', s);
  // 3b. Joined, waiting for the opponent.
  const t = JSON.parse(JSON.stringify(s));
  t.me.match.joined = true;
  t.me.match.opponentJoined = false;
  t.version += 1;
  write('match-joined', t);
  // 3c. Both joined: live, starts in 4 s (the page hands off to CupPlay).
  const u = JSON.parse(JSON.stringify(s));
  u.me.match.joined = true;
  u.me.match.status = 'live';
  u.me.match.startAt = iso(T0 + sec(4));
  u.me.match.boardSeed = 418203;
  u.me.match.myLive = 0;
  u.me.match.opponentLive = 0;
  findMatch(u, u.me.match.id).status = 'live';
  findMatch(u, u.me.match.id).startAt = u.me.match.startAt;
  u.version += 2;
  write('match-live', u);
  // 3d. Opponent absent: play solo.
  const v = JSON.parse(JSON.stringify(s));
  v.me.match.joined = true;
  v.me.match.opponentJoined = false;
  v.me.match.status = 'solo';
  findMatch(v, v.me.match.id).status = 'solo';
  v.version += 3;
  write('match-solo', v);
  // 3e. Tie, replay on a new board.
  const w = JSON.parse(JSON.stringify(s));
  w.me.match.attempt = 1;
  w.me.match.opponentJoined = false;
  w.me.match.deadlineAt = iso(T0 + sec(170));
  w.me.match.lastTie = 1840;
  findMatch(w, w.me.match.id).attempt = 1;
  w.version += 4;
  write('match-replay', w);
}

// 4. Won round 1, waiting while the rest finish (what's live now).
write('result-won', moment({ me: 41, at: { round: 1, stage: 'mixed' } }));

// 5. Lost round 1: eliminated.
write('result-lost', moment({ me: 41, at: { round: 1, stage: 'mixed' }, fate: { 1: 'lose' } }));

// 6. Free pass: seed 3 skips round 2, which is live.
write('free-pass', moment({ me: 3, at: { round: 2, stage: 'live' } }));

// 7. Watch: round 2 live, 49 matches (the viewer's done).
write('watch', moment({ me: 41, at: { round: 2, stage: 'mixed' } }));

// 8. Round 1 open for the bracket's big round (113 matches).
{
  const s = moment({ me: 41, at: { round: 1, stage: 'live' } });
  // The viewer's own match is over (so the page isn't playing it); everyone else's is live.
  const m = findMatch(s, s.me.match.id);
  const opp = s.me.match.opponent.userId;
  Object.assign(m, { status: 'done', result: { [s.me.userId]: 2960, [opp]: 1710 }, winnerId: s.me.userId, decidedBy: 'played' });
  delete m.live;
  Object.assign(s.me.match, { status: 'done', result: m.result, winnerId: s.me.userId, joined: true, opponentJoined: true });
  write('bracket-r1', s);
}

// 9. Top 8: QF1 betting, the viewer was knocked out in round 3.
{
  const qf = 6;
  const s = moment({ me: 41, at: { round: qf, stage: { match: 0, kind: 'betting' } }, fate: { 3: 'lose' } });
  const m = findMatch(s, s.current.matchId);
  s.bets = { mine: [], onStage: { matchId: m.id, a: { stake: 11200, count: 87 }, b: { stake: 7200, count: 55 }, closesAt: m.bettingEndsAt } };
  s.tipsters = [];
  write('top8-betting', s);

  // 9b. The viewer is one of the two players (seed 1 is in QF1): betting off.
  const p = moment({ me: 1, at: { round: qf, stage: { match: 0, kind: 'betting' } } });
  const pm = findMatch(p, p.current.matchId);
  p.bets = { mine: [], onStage: { matchId: pm.id, a: { stake: 11200, count: 87 }, b: { stake: 7200, count: 55 }, closesAt: pm.bettingEndsAt } };
  p.tipsters = [];
  write('top8-player', p);

  // 9c. Another top-8 player watching QF2's lobby: they may bet on others' matches.
  const o = moment({ me: 6, at: { round: qf, stage: { match: 0, kind: 'after' } } });
  const om = findMatch(o, o.current.matchId);
  o.bets = { mine: [], onStage: { matchId: om.id, a: { stake: 3000, count: 20 }, b: { stake: 2500, count: 18 }, closesAt: om.bettingEndsAt } };
  o.tipsters = tipsters('u041');
  write('top8-other-player', o);

  // 10. QF1 live with the viewer's bet.
  const l = moment({ me: 41, at: { round: qf, stage: { match: 0, kind: 'live' } }, fate: { 3: 'lose' }, mine: { balance: 950 } });
  const lm = findMatch(l, l.current.matchId);
  l.bets = { mine: [{ matchId: lm.id, pick: lm.a.userId, stake: 300, status: 'held', payout: 0 }], onStage: { matchId: lm.id, a: { stake: 11200, count: 87 }, b: { stake: 7200, count: 55 } } };
  l.tipsters = [];
  write('top8-live', l);

  // 11. QF1 over, the viewer's pick won; QF2 in its betting lobby.
  const w = moment({ me: 41, at: { round: qf, stage: { match: 0, kind: 'after' } }, fate: { 3: 'lose' }, mine: { balance: 1550 } });
  const q1 = w.event.rounds[qf - 1].matches[0];
  const q2 = findMatch(w, w.current.matchId);
  w.bets = {
    mine: [{ matchId: q1.id, pick: q1.winnerId, stake: 300, status: 'won', payout: 600 }],
    onStage: { matchId: q2.id, a: { stake: 2100, count: 14 }, b: { stake: 1800, count: 12 }, closesAt: q2.bettingEndsAt },
  };
  w.tipsters = tipsters(w.me.userId);
  write('top8-won', w);

  // 12. The same, the pick lost.
  const x = JSON.parse(JSON.stringify(w));
  const loser = q1.a.userId === q1.winnerId ? q1.b.userId : q1.a.userId;
  x.bets.mine = [{ matchId: q1.id, pick: loser, stake: 300, status: 'lost', payout: 0 }];
  x.me.balance = 950;
  x.tipsters = tipsters(x.me.userId).map((t) => (t.userId === x.me.userId ? { ...t, won: 300, right: 1, of: 2 } : t));
  write('top8-lost', x);
}

// 13. The final played: standings.
{
  const s = moment({ me: 41, at: { stage: 'done' }, fate: { 3: 'lose' }, mine: { balance: 1870 } });
  s.event.round = s.event.rounds.length;
  const reachedOf = (n) => {
    const r = s.event.rounds[n - 1];
    return r.short === 'F' ? 'Final' : r.short === 'SF' ? 'Semi-final' : r.short === 'QF' ? 'Quarter-final' : r.matches.length === 8 ? 'Round of 16' : r.matches.length === 16 ? 'Round of 32' : r.label;
  };
  const standings = [];
  const total = s.event.rounds.length;
  const fin = s.event.rounds[total - 1].matches[0];
  const champ = [fin.a, fin.b].find((p) => p.userId === fin.winnerId);
  standings.push({ userId: champ.userId, name: champ.name, seed: champ.seed, reached: 'Champion', place: 1 });
  for (let n = total; n >= 1; n -= 1) {
    const losers = s.event.rounds[n - 1].matches.map((m) => [m.a, m.b].find((p) => p.userId !== m.winnerId)).sort((a, b) => a.seed - b.seed);
    const place = standings.length + 1;
    for (const l of losers) standings.push({ userId: l.userId, name: l.name, seed: l.seed, reached: reachedOf(n), place });
  }
  s.standings = standings;
  s.tipsters = tipsters(s.me.userId);
  s.bets = { mine: [{ matchId: s.event.rounds[total - 1].matches[0].id, pick: s.event.rounds[total - 1].matches[0].winnerId, stake: 300, status: 'won', payout: 600 }] };
  write('done', s);
}

// 14. The Cup is off.
write('off', { success: true, serverNow: iso(T0), version: 1, event: null, me: { userId: 'u041', name: bySeed(41).name, hr: false } });

// 15. Someone left out of the draw, watching round 2.
{
  const s = moment({ me: 41, at: { round: 2, stage: 'mixed' } });
  s.me = { userId: 'u999', name: 'Convrse Support', hr: true, entered: false, alive: false, balance: 0 };
  write('spectator', s);
}
