// Recognition: who is worth a shout-out this week or month, from facts only —
// a review score that rose, a strong review, a game win, a quarter of perfect
// attendance, a work anniversary or birthday, a run of approved claims. Each
// comes with its evidence; the shout-out itself goes through
// prepare_connect_post (kind: shoutout), one person per post, never a ranking.
import { reimbursementClaims } from '../../config/db';
import { hasAllDashboardTabs } from '../../middleware/admin.middleware';
import { tabsForRequest } from '../../models/dashboard-tabs';
import { listAllFeedbackForAdmin } from '../../services/admin.service';
import { attendanceReport } from '../../services/attendance-report.service';
import { catalogFor, leaderboardFor } from '../../services/game-catalog.service';
import { pointEvents } from '../../services/points-ledger.service';
import { defineTools, num, str, SuwiContext } from '../tools';
import { activeRoster, addDays, istDate, officeOf, teamOf } from './connect';

/** The same tab rule as the dashboard API this fact comes from; a source this person can't open is skipped and named. */
function mayRead(ctx: SuwiContext, path: string) {
  if (hasAllDashboardTabs(ctx.user)) return true;
  const needed = tabsForRequest('GET', path);
  if (needed === null) return true;
  const mine = new Set(ctx.user.dashboardTabs ?? []);
  return needed.some((t) => mine.has(t));
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "11-03" → "3 Nov"; "2024-11-03" → "3 Nov 2024". */
const dayMonth = (v: string) => { const [y, m, d] = v.length === 5 ? ['', ...v.split('-')] : v.split('-'); return `${Number(d)} ${MON[Number(m) - 1]}${y ? ` ${y}` : ''}`; };

interface Reason { kind: string; evidence: string; link?: { label: string; view?: string; userId?: string; tab?: string } }

defineTools({
  name: 'recognition_candidates',
  area: 'connect',
  label: (i) => `People worth recognising this ${str(i.window) === 'month' ? 'month' : 'week'}`,
  description: 'People worth a shout-out this week (default) or month, from facts: a review score that rose or a strong latest review, a game leaderboard win or the most engagement points this week, perfect attendance over the last quarter, a work anniversary or birthday in the window, and a run of approved expense claims with none declined. Each person comes with the evidence and a link. One person per shout-out: use prepare_connect_post with kind shoutout. Never rank people publicly.',
  input_schema: { type: 'object', properties: { window: { type: 'string', enum: ['week', 'month'] }, limit: { type: 'number' } } },
  api: { method: 'GET', path: '/admin/games' },
  async run(ctx, i) {
    const window = str(i.window) === 'month' ? 'month' : 'week';
    const from = ctx.today, to = addDays(ctx.today, window === 'month' ? 30 : 7);
    const roster = await activeRoster(ctx.org);
    const byId = new Map(roster.map((p) => [p.userId, p]));
    const reasons = new Map<string, Reason[]>();
    const add = (userId: string, r: Reason) => { if (byId.has(userId)) reasons.set(userId, [...(reasons.get(userId) ?? []), r]); };
    const skipped: string[] = [];
    const quarterFrom = addDays(ctx.today, -91);

    // 1. Reviews: latest sent review per person, against the one before it.
    if (mayRead(ctx, '/admin/feedback')) {
      const all = (await listAllFeedbackForAdmin(ctx.userId)).filter((r) => r.status === 'sent');
      const byPerson = new Map<string, typeof all>();
      for (const r of all) byPerson.set(r.employeeUserId, [...(byPerson.get(r.employeeUserId) ?? []), r]);
      const recent = quarterFrom.slice(0, 7);
      for (const [uid, rs] of byPerson) {
        rs.sort((a, b) => b.period.localeCompare(a.period));
        const [latest, prev] = rs;
        if (!latest || latest.period < recent) continue;
        if (prev && latest.overallScore - prev.overallScore >= 0.5) add(uid, { kind: 'review_rose', evidence: `Review score rose from ${prev.overallScore.toFixed(1)} (${prev.period}) to ${latest.overallScore.toFixed(1)} (${latest.period}) out of 5, by ${latest.managerName ?? 'their manager'}.`, link: { label: 'Open feedback', view: 'feedback' } });
        else if (latest.overallScore >= 4.3) add(uid, { kind: 'strong_review', evidence: `Scored ${latest.overallScore.toFixed(1)} out of 5 in the ${latest.period} review by ${latest.managerName ?? 'their manager'}.`, link: { label: 'Open feedback', view: 'feedback' } });
      }
    } else skipped.push('reviews (no Feedback tab)');

    // 2. Games: whoever leads each board, when their best was set in the window or the last month; plus this week's points leader.
    const viewer = { userId: ctx.userId, name: ctx.user.name, org: ctx.org };
    const games = await catalogFor(viewer).catch(() => []);
    const since = addDays(ctx.today, window === 'month' ? -30 : -7);
    const scored = games.filter((g) => g.scoring);
    const boards = await Promise.all(scored.map((g) => leaderboardFor(viewer, g.key).catch(() => null)));
    scored.forEach((g, n) => {
      const board = boards[n];
      const top = board?.leaderboard[0];
      if (!top || top.score <= 0) return;
      const when = istDate(top.achievedAt);
      if (when >= since) add(top.userId, { kind: 'game_win', evidence: `Top of the ${g.name} leaderboard with ${top.score.toLocaleString('en-IN')} ${board!.scoring.label}, set on ${when} (${board!.leaderboard.length} players).`, link: { label: 'Open games', view: 'games' } });
    });
    // This week's points (the same ledger the Games tab's weekly board reads, since Monday 00:00 IST).
    const weekStart = addDays(ctx.today, -((new Date(`${ctx.today}T00:00:00Z`).getUTCDay() + 6) % 7));
    const [lead] = await pointEvents().aggregate<{ _id: string; points: number }>([
      { $match: { org: ctx.org, createdAt: { $gte: new Date(`${weekStart}T00:00:00+05:30`) } } },
      { $group: { _id: '$userId', points: { $sum: '$delta' } } }, { $sort: { points: -1 } }, { $limit: 1 },
    ]).toArray();
    if (lead && lead.points > 0) add(lead._id, { kind: 'points_leader', evidence: `Most engagement points this week: ${lead.points} since ${weekStart}.`, link: { label: 'Open games', view: 'games' } });

    // 3. Perfect attendance over the last quarter: no absence, late, half day or missed punch, and enough days to mean it.
    if (mayRead(ctx, '/admin/reports/attendance')) {
      const r = await attendanceReport(ctx.userId, { from: quarterFrom, to: ctx.today });
      const per = new Map<string, { present: number; bad: number }>();
      for (const [uid, , status, late, , , , , early] of r.days) {
        const c = per.get(uid) ?? { present: 0, bad: 0 };
        if (status === 'present' && late === 0 && early === 0) c.present++; else if (status !== 'on_leave') c.bad++;
        per.set(uid, c);
      }
      for (const [uid, c] of per) if (c.bad === 0 && c.present >= 40) add(uid, { kind: 'perfect_attendance', evidence: `${c.present} working days present and on time from ${quarterFrom} to ${ctx.today}, with no absence, late mark, half day or missed punch.`, link: { label: 'Open attendance report', view: 'attendancereport' } });
    } else skipped.push('attendance (no Attendance report tab)');

    // 4. Anniversaries and birthdays in the window.
    const mmdd = (d: Date) => istDate(d).slice(5);
    const inWindow = (d: Date | undefined) => { if (!d) return false; const k = mmdd(d), f = from.slice(5), t = to.slice(5); return f <= t ? k >= f && k <= t : k >= f || k <= t; };
    const thisYear = Number(ctx.today.slice(0, 4));
    for (const p of roster) {
      if (p.joiningDate && inWindow(p.joiningDate)) {
        const years = thisYear - Number(istDate(p.joiningDate).slice(0, 4)) + (mmdd(p.joiningDate) < from.slice(5) ? 1 : 0);
        if (years >= 1) add(p.userId, { kind: 'anniversary', evidence: `${years} year${years === 1 ? '' : 's'} at the company on ${dayMonth(mmdd(p.joiningDate))} (joined ${dayMonth(istDate(p.joiningDate))}).`, link: { label: `Open ${p.name.split(' ')[0]}'s profile`, userId: p.userId } });
      }
      if (inWindow(p.birthday)) add(p.userId, { kind: 'birthday', evidence: `Birthday on ${dayMonth(mmdd(p.birthday!))}.`, link: { label: `Open ${p.name.split(' ')[0]}'s profile`, userId: p.userId } });
    }

    // 5. Claims: a run of approved or paid claims this quarter with none declined.
    if (mayRead(ctx, '/admin/reimbursements')) {
      const claims = await reimbursementClaims().find({ userId: { $in: roster.map((p) => p.userId) }, createdAt: { $gte: new Date(`${quarterFrom}T00:00:00+05:30`) } }, { projection: { _id: 0, userId: 1, status: 1 } }).toArray();
      const per = new Map<string, { ok: number; declined: number }>();
      for (const c of claims) { const x = per.get(c.userId) ?? { ok: 0, declined: 0 }; if (c.status === 'approved' || c.status === 'paid') x.ok++; if (c.status === 'declined') x.declined++; per.set(c.userId, x); }
      for (const [uid, x] of per) if (x.ok >= 3 && x.declined === 0) add(uid, { kind: 'claims_streak', evidence: `${x.ok} expense claims approved since ${quarterFrom}, none declined.`, link: { label: 'Open reimbursements', view: 'reimbursements' } });
    } else skipped.push('claims (no Reimbursements tab)');

    const order = ['review_rose', 'strong_review', 'game_win', 'points_leader', 'perfect_attendance', 'anniversary', 'birthday', 'claims_streak'];
    const people = [...reasons.entries()].map(([userId, rs]) => {
      const p = byId.get(userId)!;
      rs.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
      return { userId, name: p.name, team: teamOf(p), office: officeOf(p), reasons: rs.map(({ kind, evidence }) => ({ kind, evidence })), links: rs.map((r) => r.link).filter(Boolean) };
    }).sort((a, b) => b.reasons.length - a.reasons.length || order.indexOf(a.reasons[0].kind) - order.indexOf(b.reasons[0].kind));
    const limit = num(i.limit, 25, 1, 100);
    return {
      data: {
        window: {
          lookedBack: { reviews: `latest sent review, from ${quarterFrom.slice(0, 7)} on`, games: `leaderboard bests set from ${since}`, pointsSince: weekStart, attendance: `${quarterFrom} to ${ctx.today}`, claims: `filed from ${quarterFrom}`, to: ctx.today },
          upcoming: { from, to, covers: 'work anniversaries and birthdays' },
        },
        candidates: people.length, people: people.slice(0, limit),
        ...(skipped.length ? { skipped } : {}),
        note: 'Facts only, in no particular order of merit. Post one shout-out per person (prepare_connect_post, kind shoutout); never publish a ranking or compare people.',
      },
      links: [{ label: 'Open engagement posts', view: 'engagementposts' }],
    };
  },
});
