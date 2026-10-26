import { AsyncLocalStorage } from 'node:async_hooks';
import { ObjectId } from 'mongodb';
import { employeeActivity, users } from '../config/db';
import type { ActivityChange, ActivityKind, ActivityVia, EmployeeActivity } from '../models/employee-activity.model';
import type { User } from '../models/user.model';
import { logger } from '../utils/logger';

/**
 * An employee's change history: every edit to their details, manager, shift
 * and templates, wherever it came from. The services that make a change call
 * `logActivity` beside it; a Suwi card or an import runs inside
 * `withActivityVia` so the line says so. Writing a line never fails the change.
 */

const scope = new AsyncLocalStorage<{ via: ActivityVia; proposalTitle?: string }>();

/** Runs `fn` so every change it logs is marked as made through Suwi or an import. */
export function withActivityVia<T>(ctx: { via: ActivityVia; proposalTitle?: string }, fn: () => T): T {
  return scope.run(ctx, fn);
}

/** The basic details HR edits, by record field, as the profile labels them. */
export const DETAIL_LABELS: Record<string, string> = {
  name: 'Full name',
  email: 'Work email',
  employeeId: 'Employee ID',
  joiningDate: 'Joining date',
  birthday: 'Date of birth',
  phone: 'Mobile',
  gender: 'Gender',
  designation: 'Designation',
  department: 'Department',
  location: 'Location',
  branch: 'Branch',
  state: 'State',
  employeeType: 'Employee type',
  isDirector: 'Director',
};

const TYPE_WORDS: Record<string, string> = { full_time: 'Full time', contract: 'Contract', intern: 'Intern' };

function shown(field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? '' : value.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  if (field === 'employeeType') return TYPE_WORDS[String(value)] ?? String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/**
 * The detail fields a `$set`/`$unset` really changes on `before`, old and new
 * value each. Fields outside DETAIL_LABELS (timestamps, the manager) are left
 * to their own lines.
 */
export function detailChanges(before: Partial<User>, set: Record<string, unknown>, unset: Record<string, unknown> = {}): ActivityChange[] {
  const out: ActivityChange[] = [];
  for (const [field, label] of Object.entries(DETAIL_LABELS)) {
    if (!(field in set) && !(field in unset)) continue;
    const from = shown(field, (before as Record<string, unknown>)[field]);
    const to = field in set ? shown(field, set[field]) : '';
    if (from !== to) out.push({ field, label, from, to });
  }
  return out;
}

export function detailsTitle(changes: ActivityChange[]): string {
  if (changes.length === 1) return `${changes[0].label} ${changes[0].to ? 'updated' : 'cleared'}`;
  if (changes.length === 2) return `${changes[0].label} and ${changes[1].label} updated`;
  return `${changes.length} details updated`;
}

export interface ActivityInput {
  org: string;
  userId: string;
  byUserId: string;
  kind: ActivityKind;
  title: string;
  changes?: ActivityChange[];
  effectiveFrom?: string;
}

/**
 * Records changes, one line per employee. Fire and forget: the caller has
 * already saved the change, so a failure here is logged and swallowed.
 */
export function logActivity(...entries: ActivityInput[]): Promise<void> {
  // Read now, before any await, while the caller's scope is still current.
  const ctx = scope.getStore();
  const rows = entries.filter((e) => e.org && e.userId && (e.kind !== 'details' || e.changes?.length));
  if (!rows.length) return Promise.resolve();
  return (async () => {
    const byIds = [...new Set(rows.map((r) => r.byUserId))];
    const names = new Map((await users().find({ userId: { $in: byIds } }, { projection: { userId: 1, name: 1 } }).toArray()).map((u) => [u.userId, u.name ?? '']));
    const at = new Date();
    await employeeActivity().insertMany(rows.map((r): EmployeeActivity => ({
      org: r.org,
      userId: r.userId,
      at,
      byUserId: r.byUserId,
      byName: names.get(r.byUserId) || 'Someone',
      via: ctx?.via ?? 'dashboard',
      kind: r.kind,
      title: r.title,
      changes: r.changes ?? [],
      ...(r.effectiveFrom ? { effectiveFrom: r.effectiveFrom } : {}),
      ...(ctx?.proposalTitle ? { proposalTitle: ctx.proposalTitle } : {}),
    })));
  })().catch((error) => {
    logger.warn('Could not record employee activity', { error: (error as Error).message, kinds: rows.map((r) => r.kind) });
  });
}

/** A person's name for a line, '' when there is nobody. */
export async function nameOfUser(userId: string | null | undefined): Promise<string> {
  if (!userId) return '';
  return (await users().findOne({ userId }, { projection: { name: 1 } }))?.name ?? '';
}

export interface ActivityView {
  id: string;
  at: string;
  by: string;
  via: ActivityVia;
  kind: ActivityKind;
  title: string;
  changes: ActivityChange[];
  effectiveFrom: string | null;
  proposalTitle: string | null;
}

export class ActivityError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

/** Newest first, a page at a time; `before` is the last id of the previous page. */
export async function listEmployeeActivity(viewerUserId: string, userId: string, opts: { before?: string; limit?: number } = {}) {
  const viewer = await users().findOne({ userId: viewerUserId }, { projection: { org: 1 } });
  if (!viewer?.org) throw new ActivityError(404, 'User not found');
  const employee = await users().findOne({ userId, org: viewer.org }, { projection: { userId: 1 } });
  if (!employee) throw new ActivityError(404, 'Employee not found');
  const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 100);
  const before = opts.before && ObjectId.isValid(opts.before) ? new ObjectId(opts.before) : null;
  const rows = await employeeActivity()
    .find({ org: viewer.org, userId, ...(before ? { _id: { $lt: before } } : {}) })
    .sort({ _id: -1 })
    .limit(limit + 1)
    .toArray();
  return {
    items: rows.slice(0, limit).map((r): ActivityView => ({
      id: r._id!.toHexString(),
      at: r.at.toISOString(),
      by: r.byName,
      via: r.via,
      kind: r.kind,
      title: r.title,
      changes: r.changes,
      effectiveFrom: r.effectiveFrom ?? null,
      proposalTitle: r.proposalTitle ?? null,
    })),
    more: rows.length > limit,
  };
}
