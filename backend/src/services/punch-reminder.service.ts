import { MongoServerError, type Collection } from 'mongodb';
import { attendanceOverrides, attendanceRecords, getDb, leaves, notifications, users } from '../config/db';
import { env } from '../config/env';
import type { User } from '../models/user.model';
import { holidayDatesForUser } from './holiday.service';
import { notifiesOrg, notifyUsers } from './notification.service';
import { isWeekOffDay, policiesForUsers } from './shift.service';
import { logger } from '../utils/logger';

/** How long after the shift starts someone with no punch is reminded. */
const REMIND_AFTER_MINUTES = 60;
/**
 * How long the reminder stays due. A server down at the hour still reminds
 * when it comes back inside this, but nobody is told to punch in at 5 pm.
 */
const DUE_FOR_MINUTES = 120;
const DAY_MINUTES = 24 * 60;
/** A claim only matters on its own day; a few days' grace, then it goes. */
const CLAIM_KEEP_SECONDS = 3 * 24 * 60 * 60;

const SCENARIO = 'punch_in_reminder';

const APP_PUNCH_FORMATS = new Set(['Geotag (powered by Sowaka)', 'In-app punch in']);

type Person = Pick<User, 'userId' | 'employeeId' | 'org' | 'state' | 'location' | 'branch'>;

function minutesOf(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** The date, and the minutes past midnight, now on the offices' clock. */
function istClock(now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: (Number(part('hour')) % 24) * 60 + Number(part('minute')),
  };
}

function dayBefore(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- once a day

/**
 * One row per person per work day, taken just before their reminder goes
 * out. Production and anyone's local server share the database, and both can
 * read "not reminded yet" in the same minute; only one of them gets the row.
 */
interface ReminderClaim {
  _id: string;
  createdAt: Date;
}

function reminderClaims(): Collection<ReminderClaim> {
  return getDb().collection<ReminderClaim>('punch_reminder_claims');
}

let claimIndexes: Promise<unknown> | null = null;

/** Made on first use; a failure is retried next time. */
function ensureClaimIndexes(): Promise<unknown> {
  claimIndexes ??= reminderClaims()
    .createIndex({ createdAt: 1 }, { expireAfterSeconds: CLAIM_KEEP_SECONDS })
    .catch((error) => {
      claimIndexes = null;
      logger.warn('Punch reminder claim index could not be made', {}, error);
    });
  return claimIndexes;
}

/**
 * This person's reminder for this work day, or false when another process
 * has it already.
 *
 * Never taken for someone this process would not deliver to: `notifyUsers`
 * drops orgs outside NOTIFY_ORGS, and a claim a dev server took for them
 * would stop production reminding them at all.
 */
async function claimReminder(person: Person, workDate: string): Promise<boolean> {
  if (!notifiesOrg(person.org)) return false;
  await ensureClaimIndexes();
  try {
    await reminderClaims().insertOne({ _id: `${person.userId}|${workDate}`, createdAt: new Date() });
    return true;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) return false;
    throw error;
  }
}

/** A claim whose send failed goes back, so the next tick tries again. */
async function releaseReminder(person: Person, workDate: string): Promise<void> {
  await reminderClaims()
    .deleteOne({ _id: `${person.userId}|${workDate}` })
    .catch((error) => {
      logger.warn('Punch reminder claim could not be given back', { userId: person.userId, workDate }, error);
    });
}

// ---------------------------------------------------------------- the reminder

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
  const { date: today, minutes: nowMinutes } = istClock(now);
  // Orgs outside NOTIFY_ORGS would be dropped by notifyUsers anyway; leaving
  // them out here saves grading their whole roster every few minutes.
  const people = await users()
    .find({
      lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
      isCounsellor: { $ne: true },
      org: env.notifyOrgs.length ? { $in: env.notifyOrgs } : { $exists: true },
    })
    .project<Person>({ _id: 0, userId: 1, employeeId: 1, org: 1, state: 1, location: 1, branch: 1 })
    .toArray();
  if (people.length === 0) return 0;

  // Only a real send claims anyone. A dry run delivers nothing, and a claim
  // it took would stop the real reminder.
  const claims = deliver === notifyUsers;
  let sent = await remindFor(people, today, nowMinutes, deliver, claims);
  // A shift starting late in the evening is due after midnight, but it is
  // still the day it started on that counts: its policy, week-off, leave,
  // holiday, punch and HR mark. So the small hours look back at yesterday
  // too, counting minutes from yesterday's midnight. Past the window of a
  // shift starting at 23:59 nobody from yesterday can be due, so the rest of
  // the day skips it.
  if (nowMinutes < REMIND_AFTER_MINUTES + DUE_FOR_MINUTES) {
    sent += await remindFor(people, dayBefore(today), nowMinutes + DAY_MINUTES, deliver, claims);
  }
  if (sent > 0) logger.info('Punch-in reminders sent', { sent, today });
  return sent;
}

