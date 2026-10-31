import { ObjectId } from 'mongodb';
import {
  payHeads,
  payrollRuns,
  payslips,
  reimbursementClaims,
  salaryStructures,
  salaryTemplates,
  users,
  employeePaymentDetails,
} from '../config/db';
import { requestViewer } from '../middleware/request-viewer';
import {
  Payslip,
  PayslipInputs,
  PayrollRun,
  PayrollRunStatus,
  PayrollRunTotals,
} from '../models/payrollRun.model';
import { ResolvedRuleSet } from '../models/statutoryRule.model';
import { calculateSalaryStructure } from './salary-calculator';
import { applyOverrides, resolveTemplateComponents } from './salaryTemplate.service';
import { esiCoveredThisPeriod, statutorySettingsFor, workStateOf } from './statutorySettings.service';
import { computePayslip, projectedTaxable, taxableAfterMealExemption } from './payroll-run.calculator';
import { overtimePayFor } from '../shared/payroll/overtime';
import {
  anyApprovedLeave,
  computeWorkingDays,
  getEmployeePeriodInputs,
  parsePeriod,
} from './payroll-inputs.service';
import type { PeriodRange } from './payroll-inputs.service';
import { resolveRuleSet } from './statutory.service';
import { attendanceCountsForPeriod, payrollDeductions, unpaidLeaveDeduction } from './deduction.service';
import { payslipHtml } from './payslip-html';
import { employeeCalendar } from './attendance-report.service';
import { companies } from '../config/db';
import { declarationsFor, runTds, tdsConfigsFor, ytdFor } from './tds.service';
import { fyOf, periodsAfter } from '../shared/payroll/tds';
import { paidDaysResolver } from './paidDaysTemplate.service';
import { addInto, billCategories, billsByComponent, ReimbursementTax, reimbursementTax, reimbursementsPaidBefore } from './reimbursementBills.service';
import { decryptField, fieldKeyConfigured } from './fieldCrypto';
import { splitAmountsFor, splitsByUser } from './employeePayroll.split';

export class PayrollRunError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PayrollRunError';
  }
}

export interface CreateRunInput {
  period: string;
  /** Per-employee LOP days for the cycle (Leave module has no paid/unpaid flag — INT-1). */
  lopDays?: Record<string, number>;
  /** Per-employee overtime pay in paise (Overtime module stores hours, not amount — INT-2). */
  overtimePaise?: Record<string, number>;
  /** Income tax (TDS) per person for the month, in paise. */
  incomeTaxPaise?: Record<string, number>;
  /** This month only, per person: amounts for one-time earnings and deductions (Bonus, Hold Amount…), by component code. */
  componentAmounts?: Record<string, Record<string, number>>;
}

type Amounts = Record<string, Record<string, number>>;

/**
 * Create a Draft run for a period: compute one payslip per employee with an
 * ACTIVE salary structure. Employees without an active structure (half-onboarded,
 * SS-3) are skipped rather than erroring the whole run.
 */
export async function createRun(adminUserId: string, input: CreateRunInput) {
  const org = await requireAdminOrg(adminUserId);
  const range = parsePeriod(input.period);

  const existing = await payrollRuns().findOne({ org, period: input.period });
  if (existing && existing.status !== 'rejected') {
    throw new PayrollRunError(409, `A payroll run for ${input.period} already exists`);
  }

  const runId = new ObjectId();
  const slips = await buildRunPayslips(adminUserId, org, runId.toHexString(), input.period, range, {
    lopDays: input.lopDays ?? {},
    overtimePaise: input.overtimePaise ?? {},
    incomeTaxPaise: input.incomeTaxPaise ?? {},
    componentAmounts: cleanAmounts(input.componentAmounts),
  });

  const now = new Date();
  const totals = sumTotals(slips);
  const run: PayrollRun & { _id: ObjectId } = {
    _id: runId,
    org,
    period: input.period,
    runType: 'regular',
    status: 'draft',
    employeeCount: slips.length,
    totals,
    createdByUserId: adminUserId,
    createdAt: now,
    updatedAt: now,
  };

  // If recreating over a previously rejected run, clear its stale payslips first.
  if (existing) {
    await payslips().deleteMany({ org, runId: existing._id!.toHexString() });
    await payrollRuns().deleteOne({ _id: existing._id });
  }
  await payrollRuns().insertOne(run);
  await payslips().insertMany(slips);
  return { run: runView(run), payslipCount: slips.length };
}

/**
 * Recompute a Draft run in place with new per-employee LOP / overtime overrides
 * (INT-1 / INT-2). Only draft runs may be recomputed; the runId is preserved so
 * the admin keeps editing the same run.
 */
