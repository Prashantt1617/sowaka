/**
 * Dashboard › Engagement › Games: the company's games as the app's Games tab
 * lists them, who plays them and when, each game's board and its tournaments.
 *
 * Read only. Nothing here keeps a log of its own: a "play" is any moment the
 * server already kept of someone playing a game —
 *   - a finished game in the points ledger (`point_events`, reason 'game':
 *     every room game of Pool, Scribble and Tile Up, every colleague
 *     challenge, Secret Squad's paid rounds),
 *   - a new best on a game's board (`game_scores`, only the best is kept),
 *   - a score in a timed game launch (`game_launch_scores`),
 *   - a challenge round reported (`game_challenges`),
 *   - a knockout match played (`cup_matches`),
 *   - a Speed Poker table finished (`poker_results`),
 *   - a Secret Squad round paid (`secret_squad_payouts`),
 *   - being in a Hint Relay game (`relay_presence`).
 * The same person in the same game in the same minute counts once, so one
 * challenge that also set a best is one play. A solo round that did not beat
 * the person's best is kept nowhere, so it is not counted.
 */
import {
  connectPosts,
  gameChallenges,
  gameScores,
  getDb,
  relayEvents,
  relayPresence,
  relayProgress,
  relayTeams,
  users,
} from '../config/db';
import type { GameScore } from '../models/game.model';
import type { User } from '../models/user.model';
import { catalogFor, type PublicGame } from './game-catalog.service';
import { cachedEngagement } from './engagement-cache';
import { pointEvents } from './points-ledger.service';
import { cupEvents, cupMatches } from './cup.service';
import { pokerEvents, pokerResults } from './poker-db';
import { squadPayouts, squadSchedules } from './secret-squad.service';

export class EngagementGamesError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'EngagementGamesError';
  }
}

/** Played with others in a room. */
const GROUP_GAMES = new Set(['pool', 'speed-poker', 'tile-up', 'scribble']);
/** Played only while one is on, as an event. */
const LIVE_GAMES = new Set(['secret-squad', 'hint-relay']);
/** The knockout's own page: its events are listed under the game they are played in. */
const TOURNAMENT_PAGE = 'diwali-cup';
const RELAY_KEY = 'hint-relay';
const SQUAD_KEY = 'secret-squad';
const POKER_KEY = 'speed-poker';
const INACTIVE = ['offboarded', 'terminated'];
/** A ceiling so one company's history stays one reply. */
const MAX_PLAYS = 60_000;
const MAX_STANDINGS = 500;

export type GameKind = 'Solo challenge' | 'Group game' | 'Live event';

export interface GameLine {
  key: string;
  name: string;
  tagline: string;
  description: string;
  instructions: string;
  kind: GameKind;
  accentColor: string | null;
  /** Only a picture the dashboard can load (https or data:); the app's bundled pictures are not. */
  thumbnail: string | null;
  scoring: { higherIsBetter: boolean; label: string } | null;
  /** Shown on the app only while one is on, never in the list to play any time. */
  liveOnly: boolean;
  /** Not in the company's catalog, but the company has run it (Hint Relay before it had an entry). */
  eventOnly?: boolean;
}

export interface GamePerson {
  id: string;
  name: string;
  department: string;
  location: string;
  manager: string;
  /** No longer at the company: their plays count, they are never "never played". */
  left?: boolean;
}

