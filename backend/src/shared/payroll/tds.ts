/**
 * Income tax (TDS on salary, section 192) for one person and one month.
 * Pure: no I/O, all money in integer paise, shared by the server and the
 * dashboard. Slabs, limits, rebate, surcharge and cess come from a dated
 * config row (`tds_configs`), never from this file.
 *
 *   monthly TDS = (projected annual tax − TDS already deducted this FY)
 *                 ÷ months left in the FY, this one included
 */

export type TaxRegime = 'new' | 'old';

export interface TaxSlab {
  /** Upper bound of the slab, in paise; null for the top slab. */
  upToPaise: number | null;
  ratePercent: number;
}

export interface TdsConfig {
  /** "2026-27" */
  fy: string;
  regime: TaxRegime;
  /** 'to_confirm' until someone checks the values against the Finance Act. */
  status: 'to_confirm' | 'confirmed';
  source?: string;
  standardDeductionPaise: number;
  slabs: TaxSlab[];
  /** Section 87A: up to maxRebatePaise when taxable income ≤ incomeLimitPaise, with marginal relief just above it. */
  rebate: { incomeLimitPaise: number; maxRebatePaise: number; marginalRelief: boolean };
  /** Surcharge on tax by taxable income; marginal relief at each threshold. */
  surcharge: { abovePaise: number; ratePercent: number }[];
  cessPercent: number;
  /** Old regime deduction limits (paise). The new regime ignores them except where noted. */
  limits: {
    sec80C: number;
    sec80CCD1B: number;
    sec80DSelf: number;
    sec80DSelfSenior: number;
    sec80DParents: number;
    sec80DParentsSenior: number;
    sec24bHomeLoan: number;
    sec80TTA: number;
  };
  /** Old regime: Professional Tax paid is deductible (section 16(iii)). */
  ptDeductible: boolean;
  /** Old regime: HRA exemption (section 10(13A)). */
  hraExemption: boolean;
}

/** What the employee declared for the FY (old regime mostly), in paise per year. */
export interface TaxDeclarations {
  sec80C?: number;
  sec80CCD1B?: number;
  sec80DSelf?: number;
  sec80DParents?: number;
  selfSenior?: boolean;
  parentsSenior?: boolean;
  homeLoanInterest?: number;
  sec80TTA?: number;
  /** Rent actually paid in the year, for the HRA exemption. */
  rentPaidPaise?: number;
  /** Lives in Delhi, Mumbai, Kolkata or Chennai: 50% of Basic instead of 40%. */
  metro?: boolean;
  /** Income from elsewhere the employee asked to have taxed through salary. */
  otherIncomePaise?: number;
  /** Tax already deducted by a previous employer this FY, and the salary it was on. */
  previousEmployerSalaryPaise?: number;
  previousEmployerTdsPaise?: number;
}

export interface TdsInput {
  config: TdsConfig;
  /** Taxable salary already paid this FY before this month (all months together). */
  ytdTaxablePaise: number;
  /** Income tax already deducted this FY before this month. */
  ytdTdsPaise: number;
  /** This month's taxable salary as paid. */
  currentTaxablePaise: number;
  /** A normal month's taxable salary from the structure, for the months still to come. */
  futureMonthlyTaxablePaise: number;
  /** Months after this one left in the FY (March → 0). */
  monthsAfter: number;
  /** Old regime pieces. */
  basicYearPaise?: number;
  hraYearPaise?: number;
  employeePfYearPaise?: number;
  ptYearPaise?: number;
  declarations?: TaxDeclarations;
}

export interface TdsResult {
  regime: TaxRegime;
  fy: string;
  configStatus: TdsConfig['status'];
  grossSalaryPaise: number;
  standardDeductionPaise: number;
  hraExemptPaise: number;
  ptDeductionPaise: number;
  chapterVIAPaise: number;
  homeLoanPaise: number;
  taxableIncomePaise: number;
  slabTaxPaise: number;
  rebatePaise: number;
  surchargePaise: number;
  cessPaise: number;
  annualTaxPaise: number;
  alreadyDeductedPaise: number;
  monthsLeft: number;
  monthlyTdsPaise: number;
}

const pct = (paise: number, rate: number) => (paise * Math.round(rate * 100)) / 10000;
/** Tax is computed to the rupee (section 288B rounds income to ₹10; we round tax to ₹1). */
const rupee = (paise: number) => Math.round(paise / 100) * 100;

export function slabTax(income: number, slabs: TaxSlab[]): number {
  let tax = 0;
  let lower = 0;
  for (const slab of slabs) {
    const upper = slab.upToPaise ?? Number.POSITIVE_INFINITY;
    if (income > lower) tax += pct(Math.min(income, upper) - lower, slab.ratePercent);
    lower = upper;
    if (income <= upper) break;
  }
  return tax;
}

/** Tax on `income` after the 87A rebate, before surcharge and cess. */
function afterRebate(income: number, config: TdsConfig): { tax: number; rebate: number } {
  const tax = slabTax(income, config.slabs);
  const r = config.rebate;
  if (income <= r.incomeLimitPaise) {
    const rebate = Math.min(tax, r.maxRebatePaise);
    return { tax: tax - rebate, rebate };
  }
  if (r.marginalRelief) {
    // Just above the limit, tax may not exceed the income above the limit.
    const excess = income - r.incomeLimitPaise;
    if (tax > excess) return { tax: excess, rebate: tax - excess };
  }
  return { tax, rebate: 0 };
}

