/**
 * Every message a leave, overtime or attendance request produces, as the
 * notification spec (Sowaka_notifications_final.xlsx, "Requests") has them.
 *
 *   Employee  submitted          -> inbox only: no push, no email (rows 64–67)
 *   Employee  approved/declined  -> push + inbox + email, naming who decided (rows 1–8)
 *   Approver  new request        -> push + inbox + email, opening that request (rows 9–12)
 *   Approver  pending reminder   -> Tue & Thu 14:00 IST (row 13), see `sendPendingRequestReminders`
 *   Manager   leave next week    -> Fridays (row 14), see `sendLeaveNextWeek`
 *
 * The approver is the employee's reporting manager; HR instead when there is
 * no manager, or when the employee's policy makes HR the approver. Nothing is
 * escalated to HR when a manager doesn't act.
 *
 * Sending never throws into the request that triggered it: an employee's leave
 * is submitted whether or not their manager's phone is reachable.
 */
import { attendanceRegularizations, leaves, overtimeRequests, users } from '../config/db';
import { User } from '../models/user.model';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { notifications } from '../config/db';
import { notifyUsers } from './notification.service';
import { claimOnce } from './scribble-store';
import { emitRequestsChanged } from './connect-realtime.service';
import { leaveTypeLabel } from '../models/shift.model';
import { approvalRulesFor, managerMayDecide } from './shift.service';
import { dateRange, dayLabel, days, istParts, shortDate, tueThuDueFor } from './notification-time';

/** "10 September 2026", for email copy. */
function longDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(date);
}

/** One date, or a range, for email copy. */
export function dateOrDates(start: Date | string, end?: Date | string): string {
  const from = longDate(start);
  if (!end) return from;
  const to = longDate(end);
  return from === to ? from : `${from} – ${to}`;
}

