/**
 * Payroll home and Missing punches (app › Payroll).
 *
 * Home is this pay period's pay — the released payslip when there is one, else
 * an estimate from the salary structure and the period's attendance so far,
 * on the company's pay dates and base days (payroll_periods) — and
 * what needs the person's action. Missing punches lists the month's past
 * working days graded a missed punch or absent; fixing one is the existing
 * correction request (POST /attendance/regularizations).
 */
import { ObjectId } from 'mongodb';
import { attendanceRecords, attendanceRegularizations, flexibleSplits, payrollRuns, payslips, salaryStructures } from '../config/db';
import { Payslip, PayrollRunStatus } from '../models/payrollRun.model';
import { fyOf } from '../shared/payroll/tds';
import { employeeDayStatuses, joinedOn } from './attendance-report.service';
import { correctionTriggerFor } from './attendance.service';
import { policyForUser, withPolicyMemo } from './shift.service';
import {
  EmployeePayrollError, askHr, dayOf, lastDayOf, lockedPeriods, meOf, parsePeriodParam, payrollAppEnabled, periodOf,
} from './employeePayroll.common';
import { myDeclaration, myProofs } from './employeePayroll.declaration';
import { mySplit, splitAmountsFor } from './employeePayroll.split';
import { PayrollConfigError } from './payrollConfig.service';
import { PayrollInputsError, PeriodRange, payrollPeriodHolding, payrollPeriodRange } from './payroll-inputs.service';
import { myLatestReleasedPayslipBefore, myReleasedPayslipFor } from './payrollRun.service';
import { computeStructureFor } from './salaryStructure.service';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEDUCTION_LABELS: Record<string, string> = {
  epf: 'Provident fund',
  esi: 'ESI',
  pt: 'Professional tax',
  lwf: 'Labour welfare fund',
  income_tax: 'Income tax (TDS)',
};

// —— Missing punches ——

/** The date `n` days after a 'YYYY-MM-DD' date. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d);
}

/** Today in India, as the offices see it. */
const istDayOf = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export type FixClosedReason = 'window_closed' | 'payroll_locked' | 'corrections_off';
const CLOSED_MESSAGES: Record<FixClosedReason, string> = {
  window_closed: 'The time to fix this day has passed',
  payroll_locked: 'Payroll for this month is locked',
  corrections_off: 'Your shift policy does not allow fixing this day',
};

/**
 * The month's past working days graded a missed punch or absent, each with
 * the last day it can be fixed: the day plus the correction window of the
 * shift policy that governed it (`correction.backdateDays`, the rule
 * POST /attendance/regularizations enforces), and never once the month's run
 * is locked. A day the policy does not let anyone correct (its trigger off,
 * or no window) cannot be fixed at all.
 */
