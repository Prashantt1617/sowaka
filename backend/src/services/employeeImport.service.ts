/**
 * People › Import: HR uploads a sheet of employee details. Each row is matched
 * to a person by Employee ID, else by work email; a row that matches nobody is
 * a new employee. Only the columns the sheet has are written: a column left out
 * is never touched, and an empty cell where the person has a value removes it.
 *
 * A bad cell (a date that isn't one, a manager nobody matches) skips only that
 * cell: the rest of the row is still imported, and the cell is listed. A row is
 * left out only when it can't work at all (a new person with no name or email,
 * the same person twice in the file).
 *
 * Nothing is written on upload. The preview lists every row of the file and
 * what happens to it, every new employee, every changed, added and removed
 * value, and every skipped cell and row with the reason; HR approves it, and
 * only then is it applied — exactly as previewed. If
 * anyone in it was changed in between, the approval is refused and HR uploads
 * again. Dashboard admins only.
 */
import { ObjectId } from 'mongodb';
import { employeePaymentDetails, getDb, kpiAssignments, kpiTemplates, paidDaysTemplates, salaryStructures, salaryTemplates, shiftTemplates, users } from '../config/db';
import { User } from '../models/user.model';
import { AdminError, accountLimitForAdmin, createEmployeeForAdmin } from './admin.service';
import { decryptField, encryptField, fieldKeyConfigured } from './fieldCrypto';
import { hasPayrollAccess } from './payrollAccess.service';
import { upsertSalaryStructure } from './salaryStructure.service';
import { assignPaidDaysTemplate } from './paidDaysTemplate.service';
import { assignShiftToUsers } from './shift.service';
import { assignTemplateToUsers } from './kpi.service';
import { setPaymentDetails } from './employeePayment.service';
import { currentPeriodFor, nextPeriod } from './cycle';

type Field = 'employeeId' | 'name' | 'email' | 'phone' | 'gender' | 'birthday' | 'joiningDate' | 'designation' | 'department'
  | 'location' | 'state' | 'branch' | 'employeeType' | 'manager' | 'isDirector'
  // Not on the person's record: templates, salary and bank details, each written through its own service.
  | 'salaryTemplate' | 'annualCtc' | 'monthlyCtc' | 'paidDaysTemplate' | 'shiftTemplate' | 'kpiTemplate'
  | 'payMode' | 'bankName' | 'accountHolder' | 'accountType' | 'accountNumber' | 'ifsc' | 'pan' | 'uan';
const EXTRA = new Set<Field>(['salaryTemplate', 'annualCtc', 'monthlyCtc', 'paidDaysTemplate', 'shiftTemplate', 'kpiTemplate', 'payMode', 'bankName', 'accountHolder', 'accountType', 'accountNumber', 'ifsc', 'pan', 'uan']);
/** Read only for someone with payroll access. */
const PAYROLL = new Set<Field>(['salaryTemplate', 'annualCtc', 'monthlyCtc', 'paidDaysTemplate', 'payMode', 'bankName', 'accountHolder', 'accountType', 'accountNumber', 'ifsc', 'pan', 'uan']);
/** Stored encrypted, shown masked. */
const SECRET = new Set<Field>(['accountNumber', 'pan', 'uan']);
const BANK = ['payMode', 'bankName', 'accountHolder', 'accountType', 'accountNumber', 'ifsc', 'pan', 'uan'] as const;

