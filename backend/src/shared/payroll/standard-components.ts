/**
 * The built-in standard component library, shared by the server and the
 * dashboard (pure data, no imports beyond types). Every org sees these on
 * Payroll › Salary Components next to its own pay heads, marked
 * "Standard · not added yet". A standard component becomes a real
 * `pay_heads` row for one org only when HR saves it there or a salary
 * template of that org uses it. Nothing is written for an org until then.
 *
 * An org's own pay head overrides the standard entry with the same code, and
 * for `uniqueType` entries any of its pay heads of the same type does
 * (an org that already has a Basic under another code doesn't see this one).
 */
import type { PayHead } from '../../models/payHead.model';

export type StandardComponent = Omit<PayHead, 'org' | 'active' | 'createdAt' | 'updatedAt'> & {
  /** Hidden when the org has any pay head of this componentType. */
  uniqueType?: boolean;
};

const earning = (c: Omit<StandardComponent, 'category'>): StandardComponent => ({
  category: 'earning',
  partOfStructure: true,
  taxable: true,
  prorate: true,
  showInPayslip: true,
  recurrence: 'recurring',
  ...c,
});

export const STANDARD_COMPONENTS: StandardComponent[] = [
  // —— Earnings ——
  earning({ code: 'BASIC', name: 'Basic', payslipName: 'Basic', componentType: 'basic', uniqueType: true,
    calculation: { mode: 'percentage', percent: 50, base: 'ctc' },
    considerForEpf: { consider: true, condition: 'always' }, considerForEsi: { consider: true }, fbp: false }),
  earning({ code: 'HRA', name: 'House Rent Allowance', payslipName: 'House Rent Allowance', componentType: 'hra', uniqueType: true,
    calculation: { mode: 'percentage', percent: 50, base: 'basic' }, considerForEsi: { consider: true } }),
  earning({ code: 'SPECIAL', name: 'Special Allowance', payslipName: 'Special Allowance', componentType: 'special_allowance',
    calculation: { mode: 'flat_amount' }, considerForEsi: { consider: true } }),
  earning({ code: 'FIXED_ALLOWANCE', name: 'Fixed Allowance', payslipName: 'Fixed Allowance', componentType: 'fixed_allowance',
    calculation: { mode: 'flat_amount' }, considerForEsi: { consider: true } }),
  earning({ code: 'CONVEYANCE', name: 'Conveyance Allowance', payslipName: 'Conveyance Allowance', componentType: 'conveyance',
    calculation: { mode: 'flat_per_month', amountPaise: 1_600_00 }, considerForEsi: { consider: true } }),
  earning({ code: 'LTA', name: 'Leave Travel Allowance', payslipName: 'Leave Travel Allowance', componentType: 'lta',
    calculation: { mode: 'flat_amount' }, considerForEsi: { consider: true } }),
  earning({ code: 'MEDICAL', name: 'Medical Allowance', payslipName: 'Medical Allowance', componentType: 'medical',
    calculation: { mode: 'flat_per_month', amountPaise: 1_250_00 }, considerForEsi: { consider: true } }),
  earning({ code: 'TELEPHONE_ALLOWANCE', name: 'Telephone Allowance', payslipName: 'Telephone Allowance', componentType: 'telephone',
    calculation: { mode: 'flat_amount' }, considerForEsi: { consider: true } }),
  earning({ code: 'CHILD_EDU', name: 'Children Education Allowance', payslipName: 'Children Education Allowance', componentType: 'child_education',
    calculation: { mode: 'flat_per_month', amountPaise: 200_00 }, considerForEsi: { consider: true } }),
  earning({ code: 'MEAL_CARD', name: 'Meal Card', payslipName: 'Meal Card', componentType: 'meal_card', uniqueType: true,
    calculation: { mode: 'flat_per_month', amountPaise: 2_200_00 }, fbp: true }),
  earning({ code: 'STAT_BONUS', name: 'Statutory Bonus', payslipName: 'Statutory Bonus', componentType: 'statutory_bonus', uniqueType: true,
    calculation: { mode: 'percentage', percent: 8.33, base: 'basic' }, considerForEsi: { consider: true } }),
  earning({ code: 'BONUS_ONE_TIME', name: 'Bonus', payslipName: 'Bonus', componentType: 'other', recurrence: 'one_time', prorate: false,
    calculation: { mode: 'flat_amount' } }),
  // —— Reimbursements (paid every month at the person's amount, or this limit) ——
  { code: 'FUEL', name: 'Fuel Reimbursement', payslipName: 'Fuel Reimbursement', category: 'reimbursement', componentType: 'other',
    calculation: { mode: 'flat_amount' }, maxClaimablePaise: 0, showInPayslip: true, recurrence: 'recurring', unclaimedHandling: 'encash_monthly' },
  { code: 'INTERNET', name: 'Internet Reimbursement', payslipName: 'Internet Reimbursement', category: 'reimbursement', componentType: 'other',
    calculation: { mode: 'flat_amount' }, maxClaimablePaise: 0, showInPayslip: true, recurrence: 'recurring', unclaimedHandling: 'encash_monthly' },
  { code: 'BOOKS', name: 'Books and Periodicals Reimbursement', payslipName: 'Books and Periodicals Reimbursement', category: 'reimbursement', componentType: 'other',
    calculation: { mode: 'flat_amount' }, maxClaimablePaise: 0, showInPayslip: true, recurrence: 'recurring', unclaimedHandling: 'carry_forward' },
  { code: 'TELEPHONE', name: 'Telephone Reimbursement', payslipName: 'Telephone Reimbursement', category: 'reimbursement', componentType: 'other',
    calculation: { mode: 'flat_amount' }, maxClaimablePaise: 0, showInPayslip: true, recurrence: 'recurring', unclaimedHandling: 'encash_monthly' },
  // —— Employer benefits inside CTC ——
  { code: 'GRATUITY', name: 'Gratuity', payslipName: 'Gratuity', category: 'benefit', componentType: 'gratuity', uniqueType: true,
    calculation: { mode: 'percentage', percent: 4.81, base: 'basic' }, showInPayslip: false, recurrence: 'recurring' },
  // —— Deductions (amount set per person on the run or salary) ——
  { code: 'SALARY_ADVANCE_DEDUCTION', name: 'Salary Advance Deduction', payslipName: 'Salary Advance Deduction', category: 'deduction', componentType: 'salary_advance', uniqueType: true,
    calculation: { mode: 'flat_amount' }, recurrence: 'one_time', showInPayslip: true },
  { code: 'NOTICE_PAY_DEDUCTION', name: 'Notice Pay Deduction', payslipName: 'Notice Pay Deduction', category: 'deduction', componentType: 'notice_pay', uniqueType: true,
    calculation: { mode: 'flat_amount' }, recurrence: 'one_time', showInPayslip: true },
  { code: 'HOLD_AMOUNT', name: 'Hold Amount', payslipName: 'Hold Amount', category: 'deduction', componentType: 'hold_amount', uniqueType: true,
    calculation: { mode: 'flat_amount' }, recurrence: 'one_time', showInPayslip: true },
];

/** The standard components an org doesn't have yet, given its own pay heads. */
export function standardNotAdded(own: { code: string; componentType: string }[]): StandardComponent[] {
  const codes = new Set(own.map((h) => h.code));
  const types = new Set<string>(own.map((h) => h.componentType));
  return STANDARD_COMPONENTS.filter((s) => !codes.has(s.code) && !(s.uniqueType && types.has(s.componentType)));
}

/** The pay head row a standard component becomes for one org. */
export function standardAsPayHead(s: StandardComponent, org: string, now: Date): PayHead {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { uniqueType, ...head } = s;
  return { ...head, org, active: true, createdAt: now, updatedAt: now };
}