async function missingPunchesFor(org: string, userId: string, employeeId: string | undefined, period: string, now: Date) {
  const from = `${period}-01`;
  const yesterday = dayOf(new Date(now.getTime() - 86_400_000));
  const to = lastDayOf(period) < yesterday ? lastDayOf(period) : yesterday;
  const locked = (await lockedPeriods(org, period, period)).has(period);
  if (to < from) return { period, fixBy: null, locked, count: 0, days: [] };

  const [graded, records, requests] = await Promise.all([
    employeeDayStatuses(org, userId, from, to),
    attendanceRecords()
      .find(employeeId ? { $or: [{ userId }, { employeeId }], workDate: { $gte: from, $lte: to } } : { userId, workDate: { $gte: from, $lte: to } })
      .toArray(),
    attendanceRegularizations().find({ userId, workDate: { $gte: from, $lte: to } }).sort({ createdAt: -1 }).toArray(),
  ]);
  const recordOn = new Map(records.map((r) => [r.workDate, r]));
  const requestOn = new Map<string, (typeof requests)[number]>();
  // The newest request of a day speaks for it; out-of-location and face checks are not corrections.
  for (const r of requests) if (!requestOn.has(r.workDate) && (r.kind ?? 'correction') === 'correction') requestOn.set(r.workDate, r);

  const listed = (graded ?? []).filter((d) => d.final && (d.status === 'missed_punch' || d.status === 'absent'));
  // As the correction itself reads it: the policy as of the day being corrected.
  const policies = await withPolicyMemo(() => Promise.all(listed.map((d) => policyForUser(userId, d.date))));
  const today = istDayOf(now);

  const days = listed.map((d, i) => {
    const rec = recordOn.get(d.date);
    const req = requestOn.get(d.date);
    const correction = policies[i].correction;
    const backdate = Math.max(0, Math.floor(Number(correction.backdateDays) || 0));
    // The trigger the correction is checked against (a single-punch shift reads only the punch-in).
    const policyTrigger = correction.punchMode === 'Single punch'
      ? (rec?.punchIn ? 'Both punches present' : 'Both punches missing')
      : correctionTriggerFor(rec?.punchIn ?? null, rec?.punchOut ?? null);
    const correctable = backdate > 0 && (correction.triggers ?? []).includes(policyTrigger);
    const fixBy = correctable ? addDays(d.date, backdate) : null;
    const closedReason: FixClosedReason | null = !correctable ? 'corrections_off'
      : locked ? 'payroll_locked'
        : today > fixBy! ? 'window_closed'
          : null;
    return {
      date: d.date,
      weekday: WEEKDAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()],
      punchIn: rec?.punchIn ? rec.punchIn.toISOString() : null,
      punchOut: rec?.punchOut ? rec.punchOut.toISOString() : null,
      trigger: correctionTriggerFor(rec?.punchIn ?? null, rec?.punchOut ?? null),
      status: d.status as 'missed_punch' | 'absent',
      label: d.label,
      countsAs: d.countsAs ?? null,
      fixBy,
      canFix: closedReason === null,
      closedReason,
      closedMessage: closedReason ? CLOSED_MESSAGES[closedReason] : null,
      request: req ? { id: req._id.toHexString(), status: req.status, requestedDayType: req.requestedDayType ?? null } : null,
    };
  });
  const toFix = days.filter((d) => d.canFix && (!d.request || d.request.status === 'declined'));
  const fixBy = toFix.reduce<string | null>((min, d) => (min === null || d.fixBy! < min ? d.fixBy : min), null);
  return { period, fixBy, locked, count: toFix.length, days };
}

export async function myMissingPunches(userId: string, periodRaw: unknown, now = new Date()) {
  const { org, user } = await meOf(userId);
  return missingPunchesFor(org, userId, user.employeeId, parsePeriodParam(periodRaw, now), now);
}

// —— This month's pay ——

function fromPayslip(slip: Payslip & { _id?: { toHexString(): string } }) {
  const full = slip.earnings.reduce((sum, e) => sum + e.fullPaise, 0);
  const paid = slip.earnings.reduce((sum, e) => sum + e.paidPaise, 0);
  return {
    period: slip.period,
    status: 'final' as const,
    payslipId: slip._id ? slip._id.toHexString() : null,
    // The run's own base days (what its loss of pay was divided by); its dates are on the run.
    periodFrom: null,
    periodTo: null,
    baseDays: slip.inputs?.workingDays ?? null,
    grossPaise: full,
    lopDays: slip.inputs?.lopDays ?? 0,
    // From the earnings alone: the slip's gross has overtime in it, which would hide loss of pay.
    lopPaise: Math.max(0, full - paid),
    overtimePaise: slip.inputs?.overtimePaise ?? 0,
    deductions: slip.deductions.filter((d) => !d.hidden && d.amountPaise > 0).map((d) => ({ key: d.key, label: DEDUCTION_LABELS[d.key] ?? d.name, amountPaise: d.amountPaise })),
    netPaise: slip.netPaise,
    reimbursementsPaise: slip.reimbursementsPaise,
    takeHomePaise: slip.netPayablePaise,
  };
}