/** The columns, by field: the header the template uses, the other spellings accepted, and what goes in it. */
export const IMPORT_COLUMNS: { field: Field; header: string; aliases: string[]; hint: string }[] = [
  { field: 'employeeId', header: 'Employee ID', aliases: ['employee id', 'employee no', 'employee number', 'emp id', 'emp no', 'emp code', 'employee code', 'staff id'], hint: 'Matches the person. Required for everyone who has one.' },
  { field: 'name', header: 'Full Name', aliases: ['full name', 'name', 'employee name'], hint: 'Required for a new employee.' },
  { field: 'email', header: 'Work Email', aliases: ['work email', 'email', 'email id', 'official email', 'official email id', 'official mail', 'official mail id', 'office email', 'company email', 'work mail', 'mail id'], hint: 'Matches the person when there is no Employee ID. Required for a new employee.' },
  { field: 'phone', header: 'Mobile', aliases: ['mobile', 'mobile number', 'mobile no', 'phone', 'phone number', 'contact number', 'contact no'], hint: '' },
  { field: 'gender', header: 'Gender', aliases: ['gender'], hint: '' },
  { field: 'birthday', header: 'Date of Birth', aliases: ['date of birth', 'dob', 'birthday', 'birth date', 'birthday date'], hint: 'A date: DD/MM/YYYY, or MM/DD if the header says so.' },
  { field: 'joiningDate', header: 'Date of Joining', aliases: ['date of joining', 'doj', 'joining date', 'joining'], hint: 'A date: DD/MM/YYYY, or MM/DD if the header says so, e.g. "DOJ (MM/DD/YY)".' },
  { field: 'designation', header: 'Designation', aliases: ['designation', 'title', 'job title'], hint: '' },
  { field: 'department', header: 'Department', aliases: ['department', 'team'], hint: '' },
  { field: 'location', header: 'Work Location', aliases: ['work location', 'location', 'city'], hint: '' },
  { field: 'state', header: 'State', aliases: ['state', 'work state'], hint: 'Used for professional tax and minimum wage.' },
  { field: 'branch', header: 'Branch', aliases: ['branch', 'office'], hint: '' },
  { field: 'employeeType', header: 'Employee Type', aliases: ['employee type', 'employment type', 'type'], hint: 'Full-time, Contract or Intern.' },
  { field: 'manager', header: 'Reporting Manager', aliases: ['reporting manager', 'manager', 'reports to', 'reporting to', 'manager employee id', 'manager email'], hint: 'Their Employee ID, email or name (a first name works when only one person has it).' },
  { field: 'isDirector', header: 'Director', aliases: ['director', 'director substantial interest', 'is director'], hint: 'Yes or No.' },
  { field: 'shiftTemplate', header: 'Shift Template', aliases: ['shift template', 'shift', 'shift name', 'shift policy', 'attendance template'], hint: 'The name of one of your shift templates. Starts tomorrow.' },
  { field: 'kpiTemplate', header: 'KPI Template', aliases: ['kpi template', 'kpi', 'kpis', 'parameters', 'parameter template', 'kpi parameters', 'performance template'], hint: 'The name of one of your KPI templates. Applies from the next review cycle.' },
  { field: 'salaryTemplate', header: 'Salary Template', aliases: ['salary template', 'pay group', 'salary structure'], hint: 'The name of one of your salary templates. Payroll access only.' },
  { field: 'annualCtc', header: 'Annual CTC', aliases: ['annual ctc', 'ctc', 'ctc per annum', 'ctc pa', 'ctc annual', 'yearly ctc', 'annual salary', 'annual package', 'package'], hint: 'Rupees a year: 600000, 6,00,000, 6 LPA or 6.5 lakh. Needs a salary template. Payroll access only.' },
  { field: 'monthlyCtc', header: 'Monthly CTC', aliases: ['monthly ctc', 'ctc per month', 'ctc monthly', 'monthly salary', 'monthly gross', 'gross salary', 'salary'], hint: 'Rupees a month; read as 12 times that a year. Payroll access only.' },
  { field: 'paidDaysTemplate', header: 'Paid Days Template', aliases: ['paid days template', 'paid days', 'paid days rule'], hint: 'The name of one of your paid days templates. Payroll access only.' },
  { field: 'payMode', header: 'Pay Mode', aliases: ['pay mode', 'payment mode', 'mode of payment', 'salary mode'], hint: 'Bank transfer, Cheque or Cash. Payroll access only.' },
  { field: 'bankName', header: 'Bank Name', aliases: ['bank name', 'bank'], hint: 'Payroll access only.' },
  { field: 'accountHolder', header: 'Account Holder', aliases: ['account holder', 'account holder name', 'name as per bank', 'beneficiary name'], hint: 'Payroll access only.' },
  { field: 'accountType', header: 'Account Type', aliases: ['account type'], hint: 'Savings or Current. Payroll access only.' },
  { field: 'accountNumber', header: 'Account Number', aliases: ['account number', 'account no', 'a c no', 'a c number', 'ac no', 'acc no', 'bank account', 'bank account number', 'bank account no'], hint: '9 to 18 digits; stored encrypted. Payroll access only.' },
  { field: 'ifsc', header: 'IFSC', aliases: ['ifsc', 'ifsc code', 'bank ifsc'], hint: 'Like HDFC0001234. Payroll access only.' },
  { field: 'pan', header: 'PAN', aliases: ['pan', 'pan number', 'pan no', 'pan card', 'pan card number', 'pan card no'], hint: 'Like ABCDE1234F; stored encrypted. Payroll access only.' },
  { field: 'uan', header: 'UAN', aliases: ['uan', 'uan number', 'uan no', 'pf uan'], hint: '12 digits; stored encrypted. Payroll access only.' },
];
/** A header as compared: lower case, words only, anything in brackets dropped ("DOJ (MM/DD/YY)" is "doj"). */
const headerKey = (h: string) => norm(h.replace(/\([^)]*\)/g, ' '));
const LABEL: Record<Field, string> = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.field, c.header])) as Record<Field, string>;
// Matching never depends on case, spacing or punctuation.
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** An Employee ID as matched: letters and digits only ("cs-2", "CS 2" and "CS2" are one ID). */
const idKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** An email as matched and stored: lower case, no spaces, no wrapping quotes, brackets or trailing punctuation. */
const emailKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, '').replace(/^mailto:/, '').replace(/^[<"'(\[]+|[>"')\],;.:]+$/g, '');
/** A text value as stored: single spaces, trimmed. */
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const GENDERS: Record<string, string> = { m: 'Male', male: 'Male', man: 'Male', f: 'Female', female: 'Female', woman: 'Female', o: 'Other', other: 'Other', others: 'Other' };
const MAX_ROWS = 2000;

export interface ImportChange { field: Field; label: string; from: string; to: string; kind: 'changed' | 'added' | 'removed' }
export interface ImportPlan {
  /** Each field read, and the file's header it was read from. */
  columns: { field: Field; label: string; from: string }[];
  emptyRemoves: boolean;
  /** Things to know about the whole file, e.g. columns left out for want of access. */
  notes: string[];
  /** What a column can be read as, for the "Match columns" choices. */
  fieldChoices: { field: Field; label: string }[];
  /** Every column of the file, what it's read as ('' = not used), and its first value. */
  fileColumns: { header: string; key: string; field: Field | ''; sample: string }[];
  ignoredColumns: string[];
  newEmployees: { row: number; values: Record<string, string> }[];
  updates: { row: number; userId: string; name: string; employeeId: string; changes: ImportChange[] }[];
  unchanged: number;
  /** Rows left out entirely, and why. Row 0 is a problem with the whole file. */
  errors: { row: number; message: string }[];
  /** Cells left as they are while the rest of their row is imported. */
  /** `column` is the file's header, so a fix can be written back into that cell; `suggested` are the likeliest picks (e.g. every Neeraj). */
  skippedCells: { row: number; name: string; label: string; value: string; message: string; field: Field; column: string; suggested?: string[] }[];
  /** Ready-made choices for fixing a cell: people (by Employee ID, else email) and templates (by name). */
  pickLists: Partial<Record<'manager' | 'salaryTemplate' | 'paidDaysTemplate' | 'shiftTemplate' | 'kpiTemplate', { value: string; label: string }[]>>;
  /** Every row of the file and what happens to it. */
  rows: { row: number; name: string; employeeId: string; status: 'new' | 'updated' | 'unchanged' | 'not imported'; detail: string }[];
  accountLimit: { max: number | null; used: number; afterImport: number };
}

interface StoredImport {
  _id?: ObjectId;
  org: string;
  createdByUserId: string;
  fileName: string;
  status: 'previewed' | 'applied' | 'cancelled';
  plan: ImportPlan;
  /** Raw values per row, by field, for the rows that will be written. */
  writes: { row: number; userId?: string; set: Partial<Record<Field, string>>; unset: Field[] }[];
  /** Each touched person's updatedAt at preview: approval refuses if any changed since. */
  stamps: Record<string, string>;
  createdAt: Date;
  appliedAt?: Date;
  result?: { created: number; updated: number; failed: { row: number; message: string }[] };
}
const imports = () => getDb().collection<StoredImport>('employee_imports');

async function requireImporter(adminUserId: string): Promise<User & { org: string }> {
  const admin = await users().findOne({ userId: adminUserId });
  if (!admin?.org) throw new AdminError(403, 'No organisation on this account');
  if (admin.dashboardAdmin !== true) throw new AdminError(403, 'Only a dashboard admin can import employee details');
  return admin as User & { org: string };
}

// —— Values: what the sheet says, as stored, and as shown ——

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A date cell to YYYY-MM-DD: ISO, DD/MM/YYYY, DD-MM-YYYY, "1 Oct 2024", or an Excel day number. */
function parseDate(raw: string, monthFirst = false): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) { const y = m[3].length === 2 ? (+m[3] < 50 ? 2000 : 1900) + +m[3] : +m[3]; return monthFirst ? iso(y, +m[1], +m[2]) : iso(y, +m[2], +m[1]); }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s,-]+(\d{4})$/);
  if (m && MONTHS.includes(m[2].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Math.round((Number(s) - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
  return null;
}
function iso(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}
const TYPES: Record<string, User['employeeType']> = { 'full time': 'full_time', fulltime: 'full_time', permanent: 'full_time', 'full_time': 'full_time', contract: 'contract', contractor: 'contract', intern: 'intern', internship: 'intern' };
const TYPE_LABEL: Record<string, string> = { full_time: 'Full-time', contract: 'Contract', intern: 'Intern' };
const yesNo = (s: string) => (/^(y|yes|true|1)$/i.test(s.trim()) ? true : /^(n|no|false|0)$/i.test(s.trim()) ? false : null);
/** Rupees in any common form to paise: "6,00,000", "₹ 600000", "6 LPA", "6.5 lakh", "1.2 cr", "50k". */
function parseMoneyPaise(raw: string): number | null {
  const t = raw.toLowerCase().replace(/₹|rs\.?|inr|\/-|per annum|p\.?a\.?|per month|p\.?m\.?/g, ' ').replace(/,/g, '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|l|crores?|cr|k|thousand)?$/);
  if (!m) return null;
  const mult = !m[2] ? 1 : /^(lpa|lakh|lakhs|lac|lacs|l)$/.test(m[2]) ? 1e5 : /^(crore|crores|cr)$/.test(m[2]) ? 1e7 : 1e3;
  const paise = Math.round(Number(m[1]) * mult * 100);
  return paise > 0 ? paise : null;
}
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const PAY_MODES: Record<string, string> = { 'bank transfer': 'bank_transfer', bank: 'bank_transfer', neft: 'bank_transfer', imps: 'bank_transfer', online: 'bank_transfer', transfer: 'bank_transfer', 'bank_transfer': 'bank_transfer', cheque: 'cheque', check: 'cheque', cash: 'cash' };
const PAY_MODE_LABEL: Record<string, string> = { bank_transfer: 'Bank transfer', cheque: 'Cheque', cash: 'Cash' };
const ACCOUNT_TYPES: Record<string, string> = { savings: 'savings', saving: 'savings', sb: 'savings', 'savings account': 'savings', current: 'current', ca: 'current', 'current account': 'current' };
const masked = (v?: string) => (v ? `•••• ${v.slice(-4)}` : '');
const dmy = (d?: Date | null) => (d ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` : '');

/** How a person's current value reads, for the preview and the template. */
function shown(u: User, field: Field, nameById: Map<string, string>): string {
  switch (field) {
    case 'birthday': return dmy(u.birthday);
    case 'joiningDate': return dmy(u.joiningDate);
    case 'employeeType': return TYPE_LABEL[u.employeeType ?? ''] ?? '';
    case 'manager': return u.managerUserId ? nameById.get(u.managerUserId) ?? '' : '';
    case 'isDirector': return u.isDirector ? 'Yes' : '';
    default: return String((u as unknown as Record<string, unknown>)[field] ?? '');
  }
}

// —— Template: today's employees in the import's columns ——

export async function importTemplate(adminUserId: string) {
  const admin = await requireImporter(adminUserId);
  const people = await users().find({ org: admin.org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never).toArray();
  const byId = new Map(people.map((p) => [p.userId, p]));
  const managerKey = new Map(people.map((p) => [p.userId, p.employeeId || p.email]));
  return {
    accepted: IMPORT_COLUMNS.map(({ field, header, aliases, hint }) => ({ field, header, aliases: aliases.filter((a) => a !== norm(header)), hint })),
    headers: IMPORT_COLUMNS.map((c) => c.header),
    rows: people
      .sort((a, b) => String(a.employeeId ?? '~').localeCompare(String(b.employeeId ?? '~'), undefined, { numeric: true }))
      .map((u) => IMPORT_COLUMNS.map((c) => (c.field === 'manager' ? (u.managerUserId && byId.has(u.managerUserId) ? managerKey.get(u.managerUserId) ?? '' : '') : shown(u, c.field, new Map())))),
  };
}

// —— Preview ——

/** What a file would do, without saving anything. */
export async function planImport(adminUserId: string, input: { rows?: unknown; emptyRemoves?: unknown; mapping?: unknown }) {
  const admin = await requireImporter(adminUserId);
  const rows = Array.isArray(input.rows) ? (input.rows as unknown[]).filter((r) => r && typeof r === 'object') as Record<string, unknown>[] : [];
  if (rows.length === 0) throw new AdminError(400, 'The file has no rows under its header');
  if (rows.length > MAX_ROWS) throw new AdminError(400, `At most ${MAX_ROWS} rows per import`);

  // Empty cells remove the value only when HR asks for it; otherwise they leave it as it is.
  const emptyRemoves = input.emptyRemoves === true;
  // Which header is which field: an exact name first, then a header that starts with one
  // ("Birthday Date As per Aadhar"). Unknown headers are listed and left alone.
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((h) => !/^__/.test(h) && h.trim() !== '');
  const fieldOf = new Map<string, Field>();
  const taken = () => new Set(fieldOf.values());
  // HR's own matching wins: { "file header": field, or "" to leave that column out }.
  const chosen = input.mapping && typeof input.mapping === 'object' ? input.mapping as Record<string, unknown> : null;
  const skipHeaders = new Set<string>();
  if (chosen) {
    for (const h of headers) {
      if (!(h in chosen)) continue;
      const f = chosen[h];
      if (f === '' || f === null) skipHeaders.add(h);
      else if (IMPORT_COLUMNS.some((c) => c.field === f) && !taken().has(f as Field)) fieldOf.set(h, f as Field);
      else skipHeaders.add(h);
    }
  }
  for (const h of headers) {
    if (fieldOf.has(h) || skipHeaders.has(h)) continue;
    const k = headerKey(h);
    const col = IMPORT_COLUMNS.find((c) => c.aliases.includes(k) || norm(c.header) === k);
    if (col && !taken().has(col.field)) fieldOf.set(h, col.field);
  }
  for (const h of headers) {
    if (fieldOf.has(h) || skipHeaders.has(h)) continue;
    const k = headerKey(h);
    const col = IMPORT_COLUMNS.find((c) => !taken().has(c.field) && [norm(c.header), ...c.aliases].some((a) => a.length >= 3 && k.startsWith(`${a} `)));
    if (col) fieldOf.set(h, col.field);
  }
  let ignoredColumns = headers.filter((h) => !fieldOf.has(h));
  // Every header of the file and what it is read as, for the "Match columns" step.
  let fileColumns = headers.map((h) => ({ header: h.trim(), key: h, field: fieldOf.get(h) ?? '' as Field | '', sample: String(rows.find((r) => String(r[h] ?? '').trim() !== '')?.[h] ?? '').trim().slice(0, 40) }));
  const notes: string[] = [];
  // Salary and bank columns need payroll access; secrets also need the encryption key.
  if (!hasPayrollAccess(admin)) {
    const dropped = [...fieldOf].filter(([, f]) => PAYROLL.has(f));
    for (const [h] of dropped) fieldOf.delete(h);
    if (dropped.length) notes.push(`Not read without payroll access: ${dropped.map(([h]) => h.trim()).join(', ')}.`);
  } else if (!fieldKeyConfigured()) {
    const dropped = [...fieldOf].filter(([, f]) => SECRET.has(f));
    for (const [h] of dropped) fieldOf.delete(h);
    if (dropped.length) notes.push(`Not read: ${dropped.map(([h]) => h.trim()).join(', ')} (bank details can't be stored securely on this server yet).`);
  }
  const monthFirst = new Set([...fieldOf].filter(([h]) => /mm\s*[/.-]\s*dd/i.test(h)).map(([, f]) => f));
  const present = new Set(fieldOf.values());
  ignoredColumns = headers.filter((h) => !fieldOf.has(h));
  fileColumns = fileColumns.map((c) => ({ ...c, field: fieldOf.get(c.key) ?? '' }));
  // No column to match people by: the preview still comes back, so HR can pick one in "Match columns".
  const noKey = !present.has('employeeId') && !present.has('email');

  const people = await users().find({ org: admin.org }).toArray();
  const active = people.filter((p) => p.lifecycleStatus !== 'offboarded' && p.lifecycleStatus !== 'terminated');
  const nameById = new Map(people.map((p) => [p.userId, p.name]));
  const byEmpId = new Map(people.filter((p) => idKey(p.employeeId)).map((p) => [idKey(p.employeeId), p]));
  const byEmail = new Map(people.map((p) => [emailKey(p.email), p]));
  const byName = new Map<string, User[]>(), byFirst = new Map<string, User[]>();
  for (const p of active) {
    const k = norm(p.name), f = k.split(' ')[0];
    byName.set(k, [...(byName.get(k) ?? []), p]);
    if (f) byFirst.set(f, [...(byFirst.get(f) ?? []), p]);
  }
  /** A manager cell to a person: Employee ID, email, full name, or a first name only one person has. */
  const managerOf = (raw: string): { user?: User; ambiguous?: boolean; candidates?: User[] } => {
    const n = norm(raw);
    const hit = byEmpId.get(idKey(raw)) ?? byEmail.get(emailKey(raw));
    if (hit) return { user: hit };
    const full = byName.get(n) ?? [];
    if (full.length === 1) return { user: full[0] };
    if (full.length > 1) return { ambiguous: true, candidates: full };
    // A first name, or a cell that starts with one ("Manoj- Walkthrough"), when only one person has it.
    const first = byFirst.get(n.split(' ')[0]) ?? [];
    return first.length === 1 ? { user: first[0] } : { ambiguous: first.length > 1, candidates: first };
  };

  const x = await extrasContext(admin.org, present);
  /** How a person is written into a cell when HR picks them: their Employee ID, else their email. */
  const personKey = (u: User) => u.employeeId?.trim() || u.email;
  const columnOf = new Map([...fieldOf].map(([h, f]) => [f, h]));

  const plan: ImportPlan = {
    notes,
    pickLists: {},
    columns: IMPORT_COLUMNS.filter((c) => present.has(c.field)).map((c) => ({ field: c.field, label: c.header, from: [...fieldOf].find(([, f]) => f === c.field)![0].trim() })),
    emptyRemoves,
    fileColumns,
    fieldChoices: IMPORT_COLUMNS.filter((c) => hasPayrollAccess(admin) || !PAYROLL.has(c.field)).map((c) => ({ field: c.field, label: c.header })),
    ignoredColumns, newEmployees: [], updates: [], unchanged: 0, errors: [], skippedCells: [], rows: [],
    accountLimit: { ...(await accountLimitForAdmin(adminUserId)), afterImport: 0 },
  };
  const writes: StoredImport['writes'] = [];
  const stamps: Record<string, string> = {};
  const seenIds = new Set<string>(), seenEmails = new Set<string>();
  // New rows' employee IDs and emails, so a manager can be someone added in the same file.
  const newKeys = new Set<string>();
  for (const r of rows) {
    const get = (f: Field) => { for (const [h, ff] of fieldOf) if (ff === f) return String(r[h] ?? '').trim(); return undefined; };
    const id = idKey(get('employeeId')), em = emailKey(get('email'));
    if ((id && !byEmpId.has(id)) && (!em || !byEmail.has(em))) { if (id) newKeys.add(id); if (em) newKeys.add(em); }
    else if (!id && em && !byEmail.has(em)) newKeys.add(em);
  }

  if (noKey) plan.errors.push({ row: 0, message: "Couldn't tell which column is the Employee ID or Work Email. Pick it under Match columns." });
  if (!noKey) rows.forEach((r, i) => {
    const row = Number(r.__row) || i + 2; // the sheet's row number, under its header
    const cells = new Map<Field, string>();
    // "N/A", "-", "--", "nil" and the like are read as empty cells.
    for (const [h, f] of fieldOf) { const v = tidy(String(r[h] ?? '')); cells.set(f, /^(n\s*\/?\s*a|na|nil|none|null|not applicable|-+|—+|\.+)$/i.test(v) ? '' : v); }
    if ([...cells.values()].every((v) => v === '')) return; // a blank line
    const id = tidy(cells.get('employeeId') ?? ''), idk = idKey(id), em = emailKey(cells.get('email'));
    const byIdHit = idk ? byEmpId.get(idk) : undefined;
    const byEmailHit = em ? byEmail.get(em) : undefined;
    const label = byIdHit?.name ?? byEmailHit?.name ?? cells.get('name') ?? '';
    const fail = (message: string) => {
      plan.errors.push({ row, message: label ? `${label}: ${message}` : message });
      plan.rows.push({ row, name: label, employeeId: id, status: 'not imported', detail: message });
    };
    if (idk && seenIds.has(idk)) return fail(`Employee ID ${id} appears twice in the file`);
    if (em && seenEmails.has(em)) return fail(`Work email ${em} appears twice in the file`);
    if (idk) seenIds.add(idk);
    if (em) seenEmails.add(em);
    if (byIdHit && byEmailHit && byIdHit.userId !== byEmailHit.userId) return fail(`Employee ID ${id} is ${byIdHit.name}, but ${em} is ${byEmailHit.name}`);
    const person = byIdHit ?? byEmailHit;

    // Each present cell to the value stored; a cell that can't be read is skipped, the rest of the row goes on.
    const set: Partial<Record<Field, string>> = {};
    const unset: Field[] = [];
    const skipped: { field: Field; message: string; suggested?: string[] }[] = [];
    const skip = (field: Field, message: string, suggested?: string[]) => skipped.push({ field, message, suggested });
    for (const [f, raw] of cells) {
      if (raw === '') { if (emptyRemoves) unset.push(f); continue; }
      switch (f) {
        case 'email':
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailKey(raw))) skip(f, 'not an email');
          else if (person && emailKey(raw) !== emailKey(person.email) && byEmail.has(emailKey(raw))) skip(f, `already ${byEmail.get(emailKey(raw))!.name}'s email`);
          else set.email = emailKey(raw);
          break;
        case 'birthday': case 'joiningDate': { const d = parseDate(raw, monthFirst.has(f)); if (!d) skip(f, 'not a date (use DD/MM/YYYY)'); else set[f] = d; break; }
        case 'employeeType': { const t = TYPES[norm(raw)]; if (!t) skip(f, 'must be Full-time, Contract or Intern'); else set.employeeType = t; break; }
        case 'isDirector': { const b = yesNo(raw); if (b === null) skip(f, 'must be Yes or No'); else set.isDirector = b ? 'yes' : 'no'; break; }
        case 'manager': {
          const k = [idKey(raw), emailKey(raw)].find((x) => x && newKeys.has(x));
          const m = managerOf(raw);
          if (m.user) { if (person && m.user.userId === person.userId) skip(f, 'a person cannot report to themselves'); else set.manager = m.user.userId; }
          else if (k) set.manager = `new:${k}`;
          else skip(f, m.ambiguous ? 'matches more than one person: pick one' : 'is not an employee here: pick who it is', m.candidates?.map(personKey));
          break;
        }
        case 'gender': set.gender = GENDERS[norm(raw)] ?? tidy(raw).slice(0, 40); break;
        case 'salaryTemplate': case 'paidDaysTemplate': case 'shiftTemplate': case 'kpiTemplate': {
          const hit = x.templates[f].get(norm(raw));
          if (hit) set[f] = hit.id; else skip(f, `no ${LABEL[f].toLowerCase()} is called "${raw}"`);
          break;
        }
        case 'annualCtc': case 'monthlyCtc': { const p = parseMoneyPaise(raw); if (p === null) skip(f, 'not an amount (e.g. 600000 or 6 LPA)'); else set[f] = String(p); break; }
        case 'payMode': { const m = PAY_MODES[norm(raw)]; if (!m) skip(f, 'must be Bank transfer, Cheque or Cash'); else set.payMode = m; break; }
        case 'accountType': { const t = ACCOUNT_TYPES[norm(raw)]; if (!t) skip(f, 'must be Savings or Current'); else set.accountType = t; break; }
        case 'accountNumber': { const v = raw.replace(/[\s-]/g, ''); if (!/^\d{9,18}$/.test(v)) skip(f, 'must be 9 to 18 digits'); else set.accountNumber = v; break; }
        case 'ifsc': { const v = raw.replace(/\s/g, '').toUpperCase(); if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v)) skip(f, 'must be 4 letters, a zero, then 6 letters or digits'); else set.ifsc = v; break; }
        case 'pan': { const v = raw.replace(/[^a-z0-9]/gi, '').toUpperCase(); if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(v)) skip(f, 'must be like ABCDE1234F'); else set.pan = v; break; }
        case 'uan': { const v = raw.replace(/\D/g, ''); if (!/^\d{12}$/.test(v)) skip(f, 'must be 12 digits'); else set.uan = v; break; }
        case 'employeeId': set.employeeId = tidy(raw).slice(0, 60); break;
        default: set[f] = tidy(raw).slice(0, 120);
      }
    }
    // A monthly CTC is twelve times that a year, unless the file also gives the annual one.
    if (set.monthlyCtc) { if (!set.annualCtc) set.annualCtc = String(Number(set.monthlyCtc) * 12); delete set.monthlyCtc; }
    const structure = person ? x.structures.get(person.userId) : undefined;
    if (set.annualCtc && !set.salaryTemplate && !structure?.salaryTemplateCode) { skip(cells.has('annualCtc') ? 'annualCtc' : 'monthlyCtc', 'needs a Salary Template: add that column, or assign one first'); delete set.annualCtc; }
    if (set.salaryTemplate && !set.annualCtc && !structure?.annualCtcPaise) { skip('salaryTemplate', 'needs a CTC: add an Annual CTC or Monthly CTC column'); delete set.salaryTemplate; }
    if (set.paidDaysTemplate && !structure && !set.salaryTemplate) { skip('paidDaysTemplate', 'needs a salary first'); delete set.paidDaysTemplate; }
    const toShown = (f: Field) => EXTRA.has(f) ? x.shownTo(f, set[f]!) : f === 'manager' ? (set.manager!.startsWith('new:') ? `${cells.get('manager')} (new)` : nameById.get(set.manager!) ?? '') : f === 'birthday' || f === 'joiningDate' ? dmy(new Date(`${set[f]}T00:00:00Z`)) : f === 'employeeType' ? TYPE_LABEL[set.employeeType!] : f === 'isDirector' ? (set.isDirector === 'yes' ? 'Yes' : '') : set[f]!;
    const noteSkipped = (name: string) => { for (const k of skipped) plan.skippedCells.push({ row, name, label: LABEL[k.field], value: cells.get(k.field) ?? '', message: k.message, field: k.field, column: columnOf.get(k.field) ?? '', ...(k.suggested?.length ? { suggested: k.suggested } : {}) }); };

    if (!person) {
      const missing = [!set.name && 'a Full Name', !set.email && 'a Work Email'].filter(Boolean).join(' and ');
      if (missing) return fail(`${id ? `No employee has ID ${id} here, so this row would add someone new` : 'This row matches nobody, so it would add someone new'}, and a new employee needs ${missing}`);
      const values: Record<string, string> = {};
      for (const c of plan.columns) values[c.label] = set[c.field] !== undefined ? toShown(c.field) : '';
      plan.newEmployees.push({ row, values });
      writes.push({ row, set: seal(set), unset: [] });
      noteSkipped(set.name!);
      plan.rows.push({ row, name: set.name!, employeeId: id, status: 'new', detail: skipped.length ? `${skipped.length} cell${skipped.length > 1 ? 's' : ''} skipped` : '' });
      return;
    }
    // Required values aren't emptied: the cell is skipped and the value kept.
    const nowShown = (f: Field) => (EXTRA.has(f) ? x.shownNow(person.userId, f) : shown(person, f, nameById));
    // Templates, salary and bank details are never removed by an import.
    for (const f of [...unset]) if (EXTRA.has(f)) unset.splice(unset.indexOf(f), 1);
    for (const f of [...unset]) {
      if ((f === 'name' || f === 'email' || f === 'joiningDate' || f === 'employeeId') && nowShown(f) !== '') { skip(f, `is empty; kept ${nowShown(f)} (it can't be removed)`); unset.splice(unset.indexOf(f), 1); }
    }

    const changes: ImportChange[] = [];
    for (const f of Object.keys(set) as Field[]) {
      const to = toShown(f);
      const from = nowShown(f);
      // A value that differs only in case, spacing or punctuation is the same value.
      const same = EXTRA.has(f) ? x.same(person.userId, f, set[f]!) : f === 'manager' ? person.managerUserId === set.manager : f === 'email' ? emailKey(from) === emailKey(to) : norm(from) === norm(to);
      if (!same) changes.push({ field: f, label: LABEL[f], from, to, kind: from ? 'changed' : 'added' });
      else delete set[f];
    }
    const realUnset = unset.filter((f) => nowShown(f) !== '');
    for (const f of realUnset) changes.push({ field: f, label: LABEL[f], from: nowShown(f), to: '', kind: 'removed' });
    noteSkipped(person.name);
    const note = skipped.length ? `${skipped.length} cell${skipped.length > 1 ? 's' : ''} skipped` : '';
    if (changes.length === 0) { plan.unchanged++; plan.rows.push({ row, name: person.name, employeeId: person.employeeId ?? id, status: 'unchanged', detail: note }); return; }
    plan.updates.push({ row, userId: person.userId, name: person.name, employeeId: person.employeeId ?? '', changes });
    plan.rows.push({ row, name: person.name, employeeId: person.employeeId ?? id, status: 'updated', detail: [`${changes.length} value${changes.length > 1 ? 's' : ''}`, note].filter(Boolean).join(' · ') });
    writes.push({ row, userId: person.userId, set: seal(set), unset: realUnset });
    stamps[person.userId] = new Date(person.updatedAt ?? 0).toISOString();
  });

  const newCount = plan.newEmployees.length;
  plan.accountLimit.afterImport = plan.accountLimit.used + newCount;
  if (plan.accountLimit.max !== null && plan.accountLimit.afterImport > plan.accountLimit.max) {
    plan.errors.push({ row: 0, message: `Your plan allows ${plan.accountLimit.max} accounts; ${plan.accountLimit.used} are used and this adds ${newCount}. Contact Sowaka to add more, or remove rows.` });
  }
  // Emails new employees would take that already exist in another company.
  const newEmails = writes.filter((w) => !w.userId && w.set.email).map((w) => w.set.email!);
  if (newEmails.length) {
    const elsewhere = new Set((await users().find({ email: { $in: newEmails }, org: { $ne: admin.org } } as never, { projection: { email: 1 } }).toArray()).map((u) => u.email.toLowerCase()));
    for (const w of [...writes]) {
      if (!w.userId && w.set.email && elsewhere.has(w.set.email)) {
        const message = `${w.set.email} is already used by an account in another company`;
        plan.errors.push({ row: w.row, message: `${w.set.name}: ${message}` });
        plan.newEmployees = plan.newEmployees.filter((n) => n.row !== w.row);
        const r = plan.rows.find((x) => x.row === w.row);
        if (r) { r.status = 'not imported'; r.detail = message; }
        writes.splice(writes.indexOf(w), 1);
      }
    }
  }
  plan.errors.sort((a, b) => a.row - b.row);
  plan.rows.sort((a, b) => a.row - b.row);
  const needs = new Set(plan.skippedCells.map((c) => c.field));
  if (needs.has('manager')) plan.pickLists.manager = [...active].sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ value: personKey(u), label: [u.name, u.employeeId, u.designation].filter(Boolean).join(' · ') }));
  for (const f of ['salaryTemplate', 'paidDaysTemplate', 'shiftTemplate', 'kpiTemplate'] as const) {
    if (needs.has(f)) plan.pickLists[f] = [...new Map([...x.templates[f].values()].map((t) => [t.id, t])).values()].map((t) => ({ value: t.name, label: t.name }));
  }
  return { admin, plan, writes, stamps };
}

