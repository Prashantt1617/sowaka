/**
 * Resigning in the app (R0–R2b), the manager's answer (R7) and HR accepting it (O1d).
 *
 * The employee gives a reason (required) and a note (optional); there is no
 * last-day picker: the last day by notice is the day sent plus the notice
 * period (the default offboarding template's, else the company's Exit
 * settings). The manager accepts, agrees another last day or releases early;
 * HR accepts with the last working day, which records the exit on the live
 * exits (kind resigned, notice from the day sent) and starts the offboarding
 * journey. The employee can withdraw until HR accepts. The reason and note are
 * seen by the manager and HR only.
 */
import { randomUUID } from 'node:crypto';
import { resignations, users } from '../../config/db';
import type { Resignation } from '../../models/lifecycle.model';
import {
  LifecycleError, addDays, appUser, beginOffboarding, dashboardActor, firstName, isDateKey, keyOfInstant, longDay, noticeDaysFor, requireHr, resignationView, shortDay, todayKey,
} from './offboarding';
import { completeTask } from './engine';
import { notifyUsers } from '../notification.service';
import { logger } from '../../utils/logger';

/** What the app offers as the reason (R1); any short reason is accepted. */
export const RESIGNATION_REASONS = ['Better opportunity', 'Growth', 'Pay', 'Manager', 'Work-life balance', 'Higher studies', 'Relocation', 'Personal', 'Other'];
const OPEN: Resignation['status'][] = ['with_manager', 'with_hr'];

async function tell(userIds: (string | undefined)[], scenario: string, title: string, body: string, data: Record<string, string>) {
  try { await notifyUsers(userIds.filter((x): x is string => !!x), { scenario, title, body, data: { type: 'lifecycle_resignation', ...data } }); }
  catch (error) { logger.warn('Resignation: a notification could not be sent', { scenario, reason: error instanceof Error ? error.message : String(error) }); }
}

const managerNameOf = async (id: string | undefined) => (id ? (await users().findOne({ userId: id }, { projection: { _id: 0, name: 1 } }))?.name : undefined);

/** GET /lifecycle/resignation — the open (or accepted) resignation, and what a new one would give. */
export async function myResignation(userId: string, now = new Date()) {
  const user = await appUser(userId);
  const noticeDays = await noticeDaysFor(user.org);
  const lastDayByNotice = addDays(todayKey(now), noticeDays);
  const r = await resignations().findOne({ org: user.org, userId, status: { $in: ['with_manager', 'with_hr', 'accepted'] } }, { sort: { submittedAt: -1 }, projection: { _id: 0 } });
  // Accepted and long gone (a rehire): only a resignation of the exit under way counts.
  const current = r && (r.status !== 'accepted' || user.exit?.offboarding?.resignationId === r.id) ? r : null;
  const canResign = !current && !user.exit && user.lifecycleStatus !== 'notice';
  return {
    ...(current ? { resignation: { ...resignationView(current, await managerNameOf(current.managerUserId), now), ...(current.status === 'accepted' && user.exit ? { tl: user.exit.lastWorkingDay } : {}) } } : {}),
    noticeDays, lastDayByNotice, canResign, reasons: RESIGNATION_REASONS,
  };
}

/** POST /lifecycle/resignation { reason, note? } — R1b "Yes, send it". With the manager (or HR, when they have none). */
export async function resign(userId: string, body: Record<string, unknown>, now = new Date()) {
  const user = await appUser(userId);
  if (user.exit || user.lifecycleStatus === 'notice') throw new LifecycleError(409, 'You are already on notice');
  if (await resignations().findOne({ org: user.org, userId, status: { $in: OPEN } }, { projection: { _id: 1 } })) throw new LifecycleError(409, 'Your resignation is already sent');
  const reason = String(body.reason ?? '').trim().slice(0, 80);
  if (!reason) throw new LifecycleError(400, 'Pick a reason');
  const note = String(body.note ?? '').trim().slice(0, 2000);
  const noticeDays = await noticeDaysFor(user.org);
  const managerUserId = user.managerUserId && user.managerUserId !== userId ? user.managerUserId : undefined;
  const r: Resignation = {
    id: randomUUID(), org: user.org, userId, ...(managerUserId ? { managerUserId } : {}), reason, ...(note ? { note } : {}),
    submittedAt: now, noticeDays, lastDayByNotice: addDays(todayKey(now), noticeDays), status: managerUserId ? 'with_manager' : 'with_hr',
  };
  await resignations().insertOne({ ...r });
  const first = firstName(user.name);
  if (managerUserId) await tell([managerUserId], 'lifecycle_resignation', `Resignation · ${user.name}`, `${first} has resigned. Last day by notice: ${shortDay(r.lastDayByNotice)}. Open Team › Requests.`, { resignationId: r.id, userId });
  return { resignation: resignationView(r, await managerNameOf(managerUserId), now) };
}

