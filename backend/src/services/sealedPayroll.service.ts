/**
 * Payroll for an org whose salaries are end-to-end encrypted. The server
 * hands the browser everything that is NOT an amount (components, templates,
 * statutory settings and rules, attendance, who is on which template), the
 * browser decrypts the salaries, runs the shared calculator, seals the
 * results and sends them back. The server stores the sealed records and
 * drives the run's lifecycle; it never sees a salary figure.
 */
import { ObjectId } from 'mongodb';
import { companies, payrollRuns, payslips, salaryStructures, salaryTemplates, users } from '../config/db';
import { Payslip, PayrollRun } from '../models/payrollRun.model';
import { ResolvedRuleSet } from '../models/statutoryRule.model';
import { SalaryStructure } from '../models/salaryStructure.model';
import { isSealedForPerson, orgCryptoState, PayrollCryptoError, requireSealed } from './payrollCrypto.service';
import { hasPayrollAccess } from './payrollAccess.service';
import { catalogWithStandard, materializeStandard } from './standardComponents.service';
import { esiCoveredThisPeriod, statutorySettingsFor, workStateOf } from './statutorySettings.service';
import { resolveRuleSet } from './statutory.service';
import { computeWorkingDays, getEmployeePeriodInputs, parsePeriod } from './payroll-inputs.service';
import { attendanceCountsForPeriod, payrollDeductions } from './deduction.service';
import { declarationsFor, tdsConfigsFor } from './tds.service';
import { fyOf } from '../shared/payroll/tds';

async function encryptedOrgOf(viewerUserId: string) {
  const viewer = await users().findOne({ userId: viewerUserId }, { projection: { _id: 0, org: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1 } });
  if (!viewer?.org) throw new PayrollCryptoError(403, 'No organisation on this account');
  if (!hasPayrollAccess(viewer)) throw new PayrollCryptoError(403, 'Needs payroll access');
  const state = await orgCryptoState(viewer.org);
  if (!state) throw new PayrollCryptoError(409, 'This organisation’s salaries are not encrypted');
  return { org: viewer.org, keyVersion: state.keyVersion };
}

function omit<T extends object>(obj: T, keys: string[]): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k))) as Partial<T>;
}

/** Everything the browser's calculator needs, none of it an amount someone earns. */
export async function calcContext(viewerUserId: string, period?: string) {
  const { org, keyVersion } = await encryptedOrgOf(viewerUserId);
  const [{ all: payHeads }, templates, settings, structures, company] = await Promise.all([
    catalogWithStandard(org),
    salaryTemplates().find({ org }).toArray(),
    statutorySettingsFor(org),
    salaryStructures().find({ org }, { projection: { userId: 1 } }).toArray(),
    companies().findOne({ id: org }, { projection: { name: 1, address: 1 } }),
  ]);
  const people = await users()
    .find({ org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } }, { projection: { _id: 0, userId: 1, name: 1, employeeId: 1, department: 1, designation: 1, joiningDate: 1, state: 1, location: 1 } })
    .toArray();
  const ruleSets: Record<string, ResolvedRuleSet> = {};
  const employees = [];
  for (const p of people) {
    const state = (workStateOf(p) ?? '').trim().toLowerCase();
    if (!(state in ruleSets)) ruleSets[state] = await resolveRuleSet(org, state);
    employees.push({ userId: p.userId, name: p.name, employeeId: p.employeeId, department: p.department, designation: p.designation, joiningDate: p.joiningDate ? new Date(p.joiningDate).toISOString().slice(0, 10) : undefined, state });
  }
  return {
    org,
    keyVersion,
    company: { name: company?.name ?? org, address: company?.address ?? '' },
    payHeads: payHeads.map((h) => omit(h, ['org', 'createdAt', 'updatedAt'])),
    templates: templates.map((t) => ({ id: t._id.toHexString(), ...omit(t, ['_id', 'org', 'createdAt', 'updatedAt']) })),
    settings,
    ruleSets,
    employees,
    withSalary: structures.map((s) => s.userId),
    // For the TDS engine in the browser: the FY's slabs and each person's declaration (not salary amounts).
    tds: period && settings.tds?.enabled
      ? { fy: fyOf(period).fy, configs: [...(await tdsConfigsFor(fyOf(period).fy)).values()], declarations: [...(await declarationsFor(org, fyOf(period).fy, people.map((p) => p.userId))).values()].map((d) => ({ ...d, _id: undefined })) }
      : null,
  };
}