/** Bank secrets are kept encrypted in the stored import, like everywhere else. */
const seal = (set: Partial<Record<Field, string>>) => Object.fromEntries(Object.entries(set).map(([f, v]) => [f, SECRET.has(f as Field) && v ? encryptField(v) : v])) as Partial<Record<Field, string>>;
const unseal = (f: Field, v: string) => (SECRET.has(f) ? decryptField(v) : v);

/**
 * What templates, salary and bank details look like now, by person, and how a
 * new value reads: only loaded for the columns the file has.
 */
async function extrasContext(org: string, present: Set<Field>) {
  const want = (...fs: Field[]) => fs.some((f) => present.has(f));
  const named = (rows: { id: string; name: string; code?: string }[]) => {
    const m = new Map<string, { id: string; name: string }>();
    for (const r of rows) { m.set(norm(r.name), r); if (r.code) m.set(norm(r.code), r); }
    return m;
  };
  const salaryTpl = want('salaryTemplate', 'annualCtc', 'monthlyCtc') ? (await salaryTemplates().find({ org }).toArray()).map((t) => ({ id: t.code, name: t.name, code: t.code })) : [];
  const paidTpl = want('paidDaysTemplate') ? (await paidDaysTemplates().find({ org }).toArray()).map((t) => ({ id: t.code, name: t.name, code: t.code, isDefault: t.isDefault === true })) : [];
  const shiftTpl = want('shiftTemplate') ? await shiftTemplates().find({ org, deletedAt: { $exists: false } } as never).toArray() : [];
  const kpiTpl = want('kpiTemplate') ? (await kpiTemplates().find({ org }).toArray()).filter((t) => !(t as { archived?: boolean }).archived) : [];
  const kpiPeriod = want('kpiTemplate') ? nextPeriod(await currentPeriodFor(org)) : '';
  const structures = new Map((want('salaryTemplate', 'annualCtc', 'monthlyCtc', 'paidDaysTemplate') ? await salaryStructures().find({ org }).toArray() : []).map((d) => [d.userId, d]));
  const payments = new Map((want(...BANK) ? await employeePaymentDetails().find({ org }).toArray() : []).map((d) => [d.userId, d]));
  const shiftOf = new Map<string, string>();
  for (const t of shiftTpl) for (const u of t.assignedUserIds ?? []) shiftOf.set(u, t._id!.toHexString());
  const kpiOf = new Map<string, string>();
  if (kpiPeriod) for (const a of await kpiAssignments().find({ org, period: kpiPeriod }).toArray()) if (a.templateId) kpiOf.set(a.userId, a.templateId);
  const nameOf = { salaryTemplate: new Map(salaryTpl.map((t) => [t.id, t.name])), paidDaysTemplate: new Map(paidTpl.map((t) => [t.id, t.name])), shiftTemplate: new Map(shiftTpl.map((t) => [t._id!.toHexString(), t.name])), kpiTemplate: new Map(kpiTpl.map((t) => [t._id!.toHexString(), t.name])) };
  const defaultPaid = paidTpl.find((t) => t.isDefault)?.id;
  const plain = (userId: string, f: Field): string => {
    const d = payments.get(userId) as Record<string, string | undefined> | undefined;
    if (!d) return '';
    if (SECRET.has(f)) { try { return d[f] ? decryptField(d[f]!) : ''; } catch { return ''; } }
    return d[f] ?? '';
  };
  const current = (userId: string, f: Field): string => {
    const st = structures.get(userId);
    switch (f) {
      case 'salaryTemplate': return st?.salaryTemplateCode ?? '';
      case 'annualCtc': return st?.annualCtcPaise ? String(st.annualCtcPaise) : '';
      case 'paidDaysTemplate': return st ? st.paidDaysTemplateCode ?? defaultPaid ?? '' : '';
      case 'shiftTemplate': return shiftOf.get(userId) ?? '';
      case 'kpiTemplate': return kpiOf.get(userId) ?? '';
      default: return plain(userId, f);
    }
  };
  const shownTo = (f: Field, v: string): string => {
    switch (f) {
      case 'salaryTemplate': case 'paidDaysTemplate': case 'shiftTemplate': case 'kpiTemplate': return nameOf[f].get(v) ?? '';
      case 'annualCtc': case 'monthlyCtc': return v ? `${rupees(Number(v))} a year` : '';
      case 'payMode': return PAY_MODE_LABEL[v] ?? v;
      case 'accountType': return v ? v[0].toUpperCase() + v.slice(1) : '';
      default: return SECRET.has(f) ? masked(v) : v;
    }
  };
  return {
    structures,
    templates: { salaryTemplate: named(salaryTpl), paidDaysTemplate: named(paidTpl), shiftTemplate: named(shiftTpl.map((t) => ({ id: t._id!.toHexString(), name: t.name }))), kpiTemplate: named(kpiTpl.map((t) => ({ id: t._id!.toHexString(), name: t.name }))) } as Record<'salaryTemplate' | 'paidDaysTemplate' | 'shiftTemplate' | 'kpiTemplate', Map<string, { id: string; name: string }>>,
    shownNow: (userId: string, f: Field) => { const v = current(userId, f); return f === 'kpiTemplate' && v ? `${shownTo(f, v)} (${kpiPeriod})` : shownTo(f, v); },
    shownTo: (f: Field, v: string) => (f === 'kpiTemplate' && v ? `${shownTo(f, v)} (from ${kpiPeriod})` : shownTo(f, v)),
    same: (userId: string, f: Field, v: string) => {
      const now = current(userId, f);
      if (f === 'bankName' || f === 'accountHolder') return norm(now) === norm(v);
      return now === v;
    },
  };
}

