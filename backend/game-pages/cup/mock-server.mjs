#!/usr/bin/env node
/**
 * A stand-in for the Cup's server, for trying the page on this machine:
 *
 *   node backend/game-pages/cup/build.mjs && node backend/game-pages/cup/mock-server.mjs
 *   open http://localhost:5312/            (a list of every state)
 *
 * `/play/diwali-cup?fx=<fixture>` serves the built page with window.__CUP set;
 * the ticket names the fixture, so `/cup/api/*` answers from
 * fixtures/<fixture>.json. Each page load starts that fixture afresh, with its
 * clock moved to now (countdowns tick, live scores climb). Join, solo, live,
 * final and bets change that copy, so a match or a bet can be played through.
 *
 * Live matches also carry `boardSeed` and `liveBoard` (where each player is in
 * the seeded boards, moving with the score, a wrong tap now and then), so both
 * boards can be watched; `&boards=0` leaves them out (an old page's scores only).
 *
 * `&name=<text>` gives the event another name (the page shows event.name).
 * `&game=knights&n=6` turns the fixture into a Knights Tournament: every match gets a board from
 * src/content/knights-boards.json (`knights: {n, g}`), the opponent places a knight every ~10 s
 * (`placed`), a right board (`POST live {knights}`) decides it at once, `POST resign` gives it away,
 * and at the cap more right wins (`&opp=fast` lets the opponent finish first at ~40 s).
 * Special fixtures: expired (the ticket is refused), flaky (watch, with the
 * network failing from 3 s to 9 s), down (never answers), noticket (no __CUP).
 */
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5312);
const BUILT = join(here, '..', 'diwali-cup.html');
const sessions = new Map();
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function shiftDates(value, by) {
  if (typeof value === 'string' && ISO.test(value)) return new Date(Date.parse(value) + by).toISOString();
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, by));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, by)]));
  return value;
}
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const strip = (k, v) => (k.startsWith('_') ? undefined : v);

/* The boards, from play.js's own seeded-boards block (board g of a seed). */
const PLAY = readFileSync(join(here, 'play.js'), 'utf8');
const SEEDED = PLAY.slice(PLAY.indexOf('/* seeded-boards:start'), PLAY.indexOf('/* seeded-boards:end */'));
const { boardAt } = new Function(SEEDED + '\nreturn { boardAt };')();
const seedOf = (m) => 100000 + (Math.abs(hash(m.id)) % 900000) + (m.attempt || 0);

/** Where a simulated player is `el` seconds in: a find every ~1.3 s (faster for some), and every fifth step a wrong tap. */
function simBoard(seed, uid, el) {
  const pace = 0.8 + (Math.abs(hash(uid + ':pace')) % 13) / 15;
  const steps = Math.floor(el / (pace * 0.85));
  const wrong = Math.floor(steps / 5);
  const board = Math.max(0, steps - wrong);
  if (!steps) return { board: 0 };
  if (steps % 5 === 4) {
    const b = boardAt(seed, board), n = b.n * b.n;
    return { board, tap: (b.at + 1 + (Math.abs(hash(uid + steps)) % (n - 1))) % n, ok: false };
  }
  return { board, tap: boardAt(seed, board - 1).at, ok: true };
}

const KBANK = JSON.parse(readFileSync(join(here, '..', '..', 'src', 'content', 'knights-boards.json'), 'utf8'));
function knightsify(d, n) {
  d.event.gameKey = 'knights'; d.event.name = 'Knights Tournament'; d.event.roundSec = 300; d.event.startWindowSec = 30; d.event.wallet = 1000; d.event.lobbyDraw = true;
  const bank = KBANK[String(n)] || KBANK['6'];
  const board = (m) => { const b = bank[Math.abs(hash(m.id + ':' + (m.attempt || 0))) % bank.length]; return b; };
  for (const m of [...matchesOf(d), ...(d.me && d.me.match ? [d.me.match] : [])]) {
    if (!['live', 'solo', 'done'].includes(m.status) && m !== d.me.match) continue;
    const b = board(m);
    m.knights = { n: Math.round(Math.sqrt(b.g.length)), g: b.g, f: b.s[Math.floor(Math.round(Math.sqrt(b.g.length)) / 2)] };
    m._sol = b.s;
    m.placed = m.placed || {};
  }
}
function decideKnights(d, mm, rm, winnerId, decidedBy, right) {
  const result = { winnerId, decidedBy, right };
  for (const m of [mm, rm]) if (m) Object.assign(m, { status: 'done', winnerId, decidedBy, result, right, knights: { ...m.knights, solution: mm._sol } });
  if (winnerId !== d.me.userId) { d.me.alive = false; d.me.eliminatedIn = d.event.rounds[mm.round - 1].label; }
}

