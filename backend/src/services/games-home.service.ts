/**
 * The Games tab's home and its points leaderboard, each in one round trip.
 *
 * Read only: everything here is gathered from what other features already
 * write — engagement points on the user (`User.points`) and their ledger
 * (`point_events`), catalog scores (`game_scores`), colleague challenges, the
 * Connect contests in the viewer's feed, and the company's Hint Relay. The
 * rules (what counts as live, the week, who is next up) are in
 * `games-home-rules.ts`.
 */
import type { Filter } from 'mongodb';
import {
  connectPosts,
  gameChallenges,
  gameScores,
  relayEvents,
  relayPresence,
  relayTeams,
  users,
} from '../config/db';
import type { ConnectPost, ConnectPostType } from '../models/connect.model';
import { catalogScoreId } from '../models/game-catalog.model';
import type { GameChallenge } from '../models/game-challenge.model';
import type { User } from '../models/user.model';
import { blockedUserIdsFor } from './connect-blocks.service';
import { catalogFor, GameCatalogError, type PublicGame } from './game-catalog.service';
import {
  contestIsLive,
  firstNameOf,
  initialsOf,
  istWeekStart,
  movementSince,
  nextUpFor,
  orderLiveContests,
  passedSince,
  playedRecently,
  pointsBefore,
  BANNER_WINDOW_MS,
  OPEN_ENDED_CONTEST_MS,
  PLAYING_NOW_WINDOW_MS,
} from './games-home-rules';
import { rankByPoints, type Contender, type RankedEntry } from './leaderboard';
import { pointEvents } from './points-ledger.service';
import { rosterFor } from './profile.service';
import { resolveProfilePhoto } from './s3-connect-media.service';

const CONTEST_TYPES: ConnectPostType[] = ['caption_challenge', 'photo_story_challenge', 'most_likely'];
const CONTEST_KIND: Record<string, 'caption' | 'photo' | 'mostLikely'> = {
  caption_challenge: 'caption',
  photo_story_challenge: 'photo',
  most_likely: 'mostLikely',
};
const MAX_LIVE_CONTESTS = 10;
const MAX_CHALLENGES = 5;
const ENTRANT_FACES = 3;
const PLAYING_FACES = 3;

type PhotoFields = Pick<User, 'userId' | 'name' | 'profilePhotoKey' | 'profilePhotoUrl'>;

async function requireViewer(userId: string): Promise<User> {
  const viewer = await users().findOne(
    { userId },
    // A legacy inline photo can be large, and nothing here draws the viewer's.
    { projection: { _id: 0, profilePhotoUrl: 0, documents: 0, helpIntake: 0, helpMatch: 0, counsellor: 0 } },
  );
  if (!viewer) throw new GameCatalogError(404, 'User not found');
  return viewer;
}

/** Same as the feed's: the org, else the email's domain. */
const feedOrgOf = (user: Pick<User, 'org' | 'email'>) => user.org ?? user.email.split('@').at(1) ?? 'default';

/** A photo as a whole URL, never a legacy inline one. */
/** Photos kept as links rather than uploads, by userId: only the rows that have one, and only that field. */
async function linkPhotosOf(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await users()
    .find(
      { userId: { $in: userIds }, profilePhotoUrl: { $regex: '^http' } },
      { projection: { _id: 0, userId: 1, profilePhotoUrl: 1 } },
    )
    .toArray();
  return new Map(rows.map((row) => [row.userId, row.profilePhotoUrl!]));
}

async function photoOf(row: Partial<PhotoFields> | null | undefined): Promise<string | null> {
  if (!row) return null;
  const url = await resolveProfilePhoto({
    profilePhotoKey: row.profilePhotoKey,
    profilePhotoUrl: row.profilePhotoUrl?.startsWith('http') ? row.profilePhotoUrl : undefined,
  });
  return url ?? null;
}

/** Name and photo for a handful of people, in one read. */
async function peopleById(userIds: string[]): Promise<Map<string, { name: string; photoUrl: string | null }>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await users()
    .find(
      { userId: { $in: ids } },
      { projection: { _id: 0, userId: 1, name: 1, profilePhotoKey: 1, profilePhotoUrl: 1 } },
    )
    .toArray();
  return new Map(
    await Promise.all(
      rows.map(async (row) => [row.userId, { name: row.name, photoUrl: await photoOf(row) }] as const),
    ),
  );
}