/** Templates, salary and bank details for one person, through the same services the profile uses. */
async function applyExtras(adminUserId: string, userId: string, set: Partial<Record<Field, string>>, groups: { shift: Map<string, string[]>; kpi: Map<string, string[]> }) {
  const failed: string[] = [];
  if (set.salaryTemplate || set.annualCtc) {
    try {
      await upsertSalaryStructure(adminUserId, userId, { ...(set.salaryTemplate ? { salaryTemplateCode: set.salaryTemplate } : {}), ...(set.annualCtc ? { annualCtcPaise: Number(set.annualCtc) } : {}), status: 'active', effectiveFrom: new Date().toISOString().slice(0, 10) });
    } catch (e) { failed.push(`Salary: ${(e as Error).message}`); }
  }
  if (set.paidDaysTemplate) {
    try { await assignPaidDaysTemplate(adminUserId, userId, set.paidDaysTemplate); } catch (e) { failed.push(`Paid days template: ${(e as Error).message}`); }
  }
  const bank: Record<string, string> = {};
  for (const f of BANK) if (set[f]) bank[f] = unseal(f, set[f]!);
  if (Object.keys(bank).length) {
    try { await setPaymentDetails(adminUserId, userId, bank); } catch (e) { failed.push(`Bank details: ${(e as Error).message}`); }
  }
  if (set.shiftTemplate) groups.shift.set(set.shiftTemplate, [...(groups.shift.get(set.shiftTemplate) ?? []), userId]);
  if (set.kpiTemplate) groups.kpi.set(set.kpiTemplate, [...(groups.kpi.get(set.kpiTemplate) ?? []), userId]);
  return failed;
}

