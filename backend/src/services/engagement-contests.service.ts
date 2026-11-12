/**
 * Dashboard › Engagement › Contests: the company's contests (Caption this,
 * Best photo, Most likely) with what really happened in each — entries, who
 * voted for whom, who tagged whom, and who in the audience has not taken part.
 *
 * Read only. Starting a contest still goes through POST /connect/posts and
 * deleting through DELETE /connect/posts/:id, so the app's rules (points
 * clamped, points taken back on a running contest) stay in one place.
 */
import { connectPosts, users } from '../config/db';
import type { ConnectPost } from '../models/connect.model';
import type { User } from '../models/user.model';
import { audienceAllows } from './audience-list-rules';
import { presignConnectMedia } from './s3-connect-media.service';
import { cachedEngagement } from './engagement-cache';

export const CONTEST_TYPES = ['caption_challenge', 'photo_story_challenge', 'most_likely'] as const;
export type ContestType = (typeof CONTEST_TYPES)[number];

const GONE = ['offboarded', 'terminated'];

/** The server's own clamp (normalizePoints in connect.service): 1–100, default 10. */
function pointsOf(post: ConnectPost): number {
  const n = Math.round(Number(post.body.pointsPerVote));
  return Number.isFinite(n) && n >= 1 ? Math.min(100, n) : 10;
}

function closesAtOf(post: ConnectPost): Date | null {
  const raw = String(post.body.closesAt ?? '').trim();
  if (!raw) return null;
  const when = new Date(raw);
  return Number.isNaN(when.getTime()) ? null : when;
}

function isClosed(post: ConnectPost): boolean {
  const when = closesAtOf(post);
  return when !== null && Date.now() > when.getTime();
}

/** What the card leads with, as the app picks it: the tag on Most likely, the task on Best photo. */
export function contestName(post: ConnectPost): string {
  const b = post.body;
  if (post.type === 'most_likely') return String(b.title || b.question || 'Most Likely');
  if (post.type === 'photo_story_challenge') return String(b.task || b.title || 'Caught red handed');
  return String(b.title || 'Caption this');
}

function audienceLabel(post: ConnectPost): string {
  const a = post.audience;
  if (!a) return 'Everyone';
  if (Array.isArray(a.userIds) || a.listId) return a.listName ? `List: ${a.listName}` : 'A list';
  if (a.teamId) return 'A team';
  if (a.department) return a.department;
  return 'Everyone';
}

type Person = { userId: string; name: string; department: string; location: string };

function personOf(u: Pick<User, 'userId' | 'name' | 'department' | 'location'> | undefined, userId: string, fallback: string): Person {
  return {
    userId,
    name: u?.name || fallback || 'Former colleague',
    department: u?.department || '',
    location: u?.location || '',
  };
}

/** One contest's numbers, worked out from its entries and votes. */
function tally(post: ConnectPost) {
  const entries = post.captionEntries ?? [];
  const votes = post.captionVotes ?? {};
  const ml = post.type === 'most_likely';
  const byEntry = new Map<string, number>();
  for (const entryId of Object.values(votes)) byEntry.set(entryId, (byEntry.get(entryId) ?? 0) + 1);
  const entryIds = new Set(entries.map((e) => e.id));
  // A vote for an entry since withdrawn is released by the server; skip any stragglers.
  const liveVotes = Object.entries(votes).filter(([, entryId]) => entryIds.has(entryId));
  const ppv = pointsOf(post);
  const participants = new Set<string>([...entries.map((e) => e.userId), ...liveVotes.map(([voter]) => voter)]);
  let leader = '';
  if (ml) {
    const tags = new Map<string, { name: string; n: number }>();
    for (const e of entries) {
      if (!e.taggedUserId) continue;
      const row = tags.get(e.taggedUserId) ?? { name: e.taggedName ?? 'Teammate', n: 0 };
      row.n += 1;
      tags.set(e.taggedUserId, row);
    }
    leader = [...tags.values()].sort((a, b) => b.n - a.n)[0]?.name ?? '';
  } else {
    // Ties keep the earlier entry ahead, as the app's leaderboard does.
    const top = [...entries].sort((a, b) => (byEntry.get(b.id) ?? 0) - (byEntry.get(a.id) ?? 0))[0];
    if (top && (byEntry.get(top.id) ?? 0) > 0) leader = top.name;
  }
  // Points paid: a vote earns its entry's author ppv; a tag earns the person named ppv.
  const pointsGiven = ml ? entries.filter((e) => e.taggedUserId).length * ppv : liveVotes.length * ppv;
  return {
    entries: entries.length,
    entrants: new Set(entries.map((e) => e.userId)).size,
    votes: ml ? entries.length : liveVotes.length,
    voters: ml ? new Set(entries.map((e) => e.userId)).size : liveVotes.length,
    participants: participants.size,
    pointsGiven,
    leader,
    byEntry,
    liveVotes,
  };
}

export function contestSummary(post: ConnectPost) {
  const t = tally(post);
  const closesAt = closesAtOf(post);
  return {
    id: post.id,
    type: post.type as ContestType,
    name: contestName(post),
    title: String(post.body.title ?? ''),
    task: String(post.body.task ?? ''),
    question: String(post.body.question ?? ''),
    pointsPerVote: pointsOf(post),
    publishedAt: post.publishedAt,
    closesAt: closesAt ? closesAt.toISOString() : null,
    status: isClosed(post) ? ('closed' as const) : ('live' as const),
    audience: audienceLabel(post),
    pinned: Boolean(post.pinnedUntil && new Date(post.pinnedUntil).getTime() > Date.now()),
    author: post.author?.name ?? '',
    entries: t.entries,
    entrants: t.entrants,
    votes: t.votes,
    voters: t.voters,
    participants: t.participants,
    pointsGiven: t.pointsGiven,
    leader: t.leader,
  };
}

