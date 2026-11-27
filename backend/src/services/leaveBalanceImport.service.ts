/**
 * Time office › Leave balances: every active employee's leave balance for the
 * year in one read, and an Excel import that sets each person's latest balance.
 *
 * The balances are exactly what each person's app shows (`leaveBalancesFor`,
 * the same working-out as `getMyLeaveBalance`). The import reads a sheet of
 * AVAILABLE days per leave type: each row is matched to a person by Employee
 * ID, else by work email; each column to a leave type by its header (HR can
 * change any match). What is stored is the total that leaves that much
 * available: available + taken this year, through the same per person, type
 * and year adjustment the profile's pencil writes (`writeLeaveTotals`), so
 * taken days never change and later monthly credits still add on top.
 *
 * Nothing is written on upload: the preview lists every change (available now,
 * after, the difference), every row that matches nobody and every cell that
 * can't be used, and only what HR approves is written. Who may: someone with
 * the right to edit employee details, for the people they may edit on the
 * profile (anyone for a dashboard admin, else themselves and those below
 * them), never their own balance.
 */
import { ObjectId } from 'mongodb';
import { getDb, users } from '../config/db';
import type { User } from '../models/user.model';
import { orgUsers } from './admin-scope';
import { withActivityVia } from './employee-activity.service';
import { IMPORT_COLUMNS, emailKey, headerKey, idKey, norm } from './employeeImport.service';
import { editableBalanceItem, LeaveError, leaveBalancesFor, writeLeaveTotals } from './leave.service';
import type { LeaveBalance } from './leave.service';
import { mayEditEmployees } from '../middleware/admin.middleware';

const MAX_ROWS = 2000;
const MAX_DAYS = 366;
const round2 = (n: number) => Math.round(n * 100) / 100;
const isActive = (u: Pick<User, 'lifecycleStatus'>) => u.lifecycleStatus !== 'offboarded' && u.lifecycleStatus !== 'terminated';
// What a balance and the list read of each person: never photos or documents.
const USER_FIELDS = ['userId', 'org', 'name', 'email', 'employeeId', 'department', 'designation', 'location', 'branch', 'managerUserId', 'lifecycleStatus', 'joiningDate'];

type Editor = Pick<User, 'userId' | 'org' | 'name' | 'dashboardAdmin' | 'canEditEmployeeDetails'> & { org: string };

async function editorOf(adminUserId: string): Promise<Editor> {
  const editor = await users().findOne({ userId: adminUserId }, { projection: { _id: 0, userId: 1, org: 1, name: 1, dashboardAdmin: 1, canEditEmployeeDetails: 1 } });
  if (!editor?.org) throw new LeaveError(403, 'No organisation on this account');
  return editor as Editor;
}

/**
 * Whose totals this person may set, as the profile's pencil decides it: the
 * right to edit employee details, then anyone (a dashboard admin) or the people
 * below them; never their own.
 */
function editRule(editor: Editor, everyone: Pick<User, 'userId' | 'managerUserId'>[]) {
  const managerOf = new Map(everyone.map((u) => [u.userId, u.managerUserId]));
  const below = (userId: string) => {
    const seen = new Set<string>();
    let current: string | undefined = userId;
    while (current && !seen.has(current)) {
      if (current === editor.userId) return true;
      seen.add(current);
      current = managerOf.get(current);
    }
    return false;
  };
  return (userId: string): string | null => {
    if (!mayEditEmployees(editor)) return 'You cannot edit employee details. Ask a dashboard admin for that right in People › Accesses.';
    if (userId === editor.userId) return 'Your own balance is set by someone else';
    if (editor.dashboardAdmin !== true && !below(userId)) return 'You can set the balances of the people who report to you';
    return null;
  };
}

function yearOf(input: unknown) {
  const year = input == null || input === '' ? new Date().getUTCFullYear() : Number(input);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new LeaveError(400, 'Invalid balance year');
  return year;
}

/** Every leave type on anyone's template, in the order the templates list them; unpaid types last. */
function typesOf(balances: Iterable<LeaveBalance>) {
  const types = new Map<string, { key: string; name: string; editable: boolean; unpaid: boolean; monthly: boolean }>();
  for (const b of balances) {
    for (const t of b.types as BalanceType[]) {
      const seen = types.get(t.key);
      if (seen) { seen.editable ||= t.editable === true; continue; }
      types.set(t.key, { key: t.key, name: t.name, editable: t.editable === true, unpaid: t.unpaid === true, monthly: t.cadence === 'monthly' });
    }
  }
  return [...types.values()].sort((a, b) => Number(a.unpaid) - Number(b.unpaid));
}
type BalanceType = { key: string; name: string; total: number; used: number; remaining: number; editable?: true; unpaid?: true; unlimited?: true; cadence?: 'monthly'; period?: string };

