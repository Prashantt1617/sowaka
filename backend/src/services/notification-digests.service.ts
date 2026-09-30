import { attendanceRecords, leaves, users } from '../config/db';
import { env } from '../config/env';
import { User } from '../models/user.model';
import { notifyUsers } from './notification.service';

/**
 * Scheduled notification digests: the feedback-cycle reminders and the
 * attendance/leave reports from the notification spec.
 *
 * These reach the bell icon and the device, and deliberately send no email.
 * Scheduled mail is the kind that piles up unread in an inbox nobody asked to
 * fill; a notification the person sees when they next open the app carries the
 * same information without that cost. Mail is kept for the things that happen
 * *to* someone — a leave decided, a review shared.
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

/**
 * #24 — Monday 9:00 AM: last week's attendance, summarised.
 *
 * The figures are in the notification itself. A line saying a report "is ready"
 * asks the manager to go and look before they know whether anything happened.
 */
export async function sendWeeklyAttendanceReport(now = new Date()): Promise<void> {
  const weekStartDate = addDays(startOfDay(now), -7);
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEnd = addDays(weekStartDate, 6);
  for (const { manager, reports } of (await managersWithReports()).values()) {
    const employeeIds = reports.map((report) => report.employeeId).filter(Boolean) as string[];
    if (!employeeIds.length) continue;
    const records = await attendanceRecords()
      .find({
        employeeId: { $in: employeeIds },
        workDate: { $gte: weekStart, $lte: weekEnd.toISOString().slice(0, 10) },
      })
      .toArray();
    const present = records.filter((record) => record.punchIn).length;
    const onLeave = await leaves().countDocuments({
      userId: { $in: reports.map((report) => report.userId) },
      status: 'approved',
      startDate: { $lte: weekEnd },
      endDate: { $gte: weekStartDate },
    });
    await notifyUsers([manager.userId], {
      scenario: 'weekly_attendance_report', title: 'Last week at a glance',
      body: `${present} day${present === 1 ? '' : 's'} attended across ${reports.length} `
        + `team member${reports.length === 1 ? '' : 's'}`
        + (onLeave ? `, ${onLeave} leave${onLeave === 1 ? '' : 's'} taken.` : '.'),
      data: { destination: 'manage_attendance', weekStart },
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
      // Who and when, in the notification. "Plan ahead" with a link to go and
      // find out who was a instruction, not information.
      body: `${people} on leave next week — ${lines.map((line) => line.slice(2)).join('; ')}`,
      data: { destination: 'manage_leave' },
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



function monthsBack(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
}
