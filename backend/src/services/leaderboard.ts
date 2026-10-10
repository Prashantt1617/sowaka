/**
 * Ranking by engagement points, kept free of the database so it can be
 * checked on its own (`src/scripts/leaderboard-check.ts`).
 */
import type { PointEvent, PointSource } from '../models/points.model';

export interface Contender {
  userId: string;
  name: string;
  /** Absent on everyone who has never earned any, which reads as zero. */
  points?: number;
}

export interface RankedEntry {
  userId: string;
  name: string;
  points: number;
  /**
   * Shared on a tie, and the next distinct score skips past the tied places:
   * 980, 860, 860, 790 rank 1, 2, 2, 4. Someone's rank is one more than the
   * number of people strictly ahead of them.
   */
  rank: number;
}

/** A balance as a whole, non-negative number of points. */
export function pointsOf(value: unknown): number {
  const points = Number(value);
  return Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
}

/**
 * Everyone, highest first. Ties are listed by name so the order is the same on
 * every read, but they share a rank.
 */
export function rankByPoints(people: Contender[]): RankedEntry[] {
  const sorted = people
    .map((person) => ({
      userId: person.userId,
      name: person.name,
      points: pointsOf(person.points),
    }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        a.name.localeCompare(b.name) ||
        a.userId.localeCompare(b.userId),
    );
  let rank = 0;
  return sorted.map((entry, index) => {
    if (index === 0 || entry.points !== sorted[index - 1].points) rank = index + 1;
    return { ...entry, rank };
  });
}

/**
 * The top three for the podium. Nobody stands on it for zero points: an org
 * that has not played yet gets an empty podium, not three names picked by the
 * alphabet.
 */
export function podiumOf(ranked: RankedEntry[]): RankedEntry[] {
  return ranked.filter((entry) => entry.points > 0).slice(0, 3);
}

/**
 * How many places someone has climbed since the given balances. Positive is
 * up. Everyone is re-ranked as they stood then, so a place lost to someone
 * else overtaking counts as much as a place won.
 */
export function placesMoved(
  people: Contender[],
  earnedSince: Map<string, number>,
  userId: string,
): number {
  const now = rankByPoints(people).find((entry) => entry.userId === userId);
  const then = rankByPoints(
    people.map((person) => ({
      ...person,
      points: pointsOf(person.points) - (earnedSince.get(person.userId) ?? 0),
    })),
  ).find((entry) => entry.userId === userId);
  if (!now || !then) return 0;
  // Nobody stands anywhere on zero points. Ranked as a tie they would all
  // share the place after the last scorer — near the top in a company that
  // has barely played — and earning points would read as falling. They count
  // as last instead, so starting from nothing reads as a climb.
  const placeOf = (entry: RankedEntry) => (entry.points > 0 ? entry.rank : people.length);
  return placeOf(then) - placeOf(now);
}

export interface ActivityGroup {
  source: PointSource;
  refId: string | null;
  /** What the row is called — the game or challenge. */
  title: string;
  /** The line under it: what kind of challenge, and how it was earned. */
  detail: string;
  /** Net points from this source in the month. */
  points: number;
  /** The latest change in the group. */
  at: string;
  /** The catalog game a game challenge was played in, for its picture. */
  gameKey?: string;
}

const sourceTitles: Record<PointSource, string> = {
  caption_challenge: 'Caption Contest',
  photo_story_challenge: 'Content Contest',
  most_likely: 'Most Tagged',
  hint_relay: 'Hint Relay',
  // A game challenge is titled by its game, from the event; this is the fallback.
  game_challenge: 'Game challenge',
};

const sourceKinds: Record<PointSource, string> = {
  caption_challenge: 'Community challenge',
  photo_story_challenge: 'Creative challenge',
  most_likely: 'Social challenge',
  hint_relay: 'Game',
  game_challenge: 'Game',
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * A month's ledger rows as the activity list shows them: one row per
 * challenge or game, newest first, with what it came to. A challenge whose
 * points all went back again (an entry deleted, every vote withdrawn) nets to
 * nothing and is left out.
 */
export function groupActivity(events: PointEvent[]): ActivityGroup[] {
  const groups = new Map<string, PointEvent[]>();
  for (const event of events) {
    const key = `${event.source}:${event.refId ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  const rows: ActivityGroup[] = [];
  for (const list of groups.values()) {
    const points = list.reduce((sum, event) => sum + event.delta, 0);
    const latest = list.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    const source = latest.source;
    // A game is listed even when it paid nothing; anything else that nets to
    // zero (a deleted entry, votes withdrawn) is left out.
    if (points === 0 && source !== 'game_challenge') continue;
    const count = (reason: PointEvent['reason']) =>
      list.filter((event) => event.reason === reason).length;
    const votes = Math.max(0, count('vote_received') - count('vote_withdrawn'));
    const how = (() => {
      switch (source) {
        case 'most_likely':
          return plural(Math.max(0, count('tagged')), 'mention', 'mentions');
        case 'hint_relay': {
          const note = [...list].reverse().find((event) => event.note)?.note;
          return note ?? plural(list.length, 'game played', 'games played');
        }
        // One challenge per row: who it was against and how it ended.
        case 'game_challenge':
          return latest.note ?? 'Challenge played';
        default:
          return `${plural(votes, 'vote', 'votes')} received`;
      }
    })();
    rows.push({
      source,
      refId: latest.refId ?? null,
      title: (source === 'game_challenge' ? latest.title : undefined) ?? sourceTitles[source] ?? 'Points',
      detail: `${sourceKinds[source] ?? 'Activity'} · ${how}`,
      points,
      at: latest.createdAt.toISOString(),
      ...(latest.gameKey ? { gameKey: latest.gameKey } : {}),
    });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/** 'YYYY-MM' for a date, in UTC as the rest of the server dates months. */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** The first instant of a 'YYYY-MM' month and of the one after it, in UTC. */
export function monthBounds(month: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11) return null;
  return {
    start: new Date(Date.UTC(year, index, 1)),
    end: new Date(Date.UTC(year, index + 1, 1)),
  };
}
