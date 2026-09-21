import {
  relayEvents,
  relayItems,
  relayPresence,
  relayProgress,
  relayTeams,
  users,
} from '../config/db';
import {
  RelayAnswerRecord,
  RelayEvent,
  RelayItem,
  RelayTeam,
  RelayTeamProgress,
} from '../models/relay.model';
import {
  answerAccepted,
  currentLeader,
  piecesForPlayer,
  PresentPlayer,
  questionPhase,
  roundPhase,
  roundSeconds,
  scoreRound,
  standings,
} from './relay-engine';
import { itemsForTeam } from './relay-pool';
import { RelayError } from './relay-import.service';

/**
 * Small in-process cache for the parts of an event that do not change while a
 * round runs.
 *
 * Measured against the hosted cluster, an answer took over two seconds to come
 * back because every action re-read the user, the event, the team and the round's
 * items in sequence. None of that changes mid-round, so it is held briefly here
 * and the action path stops paying for it.
 */
const cache = new Map<string, { value: unknown; expiresAt: number }>();

async function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** Called wherever the shape of an event changes under the cache. */
export function forgetRelayCache(eventId?: string) {
  if (!eventId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(eventId)) cache.delete(key);
  }
}

/**
 * The live game: persistence around the pure engine.
 *
 * Every read recomputes what is true from the clock and, where the clock says
 * a question or round has moved on, records that move. Advancing is guarded on
 * the position being advanced from, so two players polling at the same instant
 * cannot bank the same timeout twice.
 */

export interface PlayerSnapshot {
  event: { id: string; name: string; status: RelayEvent['status']; round: number; rounds: number };
  team: { id: string; name: string; points: number } | null;
  phase: 'lobby' | 'playing' | 'break' | 'finished';
  /** The leader's screen carries this; nobody else's does. */
  isLeader: boolean;
  prompt: string;
  questionNumber: number;
  questionsPerRound: number;
  secondsLeft: number;
  /** Only ever this player's share of the puzzle. */
  pieces: { label: string; text: string }[];
  teammates: { name: string; present: boolean; isLeader: boolean }[];
  standings: { rank: number; name: string; points: number }[];
  lastOutcome?: { outcome: string; answer: string };
}

async function membership(userId: string) {
  const user = await memo(`user:${userId}`, 30_000, () => users().findOne({ userId }));
  if (!user) throw new RelayError(404, 'User not found');
  const org = user.org ?? user.email.split('@').at(1) ?? 'default';
  // Short-lived: a round change has to reach players quickly.
  const event = await memo(`openEvent:${org}`, 1_000, () =>
    relayEvents().findOne({ org, status: { $in: ['scheduled', 'live'] } }, { sort: { updatedAt: -1 } }),
  );
  if (!event) throw new RelayError(404, 'No relay event is open');
  const team = await memo(`team:${event.id}:${userId}`, 30_000, () =>
    relayTeams().findOne({ eventId: event.id, 'members.userId': userId }),
  );
  return { user, org, event, team };
}

export async function heartbeat(userId: string) {
  const { event, team } = await membership(userId);
  if (!team) return;
  await relayPresence().updateOne(
    { eventId: event.id, userId },
    { $set: { eventId: event.id, teamId: team.id, userId, lastSeenAt: new Date() } },
    { upsert: true },
  );
}

async function presentPlayers(event: RelayEvent, team: RelayTeam): Promise<PresentPlayer[]> {
  const seen = await relayPresence().find({ eventId: event.id, teamId: team.id }).toArray();
  const lastSeen = new Map(seen.map((row) => [row.userId, row.lastSeenAt]));
  return team.members.map((member) => ({
    ...member,
    lastSeenAt: lastSeen.get(member.userId) ?? new Date(0),
  }));
}

async function poolFor(event: RelayEvent, round: number): Promise<RelayItem[]> {
  // Items are fixed once imported; re-reading them per action was pure cost.
  return memo(`pool:${event.id}:${round}`, 60_000, () =>
    relayItems().find({ eventId: event.id, round }).sort({ id: 1 }).toArray(),
  );
}