/** POST /lifecycle/resignation/withdraw — until HR accepts. The tab returns to normal; the manager is told. */
export async function withdrawResignation(userId: string, now = new Date()) {
  const user = await appUser(userId);
  const r = await resignations().findOne({ org: user.org, userId, status: { $in: OPEN } }, { projection: { _id: 0 } });
  if (!r) {
    const accepted = await resignations().findOne({ org: user.org, userId, status: 'accepted' }, { projection: { _id: 1 } });
    throw new LifecycleError(accepted ? 409 : 404, accepted ? 'HR has accepted your resignation. Talk to HR to change it.' : 'No resignation to withdraw');
  }
  const done = await resignations().updateOne({ id: r.id, status: { $in: OPEN } }, { $set: { status: 'withdrawn', withdrawnAt: now } });
  if (!done.modifiedCount) throw new LifecycleError(409, 'HR has accepted your resignation. Talk to HR to change it.');
  await tell([r.managerUserId], 'lifecycle_resignation_withdrawn', `${firstName(user.name)} withdrew their resignation`, `${user.name} is staying.`, { resignationId: r.id, userId });
  return { resignation: resignationView({ ...r, status: 'withdrawn', withdrawnAt: now }, await managerNameOf(r.managerUserId), now) };
}

/** GET /lifecycle/manager/resignations — R7: the manager's reports' resignations not yet accepted by HR. */
export async function managerResignations(managerUserId: string, now = new Date()) {
  const manager = await appUser(managerUserId);
  const rows = await resignations().find({ org: manager.org, managerUserId, status: { $in: OPEN } }, { projection: { _id: 0 } }).sort({ submittedAt: -1 }).toArray();
  const people = await users().find({ userId: { $in: rows.map((r) => r.userId) } }, { projection: { _id: 0, userId: 1, name: 1, designation: 1, department: 1 } }).toArray();
  return {
    resignations: rows.map((r) => {
      const p = people.find((x) => x.userId === r.userId);
      return { ...resignationView(r, manager.name, now), name: p?.name ?? '', designation: p?.designation ?? '', department: p?.department ?? '' };
    }),
  };
}

/** POST /lifecycle/manager/resignations/:id { action: accept | change_day | release_early, date?, note? } — moves it to HR. */
export async function managerResignationAction(managerUserId: string, resignationId: string, body: Record<string, unknown>, now = new Date()) {
  const manager = await appUser(managerUserId);
  const r = await resignations().findOne({ id: resignationId, org: manager.org, managerUserId }, { projection: { _id: 0 } });
  if (!r) throw new LifecycleError(404, 'No such resignation');
  if (!OPEN.includes(r.status)) throw new LifecycleError(409, r.status === 'withdrawn' ? 'This resignation was withdrawn' : 'HR has already accepted it');
  const action = String(body.action ?? '');
  if (!['accept', 'change_day', 'release_early'].includes(action)) throw new LifecycleError(400, 'action: accept, change_day or release_early');
  const today = todayKey(now);
  let date: string | undefined;
  if (action !== 'accept') {
    date = String(body.date ?? '');
    if (!isDateKey(date)) throw new LifecycleError(400, 'Pick the last day, a date like 2026-12-31');
    if (date < today) throw new LifecycleError(400, 'The last day cannot be in the past');
    if (action === 'release_early' && date >= r.lastDayByNotice) throw new LifecycleError(400, `An early release is before the last day by notice (${longDay(r.lastDayByNotice)})`);
  }
  const note = String(body.note ?? '').trim().slice(0, 1000);
  const managerAct = { action: action as 'accept' | 'change_day' | 'release_early', ...(date ? { date } : {}), ...(note ? { note } : {}), at: now, byName: manager.name };
  const done = await resignations().updateOne({ id: r.id, status: { $in: OPEN } }, { $set: { manager: managerAct, status: 'with_hr' } });
  if (!done.modifiedCount) throw new LifecycleError(409, 'HR has already accepted it');
  return { resignation: resignationView({ ...r, manager: managerAct, status: 'with_hr' }, manager.name, now) };
}