/**
 * Reminds whoever is due for one work day. `minutesIntoDay` is now counted
 * from that day's midnight, so it runs past a day's worth for yesterday.
 */
async function remindFor(
  people: Person[],
  workDate: string,
  minutesIntoDay: number,
  deliver: typeof notifyUsers,
  claims: boolean,
): Promise<number> {
  const policies = await policiesForUsers(people.map((person) => person.userId), workDate);
  const day = new Date(`${workDate}T00:00:00.000Z`);
  const due = people.filter((person) => {
    const policy = policies.get(person.userId);
    if (!policy) return false;
    // Only people who punch in the app. Auto punch marks them present without
    // a punch; a biometric punch reaches us late through the SQL sync, and the
    // app could not take it anyway.
    if (!APP_PUNCH_FORMATS.has(policy.correction?.punchFormat ?? '')) return false;
    if (isWeekOffDay(day, policy.weeklyOff)) return false;
    const start = minutesOf(policy.startTime ?? '');
    if (start === null) return false;
    const since = minutesIntoDay - (start + REMIND_AFTER_MINUTES);
    return since >= 0 && since < DUE_FOR_MINUTES;
  });
  if (due.length === 0) return 0;

  const ids = due.map((person) => person.userId);
  const employeeIds = due.map((person) => person.employeeId).filter((id): id is string => Boolean(id));
  const [punched, onLeave, marked] = await Promise.all([
    // Punches are keyed by userId from the app and by employeeId from SQL.
    attendanceRecords()
      .find(
        {
          workDate,
          $or: [{ userId: { $in: ids } }, ...(employeeIds.length ? [{ employeeId: { $in: employeeIds } }] : [])],
        },
        { projection: { _id: 0, userId: 1, employeeId: 1, punchIn: 1, dayType: 1 } },
      )
      .toArray(),
    leaves()
      .find(
        { userId: { $in: ids }, status: 'approved', startDate: { $lte: day }, endDate: { $gte: day } },
        { projection: { _id: 0, userId: 1 } },
      )
      .toArray(),
    attendanceOverrides().find({ userId: { $in: ids }, workDate }, { projection: { _id: 0, userId: 1 } }).toArray(),
  ]);
  // A record with a punch-in, or a day already settled another way (work from
  // home, a client visit, a corrected day), needs no reminder.
  const accounted = punched.filter((record) => record.punchIn || record.dayType);
  const skip = new Set<string>([
    ...accounted.map((record) => record.userId).filter((id): id is string => Boolean(id)),
    ...onLeave.map((row) => row.userId),
    ...marked.map((row) => row.userId),
  ]);
  const punchedEmployeeIds = new Set(accounted.map((record) => record.employeeId).filter(Boolean));
  const open = due.filter(
    (person) => !skip.has(person.userId) && !(person.employeeId && punchedEmployeeIds.has(person.employeeId)),
  );
  if (open.length === 0) return 0;

  // Who has had this day's reminder already. Bounded by the day's start, so
  // it reads that stretch of each person's notifications, not all of them.
  const reminded = new Set(
    (
      await notifications()
        .find(
          {
            userId: { $in: open.map((person) => person.userId) },
            createdAt: { $gte: new Date(`${workDate}T00:00:00+05:30`) },
            scenario: SCENARIO,
            'data.dateKey': workDate,
          },
          { projection: { _id: 0, userId: 1 } },
        )
        .toArray()
    ).map((row) => row.userId),
  );

  let sent = 0;
  for (const person of open) {
    if (reminded.has(person.userId)) continue;
    // Holidays are per work location, so read for the few still due.
    const holidays = await holidayDatesForUser(person, { from: day, to: day });
    if (holidays.has(workDate)) continue;
    // Taken last, just before the send, so nothing above can strand it.
    if (claims && !(await claimReminder(person, workDate))) continue;
    const policy = policies.get(person.userId);
    try {
      await deliver([person.userId], {
        scenario: SCENARIO,
        title: 'You haven’t punched in yet',
        body: `Your shift started at ${policy?.startTime}. Punch in when you’re at work, or apply for leave if you’re off today.`,
        // No `destination`: every app version, the released one included, takes
        // a request-style notification without one to the Actions tab, where
        // the punch is.
        data: { type: 'punch_in', view: 'mine', dateKey: workDate },
      });
    } catch (error) {
      if (claims) await releaseReminder(person, workDate);
      throw error;
    }
    sent += 1;
  }
  return sent;
}
