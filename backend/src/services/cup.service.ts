/**
 * The Diwali Cup: the event, who is in it, and what each person's page
 * shows. The rules themselves are in `cup-rules.ts`.
 *
 * Nobody signs up: everyone active at the company is in, bar the people the
 * event leaves out (`excludeUserIds`, the Support account). Until the draw the
 * list is read live, so someone who joins the company that morning is in it.
 *
 * The page reaches this API with a signed ticket (`X-Cup-Ticket`), never the
 * session: from the Games tab after its one reload to `/play/diwali-cup?ticket=`
 * (as Scribble does), and from the feed post through a link of its own per
 * viewer (`/cup/<event>?ticket=`). Either way the ticket names one person at
 * one company, and the event must be that company's.
 *
 * Nothing here happens while an event's switch (`active`) is off: the page
 * says the Cup is not on, and the runner leaves it alone.
 */
import type { Collection } from 'mongodb';
import { gameScores, getDb, users } from '../config/db';
import type { CupBet, CupEvent, CupMatch } from '../models/cup.model';
import { catalogScoreId } from '../models/game-catalog.model';
import type { User } from '../models/user.model';
import { hasAllDashboardTabs } from '../middleware/admin.middleware';
import { mintTicket, verifyTicket } from './scribble-ticket.service';

export class CupError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'CupError';
  }
}

export function cupEvents(): Collection<CupEvent> {
  return getDb().collection<CupEvent>('cup_events');
}
export function cupMatches(): Collection<CupMatch> {
  return getDb().collection<CupMatch>('cup_matches');
}
export function cupBets(): Collection<CupBet> {
  return getDb().collection<CupBet>('cup_bets');
}

/**
 * The indexes the Cup's queries would like. NOT called: the cluster is shared
 * with production, so indexes go in by hand once approved. Each collection
 * stays small (one event, a few hundred matches, a few thousand bets), so the
 * Cup works without them.
 */
export async function proposedCupIndexes(): Promise<void> {
  await cupEvents().createIndex({ id: 1 }, { unique: true });
  await cupEvents().createIndex({ org: 1, active: 1, lobbyAt: -1 });
  await cupMatches().createIndex({ id: 1 }, { unique: true });
  await cupMatches().createIndex({ eventId: 1, round: 1, slot: 1 });
  await cupBets().createIndex({ matchId: 1 });
  await cupBets().createIndex({ eventId: 1, userId: 1 });
}

// ---------------------------------------------------------------- who is asking

const INACTIVE = ['offboarded', 'terminated'] as User['lifecycleStatus'][];

export interface CupViewer {
  userId: string;
  name: string;
  org: string;
  /** May void a result: HR with the whole dashboard. */
  hr: boolean;
}

type ViewerRow = Pick<User, 'userId' | 'name' | 'org' | 'lifecycleStatus' | 'dashboardAccess' | 'dashboardAdmin' | 'dashboardTabs'>;
const viewerCache = new Map<string, { row: ViewerRow | null; at: number }>();

async function viewerRow(userId: string): Promise<ViewerRow | null> {
  const kept = viewerCache.get(userId);
  if (kept && Date.now() - kept.at < 60_000) return kept.row;
  const row = await users().findOne(
    { userId },
    { projection: { _id: 0, userId: 1, name: 1, org: 1, lifecycleStatus: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1 } },
  );
  viewerCache.set(userId, { row, at: Date.now() });
  if (viewerCache.size > 5000) viewerCache.clear();
  return row;
}

/**
 * The person a page's ticket names, provided they are still at the company
 * it was signed for. A ticket from another company, or someone who has left,
 * is refused.
 */
export async function viewerFromTicket(raw: unknown): Promise<CupViewer> {
  const verdict = verifyTicket(raw, 'ticket');
  if (!verdict.ok) throw new CupError(401, verdict.error === 'ticket_expired' ? 'Close and reopen the Cup.' : 'Close and reopen the Cup.');
  const row = await viewerRow(verdict.ticket.userId);
  if (!row || INACTIVE.includes(row.lifecycleStatus) || row.org !== verdict.ticket.org) {
    throw new CupError(401, 'Close and reopen the Cup.');
  }
  return {
    userId: row.userId,
    name: row.name,
    org: row.org,
    hr: row.dashboardAccess === true && hasAllDashboardTabs(row),
  };
}

// ---------------------------------------------------------------- the event

const eventCache = new Map<string, { event: CupEvent | null; at: number }>();
const EVENT_TTL_MS = 1000;

export async function loadEvent(id: string, fresh = false): Promise<CupEvent | null> {
  const kept = eventCache.get(id);
  if (!fresh && kept && Date.now() - kept.at < EVENT_TTL_MS) return kept.event;
  const event = await cupEvents().findOne({ id }, { projection: { _id: 0 } });
  eventCache.set(id, { event, at: Date.now() });
  return event;
}

/** Forgets what is kept of an event, after a write to it. */
export function forgetEvent(id: string): void {
  eventCache.delete(id);
}

const orgEventCache = new Map<string, { id: string | null; at: number }>();

/**
 * The event a page is about: the one asked for, when it is the viewer's
 * company's and switched on; else the company's switched-on event, the
 * latest first. Null when there is none: the Cup is not on.
 */
