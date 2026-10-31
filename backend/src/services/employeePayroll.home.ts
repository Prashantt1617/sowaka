/**
 * Payroll home and Missing punches (app › Payroll).
 *
 * Home is this month's pay — the released payslip when there is one, else an
 * estimate from the salary structure and the month's attendance so far — and
 * what needs the person's action. Missing punches lists the month's past
 * working days graded a missed punch or absent; fixing one is the existing
 * correction request (POST /attendance/regularizations).
 */
import { attendanceRecords, attendanceRegularizations, flexibleSplits, salaryStructures } from '../config/db';
import { Payslip } from '../models/payrollRun.model';
import { fyOf } from '../shared/payroll/tds';
import { employeeDayStatuses } from './attendance-report.service';
import { correctionTriggerFor } from './attendance.service';
import { policyForUser, withPolicyMemo } from './shift.service';
import {
  EmployeePayrollError, dayOf, daysInMonth, lastDayOf, lockedPeriods, meOf, parsePeriodParam, payrollAppEnabled, periodOf,
} from './employeePayroll.common';
import { myDeclaration, myProofs } from './employeePayroll.declaration';
import { mySplit, splitAmountsFor } from './employeePayroll.split';
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
  return {
    period: slip.period,
    status: 'final' as const,
    payslipId: slip._id ? slip._id.toHexString() : null,
    grossPaise: full,
    lopDays: slip.inputs?.lopDays ?? 0,
    lopPaise: Math.max(0, full - slip.grossPaise),
    deductions: slip.deductions.filter((d) => !d.hidden && d.amountPaise > 0).map((d) => ({ key: d.key, label: DEDUCTION_LABELS[d.key] ?? d.name, amountPaise: d.amountPaise })),
    netPaise: slip.netPaise,
    reimbursementsPaise: slip.reimbursementsPaise,
    takeHomePaise: slip.netPayablePaise,
  };
}

/** Loss of pay so far this month, as the calendar grades it: absences, half days, leave without pay. */
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

async function estimateFor(org: string, userId: string, period: string, now: Date) {
  const structure = await salaryStructures().findOne({ org, userId });
  if (!structure?.salaryTemplateCode) return null;
  const splits = await flexibleSplits().find({ org, userId }).toArray();
  const { computed } = await computeStructureFor(org, userId, {
    ...structure,
    componentValues: { ...(structure.componentValues ?? {}), ...splitAmountsFor(splits, period) },
  });
  const yesterday = dayOf(new Date(now.getTime() - 86_400_000));
  const to = lastDayOf(period) < yesterday ? lastDayOf(period) : yesterday;
  const graded = to >= `${period}-01` ? await employeeDayStatuses(org, userId, `${period}-01`, to).catch(() => null) : [];
  const lopDays = lopDaysOf(graded);
  const gross = computed.grossMonthlyPaise;
  const lopPaise = Math.round((gross * lopDays) / daysInMonth(period) / 100) * 100;
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
    period,
    status: 'estimate' as const,
    payslipId: null,
    grossPaise: gross,
    lopDays,
    lopPaise,
    deductions: shown,
    netPaise: net,
    reimbursementsPaise: reimbursements,
    takeHomePaise: net + reimbursements,
  };
}

// —— Home ——

export async function myPayrollHome(userId: string, periodRaw: unknown, now = new Date()) {
  const { org, user } = await meOf(userId);
  const period = parsePeriodParam(periodRaw, now);
  const fy = fyOf(periodOf(now)).fy;
  // Off until HR switches Payroll on for the company: the app shows nothing.
  if (!(await payrollAppEnabled(org))) return { appEnabled: false as const, period, fy };

  const released = await myReleasedPayslipFor(userId, period);
  const [salary, punches, split, declaration, proofs] = await Promise.all([
    released ? Promise.resolve(fromPayslip(released)) : estimateFor(org, userId, period, now),
    missingPunchesFor(org, userId, user.employeeId, period, now),
    mySplit(userId, now).catch((error) => {
      if (error instanceof EmployeePayrollError && error.statusCode === 404) return null;
      throw error;
    }),
    myDeclaration(userId, fy, now),
    myProofs(userId, fy, now),
  ]);

  const splitSummary = split?.available
    ? {
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
  // Whether they have split their pool for the FY the window is in.
  const splitThisYear = split?.available
    ? await flexibleSplits().countDocuments({ org, userId, fy: fyOf(split.window.effectiveFrom).fy })
    : 0;

  const todo: Record<string, unknown>[] = [];
  // Only days that can still be fixed; due by the earliest of their last days.
  if (punches.count > 0) todo.push({ kind: 'missing_punches', count: punches.count, dueOn: punches.fixBy, period });
  if (split?.available && split.window.open && splitThisYear === 0) {
    todo.push({ kind: 'flexible_split', dueOn: split.window.closesOn, effectiveFrom: split.window.effectiveFrom, submitted: false });
  }
  if (splitSummary && splitSummary.bills.rejected > 0) {
    todo.push({ kind: 'fbp_bills', rejected: splitSummary.bills.rejected, inReview: splitSummary.bills.inReview, dueOn: split!.billsDueOn });
  }
  if (!declaration.chosen && !declaration.locked) todo.push({ kind: 'tax_regime', regime: declaration.regime, chosen: false, dueOn: declaration.dueOn });
  if (proofs.required && !proofs.locked && proofs.summary.notUploaded + proofs.summary.rejected > 0) {
    todo.push({ kind: 'investment_proofs', notUploaded: proofs.summary.notUploaded, rejected: proofs.summary.rejected, dueOn: proofs.dueOn });
  }

  return {
    appEnabled: true as const,
    period,
    fy,
    hasSalaryStructure: Boolean(salary),
    salary,
    todo,
    missingPunches: { period, count: punches.count, fixBy: punches.fixBy, locked: punches.locked },
    split: splitSummary,
    declaration: { fy, regime: declaration.regime, chosen: declaration.chosen, status: declaration.status, locked: declaration.locked, dueOn: declaration.dueOn },
    proofs: {
      fy,
      required: proofs.required,
      dueOn: proofs.dueOn,
      notUploaded: proofs.summary.notUploaded,
      uploaded: proofs.summary.uploaded,
      approved: proofs.summary.approved,
      rejected: proofs.summary.rejected,
    },
  };
}
