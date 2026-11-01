/**
 * Seed data for the payroll config collections: exactly the figures the code
 * carried before they moved to the database, so seeding changes no result.
 * Used only by the seed scripts and the checks; nothing at run time imports
 * this file.
 */
import type { TdsConfig } from '../shared/payroll/tds';
import type { StatutoryConfig, StateStatutoryDefaults } from '../shared/payroll/statutory-config';

/** HRA exemption (rule 2A): 50% of Basic in a metro, 40% elsewhere, rent over 10% of Basic. */
const HRA_RULE: NonNullable<TdsConfig['hra']> = { metroPercentOfBasic: 50, nonMetroPercentOfBasic: 40, rentOverPercentOfBasic: 10 };

const L = (rupees: number) => rupees * 100;

/**
 * Income tax seed rows for `tds_configs`, written by payroll-tds-seed.ts and
 * the checks' scratch databases. Never read at run time: payroll reads the
 * stored rows, which HR edits on the dashboard.
 */
export const TDS_SEED: TdsConfig[] = [
  {
    fy: '2026-27',
    regime: 'new',
    status: 'confirmed',
    source: 'New regime as set by the Finance Act 2025; Budget 2026 left slabs, the ₹75,000 standard deduction and the ₹12 lakh rebate unchanged for FY 2026-27 (checked 21 Oct 2026)',
    standardDeductionPaise: L(75_000),
    slabs: [
      { upToPaise: L(4_00_000), ratePercent: 0 },
      { upToPaise: L(8_00_000), ratePercent: 5 },
      { upToPaise: L(12_00_000), ratePercent: 10 },
      { upToPaise: L(16_00_000), ratePercent: 15 },
      { upToPaise: L(20_00_000), ratePercent: 20 },
      { upToPaise: L(24_00_000), ratePercent: 25 },
      { upToPaise: null, ratePercent: 30 },
    ],
    rebate: { incomeLimitPaise: L(12_00_000), maxRebatePaise: L(60_000), marginalRelief: true },
    surcharge: [
      { abovePaise: L(50_00_000), ratePercent: 10 },
      { abovePaise: L(1_00_00_000), ratePercent: 15 },
      { abovePaise: L(2_00_00_000), ratePercent: 25 },
    ],
    cessPercent: 4,
    limits: { sec80C: 0, sec80CCD1B: 0, sec80DSelf: 0, sec80DSelfSenior: 0, sec80DParents: 0, sec80DParentsSenior: 0, sec24bHomeLoan: 0, sec80TTA: 0 },
    ptDeductible: false,
    hraExemption: false,
    hra: HRA_RULE,
  },
  {
    fy: '2026-27',
    regime: 'old',
    status: 'confirmed',
    source: 'Old regime (individual below 60); unchanged by Budget 2026 for FY 2026-27 (checked 21 Oct 2026)',
    standardDeductionPaise: L(50_000),
    slabs: [
      { upToPaise: L(2_50_000), ratePercent: 0 },
      { upToPaise: L(5_00_000), ratePercent: 5 },
      { upToPaise: L(10_00_000), ratePercent: 20 },
      { upToPaise: null, ratePercent: 30 },
    ],
    rebate: { incomeLimitPaise: L(5_00_000), maxRebatePaise: L(12_500), marginalRelief: false },
    surcharge: [
      { abovePaise: L(50_00_000), ratePercent: 10 },
      { abovePaise: L(1_00_00_000), ratePercent: 15 },
      { abovePaise: L(2_00_00_000), ratePercent: 25 },
      { abovePaise: L(5_00_00_000), ratePercent: 37 },
    ],
    cessPercent: 4,
    limits: {
      sec80C: L(1_50_000),
      sec80CCD1B: L(50_000),
      sec80DSelf: L(25_000),
      sec80DSelfSenior: L(50_000),
      sec80DParents: L(25_000),
      sec80DParentsSenior: L(50_000),
      sec24bHomeLoan: L(2_00_000),
      sec80TTA: L(10_000),
    },
    ptDeductible: true,
    hraExemption: true,
    hra: HRA_RULE,
  },
];

