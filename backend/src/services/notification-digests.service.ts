import { attendanceRecords, feedbackRecords, leaves, users } from '../config/db';
import { env } from '../config/env';
import { User } from '../models/user.model';
import { notifyUsers } from './notification.service';

/**
 * Scheduled notification digests: the feedback-cycle reminders and the
 * attendance/leave reports from the notification spec.
 *
 * Every one of these is derived from records that already exist — there is no
 * separate reminder state to keep. The scheduler decides *when* each runs; the
 * functions here only decide *who* gets what, and each is a no-op when there is
 * nothing to report.
 *
 * On the feedback "session date": feedback runs on a monthly cycle whose only
 * deadline is the end of the month, so the spec's session date maps to month
 * end — the T-2 reminder lands two days before it, and the overdue nudge on the
 * final day, the last chance before the record is marked Missed.
 */

const link = () => env.appWebUrl;

/** `YYYY-MM` for the month containing `date`. */
function period(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function monthLabel(value: string): string {
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1))
    .toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function dayLabel(date: Date): string {
  return date.toLocaleString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Managers paired with their active direct reports; managers with none are skipped. */
async function managersWithReports(): Promise<Map<string, { manager: User; reports: User[] }>> {
  const active = await users()
    .find({ lifecycleStatus: { $nin: ['offboarded', 'terminated'] } })
    .toArray();
  const byId = new Map(active.map((user) => [user.userId, user]));
  const grouped = new Map<string, { manager: User; reports: User[] }>();
  for (const user of active) {
    const manager = user.managerUserId ? byId.get(user.managerUserId) : undefined;
    if (!manager) continue;
    const entry = grouped.get(manager.userId) ?? { manager, reports: [] };
    entry.reports.push(user);
    grouped.set(manager.userId, entry);
  }
  return grouped;
}

/** Reports with no `sent` feedback for `forPeriod`, keyed by manager. */
async function pendingFeedback(forPeriod: string) {
  const grouped = await managersWithReports();
  const sent = await feedbackRecords()
    .find({ period: forPeriod, status: 'sent' })
    .toArray();
  const sentPairs = new Set(sent.map((record) => `${record.managerUserId}:${record.employeeUserId}`));
  return [...grouped.values()]
    .map(({ manager, reports }) => ({
      manager,
      reports: reports.filter((report) => !sentPairs.has(`${manager.userId}:${report.userId}`)),
    }))
    .filter((entry) => entry.reports.length > 0);
}

/** #13 — two days before month end. Manager and employee get separate copy. */
export async function sendFeedbackDueReminders(now = new Date()): Promise<void> {
  const current = period(now);
  const due = endOfMonth(now);
  const day = dayLabel(due);
  for (const { manager, reports } of await pendingFeedback(current)) {
    for (const report of reports) {
      await notifyUsers([manager.userId], {
        scenario: 'feedback_due', title: 'Feedback due',
        body: `Feedback for ${report.name} is due ${day}. Prepare now.`,
        data: { destination: 'grow_feedback', employeeUserId: report.userId, period: current },
        email: {
          subject: `Feedback for ${report.name} due ${day}`,
          body: `Hi {firstName},\n\nYour feedback session with ${report.name} is on ${day}. `
            + `Draft and save the feedback before the session:\n${link()}\n\n- Sowaka Connect`,
        },
      });
      await notifyUsers([report.userId], {
        scenario: 'feedback_due', title: 'Feedback session',
        body: `Your feedback session with ${manager.name} is on ${day}.`,
        data: { destination: 'grow_feedback', employeeUserId: report.userId, period: current },
        email: {
          subject: `Your feedback session with ${manager.name} is on ${day}`,
          body: `Hi {firstName},\n\nYour feedback session with ${manager.name} is on ${day}. `
            + `Take a few minutes to think about the month.\n\n- Sowaka Connect`,
        },
      });
    }
  }
}

/** #14 — final day of the month, the last chance before the record is Missed. */
export async function sendFeedbackOverdueReminders(now = new Date()): Promise<void> {
  const current = period(now);
  const month = monthLabel(current);
  const end = dayLabel(endOfMonth(now));
  for (const { manager, reports } of await pendingFeedback(current)) {
    for (const report of reports) {
      await notifyUsers([manager.userId], {
        scenario: 'feedback_overdue', title: 'Feedback overdue',
        body: `Feedback for ${report.name} is overdue - send it before month end.`,
        data: { destination: 'grow_feedback', employeeUserId: report.userId, period: current },
        email: {
          subject: `Overdue: feedback for ${report.name}`,
          body: `Hi {firstName},\n\nYour feedback session with ${report.name} hasn't been sent. `
            + `Send it before ${end} or it will be marked Missed - permanently for this month:\n`
            + `${link()}\n\n- Sowaka Connect`,
        },
      });
      await notifyUsers([report.userId], {
        scenario: 'feedback_overdue', title: 'Feedback pending',
        body: `Your ${month} feedback from ${manager.name} is pending.`,
        data: { destination: 'grow_feedback', employeeUserId: report.userId, period: current },
        email: {
          subject: `Your ${month} feedback is pending`,
          body: `Hi {firstName},\n\nYour ${month} feedback session with ${manager.name} hasn't `
            + `happened yet. It's still pending for this month.\n\n- Sowaka Connect`,
        },
      });
    }
  }
}

/** #15 — 1st of the month: one summary per manager for the month just ended. */
export async function sendMissedFeedbackSummaries(now = new Date()): Promise<void> {
  const closed = period(previousMonth(now));
  const month = monthLabel(closed);
  const next = monthLabel(period(now));
  for (const { manager, reports } of await pendingFeedback(closed)) {
    const names = reports.map((report) => report.name);
    await notifyUsers([manager.userId], {
      scenario: 'feedback_missed', title: 'Missed feedback',
      body: `You missed ${names.length} feedback session${names.length === 1 ? '' : 's'} in ${month}: ${names.join(', ')}`,
      data: { destination: 'grow_feedback', period: closed },
      email: {
        subject: `${month}: ${names.length} missed feedback session${names.length === 1 ? '' : 's'}`,
        body: `Hi {firstName},\n\nThese feedback sessions were not completed in ${month} and are `
          + `now marked Missed:\n${names.map((name) => `- ${name}`).join('\n')}\n\n`
          + `Missed records are permanent for the month. ${next}'s sessions are already scheduled:\n`
          + `${link()}\n\n- Sowaka Connect`,
      },
    });
  }
}

/**
 * #16 — 1st of the month: flags to HR where the same manager/employee pair has
 * gone two or more consecutive months without feedback.
 */
export async function sendConsecutiveMissedFlags(now = new Date()): Promise<void> {
  const closed = period(previousMonth(now));
  const grouped = await managersWithReports();
  const sent = await feedbackRecords().find({ status: 'sent' }).toArray();
  const sentPairs = new Set(sent.map((record) => `${record.managerUserId}:${record.employeeUserId}:${record.period}`));

  for (const { manager, reports } of grouped.values()) {
    for (const report of reports) {
      // Walk back from the month that just closed for as long as it was missed.
      const missed: string[] = [];
      for (let back = 0; back < 12; back += 1) {
        const month = period(monthsBack(now, back + 1));
        if (sentPairs.has(`${manager.userId}:${report.userId}:${month}`)) break;
        missed.unshift(month);
      }
      if (missed.length < 2 || missed.at(-1) !== closed) continue;

      const hr = await users()
        .find({ org: manager.org, dashboardAccess: true })
        .toArray();
      if (!hr.length) continue;
      const monthList = missed.map(monthLabel).join(', ');
      await notifyUsers(hr.map((user) => user.userId), {
        scenario: 'consecutive_missed_feedback', title: 'Missed feedback flag',
        body: `${manager.name} has missed feedback for ${report.name} ${missed.length} months in a row`,
        data: { destination: 'grow_feedback', employeeUserId: report.userId, managerUserId: manager.userId },
        email: {
          subject: `Flag: ${report.name} - ${missed.length} consecutive months of missed feedback`,
          body: `Hi {firstName},\n\n${manager.name} has now missed feedback for ${report.name} `
            + `${missed.length} months in a row (${monthList}).\n\nReview on the dashboard:\n`
            + `${link()}\n\n- Sowaka Connect`,
        },
      });
    }
  }
}

/** #23 — 6:00 PM: who was present, on leave, and unaccounted for today. */
export async function sendDailyAttendanceSummary(now = new Date()): Promise<void> {
  const workDate = now.toISOString().slice(0, 10);
  for (const { manager, reports } of (await managersWithReports()).values()) {
    const reportIds = reports.map((report) => report.userId);
    const employeeIds = reports.map((report) => report.employeeId).filter(Boolean) as string[];
    const [records, onLeave] = await Promise.all([
      attendanceRecords().find({
        workDate,
        $or: [
          { userId: { $in: reportIds } },
          ...(employeeIds.length ? [{ employeeId: { $in: employeeIds } }] : []),
        ],
      }).toArray(),
      leaves().find({
        userId: { $in: reportIds },
        status: 'approved',
        startDate: { $lte: endOfDay(now) },
        endDate: { $gte: startOfDay(now) },
      }).toArray(),
    ]);

    const present = new Set(records
      .filter((record) => record.punchIn)
      .map((record) => record.userId
        ?? reports.find((report) => report.employeeId === record.employeeId)?.userId)
      .filter(Boolean) as string[]);
    const leaveIds = new Set(onLeave.map((leave) => leave.userId));
    const leaveNames = reports.filter((report) => leaveIds.has(report.userId)).map((report) => report.name);
    const absentNames = reports
      .filter((report) => !present.has(report.userId) && !leaveIds.has(report.userId))
      .map((report) => report.name);

    await notifyUsers([manager.userId], {
      scenario: 'attendance_summary', title: 'Team attendance',
      body: `Team attendance today: ${present.size}/${reports.length} present`,
      data: { destination: 'manage_attendance', workDate },
      email: {
        subject: `Team attendance today: ${present.size}/${reports.length}`,
        body: `Hi {firstName},\n\nYour team's attendance for ${workDate}:\n`
          + `Present: ${present.size}/${reports.length}\n`
          + `On leave: ${leaveNames.length ? leaveNames.join(', ') : 'none'}\n`
          + `Absent (unplanned): ${absentNames.length ? absentNames.join(', ') : 'none'}\n\n`
          + `Full view:\n${link()}\n\n- Sowaka Connect`,
      },
    });
  }
}

/** #24 — Monday 9:00 AM: pointer to last week's report. */
export async function sendWeeklyAttendanceReport(now = new Date()): Promise<void> {
  const weekStart = addDays(startOfDay(now), -7).toISOString().slice(0, 10);
  for (const { manager } of (await managersWithReports()).values()) {
    await notifyUsers([manager.userId], {
      scenario: 'weekly_attendance_report', title: 'Attendance report',
      body: `Your team's attendance report for last week is ready`,
      data: { destination: 'manage_attendance', weekStart },
      email: {
        subject: `Your team's attendance report - week of ${weekStart}`,
        body: `Hi {firstName},\n\nYour team's attendance report for last week is ready: `
          + `attendance rate, late arrivals, and leaves taken.\n\nView the report:\n`
          + `${link()}\n\n- Sowaka Connect`,
      },
    });
  }
}

/** #25 — Friday 4:00 PM: who is on approved leave next week. */
export async function sendLeavePlanningReport(now = new Date()): Promise<void> {
  const from = startOfDay(addDays(now, 3));
  const to = endOfDay(addDays(now, 9));
  for (const { manager, reports } of (await managersWithReports()).values()) {
    const reportIds = reports.map((report) => report.userId);
    const upcoming = await leaves().find({
      userId: { $in: reportIds },
      status: 'approved',
      startDate: { $lte: to },
      endDate: { $gte: from },
    }).toArray();
    if (!upcoming.length) continue;

    const byName = new Map(reports.map((report) => [report.userId, report.name]));
    const lines = upcoming.map((leave) => {
      const start = leave.startDate.toISOString().slice(0, 10);
      const end = leave.endDate.toISOString().slice(0, 10);
      const range = start === end ? start : `${start} to ${end}`;
      return `- ${byName.get(leave.userId) ?? 'Teammate'}: ${range}`;
    });
    const people = new Set(upcoming.map((leave) => leave.userId)).size;

    await notifyUsers([manager.userId], {
      scenario: 'leave_planning', title: 'Leave next week',
      body: `${people} team member${people === 1 ? '' : 's'} on leave next week - plan ahead`,
      data: { destination: 'manage_leave' },
      email: {
        subject: `Next week: ${people} team member${people === 1 ? '' : 's'} on leave`,
        body: `Hi {firstName},\n\n${people} team member${people === 1 ? ' is' : 's are'} on approved `
          + `leave next week:\n${lines.join('\n')}\n\nPlan ahead:\n${link()}\n\n- Sowaka Connect`,
      },
    });
  }
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function previousMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
}

function monthsBack(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
}
