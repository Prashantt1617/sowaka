/**
 * Every message a leave, overtime or attendance-correction request produces.
 *
 * One request produces at most two messages: one to the person who raised it,
 * one to whoever has to act on it. Each is composed here as a pure function and
 * handed to `notifyUsers`, which stores it for the in-app bell, pushes it, and
 * mails it — all behind the same org allowlists.
 *
 * Sending never throws into the request that triggered it: an employee's leave
 * is submitted whether or not their manager's phone is reachable.
 */
import { users } from '../config/db';
import { User } from '../models/user.model';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { notifyUsers } from './notification.service';

/** "10 September 2026". */
function longDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(date);
}

/** One date, or a range — the `{{date/dates}}` of the templates. */
export function dateOrDates(start: Date | string, end?: Date | string): string {
  const from = longDate(start);
  if (!end) return from;
  const to = longDate(end);
  return from === to ? from : `${from} – ${to}`;
}

/** "9:05 AM". */
export function clockTime(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  }).format(value);
}

/** "8h 45m" from a count of minutes. */
export function hoursWorked(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`;
}

const LEAVE_LABEL: Record<string, string> = {
  sick: 'Sick Leave',
  casual: 'Casual Leave',
  earned: 'Earned Leave',
  comp_off: 'Comp-off',
};
export const leaveLabel = (type: string) => LEAVE_LABEL[type] ?? type;

const link = (label: string) => `${label}:\n${env.appWebUrl}`;
const firstName = (name?: string) => (name ?? '').trim().split(/\s+/)[0] || 'there';

/** A number of days as the templates write it: "1 day", "2.5 days". */
export const dayCount = (days: number) => `${days} ${days === 1 ? 'day' : 'days'}`;

async function deliver(userIds: string[], input: Parameters<typeof notifyUsers>[1]) {
  try {
    await notifyUsers(userIds, input);
  } catch (error) {
    // Never fail the request that triggered this.
    logger.error('Request notification failed', { scenario: input.scenario }, error);
  }
}

type Party = Pick<User, 'userId' | 'name'>;

async function partiesFor(employeeUserId: string): Promise<{ employee: User | null; approver: User | null }> {
  const employee = await users().findOne({ userId: employeeUserId });
  const approver = employee?.managerUserId
    ? await users().findOne({ userId: employee.managerUserId })
    : null;
  return { employee, approver };
}

// ------------------------------------------------------------------- leave

export function leaveSubmittedEmployeeEmail(employee: Party, type: string, dates: string) {
  return {
    subject: `Leave request submitted for ${dates}`,
    body:
      `Hi ${firstName(employee.name)},\n\n`
      + `Your ${leaveLabel(type)} request for ${dates} has been submitted successfully and is awaiting approval.\n\n`
      + `Status: Pending\n`
      + `Leave: ${leaveLabel(type)}\n`
      + `Date: ${dates}\n\n`
      + `You'll be notified once your request is reviewed.`,
  };
}

export function leaveSubmittedApproverEmail(
  approver: Party, employee: Party, type: string, dates: string, days: number, reason: string,
) {
  return {
    subject: `Leave request from ${employee.name} — ${dates}`,
    body:
      `Hi ${firstName(approver.name)},\n\n`
      + `${employee.name} has submitted a ${leaveLabel(type)} request for ${dates}.\n\n`
      + `Duration: ${dayCount(days)}\n`
      + `Reason: ${reason || '—'}\n\n`
      + `Review the request on Sowaka.\n\n`
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
      + `View the request on Sowaka for details.\n\n`
      + link('View Request'),
  };
}

/** Employee gets a receipt; the approver gets something to act on. */
export async function notifyLeaveSubmitted(input: {
  employeeUserId: string; type: string; startDate: Date; endDate: Date; days: number; reason: string;
}) {
  const { employee, approver } = await partiesFor(input.employeeUserId);
  if (!employee) return;
  const dates = dateOrDates(input.startDate, input.endDate);

  await deliver([employee.userId], {
    scenario: 'leave_submitted',
    title: 'Leave request submitted',
    body: `Your ${leaveLabel(input.type)} for ${dates} is awaiting approval.`,
    data: { type: 'leave', view: 'mine' },
    email: leaveSubmittedEmployeeEmail(employee, input.type, dates),
  });

  if (approver) {
    await deliver([approver.userId], {
      scenario: 'leave_requested',
      title: `Leave request from ${employee.name}`,
      body: `${leaveLabel(input.type)} · ${dates}. Tap to review.`,
      data: { type: 'leave', view: 'inbox' },
      email: leaveSubmittedApproverEmail(approver, employee, input.type, dates, input.days, input.reason),
    });
  }
}