/** Loss of pay so far this pay period, as the calendar grades it: absences, half days, leave without pay. */
function lopDaysOf(days: Awaited<ReturnType<typeof employeeDayStatuses>>): number {
  let lop = 0;
  for (const d of days ?? []) {
    if (!d.final) continue;
    if (d.status === 'absent') lop += 1;
    else if (d.status === 'half_day') lop += 0.5;
    else if (d.status === 'unpaid_leave') lop += d.halfDay ? 0.5 : 1;
    else if (d.status === 'missed_punch') lop += d.countsAs === 'Absent' ? 1 : d.countsAs === 'Half Day' ? 0.5 : 0;
  }
  return lop;
}

/** Why Home cannot work out the pay yet: something HR sets up is missing. Shown instead of a made-up figure. */
export interface SalaryNotSetUp {
  notConfigured: true;
  reason: 'statutory_not_set_up' | 'pay_period_not_set_up';
  fy: string | null;
  message: string;
}

const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const periodKey = (range: PeriodRange) => `${range.year}-${String(range.month).padStart(2, '0')}`;

/**
 * The estimate for one pay period: the structure as it pays that month (its
 * FY's statutory row), loss of pay over the period's days so far, divided by
 * the period's base days, as the run does it. A FY with no statutory row is
 * not guessed at: the gross itself depends on it (employer contributions
 * inside CTC, statutory bonus), so the estimate says it is not set up.
 */
async function estimateFor(org: string, userId: string, period: string, range: PeriodRange, now: Date) {
  const structure = await salaryStructures().findOne({ org, userId });
  if (!structure?.salaryTemplateCode) return null;
  const splits = await flexibleSplits().find({ org, userId }).toArray();
  let computed: Awaited<ReturnType<typeof computeStructureFor>>['computed'];
  try {
    ({ computed } = await computeStructureFor(org, userId, {
      ...structure,
      componentValues: { ...(structure.componentValues ?? {}), ...splitAmountsFor(splits, period) },
    }, undefined, period));
  } catch (error) {
    if (!(error instanceof PayrollConfigError) || error.statusCode !== 409) throw error;
    const fy = fyOf(period).fy;
    const notSetUp: SalaryNotSetUp = {
      notConfigured: true,
      reason: 'statutory_not_set_up',
      fy,
      message: `Your ${monthLabel(period)} pay can't be worked out yet: the statutory settings (PF, ESI, professional tax) for FY ${fy} are not set up. Ask HR.`,
    };
    return { notSetUp };
  }
  const yesterday = dayOf(new Date(now.getTime() - 86_400_000));
  const to = range.to < yesterday ? range.to : yesterday;
  const graded = to >= range.from ? await employeeDayStatuses(org, userId, range.from, to).catch(() => null) : [];
  const lopDays = lopDaysOf(graded);
  const gross = computed.grossMonthlyPaise;
  const lopPaise = Math.round((gross * lopDays) / range.baseDays / 100) * 100;
  const st = computed.statutory;
  const deductions = [
    { key: 'epf', amountPaise: st.epf.employeePaise },
    { key: 'esi', amountPaise: st.esi.applicable ? st.esi.employeePaise : 0 },
    { key: 'pt', amountPaise: st.pt.amountPaise },
    { key: 'lwf', amountPaise: st.lwf.applicable ? st.lwf.employeePaise : 0 },
    ...computed.deductions.map((d) => ({ key: d.code, label: d.payslipName, amountPaise: d.monthlyPaise })),
  ];
  // Income tax: what the last released payslip withheld, as this month's best guess.
  const last = await myLatestReleasedPayslipBefore(userId, period);
  const tax = last?.deductions.find((d) => d.key === 'income_tax')?.amountPaise ?? 0;
  deductions.push({ key: 'income_tax', amountPaise: tax });
  const shown = deductions
    .filter((d) => d.amountPaise > 0)
    .map((d) => ({ key: d.key, label: ('label' in d && d.label) || DEDUCTION_LABELS[d.key] || d.key, amountPaise: d.amountPaise }));
  const net = gross - lopPaise - shown.reduce((sum, d) => sum + d.amountPaise, 0);
  const reimbursements = computed.reimbursements.reduce((sum, r) => sum + r.monthlyPaise, 0);
  return {
    salary: {
      period,
      status: 'estimate' as const,
      payslipId: null,
      periodFrom: range.from as string | null,
      periodTo: range.to as string | null,
      baseDays: range.baseDays as number | null,
      grossPaise: gross,
      lopDays,
      lopPaise,
      // Approved overtime is paid on the run, by the template's rule: not estimated.
      overtimePaise: 0,
      deductions: shown,
      netPaise: net,
      reimbursementsPaise: reimbursements,
      takeHomePaise: net + reimbursements,
    },
  };
}

