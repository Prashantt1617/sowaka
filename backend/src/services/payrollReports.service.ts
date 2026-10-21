/**
 * Payroll reports and the payroll dashboard, from the payslips of finished
 * runs (approved or paid; `includeDrafts` adds draft / awaiting-approval runs
 * to preview a month before it is approved). One run per month counts: the
 * furthest along.
 *
 * Every figure is a sum of payslip lines, in paise, so a report always agrees
 * with the payslips behind it: gross + reimbursements − employee deductions =
 * net pay; gross + reimbursements + employer contributions = cost to company.
 */
import { ObjectId } from 'mongodb';
import { companies, employeePaymentDetails, payrollRuns, payslips, reimbursementClaims, salaryStructures, users } from '../config/db';
import { Payslip, PayrollRun } from '../models/payrollRun.model';
import { PayrollRunError, requireAdminOrg } from './payrollRun.service';
import { workStateOf } from './statutorySettings.service';
import { decryptField, fieldKeyConfigured } from './fieldCrypto';

type Opts = { includeDrafts?: boolean };
type StoredRun = PayrollRun & { _id: ObjectId };
type Slip = Payslip & { _id?: ObjectId };

const FINAL = ['approved', 'paid'];
const RANK: Record<string, number> = { paid: 4, approved: 3, pending_approval: 2, draft: 1 };
const STATUTORY_EMPLOYEE = new Set(['epf', 'esi', 'pt', 'lwf']);
const DEDUCTION_NAMES: Record<string, string> = { epf: 'EPF Contribution', esi: 'ESI Contribution', pt: 'Professional Tax', lwf: 'Labour Welfare Fund', income_tax: 'Income Tax', food_coupon: 'Food Coupon Deduction' };
const PAY_MODES: Record<string, string> = { bank_transfer: 'Bank Transfer', cheque: 'Cheque', cash: 'Cash' };

const isPeriod = (p: unknown): p is string => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
const addMonths = (p: string, n: number) => {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let p = from; p <= to && out.length < 60; p = addMonths(p, 1)) out.push(p);
  return out;
};
const lastDay = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).toISOString().slice(0, 10);
const fyRange = (fy: string) => {
  const start = Number(fy.slice(0, 4));
  return { from: `${start}-04`, to: `${start + 1}-03` };
};
const fyOfPeriod = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/** The runs that count for each month in [from, to]: one per month, the furthest along. */
async function runsBetween(org: string, from: string, to: string, opts: Opts): Promise<StoredRun[]> {
  const statuses = opts.includeDrafts ? ['draft', 'pending_approval', 'approved', 'paid'] : FINAL;
  const runs = (await payrollRuns().find({ org, period: { $gte: from, $lte: to }, status: { $in: statuses } } as never).toArray()) as StoredRun[];
  const best = new Map<string, StoredRun>();
  for (const r of runs) {
    const held = best.get(r.period);
    if (!held || (RANK[r.status] ?? 0) > (RANK[held.status] ?? 0)) best.set(r.period, r);
  }
  return [...best.values()].sort((a, b) => a.period.localeCompare(b.period));
}

async function slipsOf(org: string, runs: StoredRun[]): Promise<Slip[]> {
  if (runs.length === 0) return [];
  return (await payslips().find({ org, runId: { $in: runs.map((r) => r._id.toHexString()) } }).toArray()) as Slip[];
}