export async function eventFor(viewer: CupViewer, askedId?: unknown): Promise<CupEvent | null> {
  if (typeof askedId === 'string' && askedId) {
    const event = await loadEvent(askedId);
    return event && event.org === viewer.org && event.active ? event : null;
  }
  const kept = orgEventCache.get(viewer.org);
  let id = kept && Date.now() - kept.at < 5000 ? kept.id : undefined;
  if (id === undefined) {
    const row = await cupEvents()
      .find({ org: viewer.org, active: true }, { projection: { _id: 0, id: 1 } })
      .sort({ lobbyAt: -1 })
      .limit(1)
      .next();
    id = row?.id ?? null;
    orgEventCache.set(viewer.org, { id, at: Date.now() });
  }
  if (!id) return null;
  const event = await loadEvent(id);
  return event && event.active ? event : null;
}

// ---------------------------------------------------------------- who is in

export interface RosterRow {
  userId: string;
  name: string;
  best: number | null;
}

/**
 * Everyone the event would enter now: active at the company, not a
 * counsellor, not left out; with only `includeUserIds` when a test names
 * them. With each one's best score on the game's leaderboard.
 */
export async function rosterOf(event: Pick<CupEvent, 'org' | 'gameKey' | 'excludeUserIds' | 'includeUserIds'>): Promise<RosterRow[]> {
  const people = await users()
    .find(
      {
        org: event.org,
        lifecycleStatus: { $nin: INACTIVE },
        isCounsellor: { $ne: true },
        ...(event.includeUserIds.length ? { userId: { $in: event.includeUserIds, $nin: event.excludeUserIds } } : { userId: { $nin: event.excludeUserIds } }),
      },
      { projection: { _id: 0, userId: 1, name: 1 } },
    )
    .toArray();
  const scores = await gameScores()
    .find(
      { gameId: catalogScoreId(event.gameKey), org: event.org, userId: { $in: people.map((p) => p.userId) } },
      { projection: { _id: 0, userId: 1, score: 1 } },
    )
    .toArray();
  const best = new Map(scores.map((row) => [row.userId, row.score]));
  return people.map((p) => ({ userId: p.userId, name: p.name || 'Colleague', best: best.get(p.userId) ?? null }));
}

const rosterCache = new Map<string, { rows: RosterRow[]; at: number }>();

/** The roster before the draw, kept half a minute: every page asks for it. */
async function rosterPreview(event: CupEvent): Promise<RosterRow[]> {
  const kept = rosterCache.get(event.id);
  if (kept && Date.now() - kept.at < 30_000) return kept.rows;
  const rows = await rosterOf(event);
  rows.sort((a, b) => a.name.localeCompare(b.name));
  rosterCache.set(event.id, { rows, at: Date.now() });
  return rows;
}

// ---------------------------------------------------------------- what a page shows

/** The event as every page sees it. */
function eventView(event: CupEvent) {
  return {
    id: event.id,
    name: event.name,
    phase: event.phase,
    lobbyAt: event.lobbyAt,
    startAt: event.startAt,
    round: event.round,
    topN: event.topN,
    seeding: event.seeding,
    startWindowSec: event.startWindowSec,
    bettingSec: event.bettingSec,
    roundSec: event.roundSec,
    countdownSec: event.countdownSec,
    version: event.version,
  };
}

/**
 * Everything one person's page draws, in one round trip: the event, whether
 * they are in it, and how many are. Later phases add their match, the live
 * games and their bets.
 */
export async function stateFor(viewer: CupViewer, askedId?: unknown) {
  const now = new Date();
  const event = await eventFor(viewer, askedId);
  if (!event) return { serverNow: now, event: null, me: { userId: viewer.userId, name: viewer.name, hr: viewer.hr } };
  const roster = await rosterPreview(event);
  const mine = roster.find((row) => row.userId === viewer.userId) ?? null;
  return {
    serverNow: now,
    event: eventView(event),
    me: { userId: viewer.userId, name: viewer.name, hr: viewer.hr, entered: !!mine, best: mine?.best ?? null },
    entrants: roster.length,
  };
}

/** Who is in, by name, for the list on the page. */
export async function entrantsFor(viewer: CupViewer, askedId?: unknown) {
  const event = await eventFor(viewer, askedId);
  if (!event) throw new CupError(404, 'The Cup is not on');
  const roster = await rosterPreview(event);
  return { entrants: roster.map((row) => ({ userId: row.userId, name: row.name, best: row.best })) };
}

// ---------------------------------------------------------------- links

/** An https address, or a local one for a test on this machine. */
const LINK_BASE = /^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

/** The address the app opens for a Cup feed post, signed for this viewer. Null when the post has no event. */
export function cupLinkFor(
  body: Record<string, unknown>,
  viewer: { userId: string; org: string },
  now = Date.now(),
): string | null {
  const eventId = typeof body.cupEventId === 'string' ? body.cupEventId : '';
  const base = typeof body.cupLinkBase === 'string' ? body.cupLinkBase.replace(/\/+$/, '') : '';
  const until = body.cupLinkUntil ? new Date(body.cupLinkUntil as string).getTime() : Number.NaN;
  if (!eventId || !LINK_BASE.test(base) || !Number.isFinite(until) || until <= now || !viewer.org) return null;
  const ticket = mintTicket({ userId: viewer.userId, org: viewer.org, name: '' }, { kind: 'cup-link', ttlMs: until - now, now });
  return `${base}/cup/${encodeURIComponent(eventId)}?ticket=${encodeURIComponent(ticket)}`;
}