/** The pay cannot be estimated while HR's pay cycle is unusable: said, for someone who has a structure. */
async function payPeriodNotSetUp(org: string, userId: string, problem: string) {
  const structure = await salaryStructures().findOne({ org, userId }, { projection: { _id: 0, salaryTemplateCode: 1 } });
  if (!structure?.salaryTemplateCode) return null;
  const notSetUp: SalaryNotSetUp = {
    notConfigured: true,
    reason: 'pay_period_not_set_up',
    fy: null,
    message: askHr(`Your pay can't be worked out yet: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`),
  };
  return { notSetUp };
}

/**
 * The pay period Home shows: the one whose pay dates hold today (a company
 * paying 26th to 25th is in November's from 26 October), or the one asked
 * for, never one that has not started. A pay cycle set up wrong is not
 * guessed around: the range is null and `problem` says why.
 */
async function homePayPeriod(org: string, periodRaw: unknown, now: Date): Promise<{ period: string; range: PeriodRange | null; problem: string | null }> {
  const today = istDayOf(now);
  let current: PeriodRange | undefined;
  let problem: string | null = null;
  try {
    current = await payrollPeriodHolding(org, today);
    if (!current) problem = `no pay period set up holds ${today}`;
  } catch (error) {
    if (!(error instanceof PayrollInputsError) || error.statusCode !== 409) throw error;
    problem = error.message;
  }
  const currentPeriod = current ? periodKey(current) : periodOf(now);
  let period = currentPeriod;
  if (periodRaw !== undefined && periodRaw !== null && periodRaw !== '') {
    period = String(periodRaw);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new EmployeePayrollError(400, 'period is like 2026-10');
    if (period > currentPeriod) throw new EmployeePayrollError(400, 'That month has not started yet');
  }
  if (period === currentPeriod) return { period, range: current ?? null, problem: current ? null : problem };
  try {
    return { period, range: await payrollPeriodRange(org, period), problem: null };
  } catch (error) {
    if (!(error instanceof PayrollInputsError) || error.statusCode !== 409) throw error;
    return { period, range: null, problem: error.message };
  }
}

// —— Home's summary cards (the carousel) ——

function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** "2026-10" → "October". */
const monthName = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' });

/** Runs whose payslips the employee may see, as payrollRun.service has them. */
const RELEASED_RUN_STATUSES: PayrollRunStatus[] = ['approved', 'paid'];

const tdsOf = (slip: Payslip) => slip.deductions.find((d) => d.key === 'income_tax')?.amountPaise ?? 0;

/**
 * The last pay period's salary, as a card: its released payslip, else the
 * estimate over all its days. Null for someone with no salary structure, or
 * who joined after it ended; a not-set-up state when HR's settings are
 * missing (never made-up figures).
 */
export type HomeSalaryCard = { period: string; label: string } & (SalaryNotSetUp | {
  notConfigured: false;
  released: boolean;
  payslipId: string | null;
  daysPaid: number | null;
  daysInPeriod: number | null;
  grossPaise: number;
  takeHomePaise: number;
  deductionsPaise: number;
  lopPaise: number;
  lopDays: number;
  overtimePaise: number;
  reimbursementsPaise: number;
});