/** One payslip in the report's terms. */
function partsOf(s: Slip) {
  const earnings = s.earnings.map((e) => ({ code: e.code, name: e.name, paise: e.paidPaise }));
  const overtime = s.inputs?.overtimePaise ?? 0;
  if (overtime > 0) earnings.push({ code: '__overtime', name: 'Overtime', paise: overtime });
  const reimbursements = (s.reimbursementLines ?? []).map((l) => ({ code: l.code, name: l.name, paise: l.amountPaise }));
  const business = (s.reimbursementsPaise ?? 0) - reimbursements.reduce((t, l) => t + l.paise, 0);
  if (business > 0) reimbursements.push({ code: '__business', name: 'Business Expense Reimbursements', paise: business });
  const deductions = s.deductions.map((d) => ({ key: d.key, name: DEDUCTION_NAMES[d.key] ?? d.name, paise: d.amountPaise }));
  const ded = (k: string) => deductions.filter((d) => d.key === k).reduce((t, d) => t + d.paise, 0);
  const em: Partial<NonNullable<Slip['employer']>> = s.employer ?? {};
  const employer = [
    { key: 'epf', name: 'EPF Contribution', paise: em.epfPaise ?? 0 },
    { key: 'eps', name: 'EPS Contribution', paise: em.epsPaise ?? 0 },
    { key: 'edli', name: 'EDLI Contribution', paise: em.edliPaise ?? 0 },
    { key: 'admin', name: 'EPF Admin Charges', paise: em.adminPaise ?? 0 },
    { key: 'esi', name: 'ESI Contribution', paise: em.esiPaise ?? 0 },
    { key: 'lwf', name: 'Labour Welfare Fund', paise: em.lwfPaise ?? 0 },
    { key: 'benefits', name: 'Gratuity and other benefits', paise: em.benefitsPaise ?? 0 },
  ];
  return { earnings, reimbursements, deductions, ded, employer };
}

/** A month's income tax split as the register shows it: tax on income, surcharge, cess. */
function taxSplit(s: Slip, tax: number) {
  if (tax <= 0) return { taxOnIncome: 0, surcharge: 0, cess: 0 };
  const t = s.inputs?.tds;
  const onIncome = t ? Math.max(0, t.slabTaxPaise - t.rebatePaise - (t.marginalReliefPaise ?? 0)) : 0;
  const whole = t ? onIncome + t.surchargePaise + t.cessPaise : 0;
  const cess = whole > 0 ? Math.round((tax * t!.cessPaise) / whole) : Math.round((tax * 4) / 104);
  const surcharge = whole > 0 ? Math.round((tax * t!.surchargePaise) / whole) : 0;
  return { taxOnIncome: tax - cess - surcharge, surcharge, cess };
}

type Line = { name: string; paise: number };
const addLine = (m: Map<string, Line>, key: string, name: string, paise: number) => {
  if (!paise) return;
  const l = m.get(key) ?? { name, paise: 0 };
  l.paise += paise;
  m.set(key, l);
};
const total = (m: Map<string, Line>) => [...m.values()].reduce((t, l) => t + l.paise, 0);

function rangeArgs(from: unknown, to: unknown) {
  if (!isPeriod(from) || !isPeriod(to) || from > to) throw new PayrollRunError(400, 'from and to are months like 2026-04, from ≤ to');
  return { from, to };
}

// ————————————————————————————————————————————————— Payroll Summary

export async function payrollSummary(viewer: string, fromIn: unknown, toIn: unknown, opts: Opts) {
  const org = await requireAdminOrg(viewer);
  const { from, to } = rangeArgs(fromIn, toIn);
  const runs = await runsBetween(org, from, to, opts);
  const slips = await slipsOf(org, runs);
  const earnings = new Map<string, Line>(), reimb = new Map<string, Line>(), statutory = new Map<string, Line>();
  const taxes = new Map<string, Line>(), other = new Map<string, Line>(), employer = new Map<string, Line>();
  for (const s of slips) {
    const p = partsOf(s);
    for (const e of p.earnings) addLine(earnings, e.code, e.name, e.paise);
    for (const r of p.reimbursements) addLine(reimb, r.code, r.name, r.paise);
    for (const d of p.deductions) {
      if (d.key === 'income_tax') addLine(taxes, d.key, d.name, d.paise);
      else if (STATUTORY_EMPLOYEE.has(d.key)) addLine(statutory, d.key, d.name, d.paise);
      else addLine(other, d.key, d.name, d.paise);
    }
    for (const e of p.employer) addLine(employer, e.key, e.name, e.paise);
  }
  const section = (title: string, m: Map<string, Line>, totalLabel: string) => ({ title, rows: [...m.values()], totalLabel, totalPaise: total(m) });
  const gross = total(earnings), reimbursements = total(reimb);
  const deductions = total(statutory) + total(taxes) + total(other);
  const netPay = slips.reduce((t, s) => t + s.netPayablePaise, 0);
  return {
    from, to,
    runs: runs.map((r) => ({ period: r.period, status: r.status })),
    employees: new Set(slips.map((s) => s.userId)).size,
    sections: [
      section('Earnings', earnings, 'Gross Pay'),
      section('Reimbursements', reimb, 'Total Reimbursements'),
      section('Statutory deductions (employee)', statutory, 'Total Statutory Deductions'),
      section('Taxes', taxes, 'Total Taxes'),
      section('Other deductions', other, 'Total Other Deductions'),
      section('Employer contributions', employer, 'Total Employer Contributions'),
    ],
    netPayPaise: netPay,
    costToCompanyPaise: gross + reimbursements + total(employer),
    // Gross + reimbursements − deductions should equal net pay; a gap means a payslip does not add up.
    balancesPaise: gross + reimbursements - deductions - netPay,
  };
}