export async function recomputeRun(
  adminUserId: string,
  runIdInput: string,
  input: {
    lopDays?: Record<string, number | null>;
    overtimePaise?: Record<string, number | null>;
    incomeTaxPaise?: Record<string, number | null>;
    componentAmounts?: Record<string, Record<string, number | null> | null>;
  },
) {
  const org = await requireAdminOrg(adminUserId);
  const run = await findOwnedRun(org, runIdInput);
  if (run.status !== 'draft') {
    throw new PayrollRunError(409, 'Only draft runs can be recomputed');
  }
  const range = parsePeriod(run.period);
  const runIdHex = run._id.toHexString();
  // What HR typed earlier on this run stays unless this call changes it
  // (a null clears it back to attendance / none).
  const earlier = await payslips().find({ org, runId: runIdHex }, { projection: { userId: 1, inputs: 1, deductions: 1 } }).toArray();
  const previous = new Map(earlier.map((slip) => [slip.userId, slip]));
  const merge = (given: Record<string, number | null> | undefined, keep: (slip: Payslip) => number | undefined) => {
    const out: Record<string, number> = {};
    for (const [userId, slip] of previous) {
      const kept = keep(slip);
      if (kept !== undefined) out[userId] = kept;
    }
    for (const [userId, value] of Object.entries(given ?? {})) {
      if (value === null || value === undefined) delete out[userId];
      else out[userId] = value;
    }
    return out;
  };
  const slips = await buildRunPayslips(adminUserId, org, runIdHex, run.period, range, {
    lopDays: merge(input.lopDays, (s) => (s.inputs.lopEnteredByHr ? s.inputs.lopDays : undefined)),
    overtimePaise: merge(input.overtimePaise, (s) => (s.inputs.overtimeEnteredByHr ? s.inputs.overtimePaise : undefined)),
    incomeTaxPaise: merge(input.incomeTaxPaise, (s) =>
      s.inputs.incomeTaxEnteredByHr ? s.inputs.incomeTaxPaise ?? s.deductions.find((d) => d.key === 'income_tax')?.amountPaise ?? 0 : undefined,
    ),
    componentAmounts: mergeAmounts(previous, input.componentAmounts),
  });
  await payslips().deleteMany({ org, runId: runIdHex });
  await payslips().insertMany(slips);
  return runView(await patchRun(run._id, { employeeCount: slips.length, totals: sumTotals(slips) }));
}

/**
 * Compute one payslip per employee with an ACTIVE salary structure for a period.
 * Employees without an active structure (half-onboarded, SS-3) are skipped rather
 * than erroring the whole run. Shared by createRun and recomputeRun.
 */
