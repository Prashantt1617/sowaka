/**
 * Zoho match check: September 2026, two Convrse employees on different
 * templates, all 26 payslip lines to the paisa. In-memory only — no DB,
 * no network. The component definitions mirror convrse's pay_heads and
 * salary_templates (read once, read-only); the people are anonymous.
 *
 *   npm run payroll:zoho-check
 *
 * Exits 1 on any mismatch.
 */
import { PayHead } from '../models/payHead.model';
import { SalaryTemplate } from '../models/salaryTemplate.model';
import { StructureOverrides } from '../models/salaryStructure.model';
import { ResolvedRuleSet } from '../models/statutoryRule.model';
import { StatutorySettings } from '../models/statutorySettings.model';
import { calculateSalaryStructure } from '../services/salary-calculator';
import { computePayslip, PayslipComputation } from '../services/payroll-run.calculator';
import { SalaryCalcResult } from '../services/salary-calculator';
import { applyOverrides, resolveTemplateComponents } from '../services/salaryTemplate.service';
import { STATUTORY_SEED } from './payroll-config-seed-data';

/** FY 2026-27 as seeded into payroll_statutory_configs. */
export const ZOHO_STATUTORY = STATUTORY_SEED.find((c) => c.fy === '2026-27')!;

const now = new Date('2026-09-01T00:00:00Z');
const head = (h: Partial<PayHead> & Pick<PayHead, 'code' | 'name' | 'category' | 'componentType' | 'calculation'>): PayHead => ({
  org: 'zoho-check',
  active: true,
  createdAt: now,
  updatedAt: now,
  ...h,
});

// The component catalog (identity + treatment), as convrse has it.
export const ZOHO_CATALOG: PayHead[] = [
  head({ code: 'BASIC', name: 'Basic', category: 'earning', componentType: 'basic', calculation: { mode: 'percentage', percent: 50, base: 'ctc' }, considerForEpf: { consider: true }, considerForEsi: { consider: true }, taxable: true, showInPayslip: true }),
  head({ code: 'HRA', name: 'House Rent Allowance', category: 'earning', componentType: 'hra', calculation: { mode: 'percentage', percent: 50, base: 'basic' }, considerForEsi: { consider: true }, taxable: true, showInPayslip: true }),
  head({ code: 'MEAL_CARD', name: 'Meal Card', category: 'earning', componentType: 'meal_card', calculation: { mode: 'flat_per_month', amountPaise: 2_200_00 }, taxable: true, showInPayslip: true }),
  head({ code: 'FIXED_ALLOWANCE', name: 'Fixed Allowance', category: 'earning', componentType: 'fixed_allowance', calculation: { mode: 'flat_amount' }, payslipName: 'Fixed Allowance', showInPayslip: true, taxable: true }),
  head({ code: 'BONUS', name: 'Statutory Bonus', category: 'earning', componentType: 'statutory_bonus', calculation: { mode: 'percentage', percent: 8.33, base: 'basic' } }),
  head({ code: 'BONUS_ONE_TIME', name: 'Bonus', category: 'earning', componentType: 'other', calculation: { mode: 'flat_amount' }, recurrence: 'one_time', payslipName: 'Bonus', showInPayslip: true, taxable: true }),
  head({ code: 'FUEL', name: 'Fuel Reimbursement', category: 'reimbursement', componentType: 'other', calculation: { mode: 'flat_amount' }, maxClaimablePaise: 7_000_00 }),
  head({ code: 'BOOKS', name: 'Books and Periodicals', category: 'reimbursement', componentType: 'other', calculation: { mode: 'flat_amount' }, maxClaimablePaise: 3_000_00, payslipName: 'Books and Periodicals Reimbursement' }),
  head({ code: 'INTERNET', name: 'Internet Reimbursement', category: 'reimbursement', componentType: 'other', calculation: { mode: 'flat_amount' }, maxClaimablePaise: 1_800_00, payslipName: 'Internet Reimbursement' }),
  head({ code: 'GRATUITY', name: 'Gratuity', category: 'benefit', componentType: 'gratuity', calculation: { mode: 'percentage', percent: 4.81, base: 'basic' }, payslipName: 'Gratuity' }),
];

const tpl = (code: string, components: SalaryTemplate['components']): SalaryTemplate => ({
  org: 'zoho-check',
  name: code,
  code,
  components,
  balancingComponentCode: 'FIXED_ALLOWANCE',
  paidDaysEnabled: true,
  active: true,
  createdAt: now,
  updatedAt: now,
});