/** The per-state defaults that were DEFAULT_STATE_RULES in statutory.service.ts. */
const STATES: StateStatutoryDefaults[] = [
  {
    state: 'delhi',
    lwf: {
      cycle: 'half_yearly',
      deductionMonths: [6, 12],
      employee: { mode: 'flat', amountPaise: 75 }, // ₹0.75
      employer: { mode: 'flat', amountPaise: 225 }, // ₹2.25
    },
  },
  {
    state: 'haryana',
    lwf: {
      cycle: 'monthly',
      deductionMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      employee: { mode: 'percentage', percent: 0.2, capPaise: 35_00 },
      employer: { mode: 'multiple_of_employee', factor: 2 },
    },
  },
  {
    state: 'karnataka',
    // ₹0 below ₹25,000 monthly gross, ₹200 at/above.
    pt: {
      slabs: [
        { upToPaise: 24_999_99, amountPaise: 0 },
        { upToPaise: null, amountPaise: 200_00 },
      ],
    },
  },
  {
    state: 'west bengal',
    // Monthly gross: ₹0 up to ₹10,000, then ₹110 / ₹130 / ₹150, and ₹200 above ₹40,000.
    pt: {
      slabs: [
        { upToPaise: 10_000_00, amountPaise: 0 },
        { upToPaise: 15_000_00, amountPaise: 110_00 },
        { upToPaise: 25_000_00, amountPaise: 130_00 },
        { upToPaise: 40_000_00, amountPaise: 150_00 },
        { upToPaise: null, amountPaise: 200_00 },
      ],
    },
  },
];

function statutoryYear(fy: string, wageCeilings: StatutoryConfig['epf']['wageCeilings'], source: string): StatutoryConfig {
  return {
    fy,
    status: 'confirmed',
    source,
    // Were EPF_CONSTANTS and EDLI_RATE / ADMIN_RATE.
    epf: { employeeRate: 0.12, employerRate: 0.12, epsRate: 0.0833, edliRate: 0.005, adminRate: 0.005, wageCeilings },
    // Were ESI_CONSTANTS.
    esi: { employeeRate: 0.0075, employerRate: 0.0325, grossCeilingPaise: 21_000_00 },
    // Were BONUS_ELIGIBILITY_PAISE, BONUS_WAGE_FLOOR_PAISE and the 8.33% / 20% bounds.
    bonus: { minRate: 0.0833, maxRate: 0.2, wageFloorPaise: 7_000_00, eligibilityCeilingPaise: 21_000_00 },
    // Was MEAL_CARD_EXEMPT_MONTHLY_PAISE: ₹200 a meal, two meals on 22 working days.
    mealCard: { exemptMonthlyPaise: 8_800_00 },
    states: STATES.map((s) => structuredClone(s)),
  };
}

/** Was EPF_CEILING_SCHEDULE: ₹15,000 until 16 Sep 2026, ₹25,000 from 17 Sep 2026. */
export const STATUTORY_SEED: StatutoryConfig[] = [
  statutoryYear('2025-26', [{ from: '2025-04-01', ceilingPaise: 15_000_00 }], 'The figures payroll used in code before 31 Oct 2026 (EPF 12% / EPS 8.33%, ₹15,000 PF ceiling, ESI 0.75% / 3.25% to ₹21,000, Bonus Act 8.33–20% on ₹7,000 to ₹21,000 Basic)'),
  statutoryYear('2026-27', [
    { from: '2026-04-01', ceilingPaise: 15_000_00 },
    { from: '2026-09-17', ceilingPaise: 25_000_00 },
  ], 'The figures payroll used in code before 31 Oct 2026 (PF ceiling ₹25,000 from 17 Sep 2026, as Zoho applied it to Convrse)'),
];