async function buildRunPayslips(
  adminUserId: string,
  org: string,
  runIdHex: string,
  period: string,
  range: PeriodRange,
  entered: { lopDays: Record<string, number>; overtimePaise: Record<string, number>; incomeTaxPaise: Record<string, number>; componentAmounts?: Amounts },
): Promise<Payslip[]> {
  const runAmounts = entered.componentAmounts ?? {};
  const lopOverrides = entered.lopDays;
  const otOverrides = entered.overtimePaise;
  const taxOverrides = entered.incomeTaxPaise;
  const structures = await salaryStructures().find({ org, status: 'active' }).toArray();
  if (structures.length === 0) {
    throw new PayrollRunError(409, 'No active salary structures to run payroll for');
  }
  const catalog = await payHeads().find({ org }).toArray();
  const catalogByCode = new Map(catalog.map((h) => [h.code, h]));
  const templates = await salaryTemplates().find({ org }).toArray();
  const templatesByCode = new Map(templates.map((t) => [t.code, t]));
  const workingDays = await computeWorkingDays(org, range);
  const ruleSetCache = new Map<string, ResolvedRuleSet>();
  // One set of statutory settings for everyone, and who ESI already covers
  // this contribution period.
  const settings = await statutorySettingsFor(org);
  const esiCovered = await esiCoveredThisPeriod(org, period, structures.map((s) => s.userId));
  // The month's calendar, whenever a template pays by it — the report is the
  // slow part of a run.
  // Each person's Paid Days Template (else the company's Default) says how attendance becomes paid days.
  const paidDaysFor = await paidDaysResolver(org);
  const docksForAttendance = structures.some((s) => !(paidDaysFor(s.paidDaysTemplateCode)?.allDaysPaid ?? false));
  // Leave without pay is docked even where every day is paid, so a month with
  // any approved leave in it reads the calendar too; whether a leave is unpaid
  // is the calendar's to say, from the shift that covered the day.
  const attendance = docksForAttendance || (await anyApprovedLeave(structures.map((s) => s.userId), range))
    ? await attendanceCountsForPeriod(adminUserId, period)
    : new Map();

  const employees = await users()
    .find({ userId: { $in: structures.map((s) => s.userId) } })
    .toArray();
  // The TDS engine, when the org has switched it on and the FY has config rows.
  const { fy } = fyOf(period);
  const tdsConfigs = settings.tds?.enabled ? await tdsConfigsFor(fy) : new Map();
  const tdsOn = tdsConfigs.size > 0;
  const userIds = structures.map((s) => s.userId);
  const [ytd, declarations] = tdsOn ? await Promise.all([ytdFor(org, period, userIds), declarationsFor(org, fy, userIds)]) : [new Map(), new Map()];
  // Fuel, Internet…: paid in full, taxed until bills; claims of a linked type are those bills, not paid again.
  const billCats = await billCategories(org);
  // Claims on another run (not rejected) are that run's: never paid twice.
  const otherRuns = await payrollRuns().find({ org, status: { $ne: 'rejected' } } as never, { projection: { _id: 1 } }).toArray();
  const otherRunIds = otherRuns.map((r) => r._id.toHexString()).filter((id) => id !== runIdHex);
  const reservedClaimIds = new Set(
    otherRunIds.length
      ? (await payslips().find({ org, runId: { $in: otherRunIds } }, { projection: { 'inputs.reimbursementClaimIds': 1 } }).toArray()).flatMap((s) => s.inputs?.reimbursementClaimIds ?? [])
      : [],
  );
  const [reimbPaidBefore, bills] = tdsOn
    ? await Promise.all([reimbursementsPaidBefore(org, userIds, period), billsByComponent(billCats, userIds, period, range.end)])
    : [new Map<string, Map<string, number>>(), new Map<string, Map<string, number>>()];
  const employeeById = new Map(employees.map((e) => [e.userId, e]));
  // Each person's flexible split (app › Payroll), month by month, over their structure's own values.
  const splits = await splitsByUser(org, userIds);

  const now = new Date();
  const slips: Payslip[] = [];

  for (const structure of structures) {
    const employee = employeeById.get(structure.userId);
    if (!employee) continue; // structure orphaned from its user; skip defensively

    // Resolve the assigned salary template; skip employees without one (SS-3).
    const template = structure.salaryTemplateCode
      ? templatesByCode.get(structure.salaryTemplateCode)
      : undefined;
    if (!template) continue;
    // The template plus this person's own add / remove / edit.
    const resolvedComponents = resolveTemplateComponents(applyOverrides(template.components, structure.overrides, catalogByCode), catalogByCode);
    // This month's one-time amounts: a component not on the salary is added
    // for this run; either way it is paid / taken at the amount HR typed.
    const amounts = runAmounts[structure.userId] ?? {};
    for (const code of Object.keys(amounts)) {
      const head = catalogByCode.get(code);
      if (!head) continue;
      const i = resolvedComponents.findIndex((h) => h.code === code);
      const runHead = { ...(i >= 0 ? resolvedComponents[i] : head), calculation: { mode: 'flat_amount' as const }, active: true };
      if (i >= 0) resolvedComponents[i] = runHead;
      else resolvedComponents.push(runHead);
    }

    const ruleSet = await resolveRuleSetCached(ruleSetCache, org, workStateOf(employee));
    // Joined during this month: paid from the joining day, PF ceilings counted from it.
    const joined = employee.joiningDate ? new Date(employee.joiningDate).toISOString().slice(0, 10) : undefined;
    // Not employed yet in this month (a run made for an earlier month): no payslip.
    if (joined && joined > `${period}-${String(range.daysInMonth).padStart(2, '0')}`) continue;
    const employedFrom = joined && joined.slice(0, 7) === period && joined > `${period}-01` ? joined : undefined;
    const notYetEmployedDays = employedFrom ? Number(employedFrom.slice(8, 10)) - 1 : 0;
    const salaryFor = (p: string, from?: string) => calculateSalaryStructure({
      monthlyCtcPaise: Math.round(structure.annualCtcPaise / 12),
      payHeads: resolvedComponents,
      componentValues: { ...(structure.componentValues ?? {}), ...splitAmountsFor(splits.get(structure.userId), p), ...amounts },
      balancingComponentCode: template.balancingComponentCode,
      ruleSet,
      month: Number(p.slice(5, 7)),
      period: p,
      bonusCategory: structure.bonusCategory,
      statutory: structure.statutory,
      settings,
      statutoryWages: template.statutoryWages,
      employedFrom: from,
    });
    const base = salaryFor(period, employedFrom);

    const periodInputs = await getEmployeePeriodInputs(structure.userId, range, { billCategories: [...billCats.keys()], reservedClaimIds });
    // Loss of pay: the calendar's absences and half days, plus whatever else
    // the template's rules dock, unless HR typed a figure on the run.
    // A template can switch paid-days calculation off: every day is paid.
    const paidDays = paidDaysFor(structure.paidDaysTemplateCode);
    const paidDaysOn = !(paidDays?.allDaysPaid ?? false);
    const docked = paidDaysOn ? payrollDeductions(paidDays?.deductionRules, attendance.get(structure.userId)) : { days: 0, lines: [] };
    // Leave without pay, on any template: the employee asked for it unpaid.
    const unpaidLeave = unpaidLeaveDeduction(attendance.get(structure.userId));
    // The template's paid-leave allowance covers the first days docked — not
    // leave without pay, which it would otherwise turn back into paid leave.
    const allowance = paidDaysOn ? paidDays?.monthlyPaidLeaveDays ?? 0 : 0;
    // Days before joining are not loss of pay but not paid either (attendance has no punches for them).
    const attendanceLopDays = Math.min(Math.max(Math.max(0, docked.days - allowance) + unpaidLeave.days, notYetEmployedDays), workingDays);
    const lopEnteredByHr = lopOverrides[structure.userId] !== undefined;
    const lopDays = lopEnteredByHr ? clampLop(lopOverrides[structure.userId], workingDays) : attendanceLopDays;
    // Overtime: what HR typed on the run, else the template's rule applied to
    // the month's approved overtime hours.
    const overtimeEnteredByHr = otOverrides[structure.userId] !== undefined && otOverrides[structure.userId] !== null;
    const overtimePaise = overtimeEnteredByHr
      ? nonNegInt(otOverrides[structure.userId])
      : overtimePayFor(template.overtimePay ?? undefined, periodInputs.approvedOtHours, {
        basicPaise: base.earnings.filter((l) => l.componentType === 'basic').reduce((t, l) => t + l.monthlyPaise, 0),
        grossPaise: base.earnings.filter((l) => !l.oneTime).reduce((t, l) => t + l.monthlyPaise, 0),
      }, workingDays);
    const incomeTaxEnteredByHr = taxOverrides[structure.userId] !== undefined;
    let incomeTaxPaise = nonNegInt(taxOverrides[structure.userId]);

    const slipInput = {
      workingDays,
      lopDays,
      overtimePaise,
      reimbursementsPaise: periodInputs.reimbursementsPaise,
      ruleSet,
      month: range.month,
      statutory: structure.statutory,
      settings,
      esiCoveredEarlier: esiCovered.has(structure.userId),
      incomeTaxPaise,
      period,
      employedFrom,
    };
    let slip = computePayslip(base, slipInput);
    // Income tax from the TDS engine, when the org has it on and HR didn't type one.
    let tds: PayslipInputs['tds'];
    let reimbTax: ReimbursementTax | undefined;
    if (!incomeTaxEnteredByHr && tdsOn) {
      const declaration = declarations.get(structure.userId);
      const futureTaxable = taxableAfterMealExemption(
        base.earnings.filter((l) => !l.oneTime).map((l) => ({ taxable: l.taxable, componentType: l.componentType, amountPaise: l.monthlyPaise })),
      );
      // The months still to come on each month's own structure (a PF ceiling change moves the balance), as Zoho projects;
      // their salary reimbursements count as taxable (no bills for them yet).
      const taxableReimb = (lines: { code: string; monthlyPaise: number }[]) =>
        lines.filter((l) => catalogByCode.get(l.code)?.taxable !== false).reduce((t, l) => t + l.monthlyPaise, 0);
      const futureTaxablePaise = periodsAfter(period).reduce((t, p) => {
        const later = salaryFor(p);
        return t + projectedTaxable(later) + taxableReimb(later.reimbursements ?? []);
      }, 0);
      // This year's reimbursements so far less the bills approved so far: a late bill lowers the tax from now on.
      reimbTax = reimbursementTax(addInto(new Map(reimbPaidBefore.get(structure.userId) ?? []), slip.reimbursementLines), bills.get(structure.userId), catalogByCode);
      const byType = (type: string) => base.earnings.filter((l) => l.componentType === type).reduce((t, l) => t + l.monthlyPaise, 0);
      const result = runTds({
        configs: tdsConfigs,
        regime: declaration?.regime ?? settings.tds!.defaultRegime,
        period,
        ytd: ytd.get(structure.userId),
        currentTaxablePaise: slip.taxablePaise + reimbTax.taxablePaise,
        futureMonthlyTaxablePaise: futureTaxable,
        futureTaxablePaise,
        basicMonthlyPaise: byType('basic'),
        hraMonthlyPaise: byType('hra'),
        employeePfMonthlyPaise: base.statutory.epf.employeePaise,
        ptMonthlyPaise: base.statutory.pt.amountPaise,
        declarations: declaration?.declarations,
      });
      if (result) {
        tds = { ...result, proofs: declaration?.proofs ?? 'none' };
        incomeTaxPaise = result.monthlyTdsPaise;
        slip = computePayslip(base, { ...slipInput, incomeTaxPaise });
      }
    }

    slips.push({
      org,
      runId: runIdHex,
      period,
      userId: structure.userId,
      employeeName: employee.name,
      department: employee.department,
      employeeId: employee.employeeId,
      designation: employee.designation,
      joiningDate: employee.joiningDate,
      annualCtcPaise: structure.annualCtcPaise,
      monthlyCtcPaise: Math.round(structure.annualCtcPaise / 12),
      earnings: slip.earnings.map((e) => ({
        code: e.code,
        name: e.name,
        ...(e.hidden ? { hidden: true } : {}),
        calcLabel: e.calcLabel,
        fullPaise: e.fullPaise,
        paidPaise: e.paidPaise,
      })),
      deductions: slip.deductions,
      pfWagePaise: slip.pfWagePaise,
      grossPaise: slip.grossPaise,
      taxablePaise: slip.taxablePaise,
      employeeDeductionsPaise: slip.employeeDeductionsPaise,
      netPaise: slip.netPaise,
      reimbursementsPaise: slip.reimbursementsPaise,
      netPayablePaise: slip.netPayablePaise,
      employerCostPaise: slip.employerCostPaise,
      esiApplicable: slip.esiApplicable,
      reimbursementLines: slip.reimbursementLines,
      employer: slip.employer,
      epf: slip.epf,
      inputs: {
        workingDays,
        lopDays,
        attendanceLopDays,
        lopEnteredByHr,
        incomeTaxPaise,
        incomeTaxEnteredByHr,
        overtimeEnteredByHr,
        ...(Object.keys(amounts).length ? { componentAmounts: amounts } : {}),
        ...(tds ? { tds } : {}),
        ...(reimbTax && reimbTax.paidPaise > 0 ? { reimbursementTax: { paidPaise: reimbTax.paidPaise, exemptPaise: reimbTax.exemptPaise, taxablePaise: reimbTax.taxablePaise } } : {}),
        attendanceDeductions: [...docked.lines, ...unpaidLeave.lines],
        paidLeaveDaysApplied: Math.min(allowance, docked.days),
        payableDays: slip.payableDays,
        approvedLeaveDays: periodInputs.approvedLeaveDays,
        approvedOtHours: periodInputs.approvedOtHours,
        overtimePaise,
        reimbursementsPaise: periodInputs.reimbursementsPaise,
        reimbursementClaimIds: periodInputs.reimbursementClaimIds,
      },
      createdAt: now,
    });
  }

  if (slips.length === 0) {
    throw new PayrollRunError(409, 'No payslips could be generated for this period');
  }
  return slips;
}