// ————————————————————————————————————————————————— Salary Register (one month)

export async function salaryRegister(viewer: string, periodIn: unknown, opts: Opts) {
  const org = await requireAdminOrg(viewer);
  if (!isPeriod(periodIn)) throw new PayrollRunError(400, 'period is a month like 2026-09');
  const period = periodIn;
  const [run] = await runsBetween(org, period, period, opts);
  const slips = run ? await slipsOf(org, [run]) : [];
  const [people, payments] = await Promise.all([
    users().find({ userId: { $in: slips.map((s) => s.userId) } }).toArray(),
    employeePaymentDetails().find({ org, userId: { $in: slips.map((s) => s.userId) } } as never).toArray() as unknown as Promise<{ userId: string; payMode?: string; bankName?: string; ifsc?: string; accountNumber?: string; accountLast4?: string }[]>,
  ]);
  const personBy = new Map(people.map((u) => [u.userId, u]));
  const payBy = new Map(payments.map((p) => [p.userId, p]));
  const earnCols = new Map<string, string>(), reimbCols = new Map<string, string>(), dedCols = new Map<string, string>();
  for (const s of slips) {
    const p = partsOf(s);
    p.earnings.forEach((e) => earnCols.set(e.code, e.name));
    p.reimbursements.forEach((r) => reimbCols.set(r.code, r.name));
    p.deductions.filter((d) => d.key !== 'income_tax').forEach((d) => dedCols.set(d.key, d.name));
  }
  const account = (p?: { accountNumber?: string; accountLast4?: string }) => {
    if (p?.accountNumber && fieldKeyConfigured()) { try { return decryptField(p.accountNumber); } catch { /* masked below */ } }
    return p?.accountLast4 ? `XXXX${p.accountLast4}` : '';
  };
  const rows = slips
    .map((s) => {
      const p = partsOf(s);
      const u = personBy.get(s.userId);
      const pay = payBy.get(s.userId);
      const tax = p.ded('income_tax');
      const split = taxSplit(s, tax);
      const byCode = (list: { code: string; paise: number }[]) => Object.fromEntries(list.map((x) => [x.code, x.paise]));
      return {
        employeeId: s.employeeId ?? '',
        name: s.employeeName,
        department: s.department ?? '',
        designation: s.designation ?? '',
        workLocation: (u && workStateOf(u)) ?? '',
        joiningDate: s.joiningDate ? new Date(s.joiningDate).toISOString().slice(0, 10) : '',
        paymentMode: PAY_MODES[pay?.payMode ?? ''] ?? '',
        bankName: pay?.bankName ?? '',
        accountNumber: account(pay),
        ifsc: pay?.ifsc ?? '',
        annualCtcPaise: s.annualCtcPaise ?? 0,
        baseDays: s.inputs?.workingDays ?? 0,
        lopDays: s.inputs?.lopDays ?? 0,
        paidDays: s.inputs?.payableDays ?? 0,
        earnings: byCode(p.earnings),
        grossPaise: s.grossPaise,
        reimbursements: byCode(p.reimbursements),
        reimbursementsPaise: s.reimbursementsPaise ?? 0,
        deductions: Object.fromEntries(p.deductions.filter((d) => d.key !== 'income_tax').map((d) => [d.key, d.paise])),
        taxOnIncomePaise: split.taxOnIncome,
        surchargePaise: split.surcharge,
        cessPaise: split.cess,
        incomeTaxPaise: tax,
        totalDeductionsPaise: s.employeeDeductionsPaise,
        employer: Object.fromEntries(p.employer.map((e) => [e.key, e.paise])),
        employerTotalPaise: s.employer?.totalPaise ?? 0,
        netPayPaise: s.netPayablePaise,
      };
    })
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId, undefined, { numeric: true }));
  return {
    period,
    run: run ? { id: run._id.toHexString(), status: run.status } : null,
    columns: {
      earnings: [...earnCols].map(([code, name]) => ({ code, name })),
      reimbursements: [...reimbCols].map(([code, name]) => ({ code, name })),
      deductions: [...dedCols].map(([key, name]) => ({ key, name })),
      employer: partsOf({ earnings: [], deductions: [], employer: {} } as unknown as Slip).employer.map((e) => ({ key: e.key, name: e.name })),
    },
    rows,
  };
}

