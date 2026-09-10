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
  PayrollRun,
  PayrollRunStatus,
  PayrollRunTotals,
} from '../models/payrollRun.model';
import { ResolvedRuleSet } from '../models/statutoryRule.model';
import { User } from '../models/user.model';
import { calculateSalaryStructure } from './salary-calculator';
import { resolveTemplateComponents } from './salaryTemplate.service';
import { computePayslip } from './payroll-run.calculator';
import {
  computeWorkingDays,
  getEmployeePeriodInputs,
  parsePeriod,
} from './payroll-inputs.service';
import type { PeriodRange } from './payroll-inputs.service';
import { resolveRuleSet } from './statutory.service';

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
}

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
  const slips = await buildRunPayslips(
    org,
    runId.toHexString(),
    input.period,
    range,
    input.lopDays ?? {},
    input.overtimePaise ?? {},
  );

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
  input: { lopDays?: Record<string, number>; overtimePaise?: Record<string, number> },
) {
  const org = await requireAdminOrg(adminUserId);
  const run = await findOwnedRun(org, runIdInput);
  if (run.status !== 'draft') {
    throw new PayrollRunError(409, 'Only draft runs can be recomputed');
  }
  const range = parsePeriod(run.period);
  const runIdHex = run._id.toHexString();
  const slips = await buildRunPayslips(
    org,
    runIdHex,
    run.period,
    range,
    input.lopDays ?? {},
    input.overtimePaise ?? {},
  );
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
  org: string,
  runIdHex: string,
  period: string,
  range: PeriodRange,
  lopOverrides: Record<string, number>,
  otOverrides: Record<string, number>,
): Promise<Payslip[]> {
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

  const employees = await users()
    .find({ userId: { $in: structures.map((s) => s.userId) } })
    .toArray();
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
    const resolvedComponents = resolveTemplateComponents(template.components, catalogByCode);

    const ruleSet = await resolveRuleSetCached(ruleSetCache, org, employee.state);
    const base = calculateSalaryStructure({
      monthlyCtcPaise: Math.round(structure.annualCtcPaise / 12),
      payHeads: resolvedComponents,
      componentValues: structure.componentValues,
      balancingComponentCode: template.balancingComponentCode,
      epfApplyCeiling: template.epfApplyCeiling,
      ruleSet,
      month: range.month,
      bonusCategory: structure.bonusCategory,
      statutory: structure.statutory,
    });

    const periodInputs = await getEmployeePeriodInputs(structure.userId, range);
    const lopDays = clampLop(lopOverrides[structure.userId], workingDays);
    const overtimePaise = nonNegInt(otOverrides[structure.userId]);

    const slip = computePayslip(base, {
      workingDays,
      lopDays,
      overtimePaise,
      reimbursementsPaise: periodInputs.reimbursementsPaise,
      epfApplyCeiling: template.epfApplyCeiling,
      ruleSet,
      month: range.month,
      statutory: structure.statutory,
    });

    slips.push({
      org,
      runId: runIdHex,
      period,
      userId: structure.userId,
      employeeName: employee.name,
      department: employee.department,
      annualCtcPaise: structure.annualCtcPaise,
      monthlyCtcPaise: Math.round(structure.annualCtcPaise / 12),
      earnings: slip.earnings.map((e) => ({
        code: e.code,
        name: e.name,
        calcLabel: e.calcLabel,
        fullPaise: e.fullPaise,
        paidPaise: e.paidPaise,
      })),
      deductions: slip.deductions,
      pfWagePaise: slip.pfWagePaise,
      grossPaise: slip.grossPaise,
      employeeDeductionsPaise: slip.employeeDeductionsPaise,
      netPaise: slip.netPaise,
      reimbursementsPaise: slip.reimbursementsPaise,
      netPayablePaise: slip.netPayablePaise,
      employerCostPaise: slip.employerCostPaise,
      epf: slip.epf,
      inputs: {
        workingDays,
        lopDays,
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
  const slips = await payslips().find({ org, runId: run._id.toHexString() }).toArray();
  return { run: runView(run), payslips: slips.map(payslipView) };
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
  if (run.createdByUserId === adminUserId) {
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

function clampLop(value: unknown, workingDays: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), workingDays);
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
    epf: slip.epf,
    inputs: slip.inputs,
  };
}
