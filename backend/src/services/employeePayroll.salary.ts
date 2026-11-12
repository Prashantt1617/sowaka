/**
 * Salary summary (app › Payroll › "<Month> salary"): one pay period's pay as
 * a receipt — gross, loss of pay, each deduction and the take-home — every
 * line with a plain-English reason built from the real figures and the
 * company's own rules (the FY's statutory row, the person's state PT / LWF
 * rule, the pay period's base days). The released payslip when there is one,
 * else the estimate Home shows (estimateFor). By default the previous pay
 * period: the one most recently over, on the company's pay dates
 * (payroll_periods: a company paying 26th to 25th is on October's until
 * 25 October). Nothing is filled in from code: a rule HR has not set up says
 * "not set up".
 */
import { ObjectId } from 'mongodb';
import { flexibleSplits, payrollRuns, payslips, salaryStructures } from '../config/db';
import { PtRule, LwfRule } from '../models/statutoryRule.model';
import { Payslip } from '../models/payrollRun.model';
import { User } from '../models/user.model';
import { StatutoryConfig, ratePercentLabel } from '../shared/payroll/statutory-config';
import { fyOf } from '../shared/payroll/tds';
import { employeeDayStatuses } from './attendance-report.service';
import { dayOf, EmployeePayrollError, meOf, periodOf } from './employeePayroll.common';
import { estimateFor, fromPayslip, homePayPeriod, missingPunchesFor, payPeriodNotSetUp } from './employeePayroll.home';
import { splitAmountsFor } from './employeePayroll.split';
import { PayrollConfigError, statutoryConfigForPeriod } from './payrollConfig.service';
import { myLatestReleasedPayslipBefore, myReleasedPayslipFor } from './payrollRun.service';
import { computeStructureFor } from './salaryStructure.service';
import { resolveRuleSet } from './statutory.service';
import { workStateOf } from './statutorySettings.service';

export type SalaryLineKind = 'earning' | 'deduction' | 'lop';

export interface SalaryLine {
  key: string;
  label: string;
  amountPaise: number;
  kind: SalaryLineKind;
  explanation: string;
}

export interface SalaryLop {
  /** Days of pay lost: what the run divided by the base days (half days as ½). */
  days: number;
  absentDays: number;
  halfDays: number;
  /** Missed punches the shift counts as an absence or a half day, in days lost. */
  missedPunchDays: number;
  unpaidLeaveDays: number;
  /** One day's pay: gross ÷ base days. Null when the base days are not known. */
  perDayPaise: number | null;
  /** HR typed the loss of pay on the run. */
  enteredByHr: boolean;
}

// —— words ——

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

const monthName = (period: string) => MONTHS[Number(period.slice(5, 7)) - 1];
const periodLabel = (period: string) => `${monthName(period)} ${period.slice(0, 4)}`;
/** "2026-09-26" → "26 Sep". */
const shortDay = (day: string) => `${Number(day.slice(8, 10))} ${SHORT[Number(day.slice(5, 7)) - 1]}`;
/** Whole rupees, Indian grouping: ₹1,24,000. */
const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
/** 2 → "2 days", 1 → "1 day", 0.5 → "½ day", 2.5 → "2½ days". */
function dayCount(days: number): string {
  const whole = Math.floor(days);
  const half = days - whole >= 0.5;
  const n = half ? (whole === 0 ? '½' : `${whole}½`) : String(whole);
  return `${n} ${days === 1 || days === 0.5 ? 'day' : 'days'}`;
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const lastOfMonth = (period: string) => dayOf(new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)));

/** "31 days in October", or the pay dates / base days when they are not the calendar month's. */
function baseDaysPhrase(period: string, baseDays: number, from: string | null, to: string | null): string {
  const calendar = (!from || from === `${period}-01`) && (!to || to === lastOfMonth(period));
  if (calendar && baseDays === daysBetween(`${period}-01`, lastOfMonth(period))) return `${baseDays} days in ${monthName(period)}`;
  if (from && to && baseDays === daysBetween(from, to)) return `${baseDays} days from ${shortDay(from)} to ${shortDay(to)}`;
  return `${baseDays} base days set for ${monthName(period)}'s pay`;
}

