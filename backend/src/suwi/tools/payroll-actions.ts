// Payroll actions: a what-if on one person's pay (nothing saved), assigning a
// salary template and CTC as a prepared action with Undo, and running a month's
// payroll as a prepared action whose pre-flight says what is missing and what
// Submit locks. Every tool here needs payroll access; the executors call the
// same services the Salary details and Payroll Runs pages use.
import { employeePaymentDetails, leaves, payrollRuns, payslips, salaryStructures, salaryTemplates, users } from '../../config/db';
import { previewSalaryStructure, upsertSalaryStructure } from '../../services/salaryStructure.service';
import { createRun, recomputeRun, submitRun } from '../../services/payrollRun.service';
import { SalaryCalcResult } from '../../services/salary-calculator';
import { projectedTaxable } from '../../services/payroll-run.calculator';
import { declarationsFor, runTds, tdsConfigsFor, ytdFor } from '../../services/tds.service';
import { fyOf } from '../../shared/payroll/tds';
import { statutorySettingsFor } from '../../services/statutorySettings.service';
import { epfCeilingForPeriod, ESI_CONSTANTS } from '../../models/statutoryRule.model';
import { SalaryStructure } from '../../models/salaryStructure.model';
import { defineTools, monthOf, num, rupees, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { niceDate } from './team';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
export const nextPeriod = (period: string) => {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const toPaise = (rupeesIn: unknown) => (rupeesIn === undefined || rupeesIn === null || rupeesIn === '' ? undefined : Math.round(num(rupeesIn, NaN, 0) * 100));
/** A change in net pay this big against last month is flagged in the pre-flight. */
const JUMP_PCT = 20;
const signed = (paise: number) => `${paise < 0 ? "−" : "+"}${rupees(Math.abs(paise))}`;

/** The last day of the ESI contribution period (April–September or October–March) a month falls in, as YYYY-MM-DD. */
export function esiPeriodEnd(period: string): string {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
  return m >= 4 && m <= 9 ? `${y}-09-30` : `${m >= 10 ? y + 1 : y}-03-31`;
}

/** A computed structure as small plain lines Claude can read and compare. */
export function describeComputed(c: SalaryCalcResult) {
  const line = (l: SalaryCalcResult['earnings'][number]) => ({ code: l.code, name: l.payslipName, monthly: rupees(l.monthlyPaise), how: l.calcLabel });
  return {
    annualCtc: rupees(c.annualCtcPaise), monthlyCtc: rupees(c.monthlyCtcPaise),
    earnings: c.earnings.map(line), reimbursements: c.reimbursements.map(line), benefits: c.benefits.map(line), deductions: c.deductions.map(line),
    gross: rupees(c.grossMonthlyPaise), pfWage: rupees(c.pfWagePaise),
    pf: { employee: rupees(c.statutory.epf.employeePaise), employer: rupees(c.statutory.epf.employerTotalPaise) },
    esi: c.statutory.esi.applicable ? { employee: rupees(c.statutory.esi.employeePaise), employer: rupees(c.statutory.esi.employerPaise) } : 'not applicable',
    pt: rupees(c.statutory.pt.amountPaise),
    lwf: c.statutory.lwf.applicable ? rupees(c.statutory.lwf.employeePaise) : 'not applicable',
    netBeforeTax: rupees(c.netMonthlyPaise), employerCost: rupees(c.employerCostMonthlyPaise),
    overBudget: c.overBudget || undefined,
  };
}

/** The TDS the engine would take each month on this structure, when the org has TDS on and a config for the FY. */
export async function tdsProjection(org: string, userId: string, period: string, c: SalaryCalcResult): Promise<{ monthlyPaise: number; annualPaise: number; regime: string } | null> {
  const settings = await statutorySettingsFor(org);
  if (!settings.tds?.enabled) return null;
  const { fy } = fyOf(period);
  const configs = await tdsConfigsFor(fy);
  if (configs.size === 0) return null;
  const [ytd, decl] = await Promise.all([ytdFor(org, period, [userId]), declarationsFor(org, fy, [userId])]);
  const d = decl.get(userId);
  const taxable = projectedTaxable(c);
  const byType = (t: string) => c.earnings.filter((l) => l.componentType === t).reduce((s, l) => s + l.monthlyPaise, 0);
  const r = runTds({
    configs, regime: d?.regime ?? settings.tds.defaultRegime, period, ytd: ytd.get(userId),
    currentTaxablePaise: taxable, futureMonthlyTaxablePaise: taxable,
    basicMonthlyPaise: byType('basic'), hraMonthlyPaise: byType('hra'),
    employeePfMonthlyPaise: c.statutory.epf.employeePaise, ptMonthlyPaise: c.statutory.pt.amountPaise, declarations: d?.declarations,
  });
  return r ? { monthlyPaise: r.monthlyTdsPaise, annualPaise: r.annualTaxPaise, regime: r.regime } : null;
}

/** Plain-words reasons for the surprises in a breakup, for teaching mode. */
export function whyLines(c: SalaryCalcResult, period: string, before?: SalaryCalcResult): string[] {
  const out: string[] = [];
  const ceiling = epfCeilingForPeriod(period);
  const basic = c.earnings.filter((l) => l.componentType === 'basic').reduce((s, l) => s + l.monthlyPaise, 0);
  const epf = c.statutory.epf;
  if (epf.employeePaise > 0 && epf.contributionWagePaise < c.pfWagePaise) {
    out.push(`PF is worked out on ${rupees(epf.contributionWagePaise)}, not the full PF wage of ${rupees(c.pfWagePaise)}: the company applies the statutory ceiling of ${rupees(ceiling)} a month, so PF stops growing once the PF wage passes it.`);
  } else if (epf.employeePaise > 0 && before && before.statutory.epf.employeePaise === epf.employeePaise && basic !== before.earnings.filter((l) => l.componentType === 'basic').reduce((s, l) => s + l.monthlyPaise, 0)) {
    out.push(`PF did not change although Basic did: both are at or above the ${rupees(ceiling)} ceiling, so the contribution is the same either way.`);
  }
  if (epf.employeePaise === 0) out.push('No PF: either PF is off for this person, or the company has it off in Statutory Components.');
  const esiCeiling = ESI_CONSTANTS.grossCeilingPaise;
  if (c.statutory.esi.applicable) {
    out.push(`ESI applies because the ESI wage is at or under ${rupees(esiCeiling)} a month: 0.75% from the employee, 3.25% from the employer.`);
  } else if (before?.statutory.esi.applicable) {
    out.push(`ESI shows as stopping here, but in a real run it continues until ${niceDate(esiPeriodEnd(period))}, the end of the current contribution period (April–September or October–March): the law keeps a person covered for the half-year they crossed ${rupees(esiCeiling)} in.`);
  } else if (c.grossMonthlyPaise > esiCeiling && c.grossMonthlyPaise <= esiCeiling * 1.1) {
    out.push(`ESI does not apply: gross is just above ${rupees(esiCeiling)}. A cut that takes gross under it would bring ESI back.`);
  }
  if (c.statutory.pt.amountPaise > 0) out.push(`Professional tax of ${rupees(c.statutory.pt.amountPaise)} follows the slab of the person's work state; it changes only when gross crosses a slab edge.`);
  if (c.overBudget) out.push('The CTC is too small for the fixed components: the balancing component would go negative, so it is shown as zero and gross exceeds CTC.');
  const bonus = c.earnings.find((l) => l.componentType === 'statutory_bonus');
  if (bonus && bonus.monthlyPaise === 0) out.push(`Statutory Bonus is zero because Basic is above ${rupees(21_000_00)} a month, the Bonus Act's limit.`);
  if (c.includedInCtcPaise > 0) out.push(`${rupees(c.includedInCtcPaise)} of employer PF/ESI sits inside the CTC, so the balancing component is smaller by that much.`);
  return out;
}

async function structureOf(org: string, userId: string) {
  return salaryStructures().findOne({ org, userId });
}

async function person(ctx: SuwiContext, userId: string) {
  const p = await users().findOne({ org: ctx.org, userId }, { projection: { _id: 0, userId: 1, name: 1 } });
  if (!p) throw new Error('That person is not in this company');
  return p;
}

async function templateByCodeOrName(org: string, given: string) {
  const all = await salaryTemplates().find({ org }).toArray();
  const n = given.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return all.find((t) => t.code.toLowerCase() === given.toLowerCase().trim()) ?? all.find((t) => t.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === n) ?? all.filter((t) => t.name.toLowerCase().includes(n)).sort((a, b) => a.name.length - b.name.length)[0];
}

/** The template and CTC edits as previewSalaryStructure takes them. */
function editsFrom(i: Record<string, unknown>, existing: SalaryStructure | null) {
  const input: Record<string, unknown> = {};
  if (i.templateCode) input.salaryTemplateCode = String(i.templateCode).trim().toUpperCase();
  const ctc = toPaise(i.annualCtcRupees);
  if (ctc !== undefined) input.annualCtcPaise = ctc;
  const basicPct = i.basicPercentOfCtc === undefined ? undefined : num(i.basicPercentOfCtc, NaN, 1, 100);
  if (basicPct !== undefined && Number.isFinite(basicPct)) {
    input.overrides = { ...(existing?.overrides ?? {}), edit: { ...(existing?.overrides?.edit ?? {}), BASIC: { mode: 'percentage', percent: basicPct, base: 'ctc' } } };
  }
  return input;
}

defineTools(
  {
    name: 'simulate_pay',
    area: 'payroll',
    payroll: true,
    label: (i) => `What-if on pay${i.annualCtcRupees ? ` at ₹${Number(i.annualCtcRupees).toLocaleString('en-IN')}` : ''}`,
    description: 'What-if simulator: runs the salary calculation for one person with edited inputs (annual CTC in rupees, salary template code, Basic as a percent of CTC) WITHOUT saving anything, and returns before and after: components, PF, ESI, PT, projected TDS, net, with a plain-words reason for each surprise. Use salary_templates for template codes. Find userIds with search_people.',
    input_schema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        annualCtcRupees: { type: 'number', description: 'New annual CTC in rupees (not paise)' },
        templateCode: { type: 'string', description: 'Salary template code to try' },
        basicPercentOfCtc: { type: 'number', description: 'Try Basic at this percent of CTC' },
      },
      required: ['userId'],
    },
    api: { method: 'POST', path: '/admin/payroll/salary-structures/x/preview' },
    async run(ctx, i) {
      const userId = str(i.userId);
      const who = await person(ctx, userId);
      const existing = await structureOf(ctx.org, userId);
      const edits = editsFrom(i, existing);
      if (!Object.keys(edits).length) throw new Error('Give something to change: annualCtcRupees, templateCode or basicPercentOfCtc');
      if (edits.salaryTemplateCode) {
        const t = await templateByCodeOrName(ctx.org, String(edits.salaryTemplateCode));
        if (!t) throw new Error(`No salary template "${i.templateCode}"`);
        edits.salaryTemplateCode = t.code;
      }
      if (!existing?.salaryTemplateCode && !edits.salaryTemplateCode) throw new Error(`${who.name} has no salary template yet: give a templateCode to simulate`);
      const period = ctx.today.slice(0, 7);
      const before = existing?.salaryTemplateCode ? (await previewSalaryStructure(ctx.userId, userId, {})).computed : null;
      const after = (await previewSalaryStructure(ctx.userId, userId, edits)).computed;
      const [tdsBefore, tdsAfter] = await Promise.all([before ? tdsProjection(ctx.org, userId, period, before) : null, tdsProjection(ctx.org, userId, period, after)]);
      const net = (c: SalaryCalcResult, t: { monthlyPaise: number } | null) => c.netMonthlyPaise - (t?.monthlyPaise ?? 0);
      return {
        data: {
          person: who.name, userId, simulated: true, nothingSaved: true,
          changes: { template: edits.salaryTemplateCode ?? existing?.salaryTemplateCode, annualCtc: rupees(Number(edits.annualCtcPaise ?? existing?.annualCtcPaise ?? 0)), basicPercentOfCtc: i.basicPercentOfCtc ?? undefined },
          before: before ? { ...describeComputed(before), tds: tdsBefore ? { monthly: rupees(tdsBefore.monthlyPaise), regime: tdsBefore.regime } : 'not projected', netAfterTax: rupees(net(before, tdsBefore)) } : 'no structure yet',
          after: { ...describeComputed(after), tds: tdsAfter ? { monthly: rupees(tdsAfter.monthlyPaise), regime: tdsAfter.regime } : 'not projected', netAfterTax: rupees(net(after, tdsAfter)) },
          netChange: before ? signed(net(after, tdsAfter) - net(before, tdsBefore)) : undefined,
          why: whyLines(after, period, before ?? undefined),
          note: 'A simulation for a full month at today\'s statutory rules; a real run also applies loss of pay, overtime, claims and the ESI contribution period.',
        },
        links: [{ label: `Open ${who.name.split(' ')[0]}'s salary`, view: 'salarydetails', userId }],
      };
    },
  },
  {
    name: 'prepare_assign_salary_template',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: (i) => `Prepared: salary template ${i.templateCode ?? ''}${i.annualCtcRupees ? ` at ₹${Number(i.annualCtcRupees).toLocaleString('en-IN')}` : ''}`,
    description: 'Prepare assigning a salary template (and optionally a new annual CTC in rupees) to one person from a date. Changes nothing: it creates a "What will happen" card with the CTC split, this month\'s and next month\'s net, the TDS change, and refuses a month whose payroll is already submitted. HR confirms on the card; Undo restores the previous structure.',
    input_schema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        templateCode: { type: 'string', description: 'Salary template code or name' },
        annualCtcRupees: { type: 'number', description: 'Annual CTC in rupees; omit to keep the current CTC' },
        effectiveFrom: { type: 'string', description: 'YYYY-MM-DD; default the 1st of next month' },
      },
      required: ['userId', 'templateCode'],
    },
    api: { method: 'PUT', path: '/admin/payroll/salary-structures/x' },
    async run(ctx, i) {
      const userId = str(i.userId);
      const who = await person(ctx, userId);
      const tpl = await templateByCodeOrName(ctx.org, str(i.templateCode));
      if (!tpl) throw new Error(`No salary template "${str(i.templateCode)}"`);
      if (!tpl.active) throw new Error(`${tpl.name} is inactive; make it active on Salary Templates first`);
      const existing = await structureOf(ctx.org, userId);
      const ctcPaise = toPaise(i.annualCtcRupees) ?? existing?.annualCtcPaise;
      if (!ctcPaise) throw new Error(`${who.name} has no CTC yet: give annualCtcRupees`);
      const from = typeof i.effectiveFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.effectiveFrom) ? i.effectiveFrom : `${nextPeriod(ctx.today.slice(0, 7))}-01`;
      const period = from.slice(0, 7);
      // A month that is already submitted was paid on the old structure; a change must land on an open month.
      const run = await payrollRuns().findOne({ org: ctx.org, period });
      if (run && run.status === 'paid') throw new Error(`${monthName(period)}'s payroll is already submitted. Choose ${monthName(nextPeriod(period))} or later; a submitted month is never worked out again.`);
      const sameTemplate = existing?.salaryTemplateCode === tpl.code;
      const sameCtc = existing?.annualCtcPaise === ctcPaise;
      if (sameTemplate && sameCtc) return { data: { nothingToDo: true, message: `${who.name} is already on ${tpl.name} at ${rupees(ctcPaise)} a year.` } };
      const before = existing?.salaryTemplateCode ? (await previewSalaryStructure(ctx.userId, userId, {})).computed : null;
      const after = (await previewSalaryStructure(ctx.userId, userId, { salaryTemplateCode: tpl.code, annualCtcPaise: ctcPaise })).computed;
      const [tdsBefore, tdsAfter] = await Promise.all([before ? tdsProjection(ctx.org, userId, period, before) : null, tdsProjection(ctx.org, userId, period, after)]);
      const thisMonth = ctx.today.slice(0, 7);
      const thisRun = period === thisMonth ? run : await payrollRuns().findOne({ org: ctx.org, period: thisMonth }, { projection: { status: 1 } });
      const split = after.earnings.filter((l) => l.monthlyPaise > 0).map((l) => `${l.payslipName} ${rupees(l.monthlyPaise)}`).join(', ');
      // Someone covered by ESI now stays covered to the end of the contribution period, even when the new pay is over the limit.
      const esiEnd = esiPeriodEnd(thisMonth);
      const esiContinues = Boolean(before?.statutory.esi.applicable) && !after.statutory.esi.applicable && esiPeriodEnd(period) === esiEnd;
      const lwf = after.statutory.lwf.applicable && after.statutory.lwf.employeePaise > 0 ? `, LWF ${rupees(after.statutory.lwf.employeePaise)}` : '';
      const fromNice = niceDate(from);
      const oldTemplate = existing?.salaryTemplateCode ? (await salaryTemplates().findOne({ org: ctx.org, code: existing.salaryTemplateCode }, { projection: { name: 1 } }))?.name ?? existing.salaryTemplateCode : null;
      const tdsLine = tdsAfter
        ? `Income tax (TDS) ${tdsBefore ? `${rupees(tdsBefore.monthlyPaise)} → ` : ''}${rupees(tdsAfter.monthlyPaise)} a month under the ${tdsAfter.regime} regime.`
        : 'TDS is not projected (the company has the TDS engine off or no tax config for this year).';
      const lines: { text: string; why?: string; tone?: 'info' | 'warn' }[] = [
        { text: `Monthly CTC ${rupees(after.monthlyCtcPaise)}: ${split}.`, why: `Each component follows ${tpl.name}'s rule (${after.earnings.map((l) => `${l.payslipName}: ${l.calcLabel}`).join('; ')}).` },
        { text: `Deductions: PF ${rupees(after.statutory.epf.employeePaise)}, ESI ${after.statutory.esi.applicable ? rupees(after.statutory.esi.employeePaise) : esiContinues ? `continues until ${niceDate(esiEnd)}` : 'none'}, PT ${rupees(after.statutory.pt.amountPaise)}${lwf}.`, why: whyLines(after, period, before ?? undefined).join(' ') || undefined },
        ...(esiContinues ? [{ text: `ESI is still deducted until ${niceDate(esiEnd)}: ${who.name.split(' ')[0]} is covered now, and coverage lasts to the end of the contribution period even though the new gross is over ${rupees(ESI_CONSTANTS.grossCeilingPaise)}. The net below leaves it out, so take-home is lower by the ESI until then.`, tone: 'warn' as const }] : []),
        { text: `Net before tax ${before ? `${rupees(before.netMonthlyPaise)} → ` : ''}${rupees(after.netMonthlyPaise)} a month for a full month.` },
        { text: tdsLine, why: 'The engine spreads the year\'s projected tax over the months left in the financial year, so a mid-year change moves every remaining month.' },
        period === thisMonth
          ? { text: `${monthName(thisMonth)}: ${thisRun ? (thisRun.status === 'draft' ? 'the draft run is recalculated on the new structure when HR next calculates it' : 'the run is not a draft, so the change reaches the next run') : 'no run yet; it is worked out on the new structure'}; ${monthName(nextPeriod(thisMonth))} and after follow the new structure.`, tone: 'info' }
          : { text: `${monthName(thisMonth)}${thisRun?.status === 'paid' ? ' is already paid and' : ''} stays on the current structure; ${monthName(period)} onward follows the new one.`, tone: 'info' },
        ...(existing ? [{ text: `Now: ${oldTemplate ?? 'no template'} at ${rupees(existing.annualCtcPaise)} a year → ${tpl.name} at ${rupees(ctcPaise)} a year from ${fromNice}${sameCtc ? '' : ', recorded as a revision in the salary history'}.` }] : [{ text: 'This is the first salary structure for this person; it is saved as active.' }]),
        { text: `Their payslip from ${monthName(period)} shows the new structure.`, tone: 'info' },
        ...(after.overBudget ? [{ text: 'The CTC is too small for this template\'s fixed components; the balancing component would go negative.', tone: 'warn' as const }] : []),
      ];
      const proposalId = await propose(ctx, {
        kind: 'assign_salary_template', area: 'payroll', title: `${who.name}: ${tpl.name}${sameCtc ? '' : ` at ${rupees(ctcPaise)}`} from ${fromNice}`,
        summary: `${who.name} moves to ${tpl.name}${sameCtc ? '' : ` with an annual CTC of ${rupees(ctcPaise)}`} from ${fromNice}. Net before tax ${rupees(after.netMonthlyPaise)} a month.`,
        lines, effectiveFrom: from, undoable: true,
        payload: { userId, name: who.name, byUserId: ctx.userId, templateCode: tpl.code, templateName: tpl.name, annualCtcPaise: ctcPaise, effectiveFrom: from, previous: existing ? { ...existing, _id: undefined } : null },
      });
      return {
        data: { prepared: true, title: `${who.name} to ${tpl.name} from ${fromNice}`, after: describeComputed(after), tds: tdsAfter ? rupees(tdsAfter.monthlyPaise) : null, note: 'Nothing is saved until HR presses Confirm on the card.' },
        proposalId,
        links: [{ label: `Open ${who.name.split(' ')[0]}'s salary`, view: 'salarydetails', userId }],
      };
    },
  },
  {
    name: 'prepare_payroll_run',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: (i) => `Prepared: run payroll for ${i.period ?? 'this month'}`,
    description: 'Prepare running payroll for a month (YYYY-MM): a pre-flight of what is missing (salary template, bank account, PAN, attendance still to come, pay that jumps against last month) and what Submit locks. Changes nothing until HR types the month and confirms; then the run is calculated (or the draft recalculated) and submitted through the Payroll Runs flow. Submit is final: there is no Undo.',
    input_schema: { type: 'object', properties: { period: { type: 'string', description: 'YYYY-MM' } } },
    api: { method: 'POST', path: '/admin/payroll/runs' },
    async run(ctx, i) {
      const period = monthOf(i.period, ctx.today);
      const name = monthName(period);
      const run = await payrollRuns().findOne({ org: ctx.org, period });
      if (run && run.status === 'paid') return { data: { alreadySubmitted: true, message: `${name}'s payroll was submitted on ${run.paidAt?.toISOString().slice(0, 10) ?? '?'} for ${run.employeeCount} people.` }, links: [{ label: 'Open payroll runs', view: 'payruns' }] };
      if (run && run.status !== 'draft' && run.status !== 'rejected') return { data: { message: `${name}'s run is ${run.status.replace('_', ' ')}; finish it on Payroll Runs.` }, links: [{ label: 'Open payroll runs', view: 'payruns' }] };
      const structures = await salaryStructures().find({ org: ctx.org }).toArray();
      const active = structures.filter((s) => s.status === 'active' && s.salaryTemplateCode);
      const roster = await users().find({ org: ctx.org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never, { projection: { _id: 0, userId: 1, name: 1, joiningDate: 1 } }).toArray();
      const nameOf = new Map(roster.map((p) => [p.userId, p.name]));
      const covered = new Set(active.map((s) => s.userId));
      const monthEnd = `${period}-31`;
      const noStructure = roster.filter((p) => !covered.has(p.userId) && (!p.joiningDate || p.joiningDate.toISOString().slice(0, 10) <= monthEnd));
      const details = await employeePaymentDetails().find({ org: ctx.org, userId: { $in: [...covered] } } as never).toArray();
      const byUser = new Map(details.map((d) => [d.userId, d]));
      const noBank = [...covered].filter((u) => !byUser.get(u)?.accountNumber).map((u) => nameOf.get(u) ?? u);
      const noPan = [...covered].filter((u) => !byUser.get(u)?.pan).map((u) => nameOf.get(u) ?? u);
      // Attendance: days of the month still to come, and leave not yet decided.
      const daysLeft = period === ctx.today.slice(0, 7) ? Number(new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate()) - Number(ctx.today.slice(8, 10)) : period > ctx.today.slice(0, 7) ? 31 : 0;
      const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
      const pendingLeave = await leaves().countDocuments({ org: ctx.org, status: 'pending', startDate: { $lte: new Date(Date.UTC(y, m, 0, 23, 59, 59)) }, endDate: { $gte: new Date(Date.UTC(y, m - 1, 1)) } } as never).catch(() => 0);
      // Big jumps: this month's draft (if calculated) or the structure's full-month net, against last month's payslip.
      const lastRun = await payrollRuns().findOne({ org: ctx.org, period: { $lt: period }, status: { $ne: 'rejected' } } as never, { sort: { period: -1 } });
      const lastSlips = lastRun ? await payslips().find({ org: ctx.org, runId: lastRun._id!.toHexString() }, { projection: { userId: 1, netPaise: 1, grossPaise: 1 } }).toArray() : [];
      const lastNet = new Map(lastSlips.map((s) => [s.userId, s.netPaise]));
      const draftSlips = run?.status === 'draft' ? await payslips().find({ org: ctx.org, runId: run._id!.toHexString() }, { projection: { userId: 1, netPaise: 1 } }).toArray() : [];
      const thisNet = new Map<string, number>(draftSlips.map((s) => [s.userId, s.netPaise]));
      if (!draftSlips.length) {
        for (const s of active) {
          try { thisNet.set(s.userId, (await previewSalaryStructure(ctx.userId, s.userId, {})).computed.netMonthlyPaise); } catch { /* a structure that no longer computes is caught by the run itself */ }
        }
      }
      const jumps: { name: string; last: string; now: string; change: string }[] = [];
      for (const [u, now] of thisNet) {
        const last = lastNet.get(u);
        if (last === undefined || last === 0) continue;
        const pct = ((now - last) / last) * 100;
        if (Math.abs(pct) >= JUMP_PCT) jumps.push({ name: nameOf.get(u) ?? u, last: rupees(last), now: rupees(now), change: `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%` });
      }
      const newPeople = [...covered].filter((u) => lastRun && !lastNet.has(u)).map((u) => nameOf.get(u) ?? u);
      const blocked = active.length === 0;
      const list = (xs: string[]) => `${xs.slice(0, 6).join(', ')}${xs.length > 6 ? ` and ${xs.length - 6} more` : ''}`;
      const lines: { text: string; why?: string; tone?: 'info' | 'warn' }[] = [
        { text: `${active.length} ${active.length === 1 ? 'person' : 'people'} with an active salary structure ${run?.status === 'draft' ? 'are recalculated on the draft, then it is submitted' : 'get a payslip; the run is calculated, then submitted'}.`, why: 'A run pays only people whose salary structure is active and has a template; everyone else is skipped, not paid late.' },
        ...(noStructure.length ? [{ text: `${noStructure.length} on the roll have no salary structure and will not be paid: ${list(noStructure.map((p) => p.name))}.`, tone: 'warn' as const, why: 'Set a template and CTC on their Salary details before the run, or they get no payslip this month.' }] : []),
        ...(noBank.length ? [{ text: `${noBank.length} without a bank account: ${list(noBank)}.`, tone: 'warn' as const, why: 'The run still calculates their pay, but the bank payment file will have no account for them.' }] : []),
        ...(noPan.length ? [{ text: `${noPan.length} without a PAN: ${list(noPan)}.`, tone: 'warn' as const, why: 'TDS is still deducted; without a PAN the quarterly return cannot credit it to them, and the law asks for 20% TDS.' }] : []),
        ...(daysLeft > 0 ? [{ text: `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} of ${name} ${daysLeft === 31 ? 'have not started' : 'are still to come'}: loss of pay is counted from attendance as it stands now.`, tone: 'warn' as const, why: 'Payroll reads the month\'s graded days when it is calculated. Days after today count as paid; an absence later in the month would need a correction next month.' }] : []),
        ...(pendingLeave ? [{ text: `${pendingLeave} leave ${pendingLeave === 1 ? 'request' : 'requests'} for ${name} still pending.`, tone: 'warn' as const, why: 'A leave approved after the run does not change the paid days already locked.' }] : []),
        ...(jumps.length ? [{ text: `Pay jumps against ${lastRun ? monthName(lastRun.period) : 'last month'}: ${jumps.slice(0, 5).map((j) => `${j.name} ${j.last} → ${j.now} (${j.change})`).join('; ')}.`, tone: 'warn' as const, why: `A move of ${JUMP_PCT}% or more usually means a CTC change, a template change, loss of pay or a one-time amount. Check them on the run before submitting.` }] : []),
        ...(newPeople.length ? [{ text: `New since last run: ${list(newPeople)}.`, tone: 'info' as const }] : []),
        { text: 'Submit is final: payslips reach employees in the app, the month\'s attendance days are locked, and reimbursement claims on the run are marked paid.', why: 'Sowaka has no second approval step. If something is wrong afterwards, Payroll Runs › Reopen puts the month back to draft, but only while no later month has been submitted; this card has no Undo.' },
      ];
      if (blocked) lines.unshift({ text: 'Nothing to run: no one has an active salary structure.', tone: 'warn' });
      const proposalId = blocked ? undefined : await propose(ctx, {
        kind: 'run_payroll', area: 'payroll', title: `Run and submit payroll for ${name}`,
        summary: `Calculate ${name}'s payroll for ${active.length} ${active.length === 1 ? 'person' : 'people'} and submit it. Submit is final; type ${name.split(' ')[0].toUpperCase()} to confirm.`,
        lines, effectiveFrom: `${period}-01`, undoable: false, typeToConfirm: name.split(' ')[0].toUpperCase(),
        payload: { period, byUserId: ctx.userId, existingRunId: run?._id?.toHexString() ?? null },
      });
      return {
        data: {
          period, prepared: Boolean(proposalId), people: active.length, draftExists: run?.status === 'draft',
          preflight: { noSalaryStructure: { count: noStructure.length, names: noStructure.slice(0, 12).map((p) => p.name) }, noBankAccount: noBank, noPan, daysOfMonthLeft: daysLeft, pendingLeaveRequests: pendingLeave, bigJumps: { threshold: `net pay up or down ${JUMP_PCT}% or more against last month`, people: jumps }, newSinceLastRun: newPeople },
          lastRun: lastRun ? { period: lastRun.period, status: lastRun.status, people: lastRun.employeeCount, net: rupees(lastRun.totals.netPaise) } : null,
          note: blocked ? 'No card: nothing to run.' : `Nothing happens until HR types ${name.split(' ')[0].toUpperCase()} and confirms on the card. Submit is final.`,
        },
        proposalId,
        links: [{ label: 'Open payroll runs', view: 'payruns' }],
      };
    },
  },
);