function surchargeOn(income: number, tax: number, config: TdsConfig): number {
  const bands = [...config.surcharge].sort((a, b) => b.abovePaise - a.abovePaise);
  const band = bands.find((b) => income > b.abovePaise);
  if (!band) return 0;
  const raw = pct(tax, band.ratePercent);
  // Marginal relief: tax + surcharge may not exceed tax at the threshold
  // (with that threshold's lower surcharge) plus the income above it.
  const lower = bands.find((b) => b.abovePaise < band.abovePaise);
  const atThreshold = afterRebate(band.abovePaise, config).tax;
  const atThresholdTotal = atThreshold + (lower ? pct(atThreshold, lower.ratePercent) : 0);
  const cap = atThresholdTotal + (income - band.abovePaise) - tax;
  return Math.max(0, Math.min(raw, cap));
}

export function computeTds(input: TdsInput): TdsResult {
  const { config } = input;
  const d = input.declarations ?? {};
  const old = config.regime === 'old';
  const L = config.limits;

  const projected = input.ytdTaxablePaise + input.currentTaxablePaise + input.futureMonthlyTaxablePaise * input.monthsAfter;
  const gross = projected + (d.previousEmployerSalaryPaise ?? 0) + (d.otherIncomePaise ?? 0);

  let hraExempt = 0;
  if (old && config.hraExemption && (input.hraYearPaise ?? 0) > 0 && (d.rentPaidPaise ?? 0) > 0) {
    const basic = input.basicYearPaise ?? 0;
    hraExempt = Math.max(0, Math.min(input.hraYearPaise!, d.rentPaidPaise! - basic / 10, (basic * (d.metro ? 50 : 40)) / 100));
  }
  const pt = old && config.ptDeductible ? input.ptYearPaise ?? 0 : 0;
  const standard = Math.min(config.standardDeductionPaise, gross);

  let viA = 0;
  let homeLoan = 0;
  if (old) {
    viA += Math.min(L.sec80C, (d.sec80C ?? 0) + (input.employeePfYearPaise ?? 0));
    viA += Math.min(L.sec80CCD1B, d.sec80CCD1B ?? 0);
    viA += Math.min(d.selfSenior ? L.sec80DSelfSenior : L.sec80DSelf, d.sec80DSelf ?? 0);
    viA += Math.min(d.parentsSenior ? L.sec80DParentsSenior : L.sec80DParents, d.sec80DParents ?? 0);
    viA += Math.min(L.sec80TTA, d.sec80TTA ?? 0);
    homeLoan = Math.min(L.sec24bHomeLoan, d.homeLoanInterest ?? 0);
  }

  const taxable = Math.max(0, rupee(gross - hraExempt - pt - standard - viA - homeLoan));
  const slab = slabTax(taxable, config.slabs);
  const { tax: afterRebateTax, rebate } = afterRebate(taxable, config);
  const surcharge = surchargeOn(taxable, afterRebateTax, config);
  const cess = pct(afterRebateTax + surcharge, config.cessPercent);
  const annual = rupee(afterRebateTax + surcharge + cess);

  const already = input.ytdTdsPaise + (d.previousEmployerTdsPaise ?? 0);
  const monthsLeft = input.monthsAfter + 1;
  // What is still owed, spread evenly over this month and the ones left.
  const monthly = Math.max(0, rupee((annual - already) / monthsLeft));

  return {
    regime: config.regime,
    fy: config.fy,
    configStatus: config.status,
    grossSalaryPaise: gross,
    standardDeductionPaise: standard,
    hraExemptPaise: rupee(hraExempt),
    ptDeductionPaise: pt,
    chapterVIAPaise: viA,
    homeLoanPaise: homeLoan,
    taxableIncomePaise: taxable,
    slabTaxPaise: rupee(slab),
    rebatePaise: rupee(rebate),
    surchargePaise: rupee(surcharge),
    cessPaise: rupee(cess),
    annualTaxPaise: annual,
    alreadyDeductedPaise: already,
    monthsLeft,
    monthlyTdsPaise: monthly,
  };
}

/** The financial year ("2026-27") a pay month ("YYYY-MM") falls in, and the months after it in that FY. */
export function fyOf(period: string): { fy: string; monthsAfter: number; firstPeriod: string } {
  const [y, m] = period.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  const monthsAfter = m >= 4 ? 15 - m : 3 - m;
  return { fy: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, monthsAfter, firstPeriod: `${start}-04` };
}

const L = (rupees: number) => rupees * 100;

/**
 * Seed values. FY 2026-27 is assumed to carry the Finance Act 2025 (FY
 * 2025-26) slabs unchanged: TO CONFIRM against the Finance Act 2026 before
 * use. Stored in `tds_configs` by the seed script, never read from here at
 * run time.
 */
export const TDS_SEED: TdsConfig[] = [
  {
    fy: '2026-27',
    regime: 'new',
    status: 'to_confirm',
    source: 'Section 115BAC as amended by the Finance Act 2025 (FY 2025-26 values), assumed unchanged for FY 2026-27',
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
  },
  {
    fy: '2026-27',
    regime: 'old',
    status: 'to_confirm',
    source: 'Old regime (individual below 60) as in FY 2025-26, assumed unchanged for FY 2026-27',
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
  },
];