/** "Basic ₹62,000 + HRA ₹24,800", the rest as one figure so the parts add up to the whole. */
function partsOf(parts: { name: string; paise: number }[], total: number, max = 4): string {
  const shown = parts.filter((p) => p.paise > 0);
  const listed = shown.slice(0, max);
  const rest = total - listed.reduce((sum, p) => sum + p.paise, 0);
  const words = listed.map((p) => `${p.name} ${inr(p.paise)}`);
  if (rest >= 100) words.push(`${listed.length ? 'other pay' : 'pay'} ${inr(rest)}`);
  return words.join(' + ');
}

// —— the rules behind each line ——

interface Rules {
  config: StatutoryConfig | null;
  /** Why there is no config: the FY's statutory row is missing. */
  configMissing: string | null;
  state: string | null;
  pt?: PtRule;
  lwf?: LwfRule;
}

async function rulesFor(org: string, user: Omit<User, 'profilePhotoUrl'>, period: string): Promise<Rules> {
  let config: StatutoryConfig;
  try {
    config = await statutoryConfigForPeriod(period);
  } catch (error) {
    if (!(error instanceof PayrollConfigError) || error.statusCode !== 409) throw error;
    return { config: null, configMissing: fyOf(period).fy, state: null };
  }
  const state = workStateOf(user) ?? null;
  const ruleSet = await resolveRuleSet(org, state ?? undefined, config);
  return { config, configMissing: null, state, pt: ruleSet.pt, lwf: ruleSet.lwf };
}

const notSetUp = (rules: Rules, what: string) =>
  `The statutory settings for FY ${rules.configMissing} are not set up, so ${what} can't be explained here. Ask HR.`;

function pfExplanation(rules: Rules, amountPaise: number, wage: { contributionPaise: number; pfWagePaise: number } | null): string {
  if (!rules.config) return notSetUp(rules, 'the PF rate');
  const rate = rules.config.epf.employeeRate;
  const why = 'saved in your PF account for retirement';
  if (!wage || wage.contributionPaise <= 0 || Math.abs(Math.round(wage.contributionPaise * rate) - amountPaise) > 100) {
    return `Your share of provident fund: ${ratePercentLabel(rate)} of your PF wage, ${why}.`;
  }
  const capped = wage.contributionPaise < wage.pfWagePaise
    ? ` (your PF wage is ${inr(wage.pfWagePaise)}; PF is worked out on the ${inr(wage.contributionPaise)} ceiling)`
    : '';
  return `${ratePercentLabel(rate)} of your PF wage of ${inr(wage.contributionPaise)}${capped}, ${why}.`;
}

function esiExplanation(rules: Rules): string {
  if (!rules.config) return notSetUp(rules, 'the ESI rate');
  const { employeeRate, grossCeilingPaise } = rules.config.esi;
  return `Employees' State Insurance: ${ratePercentLabel(employeeRate)} of your pay, for medical cover for you and your family. `
    + `It applies while your monthly pay is ${inr(grossCeilingPaise)} or less.`;
}

