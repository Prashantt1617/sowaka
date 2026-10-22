// What to plan in each office this month: a suggested engagement calendar
// (game sessions, polls, celebrations) built from facts — which weekday
// people actually take part on, when the last poll and game session were,
// holidays from the Holiday Bank, birthdays and anniversaries, and office
// headcount. Each suggestion carries its reason. The prepared action
// publishes what Connect can carry today (dated event posts and polls);
// Relay and Secret Squad sessions need a roster and questions uploaded, so
// those stay in the plan for HR to schedule by hand, and the card says so.
import { connectPosts, gameScores } from '../../config/db';
import { listCompanyHolidays } from '../../services/holiday.service';
import { pointEvents } from '../../services/points-ledger.service';
import { defineTools, monthOf, str, SuwiContext } from '../tools';
import { activeRoster, addDays, DraftPost, draftPost, istDate, istWeekday, lastDates, MIN_GROUP, monthName, nextMonth, officeOf, proposePosts, RosterPerson } from './connect';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86_400_000;

/** Connect activity in the last 90 days by IST weekday, per office. */
async function weekdayActivity(ctx: SuwiContext, roster: RosterPerson[]) {
  const since = new Date(Date.now() - 90 * DAY_MS);
  const office = new Map(roster.map((p) => [p.userId, officeOf(p)]));
  const counts = new Map<string, number[]>();
  const hit = (uid: string | undefined, at: Date | undefined) => {
    const o = uid ? office.get(uid) : undefined;
    if (!o || !at) return;
    const row = counts.get(o) ?? [0, 0, 0, 0, 0, 0, 0];
    row[istWeekday(at)]++;
    counts.set(o, row);
  };
  const [posts, plays, scores] = await Promise.all([
    connectPosts().find({ org: ctx.org, publishedAt: { $gte: new Date(since.getTime() - 30 * DAY_MS) } }, { projection: { _id: 0, publishedAt: 1, 'author.userId': 1, 'comments.userId': 1, 'comments.createdAt': 1, 'captionEntries.userId': 1, 'captionEntries.createdAt': 1 } }).toArray(),
    pointEvents().find({ org: ctx.org, source: 'game_challenge', createdAt: { $gte: since } }, { projection: { _id: 0, userId: 1, createdAt: 1 } }).toArray(),
    gameScores().find({ org: ctx.org, achievedAt: { $gte: since } }, { projection: { _id: 0, userId: 1, achievedAt: 1 } }).toArray(),
  ]);
  for (const p of posts) {
    if (p.publishedAt >= since) hit(p.author?.userId, p.publishedAt);
    for (const c of p.comments ?? []) if (c.createdAt >= since) hit(c.userId, c.createdAt);
    for (const e of p.captionEntries ?? []) if (e.createdAt >= since) hit(e.userId, e.createdAt);
  }
  for (const e of plays) hit(e.userId, e.createdAt);
  for (const s of scores) hit(s.userId, s.achievedAt);
  return counts;
}

/** Best working weekday (Mon–Fri) from activity; Wednesday when there is too little to tell. */
function bestWeekday(row: number[] | undefined): { day: number; reason: string } {
  const total = (row ?? []).reduce((a, b) => a + b, 0);
  if (!row || total < 10) return { day: 3, reason: `too little activity in the last 90 days to pick a day (${total} actions), so mid-week` };
  let best = 1;
  for (let d = 2; d <= 5; d++) if (row[d] > row[best]) best = d;
  return { day: best, reason: `${WEEKDAYS[best]} had the most Connect activity in the last 90 days (${row[best]} of ${total} actions)` };
}

/** Dates in the month that fall on this weekday, from today on, skipping holidays. */
function datesOn(month: string, weekday: number, today: string, skip: Set<string>) {
  const out: string[] = [];
  for (let d = `${month}-01`; d < `${nextMonth(month)}-01`; d = addDays(d, 1)) {
    if (d < today || skip.has(d)) continue;
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === weekday) out.push(d);
  }
  return out;
}