export async function notifyLeaveDecided(input: {
  employeeUserId: string; type: string; startDate: Date; endDate: Date;
  approved: boolean; comment: string;
}) {
  const employee = await users().findOne({ userId: input.employeeUserId });
  if (!employee) return;
  const dates = dateOrDates(input.startDate, input.endDate);
  await deliver([employee.userId], {
    scenario: 'leave_decided',
    title: input.approved ? 'Leave approved ✓' : 'Leave request declined',
    body: input.approved
      ? `Your ${leaveLabel(input.type)} for ${dates} has been approved.`
      : `Your ${leaveLabel(input.type)} for ${dates} wasn't approved. Tap to view details.`,
    data: { type: 'leave', view: 'mine' },
    email: input.approved
      ? leaveApprovedEmail(employee, input.type, dates)
      : leaveDeclinedEmail(employee, input.type, dates, input.comment),
  });
}

// ---------------------------------------------------------------- overtime

export function overtimeSubmittedEmployeeEmail(employee: Party, duration: string, date: string) {
  return {
    subject: `Overtime request submitted for ${date}`,
    body:
      `Hi ${firstName(employee.name)},\n\n`
      + `Your overtime request for ${date} has been submitted successfully and is awaiting approval.\n\n`
      + `Overtime: ${duration}\n`
      + `Date: ${date}\n`
      + `Status: Pending\n\n`
      + `You'll be notified once it is reviewed.`,
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
      + `Review the request on Sowaka.\n\n`
      + link('Review Request'),
  };
}

export function overtimeApprovedEmail(employee: Party, duration: string, date: string) {
  return {
    subject: 'Your overtime request has been approved',
    body:
      `Hi ${firstName(employee.name)},\n\n`
      + `Your overtime request for ${date} has been approved.\n\n`
      + `Approved overtime: ${duration}`,
  };
}

export function overtimeDeclinedEmail(employee: Party, date: string, comment: string) {
  return {
    subject: 'Update on your overtime request',
    body:
      `Hi ${firstName(employee.name)},\n\n`
      + `Your overtime request for ${date} was not approved.\n\n`
      + `Reason: ${comment || '—'}\n\n`
      + `View the request on Sowaka for details.\n\n`
      + link('View Request'),
  };
}

export async function notifyOvertimeSubmitted(input: {
  employeeUserId: string; workDate: Date; duration: string; reason: string;
}) {
  const { employee, approver } = await partiesFor(input.employeeUserId);
  if (!employee) return;
  const date = longDate(input.workDate);

  await deliver([employee.userId], {
    scenario: 'overtime_submitted',
    title: 'Overtime request submitted',
    body: `${input.duration} on ${date} is awaiting approval.`,
    data: { type: 'overtime', view: 'mine' },
    email: overtimeSubmittedEmployeeEmail(employee, input.duration, date),
  });

  if (approver) {
    await deliver([approver.userId], {
      scenario: 'overtime_requested',
      title: `Overtime request from ${employee.name}`,
      body: `${input.duration} on ${date}. Tap to review.`,
      data: { type: 'overtime', view: 'inbox' },
      email: overtimeSubmittedApproverEmail(approver, employee, input.duration, date, input.reason),
    });
  }
}

export async function notifyOvertimeDecided(input: {
  employeeUserId: string; workDate: Date; duration: string; approved: boolean; comment: string;
}) {
  const employee = await users().findOne({ userId: input.employeeUserId });
  if (!employee) return;
  const date = longDate(input.workDate);
  await deliver([employee.userId], {
    scenario: 'overtime_decided',
    title: input.approved ? 'Overtime approved ✓' : 'Overtime request declined',
    body: input.approved
      ? `Your ${input.duration} overtime for ${date} has been approved.`
      : `Your overtime request for ${date} wasn't approved.`,
    data: { type: 'overtime', view: 'mine' },
    email: input.approved
      ? overtimeApprovedEmail(employee, input.duration, date)
      : overtimeDeclinedEmail(employee, date, input.comment),
  });
}

// ------------------------------------------------- attendance correction