export async function previewImport(adminUserId: string, input: { fileName?: unknown; rows?: unknown; emptyRemoves?: unknown; mapping?: unknown }) {
  const { admin, plan, writes, stamps } = await planImport(adminUserId, input);
  const doc: StoredImport = { org: admin.org, createdByUserId: adminUserId, fileName: String(input.fileName ?? 'import').slice(0, 120), status: 'previewed', plan, writes, stamps, createdAt: new Date() };
  const { insertedId } = await imports().insertOne(doc);
  return { importId: insertedId.toHexString(), ...plan };
}

// —— Apply (HR approved) ——

/**
 * Applies a previewed import. `declined` leaves out single changes HR turned
 * down ({ row, field }); `skipRows` leaves out whole rows (e.g. a new person).
 */
export async function applyImport(adminUserId: string, importId: string, choices: { declined?: unknown; skipRows?: unknown } = {}) {
  const admin = await requireImporter(adminUserId);
  if (!ObjectId.isValid(importId)) throw new AdminError(400, 'Invalid import');
  const imp = await imports().findOne({ _id: new ObjectId(importId), org: admin.org });
  if (!imp) throw new AdminError(404, 'Import not found');
  if (imp.status !== 'previewed') throw new AdminError(409, 'This import was already applied or cancelled');
  if (imp.plan.errors.some((e) => e.row === 0)) throw new AdminError(409, imp.plan.errors.find((e) => e.row === 0)!.message);
  // Anyone changed since the preview: the approval would write over what HR didn't see.
  const ids = Object.keys(imp.stamps);
  const now = await users().find({ userId: { $in: ids } }, { projection: { userId: 1, name: 1, updatedAt: 1 } }).toArray();
  const moved = now.filter((u) => new Date(u.updatedAt ?? 0).toISOString() !== imp.stamps[u.userId]);
  if (moved.length) throw new AdminError(409, `${moved.map((u) => u.name).slice(0, 3).join(', ')}${moved.length > 3 ? ` and ${moved.length - 3} more` : ''} changed since this preview. Upload the file again.`);

  // HR's choices on the preview: whole rows left out, and single changes declined.
  const skipRows = new Set(Array.isArray(choices.skipRows) ? choices.skipRows.map(Number) : []);
  const declined = new Set((Array.isArray(choices.declined) ? choices.declined : []).map((d) => `${Number((d as { row?: unknown }).row)}:${String((d as { field?: unknown }).field)}`));
  imp.writes = imp.writes.filter((w) => !skipRows.has(w.row)).map((w) => {
    const set = Object.fromEntries(Object.entries(w.set).filter(([f]) => !declined.has(`${w.row}:${f}`))) as typeof w.set;
    // Declining the CTC declines it whether it came from an annual or a monthly column.
    if (declined.has(`${w.row}:monthlyCtc`)) delete set.annualCtc;
    return { ...w, set, unset: w.unset.filter((f) => !declined.has(`${w.row}:${f}`)) };
  }).filter((w) => !w.userId || Object.keys(w.set).length > 0 || w.unset.length > 0);

  const failed: { row: number; message: string }[] = [];
  const createdByKey = new Map<string, string>();
  // New employees first, so a manager added in the same file exists.
  let created = 0;
  for (const w of imp.writes.filter((x) => !x.userId)) {
    try {
      const e = await createEmployeeForAdmin(adminUserId, {
        name: w.set.name, email: w.set.email, employeeId: w.set.employeeId, mobile: w.set.phone, gender: w.set.gender,
        designation: w.set.designation, department: w.set.department, location: w.set.location, branch: w.set.branch,
        employeeType: w.set.employeeType, birthday: w.set.birthday, joiningDate: w.set.joiningDate,
        managerUserId: w.set.manager && !w.set.manager.startsWith('new:') ? w.set.manager : undefined,
      });
      const extra: Partial<User> = {};
      if (w.set.state) extra.state = w.set.state;
      if (w.set.isDirector) extra.isDirector = w.set.isDirector === 'yes';
      if (Object.keys(extra).length) await users().updateOne({ userId: e.userId }, { $set: extra });
      if (w.set.employeeId) createdByKey.set(idKey(w.set.employeeId), e.userId);
      if (w.set.email) createdByKey.set(emailKey(w.set.email), e.userId);
      created++;
    } catch (err) { failed.push({ row: w.row, message: (err as Error).message }); }
  }
  // Then the changes, and managers that point at people just created.
  let updated = 0;
  const groups = { shift: new Map<string, string[]>(), kpi: new Map<string, string[]>() };
  for (const w of imp.writes) {
    const userId = w.userId ?? (w.set.employeeId ? createdByKey.get(idKey(w.set.employeeId)) : undefined) ?? (w.set.email ? createdByKey.get(emailKey(w.set.email)) : undefined);
    if (!userId) continue;
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ''> = {};
    if (w.userId) {
      for (const [f, v] of Object.entries(w.set) as [Field, string][]) {
        if (f === 'manager' || EXTRA.has(f)) continue;
        if (f === 'birthday' || f === 'joiningDate') $set[f] = new Date(`${v}T00:00:00.000Z`);
        else if (f === 'isDirector') $set.isDirector = v === 'yes';
        else $set[f] = v;
      }
      for (const f of w.unset) if (!EXTRA.has(f)) $unset[f === 'manager' ? 'managerUserId' : f] = '';
    }
    if (w.set.manager) {
      const m = w.set.manager.startsWith('new:') ? createdByKey.get(w.set.manager.slice(4)) : w.set.manager;
      if (m && m !== userId) $set.managerUserId = m;
      else if (!m) failed.push({ row: w.row, message: 'Reporting manager was not created, so it was left as it was' });
    }
    let touched = false;
    if (Object.keys($set).length || Object.keys($unset).length) {
      try {
        if ($set.email && await users().findOne({ email: $set.email, userId: { $ne: userId } })) throw new Error(`${$set.email} is already used`);
        if ($set.employeeId && await users().findOne({ org: admin.org, employeeId: $set.employeeId, userId: { $ne: userId } })) throw new Error(`Employee ID ${$set.employeeId} is already used`);
        await users().updateOne({ userId, org: admin.org }, { $set: { ...$set, updatedAt: new Date() }, ...(Object.keys($unset).length ? { $unset } : {}) });
        touched = true;
      } catch (err) { failed.push({ row: w.row, message: (err as Error).message }); }
    }
    // Templates, salary and bank details, for existing and new people alike.
    if (Object.keys(w.set).some((f) => EXTRA.has(f as Field))) {
      const problems = await applyExtras(adminUserId, userId, w.set, groups);
      for (const message of problems) failed.push({ row: w.row, message });
      touched = true;
    }
    if (touched && w.userId) updated++;
  }
  // Shifts and KPI templates go on in one move per template.
  for (const [shiftId, ids] of groups.shift) {
    try { await assignShiftToUsers(adminUserId, shiftId, ids); } catch (err) { failed.push({ row: 0, message: `Shift template for ${ids.length} people: ${(err as Error).message}` }); }
  }
  if (groups.kpi.size) {
    const period = nextPeriod(await currentPeriodFor(admin.org));
    for (const [templateId, ids] of groups.kpi) {
      try { await assignTemplateToUsers(adminUserId, templateId, { userIds: ids, period }); } catch (err) { failed.push({ row: 0, message: `KPI template for ${ids.length} people: ${(err as Error).message}` }); }
    }
  }
  const result = { created, updated, failed };
  await imports().updateOne({ _id: imp._id }, { $set: { status: 'applied', appliedAt: new Date(), result } });
  return result;
}

export async function cancelImport(adminUserId: string, importId: string) {
  const admin = await requireImporter(adminUserId);
  if (!ObjectId.isValid(importId)) throw new AdminError(400, 'Invalid import');
  await imports().updateOne({ _id: new ObjectId(importId), org: admin.org, status: 'previewed' }, { $set: { status: 'cancelled' } });
  return { cancelled: true };
}
