/**
 * Contest pushes that come from the clock rather than from someone's action:
 *
 *   contest_closing   two hours before a contest closes, to the people it is
 *                     open to who have not entered yet. Once per contest.
 *   contest_results   as it closes, to everyone who entered or voted (and, on
 *                     Most Likely, the people named). Once per contest.
 *
 * Run every five minutes (notification-scheduler). The title is the contest's
 * own, word for word, as on the approved mockup; the line under it says what
 * is happening. The picture is the contest's own photo (the look decides).
 *
 * "Once" is a row in `notification_once` keyed by the contest: the insert of
 * its `_id` succeeds for exactly one runner, however many processes tick.
 * The org gate (NOTIFY_ORGS) is asked before the claim, so a dev server on the
 * shared database never uses up a real company's push.
 */
import { connectPosts, getDb } from '../config/db';
import type { ConnectPost } from '../models/connect.model';
import { CONTEST_TYPES, contestName } from './engagement-contests.service';
import { postAudience, plural, postPicture as contestPicture } from './connect-notifications.service';
import { notifiesOrg, notifyUsers } from './notification.service';
import { logger } from '../utils/logger';

const HOUR_MS = 60 * 60_000;
/** How long before a contest closes the reminder goes. */
export const CLOSING_LEAD_MS = 2 * HOUR_MS;
/** A contest that closed longer ago than this (the server was down) gets no results push. */
const RESULTS_WITHIN_MS = 6 * HOUR_MS;

/** The contest's title as HR typed it; a contest with none goes by what its card leads with. */
export function contestTitle(post: ConnectPost): string {
  const typed = String(post.body.title ?? '').trim();
  return (typed || contestName(post)).slice(0, 100);
}

function closesAtOf(post: ConnectPost): Date | null {
  const raw = String(post.body.closesAt ?? '').trim();
  if (!raw) return null;
  const when = new Date(raw);
  return Number.isNaN(when.getTime()) ? null : when;
}

const hhmm = (date: Date) =>
  date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });

/** "2 hours left", "1 hour left", "40 minutes left": the job may run a little late. */
export function timeLeft(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} left`;
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`;
}