export async function listRuns(adminUserId: string) {
  const org = await requireAdminOrg(adminUserId);
  const runs = await payrollRuns().find({ org }).sort({ period: -1 }).toArray();
  return runs.map(runView);
}

export async function getRun(adminUserId: string, runIdInput: string) {
  const org = await requireAdminOrg(adminUserId);
  // The run, its payslips, the company and the approver count do not depend
  // on one another, so they are asked for together rather than in turn.
  const runHex = ObjectId.isValid(runIdInput) ? new ObjectId(runIdInput).toHexString() : '';
  const [run, slips, company, approvers] = await Promise.all([
    findOwnedRun(org, runIdInput),
    runHex ? payslips().find({ org, runId: runHex }).toArray() : Promise.resolve([]),
    companyOf(org),
    otherRunApprovers(org, adminUserId),
  ]);
  const creatorMayApprove = run.createdByUserId === adminUserId && approvers === 0;
  return { run: { ...runView(run), creatorMayApprove }, payslips: await slipsForDisplay(org, slips, true), company };
}

/**
 * How many other people in the company could approve a run: dashboard users
 * who still work there and can open Payroll Runs (an admin, a full-access
 * user, or one given that tab).
 */
async function otherRunApprovers(org: string, userId: string): Promise<number> {
  return users().countDocuments({
    org,
    userId: { $ne: userId },
    dashboardAccess: true,
    lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
    $or: [{ dashboardAdmin: true }, { dashboardTabs: { $exists: false } }, { dashboardTabs: 'payruns' }],
  } as never);
}

