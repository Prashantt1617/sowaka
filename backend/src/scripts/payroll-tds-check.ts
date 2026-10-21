/**
 * TDS engine check, in memory: the seed config ("to confirm") applied to
 * Zoho Employee A's September 2026 structure. Zoho's ₹28,879 for that month
 * was typed by hand, so this reports what the engine computes rather than
 * forcing a match. Also a few textbook cases, asserted.
 *
 *   npm run payroll:tds-check
 */
import assert from 'node:assert/strict';
import { computeTds, fyOf, TDS_SEED } from '../shared/payroll/tds';
import { computeZohoCase, ZOHO_CASES } from './payroll-zoho-check';

const NEW = TDS_SEED.find((c) => c.regime === 'new')!;
const OLD = TDS_SEED.find((c) => c.regime === 'old')!;
const R = (r: number) => r * 100;
const year = (annualPaise: number, config = NEW) =>
  computeTds({ config, ytdTaxablePaise: 0, ytdTdsPaise: 0, currentTaxablePaise: annualPaise / 12, futureMonthlyTaxablePaise: annualPaise / 12, monthsAfter: 11 });

// Textbook: new regime, ₹12,75,000 salary → ₹12,00,000 taxable → nil (87A).
assert.equal(year(R(12_75_000)).annualTaxPaise, 0);
// ₹13,00,000 salary → ₹12,25,000 taxable: slab tax ₹63,750, marginal relief caps it at ₹25,000, + 4% cess = ₹26,000.
assert.equal(year(R(13_00_000)).annualTaxPaise, R(26_000));
// ₹25,75,000 salary → ₹25,00,000 taxable: 20k + 40k + 60k + 80k + 1L + 30k = ₹3,30,000, + 4% cess = ₹3,43,200.
assert.equal(year(R(25_75_000)).annualTaxPaise, R(3_43_200));
// Old regime ₹10,50,000 salary, 80C ₹1.5L: taxable ₹8,50,000 → 12,500 + 70,000 = ₹82,500 + cess = ₹85,800.
assert.equal(
  computeTds({ config: OLD, ytdTaxablePaise: 0, ytdTdsPaise: 0, currentTaxablePaise: R(87_500), futureMonthlyTaxablePaise: R(87_500), monthsAfter: 11, declarations: { sec80C: R(1_50_000) } }).annualTaxPaise,
  R(85_800),
);
assert.deepEqual(fyOf('2026-09'), { fy: '2026-27', monthsAfter: 6, firstPeriod: '2026-04' });
assert.deepEqual(fyOf('2027-03'), { fy: '2026-27', monthsAfter: 0, firstPeriod: '2026-04' });
console.log('TDS textbook cases: ok (new regime rebate, marginal relief, slabs; old regime with 80C)');

// Employee A: taxable salary = gross pay (every earning on A's structure is taxable; reimbursements are not).
const a = ZOHO_CASES[0];
const sept = computeZohoCase(a, { incomeTaxPaise: 0 }).slip.taxablePaise;
// Months before September at the old ₹15,000 ceiling: employer PF ₹1,800 inside CTC, so ₹560 more Fixed Allowance a month.
const aprToAug = (sept + R(560)) * 5;
// From October at ₹25,000: employer PF ₹3,000, ₹640 less a month.
const octOn = sept - R(640);
for (const [label, ytdTds] of [['no tax deducted before September', 0], ['₹28,879 deducted each month April–August', R(28_879) * 5]] as const) {
  const r = computeTds({ config: NEW, ytdTaxablePaise: aprToAug, ytdTdsPaise: ytdTds, currentTaxablePaise: sept, futureMonthlyTaxablePaise: octOn, monthsAfter: 6 });
  console.log(`Employee A, Sept 2026, new regime, ${label}: projected salary ₹${(r.grossSalaryPaise / 100).toLocaleString('en-IN')}, taxable ₹${(r.taxableIncomePaise / 100).toLocaleString('en-IN')}, annual tax ₹${(r.annualTaxPaise / 100).toLocaleString('en-IN')} (slab ₹${(r.slabTaxPaise / 100).toLocaleString('en-IN')} + cess ₹${(r.cessPaise / 100).toLocaleString('en-IN')}), September TDS ₹${(r.monthlyTdsPaise / 100).toLocaleString('en-IN')} (Zoho, typed by hand: ₹28,879)`);
}
const flat = year(sept * 12);
console.log(`Employee A at the September salary for a whole year, new regime: annual tax ₹${(flat.annualTaxPaise / 100).toLocaleString('en-IN')}, ₹${(flat.monthlyTdsPaise / 100).toLocaleString('en-IN')} a month`);
const flatOld = computeTds({ config: OLD, ytdTaxablePaise: 0, ytdTdsPaise: 0, currentTaxablePaise: sept, futureMonthlyTaxablePaise: sept, monthsAfter: 11, employeePfYearPaise: R(2_360) * 12, ptYearPaise: 0 });
console.log(`Same, old regime, no declarations beyond employee PF in 80C: annual tax ₹${(flatOld.annualTaxPaise / 100).toLocaleString('en-IN')}, ₹${(flatOld.monthlyTdsPaise / 100).toLocaleString('en-IN')} a month`);
console.log(`Seed config status: ${NEW.status} (${NEW.source})`);
