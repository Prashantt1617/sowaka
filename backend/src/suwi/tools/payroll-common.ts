// Shared by the payroll tools: the runs that count for a month (one per
// month, the furthest along, as the reports pick them), the payslips behind
// them, and a payslip reduced to the plain lines Suwi reads. Payslip rows
// are read here (not through the dashboard's payslip view) so bank account
// numbers never enter a tool result.
import { ObjectId } from 'mongodb';
import { payrollRuns, payslips } from '../../config/db';
import { Payslip, PayrollRun } from '../../models/payrollRun.model';
import { rupees } from '../tools';

export type StoredRun = PayrollRun & { _id: ObjectId };
export type StoredSlip = Payslip & { _id: ObjectId };

const RANK: Record<string, number> = { paid: 4, approved: 3, pending_approval: 2, draft: 1 };
export const FINAL_STATUSES = ['approved', 'paid'];

export const isPeriod = (p: unknown): p is string => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
export const addMonths = (p: string, n: number) => {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const daysInMonth = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate();
export const lastDayOf = (p: string) => `${p}-${String(daysInMonth(p)).padStart(2, '0')}`;
export const monthLabel = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** The financial year a month belongs to, as "2026-27". */
export const fyOfPeriod = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

export const STATUS_LABEL: Record<string, string> = {
  draft: 'draft (not submitted; figures can still change)', pending_approval: 'awaiting approval', approved: 'approved', paid: 'submitted and paid', rejected: 'rejected',
};

/** Every run of the company that is not rejected, newest month first. */
export async function allRuns(org: string): Promise<StoredRun[]> {
  return (await payrollRuns().find({ org, status: { $ne: 'rejected' } } as never).sort({ period: -1 }).toArray()) as StoredRun[];
}

/** The run that counts for each month: the furthest along. */
export function bestByPeriod(runs: StoredRun[]): Map<string, StoredRun> {
  const best = new Map<string, StoredRun>();
  for (const r of runs) {
    const held = best.get(r.period);
    if (!held || (RANK[r.status] ?? 0) > (RANK[held.status] ?? 0)) best.set(r.period, r);
  }
  return best;
}

export async function slipsOfRun(org: string, run: StoredRun): Promise<StoredSlip[]> {
  return (await payslips().find({ org, runId: run._id.toHexString() }).toArray()) as StoredSlip[];
}

export async function runById(org: string, id: string): Promise<StoredRun | null> {
  if (!ObjectId.isValid(id)) return null;
  return (await payrollRuns().findOne({ _id: new ObjectId(id), org })) as StoredRun | null;
}

export const DEDUCTION_NAMES: Record<string, string> = { epf: 'Employee PF', esi: 'Employee ESI', pt: 'Professional tax', lwf: 'Labour welfare fund', income_tax: 'Income tax (TDS)', food_coupon: 'Food coupon deduction' };

/** Where this month's income tax came from. */
export function taxSource(s: Payslip): 'typed by HR' | 'TDS engine' | 'none' {
  const tax = s.deductions.find((d) => d.key === 'income_tax')?.amountPaise ?? 0;
  if (s.inputs?.incomeTaxEnteredByHr) return 'typed by HR';
  if (s.inputs?.tds) return 'TDS engine';
  return tax > 0 ? 'typed by HR' : 'none';
}

export interface SlipLine { code: string; name: string; paise: number; fullPaise?: number }

/** A payslip as plain lines and figures, in paise. */
export function slipLines(s: Payslip) {
  const earnings: SlipLine[] = s.earnings.map((e) => ({ code: e.code, name: e.name, paise: e.paidPaise, fullPaise: e.fullPaise }));
  const overtime = s.inputs?.overtimePaise ?? 0;
  if (overtime > 0) earnings.push({ code: '__overtime', name: 'Overtime', paise: overtime, fullPaise: overtime });
  const reimbursements: SlipLine[] = (s.reimbursementLines ?? []).map((l) => ({ code: l.code, name: l.name, paise: l.amountPaise }));
  const claims = (s.reimbursementsPaise ?? 0) - reimbursements.reduce((t, l) => t + l.paise, 0);
  if (claims > 0) reimbursements.push({ code: '__claims', name: 'Expense claims paid', paise: claims });
  const deductions: SlipLine[] = s.deductions.map((d) => ({ code: d.key, name: DEDUCTION_NAMES[d.key] ?? d.name, paise: d.amountPaise }));
  const em = s.employer;
  const employer: SlipLine[] = em
    ? [
      { code: 'epf', name: 'Employer PF', paise: em.epfPaise }, { code: 'eps', name: 'Employer pension (EPS)', paise: em.epsPaise },
      { code: 'edli', name: 'EDLI', paise: em.edliPaise }, { code: 'admin', name: 'PF admin charges', paise: em.adminPaise },
      { code: 'esi', name: 'Employer ESI', paise: em.esiPaise }, { code: 'lwf', name: 'Employer LWF', paise: em.lwfPaise },
      { code: 'benefits', name: 'Gratuity and other benefits', paise: em.benefitsPaise },
    ].filter((l) => l.paise)
    : [];
  // Gross includes overtime; the full month is what the earnings would have been with no loss of pay.
  const fullGross = s.earnings.reduce((t, e) => t + e.fullPaise, 0) + overtime;
  return {
    earnings, reimbursements, deductions, employer,
    grossPaise: s.grossPaise,
    /** What the month's earnings would have been with no loss of pay (one-time amounts included). */
    fullGrossPaise: fullGross,
    lopLossPaise: Math.max(0, fullGross - s.grossPaise),
    overtimePaise: overtime,
    deductionsPaise: s.employeeDeductionsPaise,
    netPaise: s.netPaise,
    reimbursementsPaise: s.reimbursementsPaise ?? 0,
    netPayablePaise: s.netPayablePaise,
    employerCostPaise: s.employerCostPaise,
    incomeTaxPaise: s.deductions.find((d) => d.key === 'income_tax')?.amountPaise ?? 0,
  };
}

/** Lines as Suwi reads them: rupees alongside paise so it never divides. */
export const showLines = (lines: SlipLine[]) => lines.map((l) => ({ code: l.code, name: l.name, amount: rupees(l.paise), ...(l.fullPaise !== undefined && l.fullPaise !== l.paise ? { fullMonth: rupees(l.fullPaise) } : {}) }));

/** A signed rupee delta, "+₹1,200" / "−₹300" / "no change". */
export const delta = (paise: number) => (paise === 0 ? 'no change' : `${paise > 0 ? '+' : '−'}${rupees(Math.abs(paise))}`);

export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