/** "8h 45m" from a count of minutes. */
export function hoursWorked(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`;
}

export const leaveLabel = (type: string) => leaveTypeLabel(type);

const link = (label: string) => `${label}:\n${env.appWebUrl}`;
const firstName = (name?: string) => (name ?? '').trim().split(/\s+/)[0] || 'there';
/** The decider's reason, quoted, or nothing. */
const quoted = (who: string, reason: string) => (reason.trim() ? `${who}: "${reason.trim()}"` : '');

async function deliver(userIds: string[], input: Parameters<typeof notifyUsers>[1]) {
  // The open app hears about it the same instant, push permission or not.
  emitRequestsChanged(userIds, input.scenario);
  try {
    await notifyUsers(userIds, input);
  } catch (error) {
    // Never fail the request that triggered this.
    logger.error('Request notification failed', { scenario: input.scenario }, error);
  }
}

type Party = Pick<User, 'userId' | 'name'>;
type RequestKind = 'leave' | 'overtime' | 'correction';

/** HR for an org: everyone with dashboard access who is still here. */
async function hrOf(org: string | undefined, except: string): Promise<User[]> {
  if (!org) return [];
  return users()
    .find({ org, dashboardAccess: true, lifecycleStatus: { $nin: ['offboarded', 'terminated'] }, userId: { $ne: except } })
    .toArray();
}

/** Who acts on this employee's request: their manager, or HR when there is none or the policy names HR. */
export async function approversFor(employee: User, kind: RequestKind): Promise<User[]> {
  const manager = employee.managerUserId ? await users().findOne({ userId: employee.managerUserId }) : null;
  let managerDecides = Boolean(manager);
  if (manager && kind !== 'overtime') {
    try {
      managerDecides = managerMayDecide((await approvalRulesFor(employee.userId, kind)).approver);
    } catch (error) {
      logger.error('Approval rules lookup failed', { userId: employee.userId, kind }, error);
    }
  }
  return managerDecides && manager ? [manager] : hrOf(employee.org, employee.userId);
}

/** Who a decision came from, for the inbox's label: their manager, or HR. */
const decidedBy = (employee: User, deciderUserId: string | undefined): 'manager' | 'hr' =>
  !deciderUserId || deciderUserId === employee.managerUserId ? 'manager' : 'hr';

async function nameOf(userId: string | undefined): Promise<string> {
  if (!userId) return 'Your manager';
  return (await users().findOne({ userId }, { projection: { name: 1 } }))?.name || 'Your manager';
}

// ------------------------------------------------------------------- emails

export function leaveSubmittedApproverEmail(
  approver: Party, employee: Party, type: string, dates: string, count: number, reason: string,
) {
  return {
    subject: `Leave request from ${employee.name} — ${dates}`,
    body:
      `Hi ${firstName(approver.name)},\n\n`
      + `${employee.name} has submitted a ${leaveLabel(type)} request for ${dates}.\n\n`
      + `Duration: ${days(count)}\n`
      + `Reason: ${reason || '—'}\n\n`
      + `Review the request in the app.\n\n`
      + link('Review Request'),
  };
}

export function leaveApprovedEmail(employee: Party, type: string, dates: string) {
  return {
    subject: 'Your leave request has been approved',
    body:
      `Hi ${firstName(employee.name)},\n\n`
      + `Your ${leaveLabel(type)} request for ${dates} has been approved.\n\n`
      + `Status: Approved\n`
      + `Leave: ${leaveLabel(type)}\n`
      + `Date: ${dates}`,
  };
}

export function leaveDeclinedEmail(employee: Party, type: string, dates: string, comment: string) {
  return {
    subject: 'Update on your leave request',
    body:
      `Hi ${firstName(employee.name)},\n\n`
      + `Your ${leaveLabel(type)} request for ${dates} was not approved.\n\n`
      + `Status: Declined\n`
      + `Reason: ${comment || '—'}\n\n`
      + `View the request in the app for details.\n\n`
      + link('View Request'),
  };
}

export function overtimeSubmittedApproverEmail(
  approver: Party, employee: Party, duration: string, date: string, reason: string,
) {
  return {
    subject: `Overtime request from ${employee.name} — ${date}`,
    body:
      `Hi ${firstName(approver.name)},\n\n`
      + `${employee.name} has submitted an overtime request.\n\n`
      + `Date: ${date}\n`
      + `Duration: ${duration}\n`
      + `Reason: ${reason || '—'}\n\n`
      + `Review the request in the app.\n\n`
      + link('Review Request'),
  };
}

export function overtimeApprovedEmail(employee: Party, duration: string, date: string) {
  return {
    subject: 'Your overtime request has been approved',
    body: `Hi ${firstName(employee.name)},\n\nYour overtime request for ${date} has been approved.\n\nApproved overtime: ${duration}`,
  };
}

export function overtimeDeclinedEmail(employee: Party, date: string, comment: string) {
  return {
    subject: 'Update on your overtime request',
    body:
      `Hi ${firstName(employee.name)},\n\n`
      + `Your overtime request for ${date} was not approved.\n\n`
      + `Reason: ${comment || '—'}\n\n`
      + `View the request in the app for details.\n\n`
      + link('View Request'),
  };
}

export function presentSubmittedApproverEmail(approver: Party, employee: Party, date: string, reason: string) {
  return {
    subject: `Present request from ${employee.name} — ${date}`,
    body:
      `Hi ${firstName(approver.name)},\n\n`
      + `${employee.name} has requested to be marked Present for ${date}.\n\n`
      + `Reason: ${reason || '—'}\n\n`
      + `Review the request in the app.\n\n`
      + link('Review Request'),
  };
}

export function presentApprovedEmail(employee: Party, date: string) {
  return {
    subject: `You've been marked Present for ${date}`,
    body: `Hi ${firstName(employee.name)},\n\nYour attendance correction request has been approved.\n\nYour attendance for ${date} is now marked Present.`,
  };
}

export function presentDeclinedEmail(employee: Party, date: string, comment: string) {
  return {
    subject: 'Update on your Present request',
    body:
      `Hi ${firstName(employee.name)},\n\n`
      + `Your request to be marked Present for ${date} was not approved.\n\n`
      + `Reason: ${comment || '—'}\n\n`
      + `View your attendance in the app for details.\n\n`
      + link('View Attendance'),
  };
}

