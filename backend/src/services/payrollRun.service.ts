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
  payrollPeriodRange,
} from './payroll-inputs.service';
import type { PeriodRange } from './payroll-inputs.service';
import { resolveRuleSet } from './statutory.service';
import { attendanceCountsForPeriod, payrollDeductions, unpaidLeaveDeduction } from './deduction.service';
import { payslipHtml } from './payslip-html';
import { employeeCalendar, invalidateAttendanceSetup, joinedOn, leftOn } from './attendance-report.service';
import { companies, exitSettlements } from '../config/db';
import { declarationsFor, runTds, ytdFor } from './tds.service';
import { requireTdsConfigs, statutoryConfigForPeriod } from './payrollConfig.service';
import type { StatutoryConfig } from '../shared/payroll/statutory-config';
import { fyOf, periodsAfter } from '../shared/payroll/tds';
import { paidDaysResolver } from './paidDaysTemplate.service';
import { addInto, billCategories, billsByComponent, ReimbursementTax, reimbursementTax, reimbursementsPaidBefore } from './reimbursementBills.service';
import { decryptField, fieldKeyConfigured } from './fieldCrypto';
import { splitAmountsFor, splitsByUser } from './employeePayroll.split';
import { cachedLifecycle } from './lifecycle/readCache';
import type { PayslipArrears, PayslipArrearsItem, SalarySegmentView } from '../models/payrollRun.model';
import type { SalaryCalcResult } from './salary-calculator';
import {
  addDays, allocateLop, arrearsLines, arrearsShare, atTime, combineSegments, daysBetween, paidDaysOf, payRevisions,
  recurringEarnings, salarySegments, salaryVersions, sameState, structureAsKnownAt, versionOn,
} from '../shared/payroll/salary-revisions';
import type { MonthlyLine, SalaryState } from '../shared/payroll/salary-revisions';
import type { SalaryStructure } from '../models/salaryStructure.model';

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
  const range = await payrollPeriodRange(org, input.period);

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
    ...periodDates(range),
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
  const range = await payrollPeriodRange(org, run.period);
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
  return runView(await patchRun(run._id, { employeeCount: slips.length, totals: sumTotals(slips), ...periodDates(range) }));
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
  scope?: EstimateScope,
): Promise<Payslip[]> {
  const runAmounts = entered.componentAmounts ?? {};
  const lopOverrides = entered.lopDays;
  const otOverrides = entered.overtimePaise;
  const taxOverrides = entered.incomeTaxPaise;
  const structures = await salaryStructures().find({ org, status: 'active', ...(scope ? { userId: scope.userId } : {}) }).toArray();
  if (structures.length === 0) {
    if (scope) return [];
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
  // The FY's national figures: no row, no run (409).
  const config = await statutoryConfigForPeriod(period);
  const esiCovered = await esiCoveredThisPeriod(org, period, structures.map((s) => s.userId));
  // The month's calendar, whenever a template pays by it — the report is the
  // slow part of a run.
  // Each person's Paid Days Template (else the company's Default) says how attendance becomes paid days.
  const paidDaysFor = await paidDaysResolver(org);
  const docksForAttendance = structures.some((s) => !(paidDaysFor(s.paidDaysTemplateCode)?.allDaysPaid ?? false));
  // Leave without pay is docked even where every day is paid, so a month with
  // any approved leave in it reads the calendar too; whether a leave is unpaid
  // is the calendar's to say, from the shift that covered the day.
  const readsAttendance = docksForAttendance || (await anyApprovedLeave(structures.map((s) => s.userId), range));
  // Graded on the roster as it is now: a joining date just changed moves which
  // days are before joining, and payroll counts those itself below.
  // (An estimate reads the setup as it is cached: it runs on every app home.)
  if (readsAttendance && !scope) invalidateAttendanceSetup(org);
  // An estimate counts its one person's days alone (graded as the run's report grades them), not
  // the whole company's pay period: the same counts for them, from their own rows.
  let attendance = readsAttendance
    ? await attendanceCountsForPeriod(adminUserId, period, range, scope?.today, scope?.userId)
    : new Map();
  // Not on the cached roster (just joined, or just given a structure): read it afresh, as a run would.
  if (readsAttendance && scope && !attendance.has(scope.userId)) {
    invalidateAttendanceSetup(org);
    attendance = await attendanceCountsForPeriod(adminUserId, period, range, scope.today, scope.userId);
  }

  // Whole records bar what a payslip never reads: an older account's inline photo (hundreds of KB),
  // uploaded documents and the help desk's notes.
  const employees = await users()
    .find({ userId: { $in: structures.map((s) => s.userId) } }, { projection: { profilePhotoUrl: 0, documents: 0, helpIntake: 0, helpMatch: 0, counsellor: 0 } })
    .toArray();
  // The TDS engine, when the org has switched it on: the FY's income tax rows, else 409.
  const { fy } = fyOf(period);
  const tdsConfigs = settings.tds?.enabled ? await requireTdsConfigs(fy) : new Map();
  const tdsOn = tdsConfigs.size > 0;
  const userIds = structures.map((s) => s.userId);
  const [ytd, declarations] = tdsOn ? await Promise.all([ytdFor(org, period, userIds), declarationsFor(org, fy, userIds)]) : [new Map(), new Map()];
  // Fuel, Internet…: paid in full, taxed until bills; claims of a linked type are those bills, not paid again.
  const billCats = await billCategories(org);
  // Claims on another run (not rejected) are that run's: never paid twice.
  // (An estimate stands in for this period's run, so that run's own claims stay its to pay.)
  const otherRuns = await payrollRuns().find({ org, status: { $ne: 'rejected' }, ...(scope ? { period: { $ne: period } } : {}) } as never, { projection: { _id: 1 } }).toArray();
  const otherRunIds = otherRuns.map((r) => r._id.toHexString()).filter((id) => id !== runIdHex);
  // An estimate's one person: only their own payslips can hold their claims (a claim is one person's).
  const reservedClaimIds = new Set(
    otherRunIds.length
      ? (await payslips().find({ org, runId: { $in: otherRunIds }, ...(scope ? { userId: scope.userId } : {}) }, { projection: { 'inputs.reimbursementClaimIds': 1 } }).toArray()).flatMap((s) => s.inputs?.reimbursementClaimIds ?? [])
      : [],
  );
  const [reimbPaidBefore, bills] = tdsOn
    ? await Promise.all([reimbursementsPaidBefore(org, userIds, period), billsByComponent(billCats, userIds, period, range.end)])
    : [new Map<string, Map<string, number>>(), new Map<string, Map<string, number>>()];
  const employeeById = new Map(employees.map((e) => [e.userId, e]));
  // Each person's flexible split (app › Payroll), month by month, over their structure's own values.
  const splits = await splitsByUser(org, userIds);

  // The pay dates of the months still to come this year, for the tax of someone who leaves in one of them.
  const laterRanges = new Map<string, { from: string; to: string }>();
  if (tdsOn && employees.some((e) => e.exit)) {
    for (const p of periodsAfter(period)) {
      try { const r = await payrollPeriodRange(org, p); laterRanges.set(p, { from: r.from, to: r.to }); }
      catch { const r = parsePeriod(p); laterRanges.set(p, { from: r.from, to: r.to }); }
    }
  }

  // People whose final settlement already paid this period from its own working (no payslip
  // existed when it was approved): the run leaves them out, so the month is not paid twice.
  const settledHere = scope
    ? new Set<string>()
    : new Set((await exitSettlements().find({ org, status: { $in: ['approved', 'paid'] }, lines: { $elemMatch: { period, estimated: true } } }, { projection: { _id: 0, userId: 1 } }).toArray()).map((r) => r.userId));

  // ——— Salary revisions: each day is paid on the salary in force that day (salary-revisions).
  const revisions = await revisionInputs(org, period, range, structures, otherRunIds);
  // The arrears pay head: the company's earning flagged Arrears (a one-time one first). None: arrears
  // are worked out and shown but not paid ("not set up"), and offered again once there is one.
  const arrearsHead = catalog
    .filter((h) => h.category === 'earning' && h.arrears === true && h.active)
    .sort((a, b) => (a.recurrence === 'one_time' ? 0 : 1) - (b.recurrence === 'one_time' ? 0 : 1) || a.code.localeCompare(b.code))[0];
  const configByPeriod = new Map<string, Promise<StatutoryConfig>>([[period, Promise.resolve(config)]]);
  const configOf = (p: string) => {
    if (!configByPeriod.has(p)) configByPeriod.set(p, statutoryConfigForPeriod(p));
    return configByPeriod.get(p)!;
  };

  const now = new Date();
  const slips: Payslip[] = [];

  for (const structure of structures) {
    const employee = employeeById.get(structure.userId);
    if (!employee) continue; // structure orphaned from its user; skip defensively
    if (settledHere.has(structure.userId)) continue;

    // Resolve the assigned salary template; skip employees without one (SS-3).
    const template = structure.salaryTemplateCode
      ? templatesByCode.get(structure.salaryTemplateCode)
      : undefined;
    if (!template) continue;
    // This month's one-time amounts: a component not on the salary is added
    // for this run; either way it is paid / taken at the amount HR typed.
    const amounts = runAmounts[structure.userId] ?? {};
    // What is paid this run: HR's amounts, plus worked-out arrears (below) unless HR typed that line.
    const payAmounts: Record<string, number> = { ...amounts };
    let workedOutArrearsCode: string | undefined;
    // A salary's components: its template plus the person's own add / remove / edit, and this run's amounts.
    const componentsFor = (state: SalaryState, paid: Record<string, number>) => {
      const tpl = (state.salaryTemplateCode && templatesByCode.get(state.salaryTemplateCode)) || template;
      const resolvedComponents = resolveTemplateComponents(applyOverrides(tpl.components, state.overrides, catalogByCode), catalogByCode);
      for (const code of Object.keys(paid)) {
        const head = catalogByCode.get(code);
        if (!head) continue;
        const i = resolvedComponents.findIndex((h) => h.code === code);
        // Worked-out arrears are paid exactly as worked out, once: never prorated by this month's days.
        // (A figure HR typed is taken as any typed amount always was.)
        const asArrears = code === workedOutArrearsCode ? { prorate: false, recurrence: 'one_time' as const } : {};
        const runHead = { ...(i >= 0 ? resolvedComponents[i] : head), calculation: { mode: 'flat_amount' as const }, active: true, ...asArrears };
        if (i >= 0) resolvedComponents[i] = runHead;
        else resolvedComponents.push(runHead);
      }
      return { tpl, resolvedComponents };
    };

    const ruleSet = await resolveRuleSetCached(ruleSetCache, org, workStateOf(employee), config);
    // Joined during this month: paid from the joining day, PF ceilings counted from it.
    const joined = joinedOn(employee);
    // Not employed yet in this period (a run made for an earlier one): no
    // payslip, unless HR typed their loss of pay and they joined within the
    // period's calendar month: a company whose files pay a joiner by the
    // calendar month (joined the 27th, paid 27th to 31st in a 26th-to-25th
    // cycle) puts them on the run that way.
    if (joined && joined > range.to && (lopOverrides[structure.userId] === undefined || joined > calendarEnd(period))) continue;
    // Left before this period began (an exit HR recorded): no payslip.
    const left = leftOn(employee);
    if (left && left < range.from) continue;
    const employedFrom = joined && joined > range.from ? joined : undefined;
    const notYetEmployedDays = employedFrom ? Math.round((Date.parse(employedFrom) - Date.parse(range.from)) / 86_400_000) : 0;
    // Notice began (an exit HR recorded; the day it was recorded when no date was given): pay is held from then.
    // (Unless this exit's rules say not to hold pay.)
    // Recorded after they had already gone (an absconding found out later): held from their last working day.
    const recordedOn = employee.exit ? new Date(employee.exit.recordedAt).toISOString().slice(0, 10) : '';
    const noticeStart = employee.exit && employee.exit.rules?.holdPay !== false
      ? (employee.exit.noticeFrom ?? (recordedOn < employee.exit.lastWorkingDay ? recordedOn : employee.exit.lastWorkingDay))
      : undefined;
    // Left during it: the days after the last working day are not paid, like the days before joining.
    const leftDays = left && left < range.to ? Math.round((Date.parse(range.to) - Date.parse(left)) / 86_400_000) : 0;
    // One salary (as in force on some day) worked out for a pay month. A salary from before a
    // revision whose template or own changes no longer resolve is worked out on the current ones.
    const calcOf = (state: SalaryState, p: string, from: string | undefined, cfg: StatutoryConfig, rs: ResolvedRuleSet, paid: Record<string, number>): SalaryCalcResult => {
      const work = (st: SalaryState) => {
        const { tpl, resolvedComponents } = componentsFor(st, paid);
        return calculateSalaryStructure({
          monthlyCtcPaise: Math.round(st.annualCtcPaise / 12),
          payHeads: resolvedComponents,
          componentValues: { ...(st.componentValues ?? {}), ...splitAmountsFor(splits.get(structure.userId), p), ...paid },
          balancingComponentCode: tpl.balancingComponentCode,
          ruleSet: rs,
          config: cfg,
          month: Number(p.slice(5, 7)),
          period: p,
          bonusCategory: structure.bonusCategory,
          statutory: structure.statutory,
          settings,
          statutoryWages: tpl.statutoryWages,
          employedFrom: from,
        });
      };
      try {
        return work(state);
      } catch (error) {
        if (state.salaryTemplateCode === structure.salaryTemplateCode && state.overrides === structure.overrides) throw error;
        return work({ ...state, salaryTemplateCode: structure.salaryTemplateCode, overrides: structure.overrides });
      }
    };
    // The salary in force on each day of this period; one part for anyone without a revision in it.
    const versions = salaryVersions(structure, revisions.held.get(structure.userId));
    const segments = salarySegments(versions, range.from, range.to);

    // Arrears: a revision dated in an earlier, submitted period that its payslip did not know of.
    const arrearsItems = await arrearsFor({
      structure, range, earlier: revisions.earlier.get(structure.userId) ?? [], settled: revisions.settled.get(structure.userId) ?? new Set(),
      covered: revisions.covered, firstFinalizedAt: revisions.firstFinalizedAt, joined,
      oneTimeCode: (code) => catalogByCode.get(code)?.recurrence === 'one_time' || code === arrearsHead?.code,
      calc: async (state, p, from) => {
        const cfg = await configOf(p);
        const rs = cfg.fy === config.fy ? ruleSet : await resolveRuleSet(org, workStateOf(employee), cfg);
        return calcOf(state, p, from, cfg, rs, {});
      },
    });
    let arrears: PayslipArrears | undefined;
    if (arrearsItems.length) {
      // What a revision raised is paid; what one lowered is shown, never taken back automatically.
      const workedOutPaise = arrearsItems.reduce((t, i) => t + Math.max(0, i.amountPaise), 0);
      const typed = !!arrearsHead && amounts[arrearsHead.code] !== undefined;
      const status: PayslipArrears['status'] = typed ? 'entered_by_hr'
        : workedOutPaise === 0 ? (arrearsItems.some((i) => i.amountPaise < 0) ? 'negative' : 'paid')
          : !arrearsHead ? 'not_set_up' : 'paid';
      if (status === 'paid' && workedOutPaise > 0) {
        payAmounts[arrearsHead!.code] = workedOutPaise;
        workedOutArrearsCode = arrearsHead!.code;
      }
      arrears = {
        ...(arrearsHead ? { payHeadCode: arrearsHead.code } : {}),
        status,
        workedOutPaise,
        paidPaise: status === 'paid' ? workedOutPaise : status === 'entered_by_hr' ? amounts[arrearsHead!.code] : 0,
        items: arrearsItems,
      };
    }

    // A later month (the year's tax projection) on the salary in force by its end.
    const salaryFor = (p: string, from?: string) =>
      calcOf(p === period ? segments[segments.length - 1].version.state : versionOn(versions, calendarEnd(p)).state, p, from, config, ruleSet, payAmounts);
    // Each part of the period on its own salary; one part is the month as always.
    const segmentCalcs = segments.map((seg) => calcOf(seg.version.state, period, employedFrom, config, ruleSet, payAmounts));
    const periodDays = daysBetween(range.from, range.to);
    const split = segments.length > 1;
    // The month as one, from its parts (monthly figures day-weighted; what is paid comes once loss of pay is placed).
    const latest = segmentCalcs[segmentCalcs.length - 1];
    let base = split ? combineSegments(segmentCalcs.map((calc, i) => ({ calc, days: segments[i].days, lopDays: 0 })), periodDays, workingDays).calc : latest;

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
    // Days before joining are not paid either: attendance leaves them out, so
    // they come on top of what it docks from the joining day on.
    const attendanceLopDays = Math.min(Math.max(0, docked.days - allowance) + unpaidLeave.days + notYetEmployedDays + leftDays, workingDays);
    const lopEnteredByHr = lopOverrides[structure.userId] !== undefined;
    const lopDays = lopEnteredByHr ? clampLop(lopOverrides[structure.userId], workingDays) : attendanceLopDays;
    // A period on more than one salary: its loss of pay placed in the parts (the dated days where
    // they fall), so a day lost on the old salary costs the old rate and one on the new the new.
    let paidOverride: Record<string, number> | undefined;
    let salarySegmentsView: SalarySegmentView[] | undefined;
    if (split) {
      const notEmployedIn = (from: string, to: string) => {
        let n = 0;
        if (employedFrom) { const end = addDays(employedFrom, -1); if (end >= from) n += daysBetween(from, end < to ? end : to); }
        if (leftDays > 0 && left) { const start = addDays(left, 1); if (start <= to) n += daysBetween(start > from ? start : from, to); }
        return n;
      };
      // The calendar's own days, part by part, when loss of pay comes from it.
      const dated = !lopEnteredByHr && readsAttendance
        ? await Promise.all(segments.map((seg) => attendanceCountsForPeriod(adminUserId, period, { from: seg.from, to: seg.to }, scope?.today, structure.userId).then((m) => m.get(structure.userId))))
        : segments.map(() => undefined);
      const lops = allocateLop(lopDays, segments.map((seg, i) => ({
        capacity: (seg.days * workingDays) / periodDays,
        notEmployed: notEmployedIn(seg.from, seg.to),
        unpaid: unpaidLeaveDeduction(dated[i]).days,
        docked: paidDaysOn && dated[i] ? dated[i]!.absent + dated[i]!.half_day / 2 + dated[i]!.missedPunchLop : 0,
      })), lopEnteredByHr ? 0 : Math.min(allowance, docked.days));
      const combined = combineSegments(segmentCalcs.map((calc, i) => ({ calc, days: segments[i].days, lopDays: lops[i] })), periodDays, workingDays);
      base = combined.calc;
      paidOverride = combined.paidPaise;
      salarySegmentsView = segments.map((seg, i) => ({
        from: seg.from,
        to: seg.to,
        days: seg.days,
        lopDays: lops[i],
        paidDays: paidDaysOf(seg.days, lops[i], periodDays, workingDays),
        annualCtcPaise: seg.version.state.annualCtcPaise,
        ...(seg.version.state.salaryTemplateCode ? { salaryTemplateCode: seg.version.state.salaryTemplateCode } : {}),
      }));
    }

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
    // Without the TDS engine HR types the tax on each run: an estimate takes the last payslip's.
    let incomeTaxPaise = nonNegInt(taxOverrides[structure.userId] ?? (scope && !tdsOn ? scope.incomeTaxWithoutEnginePaise : 0));

    const slipInput = {
      workingDays,
      lopDays,
      overtimePaise,
      reimbursementsPaise: periodInputs.reimbursementsPaise,
      ruleSet,
      config,
      month: range.month,
      statutory: structure.statutory,
      settings,
      esiCoveredEarlier: esiCovered.has(structure.userId),
      incomeTaxPaise,
      period,
      employedFrom,
      ...(paidOverride ? { paidPaise: paidOverride } : {}),
    };
    let slip = computePayslip(base, slipInput);
    // Income tax from the TDS engine, when the org has it on and HR didn't type one.
    let tds: PayslipInputs['tds'];
    let reimbTax: ReimbursementTax | undefined;
    if (!incomeTaxEnteredByHr && tdsOn) {
      const declaration = declarations.get(structure.userId);
      // The months to come are on the salary the person is on now (the period's last part).
      const futureTaxable = taxableAfterMealExemption(
        latest.earnings.filter((l) => !l.oneTime).map((l) => ({ taxable: l.taxable, componentType: l.componentType, amountPaise: l.monthlyPaise })),
        config.mealCard.exemptMonthlyPaise,
      );
      // The months still to come on each month's own structure (a PF ceiling change moves the balance), as Zoho projects;
      // their salary reimbursements count as taxable (no bills for them yet).
      const taxableReimb = (lines: { code: string; monthlyPaise: number }[]) =>
        lines.filter((l) => catalogByCode.get(l.code)?.taxable !== false).reduce((t, l) => t + l.monthlyPaise, 0);
      // Someone leaving earns nothing after their last working day, and only part of the month it falls in:
      // the year's tax is worked out on what they will really earn, so the months left take less (often none).
      const futureTaxablePaise = periodsAfter(period).reduce((t, p) => {
        const share = left ? shareBeforeLeaving(laterRanges.get(p), left) : 1;
        if (share === 0) return t;
        const later = salaryFor(p);
        return t + Math.round((projectedTaxable(later, config.mealCard.exemptMonthlyPaise) + taxableReimb(later.reimbursements ?? [])) * share);
      }, 0);
      // This year's reimbursements so far less the bills approved so far: a late bill lowers the tax from now on.
      reimbTax = reimbursementTax(addInto(new Map(reimbPaidBefore.get(structure.userId) ?? []), slip.reimbursementLines), bills.get(structure.userId), catalogByCode);
      const byType = (type: string) => latest.earnings.filter((l) => l.componentType === type).reduce((t, l) => t + l.monthlyPaise, 0);
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
        employeePfMonthlyPaise: latest.statutory.epf.employeePaise,
        ptMonthlyPaise: latest.statutory.pt.amountPaise,
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
      // On notice by the end of this period: the pay is held for the final settlement.
      ...(noticeStart && noticeStart <= range.to ? { held: { reason: 'notice' as const, since: noticeStart } } : {}),
      // The salary in force at the period's end (a revision dated later is not yet).
      annualCtcPaise: segments[segments.length - 1].version.state.annualCtcPaise,
      monthlyCtcPaise: Math.round(segments[segments.length - 1].version.state.annualCtcPaise / 12),
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
        // Of lopDays, the days before joining and after leaving: not loss of pay (they were not employed), paid the same way.
        notEmployedDays: Math.min(notYetEmployedDays + leftDays, lopDays),
        ...(leftDays > 0 && left ? { leftOn: left } : {}),
        incomeTaxPaise,
        incomeTaxEnteredByHr,
        overtimeEnteredByHr,
        ...(Object.keys(amounts).length ? { componentAmounts: amounts } : {}),
        ...(tds ? { tds } : {}),
        ...(reimbTax && reimbTax.paidPaise > 0 ? { reimbursementTax: { paidPaise: reimbTax.paidPaise, exemptPaise: reimbTax.exemptPaise, taxablePaise: reimbTax.taxablePaise } } : {}),
        // The days before joining and after leaving as lines of their own, so the lines add up to lopDays (payslipDays tells them apart).
        attendanceDeductions: [...docked.lines, ...unpaidLeave.lines, ...(notYetEmployedDays > 0 ? [{ label: 'Before joining', count: notYetEmployedDays, days: notYetEmployedDays, trigger: 'absent' as const, every: 1, deductDays: 1 }] : []), ...(leftDays > 0 ? [{ label: 'After leaving', count: leftDays, days: leftDays, trigger: 'absent' as const, every: 1, deductDays: 1 }] : [])],
        paidLeaveDaysApplied: Math.min(allowance, docked.days),
        payableDays: slip.payableDays,
        ...(salarySegmentsView ? { salarySegments: salarySegmentsView } : {}),
        ...(arrears ? { arrears } : {}),
        approvedLeaveDays: periodInputs.approvedLeaveDays,
        approvedOtHours: periodInputs.approvedOtHours,
        overtimePaise,
        reimbursementsPaise: periodInputs.reimbursementsPaise,
        reimbursementClaimIds: periodInputs.reimbursementClaimIds,
      },
      createdAt: now,
    });
  }

  if (slips.length === 0 && !scope) {
    throw new PayrollRunError(409, 'No payslips could be generated for this period');
  }
  return slips;
}