// ————————————————————————————————————————————————— Payroll Liability Summary

export async function liabilitySummary(viewer: string, fromIn: unknown, toIn: unknown, opts: Opts) {
  const org = await requireAdminOrg(viewer);
  const { from, to } = rangeArgs(fromIn, toIn);
  const runs = await runsBetween(org, from, to, opts);
  const slips = await slipsOf(org, runs);
  const rows: Record<string, { name: string; employeePaise: number; employerPaise: number }> = {
    income_tax: { name: 'Income Tax (TDS)', employeePaise: 0, employerPaise: 0 },
    epf: { name: 'EPF Contribution', employeePaise: 0, employerPaise: 0 },
    eps: { name: 'EPS Contribution', employeePaise: 0, employerPaise: 0 },
    edli: { name: 'EDLI Contribution', employeePaise: 0, employerPaise: 0 },
    admin: { name: 'EPF Admin Charges', employeePaise: 0, employerPaise: 0 },
    esi: { name: 'ESI Contribution', employeePaise: 0, employerPaise: 0 },
    pt: { name: 'Professional Tax', employeePaise: 0, employerPaise: 0 },
    lwf: { name: 'Labour Welfare Fund', employeePaise: 0, employerPaise: 0 },
    benefits: { name: 'Gratuity and other benefits (provision)', employeePaise: 0, employerPaise: 0 },
  };
  for (const s of slips) {
    const p = partsOf(s);
    for (const k of ['income_tax', 'epf', 'esi', 'pt', 'lwf']) rows[k].employeePaise += p.ded(k);
    for (const e of p.employer) if (rows[e.key]) rows[e.key].employerPaise += e.paise;
  }
  const list = Object.entries(rows)
    .map(([key, r]) => ({ key, ...r, totalPaise: r.employeePaise + r.employerPaise }))
    .filter((r) => r.totalPaise > 0);
  return { from, to, runs: runs.map((r) => ({ period: r.period, status: r.status })), rows: list, totalPaise: list.reduce((t, r) => t + r.totalPaise, 0) };
}

// ————————————————————————————————————————————————— Professional Tax

export async function ptSummary(viewer: string, periodIn: unknown, opts: Opts) {
  const org = await requireAdminOrg(viewer);
  if (!isPeriod(periodIn)) throw new PayrollRunError(400, 'period is a month like 2026-09');
  const [run] = await runsBetween(org, periodIn, periodIn, opts);
  const slips = run ? await slipsOf(org, [run]) : [];
  const people = await users().find({ userId: { $in: slips.map((s) => s.userId) } }).toArray();
  const by = new Map(people.map((u) => [u.userId, u]));
  const rows = slips
    .map((s) => ({ s, pt: partsOf(s).ded('pt') }))
    .filter((x) => x.pt > 0)
    .map(({ s, pt }) => {
      const u = by.get(s.userId);
      return {
        employeeId: s.employeeId ?? '',
        name: s.employeeName,
        workLocation: (u && workStateOf(u)) ?? '',
        status: u?.lifecycleStatus ?? '',
        employeeType: u?.employeeType ?? '',
        ptPaise: pt,
      };
    })
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId, undefined, { numeric: true }));
  return { period: periodIn, run: run ? { status: run.status } : null, rows, totalPaise: rows.reduce((t, r) => t + r.ptPaise, 0) };
}