// ------------------------------------------------------------------- leave

/** Row 64 for the employee (inbox only), row 9 for whoever approves. */
export async function notifyLeaveSubmitted(input: {
  employeeUserId: string; requestId?: string; type: string; startDate: Date; endDate: Date; days: number; reason: string;
}) {
  const employee = await users().findOne({ userId: input.employeeUserId });
  if (!employee) return;
  const range = dateRange(input.startDate, input.endDate);
  const requestId = input.requestId ?? '';

  await deliver([employee.userId], {
    scenario: 'leave_submitted',
    title: 'Leave request sent',
    body: `${leaveLabel(input.type)}, ${range} (${days(input.days)}) is waiting for approval`,
    data: { type: 'leave', view: 'mine', requestId },
    push: false,
  });

  const approvers = await approversFor(employee, 'leave');
  const longDates = dateOrDates(input.startDate, input.endDate);
  for (const approver of approvers) {
    await deliver([approver.userId], {
      scenario: 'leave_requested',
      title: `${employee.name} · ${leaveLabel(input.type)}`,
      body: `${range} (${days(input.days)})`,
      data: { type: 'leave', view: 'inbox', requestId },
      email: leaveSubmittedApproverEmail(approver, employee, input.type, longDates, input.days, input.reason),
    });
  }
}

/** Rows 1 and 2. */
export async function notifyLeaveDecided(input: {
  employeeUserId: string; requestId?: string; type: string; startDate: Date; endDate: Date; days?: number;
  approved: boolean; comment: string; decidedByUserId?: string;
}) {
  const employee = await users().findOne({ userId: input.employeeUserId });
  if (!employee) return;
  const approver = await nameOf(input.decidedByUserId);
  const range = dateRange(input.startDate, input.endDate);
  const longDates = dateOrDates(input.startDate, input.endDate);
  const count = input.days ?? 0;
  await deliver([employee.userId], {
    scenario: 'leave_decided',
    title: input.approved ? 'Leave approved ✓' : 'Leave not approved',
    body: input.approved
      ? `${approver} approved your ${leaveLabel(input.type)}, ${range}${count ? ` (${days(count)})` : ''}`
      : quoted(approver, input.comment) || `${approver} didn't approve your ${leaveLabel(input.type)}, ${range}`,
    data: { type: 'leave', view: 'mine', requestId: input.requestId ?? '', from: decidedBy(employee, input.decidedByUserId) },
    email: input.approved
      ? leaveApprovedEmail(employee, input.type, longDates)
      : leaveDeclinedEmail(employee, input.type, longDates, input.comment),
  });
}

// ---------------------------------------------------------------- overtime

/** Row 65 for the employee (inbox only), row 10 for whoever approves. `duration` is "Full day" or "Half day". */
export async function notifyOvertimeSubmitted(input: {
  employeeUserId: string; requestId?: string; workDate: Date; duration: string; reason: string;
}) {
  const employee = await users().findOne({ userId: input.employeeUserId });
  if (!employee) return;
  const date = shortDate(input.workDate);
  const requestId = input.requestId ?? '';

  await deliver([employee.userId], {
    scenario: 'overtime_submitted',
    title: 'Overtime request sent',
    body: `${input.duration} on ${date} is waiting for approval`,
    data: { type: 'overtime', view: 'mine', requestId },
    push: false,
  });

  for (const approver of await approversFor(employee, 'overtime')) {
    await deliver([approver.userId], {
      scenario: 'overtime_requested',
      title: `${employee.name} · Overtime`,
      body: `${input.duration} on ${date}`,
      data: { type: 'overtime', view: 'inbox', requestId },
      email: overtimeSubmittedApproverEmail(approver, employee, input.duration, longDate(input.workDate), input.reason),
    });
  }
}