// ————————————————————————————————————————————————————————————————
// Salary revisions: what the run reads, and arrears
// ————————————————————————————————————————————————————————————————

/** An earlier, submitted payslip of one person, as arrears read it. */
interface EarlierSlip {
  period: string;
  from: string;
  to: string;
  baseDays: number;
  /** When its run was submitted (paid / approved): a revision saved after it is news to it. */
  finalizedAt: number;
  lopDays: number;
  leftOn?: string;
  /** The monthly amount of each earning it paid on (fullPaise). */
  earnings: { code: string; name: string; fullPaise: number }[];
  /** Codes HR typed on that run (one-time items): not salary, never compared. */
  typedCodes: string[];
  /** It was itself paid in parts (made by this code): what it paid on is worked out, not read. */
  split: boolean;
}

interface RevisionInputs {
  earlier: Map<string, EarlierSlip[]>;
  /** `revisionKey|period` (or `revisionKey|note:from`) already carried by another run: never again. */
  settled: Map<string, Set<string>>;
  /** Revisions whose arrears for THIS period another run paid: this period keeps the old salary for their days. */
  held: Map<string, Set<string>>;
  /** The days the company's runs (not rejected) pay for, this one included. */
  covered: { from: string; to: string }[];
  /** When the company's first run was submitted (Infinity: none yet). */
  firstFinalizedAt: number;
}

