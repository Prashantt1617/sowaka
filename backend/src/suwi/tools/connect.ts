// Connect: how much people take part (posts, reactions, polls, games), by
// team and office, with last month beside it; the open content reports, for
// Suwi to sort (never to act on); the facts a post needs (holidays, events,
// new joiners); and Suwi's one Connect action — publishing a post or poll
// through the same service the dashboard's composer uses, after HR confirms.
import { attendanceRecords, companies, connectPosts, gameScores, users } from '../../config/db';
import { ConnectPost } from '../../models/connect.model';
import { User } from '../../models/user.model';
import { listContentReports } from '../../services/connect-moderation.service';
import { createConnectPost, deleteConnectPost } from '../../services/connect.service';
import { listCompanyHolidays } from '../../services/holiday.service';
import { pointEvents } from '../../services/points-ledger.service';
import { listEvents as listRelayEvents } from '../../services/relay-import.service';
import { defineTools, monthOf, num, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';

/** Wellbeing-style rates (how engaged a group is) are only shown for groups this big. */
export const MIN_GROUP = 10;
const IST_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;
export const istDate = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
export const istWeekday = (d: Date) => new Date(d.getTime() + IST_MS).getUTCDay();
export const monthStart = (month: string) => new Date(`${month}-01T00:00:00+05:30`);
export const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
export const prevMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

export type RosterPerson = Pick<User, 'userId' | 'name' | 'department' | 'location' | 'branch' | 'birthday' | 'joiningDate' | 'managerUserId' | 'designation'>;
export async function activeRoster(org: string): Promise<RosterPerson[]> {
  return users().find({ org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never, {
    projection: { _id: 0, userId: 1, name: 1, department: 1, location: 1, branch: 1, birthday: 1, joiningDate: 1, managerUserId: 1, designation: 1 },
  }).toArray();
}
export const officeOf = (p: RosterPerson) => (p.location ?? p.branch ?? '').trim() || '(no office set)';
export const teamOf = (p: RosterPerson) => (p.department ?? '').trim() || '(no department set)';

export interface Activity { posts: number; reactions: number; comments: number; pollVotes: number; entries: number; games: number }
const blank = (): Activity => ({ posts: 0, reactions: 0, comments: 0, pollVotes: 0, entries: 0, games: 0 });
export const totalOf = (a: Activity) => a.posts + a.reactions + a.comments + a.pollVotes + a.entries + a.games;

/**
 * What each person did on Connect in a month. Reactions, poll votes and
 * challenge votes carry no time of their own, so they count in the month
 * the post went up; comments, entries and game plays have their own time.
 */
export async function activityByPerson(org: string, month: string, roster: RosterPerson[]) {
  const start = monthStart(month), end = monthStart(nextMonth(month));
  const ids = new Set(roster.map((p) => p.userId));
  const per = new Map<string, Activity>();
  const bump = (uid: string | undefined, k: keyof Activity, n = 1) => {
    if (!uid || !ids.has(uid)) return;
    const a = per.get(uid) ?? blank(); a[k] += n; per.set(uid, a);
  };
  // Posts from the month, and older posts whose comments or entries may fall in it.
  const posts = await connectPosts().find({ org, publishedAt: { $gte: new Date(start.getTime() - 90 * DAY_MS), $lt: end } }, {
    projection: { _id: 0, id: 1, type: 1, publishedAt: 1, 'author.userId': 1, likedBy: 1, 'comments.userId': 1, 'comments.createdAt': 1, pollVotes: 1, actionBy: 1, captionVotes: 1, 'captionEntries.userId': 1, 'captionEntries.createdAt': 1, 'body.title': 1, 'body.totalVotes': 1, 'audience.label': 1 },
  }).toArray();
  const inMonth = (d: Date | undefined) => Boolean(d && d >= start && d < end);
  const polls: { id: string; title: string; publishedAt: string; votes: number; audience: string }[] = [];
  const byType: Record<string, number> = {};
  for (const p of posts) {
    const own = inMonth(p.publishedAt);
    if (own) {
      byType[p.type] = (byType[p.type] ?? 0) + 1;
      bump(p.author?.userId, 'posts');
      for (const u of p.likedBy ?? []) bump(u, 'reactions');
      for (const u of Object.keys(p.pollVotes ?? {})) bump(u, 'pollVotes');
      for (const u of Object.keys(p.actionBy ?? {})) bump(u, 'reactions');
      for (const u of Object.keys(p.captionVotes ?? {})) bump(u, 'reactions');
      if (p.type === 'survey') polls.push({ id: p.id, title: str(p.body?.title, 120), publishedAt: istDate(p.publishedAt), votes: Object.keys(p.pollVotes ?? {}).length, audience: p.audience?.label ?? 'Public' });
    }
    for (const c of p.comments ?? []) if (inMonth(c.createdAt)) bump(c.userId, 'comments');
    for (const e of p.captionEntries ?? []) if (inMonth(e.createdAt)) bump(e.userId, 'entries');
  }
  const [plays, bests] = await Promise.all([
    pointEvents().aggregate<{ _id: string; n: number }>([{ $match: { org, source: 'game_challenge', createdAt: { $gte: start, $lt: end } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]).toArray(),
    gameScores().find({ org, achievedAt: { $gte: start, $lt: end } }, { projection: { _id: 0, userId: 1 } }).toArray(),
  ]);
  const played = new Set<string>();
  for (const r of plays) { bump(r._id, 'games', r.n); played.add(r._id); }
  for (const s of bests) if (!played.has(s.userId)) bump(s.userId, 'games');
  return { per, polls: polls.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)), postsByType: byType };
}

interface GroupRow { name: string; people: number; active: number; activeLastMonth: number | null; change: number | null; interactions: number; quiet: boolean; signal: { activeShare: number; interactionsPerPerson: number } | null; signalWithheld?: string }
function groupRows(roster: RosterPerson[], now: Map<string, Activity>, before: Map<string, Activity> | null, key: (p: RosterPerson) => string): GroupRow[] {
  const groups = new Map<string, RosterPerson[]>();
  for (const p of roster) { const k = key(p); groups.set(k, [...(groups.get(k) ?? []), p]); }
  return [...groups.entries()].map(([name, people]) => {
    const active = people.filter((p) => totalOf(now.get(p.userId) ?? blank()) > 0).length;
    const activeLastMonth = before ? people.filter((p) => totalOf(before.get(p.userId) ?? blank()) > 0).length : null;
    const interactions = people.reduce((s, p) => s + totalOf(now.get(p.userId) ?? blank()), 0);
    const big = people.length >= MIN_GROUP;
    return {
      name, people: people.length, active, activeLastMonth, change: activeLastMonth === null ? null : active - activeLastMonth, interactions,
      quiet: active === 0 || active / people.length < 0.25,
      signal: big ? { activeShare: Math.round((100 * active) / people.length), interactionsPerPerson: Math.round((10 * interactions) / people.length) / 10 } : null,
      ...(big ? {} : { signalWithheld: `Only ${people.length} ${people.length === 1 ? "person" : "people"}: engagement rates are shown for groups of ${MIN_GROUP} or more, to keep individuals' wellbeing private.` }),
    };
  }).sort((a, b) => b.people - a.people);
}

/** When Connect last saw a poll, a game session and a challenge, across the company. */
export async function lastDates(ctx: SuwiContext) {
  const latest = async (types: string[]) => (await connectPosts().find({ org: ctx.org, type: { $in: types as never[] } }, { projection: { _id: 0, publishedAt: 1, 'body.startsAt': 1, 'body.title': 1, type: 1 } }).sort({ publishedAt: -1 }).limit(1).toArray())[0];
  const [poll, challenge, session, score, relay] = await Promise.all([
    latest(['survey']), latest(['caption_challenge', 'photo_story_challenge', 'most_likely']), latest(['secret_squad', 'live_game', 'relay_game']),
    gameScores().find({ org: ctx.org }, { projection: { _id: 0, achievedAt: 1, gameId: 1 } }).sort({ achievedAt: -1 }).limit(1).toArray().then((r) => r[0]),
    listRelayEvents(ctx.userId).then((evs) => evs.filter((e) => e.startsAt).sort((a, b) => (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0))[0]).catch(() => undefined),
  ]);
  const sessionAt = [session?.body?.startsAt ? new Date(String(session.body.startsAt)) : session?.publishedAt, relay?.startsAt].filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime())).sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    lastPoll: poll ? { date: istDate(poll.publishedAt), title: str(poll.body?.title, 120) } : null,
    lastChallenge: challenge ? { date: istDate(challenge.publishedAt), type: challenge.type, title: str(challenge.body?.title, 120) } : null,
    lastGameSession: sessionAt ? { date: istDate(sessionAt), what: relay && relay.startsAt?.getTime() === sessionAt.getTime() ? `Relay: ${relay.name}` : session?.type === 'secret_squad' ? 'Secret Squad' : 'Live game' } : null,
    lastGamePlayed: score ? { date: istDate(score.achievedAt), game: score.gameId.replace(/^catalog:/, '') } : null,
  };
}

