/**
 * EPF (app › Payroll › EPF): what Sowaka knows about the person's provident
 * fund, never more.
 *
 * Sowaka cannot read EPFO. So the page shows
 *  - the PF put in through Sowaka payroll: the employee's and the employer's
 *    EPF share (not the pension share, which is not in the PF balance) from
 *    released payslips, one per month;
 *  - a PF balance only when someone typed one in from the EPFO passbook (the
 *    employee in the app, or HR on the dashboard: `epf_balances`, the newest
 *    row wins), plus the payslips' PF for the months after its date;
 *  - this month's split from the salary structure's statutory computation,
 *    on the FY's rates and ceilings (payroll_statutory_configs) and the
 *    company's statutory settings; nothing is assumed when they are missing;
 *  - the person's own UAN, decrypted for them alone (this route takes no
 *    userId).
 */
import { Collection, ObjectId } from 'mongodb';
import { employeePaymentDetails, flexibleSplits, getDb, payrollRuns, payslips, salaryStructures } from '../config/db';
import { PayrollRunStatus } from '../models/payrollRun.model';
import { fyOf } from '../shared/payroll/tds';
import { rateToPercent } from '../shared/payroll/statutory-config';
import { EmployeePayrollError, askHr, istPeriodOf, meOf, payrollViewerOrgFor } from './employeePayroll.common';
import { splitAmountsFor } from './employeePayroll.split';
import { decryptField, fieldKeyConfigured, isEncrypted } from './fieldCrypto';
import { PayrollConfigError, statutoryConfigForPeriod } from './payrollConfig.service';
import { computeStructureFor, SalaryStructureError } from './salaryStructure.service';
import { statutorySettingsFor } from './statutorySettings.service';

// —— the stored balance ——

/** A PF balance read off the EPFO passbook, typed in by the employee or HR. The newest row is the one in force. */
export interface EpfBalanceRow {
  org: string;
  userId: string;
  balancePaise: number;
  /** The passbook date the balance is as on, "YYYY-MM-DD". */
  asOn: string;
  source: 'hr' | 'employee';
  updatedBy: string;
  updatedAt: Date;
}

export const epfBalances = (): Collection<EpfBalanceRow> => getDb().collection<EpfBalanceRow>('epf_balances');

async function latestBalance(org: string, userId: string) {
  return epfBalances().find({ org, userId }).sort({ updatedAt: -1, _id: -1 }).limit(1).next();
}

/** Today in India, "YYYY-MM-DD". */
const istDayOf = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** A balance as sent: whole rupees in paise, not negative, as on a real day that is not in the future. */
function parseBalance(input: Record<string, unknown>, now: Date): { balancePaise: number; asOn: string } {
  const paise = input.balancePaise;
  if (typeof paise !== 'number' || !Number.isSafeInteger(paise) || paise < 0) {
    throw new EmployeePayrollError(400, 'The PF balance is an amount of ₹0 or more');
  }
  if (paise % 100 !== 0) throw new EmployeePayrollError(400, 'The PF balance is in whole rupees');
  const asOn = typeof input.asOn === 'string' ? input.asOn.trim() : '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asOn) ? new Date(`${asOn}T00:00:00Z`) : null;
  if (!day || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== asOn) {
    throw new EmployeePayrollError(400, 'asOn is a date like 2026-09-30');
  }
  if (asOn > istDayOf(now)) throw new EmployeePayrollError(400, 'The "as on" date can\'t be in the future');
  return { balancePaise: paise, asOn };
}

const balanceView = (row: EpfBalanceRow | null) =>
  row ? { balancePaise: row.balancePaise, asOn: row.asOn, source: row.source, updatedAt: row.updatedAt.toISOString() } : null;

// —— PF through Sowaka payroll ——

/** Runs whose payslips are the record the employee sees (as payslips/mine). */
const RELEASED: PayrollRunStatus[] = ['approved', 'paid'];

interface MonthPf {
  period: string;
  employeePaise: number;
  employerEpfPaise: number;
}

