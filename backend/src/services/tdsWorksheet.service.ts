/**
 * The TDS work sheet for one payslip, laid out as Zoho's: salary actually paid
 * this FY up to the payslip's month, the months still to come projected on each
 * month's own structure, exemptions, section 19 deductions, chapter VIII, the
 * total income rounded to ₹10, the tax by slab, the rebate or relief, cess, and
 * the tax deducted so far and still to deduct.
 *
 * Months this FY before the person's first payslip in Sowaka (the company paid
 * them elsewhere) are filled in from the salary as a full month, or from the
 * joining day; they are listed in `estimatedPeriods` and their income tax is
 * not known.
 */
import { ObjectId } from 'mongodb';
import { employeePaymentDetails, payHeads, payrollRuns, payslips, salaryStructures, salaryTemplates, users } from '../config/db';
import { Payslip } from '../models/payrollRun.model';
import { calculateSalaryStructure } from './salary-calculator';
import { computePayslip, MEAL_CARD_EXEMPT_MONTHLY_PAISE } from './payroll-run.calculator';
import { applyOverrides, resolveTemplateComponents } from './salaryTemplate.service';
import { statutorySettingsFor, workStateOf } from './statutorySettings.service';
import { resolveRuleSet } from './statutory.service';
import { computeWorkingDays, parsePeriod } from './payroll-inputs.service';
import { declarationsFor, tdsConfigsFor } from './tds.service';
import { fyOf, periodsAfter, roundToTenRupees, taxOnIncome, TaxRegime } from '../shared/payroll/tds';
import { billCategories, billsByComponent, reimbursementTax } from './reimbursementBills.service';
import { companyOf, PayrollRunError, requireAdminOrg } from './payrollRun.service';
import { decryptField, fieldKeyConfigured } from './fieldCrypto';
import { payrollAccessOf } from './payrollAccess.service';

const RUN_RANK: Record<string, number> = { paid: 4, approved: 3, pending_approval: 2, draft: 1 };

interface MonthEarnings {
  lines: { code: string; paise: number }[];
  overtimePaise: number;
}

/** A payslip's earnings and salary reimbursements as paid. */
const linesOf = (s: Pick<Payslip, 'earnings' | 'reimbursementLines'>) => [
  ...s.earnings.map((e) => ({ code: e.code, paise: e.paidPaise })),
  ...(s.reimbursementLines ?? []).map((l) => ({ code: l.code, paise: l.amountPaise })),
];

function periodsFrom(first: string, before: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number);
  for (let p = first; p < before; ) {
    out.push(p);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    p = `${y}-${String(m).padStart(2, '0')}`;
  }
  return out;
}

const monthName = (period: string) =>
  new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

export async function tdsWorksheet(viewerUserId: string, payslipId: string) {
  const org = await requireAdminOrg(viewerUserId);
  if (!(await payrollAccessOf(viewerUserId))) throw new PayrollRunError(403, 'Only people with payroll access can see a TDS work sheet');
  if (!ObjectId.isValid(payslipId)) throw new PayrollRunError(404, 'Payslip not found');
  const slip = await payslips().findOne({ _id: new ObjectId(payslipId), org });
  if (!slip || !ObjectId.isValid(slip.runId)) throw new PayrollRunError(404, 'Payslip not found');
  const run = await payrollRuns().findOne({ _id: new ObjectId(slip.runId), org, status: { $ne: 'rejected' } });
  if (!run) throw new PayrollRunError(404, 'Payslip not found');
  return worksheetFor(org, slip);
}