export function presentSubmittedEmployeeEmail(employee: Party, date: string) {
  return {
    subject: `Present request submitted for ${date}`,
    body:
      `Hi ${firstName(employee.name)},\n\n`
      + `Your request to be marked Present for ${date} has been submitted and is awaiting approval.\n\n`
      + `Status: Pending\n\n`
      + `You'll be notified once it is reviewed.`,
  };
}

export function presentSubmittedApproverEmail(
  approver: Party, employee: Party, date: string, reason: string,
) {
  return {
    subject: `Present request from ${employee.name} — ${date}`,
    body:
      `Hi ${firstName(approver.name)},\n\n`
      + `${employee.name} has requested to be marked Present for ${date}.\n\n`
      + `Reason: ${reason || '—'}\n\n`
      + `Review the request on Sowaka.\n\n`
      + link('Review Request'),
  };
}

export function presentApprovedEmail(employee: Party, date: string) {
  return {
    subject: `You've been marked Present for ${date}`,
    body:
      `Hi ${firstName(employee.name)},\n\n`
      + `Your attendance correction request has been approved.\n\n`
      + `Your attendance for ${date} is now marked Present.`,
  };
}

export function presentDeclinedEmail(employee: Party, date: string, comment: string) {
  return {
    subject: 'Update on your Present request',
    body:
      `Hi ${firstName(employee.name)},\n\n`
      + `Your request to be marked Present for ${date} was not approved.\n\n`
      + `Reason: ${comment || '—'}\n\n`
      + `View your attendance on Sowaka for details.\n\n`
      + link('View Attendance'),
  };
}

export async function notifyCorrectionSubmitted(input: {
  employeeUserId: string; workDate: string; reason: string;
}) {
  const { employee, approver } = await partiesFor(input.employeeUserId);
  if (!employee) return;
  const date = longDate(input.workDate);

  await deliver([employee.userId], {
    scenario: 'correction_submitted',
    title: 'Present request submitted',
    body: `Your request to be marked Present for ${date} is awaiting approval.`,
    data: { type: 'attendance', view: 'mine' },
    email: presentSubmittedEmployeeEmail(employee, date),
  });

  if (approver) {
    await deliver([approver.userId], {
      scenario: 'correction_requested',
      title: `Present request from ${employee.name}`,
      body: `${employee.name} has requested to be marked Present for ${date}. Tap to review.`,
      data: { type: 'attendance', view: 'inbox' },
      email: presentSubmittedApproverEmail(approver, employee, date, input.reason),
    });
  }
}

export async function notifyCorrectionDecided(input: {
  employeeUserId: string; workDate: string; approved: boolean; comment: string;
}) {
  const employee = await users().findOne({ userId: input.employeeUserId });
  if (!employee) return;
  const date = longDate(input.workDate);
  await deliver([employee.userId], {
    scenario: 'correction_decided',
    title: input.approved ? 'Marked Present ✓' : 'Present request declined',
    body: input.approved
      ? `Your attendance for ${date} has been marked Present.`
      : `Your request to be marked Present for ${date} wasn't approved.`,
    data: { type: 'attendance', view: 'mine' },
    email: input.approved
      ? presentApprovedEmail(employee, date)
      : presentDeclinedEmail(employee, date, input.comment),
  });
}

// -------------------------------------------------------------- punching
// Push only: a punch is a moment, not something worth an email.

export async function notifyPunchedIn(employeeUserId: string, at: Date) {
  await deliver([employeeUserId], {
    scenario: 'punch_in',
    title: "You're in 👋",
    body: `Punched in at ${clockTime(at)}.`,
    data: { type: 'attendance', view: 'mine' },
  });
}

/**
 * On punch-out the day is graded, so the message says what the day became —
 * a half day is worth telling someone about while they can still correct it.
 */
export async function notifyPunchedOut(
  employeeUserId: string,
  at: Date,
  workedMinutes: number,
  band: 'full' | 'half' | 'short',
) {
  const worked = hoursWorked(workedMinutes);
  await deliver([employeeUserId], band === 'full'
    ? {
      scenario: 'punch_out',
      title: "You're done for the day ✓",
      body: `Punched out at ${clockTime(at)} · ${worked} today.`,
      data: { type: 'attendance', view: 'mine' },
    }
    : {
      scenario: 'punch_out_half_day',
      title: band === 'half' ? 'Today is marked Half Day' : 'Today is short of a half day',
      body: `You logged ${worked} today. Tap to review your attendance.`,
      data: { type: 'attendance', view: 'mine' },
    });
}