// —— The list ——

/** Every active employee's balance for the year, with who of them this person may change. */
/** Unlimited leave (the template's "Keep a leave balance" off): nobody's days are counted down, so there is no balance to show or set. */
export const unlimitedLeave = (policy: { leave?: { balanceTracked?: boolean } } | undefined | null) => policy?.leave?.balanceTracked === false;

export async function listLeaveBalances(adminUserId: string, yearInput?: unknown) {
  const year = yearOf(yearInput);
  const [editor, everyone] = await Promise.all([editorOf(adminUserId), orgUsers(adminUserId, USER_FIELDS)]);
  const people = everyone.filter(isActive);
  const { balances, failed, policies } = await leaveBalancesFor(people, year);
  const mayEdit = editRule(editor, everyone);
  const nameOf = new Map(everyone.map((u) => [u.userId, u.name]));
  return {
    year,
    types: typesOf(balances.values()),
    canImport: mayEditEmployees(editor),
    people: people
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      .map((p) => ({
        userId: p.userId,
        name: p.name,
        employeeId: p.employeeId ?? '',
        email: p.email ?? '',
        department: p.department ?? '',
        designation: p.designation ?? '',
        location: p.location ?? '',
        manager: p.managerUserId ? nameOf.get(p.managerUserId) ?? '' : '',
        template: policies.get(p.userId)?.shiftName ?? '',
        canEdit: mayEdit(p.userId) === null,
        // A template with unlimited leave keeps no balance: its types are "Unlimited" (days taken told), never a total.
        ...(unlimitedLeave(policies.get(p.userId)) ? { unlimitedLeave: true as const } : {}),
        types: ((balances.get(p.userId)?.types ?? []) as BalanceType[]).map((t) => unlimitedLeave(policies.get(p.userId)) && !t.unpaid
          ? { key: t.key, name: t.name, total: 0, used: t.used, remaining: 0, unlimited: true as const }
          : {
            key: t.key, name: t.name, total: t.total, used: t.used, remaining: t.remaining,
            ...(t.editable ? { editable: true as const } : {}),
            ...(t.unpaid ? { unpaid: true as const, unlimited: true as const } : {}),
            ...(t.cadence ? { cadence: t.cadence, period: t.period } : {}),
          }),
        ...(failed.has(p.userId) ? { error: failed.get(p.userId) } : {}),
      })),
  };
}

// —— The import ——

/** What a column is read as: who the row is, or a leave type's days. */
type Field = 'employeeId' | 'email' | `type:${string}`;
export type ImportMode = 'available' | 'total';

export interface LeaveImportPlan {
  year: number;
  mode: ImportMode;
  /** Every column of the file, what it is read as ('' = not used), and its first value. */
  fileColumns: { header: string; key: string; field: Field | ''; sample: string }[];
  fieldChoices: { field: Field; label: string }[];
  /** One line per person and leave type whose figure differs from Sowaka's: the discrepancies. Only these are applied. */
  changes: ImportLine[];
  /** Lines where the file says what Sowaka already has ("Same"). */
  same: ImportLine[];
  /** People in the file whose figures are all what they already have. */
  unchanged: number;
  /** Active employees the file does not mention: they stay as they are. */
  notInFile: { userId: string; name: string; employeeId: string; department: string }[];
  /** Rows that match nobody here. */
  unmatched: { row: number; value: string; message: string }[];
  /** Cells (and whole rows) left out, and why. Row 0 is a problem with the whole file. */
  errors: { row: number; name: string; employeeId: string; column: string; value: string; message: string }[];
  /** Every row of the file and what happens to it. */
  rows: { row: number; name: string; employeeId: string; status: 'changed' | 'unchanged' | 'not matched' | 'not imported'; detail: string }[];
}

/** One person and leave type: Sowaka's figure now and the file's. `difference` is in available days (and total days: taken is the same). */
export interface ImportLine {
  row: number; userId: string; name: string; employeeId: string; department: string; type: string; typeName: string; column: string;
  taken: number; totalNow: number; availableNow: number; totalNew: number; availableNew: number; difference: number; note?: string;
}