/**
 * One employee's payslips, newest period first, each with the run it came
 * from — a draft is a preview, an approved or paid one is the record.
 */
export async function employeePayslips(adminUserId: string, userId: string) {
  const org = await requireAdminOrg(adminUserId);
  // The org's runs (one a month) come with the payslips rather than after
  // them; only the ones these payslips came from are used.
  const [slips, runs, company] = await Promise.all([
    payslips().find({ org, userId }).sort({ period: -1 }).toArray(),
    payrollRuns().find({ org }).toArray(),
    companyOf(org),
  ]);
  const runById = new Map(runs.map((run) => [run._id.toHexString(), run as StoredRun]));
  const kept = slips.filter((slip) => runById.has(slip.runId));
  const shown = await slipsForDisplay(org, kept, true);
  return {
    company,
    payslips: kept.map((slip, i) => ({ run: runView(runById.get(slip.runId)!), payslip: shown[i] })),
  };
}

// ------------------------------------------------------------- an employee's own slips

const MY_PAYSLIPS = 3;

/** Runs whose payslips the employee may see: a draft or one awaiting approval is not final. */
const RELEASED: PayrollRunStatus[] = ['approved', 'paid'];

async function ownedPayslip(userId: string, payslipId: string) {
  if (!ObjectId.isValid(payslipId)) throw new PayrollRunError(404, 'Payslip not found');
  const slip = await payslips().findOne({ _id: new ObjectId(payslipId), userId });
  if (!slip || !ObjectId.isValid(slip.runId)) throw new PayrollRunError(404, 'Payslip not found');
  const run = await payrollRuns().findOne({ _id: new ObjectId(slip.runId), status: { $in: RELEASED } }, { projection: { _id: 1 } });
  if (!run) throw new PayrollRunError(404, 'Payslip not found');
  return slip;
}

/** The company as its payslips print it: registered name and address from the Organisation profile. */
export async function companyOf(org: string) {
  const company = (await companies().findOne({ id: org })) as (Record<string, unknown> & { name?: string; address?: string; profile?: Record<string, string | undefined> }) | null;
  const pr = company?.profile ?? {};
  const address = [pr.addressLine1, pr.addressLine2, pr.city, pr.state, pr.pincode, pr.country ?? pr.addressCountry]
    .map((x) => (x ?? '').trim()).filter(Boolean).join(', ');
  return { name: pr.registeredName?.trim() || company?.name || org, address: address || company?.address || '', org };
}

/**
 * Year to date for each payslip: this financial year's payslips of the same
 * person up to and including its month (runs not rejected), summed per line,
 * as the YTD column of the payslip.
 */
async function withYtd<T extends ReturnType<typeof payslipView>>(org: string, views: T[]): Promise<(T & { ytd: { earnings: Record<string, number>; deductions: Record<string, number>; reimbursementsPaise: number } })[]> {
  if (views.length === 0) return [];
  const userIds = [...new Set(views.map((v) => v.userId))];
  const periods = views.map((v) => v.period).sort();
  const from = fyOf(periods[0]).firstPeriod;
  // The org's live runs (one a month) come with the rows rather than after
  // them: a payslip belongs to a run of its own org, so the answer is the same.
  const [rows, liveRuns] = await Promise.all([
    payslips().find({ org, userId: { $in: userIds }, period: { $gte: from, $lte: periods[periods.length - 1] } }).toArray(),
    payrollRuns().find({ org, status: { $ne: 'rejected' } }, { projection: { _id: 1 } }).toArray(),
  ]);
  const live = new Set(liveRuns.map((r) => r._id.toHexString()));
  return views.map((v) => {
    const fy = fyOf(v.period).firstPeriod;
    const earnings: Record<string, number> = {};
    const deductions: Record<string, number> = {};
    let reimbursementsPaise = 0;
    for (const r of rows) {
      if (r.userId !== v.userId || r.period < fy || r.period > v.period || !live.has(r.runId)) continue;
      for (const e of r.earnings ?? []) earnings[e.code] = (earnings[e.code] ?? 0) + e.paidPaise;
      for (const d of r.deductions ?? []) deductions[d.key] = (deductions[d.key] ?? 0) + d.amountPaise;
      reimbursementsPaise += r.reimbursementsPaise ?? 0;
    }
    return { ...v, ytd: { earnings, deductions, reimbursementsPaise } };
  });
}

