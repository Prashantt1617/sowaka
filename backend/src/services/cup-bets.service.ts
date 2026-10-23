/**
 * The Diwali Cup's bets: placing them, holding the stake, settling them when
 * a top-8 match is decided, refunding them when HR voids one, and the top
 * tipsters. The rules themselves are in `cup-bets-rules.ts`.
 *
 * The money is engagement points: `User.points`, with a row in the points
 * ledger (`point_events`, source `cup_bet`) for every move, so a bet shows
 * in the person's points history like a game or a challenge does:
 *   - placed:  − stake  ("Diwali Cup bet")
 *   - won:     + 2 × stake  ("Diwali Cup win")
 *   - lost:    nothing more (the stake is already gone)
 *   - voided:  the stake back, less anything a win had paid  ("Diwali Cup refund")
 *
 * Every move is one MongoDB transaction over the bet, the balance and the
 * ledger row, and every bet's change is conditional on the status it was
 * read with. So a bet is paid once: a retry, the engine calling twice, or two
 * servers settling the same match at once move nothing more. A bet that
 * cannot be paid for (the balance moved since it was read) is never written.
 *
 * The engine (`cup.service.ts`) calls `onCupMatchDecided`, `onCupMatchVoided`
 * and `onCupMatchReplayed` when a match changes, and `betsStateFor` for each
 * page's state. Each hook only reconciles the match's bets with the match as
 * it now stands, so the order they arrive in, or a lost call, does not
 * matter: `reconcileCupBets` (run by the runner now and then) catches up.
 */
import type { NextFunction, Request, Response } from 'express';
import type { ClientSession, Collection, Db } from 'mongodb';
import { getDb, users } from '../config/db';
import type { CupEvent, CupMatch } from '../models/cup.model';
import type { PointEvent } from '../models/points.model';
import type { User } from '../models/user.model';
import { hasAllDashboardTabs } from '../middleware/admin.middleware';
import { logger } from '../utils/logger';
import * as engine from './cup.service';
import { CupError, cupEvents, cupMatches, eventFor, forgetEvent, loadEvent, viewerFromTicket, type CupViewer } from './cup.service';
import {
  betIdOf,
  betVerdict,
  bookOf,
  deltasByUser,
  ledgerRowFor,
  mineOf,
  movesFor,
  splitOf,
  tipstersOf,
  type BetContext,
  type BetMove,
  type CupBetRow,
} from './cup-bets-rules';
import { pointEvents } from './points-ledger.service';

// ---------------------------------------------------------------- where it is kept

/** The collections a bet touches. The check script points these at scratch collections. */
export interface BetStores {
  db: Db;
  bets: Collection<CupBetRow>;
  users: Collection<User>;
  ledger: Collection<PointEvent>;
}

export const liveBetStores = (): BetStores => ({
  db: getDb(),
  bets: getDb().collection<CupBetRow>('cup_bets'),
  users: users(),
  ledger: pointEvents(),
});

/** Runs `work` as one transaction (retried by the driver on a transient error or a write conflict). */
async function inTransaction<T>(db: Db, work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = db.client.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => {
      out = await work(session);
    });
    return out;
  } finally {
    await session.endSession();
  }
}

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

// ---------------------------------------------------------------- kept in memory

/** Every bet of an event, read at most once a second however many pages poll. */
const eventBetsCache = new Map<string, { rows: CupBetRow[]; at: number } | { pending: Promise<CupBetRow[]> }>();
const BETS_TTL_MS = 1000;

async function eventBets(eventId: string, stores: BetStores = liveBetStores()): Promise<CupBetRow[]> {
  const kept = eventBetsCache.get(eventId);
  if (kept && 'pending' in kept) return kept.pending;
  if (kept && Date.now() - kept.at < BETS_TTL_MS) return kept.rows;
  const pending = stores.bets
    .find({ eventId })
    .toArray()
    .then(
      (rows) => {
        eventBetsCache.set(eventId, { rows, at: Date.now() });
        return rows;
      },
      (error) => {
        eventBetsCache.delete(eventId);
        throw error;
      },
    );
  eventBetsCache.set(eventId, { pending });
  return pending;
}

/** A balance, kept a few seconds; this server's own moves update it at once. */
const balanceCache = new Map<string, { points: number; at: number }>();
const BALANCE_TTL_MS = 5000;