export async function ptAnnualReturn(viewer: string, fyIn: unknown, opts: Opts) {
  const org = await requireAdminOrg(viewer);
  if (typeof fyIn !== 'string' || !/^\d{4}-\d{2}$/.test(fyIn)) throw new PayrollRunError(400, 'fy is like 2026-27');
  const { from, to } = fyRange(fyIn);
  const runs = await runsBetween(org, from, to, opts);
  const slips = await slipsOf(org, runs);
  const rows = runs.map((r) => {
    const mine = slips.filter((s) => s.runId === r._id.toHexString()).map((s) => partsOf(s).ded('pt')).filter((x) => x > 0);
    return { period: r.period, periodEnd: lastDay(r.period), status: r.status, employees: mine.length, ptPaise: mine.reduce((t, x) => t + x, 0) };
  });
  return { fy: fyIn, rows, totalPaise: rows.reduce((t, r) => t + r.ptPaise, 0) };
}

// ————————————————————————————————————————————————— Employee payment details (one run)

export async function paymentDetails(viewer: string, runIdIn: string) {
  const org = await requireAdminOrg(viewer);
  if (!ObjectId.isValid(runIdIn)) throw new PayrollRunError(400, 'Invalid run ID');
  const run = await payrollRuns().findOne({ _id: new ObjectId(runIdIn), org });
  if (!run) throw new PayrollRunError(404, 'Payroll run not found');
  const register = await salaryRegister(viewer, run.period, { includeDrafts: true });
  return {
    period: run.period,
    status: run.status,
    rows: register.rows.map((r) => ({ employeeId: r.employeeId, name: r.name, paymentMode: r.paymentMode || 'Not set', bankName: r.bankName, accountNumber: r.accountNumber, ifsc: r.ifsc, netPayPaise: r.netPayPaise })),
  };
}

// ————————————————————————————————————————————————— Dashboard

export type CostRange = 'this_year' | 'this_quarter' | 'previous_year' | 'previous_quarter';

function rangeFor(range: CostRange, today: string): { from: string; to: string; label: string } {
  const fy = fyOfPeriod(today);
  const { from: fyFrom } = fyRange(fy);
  if (range === 'this_year' || range === 'previous_year') {
    const start = range === 'this_year' ? fyFrom : addMonths(fyFrom, -12);
    return { from: start, to: addMonths(start, 11), label: `FY ${fyOfPeriod(start)}` };
  }
  const q = Math.floor(monthsBetween(fyFrom, today).length - 1) / 3;
  const qStart = addMonths(fyFrom, Math.floor(q) * 3 + (range === 'previous_quarter' ? -3 : 0));
  return { from: qStart, to: addMonths(qStart, 2), label: `${qStart} to ${addMonths(qStart, 2)}` };
}