// ---------------------------------------------------------------- the home

type ScoreRow = Awaited<ReturnType<typeof myScoresFor>>[number];

/** The viewer's own bests in the company's catalog games, read once for the banner and Your Games. */
function myScoresFor(viewer: User) {
  return viewer.org
    ? gameScores().find({ userId: viewer.userId, org: viewer.org, gameId: /^catalog:/ }).toArray()
    : Promise.resolve([]);
}

export interface ScoreBanner {
  gameKey: string;
  gameName: string;
  userId: string;
  name: string;
  firstName: string;
  photoUrl: string | null;
  /** Their new best, and the viewer's own that it passed. */
  score: number;
  yourBest: number;
  at: Date;
}

/**
 * The latest time in the last two days that a colleague's best in one of the
 * company's games went past the viewer's own. Null when nobody did.
 */
async function scoreBannerFor(
  viewer: User,
  games: PublicGame[],
  allMine: ScoreRow[],
  blocked: string[],
  now: Date,
): Promise<ScoreBanner | null> {
  const scored = games.filter((game) => game.scoring);
  const mine = allMine.filter((own) => scored.some((game) => catalogScoreId(game.key) === own.gameId));
  if (!viewer.org || mine.length === 0) return null;
  const since = new Date(now.getTime() - BANNER_WINDOW_MS);
  const found = await Promise.all(
    mine.map(async (own) => {
      const game = scored.find((g) => catalogScoreId(g.key) === own.gameId)!;
      const higherIsBetter = game.scoring!.higherIsBetter !== false;
      const [theirs] = await gameScores()
        .find({
          gameId: own.gameId,
          org: viewer.org,
          userId: { $nin: [viewer.userId, ...blocked] },
          score: higherIsBetter ? { $gt: own.score } : { $lt: own.score },
          achievedAt: { $gt: own.achievedAt > since ? own.achievedAt : since },
        })
        .sort({ achievedAt: -1 })
        .limit(1)
        .toArray();
      return theirs && passedSince(own, theirs, higherIsBetter, now) ? { game, own, theirs } : null;
    }),
  );
  const latest = found
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.theirs.achievedAt.getTime() - a.theirs.achievedAt.getTime())[0];
  if (!latest) return null;
  const who = (await peopleById([latest.theirs.userId])).get(latest.theirs.userId);
  const name = who?.name ?? latest.theirs.playerName;
  return {
    gameKey: latest.game.key,
    gameName: latest.game.name,
    userId: latest.theirs.userId,
    name,
    firstName: firstNameOf(name),
    photoUrl: who?.photoUrl ?? null,
    score: latest.theirs.score,
    yourBest: latest.own.score,
    at: latest.theirs.achievedAt,
  };
}

export interface LiveContest {
  /** The Connect post. */
  id: string;
  type: 'caption' | 'photo' | 'mostLikely';
  postType: ConnectPostType;
  title: string;
  /** The brief: a caption or photo contest's task, a Most Likely question. */
  prompt: string;
  /** Null for one with no closing time. */
  closesAt: Date | null;
  publishedAt: Date;
  author: { userId: string | null; name: string; photoUrl: string | null };
  entries: number;
  /** The latest few to enter, for the faces under the card. */
  entrants: { name: string; initials: string; photoUrl: string | null }[];
  /** The viewer has an entry in already. */
  entered: boolean;
}

/** Teams the viewer belongs to, as the feed scopes a "Team" post. */
const visibleTeamIds = (viewer: User) =>
  [viewer.userId, viewer.managerUserId].filter((id): id is string => typeof id === 'string' && id.length > 0);

/**
 * The contests in the viewer's feed that are still taking entries: the same
 * company, audience and blocks the feed applies, closing soonest first.
 */
