// Pinning and contests from Suwi (24 Nov, HR asked that Suwi can do what Engagement › Feed and
// Engagement › Contests do). prepare_pin_posts pins or unpins posts (one card for several) through the
// feed page's own pinFeedPost / unpinFeedPost (engagement-feed.service): a pin lasts until a time, and
// at most FEED_MAX_PINNED posts are pinned at once. prepare_contest starts a Most Likely or Best Photo
// (photo story) contest through createConnectPost, the service behind POST /connect/posts that the
// Contests composer calls, with the card showing the post as the feed will draw it and when it closes.
// "Caption this" needs a picture to caption, which Suwi cannot attach: the card points to the composer.
import { connectPosts, users } from '../../config/db';
import type { ConnectPost } from '../../models/connect.model';
import { createConnectPost, deleteConnectPost, FEED_MAX_PINNED } from '../../services/connect.service';
import { pinFeedPost, unpinFeedPost } from '../../services/engagement-feed.service';
import { defineTools, num, str, SuwiContext } from '../tools';
import { defineExecutor, propose, SuwiActionError } from '../proposals';
import { companyName } from './connect';

const IST = 'Asia/Kolkata';
const IST_WEEKDAY_TIME = new Intl.DateTimeFormat('en-US', { timeZone: IST, weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true });
const IST_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' });
/** "Friday, 6 pm" / "Friday, 5:30 pm", as the app and the composer write a closing time. */
function weekdayTime(when: Date) {
  const part = Object.fromEntries(IST_WEEKDAY_TIME.formatToParts(when).map((p) => [p.type, p.value]));
  return `${part.weekday}, ${part.hour}${part.minute === '00' ? '' : `:${part.minute}`} ${String(part.dayPeriod).toLowerCase()}`;
}
const when = (d: Date) => `${weekdayTime(d)} (${IST_DATE.format(d)})`;
/** A YYYY-MM-DD day and HH:MM time in India, or a full ISO time. */
function istTime(day: string, time: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}T/.test(day)) { const d = new Date(day); return Number.isNaN(d.getTime()) ? null : d; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${day}T${time.padStart(5, '0')}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type PostRow = Pick<ConnectPost, 'id' | 'type' | 'tag' | 'body' | 'author' | 'publishedAt' | 'pinnedUntil'>;
const postText = (p: PostRow) => {
  const b = p.body ?? {};
  return String(b.title || b.text || b.question || b.task || b.caption || b.label || '').trim().replace(/\s+/g, ' ').slice(0, 160);
};
const describe = (p: PostRow) => `${p.tag || p.type} by ${p.author?.name ?? 'Sowaka'}${postText(p) ? `: "${postText(p)}"` : ''}`;
const isLive = (p: PostRow, now: Date) => Boolean(p.pinnedUntil && new Date(p.pinnedUntil) > now);

/** Posts by id, or by words from their text (the most recent 300 posts); an unclear match names the candidates. */
async function findPosts(ctx: SuwiContext, refs: string[]) {
  const recent = await connectPosts().find({ org: ctx.org }, { projection: { _id: 0, id: 1, type: 1, tag: 1, body: 1, author: 1, publishedAt: 1, pinnedUntil: 1 } }).sort({ publishedAt: -1 }).limit(300).toArray() as PostRow[];
  const out: PostRow[] = [];
  for (const ref of refs) {
    const byId = recent.find((p) => p.id === ref) ?? (await connectPosts().findOne({ org: ctx.org, id: ref }) as PostRow | null);
    if (byId) { out.push(byId); continue; }
    const words = ref.toLowerCase();
    const hits = recent.filter((p) => `${postText(p)} ${p.author?.name ?? ''}`.toLowerCase().includes(words));
    if (hits.length === 1) { out.push(hits[0]); continue; }
    if (!hits.length) throw new Error(`No recent post matches "${ref}". Give its id, or words from its text.`);
    throw new Error(`More than one post matches "${ref}": ${hits.slice(0, 5).map((p) => `${describe(p)} [id ${p.id}]`).join('; ')}. Say which (by id).`);
  }
  return out;
}

const refsOf = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 200)).filter(Boolean) : str(v, 200) ? [str(v, 200)] : []);

