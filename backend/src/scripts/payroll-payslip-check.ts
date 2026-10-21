/**
 * Payslip display check, in memory: a template component's payslip name is
 * the label on the slip, and a component with showInPayslip off is not
 * listed but still counts in every total.
 *
 *   npm run payroll:payslip-check
 */
import assert from 'node:assert/strict';
import { payslipHtml } from '../services/payslip-html';
import { computeZohoCase, ZOHO_CASES, ZOHO_TEMPLATES } from './payroll-zoho-check';

const a = ZOHO_CASES[0];
const plain = computeZohoCase(a);

// Same person, but this template renames Basic and hides Internet + Meal Card.
const template = ZOHO_TEMPLATES[a.templateCode];
const original = template.components;
template.components = original.map((c) =>
  c.payHeadCode === 'BASIC'
    ? { ...c, payslipName: 'Basic Salary' }
    : c.payHeadCode === 'INTERNET' || c.payHeadCode === 'MEAL_CARD'
      ? { ...c, showInPayslip: false }
      : c,
);
const styled = computeZohoCase(a);
template.components = original;

const { slip } = styled;
assert.equal(slip.grossPaise, plain.slip.grossPaise, 'gross unchanged');
assert.equal(slip.netPayablePaise, plain.slip.netPayablePaise, 'net unchanged');
assert.equal(slip.employerCostPaise, plain.slip.employerCostPaise, 'cost unchanged');
assert.equal(slip.earnings.find((e) => e.code === 'BASIC')?.name, 'Basic Salary');
assert.equal(slip.earnings.find((e) => e.code === 'MEAL_CARD')?.hidden, true);
assert.equal(slip.reimbursementLines.find((r) => r.code === 'INTERNET')?.hidden, true);

const html = payslipHtml(
  {
    employeeName: 'Check Person',
    period: '2026-09',
    earnings: slip.earnings,
    deductions: slip.deductions,
    reimbursementsPaise: slip.reimbursementsPaise,
    reimbursementLines: slip.reimbursementLines,
    netPayablePaise: slip.netPayablePaise,
    inputs: { workingDays: 30, lopDays: 0, payableDays: 30, overtimePaise: 0 },
  },
  { name: 'Check Co', address: '' },
);
assert.ok(html.includes('Basic Salary'), 'renamed label printed');
assert.ok(!html.includes('>Meal Card<'), 'hidden earning not listed');
assert.ok(!html.includes('Internet Reimbursement'), 'hidden reimbursement not listed');
assert.ok(html.includes('Fuel Reimbursement'), 'visible reimbursement listed');
// Gross earnings row still includes the hidden lines: 2,24,827 + 16,800.
assert.ok(html.includes('₹2,41,627'), 'totals include hidden lines');
console.log('Payslip check passed: payslip names used, hidden lines unlisted, totals unchanged.');