function ptExplanation(rules: Rules, amountPaise: number, grossPaise: number, month: number): string {
  if (!rules.config) return notSetUp(rules, 'professional tax');
  const where = rules.state ? titleCase(rules.state) : 'your state';
  if (!rules.pt?.slabs?.length) return `A tax set by ${where}. Its professional tax slabs are not set up. Ask HR.`;
  const slabs = [...rules.pt.slabs].sort((a, b) => (a.upToPaise ?? Infinity) - (b.upToPaise ?? Infinity));
  const charged = (s: PtRule['slabs'][number]) => (s.monthOverride?.month === month ? s.monthOverride.amountPaise : s.amountPaise);
  // The slab the pay falls in, as the engine finds it; else the one that charges this amount.
  let at = slabs.findIndex((s) => s.upToPaise === null || grossPaise <= s.upToPaise);
  if (at < 0 || charged(slabs[at]) !== amountPaise) at = slabs.findIndex((s) => charged(s) === amountPaise);
  if (at < 0) return `A tax set by ${where}: ${inr(amountPaise)} this month.`;
  const slab = slabs[at];
  const below = at > 0 ? slabs[at - 1].upToPaise : null;
  // A bound in paise as the slab means it: ₹24,999.99 is "under ₹25,000", ₹10,000 is "up to ₹10,000".
  const over = (paise: number) => (paise % 100 === 0 ? `over ${inr(paise)}` : `of ${inr(Math.ceil(paise / 100) * 100)} or more`);
  const upTo = (paise: number) => (paise % 100 === 0 ? `up to ${inr(paise)}` : `under ${inr(Math.ceil(paise / 100) * 100)}`);
  const band = slab.upToPaise === null
    ? (below === null ? 'whatever your pay' : `for monthly pay ${over(below)}`)
    : below === null ? `for monthly pay ${upTo(slab.upToPaise)}` : `for monthly pay ${over(below)}, ${upTo(slab.upToPaise)}`;
  const special = slab.monthOverride && slab.monthOverride.month !== month
    ? ` (${inr(slab.monthOverride.amountPaise)} in ${MONTHS[slab.monthOverride.month - 1]})`
    : slab.monthOverride?.month === month ? ` (${MONTHS[month - 1]}'s amount; ${inr(slab.amountPaise)} in other months)` : '';
  return `A tax set by ${where}: ${inr(charged(slab))} a month ${band}${special}.`;
}

function lwfExplanation(rules: Rules): string {
  if (!rules.config) return notSetUp(rules, 'labour welfare fund');
  const where = rules.state ? titleCase(rules.state) : 'your state';
  const lwf = rules.lwf;
  if (!lwf) return `Labour welfare fund, set by ${where}.`;
  const amount = lwf.employee.mode === 'flat'
    ? inr(lwf.employee.amountPaise)
    : `${lwf.employee.percent}% of your pay${lwf.employee.capPaise ? ` (at most ${inr(lwf.employee.capPaise)})` : ''}`;
  const when = lwf.cycle === 'monthly' || lwf.deductionMonths.length >= 12
    ? 'every month'
    : `in ${lwf.deductionMonths.map((m) => MONTHS[m - 1]).join(' and ')}`;
  return `Labour welfare fund, set by ${where}: ${amount}, taken ${when}.`;
}

function taxExplanation(period: string, amountPaise: number, slip: Payslip | null, estimateFrom: Payslip | null): string {
  if (slip) {
    if (slip.inputs?.incomeTaxEnteredByHr) return `The income tax HR set for ${monthName(period)}.`;
    const tds = slip.inputs?.tds;
    if (tds && tds.monthsLeft > 0) {
      const left = Math.max(0, tds.annualTaxPaise - tds.alreadyDeductedPaise);
      const months = tds.monthsLeft === 1 ? `${monthName(period)}, the last month of the year` : `the ${tds.monthsLeft} months from ${monthName(period)} to March`;
      const before = tds.alreadyDeductedPaise > 0
        ? `${inr(tds.alreadyDeductedPaise)} was taken before ${monthName(period)}, so the ${inr(left)} left is split across ${months}.`
        : `None of it was taken before ${monthName(period)}, so it is split across ${months}.`;
      return `Your income tax for FY ${tds.fy} under the ${tds.regime} regime comes to ${inr(tds.annualTaxPaise)}. ${before}`;
    }
    return `Income tax taken from your ${monthName(period)} pay.`;
  }
  if (estimateFrom) {
    return `For this estimate, what your ${periodLabel(estimateFrom.period)} payslip took (${inr(amountPaise)}). `
      + `Payroll works out ${monthName(period)}'s from your tax for the year.`;
  }
  return `Your estimated tax for the year, split across the months left.`;
}

// —— loss of pay ——

type Graded = Awaited<ReturnType<typeof employeeDayStatuses>>;

