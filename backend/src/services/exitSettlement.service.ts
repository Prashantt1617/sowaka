/**
 * The final settlement (People › Exits › a person).
 *
 * One statement for someone who has left: every month held since notice
 * began, the last month up to the last working day, leave encashment,
 * gratuity and notice pay, less any notice recovery, PF and the year's
 * remaining income tax. HR checks it, can change a line with a reason, ticks
 * the clearance list, approves it and marks it paid.
 *
 * A draft is worked out afresh each time it is read, so a monthly run made
 * since (or a rule changed on the exit) shows; approving freezes it.
 *
 * Money rules (the plan's, agreed 14 Nov 2026):
 *  - leave encashment: each leave type's own encashment rule, a day at Basic ÷ 30;
 *  - gratuity: 5 completed years or more; 15 ÷ 26 × last Basic × years, a part
 *    year over 6 months counting as a year;
 *  - notice pay and notice recovery: the exit's rules, a day at the company's
 *    basis (Exit settings);
 *  - PF only on salary; never on encashment, gratuity or notice pay;
 *  - income tax: tax for the year on what they actually earned, less tax
 *    already taken, never below zero. A notice recovery does not lower
 *    taxable salary. Leave encashment is tax-free to ₹25 lakh, gratuity to ₹20 lakh.
 */
import { companies, exitSettlements, payrollRuns, payslips, salaryStructures, taxDeclarations, users } from '../config/db';
import { ExitSettlement, SettlementChange, SettlementLine, SettlementTaxWorking } from '../models/exitSettlement.model';
import { Payslip } from '../models/payrollRun.model';
import { DEFAULT_EXIT_CLEARANCE, DEFAULT_EXIT_NOTICE, DEFAULT_EXIT_RULES, ExitNoticeSettings, User, UserExit } from '../models/user.model';
import { computeTds, fyOf } from '../shared/payroll/tds';
import { AdminError } from './admin.service';
import { getMyLeaveBalance } from './leave.service';
import { payrollPeriodHolding } from './payroll-inputs.service';
import { estimatePayslip } from './payrollRun.service';
import { computeStructureFor } from './salaryStructure.service';
import { leaveTypeRulesFor } from './shift.service';
import { statutorySettingsFor } from './statutorySettings.service';
import { tdsConfigsFor } from './tds.service';
import { logger } from '../utils/logger';

export class SettlementError extends AdminError {}

const LEAVE_ENCASHMENT_EXEMPT_PAISE = 25_00_000_00;
const GRATUITY_EXEMPT_PAISE = 20_00_000_00;
const GRATUITY_MIN_YEARS = 5;

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
/** Whole rupees, as every payslip line is. */
const round = (n: number) => Math.round(n / 100) * 100;
const dayMs = 86_400_000;
const asDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
const monthLabel = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (key: string) => asDate(key).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The company's notice settings, with the defaults for what it has not set. */
export async function exitNoticeSettings(org: string): Promise<ExitNoticeSettings> {
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, exitNotice: 1 } });
  return { ...DEFAULT_EXIT_NOTICE, ...(company?.exitNotice ?? {}) };
}

/** Completed years of service, and the years gratuity counts (a part year over 6 months is a year). */
export function serviceYears(joined: string, lastDay: string): { completed: number; counted: number; months: number } {
  const a = asDate(joined);
  const b = new Date(asDate(lastDay).getTime() + dayMs); // the last day is worked
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  const completed = Math.floor(months / 12);
  const rest = months - completed * 12;
  // "Over 6 months": six full months and at least a day more.
  const over = rest > 6 || (rest === 6 && b.getUTCDate() !== a.getUTCDate());
  return { completed, counted: completed + (over ? 1 : 0), months };
}

/** Days of notice served, the day they said it and the last day both counted. */
const servedInclusive = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1);

interface Basis { basicPaise: number; grossPaise: number; monthDays: number }
function perDay(basis: ExitNoticeSettings['recoveryBasis'] | ExitNoticeSettings['noticePayBasis'], b: Basis): { paise: number; label: string } {
  switch (basis) {
    case 'gross_30': return { paise: b.grossPaise / 30, label: 'gross ÷ 30' };
    case 'gross_month': return { paise: b.grossPaise / b.monthDays, label: `gross ÷ ${b.monthDays}` };
    case 'basic_month': return { paise: b.basicPaise / b.monthDays, label: `Basic ÷ ${b.monthDays}` };
    default: return { paise: b.basicPaise / 30, label: 'Basic ÷ 30' };
  }
}