async function progressFor(event: RelayEvent, team: RelayTeam): Promise<RelayTeamProgress> {
  const existing = await relayProgress().findOne({ eventId: event.id, teamId: team.id });
  if (existing) return existing;
  const fresh: RelayTeamProgress = {
    eventId: event.id,
    org: event.org,
    teamId: team.id,
    round: event.currentRound,
    questionIndex: 0,
    questionStartedAt: event.roundStartedAt ?? new Date(),
    answers: [],
    totalPoints: 0,
    bonusRounds: [],
    totalSecondsUsed: 0,
    updatedAt: new Date(),
  };
  await relayProgress().insertOne(fresh);
  return fresh;
}

/**
 * Closes the question a team is on and moves them to the next one.
 *
 * The filter pins the round and position being left, so whichever concurrent
 * caller gets there first wins and the rest are no-ops.
 */
async function closeQuestion(
  event: RelayEvent,
  progress: RelayTeamProgress,
  outcome: RelayAnswerRecord['outcome'],
  secondsTaken: number,
  submitted?: string,
  answeredBy?: string,
): Promise<boolean> {
  const record: RelayAnswerRecord = {
    round: progress.round,
    position: progress.questionIndex + 1,
    outcome,
    secondsTaken: Math.round(secondsTaken),
    points: outcome === 'correct' ? event.config.pointsPerCorrect : 0,
    submitted,
    answeredBy,
  };
  const result = await relayProgress().updateOne(
    {
      eventId: event.id,
      teamId: progress.teamId,
      round: progress.round,
      questionIndex: progress.questionIndex,
    },
    {
      $push: { answers: record },
      $inc: { totalPoints: record.points, totalSecondsUsed: record.secondsTaken },
      $set: { questionIndex: progress.questionIndex + 1, questionStartedAt: new Date(), updatedAt: new Date() },
    },
  );
  if (result.modifiedCount !== 1) return false;
  if (progress.questionIndex + 1 >= event.config.questionsPerRound) {
    await payRoundBonus(event, progress.teamId, progress.round);
  }
  return true;
}

/**
 * Pays the leftover seconds for a clean sweep, once.
 *
 * Guarded on the round not already being in `bonusRounds`, so whichever call
 * closes the last question pays it and a concurrent one cannot pay it again.
 */
async function payRoundBonus(event: RelayEvent, teamId: string, round: number) {
  const progress = await relayProgress().findOne({ eventId: event.id, teamId });
  if (!progress) return;
  const thisRound = progress.answers.filter((answer) => answer.round === round);
  const { bonusPoints } = scoreRound(thisRound, event.config);
  if (bonusPoints <= 0) return;
  await relayProgress().updateOne(
    { eventId: event.id, teamId, bonusRounds: { $ne: round } },
    { $inc: { totalPoints: bonusPoints }, $addToSet: { bonusRounds: round }, $set: { updatedAt: new Date() } },
  );
}

/**
 * Brings a team up to the present.
 *
 * A team nobody is playing still has its questions expire on the clock, so it
 * stays in step with everyone else and rejoins at whatever the room is on
 * rather than somewhere in the past.
 */
async function settle(event: RelayEvent, team: RelayTeam): Promise<RelayTeamProgress> {
  let progress = await progressFor(event, team);
  const now = Date.now();
  const { config } = event;

  for (let guard = 0; guard < config.questionsPerRound + 1; guard += 1) {
    if (progress.round !== event.currentRound) break;
    if (progress.questionIndex >= config.questionsPerRound) break;
    const round = roundPhase(config, event.roundStartedAt ?? new Date(), now);
    const question = questionPhase(config, progress.questionStartedAt, now);
    const outOfTime = question.phase === 'expired' || round.phase !== 'playing';
    if (!outOfTime) break;
    await closeQuestion(event, progress, 'timeout', Math.min(question.elapsedSec, config.questionSeconds));
    progress = (await relayProgress().findOne({ eventId: event.id, teamId: team.id })) ?? progress;
  }
  return progress;
}