/** Each person's bank account number for their payslip, in full only to payroll people (and to them). */
async function bankAccounts(org: string, userIds: string[], reveal: boolean): Promise<Map<string, string>> {
  const docs = await employeePaymentDetails().find({ org, userId: { $in: userIds } } as never).toArray() as unknown as { userId: string; accountNumber?: string; accountLast4?: string }[];
  const out = new Map<string, string>();
  for (const d of docs) {
    if (!d.accountNumber) continue;
    let shown = d.accountLast4 ? `XXXX${d.accountLast4}` : '';
    if (reveal && fieldKeyConfigured()) {
      try { shown = decryptField(d.accountNumber); } catch { /* key changed: keep the masked form */ }
    }
    if (shown) out.set(d.userId, shown);
  }
  return out;
}

/** The payslip as the dashboard and app show it: with YTD and the bank account. */
async function slipsForDisplay(org: string, slips: (Payslip & { _id?: ObjectId })[], revealBank: boolean) {
  const [views, banks] = await Promise.all([
    withYtd(org, slips.map(payslipView)),
    bankAccounts(org, [...new Set(slips.map((s) => s.userId))], revealBank),
  ]);
  return views.map((v) => ({ ...v, bankAccountNo: banks.get(v.userId) }));
}

/**
 * The signed-in person's last few payslips, newest period first, with the run
 * each came from. Only approved or paid runs: a draft or a run awaiting
 * approval is still being worked on and is never shown to the employee.
 */