async function balanceOf(userId: string, stores: BetStores = liveBetStores(), fresh = false): Promise<number> {
  const kept = balanceCache.get(userId);
  if (!fresh && kept && Date.now() - kept.at < BALANCE_TTL_MS) return kept.points;
  const row = await stores.users.findOne({ userId }, { projection: { _id: 0, points: 1 } });
  const points = Math.max(0, Math.floor(Number(row?.points) || 0));
  balanceCache.set(userId, { points, at: Date.now() });
  if (balanceCache.size > 5000) balanceCache.clear();
  return points;
}

/** The top-8 match on stage (its lobby or its game), else the last one decided. Kept a second. */
const stageCache = new Map<string, { match: CupMatch | null; at: number }>();

async function stageMatch(eventId: string): Promise<CupMatch | null> {
  const kept = stageCache.get(eventId);
  if (kept && Date.now() - kept.at < 1000) return kept.match;
  const on = await cupMatches()
    .find({ eventId, kind: 'sequential', status: { $in: ['betting', 'open', 'live', 'solo'] } }, { projection: { _id: 0 } })
    .sort({ round: 1, slot: 1 })
    .limit(1)
    .next();
  const match =
    on ??
    (await cupMatches()
      .find({ eventId, kind: 'sequential', status: 'done' }, { projection: { _id: 0 } })
      .sort({ decidedAt: -1 })
      .limit(1)
      .next());
  stageCache.set(eventId, { match, at: Date.now() });
  return match;
}

/** After a write here: what this server keeps of it is read again. */
function forgetBets(eventId: string, userIds: Iterable<string>): void {
  eventBetsCache.delete(eventId);
  stageCache.delete(eventId);
  for (const userId of userIds) balanceCache.delete(userId);
}

/**
 * The bet split on stage and the tipsters change what every page draws, so
 * the event's version moves on (a page asking `since` the old one gets the
 * new state).
 */
async function bumpVersion(eventId: string): Promise<void> {
  try {
    await cupEvents().updateOne({ id: eventId }, { $inc: { version: 1 }, $set: { updatedAt: new Date() } });
    forgetEvent(eventId);
  } catch (error) {
    logger.warn('Cup: version bump after a bet failed', { eventId }, error);
  }
}

// ---------------------------------------------------------------- names for the history

/** Who a user is, by the event's draw. */
function namesOf(event: Pick<CupEvent, 'entrants'> | null): (userId: string) => string {
  const names = new Map((event?.entrants ?? []).map((entrant) => [entrant.userId, entrant.name]));
  return (userId) => names.get(userId) ?? 'a player';
}

const contextFor = (match: Pick<CupMatch, 'label'>, nameOf: (userId: string) => string, pick: string): BetContext => ({
  label: match.label || 'Diwali Cup',
  pickName: nameOf(pick),
});

// ---------------------------------------------------------------- placing a bet

export interface PlaceBetInput {
  matchId?: unknown;
  pick?: unknown;
  stake?: unknown;
}

/**
 * Backs `pick` with `stake` points in a top-8 match's betting lobby. The bet,
 * the stake leaving the balance and its ledger row are written together or
 * not at all; a second bet on the same match is refused by the bet's id.
 */
export async function placeBet(viewer: CupViewer, input: PlaceBetInput, now = new Date()) {
  const matchId = typeof input.matchId === 'string' ? input.matchId : '';
  if (!matchId) throw new CupError(400, 'Which match?');
  const match = await cupMatches().findOne({ id: matchId }, { projection: { _id: 0 } });
  if (!match || match.org !== viewer.org) throw new CupError(404, 'There is no such match');
  const event = await loadEvent(match.eventId);
  if (!event || !event.active || event.org !== viewer.org) throw new CupError(404, 'The Cup is not on');
  return placeBetOn(viewer, event, match, input.pick, input.stake, liveBetStores(), now);
}