export async function snapshot(userId: string): Promise<PlayerSnapshot> {
  const { event, team } = await membership(userId);
  await heartbeat(userId);
  const now = Date.now();
  const { config } = event;

  const base = {
    event: {
      id: event.id,
      name: event.name,
      status: event.status,
      round: event.currentRound,
      rounds: config.rounds,
    },
    questionsPerRound: config.questionsPerRound,
    teammates: [] as PlayerSnapshot['teammates'],
    standings: [] as PlayerSnapshot['standings'],
  };

  if (!team) {
    throw new RelayError(403, 'You are not on a team for this event');
  }
  const players = await presentPlayers(event, team);
  const leader = currentLeader(players, config, now);
  const teammates = players.map((player) => ({
    name: player.name,
    isLeader: player.userId === leader?.userId,
    present: now - player.lastSeenAt.getTime() < config.presenceWindowSeconds * 1000,
  }));

  if (event.status !== 'live' || !event.roundStartedAt) {
    return {
      ...base,
      team: { id: team.id, name: team.name, points: 0 },
      phase: 'lobby',
      isLeader: leader?.userId === userId,
      prompt: '',
      questionNumber: 0,
      secondsLeft: 0,
      pieces: [],
      teammates,
      standings: [],
    };
  }

  const progress = await settle(event, team);
  const round = roundPhase(config, event.roundStartedAt, now);
  const pool = await poolFor(event, event.currentRound);
  const plan = itemsForTeam(pool, team.index, config.questionsPerRound);
  const item = plan[progress.questionIndex];
  const question = questionPhase(config, progress.questionStartedAt, now);
  const finishedRound = progress.questionIndex >= config.questionsPerRound;
  const phase: PlayerSnapshot['phase'] =
    round.phase === 'break' || finishedRound ? 'break' : 'playing';

  return {
    ...base,
    team: { id: team.id, name: team.name, points: progress.totalPoints },
    phase,
    isLeader: leader?.userId === userId,
    prompt: phase === 'playing' && item ? item.prompt : '',
    questionNumber: Math.min(progress.questionIndex + 1, config.questionsPerRound),
    secondsLeft: phase === 'playing' ? question.secondsLeft : round.secondsLeft,
    pieces:
      phase === 'playing' && item
        ? piecesForPlayer(item, players, config, question.elapsedSec, now, userId)
        : [],
    teammates,
    standings: phase === 'break' ? await leaderboard(event.id) : [],
  };
}

async function currentItemFor(event: RelayEvent, team: RelayTeam, progress: RelayTeamProgress) {
  const pool = await poolFor(event, event.currentRound);
  return itemsForTeam(pool, team.index, event.config.questionsPerRound)[progress.questionIndex];
}

async function requireLeader(userId: string) {
  const { event, team } = await membership(userId);
  if (!team) throw new RelayError(403, 'You are not on a team for this event');
  if (event.status !== 'live') throw new RelayError(409, 'The game is not running');
  const players = await presentPlayers(event, team);
  const leader = currentLeader(players, event.config, Date.now());
  if (leader?.userId !== userId) throw new RelayError(403, 'Only the team leader can answer');
  return { event, team };
}

export async function submitAnswer(userId: string, given: string) {
  const { event, team } = await requireLeader(userId);
  const progress = await settle(event, team);
  if (progress.questionIndex >= event.config.questionsPerRound) {
    throw new RelayError(409, 'This round is over');
  }
  const item = await currentItemFor(event, team, progress);
  if (!item) throw new RelayError(409, 'No question is open');

  const correct = answerAccepted(given, item, event.config);
  if (!correct) return { correct: false };

  const secondsTaken = (Date.now() - progress.questionStartedAt.getTime()) / 1000;
  await closeQuestion(event, progress, 'correct', secondsTaken, given, userId);
  return { correct: true, answer: item.acceptedAnswers[0] };
}

export async function skipQuestion(userId: string) {
  const { event, team } = await requireLeader(userId);
  const progress = await settle(event, team);
  if (progress.questionIndex >= event.config.questionsPerRound) {
    throw new RelayError(409, 'This round is over');
  }
  const item = await currentItemFor(event, team, progress);
  const secondsTaken = (Date.now() - progress.questionStartedAt.getTime()) / 1000;
  await closeQuestion(event, progress, 'skipped', secondsTaken);
  return { answer: item?.acceptedAnswers[0] ?? '' };
}

export async function leaderboard(eventId: string) {
  const [teams, rows] = await Promise.all([
    relayTeams().find({ eventId }).toArray(),
    relayProgress().find({ eventId }).toArray(),
  ]);
  const byTeam = new Map(rows.map((row) => [row.teamId, row]));
  return standings(
    teams.map((team) => ({
      teamId: team.id,
      name: team.name,
      points: byTeam.get(team.id)?.totalPoints ?? 0,
      secondsUsed: byTeam.get(team.id)?.totalSecondsUsed ?? 0,
    })),
  ).map((row) => ({ rank: row.rank, name: row.name, points: row.points }));
}