/**
 * POST /admin/lifecycle/resignations/:id/accept { lastWorkingDay?, note?, newManagerUserId?, moveTeamNow?, recoverShortfall?, templateId? }
 * HR accepts and confirms Tl (default: the manager's agreed day, else the last day by notice). Records the
 * exit (kind resigned, notice from the day it was sent) and creates the offboarding journey. A last day
 * earlier than the notice gives is the company's release: no shortfall is recovered unless `recoverShortfall`.
 */
export async function acceptResignation(hrUserId: string, resignationId: string, body: Record<string, unknown>, now = new Date()) {
  const hr = await dashboardActor(hrUserId);
  requireHr(hr, 'Only HR can accept a resignation');
  const r = await resignations().findOne({ id: resignationId, org: hr.org }, { projection: { _id: 0 } });
  if (!r) throw new LifecycleError(404, 'No such resignation');
  if (r.status === 'accepted') throw new LifecycleError(409, 'This resignation is already accepted');
  if (r.status === 'withdrawn') throw new LifecycleError(409, 'This resignation was withdrawn');
  const employee = await users().findOne({ userId: r.userId, org: hr.org });
  if (!employee) throw new LifecycleError(404, 'Employee not found');
  if (employee.exit) throw new LifecycleError(409, `An exit is already recorded for ${employee.name}`);
  const lastWorkingDay = body.lastWorkingDay == null || body.lastWorkingDay === '' ? (r.manager?.date ?? r.lastDayByNotice) : String(body.lastWorkingDay);
  if (!isDateKey(lastWorkingDay)) throw new LifecycleError(400, 'Last working day is a date like 2026-12-31');
  const sent = keyOfInstant(r.submittedAt)!;
  if (lastWorkingDay < sent) throw new LifecycleError(400, `The last day cannot be before the resignation (${longDay(sent)})`);
  const early = lastWorkingDay < r.lastDayByNotice && body.recoverShortfall !== true;
  const res = await beginOffboarding(hr, employee, {
    exitType: 'resignation', lastWorkingDay, noticeFrom: sent, noticeDays: r.noticeDays,
    ...(body.note ? { note: String(body.note).trim().slice(0, 1000) } : {}),
    ...(early ? { rules: { noticeRecovery: 'none' } } : {}),
    ...(body.newManagerUserId ? { newManagerUserId: String(body.newManagerUserId) } : {}),
    moveTeamNow: body.moveTeamNow === true,
    ...(body.templateId ? { templateId: String(body.templateId) } : {}),
    resignationId: r.id, tellManagerNow: true, showAppPage: true,
  }, now);
  await resignations().updateOne({ id: r.id }, { $set: { status: 'accepted', hrAcceptedAt: now, ...(hr.name ? { hrAcceptedByName: hr.name } : {}), agreedLastDay: lastWorkingDay, journeyId: res.journeyId } });
  await completeTask(res.journeyId, 'send_resignation', { userId: r.userId });
  if (r.manager) await completeTask(res.journeyId, 'manager_resignation_action', { name: r.manager.byName });
  const after = await resignations().findOne({ id: r.id }, { projection: { _id: 0 } });
  return { resignation: resignationView(after!, await managerNameOf(r.managerUserId), now), journeyId: res.journeyId, exit: res.exit };
}