export async function companyName(org: string) {
  return (await companies().findOne({ id: org }, { projection: { _id: 0, name: 1 } }))?.name ?? org;
}

// —— Post drafting ——
type Kind = 'announcement' | 'poll' | 'event' | 'shoutout' | 'post';
const KIND_TYPE: Record<Kind, ConnectPost['type']> = { announcement: 'hr_announcement', poll: 'survey', event: 'event', shoutout: 'kudos', post: 'new_post' };
export interface DraftPost { kind: Kind; type: ConnectPost['type']; body: Record<string, unknown>; audience: string; preview: string }

/** Turns Suwi's plain input into the body the composer sends, and the words the card shows. */
export async function draftPost(ctx: SuwiContext, i: Record<string, unknown>, headcount: number): Promise<DraftPost> {
  const kind = str(i.kind) as Kind;
  if (!KIND_TYPE[kind]) throw new Error('kind must be announcement, poll, event, shoutout or post');
  const title = str(i.title, 160), text = str(i.text, 1200);
  const sendTo = str(i.sendTo) === 'my_team' ? 'my_team' : 'all_company';
  const company = await companyName(ctx.org);
  const audience = sendTo === 'my_team' ? 'Your team (you and the people who report to you, as the app\'s Team tab lists them)' : `Everyone at ${company} (${headcount} people)`;
  switch (kind) {
    case 'announcement': {
      if (!title || !text) throw new Error('An announcement needs a title and text');
      const ack = i.requireAcknowledgement === true;
      return { kind, type: 'hr_announcement', audience, body: { title, text, severity: i.highlight === true ? 'highlight_alert' : 'plain', sendTo, requireAcknowledgement: ack, acknowledgementMessage: ack ? str(i.acknowledgementMessage, 300) || 'Please acknowledge' : '' }, preview: `${title}\n${text}` };
    }
    case 'poll': {
      const options = Array.isArray(i.options) ? i.options.map((o) => str(o, 80)).filter(Boolean).slice(0, 4) : [];
      if (!title) throw new Error('A poll needs a question (title)');
      if (options.length < 2) throw new Error('A poll needs 2 to 4 options');
      return { kind, type: 'survey', audience, body: { title, options, sendTo }, preview: `${title}\n${options.map((o, n) => `${n + 1}. ${o}`).join('\n')}` };
    }
    case 'event': {
      const date = str(i.date, 20);
      if (!title) throw new Error('An event needs a title');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('An event needs a date (YYYY-MM-DD)');
      const body = { title, subtitle: str(i.subtitle ?? i.text, 180), category: ['sports', 'wellness', 'social', 'learning', 'creative'].includes(str(i.category)) ? str(i.category) : 'social', date, time: str(i.time, 20), location: str(i.location, 120), prize: str(i.prize, 120), allowRegistration: i.allowRegistration !== false };
      return { kind, type: 'event', audience: `Everyone at ${company} (${headcount} people); events always go to the whole company`, body, preview: `${title}${body.subtitle ? ` — ${body.subtitle}` : ''}\n${date}${body.time ? ` at ${body.time}` : ''}${body.location ? `, ${body.location}` : ''}${body.prize ? `\nPrize: ${body.prize}` : ''}` };
    }
    case 'shoutout': {
      const uid = str(i.personUserId, 80);
      if (!uid || !text) throw new Error('A shout-out needs one personUserId and the text');
      const person = await users().findOne({ org: ctx.org, userId: uid }, { projection: { _id: 0, name: 1 } });
      if (!person) throw new Error('That person is not in this company');
      const initials = person.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'T';
      return { kind, type: 'kudos', audience: `Everyone at ${company} (${headcount} people); a shout-out names one person and goes to the whole company`, body: { text, personName: person.name, personInitials: initials, personUserId: uid }, preview: `Shout-out to ${person.name}\n${text}` };
    }
    default: {
      if (!text) throw new Error('A post needs text');
      return { kind, type: 'new_post', audience, body: { postKind: 'text', text, sendTo }, preview: text };
    }
  }
}