async function salaryCard(org: string, userId: string, joined: string | undefined, period: string, now: Date): Promise<HomeSalaryCard | null> {
  const prev = previousPeriod(period);
  const label = monthName(prev);
  const released = await myReleasedPayslipFor(userId, prev);
  let range: PeriodRange | null = null;
  let problem = 'the pay period is not set up';
  if (!released) {
    try {
      range = await payrollPeriodRange(org, prev);
    } catch (error) {
      if (!(error instanceof PayrollInputsError) || error.statusCode !== 409) throw error;
      problem = error.message;
    }
    // Not yet with the company then: there is no salary for that period.
    if (range && joined && joined > range.to) return null;
  }
  const pay = released ? { salary: fromPayslip(released) }
    : range ? await estimateFor(org, userId, prev, range, now)
      : await payPeriodNotSetUp(org, userId, problem);
  if (!pay) return null;
  if ('notSetUp' in pay && pay.notSetUp) return { period: prev, label, ...pay.notSetUp };
  if (!('salary' in pay) || !pay.salary) return null;
  const s = pay.salary;
  const daysInPeriod = s.baseDays;
  return {
    period: prev,
    label,
    notConfigured: false,
    released: s.status === 'final',
    payslipId: s.payslipId,
    // Paid days = the period's base days less the days lost; unknown when the payslip has no base days.
    daysPaid: daysInPeriod === null ? null : Math.max(0, daysInPeriod - s.lopDays),
    daysInPeriod,
    grossPaise: s.grossPaise,
    takeHomePaise: s.takeHomePaise,
    deductionsPaise: s.deductions.reduce((sum, d) => sum + d.amountPaise, 0),
    lopPaise: s.lopPaise,
    lopDays: s.lopDays,
    // Paid on top of the gross (and inside the take-home): overtime, flexible and other reimbursements.
    overtimePaise: s.overtimePaise,
    reimbursementsPaise: s.reimbursementsPaise,
  };
}