export const ZOHO_TEMPLATES: Record<string, SalaryTemplate> = {
  TAXABLE_SALARY: tpl('TAXABLE_SALARY', [
    { payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: 50, base: 'ctc' } },
    { payHeadCode: 'HRA', calculation: { mode: 'percentage', percent: 50, base: 'basic' } },
    { payHeadCode: 'FIXED_ALLOWANCE', calculation: { mode: 'flat_amount' } },
    { payHeadCode: 'BONUS', calculation: { mode: 'percentage', percent: 8.33, base: 'basic' } },
    { payHeadCode: 'FUEL', calculation: { mode: 'flat_amount' } },
    { payHeadCode: 'BOOKS', calculation: { mode: 'flat_amount' } },
    { payHeadCode: 'INTERNET', calculation: { mode: 'flat_amount' } },
    { payHeadCode: 'MEAL_CARD', calculation: { mode: 'flat_per_month', amountPaise: 8_800_00 } },
    { payHeadCode: 'GRATUITY', calculation: { mode: 'percentage', percent: 4.81, base: 'basic' } },
    { payHeadCode: 'BONUS_ONE_TIME', calculation: { mode: 'flat_amount' } },
  ]),
  BELOW_TAXABLE: tpl('BELOW_TAXABLE', [
    { payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: 30, base: 'ctc' } },
    { payHeadCode: 'HRA', calculation: { mode: 'percentage', percent: 50, base: 'basic' } },
    { payHeadCode: 'FIXED_ALLOWANCE', calculation: { mode: 'flat_amount' } },
    { payHeadCode: 'BONUS', calculation: { mode: 'percentage', percent: 8.33, base: 'basic' } },
    { payHeadCode: 'GRATUITY', calculation: { mode: 'percentage', percent: 4.81, base: 'basic' } },
  ]),
};

/** Convrse's org-wide statutory settings (registration numbers left out). */
export const ZOHO_SETTINGS: StatutorySettings = {
  org: 'zoho-check',
  epf: {
    enabled: true,
    employeeRate: 'restricted',
    employerRate: 'restricted',
    includeEmployer: true,
    includeEDLI: false,
    includeAdmin: false,
    overrideAtEmployee: true,
    proRateRestricted: false,
    considerLOP: true,
  },
  esi: { enabled: true, includeEmployer: true },
  bonus: {
    enabled: true,
    frequency: 'monthly',
    ratePercent: 8.33,
    minWages: { haryana: [{ category: 'Skilled', minWagePaise: 13_372_67, effectiveFrom: '2024-10' }] },
  },
  lwfDisabledStates: [],
};

export const HARYANA: ResolvedRuleSet = {
  state: 'haryana',
  lwf: {
    cycle: 'monthly',
    deductionMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    employee: { mode: 'percentage', percent: 0.2, capPaise: 35_00 },
    employer: { mode: 'multiple_of_employee', factor: 2 },
  },
};

export const ZOHO_LINES = [
  'Basic', 'House Rent Allowance', 'Meal Card', 'Fixed Allowance', 'Statutory Bonus', 'Bonus',
  'Fuel Reimbursement', 'Internet Reimbursement', 'Total Reimbursements', 'Gross Pay',
  'EPF (employee)', 'Haryana LWF (employee)', 'ESI (employee)', 'Income Tax', 'Food Coupon Deduction',
  'Total Deductions', 'Net Pay', 'EPF Employer', 'EPS Employer', 'EDLI Employer', 'EPF Admin Charges',
  'ESI Employer', 'Haryana LWF Employer', 'Gratuity Employer', 'Total Employer Contributions', 'CTC (monthly)',
] as const;

export interface ZohoCase {
  label: string;
  templateCode: keyof typeof ZOHO_TEMPLATES;
  annualCtcPaise: number;
  overrides?: StructureOverrides;
  incomeTaxPaise: number;
  /** Rupees, in ZOHO_LINES order. */
  expected: number[];
}

export const ZOHO_CASES: ZohoCase[] = [
  {
    label: 'Employee A (TAXABLE_SALARY, ₹30,00,000)',
    templateCode: 'TAXABLE_SALARY',
    annualCtcPaise: 30_00_000_00,
    overrides: { remove: ['BOOKS'], edit: { FUEL: { mode: 'flat_per_month', amountPaise: 15_000_00 } } },
    incomeTaxPaise: 28_879_00,
    expected: [125000, 62500, 8800, 28527, 0, 0, 15000, 1800, 16800, 224827, 2360, 35, 0, 28879, 8800, 40074, 201553, 722, 1638, 98, 98.34, 0, 70, 6013, 8639.34, 250000],
  },
  {
    label: 'Employee B (BELOW_TAXABLE, ₹7,92,000)',
    templateCode: 'BELOW_TAXABLE',
    annualCtcPaise: 7_92_000_00,
    overrides: { edit: { BASIC: { mode: 'percentage', percent: 50, base: 'ctc' } } },
    incomeTaxPaise: 0,
    expected: [33000, 16500, 0, 12553, 0, 0, 0, 0, 0, 62053, 2360, 35, 0, 0, 0, 2395, 59658, 722, 1638, 98, 98.34, 0, 70, 1587, 4213.34, 66000],
  },
];