/**
 * What the run needs to pay revisions by date: for the people with a revision only (nobody else
 * costs a read), their submitted payslips before this period, and the arrears other runs carry.
 */
async function revisionInputs(org: string, period: string, range: PeriodRange, structures: SalaryStructure[], otherRunIds: string[]): Promise<RevisionInputs> {
  const out: RevisionInputs = { earlier: new Map(), settled: new Map(), held: new Map(), covered: [{ from: range.from, to: range.to }], firstFinalizedAt: Infinity };
  const people = structures.filter((s) => payRevisions(s).length > 0).map((s) => s.userId);
  if (people.length === 0) return out;
  const runs = await payrollRuns().find({ org, status: { $ne: 'rejected' } } as never, { projection: { _id: 1, period: 1, status: 1, periodFrom: 1, periodTo: 1, baseDays: 1, paidAt: 1, decidedAt: 1, updatedAt: 1 } }).toArray();
  const submitted = new Map<string, { period: string; from: string; to: string; baseDays: number; finalizedAt: number }>();
  for (const run of runs) {
    const r = run.periodFrom && run.periodTo
      ? { from: run.periodFrom, to: run.periodTo, baseDays: run.baseDays ?? daysBetween(run.periodFrom, run.periodTo) }
      : await payrollPeriodRange(org, run.period).catch(() => parsePeriod(run.period));
    out.covered.push({ from: r.from, to: r.to });
    if (run.status !== 'paid' && run.status !== 'approved') continue;
    const finalizedAt = new Date(run.paidAt ?? run.decidedAt ?? run.updatedAt).getTime();
    out.firstFinalizedAt = Math.min(out.firstFinalizedAt, finalizedAt);
    if (run.period < period) submitted.set(run._id.toHexString(), { period: run.period, from: r.from, to: r.to, baseDays: r.baseDays, finalizedAt });
  }
  const [earlier, carried] = await Promise.all([
    submitted.size
      ? payslips().find({ org, userId: { $in: people }, runId: { $in: [...submitted.keys()] } }, { projection: { _id: 0, userId: 1, runId: 1, 'earnings.code': 1, 'earnings.name': 1, 'earnings.fullPaise': 1, 'inputs.lopDays': 1, 'inputs.leftOn': 1, 'inputs.componentAmounts': 1, 'inputs.salarySegments': 1 } }).toArray()
      : Promise.resolve([] as Payslip[]),
    otherRunIds.length
      ? payslips().find({ org, userId: { $in: people }, runId: { $in: otherRunIds }, 'inputs.arrears': { $exists: true } } as never, { projection: { _id: 0, userId: 1, 'inputs.arrears': 1 } }).toArray()
      : Promise.resolve([] as Payslip[]),
  ]);
  for (const slip of earlier) {
    const run = submitted.get(slip.runId)!;
    const list = out.earlier.get(slip.userId) ?? [];
    list.push({
      period: run.period, from: run.from, to: run.to, baseDays: run.baseDays, finalizedAt: run.finalizedAt,
      lopDays: slip.inputs?.lopDays ?? 0, leftOn: slip.inputs?.leftOn,
      earnings: (slip.earnings ?? []).map((e) => ({ code: e.code, name: e.name, fullPaise: e.fullPaise })),
      typedCodes: Object.keys(slip.inputs?.componentAmounts ?? {}),
      split: (slip.inputs?.salarySegments?.length ?? 0) > 1,
    });
    out.earlier.set(slip.userId, list);
  }
  for (const slip of carried) {
    const a = slip.inputs?.arrears;
    // Worked out but not paid for want of an Arrears component: still owed, offered again.
    if (!a || a.status === 'not_set_up') continue;
    const settled = out.settled.get(slip.userId) ?? new Set<string>();
    for (const item of a.items ?? []) {
      settled.add(item.notInSowaka ? `${item.revisionKey}|note:${item.from}` : `${item.revisionKey}|${item.period}`);
      if (!item.notInSowaka && item.period === period) {
        const held = out.held.get(slip.userId) ?? new Set<string>();
        held.add(item.revisionKey);
        out.held.set(slip.userId, held);
      }
    }
    out.settled.set(slip.userId, settled);
  }
  return out;
}

