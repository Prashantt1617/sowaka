/**
 * The Games home's decisions, kept free of the database so they can be
 * checked on their own (`src/scripts/games-home-check.ts`): which contests
 * count as live, when the week began, who to chase on the leaderboard, and
 * which colleague's score to tell the viewer about.
 */
import { pointsOf, type RankedEntry } from './leaderboard';

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back a colleague's new best is news. */
export const BANNER_WINDOW_MS = 48 * 60 * 60 * 1000;
/** How recently someone must have played to count as playing now. */
export const PLAYING_NOW_WINDOW_MS = 15 * 60 * 1000;
/**
 * A contest with no closing time never closes (the server keeps taking
 * entries), but one posted weeks ago is not what "live" means on the Games
 * home. It shows there for this long after it was posted.
 */
export const OPEN_ENDED_CONTEST_MS = 14 * DAY_MS;

/** Monday 00:00 in India, as an instant: when "this week" began. */
export function istWeekStart(now: Date): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const sinceMonday = (shifted.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - sinceMonday) -
      IST_OFFSET_MS,
  );
}

/**
 * Whether a contest is still taking entries, and so belongs in Live Games:
 * its closing time is ahead, or it has none (or only the free text these used
 * to carry) and was posted recently.
 */
export function contestIsLive(
  closesAt: unknown,
  publishedAt: Date,
  now: Date,
): { live: boolean; closesAt: Date | null } {
  const raw = typeof closesAt === 'string' ? closesAt.trim() : '';
  const when = raw ? new Date(raw) : null;
  if (when && !Number.isNaN(when.getTime())) {
    return { live: when.getTime() > now.getTime(), closesAt: when };
  }
  return { live: now.getTime() - publishedAt.getTime() <= OPEN_ENDED_CONTEST_MS, closesAt: null };
}

/**
 * Live contests in the order the carousel shows them: those closing soonest
 * first, then the open-ended ones, newest first.
 */
export function orderLiveContests<T extends { closesAt: Date | null; publishedAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.closesAt && b.closesAt) return a.closesAt.getTime() - b.closesAt.getTime();
    if (a.closesAt) return -1;
    if (b.closesAt) return 1;
    return b.publishedAt.getTime() - a.publishedAt.getTime();
  });
}

export interface NextUp {
  userId: string;
  name: string;
  /** Their place. */
  rank: number;
  /** Points the viewer needs to go past them: one more than the difference. */
  gap: number;
}

/**
 * The person just ahead of [userId]: the closest score strictly above theirs.
 * Null for whoever leads, and for someone not on the board.
 */
export function nextUpFor(ranked: RankedEntry[], userId: string): NextUp | null {
  const me = ranked.find((entry) => entry.userId === userId);
  if (!me) return null;
  let ahead: RankedEntry | null = null;
  for (const entry of ranked) {
    if (entry.points > me.points && (!ahead || entry.points < ahead.points)) ahead = entry;
  }
  if (!ahead) return null;
  return { userId: ahead.userId, name: ahead.name, rank: ahead.rank, gap: ahead.points - me.points + 1 };
}

/**
 * How many places each person has moved since [earnedSince] was earned:
 * positive is up. Nobody stands anywhere on zero points, so a zero counts as
 * last place — starting from nothing reads as a climb, never a fall.
 */
export function movementSince(
  now: RankedEntry[],
  then: RankedEntry[],
  total: number,
): Map<string, number> {
  const placeOf = (entry: RankedEntry | undefined) =>
    entry && entry.points > 0 ? entry.rank : total;
  const before = new Map(then.map((entry) => [entry.userId, entry]));
  return new Map(
    now.map((entry) => [entry.userId, placeOf(before.get(entry.userId)) - placeOf(entry)]),
  );
}

/** A balance as it stood before [delta] was earned, never below zero. */
export function pointsBefore(points: unknown, delta: number | undefined): number {
  return Math.max(0, pointsOf(points) - (delta ?? 0));
}

export interface BestScore {
  userId: string;
  score: number;
  achievedAt: Date;
}

/**
 * Whether [theirs] went past [mine]: better, set after the viewer's own best
 * (before it, the viewer has since moved and is still behind — no news), and
 * recently enough to be news.
 */
