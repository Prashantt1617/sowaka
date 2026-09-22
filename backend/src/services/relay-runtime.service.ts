import { randomUUID } from 'node:crypto';
import {
  relayEvents,
  relayItems,
  relayProgress,
  relayTeams,
  users,
} from '../config/db';
import {
  RelayAnswerRecord,
  RelayConfig,
  RelayEvent,
  RelayItem,
  RelayTeam,
  RelayTeamProgress,
} from '../models/relay.model';
import {
  answerAccepted,
  assignments,
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
import { presignConnectMedia } from './s3-connect-media.service';
import { RelayError } from './relay-import.service';
import {
  answeringTeams,
  cacheProgress,
  markAnswering,
  forgetProgress,
  markPresent,
  persistPresence,
  presenceFor,
  readProgress,
} from './relay-store';

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
  // A miss is never remembered: a brief moment with no event found would
  // otherwise tell everyone "no game" for the whole of the cache window.
  if (value !== null && value !== undefined) {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
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
  /** What a correct answer pays, so the screen never states a different number. */
  pointsPerCorrect: number;
  /** A round's full length, for the rules screen's timer. */
  roundSeconds: number;
  /** What kind of puzzle each round is, in order — from the imported sheet. */
  roundKinds: string[];
  /**
   * The clock the player watches: the whole round, four questions' worth.
   *
   * The 30-second cap still governs each question underneath — it closes them
   * and it is what a skip hands forward — but nobody is shown a timer that
   * resets four times a round. During the break this counts down to the next
   * round instead.
   */
  roundSecondsLeft: number;
  /** The per-question cap, still enforced even though it is not the display. */
  questionSecondsLeft: number;
  /** Only ever this player's share of the puzzle. */
  pieces: { label: string; text: string }[];
  /** `hasClue` drives the tick beside each face: who is holding a piece now. */
  teammates: {
    name: string;
    present: boolean;
    isLeader: boolean;
    hasClue: boolean;
    /** Marks the viewer's own row, which the roster labels "(You)". */
    isYou: boolean;
  }[];
  /** Named on every player's screen, because they are who to shout the clue at. */
  leadName: string;
  /** Drives "Your team lead is answering" — true while they are typing. */
  leadIsAnswering: boolean;
  standings: { rank: number; name: string; points: number }[];
  /** Counts the lobby down to kick-off; zero once play has begun. */
  secondsUntilStart: number;
  /** Shown before the lobby, so nobody arrives without knowing the rules. */
  instructionsVideoUrl: string;
  /** The prize headline HR set when publishing, in rupees. */
  rewardAmount: number;
  /** Where this team sits, so the screen does not have to find itself in the list. */
  yourRank: number;
  /** What this round earned, shown as "+100 points this round". */
  pointsThisRound: number;
  /** How each closed question this round went, by position — the pips' colours. */
  roundOutcomes: RelayAnswerRecord['outcome'][];
  /** Set for a few seconds after a correct answer, for the banner. */
  lastOutcome?: { outcome: 'correct'; answer: string; points: number };
}

/**
 * A playable address for the instructions video.
 *
 * The event stores a storage key, which a phone cannot play. Signed addresses
 * expire, so this is cached well inside that window rather than signed on
 * every tick for every player.
 */
async function videoUrlFor(event: RelayEvent): Promise<string> {
  const key = event.instructionsVideoUrl ?? '';
  if (!key) return '';
  return memo(`video:${event.id}:${key}`, 20 * 60_000, () =>
    presignConnectMedia(key).catch(() => ''),
  );
}

/**
 * Each round's kind of puzzle, in playing order, as the sheet defined them.
 * Fixed once imported, so it is read once and held.
 */
async function roundKindsFor(event: RelayEvent): Promise<string[]> {
  return memo(`kinds:${event.id}`, 5 * 60_000, async () => {
    const rows = await relayItems()
      .aggregate<{ _id: number; kind: string }>([
        { $match: { eventId: event.id } },
        { $group: { _id: '$round', kind: { $first: '$kind' } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    return rows.map((row) => row.kind);
  });
}

/** Whole seconds until a moment, never negative. */
function secondsUntil(at: Date | undefined, now: number): number {
  if (!at) return 0;
  return Math.max(0, Math.ceil((new Date(at).getTime() - now) / 1000));
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
  // Written where presence is read from, not only to the durable mirror —
  // otherwise a heartbeat lands somewhere nothing consults.
  await markPresent(event.id, [userId]);
  void persistPresence(event.id, [userId], new Map([[userId, team.id]]));
}

async function presentPlayers(event: RelayEvent, team: RelayTeam): Promise<PresentPlayer[]> {
  const seen = await presenceFor(
    event.id,
    team.members.map((member) => member.userId),
  );
  return team.members.map((member) => ({
    ...member,
    lastSeenAt: new Date(seen.get(member.userId) ?? 0),
  }));
}

async function poolFor(event: RelayEvent, round: number): Promise<RelayItem[]> {
  // Items are fixed once imported; re-reading them per action was pure cost.
  return memo(`pool:${event.id}:${round}`, 60_000, () =>
    relayItems().find({ eventId: event.id, round }).sort({ id: 1 }).toArray(),
  );
}

async function progressFor(event: RelayEvent, team: RelayTeam): Promise<RelayTeamProgress> {
  const existing = await readProgress(event.id, team.id);
  if (existing) return existing;
  const fresh: RelayTeamProgress = {
    eventId: event.id,
    org: event.org,
    teamId: team.id,
    round: event.currentRound,
    questionIndex: 0,
    questionStartedAt: event.roundStartedAt ?? new Date(),
    carriedSeconds: 0,
    answers: [],
    totalPoints: 0,
    bonusRounds: [],
    totalSecondsUsed: 0,
    updatedAt: new Date(),
  };
  await relayProgress().insertOne(fresh);
  await cacheProgress(fresh);
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
  /** Seconds a skip hands to the next question. Zero for anything else. */
  carryForward = 0,
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
      $set: {
        questionIndex: progress.questionIndex + 1,
        questionStartedAt: new Date(),
        carriedSeconds: Math.max(0, Math.round(carryForward)),
        updatedAt: new Date(),
      },
    },
  );
  if (result.modifiedCount !== 1) return false;
  if (progress.questionIndex + 1 >= event.config.questionsPerRound) {
    await payRoundBonus(event, progress.teamId, progress.round);
  } else {
    await refreshCachedProgress(event.id, progress.teamId);
  }
  return true;
}

/**
 * Pays the leftover seconds for a clean sweep, once.
 *
 * Guarded on the round not already being in `bonusRounds`, so whichever call
 * closes the last question pays it and a concurrent one cannot pay it again.
 */
async function refreshCachedProgress(eventId: string, teamId: string) {
  const stored = await relayProgress().findOne({ eventId, teamId });
  if (stored) await cacheProgress(stored);
}

async function payRoundBonus(event: RelayEvent, teamId: string, round: number) {
  const progress = await relayProgress().findOne({ eventId: event.id, teamId });
  if (!progress) return;
  const thisRound = progress.answers.filter((answer) => answer.round === round);
  const { bonusPoints } = scoreRound(thisRound, event.config);
  if (bonusPoints <= 0) {
    await refreshCachedProgress(event.id, teamId);
    return;
  }
  await relayProgress().updateOne(
    { eventId: event.id, teamId, bonusRounds: { $ne: round } },
    { $inc: { totalPoints: bonusPoints }, $addToSet: { bonusRounds: round }, $set: { updatedAt: new Date() } },
  );
  await refreshCachedProgress(event.id, teamId);
}

/**
 * Brings a team up to the present.
 *
 * A question no longer closes on its own: it stays open until the lead
 * answers it or moves on, and only the round's clock can end it. When the
 * round runs out, whatever is left counts as missed — so a team nobody is
 * playing still finishes the round in step with everyone else.
 */
async function settle(event: RelayEvent, team: RelayTeam): Promise<RelayTeamProgress> {
  let progress = await progressFor(event, team);
  const now = Date.now();
  const { config } = event;

  for (let guard = 0; guard < config.questionsPerRound + 1; guard += 1) {
    if (progress.round !== event.currentRound) break;
    if (progress.questionIndex >= config.questionsPerRound) break;
    const round = roundPhase(config, event.roundStartedAt ?? new Date(), now);
    if (round.phase === 'playing') break;
    const elapsed = (now - progress.questionStartedAt.getTime()) / 1000;
    await closeQuestion(event, progress, 'timeout', elapsed);
    progress = (await relayProgress().findOne({ eventId: event.id, teamId: team.id })) ?? progress;
  }
  return progress;
}

/**
 * The answer a team just got right, for a few seconds after it lands.
 *
 * Shown to the whole team, not only the lead who typed it: a member whose clue
 * suddenly changes should see why.
 */
function justAnswered(
  progress: RelayTeamProgress | undefined,
  plan: RelayItem[],
  round: number,
  now: number,
): PlayerSnapshot['lastOutcome'] {
  if (!progress) return undefined;
  const last = progress.answers.filter((answer) => answer.round === round).at(-1);
  if (!last || last.outcome !== 'correct') return undefined;
  // The next question opened when this one closed, so its start is the moment.
  if (now - progress.questionStartedAt.getTime() > CORRECT_BANNER_MS) return undefined;
  return {
    outcome: 'correct',
    answer: plan[last.position - 1]?.acceptedAnswers[0] ?? last.submitted ?? '',
    points: last.points,
  };
}

const CORRECT_BANNER_MS = 3500;

/** Outcomes of this round's closed questions, in the order they were played. */
function outcomesOf(progress: RelayTeamProgress | undefined, round: number) {
  return (progress?.answers ?? [])
    .filter((answer) => answer.round === round)
    .sort((a, b) => a.position - b.position)
    .map((answer) => answer.outcome);
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
    pointsPerCorrect: config.pointsPerCorrect,
    roundSeconds: roundSeconds(config),
    roundKinds: await roundKindsFor(event),
    teammates: [] as PlayerSnapshot['teammates'],
    standings: [] as PlayerSnapshot['standings'],
  };

  if (!team) {
    throw new RelayError(403, 'You are not on a team for this event');
  }
  const players = await presentPlayers(event, team);
  const leader = currentLeader(players, config, now);
  const teammatesOf = (holders: Set<string>) =>
    players.map((player) => ({
      name: player.name,
      isLeader: player.userId === leader?.userId,
      present: now - player.lastSeenAt.getTime() < config.presenceWindowSeconds * 1000,
      hasClue: holders.has(player.userId),
      isYou: player.userId === userId,
    }));
  const teammates = teammatesOf(new Set());

  if (event.status !== 'live' || !event.roundStartedAt) {
    return {
      ...base,
      team: { id: team.id, name: team.name, points: 0 },
      phase: 'lobby',
      isLeader: leader?.userId === userId,
      prompt: '',
      questionNumber: 0,
      roundSecondsLeft: 0,
      questionSecondsLeft: 0,
      pieces: [],
      teammates,
      leadName: leader?.name ?? '',
      leadIsAnswering: false,
      standings: [],
      secondsUntilStart: secondsUntil(event.startsAt, now),
      roundOutcomes: [],
      instructionsVideoUrl: await videoUrlFor(event),
      rewardAmount: event.rewardAmount ?? 0,
      yourRank: 0,
      pointsThisRound: 0,
    };
  }

  const progress = await settle(event, team);
  const table = await leaderboard(event.id);
  const round = roundPhase(config, event.roundStartedAt, now);
  const pool = await poolFor(event, event.currentRound);
  const plan = itemsForTeam(pool, team.index, config.questionsPerRound);
  const item = plan[progress.questionIndex];
  const question = questionPhase(config, progress.questionStartedAt, now, progress.carriedSeconds);
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
    roundSecondsLeft: round.secondsLeft,
    questionSecondsLeft: phase === 'playing' ? question.secondsLeft : 0,
    pieces:
      phase === 'playing' && item
        ? piecesForPlayer(item, players, config, question.elapsedSec, now, userId)
        : [],
    teammates: teammatesOf(
      phase === 'playing' ? holdersOf(item, players, config, question.elapsedSec, now) : new Set(),
    ),
    leadName: leader?.name ?? '',
    leadIsAnswering: (await answeringTeams(event.id, [team.id])).has(team.id),
    standings: table,
    secondsUntilStart: 0,
    instructionsVideoUrl: await videoUrlFor(event),
    rewardAmount: event.rewardAmount ?? 0,
    yourRank: table.find((row) => row.name === team.name)?.rank ?? 0,
    pointsThisRound: roundPoints(progress, event.currentRound),
    lastOutcome: justAnswered(progress, plan, event.currentRound, now),
    roundOutcomes: outcomesOf(progress, event.currentRound),
  };
}

const config = (event: RelayEvent) => event.config;

/**
 * Who currently holds a piece, for the ticks beside each face.
 *
 * Derived from the same assignment the pieces themselves come from, so the
 * tick can never disagree with what is on somebody's screen.
 */
function holdersOf(
  item: RelayItem | undefined,
  players: PresentPlayer[],
  config: RelayConfig,
  elapsedSec: number,
  now: number,
): Set<string> {
  if (!item) return new Set();
  return new Set(assignments(item, players, config, elapsedSec, now).map((a) => a.userId));
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

/**
 * The lead is typing, so their team's screens can say so.
 *
 * Only the lead: nobody else has an answer box, and a mark from anyone else
 * would put a false "answering" on four other phones.
 */
export async function markLeadAnswering(userId: string) {
  const { event, team } = await requireLeader(userId).catch(() => ({ event: null, team: null }));
  if (!event || !team) return;
  await markAnswering(event.id, team.id);
}

/**
 * Refuses an answer or a skip aimed at a question that has already closed.
 *
 * A double tap sends two; the first closes the question, and without this the
 * second would land on the next one and skip it unseen. Phones say which
 * question they meant (1-based); an older client that doesn't is taken at its
 * word.
 */
function requireStillOpen(progress: RelayTeamProgress, question?: number) {
  if (question !== undefined && question !== progress.questionIndex + 1) {
    throw new RelayError(409, 'That question has already moved on');
  }
}

export async function submitAnswer(userId: string, given: string, question?: number) {
  const { event, team } = await requireLeader(userId);
  const progress = await settle(event, team);
  if (progress.questionIndex >= event.config.questionsPerRound) {
    throw new RelayError(409, 'This round is over');
  }
  requireStillOpen(progress, question);
  const item = await currentItemFor(event, team, progress);
  if (!item) throw new RelayError(409, 'No question is open');

  const correct = answerAccepted(given, item, event.config);
  if (!correct) return { correct: false };

  const secondsTaken = (Date.now() - progress.questionStartedAt.getTime()) / 1000;
  await closeQuestion(event, progress, 'correct', secondsTaken, given, userId);
  return { correct: true, answer: item.acceptedAnswers[0] };
}

export async function skipQuestion(userId: string, question?: number) {
  const { event, team } = await requireLeader(userId);
  const progress = await settle(event, team);
  if (progress.questionIndex >= event.config.questionsPerRound) {
    throw new RelayError(409, 'This round is over');
  }
  requireStillOpen(progress, question);
  const item = await currentItemFor(event, team, progress);
  const now = Date.now();
  const { allowance } = questionPhase(config(event), progress.questionStartedAt, now, progress.carriedSeconds);
  const secondsTaken = (now - progress.questionStartedAt.getTime()) / 1000;
  // The point of skipping: whatever was left goes to the next question.
  const carried = Math.max(0, allowance - secondsTaken);
  await closeQuestion(event, progress, 'skipped', secondsTaken, undefined, undefined, carried);
  return { answer: item?.acceptedAnswers[0] ?? '', carriedSeconds: Math.round(carried) };
}

/** What a team banked this round: answers plus the round's own bonus. */
function roundPoints(progress: RelayTeamProgress, round: number): number {
  const answers = progress.answers.filter((answer) => answer.round === round);
  const base = answers.reduce((total, answer) => total + answer.points, 0);
  const bonus = progress.bonusRounds.includes(round)
    ? progress.totalPoints - progress.answers.reduce((t, a) => t + a.points, 0)
    : 0;
  return base + Math.max(0, bonus);
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
/**
 * Starts a scheduled event once its moment arrives.
 *
 * Guarded on the event still being scheduled, so whichever server gets there
 * first starts it and the others do nothing.
 */
export async function startDueEvents(): Promise<string[]> {
  const due = await relayEvents()
    .find({ status: 'scheduled', startsAt: { $lte: new Date() }, startClaim: { $exists: false } })
    .toArray();
  const started: string[] = [];
  for (const event of due) {
    // Claimed with a marker rather than by changing the status. Flipping it
    // away from "scheduled" for the instant of starting told anyone acting in
    // that instant that no game existed.
    const claim = randomUUID();
    const claimed = await relayEvents().updateOne(
      { id: event.id, status: 'scheduled', startClaim: { $exists: false } },
      { $set: { startClaim: claim } },
    );
    if (claimed.modifiedCount !== 1) continue;
    try {
      await startEvent(event.id);
      started.push(event.id);
    } finally {
      await relayEvents().updateOne({ id: event.id, startClaim: claim }, { $unset: { startClaim: '' } });
    }
  }
  return started;
}

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
  await forgetProgress(eventId);

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
            carriedSeconds: 0,
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
  const sizes = await Promise.all(
    Array.from({ length: event.config.rounds }, (_, i) =>
      relayItems().countDocuments({ eventId, round: i + 1 }),
    ),
  );
  sizes.forEach((size, i) => {
    if (size < event.config.questionsPerRound) {
      throw new RelayError(400, `Round ${i + 1} has too few items to play`);
    }
  });

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
  await forgetProgress(eventId);
  await relayProgress().deleteMany({ eventId });
  await relayProgress().insertMany(
    teams.map((team) => ({
      eventId,
      org: event.org,
      teamId: team.id,
      round: 1,
      questionIndex: 0,
      questionStartedAt: startedAt,
      carriedSeconds: 0,
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

  const [teams, pool] = await Promise.all([
    memo(`teams:${eventId}`, 30_000, () => relayTeams().find({ eventId }).toArray()),
    event.status === 'live' ? poolFor(event, event.currentRound) : Promise.resolve([]),
  ]);
  const everyone = teams.flatMap((team) => team.members.map((member) => member.userId));
  const seen = await presenceFor(eventId, everyone);
  const lastSeen = new Map([...seen].map(([userId, at]) => [userId, new Date(at)]));

  // Settling can write, so it happens once per team here rather than per player.
  // Teams settle side by side: each is independent, and one after another
  // meant a tick's length grew with every team — seconds, against a remote
  // database, with forty-odd of them.
  const progressByTeam = new Map<string, RelayTeamProgress>();
  const settled = await Promise.all(
    teams.map(async (team) => {
      if (event.status === 'live') return [team.id, await settle(event, team)] as const;
      if (event.status === 'finished') {
        // Read, not settled: nothing moves once the game is over, but the final
        // table needs the scores — without them every team showed zero.
        return [team.id, await readProgress(event.id, team.id)] as const;
      }
      return [team.id, null] as const;
    }),
  );
  for (const [teamId, progress] of settled) {
    if (progress) progressByTeam.set(teamId, progress);
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
  const videoUrl = await videoUrlFor(event);
  const kinds = await roundKindsFor(event);
  const answering = await answeringTeams(
    eventId,
    teams.map((team) => team.id),
  );

  for (const team of teams) {
    const players: PresentPlayer[] = team.members.map((member) => ({
      ...member,
      lastSeenAt: lastSeen.get(member.userId) ?? new Date(0),
    }));
    const leader = currentLeader(players, config, now);
    const progress = progressByTeam.get(team.id);
    const plan = itemsForTeam(pool, team.index, config.questionsPerRound);
    const item = progress ? plan[progress.questionIndex] : undefined;
    const question = progress
      ? questionPhase(config, progress.questionStartedAt, now, progress.carriedSeconds)
      : { phase: 'running' as const, elapsedSec: 0, secondsLeft: 0 };
    const finishedRound = (progress?.questionIndex ?? 0) >= config.questionsPerRound;
    const holders =
      progress && item ? holdersOf(item, players, config, question.elapsedSec, now) : new Set<string>();
    const roster = players.map((player) => ({
      userId: player.userId,
      name: player.name,
      isLeader: player.userId === leader?.userId,
      present: now - player.lastSeenAt.getTime() < config.presenceWindowSeconds * 1000,
      hasClue: holders.has(player.userId),
    }));
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
        pointsPerCorrect: config.pointsPerCorrect,
        roundSeconds: roundSeconds(config),
        roundKinds: kinds,
        roundSecondsLeft: round.secondsLeft,
        questionSecondsLeft: phase === 'playing' ? question.secondsLeft : 0,
        pieces:
          phase === 'playing' && item
            ? piecesForPlayer(item, players, config, question.elapsedSec, now, member.userId)
            : [],
        teammates: roster.map(({ userId: id, ...rest }) => ({ ...rest, isYou: id === member.userId })),
        leadName: leader?.name ?? '',
        leadIsAnswering: answering.has(team.id),
        standings: table,
        secondsUntilStart: phase === 'lobby' ? secondsUntil(event.startsAt, now) : 0,
        instructionsVideoUrl: videoUrl,
        rewardAmount: event.rewardAmount ?? 0,
        yourRank: table.find((row) => row.name === team.name)?.rank ?? 0,
        pointsThisRound: progress ? roundPoints(progress, event.currentRound) : 0,
        lastOutcome: justAnswered(progress, plan, event.currentRound, now),
        roundOutcomes: outcomesOf(progress, event.currentRound),
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
  await markPresent(eventId, [...teamOf.keys()]);
  // Mirrored into Mongo behind the response, so nothing on the game's path
  // waits for it.
  void persistPresence(eventId, [...teamOf.keys()], teamOf);
}

/** Live events in an org, for the socket layer to tick. */
export async function liveEventIds(): Promise<string[]> {
  // Scheduled events too: the lobby is a real screen with a countdown and a
  // roster filling up, and leaving them out meant it never received a thing.
  const events = await relayEvents()
    .find({ status: { $in: ['scheduled', 'live'] } })
    .project({ id: 1 })
    .toArray();
  return events.map((event) => String(event.id));
}

/**
 * What the Connect post shows this particular viewer.
 *
 * The post is the same for everyone; their team is not. So the card asks for
 * this separately rather than the feed baking one person's team into a post
 * the whole company reads.
 */
export async function playerCard(userId: string) {
  const { event, team } = await membership(userId);
  return {
    event: {
      id: event.id,
      title: event.name,
      status: event.status,
      startsAt: event.startsAt?.toISOString() ?? null,
      rewardAmount: event.rewardAmount ?? 0,
      pointsPerCorrect: event.config.pointsPerCorrect,
      rounds: event.config.rounds,
      instructionsVideoUrl: await videoUrlFor(event),
    },
    team: team
      ? {
          name: team.name,
          members: team.members.map((member) => ({
            name: member.name,
            isLeader: member.isLeader,
            isYou: member.userId === userId,
          })),
        }
      : null,
  };
}