function newSession(fx, name, boards) {
  const real = fx === 'flaky' ? 'watch' : fx;
  const raw = JSON.parse(readFileSync(join(here, 'fixtures', `${real}.json`), 'utf8'));
  const data = shiftDates(raw, Date.now() - Date.parse(raw.serverNow));
  // ?name= tries the page with another tournament name (?name= with nothing: no name, the page's fallback).
  if (name != null && data.event) data.event.name = name;
  if (boards && boards.game === 'knights' && data.event) knightsify(data, boards.n);
  const ticket = `fx:${fx}:${Math.random().toString(36).slice(2, 8)}`;
  sessions.set(ticket, { fx, data, anchor: Date.now(), bump: 0, boards: boards && boards.on, knights: boards && boards.game === 'knights', opp: boards && boards.opp });
  return ticket;
}

const matchesOf = (d) => (d.event ? d.event.rounds.flatMap((r) => r.matches) : []);

/** Moves the copy on to now: live scores climb, a waiting opponent turns up. */
function advance(s) {
  const d = s.data;
  const now = Date.now();
  const meId = d.me && d.me.userId;
  const mm = d.me && d.me.match;
  if (mm && s.oppJoinAt && now >= s.oppJoinAt && mm.status === 'open') {
    s.oppJoinAt = 0;
    mm.opponentJoined = true;
    mm.status = 'live';
    mm.startAt = new Date(now + 4000).toISOString();
    mm.boardSeed = 100000 + (Math.abs(hash(mm.id)) % 900000) + mm.attempt;
    const rm = matchesOf(d).find((m) => m.id === mm.id);
    if (rm) Object.assign(rm, { status: 'live', startAt: mm.startAt, live: { [meId]: 0, [mm.opponent.userId]: 0 } });
    s.bump += 1;
  }
  if (s.knights) {
    const rm = mm && matchesOf(d).find((m) => m.id === mm.id);
    if (mm && mm.status === 'live' && mm.startAt && mm.knights) {
      const el = (now - Date.parse(mm.startAt)) / 1000, n = mm.knights.n, oid = mm.opponent.userId;
      const pl = Math.max(0, Math.min(s.opp === 'fast' ? n : n - 1, Math.floor(el / (s.opp === 'fast' ? 40 / n : 10))));
      if (mm.placed[oid] !== pl) { mm.placed[oid] = pl; if (rm) rm.placed = { ...mm.placed }; s.bump += 1; }
      if (s.opp === 'fast' && pl === n) decideKnights(d, mm, rm, oid, 'finished', { [d.me.userId]: mm._right || 0, [oid]: n });
      else if (el > d.event.roundSec + 3) {
        const mine = mm._right || 0, theirs = Math.max(0, pl - 2);
        decideKnights(d, mm, rm, mine >= theirs ? d.me.userId : oid, 'cap', { [d.me.userId]: mine, [oid]: theirs });
        s.bump += 1;
      }
    }
    return d.version + s.bump + Math.floor((now - s.anchor) / 1500);
  }
  let anyLive = false;
  for (const m of matchesOf(d)) {
    if (m.status !== 'live' || !m.live || !m.startAt) continue;
    m._base = m._base || { ...m.live };
    const el = Math.max(0, Math.min(45, (now - Date.parse(m.startAt)) / 1000));
    if (el > 0 && el < 45) anyLive = true;
    for (const uid of Object.keys(m.live)) {
      if (uid === meId) continue;
      m.live[uid] = m._base[uid] + Math.floor(el * (40 + (Math.abs(hash(uid)) % 50)));
    }
    if (s.boards) {
      m.boardSeed = m.boardSeed || seedOf(m);
      m.liveBoard = m.liveBoard || {};
      for (const uid of Object.keys(m.live)) if (uid !== meId) m.liveBoard[uid] = { ...simBoard(m.boardSeed, uid, el), at: new Date(now).toISOString() };
    }
  }
  if (mm && (mm.status === 'live' || mm.status === 'solo') && mm.startAt && mm.opponent) {
    const el = Math.max(0, Math.min(45, (now - Date.parse(mm.startAt)) / 1000));
    if (mm.status === 'live') mm.opponentLive = Math.floor(el * 52);
    if (el > 0 && el < 45) anyLive = true;
  }
  const tick = anyLive ? Math.floor((now - s.anchor) / 1500) : 0;
  return d.version + s.bump + tick;
}

