/**
 * What the app's Payroll screens share: who is asking, the company's
 * deadlines, and which pay months are locked by a run.
 *
 * Every employee route reads the signed-in person's own records only; none
 * takes a userId. Days are UTC calendar days, as the rest of payroll keys them.
 */
import { companies, payrollRuns, users } from '../config/db';
import { requestViewer } from '../middleware/request-viewer';
import { EmployeePayrollSettings } from '../models/employeePayroll.model';
import { PayrollRunStatus } from '../models/payrollRun.model';
import { User } from '../models/user.model';
import { fyOf } from '../shared/payroll/tds';
import { hasPayrollAccess } from './payrollAccess.service';

export class EmployeePayrollError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    /** Sent back as `details` (see the error middleware), e.g. `{ reason: 'payroll_app_off' }`. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'EmployeePayrollError';
  }
}

export type PayrollDeadlines = Required<Pick<EmployeePayrollSettings, 'splitCutoffDay' | 'declarationDue' | 'proofsDue' | 'billsDue'>>;

export const DEFAULT_DEADLINES: PayrollDeadlines = {
  splitCutoffDay: 15,
  declarationDue: '11-30',
  proofsDue: '01-31',
  billsDue: '03-31',
};

const MM_DD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The company's deadlines, each stored one or else its default. */
export function deadlinesFrom(s: EmployeePayrollSettings | undefined): PayrollDeadlines {
  const day = Number(s?.splitCutoffDay);
  const md = (v: unknown, fallback: string) => (typeof v === 'string' && MM_DD.test(v) ? v : fallback);
  return {
    splitCutoffDay: Number.isInteger(day) && day >= 1 && day <= 31 ? day : DEFAULT_DEADLINES.splitCutoffDay,
    declarationDue: md(s?.declarationDue, DEFAULT_DEADLINES.declarationDue),
    proofsDue: md(s?.proofsDue, DEFAULT_DEADLINES.proofsDue),
    billsDue: md(s?.billsDue, DEFAULT_DEADLINES.billsDue),
  };
}

export async function deadlinesOf(org: string): Promise<PayrollDeadlines> {
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, payrollEmployee: 1 } });
  return deadlinesFrom(company?.payrollEmployee);
}

/** Whether the app shows Payroll to this company's people: only once HR has switched it on. */
export const payrollAppEnabledFrom = (s: EmployeePayrollSettings | undefined | null) => s?.appEnabled === true;

export async function payrollAppEnabled(org: string): Promise<boolean> {
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, payrollEmployee: 1 } });
  return payrollAppEnabledFrom(company?.payrollEmployee);
}

export const PAYROLL_APP_OFF = () =>
  new EmployeePayrollError(403, 'Payroll is not switched on in the app for your company yet', { reason: 'payroll_app_off' });

/** The signed-in HR viewer's company, when they have payroll access. */
export async function payrollViewerOrg(viewerUserId: string, what = 'see payroll details'): Promise<string> {
  const viewer = requestViewer(viewerUserId)
    ?? (await users().findOne({ userId: viewerUserId }, { projection: { _id: 0, org: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1 } }));
  if (!viewer?.org) throw new EmployeePayrollError(403, 'No organisation on this account');
  if (!hasPayrollAccess(viewer)) throw new EmployeePayrollError(403, `Only people with payroll access can ${what}`);
  return viewer.org;
}

/** As payrollViewerOrg, for one employee of the viewer's own company (404 for anyone else's). */
export async function payrollViewerOrgFor(viewerUserId: string, userId: string, what?: string): Promise<string> {
  const org = await payrollViewerOrg(viewerUserId, what);
  const employee = userId ? await users().findOne({ userId }, { projection: { _id: 0, org: 1 } }) : null;
  if (!employee || employee.org !== org) throw new EmployeePayrollError(404, 'Employee not found');
  return org;
}

/** The signed-in person and their company. */
export async function meOf(userId: string): Promise<{ user: Omit<User, 'profilePhotoUrl'>; org: string }> {
  if (!userId) throw new EmployeePayrollError(401, 'Authentication required');
  const user = requestViewer(userId) ?? (await users().findOne({ userId }));
  if (!user) throw new EmployeePayrollError(404, 'User not found');
  if (!user.org) throw new EmployeePayrollError(409, 'Your account is not attached to a company');
  return { user, org: user.org };
}

export const dayOf = (d: Date) => d.toISOString().slice(0, 10);
export const periodOf = (d: Date) => d.toISOString().slice(0, 7);

export function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const lastDayOf = (period: string) => `${period}-${String(daysInMonth(period)).padStart(2, '0')}`;

export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Day `day` of a month, or its last day when the month is shorter. */
export function dayInMonth(period: string, day: number): string {
  return `${period}-${String(Math.min(day, daysInMonth(period))).padStart(2, '0')}`;
}

export function parsePeriodParam(raw: unknown, now: Date): string {
  if (raw === undefined || raw === null || raw === '') return periodOf(now);
  const p = String(raw);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new EmployeePayrollError(400, 'period is like 2026-10');
  if (p > periodOf(now)) throw new EmployeePayrollError(400, 'That month has not started yet');
  return p;
}

export function parseFyParam(raw: unknown, now: Date): string {
  if (raw === undefined || raw === null || raw === '') return fyOf(periodOf(now)).fy;
  const fy = String(raw);
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) throw new EmployeePayrollError(400, 'fy is like 2026-27');
  return fy;
}

const fyStartYear = (fy: string) => Number(fy.slice(0, 4));
export const declarationDueOn = (fy: string, d: Pick<PayrollDeadlines, 'declarationDue'>) => `${fyStartYear(fy)}-${d.declarationDue}`;
export const proofsDueOn = (fy: string, d: Pick<PayrollDeadlines, 'proofsDue'>) => `${fyStartYear(fy) + 1}-${d.proofsDue}`;
export const billsDueOn = (fy: string, d: Pick<PayrollDeadlines, 'billsDue'>) => `${fyStartYear(fy) + 1}-${d.billsDue}`;
export const fyLastDay = (fy: string) => `${fyStartYear(fy) + 1}-03-31`;

/** A run past draft locks its month: its payslips are the record. */
export const LOCKING_RUN_STATUSES: PayrollRunStatus[] = ['pending_approval', 'approved', 'paid'];

/** The pay months from `from` to `to` that a run has locked. */
export async function lockedPeriods(org: string, from: string, to: string): Promise<Set<string>> {
  const runs = await payrollRuns()
    .find({ org, period: { $gte: from, $lte: to }, status: { $in: LOCKING_RUN_STATUSES } }, { projection: { _id: 0, period: 1 } })
    .toArray();
  return new Set(runs.map((r) => r.period));
}
