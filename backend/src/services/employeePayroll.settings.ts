/**
 * The app's Payroll, per company, as HR sets it on the dashboard: whether the
 * app shows Payroll at all (`appEnabled`, off until HR turns it on) and the
 * deadlines the employee screens read (Company.payrollEmployee).
 *
 * Deadlines repeat every financial year, so they are kept as a day of the
 * month (the split cutoff) or "MM-DD" (the rest). The dashboard may send a
 * full "YYYY-MM-DD" date instead; it must then fall in the right part of the
 * FY (`?fy=`, default the current one) and only its month and day are kept.
 *
 * Nothing here has a default in code: a deadline HR has not set is reported
 * missing, the app's screens say it is not set up, and Payroll cannot be
 * switched on in the app until every deadline is set.
 */
import { companies } from '../config/db';
import { EmployeePayrollSettings } from '../models/employeePayroll.model';
import {
  DEADLINE_FIELDS, EmployeePayrollError, NOT_CONFIGURED, billsDueOn, dayInMonth, deadlinesFrom, declarationDueOn, missingDeadlines, parseFyParam,
  payrollAppEnabledFrom, payrollViewerOrg, periodOf, proofsDueOn,
} from './employeePayroll.common';

const FIELDS = ['appEnabled', 'splitCutoffDay', 'declarationDue', 'proofsDue', 'billsDue'] as const;
type Field = (typeof FIELDS)[number];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** February is held to 28 days: the date repeats every year. */
const DAYS_IN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Which months of the FY each date may fall in, and in which of its calendar years. */
const DATE_RULES: Record<'declarationDue' | 'proofsDue' | 'billsDue', { label: string; months: number[]; secondYear: boolean }> = {
  declarationDue: { label: 'The declaration due date', months: [4, 5, 6, 7, 8, 9, 10, 11, 12], secondYear: false },
  proofsDue: { label: 'The proofs due date', months: [1, 2, 3], secondYear: true },
  billsDue: { label: 'The bills due date', months: [1, 2, 3], secondYear: true },
};

function parseDate(field: keyof typeof DATE_RULES, raw: unknown, fy: string): string {
  const rule = DATE_RULES[field];
  const range = rule.secondYear ? 'between 1 January and 31 March' : 'between 1 April and 31 December';
  const text = typeof raw === 'string' ? raw.trim() : '';
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(text);
  if (!m) throw new EmployeePayrollError(400, `${rule.label} is like "11-30" or "2026-11-30"`);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN[month - 1]) {
    throw new EmployeePayrollError(400, `${rule.label} is not a date that comes every year`);
  }
  if (!rule.months.includes(month)) throw new EmployeePayrollError(400, `${rule.label} must be ${range} (within the financial year)`);
  if (m[1]) {
    const year = Number(fy.slice(0, 4)) + (rule.secondYear ? 1 : 0);
    if (Number(m[1]) !== year) throw new EmployeePayrollError(400, `${rule.label} must be within FY ${fy}: ${range} ${year}`);
  }
  return `${m[2]}-${m[3]}`;
}

function viewOf(s: EmployeePayrollSettings | undefined, fy: string, now: Date) {
  const d = deadlinesFrom(s);
  const month = periodOf(now);
  const missing = missingDeadlines(d);
  return {
    fy,
    // As stored; null is a deadline HR has not set (there are no defaults).
    settings: { appEnabled: payrollAppEnabledFrom(s), ...d },
    // The deadlines still to set; Payroll can be switched on in the app only once this is empty.
    missing,
    ready: missing.length === 0,
    // The deadlines as dates in this FY, and this month's split cutoff; null where not set.
    dates: {
      splitClosesOn: d.splitCutoffDay === null ? null : dayInMonth(month, d.splitCutoffDay),
      declarationDueOn: declarationDueOn(fy, d),
      proofsDueOn: proofsDueOn(fy, d),
      billsDueOn: billsDueOn(fy, d),
    },
    updatedAt: s?.updatedAt ? new Date(s.updatedAt).toISOString() : null,
    updatedBy: s?.updatedBy ?? null,
  };
}

export async function employeeAppSettingsForHr(viewerUserId: string, fyRaw: unknown, now = new Date()) {
  const org = await payrollViewerOrg(viewerUserId, 'see the app\'s payroll settings');
  const fy = parseFyParam(fyRaw, now);
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, payrollEmployee: 1 } });
  return viewOf(company?.payrollEmployee, fy, now);
}