export type ContestSummary = ReturnType<typeof contestSummary>;

/** Every contest, newest first, plus who took part in the ones started in the last 30 days. */
export function listContests(org: string) {
  return cachedEngagement(org, 'contests', null, () => buildContestList(org));
}

async function buildContestList(org: string) {
  const posts = await connectPosts()
    .find({ org, type: { $in: [...CONTEST_TYPES] } }, { projection: { _id: 0, comments: 0, likedBy: 0, wishesSeenAt: 0 } })
    .sort({ publishedAt: -1 })
    .limit(500)
    .toArray();
  const since = Date.now() - 30 * 86_400_000;
  const people = new Set<string>();
  let votes = 0;
  for (const post of posts) {
    if (new Date(post.publishedAt).getTime() < since) continue;
    const t = tally(post);
    (post.captionEntries ?? []).forEach((e) => people.add(e.userId));
    t.liveVotes.forEach(([voter]) => people.add(voter));
    votes += t.votes;
  }
  return { contests: posts.map(contestSummary), last30: { people: people.size, votes } };
}

async function firstMediaUrl(post: ConnectPost): Promise<string | null> {
  const keys = Array.isArray(post.body.mediaObjectKeys)
    ? (post.body.mediaObjectKeys as unknown[]).filter((k): k is string => typeof k === 'string')
    : typeof post.body.mediaObjectKey === 'string'
      ? [post.body.mediaObjectKey]
      : [];
  if (!keys.length) return null;
  return (await presignConnectMedia(keys[0]).catch(() => undefined)) ?? null;
}

/** Everything the Contests page shows for one contest. Null when it is not this company's. */
export async function contestDetail(org: string, id: string) {
  const post = await connectPosts().findOne({ id, org, type: { $in: [...CONTEST_TYPES] } });
  if (!post) return null;
  const t = tally(post);
  const ml = post.type === 'most_likely';
  const entries = post.captionEntries ?? [];

  // The company as it is now, for departments, locations and the audience.
  const roster = await users()
    .find(
      { org },
      { projection: { _id: 0, userId: 1, name: 1, department: 1, location: 1, managerUserId: 1, lifecycleStatus: 1 } },
    )
    .toArray();
  const byId = new Map(roster.map((u) => [u.userId, u]));
  const who = (userId: string, fallback = '') => personOf(byId.get(userId), userId, fallback);

  // Who could take part: active people the post's audience reaches.
  const audience = roster.filter(
    (u) =>
      !GONE.includes(String(u.lifecycleStatus ?? '')) &&
      audienceAllows(post.audience, {
        userId: u.userId,
        managerUserId: u.managerUserId ?? null,
        department: u.department ?? null,
      }),
  );

  const entryRows = await Promise.all(
    entries
      .filter(() => !ml)
      .map(async (e) => ({
        id: e.id,
        by: who(e.userId, e.name),
        text: e.text,
        photoUrl: e.photoObjectKey ? ((await presignConnectMedia(e.photoObjectKey).catch(() => undefined)) ?? null) : null,
        votes: t.byEntry.get(e.id) ?? 0,
        points: (t.byEntry.get(e.id) ?? 0) * pointsOf(post),
        createdAt: e.createdAt,
        mentions: (e.mentions ?? []).map((m) => m.name),
      })),
  );
  // Ranked by votes; ties keep submission order (the array is in that order).
  const ranked = entryRows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => b.row.votes - a.row.votes || a.i - b.i)
    .map(({ row }) => row);

  const entryById = new Map(entryRows.map((e) => [e.id, e]));
  const voters = ml
    ? []
    : t.liveVotes.map(([voterId, entryId]) => {
        const e = entryById.get(entryId);
        return { voter: who(voterId), entryId, forName: e?.by.name ?? '', forText: e?.text ?? '' };
      });

  const nominations = ml
    ? entries
        .filter((e) => e.taggedUserId)
        .map((e) => ({ by: who(e.userId, e.name), tagged: who(String(e.taggedUserId), e.taggedName ?? ''), at: e.createdAt }))
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    : [];
  const tagBoard = new Map<string, { person: Person; by: Person[]; tags: number }>();
  for (const n of nominations) {
    const row = tagBoard.get(n.tagged.userId) ?? { person: n.tagged, by: [], tags: 0 };
    row.tags += 1;
    row.by.push(n.by);
    tagBoard.set(n.tagged.userId, row);
  }
  const tagged = [...tagBoard.values()]
    .sort((a, b) => b.tags - a.tags)
    .map((row) => ({ ...row, points: row.tags * pointsOf(post) }));

  // Who in the audience has done nothing yet (entered, voted or nominated).
  const took = new Set<string>([...entries.map((e) => e.userId), ...t.liveVotes.map(([v]) => v)]);
  const notYet = audience.filter((u) => !took.has(u.userId)).map((u) => who(u.userId, u.name));

  // Taking part by department and by location, out of the audience there.
  const groupBy = (key: 'department' | 'location') => {
    const g = new Map<string, { group: string; audience: number; took: number }>();
    for (const u of audience) {
      const k = (u[key] as string | undefined) || 'Not set';
      const row = g.get(k) ?? { group: k, audience: 0, took: 0 };
      row.audience += 1;
      if (took.has(u.userId)) row.took += 1;
      g.set(k, row);
    }
    return [...g.values()].sort((a, b) => b.took - a.took || b.audience - a.audience);
  };

  return {
    contest: { ...contestSummary(post), mediaUrl: await firstMediaUrl(post), audienceSize: audience.length },
    entries: ranked,
    voters,
    nominations,
    tagged,
    notYet,
    byDepartment: groupBy('department'),
    byLocation: groupBy('location'),
  };
}