async function liveContestsFor(viewer: User, blockedList: Promise<string[]>, now: Date): Promise<LiveContest[]> {
  const filter: Filter<ConnectPost> = {
    org: feedOrgOf(viewer),
    type: { $in: CONTEST_TYPES },
    $and: [
      {
        $or: [
          { 'audience.teamId': null, 'audience.department': null },
          { 'audience.teamId': { $in: visibleTeamIds(viewer) } },
          { 'audience.department': viewer.department },
        ],
      },
      // A closing time still ahead (ISO strings compare as times), or posted
      // recently enough to count when it has none; read exactly below.
      {
        $or: [
          { 'body.closesAt': { $gt: now.toISOString() } },
          { publishedAt: { $gte: new Date(now.getTime() - OPEN_ENDED_CONTEST_MS) } },
        ],
      },
    ],
  };
  // Blocks are applied after the read, so the two go together.
  const [found, blocked] = await Promise.all([
    connectPosts()
      .find(filter, {
        projection: { _id: 0, id: 1, type: 1, body: 1, author: 1, captionEntries: 1, publishedAt: 1 },
      })
      .sort({ publishedAt: -1 })
      .limit(60)
      .toArray(),
    blockedList,
  ]);
  // A blocked colleague's own posts drop out, as in the feed.
  const posts = found.filter((post) => !post.author.userId || !blocked.includes(post.author.userId));
  const live = orderLiveContests(
    posts
      .map((post) => ({ post, publishedAt: post.publishedAt, ...contestIsLive(post.body?.closesAt, post.publishedAt, now) }))
      .filter((row) => row.live),
  ).slice(0, MAX_LIVE_CONTESTS);
  if (live.length === 0) return [];

  const entriesOf = (post: ConnectPost) =>
    (post.captionEntries ?? []).filter((entry) => !blocked.includes(entry.userId));
  const faces = live.flatMap(({ post }) => [
    post.author.userId ?? '',
    ...entriesOf(post)
      .slice(-ENTRANT_FACES)
      .map((entry) => entry.userId),
  ]);
  const people = await peopleById(faces);
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

  return live.map(({ post, closesAt }) => {
    const entries = entriesOf(post);
    const authorId = post.author.userId ?? null;
    return {
      id: post.id,
      type: CONTEST_KIND[post.type] ?? 'caption',
      postType: post.type,
      title: text(post.body.title),
      prompt: post.type === 'most_likely' ? text(post.body.question) : text(post.body.task),
      closesAt,
      publishedAt: post.publishedAt,
      author: {
        userId: authorId,
        name: (authorId && people.get(authorId)?.name) || post.author.name,
        photoUrl: (authorId && people.get(authorId)?.photoUrl) || post.author.photoUrl || null,
      },
      entries: entries.length,
      entrants: entries
        .slice(-ENTRANT_FACES)
        .reverse()
        .map((entry) => ({
          name: entry.name,
          initials: entry.initials || initialsOf(entry.name),
          photoUrl: people.get(entry.userId)?.photoUrl ?? null,
        })),
      entered: entries.some((entry) => entry.userId === viewer.userId),
    };
  });
}

export interface LiveRelay {
  eventId: string;
  title: string;
  status: 'scheduled' | 'live';
  /** Playing now, its lobby open, or still to come. */
  phase: 'live' | 'lobby' | 'upcoming';
  startsAt: Date | null;
  lobbyOpensAt: Date | null;
  /** Its post in Connect, where the game is joined from. */
  postId: string | null;
  players: number;
  teams: number;
  /** The viewer's team, when they are on one. */
  teamName: string | null;
}