/** The work sheet for a payslip of `org` (stored, or computed and not saved). */
export async function worksheetFor(org: string, slip: Payslip) {
  const { userId, period } = slip;
  const { fy, firstPeriod, monthsAfter } = fyOf(period);
  const [employee, structure, catalog, templates, settings, configs, declarations, payment, company] = await Promise.all([
    users().findOne({ userId }),
    salaryStructures().findOne({ org, userId, status: 'active' }),
    payHeads().find({ org }).toArray(),
    salaryTemplates().find({ org }).toArray(),
    statutorySettingsFor(org),
    tdsConfigsFor(fy),
    declarationsFor(org, fy, [userId]),
    employeePaymentDetails().findOne({ org, userId } as never) as Promise<{ pan?: string; panLast4?: string } | null>,
    companyOf(org),
  ]);
  const declaration = declarations.get(userId);
  const regime: TaxRegime = declaration?.regime ?? settings.tds?.defaultRegime ?? 'new';
  const config = configs.get(regime);
  if (!config) throw new PayrollRunError(409, `No income-tax rates are set up for FY ${fy}`);
  const d = declaration?.declarations ?? {};
  const old = regime === 'old';
  const headByCode = new Map(catalog.map((h) => [h.code, h]));

  // This FY's earlier payslips: one per month, from the furthest-along run.
  const earlier = await payslips().find({ org, userId, period: { $gte: firstPeriod, $lt: period } }).toArray();
  const runs = await payrollRuns()
    .find({ org, _id: { $in: [...new Set(earlier.map((s) => s.runId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) }, status: { $ne: 'rejected' } }, { projection: { status: 1 } })
    .toArray();
  const rankOf = new Map(runs.map((r) => [r._id.toHexString(), RUN_RANK[r.status] ?? 0]));
  const byPeriod = new Map<string, Payslip>();
  for (const s of earlier) {
    const rank = rankOf.get(s.runId);
    if (rank === undefined) continue;
    const held = byPeriod.get(s.period);
    if (!held || (rankOf.get(held.runId) ?? 0) < rank) byPeriod.set(s.period, s);
  }
  byPeriod.set(period, slip);
  const firstRecorded = [...byPeriod.keys()].sort()[0];

  // The salary as it would be computed for any month (for months before Sowaka and the projection).
  const template = structure?.salaryTemplateCode ? templates.find((t) => t.code === structure.salaryTemplateCode) : undefined;
  const ruleSet = employee ? await resolveRuleSet(org, workStateOf(employee)) : undefined;
  const salaryFor = structure && template && ruleSet
    ? (p: string, employedFrom?: string) => calculateSalaryStructure({
      monthlyCtcPaise: Math.round(structure.annualCtcPaise / 12),
      payHeads: resolveTemplateComponents(applyOverrides(template.components, structure.overrides, headByCode), headByCode),
      componentValues: structure.componentValues ?? {},
      balancingComponentCode: template.balancingComponentCode,
      ruleSet,
      month: Number(p.slice(5, 7)),
      period: p,
      bonusCategory: structure.bonusCategory,
      statutory: structure.statutory,
      settings,
      statutoryWages: template.statutoryWages,
      employedFrom,
    })
    : undefined;

  const actual: MonthEarnings[] = [];
  let tdsTillLastMonth = 0;
  let ptPaid = 0;
  let pfPaid = 0;
  const estimatedPeriods: string[] = [];
  const joined = employee?.joiningDate ? new Date(employee.joiningDate).toISOString().slice(0, 10) : undefined;
  for (const p of periodsFrom(firstPeriod, period)) {
    const s = byPeriod.get(p);
    if (s) {
      actual.push({ lines: linesOf(s), overtimePaise: s.inputs?.overtimePaise ?? 0 });
      tdsTillLastMonth += s.deductions.find((x) => x.key === 'income_tax')?.amountPaise ?? 0;
      ptPaid += s.deductions.find((x) => x.key === 'pt')?.amountPaise ?? 0;
      pfPaid += s.epf?.employeePaise ?? 0;
      continue;
    }
    // Paid outside Sowaka: only before the first payslip here, and only once employed.
    if (!salaryFor || !ruleSet || p > firstRecorded) continue;
    const range = parsePeriod(p);
    const monthEnd = `${p}-${String(range.daysInMonth).padStart(2, '0')}`;
    if (joined && joined > monthEnd) continue;
    const employedFrom = joined && joined.slice(0, 7) === p && joined > `${p}-01` ? joined : undefined;
    const workingDays = await computeWorkingDays(org, range);
    const computed = computePayslip(salaryFor(p, employedFrom), {
      workingDays,
      lopDays: employedFrom ? Math.min(workingDays, Number(employedFrom.slice(8, 10)) - 1) : 0,
      overtimePaise: 0,
      reimbursementsPaise: 0,
      ruleSet,
      month: range.month,
      statutory: structure!.statutory,
      settings,
      period: p,
      employedFrom,
    });
    actual.push({ lines: [...computed.earnings.map((e) => ({ code: e.code, paise: e.paidPaise })), ...computed.reimbursementLines.map((l) => ({ code: l.code, paise: l.amountPaise }))], overtimePaise: 0 });
    ptPaid += computed.deductions.find((x) => x.key === 'pt')?.amountPaise ?? 0;
    pfPaid += computed.epf.employeePaise;
    estimatedPeriods.push(p);
  }
  // This month, as the payslip has it.
  actual.push({ lines: linesOf(slip), overtimePaise: slip.inputs?.overtimePaise ?? 0 });
  ptPaid += slip.deductions.find((x) => x.key === 'pt')?.amountPaise ?? 0;
  pfPaid += slip.epf?.employeePaise ?? 0;

  const projection: MonthEarnings[] = [];
  let ptProjected = 0;
  let pfProjected = 0;
  if (salaryFor) {
    for (const p of periodsAfter(period)) {
      const base = salaryFor(p);
      projection.push({
        lines: [...base.earnings.filter((l) => !l.oneTime), ...(base.reimbursements ?? [])].map((l) => ({ code: l.code, paise: l.monthlyPaise })),
        overtimePaise: 0,
      });
      ptProjected += base.statutory.pt.amountPaise;
      pfProjected += base.statutory.epf.employeePaise;
    }
  }

  // 1) Gross earnings per component, and 2) the exempt part.
  const rows = new Map<string, { name: string; actualPaise: number; projectionPaise: number }>();
  const exempt = new Map<string, number>();
  const nameOf = (code: string) => {
    const h = headByCode.get(code);
    return h?.payslipName || h?.name || slip.earnings.find((e) => e.code === code)?.name || code;
  };
  const tally = (months: MonthEarnings[], key: 'actualPaise' | 'projectionPaise') => {
    for (const m of months) {
      let meal = 0;
      for (const l of m.lines) {
        if (!l.paise) continue;
        const row = rows.get(l.code) ?? { name: nameOf(l.code), actualPaise: 0, projectionPaise: 0 };
        row[key] += l.paise;
        rows.set(l.code, row);
        const h = headByCode.get(l.code);
        if (h?.taxable === false) exempt.set(row.name, (exempt.get(row.name) ?? 0) + l.paise);
        else if (h?.componentType === 'meal_card') meal += l.paise;
      }
      if (meal > 0) {
        const name = nameOf(m.lines.find((l) => headByCode.get(l.code)?.componentType === 'meal_card')!.code);
        exempt.set(name, (exempt.get(name) ?? 0) + Math.min(meal, MEAL_CARD_EXEMPT_MONTHLY_PAISE));
      }
      if (m.overtimePaise > 0) {
        const row = rows.get('__overtime') ?? { name: 'Overtime', actualPaise: 0, projectionPaise: 0 };
        row[key] += m.overtimePaise;
        rows.set('__overtime', row);
      }
    }
  };
  tally(actual, 'actualPaise');
  tally(projection, 'projectionPaise');
  const earnings = [...rows.values()].map((r) => ({ ...r, totalPaise: r.actualPaise + r.projectionPaise }));
  const grossPaise = earnings.reduce((t, r) => t + r.totalPaise, 0);

  // Old regime: HRA exemption on rent paid.
  if (old && config.hraExemption && (d.rentPaidPaise ?? 0) > 0) {
    const sumType = (type: string) => earnings.filter((_, i) => headByCode.get([...rows.keys()][i])?.componentType === type).reduce((t, r) => t + r.totalPaise, 0);
    const basic = sumType('basic');
    const hra = sumType('hra');
    const hraExempt = Math.max(0, Math.min(hra, d.rentPaidPaise! - basic / 10, (basic * (d.metro ? 50 : 40)) / 100));
    if (hraExempt > 0) exempt.set('House Rent Allowance', (exempt.get('House Rent Allowance') ?? 0) + Math.round(hraExempt / 100) * 100);
  }
  // Salary reimbursements (Fuel, Internet…) paid so far: tax-free only as far as approved bills cover them.
  const reimbPaid = new Map<string, number>();
  for (const [code, row] of rows) if (headByCode.get(code)?.category === 'reimbursement' && headByCode.get(code)?.taxable !== false) reimbPaid.set(code, row.actualPaise);
  if (reimbPaid.size) {
    const until = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0, 23, 59, 59));
    const billed = await billsByComponent(await billCategories(org), [userId], period, until);
    for (const line of reimbursementTax(reimbPaid, billed.get(userId), headByCode).byCode) {
      if (line.exemptPaise > 0) exempt.set(`${nameOf(line.code)} (bills)`, line.exemptPaise);
    }
  }
  const exemptions = [...exempt.entries()].map(([name, paise]) => ({ name, paise }));
  const exemptPaise = exemptions.reduce((t, e) => t + e.paise, 0);
  const afterExemptionPaise = grossPaise - exemptPaise;

  const previousEmploymentPaise = d.previousEmployerSalaryPaise ?? 0;
  const grossTotalPaise = afterExemptionPaise + previousEmploymentPaise;
  const taxOnEmploymentPaise = old && config.ptDeductible ? ptPaid + ptProjected : 0;
  const standardDeductionPaise = Math.min(config.standardDeductionPaise, grossTotalPaise);
  const section19Paise = taxOnEmploymentPaise + standardDeductionPaise;
  const chargeablePaise = Math.max(0, grossTotalPaise - section19Paise);
  const otherIncomePaise = d.otherIncomePaise ?? 0;
  const grossTotalIncomePaise = chargeablePaise + otherIncomePaise;

  // 10) Chapter VIII: the old regime's deductions; the new regime allows none of these.
  const L = config.limits;
  const chapterVIII = old
    ? [
      { name: '80C (incl. employee PF)', qualifyingPaise: (d.sec80C ?? 0) + pfPaid + pfProjected, limit: L.sec80C },
      { name: '80CCD(1B) NPS', qualifyingPaise: d.sec80CCD1B ?? 0, limit: L.sec80CCD1B },
      { name: '80D Medical insurance (self)', qualifyingPaise: d.sec80DSelf ?? 0, limit: d.selfSenior ? L.sec80DSelfSenior : L.sec80DSelf },
      { name: '80D Medical insurance (parents)', qualifyingPaise: d.sec80DParents ?? 0, limit: d.parentsSenior ? L.sec80DParentsSenior : L.sec80DParents },
      { name: '80TTA Savings interest', qualifyingPaise: d.sec80TTA ?? 0, limit: L.sec80TTA },
      { name: '24(b) Home loan interest', qualifyingPaise: d.homeLoanInterest ?? 0, limit: L.sec24bHomeLoan },
    ].filter((r) => r.qualifyingPaise > 0).map((r) => ({ name: r.name, qualifyingPaise: r.qualifyingPaise, deductiblePaise: Math.min(r.qualifyingPaise, r.limit) }))
    : [];
  const chapterVIIIPaise = chapterVIII.reduce((t, r) => t + r.deductiblePaise, 0);
  const totalIncomePaise = roundToTenRupees(Math.max(0, grossTotalIncomePaise - chapterVIIIPaise));

  const tax = taxOnIncome(totalIncomePaise, config);
  const tdsThisMonthPaise = slip.deductions.find((x) => x.key === 'income_tax')?.amountPaise ?? 0;
  const previousEmployerTdsPaise = d.previousEmployerTdsPaise ?? 0;
  const tdsTotalPaise = tdsTillLastMonth + tdsThisMonthPaise + previousEmployerTdsPaise;
  const payablePaise = tax.annualTaxPaise - tdsTotalPaise;

  return {
    company,
    period,
    monthName: monthName(period),
    year: Number(period.slice(0, 4)),
    fy,
    regime,
    configStatus: config.status,
    employee: {
      name: employee?.name ?? slip.employeeName,
      employeeId: employee?.employeeId ?? slip.employeeId,
      designation: employee?.designation ?? slip.designation,
      pan: panOf(payment),
    },
    earnings,
    grossPaise,
    exemptions,
    exemptPaise,
    afterExemptionPaise,
    previousEmployment: { incomePaise: previousEmploymentPaise, professionalTaxPaise: 0 },
    grossTotalPaise,
    section19: { entertainmentPaise: 0, taxOnEmploymentPaise, standardDeductionPaise, totalPaise: section19Paise },
    chargeablePaise,
    otherIncomePaise,
    grossTotalIncomePaise,
    chapterVIII,
    chapterVIIIPaise,
    totalIncomePaise,
    tax: { ...tax, cessPercent: config.cessPercent, cessOnPaise: tax.taxAfterRebatePaise + tax.surchargePaise, relief157Paise: 0 },
    rebateRule: config.rebate,
    tds: {
      tillLastMonthPaise: tdsTillLastMonth,
      thisMonthPaise: tdsThisMonthPaise,
      previousEmployerPaise: previousEmployerTdsPaise,
      totalPaise: tdsTotalPaise,
      payablePaise,
      monthsAfter,
      perMonthNextPaise: monthsAfter > 0 ? Math.max(0, Math.round(payablePaise / monthsAfter / 100) * 100) : 0,
    },
    estimatedPeriods,
  };
}

function panOf(payment: { pan?: string; panLast4?: string } | null): string | undefined {
  if (payment?.pan && fieldKeyConfigured()) {
    try { return decryptField(payment.pan); } catch { /* key changed: fall back to the masked form */ }
  }
  return payment?.panLast4 ? `XXXXXX${payment.panLast4}` : undefined;
}