/** The days behind an estimate's loss of pay, as lopDaysOf (Home) counts them. */
function lopFromCalendar(days: Graded) {
  let absentDays = 0;
  let halfDays = 0;
  let missedPunchDays = 0;
  let unpaidLeaveDays = 0;
  for (const d of days ?? []) {
    if (!d.final) continue;
    if (d.status === 'absent') absentDays += 1;
    else if (d.status === 'half_day') halfDays += 1;
    else if (d.status === 'unpaid_leave') unpaidLeaveDays += d.halfDay ? 0.5 : 1;
    else if (d.status === 'missed_punch') missedPunchDays += d.countsAs === 'Absent' ? 1 : d.countsAs === 'Half Day' ? 0.5 : 0;
  }
  return { absentDays, halfDays, missedPunchDays, unpaidLeaveDays };
}

/** What makes up the loss of pay, in words: "1 absent day + 2 half days". */
function lopParts(lop: SalaryLop, extra: string[]): string {
  const parts: string[] = [];
  if (lop.absentDays > 0) parts.push(plural(lop.absentDays, 'absent day', 'absent days'));
  if (lop.halfDays > 0) parts.push(plural(lop.halfDays, 'half day', 'half days'));
  if (lop.missedPunchDays > 0) parts.push(`${dayCount(lop.missedPunchDays)} for punches not fixed`);
  if (lop.unpaidLeaveDays > 0) parts.push(`${dayCount(lop.unpaidLeaveDays)} of leave without pay`);
  parts.push(...extra);
  return parts.join(' + ');
}

function lopExplanation(period: string, lop: SalaryLop, grossPaise: number, baseDays: number | null, from: string | null, to: string | null, extra: string[], offset: string | null): string {
  const what = lop.enteredByHr
    ? `HR set ${dayCount(lop.days)} of loss of pay for ${monthName(period)}.`
    : (() => {
      const parts = lopParts(lop, extra);
      return parts ? `${parts}${offset ? `, ${offset}` : ''}.` : `${dayCount(lop.days)} without pay.`;
    })();
  if (!baseDays || lop.perDayPaise === null) return what;
  return `${what} One day's pay is ${inr(lop.perDayPaise)} (${inr(grossPaise)} ÷ ${baseDaysPhrase(period, baseDays, from, to)}).`;
}

// —— past payslips ——

async function releasedPeriods(userId: string): Promise<string[]> {
  const slips = await payslips().find({ userId }, { projection: { _id: 0, period: 1, runId: 1 } }).toArray();
  const runIds = [...new Set(slips.map((s) => s.runId))];
  const ids = runIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const runs = ids.length ? await payrollRuns().find({ _id: { $in: ids }, status: { $in: ['approved', 'paid'] } }, { projection: { _id: 1 } }).toArray() : [];
  const released = new Set(runs.map((r) => r._id.toHexString()));
  return [...new Set(slips.filter((s) => released.has(s.runId)).map((s) => s.period))].sort();
}

// —— the summary ——

const DEDUCTION_ORDER = ['epf', 'esi', 'income_tax', 'pt', 'lwf'];
const orderOf = (key: string) => (DEDUCTION_ORDER.includes(key) ? DEDUCTION_ORDER.indexOf(key) : DEDUCTION_ORDER.length);

/**
 * `view` (app › Salary's Previous Month | Current Month switch): "previous"
 * (the default) is the pay period most recently over, "current" the one
 * running now — its estimate, worked out as a run would (estimateFor). A
 * `period` asked for wins over either.
 */
export type SalaryView = 'previous' | 'current';