/** The company's Hint Relay, while it is on or still to come. */
async function liveRelayFor(viewer: User, now: Date): Promise<LiveRelay | null> {
  const org = feedOrgOf(viewer);
  const event = await relayEvents().findOne(
    { org, status: { $in: ['scheduled', 'live'] } },
    { sort: { updatedAt: -1 }, projection: { _id: 0, id: 1, name: 1, status: 1, startsAt: 1, lobbyOpensAt: 1 } },
  );
  if (!event) return null;
  const [post, teams] = await Promise.all([
    connectPosts().findOne(
      { org, type: 'relay_game', 'body.eventId': event.id },
      { sort: { publishedAt: -1 }, projection: { _id: 0, id: 1 } },
    ),
    relayTeams()
      .find({ eventId: event.id }, { projection: { _id: 0, name: 1, members: 1 } })
      .toArray(),
  ]);
  const mine = teams.find((team) => team.members.some((member) => member.userId === viewer.userId));
  const lobbyOpen = !event.lobbyOpensAt || event.lobbyOpensAt.getTime() <= now.getTime();
  return {
    eventId: event.id,
    title: event.name || 'Hint Relay',
    status: event.status === 'live' ? 'live' : 'scheduled',
    phase: event.status === 'live' ? 'live' : lobbyOpen ? 'lobby' : 'upcoming',
    startsAt: event.startsAt ?? null,
    lobbyOpensAt: event.lobbyOpensAt ?? null,
    postId: post?.id ?? null,
    players: teams.reduce((sum, team) => sum + team.members.length, 0),
    teams: teams.length,
    teamName: mine?.name ?? null,
  };
}

export interface HomeChallenge {
  id: string;
  gameKey: string;
  gameName: string;
  /** Waiting on the viewer's answer, or accepted and waiting on their round. */
  kind: 'incoming' | 'your_turn';
  from: { userId: string; name: string; firstName: string; photoUrl: string | null };
  /** What to beat: their round in this challenge once played, else their best in the game. */
  beat: number | null;
  expiresAt: Date;
}

/**
 * Colleague challenges waiting on the viewer: ones sent to them, and ones
 * they accepted but have not played yet. Only in games the company still has.
 */
async function challengesFor(viewer: User, catalog: Promise<PublicGame[]>, now: Date): Promise<HomeChallenge[]> {
  if (!viewer.org) return [];
  const me = viewer.userId;
  const rowsP = gameChallenges()
    .find(
      {
        org: viewer.org,
        expiresAt: { $gt: now },
        $or: [
          { opponentUserId: me, status: 'pending' },
          {
            status: 'accepted',
            $and: [
              { $or: [{ challengerUserId: me }, { opponentUserId: me }] },
              { [`scores.${me}`]: { $exists: false } },
            ],
          },
        ],
      } as Filter<GameChallenge>,
      { projection: { _id: 0 } },
    )
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
  const [rows, games] = await Promise.all([rowsP, catalog]);
  const playable = rows.filter((row) => games.some((game) => game.key === row.gameKey)).slice(0, MAX_CHALLENGES);
  if (playable.length === 0) return [];
  const other = (c: GameChallenge) => (c.challengerUserId === me ? c.opponentUserId : c.challengerUserId);
  const [people, bests] = await Promise.all([
    peopleById(playable.map(other)),
    gameScores()
      .find({
        org: viewer.org,
        $or: playable.map((c) => ({ gameId: catalogScoreId(c.gameKey), userId: other(c) })),
      })
      .toArray(),
  ]);
  return playable.map((c) => {
    const them = other(c);
    const name = people.get(them)?.name ?? (them === c.challengerUserId ? c.challengerName : c.opponentName);
    const best = bests.find((row) => row.userId === them && row.gameId === catalogScoreId(c.gameKey));
    return {
      id: c.id,
      gameKey: c.gameKey,
      gameName: games.find((game) => game.key === c.gameKey)!.name,
      kind: c.status === 'pending' ? 'incoming' : 'your_turn',
      from: { userId: them, name, firstName: firstNameOf(name), photoUrl: people.get(them)?.photoUrl ?? null },
      beat: c.scores?.[them]?.score ?? best?.score ?? null,
      expiresAt: c.expiresAt,
    };
  });
}

export interface PlayedGame {
  key: string;
  best: number;
  achievedAt: Date;
  /** Where the best ranks on the company's board for the game. */
  rank: number;
  /** Everyone at the company with a score in it. */
  players: number;
}

