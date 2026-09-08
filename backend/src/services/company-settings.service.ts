import { companies, holidays, users } from '../config/db';
import { Company } from '../models/company.model';
import { cycleWindow, DEFAULT_CYCLE_START_DAY, normaliseStartDay, periodFor } from './cycle';

// Default week-off when a company has none configured: Sunday only.
export const DEFAULT_WEEKOFF_DAYS = [0];

export class CompanySettingsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CompanySettingsError';
  }
}

export interface CompanySettingsView {
  weekoffDays: number[];
  overtimeDisabledDepartments: string[];
  departments: string[]; // all departments in the org, for building toggles
  /** Day of month review cycles open on (1-28). */
  reviewCycleStartDay: number;
  /** The cycle that day currently puts the org in, for the settings preview. */
  currentCycle: { period: string; start: string; end: string };
}

async function requireAdminOrg(adminUserId: string): Promise<string> {
  const admin = await users().findOne({ userId: adminUserId });
  if (!admin) throw new CompanySettingsError(404, 'User not found');
  if (!admin.org) throw new CompanySettingsError(409, 'User is not attached to a company');
  return admin.org;
}

/** Raw config for an org, with defaults applied. Used by the overtime rules. */
export async function getCompanyConfig(
  org: string | undefined,
): Promise<{ weekoffDays: number[]; overtimeDisabledDepartments: string[] }> {
  if (!org) return { weekoffDays: DEFAULT_WEEKOFF_DAYS, overtimeDisabledDepartments: [] };
  const company = await companies().findOne({ id: org });
  return {
    weekoffDays:
      company?.weekoffDays && company.weekoffDays.length
        ? company.weekoffDays
        : DEFAULT_WEEKOFF_DAYS,
    overtimeDisabledDepartments: company?.overtimeDisabledDepartments ?? [],
  };
}

/** Settings for the HR dashboard, including the list of departments to toggle. */
export async function getCompanySettings(adminUserId: string): Promise<CompanySettingsView> {
  const org = await requireAdminOrg(adminUserId);
  const config = await getCompanyConfig(org);
  const company = await companies().findOne({ id: org });
  const reviewCycleStartDay = normaliseStartDay(
    company?.reviewCycleStartDay ?? DEFAULT_CYCLE_START_DAY,
  );
  const period = periodFor(new Date(), reviewCycleStartDay);
  const { start, end } = cycleWindow(period, reviewCycleStartDay);
  const orgEmployees = await users().find({ org }).project({ department: 1 }).toArray();
  const departments = [
    ...new Set(
      orgEmployees
        .map((employee) => (employee as { department?: string }).department?.trim())
        .filter((department): department is string => Boolean(department)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  return {
    ...config,
    departments,
    reviewCycleStartDay,
    currentCycle: {
      period,
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    },
  };
}

export async function updateCompanySettings(
  adminUserId: string,
  patch: {
    weekoffDays?: unknown;
    overtimeDisabledDepartments?: unknown;
    reviewCycleStartDay?: unknown;
  },
): Promise<CompanySettingsView> {
  const org = await requireAdminOrg(adminUserId);
  const update: Partial<Company> = { updatedAt: new Date() };

  if (patch.weekoffDays !== undefined) {
    if (
      !Array.isArray(patch.weekoffDays) ||
      !patch.weekoffDays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    ) {
      throw new CompanySettingsError(400, 'weekoffDays must be an array of weekday numbers (0-6)');
    }
    update.weekoffDays = [...new Set(patch.weekoffDays as number[])].sort((a, b) => a - b);
  }

  if (patch.overtimeDisabledDepartments !== undefined) {
    if (
      !Array.isArray(patch.overtimeDisabledDepartments) ||
      !patch.overtimeDisabledDepartments.every((dep) => typeof dep === 'string')
    ) {
      throw new CompanySettingsError(400, 'overtimeDisabledDepartments must be an array of strings');
    }
    update.overtimeDisabledDepartments = [
      ...new Set((patch.overtimeDisabledDepartments as string[]).map((dep) => dep.trim()).filter(Boolean)),
    ];
  }

  if (patch.reviewCycleStartDay !== undefined) {
    const day = Number(patch.reviewCycleStartDay);
    // Capped at 28 so the cycle opens on a day every month actually has.
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      throw new CompanySettingsError(400, 'reviewCycleStartDay must be a whole number from 1 to 28');
    }
    update.reviewCycleStartDay = day;
  }

  await companies().updateOne({ id: org }, { $set: update }, { upsert: true });
  return getCompanySettings(adminUserId);
}

/** True when `date` falls on a configured week-off weekday (UTC). */
export function isWeekoffDay(date: Date, weekoffDays: number[]): boolean {
  return weekoffDays.includes(date.getUTCDay());
}

/** Distinct YYYY-MM-DD holiday dates for an org (UTC day granularity). */
export async function getOrgHolidayDates(org: string | undefined): Promise<Set<string>> {
  if (!org) return new Set();
  const rows = await holidays().find({ org }).project({ date: 1 }).toArray();
  return new Set(
    rows.map((row) => (row as { date: Date }).date.toISOString().slice(0, 10)),
  );
}