/** The write itself, given the match as read. Exported for the check script. */
export async function placeBetOn(
  viewer: Pick<CupViewer, 'userId' | 'name' | 'org'>,
  event: Pick<CupEvent, 'id' | 'maxStake' | 'entrants'>,
  match: CupMatch,
  pick: unknown,
  stake: unknown,
  stores: BetStores,
  now = new Date(),
) {
  const balance = await balanceOf(viewer.userId, stores, true);
  const verdict = betVerdict(match, viewer.userId, pick, stake, balance, event.maxStake, now);
  if (!verdict.ok) throw new CupError(verdict.status, verdict.message);
  const amount = stake as number;
  const book = bookOf(match);
  const bet: CupBetRow = {
    _id: betIdOf(match.id, book, viewer.userId),
    book,
    eventId: event.id,
    org: viewer.org,
    matchId: match.id,
    userId: viewer.userId,
    name: viewer.name || 'Colleague',
    pick: pick as string,
    stake: amount,
    status: 'held',
    payout: 0,
    placedAt: now,
  };
  const row = ledgerRowFor(bet, 'placed', -amount, contextFor(match, namesOf(event), bet.pick), now);
  try {
    await inTransaction(stores.db, async (session) => {
      await stores.bets.insertOne(bet, { session });
      const debit = await stores.users.updateOne(
        { userId: viewer.userId, org: viewer.org, points: { $gte: amount } },
        { $inc: { points: -amount } },
        { session },
      );
      if (debit.modifiedCount !== 1) throw new CupError(400, "You don't have that many points to bet");
      await stores.ledger.insertOne(row, { session });
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw new CupError(409, 'You have already bet on this match');
    throw error;
  }
  forgetBets(event.id, [viewer.userId]);
  return { bet, balance: await balanceOf(viewer.userId, stores, true) };
}

/**
 * After a bet is in: if the match moved on while it was being placed (decided,
 * or voided into a new book), the bet is settled or refunded straight away
 * rather than left held.
 */
async function afterPlaced(bet: Pick<CupBetRow, 'matchId' | 'eventId' | 'book'>): Promise<void> {
  const fresh = await cupMatches().findOne({ id: bet.matchId }, { projection: { _id: 0 } });
  if (fresh && (fresh.status === 'done' || bookOf(fresh) !== bet.book)) await reconcileMatch(fresh);
  await bumpVersion(bet.eventId);
}

// ---------------------------------------------------------------- settling

class BetsMoved extends Error {}

/**
 * Brings a match's bets in line with the match: settles the current book's
 * held bets once it is decided, and refunds every bet of an earlier book. One
 * transaction; each bet's update is conditional on the status it was read
 * with, so whatever was already done is not done again. Returns the moves
 * made (none when there was nothing to do).
 */
export async function settleMatchBets(
  match: CupMatch,
  stores: BetStores,
  nameOf: (userId: string) => string,
  now = new Date(),
): Promise<BetMove[]> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await inTransaction(stores.db, async (session) => {
        const bets = await stores.bets.find({ matchId: match.id, status: { $ne: 'refunded' } }, { session }).toArray();
        const moves = movesFor(bets, match);
        if (moves.length === 0) return [];
        const claimed = await stores.bets.bulkWrite(
          moves.map((move) => ({
            updateOne: {
              filter: { _id: move.bet._id, status: move.from },
              update: { $set: { status: move.to, payout: move.payout, settledAt: now } },
            },
          })),
          { session, ordered: true },
        );
        if (claimed.modifiedCount !== moves.length) throw new BetsMoved();
        const deltas = deltasByUser(moves);
        if (deltas.size) {
          await stores.users.bulkWrite(
            [...deltas].map(([userId, { org, delta }]) => ({
              updateOne: { filter: { userId, org }, update: { $inc: { points: delta } } },
            })),
            { session, ordered: true },
          );
        }
        const rows = moves
          .filter((move) => move.kind !== 'lost')
          .map((move) => ledgerRowFor(move.bet, move.kind === 'won' ? 'won' : 'refund', move.delta, contextFor(match, nameOf, move.bet.pick), now));
        if (rows.length) await stores.ledger.insertMany(rows, { session, ordered: true });
        return moves;
      });
    } catch (error) {
      // Another server got to some of these bets between our read and our
      // write: read again (what it did is not redone).
      if (error instanceof BetsMoved && attempt < 3) continue;
      throw error;
    }
  }
}