/** Rows 3 and 4. */
export async function notifyOvertimeDecided(input: {
  employeeUserId: string; requestId?: string; workDate: Date; duration: string; approved: boolean; comment: string;
  decidedByUserId?: string;
}) {
  const employee = await users().findOne({ userId: input.employeeUserId });
  if (!employee) return;
  const approver = await nameOf(input.decidedByUserId);
  const date = shortDate(input.workDate);
  await deliver([employee.userId], {
    scenario: 'overtime_decided',
    title: input.approved ? 'Overtime approved ✓' : 'Overtime not approved',
    body: input.approved
      ? `${approver} approved your ${input.duration.toLowerCase().replace(' ', '-')} overtime on ${date}`
      : quoted(approver, input.comment) || `${approver} didn't approve your overtime on ${date}`,
    data: { type: 'overtime', view: 'mine', requestId: input.requestId ?? '', from: decidedBy(employee, input.decidedByUserId) },
    email: input.approved
      ? overtimeApprovedEmail(employee, input.duration, longDate(input.workDate))
      : overtimeDeclinedEmail(employee, longDate(input.workDate), input.comment),
  });
}

// ------------------------------------------------- attendance correction

/** Row 66 for the employee (inbox only), row 11 for whoever approves. */
export async function notifyCorrectionSubmitted(input: {
  employeeUserId: string; requestId?: string; workDate: string; reason: string;
}) {
  const employee = await users().findOne({ userId: input.employeeUserId });
  if (!employee) return;
  const date = shortDate(input.workDate);
  const requestId = input.requestId ?? '';

  await deliver([employee.userId], {
    scenario: 'correction_submitted',
    title: 'Attendance correction sent',
    body: `Asked for ${date} to be marked Present`,
    data: { type: 'attendance', view: 'mine', requestId, workDate: input.workDate },
    push: false,
  });

  for (const approver of await approversFor(employee, 'correction')) {
    await deliver([approver.userId], {
      scenario: 'correction_requested',
      title: `${employee.name} · Attendance correction`,
      body: `Wants ${date} marked Present`,
      data: { type: 'attendance', view: 'inbox', requestId },
      email: presentSubmittedApproverEmail(approver, employee, longDate(input.workDate), input.reason),
    });
  }
}

/** Rows 5 and 6. */
export async function notifyCorrectionDecided(input: {
  employeeUserId: string; workDate: string; approved: boolean; comment: string; decidedByUserId?: string;
}) {
  const employee = await users().findOne({ userId: input.employeeUserId });
  if (!employee) return;
  const approver = await nameOf(input.decidedByUserId);
  const date = shortDate(input.workDate);
  const reason = quoted(approver, input.comment);
  await deliver([employee.userId], {
    scenario: 'correction_decided',
    title: input.approved ? 'Attendance fixed ✓' : 'Attendance not changed',
    body: input.approved ? `${date} is now marked Present` : `${date} stays Absent.${reason ? ` ${reason}` : ''}`,
    data: { type: 'attendance', view: 'mine', workDate: input.workDate, from: decidedBy(employee, input.decidedByUserId) },
    email: input.approved
      ? presentApprovedEmail(employee, longDate(input.workDate))
      : presentDeclinedEmail(employee, longDate(input.workDate), input.comment),
  });
}

// ---------------------------------------------------- out of location

/** Row 67 for the employee (inbox only), row 12 for whoever approves. */
export async function notifyOutOfLocationSubmitted(input: {
  employeeUserId: string; requestId?: string; workDate: string; reason: string; place: string;
}) {
  const employee = await users().findOne({ userId: input.employeeUserId });
  if (!employee) return;
  const date = shortDate(input.workDate);
  const requestId = input.requestId ?? '';

  await deliver([employee.userId], {
    scenario: 'correction_submitted',
    title: 'Out-of-office punch sent',
    body: `${input.place} on ${date}. The day is marked Present once it's approved.`,
    data: { type: 'attendance', view: 'mine', requestId, workDate: input.workDate },
    push: false,
  });

  for (const approver of await approversFor(employee, 'correction')) {
    await deliver([approver.userId], {
      scenario: 'correction_requested',
      title: `${employee.name} · Out-of-office punch`,
      body: `${input.place} on ${date}`,
      data: { type: 'attendance', view: 'inbox', requestId },
      email: {
        subject: `Out-of-office punch from ${employee.name} — ${longDate(input.workDate)}`,
        body:
          `Hi ${firstName(approver.name)},\n\n`
          + `${employee.name} punched in from outside the office on ${longDate(input.workDate)}.\n\n`
          + `Reason: ${input.reason}\nLocation: ${input.place}\n\n`
          + `Approve to mark the day present, or reject to leave it absent.\n\n`
          + link('Review Request'),
      },
    });
  }
}