const kindOf = (key: string): GameKind => (LIVE_GAMES.has(key) ? 'Live event' : GROUP_GAMES.has(key) ? 'Group game' : 'Solo challenge');
const loadable = (src: string | undefined) => (src && /^(https:\/\/|data:image\/)/.test(src) ? src : null);
const dateOf = (v: unknown): Date | null => {
  const d = v instanceof Date ? v : typeof v === 'string' || typeof v === 'number' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

function lineOf(game: PublicGame): GameLine {
  return {
    key: game.key,
    name: game.name,
    tagline: game.tagline,
    description: game.description,
    instructions: game.instructions,
    kind: kindOf(game.key),
    accentColor: game.accentColor ?? null,
    thumbnail: loadable(game.thumbnail),
    scoring: game.scoring,
    liveOnly: game.key === SQUAD_KEY,
  };
}

/** The company's games in the app's order (its catalog), and Hint Relay when it has run one without an entry. */
async function lineUpFor(org: string): Promise<GameLine[]> {
  const catalog = await catalogFor({ userId: '', name: '', org });
  const lines = catalog.filter((g) => g.key !== TOURNAMENT_PAGE).map(lineOf);
  if (!lines.some((g) => g.key === RELAY_KEY) && (await relayEvents().countDocuments({ org }, { limit: 1 })) > 0) {
    lines.push({
      key: RELAY_KEY,
      name: 'Hint Relay',
      tagline: '',
      description: '',
      instructions: '',
      kind: 'Live event',
      accentColor: null,
      thumbnail: null,
      scoring: null,
      liveOnly: true,
      eventOnly: true,
    });
  }
  return lines;
}

/** Everyone at the company with what the tables group by; people who have left only when asked for by id. */
async function peopleOf(org: string, alsoIds: Set<string> = new Set()): Promise<GamePerson[]> {
  const rows = await users()
    .find(
      { org },
      { projection: { _id: 0, userId: 1, name: 1, department: 1, location: 1, managerUserId: 1, lifecycleStatus: 1, isCounsellor: 1, hiddenFromDirectory: 1 } },
    )
    .toArray();
  const names = new Map(rows.map((u) => [u.userId, u.name]));
  const out: GamePerson[] = [];
  for (const u of rows as (User & { isCounsellor?: boolean; hiddenFromDirectory?: boolean })[]) {
    const gone = INACTIVE.includes(u.lifecycleStatus) || u.isCounsellor === true || u.hiddenFromDirectory === true;
    if (gone && !alsoIds.has(u.userId)) continue;
    out.push({
      id: u.userId,
      name: u.name || 'Unnamed',
      department: u.department || '',
      location: u.location || '',
      manager: (u.managerUserId && names.get(u.managerUserId)) || '',
      ...(gone ? { left: true } : {}),
    });
  }
  return out;
}

interface Play {
  key: string;
  userId: string;
  at: Date;
}

/** Every play the server kept at the company (see the top of the file), one per person per game per minute. */
async function playsOf(org: string): Promise<Play[]> {
  const launchScores = getDb().collection<{ org: string; gameKey: string; userId: string; achievedAt: Date }>('game_launch_scores');
  const [ledger, bests, launches, challenges, cupRows, cupMatchRows, pokerRows, pokerEventRows, payouts, relayRows] = await Promise.all([
    pointEvents()
      .find({ org, reason: 'game', gameKey: { $exists: true } }, { projection: { _id: 0, userId: 1, gameKey: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(MAX_PLAYS)
      .toArray(),
    gameScores()
      .find({ org, gameId: /^catalog:/ }, { projection: { _id: 0, gameId: 1, userId: 1, achievedAt: 1 } })
      .toArray(),
    launchScores.find({ org }, { projection: { _id: 0, gameKey: 1, userId: 1, achievedAt: 1 } }).toArray(),
    gameChallenges()
      .find({ org }, { projection: { _id: 0, gameKey: 1, scores: 1 } })
      .sort({ createdAt: -1 })
      .limit(MAX_PLAYS)
      .toArray(),
    cupEvents().find({ org }, { projection: { _id: 0, id: 1, gameKey: 1 } }).toArray(),
    cupMatches().find({ org }, { projection: { _id: 0, eventId: 1, finals: 1 } }).toArray(),
    pokerResults()
      .find({ org, voided: { $ne: true } }, { projection: { _id: 0, eventId: 1, userId: 1, at: 1 } })
      .limit(MAX_PLAYS)
      .toArray(),
    pokerEvents().find({ org }, { projection: { _id: 0, id: 1, catalogKey: 1 } }).toArray(),
    squadPayouts().find({ org }, { projection: { _id: 0, points: 1, paidAt: 1 } }).toArray(),
    relayEvents().find({ org }, { projection: { _id: 0, id: 1 } }).toArray(),
  ]);
  const presence = relayRows.length
    ? await relayPresence()
        .find({ eventId: { $in: relayRows.map((e) => e.id) } }, { projection: { _id: 0, userId: 1, lastSeenAt: 1 } })
        .toArray()
    : [];

  const plays: Play[] = [];
  const seen = new Set<string>();
  const add = (key: unknown, userId: unknown, at: unknown) => {
    const when = dateOf(at);
    if (typeof key !== 'string' || !key || typeof userId !== 'string' || !userId || !when) return;
    const id = `${key}|${userId}|${Math.floor(when.getTime() / 60_000)}`;
    if (seen.has(id)) return;
    seen.add(id);
    plays.push({ key, userId, at: when });
  };
  for (const r of ledger) add(r.gameKey, r.userId, r.createdAt);
  for (const r of bests) add(r.gameId.slice('catalog:'.length), r.userId, r.achievedAt);
  for (const r of launches) add(r.gameKey, r.userId, r.achievedAt);
  for (const c of challenges) for (const [uid, s] of Object.entries(c.scores ?? {})) add(c.gameKey, uid, s?.finishedAt);
  const cupGame = new Map(cupRows.map((e) => [e.id, e.gameKey]));
  for (const m of cupMatchRows) for (const [uid, s] of Object.entries(m.finals ?? {})) add(cupGame.get(m.eventId), uid, s?.at);
  const pokerGame = new Map(pokerEventRows.map((e) => [e.id, e.catalogKey || POKER_KEY]));
  for (const r of pokerRows) add(pokerGame.get(r.eventId) ?? POKER_KEY, r.userId, r.at);
  for (const p of payouts) for (const uid of Object.keys(p.points ?? {})) add(SQUAD_KEY, uid, p.paidAt);
  for (const p of presence) add(RELAY_KEY, p.userId, p.lastSeenAt);
  plays.sort((a, b) => a.at.getTime() - b.at.getTime());
  return plays.length > MAX_PLAYS ? plays.slice(plays.length - MAX_PLAYS) : plays;
}

/** Tournaments of every kind at the company, counted per game: [total, still to come or on]. */
async function tournamentCounts(org: string): Promise<Map<string, [number, number]>> {
  const [cups, pokers, relays, squads] = await Promise.all([
    cupEvents().find({ org }, { projection: { _id: 0, gameKey: 1, phase: 1 } }).toArray(),
    pokerEvents().find({ org, status: { $ne: 'draft' } }, { projection: { _id: 0, catalogKey: 1, status: 1 } }).toArray(),
    relayEvents().find({ org }, { projection: { _id: 0, status: 1 } }).toArray(),
    squadSchedules().find({ org, status: { $ne: 'cancelled' } }, { projection: { _id: 0, startsAt: 1 } }).toArray(),
  ]);
  const counts = new Map<string, [number, number]>();
  const bump = (key: string, open: boolean) => {
    const c = counts.get(key) ?? [0, 0];
    c[0] += 1;
    if (open) c[1] += 1;
    counts.set(key, c);
  };
  for (const e of cups) bump(e.gameKey, e.phase !== 'done');
  for (const e of pokers) bump(e.catalogKey || POKER_KEY, e.status !== 'over');
  for (const e of relays) bump(RELAY_KEY, e.status !== 'finished');
  const now = Date.now();
  for (const s of squads) bump(SQUAD_KEY, s.startsAt.getTime() > now);
  return counts;
}

/**
 * What games paid each person in engagement points: the ledger's game rows
 * (rooms, challenges, Secret Squad), Hint Relay's answers, and Speed Poker's
 * tables, which pay through their own results. The ledger starts on the day
 * it was added; nothing before then was written back.
 */
async function gamePointsOf(org: string): Promise<Map<string, number>> {
  const [ledger, poker] = await Promise.all([
    pointEvents()
      .aggregate<{ _id: string; points: number }>([
        { $match: { org, $or: [{ reason: 'game' }, { source: 'hint_relay' }] } },
        { $group: { _id: '$userId', points: { $sum: '$delta' } } },
      ])
      .toArray(),
    pokerResults()
      .aggregate<{ _id: string; points: number }>([
        { $match: { org, voided: { $ne: true } } },
        { $group: { _id: '$userId', points: { $sum: '$points' } } },
      ])
      .toArray(),
  ]);
  const out = new Map<string, number>();
  for (const r of [...ledger, ...poker]) out.set(r._id, (out.get(r._id) ?? 0) + (Number.isFinite(r.points) ? r.points : 0));
  return out;
}

/**
 * The Games page: the line-up, everyone at the company, and every play as
 * [game, person, seconds since 1970] by their places in those lists, so the
 * page can draw any range and any grouping without asking again.
 */
export function gamesOverview(org: string) {
  // Every play on record is seconds of reads; a new play shows within the cache's five minutes.
  return cachedEngagement(org, 'games', null, () => buildGamesOverview(org));
}

async function buildGamesOverview(org: string) {
  const [games, plays, counts, points] = await Promise.all([lineUpFor(org), playsOf(org), tournamentCounts(org), gamePointsOf(org)]);
  const keys = new Map(games.map((g, i) => [g.key, i]));
  const mine = plays.filter((p) => keys.has(p.key));
  const people = await peopleOf(org, new Set(mine.map((p) => p.userId)));
  const index = new Map(people.map((p, i) => [p.id, i]));
  const rows: [number, number, number][] = [];
  for (const p of mine) {
    const who = index.get(p.userId);
    if (who !== undefined) rows.push([keys.get(p.key)!, who, Math.floor(p.at.getTime() / 1000)]);
  }
  // The org board: points every game paid each person, by their place in `people`.
  const board: [number, number][] = [];
  for (const [userId, n] of points) {
    const who = index.get(userId);
    if (who !== undefined && n !== 0) board.push([who, n]);
  }
  return {
    board,
    games: games.map((g) => ({ ...g, tournaments: counts.get(g.key)?.[0] ?? 0, tournamentsOpen: counts.get(g.key)?.[1] ?? 0 })),
    people,
    plays: rows,
  };
}

// ---------------------------------------------------------------- one game

export interface BoardRow {
  rank: number;
  userId: string;
  name: string;
  department: string;
  /** Their best on the game's own board, when it keeps one. */
  best: number | null;
  bestAt: string | null;
  /** Engagement points this game paid them (the ledger's 'game' rows, or the tournament's own). */
  points: number;
  plays: number;
  lastAt: string | null;
}

export interface Standing {
  place: number;
  userId?: string;
  name: string;
  /** What they got to: "Champion", "Semi-final", "1,240 pts", "Team of 6". */
  detail: string;
}

export interface Tournament {
  id: string;
  type: 'cup' | 'poker' | 'relay' | 'squad' | 'launch';
  name: string;
  /** 'upcoming' | 'live' | 'done' | 'cancelled'. */
  state: 'upcoming' | 'live' | 'done' | 'cancelled';
  /** The phase as the game itself words it. */
  phase: string;
  format: string;
  startsAt: string | null;
  endsAt: string | null;
  players: number;
  winner: string | null;
  standings: Standing[];
  /** A knockout the Tournament TV can show (switched on). */
  tv?: boolean;
}

const iso = (d: unknown) => dateOf(d)?.toISOString() ?? null;
const ordinal = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
const pts = (n: number) => `${Math.round(n).toLocaleString('en-IN')} pts`;

function rankBy<T>(rows: T[], value: (row: T) => number): (T & { place: number })[] {
  const out = rows.map((row) => ({ ...row, place: 0 }));
  out.forEach((row, i) => {
    row.place = i > 0 && value(out[i - 1]) === value(row) ? out[i - 1].place : i + 1;
  });
  return out;
}

async function cupTournaments(org: string, key: string, names: Map<string, string>): Promise<Tournament[]> {
  const events = await cupEvents().find({ org, gameKey: key }, { projection: { _id: 0 } }).sort({ startAt: -1 }).toArray();
  if (!events.length) return [];
  const matches = await cupMatches()
    .find({ org, eventId: { $in: events.map((e) => e.id) }, status: 'done' }, { projection: { _id: 0, eventId: 1, round: 1, players: 1, winnerId: 1 } })
    .toArray();
  return events.map((event) => {
    // Where each entrant went out, as the Cup's own standings work it out.
    const out = new Map<string, number>();
    for (const m of matches) {
      if (m.eventId !== event.id || !m.winnerId) continue;
      out.set(m.players[0] === m.winnerId ? m.players[1] : m.players[0], m.round);
    }
    const total = event.rounds.length;
    const roundName = (n: number) => {
      const r = event.rounds[n - 1];
      if (!r) return 'Round 1';
      return r.short === 'F' ? 'Final' : r.short === 'SF' ? 'Semi-final' : r.short === 'QF' ? 'Quarter-final' : r.label;
    };
    const rows = event.entrants
      .map((e) => {
        const round = out.get(e.userId);
        const champion = event.championId === e.userId;
        const detail = champion
          ? 'Champion'
          : round
            ? `Out in the ${roundName(round)}`
            : event.phase === 'done'
              ? 'Did not play'
              : `In the ${roundName(Math.max(1, event.round))}`;
        return { userId: e.userId, name: e.name || names.get(e.userId) || 'Player', seed: e.seed, detail, depth: champion ? total + 2 : round ?? total + 1 };
      })
      .sort((a, b) => b.depth - a.depth || a.seed - b.seed);
    const standings = event.phase === 'scheduled' || event.phase === 'lobby'
      ? event.entrants.slice(0, MAX_STANDINGS).map((e) => ({ place: e.seed, userId: e.userId, name: e.name, detail: `Seed ${e.seed}` }))
      : rankBy(rows, (r) => r.depth).slice(0, MAX_STANDINGS).map((r) => ({ place: r.place, userId: r.userId, name: r.name, detail: r.detail }));
    const state: Tournament['state'] = event.phase === 'done' ? 'done' : event.phase === 'scheduled' ? 'upcoming' : 'live';
    return {
      id: event.id,
      type: 'cup' as const,
      name: event.name,
      state,
      phase: { scheduled: 'Scheduled', lobby: 'Lobby open', running: 'Playing', done: 'Finished' }[event.phase],
      format: 'Knockout · pairs play, the winner moves up',
      startsAt: iso(event.startAt),
      endsAt: iso(event.finishedAt),
      players: event.entrants.length,
      winner: event.championId ? event.entrants.find((e) => e.userId === event.championId)?.name ?? null : null,
      standings,
      tv: event.active === true,
    };
  });
}

async function pokerTournaments(org: string, key: string, names: Map<string, string>): Promise<Tournament[]> {
  const events = (await pokerEvents().find({ org, status: { $ne: 'draft' } }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray())
    .filter((e) => (e.catalogKey || POKER_KEY) === key);
  if (!events.length) return [];
  const results = await pokerResults()
    .aggregate<{ _id: { eventId: string; userId: string }; name: string; points: number; tables: number }>([
      { $match: { org, eventId: { $in: events.map((e) => e.id) }, voided: { $ne: true } } },
      { $group: { _id: { eventId: '$eventId', userId: '$userId' }, name: { $last: '$name' }, points: { $sum: '$points' }, tables: { $sum: 1 } } },
    ])
    .toArray();
  return events.map((event) => {
    const shoot = event.shootout ?? null;
    const mine = results.filter((r) => r._id.eventId === event.id).sort((a, b) => b.points - a.points);
    let standings: Standing[];
    let players: number;
    if (shoot) {
      const joined = new Map(shoot.joined.map((j) => [j.userId, j.name]));
      players = shoot.joined.length;
      standings = (shoot.standings ?? []).slice(0, MAX_STANDINGS).map((userId, i) => ({
        place: i + 1,
        userId,
        name: joined.get(userId) || names.get(userId) || 'Player',
        detail: i === 0 ? 'Winner' : `${ordinal(i + 1)} place`,
      }));
      if (!standings.length) standings = shoot.joined.slice(0, MAX_STANDINGS).map((j, i) => ({ place: i + 1, userId: j.userId, name: j.name, detail: 'Joined' }));
    } else {
      players = mine.length;
      standings = rankBy(mine, (r) => r.points).slice(0, MAX_STANDINGS).map((r) => ({
        place: r.place,
        userId: r._id.userId,
        name: r.name || names.get(r._id.userId) || 'Player',
        detail: `${pts(r.points)} · ${r.tables} table${r.tables === 1 ? '' : 's'}`,
      }));
    }
    const startsAt = iso(event.config.shootout?.startAt) ?? iso(event.config.game?.openFrom) ?? iso(event.createdAt);
    const state: Tournament['state'] = shoot?.status === 'cancelled'
      ? 'cancelled'
      : event.status === 'over' || shoot?.status === 'done'
        ? 'done'
        : startsAt && new Date(startsAt).getTime() > Date.now()
          ? 'upcoming'
          : 'live';
    return {
      id: event.id,
      type: 'poker' as const,
      name: event.name,
      state,
      phase: state === 'done' ? 'Finished' : state === 'cancelled' ? 'Cancelled' : state === 'upcoming' ? 'Scheduled' : event.paused ? 'Paused' : 'On now',
      format: shoot ? 'Shootout · tables of players, the top move up' : 'Open play, then semi-finals and a final',
      startsAt,
      endsAt: iso(event.updatedAt && (event.status === 'over' ? event.updatedAt : null)),
      players,
      winner: event.champion?.name ?? (shoot?.status === 'done' && standings[0] ? standings[0].name : null),
      standings,
    };
  });
}

async function relayTournaments(org: string): Promise<Tournament[]> {
  const events = await relayEvents().find({ org }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
  if (!events.length) return [];
  const ids = events.map((e) => e.id);
  const [teams, progress, presence] = await Promise.all([
    relayTeams().find({ org, eventId: { $in: ids } }, { projection: { _id: 0, id: 1, eventId: 1, name: 1, members: 1 } }).toArray(),
    relayProgress().find({ org, eventId: { $in: ids } }, { projection: { _id: 0, eventId: 1, teamId: 1, totalPoints: 1, totalSecondsUsed: 1 } }).toArray(),
    relayPresence()
      .aggregate<{ _id: string; n: number }>([{ $match: { eventId: { $in: ids } } }, { $group: { _id: '$eventId', n: { $sum: 1 } } }])
      .toArray(),
  ]);
  const playedIn = new Map(presence.map((p) => [p._id, p.n]));
  return events.map((event) => {
    const own = teams.filter((t) => t.eventId === event.id);
    const score = new Map(progress.filter((p) => p.eventId === event.id).map((p) => [p.teamId, p]));
    const rows = own
      .map((t) => ({ t, points: score.get(t.id)?.totalPoints ?? 0, secs: score.get(t.id)?.totalSecondsUsed ?? 0 }))
      .sort((a, b) => b.points - a.points || a.secs - b.secs);
    const started = event.status === 'live' || event.status === 'finished';
    const standings = rankBy(rows, (r) => (started ? r.points * 1e6 - r.secs : 0)).slice(0, MAX_STANDINGS).map((r) => ({
      place: r.place,
      name: r.t.name,
      detail: started ? `${pts(r.points)} · team of ${r.t.members.length}` : `Team of ${r.t.members.length}`,
    }));
    const state: Tournament['state'] = event.status === 'finished' ? 'done' : event.status === 'live' ? 'live' : 'upcoming';
    return {
      id: event.id,
      type: 'relay' as const,
      name: event.name,
      state,
      phase: { draft: 'Being set up', scheduled: 'Scheduled', live: 'Playing', finished: 'Finished' }[event.status],
      format: `Teams · ${event.config.rounds} rounds`,
      startsAt: iso(event.startedAt ?? event.startsAt),
      endsAt: iso(event.finishedAt),
      players: playedIn.get(event.id) ?? own.reduce((s, t) => s + t.members.length, 0),
      winner: event.status === 'finished' && rows[0] && rows[0].points > 0 ? rows[0].t.name : null,
      standings,
    };
  });
}

async function squadTournaments(org: string, names: Map<string, string>): Promise<Tournament[]> {
  const schedules = await squadSchedules().find({ org }, { projection: { _id: 0 } }).sort({ startsAt: -1 }).toArray();
  if (!schedules.length) return [];
  const payouts = await squadPayouts().find({ org, sessionId: { $in: schedules.map((s) => s.id) } }, { projection: { _id: 0 } }).toArray();
  const now = Date.now();
  return schedules.map((s) => {
    const totals = new Map<string, number>();
    for (const p of payouts) {
      if (p.sessionId !== s.id) continue;
      for (const [uid, v] of Object.entries(p.points ?? {})) if (Number.isFinite(v)) totals.set(uid, (totals.get(uid) ?? 0) + v);
    }
    const rows = [...totals.entries()].map(([userId, points]) => ({ userId, points })).sort((a, b) => b.points - a.points);
    const minutes = s.rounds.reduce((sum, r) => sum + (r.huntMs + r.breakMs) / 60_000, 0);
    const ends = new Date(s.startsAt.getTime() + minutes * 60_000);
    const state: Tournament['state'] = s.status === 'cancelled' ? 'cancelled' : s.startsAt.getTime() - s.lobbyMs > now ? 'upcoming' : ends.getTime() > now ? 'live' : 'done';
    return {
      id: s.id,
      type: 'squad' as const,
      name: `Secret Squad · ${s.office}`,
      state,
      phase: state === 'cancelled' ? 'Cancelled' : state === 'upcoming' ? 'Scheduled' : state === 'live' ? 'On now' : 'Finished',
      format: `${s.rounds.length} round${s.rounds.length === 1 ? '' : 's'} · find your squad`,
      startsAt: iso(s.startsAt),
      endsAt: state === 'done' ? ends.toISOString() : null,
      players: rows.length,
      winner: rows[0] ? names.get(rows[0].userId) ?? null : null,
      standings: rankBy(rows, (r) => r.points).slice(0, MAX_STANDINGS).map((r) => ({ place: r.place, userId: r.userId, name: names.get(r.userId) || 'Player', detail: pts(r.points) })),
    };
  });
}

/** Timed game launches on the feed (not the knockouts' own cards): who scored best while each was on. */
async function launchTournaments(org: string, key: string, higherIsBetter: boolean, names: Map<string, string>): Promise<Tournament[]> {
  const posts = await connectPosts()
    .find(
      { org, type: 'game_launch', 'body.gameKey': key, 'body.endsAt': { $exists: true, $ne: '' }, 'body.tournamentId': { $exists: false } },
      { projection: { _id: 0, id: 1, body: 1, createdAt: 1 } },
    )
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
  if (!posts.length) return [];
  const scores = await getDb()
    .collection<{ postId: string; userId: string; playerName: string; score: number; achievedAt: Date }>('game_launch_scores')
    .find({ org, postId: { $in: posts.map((p) => p.id) } }, { projection: { _id: 0 } })
    .toArray();
  const now = Date.now();
  return posts.map((post) => {
    const body = (post.body ?? {}) as Record<string, unknown>;
    const startsAt = iso(body.startsAt) ?? iso((post as { createdAt?: unknown }).createdAt);
    const endsAt = iso(body.endsAt);
    const rows = scores
      .filter((s) => s.postId === post.id)
      .sort((a, b) => (higherIsBetter ? b.score - a.score : a.score - b.score) || a.achievedAt.getTime() - b.achievedAt.getTime());
    const state: Tournament['state'] = startsAt && new Date(startsAt).getTime() > now ? 'upcoming' : endsAt && new Date(endsAt).getTime() > now ? 'live' : 'done';
    return {
      id: post.id,
      type: 'launch' as const,
      name: (typeof body.title === 'string' && body.title.trim()) || 'Timed game',
      state,
      phase: state === 'done' ? 'Finished' : state === 'live' ? 'On now' : 'Scheduled',
      format: 'Timed · best score while it is on',
      startsAt,
      endsAt,
      players: rows.length,
      winner: state === 'done' && rows[0] ? names.get(rows[0].userId) || rows[0].playerName : null,
      standings: rankBy(rows, (r) => Math.round(r.score)).slice(0, MAX_STANDINGS).map((r) => ({
        place: r.place,
        userId: r.userId,
        name: names.get(r.userId) || r.playerName || 'Player',
        detail: Math.round(r.score).toLocaleString('en-IN'),
      })),
    };
  });
}

/** One game's page: its board (everyone on it), its tournaments, newest first. Its analytics come from the overview's plays. */
export async function gameDetail(org: string, key: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) throw new EngagementGamesError(400, 'Unknown game');
  const games = await lineUpFor(org);
  const game = games.find((g) => g.key === key);
  if (!game) throw new EngagementGamesError(404, 'This game is not on your company’s app');

  const [plays, bests, ledger, people] = await Promise.all([
    playsOf(org).then((all) => all.filter((p) => p.key === key)),
    game.scoring
      ? gameScores()
          .find({ org, gameId: `catalog:${key}` }, { projection: { _id: 0, userId: 1, playerName: 1, score: 1, achievedAt: 1 } })
          .toArray()
      : Promise.resolve([] as Pick<GameScore, 'userId' | 'playerName' | 'score' | 'achievedAt'>[]),
    pointEvents()
      .aggregate<{ _id: string; points: number }>([
        { $match: { org, ...(key === RELAY_KEY ? { source: 'hint_relay' } : { reason: 'game', gameKey: key }) } },
        { $group: { _id: '$userId', points: { $sum: '$delta' } } },
      ])
      .toArray(),
    users().find({ org }, { projection: { _id: 0, userId: 1, name: 1, department: 1 } }).toArray(),
  ]);
  const names = new Map(people.map((u) => [u.userId, u.name]));
  const dept = new Map(people.map((u) => [u.userId, u.department ?? '']));

  // Speed Poker pays its points through its own results, not the ledger.
  const pokerIds = (await pokerEvents().find({ org }, { projection: { _id: 0, id: 1, catalogKey: 1 } }).toArray())
    .filter((e) => (e.catalogKey || POKER_KEY) === key)
    .map((e) => e.id);
  const pokerPoints = pokerIds.length
    ? await pokerResults()
        .aggregate<{ _id: string; points: number }>([
          { $match: { org, eventId: { $in: pokerIds }, voided: { $ne: true } } },
          { $group: { _id: '$userId', points: { $sum: '$points' } } },
        ])
        .toArray()
    : [];

  const byUser = new Map<string, { best: number | null; bestAt: Date | null; points: number; plays: number; last: Date | null; name: string }>();
  const row = (userId: string, name = '') => {
    let r = byUser.get(userId);
    if (!r) byUser.set(userId, (r = { best: null, bestAt: null, points: 0, plays: 0, last: null, name: names.get(userId) || name || 'Player' }));
    return r;
  };
  for (const b of bests) Object.assign(row(b.userId, b.playerName), { best: b.score, bestAt: b.achievedAt });
  for (const l of ledger) row(l._id).points += l.points;
  for (const p of pokerPoints) row(p._id).points += p.points;
  for (const p of plays) {
    const r = row(p.userId);
    r.plays += 1;
    if (!r.last || p.at > r.last) r.last = p.at;
  }
  const higher = game.scoring?.higherIsBetter !== false;
  const sorted = [...byUser.entries()]
    .map(([userId, r]) => ({ userId, ...r }))
    .filter((r) => r.best !== null || r.points !== 0 || r.plays > 0)
    .sort((a, b) => {
      if (game.scoring && a.best !== b.best) {
        if (a.best === null || b.best === null) return a.best === null ? 1 : -1;
        return higher ? b.best - a.best : a.best - b.best;
      }
      return b.points - a.points || b.plays - a.plays;
    });
  // On a scored board, people without a best (points or plays only) come after, each in their own place.
  const board: BoardRow[] = rankBy(sorted, (r) => (game.scoring ? (r.best ?? Number.NaN) : r.points)).map((r) => ({
    rank: r.place,
    userId: r.userId,
    name: r.name,
    department: dept.get(r.userId) ?? '',
    best: r.best,
    bestAt: iso(r.bestAt),
    points: r.points,
    plays: r.plays,
    lastAt: iso(r.last),
  }));

  const tournaments: Tournament[] = (
    await Promise.all([
      cupTournaments(org, key, names),
      pokerTournaments(org, key, names),
      key === RELAY_KEY ? relayTournaments(org) : Promise.resolve([]),
      key === SQUAD_KEY ? squadTournaments(org, names) : Promise.resolve([]),
      launchTournaments(org, key, higher, names),
    ])
  )
    .flat()
    .sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''));

  return {
    game,
    board: { by: game.scoring ? ('best' as const) : ('points' as const), label: game.scoring?.label ?? 'points', higherIsBetter: higher, rows: board },
    tournaments,
  };
}
