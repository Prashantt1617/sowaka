/**
 * Payroll for an org whose salaries are end-to-end encrypted. The server
 * hands the browser everything that is NOT an amount (components, templates,
 * statutory settings and rules, attendance, who is on which template), the
 * browser decrypts the salaries, runs the shared calculator, seals the
 * results and sends them back. The server stores the sealed records and
 * drives the run's lifecycle; it never sees a salary figure.
 */
import { ObjectId } from 'mongodb';
import { companies, payrollCrypto, payrollRuns, payslips, salaryStructures, salaryTemplates, taxDeclarations, users } from '../config/db';
import { Payslip, PayrollRun, PayrollRunStatus } from '../models/payrollRun.model';
import { ResolvedRuleSet } from '../models/statutoryRule.model';
import { SalaryStructure } from '../models/salaryStructure.model';
import { employeePublicKeys, isSealedForPerson, myEmployeeKey, orgCryptoState, PayrollCryptoError, requireSealed, requireWritableState } from './payrollCrypto.service';
import { hasPayrollAccess } from './payrollAccess.service';
import { catalogWithStandard, materializeStandard } from './standardComponents.service';
import { esiCoveredThisPeriod, statutorySettingsFor, workStateOf } from './statutorySettings.service';
import { resolveRuleSet } from './statutory.service';
import { computeWorkingDays, getEmployeePeriodInputs, parsePeriod } from './payroll-inputs.service';
import { attendanceCountsForPeriod, payrollDeductions } from './deduction.service';
import { declarationsFor, tdsConfigsFor } from './tds.service';
import { openIds, sealIds } from './salaryStructure.service';
import { fyOf } from '../shared/payroll/tds';

async function encryptedOrgOf(viewerUserId: string) {
  const viewer = await users().findOne({ userId: viewerUserId }, { projection: { _id: 0, org: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1 } });
  if (!viewer?.org) throw new PayrollCryptoError(403, 'No organisation on this account');
  if (!hasPayrollAccess(viewer)) throw new PayrollCryptoError(403, 'Needs payroll access');
  const state = await orgCryptoState(viewer.org);
  if (!state) throw new PayrollCryptoError(409, 'This organisation’s salaries are not encrypted');
  return { org: viewer.org, keyVersion: state.keyVersion };
}

/** For writes: the org must be on its current key with no rotation outstanding. */
async function writableOrgOf(viewerUserId: string) {
  const { org } = await encryptedOrgOf(viewerUserId);
  const state = await requireWritableState(org);
  return { org, keyVersion: state.keyVersion };
}

function omit<T extends object>(obj: T, keys: string[]): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k))) as Partial<T>;
}

/** Everything the browser's calculator needs, none of it an amount someone earns. */
export async function calcContext(viewerUserId: string, period?: string) {
  const { org, keyVersion } = await encryptedOrgOf(viewerUserId);
  const [{ all: payHeads }, templates, settings, structures, company, employeeKeys] = await Promise.all([
    catalogWithStandard(org),
    salaryTemplates().find({ org }).toArray(),
    statutorySettingsFor(org),
    salaryStructures().find({ org }, { projection: { userId: 1 } }).toArray(),
    companies().findOne({ id: org }, { projection: { name: 1, address: 1 } }),
    employeePublicKeys(org),
  ]);
  const people = await users()
    .find({ org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } }, { projection: { _id: 0, userId: 1, name: 1, employeeId: 1, department: 1, designation: 1, joiningDate: 1, state: 1, location: 1 } })
    .toArray();
  const ruleSets: Record<string, ResolvedRuleSet> = {};
  const employees = [];
  for (const p of people) {
    // The server's run resolves the rule set by workStateOf as given; the key here is the same, normalised.
    const state = (workStateOf(p) ?? '').trim().toLowerCase();
    if (!(state in ruleSets)) ruleSets[state] = await resolveRuleSet(org, workStateOf(p));
    employees.push({ userId: p.userId, name: p.name, employeeId: p.employeeId, department: p.department, designation: p.designation, joiningDate: p.joiningDate ? new Date(p.joiningDate).toISOString().slice(0, 10) : undefined, state });
  }
  let tds = null;
  if (period && settings.tds?.enabled) {
    const fy = fyOf(period).fy;
    const configs = [...(await tdsConfigsFor(fy)).values()];
    const rows = [...(await declarationsFor(org, fy, people.map((p) => p.userId))).values()];
    tds = {
      fy,
      configs,
      // Regime and proof status plain; the declared amounts sealed (opened in the browser).
      declarations: rows.map((d) => ({ userId: d.userId, fy: d.fy, regime: d.regime, proofs: d.proofs, ...(d.sealed ? { sealed: d.sealed } : { declarations: d.declarations }) })),
    };
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
    /** Employees who have a key: their payslips are also sealed to them. */
    employeeKeys,
    tds,
  };
}