interface StoredLeaveImport {
  _id?: ObjectId;
  org: string;
  createdByUserId: string;
  fileName: string;
  year: number;
  mode: ImportMode;
  status: 'previewed' | 'applied' | 'cancelled';
  plan: LeaveImportPlan;
  /** The figure from the file per person and type (available or total, by `mode`), as approved. */
  writes: { row: number; userId: string; type: string; value: number }[];
  createdAt: Date;
  appliedAt?: Date;
  result?: LeaveImportResult;
}
export interface LeaveImportResult { people: number; values: number; unchanged: number; failed: { row: number; name: string; message: string }[] }
const imports = () => getDb().collection<StoredLeaveImport>('leave_balance_imports');

const ID_HEADERS = IMPORT_COLUMNS.find((c) => c.field === 'employeeId')!;
const EMAIL_HEADERS = IMPORT_COLUMNS.find((c) => c.field === 'email')!;
const named = (c: { header: string; aliases: string[] }, k: string) => k === norm(c.header) || c.aliases.includes(k);
/** Words a balance header carries around the type's name ("Casual leave balance", "Earned leaves available"). */
const FILLER = new Set(['leave', 'leaves', 'balance', 'balances', 'bal', 'available', 'availability', 'left', 'remaining', 'days', 'day', 'current', 'latest', 'no', 'of']);
const core = (s: string) => headerKey(s).split(' ').filter((w) => w && !FILLER.has(w)).join(' ');
/** The short forms HR sheets use for the standard types. */
const SHORT: Record<string, string[]> = {
  earned: ['el', 'pl', 'privilege', 'privileged', 'annual'],
  casual: ['cl'],
  sick: ['sl', 'medical'],
  comp_off: ['co', 'comp off', 'compoff', 'compensatory', 'compensatory off'],
};
function typeFor(header: string, types: { key: string; name: string }[]) {
  const k = headerKey(header), c = core(header);
  if (!c) return undefined;
  return types.find((t) => k === norm(t.name) || c === core(t.name) || c === norm(t.key.replace(/_/g, ' ')))
    ?? types.find((t) => (SHORT[t.key] ?? []).includes(c));
}

/** A cell to days: a number (a comma as the decimal point too), "2 days"; '' when empty or "-". */
function daysOf(raw: string): { empty: true } | { value: number; rounded: boolean } | { error: string } {
  const t = raw.trim().replace(/\s*(days?|d)$/i, '').trim();
  if (t === '' || /^(n\s*\/?\s*a|na|nil|none|null|-+|—+|\.+)$/i.test(t)) return { empty: true };
  const n = Number(/^-?\d+,\d+$/.test(t) ? t.replace(',', '.') : t);
  if (!Number.isFinite(n)) return { error: 'not a number' };
  if (n < 0) return { error: 'negative: a balance cannot be below zero' };
  const value = round2(n);
  return { value, rounded: Math.abs(value - n) > 1e-9 };
}
const fmt = (n: number) => String(round2(n));