// —— Contests ——
type ContestKind = 'most_likely' | 'photo_story' | 'caption_this';
const TYPE: Record<Exclude<ContestKind, 'caption_this'>, ConnectPost['type']> = { most_likely: 'most_likely', photo_story: 'photo_story_challenge' };

defineTools(
  {
    name: 'prepare_pin_posts',
    area: 'connect',
    acts: true,
    label: () => 'Prepared: pin or unpin feed posts',
    description: `Prepare ONE card that pins and/or unpins Connect posts, as Engagement › Feed does. pin: posts (ids or words from their text) to pin to the top of everyone's feed until a time (until: YYYY-MM-DD, with untilTime HH:MM India time, default 18:00; default a week from now). unpin: posts to take off the top. At most ${FEED_MAX_PINNED} posts can be pinned at once: unpin one in the same card to make room. Re-pinning a pinned post only moves its end time. Changes nothing until HR confirms; Undo puts every pin back as it was. Not for publishing posts (prepare_connect_post) or contests (prepare_contest).`,
    input_schema: {
      type: 'object',
      properties: {
        pin: { type: 'array', items: { type: 'string' }, description: 'Post ids or words from the post text' },
        unpin: { type: 'array', items: { type: 'string' }, description: 'Post ids or words from the post text' },
        until: { type: 'string', description: 'YYYY-MM-DD: pins last until this day' }, untilTime: { type: 'string', description: 'HH:MM India time on that day (default 18:00)' },
      },
    },
    api: { method: 'PUT', path: '/admin/engagement/feed/posts/x/pin' },
    async run(ctx, i) {
      const pinRefs = refsOf(i.pin), unpinRefs = refsOf(i.unpin);
      if (!pinRefs.length && !unpinRefs.length) throw new Error('Say which posts to pin or unpin');
      const [toPin, toUnpin] = await Promise.all([findPosts(ctx, pinRefs), findPosts(ctx, unpinRefs)]);
      const now = new Date();
      const live = await connectPosts().find({ org: ctx.org, pinnedUntil: { $gt: now } }, { projection: { _id: 0, id: 1, type: 1, tag: 1, body: 1, author: 1, publishedAt: 1, pinnedUntil: 1 } }).toArray() as PostRow[];
      const unpinning = toUnpin.filter((p) => isLive(p, now));
      const notPinned = toUnpin.filter((p) => !isLive(p, now));
      const until = str(i.until) ? istTime(str(i.until, 30), str(i.untilTime, 5) || '18:00') : new Date(now.getTime() + 7 * 86_400_000);
      if (toPin.length && (!until || until <= now)) throw new Error('Pick a time in the future for the pin to end (until YYYY-MM-DD, untilTime HH:MM)');
      if (toPin.length && until!.getTime() - now.getTime() > 90 * 86_400_000) throw new Error('A pin can last 90 days at most from Suwi');
      const gone = new Set(unpinning.map((p) => p.id));
      const newPins = toPin.filter((p) => !isLive(p, now) && !gone.has(p.id));
      const after = live.filter((p) => !gone.has(p.id)).length + newPins.length;
      if (after > FEED_MAX_PINNED) {
        const stay = live.filter((p) => !gone.has(p.id));
        throw new Error(`${FEED_MAX_PINNED} posts can be pinned at once, the most the feed shows. Pinned now: ${stay.map((p) => `${describe(p)} until ${when(new Date(p.pinnedUntil!))} [id ${p.id}]`).join('; ')}. Unpin ${after - FEED_MAX_PINNED} in the same request to make room.`);
      }
      if (!toPin.length && !unpinning.length) return { data: { prepared: false, message: 'None of those posts is pinned now.', notPinned: notPinned.map(describe) } };
      const lines: { text: string; why?: string; tone?: 'info' | 'warn' }[] = [
        ...unpinning.map((p) => ({ text: `Unpin ${describe(p)} (pinned until ${when(new Date(p.pinnedUntil!))}). It stays in the feed in its usual place.` })),
        ...toPin.map((p) => ({ text: isLive(p, now) ? `Move the pin on ${describe(p)} to end ${when(until!)} (now ${when(new Date(p.pinnedUntil!))}).` : `Pin ${describe(p)} to the top of everyone's feed until ${when(until!)}.` })),
        { text: `Pinned after this: ${after} of ${FEED_MAX_PINNED}.`, why: 'The app\'s feed leads with the pinned posts, newest first; a pin ends by itself at its time.' },
        ...(notPinned.length ? [{ text: `Not pinned now, so nothing to unpin: ${notPinned.map(describe).join('; ')}.`, tone: 'info' as const }] : []),
        { text: 'Undo puts every pin back as it was.', tone: 'info' as const },
      ];
      const title = [unpinning.length ? `unpin ${plural(unpinning.length, 'post')}` : '', toPin.length ? `pin ${plural(toPin.length, 'post')}` : ''].filter(Boolean).join(' and ');
      const proposalId = await propose(ctx, {
        kind: 'pin_posts', area: 'connect', title: `${title[0].toUpperCase()}${title.slice(1)}`,
        summary: lines.slice(0, unpinning.length + toPin.length).map((l) => l.text).join(' '),
        lines, effectiveFrom: ctx.today, undoable: true,
        payload: {
          byUserId: ctx.userId, until: until?.toISOString() ?? null,
          pin: toPin.map((p) => ({ id: p.id, text: describe(p) })), unpin: unpinning.map((p) => ({ id: p.id, text: describe(p) })),
          before: Object.fromEntries([...toPin, ...unpinning].map((p) => [p.id, isLive(p, now) ? new Date(p.pinnedUntil!).toISOString() : null])),
        },
      });
      return { data: { prepared: true, title, pinning: toPin.map(describe), unpinning: unpinning.map(describe), until: until ? when(until) : null, pinnedAfter: after, note: 'Nothing changes until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open the feed', view: 'feed' }] };
    },
  },
  {
    name: 'prepare_contest',
    area: 'connect',
    acts: true,
    label: (i) => `Prepared: a ${str(i.type) === 'photo_story' ? 'Best Photo' : str(i.type) === 'caption_this' ? 'Caption this' : 'Most Likely'} contest`,
    description: "Prepare starting ONE contest in everyone's Connect feed, as Engagement › Contests does. type most_likely: text is the tag people nominate a teammate for (\"most likely to fix the printer\"). type photo_story (Best Photo): text is the task people post a photo for (max 100 characters). type caption_this needs a picture to caption, which Suwi cannot attach: it is started on the Contests page. closesOn YYYY-MM-DD with closesAt HH:MM India time (default 18:00), or closesInDays 1 or 2 like the composer. pointsPerVote 1–100 (default 10). The card shows the post as the feed will draw it and when it closes. Changes nothing until HR confirms; Undo deletes the contest (points it paid come back while it is still running). For polls and announcements use prepare_connect_post.",
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['most_likely', 'photo_story', 'caption_this'] },
        text: { type: 'string', description: 'The Most Likely tag, or the Best Photo task' },
        closesOn: { type: 'string', description: 'YYYY-MM-DD' }, closesAt: { type: 'string', description: 'HH:MM India time (default 18:00)' },
        closesInDays: { type: 'number', description: '1 or 2: closes this many days from now' },
        pointsPerVote: { type: 'number' },
      },
      required: ['type', 'text'],
    },
    api: { method: 'POST', path: '/admin/engagement/contests' },
    async run(ctx, i) {
      const kind = str(i.type) as ContestKind;
      if (kind === 'caption_this') throw new Error('Caption this needs the picture people will caption, and Suwi cannot attach one. Start it on Engagement › Contests (upload the picture there), or pick Most Likely or Best Photo.');
      if (kind !== 'most_likely' && kind !== 'photo_story') throw new Error('type must be most_likely, photo_story or caption_this');
      const me = await users().findOne({ userId: ctx.userId }, { projection: { _id: 0, canCreateContests: 1, dashboardAccess: 1, name: 1 } });
      if (me?.canCreateContests !== true) throw new Error('Your account is not allowed to start contests (People › Accesses: "Can create contests"). Ask an admin to turn it on.');
      let text = str(i.text, 100).replace(/\s+/g, ' ');
      if (!text) throw new Error(kind === 'most_likely' ? 'Give the tag, e.g. "most likely to fix the printer"' : 'Give the task people post a photo for');
      if (kind === 'most_likely' && /^to\s/i.test(text)) text = `Most likely ${text}`;
      text = `${text[0].toUpperCase()}${text.slice(1)}`;
      const now = new Date();
      const days = num(i.closesInDays, NaN, 1, 2);
      const closes = str(i.closesOn) ? istTime(str(i.closesOn, 30), str(i.closesAt, 5) || '18:00') : Number.isFinite(days) ? new Date(now.getTime() + Math.round(days) * 86_400_000) : null;
      if (!closes) throw new Error('Say when it closes: closesOn YYYY-MM-DD (and closesAt HH:MM), or closesInDays 1 or 2');
      if (closes.getTime() < now.getTime() + 60 * 60_000) throw new Error(`That closing time (${when(closes)}) is less than an hour away or past; pick a later one`);
      if (closes.getTime() - now.getTime() > 31 * 86_400_000) throw new Error('A contest can run 31 days at most from Suwi');
      const raw = num(i.pointsPerVote, 10);
      const points = Math.min(100, Math.max(1, Math.round(raw)));
      const official = Boolean(me.dashboardAccess);
      const body = kind === 'most_likely'
        ? { title: text, closesAt: closes.toISOString(), pointsPerVote: points }
        : { title: '', task: text, closesAt: closes.toISOString(), pointsPerVote: points };
      const [company, headcount] = await Promise.all([companyName(ctx.org), users().countDocuments({ org: ctx.org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never)]);
      const label = kind === 'most_likely' ? 'Most Likely' : 'Best Photo';
      const card = [
        `${official ? 'Sowaka Engagement' : me.name} · ${points} pts per vote received`,
        text,
        ...(kind === 'most_likely' ? ['Nominate the teammate who fits this tag'] : []),
        `Closes ${weekdayTime(closes)}`,
      ].join('\n');
      const proposalId = await propose(ctx, {
        kind: 'start_contest', area: 'connect', title: `Start a ${label} contest: ${text.slice(0, 60)}`,
        summary: `${card}\n\nTo: everyone at ${company} (${headcount} people).`,
        lines: [
          { text: `The card in the feed reads: "${card.split('\n').join(' / ')}".` },
          { text: `Goes live in everyone's Connect feed now and closes ${when(closes)}; after that it takes no more ${kind === 'most_likely' ? 'nominations' : 'entries or votes'}.`, why: 'The same post the Contests composer makes; everyone at the company sees it and gets a notification.' },
          { text: kind === 'most_likely' ? `Each person nominates one teammate; each nomination earns the person named ${points} points.` : `People post a photo for the task and vote for the best; each vote earns the photo's author ${points} points.`, why: points !== raw ? `Points per vote are kept between 1 and 100 (asked: ${raw}).` : 'What a vote is worth is HR\'s to set, from 1 to 100; the app\'s own contests are worth 10.' },
          { text: official ? 'Posted as Sowaka Engagement (the company), because you have dashboard access.' : `Posted in your name (${me.name}).` },
          { text: 'Undo deletes the contest; points it paid come back while it is still running.', tone: 'info' },
        ],
        effectiveFrom: ctx.today, undoable: true,
        payload: { byUserId: ctx.userId, type: TYPE[kind], body, label, text },
      });
      return { data: { prepared: true, contest: label, cardText: card, closes: when(closes), pointsPerVote: points, audience: `Everyone at ${company} (${headcount} people)`, note: 'Nothing is published until HR presses Confirm on the card. Show HR the card text as it is.' }, proposalId, links: [{ label: 'Open contests', view: 'contests' }] };
    },
  },
);