export async function mySalarySummary(userId: string, periodRaw: unknown, now = new Date(), viewRaw?: unknown) {
  const { org, user } = await meOf(userId);
  const asked = periodRaw !== undefined && periodRaw !== null && periodRaw !== '';
  if (viewRaw !== undefined && viewRaw !== null && viewRaw !== '' && viewRaw !== 'previous' && viewRaw !== 'current') {
    throw new EmployeePayrollError(400, 'view is previous or current');
  }
  // The pay period most recently over by default; a month asked for is checked as Home checks it.
  const current = asked ? null : await homePayPeriod(org, undefined, now);
  const view: SalaryView | null = asked ? null : viewRaw === 'current' ? 'current' : 'previous';
  const { period, range, problem } = await homePayPeriod(org, asked ? periodRaw : view === 'current' ? current!.period : previousPeriod(current!.period), now);

  const [released, periods, punches] = await Promise.all([
    myReleasedPayslipFor(userId, period),
    releasedPeriods(userId),
    // Unpaid days open on the calendar month of the period's end, as the attendance list shows them.
    missingPunchesFor(org, userId, user.employeeId, period < periodOf(now) ? period : periodOf(now), now),
  ]);
  const base = {
    period,
    label: periodLabel(period),
    /** Which side of the switch this is (null when a period was asked for), and the two periods it flips between. */
    view,
    currentPeriod: current?.period ?? null,
    previousPeriod: current ? previousPeriod(current.period) : null,
    unpaidDays: { period: punches.period, count: punches.count, fixBy: punches.fixBy, locked: punches.locked },
    payslips: { count: periods.length, from: periods[0] ?? null, to: periods[periods.length - 1] ?? null },
  };
  const empty = (reason: string, message: string) => ({
    ...base,
    released: false,
    payslipId: null,
    periodFrom: range?.from ?? null,
    periodTo: range?.to ?? null,
    daysPaid: null,
    daysInPeriod: range ? daysBetween(range.from, range.to) : null,
    baseDays: range?.baseDays ?? null,
    grossPaise: null,
    takeHomePaise: null,
    lines: [] as SalaryLine[],
    lop: null,
    notSetUp: { reason, message },
  });

  const rules = await rulesFor(org, user, period);
  const month = Number(period.slice(5, 7));

  if (released) {
    const pay = fromPayslip(released);
    const run = await payrollRuns().findOne({ _id: new ObjectId(released.runId) }, { projection: { _id: 0, periodFrom: 1, periodTo: 1 } });
    const from = run?.periodFrom ?? `${period}-01`;
    const to = run?.periodTo ?? lastOfMonth(period);
    const baseDays = pay.baseDays;
    const inputs = released.inputs;
    const rows = inputs?.attendanceDeductions ?? [];
    const sum = (pick: (r: (typeof rows)[number]) => boolean) => rows.filter(pick).reduce((t, r) => t + r.days, 0);
    const count = (pick: (r: (typeof rows)[number]) => boolean) => rows.filter(pick).reduce((t, r) => t + r.count, 0);
    const beforeJoining = (r: (typeof rows)[number]) => r.label === 'Before joining';
    const lop: SalaryLop = {
      days: pay.lopDays,
      absentDays: count((r) => r.trigger === 'absent' && !beforeJoining(r)),
      halfDays: count((r) => r.trigger === 'half_day'),
      missedPunchDays: sum((r) => r.trigger === 'missed_punch'),
      unpaidLeaveDays: sum((r) => r.trigger === 'unpaid_leave'),
      perDayPaise: baseDays ? Math.round(pay.grossPaise / baseDays) : null,
      enteredByHr: inputs?.lopEnteredByHr === true,
    };
    // The template's own rules (late marks, early leaves…) and the days before joining.
    const extra = [
      ...rows.filter((r) => ['late', 'early', 'leave'].includes(r.trigger ?? '') && r.days > 0)
        .map((r) => `${plural(r.count, r.label.toLowerCase().replace(/s$/, ''), r.label.toLowerCase())} (${dayCount(r.days)})`),
      ...rows.filter((r) => beforeJoining(r) && r.days > 0).map((r) => `${dayCount(r.days)} before you joined`),
    ];
    const offset = (inputs?.paidLeaveDaysApplied ?? 0) > 0 ? `less ${dayCount(inputs!.paidLeaveDaysApplied!)} of paid leave` : null;

    const visible = released.earnings.filter((e) => !e.hidden).map((e) => ({ name: e.name, paise: e.fullPaise }));
    const lines: SalaryLine[] = [{
      key: 'gross', label: 'Gross salary', amountPaise: pay.grossPaise, kind: 'earning',
      explanation: `Your fixed monthly pay before any deductions: ${partsOf(visible, pay.grossPaise)}.`,
    }];
    if (pay.lopPaise > 0 || pay.lopDays > 0) {
      lines.push({
        key: 'lop', label: `Loss of pay · ${dayCount(pay.lopDays)}`, amountPaise: pay.lopPaise, kind: 'lop',
        explanation: lopExplanation(period, lop, pay.grossPaise, baseDays, from, to, extra, offset),
      });
    }
    if (pay.overtimePaise > 0) {
      lines.push({
        key: 'overtime', label: 'Overtime', amountPaise: pay.overtimePaise, kind: 'earning',
        explanation: inputs?.overtimeEnteredByHr
          ? `The overtime pay HR set for ${monthName(period)}.`
          : `${plural(inputs?.approvedOtHours ?? 0, 'hour', 'hours')} of approved overtime, paid by your salary template's overtime rule.`,
      });
    }
    const grossForPt = released.grossPaise;
    for (const d of [...pay.deductions].sort((a, b) => orderOf(a.key) - orderOf(b.key))) {
      lines.push({
        key: d.key, label: d.label, amountPaise: d.amountPaise, kind: 'deduction',
        explanation: d.key === 'epf' ? pfExplanation(rules, d.amountPaise, { contributionPaise: released.epf?.contributionWagePaise ?? 0, pfWagePaise: released.pfWagePaise })
          : d.key === 'esi' ? esiExplanation(rules)
            : d.key === 'pt' ? ptExplanation(rules, d.amountPaise, grossForPt, month)
              : d.key === 'lwf' ? lwfExplanation(rules)
                : d.key === 'income_tax' ? taxExplanation(period, d.amountPaise, released, null)
                  : `${d.label}: a deduction in your salary structure.`,
      });
    }
    // Not listed on the payslip, but taken: one line, so the receipt adds up.
    const hidden = released.deductions.filter((d) => d.hidden && d.amountPaise > 0).reduce((t, d) => t + d.amountPaise, 0);
    if (hidden > 0) lines.push({ key: 'other_deductions', label: 'Other deductions', amountPaise: hidden, kind: 'deduction', explanation: 'Deductions your company does not list on the payslip.' });
    if (pay.reimbursementsPaise > 0) {
      const parts = (released.reimbursementLines ?? []).filter((r) => !r.hidden).map((r) => ({ name: r.name, paise: r.amountPaise }));
      lines.push({
        key: 'reimbursements', label: 'Reimbursements', amountPaise: pay.reimbursementsPaise, kind: 'earning',
        explanation: `Paid with your salary, outside gross pay: ${partsOf(parts, pay.reimbursementsPaise)}.`,
      });
    }
    const daysPaid = inputs?.payableDays ?? (baseDays !== null ? Math.max(0, baseDays - pay.lopDays) : null);
    return {
      ...base,
      released: true,
      payslipId: pay.payslipId,
      periodFrom: from,
      periodTo: to,
      daysPaid,
      daysInPeriod: daysBetween(from, to),
      baseDays,
      grossPaise: pay.grossPaise,
      takeHomePaise: pay.takeHomePaise,
      lines,
      lop,
      notSetUp: null,
    };
  }

  // —— the estimate ——
  if (!range) {
    const said = await payPeriodNotSetUp(org, userId, problem ?? 'the pay period is not set up');
    return said
      ? empty(said.notSetUp.reason, said.notSetUp.message)
      : empty('no_salary_structure', 'Your salary shows here once HR sets up your pay.');
  }
  const estimate = await estimateFor(org, userId, period, range, now);
  if (!estimate) return empty('no_salary_structure', 'Your salary shows here once HR sets up your pay.');
  if (estimate.notSetUp) return empty(estimate.notSetUp.reason, estimate.notSetUp.message);
  const s = estimate.salary!;

  // The same structure, worked out the same way, for what each line is made of.
  const structure = await salaryStructures().findOne({ org, userId });
  const splits = await flexibleSplits().find({ org, userId }).toArray();
  const { computed } = await computeStructureFor(org, userId, {
    ...structure!,
    componentValues: { ...(structure!.componentValues ?? {}), ...splitAmountsFor(splits, period) },
  }, undefined, period);
  const yesterday = dayOf(new Date(now.getTime() - 86_400_000));
  const to = range.to < yesterday ? range.to : yesterday;
  const graded = to >= range.from ? await employeeDayStatuses(org, userId, range.from, to).catch(() => null) : [];
  const parts = lopFromCalendar(graded);
  // The estimate is the run's own count: a working day with no punches at all is absent there even
  // when the calendar shows it ungraded, so what the parts don't explain reads as absent days.
  const explained = parts.absentDays + parts.halfDays * 0.5 + parts.missedPunchDays + parts.unpaidLeaveDays;
  if (s.lopDays > explained) parts.absentDays += Math.round((s.lopDays - explained) * 2) / 2;
  const lop: SalaryLop = {
    days: s.lopDays,
    ...parts,
    perDayPaise: Math.round(s.grossPaise / range.baseDays),
    enteredByHr: false,
  };
  const lastSlip = await myLatestReleasedPayslipBefore(userId, period);

  const earnings = computed.earnings.filter((e) => e.showInPayslip !== false).map((e) => ({ name: e.payslipName || e.name, paise: e.monthlyPaise }));
  const lines: SalaryLine[] = [{
    key: 'gross', label: 'Gross salary', amountPaise: s.grossPaise, kind: 'earning',
    explanation: `Your fixed monthly pay before any deductions: ${partsOf(earnings, s.grossPaise)}.`,
  }];
  if (s.lopDays > 0) {
    lines.push({
      key: 'lop', label: `Loss of pay · ${dayCount(s.lopDays)}`, amountPaise: s.lopPaise, kind: 'lop',
      explanation: lopExplanation(period, lop, s.grossPaise, range.baseDays, range.from, range.to, [], null),
    });
  }
  const calcLabel = new Map(computed.deductions.map((d) => [d.code, d.calcLabel]));
  for (const d of [...s.deductions].sort((a, b) => orderOf(a.key) - orderOf(b.key))) {
    lines.push({
      key: d.key, label: d.label, amountPaise: d.amountPaise, kind: 'deduction',
      explanation: d.key === 'epf' ? pfExplanation(rules, d.amountPaise, { contributionPaise: computed.statutory.epf.contributionWagePaise, pfWagePaise: computed.pfWagePaise })
        : d.key === 'esi' ? esiExplanation(rules)
          : d.key === 'pt' ? ptExplanation(rules, d.amountPaise, s.grossPaise, month)
            : d.key === 'lwf' ? lwfExplanation(rules)
              : d.key === 'income_tax' ? taxExplanation(period, d.amountPaise, null, lastSlip)
                : `${d.label}: ${calcLabel.get(d.key) ?? 'a deduction'}, as your salary structure sets it.`,
    });
  }
  if (s.reimbursementsPaise > 0) {
    const parts = computed.reimbursements.filter((r) => r.showInPayslip !== false).map((r) => ({ name: r.payslipName || r.name, paise: r.monthlyPaise }));
    lines.push({
      key: 'reimbursements', label: 'Reimbursements', amountPaise: s.reimbursementsPaise, kind: 'earning',
      explanation: `Paid with your salary, outside gross pay: ${partsOf(parts, s.reimbursementsPaise)}.`,
    });
  }
  return {
    ...base,
    released: false,
    payslipId: null,
    periodFrom: range.from,
    periodTo: range.to,
    daysPaid: Math.max(0, range.baseDays - s.lopDays),
    daysInPeriod: daysBetween(range.from, range.to),
    baseDays: range.baseDays,
    grossPaise: s.grossPaise,
    takeHomePaise: s.takeHomePaise,
    lines,
    lop,
    notSetUp: null,
  };
}