/** The person's released payslips of the months from..to, the newest run's for each month. */
async function releasedPayslipsBetween(org: string, userId: string, from: string, to: string) {
  const slips = await payslips().find({ org, userId, period: { $gte: from, $lte: to } }).sort({ createdAt: -1 }).toArray();
  const runIds = [...new Set(slips.map((s) => s.runId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const runs = runIds.length
    ? await payrollRuns().find({ _id: { $in: runIds }, status: { $in: RELEASED_RUN_STATUSES } }, { projection: { _id: 1 } }).toArray()
    : [];
  const released = new Set(runs.map((r) => r._id.toHexString()));
  const byPeriod = new Map<string, Payslip>();
  for (const slip of slips) if (released.has(slip.runId) && !byPeriod.has(slip.period)) byPeriod.set(slip.period, slip);
  return byPeriod;
}

/**
 * Income tax this FY: what the released payslips withheld from April to the
 * month before this pay period, and this period's own (its payslip once
 * released, else the estimate's). The regime is the declaration's; a FY
 * whose tax rules are not set up says so instead.
 */
async function taxCard(
  org: string,
  userId: string,
  period: string,
  declaration: { regime: string; chosen: boolean } | null,
  thisMonth: { released: boolean; taxPaise: number } | null,
) {
  const { fy, firstPeriod } = fyOf(period);
  if (!declaration) {
    return {
      fy,
      notConfigured: true as const,
      reason: 'tax_rules_not_set_up' as const,
      message: askHr(`The income tax rules for FY ${fy} are not set up yet`),
    };
  }
  const slips = await releasedPayslipsBetween(org, userId, firstPeriod, period);
  let before = 0;
  for (const [p, slip] of slips) if (p < period) before += tdsOf(slip);
  const own = slips.get(period);
  // This period's tax: its payslip, else the estimate; unknown while its pay can't be worked out.
  const thisMonthPaise = own ? tdsOf(own) : thisMonth ? thisMonth.taxPaise : null;
  return {
    fy,
    notConfigured: false as const,
    regime: declaration.regime,
    regimeChosen: declaration.chosen,
    paidSoFarPaise: before + (thisMonthPaise ?? 0),
    paidBeforeThisMonthPaise: before,
    thisMonthPaise,
    thisMonthReleased: Boolean(own),
    fromMonth: firstPeriod,
    // The months the total covers: up to this one, or the one before while this one is unknown.
    toMonth: thisMonthPaise === null && period > firstPeriod ? previousPeriod(period) : period,
    thisMonth: period,
  };
}

/** The flexible pool as the person split it, head by head, and what is left; null without flexible heads. */
function fbpCard(split: Awaited<ReturnType<typeof mySplit>> | null) {
  if (!split?.available) return null;
  return {
    poolPaise: split.poolPaise,
    heads: split.components.filter((c) => c.amountPaise > 0).map((c) => ({ code: c.code, name: c.name, amountPaise: c.amountPaise })),
    assignedPaise: split.assignedPaise,
    unassignedPaise: split.unassignedPaise,
    // The pool itself not set: shown as split, without a "Not assigned" share.
    notConfigured: split.notConfigured,
    missing: split.missing,
  };
}

// —— Home ——

export async function myPayrollHome(userId: string, periodRaw: unknown, now = new Date()) {
  const { org, user } = await meOf(userId);
  const fy = fyOf(periodOf(now)).fy;
  // Off until HR switches Payroll on for the company: the app shows nothing.
  if (!(await payrollAppEnabled(org))) return { appEnabled: false as const, period: parsePeriodParam(periodRaw, now), fy };

  // The salary is the pay period's (payroll_periods); missing punches stay the
  // calendar month's, as the attendance calendar they open shows them.
  const { period, range, problem } = await homePayPeriod(org, periodRaw, now);
  const punchesPeriod = period < periodOf(now) ? period : periodOf(now);
  const released = await myReleasedPayslipFor(userId, period);
  const [pay, punches, split, declaration, proofs] = await Promise.all([
    released ? Promise.resolve({ salary: fromPayslip(released) })
      : range ? estimateFor(org, userId, period, range, now)
        : payPeriodNotSetUp(org, userId, problem ?? 'the pay period is not set up'),
    missingPunchesFor(org, userId, user.employeeId, punchesPeriod, now),
    mySplit(userId, now).catch((error) => {
      if (error instanceof EmployeePayrollError && error.statusCode === 404) return null;
      throw error;
    }),
    // A FY whose tax rules are not set up: the section says so instead of failing home.
    myDeclaration(userId, fy, now).catch((error) => {
      if (error instanceof EmployeePayrollError && error.details?.reason === 'tax_rules_not_set_up') return null;
      throw error;
    }),
    myProofs(userId, fy, now),
  ]);

  const salary = pay && 'salary' in pay ? pay.salary : null;
  const salaryNotSetUp = pay && 'notSetUp' in pay ? pay.notSetUp : null;
  // The carousel: last period's salary, this FY's tax, the flexible split.
  const [salaryCardOf, taxCardOf] = await Promise.all([
    salaryCard(org, userId, joinedOn(user), period, now),
    taxCard(org, userId, period, declaration, salary
      ? { released: salary.status === 'final', taxPaise: salary.deductions.find((d) => d.key === 'income_tax')?.amountPaise ?? 0 }
      : null),
  ]);
  const cards = { salary: salaryCardOf, tax: taxCardOf, fbp: fbpCard(split) };
  const splitSummary = split?.available
    ? {
      notConfigured: split.notConfigured,
      missing: split.missing,
      open: split.window.open,
      effectiveFrom: split.window.effectiveFrom,
      closesOn: split.window.closesOn,
      poolPaise: split.poolPaise,
      assignedPaise: split.assignedPaise,
      unassignedPaise: split.unassignedPaise,
      bills: split.components.reduce(
        (acc, c) => ({ approved: acc.approved + c.bills.approved, inReview: acc.inReview + c.bills.inReview, rejected: acc.rejected + c.bills.rejected }),
        { approved: 0, inReview: 0, rejected: 0 },
      ),
    }
    : null;
  // Whether they have split their pool for the FY the window is in (today's while the window is not set up).
  const splitFy = split?.window.effectiveFrom ? fyOf(split.window.effectiveFrom).fy : fy;
  const splitThisYear = split?.available ? await flexibleSplits().countDocuments({ org, userId, fy: splitFy }) : 0;

  // A to-do whose deadline HR has not set says so (notConfigured, dueOn null) rather than carry a made-up date.
  const notSet = (missing: string[]) => (missing.length > 0 ? { notConfigured: true, reason: 'payroll_not_configured', missing } : { notConfigured: false });
  const todo: Record<string, unknown>[] = [];
  // Only days that can still be fixed; due by the earliest of their last days.
  if (punches.count > 0) todo.push({ kind: 'missing_punches', count: punches.count, dueOn: punches.fixBy, period: punchesPeriod, notConfigured: false });
  if (split?.available && splitThisYear === 0 && (split.window.open || split.notConfigured)) {
    todo.push({ kind: 'flexible_split', dueOn: split.window.closesOn, effectiveFrom: split.window.effectiveFrom, submitted: false, ...notSet(split.missing) });
  }
  if (splitSummary && splitSummary.bills.rejected > 0) {
    todo.push({ kind: 'fbp_bills', rejected: splitSummary.bills.rejected, inReview: splitSummary.bills.inReview, dueOn: split!.billsDueOn, ...notSet(split!.billsDueOn ? [] : ['billsDue']) });
  }
  if (!declaration) {
    todo.push({ kind: 'tax_regime', regime: null, chosen: false, dueOn: null, notConfigured: true, reason: 'tax_rules_not_set_up', missing: [] });
  } else if (!declaration.chosen && !declaration.locked) {
    todo.push({ kind: 'tax_regime', regime: declaration.regime, chosen: false, dueOn: declaration.dueOn, ...notSet(declaration.missing) });
  }
  if (proofs.required && !proofs.locked && proofs.summary.notUploaded + proofs.summary.rejected > 0) {
    todo.push({ kind: 'investment_proofs', notUploaded: proofs.summary.notUploaded, rejected: proofs.summary.rejected, dueOn: proofs.dueOn, ...notSet(proofs.missing) });
  }

  return {
    appEnabled: true as const,
    period,
    fy,
    // The days this pay period pays for and the base days its loss of pay is divided by; null when the pay cycle is not usable.
    payPeriod: range ? { period, from: range.from, to: range.to, baseDays: range.baseDays } : null,
    hasSalaryStructure: Boolean(salary || salaryNotSetUp),
    salary,
    // Set (and salary null) when the pay cannot be worked out until HR sets something up.
    salaryNotSetUp,
    todo,
    cards,
    missingPunches: { period: punchesPeriod, count: punches.count, fixBy: punches.fixBy, locked: punches.locked },
    split: splitSummary,
    declaration: declaration
      ? {
        fy, regime: declaration.regime, chosen: declaration.chosen, status: declaration.status, locked: declaration.locked, dueOn: declaration.dueOn,
        notConfigured: declaration.notConfigured, reason: declaration.notConfigured ? 'payroll_not_configured' : null, missing: declaration.missing,
      }
      : { fy, regime: null, chosen: false, status: null, locked: false, dueOn: null, notConfigured: true, reason: 'tax_rules_not_set_up', missing: [] },
    proofs: {
      fy,
      required: proofs.required,
      dueOn: proofs.dueOn,
      notConfigured: proofs.notConfigured,
      missing: proofs.missing,
      notUploaded: proofs.summary.notUploaded,
      uploaded: proofs.summary.uploaded,
      approved: proofs.summary.approved,
      rejected: proofs.summary.rejected,
    },
  };
}