/** Rows 7 and 8. */
export async function notifyOutOfLocationDecided(input: {
  employeeUserId: string; workDate: string; reason: string; approved: boolean; comment: string; decidedByUserId?: string;
}) {
  const employee = await users().findOne({ userId: input.employeeUserId });
  if (!employee) return;
  const approver = await nameOf(input.decidedByUserId);
  const date = shortDate(input.workDate);
  const reason = quoted(approver, input.comment);
  await deliver([employee.userId], {
    scenario: 'correction_decided',
    title: input.approved ? 'Punch approved ✓' : 'Punch not approved',
    body: input.approved ? `${date} is marked Present` : `${date} is marked Absent.${reason ? ` ${reason}` : ''}`,
    data: { type: 'attendance', view: 'mine', workDate: input.workDate, from: decidedBy(employee, input.decidedByUserId) },
    email: {
      subject: input.approved ? `Out-of-office punch approved for ${longDate(input.workDate)}` : `Out-of-office punch not approved for ${longDate(input.workDate)}`,
      body: input.approved
        ? `Hi ${firstName(employee.name)},\n\nYour out-of-office punch for ${longDate(input.workDate)} was approved. The day is marked Present.`
        : `Hi ${firstName(employee.name)},\n\nYour out-of-office punch for ${longDate(input.workDate)} was not approved, so the day is marked Absent.\n\n`
          + `Reason: ${input.comment || '—'}\n\nYou can raise an attendance correction for it in the app.\n\n`
          + link('View Attendance'),
    },
  });
}

// -------------------------------------------------------------- punching