/** One person's structure as stored: plain switches and template, amounts sealed. */
function structureEnvelope(s: SalaryStructure) {
  return {
    userId: s.userId,
    salaryTemplateCode: s.salaryTemplateCode,
    status: s.status,
    statutory: { epf: s.statutory?.epf, esi: s.statutory?.esi, lwf: s.statutory?.lwf, pfActualWage: s.statutory?.pfActualWage, contributeEps: s.statutory?.contributeEps },
    bonusCategory: s.bonusCategory,
    sealed: s.sealed ?? null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function listSealedStructures(viewerUserId: string) {
  const { org } = await encryptedOrgOf(viewerUserId);
  const docs = await salaryStructures().find({ org }).toArray();
  return docs.map(structureEnvelope);
}

/** Save one person's structure: template, status and switches plain, amounts sealed in the browser. */
export async function saveSealedStructure(viewerUserId: string, userId: string, input: Record<string, unknown>) {
  const { org, keyVersion } = await encryptedOrgOf(viewerUserId);
  const employee = await users().findOne({ userId }, { projection: { _id: 0, org: 1 } });
  if (!employee || employee.org !== org) throw new PayrollCryptoError(404, 'Employee not found');
  const code = String(input.salaryTemplateCode ?? '').trim().toUpperCase();
  if (!(await salaryTemplates().findOne({ org, code }))) throw new PayrollCryptoError(400, 'Pick a salary template');
  const sealed = requireSealed(input.sealed, 'salary', keyVersion);
  const st = (input.statutory ?? {}) as Record<string, unknown>;
  const flag = (v: unknown) => (v === undefined ? undefined : Boolean(v));
  // Standard components this salary uses become the org's own (codes, never amounts).
  if (Array.isArray(input.componentCodes)) await materializeStandard(org, input.componentCodes.map(String));
  const now = new Date();
  const existing = await salaryStructures().findOne({ org, userId });
  const doc: SalaryStructure = {
    org,
    userId,
    salaryTemplateCode: code,
    annualCtcPaise: 0,
    componentValues: {},
    overrides: {},
    revisions: [],
    statutory: { ...(existing?.statutory ?? {}), epf: flag(st.epf), esi: flag(st.esi), lwf: flag(st.lwf), pfActualWage: flag(st.pfActualWage), contributeEps: flag(st.contributeEps), pfRestrictedWagePaise: undefined },
    bonusCategory: input.bonusCategory === undefined ? existing?.bonusCategory : String(input.bonusCategory),
    status: input.status === 'active' ? 'active' : input.status === 'draft' ? 'draft' : existing?.status ?? 'draft',
    effectiveFrom: existing?.effectiveFrom,
    sealed,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await salaryStructures().updateOne({ org, userId }, { $set: doc }, { upsert: true });
  return structureEnvelope(doc);
}

/** The month's non-amount inputs for every active salary: days, attendance, approvals, ESI coverage. */
export async function runInputs(viewerUserId: string, period: string) {
  const { org } = await encryptedOrgOf(viewerUserId);
  const range = parsePeriod(period);
  const structures = await salaryStructures().find({ org, status: 'active' }, { projection: { userId: 1, salaryTemplateCode: 1 } }).toArray();
  const templates = await salaryTemplates().find({ org }).toArray();
  const byCode = new Map(templates.map((t) => [t.code, t]));
  const workingDays = await computeWorkingDays(org, range);
  const attendance = templates.some((t) => t.paidDaysEnabled ?? true) ? await attendanceCountsForPeriod(viewerUserId, period) : new Map();
  const esiCovered = await esiCoveredThisPeriod(org, period, structures.map((s) => s.userId));
  const people = [];
  for (const s of structures) {
    const t = s.salaryTemplateCode ? byCode.get(s.salaryTemplateCode) : undefined;
    if (!t) continue;
    const on = t.paidDaysEnabled ?? true;
    const docked = on ? payrollDeductions(t.deductionRules, attendance.get(s.userId)) : { days: 0, lines: [] };
    const allowance = on ? t.monthlyPaidLeaveDays ?? 0 : 0;
    const p = await getEmployeePeriodInputs(s.userId, range);
    people.push({
      userId: s.userId,
      attendanceLopDays: Math.min(Math.max(0, docked.days - allowance), workingDays),
      attendanceDeductions: docked.lines,
      paidLeaveDaysApplied: Math.min(allowance, docked.days),
      approvedLeaveDays: p.approvedLeaveDays,
      approvedOtHours: p.approvedOtHours,
      reimbursementsPaise: p.reimbursementsPaise,
      reimbursementClaimIds: p.reimbursementClaimIds,
      esiCoveredEarlier: esiCovered.has(s.userId),
    });
  }
  return { period, workingDays, month: range.month, people };
}

const NON_AMOUNT_INPUTS = ['workingDays', 'lopDays', 'attendanceLopDays', 'lopEnteredByHr', 'incomeTaxEnteredByHr', 'overtimeEnteredByHr', 'attendanceDeductions', 'paidLeaveDaysApplied', 'payableDays', 'approvedLeaveDays', 'approvedOtHours', 'reimbursementClaimIds'] as const;

/**
 * Create or replace a draft run from slips sealed in the browser. Only the
 * non-amount inputs (days, attendance, claim ids, ESI coverage) are kept in
 * clear: they drive the lifecycle, ESI periods and the claims marked paid.
 */
export async function saveSealedRun(viewerUserId: string, input: Record<string, unknown>) {
  const { org, keyVersion } = await encryptedOrgOf(viewerUserId);
  const period = String(input.period ?? '');
  parsePeriod(period);
  const slipsIn = Array.isArray(input.payslips) ? (input.payslips as Record<string, unknown>[]) : [];
  if (slipsIn.length === 0) throw new PayrollCryptoError(400, 'No payslips');
  const sealedTotals = requireSealed(input.sealedTotals, 'run totals', keyVersion);
  const existing = await payrollRuns().findOne({ org, period });
  if (existing && existing.status !== 'draft' && existing.status !== 'rejected') throw new PayrollCryptoError(409, `The ${period} run is ${existing.status}; recall it to draft first`);
  const people = await users().find({ userId: { $in: slipsIn.map((s) => String(s.userId)) }, org }).toArray();
  const byId = new Map(people.map((p) => [p.userId, p]));
  const runId = existing && existing.status === 'draft' ? existing._id : new ObjectId();
  const now = new Date();
  const zero = { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 };
  const zeroSlip = { ...zero, netPayablePaise: 0 };
  const docs: Payslip[] = slipsIn.map((s) => {
    const userId = String(s.userId);
    const p = byId.get(userId);
    if (!p) throw new PayrollCryptoError(400, `${userId} is not in this organisation`);
    const rawInputs = (s.inputs ?? {}) as Record<string, unknown>;
    const inputs = Object.fromEntries(NON_AMOUNT_INPUTS.filter((k) => rawInputs[k] !== undefined).map((k) => [k, rawInputs[k]]));
    return {
      org, runId: runId.toHexString(), period, userId,
      employeeName: p.name, department: p.department, employeeId: p.employeeId, designation: p.designation, joiningDate: p.joiningDate,
      annualCtcPaise: 0, monthlyCtcPaise: 0, earnings: [], deductions: [], pfWagePaise: 0, ...zeroSlip,
      esiApplicable: s.esiApplicable === true,
      epf: { contributionWagePaise: 0, employeePaise: 0, employerEpsPaise: 0, employerEpfPaise: 0 },
      inputs: { workingDays: 0, lopDays: 0, payableDays: 0, approvedLeaveDays: 0, approvedOtHours: 0, overtimePaise: 0, reimbursementsPaise: 0, reimbursementClaimIds: [], ...inputs } as Payslip['inputs'],
      sealed: requireSealed(s.sealed, 'payslip', keyVersion),
      ...(isSealedForPerson(s.sealedForEmployee) ? { sealedForEmployee: s.sealedForEmployee } : {}),
      createdAt: now,
    };
  });
  if (existing) await payslips().deleteMany({ org, runId: existing._id.toHexString() });
  if (existing && existing.status === 'rejected') await payrollRuns().deleteOne({ _id: existing._id });
  if (existing && existing.status === 'draft') {
    await payrollRuns().updateOne({ _id: runId }, { $set: { employeeCount: docs.length, totals: zero, sealedTotals, updatedAt: now } });
  } else {
    const run: PayrollRun & { _id: ObjectId } = { _id: runId, org, period, runType: 'regular', status: 'draft', employeeCount: docs.length, totals: zero, sealedTotals, createdByUserId: viewerUserId, createdAt: now, updatedAt: now };
    await payrollRuns().insertOne(run);
  }
  await payslips().insertMany(docs);
  return { runId: runId.toHexString(), payslipCount: docs.length };
}
