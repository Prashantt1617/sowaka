/**
 * Dashboard › Engagement › Engagement plan: one list of dates for the company —
 * what has run (contests, polls, tournaments, Secret Squad, relays, timed game
 * rounds) with who took part and who came top, what is running, and what is
 * coming up (events already scheduled in their own collections, plus dates HR
 * has put in the plan).
 *
 * Everything is read from the collections the games and the feed already
 * write. The one thing this page writes is `engagementPlanItems`, HR's own
 * planned dates: the app never reads it.
 */
import { randomUUID } from 'node:crypto';
import type { Collection } from 'mongodb';
import { connectPosts, getDb, relayEvents, relayPresence, relayProgress, relayTeams, gameCatalog, users } from '../config/db';
import type { ConnectPost } from '../models/connect.model';
import { cupEvents } from './cup.service';
import { pokerEvents, pokerResults } from './poker-db';
import { squadPayouts, squadSchedules } from './secret-squad.service';
import { CONTEST_TYPES, contestName, contestSummary } from './engagement-contests.service';

export type PlanKind = 'contest' | 'poll' | 'tournament' | 'game';
export type PlanState = 'done' | 'running' | 'planned';

export interface PlanEntry {
  /** `<source>:<id>`, unique across the list. */
  key: string;
  kind: PlanKind;
  /** Where it came from, for the label: "Caption this", "Odd One Out cup", "Secret Squad"… */
  source: string;
  title: string;
  at: string;
  end: string | null;
  state: PlanState;
  /** Headline numbers, already worded: [value, label]. */
  stats: [string, string][];
  /** Who came top, best first. */
  top: { name: string; value: string }[];
  /** Where Open goes on the dashboard. */
  open: { view: 'contests'; id: string } | { view: 'games' } | null;
  /** Set on a date HR added to the plan: its row in engagementPlanItems. */
  planItemId?: string;
  note?: string;
}

