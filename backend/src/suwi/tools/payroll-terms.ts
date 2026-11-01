// Payroll terms: a plain explanation and a worked example (content/
// payrollTerms.ts), plus this company's actual setting for the term, read
// from its statutory settings, salary components and templates, paid-days
// templates and claim types. Every rate Suwi quotes comes from here.
import { payHeads } from '../../config/db';
import { epfCeilingForPeriod } from '../../shared/payroll/statutory-config';
import { statutoryConfigForPeriod } from '../../services/payrollConfig.service';
import { CalculationBasis } from '../../models/payHead.model';
import { DEDUCTION_TRIGGER_LABELS } from '../../models/deduction.model';
import { getStatutoryOverview, statutorySettingsFor } from '../../services/statutorySettings.service';
import { listSalaryTemplates } from '../../services/salaryTemplate.service';
import { listPaidDaysTemplates } from '../../services/paidDaysTemplate.service';
import { listReimbursementTypes } from '../../services/reimbursement-type.service';
import { tdsConfigsFor } from '../../services/tds.service';
import { findPayrollTerm, PAYROLL_TERMS } from '../content/payrollTerms';
import { defineTools, rupees, str, SuwiContext, SuwiLink } from '../tools';
import { fyOfPeriod, monthLabel } from './payroll-common';

const pctOf = (r: number) => `${Math.round(r * 10000) / 100}%`;
const calcText = (c: CalculationBasis | undefined, names: Map<string, string>) => {
  if (!c) return 'not set';
  if (c.mode === 'percentage') return `${c.percent}% of ${c.base === 'ctc' ? 'CTC' : c.base === 'basic' ? 'Basic' : names.get(c.baseComponentCode ?? '') ?? c.baseComponentCode}`;
  if (c.mode === 'flat_per_month') return `${rupees(c.amountPaise ?? 0)} a month`;
  return c.amountPaise ? rupees(c.amountPaise) : 'an amount set per employee';
};

type Setting = { setting: Record<string, unknown>; links: SuwiLink[] };

/** Each component of a given type: its default calculation and how each template works it out. */
async function componentSetting(ctx: SuwiContext, match: (h: { componentType: string; code: string; fbp?: boolean }) => boolean) {
  const heads = await payHeads().find({ org: ctx.org }).toArray();
  const names = new Map(heads.map((h) => [h.code, h.name]));
  const mine = heads.filter((h) => match(h as never));
  const templates = await listSalaryTemplates(ctx.userId);
  return mine.map((h) => ({
    component: h.name, code: h.code, kind: h.category, default: calcText(h.calculation, names), ...(h.category === 'earning' ? { taxable: h.taxable !== false } : {}), active: h.active !== false,
    inTemplates: templates.filter((t) => t.components.some((c) => c.payHeadCode === h.code)).map((t) => ({ template: t.name, calculation: calcText(t.components.find((c) => c.payHeadCode === h.code)!.calculation, names) })),
  }));
}