/** PF on each released month's payslip (the newest released run's for a month), oldest first. */
async function releasedPfMonths(org: string, userId: string): Promise<MonthPf[]> {
  const slips = await payslips()
    .find({ org, userId }, { projection: { period: 1, runId: 1, createdAt: 1, epf: 1, deductions: 1, employer: 1 } })
    .sort({ period: 1, createdAt: -1 })
    .toArray();
  const runIds = [...new Set(slips.map((s) => s.runId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const released = new Set(
    (runIds.length ? await payrollRuns().find({ _id: { $in: runIds }, status: { $in: RELEASED } }, { projection: { _id: 1 } }).toArray() : [])
      .map((r) => r._id.toHexString()),
  );
  const months: MonthPf[] = [];
  for (const s of slips) {
    if (!released.has(s.runId) || months.some((m) => m.period === s.period)) continue;
    const employeePaise = s.epf?.employeePaise ?? s.deductions?.find((d) => d.key === 'epf')?.amountPaise ?? 0;
    const employerEpfPaise = s.epf?.employerEpfPaise ?? s.employer?.epfPaise ?? 0;
    months.push({ period: s.period, employeePaise, employerEpfPaise });
  }
  return months.filter((m) => m.employeePaise > 0 || m.employerEpfPaise > 0);
}

function totals(months: MonthPf[]) {
  return {
    employeePaise: months.reduce((t, m) => t + m.employeePaise, 0),
    employerEpfPaise: months.reduce((t, m) => t + m.employerEpfPaise, 0),
    months: months.length,
    sincePeriod: months.length ? months[0].period : null,
    throughPeriod: months.length ? months[months.length - 1].period : null,
  };
}

// —— the UAN ——

/** The person's own UAN in full: from Bank & PAN, else their salary details. Null when none is recorded or it cannot be read. */
function ownUan(paymentUan: string | undefined, paymentLast4: string | undefined, structureUan: string | undefined) {
  const open = (v: string | undefined): string | null => {
    if (!v) return null;
    if (!isEncrypted(v)) return /^\d{12}$/.test(v) ? v : null;
    if (!fieldKeyConfigured()) return null;
    try {
      const plain = decryptField(v);
      return /^\d{12}$/.test(plain) ? plain : null;
    } catch {
      return null; // a key rotated without re-encrypting
    }
  };
  const uan = open(paymentUan) ?? open(structureUan);
  const last4 = uan ? uan.slice(-4) : paymentLast4 ?? null;
  // On record but unreadable here: the last four only, so the page can still say which.
  return { uan, uanLast4: last4, uanOnRecord: Boolean(uan || paymentUan || structureUan) };
}

// —— the page ——

export type EpfNotEnrolledReason = 'no_salary_structure' | 'pf_off_for_company' | 'pf_off_for_you' | 'not_deducted';

export async function myEpf(userId: string, now = new Date()) {
  const { org } = await meOf(userId);
  const period = istPeriodOf(now);
  const [structure, payment, settings, months, stored] = await Promise.all([
    salaryStructures().findOne({ org, userId }),
    employeePaymentDetails().findOne({ org, userId }),
    statutorySettingsFor(org),
    releasedPfMonths(org, userId),
    latestBalance(org, userId),
  ]);

  // This month's split, from the structure as it pays this month.
  let monthly: {
    period: string; employeePaise: number; employerEpfPaise: number; employerEpsPaise: number;
    pfWagePaise: number; ratePercent: number; employerRatePercent: number;
  } | null = null;
  let notSetUp: { reason: 'statutory_not_set_up' | 'payroll_not_configured'; fy: string; message: string } | null = null;
  let enrolled = false;
  let notEnrolledReason: EpfNotEnrolledReason | null = null;
  const pfOnForPerson = settings.epf.enabled && structure?.statutory?.epf !== false;

  if (!structure?.salaryTemplateCode) {
    notEnrolledReason = 'no_salary_structure';
  } else if (!settings.epf.enabled) {
    notEnrolledReason = 'pf_off_for_company';
  } else if (structure.statutory?.epf === false) {
    notEnrolledReason = 'pf_off_for_you';
  } else {
    try {
      const splits = await flexibleSplits().find({ org, userId }).toArray();
      const { computed } = await computeStructureFor(org, userId, {
        ...structure,
        componentValues: { ...(structure.componentValues ?? {}), ...splitAmountsFor(splits, period) },
      }, undefined, period);
      const config = await statutoryConfigForPeriod(period);
      const epf = computed.statutory.epf;
      enrolled = epf.employeePaise > 0 || epf.employerTotalPaise > 0;
      if (!enrolled) notEnrolledReason = 'not_deducted';
      else {
        monthly = {
          period,
          employeePaise: epf.employeePaise,
          employerEpfPaise: epf.employerEpfPaise,
          employerEpsPaise: epf.employerEpsPaise,
          // The wage the employee's rate was applied to (capped at the ceiling when restricted).
          pfWagePaise: epf.contributionWagePaise,
          ratePercent: rateToPercent(config.epf.employeeRate),
          employerRatePercent: rateToPercent(config.epf.employerRate),
        };
      }
    } catch (error) {
      const statutoryMissing = error instanceof PayrollConfigError && error.statusCode === 409;
      // A template HR removed: nothing to compute from, said as not set up rather than failing the page.
      const templateGone = error instanceof SalaryStructureError && error.statusCode === 409;
      if (!statutoryMissing && !templateGone) throw error;
      enrolled = pfOnForPerson;
      const fy = fyOf(period).fy;
      const why = (error as Error).message;
      notSetUp = {
        reason: statutoryMissing ? 'statutory_not_set_up' : 'payroll_not_configured',
        fy,
        message: statutoryMissing
          ? askHr(`Your monthly PF can't be worked out yet: the statutory settings (PF, ESI, professional tax) for FY ${fy} are not set up`)
          : askHr(`Your monthly PF can't be worked out yet: ${why.charAt(0).toLowerCase()}${why.slice(1)}`),
      };
    }
  }

  const saved = totals(months);
  // The stored balance plus what payroll put in for the months after its date.
  const balance = stored
    ? (() => {
      const after = months.filter((m) => m.period > stored.asOn.slice(0, 7));
      const addedSincePaise = after.reduce((t, m) => t + m.employeePaise + m.employerEpfPaise, 0);
      return { ...balanceView(stored)!, addedSincePaise, totalPaise: stored.balancePaise + addedSincePaise };
    })()
    : null;

  return {
    enrolled,
    notEnrolledReason: enrolled ? null : notEnrolledReason,
    // Their own UAN in full, for Copy on the EPFO sheets. Only ever on this route, which reads the caller's own records.
    ...ownUan(payment?.uan, payment?.uanLast4, structure?.statutory?.uan),
    savedThroughSowaka: saved,
    balance,
    monthly,
    notSetUp,
  };
}

/** The employee sets their PF balance from their EPFO passbook. */
export async function setMyEpfBalance(userId: string, input: Record<string, unknown>, now = new Date()) {
  const { org } = await meOf(userId);
  const { balancePaise, asOn } = parseBalance(input, now);
  await epfBalances().insertOne({ org, userId, balancePaise, asOn, source: 'employee', updatedBy: userId, updatedAt: now });
  return myEpf(userId, now);
}

// —— HR ——

export async function epfBalanceForHr(viewerUserId: string, userId: string) {
  const org = await payrollViewerOrgFor(viewerUserId, userId, 'see EPF balances');
  return { balance: balanceView(await latestBalance(org, userId)) };
}

export async function setEpfBalanceForHr(viewerUserId: string, userId: string, input: Record<string, unknown>, now = new Date()) {
  const org = await payrollViewerOrgFor(viewerUserId, userId, 'set EPF balances');
  const { balancePaise, asOn } = parseBalance(input, now);
  await epfBalances().insertOne({ org, userId, balancePaise, asOn, source: 'hr', updatedBy: viewerUserId, updatedAt: now });
  return { balance: balanceView(await latestBalance(org, userId)) };
}
