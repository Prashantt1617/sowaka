/**
 * Which inbox rows have been overtaken by events, so the app can stop
 * colouring them (the Notifications design: alerts "clear themselves once
 * fixed", priority items "disappear once opened or done").
 *
 * Nothing is written: a row is only *annotated* `resolved: true` as the inbox
 * is read, from the state of whatever it was about at that moment. Opening a
 * row is handled by its `readAt`, as before; this covers the rows that are
 * done without being opened.
 *
 *   punch_in_reminder        the person has punched in (or the day is
 *                            settled another way), or the day has passed
 *   punch_out_half_day,      that day has since been corrected: an approved
 *   correction/punch         correction, or HR marked it from the calendar
 *   declined
 *   *_requested              that request is no longer pending
 *   pending_requests_reminder  a newer reminder supersedes it; the newest is
 *                            resolved once nothing waits on the approver
 *   feedback_cycle_open,     every report has had their feedback sent
 *   feedback_weekly
 *   feedback_last_day        the same, or the last day has passed
 */
import { ObjectId } from 'mongodb';
import { attendanceOverrides, attendanceRecords, attendanceRegularizations, leaves, overtimeRequests, users } from '../config/db';
import { AppNotification } from '../models/notification.model';
import { feedbackProgress } from './feedback-notifications.service';
import { istParts } from './notification-time';
import { pendingFor } from './request-notifications.service';
import { logger } from '../utils/logger';

export type InboxRow = AppNotification & { resolved?: true };

/** The decided rows that say the day still counts against the person. */
const DECLINED_DAY_TITLES = new Set(['Attendance not changed', 'Punch not approved']);

const objectIds = (ids: string[]) => ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

export async function resolveNotifications(userId: string, rows: AppNotification[], now = new Date()): Promise<InboxRow[]> {
  const resolved = new Set<string>();
  try {
    await Promise.all([
      punchReminders(userId, rows, now, resolved),
      fixedDays(userId, rows, resolved),
      decidedRequests(rows, resolved),
      pendingReminders(userId, rows, now, resolved),
      feedbackDue(userId, rows, now, resolved),
    ]);
  } catch (error) {
    // The inbox still opens; rows simply keep their colour.
    logger.error('Inbox resolution failed', { userId }, error);
  }
  return rows.map((row) => (resolved.has(row.id) ? { ...row, resolved: true as const } : row));
}

async function punchReminders(userId: string, rows: AppNotification[], now: Date, resolved: Set<string>) {
  const today = istParts(now).dateKey;
  const reminders = rows.filter((row) => row.scenario === 'punch_in_reminder');
  if (!reminders.length) return;
  const days = [...new Set(reminders.map((row) => row.data?.dateKey).filter(Boolean))];
  const user = await users().findOne({ userId }, { projection: { _id: 0, employeeId: 1 } });
  const records = days.length
    ? await attendanceRecords()
      .find(
        {
          workDate: { $in: days },
          $or: [{ userId }, ...(user?.employeeId ? [{ employeeId: user.employeeId }] : [])],
        },
        { projection: { _id: 0, workDate: 1, punchIn: 1, dayType: 1 } },
      )
      .toArray()
    : [];
  const settled = new Set(records.filter((record) => record.punchIn || record.dayType).map((record) => record.workDate));
  for (const row of reminders) {
    const day = row.data?.dateKey ?? '';
    if (!day || day < today || settled.has(day)) resolved.add(row.id);
  }
}

async function fixedDays(userId: string, rows: AppNotification[], resolved: Set<string>) {
  const alerts = rows.filter((row) => row.data?.workDate && (
    row.scenario === 'punch_out_half_day'
    || (row.scenario === 'correction_decided' && DECLINED_DAY_TITLES.has(row.title))
  ));
  if (!alerts.length) return;
  const days = [...new Set(alerts.map((row) => row.data.workDate))];
  const [approved, overrides] = await Promise.all([
    attendanceRegularizations()
      .find({ userId, workDate: { $in: days }, status: 'approved' }, { projection: { _id: 0, workDate: 1, decidedAt: 1 } })
      .toArray(),
    attendanceOverrides()
      .find({ userId, workDate: { $in: days } }, { projection: { _id: 0, workDate: 1, setAt: 1 } })
      .toArray(),
  ]);
  // Only a fix made after the alert counts: an approval it already knew of
  // (the day was declined after an earlier approval) changes nothing.
  const fixes = [
    ...approved.map((row) => ({ day: row.workDate, at: row.decidedAt })),
    ...overrides.map((row) => ({ day: row.workDate, at: row.setAt })),
  ];
  for (const row of alerts) {
    const created = new Date(row.createdAt).getTime();
    if (fixes.some((fix) => fix.day === row.data.workDate && fix.at && new Date(fix.at).getTime() > created)) {
      resolved.add(row.id);
    }
  }
}

async function decidedRequests(rows: AppNotification[], resolved: Set<string>) {
  const asks = rows.filter((row) => row.scenario.endsWith('_requested') && row.data?.requestId);
  if (!asks.length) return;
  const idsOf = (type: string) => objectIds(asks.filter((row) => row.data.type === type).map((row) => row.data.requestId));
  const pendingIds = async (ids: ObjectId[], find: (ids: ObjectId[]) => Promise<Array<{ _id?: ObjectId }>>) =>
    ids.length ? (await find(ids)).map((row) => String(row._id)) : [];
  const projection = { projection: { _id: 1 } };
  const stillPending = new Set([
    ...await pendingIds(idsOf('leave'), (ids) => leaves().find({ _id: { $in: ids }, status: 'pending' }, projection).toArray()),
    ...await pendingIds(idsOf('overtime'), (ids) => overtimeRequests().find({ _id: { $in: ids }, status: 'pending' }, projection).toArray()),
    ...await pendingIds(idsOf('attendance'), (ids) => attendanceRegularizations().find({ _id: { $in: ids }, status: 'pending' }, projection).toArray()),
  ]);
  for (const row of asks) {
    if (!stillPending.has(row.data.requestId)) resolved.add(row.id);
  }
}

async function pendingReminders(userId: string, rows: AppNotification[], now: Date, resolved: Set<string>) {
  // Newest first, as the inbox lists them.
  const [latest, ...older] = rows.filter((row) => row.scenario === 'pending_requests_reminder');
  if (!latest) return;
  for (const row of older) resolved.add(row.id);
  const approver = await users().findOne({ userId });
  if (!approver) return;
  const pending = await pendingFor(approver, now);
  if (pending.leave + pending.overtime + pending.attendance === 0) resolved.add(latest.id);
}

async function feedbackDue(userId: string, rows: AppNotification[], now: Date, resolved: Set<string>) {
  const due = rows.filter((row) => ['feedback_cycle_open', 'feedback_weekly', 'feedback_last_day'].includes(row.scenario));
  if (!due.length) return;
  const today = istParts(now).dateKey;
  const manager = await users().findOne({ userId });
  if (!manager) return;
  const done = new Map<string, boolean>();
  for (const row of due) {
    if (row.scenario === 'feedback_last_day' && istParts(new Date(row.createdAt)).dateKey < today) {
      resolved.add(row.id);
      continue;
    }
    const period = row.data?.period ?? '';
    if (!period) continue;
    if (!done.has(period)) done.set(period, (await feedbackProgress(manager, period)).pending.length === 0);
    if (done.get(period)) resolved.add(row.id);
  }
}