/** What a file would do, without saving anything. */
export async function planLeaveImport(adminUserId: string, input: { rows?: unknown; mapping?: unknown; mode?: unknown; year?: unknown }) {
  const year = yearOf(input.year);
  const mode: ImportMode = input.mode === 'total' ? 'total' : 'available';
  const rows = Array.isArray(input.rows) ? (input.rows as unknown[]).filter((r) => r && typeof r === 'object') as Record<string, unknown>[] : [];
  if (rows.length === 0) throw new LeaveError(400, 'The file has no rows under its header');
  if (rows.length > MAX_ROWS) throw new LeaveError(400, `At most ${MAX_ROWS} rows per import`);
  const [editor, everyone] = await Promise.all([editorOf(adminUserId), orgUsers(adminUserId, USER_FIELDS)]);
  if (!mayEditEmployees(editor)) throw new LeaveError(403, 'You cannot edit employee details. Ask a dashboard admin for that right in People › Accesses.');
  const mayEdit = editRule(editor, everyone);

  // The leave types the company's people have, from their templates as their balances read them.
  const active = everyone.filter(isActive);
  const { balances, failed, policies } = await leaveBalancesFor(active, year);
  const types = typesOf(balances.values()).filter((t) => !t.unpaid);
  const fieldChoices: LeaveImportPlan['fieldChoices'] = [
    { field: 'employeeId', label: 'Employee ID' },
    { field: 'email', label: 'Work Email' },
    ...types.map((t) => ({ field: `type:${t.key}` as Field, label: t.name })),
  ];
  const labelOf = new Map(fieldChoices.map((c) => [c.field, c.label]));

  // Which header is which: HR's own matching first, then by name. A field is read from one column only.
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((h) => !/^__/.test(h) && h.trim() !== '');
  const fieldOf = new Map<string, Field>();
  const taken = () => new Set(fieldOf.values());
  const chosen = input.mapping && typeof input.mapping === 'object' ? input.mapping as Record<string, unknown> : null;
  const skip = new Set<string>();
  if (chosen) {
    for (const h of headers) {
      if (!(h in chosen)) continue;
      const f = chosen[h];
      if (typeof f === 'string' && labelOf.has(f as Field) && !taken().has(f as Field)) fieldOf.set(h, f as Field);
      else skip.add(h);
    }
  }
  for (const h of headers) {
    if (fieldOf.has(h) || skip.has(h)) continue;
    const k = headerKey(h);
    const t = typeFor(h, types);
    const f: Field | undefined = named(ID_HEADERS, k) ? 'employeeId' : named(EMAIL_HEADERS, k) ? 'email' : t ? `type:${t.key}` : undefined;
    if (f && !taken().has(f)) fieldOf.set(h, f);
  }
  const sample = (h: string) => String(rows.find((r) => String(r[h] ?? '').trim() !== '')?.[h] ?? '').trim().slice(0, 40);
  const plan: LeaveImportPlan = {
    year, mode,
    fileColumns: headers.map((h) => ({ header: h.trim(), key: h, field: fieldOf.get(h) ?? '', sample: sample(h) })),
    fieldChoices, changes: [], same: [], unchanged: 0, notInFile: [], unmatched: [], errors: [], rows: [],
  };
  const writes: StoredLeaveImport['writes'] = [];
  const present = new Set(fieldOf.values());
  const typeColumns = [...fieldOf].filter(([, f]) => f.startsWith('type:')).map(([h, f]) => ({ header: h, key: f.slice(5) }));
  if (!present.has('employeeId') && !present.has('email')) plan.errors.push({ row: 0, name: '', employeeId: '', column: '', value: '', message: "Couldn't tell which column is the Employee ID or Work Email. Pick it under Columns from your file." });
  if (typeColumns.length === 0) plan.errors.push({ row: 0, name: '', employeeId: '', column: '', value: '', message: `No column is read as a leave type. Pick one under Columns from your file (${types.map((t) => t.name).join(', ') || 'no leave types on any template'}).` });
  if (plan.errors.length) return { editor, plan, writes };

  const byId = new Map(everyone.filter((p) => idKey(p.employeeId)).map((p) => [idKey(p.employeeId), p]));
  const byEmail = new Map(everyone.filter((p) => p.email).map((p) => [emailKey(p.email), p]));
  const idHeader = [...fieldOf].find(([, f]) => f === 'employeeId')?.[0];
  const emailHeader = [...fieldOf].find(([, f]) => f === 'email')?.[0];
  const seen = new Map<string, number>();

  rows.forEach((r, i) => {
    const row = Number(r.__row) || i + 2;
    const cell = (h?: string) => (h ? String(r[h] ?? '').trim() : '');
    const id = cell(idHeader), em = cell(emailHeader);
    const values = typeColumns.map((c) => ({ ...c, raw: cell(c.header) }));
    // A blank line, or one with neither who nor any figure: nothing to say about it.
    if (!id && !em && values.every((v) => v.raw === '')) return;
    const hitId = id ? byId.get(idKey(id)) : undefined;
    const hitEmail = em ? byEmail.get(emailKey(em)) : undefined;
    const label = id || em;
    const unmatched = (message: string) => {
      plan.unmatched.push({ row, value: label, message });
      plan.rows.push({ row, name: '', employeeId: id, status: 'not matched', detail: message });
    };
    if (!id && !em) return unmatched('No Employee ID or work email in this row');
    if (hitId && hitEmail && hitId.userId !== hitEmail.userId) return unmatched(`Employee ID ${id} is ${hitId.name}, but ${em} is ${hitEmail.name}`);
    const person = hitId ?? hitEmail;
    if (!person) return unmatched(id ? `No employee has ID ${id}${em ? ` or email ${em}` : ''}` : `No employee has the email ${em}`);
    const name = person.name ?? '';
    const code = person.employeeId ?? id;
    const rowError = (message: string) => {
      plan.errors.push({ row, name, employeeId: code, column: '', value: '', message });
      plan.rows.push({ row, name, employeeId: code, status: 'not imported', detail: message });
    };
    if (!isActive(person)) return rowError(`${name} has left, so their balance is not changed`);
    if (seen.has(person.userId)) return rowError(`${name} is in the file twice: row ${seen.get(person.userId)} is used`);
    seen.set(person.userId, row);
    const refused = mayEdit(person.userId);
    if (refused) return rowError(refused);
    if (unlimitedLeave(policies.get(person.userId))) return rowError(`${name} is on unlimited leave (${policies.get(person.userId)?.shiftName ?? 'their template'}): there is no balance to set`);
    const balance = balances.get(person.userId);
    if (!balance) return rowError(failed.get(person.userId) ?? 'Their balance could not be worked out');

    let changed = 0, refusedCells = 0, filled = 0;
    for (const v of values) {
      const typeName = labelOf.get(`type:${v.key}`) ?? v.key;
      const cellError = (message: string) => { refusedCells++; plan.errors.push({ row, name, employeeId: code, column: v.header.trim(), value: v.raw, message }); };
      const read = daysOf(v.raw);
      if ('empty' in read) continue;
      filled++;
      if ('error' in read) { cellError(read.error); continue; }
      let item;
      try { item = editableBalanceItem(balance, v.key); } catch (e) {
        cellError(e instanceof LeaveError && e.statusCode === 404 ? `${typeName} is not on their shift template` : (e as Error).message);
        continue;
      }
      const totalNew = mode === 'available' ? round2(read.value + item.used) : read.value;
      if (totalNew < item.used) { cellError(`${fmt(item.used)} days are already taken, so a total of ${fmt(totalNew)} would leave them below zero`); continue; }
      if (totalNew > MAX_DAYS) { cellError(`a total of ${fmt(totalNew)} days (with ${fmt(item.used)} taken) is more than ${MAX_DAYS}`); continue; }
      const line: ImportLine = {
        row, userId: person.userId, name, employeeId: code, department: person.department ?? '', type: v.key, typeName, column: v.header.trim(),
        taken: item.used, totalNow: item.total, availableNow: item.remaining, totalNew, availableNew: round2(totalNew - item.used), difference: round2(totalNew - item.total),
        ...(read.rounded ? { note: `${v.raw} read as ${fmt(read.value)}` } : {}),
      };
      if (totalNew === item.total) { plan.same.push(line); continue; }
      changed++;
      plan.changes.push(line);
      writes.push({ row, userId: person.userId, type: v.key, value: read.value });
    }
    const note = refusedCells ? `${refusedCells} cell${refusedCells > 1 ? 's' : ''} not used` : '';
    if (changed) plan.rows.push({ row, name, employeeId: code, status: 'changed', detail: [`${changed} leave type${changed > 1 ? 's' : ''}`, note].filter(Boolean).join(' · ') });
    else if (refusedCells && refusedCells === filled) plan.rows.push({ row, name, employeeId: code, status: 'not imported', detail: note });
    else { plan.unchanged++; plan.rows.push({ row, name, employeeId: code, status: 'unchanged', detail: filled ? note || 'Same as now' : 'No leave figures in this row' }); }
  });
  plan.rows.sort((a, b) => a.row - b.row);
  // Everyone active the file never names: nothing happens to them, and HR should know who they are.
  plan.notInFile = active
    .filter((p) => !seen.has(p.userId))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .map((p) => ({ userId: p.userId, name: p.name ?? '', employeeId: p.employeeId ?? '', department: p.department ?? '' }));
  return { editor, plan, writes };
}