/** Saves a card that will publish these posts on Confirm, as the asker, and delete them on Undo. */
export async function proposePosts(ctx: SuwiContext, drafts: DraftPost[], extra: { title: string; summary: string; lines: { text: string; why?: string; tone?: 'info' | 'warn' }[]; effectiveFrom?: string; typeToConfirm?: string }) {
  return propose(ctx, {
    kind: 'connect_post', area: 'connect', title: extra.title, summary: extra.summary, lines: extra.lines, effectiveFrom: extra.effectiveFrom ?? ctx.today,
    undoable: true, typeToConfirm: extra.typeToConfirm,
    payload: { byUserId: ctx.userId, posts: drafts.map((d) => ({ type: d.type, body: d.body, preview: d.preview })) },
  });
}

defineTools(
  {
    name: 'engagement_summary',
    area: 'connect',
    label: (i) => `Connect engagement for ${typeof i.month === 'string' ? i.month : 'this month'}`,
    description: 'How much people take part in Connect in a month (default: this month), with last month beside it: active people per team and per office, which teams and people are quiet, poll answer rates, when the last poll, challenge and game session were, and punch-ins by office. Engagement rates are only given for groups of 10 or more.',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' }, by: { type: 'string', enum: ['team', 'office', 'both'] }, includeQuietPeople: { type: 'boolean', description: 'List people with no activity this month (default true)' } } },
    api: { method: 'GET', path: '/admin/games' },
    async run(ctx, i) {
      const month = monthOf(i.month, ctx.today), before = prevMonth(month);
      const roster = await activeRoster(ctx.org);
      const [now, last, dates] = await Promise.all([activityByPerson(ctx.org, month, roster), activityByPerson(ctx.org, before, roster), lastDates(ctx)]);
      const by = str(i.by) || 'both';
      const active = roster.filter((p) => totalOf(now.per.get(p.userId) ?? blank()) > 0).length;
      const activeBefore = roster.filter((p) => totalOf(last.per.get(p.userId) ?? blank()) > 0).length;
      const quietPeople = roster.filter((p) => totalOf(now.per.get(p.userId) ?? blank()) === 0).map((p) => ({ userId: p.userId, name: p.name, team: teamOf(p), office: officeOf(p), quietLastMonthToo: totalOf(last.per.get(p.userId) ?? blank()) === 0 }));
      const ids = roster.map((p) => p.userId);
      const punches = await attendanceRecords().aggregate<{ _id: string | null; days: number; people: string[] }>([
        { $match: { userId: { $in: ids }, workDate: { $gte: `${month}-01`, $lt: `${nextMonth(month)}-01` }, punchIn: { $exists: true } } },
        { $group: { _id: '$punchInLocation.officeName', days: { $sum: 1 }, people: { $addToSet: '$userId' } } },
      ]).toArray();
      const total = roster.length;
      return {
        data: {
          month, comparedWith: before,
          company: { people: total, active, activeLastMonth: activeBefore, change: active - activeBefore, ...(total >= MIN_GROUP ? { activeShare: Math.round((100 * active) / total) } : { signalWithheld: `Fewer than ${MIN_GROUP} people` }) },
          ...(by !== 'office' ? { byTeam: groupRows(roster, now.per, last.per, teamOf) } : {}),
          ...(by !== 'team' ? { byOffice: groupRows(roster, now.per, last.per, officeOf) } : {}),
          postsThisMonth: now.postsByType,
          polls: now.polls.map((p) => ({ ...p, answerRate: p.audience === 'Public' && total ? Math.round((100 * p.votes) / total) : null, note: p.audience === 'Public' ? undefined : 'Team poll: audience size not known' })),
          pollsLastMonth: last.polls.length,
          ...dates,
          punchInsByOffice: punches.map((r) => ({ office: r._id ?? 'No office matched or not recorded', days: r.days, people: r.people.length })).sort((a, b) => b.days - a.days),
          ...(i.includeQuietPeople !== false ? { quietPeople: { count: quietPeople.length, people: quietPeople.slice(0, 25) } } : {}),
          notes: [
            '"Active" means at least one post, reaction, comment, poll vote, challenge entry or game play in the month. Reactions and poll votes count in the month the post went up.',
            `Engagement rates (active share, interactions per person) are shown only for groups of ${MIN_GROUP} or more people; activity counts are shown for every group.`,
            'Quiet is an activity fact, not a judgement about anyone.',
          ],
        },
        links: [{ label: 'Open engagement posts', view: 'engagementposts' }, { label: 'Open games', view: 'games' }],
      };
    },
  },
  {
    name: 'connect_reports',
    area: 'connect',
    label: (i) => (str(i.status) === 'all' ? 'All content reports' : 'Open content reports'),
    description: 'Reported posts and comments in Connect (default: open ones), each with the reason the reporter chose, their note, the reported words, what the content says now, whether it is still up, and a suggested category (harassment, spam, off-topic, other) with a one-line reason to check against the text. Suwi only sorts and summarises; nothing is removed, hidden or closed.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'actioned', 'dismissed', 'all'] }, limit: { type: 'number' } } },
    api: { method: 'GET', path: '/admin/connect/reports' },
    async run(ctx, i) {
      const status = str(i.status) || 'open';
      const reports = await listContentReports(ctx.userId, status);
      const limit = num(i.limit, 40, 1, 200);
      const classify = (r: (typeof reports)[number]): { category: string; reason: string } => {
        const note = `${r.note ?? ''} ${r.excerpt}`.toLowerCase();
        if (['harassment', 'hate', 'sexual', 'violence'].includes(r.reason)) return { category: 'harassment', reason: `Reporter chose "${r.reasonLabel}"${r.note ? `: "${str(r.note, 80)}"` : ''}` };
        if (r.reason === 'spam') return /off.?topic|irrelevant|not (work|relevant)|unrelated/.test(note) ? { category: 'off-topic', reason: `Reporter chose "${r.reasonLabel}" and described it as off-topic` } : { category: 'spam', reason: `Reporter chose "${r.reasonLabel}"` };
        if (/off.?topic|irrelevant|unrelated|personal|politic/.test(note)) return { category: 'off-topic', reason: `Reporter's note reads as off-topic${r.note ? `: "${str(r.note, 80)}"` : ''}` };
        return { category: 'other', reason: `Reporter chose "${r.reasonLabel}"${r.note ? `: "${str(r.note, 80)}"` : ' with no note'}` };
      };
      const rows = reports.slice(0, limit).map((r) => {
        const c = classify(r);
        return {
          reportId: r.id, status: r.status, target: r.target, postType: r.postType || r.postTag, reportedOn: istDate(r.createdAt),
          reasonGiven: r.reasonLabel, reporterNote: r.note ?? '', reporter: r.reporterName, author: r.authorName, authorUserId: r.authorUserId ?? null,
          reportedText: str(r.excerpt, 400), currentText: str(r.currentText, 400), stillUp: r.stillPresent,
          suggestedCategory: c.category, why: c.reason,
          ...(r.status !== 'open' ? { reviewedBy: r.reviewedByName, reviewNote: r.reviewNote } : {}),
        };
      });
      const byCategory: Record<string, number> = {};
      for (const r of rows) byCategory[r.suggestedCategory] = (byCategory[r.suggestedCategory] ?? 0) + 1;
      return {
        data: { status, total: reports.length, byCategory, reports: rows, note: 'The suggested category is a starting point from the reason and note; read the text and re-sort where it reads differently. Decisions (action or dismiss) are HR\'s, on the Content reports page; Suwi never removes, hides or closes anything.' },
        links: [{ label: 'Open content reports', view: 'contentreports' }],
      };
    },
  },
  {
    name: 'post_facts',
    area: 'connect',
    label: () => 'Facts for a post: holidays, events, joiners, celebrations',
    description: 'Verified facts to write an announcement, poll or shout-out from: upcoming holidays from the Holiday Bank (next N days, default 45), upcoming events and game sessions already posted, the latest announcements, people who joined this month, and birthdays and work anniversaries in the next 7 days. Use before prepare_connect_post so dates and names are real.',
    input_schema: { type: 'object', properties: { daysAhead: { type: 'number', description: 'Holidays and events up to this many days ahead (default 45)' } } },
    api: { method: 'GET', path: '/admin/games' },
    async run(ctx, i) {
      const ahead = num(i.daysAhead, 45, 1, 400);
      const until = addDays(ctx.today, ahead), weekEnd = addDays(ctx.today, 7), month = ctx.today.slice(0, 7);
      const [holidays, roster, posts, company] = await Promise.all([
        listCompanyHolidays(ctx.userId, { state: '*' }),
        activeRoster(ctx.org),
        connectPosts().find({ org: ctx.org, type: { $in: ['event', 'hr_announcement', 'secret_squad', 'live_game', 'relay_game', 'survey'] } }, { projection: { _id: 0, id: 1, type: 1, publishedAt: 1, body: 1, 'author.name': 1, actionBy: 1, pollVotes: 1 } }).sort({ publishedAt: -1 }).limit(120).toArray(),
        companyName(ctx.org),
      ]);
      const mmdd = (d: Date | undefined) => (d ? istDate(d).slice(5) : '');
      const inWindow = (d: Date | undefined, from: string, to: string) => { const k = mmdd(d); if (!k) return false; const f = from.slice(5), t = to.slice(5); return f <= t ? k >= f && k <= t : k >= f || k <= t; };
      const years = (d: Date) => Number(ctx.today.slice(0, 4)) - Number(istDate(d).slice(0, 4));
      const events = posts.filter((p) => p.type === 'event').map((p) => ({ id: p.id, title: str(p.body.title, 140), subtitle: str(p.body.subtitle, 180), date: str(p.body.date, 20), time: str(p.body.time, 20), location: str(p.body.location, 120), registered: Object.keys(p.actionBy ?? {}).length, postedBy: p.author?.name })).filter((e) => !e.date || (e.date >= ctx.today && e.date <= until));
      const sessions = posts.filter((p) => ['secret_squad', 'live_game', 'relay_game'].includes(p.type)).map((p) => ({ type: p.type, title: str(p.body.title, 100), office: str(p.body.office, 80), startsAt: p.body.startsAt ? String(p.body.startsAt) : null, status: str(p.body.status, 20) })).filter((s) => !s.startsAt || s.startsAt.slice(0, 10) >= ctx.today).slice(0, 10);
      return {
        data: {
          today: ctx.today, company,
          holidays: holidays.filter((h) => h.date >= ctx.today && h.date <= until).map((h) => ({ date: h.date, name: h.name, type: h.type, where: h.state === '*' ? 'all locations' : h.state })),
          upcomingEvents: events.slice(0, 12), upcomingGameSessions: sessions,
          recentAnnouncements: posts.filter((p) => p.type === 'hr_announcement').slice(0, 5).map((p) => ({ date: istDate(p.publishedAt), title: str(p.body.title, 100), text: str(p.body.text, 200), by: p.author?.name })),
          recentPolls: posts.filter((p) => p.type === 'survey').slice(0, 5).map((p) => ({ date: istDate(p.publishedAt), question: str(p.body.title, 120), votes: Object.keys(p.pollVotes ?? {}).length })),
          newJoinersThisMonth: roster.filter((p) => p.joiningDate && istDate(p.joiningDate).startsWith(month)).map((p) => ({ userId: p.userId, name: p.name, designation: p.designation ?? null, team: teamOf(p), office: officeOf(p), joined: istDate(p.joiningDate!) })),
          birthdaysNext7Days: roster.filter((p) => inWindow(p.birthday, ctx.today, weekEnd)).map((p) => ({ userId: p.userId, name: p.name, on: mmdd(p.birthday), team: teamOf(p) })),
          anniversariesNext7Days: roster.filter((p) => p.joiningDate && years(p.joiningDate) >= 1 && inWindow(p.joiningDate, ctx.today, weekEnd)).map((p) => ({ userId: p.userId, name: p.name, on: mmdd(p.joiningDate), years: years(p.joiningDate!), team: teamOf(p) })),
          headcount: roster.length,
        },
        links: [{ label: 'Open holiday bank', view: 'holidaybank' }, { label: 'Open engagement posts', view: 'engagementposts' }],
      };
    },
  },
  {
    name: 'prepare_connect_post',
    area: 'connect',
    acts: true,
    label: (i) => `Prepared: a ${str(i.kind) || 'post'} for Connect`,
    description: 'Prepare publishing ONE post to Connect for HR to confirm: an announcement (title, text, optional highlight and requireAcknowledgement), a poll (title = question, 2–4 options), an event (title, date YYYY-MM-DD, time, location, category sports|wellness|social|learning|creative, prize), a shout-out to one person (personUserId, text; one person per post, never a ranking), or a plain post (text). sendTo all_company (default) or my_team for announcements, polls and plain posts. Nothing is published until HR confirms; Undo deletes the post. Get dates and names from post_facts first.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['announcement', 'poll', 'event', 'shoutout', 'post'] }, title: { type: 'string' }, text: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } }, sendTo: { type: 'string', enum: ['all_company', 'my_team'] },
        highlight: { type: 'boolean' }, requireAcknowledgement: { type: 'boolean' }, acknowledgementMessage: { type: 'string' },
        date: { type: 'string' }, time: { type: 'string' }, location: { type: 'string' }, category: { type: 'string' }, subtitle: { type: 'string' }, prize: { type: 'string' },
        personUserId: { type: 'string' },
      },
      required: ['kind'],
    },
    api: { method: 'POST', path: '/connect/posts' },
    async run(ctx, i) {
      const headcount = await users().countDocuments({ org: ctx.org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never);
      const d = await draftPost(ctx, i, headcount);
      const noun = { announcement: 'announcement', poll: 'poll', event: 'event', shoutout: 'shout-out', post: 'post' }[d.kind];
      const lines = [
        { text: `Goes to: ${d.audience}.`, why: d.body.sendTo === 'my_team' ? 'A Team post is scoped to the reporting group you head, the same people the app\'s Team tab shows.' : 'Everyone still at the company sees it in their Connect feed and gets a notification.' },
        { text: `Posted in your name (${ctx.user.name}), right away, with today's date.`, why: 'Suwi publishes through the same service the dashboard composer uses, as you; there is no scheduling for a later date.' },
        ...(d.kind === 'poll' ? [{ text: 'People vote once each; the poll stays open until the post is deleted.' }] : []),
        ...(d.kind === 'announcement' && d.body.requireAcknowledgement ? [{ text: 'Each person is asked to acknowledge it; HR can see who has.' }] : []),
        ...(d.kind === 'event' ? [{ text: d.body.allowRegistration ? 'People can press Register on the card; registrations show on the post.' : 'No registration button.' }] : []),
        ...(d.kind === 'shoutout' ? [{ text: 'One person, named with their own photo; nobody else is ranked or compared.', why: 'Recognition is public praise for one person, never a league table.' }] : []),
        { text: 'Undo deletes the post (likes and comments on it go with it).', tone: 'info' as const },
      ];
      const proposalId = await proposePosts(ctx, [d], { title: d.kind === 'shoutout' ? `Publish ${d.preview.split('\n')[0]}` : `Publish ${noun}: ${str(d.body.title as string, 60) || str(d.body.text as string, 60)}`, summary: `${d.preview}\n\nTo: ${d.audience}`, lines });
      return { data: { prepared: true, kind: d.kind, fullText: d.preview, audience: d.audience, note: 'Nothing is published until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open engagement posts', view: 'engagementposts' }] };
    },
  },
);

defineExecutor('connect_post', {
  async run(p) {
    const { byUserId, posts } = p.payload as { byUserId: string; posts: { type: ConnectPost['type']; body: Record<string, unknown>; preview: string }[] };
    const ids: string[] = [];
    for (const post of posts) {
      const made = await createConnectPost(byUserId, { type: post.type, body: post.body });
      ids.push(made.id);
    }
    return { message: posts.length === 1 ? `Published to Connect: "${posts[0].preview.split('\n')[0].slice(0, 80)}".` : `Published ${posts.length} posts to Connect.`, undo: { postIds: ids } };
  },
  async undo(p) {
    const { byUserId } = p.payload as { byUserId: string };
    const ids = (p.undo?.postIds as string[] | undefined) ?? [];
    let gone = 0;
    for (const id of ids) { try { await deleteConnectPost(byUserId, id); gone++; } catch { /* already deleted */ } }
    return gone === 1 ? 'Deleted the post from Connect.' : `Deleted ${gone} of ${ids.length} posts from Connect.`;
  },
});