const sumDeduction = (slip: Payslip, pick: (key: string) => boolean) => slip.deductions.filter((d) => pick(d.key)).reduce((t, d) => t + d.amountPaise, 0);

/** Whether this person's settlement has started: the day after the last day, or (an absconding) once HR closes the case. */
export function settlementOpen(exit: UserExit): boolean {
  if (!exit.accessEndedAt) return false;
  return exit.kind !== 'absconded' || !!exit.caseClosedAt;
}

/**
 * The statement as the rules give it now. Nothing is saved.
 * `changes` are HR's figures laid over the computed lines.
 */
export async function computeSettlement(employee: User, changes: Record<string, SettlementChange> = {}): Promise<Pick<ExitSettlement, 'lines' | 'earningsPaise' | 'deductionsPaise' | 'payablePaise' | 'tax'>> {
  const exit = employee.exit;
  const org = employee.org;
  if (!exit || !org) throw new SettlementError(409, 'No exit recorded for this employee');
  const rules = exit.rules ?? DEFAULT_EXIT_RULES[exit.kind];
  const lastDay = exit.lastWorkingDay;
  const notice = await exitNoticeSettings(org);

  // —— Salary: held payslips from monthly runs, and the last month when no run has made it yet.
  const range = await payrollPeriodHolding(org, lastDay);
  const lastPeriod = range ? `${range.year}-${String(range.month).padStart(2, '0')}` : lastDay.slice(0, 7);
  const { fy, firstPeriod } = fyOf(lastPeriod);
  const runs = await payrollRuns().find({ org, status: { $ne: 'rejected' } }, { projection: { _id: 1, period: 1, status: 1 } }).toArray();
  const liveRunIds = new Set(runs.map((r) => r._id.toHexString()));
  const allSlips = (await payslips().find({ org, userId: employee.userId }).toArray()).filter((s) => liveRunIds.has(s.runId));
  const held = allSlips.filter((s) => s.held).sort((a, b) => a.period.localeCompare(b.period));
  const salary: { slip: Payslip; estimated: boolean }[] = held.map((slip) => ({ slip, estimated: false }));
  // The last month, when pay is being held and no run has made its payslip: worked out here, as the run would.
  if (rules.holdPay !== false && range && !allSlips.some((s) => s.period === lastPeriod)) {
    try {
      const estimate = await estimatePayslip(org, lastPeriod, range, { userId: employee.userId });
      if (estimate) salary.push({ slip: estimate, estimated: true });
    } catch (error) {
      // No statutory or tax row for the year, no active salary: the statement says so rather than failing.
      logger.warn('Exit settlement: the last month could not be worked out', { org, userId: employee.userId, period: lastPeriod, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const lines: SettlementLine[] = [];
  const add = (line: Omit<SettlementLine, 'amountPaise'>) => {
    const change = changes[line.key];
    lines.push({ ...line, amountPaise: change ? change.amountPaise : line.computedPaise, ...(change ? { changedReason: change.reason, ...(change.byName ? { changedByName: change.byName } : {}) } : {}) });
  };

  for (const { slip, estimated } of salary) {
    const base = slip.inputs?.workingDays ?? 0;
    const paid = slip.inputs?.payableDays ?? Math.max(0, base - (slip.inputs?.lopDays ?? 0));
    const days = base ? (paid >= base ? 'full month' : `${paid} of ${base} days`) : '';
    add({
      key: `salary:${slip.period}`,
      side: 'earning',
      label: `${monthLabel(slip.period)} salary${estimated ? '' : ' (held)'}`,
      note: [days, slip.reimbursementsPaise ? `with ${rupees(slip.reimbursementsPaise)} reimbursements` : '', estimated ? `worked out to ${dayLabel(lastDay)}; not on a monthly run yet` : ''].filter(Boolean).join(' · '),
      computedPaise: slip.grossPaise + slip.reimbursementsPaise,
      period: slip.period,
      ...(estimated ? { estimated: true } : { payslipId: String((slip as Payslip & { _id?: unknown })._id ?? '') }),
    });
  }

  // —— What a day is worth: the salary structure's own full-month Basic and gross.
  const structure = await salaryStructures().findOne({ org, userId: employee.userId });
  let basicPaise = 0;
  let grossPaise = 0;
  if (structure?.salaryTemplateCode) {
    try {
      const { computed } = await computeStructureFor(org, employee.userId, structure, employee, lastPeriod);
      basicPaise = computed.earnings.filter((l) => l.componentType === 'basic').reduce((t, l) => t + l.monthlyPaise, 0);
      grossPaise = computed.grossMonthlyPaise;
    } catch (error) {
      logger.warn('Exit settlement: the salary structure could not be worked out', { org, userId: employee.userId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const basis: Basis = { basicPaise, grossPaise, monthDays: range?.baseDays ?? 30 };

  // —— Notice: what was owed, what was given.
  const owed = exit.noticeDays ?? 0;
  const from = exit.noticeFrom;
  const served = from ? servedInclusive(from, lastDay) : 0;
  let shortDays = rules.noticeRecovery === 'whole_notice' ? owed : rules.noticeRecovery === 'days_not_served' ? Math.max(0, owed - served) : 0;

  // —— Leave encashment: each type's own rule, a day at Basic ÷ 30.
  let encashDays = 0;
  const encashParts: string[] = [];
  try {
    const [types, balance] = await Promise.all([leaveTypeRulesFor(employee.userId), getMyLeaveBalance(employee.userId, Number(lastDay.slice(0, 4)), asDate(lastDay))]);
    for (const type of types) {
      if (type.unpaid || type.encashment === 'none') continue;
      const left = balance.types.find((t) => t.key === type.key)?.remaining ?? 0;
      const days = type.encashment === 'limit' ? Math.min(left, type.encashLimitDays) : left;
      if (days > 0) { encashDays += days; encashParts.push(`${days} ${type.name}`); }
    }
  } catch (error) {
    logger.warn('Exit settlement: leave balance could not be read', { org, userId: employee.userId, reason: error instanceof Error ? error.message : String(error) });
  }
  // Unused leave covers the days of notice not given first, where the company chose that.
  let covered = 0;
  if (notice.leaveCoversShortfall && shortDays > 0 && encashDays > 0) {
    covered = Math.min(shortDays, encashDays);
    shortDays -= covered;
    encashDays -= covered;
  }
  const leaveDay = basicPaise / 30;
  if (encashDays > 0 || encashParts.length) {
    add({
      key: 'leave_encashment',
      side: 'earning',
      label: 'Leave encashment',
      note: `${plural(encashDays, 'day')} × ${rupees(leaveDay)} (Basic ÷ 30)${encashParts.length ? ` · ${encashParts.join(', ')}` : ''}${covered ? ` · ${plural(covered, 'day')} used to cover notice not given` : ''}${exit.kind === 'absconded' ? ' · HR may forfeit it' : ''}`,
      computedPaise: round(encashDays * leaveDay),
    });
  }

  // —— Gratuity: 5 completed years or more.
  const joined = employee.joiningDate ? new Date(employee.joiningDate).toISOString().slice(0, 10) : undefined;
  if (joined && basicPaise > 0) {
    const years = serviceYears(joined, lastDay);
    if (years.completed >= GRATUITY_MIN_YEARS) {
      add({
        key: 'gratuity',
        side: 'earning',
        label: 'Gratuity',
        note: `15 ÷ 26 × ${rupees(basicPaise)} Basic × ${plural(years.counted, 'year')}${['terminated', 'absconded'].includes(exit.kind) ? ' · not paid on a dismissal for misconduct' : ''}`,
        computedPaise: round((15 / 26) * basicPaise * years.counted),
      });
    }
  }

  // —— Notice pay (the company ended the job early): the days they won't work.
  if (rules.noticePay !== 'none' && owed > 0) {
    const worked = from ? Math.max(0, Math.round((Date.parse(lastDay) - Date.parse(from)) / dayMs)) : 0;
    const days = Math.max(0, owed - worked);
    const day = perDay(notice.noticePayBasis, basis);
    const full = round(days * day.paise);
    // "HR decides": shown, and paid only once HR says so on this statement.
    const decided = rules.noticePay === 'pay' || !!changes.notice_pay;
    lines.push({
      key: 'notice_pay',
      side: 'earning',
      label: 'Notice pay',
      note: `${plural(days, 'day')} × ${rupees(day.paise)} (${day.label})${decided ? '' : ' · HR decides: not paid unless you choose to'}`,
      computedPaise: full,
      amountPaise: changes.notice_pay ? changes.notice_pay.amountPaise : decided ? full : 0,
      ...(changes.notice_pay ? { changedReason: changes.notice_pay.reason, ...(changes.notice_pay.byName ? { changedByName: changes.notice_pay.byName } : {}) } : {}),
    });
  }

  // —— Notice recovery (they left early): the days not given.
  if (rules.noticeRecovery !== 'none' && owed > 0 && (shortDays > 0 || covered > 0)) {
    const day = perDay(notice.recoveryBasis, basis);
    add({
      key: 'notice_recovery',
      side: 'deduction',
      label: rules.noticeRecovery === 'whole_notice' ? 'Notice not served' : 'Notice shortfall',
      note: `${plural(shortDays, 'day')} × ${rupees(day.paise)} (${day.label})${rules.noticeRecovery === 'days_not_served' ? ` · ${served} of ${owed} days given` : ''}${covered ? ` · ${plural(covered, 'day')} covered by unused leave` : ''}`,
      computedPaise: round(shortDays * day.paise),
    });
  }

  // —— PF and the other deductions of the salary months above.
  const months = salary.map(({ slip }) => monthLabel(slip.period).split(' ')[0]).join(', ');
  const pf = salary.reduce((t, { slip }) => t + sumDeduction(slip, (k) => k === 'epf'), 0);
  if (pf > 0) add({ key: 'pf', side: 'deduction', label: 'Provident fund', note: `On ${months} salary; none on encashment, gratuity or notice pay`, computedPaise: pf });
  const otherNames = new Set<string>();
  const other = salary.reduce((t, { slip }) => t + slip.deductions.filter((d) => d.key !== 'epf' && d.key !== 'income_tax').reduce((u, d) => { if (d.amountPaise > 0) otherNames.add(d.name); return u + d.amountPaise; }, 0), 0);
  if (other > 0) add({ key: 'other_deductions', side: 'deduction', label: 'Other deductions', note: [...otherNames].join(', '), computedPaise: other });

  // —— Income tax: the year worked out again on what they actually earned.
  const amountOf = (key: string) => lines.find((l) => l.key === key)?.amountPaise ?? 0;
  const fySlips = allSlips.filter((s) => s.period >= firstPeriod);
  const paidSlips = fySlips.filter((s) => !s.held);
  const paidTaxable = paidSlips.reduce((t, s) => t + (s.taxablePaise ?? s.grossPaise), 0);
  const alreadyDeducted = paidSlips.reduce((t, s) => t + sumDeduction(s, (k) => k === 'income_tax'), 0);
  // A changed salary line is taxed at HR's figure, in the same proportion.
  const settlementSalaryTaxable = salary.filter(({ slip }) => slip.period >= firstPeriod).reduce((t, { slip }) => {
    const line = lines.find((l) => l.key === `salary:${slip.period}`)!;
    const taxable = slip.taxablePaise ?? slip.grossPaise;
    return t + (line.computedPaise > 0 ? Math.round((taxable * line.amountPaise) / line.computedPaise) : 0);
  }, 0);
  const excess = Math.max(0, amountOf('leave_encashment') - LEAVE_ENCASHMENT_EXEMPT_PAISE) + Math.max(0, amountOf('gratuity') - GRATUITY_EXEMPT_PAISE);
  const settlementTaxable = settlementSalaryTaxable + amountOf('notice_pay');
  const settings = await statutorySettingsFor(org);
  const configs = settings.tds?.enabled ? await tdsConfigsFor(fy) : new Map();
  const declaration = configs.size ? await taxDeclarations().findOne({ org, userId: employee.userId, fy }) : null;
  const regime = declaration?.regime ?? settings.tds?.defaultRegime ?? 'new';
  const config = configs.get(regime);
  let tax: SettlementTaxWorking;
  if (config) {
    const everySlip = [...paidSlips, ...salary.filter(({ slip }) => slip.period >= firstPeriod).map(({ slip }) => slip)];
    const yearOf = (codes: string[]) => everySlip.reduce((t, s) => t + s.earnings.filter((e) => codes.includes(e.code)).reduce((u, e) => u + e.paidPaise, 0), 0);
    const result = computeTds({
      config,
      ytdTaxablePaise: paidTaxable,
      ytdTdsPaise: alreadyDeducted,
      currentTaxablePaise: settlementTaxable + excess,
      futureMonthlyTaxablePaise: 0,
      futureTaxablePaise: 0,
      monthsAfter: 0,
      basicYearPaise: yearOf(['BASIC']),
      hraYearPaise: yearOf(['HRA']),
      employeePfYearPaise: everySlip.reduce((t, s) => t + sumDeduction(s, (k) => k === 'epf'), 0),
      ptYearPaise: everySlip.reduce((t, s) => t + sumDeduction(s, (k) => k === 'pt' || k === 'professional_tax'), 0),
      declarations: declaration?.declarations,
    });
    const over = result.alreadyDeductedPaise - result.annualTaxPaise;
    tax = {
      engine: true, regime, fy,
      paidTaxablePaise: paidTaxable, settlementTaxablePaise: settlementTaxable, excessExemptPaise: excess,
      taxableIncomePaise: result.taxableIncomePaise, annualTaxPaise: result.annualTaxPaise,
      alreadyDeductedPaise: result.alreadyDeductedPaise, duePaise: result.monthlyTdsPaise,
      ...(over > 0 ? { refundViaReturnPaise: over } : {}),
    };
    add({
      key: 'income_tax',
      side: 'deduction',
      label: 'Income tax still due for the year',
      note: `${rupees(result.annualTaxPaise)} for the year less ${rupees(result.alreadyDeductedPaise)} already taken${over > 0 ? ` · ${rupees(over)} taken too much comes back in their tax return` : ''}`,
      computedPaise: result.monthlyTdsPaise,
    });
  } else {
    // No tax engine here: HR types each month's tax. The held months carry what was typed; HR sets the year's figure.
    const typed = salary.reduce((t, { slip }) => t + sumDeduction(slip, (k) => k === 'income_tax'), 0);
    tax = { engine: false, fy, paidTaxablePaise: paidTaxable, settlementTaxablePaise: settlementTaxable, excessExemptPaise: excess, alreadyDeductedPaise: alreadyDeducted, duePaise: typed };
    add({
      key: 'income_tax',
      side: 'deduction',
      label: 'Income tax',
      note: `As typed on the monthly runs. Taxable this year: ${rupees(paidTaxable + settlementTaxable + excess)}; already taken ${rupees(alreadyDeducted)}. Change it to what the year still needs.`,
      computedPaise: typed,
    });
  }

  const earningsPaise = lines.filter((l) => l.side === 'earning').reduce((t, l) => t + l.amountPaise, 0);
  const deductionsPaise = lines.filter((l) => l.side === 'deduction').reduce((t, l) => t + l.amountPaise, 0);
  return { lines, earningsPaise, deductionsPaise, payablePaise: earningsPaise - deductionsPaise, tax };
}

/** A draft worked out now and saved (or the frozen one, once approved). Null until the settlement has started. */
export async function settlementFor(employee: User, now = new Date()): Promise<ExitSettlement | null> {
  if (!employee.exit || !employee.org || !settlementOpen(employee.exit)) return null;
  const saved = await exitSettlements().findOne({ org: employee.org, userId: employee.userId });
  if (saved && saved.status !== 'draft') return saved;
  const computed = await computeSettlement(employee, saved?.changes ?? {});
  const doc: ExitSettlement = { org: employee.org, userId: employee.userId, status: 'draft', ...computed, ...(saved?.changes ? { changes: saved.changes } : {}), createdAt: saved?.createdAt ?? now, updatedAt: now };
  await exitSettlements().updateOne({ org: employee.org, userId: employee.userId }, { $set: doc }, { upsert: true });
  return doc;
}

export function settlementView(s: ExitSettlement) {
  return {
    status: s.status,
    lines: s.lines,
    earningsPaise: s.earningsPaise,
    deductionsPaise: s.deductionsPaise,
    payablePaise: s.payablePaise,
    tax: s.tax ?? null,
    clearanceOverrideReason: s.clearanceOverrideReason ?? null,
    approvedAt: s.approvedAt ? s.approvedAt.toISOString() : null,
    approvedByName: s.approvedByName ?? null,
    paidAt: s.paidAt ? s.paidAt.toISOString() : null,
    paidByName: s.paidByName ?? null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** HR changes one line of a draft (a figure and why), or puts it back (amountPaise null). */
export async function changeSettlementLine(org: string, employee: User, key: string, body: Record<string, unknown>, by: { userId: string; name?: string }, now = new Date()) {
  const current = await settlementFor(employee, now);
  if (!current) throw new SettlementError(409, 'The settlement has not started yet');
  if (current.status !== 'draft') throw new SettlementError(409, 'This settlement is approved. Reopen it to change a line.');
  if (!current.lines.some((l) => l.key === key)) throw new SettlementError(404, 'No such line on this settlement');
  const changes = { ...(current.changes ?? {}) };
  if (body.amountPaise === null || body.amountPaise === undefined) delete changes[key];
  else {
    const amountPaise = Number(body.amountPaise);
    if (!Number.isInteger(amountPaise) || amountPaise < 0) throw new SettlementError(400, 'The amount is a whole number of paise, zero or more');
    const reason = String(body.reason ?? '').trim().slice(0, 300);
    if (!reason) throw new SettlementError(400, 'Say why this line is changed: it shows on the statement');
    changes[key] = { amountPaise, reason, byUserId: by.userId, ...(by.name ? { byName: by.name } : {}), at: now };
  }
  await exitSettlements().updateOne({ org, userId: employee.userId }, Object.keys(changes).length ? { $set: { changes, updatedAt: now } } : { $unset: { changes: '' }, $set: { updatedAt: now } });
  return (await settlementFor(employee, now))!;
}

export async function approveSettlement(org: string, employee: User, body: Record<string, unknown>, by: { userId: string; name?: string }, now = new Date()) {
  const current = await settlementFor(employee, now);
  if (!current) throw new SettlementError(409, 'The settlement has not started yet');
  if (current.status !== 'draft') throw new SettlementError(409, 'This settlement is already approved');
  // An exit nobody has ticked yet still has the whole list open.
  const open = (employee.exit?.clearance ?? DEFAULT_EXIT_CLEARANCE.map((c) => ({ ...c, done: false }))).filter((c) => !c.done);
  const reason = String(body.clearanceOverrideReason ?? '').trim().slice(0, 300);
  if (open.length && !reason) throw new SettlementError(409, `Clearance is not complete (${open.map((c) => c.label.toLowerCase()).join('; ')}). Tick it, or say why you are approving anyway.`);
  await exitSettlements().updateOne(
    { org, userId: employee.userId, status: 'draft' },
    { $set: { status: 'approved', approvedAt: now, approvedByUserId: by.userId, ...(by.name ? { approvedByName: by.name } : {}), ...(open.length ? { clearanceOverrideReason: reason } : {}), updatedAt: now } },
  );
  return (await exitSettlements().findOne({ org, userId: employee.userId }))!;
}

/** Back to a draft, to change something before it is paid. */
export async function reopenSettlement(org: string, employee: User, now = new Date()) {
  const done = await exitSettlements().updateOne(
    { org, userId: employee.userId, status: 'approved' },
    { $set: { status: 'draft', updatedAt: now }, $unset: { approvedAt: '', approvedByUserId: '', approvedByName: '', clearanceOverrideReason: '' } },
  );
  if (done.matchedCount === 0) throw new SettlementError(409, 'Only an approved settlement that is not paid yet can be reopened');
  return (await settlementFor(employee, now))!;
}

/** Paid: the held payslips it covers are stamped as settled, so nothing pays them again. */
export async function markSettlementPaid(org: string, employee: User, by: { userId: string; name?: string }, now = new Date()) {
  const current = await exitSettlements().findOne({ org, userId: employee.userId });
  if (!current || current.status !== 'approved') throw new SettlementError(409, 'Approve the settlement before marking it paid');
  await exitSettlements().updateOne({ org, userId: employee.userId, status: 'approved' }, { $set: { status: 'paid', paidAt: now, ...(by.name ? { paidByName: by.name } : {}), updatedAt: now } });
  const periods = current.lines.filter((l) => l.period && !l.estimated).map((l) => l.period!);
  if (periods.length) await payslips().updateMany({ org, userId: employee.userId, period: { $in: periods }, held: { $exists: true } }, { $set: { 'held.settledAt': now } });
  return (await exitSettlements().findOne({ org, userId: employee.userId }))!;
}

/** Drafts for everyone whose settlement has started and has none yet (the hourly job), so the Exits page shows the amount. */
export async function draftDueSettlements(now = new Date()): Promise<number> {
  const due = await users().find({ 'exit.accessEndedAt': { $exists: true } }).toArray();
  let made = 0;
  for (const u of due) {
    if (!u.org || !u.exit || !settlementOpen(u.exit)) continue;
    try {
      if (await exitSettlements().findOne({ org: u.org, userId: u.userId }, { projection: { _id: 1 } })) continue;
      const company = await companies().findOne({ id: u.org }, { projection: { _id: 0, features: 1 } });
      if (company?.features?.exits !== true) continue;
      if (await settlementFor(u as User, now)) made++;
    } catch (error) {
      logger.error('Exit settlement: the draft could not be made', { userId: u.userId, org: u.org }, error);
    }
  }
  if (made) logger.info('Exit settlement: drafts made', { made });
  return made;
}