/** Change any of the fields; one left out stays, `null` puts it back to the default. */
export async function setEmployeeAppSettingsForHr(viewerUserId: string, fyRaw: unknown, body: Record<string, unknown>, now = new Date()) {
  const org = await payrollViewerOrg(viewerUserId, 'change the app\'s payroll settings');
  const fy = parseFyParam(fyRaw, now);
  const unknown = Object.keys(body).filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (unknown.length > 0) throw new EmployeePayrollError(400, `Unknown setting: ${unknown.join(', ')}`);
  const given = FIELDS.filter((f) => body[f] !== undefined);
  if (given.length === 0) throw new EmployeePayrollError(400, `Send at least one of ${FIELDS.join(', ')}`);

  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ''> = {};
  for (const f of given as Field[]) {
    const raw = body[f];
    if (raw === null) {
      $unset[`payrollEmployee.${f}`] = '';
      continue;
    }
    if (f === 'appEnabled') {
      if (typeof raw !== 'boolean') throw new EmployeePayrollError(400, 'appEnabled must be true or false');
      $set['payrollEmployee.appEnabled'] = raw;
    } else if (f === 'splitCutoffDay') {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > 28) throw new EmployeePayrollError(400, 'The split cutoff day must be a day of the month from 1 to 28');
      $set['payrollEmployee.splitCutoffDay'] = n;
    } else {
      $set[`payrollEmployee.${f}`] = parseDate(f, raw, fy);
    }
  }
  // Payroll stays off in the app until every deadline is set: switching it on
  // (or clearing a deadline while it is on) is refused, naming what is missing.
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, payrollEmployee: 1 } });
  if (!company) throw new EmployeePayrollError(404, 'Company not found');
  const after: Record<string, unknown> = { ...(company.payrollEmployee ?? {}) };
  for (const f of given) after[f] = body[f] === null ? undefined : $set[`payrollEmployee.${f}`];
  if (after.appEnabled === true) {
    const missing = missingDeadlines(deadlinesFrom(after as EmployeePayrollSettings));
    if (missing.length > 0) {
      throw NOT_CONFIGURED(missing, `Set ${missing.join(', ')} before switching Payroll on in the app`);
    }
  }
  $set['payrollEmployee.updatedAt'] = now;
  $set['payrollEmployee.updatedBy'] = viewerUserId;

  const result = await companies().findOneAndUpdate(
    { id: org },
    { $set, ...(Object.keys($unset).length > 0 ? { $unset } : {}) },
    { returnDocument: 'after', projection: { _id: 0, payrollEmployee: 1 } },
  );
  if (!result) throw new EmployeePayrollError(404, 'Company not found');
  return viewOf(result.payrollEmployee, fy, now);
}

/** The values the app's payroll used before HR set them, for the one-time seed (src/scripts/payroll-employee-settings-seed.ts). */
export const SEED_DEADLINES = { splitCutoffDay: 15, declarationDue: '11-30', proofsDue: '01-31', billsDue: '03-31' } as const;

/**
 * Write SEED_DEADLINES into a company's settings where HR has not set them,
 * so HR starts from them on the dashboard and can change them. Never touches
 * a value HR set, nor the app switch. `apply` false only says what it would do.
 */
export async function seedEmployeePayrollSettings(org: string, apply: boolean, now = new Date()) {
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, id: 1, payrollEmployee: 1 } });
  if (!company) throw new EmployeePayrollError(404, `No company ${org}`);
  const current = deadlinesFrom(company.payrollEmployee);
  const writes = Object.fromEntries(DEADLINE_FIELDS.filter((f) => current[f] === null).map((f) => [f, SEED_DEADLINES[f]]));
  const kept = DEADLINE_FIELDS.filter((f) => current[f] !== null);
  if (apply && Object.keys(writes).length > 0) {
    await companies().updateOne(
      { id: org },
      {
        $set: {
          ...Object.fromEntries(Object.entries(writes).map(([f, v]) => [`payrollEmployee.${f}`, v])),
          'payrollEmployee.updatedAt': now,
          'payrollEmployee.updatedBy': 'seed:payroll-employee-settings',
        },
      },
    );
  }
  return { org, applied: apply && Object.keys(writes).length > 0, writes, kept };
}
