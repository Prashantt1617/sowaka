/**
 * Raw TV states for the public TV's checks and screenshots, shaped as the
 * engine's (`tvStateFor`: full names, userIds as keys and values, the event
 * id in match ids, the company's name, the viewer's `me`) and following the
 * Word Trip Tournament's new contract (qualifier, tie-break, `rank` beside
 * `seed`). The people are made up (`DEMO_PEOPLE`); the faces are drawn.
 */
import sharp from 'sharp';

const FIRST = [
  'Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ananya', 'Vihaan', 'Isha', 'Arjun', 'Saanvi', 'Reyansh', 'Myra', 'Advait', 'Kiara',
  'Dev', 'Tara', 'Neel', 'Aditi', 'Yash', 'Riya', 'Ishaan', 'Nisha', 'Kunal', 'Pooja', 'Varun', 'Sneha', 'Aman', 'Zoya', 'Karan',
  'Leela', 'Nikhil', 'Anika', 'Siddharth', 'Mira', 'Rahul', 'Trisha', 'Om', 'Juhi', 'Parth', 'Kavya', 'Ayaan', 'Sara', 'Manav',
  'Ira', 'Vivaan', 'Navya', 'Rudra', 'Pari', 'Atharv', 'Avni', 'Harsh', 'Ritika', 'Shaurya', 'Mahi', 'Krish', 'Anvi', 'Dhruv',
  'Esha', 'Lakshay', 'Tanya', 'Samar', 'Gauri', 'Ritvik', 'Jiya', 'Moksh', 'Prisha', 'Veer', 'Charvi', 'Aryan', 'Inaya',
];
const LAST = ['Kapoor', 'Mehta', 'Iyer', 'Raoji', 'Sharma', 'Nair', 'Bose', 'Khanna', 'Menon', 'Joshi', 'Gupta', 'Dasgupta', 'Pillai', 'Shahani', 'Verma', 'Reddy', 'Sengupta', 'Kulkarni', 'Chopra', 'Malhotra'];

export interface DemoPerson {
  userId: string;
  name: string;
  email: string;
  employeeId: string;
  designation: string;
  department: string;
  photo: boolean;
}