interface Suggestion { office: string; date: string; what: string; kind: 'game_session' | 'poll' | 'celebration' | 'holiday'; reason: string; howToSchedule: string; draft?: Record<string, unknown> }

async function buildPlan(ctx: SuwiContext, month: string, officeFilter: string) {
  const roster = await activeRoster(ctx.org);
  const [weekdays, dates, holidays] = await Promise.all([weekdayActivity(ctx, roster), lastDates(ctx), listCompanyHolidays(ctx.userId, { state: '*' })]);
  const end = `${nextMonth(month)}-01`;
  const offices = new Map<string, RosterPerson[]>();
  for (const p of roster) { const o = officeOf(p); offices.set(o, [...(offices.get(o) ?? []), p]); }
  const want = officeFilter.toLowerCase();
  const daysSince = (iso: string | undefined) => (iso ? Math.round((Date.parse(ctx.today) - Date.parse(iso)) / DAY_MS) : null);
  const pollGap = daysSince(dates.lastPoll?.date), gameGap = daysSince(dates.lastGameSession?.date);
  const plans = [];
  for (const [office, people] of [...offices.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (want && !office.toLowerCase().includes(want)) continue;
    const key = office.toLowerCase();
    const hol = holidays.filter((h) => h.date >= `${month}-01` && h.date < end && (h.state === '*' || h.state.toLowerCase() === key));
    const skip = new Set(hol.filter((h) => h.type === 'Public').map((h) => h.date));
    const best = bestWeekday(weekdays.get(office));
    const slots = datesOn(month, best.day, ctx.today, skip);
    const remote = /remote|no office/i.test(office);
    const s: Suggestion[] = [];
    for (const h of hol) {
      if (h.date < ctx.today) continue;
      s.push({ office, date: h.date, what: `${h.name} (${h.type} holiday)`, kind: 'holiday', reason: `In the Holiday Bank for ${h.state === '*' ? 'all locations' : h.state}`, howToSchedule: 'Nothing to schedule; a greeting or announcement the working day before, if wanted.' });
      if (h.type === 'Public') {
        const eve = addDays(h.date, -1);
        if (eve >= ctx.today && !skip.has(eve)) s.push({ office, date: eve, what: `${h.name} celebration before the break`, kind: 'celebration', reason: `${h.name} is on ${h.date}; the working day before is when people are around to celebrate`, howToSchedule: 'Suwi can publish an event post for it.', draft: { kind: 'event', title: `${h.name} celebration${remote ? '' : ` at ${office}`}`, date: eve, time: '16:30', location: remote ? 'Online' : office, category: 'social', subtitle: `Celebrate ${h.name} together before the holiday` } });
      }
    }
    // At least a week after the last game session, so sessions don't crowd each other.
    const gameFrom = dates.lastGameSession ? addDays(dates.lastGameSession.date, 7) : ctx.today;
    const firstSlot = slots.find((d) => d >= gameFrom);
    if (firstSlot && (people.length >= 4)) {
      const game = remote ? 'an online game session (Scribble or Word Trip)' : 'a Secret Squad or Relay game session';
      s.push({ office, date: firstSlot, what: `Game session: ${game}`, kind: 'game_session', reason: `${best.reason}; ${gameGap === null ? 'no game session has run yet' : `last session was ${gameGap} days ago (${dates.lastGameSession!.date}, ${dates.lastGameSession!.what})`}; ${people.length} people in ${office}`, howToSchedule: remote ? 'Suwi can publish an event post with the date; the game itself is played from the Games tab.' : 'Relay and Secret Squad need a roster and questions uploaded: schedule it by hand on the Relay game page. Suwi can publish an event post announcing the date.', draft: { kind: 'event', title: remote ? 'Online game hour' : `Game session at ${office}`, date: firstSlot, time: '16:00', location: remote ? 'Games tab' : office, category: 'social', subtitle: 'Bring your team; the top players get a shout-out' } });
    }
    const pollSlot = slots.find((d) => d !== firstSlot) ?? firstSlot;
    if (pollSlot && (pollGap === null || pollGap >= 14)) s.push({ office, date: pollSlot, what: 'A short poll (e.g. what to do for the next team event)', kind: 'poll', reason: `${pollGap === null ? 'No poll has been posted yet' : `The last poll was ${pollGap} days ago (${dates.lastPoll!.date}: "${dates.lastPoll!.title}")`}; ${best.reason}`, howToSchedule: 'Connect has no scheduled posts: Suwi can publish the poll now, or HR posts it on the day.', draft: { kind: 'poll', title: 'What should our next team event be?', options: ['Game session', 'Lunch together', 'Workshop', 'Outdoor activity'] } });
    const mmdd = (d: Date) => istDate(d).slice(5);
    const inMonth = (d: Date | undefined) => Boolean(d) && mmdd(d!).slice(0, 2) === month.slice(5) && `${month}-${mmdd(d!).slice(3)}` >= ctx.today;
    const bdays = people.filter((p) => inMonth(p.birthday));
    const annivs = people.filter((p) => p.joiningDate && inMonth(p.joiningDate) && Number(month.slice(0, 4)) - Number(istDate(p.joiningDate).slice(0, 4)) >= 1);
    if (bdays.length + annivs.length >= 2) {
      const lastWorking = datesOn(month, 5, ctx.today, skip).at(-1) ?? slots.at(-1);
      if (lastWorking) s.push({ office, date: lastWorking, what: `Monthly celebration: ${[bdays.length ? `${bdays.length} birthday${bdays.length === 1 ? '' : 's'}` : '', annivs.length ? `${annivs.length} work anniversar${annivs.length === 1 ? 'y' : 'ies'}` : ''].filter(Boolean).join(' and ')}`, kind: 'celebration', reason: `${[...bdays, ...annivs].map((p) => p.name.split(' ')[0]).join(', ')} celebrate${bdays.length + annivs.length === 1 ? 's' : ''} this month; one get-together on the last Friday covers them all (Connect already posts each birthday and anniversary card on the day)`, howToSchedule: 'Suwi can publish an event post for it.', draft: { kind: 'event', title: `${monthName(month).split(' ')[0]} celebrations${remote ? '' : ` at ${office}`}`, date: lastWorking, time: '17:00', location: remote ? 'Online' : office, category: 'social', subtitle: 'Birthdays and work anniversaries this month' } });
    }
    plans.push({
      office, headcount: people.length, bestWeekday: WEEKDAYS[best.day], why: best.reason,
      ...(people.length < MIN_GROUP ? { note: `Small group (${people.length}): suggestions only use activity counts, not engagement rates.` } : {}),
      suggestions: s.sort((a, b) => a.date.localeCompare(b.date)),
    });
  }
  return { month, today: ctx.today, lastPoll: dates.lastPoll, lastGameSession: dates.lastGameSession, lastChallenge: dates.lastChallenge, offices: plans };
}

defineTools(
  {
    name: 'engagement_plan',
    area: 'connect',
    label: (i) => `Engagement plan for ${typeof i.month === 'string' ? i.month : 'this month'}${i.office ? ` (${i.office})` : ''}`,
    description: 'A suggested engagement calendar per office for a month (default: this month, from today): game sessions, polls and celebrations (Holiday Bank holidays, birthdays, work anniversaries), each with a date and a reason (best weekday from the last 90 days of Connect activity, days since the last poll and game session, office headcount) and how it can be scheduled. Optionally one office.',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' }, office: { type: 'string', description: 'Office or location name (part is enough)' } } },
    api: { method: 'GET', path: '/admin/games' },
    async run(ctx, i) {
      const plan = await buildPlan(ctx, monthOf(i.month, ctx.today), str(i.office));
      return {
        data: { ...plan, note: 'Suggestions, not decisions. Offices are the people\'s work location on their profile. Connect cannot schedule a post for later: event posts announce a future date and go up when confirmed; Relay and Secret Squad sessions are set up by hand on their pages.' },
        links: [{ label: 'Open engagement posts', view: 'engagementposts' }, { label: 'Open Relay game', view: 'relaygame' }, { label: 'Open holiday bank', view: 'holidaybank' }],
      };
    },
  },
  {
    name: 'prepare_engagement_plan',
    area: 'connect',
    acts: true,
    label: (i) => `Prepared: publish the ${typeof i.month === 'string' ? i.month : 'this month\'s'} engagement plan`,
    description: 'Prepare publishing the parts of the engagement plan Connect can carry: an event post for each game session and celebration (with its date), and the poll. Builds the same plan as engagement_plan (optionally one office, or only some kinds). Game sessions that need a Relay/Secret Squad setup are listed on the card for HR to schedule by hand. Nothing is published until HR confirms; Undo deletes every post it made.',
    input_schema: { type: 'object', properties: { month: { type: 'string' }, office: { type: 'string' }, kinds: { type: 'array', items: { type: 'string', enum: ['game_session', 'poll', 'celebration'] } } } },
    api: { method: 'POST', path: '/connect/posts' },
    async run(ctx, i) {
      const plan = await buildPlan(ctx, monthOf(i.month, ctx.today), str(i.office));
      const kinds = Array.isArray(i.kinds) && i.kinds.length ? new Set(i.kinds.map(String)) : new Set(['game_session', 'poll', 'celebration']);
      // Event posts and the poll go to the whole company, whichever office the plan is for.
      const headcount = (await activeRoster(ctx.org)).length;
      const drafts: DraftPost[] = [];
      const byHand: string[] = [];
      let pollDone = false;
      for (const o of plan.offices) for (const s of o.suggestions) {
        if (!s.draft || !kinds.has(s.kind)) continue;
        if (s.kind === 'poll') { if (pollDone) continue; pollDone = true; }
        drafts.push(await draftPost(ctx, s.draft, headcount));
        if (s.kind === 'game_session' && !/remote|no office/i.test(o.office)) byHand.push(`${o.office}: set up the ${s.date} game session on the Relay game page (roster and questions).`);
      }
      if (!drafts.length) return { data: { nothingToDo: true, message: 'The plan has nothing Connect can publish for that month and office.', plan } };
      const proposalId = await proposePosts(ctx, drafts, {
        title: `Publish ${drafts.length} engagement post${drafts.length === 1 ? '' : 's'} for ${monthName(plan.month)}`,
        summary: drafts.map((d) => `• ${d.preview.split('\n').join(' · ')}`).join('\n'),
        lines: [
          { text: `Goes to: everyone at the company (${headcount} people); each is a separate post in Connect.`, why: 'Event posts always go to the whole company; the poll goes company-wide so every office can answer.' },
          { text: 'All publish now, in your name; each event post shows its own future date and a Register button.', why: 'Connect has no scheduled posts, so the date lives on the event card rather than in when it appears.' },
          ...(drafts.some((d) => d.kind === 'poll') ? [{ text: 'The poll opens immediately, one vote each.' }] : []),
          ...byHand.map((t) => ({ text: t, tone: 'warn' as const, why: 'Relay and Secret Squad sessions need a team roster and questions uploaded; Suwi cannot do that part.' })),
          { text: 'Undo deletes every post this made.', tone: 'info' as const },
        ],
        effectiveFrom: ctx.today, typeToConfirm: drafts.length >= 5 ? String(drafts.length) : undefined,
      });
      return { data: { prepared: true, posts: drafts.map((d) => ({ kind: d.kind, text: d.preview, audience: d.audience })), scheduleByHand: byHand, note: 'Nothing is published until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open engagement posts', view: 'engagementposts' }] };
    },
  },
);