/** The company's games the viewer has a score in, with their best and where it stands. */
async function playedGamesFor(viewer: User, games: PublicGame[], allMine: ScoreRow[]): Promise<PlayedGame[]> {
  const scored = games.filter((game) => game.scoring);
  const mine = allMine.filter((own) => scored.some((game) => catalogScoreId(game.key) === own.gameId));
  if (!viewer.org || mine.length === 0) return [];
  const played = await Promise.all(
    mine.map(async (own) => {
      const game = scored.find((g) => catalogScoreId(g.key) === own.gameId)!;
      const higherIsBetter = game.scoring!.higherIsBetter !== false;
      const [ahead, players] = await Promise.all([
        gameScores().countDocuments({
          gameId: own.gameId,
          org: viewer.org,
          $or: [
            { score: higherIsBetter ? { $gt: own.score } : { $lt: own.score } },
            { score: own.score, achievedAt: { $lt: own.achievedAt } },
          ],
        }),
        gameScores().countDocuments({ gameId: own.gameId, org: viewer.org }),
      ]);
      return { key: game.key, best: own.score, achievedAt: own.achievedAt, rank: ahead + 1, players };
    }),
  );
  // In the catalog's order.
  return games.flatMap((game) => played.filter((row) => row.key === game.key));
}

export interface PlayingNow {
  count: number;
  people: { name: string; initials: string }[];
}

/**
 * Colleagues with game activity in the last few minutes: a catalog score, a
 * challenge round reported or finished, game points paid, or a heartbeat in
 * the company's live relay. The viewer is not counted.
 */
async function playingNowFor(
  viewer: User,
  roster: Contender[],
  relay: LiveRelay | null,
  now: Date,
): Promise<PlayingNow> {
  if (!viewer.org) return { count: 0, people: [] };
  const cutoff = new Date(now.getTime() - PLAYING_NOW_WINDOW_MS);
  const [scorers, challenges, paid, present] = await Promise.all([
    gameScores().distinct('userId', { org: viewer.org, updatedAt: { $gte: cutoff } }),
    gameChallenges()
      .find(
        {
          org: viewer.org,
          $or: [{ status: 'accepted', expiresAt: { $gt: cutoff } }, { updatedAt: { $gte: cutoff } }],
        },
        { projection: { _id: 0, live: 1, scores: 1 } },
      )
      .limit(200)
      .toArray(),
    pointEvents().distinct('userId', {
      org: viewer.org,
      createdAt: { $gte: cutoff },
      source: { $in: ['game_challenge', 'hint_relay'] },
    }),
    relay?.status === 'live'
      ? relayPresence().distinct('userId', { eventId: relay.eventId, lastSeenAt: { $gte: cutoff } })
      : Promise.resolve([] as string[]),
  ]);
  const active = new Set<string>([...scorers, ...paid, ...present]);
  for (const c of challenges) {
    for (const [userId, live] of Object.entries(c.live ?? {})) if (playedRecently(live?.at, now)) active.add(userId);
    for (const [userId, score] of Object.entries(c.scores ?? {})) {
      if (playedRecently(score?.finishedAt, now)) active.add(userId);
    }
  }
  active.delete(viewer.userId);
  const colleagues = roster.filter((person) => active.has(person.userId));
  return {
    count: colleagues.length,
    people: colleagues.slice(0, PLAYING_FACES).map((person) => ({ name: person.name, initials: initialsOf(person.name) })),
  };
}

/**
 * Everything the Games home draws, in one round trip: the viewer's points and
 * rank, a colleague's new best over theirs, what is live, challenges waiting
 * on them, the games they have played, the catalog, and who is playing now.
 */
export async function gamesHomeFor(viewerUserId: string, now = new Date()) {
  const viewer = await requireViewer(viewerUserId);
  // Every section starts as soon as what it needs is in, rather than in
  // rounds: the home is one request, and its slowest chain is what it costs.
  const rosterP = rosterFor(viewer);
  const gamesP = catalogFor(viewer);
  const blockedP = blockedUserIdsFor(viewer.userId);
  const mineP = myScoresFor(viewer);
  const relayP = liveRelayFor(viewer, now).catch(() => null);
  const [roster, games, banner, liveContests, liveRelay, challenges, yourGames, playingNow] = await Promise.all([
    rosterP,
    gamesP,
    Promise.all([gamesP, mineP, blockedP]).then(([games, mine, blocked]) =>
      scoreBannerFor(viewer, games, mine, blocked, now),
    ),
    liveContestsFor(viewer, blockedP, now),
    relayP,
    challengesFor(viewer, gamesP, now),
    Promise.all([gamesP, mineP]).then(([games, mine]) => playedGamesFor(viewer, games, mine)),
    Promise.all([rosterP, relayP]).then(([roster, relay]) => playingNowFor(viewer, roster, relay, now)),
  ]);
  const ranked = rankByPoints(roster);
  const own = ranked.find((entry) => entry.userId === viewer.userId);
  return {
    points: own?.points ?? 0,
    // Nobody is ranked for zero points: they would all share the last place.
    rank: own && own.points > 0 ? own.rank : null,
    total: ranked.length,
    banner,
    liveContests,
    liveRelay,
    challenges,
    yourGames,
    games,
    playingNow,
  };
}

