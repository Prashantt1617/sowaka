/**
 * The app's Payroll, per company, as HR sets it on the dashboard: whether the
 * app shows Payroll at all (`appEnabled`, off until HR turns it on), the
 * deadlines the employee screens read (Company.payrollEmployee), and how much
 * each − / + on My split moves a flexible head (`splitStepPaise`).
 *
 * The step is not a deadline: without it Payroll can still be switched on,
 * but the split says it is not set up (missing `splitStepPaise`) and cannot be
 * changed until HR sets it. The same goes for the split window's close date
 * (`splitDue`, "MM-DD": the FY's one window to change the split ends on it,
 * and the split is locked for the rest of the FY). The FBP bills due day
 * (`fbpBillsDueDay`, 1 to 28: each month's bills are due by that day of the
 * month) only gives the app a date to show; without it none is shown.
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
  DEADLINE_FIELDS, EmployeePayrollError, NOT_CONFIGURED, SPLIT_STEP_MAX_PAISE, billsDueOn, dayInMonth, deadlinesFrom, declarationDueOn, missingDeadlines,
  fbpBillsDueDayFrom, istPeriodOf, parseFyParam, payrollAppEnabledFrom, payrollViewerOrg, periodOf, proofsDueOn, splitClosesOnFor, splitDueFrom, splitStepFrom,
} from './employeePayroll.common';

const FIELDS = ['appEnabled', 'splitCutoffDay', 'declarationDue', 'proofsDue', 'billsDue', 'splitStepPaise', 'splitDue', 'fbpBillsDueDay'] as const;
type Field = (typeof FIELDS)[number];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** February is held to 28 days: the date repeats every year. */
const DAYS_IN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Which months of the FY each date may fall in, and in which of its calendar years. */
const DATE_RULES: Record<'declarationDue' | 'proofsDue' | 'billsDue' | 'splitDue', { label: string; months: number[]; secondYear: boolean | 'by_month' }> = {
  declarationDue: { label: 'The declaration due date', months: [4, 5, 6, 7, 8, 9, 10, 11, 12], secondYear: false },
  proofsDue: { label: 'The proofs due date', months: [1, 2, 3], secondYear: true },
  billsDue: { label: 'The bills due date', months: [1, 2, 3], secondYear: true },
  // Any day of the FY: April–December in its first year, January–March in its second.
  splitDue: { label: 'The split change window\'s close date', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], secondYear: 'by_month' },
};

function parseDate(field: keyof typeof DATE_RULES, raw: unknown, fy: string): string {
  const rule = DATE_RULES[field];
  const range = rule.secondYear === 'by_month' ? 'between 1 April and 31 March'
    : rule.secondYear ? 'between 1 January and 31 March' : 'between 1 April and 31 December';
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
    const second = rule.secondYear === 'by_month' ? month < 4 : rule.secondYear;
    const year = Number(fy.slice(0, 4)) + (second ? 1 : 0);
    if (Number(m[1]) !== year) {
      throw new EmployeePayrollError(400, rule.secondYear === 'by_month'
        ? `${rule.label} must be within FY ${fy}: 1 April ${fy.slice(0, 4)} to 31 March ${Number(fy.slice(0, 4)) + 1}`
        : `${rule.label} must be within FY ${fy}: ${range} ${year}`);
    }
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
    settings: { appEnabled: payrollAppEnabledFrom(s), ...d, splitStepPaise: splitStepFrom(s), splitDue: splitDueFrom(s), fbpBillsDueDay: fbpBillsDueDayFrom(s) },
    // The deadlines still to set; Payroll can be switched on in the app only once this is empty.
    missing,
    ready: missing.length === 0,
    // The deadlines as dates in this FY, this month's split cutoff and FBP bills due date; null where not set.
    dates: {
      // The FY's split window closes on it: no change after it until the FY ends.
      splitClosesOn: splitClosesOnFor(fy, splitDueFrom(s)),
      // Until this day of this month a change applies from this month, after it from next month.
      splitCutoffOn: d.splitCutoffDay === null ? null : dayInMonth(month, d.splitCutoffDay),
      fbpBillsDueOn: fbpBillsDueDayFrom(s) === null ? null : dayInMonth(istPeriodOf(now), fbpBillsDueDayFrom(s)!),
      declarationDueOn: declarationDueOn(fy, d),
      proofsDueOn: proofsDueOn(fy, d),
      billsDueOn: billsDueOn(fy, d),
    },
    updatedAt: s?.updatedAt ? new Date(s.updatedAt).toISOString() : null,
    updatedBy: s?.updatedBy ?? null,
  };
}

const DEADLINE_NAMES: Record<string, string> = {
  splitCutoffDay: 'the split cutoff day', declarationDue: 'the declaration date', proofsDue: 'the proofs date', billsDue: 'the bills date',
};

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
    } else if (f === 'fbpBillsDueDay') {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > 28) throw new EmployeePayrollError(400, 'The FBP bills due day must be a day of the month from 1 to 28');
      $set['payrollEmployee.fbpBillsDueDay'] = n;
    } else if (f === 'splitStepPaise') {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 100 || n > SPLIT_STEP_MAX_PAISE || n % 100 !== 0) {
        throw new EmployeePayrollError(400, 'The split step is whole rupees, from ₹1 to ₹10,000 (in paise: 100 to 1000000)');
      }
      $set['payrollEmployee.splitStepPaise'] = n;
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
      // In words: the dashboard shows this message as it is (it was "Set splitCutoffDay, billsDue …").
      const names = missing.map((f) => DEADLINE_NAMES[f] ?? f);
      const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      throw NOT_CONFIGURED(missing, `Set ${list} first: Payroll can be on in the app only while every deadline is set`);
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