/** Reconciles one match's bets against the match as stored now. */
async function reconcileMatch(given: CupMatch): Promise<BetMove[]> {
  if (given.kind !== 'sequential' && bookOf(given) === 0) return [];
  const match = (await cupMatches().findOne({ id: given.id }, { projection: { _id: 0 } })) ?? given;
  const event = await loadEvent(match.eventId);
  const moves = await settleMatchBets(match, liveBetStores(), namesOf(event));
  if (moves.length) {
    forgetBets(match.eventId, moves.map((move) => move.bet.userId));
    await bumpVersion(match.eventId);
    logger.info('Cup bets settled', {
      matchId: match.id,
      won: moves.filter((m) => m.kind === 'won').length,
      lost: moves.filter((m) => m.kind === 'lost').length,
      refunded: moves.filter((m) => m.kind === 'refund').length,
    });
  }
  return moves;
}

async function reconcileQuietly(match: CupMatch, why: string): Promise<void> {
  try {
    await reconcileMatch(match);
  } catch (error) {
    // Left held; `reconcileCupBets` on the runner's next pass settles it.
    logger.error('Cup bets: settling failed', { matchId: match.id, why }, error);
  }
}

/** The engine: a match has been decided (status 'done', `winnerId` set). Pays the winners. */
export const onCupMatchDecided = (match: CupMatch) => reconcileQuietly(match, 'decided');

/** The engine: a match has been voided (`voids` grew). Refunds every bet placed before. */
export const onCupMatchVoided = (match: CupMatch) => reconcileQuietly(match, 'voided');

/** The engine: a tied match is being replayed. The bets ride: nothing moves (a no-op, kept for symmetry). */
export const onCupMatchReplayed = (match: CupMatch) => reconcileQuietly(match, 'replayed');

/**
 * For the runner, every so often (say each 15 s while the top 8 are on):
 * settles anything a lost hook call left behind. Reads the event's bets from
 * what is kept (at most once a second) and only opens a transaction for a
 * match that has something to move.
 */
export async function reconcileCupBets(eventId: string): Promise<number> {
  const bets = await eventBets(eventId);
  const open = [...new Set(bets.filter((bet) => bet.status !== 'refunded').map((bet) => bet.matchId))];
  if (open.length === 0) return 0;
  const matches = await cupMatches().find({ id: { $in: open } }, { projection: { _id: 0 } }).toArray();
  let moved = 0;
  for (const match of matches) {
    if (movesFor(bets, match).length === 0) continue;
    moved += (await reconcileMatch(match)).length;
  }
  return moved;
}

// ---------------------------------------------------------------- voiding (HR)

/**
 * What the engine must export for a void: record it on the match (push
 * `{ by, at }` onto `voids`), undo the result and set the match up to be
 * played again (a top-8 match through a fresh betting lobby), and return the
 * match as it now is. Refusing (a CupError) when it cannot be voided.
 */
type VoidCupMatch = (matchId: string, by: { userId: string; name: string }) => Promise<CupMatch>;

/** HR voids a match's result: the engine replays it, and every bet on it is refunded. */
export async function voidMatch(viewer: CupViewer, matchId: unknown) {
  if (!viewer.hr) throw new CupError(403, 'Only HR can void a result');
  if (typeof matchId !== 'string' || !matchId) throw new CupError(400, 'Which match?');
  const match = await cupMatches().findOne({ id: matchId }, { projection: { _id: 0 } });
  if (!match || match.org !== viewer.org) throw new CupError(404, 'There is no such match');
  const voidCupMatch = (engine as unknown as { voidCupMatch?: VoidCupMatch }).voidCupMatch;
  if (typeof voidCupMatch !== 'function') throw new CupError(501, 'Voiding a result is not ready yet');
  const replayed = await voidCupMatch(match.id, { userId: viewer.userId, name: viewer.name });
  await reconcileMatch(replayed);
  return { match: replayed };
}

// ---------------------------------------------------------------- what pages show

/**
 * The bet parts of one person's state: their balance (for `me.balance`),
 * their bets, the split on the match on stage, and the top tipsters. Pass the
 * match on stage when the caller has it (else it is looked up).
 */
export async function betsStateFor(viewer: Pick<CupViewer, 'userId'>, event: Pick<CupEvent, 'id'>, onStage?: CupMatch | null) {
  const [bets, balance, stage] = await Promise.all([
    eventBets(event.id),
    balanceOf(viewer.userId),
    onStage === undefined ? stageMatch(event.id) : Promise.resolve(onStage),
  ]);
  return {
    balance,
    bets: {
      mine: mineOf(bets, viewer.userId),
      ...(stage && stage.kind === 'sequential'
        ? { onStage: { matchId: stage.id, ...splitOf(bets, stage), closesAt: stage.bettingEndsAt ?? null } }
        : {}),
    },
    tipsters: tipstersOf(bets),
  };
}

