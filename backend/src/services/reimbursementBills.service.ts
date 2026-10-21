/**
 * Salary reimbursements (Fuel, Internet…) and the bills behind them.
 *
 * The component is paid in full every month with salary and counts as taxable
 * salary until bills come in. Each month, the bills approved so far this
 * financial year make that much of what has been paid so far tax-free (never
 * more than was paid), so a bill uploaded a month late lowers the tax from the
 * next run on: TDS is worked out on the year's figures every month.
 *
 * Bills are claims of a reimbursement type linked to the component
 * (ReimbursementType.payHeadCode); they are not paid out again.
 */
import { ObjectId } from 'mongodb';
import { payrollRuns, payslips, reimbursementClaims, reimbursementTypes } from '../config/db';
import { PayHead } from '../models/payHead.model';
import { fyOf } from '../shared/payroll/tds';

/** Claim category (the type's name, lowercased, as claims store it) → the component its bills are for. */
export async function billCategories(org: string): Promise<Map<string, string>> {
  const types = await reimbursementTypes().find({ org, payHeadCode: { $exists: true, $ne: '' } } as never).toArray();
  return new Map(types.map((t) => [t.name.toLowerCase(), t.payHeadCode!]));
}

const fyStart = (period: string) => new Date(`${fyOf(period).firstPeriod}-01T00:00:00Z`);

/** Approved bills this FY up to `until`, per person per component, in paise. */
export async function billsByComponent(
  categories: Map<string, string>,
  userIds: string[],
  period: string,
  until: Date,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (categories.size === 0 || userIds.length === 0) return out;
  const rows = await reimbursementClaims()
    .find({ userId: { $in: userIds }, status: { $in: ['approved', 'paid'] }, category: { $in: [...categories.keys()] }, expenseDate: { $gte: fyStart(period), $lte: until } })
    .toArray();
  for (const row of rows) {
    const code = categories.get(row.category);
    if (!code) continue;
    const byCode = out.get(row.userId) ?? new Map<string, number>();
    byCode.set(code, (byCode.get(code) ?? 0) + Math.round((row.amount ?? 0) * 100));
    out.set(row.userId, byCode);
  }
  return out;
}

/** The salary reimbursements paid this FY before `period`, per person per component (runs not rejected). */
export async function reimbursementsPaidBefore(org: string, userIds: string[], period: string): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const { firstPeriod } = fyOf(period);
  if (period === firstPeriod || userIds.length === 0) return out;
  const runs = await payrollRuns().find({ org, period: { $gte: firstPeriod, $lt: period }, status: { $ne: 'rejected' } }, { projection: { _id: 1 } }).toArray();
  if (runs.length === 0) return out;
  const slips = await payslips()
    .find({ org, runId: { $in: runs.map((r: { _id: ObjectId }) => r._id.toHexString()) }, userId: { $in: userIds } }, { projection: { userId: 1, reimbursementLines: 1 } })
    .toArray();
  for (const slip of slips) {
    const byCode = out.get(slip.userId) ?? new Map<string, number>();
    for (const line of slip.reimbursementLines ?? []) byCode.set(line.code, (byCode.get(line.code) ?? 0) + line.amountPaise);
    out.set(slip.userId, byCode);
  }
  return out;
}

export interface ReimbursementTax {
  /** Paid this FY, this month included. */
  paidPaise: number;
  /** Covered by approved bills (at most what was paid). */
  exemptPaise: number;
  /** Paid without bills: taxable salary. */
  taxablePaise: number;
  byCode: { code: string; paidPaise: number; billedPaise: number; exemptPaise: number }[];
}

/**
 * Of what has been paid this FY, how much is taxable. A component HR marked
 * not taxable stays tax-free; every other reimbursement needs bills.
 */
export function reimbursementTax(
  paid: Map<string, number>,
  bills: Map<string, number> | undefined,
  headByCode: Map<string, Pick<PayHead, 'taxable'>>,
): ReimbursementTax {
  const byCode: ReimbursementTax['byCode'] = [];
  let paidPaise = 0;
  let exemptPaise = 0;
  for (const [code, amount] of paid) {
    if (amount <= 0) continue;
    const billed = bills?.get(code) ?? 0;
    const exempt = headByCode.get(code)?.taxable === false ? amount : Math.min(billed, amount);
    byCode.push({ code, paidPaise: amount, billedPaise: billed, exemptPaise: exempt });
    paidPaise += amount;
    exemptPaise += exempt;
  }
  return { paidPaise, exemptPaise, taxablePaise: paidPaise - exemptPaise, byCode };
}

/** Add one map of amounts by code into another. */
export function addInto(target: Map<string, number>, lines: { code: string; amountPaise: number }[]): Map<string, number> {
  for (const l of lines) target.set(l.code, (target.get(l.code) ?? 0) + l.amountPaise);
  return target;
}