async function companySetting(ctx: SuwiContext, key: string): Promise<Setting> {
  const period = ctx.today.slice(0, 7);
  const statLink = (label = 'Open Statutory Components'): SuwiLink => ({ label, view: 'statutorycomponents' });
  const s = await statutorySettingsFor(ctx.org);
  switch (key) {
    case 'lop': {
      const t = await listPaidDaysTemplates(ctx.userId);
      return {
        setting: {
          baseDays: 'Days in the month (28 to 31); weekly offs, holidays and approved leave are paid',
          halfDay: 'Half a day of loss of pay',
          paidDaysTemplates: t.map((x) => ({
            name: x.name, isDefault: x.isDefault, people: x.people,
            allDaysPaid: x.allDaysPaid,
            extraRules: x.deductionRules.filter((r) => r.active).map((r) => `Every ${r.every} ${DEDUCTION_TRIGGER_LABELS[r.trigger].toLowerCase()} → ${r.deductDays} day${r.deductDays === 1 ? '' : 's'}`),
            paidLeaveAllowancePerMonth: x.monthlyPaidLeaveDays,
          })),
        },
        links: [{ label: 'Open Paid Days Templates', view: 'paiddays' }],
      };
    }
    case 'ctc':
      return {
        setting: {
          employerPfInsideCtc: s.epf.enabled ? s.epf.includeEmployer : 'PF is off',
          edliInsideCtc: s.epf.includeEmployer && s.epf.includeEDLI, pfAdminInsideCtc: s.epf.includeEmployer && s.epf.includeAdmin,
          employerEsiInsideCtc: s.esi.enabled ? s.esi.includeEmployer : 'ESI is off',
          balancingComponent: (await listSalaryTemplates(ctx.userId)).map((t) => ({ template: t.name, balancing: t.balancingComponentCode ?? 'none' })),
        },
        links: [statLink(), { label: 'Open Salary Templates', view: 'templates' }],
      };
    case 'basic': case 'hra': case 'gratuity': case 'meal_card': {
      const type = key === 'meal_card' ? 'meal_card' : key;
      const extra = key === 'hra' ? { defaultTaxRegime: s.tds?.defaultRegime ?? 'new', note: 'The HRA exemption applies only under the old regime, from the rent on the person\'s tax declaration.' }
        : key === 'meal_card' ? { taxFreeUpToPerMonth: rupees((await statutoryConfigForPeriod(period)).mealCard.exemptMonthlyPaise) } : {};
      return { setting: { components: await componentSetting(ctx, (h) => h.componentType === type), ...extra }, links: [{ label: 'Open Salary Components', view: 'payheads' }, { label: 'Open Salary Templates', view: 'templates' }] };
    }
    case 'fbp':
      return { setting: { fbpComponents: await componentSetting(ctx, (h) => h.fbp === true), note: 'Components count in the flexible benefit pool when marked FBP on the salary component.' }, links: [{ label: 'Open Salary Components', view: 'payheads' }] };
    case 'pf': {
      const cfg = await statutoryConfigForPeriod(period);
      return {
        setting: {
          enabled: s.epf.enabled,
          employeeContribution: `${pctOf(cfg.epf.employeeRate)} of ${s.epf.employeeRate === 'restricted' ? 'the PF wage up to the ceiling' : 'the actual PF wage'}`,
          employerContribution: `${pctOf(cfg.epf.employerRate)} of ${s.epf.employerRate === 'restricted' ? 'the PF wage up to the ceiling' : 'the actual PF wage'}, of which ${pctOf(cfg.epf.epsRate)} to pension (EPS, always capped at the ceiling)`,
          ceilingNow: `${rupees(epfCeilingForPeriod(cfg, period))} for ${monthLabel(period)}`,
          employerShareInsideCtc: s.epf.includeEmployer, edliInsideCtc: s.epf.includeEDLI, adminChargesInsideCtc: s.epf.includeAdmin,
          personMayChooseActualWage: s.epf.overrideAtEmployee, ceilingProRatedForLop: s.epf.proRateRestricted,
          epfNumberRecorded: Boolean(s.epf.epfNumber),
        },
        links: [statLink()],
      };
    }
    case 'esi': {
      const cfg = await statutoryConfigForPeriod(period);
      return {
        setting: {
          enabled: s.esi.enabled, employee: pctOf(cfg.esi.employeeRate), employer: pctOf(cfg.esi.employerRate),
          wageCeiling: `${rupees(cfg.esi.grossCeilingPaise)} a month`, employerShareInsideCtc: s.esi.includeEmployer, esiNumberRecorded: Boolean(s.esi.esiNumber),
          contributionPeriods: 'April–September and October–March',
        },
        links: [statLink()],
      };
    }
    case 'pt': case 'lwf': {
      const o = await getStatutoryOverview(ctx.userId);
      if (key === 'pt') {
        return {
          setting: {
            byWorkLocation: o.pt.map((r) => ({
              location: r.location, state: r.state,
              slabs: r.pt?.slabs.length ? r.pt.slabs.map((sl) => `${sl.upToPaise === null ? 'above that' : `gross up to ${rupees(sl.upToPaise)}`}: ${rupees(sl.amountPaise)}${sl.monthOverride ? ` (${rupees(sl.monthOverride.amountPaise)} in month ${sl.monthOverride.month})` : ''}`) : 'no professional tax in this state',
            })),
          },
          links: [statLink()],
        };
      }
      return { setting: { byState: o.lwf.map((r) => ({ state: r.state, on: r.enabled, cycle: r.rule?.cycle ?? 'none', months: r.rule?.deductionMonths, employee: r.rule?.employee, employer: r.rule?.employer })) }, links: [statLink()] };
    }
    case 'tds': {
      const fy = fyOfPeriod(period);
      const cfg = await tdsConfigsFor(fy);
      return {
        setting: {
          tdsEngineOn: s.tds?.enabled === true, defaultRegime: s.tds?.defaultRegime ?? 'new',
          whenOff: 'Income tax is only what HR types on each run',
          fy,
          regimes: [...cfg.values()].map((c) => ({
            regime: c.regime, status: c.status, standardDeduction: rupees(c.standardDeductionPaise),
            slabs: c.slabs.map((sl, i) => `${sl.upToPaise === null ? `above ${rupees(c.slabs[i - 1]?.upToPaise ?? 0)}` : `${i === 0 ? '₹0' : rupees(c.slabs[i - 1].upToPaise ?? 0)} to ${rupees(sl.upToPaise)}`}: ${sl.ratePercent}%`),
            rebate: `Income up to ${rupees(c.rebate.incomeLimitPaise)}: tax rebate up to ${rupees(c.rebate.maxRebatePaise)}${c.rebate.marginalRelief ? ', with marginal relief just above' : ''}`,
            cess: `${c.cessPercent}%`,
            ...(c.regime === 'old' ? { limits: { '80C': rupees(c.limits.sec80C), '80CCD(1B)': rupees(c.limits.sec80CCD1B), '80D self': rupees(c.limits.sec80DSelf), '80D parents': rupees(c.limits.sec80DParents), 'home loan 24(b)': rupees(c.limits.sec24bHomeLoan) } } : {}),
          })),
          ...(cfg.size ? {} : { note: `No tax rates are set up for FY ${fy}.` }),
        },
        links: [statLink('Open Income Tax settings')],
      };
    }
    case 'bonus':
      return { setting: { enabled: s.bonus.enabled, frequency: s.bonus.frequency, rate: `${s.bonus.ratePercent}%`, minimumWageStates: Object.keys(s.bonus.minWages) }, links: [statLink()] };
    case 'reimbursement': {
      const types = await listReimbursementTypes(ctx.userId) as { name: string; maxLimit: number; backdateDays: number; payHeadCode?: string; active: boolean }[];
      return {
        setting: {
          claimTypes: types.map((t) => ({ name: t.name, active: t.active, capPerClaim: t.maxLimit ? `₹${t.maxLimit.toLocaleString('en-IN')}` : 'no cap', backdateDays: t.backdateDays, billsFor: t.payHeadCode ?? null })),
          salaryReimbursements: (await payHeads().find({ org: ctx.org, category: 'reimbursement' }).toArray()).map((h) => h.name),
        },
        links: [{ label: 'Open Reimbursement Types', view: 'reimbursementtypes' }, { label: 'Open Salary Components', view: 'payheads' }],
      };
    }
    case 'arrears':
      return {
        setting: {
          oneTimeComponents: (await payHeads().find({ org: ctx.org, $or: [{ recurrence: 'one_time' }, { componentType: { $in: ['salary_advance', 'hold_amount', 'notice_pay'] } }, { arrears: true }] } as never).toArray()).map((h) => ({ name: h.name, code: h.code, category: h.category })),
          how: 'Entered per person on the draft run (one-time amounts), paid or deducted on that month\'s payslip',
        },
        links: [{ label: 'Open payroll runs', view: 'payruns' }, { label: 'Open Salary Components', view: 'payheads' }],
      };
    case 'overtime':
      return {
        setting: {
          byTemplate: (await listSalaryTemplates(ctx.userId)).map((t) => ({
            template: t.name,
            rule: !t.overtimePay ? 'HR types the overtime amount on the run'
              : t.overtimePay.mode === 'flat_per_hour' ? `${rupees(t.overtimePay.flatPerHourPaise ?? 0)} an hour`
                : `${t.overtimePay.multiplier ?? 1}× the hourly rate from monthly ${t.overtimePay.base ?? 'basic'} (${t.overtimePay.hoursPerDay ?? 8}-hour day)`,
          })),
        },
        links: [{ label: 'Open Salary Templates', view: 'templates' }],
      };
    case 'form16':
      return { setting: { tracked: false, note: 'Sowaka does not generate Form 16 yet; each payslip has a TDS work sheet.' }, links: [{ label: 'Open payroll runs', view: 'payruns' }] };
    case 'fnf':
      return { setting: { separateRun: false, note: 'A leaver is paid through the regular run up to their last day; encashment and recoveries are one-time amounts on that run.' }, links: [{ label: 'Open payroll runs', view: 'payruns' }] };
    default:
      return { setting: {}, links: [] };
  }
}

