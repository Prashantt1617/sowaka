import { ObjectId } from 'mongodb';
import {
  payHeads,
  payrollRuns,
  payslips,
  reimbursementClaims,
  salaryStructures,
  salaryTemplates,
  users,
} from '../config/db';
import {
  Payslip,
  PayslipInputs,
  PayrollRun,
  PayrollRunStatus,
  PayrollRunTotals,
} from '../models/payrollRun.model';
import { ResolvedRuleSet } from '../models/statutoryRule.model';
import { User } from '../models/user.model';
import { calculateSalaryStructure } from './salary-calculator';
import { applyOverrides, resolveTemplateComponents } from './salaryTemplate.service';
import { esiCoveredThisPeriod, statutorySettingsFor, workStateOf } from './statutorySettings.service';
import { computePayslip, taxableAfterMealExemption } from './payroll-run.calculator';
import { overtimePayFor } from '../shared/payroll/overtime';
import {
  computeWorkingDays,
  getEmployeePeriodInputs,
  parsePeriod,
} from './payroll-inputs.service';
import type { PeriodRange } from './payroll-inputs.service';
import { resolveRuleSet } from './statutory.service';
import { attendanceCountsForPeriod, payrollDeductions } from './deduction.service';
import { payslipHtml } from './payslip-html';
import { employeeCalendar } from './attendance-report.service';
import { companies } from '../config/db';
import { isEncryptedOrg } from './payrollCrypto.service';
import { declarationsFor, runTds, tdsConfigsFor, ytdFor } from './tds.service';
import { fyOf } from '../shared/payroll/tds';

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
  await refuseIfEncrypted(org);
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
  await refuseIfEncrypted(org);
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
  const docksForAttendance = templates.some((t) => t.paidDaysEnabled ?? true);
  const attendance = docksForAttendance ? await attendanceCountsForPeriod(adminUserId, period) : new Map();

  const employees = await users()
    .find({ userId: { $in: structures.map((s) => s.userId) } })
    .toArray();
  // The TDS engine, when the org has switched it on and the FY has config rows.
  const { fy } = fyOf(period);
  const tdsConfigs = settings.tds?.enabled ? await tdsConfigsFor(fy) : new Map();
  const tdsOn = tdsConfigs.size > 0;
  const userIds = structures.map((s) => s.userId);
  const [ytd, declarations] = tdsOn ? await Promise.all([ytdFor(org, period, userIds), declarationsFor(org, fy, userIds)]) : [new Map(), new Map()];
  const employeeById = new Map(employees.map((e) => [e.userId, e]));

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
    const base = calculateSalaryStructure({
      monthlyCtcPaise: Math.round(structure.annualCtcPaise / 12),
      payHeads: resolvedComponents,
      componentValues: { ...(structure.componentValues ?? {}), ...amounts },
      balancingComponentCode: template.balancingComponentCode,
      ruleSet,
      month: range.month,
      period,
      bonusCategory: structure.bonusCategory,
      statutory: structure.statutory,
      settings,
      statutoryWages: template.statutoryWages,
    });

    const periodInputs = await getEmployeePeriodInputs(structure.userId, range);
    // Loss of pay: the calendar's absences and half days, plus whatever else
    // the template's rules dock, unless HR typed a figure on the run.
    // A template can switch paid-days calculation off: every day is paid.
    const paidDaysOn = template.paidDaysEnabled ?? true;
    const docked = paidDaysOn ? payrollDeductions(template.deductionRules, attendance.get(structure.userId)) : { days: 0, lines: [] };
    // The template's paid-leave allowance covers the first days docked.
    const allowance = paidDaysOn ? template.monthlyPaidLeaveDays ?? 0 : 0;
    const attendanceLopDays = Math.min(Math.max(0, docked.days - allowance), workingDays);
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
    };
    let slip = computePayslip(base, slipInput);
    // Income tax from the TDS engine, when the org has it on and HR didn't type one.
    let tds: PayslipInputs['tds'];
    if (!incomeTaxEnteredByHr && tdsOn) {
      const declaration = declarations.get(structure.userId);
      const futureTaxable = taxableAfterMealExemption(
        base.earnings.filter((l) => !l.oneTime).map((l) => ({ taxable: l.taxable, componentType: l.componentType, amountPaise: l.monthlyPaise })),
      );
      const byType = (type: string) => base.earnings.filter((l) => l.componentType === type).reduce((t, l) => t + l.monthlyPaise, 0);
      const result = runTds({
        configs: tdsConfigs,
        regime: declaration?.regime ?? settings.tds!.defaultRegime,
        period,
        ytd: ytd.get(structure.userId),
        currentTaxablePaise: slip.taxablePaise,
        futureMonthlyTaxablePaise: futureTaxable,
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
        attendanceDeductions: docked.lines,
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
  const run = await findOwnedRun(org, runIdInput);
  // One round trip for both: on a slow link each trip is seconds.
  const [slips, company] = await Promise.all([
    payslips().find({ org, runId: run._id.toHexString() }).toArray(),
    // The slip is printed under the company's name and address.
    companies().findOne({ id: org }, { projection: { name: 1, address: 1 } }),
  ]);
  const creatorMayApprove = run.createdByUserId === adminUserId && (await otherRunApprovers(org, adminUserId)) === 0;
  return { run: { ...runView(run), creatorMayApprove }, payslips: slips.map(payslipView), company: { name: company?.name ?? org, address: company?.address ?? '' } };
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
  const slips = await payslips().find({ org, userId }).sort({ period: -1 }).toArray();
  const runIds = [...new Set(slips.map((slip) => slip.runId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const runs = await payrollRuns().find({ org, _id: { $in: runIds } }).toArray();
  const runById = new Map(runs.map((run) => [run._id.toHexString(), run as StoredRun]));
  const company = await companies().findOne({ id: org }, { projection: { name: 1, address: 1 } });
  return {
    company: { name: company?.name ?? org, address: company?.address ?? '' },
    payslips: slips
      .filter((slip) => runById.has(slip.runId))
      .map((slip) => ({ run: runView(runById.get(slip.runId)!), payslip: payslipView(slip) })),
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

async function companyOf(org: string) {
  const company = await companies().findOne({ id: org }, { projection: { name: 1, address: 1 } });
  return { name: company?.name ?? org, address: company?.address ?? '' };
}

/**
 * The signed-in person's last few payslips, newest period first, with the run
 * each came from. Only approved or paid runs: a draft or a run awaiting
 * approval is still being worked on and is never shown to the employee.
 */
export async function myPayslips(userId: string) {
  const all = await payslips().find({ userId }).sort({ period: -1, createdAt: -1 }).limit(60).toArray();
  const runIds = [...new Set(all.map((s) => s.runId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const runs = runIds.length ? await payrollRuns().find({ _id: { $in: runIds }, status: { $in: RELEASED } }).toArray() : [];
  const runById = new Map(runs.map((run) => [run._id.toHexString(), run as StoredRun]));
  // A sealed slip only opens with the employee's own key; the app can't yet, so it isn't listed.
  const slips = all.filter((s) => runById.has(s.runId) && !s.sealed).slice(0, MY_PAYSLIPS);
  if (slips.length === 0) return { company: null, payslips: [] };
  return {
    company: await companyOf(slips[0].org),
    payslips: slips.map((s) => ({ run: runView(runById.get(s.runId)!), payslip: payslipView(s) })),
  };
}

export async function myPayslipHtml(userId: string, payslipId: string): Promise<string> {
  const slip = await ownedPayslip(userId, payslipId);
  // Sealed (end-to-end encrypted org): the server holds zeros; only the employee's key opens it.
  if (slip.sealed) throw new PayrollRunError(409, 'This payslip is encrypted: open it in the app');
  return payslipHtml(payslipView(slip), await companyOf(slip.org));
}

/** The graded month behind a slip, so the app can show why pay was lost. */
export async function myPayslipCalendar(userId: string, payslipId: string) {
  const slip = await ownedPayslip(userId, payslipId);
  return employeeCalendar(userId, userId, slip.period);
}

export async function submitRun(adminUserId: string, runIdInput: string) {
  const org = await requireAdminOrg(adminUserId);
  const run = await findOwnedRun(org, runIdInput);
  assertTransition(run.status, 'pending_approval');
  return runView(await patchRun(run._id, { status: 'pending_approval', submittedByUserId: adminUserId }));
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

/** Recall a submitted or rejected run back to Draft so it can be amended and recomputed. */
export async function recallRun(adminUserId: string, runIdInput: string) {
  const org = await requireAdminOrg(adminUserId);
  const run = await findOwnedRun(org, runIdInput);
  assertTransition(run.status, 'draft');
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
  draft: ['pending_approval'],
  pending_approval: ['approved', 'rejected', 'draft'],
  rejected: ['draft'],
  approved: ['paid', 'draft'],
  paid: [],
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

/** An encrypted org's runs are computed and sealed in the browser (sealedPayroll.service). */
async function refuseIfEncrypted(org: string): Promise<void> {
  if (await isEncryptedOrg(org)) throw new PayrollRunError(409, 'This organisation’s salaries are encrypted: unlock them in the dashboard to run payroll');
}

async function requireAdminOrg(adminUserId: string): Promise<string> {
  const admin: User | null = await users().findOne({ userId: adminUserId });
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
    ...(run.sealedTotals ? { sealedTotals: run.sealedTotals } : {}),
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
    ...(slip.sealed ? { sealed: slip.sealed } : {}),
    ...(slip.sealedForEmployee ? { sealedForEmployee: slip.sealedForEmployee } : {}),
    epf: slip.epf,
    inputs: slip.inputs,
  };
}