/** The days of [from, to] no range covers, as runs of consecutive days. */
function uncoveredDays(from: string, to: string, covered: { from: string; to: string }[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let day = from;
  while (day <= to) {
    const cover = covered.find((c) => c.from <= day && day <= c.to);
    if (cover) { day = addDays(cover.to, 1); continue; }
    const next = covered.filter((c) => c.from > day).map((c) => c.from).sort()[0];
    const end = next && addDays(next, -1) < to ? addDays(next, -1) : to;
    out.push({ from: day, to: end });
    day = addDays(end, 1);
  }
  return out;
}

/**
 * Arrears this run owes one person: for each earlier, submitted period, the days a revision
 * saved after that run was submitted says were on another salary than the payslip paid
 * (revisions saved before it went out were paid as that run had them: accepted as paid, never
 * recovered). Per earning: the revised monthly amount less the one that payslip used, times the
 * share of those days it paid. A revision dated in days no Sowaka run paid (a month paid outside
 * Sowaka) gets a line saying so instead of a figure: HR enters any arrears for those by hand.
 * A revision and period already carried by another run are left out: paid once.
 */
async function arrearsFor(a: {
  structure: SalaryStructure;
  range: PeriodRange;
  earlier: EarlierSlip[];
  settled: Set<string>;
  covered: { from: string; to: string }[];
  firstFinalizedAt: number;
  joined?: string;
  oneTimeCode: (code: string) => boolean;
  calc: (state: SalaryState, period: string, employedFrom: string | undefined) => Promise<SalaryCalcResult>;
}): Promise<PayslipArrearsItem[]> {
  const revs = payRevisions(a.structure);
  const items: PayslipArrearsItem[] = [];
  if (revs.length === 0) return items;
  const versions = salaryVersions(a.structure);
  const lastDay = addDays(a.range.from, -1);
  for (const s of [...a.earlier].sort((x, y) => (x.period < y.period ? -1 : 1))) {
    const unknown = revs.filter((r) => atTime(r.at) > s.finalizedAt && r.effectiveFrom <= s.to);
    if (unknown.length === 0) continue;
    const firstDay = unknown.map((r) => r.effectiveFrom).sort()[0];
    const start = firstDay > s.from ? firstDay : s.from;
    const end = s.to < lastDay ? s.to : lastDay;
    if (start > end) continue;
    const employedFrom = a.joined && a.joined > s.from ? a.joined : undefined;
    // What that payslip paid on: its own monthly amounts (one salary for its whole period), or,
    // for one itself paid in parts, the salaries as they stood when it was submitted.
    const known = s.split ? salaryVersions(structureAsKnownAt(a.structure, s.finalizedAt)) : undefined;
    const paidOn: MonthlyLine[] = s.earnings
      .filter((e) => !s.typedCodes.includes(e.code) && !a.oneTimeCode(e.code))
      .map((e) => ({ code: e.code, name: e.name, monthlyPaise: e.fullPaise, prorate: true }));
    for (const seg of salarySegments(versions, start, end)) {
      const key = seg.version.key ?? 'before';
      if (a.settled.has(`${key}|${s.period}`)) continue;
      const subs = known ? salarySegments(known, seg.from, seg.to) : [{ from: seg.from, to: seg.to, days: seg.days, version: undefined }];
      const revised = await a.calc(seg.version.state, s.period, employedFrom);
      for (const sub of subs) {
        if (sub.version && sameState(sub.version.state, seg.version.state)) continue;
        const share = arrearsShare({ period: s.period, from: s.from, to: s.to, baseDays: s.baseDays, lopDays: s.lopDays, joinedOn: employedFrom, leftOn: s.leftOn }, sub.from, sub.to);
        const oldLines = sub.version ? recurringEarnings(await a.calc(sub.version.state, s.period, employedFrom)) : paidOn;
        const { lines, amountPaise } = arrearsLines(oldLines, recurringEarnings(revised), share);
        if (lines.length === 0) continue;
        items.push({
          revisionKey: key, effectiveFrom: seg.version.from ?? sub.from, period: s.period, from: sub.from, to: sub.to,
          days: share.days, lopDays: share.lopDays, paidDays: share.paidDays, baseDays: s.baseDays,
          previousCtcPaise: sub.version?.state.annualCtcPaise ?? seg.version.revision?.previousCtcPaise ?? 0,
          annualCtcPaise: seg.version.state.annualCtcPaise, lines, amountPaise,
        });
      }
    }
  }
  // Days before this period that no Sowaka run paid (paid outside Sowaka), for revisions saved
  // after the company's first Sowaka run went out (before it, the payroll of the time had them).
  versions.forEach((v, k) => {
    const r = v.revision;
    if (!r || !v.key || atTime(r.at) <= a.firstFinalizedAt || r.effectiveFrom > lastDay) return;
    const next = versions[k + 1]?.from;
    const from = a.joined && a.joined > r.effectiveFrom ? a.joined : r.effectiveFrom;
    const to = next && addDays(next, -1) < lastDay ? addDays(next, -1) : lastDay;
    for (const gap of from <= to ? uncoveredDays(from, to, a.covered) : []) {
      if (a.settled.has(`${v.key}|note:${gap.from}`)) continue;
      items.push({
        revisionKey: v.key, effectiveFrom: r.effectiveFrom, period: gap.to.slice(0, 7), from: gap.from, to: gap.to,
        days: daysBetween(gap.from, gap.to), lopDays: 0, paidDays: 0, baseDays: 0,
        previousCtcPaise: versions[k - 1].state.annualCtcPaise, annualCtcPaise: v.state.annualCtcPaise,
        lines: [], amountPaise: 0, notInSowaka: true,
      });
    }
  });
  return items;
}

/** The part of a later month someone is still employed for: 1 until they leave, 0 after, the days up to the last one in between. */
function shareBeforeLeaving(range: { from: string; to: string } | undefined, left: string): number {
  if (!range) return 1;
  if (left < range.from) return 0;
  if (left >= range.to) return 1;
  const day = 86_400_000;
  return (Math.round((Date.parse(left) - Date.parse(range.from)) / day) + 1) / (Math.round((Date.parse(range.to) - Date.parse(range.from)) / day) + 1);
}

/** One person's payslip as a run made now would compute it (the app's estimate). */
export interface EstimateScope {
  userId: string;
  /** The day attendance is counted to, as the run counts it (today); defaults to today. */
  today?: string;
  /** The month's income tax when the org has no TDS engine on (HR types it on the run). */
  incomeTaxWithoutEnginePaise?: number;
}

/**
 * The payslip a run for `period` would give this person if it were made now:
 * the run's own calculation (structure, flexible split, attendance's loss of
 * pay by their paid days template, meal card, TDS), for them alone, saved
 * nowhere. Null when the run would pay them nothing (no active structure, or
 * not employed in the period). A missing statutory or income tax row is the
 * run's 409 (PayrollConfigError).
 */
export async function estimatePayslip(org: string, period: string, range: PeriodRange, scope: EstimateScope): Promise<Payslip | null> {
  const slips = await buildRunPayslips(scope.userId, org, '', period, range, { lopDays: {}, overtimePaise: {}, incomeTaxPaise: {} }, scope);
  return slips[0] ?? null;
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
  const [run, shown, company, approvers] = await Promise.all([
    findOwnedRun(org, runIdInput),
    // The payslips with their year to date (whole payslips, read for every open of the run) are kept
    // per run (keptReads: dropped by any write at the company, which is how a run or a payslip changes);
    // the bank accounts are kept as stored, encrypted, and shown per request.
    runHex ? cachedLifecycle(org, 'pay-run', { runId: runHex }, () => runSlipsShown(org, runHex)) : Promise.resolve({ views: [], banks: [] }),
    companyOf(org),
    otherRunApprovers(org, adminUserId),
  ]);
  const creatorMayApprove = run.createdByUserId === adminUserId && approvers === 0;
  const banks = bankAccountsOf(shown.banks, true);
  return { run: { ...runView(run), creatorMayApprove }, payslips: shown.views.map((v) => ({ ...v, bankAccountNo: banks.get(v.userId) })), company };
}

/** A run's payslips as the run page shows them (with YTD), and its people's stored bank rows. */
async function runSlipsShown(org: string, runHex: string) {
  const slips = await payslips().find({ org, runId: runHex }).toArray();
  const [views, banks] = await Promise.all([
    withYtd(org, slips.map(payslipView)),
    bankRows(org, [...new Set(slips.map((s) => s.userId))]),
  ]);
  return { views, banks };
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
    // Only the figures summed below: a whole payslip is a few KB, and a run's people over a year are
    // thousands of them (most of the 8.7 s a run took to open).
    payslips()
      .find({ org, userId: { $in: userIds }, period: { $gte: from, $lte: periods[periods.length - 1] } }, { projection: YTD_FIELDS })
      .toArray() as Promise<Payslip[]>,
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

/** What the YTD column sums off each payslip of the year. */
const YTD_FIELDS = { _id: 0, userId: 1, period: 1, runId: 1, 'earnings.code': 1, 'earnings.paidPaise': 1, 'deductions.key': 1, 'deductions.amountPaise': 1, reimbursementsPaise: 1 } as const;

type BankRow = { userId: string; accountNumber?: string; accountLast4?: string };

/** The people's stored bank rows: the number still encrypted, as it is kept. */
async function bankRows(org: string, userIds: string[]): Promise<BankRow[]> {
  return employeePaymentDetails().find({ org, userId: { $in: userIds } } as never, { projection: { _id: 0, userId: 1, accountNumber: 1, accountLast4: 1 } }).toArray() as unknown as Promise<BankRow[]>;
}

/** Each person's bank account number for their payslip, in full only to payroll people (and to them). */
async function bankAccounts(org: string, userIds: string[], reveal: boolean): Promise<Map<string, string>> {
  return bankAccountsOf(await bankRows(org, userIds), reveal);
}

function bankAccountsOf(docs: BankRow[], reveal: boolean): Map<string, string> {
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
  return firstReleased(userId, { userId, period }, { createdAt: -1 });
}

/** The person's latest released payslip before a month, for an estimate's income tax. */
export async function myLatestReleasedPayslipBefore(userId: string, period: string) {
  return firstReleased(userId, { userId, period: { $lt: period } }, { period: -1, createdAt: -1 }, 6);
}

/**
 * The first of these payslips (in this order) whose run is released, read whole; the others are
 * looked at by their run alone. Before, every candidate came whole (a payslip is a few KB) and all
 * but one were thrown away, on every Payroll home, twice.
 */
async function firstReleased(userId: string, filter: Record<string, unknown>, sort: Record<string, 1 | -1>, limit = 0) {
  const ids = await payslips().find(filter as never, { projection: { _id: 1, runId: 1 } }).sort(sort).limit(limit).toArray();
  for (const slip of ids) {
    if (!ObjectId.isValid(slip.runId)) continue;
    const run = await payrollRuns().findOne({ _id: new ObjectId(slip.runId), status: { $in: RELEASED } }, { projection: { _id: 1 } });
    if (!run) continue;
    // Read whole by its id; gone in the moment between (a run recomputed): as if it had not been found.
    const whole = await payslips().findOne({ _id: slip._id, userId });
    if (whole) return whole;
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
  config: StatutoryConfig,
): Promise<ResolvedRuleSet> {
  const key = (state ?? '').trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const resolved = await resolveRuleSet(org, state, config);
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
      heldPaise: (acc.heldPaise ?? 0) + (slip.held ? slip.netPayablePaise : 0),
      heldCount: (acc.heldCount ?? 0) + (slip.held ? 1 : 0),
    }),
    { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0, heldPaise: 0, heldCount: 0 },
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

/** The last day of a period's calendar month: a joiner after it is never on that run. */
const calendarEnd = (period: string) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** The pay dates a run was made for, kept on it so the dashboard can show them. */
function periodDates(range: PeriodRange) {
  return { periodFrom: range.from, periodTo: range.to, baseDays: range.baseDays };
}

function runView(run: StoredRun) {
  return {
    id: run._id.toHexString(),
    period: run.period,
    ...(run.periodFrom ? { periodFrom: run.periodFrom, periodTo: run.periodTo, baseDays: run.baseDays } : {}),
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
    ...(slip.held ? { held: slip.held } : {}),
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