export async function payrollDashboard(viewer: string, rangeIn: unknown, opts: Opts) {
  const org = await requireAdminOrg(viewer);
  const range: CostRange = ['this_year', 'this_quarter', 'previous_year', 'previous_quarter'].includes(String(rangeIn)) ? (rangeIn as CostRange) : 'this_year';
  const today = new Date().toISOString().slice(0, 7);
  const company = await companies().findOne({ id: org });
  const payDay = (company as { paySchedule?: { payDay?: 'last_day' | number } } | null)?.paySchedule?.payDay ?? 'last_day';
  const payDateOf = (p: string) => (payDay === 'last_day' ? lastDay(p) : `${addMonths(p, 1)}-${String(payDay).padStart(2, '0')}`);

  // The run that needs attention: the latest one not yet paid, else the next month to run.
  const all = (await payrollRuns().find({ org, status: { $ne: 'rejected' } } as never).sort({ period: -1 }).toArray()) as StoredRun[];
  const open = all.find((r) => r.status !== 'paid');
  const lastPaid = all.find((r) => r.status === 'paid' || r.status === 'approved');
  const currentRun = open
    ? { id: open._id.toHexString(), period: open.period, status: open.status, employees: open.employeeCount, netPayPaise: (open.totals?.netPaise ?? 0) + (open.totals?.reimbursementsPaise ?? 0), payDate: payDateOf(open.period) }
    : { id: null, period: lastPaid ? addMonths(lastPaid.period, 1) : today, status: 'not_started', employees: 0, netPayPaise: 0, payDate: payDateOf(lastPaid ? addMonths(lastPaid.period, 1) : today) };

  // What is owed to the government for the latest finished month.
  const latestFinal = all.find((r) => FINAL.includes(r.status)) ?? (opts.includeDrafts ? all[0] : undefined);
  let dues: { period: string; status: string; epfPaise: number; esiPaise: number; tdsPaise: number; ptPaise: number; lwfPaise: number } | null = null;
  if (latestFinal) {
    const l = await liabilitySummary(viewer, latestFinal.period, latestFinal.period, { includeDrafts: !FINAL.includes(latestFinal.status) });
    const sum = (keys: string[]) => l.rows.filter((r) => keys.includes(r.key)).reduce((t, r) => t + r.totalPaise, 0);
    dues = { period: latestFinal.period, status: latestFinal.status, epfPaise: sum(['epf', 'eps', 'edli', 'admin']), esiPaise: sum(['esi']), tdsPaise: sum(['income_tax']), ptPaise: sum(['pt']), lwfPaise: sum(['lwf']) };
  }

  // People: active employees, and whose payroll set-up is incomplete.
  const active = await users().find({ org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never, { projection: { userId: 1 } }).toArray();
  const ids = active.map((u) => u.userId);
  const [salaried, payments] = await Promise.all([
    salaryStructures().find({ org, userId: { $in: ids }, status: 'active' }, { projection: { userId: 1 } }).toArray(),
    employeePaymentDetails().find({ org, userId: { $in: ids } } as never).toArray() as unknown as Promise<{ userId: string; accountNumber?: string; pan?: string }[]>,
  ]);
  const withSalary = new Set(salaried.map((s) => s.userId));
  const payBy = new Map(payments.map((p) => [p.userId, p]));
  const people = {
    active: ids.length,
    withSalary: withSalary.size,
    noSalary: ids.filter((id) => !withSalary.has(id)).length,
    noBankAccount: [...withSalary].filter((id) => !payBy.get(id)?.accountNumber).length,
    noPan: [...withSalary].filter((id) => !payBy.get(id)?.pan).length,
  };

  // Payroll cost by month.
  const { from, to, label } = rangeFor(range, today);
  const runs = await runsBetween(org, from, to, opts);
  const slips = await slipsOf(org, runs);
  const cost = monthsBetween(from, to).map((period) => {
    const run = runs.find((r) => r.period === period);
    const mine = run ? slips.filter((s) => s.runId === run._id.toHexString()) : [];
    let taxes = 0, deductions = 0, employer = 0, net = 0;
    for (const s of mine) {
      const p = partsOf(s);
      taxes += p.ded('income_tax');
      deductions += s.employeeDeductionsPaise - p.ded('income_tax');
      employer += s.employer?.totalPaise ?? 0;
      net += s.netPayablePaise;
    }
    return { period, status: run?.status ?? null, netPayPaise: net, taxesPaise: taxes, deductionsPaise: deductions, employerPaise: employer };
  });

  // To do.
  const pendingClaims = await reimbursementClaims().countDocuments({ userId: { $in: ids }, status: 'pending' });
  const awaitingApproval = all.filter((r) => r.status === 'pending_approval').length;

  return { currentRun, dues, people, cost: { range, label, months: cost }, todo: { pendingClaims, runsAwaitingApproval: awaitingApproval } };
}