export async function previewLeaveImport(adminUserId: string, input: { fileName?: unknown; rows?: unknown; mapping?: unknown; mode?: unknown; year?: unknown }) {
  const { editor, plan, writes } = await planLeaveImport(adminUserId, input);
  const { insertedId } = await imports().insertOne({
    org: editor.org, createdByUserId: adminUserId, fileName: String(input.fileName ?? 'import').slice(0, 120),
    year: plan.year, mode: plan.mode, status: 'previewed', plan, writes, createdAt: new Date(),
  });
  return { importId: insertedId.toHexString(), ...plan };
}

/**
 * Applies a previewed import, leaving out the lines HR declined ({ row, type }).
 * Each figure is applied as the file meant it: available days stay available
 * days even if leave was approved since the preview (the total follows what is
 * taken by then). Logged on each person's Activity as made by import.
 */
export function applyLeaveImport(adminUserId: string, importId: string, choices: { declined?: unknown } = {}) {
  return withActivityVia({ via: 'import' }, () => applyNow(adminUserId, importId, choices));
}

async function applyNow(adminUserId: string, importId: string, choices: { declined?: unknown }): Promise<LeaveImportResult> {
  const editor = await editorOf(adminUserId);
  if (!ObjectId.isValid(importId)) throw new LeaveError(400, 'Invalid import');
  const imp = await imports().findOne({ _id: new ObjectId(importId), org: editor.org, createdByUserId: adminUserId });
  if (!imp) throw new LeaveError(404, 'Import not found');
  if (imp.status !== 'previewed') throw new LeaveError(409, 'This import was already applied or cancelled');
  // Claimed before writing, so a double click applies it once.
  const claimed = await imports().updateOne({ _id: imp._id, status: 'previewed' }, { $set: { status: 'applied', appliedAt: new Date() } });
  if (claimed.modifiedCount === 0) throw new LeaveError(409, 'This import was already applied or cancelled');

  const declined = new Set((Array.isArray(choices.declined) ? choices.declined : []).map((d) => `${Number((d as { row?: unknown }).row)}:${String((d as { type?: unknown }).type)}`));
  const writes = imp.writes.filter((w) => !declined.has(`${w.row}:${w.type}`));
  const everyone = await orgUsers(adminUserId, USER_FIELDS);
  const mayEdit = editRule(editor, everyone);
  const byUser = new Map<string, typeof writes>();
  for (const w of writes) byUser.set(w.userId, [...(byUser.get(w.userId) ?? []), w]);
  const people = everyone.filter((u) => byUser.has(u.userId) && isActive(u));
  // Today's balances, read again: leave approved since the preview counts.
  const { balances, failed: unread } = await leaveBalancesFor(people, imp.year);
  const result: LeaveImportResult = { people: 0, values: 0, unchanged: 0, failed: [] };
  for (const [userId, rows] of byUser) {
    const person = people.find((p) => p.userId === userId);
    const name = person?.name ?? '';
    const fail = (row: number, message: string) => result.failed.push({ row, name, message });
    if (!person) { for (const w of rows) fail(w.row, 'No longer an active employee here'); continue; }
    const refused = mayEdit(userId);
    if (refused) { for (const w of rows) fail(w.row, refused); continue; }
    const balance = balances.get(userId);
    if (!balance) { for (const w of rows) fail(w.row, unread.get(userId) ?? 'Their balance could not be worked out'); continue; }
    const changes: { type: string; name: string; from: number; to: number }[] = [];
    for (const w of rows) {
      try {
        const item = editableBalanceItem(balance, w.type);
        const to = imp.mode === 'available' ? round2(w.value + item.used) : w.value;
        if (to < item.used) { fail(w.row, `${fmt(item.used)} days of ${item.name} are taken now, so the total cannot be ${fmt(to)}`); continue; }
        if (to > MAX_DAYS) { fail(w.row, `${item.name}: more than ${MAX_DAYS} days`); continue; }
        if (to === item.total) { result.unchanged++; continue; }
        changes.push({ type: w.type, name: item.name, from: item.total, to });
      } catch (e) { fail(w.row, (e as Error).message); }
    }
    if (changes.length === 0) continue;
    try {
      await writeLeaveTotals(adminUserId, editor.org, userId, imp.year, changes);
      result.people++;
      result.values += changes.length;
    } catch (e) { for (const w of rows) fail(w.row, (e as Error).message); }
  }
  await imports().updateOne({ _id: imp._id }, { $set: { result } });
  return result;
}

export async function cancelLeaveImport(adminUserId: string, importId: string) {
  const editor = await editorOf(adminUserId);
  if (!ObjectId.isValid(importId)) throw new LeaveError(400, 'Invalid import');
  await imports().updateOne({ _id: new ObjectId(importId), org: editor.org, status: 'previewed' }, { $set: { status: 'cancelled' } });
  return { cancelled: true };
}