/** A date HR put in the plan. Only the dashboard reads or writes these. */
export interface EngagementPlanItem {
  id: string;
  org: string;
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM, IST; empty for "some time that day". */
  time: string;
  kind: PlanKind;
  title: string;
  note: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// No createIndex: the cluster is shared with production, so indexes go in by
// hand once approved (as cup.service does). Reads are per org and small.
export const engagementPlanItems = (): Collection<EngagementPlanItem> =>
  getDb().collection<EngagementPlanItem>('engagementPlanItems');

const DAY = 86_400_000;
const iso = (d: Date | string | number | null | undefined): string | null => {
  if (d === null || d === undefined || d === '') return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
};
const stateOf = (at: string, end: string | null, now: number): PlanState => {
  const a = new Date(at).getTime();
  if (a > now) return 'planned';
  if (end && new Date(end).getTime() > now) return 'running';
  return 'done';
};
const n = (v: number) => String(v);
const plural = (v: number, one: string, many = `${one}s`) => `${v === 1 ? one : many}`;

const CONTEST_LABEL: Record<string, string> = {
  caption_challenge: 'Caption this',
  photo_story_challenge: 'Best photo',
  most_likely: 'Most likely',
};

async function contestEntries(org: string, since: Date, now: number): Promise<PlanEntry[]> {
  const posts = await connectPosts()
    .find(
      { org, type: { $in: [...CONTEST_TYPES] }, publishedAt: { $gte: since } },
      { projection: { _id: 0, comments: 0, likedBy: 0, wishesSeenAt: 0 } },
    )
    .toArray();
  return posts.map((post) => {
    const s = contestSummary(post);
    const at = iso(post.publishedAt) ?? new Date().toISOString();
    const ml = post.type === 'most_likely';
    const tagCount = new Map<string, { name: string; n: number }>();
    const votes = Object.values(post.captionVotes ?? {});
    const top = ml
      ? (() => {
          for (const e of post.captionEntries ?? []) {
            if (!e.taggedUserId) continue;
            const row = tagCount.get(e.taggedUserId) ?? { name: e.taggedName ?? 'Teammate', n: 0 };
            row.n += 1;
            tagCount.set(e.taggedUserId, row);
          }
          return [...tagCount.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((r) => ({ name: r.name, value: `${r.n} ${plural(r.n, 'tag')}` }));
        })()
      : (post.captionEntries ?? [])
          .map((e, i) => ({ e, i, v: votes.filter((id) => id === e.id).length }))
          .filter((x) => x.v > 0)
          .sort((a, b) => b.v - a.v || a.i - b.i)
          .slice(0, 3)
          .map((x) => ({ name: x.e.name, value: `${x.v} ${plural(x.v, 'vote')}` }));
    return {
      key: `contest:${post.id}`,
      kind: 'contest',
      source: CONTEST_LABEL[post.type] ?? 'Contest',
      title: contestName(post),
      at,
      end: s.closesAt,
      state: stateOf(at, s.closesAt, now),
      stats: [
        [n(s.participants), 'took part'],
        [n(s.entries), ml ? plural(s.entries, 'tag') : plural(s.entries, 'entry', 'entries')],
        ...(ml ? [] : ([[n(s.votes), plural(s.votes, 'vote')]] as [string, string][])),
        [n(s.pointsGiven), 'points given'],
      ],
      top,
      open: { view: 'contests', id: post.id },
    };
  });
}

async function pollEntries(org: string, since: Date, now: number): Promise<PlanEntry[]> {
  const posts = await connectPosts()
    .find({ org, type: 'survey', publishedAt: { $gte: since } }, { projection: { _id: 0, id: 1, body: 1, pollVotes: 1, publishedAt: 1, author: 1 } })
    .toArray();
  return posts.map((post: Pick<ConnectPost, 'id' | 'body' | 'pollVotes' | 'publishedAt' | 'author'>) => {
    const votes = Object.values(post.pollVotes ?? {});
    const options = Array.isArray(post.body.options) ? (post.body.options as { id: string; label: string }[]) : [];
    const counted = options
      .map((o) => ({ label: o.label, v: votes.filter((id) => id === o.id).length }))
      .sort((a, b) => b.v - a.v);
    const at = iso(post.publishedAt) ?? new Date().toISOString();
    const end = iso(String(post.body.closesAt ?? '')) ?? null;
    return {
      key: `poll:${post.id}`,
      kind: 'poll',
      source: post.author?.name ? `Poll by ${post.author.name}` : 'Poll',
      title: String(post.body.title || 'Poll'),
      at,
      end,
      state: stateOf(at, end, now),
      stats: [[n(votes.length), plural(votes.length, 'vote')]],
      // A poll's "top" is its leading answer, not a person.
      top: counted.filter((c) => c.v > 0).slice(0, 3).map((c) => ({ name: c.label, value: `${c.v} ${plural(c.v, 'vote')}` })),
      open: null,
    };
  });
}

async function catalogNames(): Promise<Map<string, string>> {
  const rows = await gameCatalog().find({}, { projection: { _id: 0, key: 1, name: 1 } }).toArray();
  return new Map(rows.map((r) => [r.key, r.name]));
}

async function cupEntries(org: string, since: Date, now: number, names: Map<string, string>): Promise<PlanEntry[]> {
  const events = await cupEvents()
    .find({ org, active: true, startAt: { $gte: since } }, { projection: { _id: 0, rounds: 0 } })
    .toArray();
  return events.map((ev) => {
    const at = iso(ev.lobbyAt ?? ev.startAt) ?? new Date().toISOString();
    const end = iso(ev.finishedAt) ?? (ev.phase === 'done' ? at : null);
    const champion = ev.championId ? ev.entrants.find((e) => e.userId === ev.championId)?.name : undefined;
    const state: PlanState = ev.phase === 'done' ? 'done' : ev.phase === 'scheduled' ? 'planned' : 'running';
    const players = ev.entrants.length || ev.lobbyJoined?.length || 0;
    return {
      key: `cup:${ev.id}`,
      kind: 'tournament',
      source: `${names.get(ev.gameKey) ?? 'Game'} tournament`,
      title: ev.name,
      at,
      end,
      state: state === 'planned' && new Date(at).getTime() <= now ? 'running' : state,
      stats: [[n(players), plural(players, 'player')]],
      top: champion ? [{ name: champion, value: 'Champion' }] : [],
      open: { view: 'games' },
    };
  });
}

async function pokerEntries(org: string, since: Date, now: number, names: Map<string, string>): Promise<PlanEntry[]> {
  // Drafts never ran and are not booked in, so they are left out.
  const events = await pokerEvents().find({ org, status: { $in: ['live', 'over'] } }, { projection: { _id: 0 } }).toArray();
  const out: PlanEntry[] = [];
  for (const ev of events) {
    const start = iso(ev.config.shootout?.lobbyFrom ?? ev.config.practice?.from ?? ev.config.game.openFrom);
    if (!start || new Date(start) < since) continue;
    const results = await pokerResults()
      .find({ org, eventId: ev.id, voided: { $ne: true } }, { projection: { _id: 0, userId: 1, name: 1, points: 1 } })
      .toArray();
    const people = new Map<string, { name: string; points: number }>();
    for (const r of results) {
      const row = people.get(r.userId) ?? { name: r.name, points: 0 };
      row.points += r.points || 0;
      people.set(r.userId, row);
    }
    const shootout = ev.shootout;
    const players = shootout?.joined.length ?? people.size;
    const top: { name: string; value: string }[] = [];
    if (shootout?.standings?.length) {
      // A shootout keeps everyone's final place, champion first.
      const nameOf = new Map(shootout.joined.map((j) => [j.userId, j.name]));
      shootout.standings.slice(0, 3).forEach((id, i) =>
        top.push({ name: nameOf.get(id) ?? 'Player', value: i === 0 ? 'Champion' : ['2nd', '3rd'][i - 1] + ' place' }),
      );
    } else {
      if (ev.champion) top.push({ name: ev.champion.name, value: 'Champion' });
      [...people.entries()]
        .filter(([id]) => id !== ev.champion?.userId)
        .sort((a, b) => b[1].points - a[1].points)
        .slice(0, 3 - top.length)
        .forEach(([, p]) => top.push({ name: p.name, value: `${p.points} pts` }));
    }
    const end = ev.status === 'over' ? iso(ev.updatedAt) : iso(ev.config.game.finalAt);
    out.push({
      key: `poker:${ev.id}`,
      kind: 'tournament',
      source: shootout || ev.config.shootout ? 'Poker shootout' : `${names.get(ev.catalogKey) ?? 'Poker'} tournament`,
      title: ev.name,
      at: start,
      end,
      state: ev.status === 'over' ? 'done' : stateOf(start, end, now),
      stats: [
        [n(players), plural(players, 'player')],
        [n(results.length), plural(results.length, 'table result')],
      ],
      top,
      open: { view: 'games' },
    });
  }
  return out;
}

async function squadEntries(org: string, since: Date, now: number): Promise<PlanEntry[]> {
  const sessions = await squadSchedules()
    .find({ org, status: { $ne: 'cancelled' }, startsAt: { $gte: since } }, { projection: { _id: 0 } })
    .toArray();
  if (!sessions.length) return [];
  const payouts = await squadPayouts().find({ org, sessionId: { $in: sessions.map((s) => s.id) } }).toArray();
  const ids = new Set<string>();
  for (const p of payouts) Object.keys(p.points ?? {}).forEach((id) => ids.add(id));
  const roster = ids.size
    ? new Map((await users().find({ org, userId: { $in: [...ids] } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray()).map((u) => [u.userId, u.name]))
    : new Map<string, string>();
  return sessions.map((s) => {
    const at = iso(s.startsAt) ?? new Date().toISOString();
    const length = s.lobbyMs + s.rounds.reduce((sum, r, i) => sum + r.huntMs + (i < s.rounds.length - 1 ? r.breakMs : 0), 0);
    const end = new Date(new Date(at).getTime() + length).toISOString();
    const points = new Map<string, number>();
    for (const p of payouts.filter((x) => x.sessionId === s.id)) {
      for (const [id, v] of Object.entries(p.points ?? {})) points.set(id, (points.get(id) ?? 0) + v);
    }
    const state = s.status === 'scheduled' && new Date(at).getTime() > now ? 'planned' : stateOf(at, end, now);
    return {
      key: `squad:${s.id}`,
      kind: 'game',
      source: 'Secret Squad',
      title: `Secret Squad · ${s.office}`,
      at,
      end,
      state,
      stats: [
        [n(points.size), plural(points.size, 'player')],
        [n(s.rounds.length), plural(s.rounds.length, 'round')],
      ],
      top: [...points.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, v]) => ({ name: roster.get(id) ?? 'Player', value: `${v} pts` })),
      open: { view: 'games' },
    };
  });
}

async function relayEntries(org: string, since: Date, now: number): Promise<PlanEntry[]> {
  const events = await relayEvents()
    .find({ org, status: { $in: ['scheduled', 'live', 'finished'] } }, { projection: { _id: 0 } })
    .toArray();
  const out: PlanEntry[] = [];
  for (const ev of events) {
    const at = iso(ev.startsAt ?? ev.startedAt ?? ev.lobbyOpensAt);
    if (!at || new Date(at) < since) continue;
    const [teams, progress, presentIds] = await Promise.all([
      relayTeams().find({ org, eventId: ev.id }, { projection: { _id: 0, id: 1, name: 1, members: 1 } }).toArray(),
      relayProgress().find({ org, eventId: ev.id }, { projection: { _id: 0, teamId: 1, totalPoints: 1, totalSecondsUsed: 1 } }).toArray(),
      relayPresence().distinct('userId', { eventId: ev.id }),
    ]);
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const members = teams.reduce((sum, t) => sum + t.members.length, 0);
    const end = iso(ev.finishedAt);
    out.push({
      key: `relay:${ev.id}`,
      kind: 'game',
      source: 'Relay',
      title: ev.name,
      at,
      end,
      state: ev.status === 'finished' ? 'done' : ev.status === 'live' ? 'running' : stateOf(at, end, now),
      stats: [
        [n(teams.length), plural(teams.length, 'team')],
        [n(members), plural(members, 'person', 'people') + ' on teams'],
        ...(presentIds.length ? ([[n(presentIds.length), 'joined in']] as [string, string][]) : []),
      ],
      top: progress
        .sort((a, b) => b.totalPoints - a.totalPoints || a.totalSecondsUsed - b.totalSecondsUsed)
        .slice(0, 3)
        .map((p) => ({ name: teamName.get(p.teamId) ?? 'Team', value: `${p.totalPoints} pts` })),
      open: { view: 'games' },
    });
  }
  return out;
}

/** Timed game rounds posted to the feed (a game launch with an end), not tied to a tournament. */
async function launchEntries(org: string, since: Date, now: number): Promise<PlanEntry[]> {
  const posts = await connectPosts()
    .find(
      { org, type: 'game_launch', publishedAt: { $gte: since }, 'body.endsAt': { $exists: true, $nin: ['', null] }, 'body.tournamentId': { $exists: false } },
      { projection: { _id: 0, id: 1, body: 1, publishedAt: 1 } },
    )
    .toArray();
  if (!posts.length) return [];
  const scores = getDb().collection<{ postId: string; userId: string; playerName: string; score: number }>('game_launch_scores');
  const out: PlanEntry[] = [];
  for (const post of posts) {
    const at = iso(String(post.body.startsAt || '')) ?? iso(post.publishedAt) ?? new Date().toISOString();
    const end = iso(String(post.body.endsAt));
    const rows = await scores.find({ postId: post.id }, { projection: { _id: 0, userId: 1, playerName: 1, score: 1 } }).toArray();
    // The standings the card keeps once it is over carry the right order (lower-wins games included).
    const kept = Array.isArray(post.body.results) ? (post.body.results as { name: string; points: number }[]) : null;
    const top = kept
      ? kept.slice(0, 3).map((r) => ({ name: r.name, value: `${r.points}` }))
      : [...rows].sort((a, b) => b.score - a.score).slice(0, 3).map((r) => ({ name: r.playerName || 'Player', value: `${Math.round(r.score)}` }));
    out.push({
      key: `launch:${post.id}`,
      kind: 'game',
      source: String(post.body.gameName || 'Game'),
      title: String(post.body.title || post.body.gameName || 'Game round'),
      at,
      end,
      state: stateOf(at, end, now),
      stats: [[n(rows.length), plural(rows.length, 'player')]],
      top,
      open: { view: 'games' },
    });
  }
  return out;
}

function planItemEntry(item: EngagementPlanItem, now: number): PlanEntry {
  // Read as IST: a date with no time is the start of that day there.
  const at = new Date(`${item.date}T${item.time || '00:00'}:00+05:30`).toISOString();
  const state = stateOf(at, null, now);
  return {
    key: `plan:${item.id}`,
    kind: item.kind,
    source: 'Added to the plan',
    title: item.title,
    at,
    end: null,
    state: state === 'planned' ? 'planned' : 'done',
    stats: [],
    top: [],
    open: null,
    planItemId: item.id,
    note: item.note,
  };
}

/** The whole list, from this financial year's start (1 April, IST) on. */
export async function planFor(org: string) {
  const now = Date.now();
  const today = new Date(now + 330 * 60_000);
  const fyStartYear = today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const since = new Date(`${fyStartYear}-04-01T00:00:00+05:30`);
  // Something that started a little before the year but was still on is kept by the per-source checks.
  const names = await catalogNames();
  const [contests, polls, cups, poker, squads, relays, launches, items] = await Promise.all([
    contestEntries(org, since, now),
    pollEntries(org, since, now),
    cupEntries(org, since, now, names),
    pokerEntries(org, since, now, names),
    squadEntries(org, since, now),
    relayEntries(org, since, now),
    launchEntries(org, since, now),
    engagementPlanItems().find({ org }, { projection: { _id: 0 } }).sort({ date: 1 }).toArray(),
  ]);
  const entries = [...contests, ...polls, ...cups, ...poker, ...squads, ...relays, ...launches, ...items.map((i) => planItemEntry(i, now))].sort(
    (a, b) => a.at.localeCompare(b.at),
  );
  return {
    yearFrom: since.toISOString(),
    yearTo: new Date(since.getTime() + 365 * DAY).toISOString(),
    entries,
  };
}

// ---- HR's planned dates ----

export class PlanItemError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

const KINDS: PlanKind[] = ['contest', 'poll', 'tournament', 'game'];

function cleanItem(input: Record<string, unknown>) {
  const date = String(input.date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new PlanItemError(400, 'Pick a date');
  }
  const time = String(input.time ?? '').trim();
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new PlanItemError(400, 'Pick a time, or leave it empty');
  const kind = String(input.kind ?? '') as PlanKind;
  if (!KINDS.includes(kind)) throw new PlanItemError(400, 'Pick what it is');
  const title = String(input.title ?? '').trim().slice(0, 120);
  if (!title) throw new PlanItemError(400, 'Give it a name');
  const note = String(input.note ?? '').trim().slice(0, 500);
  return { date, time, kind, title, note };
}

export async function addPlanItem(org: string, createdBy: string, input: Record<string, unknown>) {
  const now = new Date();
  const item: EngagementPlanItem = { id: randomUUID(), org, ...cleanItem(input), createdBy, createdAt: now, updatedAt: now };
  await engagementPlanItems().insertOne({ ...item });
  return item;
}

export async function updatePlanItem(org: string, id: string, input: Record<string, unknown>) {
  const res = await engagementPlanItems().findOneAndUpdate(
    { org, id },
    { $set: { ...cleanItem(input), updatedAt: new Date() } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!res) throw new PlanItemError(404, 'That planned date is gone');
  return res;
}

export async function deletePlanItem(org: string, id: string) {
  const res = await engagementPlanItems().deleteOne({ org, id });
  if (!res.deletedCount) throw new PlanItemError(404, 'That planned date is gone');
}