/** The structure and September payslip for one case, entirely in memory. */
export function computeZohoCase(c: ZohoCase, opts: { incomeTaxPaise?: number } = {}): { base: SalaryCalcResult; slip: PayslipComputation } {
  const catalogByCode = new Map(ZOHO_CATALOG.map((h) => [h.code, h]));
  const template = ZOHO_TEMPLATES[c.templateCode];
  const heads = resolveTemplateComponents(applyOverrides(template.components, c.overrides, catalogByCode), catalogByCode);
  const base = calculateSalaryStructure({
    monthlyCtcPaise: Math.round(c.annualCtcPaise / 12),
    payHeads: heads,
    balancingComponentCode: template.balancingComponentCode,
    ruleSet: HARYANA,
    config: ZOHO_STATUTORY,
    month: 9,
    period: '2026-09',
    settings: ZOHO_SETTINGS,
    statutory: {},
  });
  const slip = computePayslip(base, {
    workingDays: 30,
    lopDays: 0,
    overtimePaise: 0,
    reimbursementsPaise: 0,
    ruleSet: HARYANA,
    config: ZOHO_STATUTORY,
    month: 9,
    period: '2026-09',
    settings: ZOHO_SETTINGS,
    incomeTaxPaise: opts.incomeTaxPaise ?? c.incomeTaxPaise,
  });
  return { base, slip };
}

/** The 26 Zoho lines, in paise, from a computed case. */
export function zohoLines(base: SalaryCalcResult, slip: PayslipComputation): number[] {
  const earning = (code: string) => slip.earnings.find((e) => e.code === code)?.paidPaise ?? 0;
  const reimb = (code: string) => slip.reimbursementLines.find((r) => r.code === code)?.amountPaise ?? 0;
  const ded = (key: string) => slip.deductions.find((d) => d.key === key)?.amountPaise ?? 0;
  const st = base.statutory;
  const totalReimb = slip.reimbursementLines.reduce((t, r) => t + r.amountPaise, 0);
  const gratuity = base.benefits.find((b) => b.componentType === 'gratuity')?.monthlyPaise ?? 0;
  const edli = st.epf.edliPaise ?? 0;
  const admin = st.epf.adminPaise ?? 0;
  const employerTotal = st.epf.employerEpfPaise + st.epf.employerEpsPaise + edli + admin + st.esi.employerPaise + st.lwf.employerPaise + gratuity;
  return [
    earning('BASIC'), earning('HRA'), earning('MEAL_CARD'), earning('FIXED_ALLOWANCE'), earning('BONUS'), earning('BONUS_ONE_TIME'),
    reimb('FUEL'), reimb('INTERNET'), totalReimb, slip.grossPaise,
    ded('epf'), ded('lwf'), ded('esi'), ded('income_tax'), ded('food_coupon'),
    slip.employeeDeductionsPaise, slip.netPayablePaise,
    st.epf.employerEpfPaise, st.epf.employerEpsPaise, edli, admin, st.esi.employerPaise, st.lwf.employerPaise, gratuity,
    // CTC as the structure holds it: gross + reimbursements + gratuity + the employer PF kept inside CTC.
    employerTotal, slip.grossPaise + totalReimb + gratuity + base.includedInCtcPaise,
  ];
}

function main() {
  let failures = 0;
  for (const c of ZOHO_CASES) {
    const { base, slip } = computeZohoCase(c);
    const got = zohoLines(base, slip);
    console.log(`\n${c.label}`);
    let caseFail = 0;
    ZOHO_LINES.forEach((name, i) => {
      const want = Math.round(c.expected[i] * 100);
      const ok = got[i] === want;
      if (!ok) caseFail++;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(30)} ${(got[i] / 100).toFixed(2).padStart(12)}${ok ? '' : `   expected ${(want / 100).toFixed(2)}`}`);
    });
    if (got[25] !== Math.round(c.annualCtcPaise / 12)) {
      caseFail++;
      console.log(`  FAIL CTC breakup does not add up to the monthly CTC ${(c.annualCtcPaise / 1200).toFixed(2)}`);
    }
    console.log(caseFail === 0 ? '  → all 26 lines match' : `  → ${caseFail} line(s) differ`);
    failures += caseFail;
  }
  if (failures > 0) {
    console.log(`\nZoho check FAILED (${failures} mismatches)`);
    process.exit(1);
  }
  console.log('\nZoho check passed: both employees match to the paisa.');
}

if (require.main === module) main();
