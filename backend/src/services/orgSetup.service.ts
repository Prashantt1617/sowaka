import { companies, payrollRuns, users } from '../config/db';
import {
  Company,
  DeductorDetails,
  PaySchedule,
  StatutoryRegistration,
} from '../models/company.model';

export class OrgSetupError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'OrgSetupError';
  }
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;

const DEFAULT_SCHEDULE: PaySchedule = { frequency: 'monthly', payDay: 'last_day' };

export interface OrgSetupInput {
  paySchedule?: unknown;
  statutoryRegistration?: unknown;
}

export async function getOrgSetup(adminUserId: string) {
  const org = await requireAdminOrg(adminUserId);
  const company = await companies().findOne({ id: org });
  const runCount = await payrollRuns().countDocuments({ org });
  return toView(company, runCount);
}

export async function updateOrgSetup(adminUserId: string, input: OrgSetupInput) {
  const org = await requireAdminOrg(adminUserId);
  const company = await companies().findOne({ id: org });
  const runCount = await payrollRuns().countDocuments({ org });

  const set: Partial<Company> = { updatedAt: new Date() };

  if (input.paySchedule !== undefined) {
    // Enforce the lock (DEC-5): once a run exists and the stored schedule is
    // locked, its cadence can no longer change.
    if (runCount > 0 && company?.paySchedule?.lockedAfterFirstRun === true) {
      throw new OrgSetupError(409, 'Pay schedule is locked after the first payroll run');
    }
    set.paySchedule = validatePaySchedule(input.paySchedule);
  }

  if (input.statutoryRegistration !== undefined) {
    set.statutoryRegistration = validateStatutoryRegistration(input.statutoryRegistration);
  }

  await companies().updateOne({ id: org }, { $set: set }, { upsert: true });
  return getOrgSetup(adminUserId);
}

// ————————————————————————————————————————————————————————————————
// Validation
// ————————————————————————————————————————————————————————————————

function validatePaySchedule(raw: unknown): PaySchedule {
  if (!isRecord(raw)) throw new OrgSetupError(400, 'paySchedule must be an object');
  if (raw.frequency !== undefined && raw.frequency !== 'monthly') {
    throw new OrgSetupError(400, 'paySchedule.frequency must be "monthly"');
  }

  let payDay: PaySchedule['payDay'] = 'last_day';
  if (raw.payDay !== undefined && raw.payDay !== 'last_day') {
    const day = Number(raw.payDay);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      throw new OrgSetupError(400, 'paySchedule.payDay must be "last_day" or a day 1–28');
    }
    payDay = day;
  }

  const schedule: PaySchedule = { frequency: 'monthly', payDay };

  if (raw.firstPayPeriod !== undefined && raw.firstPayPeriod !== '') {
    const period = String(raw.firstPayPeriod);
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new OrgSetupError(400, "paySchedule.firstPayPeriod must be 'YYYY-MM'");
    }
    schedule.firstPayPeriod = period;
  }

  if (raw.workingDaysPerMonth !== undefined && raw.workingDaysPerMonth !== '') {
    const wd = Number(raw.workingDaysPerMonth);
    if (!Number.isInteger(wd) || wd < 1 || wd > 31) {
      throw new OrgSetupError(400, 'paySchedule.workingDaysPerMonth must be 1–31');
    }
    schedule.workingDaysPerMonth = wd;
  }

  if (raw.lockedAfterFirstRun !== undefined) {
    schedule.lockedAfterFirstRun = Boolean(raw.lockedAfterFirstRun);
  }

  return schedule;
}

function validateStatutoryRegistration(raw: unknown): StatutoryRegistration {
  if (!isRecord(raw)) throw new OrgSetupError(400, 'statutoryRegistration must be an object');
  const reg: StatutoryRegistration = {};

  const pan = optionalUpper(raw.pan);
  if (pan) {
    if (!PAN_RE.test(pan)) throw new OrgSetupError(400, 'PAN must look like ABCDE1234F');
    reg.pan = pan;
  }
  const tan = optionalUpper(raw.tan);
  if (tan) {
    if (!TAN_RE.test(tan)) throw new OrgSetupError(400, 'TAN must look like ABCD12345E');
    reg.tan = tan;
  }

  const tdsCircle = optionalString(raw.tdsCircle, 'tdsCircle');
  if (tdsCircle) reg.tdsCircle = tdsCircle;
  const aoCode = optionalString(raw.aoCode, 'aoCode');
  if (aoCode) reg.aoCode = aoCode;

  if (raw.taxPaymentFrequency !== undefined && raw.taxPaymentFrequency !== '') {
    if (raw.taxPaymentFrequency !== 'monthly' && raw.taxPaymentFrequency !== 'quarterly') {
      throw new OrgSetupError(400, 'taxPaymentFrequency must be "monthly" or "quarterly"');
    }
    reg.taxPaymentFrequency = raw.taxPaymentFrequency;
  }

  if (raw.deductor !== undefined && isRecord(raw.deductor)) {
    const d: DeductorDetails = {};
    const type = optionalString(raw.deductor.type, 'deductor.type');
    const name = optionalString(raw.deductor.name, 'deductor.name');
    const designation = optionalString(raw.deductor.designation, 'deductor.designation');
    if (type) d.type = type;
    if (name) d.name = name;
    if (designation) d.designation = designation;
    if (Object.keys(d).length > 0) reg.deductor = d;
  }

  return reg;
}

// ————————————————————————————————————————————————————————————————
// Helpers
// ————————————————————————————————————————————————————————————————

function optionalUpper(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim().toUpperCase();
  return s || undefined;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  if (s.length > 120) throw new OrgSetupError(400, `${field} is too long`);
  return s || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requireAdminOrg(adminUserId: string): Promise<string> {
  const admin = await users().findOne({ userId: adminUserId });
  if (!admin) throw new OrgSetupError(404, 'User not found');
  if (!admin.org) throw new OrgSetupError(409, 'User is not attached to a company');
  return admin.org;
}

function toView(company: Company | null, runCount: number) {
  return {
    paySchedule: company?.paySchedule ?? DEFAULT_SCHEDULE,
    statutoryRegistration: company?.statutoryRegistration ?? {},
    // Whether the pay schedule is currently locked (informs the UI).
    payScheduleLocked: runCount > 0 && company?.paySchedule?.lockedAfterFirstRun === true,
    hasRuns: runCount > 0,
  };
}