// ---------------------------------------------------------------- leaderboard

export type LeaderboardPeriod = 'week' | 'all';

export function parsePeriod(value: unknown): LeaderboardPeriod {
  if (value === undefined || value === '' || value === 'all') return 'all';
  if (value === 'week') return 'week';
  throw new GameCatalogError(400, 'Period must be week or all');
}

export interface PointsLeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  photoUrl: string | null;
  points: number;
  department: string;
  /** Places climbed this week (all-time board only); negative is down. */
  moved?: number;
}

/**
 * The company's individuals ranked by engagement points: all time is
 * `User.points`; this week is what the points ledger recorded since Monday
 * 00:00 India time. Everyone still at the company is on it, top first, with
 * where the viewer stands and who they would pass next.
 */
export async function pointsLeaderboardFor(viewerUserId: string, period: LeaderboardPeriod, now = new Date()) {
  const viewer = await requireViewer(viewerUserId);
  const since = istWeekStart(now);
  const [roster, weekly] = await Promise.all([
    // Not `profilePhotoUrl`: on older accounts it is a whole image inline, and
    // the board only uses links (`linkPhotosOf`).
    rosterFor(viewer, { department: 1, profilePhotoKey: 1 }),
    viewer.org
      ? pointEvents()
          .aggregate<{ _id: string; delta: number }>([
            { $match: { org: viewer.org, createdAt: { $gte: since } } },
            { $group: { _id: '$userId', delta: { $sum: '$delta' } } },
          ])
          .toArray()
      : Promise.resolve([]),
  ]);
  const earned = new Map(weekly.map((row) => [row._id, row.delta]));
  const allTime = rankByPoints(roster);
  const thisWeek = rankByPoints(roster.map((person) => ({ ...person, points: earned.get(person.userId) ?? 0 })));
  const ranked: RankedEntry[] = period === 'week' ? thisWeek : allTime;
  const moved =
    period === 'all'
      ? movementSince(
          allTime,
          rankByPoints(roster.map((person) => ({ ...person, points: pointsBefore(person.points, earned.get(person.userId)) }))),
          roster.length,
        )
      : null;

  const byId = new Map(roster.map((person) => [person.userId, person]));
  const links = await linkPhotosOf(roster.map((person) => person.userId));
  const photos = new Map(
    await Promise.all(
      roster.map(async (person) => [person.userId, await photoOf({ ...person, profilePhotoUrl: links.get(person.userId) })] as const),
    ),
  );
  const entries: PointsLeaderboardEntry[] = ranked.map((entry) => ({
    rank: entry.rank,
    userId: entry.userId,
    name: entry.name,
    photoUrl: photos.get(entry.userId) ?? null,
    points: entry.points,
    department: byId.get(entry.userId)?.department ?? '',
    ...(moved ? { moved: moved.get(entry.userId) ?? 0 } : {}),
  }));

  const mine = ranked.find((entry) => entry.userId === viewer.userId);
  const next = nextUpFor(ranked, viewer.userId);
  const weekPoints = thisWeek.find((entry) => entry.userId === viewer.userId)?.points ?? 0;
  return {
    period,
    since: period === 'week' ? since : null,
    entries,
    me: mine
      ? {
          rank: mine.rank,
          points: mine.points,
          weekPoints,
          allTimePoints: allTime.find((entry) => entry.userId === viewer.userId)?.points ?? 0,
          nextUp: next ? { userId: next.userId, name: next.name, firstName: firstNameOf(next.name), rank: next.rank, gap: next.gap } : null,
        }
      : null,
  };
}