export async function myPayslips(userId: string, limit = MY_PAYSLIPS) {
  const all = await payslips().find({ userId }).sort({ period: -1, createdAt: -1 }).limit(60).toArray();
  const runIds = [...new Set(all.map((s) => s.runId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const runs = runIds.length ? await payrollRuns().find({ _id: { $in: runIds }, status: { $in: RELEASED } }).toArray() : [];
  const runById = new Map(runs.map((run) => [run._id.toHexString(), run as StoredRun]));
  const slips = all.filter((s) => runById.has(s.runId)).slice(0, Math.min(Math.max(1, Math.floor(limit) || MY_PAYSLIPS), 24));
  if (slips.length === 0) return { company: null, payslips: [] };
  const [shown, company] = await Promise.all([slipsForDisplay(slips[0].org, slips, true), companyOf(slips[0].org)]);
  return {
    company,
    payslips: slips.map((s, i) => ({ run: runView(runById.get(s.runId)!), payslip: shown[i] })),
  };
}

/** One of the signed-in person's released payslips, as the list shows it. */
export async function myPayslip(userId: string, payslipId: string) {
  const slip = await ownedPayslip(userId, payslipId);
  const [run, shown, company] = await Promise.all([
    payrollRuns().findOne({ _id: new ObjectId(slip.runId) }),
    slipsForDisplay(slip.org, [slip], true),
    companyOf(slip.org),
  ]);
  return { company, run: runView(run as StoredRun), payslip: shown[0] };
}

/** The person's released payslip for a month, if there is one (the newest run's). */
export async function myReleasedPayslipFor(userId: string, period: string) {
  const slips = await payslips().find({ userId, period }).sort({ createdAt: -1 }).toArray();
  for (const slip of slips) {
    if (!ObjectId.isValid(slip.runId)) continue;
    const run = await payrollRuns().findOne({ _id: new ObjectId(slip.runId), status: { $in: RELEASED } }, { projection: { _id: 1 } });
    if (run) return slip;
  }
  return null;
}

/** The person's latest released payslip before a month, for an estimate's income tax. */
export async function myLatestReleasedPayslipBefore(userId: string, period: string) {
  const slips = await payslips().find({ userId, period: { $lt: period } }).sort({ period: -1, createdAt: -1 }).limit(6).toArray();
  for (const slip of slips) {
    if (!ObjectId.isValid(slip.runId)) continue;
    const run = await payrollRuns().findOne({ _id: new ObjectId(slip.runId), status: { $in: RELEASED } }, { projection: { _id: 1 } });
    if (run) return slip;
  }
  return null;
}

export async function myPayslipHtml(userId: string, payslipId: string): Promise<string> {
  const slip = await ownedPayslip(userId, payslipId);
  return payslipHtml(payslipView(slip), await companyOf(slip.org));
}

/** The graded month behind a slip, so the app can show why pay was lost. */
export async function myPayslipCalendar(userId: string, payslipId: string) {
  const slip = await ownedPayslip(userId, payslipId);
  return employeeCalendar(userId, userId, slip.period);
}

/**
 * Submit a run: it is final at once, with no second approval. Payslips reach
 * employees, the month's days are locked, and the reimbursement claims paid in
 * it are settled so no later run pays them again. A run made under the old
 * approval step (awaiting approval) is submitted the same way.
 */
export async function submitRun(adminUserId: string, runIdInput: string) {
  const org = await requireAdminOrg(adminUserId);
  const run = await findOwnedRun(org, runIdInput);
  assertTransition(run.status, 'paid');
  // A claim on this run that was paid or changed since it was calculated would be paid twice.
  const stale = await staleClaims(org, run);
  if (stale > 0) {
    throw new PayrollRunError(409, `${stale} reimbursement claim${stale === 1 ? ' on this run was' : 's on this run were'} paid or changed since it was calculated. ${run.status === 'draft' ? 'Recalculate' : 'Reopen and recalculate'} the run, then submit.`);
  }
  await settleClaims(org, run, 'paid');
  const now = new Date();
  return runView(await patchRun(run._id, { status: 'paid', submittedByUserId: adminUserId, decidedByUserId: adminUserId, decidedAt: now, paidAt: now }));
}

/** How many of a run's claims are no longer approved-and-unpaid. */
async function staleClaims(org: string, run: StoredRun): Promise<number> {
  const slips = await payslips().find({ org, runId: run._id.toHexString() }, { projection: { inputs: 1 } }).toArray();
  const ids = slips.flatMap((s) => s.inputs.reimbursementClaimIds ?? []).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (ids.length === 0) return 0;
  return reimbursementClaims().countDocuments({ _id: { $in: ids }, status: { $ne: 'approved' } });
}

/** The reimbursement claims paid in a run: settled when it is submitted, open again when it is reopened. */
async function settleClaims(org: string, run: StoredRun, to: 'paid' | 'approved') {
  const slips = await payslips().find({ org, runId: run._id.toHexString() }, { projection: { inputs: 1 } }).toArray();
  const claimIds = slips
    .flatMap((slip) => slip.inputs.reimbursementClaimIds ?? [])
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (claimIds.length === 0) return;
  const at = new Date();
  await reimbursementClaims().updateMany(
    { _id: { $in: claimIds }, status: to === 'paid' ? 'approved' : 'paid' },
    to === 'paid' ? { $set: { status: 'paid', paidAt: at, updatedAt: at } } : { $set: { status: 'approved', updatedAt: at }, $unset: { paidAt: '' } },
  );
}

export async function decideRun(
  adminUserId: string,
  runIdInput: string,
  decisionInput: string,
  note?: string,
) {
  const org = await requireAdminOrg(adminUserId);
  const run = await findOwnedRun(org, runIdInput);
  const decision = decisionInput.trim().toLowerCase();
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new PayrollRunError(400, 'decision must be "approved" or "rejected"');
  }
  // A second person approves, unless the company has nobody else who could:
  // a one-person payroll team must still be able to finish a month.
  if (run.createdByUserId === adminUserId && (await otherRunApprovers(org, adminUserId)) > 0) {
    throw new PayrollRunError(403, 'You cannot approve a payroll run you created');
  }
  assertTransition(run.status, decision as PayrollRunStatus);
  const trimmedNote = note?.trim();
  if (trimmedNote && trimmedNote.length > 500) {
    throw new PayrollRunError(400, 'note is too long');
  }
  return runView(
    await patchRun(run._id, {
      status: decision as PayrollRunStatus,
      decidedByUserId: adminUserId,
      decidedAt: new Date(),
      ...(trimmedNote ? { note: trimmedNote } : {}),
    }),
  );
}

/** Reopen a submitted (or rejected) run as a draft so it can be corrected and recomputed. */
export async function recallRun(adminUserId: string, runIdInput: string) {
  const org = await requireAdminOrg(adminUserId);
  const run = await findOwnedRun(org, runIdInput);
  assertTransition(run.status, 'draft');
  if (run.status === 'paid') {
    const later = await payrollRuns().findOne({ org, period: { $gt: run.period }, status: 'paid' }, { projection: { period: 1 } });
    if (later) throw new PayrollRunError(409, `${later.period} is already submitted and was worked out from this month: reopen that one first`);
  }
  // Its claims are paid again by the corrected run, not lost.
  if (run.status === 'paid') await settleClaims(org, run, 'approved');
  return runView(await patchRun(run._id, { status: 'draft' }));
}

/**
 * Mark an approved run as paid. Side effect: the approved reimbursement claims
 * that were bundled into these payslips are moved to 'paid' so they are not paid
 * again in a later cycle.
 */
export async function markRunPaid(adminUserId: string, runIdInput: string) {
  const org = await requireAdminOrg(adminUserId);
  const run = await findOwnedRun(org, runIdInput);
  assertTransition(run.status, 'paid');

  const slips = await payslips().find({ org, runId: run._id.toHexString() }).toArray();
  const claimIds = slips
    .flatMap((slip) => slip.inputs.reimbursementClaimIds)
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (claimIds.length > 0) {
    const paidAt = new Date();
    await reimbursementClaims().updateMany(
      { _id: { $in: claimIds }, status: 'approved' },
      { $set: { status: 'paid', paidAt, updatedAt: paidAt } },
    );
  }

  return runView(await patchRun(run._id, { status: 'paid', paidAt: new Date() }));
}

// ————————————————————————————————————————————————————————————————
// Lifecycle
// ————————————————————————————————————————————————————————————————

const ALLOWED: Record<PayrollRunStatus, PayrollRunStatus[]> = {
  // Submit takes a draft straight to final ('paid'); the approval states are kept for runs made before.
  draft: ['paid', 'pending_approval'],
  pending_approval: ['paid', 'approved', 'rejected', 'draft'],
  rejected: ['draft'],
  approved: ['paid', 'draft'],
  paid: ['draft'],
};

function assertTransition(from: PayrollRunStatus, to: PayrollRunStatus): void {
  if (!ALLOWED[from].includes(to)) {
    throw new PayrollRunError(409, `Cannot move a run from "${from}" to "${to}"`);
  }
}

// ————————————————————————————————————————————————————————————————
// Helpers
// ————————————————————————————————————————————————————————————————

type StoredRun = PayrollRun & { _id: ObjectId };

async function resolveRuleSetCached(
  cache: Map<string, ResolvedRuleSet>,
  org: string,
  state: string | undefined,
): Promise<ResolvedRuleSet> {
  const key = (state ?? '').trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const resolved = await resolveRuleSet(org, state);
  cache.set(key, resolved);
  return resolved;
}

function sumTotals(slips: Payslip[]): PayrollRunTotals {
  return slips.reduce<PayrollRunTotals>(
    (acc, slip) => ({
      grossPaise: acc.grossPaise + slip.grossPaise,
      employeeDeductionsPaise: acc.employeeDeductionsPaise + slip.employeeDeductionsPaise,
      netPaise: acc.netPaise + slip.netPaise,
      reimbursementsPaise: acc.reimbursementsPaise + slip.reimbursementsPaise,
      employerCostPaise: acc.employerCostPaise + slip.employerCostPaise,
    }),
    { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 },
  );
}

/** Per person, per code: whole non-negative paise only. */
function cleanAmounts(raw: unknown): Amounts {
  const out: Amounts = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [userId, codes] of Object.entries(raw as Record<string, unknown>)) {
    if (!codes || typeof codes !== 'object') continue;
    for (const [code, v] of Object.entries(codes as Record<string, unknown>)) {
      const n = Number(v);
      if (v === null || !Number.isFinite(n) || n < 0) continue;
      (out[userId] ??= {})[code.trim().toUpperCase()] = Math.round(n);
    }
  }
  return out;
}

/** Earlier one-time amounts on the run, with this call's changes (null clears a code, or a person's all). */
function mergeAmounts(previous: Map<string, Payslip>, given: Record<string, Record<string, number | null> | null> | undefined): Amounts {
  const out: Amounts = {};
  for (const [userId, slip] of previous) if (slip.inputs.componentAmounts) out[userId] = { ...slip.inputs.componentAmounts };
  for (const [userId, codes] of Object.entries(given ?? {})) {
    if (codes === null) { delete out[userId]; continue; }
    const mine = { ...(out[userId] ?? {}) };
    for (const [code, v] of Object.entries(codes)) {
      const c = code.trim().toUpperCase();
      if (v === null || v === undefined) delete mine[c];
      else if (Number.isFinite(Number(v)) && Number(v) >= 0) mine[c] = Math.round(Number(v));
    }
    if (Object.keys(mine).length) out[userId] = mine;
    else delete out[userId];
  }
  return out;
}

function clampLop(value: unknown, workingDays: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Half days are real: a half day costs half a day's pay.
  return Math.min(Math.floor(n * 2) / 2, workingDays);
}

function nonNegInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

async function patchRun(id: ObjectId, patch: Partial<PayrollRun>): Promise<StoredRun> {
  const updated = await payrollRuns().findOneAndUpdate(
    { _id: id },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new PayrollRunError(404, 'Payroll run not found');
  return updated as StoredRun;
}

async function findOwnedRun(org: string, runIdInput: string): Promise<StoredRun> {
  if (!ObjectId.isValid(runIdInput)) throw new PayrollRunError(400, 'Invalid run ID');
  const run = await payrollRuns().findOne({ _id: new ObjectId(runIdInput), org });
  if (!run) throw new PayrollRunError(404, 'Payroll run not found');
  return run as StoredRun;
}

export async function requireAdminOrg(adminUserId: string): Promise<string> {
  const admin = requestViewer(adminUserId) ?? (await users().findOne({ userId: adminUserId }));
  if (!admin) throw new PayrollRunError(404, 'User not found');
  if (!admin.org) throw new PayrollRunError(409, 'User is not attached to a company');
  return admin.org;
}

function runView(run: StoredRun) {
  return {
    id: run._id.toHexString(),
    period: run.period,
    runType: run.runType,
    status: run.status,
    employeeCount: run.employeeCount,
    totals: run.totals,
    note: run.note,
    createdByUserId: run.createdByUserId,
    submittedByUserId: run.submittedByUserId,
    decidedByUserId: run.decidedByUserId,
    decidedAt: run.decidedAt?.toISOString(),
    paidAt: run.paidAt?.toISOString(),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function payslipView(slip: Payslip & { _id?: ObjectId }) {
  return {
    id: slip._id?.toHexString(),
    userId: slip.userId,
    employeeName: slip.employeeName,
    department: slip.department,
    employeeId: slip.employeeId,
    designation: slip.designation,
    joiningDate: slip.joiningDate ? slip.joiningDate.toISOString().slice(0, 10) : undefined,
    period: slip.period,
    monthlyCtcPaise: slip.monthlyCtcPaise,
    earnings: slip.earnings,
    deductions: slip.deductions,
    pfWagePaise: slip.pfWagePaise,
    grossPaise: slip.grossPaise,
    employeeDeductionsPaise: slip.employeeDeductionsPaise,
    netPaise: slip.netPaise,
    reimbursementsPaise: slip.reimbursementsPaise,
    netPayablePaise: slip.netPayablePaise,
    employerCostPaise: slip.employerCostPaise,
    esiApplicable: slip.esiApplicable,
    reimbursementLines: slip.reimbursementLines ?? [],
    employer: slip.employer,
    annualCtcPaise: slip.annualCtcPaise,
    epf: slip.epf,
    inputs: slip.inputs,
  };
}