function send(res, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body, strip);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}
const readBody = (req) =>
  new Promise((ok) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try { ok(b ? JSON.parse(b) : {}); } catch { ok({}); }
    });
  });

function page(fx, from, name, boards) { // boards: { on, game, n, opp }
  let html = readFileSync(BUILT, 'utf8');
  if (fx === 'noticket') return html;
  const ticket = fx === 'expired' ? 'expired' : fx === 'down' ? 'down' : newSession(fx, name, boards);
  const cup = { ticket, eventId: fx === 'off' ? '' : 'diwali-2026', from };
  return html.replace('<!--CUP-TICKET-->', () => `<script>window.__CUP=${JSON.stringify(cup)}</script>`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  try {
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (path === '/') {
      const names = readdirSync(join(here, 'fixtures')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
      const all = [...names, 'flaky', 'expired', 'down', 'noticket'];
      return send(res, 200, `<!doctype html><meta name=viewport content="width=device-width"><body style="font:16px system-ui;background:#15122B;color:#fff;padding:20px"><h1>Cup mock</h1>${all.map((n) => `<p><a style="color:#F5B82E" href="/play/diwali-cup?fx=${n}">${n}</a></p>`).join('')}`);
    }
    if (path === '/play/diwali-cup' || /^\/cup\/[^/]+$/.test(path)) {
      return send(res, 200, page(url.searchParams.get('fx') || 'lobby', path.startsWith('/cup/') ? 'feed' : 'games', url.searchParams.get('name'), { on: url.searchParams.get('boards') !== '0', game: url.searchParams.get('game'), n: Number(url.searchParams.get('n')) || 6, opp: url.searchParams.get('opp') }));
    }
    if (!path.startsWith('/cup/api/')) return send(res, 404, { success: false, message: 'Not found' });
    const ticket = req.headers['x-cup-ticket'] || '';
    if (ticket === 'down') { req.socket.destroy(); return; }
    if (ticket === 'expired' || !sessions.has(ticket)) return send(res, 401, { success: false, message: 'Close and reopen the Cup.' });
    const s = sessions.get(ticket);
    const d = s.data;
    if (s.fx === 'flaky') {
      const el = Date.now() - s.anchor;
      if (el > 3000 && el < 9000) { req.socket.destroy(); return; }
    }
    const version = advance(s);
    const now = Date.now();
    if (req.method === 'GET' && path === '/cup/api/state') {
      const since = url.searchParams.get('since');
      if (since != null && Number(since) === version) return send(res, 200, { success: true, unchanged: true, version, serverNow: new Date(now).toISOString() });
      return send(res, 200, { ...d, version, serverNow: new Date(now).toISOString() });
    }
    const body = req.method === 'POST' ? await readBody(req) : {};
    const mm = d.me && d.me.match;
    const rm = mm && matchesOf(d).find((m) => m.id === mm.id);
    const mt = /^\/cup\/api\/matches\/([^/]+)\/(join|solo|live|final|void|resign)$/.exec(path);
    if (mt) {
      const [, id, what] = mt;
      if (!mm || mm.id !== id) return send(res, 403, { success: false, message: 'This is not your match' });
      if (what === 'join') {
        if (mm.status !== 'open') return send(res, 409, { success: false, message: 'Your match has not opened yet' });
        mm.joined = true;
        if (mm.opponentJoined) {
          mm.status = 'live';
          mm.startAt = new Date(now + 4000).toISOString();
          mm.boardSeed = 100000 + (Math.abs(hash(mm.id)) % 900000) + mm.attempt;
          if (rm) Object.assign(rm, { status: 'live', startAt: mm.startAt, live: { [d.me.userId]: 0, [mm.opponent.userId]: 0 } });
        } else s.oppJoinAt = now + 4000;
        s.bump += 1;
        return send(res, 200, { success: true, match: mm });
      }
      if (what === 'solo') {
        if (mm.status !== 'solo') return send(res, 409, { success: false, message: 'There is no round to start' });
        mm.startAt = new Date(now + 4000).toISOString();
        mm.boardSeed = 1 + Math.floor(Math.random() * 999999);
        if (rm) rm.startAt = mm.startAt;
        s.bump += 1;
        return send(res, 200, { success: true, match: mm });
      }
      if (s.knights && what === 'resign') {
        if (mm.status !== 'live' && mm.status !== 'solo') return send(res, 409, { success: false, message: 'This match is not on' });
        decideKnights(d, mm, rm, mm.opponent.userId, 'resigned', { [d.me.userId]: mm._right || 0, [mm.opponent.userId]: Math.max(0, (mm.placed[mm.opponent.userId] || 0) - 1) });
        s.bump += 1;
        return send(res, 200, { success: true, match: mm });
      }
      if (s.knights && what === 'live') {
        if (!Array.isArray(body.knights)) return send(res, 400, { success: false, message: 'knights missing' });
        if (mm.status !== 'live' && mm.status !== 'solo') return send(res, 409, { success: false, message: 'This match is not on' });
        const set = [...new Set(body.knights)].sort((a, b) => a - b);
        s.lives = (s.lives || 0) + 1; console.log('live', JSON.stringify(set));
        mm.placed[d.me.userId] = set.length; if (rm) rm.placed = { ...mm.placed };
        mm._right = set.filter((i) => mm._sol.includes(i)).length;
        if (set.join() === mm._sol.join()) decideKnights(d, mm, rm, d.me.userId, 'finished', { [d.me.userId]: mm.knights.n, [mm.opponent.userId]: Math.max(0, (mm.placed[mm.opponent.userId] || 0) - 1) });
        s.bump += 1;
        res.writeHead(204).end();
        return;
      }
      if (what === 'live') {
        mm.myLive = Number(body.score) || 0;
        if (rm && rm.live) rm.live[d.me.userId] = mm.myLive;
        if (rm && s.boards && Number.isInteger(body.board)) {
          rm.boardSeed = mm.boardSeed;
          rm.liveBoard = rm.liveBoard || {};
          rm.liveBoard[d.me.userId] = { ...(Number.isInteger(body.tap) ? { board: body.board, tap: body.tap, ok: !!body.ok } : { board: body.board }), at: new Date(now).toISOString() };
          s.bump += 1;
        }
        res.writeHead(204).end();
        return;
      }
      if (what === 'final') {
        const mine = Math.round(Number(body.score) || 0);
        const wasSolo = mm.status === 'solo';
        const theirs = wasSolo ? 0 : mm.opponentLive || 0;
        const oppId = mm.opponent.userId;
        mm.result = { [d.me.userId]: mine, [oppId]: theirs };
        mm.status = 'done';
        mm.winnerId = mine >= theirs ? d.me.userId : oppId;
        if (rm) Object.assign(rm, { status: 'done', result: mm.result, winnerId: mm.winnerId, decidedBy: wasSolo ? 'solo' : 'played' });
        if (mm.winnerId !== d.me.userId) { d.me.alive = false; d.me.eliminatedIn = d.event.rounds[mm.round - 1].label; }
        s.bump += 1;
        return send(res, 200, { success: true, match: mm });
      }
      return send(res, 403, { success: false, message: 'HR only' });
    }
    if (req.method === 'POST' && path === '/cup/api/bets') {
      const m = matchesOf(d).find((x) => x.id === body.matchId);
      if (!m || m.status !== 'betting' || Date.parse(m.bettingEndsAt) <= now) return send(res, 409, { success: false, message: 'Betting on this match is closed' });
      if ([m.a.userId, m.b.userId].includes(d.me.userId)) return send(res, 403, { success: false, message: "You can't bet on your own match" });
      if (![m.a.userId, m.b.userId].includes(body.pick)) return send(res, 400, { success: false, message: 'Pick one of the two players' });
      const stake = body.stake;
      if (!Number.isInteger(stake) || stake < 1) return send(res, 400, { success: false, message: 'Stake at least 1 point' });
      if (stake > d.me.balance) return send(res, 400, { success: false, message: `You have ${d.me.balance} points to bet` });
      d.bets = d.bets || { mine: [] };
      if (d.bets.mine.some((b) => b.matchId === m.id)) return send(res, 409, { success: false, message: 'You already have a bet on this match' });
      const bet = { matchId: m.id, pick: body.pick, stake, status: 'held', payout: 0 };
      d.bets.mine.push(bet);
      d.me.balance -= stake;
      if (d.bets.onStage && d.bets.onStage.matchId === m.id) {
        const side = body.pick === m.a.userId ? d.bets.onStage.a : d.bets.onStage.b;
        side.stake += stake;
        side.count += 1;
      }
      s.bump += 1;
      return send(res, 200, { success: true, bet, balance: d.me.balance });
    }
    if (path === '/cup/api/bets/mine') return send(res, 200, { success: true, bets: (d.bets && d.bets.mine) || [], balance: d.me.balance });
    return send(res, 404, { success: false, message: 'Not found' });
  } catch (error) {
    console.error(error);
    return send(res, 500, { success: false, message: 'The mock broke: ' + error.message });
  }
});
server.listen(PORT, () => console.log(`Cup mock on http://localhost:${PORT}/`));