defineExecutor('pin_posts', {
  async run(p) {
    const { byUserId, until, pin, unpin } = p.payload as { byUserId: string; until: string | null; pin: { id: string; text: string }[]; unpin: { id: string; text: string }[] };
    const admin = await users().findOne({ userId: byUserId }, { projection: { _id: 0, userId: 1, org: 1, email: 1, name: 1 } });
    if (!admin) throw new SuwiActionError(404, 'Your account was not found');
    const failed: string[] = [];
    let unpinned = 0, pinned = 0;
    for (const x of unpin) { try { await unpinFeedPost(admin, x.id); unpinned++; } catch (e) { failed.push(`${x.text} (${(e as Error).message})`); } }
    for (const x of pin) { try { await pinFeedPost(admin, x.id, until); pinned++; } catch (e) { failed.push(`${x.text} (${(e as Error).message})`); } }
    return { message: `${[unpinned ? `Unpinned ${plural(unpinned, 'post')}` : '', pinned ? `pinned ${plural(pinned, 'post')}${until ? ` until ${when(new Date(until))}` : ''}` : ''].filter(Boolean).join(' and ') || 'Nothing changed'}.${failed.length ? ` Not done: ${failed.join('; ')}.` : ''}` };
  },
  async undo(p) {
    const { byUserId, pin, before } = p.payload as { byUserId: string; pin: { id: string }[]; before: Record<string, string | null> };
    const admin = await users().findOne({ userId: byUserId }, { projection: { _id: 0, userId: 1, org: 1, email: 1, name: 1 } });
    if (!admin) throw new SuwiActionError(404, 'Your account was not found');
    const now = new Date();
    const notes: string[] = [];
    // Newly pinned ones come off first, so putting the old pins back never meets the limit.
    for (const x of pin) if (!before[x.id]) await unpinFeedPost(admin, x.id).catch(() => undefined);
    for (const [id, prev] of Object.entries(before)) {
      if (prev && new Date(prev) > now) await pinFeedPost(admin, id, prev).catch((e) => notes.push((e as Error).message));
      else await unpinFeedPost(admin, id).catch(() => undefined);
    }
    return `Put the pins back as they were.${notes.length ? ` Not done: ${notes.join('; ')}.` : ''}`;
  },
});

defineExecutor('start_contest', {
  async run(p) {
    const { byUserId, type, body, label, text } = p.payload as { byUserId: string; type: ConnectPost['type']; body: Record<string, unknown>; label: string; text: string };
    if (new Date(String(body.closesAt)).getTime() <= Date.now()) throw new SuwiActionError(409, 'Its closing time has passed since this was prepared. Ask Suwi again with a later time.');
    const made = await createConnectPost(byUserId, { type, body });
    return { message: `${label} contest is live in Connect: "${text.slice(0, 80)}".`, undo: { postId: made.id } };
  },
  async undo(p) {
    const { byUserId } = p.payload as { byUserId: string };
    const id = p.undo?.postId as string | undefined;
    if (!id) throw new SuwiActionError(409, 'Nothing to undo');
    await deleteConnectPost(byUserId, id);
    return 'Deleted the contest from Connect.';
  },
});