/** Made-up people: an employee-code style userId, a full name, an email, an employee id, a role. */
export const DEMO_PEOPLE: DemoPerson[] = Array.from({ length: 140 }, (_, i) => {
  const first = FIRST[i % FIRST.length];
  const last = LAST[(i * 7 + Math.floor(i / FIRST.length) * 3) % LAST.length];
  return {
    userId: `SWT-DEMO-${String(1001 + i)}`,
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@demo.sowaka.test`,
    employeeId: `EMP-${String(7001 + i)}`,
    designation: i % 3 === 0 ? 'Senior Designer' : i % 3 === 1 ? 'Account Manager' : 'Engineer II',
    department: i % 2 ? 'Studio North' : 'Client Services',
    photo: i % 4 !== 3,
  };
});

const SKIN = ['#F2C9A0', '#E0AC83', '#C68A5E', '#A86F48', '#8D5A3B', '#F5D5B8'];
const HAIR = ['#2B1B12', '#3E2A1E', '#151015', '#5A3A22', '#7A4E2D', '#1F1A2E'];
const BACK = ['#FFB3A7', '#9FE3F7', '#FFD98A', '#9EEBC6', '#D6C2FF', '#FFC9A1', '#B7F0DE', '#FFC2DE'];

/** A drawn face (not a photo of anyone), PNG. */
export async function demoFace(i: number): Promise<Buffer> {
  const skin = SKIN[i % SKIN.length];
  const hair = HAIR[(i * 5) % HAIR.length];
  const back = BACK[(i * 3) % BACK.length];
  const long = i % 2 === 1;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
    <rect width="240" height="240" fill="${back}"/>
    ${long ? `<path d="M52 128 Q50 40 120 38 Q190 40 188 128 L196 214 L44 214 Z" fill="${hair}"/>` : ''}
    <path d="M40 240 Q46 176 120 172 Q194 176 200 240 Z" fill="${['#3B6FD8', '#E0483B', '#2E9E6E', '#7B4BC4', '#E89A1F'][i % 5]}"/>
    <rect x="104" y="140" width="32" height="40" rx="12" fill="${skin}"/>
    <ellipse cx="120" cy="112" rx="50" ry="58" fill="${skin}"/>
    <path d="M68 104 Q66 50 120 48 Q176 50 172 104 Q160 74 120 74 Q86 74 68 104 Z" fill="${hair}"/>
    <circle cx="100" cy="116" r="6" fill="#2A2140"/><circle cx="140" cy="116" r="6" fill="#2A2140"/>
    <path d="M100 140 Q120 ${150 + (i % 3) * 3} 140 140" stroke="#7A3B2E" stroke-width="5" fill="none" stroke-linecap="round"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ---------------------------------------------------------------- words

const SETS: { letters: string; words: string[] }[] = [
  { letters: 'planet', words: ['plan', 'lane', 'plane', 'leap', 'neat', 'tale', 'pant', 'petal', 'plate', 'panel', 'late', 'pelt', 'plant', 'planet', 'teal', 'peal'] },
  { letters: 'stream', words: ['team', 'steam', 'mate', 'master', 'tame', 'star', 'stare', 'rate', 'east', 'seat', 'tram', 'mast', 'rest', 'stream', 'tears', 'smear'] },
  { letters: 'garden', words: ['dear', 'grade', 'range', 'anger', 'read', 'dare', 'near', 'earn', 'grand', 'drag', 'gear', 'dean', 'garden', 'raged', 'danger', 'rang'] },
  { letters: 'silver', words: ['live', 'liver', 'rise', 'sire', 'lies', 'isle', 'veil', 'evil', 'vile', 'lives', 'silver', 'sliver', 'rile', 'riles', 'evils', 'vies'] },
  { letters: 'candle', words: ['dance', 'clean', 'lance', 'laced', 'deal', 'lead', 'lane', 'lean', 'cane', 'land', 'candle', 'decal', 'dale', 'clan', 'acne', 'lanced'] },
];
const pts = (w: string) => w.length * w.length * 10;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** One player's run on the TV, partway: their stop, its letters, the words they found on it. */
function wtSide(userId: string, matchId: string, startAt: number, progress: number, done: boolean) {
  const h = hash(`${matchId}:${userId}`);
  const gi = done ? 2 : Math.min(2, Math.floor(progress * 3));
  const set = SETS[(h + gi) % SETS.length];
  const count = done ? 6 + (h % 6) : Math.max(1, Math.round(3 + (h % 9) * progress));
  const found = set.words.slice(0, count).map((w) => [w, pts(w)] as [string, number]);
  const earlier = gi * 1400 + (h % 500);
  const score = earlier + found.reduce((s, [, p]) => s + p, 0);
  const added = (h % 4) * 5;
  return { score, words: gi * 9 + found.length, gi, letters: set.letters, found, endsAt: startAt + (60 + added) * 1000 };
}

// ---------------------------------------------------------------- the bracket

type Status = 'pending' | 'scheduled' | 'betting' | 'open' | 'live' | 'solo' | 'done';
interface Who { userId: string; name: string; seed: number; rank: number }

const ROUNDS = [
  { label: 'Round 1', short: 'R1', kind: 'parallel' },
  { label: 'Round 2', short: 'R2', kind: 'parallel' },
  { label: 'Round 3', short: 'R3', kind: 'parallel' },
  { label: 'Quarter-finals', short: 'QF', kind: 'sequential' },
  { label: 'Semi-finals', short: 'SF', kind: 'sequential' },
  { label: 'Final', short: 'F', kind: 'sequential' },
] as const;

/**
 * The knockout of 64 by rank (1 v 64, 2 v 63, … in bracket order), every
 * round before `at` decided, round `at` in the state `statusOf` gives each
 * match, the rest waiting. Scores decide (rank breaks ties).
 */
function bracket(eventId: string, field: Who[], at: number, statusOf: (slot: number, matches: number) => Status, now: number) {
  const order = (n: number): number[] => (n === 1 ? [1] : order(n / 2).flatMap((s) => [s, n + 1 - s]));
  let alive: (Who | null)[] = order(64).map((rank) => field[rank - 1]);
  const words: Record<string, Record<string, ReturnType<typeof wtSide>>> = {};
  const rounds = ROUNDS.map((def, i) => {
    const n = i + 1;
    const matches: Record<string, unknown>[] = [];
    const next: (Who | null)[] = [];
    for (let slot = 1; slot <= alive.length / 2; slot += 1) {
      const a = alive[slot * 2 - 2];
      const b = alive[slot * 2 - 1];
      const id = `${eventId}-r${n}-m${slot}`;
      const label = def.short === 'F' ? 'Final' : def.kind === 'sequential' ? `${def.short}${slot}` : `${def.label} · Match ${slot}`;
      const status: Status = n < at ? 'done' : n === at ? statusOf(slot, alive.length / 2) : !a || !b ? 'pending' : def.kind === 'sequential' ? 'scheduled' : 'pending';
      const startAt = now - (status === 'done' ? 120_000 : 22_000 + (slot % 5) * 4000);
      const m: Record<string, unknown> = { id, slot, label, status, a, b, attempt: 0 };
      if (a && b && (status === 'live' || status === 'solo' || status === 'done')) {
        const progress = Math.min(1, (now - startAt) / 60_000);
        const sa = wtSide(a.userId, id, startAt, progress, status === 'done');
        const sb = status === 'solo' ? { ...wtSide(b.userId, id, startAt, 0, false), score: 0, words: 0, found: [] } : wtSide(b.userId, id, startAt, progress, status === 'done');
        words[id] = { [a.userId]: sa, [b.userId]: sb };
        m.startAt = new Date(startAt).toISOString();
        m.live = { [a.userId]: sa.score, [b.userId]: sb.score };
        m.wtWords = { [a.userId]: sa.words, [b.userId]: sb.words };
        m.wtEnds = { [a.userId]: sa.endsAt, [b.userId]: sb.endsAt };
        m.joined = status === 'solo' ? [a.userId] : [a.userId, b.userId];
        m.liveBoard = {};
        m.history = [];
        if (status === 'done') {
          const winner = sa.score > sb.score || (sa.score === sb.score && a.rank < b.rank) ? a : b;
          m.result = { [a.userId]: sa.score, [b.userId]: sb.score };
          m.winnerId = winner.userId;
          m.decidedBy = 'played';
          next.push(winner);
        } else next.push(null);
      } else {
        if (status === 'betting') m.bettingEndsAt = new Date(now + 84_000).toISOString();
        if (status === 'open') m.deadlineAt = new Date(now + 30_000).toISOString();
        next.push(null);
      }
      matches.push(m);
    }
    alive = next;
    return { n, label: def.label, short: def.short, kind: def.kind, openedAt: n <= at ? new Date(now - 600_000).toISOString() : undefined, byes: [], freePasses: 0, matches };
  });
  return { rounds, words };
}

// ---------------------------------------------------------------- the states

export type FixtureKey =
  | 'qualifier-1'
  | 'qualifier-2'
  | 'qualifier-results'
  | 'tiebreak'
  | 'round-of-64'
  | 'round-of-32'
  | 'betting'
  | 'semi-final'
  | 'final'
  | 'champion';

export const FIXTURES: FixtureKey[] = ['qualifier-1', 'qualifier-2', 'qualifier-results', 'tiebreak', 'round-of-64', 'round-of-32', 'betting', 'semi-final', 'final', 'champion'];

/** The cut: the largest power of 2 no more than the number who played. */
export const cutFor = (played: number) => (played < 2 ? played : 2 ** Math.floor(Math.log2(played)));

/** A raw TV state, as the engine would send it to the dashboard TV, for `key`, at `now`. */
export function fixtureState(key: FixtureKey, eventId: string, now = Date.now()): Record<string, unknown> {
  const people = DEMO_PEOPLE.slice(0, 105);
  const base = (h: string) => 600 + (hash(h) % 1900);
  // The qualifier: everyone's two attempts (the late five only the second).
  const late = new Set(people.slice(100).map((p) => p.userId));
  const attempt = key === 'qualifier-1' ? 1 : 2;
  const decided = key !== 'qualifier-1' && key !== 'qualifier-2';
  const rows = people.map((p, i) => {
    const first = late.has(p.userId) ? 0 : base(`${p.userId}:1`);
    const second = late.has(p.userId) ? base(`${p.userId}:2`) : base(`${p.userId}:2`) - 300;
    let attempts = 2;
    let best = Math.max(first, second);
    let combined = first + second;
    let playing = false;
    if (key === 'qualifier-1') {
      attempts = i % 5 === 0 || late.has(p.userId) ? 0 : 1;
      playing = i % 5 === 0 && i < 100;
      best = attempts ? first : playing ? Math.floor(first / 3) : 0;
      combined = best;
      if (late.has(p.userId)) return null;
    } else if (key === 'qualifier-2') {
      attempts = late.has(p.userId) ? 0 : i % 3 === 0 ? 1 : 2;
      playing = (i % 3 === 0 && i < 100) || (late.has(p.userId) && i % 2 === 0);
      best = attempts === 2 ? Math.max(first, second) : attempts === 1 ? first : playing ? Math.floor(second / 2) : 0;
      combined = attempts === 2 ? first + second : best;
    }
    return { userId: p.userId, firstName: p.name.split(' ')[0], name: p.name, email: p.email, employeeId: p.employeeId, faceVer: p.photo ? 1 : undefined, best, combined, attempts, playing, late: late.has(p.userId) || undefined };
  }).filter((r): r is NonNullable<typeof r> => !!r);
  rows.sort((a, b) => b.best - a.best || b.combined - a.combined);
  const played = rows.filter((r) => r.attempts > 0).length;
  const cut = cutFor(played);
  // Three level at the cut, for two places: 63, 64 and 65 on the same best score.
  if (decided && rows.length > cut + 1) {
    rows[cut - 2].best = rows[cut - 1].best = rows[cut].best = rows[cut - 2].best;
  }
  const tiedIds = decided ? [rows[cut - 2].userId, rows[cut - 1].userId, rows[cut].userId] : [];
  const qRows = rows.map((r, i) => ({
    ...r,
    rank: r.attempts > 0 || decided ? i + 1 : undefined,
    status: !decided ? 'pending' : tiedIds.includes(r.userId) ? (key === 'qualifier-results' || key === 'tiebreak' ? 'tied' : i < cut ? 'in' : 'out') : i < cut ? 'in' : 'out',
  }));
  if (key === 'tiebreak') {
    const t = qRows.filter((r) => tiedIds.includes(r.userId));
    Object.assign(t[0], { playing: true });
    Object.assign(t[1], { extra: 1840 });
    Object.assign(t[2], { playing: true });
  }
  const qualifier = {
    attempt,
    attemptEndsAt: key === 'qualifier-1' ? now + 192_000 : key === 'qualifier-2' ? now + 101_000 : now - 30_000,
    cut,
    played,
    rows: qRows,
    ...(key === 'tiebreak' ? { tiebreak: { spots: 2, userIds: tiedIds } } : {}),
  };

  const field: Who[] = qRows.slice(0, 64).map((r, i) => ({ userId: r.userId, name: r.name, seed: i + 1, rank: i + 1 }));
  const stage =
    key === 'round-of-64' ? { at: 1, st: (s: number) => (s % 8 === 0 ? 'done' : s % 11 === 0 ? 'solo' : 'live') as Status }
      : key === 'round-of-32' ? { at: 2, st: (s: number) => (s % 4 === 0 ? 'done' : 'live') as Status }
        : key === 'betting' ? { at: 4, st: (s: number) => (s === 1 ? 'betting' : 'scheduled') as Status }
          : key === 'semi-final' ? { at: 5, st: (s: number) => (s === 1 ? 'live' : 'scheduled') as Status }
            : key === 'final' ? { at: 6, st: () => 'live' as Status }
              : key === 'champion' ? { at: 7, st: () => 'done' as Status }
                : { at: 0, st: () => 'pending' as Status };
  const knockout = bracket(eventId, field, stage.at, stage.st, now);
  const phase = key.startsWith('qualifier') ? 'qualifier' : key === 'tiebreak' ? 'qualifier_tiebreak' : key === 'champion' ? 'done' : 'bracket';
  const finalMatch = knockout.rounds[5].matches[0] as { winnerId?: string };
  const championId = key === 'champion' ? finalMatch.winnerId : undefined;
  const person = (id: string) => DEMO_PEOPLE.find((p) => p.userId === id)!;
  const onStage = key === 'betting' ? knockout.rounds[3].matches[0] : key === 'semi-final' ? knockout.rounds[4].matches[0] : key === 'final' ? knockout.rounds[5].matches[0] : null;
  const tipsters = ['betting', 'semi-final', 'final', 'champion'].includes(key)
    ? DEMO_PEOPLE.slice(110, 115).map((p, i) => ({ userId: p.userId, name: p.name, won: [640, 420, 300, 120, -80][i], right: [4, 3, 3, 2, 1][i], of: [4, 4, 5, 3, 3][i], photoUrl: null }))
    : [];
  const standings = key === 'champion'
    ? (() => {
        const out: { userId: string; name: string; photoUrl: null; seed: number; reached: string; place: number; alive: boolean }[] = [];
        const f = knockout.rounds[5].matches[0] as { a: Who; b: Who; winnerId: string };
        const champ = f.winnerId === f.a.userId ? f.a : f.b;
        const runner = champ === f.a ? f.b : f.a;
        out.push({ userId: champ.userId, name: champ.name, photoUrl: null, seed: champ.seed, reached: 'Champion', place: 1, alive: true });
        out.push({ userId: runner.userId, name: runner.name, photoUrl: null, seed: runner.seed, reached: 'Final', place: 2, alive: false });
        for (const m of knockout.rounds[4].matches as { a: Who; b: Who; winnerId: string }[]) {
          const loser = m.winnerId === m.a.userId ? m.b : m.a;
          out.push({ userId: loser.userId, name: loser.name, photoUrl: null, seed: loser.seed, reached: 'Semi-final', place: 3, alive: false });
        }
        return out;
      })()
    : undefined;
  const current = onStage ? { matchId: (onStage as { id: string }).id, kind: key === 'betting' ? 'betting' : 'live' } : undefined;
  return {
    success: true,
    serverNow: new Date(now),
    version: 1000 + FIXTURES.indexOf(key),
    phase,
    event: {
      id: eventId,
      name: 'Word Trip Tournament',
      phase: phase === 'done' ? 'done' : 'running',
      round: Math.min(stage.at, 6),
      lobbyAt: new Date(now - 30 * 60_000),
      startAt: new Date(now - 15 * 60_000),
      topN: 8,
      orgName: 'Sowaka Test',
      entrantCount: phase.startsWith('qualifier') ? rows.length : 64,
      lobbyDraw: true,
      gameKey: 'word-trip',
      wallet: 1000,
      seeding: 'lucky',
      roundSec: 60,
      bettingSec: 120,
      championId,
      rounds: phase.startsWith('qualifier') ? [] : knockout.rounds,
    },
    qualifier,
    me: { userId: 'cup-tv-public', name: 'TV', photoUrl: null, hr: false, entered: false, alive: false, balance: 1000 },
    current,
    bets: {
      mine: [],
      ...(onStage ? { onStage: { matchId: (onStage as { id: string }).id, a: { stake: key === 'betting' ? 2350 : 4100, count: key === 'betting' ? 9 : 14 }, b: { stake: key === 'betting' ? 1600 : 3300, count: key === 'betting' ? 7 : 11 }, closesAt: key === 'betting' ? new Date(now + 84_000).toISOString() : null } } : {}),
    },
    tipsters,
    standings,
    wordTrip: knockout.words,
    // A stray full record, as a careless engine change might leave one: must never reach the public page.
    debugLast: { userId: field[0].userId, name: person(field[0].userId).name, email: person(field[0].userId).email, employeeId: person(field[0].userId).employeeId, designation: 'Senior Designer' },
  };
}