/** One person's structure as stored: plain switches and template, amounts sealed. */
function structureEnvelope(s: SalaryStructure, employeeName?: string) {
  const ids = openIds(s.statutory, true);
  return {
    userId: s.userId,
    employeeName,
    salaryTemplateCode: s.salaryTemplateCode,
    status: s.status,
    statutory: {
      epf: s.statutory?.epf, esi: s.statutory?.esi, lwf: s.statutory?.lwf, pfActualWage: s.statutory?.pfActualWage, contributeEps: s.statutory?.contributeEps,
      pfAccountNumber: ids.pfAccountNumber, uan: ids.uan, esiNumber: ids.esiNumber,
    },
    bonusCategory: s.bonusCategory,
    sealed: s.sealed ?? null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function listSealedStructures(viewerUserId: string) {
  const { org } = await encryptedOrgOf(viewerUserId);
  const docs = await salaryStructures().find({ org }).toArray();
  const people = await users().find({ userId: { $in: docs.map((d) => d.userId) } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray();
  const names = new Map(people.map((p) => [p.userId, p.name]));
  return docs.map((d) => structureEnvelope(d, names.get(d.userId)));
}

const codeList = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z0-9_]{1,40}$/.test(c)))] : []);

/** Save one person's structure: template, status and switches plain, amounts sealed in the browser. */
export async function saveSealedStructure(viewerUserId: string, userId: string, input: Record<string, unknown>) {
  const { org, keyVersion } = await writableOrgOf(viewerUserId);
  const employee = await users().findOne({ userId }, { projection: { _id: 0, org: 1, name: 1 } });
  if (!employee || employee.org !== org) throw new PayrollCryptoError(404, 'Employee not found');
  const code = String(input.salaryTemplateCode ?? '').trim().toUpperCase();
  if (!(await salaryTemplates().findOne({ org, code }))) throw new PayrollCryptoError(400, 'Pick a salary template');
  const sealed = requireSealed(input.sealed, 'salary', keyVersion);
  const st = (input.statutory ?? {}) as Record<string, unknown>;
  const flag = (v: unknown) => (v === undefined ? undefined : Boolean(v));
  const usedComponentCodes = codeList(input.componentCodes);
  // Standard components this salary uses become the org's own (codes, never amounts).
  if (usedComponentCodes.length) await materializeStandard(org, usedComponentCodes);
  const now = new Date();
  const existing = await salaryStructures().findOne({ org, userId });
  // UAN, PF and ESI numbers: the interim server-key field encryption, as on the plaintext path.
  const idsIn: Record<string, string | undefined> = {};
  for (const f of ['uan', 'pfAccountNumber', 'esiNumber'] as const) {
    if (st[f] === undefined) continue;
    const v = st[f] === null ? '' : String(st[f]).trim();
    if (v.length > 40) throw new PayrollCryptoError(400, `${f} is too long`);
    idsIn[f] = v || undefined;
  }
  const keptIds = sealIds(idsIn, existing?.statutory);
  const doc: SalaryStructure = {
    org,
    userId,
    salaryTemplateCode: code,
    annualCtcPaise: 0,
    componentValues: {},
    overrides: {},
    revisions: [],
    statutory: {
      epf: flag(st.epf), esi: flag(st.esi), lwf: flag(st.lwf), pfActualWage: flag(st.pfActualWage), contributeEps: flag(st.contributeEps),
      pfAccountNumber: keptIds.pfAccountNumber, uan: keptIds.uan, esiNumber: keptIds.esiNumber,
    },
    bonusCategory: input.bonusCategory === undefined ? existing?.bonusCategory : String(input.bonusCategory),
    status: input.status === 'active' ? 'active' : input.status === 'draft' ? 'draft' : existing?.status ?? 'draft',
    effectiveFrom: existing?.effectiveFrom,
    sealed,
    usedComponentCodes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  for (const k of Object.keys(doc.statutory!) as (keyof NonNullable<SalaryStructure['statutory']>)[]) if (doc.statutory![k] === undefined) delete doc.statutory![k];
  await salaryStructures().updateOne({ org, userId }, { $set: doc }, { upsert: true });
  return structureEnvelope(doc, employee.name);
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
  const { org, keyVersion } = await writableOrgOf(viewerUserId);
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
  const seen = new Set<string>();
  const docs: Payslip[] = slipsIn.map((s) => {
    const userId = String(s.userId);
    const p = byId.get(userId);
    if (!p) throw new PayrollCryptoError(400, `${userId} is not in this organisation`);
    if (seen.has(userId)) throw new PayrollCryptoError(400, `Two payslips for ${userId}`);
    seen.add(userId);
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
      ...(isSealedForPerson(s.sealedForEmployee) && s.sealedForEmployee.ct.length <= 200_000 ? { sealedForEmployee: s.sealedForEmployee } : {}),
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

// —— Tax declarations, sealed ——

async function declarationAccess(viewerUserId: string, userId: string) {
  const { org, keyVersion } = await encryptedOrgOf(viewerUserId);
  const employee = await users().findOne({ userId }, { projection: { _id: 0, org: 1 } });
  if (!employee || employee.org !== org) throw new PayrollCryptoError(404, 'Employee not found');
  return { org, keyVersion };
}

/** One person's declaration for a FY: regime and proofs plain, amounts sealed. */
export async function getSealedDeclaration(viewerUserId: string, userId: string, fy: string) {
  const { org } = await declarationAccess(viewerUserId, userId);
  const row = await taxDeclarations().findOne({ org, userId, fy }, { projection: { _id: 0 } });
  const configs = await tdsConfigsFor(fy);
  return {
    declaration: row ? { userId: row.userId, fy: row.fy, regime: row.regime, proofs: row.proofs, sealed: row.sealed ?? null, updatedAt: row.updatedAt } : null,
    configs: [...configs.values()].map((c) => ({ regime: c.regime, status: c.status, source: c.source })),
  };
}

export async function saveSealedDeclaration(viewerUserId: string, userId: string, fy: string, input: Record<string, unknown>) {
  await declarationAccess(viewerUserId, userId);
  const { org, keyVersion } = await writableOrgOf(viewerUserId);
  if (!/^\d{4}-\d{2}$/.test(fy)) throw new PayrollCryptoError(400, 'fy is like 2026-27');
  const regime = input.regime === 'old' ? 'old' : input.regime === 'new' ? 'new' : undefined;
  if (!regime) throw new PayrollCryptoError(400, 'regime must be new or old');
  const proofs = input.proofs === 'submitted' || input.proofs === 'verified' ? input.proofs : 'none';
  const sealed = requireSealed(input.sealed, 'tax declaration', keyVersion);
  await taxDeclarations().updateOne(
    { org, userId, fy },
    { $set: { org, userId, fy, regime, declarations: {}, proofs, sealed, updatedAt: new Date(), updatedByUserId: viewerUserId } },
    { upsert: true },
  );
  return getSealedDeclaration(viewerUserId, userId, fy);
}

/** Every sealed declaration in the org, for rotation. */
export async function listSealedDeclarations(viewerUserId: string) {
  const { org } = await encryptedOrgOf(viewerUserId);
  const rows = await taxDeclarations().find({ org, sealed: { $exists: true } }, { projection: { _id: 0, userId: 1, fy: 1, sealed: 1 } }).toArray();
  return rows.map((r) => ({ userId: r.userId, fy: r.fy, sealed: r.sealed }));
}

// —— An employee's own sealed payslips ——

const RELEASED: PayrollRunStatus[] = ['approved', 'paid'];

/**
 * The signed-in employee's released payslips that were sealed to their own
 * key, newest first, with their key record so a new device can unlock it.
 * The server can't open any of it; the app does.
 */
export async function mySealedPayslips(userId: string) {
  const key = await myEmployeeKey(userId);
  const all = await payslips().find({ userId, sealedForEmployee: { $exists: true } }, { projection: { userId: 1, org: 1, runId: 1, period: 1, employeeName: 1, sealedForEmployee: 1, createdAt: 1 } }).sort({ period: -1, createdAt: -1 }).limit(24).toArray();
  const runIds = [...new Set(all.map((s) => s.runId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const runs = runIds.length ? await payrollRuns().find({ _id: { $in: runIds }, status: { $in: RELEASED } }, { projection: { _id: 1, status: 1, period: 1 } }).toArray() : [];
  const byId = new Map(runs.map((r) => [r._id.toHexString(), r]));
  const org = all[0]?.org;
  const company = org ? await companies().findOne({ id: org }, { projection: { name: 1, address: 1 } }) : null;
  return {
    key,
    company: org ? { name: company?.name ?? org, address: company?.address ?? '' } : null,
    payslips: all
      .filter((s) => byId.has(s.runId))
      .map((s) => ({ id: s._id.toHexString(), org: s.org, userId: s.userId, period: s.period, runStatus: byId.get(s.runId)!.status, sealedForEmployee: s.sealedForEmployee })),
  };
}

// —— Locking what was there before encryption was switched on ——

const ZERO_TOTALS = { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 };

/** Readable payroll records left in an encrypted org (right after setup, or a lock that stopped halfway). */
async function plaintextQueries(org: string) {
  return {
    structures: { org, sealed: { $exists: false } },
    runs: { org, sealedTotals: { $exists: false } },
    payslips: { org, sealed: { $exists: false } },
    declarations: { org, sealed: { $exists: false } },
  } as const;
}

export async function plaintextCounts(org: string) {
  const q = await plaintextQueries(org);
  const [structures, runs, slips, declarations] = await Promise.all([
    salaryStructures().countDocuments(q.structures as never),
    payrollRuns().countDocuments(q.runs as never),
    payslips().countDocuments(q.payslips as never),
    taxDeclarations().countDocuments(q.declarations as never),
  ]);
  return { structures, runs, payslips: slips, declarations, total: structures + runs + slips + declarations };
}

/**
 * The readable records, for the browser of someone holding the data key to
 * seal. Only once encryption is on and only to a key holder, so this is the
 * same exposure the plaintext screens had a moment earlier, once.
 */
export async function listPlaintext(viewerUserId: string) {
  const { org } = await writableOrgOf(viewerUserId);
  await requireGrantHolder(org, viewerUserId);
  const q = await plaintextQueries(org);
  const [structures, runs, slips, declarations] = await Promise.all([
    salaryStructures().find(q.structures as never).toArray(),
    payrollRuns().find(q.runs as never).toArray(),
    payslips().find(q.payslips as never).toArray(),
    taxDeclarations().find(q.declarations as never).toArray(),
  ]);
  return {
    structures: structures.map((s) => ({
      userId: s.userId,
      secret: {
        annualCtcPaise: s.annualCtcPaise ?? 0,
        componentValues: s.componentValues ?? {},
        overrides: s.overrides ?? {},
        revisions: s.revisions ?? [],
        ...(s.statutory?.pfRestrictedWagePaise !== undefined ? { pfRestrictedWagePaise: s.statutory.pfRestrictedWagePaise } : {}),
      },
    })),
    runs: runs.map((r) => ({ id: r._id.toHexString(), period: r.period, totals: r.totals ?? ZERO_TOTALS })),
    payslips: slips.map((p) => {
      const { _id, org: _o, runId, sealed: _s, sealedForEmployee: _e, createdAt: _c, ...rest } = p as Payslip & { _id: ObjectId; sealed?: unknown; sealedForEmployee?: unknown };
      return { id: _id.toHexString(), runId, ...rest };
    }),
    declarations: declarations.map((d) => ({ userId: d.userId, fy: d.fy, declarations: d.declarations ?? {} })),
  };
}

async function requireGrantHolder(org: string, userId: string) {
  const state = await orgCryptoState(org);
  const mine = await payrollCrypto().findOne({ kind: 'grant', org, userId, keyVersion: state?.keyVersion ?? -1 });
  if (!mine) throw new PayrollCryptoError(403, 'You do not hold the current payroll key');
}

/**
 * Replace readable records with what the browser sealed, and clear their
 * amounts. Each record is matched to one still readable, so a retry after a
 * half-finished lock only touches what is left.
 */
export async function sealExisting(viewerUserId: string, input: Record<string, unknown>) {
  const { org, keyVersion } = await writableOrgOf(viewerUserId);
  await requireGrantHolder(org, viewerUserId);
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const now = new Date();
  let done = 0;
  for (const s of list(input.structures)) {
    const userId = String(s.userId);
    const current = await salaryStructures().findOne({ org, userId, sealed: { $exists: false } });
    if (!current) continue;
    const sealed = requireSealed(s.sealed, 'salary', keyVersion);
    const used = [...new Set([...((current.overrides as { add?: { payHeadCode: string }[] } | undefined)?.add ?? []).map((a) => a.payHeadCode), ...Object.keys(current.componentValues ?? {})])];
    await salaryStructures().updateOne(
      { _id: current._id, sealed: { $exists: false } },
      { $set: { sealed, annualCtcPaise: 0, componentValues: {}, overrides: {}, revisions: [], usedComponentCodes: used, updatedAt: now }, $unset: { 'statutory.pfRestrictedWagePaise': '' } },
    );
    done++;
  }
  for (const r of list(input.runs)) {
    const id = String(r.id);
    if (!ObjectId.isValid(id)) continue;
    const sealedTotals = requireSealed(r.sealedTotals, 'run totals', keyVersion);
    const res = await payrollRuns().updateOne({ _id: new ObjectId(id), org, sealedTotals: { $exists: false } }, { $set: { sealedTotals, totals: ZERO_TOTALS, updatedAt: now } });
    done += res.modifiedCount;
  }
  for (const p of list(input.payslips)) {
    const id = String(p.id);
    if (!ObjectId.isValid(id)) continue;
    const current = await payslips().findOne({ _id: new ObjectId(id), org, sealed: { $exists: false } });
    if (!current) continue;
    const sealed = requireSealed(p.sealed, 'payslip', keyVersion);
    const rawInputs = (current.inputs ?? {}) as unknown as Record<string, unknown>;
    const inputs = Object.fromEntries(NON_AMOUNT_INPUTS.filter((k) => rawInputs[k] !== undefined).map((k) => [k, rawInputs[k]]));
    await payslips().updateOne(
      { _id: current._id, sealed: { $exists: false } },
      {
        $set: {
          sealed,
          ...(isSealedForPerson(p.sealedForEmployee) && p.sealedForEmployee.ct.length <= 200_000 ? { sealedForEmployee: p.sealedForEmployee } : {}),
          annualCtcPaise: 0, monthlyCtcPaise: 0, earnings: [], deductions: [], pfWagePaise: 0, ...ZERO_TOTALS, netPayablePaise: 0,
          epf: { contributionWagePaise: 0, employeePaise: 0, employerEpsPaise: 0, employerEpfPaise: 0 },
          inputs: { workingDays: 0, lopDays: 0, payableDays: 0, approvedLeaveDays: 0, approvedOtHours: 0, overtimePaise: 0, reimbursementsPaise: 0, reimbursementClaimIds: [], ...inputs } as Payslip['inputs'],
        },
        $unset: { taxablePaise: '', reimbursementLines: '', employer: '' },
      },
    );
    done++;
  }
  for (const d of list(input.declarations)) {
    const sealed = requireSealed(d.sealed, 'tax declaration', keyVersion);
    const res = await taxDeclarations().updateOne(
      { org, userId: String(d.userId), fy: String(d.fy), sealed: { $exists: false } },
      { $set: { sealed, declarations: {}, updatedAt: now } },
    );
    done += res.modifiedCount;
  }
  return { sealed: done, remaining: await plaintextCounts(org) };
}