/** True for exactly one caller per name, across every process. */
export async function claimNotificationOnce(name: string, now = new Date()): Promise<boolean> {
  try {
    await getDb().collection<{ _id: string; at: Date }>('notification_once').insertOne({ _id: name, at: now });
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
}

/** The closing-soon copy for one contest, from its live state. */
export function closingCopy(post: ConnectPost, now: Date) {
  const closesAt = closesAtOf(post)!;
  const entries = (post.captionEntries ?? []).length;
  const so = entries ? `${entries} ${entries === 1 ? 'entry' : 'entries'} so far. ` : '';
  return {
    title: contestTitle(post),
    body: `${timeLeft(closesAt.getTime() - now.getTime())} · ${so}Get yours in before ${hhmm(closesAt)}.`,
  };
}

/** Who won, and the line that says so. Null when nobody took part: there is nothing to announce. */
export function resultsCopy(post: ConnectPost): { title: string; body: string; recipients: string[] } | null {
  const entries = post.captionEntries ?? [];
  const votes = post.captionVotes ?? {};
  const entryIds = new Set(entries.map((entry) => entry.id));
  const liveVotes = Object.entries(votes).filter(([, entryId]) => entryIds.has(entryId));
  const recipients = new Set<string>([...entries.map((entry) => entry.userId), ...liveVotes.map(([voter]) => voter)]);
  if (!recipients.size) return null;
  const title = contestTitle(post);
  if (post.type === 'most_likely') {
    const tags = new Map<string, { name: string; n: number }>();
    for (const entry of entries) {
      if (!entry.taggedUserId) continue;
      recipients.add(entry.taggedUserId);
      const row = tags.get(entry.taggedUserId) ?? { name: entry.taggedName ?? 'A teammate', n: 0 };
      row.n += 1;
      tags.set(entry.taggedUserId, row);
    }
    const top = [...tags.values()].sort((a, b) => b.n - a.n)[0];
    const body = top
      ? `Results are in: ${top.name} was named most, ${top.n === 1 ? 'once' : `${top.n} times`}. See who else.`
      : 'Results are in. See how it ended.';
    return { title, body, recipients: [...recipients] };
  }
  const byEntry = new Map<string, number>();
  for (const [, entryId] of liveVotes) byEntry.set(entryId, (byEntry.get(entryId) ?? 0) + 1);
  // Ties keep the earlier entry ahead, as the app's leaderboard does.
  const top = [...entries].sort((a, b) => (byEntry.get(b.id) ?? 0) - (byEntry.get(a.id) ?? 0))[0];
  const topVotes = top ? byEntry.get(top.id) ?? 0 : 0;
  const more = entries.length >= 3 ? 'See the top 3.' : 'See the results.';
  const body = top && topVotes > 0
    ? `Results are in: ${top.name} won with ${plural(topVotes, 'vote')}. ${more}`
    : `Results are in. ${more}`;
  return { title, body, recipients: [...recipients] };
}

const PROJECTION = { _id: 0, comments: 0, likedBy: 0, wishesSeenAt: 0 } as const;

async function sendClosing(post: ConnectPost, now: Date) {
  const closesAt = closesAtOf(post);
  if (!closesAt) return false;
  // Posted inside the last two hours: the "posted" push already said when it closes.
  if (closesAt.getTime() - new Date(post.publishedAt).getTime() <= CLOSING_LEAD_MS) return false;
  if (!notifiesOrg(post.org)) return false;
  if (!(await claimNotificationOnce(`contest_closing:${post.id}`, now))) return false;
  const entered = new Set((post.captionEntries ?? []).map((entry) => entry.userId));
  const audience = (await postAudience(post))
    .map((user) => user.userId)
    .filter((userId) => !entered.has(userId) && userId !== post.author.userId);
  if (!audience.length) return true;
  await notifyUsers(audience, {
    scenario: 'contest_closing',
    ...closingCopy(post, now),
    data: { destination: 'connect_post', postId: post.id, postType: post.type },
    picture: contestPicture(post),
  });
  return true;
}

async function sendResults(post: ConnectPost, now: Date) {
  if (!notifiesOrg(post.org)) return false;
  const copy = resultsCopy(post);
  if (!(await claimNotificationOnce(`contest_results:${post.id}`, now))) return false;
  if (!copy) return true;
  await notifyUsers(copy.recipients, {
    scenario: 'contest_results',
    title: copy.title,
    body: copy.body,
    data: { destination: 'connect_post', postId: post.id, postType: post.type },
    picture: contestPicture(post),
  });
  return true;
}

/** Both jobs, for one tick. Returns how many contests each sent for. */
export async function runContestNotifications(now = new Date()) {
  const nowIso = now.toISOString();
  // closesAt is stored as an ISO string, so string order is time order.
  const [closing, closed] = await Promise.all([
    connectPosts()
      .find({ type: { $in: [...CONTEST_TYPES] }, 'body.closesAt': { $gt: nowIso, $lte: new Date(now.getTime() + CLOSING_LEAD_MS).toISOString() } }, { projection: PROJECTION })
      .limit(200)
      .toArray(),
    connectPosts()
      .find({ type: { $in: [...CONTEST_TYPES] }, 'body.closesAt': { $lte: nowIso, $gt: new Date(now.getTime() - RESULTS_WITHIN_MS).toISOString() } }, { projection: PROJECTION })
      .limit(200)
      .toArray(),
  ]);
  let closingSent = 0;
  let resultsSent = 0;
  for (const post of closing) {
    try { if (await sendClosing(post as ConnectPost, now)) closingSent += 1; }
    catch (error) { logger.error('Contest closing push failed', { postId: post.id }, error); }
  }
  for (const post of closed) {
    try { if (await sendResults(post as ConnectPost, now)) resultsSent += 1; }
    catch (error) { logger.error('Contest results push failed', { postId: post.id }, error); }
  }
  return { closing: closingSent, results: resultsSent };
}