defineExecutor('assign_salary_template', {
  async run(p) {
    const { userId, name, byUserId, templateCode, templateName, annualCtcPaise, effectiveFrom } = p.payload as { userId: string; name: string; byUserId: string; templateCode: string; templateName: string; annualCtcPaise: number; effectiveFrom: string };
    // The same call as the Salary details page's Save; a submitted month is checked again at confirm time.
    const run = await payrollRuns().findOne({ org: p.org, period: effectiveFrom.slice(0, 7) }, { projection: { status: 1 } });
    if (run?.status === 'paid') throw new Error(`${monthName(effectiveFrom.slice(0, 7))}'s payroll was submitted since this was prepared; ask Suwi again with a later month.`);
    const r = await upsertSalaryStructure(byUserId, userId, { salaryTemplateCode: templateCode, annualCtcPaise, effectiveFrom, status: 'active' });
    return { message: `${name} is on ${templateName} at ${rupees(annualCtcPaise)} a year from ${effectiveFrom}; net before tax ${rupees(r.computed.netMonthlyPaise)} a month.` };
  },
  async undo(p) {
    const { userId, name, byUserId, previous } = p.payload as { userId: string; name: string; byUserId: string; previous: (SalaryStructure & { _id?: unknown }) | null };
    if (!previous?.salaryTemplateCode) throw new Error(`${name} had no salary structure before; remove the new one on their Salary details if it should not exist.`);
    await upsertSalaryStructure(byUserId, userId, {
      salaryTemplateCode: previous.salaryTemplateCode, annualCtcPaise: previous.annualCtcPaise, componentValues: previous.componentValues ?? {},
      overrides: previous.overrides ?? {}, ...(typeof previous.bonusCategory === 'string' ? { bonusCategory: previous.bonusCategory } : {}), status: previous.status ?? 'active',
    });
    // The service records every CTC change as a revision and fills empty fields; put them back exactly as they were.
    await salaryStructures().updateOne({ org: p.org, userId }, { $set: {
      revisions: previous.revisions ?? [], effectiveFrom: previous.effectiveFrom ?? null, componentValues: previous.componentValues ?? null, bonusCategory: previous.bonusCategory ?? null,
    } as never });
    return `${name} is back on ${previous.salaryTemplateCode} at ${rupees(previous.annualCtcPaise)} a year, with the earlier salary history.`;
  },
});

defineExecutor('run_payroll', {
  async run(p) {
    const { period, byUserId, existingRunId } = p.payload as { period: string; byUserId: string; existingRunId: string | null };
    // The Payroll Runs page's buttons, in order: calculate (or recalculate the draft), then Submit.
    const current = await payrollRuns().findOne({ org: p.org, period });
    if (current?.status === 'paid') throw new Error(`${monthName(period)} was already submitted.`);
    let runId: string;
    if (current && current.status === 'draft') {
      runId = current._id!.toHexString();
      await recomputeRun(byUserId, runId, {});
    } else if (current && current.status !== 'rejected') {
      throw new Error(`${monthName(period)}'s run is ${current.status.replace('_', ' ')}; finish it on Payroll Runs.`);
    } else {
      void existingRunId;
      runId = (await createRun(byUserId, { period })).run.id;
    }
    const run = await submitRun(byUserId, runId);
    return { message: `${monthName(period)} submitted for ${run.employeeCount} people: net pay ${rupees(run.totals.netPaise)}, employer cost ${rupees(run.totals.employerCostPaise)}. Payslips are now in the app.` };
  },
});