defineTools({
  name: 'payroll_term',
  area: 'payroll',
  payroll: true,
  label: (i) => `What "${i.term ?? 'that'}" means here`,
  description: `Explain a payroll term in plain words with a worked example, and this company's actual setting for it (rates, ceilings, which components and templates, who it applies to) with a link to that settings page. Always use this for rates and rules: never state a rate from memory. Terms: ${PAYROLL_TERMS.map((t) => t.key).join(', ')} (and their usual names: CTC/gross/net, Basic, HRA, FBP, PF and the ceiling, ESI, PT, TDS and regimes, Form 16, gratuity, arrears, full and final, statutory bonus, LWF, reimbursements, meal card, overtime).`,
  input_schema: { type: 'object', properties: { term: { type: 'string', description: 'The term or the question, e.g. "PF ceiling", "what is LOP"' } }, required: ['term'] },
  api: { method: 'GET', path: '/admin/payroll/statutory-settings' },
  async run(ctx, i) {
    const term = findPayrollTerm(str(i.term));
    if (!term) return { data: { found: false, known: PAYROLL_TERMS.map((t) => t.title), note: 'Not a term I have an explanation for.' } };
    const { setting, links } = await companySetting(ctx, term.key);
    return {
      data: { found: true, term: term.title, explanation: term.explain, example: term.example, exampleNote: 'Round numbers for illustration; the company\'s own figures are under thisCompany.', thisCompany: setting },
      links,
    };
  },
});