/**
 * Moves the whole event on when the clock says so.
 *
 * One caller owns this — with more than one backend instance it needs a lock,
 * or two of them will advance 44 teams twice. Rounds start together for
 * everyone, which is the point of the shared break.
 */
export async function advanceEvent(eventId: string): Promise<'unchanged' | 'round' | 'finished'> {
  const event = await relayEvents().findOne({ id: eventId, status: 'live' });
  if (!event || !event.roundStartedAt) return 'unchanged';
  const { config } = event;
  const elapsed = (Date.now() - event.roundStartedAt.getTime()) / 1000;
  if (elapsed < roundSeconds(config) + config.breakSeconds) return 'unchanged';

  if (event.currentRound >= config.rounds) {
    await relayEvents().updateOne(
      { id: eventId, status: 'live' },
      { $set: { status: 'finished', finishedAt: new Date(), updatedAt: new Date() } },
    );
    forgetRelayCache(eventId);
    return 'finished';
  }

  const nextRound = event.currentRound + 1;
  const startedAt = new Date();
  // Guarded on the round being left, so a second caller cannot skip one.
  const moved = await relayEvents().updateOne(
    { id: eventId, status: 'live', currentRound: event.currentRound },
    { $set: { currentRound: nextRound, roundStartedAt: startedAt, updatedAt: startedAt } },
  );
  if (moved.modifiedCount !== 1) return 'unchanged';
  forgetRelayCache(eventId);

  const teams = await relayTeams().find({ eventId }).toArray();
  await Promise.all(
    teams.map((team) =>
      relayProgress().updateOne(
        { eventId, teamId: team.id },
        {
          $set: {
            round: nextRound,
            questionIndex: 0,
            questionStartedAt: startedAt,
            updatedAt: startedAt,
          },
        },
        { upsert: false },
      ),
    ),
  );
  return 'round';
}

export async function startEvent(eventId: string) {
  const event = await relayEvents().findOne({ id: eventId });
  if (!event) throw new RelayError(404, 'Relay event not found');
  if (event.status === 'live') throw new RelayError(409, 'The event is already running');
  const teams = await relayTeams().find({ eventId }).toArray();
  if (teams.length === 0) throw new RelayError(400, 'Import the roster before starting');
  for (let round = 1; round <= event.config.rounds; round += 1) {
    const size = await relayItems().countDocuments({ eventId, round });
    if (size < event.config.questionsPerRound) {
      throw new RelayError(400, `Round ${round} has too few items to play`);
    }
  }

  const startedAt = new Date();
  await relayEvents().updateOne(
    { id: eventId },
    {
      $set: {
        status: 'live',
        currentRound: 1,
        startedAt,
        roundStartedAt: startedAt,
        updatedAt: startedAt,
      },
    },
  );
  forgetRelayCache(eventId);
  await relayProgress().deleteMany({ eventId });
  await relayProgress().insertMany(
    teams.map((team) => ({
      eventId,
      org: event.org,
      teamId: team.id,
      round: 1,
      questionIndex: 0,
      questionStartedAt: startedAt,
      answers: [],
      totalPoints: 0,
      bonusRounds: [],
      totalSecondsUsed: 0,
      updatedAt: startedAt,
    })),
  );
  return { startedAt, teams: teams.length };
}

/**
 * Every player's view of a live event, built from one pass over the data.
 *
 * The socket layer pushes on a tick, and doing a per-player snapshot there
 * would mean 220 sets of database reads a second. This loads the event, its
 * teams, their progress, presence and the round's pool once, then derives each
 * player's view in memory — so the cost is flat no matter how many are playing,
 * and the hint path never touches the database.
 */
