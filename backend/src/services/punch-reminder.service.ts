import { attendanceOverrides, attendanceRecords, leaves, notifications, users } from '../config/db';
import { env } from '../config/env';
import { holidayDatesForUser } from './holiday.service';
import { notifyUsers } from './notification.service';
import { isWeekOffDay, policiesForUsers, todayIso } from './shift.service';
import { logger } from '../utils/logger';

/** How long after the shift starts someone with no punch is reminded. */
const REMIND_AFTER_MINUTES = 60;
/**
 * How long the reminder stays due. A server down at the hour still reminds
 * when it comes back inside this, but nobody is told to punch in at 5 pm.
 */
const DUE_FOR_MINUTES = 120;

const SCENARIO = 'punch_in_reminder';

const APP_PUNCH_FORMATS = new Set(['Geotag (powered by Sowaka)', 'In-app punch in']);

function minutesOf(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes past midnight now, on the offices' clock. */
function istMinutesNow(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return (part('hour') % 24) * 60 + part('minute');
}

/**
 * Reminds everyone who has not punched in an hour after their own shift
 * started: once a day, on a working day, only people who punch in the app, and
 * never someone on approved leave, on a holiday or week-off, or marked by HR. Runs every few minutes, since shifts start at different
 * times; each person's own shift decides when they are due.
 */
export async function sendLatePunchInReminders(
  now = new Date(),
  /** How each reminder goes out; a dry run passes its own. */
  deliver: typeof notifyUsers = notifyUsers,
): Promise<number> {
  const today = todayIso();
  const nowMinutes = istMinutesNow(now);
  // Orgs outside NOTIFY_ORGS would be dropped by notifyUsers anyway; leaving
  // them out here saves grading their whole roster every few minutes.
  const people = await users()
    .find(
      {
        lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
        isCounsellor: { $ne: true },
        org: env.notifyOrgs.length ? { $in: env.notifyOrgs } : { $exists: true },
      },
      { projection: { _id: 0, userId: 1, employeeId: 1, org: 1, state: 1, location: 1, branch: 1 } },
    )
    .toArray();
  if (people.length === 0) return 0;

  const policies = await policiesForUsers(people.map((person) => person.userId), today);
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const due = people.filter((person) => {
    const policy = policies.get(person.userId);
    if (!policy) return false;
    // Only people who punch in the app. Auto punch marks them present without
    // a punch; a biometric punch reaches us late through the SQL sync, and the
    // app could not take it anyway.
    if (!APP_PUNCH_FORMATS.has(policy.correction?.punchFormat ?? '')) return false;
    if (isWeekOffDay(todayDate, policy.weeklyOff)) return false;
    const start = minutesOf(policy.startTime ?? '');
    if (start === null) return false;
    const since = nowMinutes - (start + REMIND_AFTER_MINUTES);
    return since >= 0 && since < DUE_FOR_MINUTES;
  });
  if (due.length === 0) return 0;

  const ids = due.map((person) => person.userId);
  const employeeIds = due.map((person) => person.employeeId).filter((id): id is string => Boolean(id));
  const [punched, onLeave, marked, reminded] = await Promise.all([
    // Punches are keyed by userId from the app and by employeeId from SQL.
    attendanceRecords()
      .find(
        {
          workDate: today,
          $or: [{ userId: { $in: ids } }, ...(employeeIds.length ? [{ employeeId: { $in: employeeIds } }] : [])],
        },
        { projection: { _id: 0, userId: 1, employeeId: 1, punchIn: 1, dayType: 1 } },
      )
      .toArray(),
    leaves()
      .find(
        { userId: { $in: ids }, status: 'approved', startDate: { $lte: todayDate }, endDate: { $gte: todayDate } },
        { projection: { _id: 0, userId: 1 } },
      )
      .toArray(),
    attendanceOverrides().find({ userId: { $in: ids }, workDate: today }, { projection: { _id: 0, userId: 1 } }).toArray(),
    notifications()
      .find({ userId: { $in: ids }, scenario: SCENARIO, 'data.dateKey': today }, { projection: { _id: 0, userId: 1 } })
      .toArray(),
  ]);
  // A record with a punch-in, or a day already settled another way (work from
  // home, a client visit, a corrected day), needs no reminder.
  const accounted = punched.filter((record) => record.punchIn || record.dayType);
  const skip = new Set<string>([
    ...accounted.map((record) => record.userId).filter((id): id is string => Boolean(id)),
    ...onLeave.map((row) => row.userId),
    ...marked.map((row) => row.userId),
    ...reminded.map((row) => row.userId),
  ]);
  const punchedEmployeeIds = new Set(accounted.map((record) => record.employeeId).filter(Boolean));

  let sent = 0;
  for (const person of due) {
    if (skip.has(person.userId)) continue;
    if (person.employeeId && punchedEmployeeIds.has(person.employeeId)) continue;
    // Holidays are per work location, so read for the few still due.
    const holidays = await holidayDatesForUser(person, { from: todayDate, to: todayDate });
    if (holidays.has(today)) continue;
    const policy = policies.get(person.userId);
    await deliver([person.userId], {
      scenario: SCENARIO,
      title: 'You haven’t punched in yet',
      body: `Your shift started at ${policy?.startTime}. Punch in when you’re at work, or apply for leave if you’re off today.`,
      // No `destination`: every app version, the released one included, takes
      // a request-style notification without one to the Actions tab, where
      // the punch is.
      data: { type: 'punch_in', view: 'mine', dateKey: today },
    });
    sent += 1;
  }
  if (sent > 0) logger.info('Punch-in reminders sent', { sent, today });
  return sent;
}