export function passedSince(
  mine: BestScore,
  theirs: BestScore,
  higherIsBetter: boolean,
  now: Date,
): boolean {
  if (theirs.userId === mine.userId) return false;
  const better = higherIsBetter ? theirs.score > mine.score : theirs.score < mine.score;
  return (
    better &&
    theirs.achievedAt.getTime() > mine.achievedAt.getTime() &&
    now.getTime() - theirs.achievedAt.getTime() <= BANNER_WINDOW_MS
  );
}

/** Whether a moment falls in the playing-now window. */
export function playedRecently(at: unknown, now: Date): boolean {
  const when = at instanceof Date ? at : typeof at === 'string' ? new Date(at) : null;
  if (!when || Number.isNaN(when.getTime())) return false;
  const age = now.getTime() - when.getTime();
  return age >= -60_000 && age <= PLAYING_NOW_WINDOW_MS;
}

/** "AB" from "Ananya Bisht"; one letter for one name. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

// ---------------------------------------------------------------- Diwali Mehfil

/** One game of the Mehfil's line-up, as the Games tab shows it. */
export interface MehfilEvent {
  id: string;
  /** The catalog game it is played as, for its icon, how-to-play and Practice. */
  gameKey: string;
  name: string;
  /** What kind of game it is: "Office game", "1v1 knockout". */
  kind: string;
  /** India time, "15:00". */
  at: string;
  minutes: number;
  /** The page's colours for its event page. */
  theme: 'squad' | 'trails' | 'relay' | 'odd' | 'poker';
  /** 'cup' adds the knockout's rules to its page; 'relay' is the team game; 'shootout' is Speed Poker's. */
  format?: 'cup' | 'relay' | 'shootout';
  /** How a match is won, in a sentence, for a knockout's rules. */
  win?: string;
  /** Whether its page offers a practice game of `gameKey` first. */
  practice?: boolean;
}

export interface Mehfil {
  /** The evening, India's date. */
  date: string;
  /** `cupEventId`: a knockout row's tournament, once one is set up and switched on (see games-home.service). */
  /** `pokerPhase`: a Shootout row's Speed Poker Shootout, once one is set up and on (its phase: upcoming, lobby, shootout, over). */
  events: Array<MehfilEvent & { startsAt: string; endsAt: string; cupEventId?: string; cupPhase?: string; pokerPhase?: string }>;
}

/**
 * The evening's line-up, 4 Nov 2026. Only the countdown for now: the games
 * themselves are joined as they always are, until the tournaments are wired
 * to these rows in a later release.
 */
export const DIWALI_MEHFIL: { date: string; events: MehfilEvent[] } = {
  date: '2026-11-04',
  events: [
    { id: 'mf-squad', gameKey: 'secret-squad', name: 'Secret Squad', kind: 'Office game', at: '15:00', minutes: 17, theme: 'squad' },
    {
      id: 'mf-trails', gameKey: 'trails', name: 'Trails Tournament', kind: '1v1 knockout', at: '16:00', minutes: 45, theme: 'trails',
      format: 'cup', win: 'Faster one wins.', practice: true,
    },
    { id: 'mf-relay', gameKey: 'hint-relay', name: 'Hint Relay', kind: 'Team game · 5 rounds', at: '17:00', minutes: 25, theme: 'relay', format: 'relay' },
    {
      id: 'mf-odd', gameKey: 'odd-one-out', name: 'Odd One Out Tournament', kind: '1v1 knockout', at: '18:00', minutes: 45, theme: 'odd',
      format: 'cup', win: 'Higher score wins.', practice: true,
    },
    { id: 'mf-poker', gameKey: 'speed-poker', name: 'Poker Shootout', kind: 'Card tournament', at: '19:00', minutes: 45, theme: 'poker', format: 'shootout', practice: true },
  ],
};

/**
 * The Mehfil for the Games home: at a company that has it, from now until the
 * evening's India day is over, with each game's start and end as instants.
 */
export function mehfilFor(
  enabled: boolean,
  now: Date,
  schedule: { date: string; events: MehfilEvent[] } = DIWALI_MEHFIL,
): Mehfil | null {
  if (!enabled) return null;
  const dayEnds = new Date(`${schedule.date}T00:00:00.000+05:30`).getTime() + DAY_MS;
  if (Number.isNaN(dayEnds) || now.getTime() >= dayEnds) return null;
  return {
    date: schedule.date,
    events: schedule.events.map((event) => {
      const start = new Date(`${schedule.date}T${event.at}:00.000+05:30`);
      return {
        ...event,
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + event.minutes * 60_000).toISOString(),
      };
    }),
  };
}