export async function eventTick(eventId: string): Promise<Map<string, PlayerSnapshot>> {
  const views = new Map<string, PlayerSnapshot>();
  const event = await relayEvents().findOne({ id: eventId });
  if (!event) return views;
  const { config } = event;
  const now = Date.now();

  const [teams, pool, presence] = await Promise.all([
    memo(`teams:${eventId}`, 30_000, () => relayTeams().find({ eventId }).toArray()),
    event.status === 'live' ? poolFor(event, event.currentRound) : Promise.resolve([]),
    relayPresence().find({ eventId }).toArray(),
  ]);
  const lastSeen = new Map(presence.map((row) => [row.userId, row.lastSeenAt]));

  // Settling can write, so it happens once per team here rather than per player.
  const progressByTeam = new Map<string, RelayTeamProgress>();
  for (const team of teams) {
    if (event.status !== 'live') continue;
    progressByTeam.set(team.id, await settle(event, team));
  }

  const table = standings(
    teams.map((team) => ({
      teamId: team.id,
      name: team.name,
      points: progressByTeam.get(team.id)?.totalPoints ?? 0,
      secondsUsed: progressByTeam.get(team.id)?.totalSecondsUsed ?? 0,
    })),
  ).map((row) => ({ rank: row.rank, name: row.name, points: row.points }));

  const round = event.roundStartedAt
    ? roundPhase(config, event.roundStartedAt, now)
    : { phase: 'playing' as const, secondsLeft: 0 };

  for (const team of teams) {
    const players: PresentPlayer[] = team.members.map((member) => ({
      ...member,
      lastSeenAt: lastSeen.get(member.userId) ?? new Date(0),
    }));
    const leader = currentLeader(players, config, now);
    const teammates = players.map((player) => ({
      name: player.name,
      isLeader: player.userId === leader?.userId,
      present: now - player.lastSeenAt.getTime() < config.presenceWindowSeconds * 1000,
    }));
    const progress = progressByTeam.get(team.id);
    const plan = itemsForTeam(pool, team.index, config.questionsPerRound);
    const item = progress ? plan[progress.questionIndex] : undefined;
    const question = progress
      ? questionPhase(config, progress.questionStartedAt, now)
      : { phase: 'running' as const, elapsedSec: 0, secondsLeft: 0 };
    const finishedRound = (progress?.questionIndex ?? 0) >= config.questionsPerRound;
    const phase: PlayerSnapshot['phase'] =
      event.status === 'finished'
        ? 'finished'
        : event.status !== 'live'
          ? 'lobby'
          : round.phase === 'break' || finishedRound
            ? 'break'
            : 'playing';

    for (const member of team.members) {
      views.set(member.userId, {
        event: {
          id: event.id,
          name: event.name,
          status: event.status,
          round: event.currentRound,
          rounds: config.rounds,
        },
        team: { id: team.id, name: team.name, points: progress?.totalPoints ?? 0 },
        phase,
        isLeader: leader?.userId === member.userId,
        prompt: phase === 'playing' && item ? item.prompt : '',
        questionNumber: Math.min((progress?.questionIndex ?? 0) + 1, config.questionsPerRound),
        questionsPerRound: config.questionsPerRound,
        secondsLeft: phase === 'playing' ? question.secondsLeft : round.secondsLeft,
        pieces:
          phase === 'playing' && item
            ? piecesForPlayer(item, players, config, question.elapsedSec, now, member.userId)
            : [],
        teammates,
        standings: phase === 'playing' ? [] : table,
      });
    }
  }
  return views;
}

/**
 * Marks everyone currently holding a socket as present.
 *
 * A live connection is better evidence that somebody is there than a message
 * they remembered to send: relying on client heartbeats alone meant a healthy
 * socket still aged out of presence, and the leader was refused their own
 * answer twenty seconds in.
 */
export async function touchPresence(eventId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const teams = await relayTeams()
    .find({ eventId, 'members.userId': { $in: userIds } })
    .toArray();
  const teamOf = new Map<string, string>();
  for (const team of teams) {
    for (const member of team.members) {
      if (userIds.includes(member.userId)) teamOf.set(member.userId, team.id);
    }
  }
  if (teamOf.size === 0) return;
  const lastSeenAt = new Date();
  await relayPresence().bulkWrite(
    [...teamOf].map(([userId, teamId]) => ({
      updateOne: {
        filter: { eventId, userId },
        update: { $set: { eventId, teamId, userId, lastSeenAt } },
        upsert: true,
      },
    })),
  );
}

/** Live events in an org, for the socket layer to tick. */
export async function liveEventIds(): Promise<string[]> {
  const events = await relayEvents().find({ status: 'live' }).project({ id: 1 }).toArray();
  return events.map((event) => String(event.id));
}
