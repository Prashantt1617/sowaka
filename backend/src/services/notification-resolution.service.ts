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
import { attendanceOverrides, attendanceRecords, attendanceRegularizations, gameChallenges, getDb, leaves, overtimeRequests, users } from '../config/db';
import type { User } from '../models/user.model';
import { requestViewer } from '../middleware/request-viewer';
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

// ------------------------------------------------------------ ended games

/** A Scribble room lasts two hours; its invite is no use after that. */
const SCRIBBLE_ROOM_MS = 2 * 60 * 60_000;
/** A live game is over within an evening. */
const LIVE_GAME_MS = 6 * 60 * 60_000;

/**
 * The rows about a game or challenge that has ended, left out of the inbox
 * as it is read (nothing is deleted): an invite, an acceptance or a lobby
 * for a challenge that finished, expired or was declined; a Scribble invite
 * past its room's two hours; a Secret Squad lobby whose game was cancelled
 * or is over; a live game's start 6 hours on.
 * The result of a challenge stays: it is the record of how it went.
 */
export async function withoutEndedGames(rows: InboxRow[], now = new Date()): Promise<InboxRow[]> {
  const ended = new Set<string>();
  try {
    const challengeRows = rows.filter((row) =>
      ['game_challenge_received', 'game_challenge_accepted', 'game_challenge_lobby'].includes(row.scenario ?? '') && row.data?.challengeId);
    const squadRows = rows.filter((row) => row.scenario === 'secret_squad_lobby' && row.data?.sessionId);
    const liveRows = rows.filter((row) => row.scenario === 'live_game_started');
    const [challenges, sessions] = await Promise.all([
      challengeRows.length
        ? gameChallenges().find({ id: { $in: [...new Set(challengeRows.map((row) => row.data!.challengeId))] } }, { projection: { _id: 0, id: 1, status: 1 } }).toArray()
        : [],
      squadRows.length
        ? getDb().collection<{ id: string; status: string; startsAt: Date; rounds: { huntMs: number; breakMs: number }[] }>('secret_squad_sessions')
          .find({ id: { $in: [...new Set(squadRows.map((row) => row.data!.sessionId))] } }, { projection: { _id: 0, id: 1, status: 1, startsAt: 1, rounds: 1 } })
          .toArray()
        : [],
    ]);
    const live = new Map(challenges.map((c) => [c.id, c.status === 'pending' || c.status === 'accepted']));
    for (const row of challengeRows) if (!live.get(row.data!.challengeId)) ended.add(row.id);
    const gameOver = new Map(sessions.map((s) => {
      // The lobby, every round and break, and a few minutes of results.
      const ends = new Date(s.startsAt).getTime() + s.rounds.reduce((sum, r) => sum + (r.huntMs ?? 0) + (r.breakMs ?? 0), 0) + 15 * 60_000;
      return [s.id, s.status === 'cancelled' || ends < now.getTime()];
    }));
    for (const row of squadRows) if (gameOver.get(row.data!.sessionId) !== false) ended.add(row.id);
    // A row whose post is gone never reaches here (listNotifications drops it).
    for (const row of liveRows) {
      if (now.getTime() - new Date(row.createdAt).getTime() > LIVE_GAME_MS) ended.add(row.id);
    }
    for (const row of rows) {
      if (row.scenario === 'scribble_invite' && now.getTime() - new Date(row.createdAt).getTime() > SCRIBBLE_ROOM_MS) ended.add(row.id);
    }
  } catch (error) {
    // The inbox still opens, ended games and all.
    logger.error('Inbox ended-games filter failed', {}, error);
    return rows;
  }
  return rows.filter((row) => !ended.has(row.id));
}

async function punchReminders(userId: string, rows: AppNotification[], now: Date, resolved: Set<string>) {
  const today = istParts(now).dateKey;
  const reminders = rows.filter((row) => row.scenario === 'punch_in_reminder');
  if (!reminders.length) return;
  const days = [...new Set(reminders.map((row) => row.data?.dateKey).filter(Boolean))];
  // The signed-in person is already in hand on a request (no round trip); read otherwise.
  const user = requestViewer(userId) ?? await users().findOne({ userId }, { projection: { _id: 0, employeeId: 1 } });
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
  const approver = (requestViewer(userId) as User | undefined) ?? await users().findOne({ userId });
  if (!approver) return;
  const pending = await pendingFor(approver, now);
  if (pending.leave + pending.overtime + pending.attendance === 0) resolved.add(latest.id);
}

async function feedbackDue(userId: string, rows: AppNotification[], now: Date, resolved: Set<string>) {
  const due = rows.filter((row) => ['feedback_cycle_open', 'feedback_weekly', 'feedback_last_day'].includes(row.scenario));
  if (!due.length) return;
  const today = istParts(now).dateKey;
  const manager = (requestViewer(userId) as User | undefined) ?? await users().findOne({ userId });
  if (!manager) return;
  const open = due.filter((row) => !(row.scenario === 'feedback_last_day' && istParts(new Date(row.createdAt)).dateKey < today));
  for (const row of due) if (!open.includes(row)) resolved.add(row.id);
  // Each period's progress side by side, not one after another.
  const periods = [...new Set(open.map((row) => row.data?.period ?? '').filter(Boolean))];
  const done = new Map(await Promise.all(periods.map(async (period) =>
    [period, (await feedbackProgress(manager, period)).pending.length === 0] as const)));
  for (const row of open) if (done.get(row.data?.period ?? '')) resolved.add(row.id);
}