/** Row 61: inbox only; the screen already says it at punch-in. */
export async function notifyPunchedIn(employeeUserId: string, at: Date) {
  const { hour, minute } = istParts(at);
  await deliver([employeeUserId], {
    scenario: 'punch_in',
    title: "You're in 👋",
    body: `Punched in at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    data: { type: 'attendance', view: 'mine' },
    push: false,
  });
}

/**
 * Row 62 for a full day (inbox only); row 15 when the day came up short,
 * pushed at punch-out while it can still be corrected.
 */
export async function notifyPunchedOut(
  employeeUserId: string,
  at: Date,
  workedMinutes: number,
  band: 'full' | 'half' | 'short',
) {
  const worked = hoursWorked(workedMinutes);
  const { hour, minute } = istParts(at);
  await deliver([employeeUserId], band === 'full'
    ? {
      scenario: 'punch_out',
      title: "You're done for the day ✓",
      body: `Punched out at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} · ${worked} today`,
      data: { type: 'attendance', view: 'mine' },
      push: false,
    }
    : {
      scenario: 'punch_out_half_day',
      title: band === 'half' ? 'Today counts as a half day' : 'Today is short of a half day',
      body: `You logged ${worked}. Raise a correction if this is wrong.`,
      data: { type: 'attendance', view: 'mine', workDate: istParts(at).dateKey },
    });
}

// ------------------------------------------------------------ schedules

/** Requests this person may act on: pending, not past-dated beyond use, not HR-only for a manager. */
export async function pendingFor(approver: User, now: Date): Promise<{ leave: number; overtime: number; attendance: number; oldest: Date | null }> {
  const todayKey = istParts(now).dateKey;
  const team = await users()
    .find({ org: approver.org, managerUserId: approver.userId, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } })
    .toArray();
  const hrNamed = new Map<string, { leave: boolean; correction: boolean }>();
  for (const member of team) {
    const named = async (kind: 'leave' | 'correction') => {
      try { return !managerMayDecide((await approvalRulesFor(member.userId, kind)).approver); } catch { return false; }
    };
    hrNamed.set(member.userId, { leave: await named('leave'), correction: await named('correction') });
  }
  const leaveFor = team.filter((m) => !hrNamed.get(m.userId)?.leave).map((m) => m.userId);
  const correctionFor = team.filter((m) => !hrNamed.get(m.userId)?.correction).map((m) => m.userId);

  // HR acts on the requests of people with no manager, and on those their policy sends to HR.
  const hrLeaveFor: string[] = [];
  const hrCorrectionFor: string[] = [];
  const hrOvertimeFor: string[] = [];
  if (approver.dashboardAccess && approver.org) {
    const roster = await users()
      .find({ org: approver.org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] }, userId: { $ne: approver.userId } })
      .toArray();
    for (const person of roster) {
      const noManager = !person.managerUserId;
      const viaPolicy = async (kind: 'leave' | 'correction') => {
        try { return !managerMayDecide((await approvalRulesFor(person.userId, kind)).approver); } catch { return false; }
      };
      if (noManager || await viaPolicy('leave')) hrLeaveFor.push(person.userId);
      if (noManager || await viaPolicy('correction')) hrCorrectionFor.push(person.userId);
      if (noManager) hrOvertimeFor.push(person.userId);
    }
  }
  const leaveIds = [...new Set([...leaveFor, ...hrLeaveFor])];
  const correctionIds = [...new Set([...correctionFor, ...hrCorrectionFor])];
  const overtimeIds = [...new Set([...team.map((m) => m.userId), ...hrOvertimeFor])];

  const [leaveRows, overtimeRows, correctionRows] = await Promise.all([
    leaveIds.length ? leaves().find({ userId: { $in: leaveIds }, status: 'pending' }).toArray() : [],
    overtimeIds.length ? overtimeRequests().find({ userId: { $in: overtimeIds }, status: 'pending' }).toArray() : [],
    correctionIds.length ? attendanceRegularizations().find({ userId: { $in: correctionIds }, status: 'pending' }).toArray() : [],
  ]);
  // A leave that ended before today can no longer be acted on in any useful way.
  const usefulLeave = leaveRows.filter((row) => row.endDate.toISOString().slice(0, 10) >= todayKey);
  const created = [
    ...usefulLeave.map((row) => new Date(row.createdAt ?? 0)),
    ...overtimeRows.map((row) => new Date(row.createdAt ?? 0)),
    ...correctionRows.map((row) => new Date(row.createdAt ?? 0)),
  ].filter((date) => !Number.isNaN(date.getTime()) && date.getTime() > 0);
  const oldest = created.length ? new Date(Math.min(...created.map((d) => d.getTime()))) : null;
  return { leave: usefulLeave.length, overtime: overtimeRows.length, attendance: correctionRows.length, oldest };
}

/**
 * Row 13 — Tuesday and Thursday at 14:00 IST (or the next working day after a
 * holiday at the approver's location): one push to everyone with requests
 * waiting on them. Replaces the old daily leave reminder (row 69).
 */
export async function sendPendingRequestReminders(now = new Date()): Promise<number> {
  const todayKey = istParts(now).dateKey;
  const approvers = new Map<string, User>();
  const pendingOwners = new Set<string>();
  for (const row of await leaves().find({ status: 'pending' }, { projection: { userId: 1 } }).toArray()) pendingOwners.add(row.userId);
  for (const row of await overtimeRequests().find({ status: 'pending' }, { projection: { userId: 1 } }).toArray()) pendingOwners.add(row.userId);
  for (const row of await attendanceRegularizations().find({ status: 'pending' }, { projection: { userId: 1 } }).toArray()) pendingOwners.add(row.userId);
  if (!pendingOwners.size) return 0;
  const owners = await users().find({ userId: { $in: [...pendingOwners] }, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } }).toArray();
  for (const owner of owners) {
    for (const kind of ['leave', 'correction'] as const) {
      for (const approver of await approversFor(owner, kind)) approvers.set(approver.userId, approver);
    }
  }
  let sent = 0;
  for (const approver of approvers.values()) {
    if (await notifications().findOne({ userId: approver.userId, scenario: 'pending_requests_reminder', 'data.dateKey': todayKey })) continue;
    if (!(await tueThuDueFor(approver, todayKey))) continue;
    const pending = await pendingFor(approver, now);
    const total = pending.leave + pending.overtime + pending.attendance;
    if (total === 0) continue;
    // Every server fires at 14:00 at once: only the one that claims it sends.
    if (!(await claimOnce(`notify:pending:${approver.userId}:${todayKey}`, 2 * 24 * 60 * 60_000))) continue;
    const parts = [
      pending.leave ? `${pending.leave} leave` : '',
      pending.overtime ? `${pending.overtime} overtime` : '',
      pending.attendance ? `${pending.attendance} attendance` : '',
      pending.oldest ? `oldest from ${dayLabel(pending.oldest)}` : '',
    ].filter(Boolean);
    await deliver([approver.userId], {
      scenario: 'pending_requests_reminder',
      title: `${total} ${total === 1 ? 'request' : 'requests'} waiting on you`,
      body: parts.join(' · '),
      data: { destination: 'requests_queue', type: 'leave', view: 'inbox', dateKey: todayKey },
    });
    sent += 1;
  }
  logger.info('Pending request reminders sent', { dateKey: todayKey, approvers: sent });
  return sent;
}

/** "Mon–Wed", "Fri", from the next-week days a leave covers. */
function weekdaySpan(start: Date, end: Date, weekStartKey: string): string {
  const weekEndKey = new Date(new Date(`${weekStartKey}T00:00:00.000Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
  const from = start.toISOString().slice(0, 10) < weekStartKey ? weekStartKey : start.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10) > weekEndKey ? weekEndKey : end.toISOString().slice(0, 10);
  const name = (key: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00.000Z`));
  return from === to ? name(from) : `${name(from)}–${name(to)}`;
}

/** Row 14 — Fridays: who in your team is on approved leave next week. */
export async function sendLeaveNextWeek(now = new Date()): Promise<number> {
  const { dateKey } = istParts(now);
  const today = new Date(`${dateKey}T00:00:00.000Z`);
  const toMonday = (8 - today.getUTCDay()) % 7 || 7;
  const monday = new Date(today.getTime() + toMonday * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000 + 86_399_999);
  const weekStartKey = monday.toISOString().slice(0, 10);
  const upcoming = await leaves().find({ status: 'approved', startDate: { $lte: sunday }, endDate: { $gte: monday } }).toArray();
  if (!upcoming.length) return 0;
  const people = await users()
    .find({ userId: { $in: [...new Set(upcoming.map((leave) => leave.userId))] }, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } })
    .toArray();
  const byManager = new Map<string, string[]>();
  for (const leave of upcoming.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())) {
    const person = people.find((p) => p.userId === leave.userId);
    if (!person?.managerUserId) continue;
    const line = `${person.name} (${weekdaySpan(leave.startDate, leave.endDate, weekStartKey)})`;
    byManager.set(person.managerUserId, [...(byManager.get(person.managerUserId) ?? []), line]);
  }
  let sent = 0;
  for (const [managerId, lines] of byManager) {
    if (await notifications().findOne({ userId: managerId, scenario: 'leave_planning', 'data.weekStart': weekStartKey })) continue;
    if (!(await claimOnce(`notify:leave-planning:${managerId}:${weekStartKey}`, 8 * 24 * 60 * 60_000))) continue;
    await deliver([managerId], {
      scenario: 'leave_planning',
      title: 'Leave next week',
      body: lines.join(', '),
      data: { destination: 'requests_queue', type: 'leave', view: 'inbox', weekStart: weekStartKey },
    });
    sent += 1;
  }
  return sent;
}