/** `GET /cup/api/bets/mine`. */
export async function myBets(viewer: CupViewer, askedId?: unknown) {
  const event = await eventFor(viewer, askedId);
  if (!event) throw new CupError(404, 'The Cup is not on');
  const [bets, balance] = await Promise.all([eventBets(event.id), balanceOf(viewer.userId)]);
  return { bets: mineOf(bets, viewer.userId), balance };
}

// ---------------------------------------------------------------- handlers

const eventOf = (req: Request) => (typeof req.query.event === 'string' ? req.query.event : req.get('x-cup-event')) || undefined;

function answer(res: Response, next: NextFunction, work: Promise<unknown>) {
  work.then(
    (body) => res.set('Cache-Control', 'private, no-store').json({ success: true, ...(body as object) }),
    (error) => {
      if (error instanceof CupError) {
        res.status(error.statusCode).set('Cache-Control', 'private, no-store').json({ success: false, message: error.message });
        return;
      }
      next(error);
    },
  );
}

/** For the page's API (signed in by `X-Cup-Ticket`). */
const ticketed =
  (work: (viewer: CupViewer, req: Request) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    answer(res, next, viewerFromTicket(req.get('x-cup-ticket')).then((viewer) => work(viewer, req)));

/** `POST /cup/api/bets` `{ matchId, pick, stake }` → `{ bet, balance }`. */
export const placeBetHandler = ticketed(async (viewer, req) => {
  const placed = await placeBet(viewer, (req.body ?? {}) as PlaceBetInput);
  void afterPlaced(placed.bet).catch((error) =>
    logger.warn('Cup: after placing a bet', { matchId: placed.bet.matchId }, error),
  );
  return { bet: mineOf([placed.bet], viewer.userId)[0], balance: placed.balance };
});

/** `GET /cup/api/bets/mine` → `{ bets, balance }`. */
export const myBetsHandler = ticketed((viewer, req) => myBets(viewer, eventOf(req)));

/** `POST /cup/api/matches/:id/void` (HR only) → `{ match }`. */
export const voidMatchHandler = ticketed((viewer, req) => voidMatch(viewer, req.params.id));

// ---------------------------------------------------------------- the office TV (dashboard)

/** The dashboard user as a Cup viewer. The TV and its void are HR's: dashboard access with every tab. */
function dashboardViewer(req: Request): CupViewer {
  const user = req.auth?.user;
  if (!user?.org) throw new CupError(401, 'Sign in again');
  const hr = user.dashboardAccess === true && hasAllDashboardTabs(user);
  if (!hr) throw new CupError(403, 'The Cup TV is for HR with the whole dashboard');
  return { userId: user.userId, name: user.name || 'HR', org: user.org, hr };
}

/** The state a page gets (the engine's), with the bet parts filled in if the engine has not yet. */
export async function tvStateFor(viewer: CupViewer, eventId?: string) {
  const state = (await engine.stateFor(viewer, eventId)) as Record<string, unknown> & { event: { id: string } | null };
  if (!state.event) return state;
  const current = state.current as { matchId?: string } | undefined;
  const onStage = current?.matchId ? await cupMatches().findOne({ id: current.matchId }, { projection: { _id: 0 } }) : undefined;
  const bets = await betsStateFor(viewer, state.event, onStage ?? undefined);
  return {
    ...state,
    bets: (state.bets as object | undefined) ?? bets.bets,
    tipsters: (state.tipsters as unknown[] | undefined) ?? bets.tipsters,
  };
}

const dashboard =
  (work: (viewer: CupViewer, req: Request) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    answer(
      res,
      next,
      Promise.resolve().then(() => work(dashboardViewer(req), req)),
    );

/** `GET /admin/cup/state` (the company's current event) and `GET /admin/cup/:eventId/state`. */
export const cupTvStateHandler = dashboard((viewer, req) => tvStateFor(viewer, typeof req.params.eventId === 'string' && req.params.eventId ? req.params.eventId : undefined));

/** `POST /admin/cup/matches/:id/void`. */
export const cupTvVoidHandler = dashboard((viewer, req) => voidMatch(viewer, req.params.id));
