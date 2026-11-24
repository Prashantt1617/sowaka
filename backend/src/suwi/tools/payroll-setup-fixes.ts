// Payroll set-up fixes from Suwi (24 Nov, Suwi training: payroll):
//  - CTCs typed as a month instead of a year: who looks that way (the line the Salary Templates
//    people editor warns under), and a prepared ×12 through the salary structure service, with Undo.
//  - The pay cycle (payroll_periods) and pay schedule (Setup › Pay Schedule): read both; change the
//    pay day / first pay period through the page's own service, with Undo. The cycle's start day
//    has no dashboard setting (Sowaka sets it in the database), so Suwi says so instead of writing it.
//  - Claim types (Setup › Reimbursement Types): read them; add or change one (name, limit per claim,
//    backdating window, on/off) through the page's own service, with Undo.
import { companies, payrollPeriods, payrollRuns, salaryStructures, salaryTemplates, users } from '../../config/db';
import { DEFAULT_PAYROLL_PERIOD } from '../../models/payrollPeriod.model';
import { PaySchedule } from '../../models/company.model';
import { SalaryStructure } from '../../models/salaryStructure.model';
import { previewSalaryStructure, upsertSalaryStructure } from '../../services/salaryStructure.service';
import { getOrgSetup, updateOrgSetup } from '../../services/orgSetup.service';
import { payrollPeriodRange } from '../../services/payroll-inputs.service';
import { createReimbursementType, deleteReimbursementType, listReimbursementTypes, updateReimbursementType } from '../../services/reimbursement-type.service';
import { defineTools, num, rupees, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { findPerson, norm } from './people';
import { addMonths, isPeriod, monthLabel } from './payroll-common';

type Line = { text: string; why?: string; tone?: 'info' | 'warn' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const GONE = ['offboarded', 'terminated'];
/** The Salary Templates people editor's warning line: under ₹1.2 lakh a year looks like a monthly amount. */
export const LOOKS_MONTHLY_PAISE = 12_000_000;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

// ———————————————————————————————————————————— CTCs that look monthly

async function looksMonthly(ctx: SuwiContext) {
  const rows = await salaryStructures().find({ org: ctx.org, annualCtcPaise: { $gt: 0, $lt: LOOKS_MONTHLY_PAISE } }, { projection: { _id: 0, userId: 1, annualCtcPaise: 1, salaryTemplateCode: 1, status: 1, effectiveFrom: 1 } }).toArray();
  if (!rows.length) return [];
  const people = await users().find({ org: ctx.org, userId: { $in: rows.map((r) => r.userId) }, lifecycleStatus: { $nin: GONE } } as never, { projection: { _id: 0, userId: 1, name: 1, employeeId: 1, employeeType: 1 } }).toArray();
  const by = new Map(people.map((p) => [p.userId, p]));
  const templates = new Map((await salaryTemplates().find({ org: ctx.org }, { projection: { _id: 0, code: 1, name: 1 } }).toArray()).map((t) => [t.code, t.name]));
  return rows.filter((r) => by.has(r.userId)).map((r) => ({
    userId: r.userId, name: by.get(r.userId)!.name, employeeId: by.get(r.userId)!.employeeId ?? null, employeeType: by.get(r.userId)!.employeeType ?? null,
    template: r.salaryTemplateCode ? templates.get(r.salaryTemplateCode) ?? r.salaryTemplateCode : null, status: r.status,
    annualCtcPaise: r.annualCtcPaise, effectiveFrom: r.effectiveFrom ? new Date(r.effectiveFrom).toISOString().slice(0, 10) : null,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

// ———————————————————————————————————————————— claim types

type ClaimType = Awaited<ReturnType<typeof listReimbursementTypes>>[number];
const limitText = (t: Pick<ClaimType, 'maxLimit'>) => (t.maxLimit > 0 ? `${rupees(Math.round(t.maxLimit * 100))} a claim` : 'no limit');
const typeText = (t: ClaimType) => `${t.name}: ${limitText(t)}, back-dated up to ${t.backdateDays} day${t.backdateDays === 1 ? '' : 's'}${t.active ? '' : ', switched off'}`;
/** The fields the service's update takes, all of them (a missing one would be reset to its default). */
const typeFields = (t: ClaimType) => ({ name: t.name, description: t.description, maxLimit: t.maxLimit, backdateDays: t.backdateDays, active: t.active });

function typeByName(types: ClaimType[], given: string): ClaimType | undefined {
  const n = norm(given);
  return types.find((t) => norm(t.name) === n) ?? (types.filter((t) => norm(t.name).includes(n) || n.includes(norm(t.name))).length === 1 ? types.find((t) => norm(t.name).includes(n) || n.includes(norm(t.name))) : undefined);
}

defineTools(
  {
    name: 'ctc_looks_monthly',
    area: 'payroll',
    payroll: true,
    label: () => 'CTCs that look like monthly amounts',
    description: `People (still here) whose annual CTC is under ${rupees(LOOKS_MONTHLY_PAISE)} a year, the line under which the Salary Templates people editor warns that a yearly CTC looks like a MONTHLY amount was typed (₹40,000 entered as the year's CTC is ₹3,333 a month). Each with the CTC as saved, what it means a month, and what it would be ×12. Use for 'any CTCs entered as monthly', 'check for CTC typos'. Some may be genuinely low (interns, stipends): ask HR before fixing. To fix the chosen ones use prepare_fix_monthly_ctc.`,
    input_schema: { type: 'object', properties: {} },
    api: { method: 'GET', path: '/admin/payroll/salary-structures' },
    async run(ctx) {
      const rows = await looksMonthly(ctx);
      return {
        data: {
          threshold: `${rupees(LOOKS_MONTHLY_PAISE)} a year (the dashboard's own warning line)`, count: rows.length,
          people: rows.map((r) => ({ name: r.name, employeeId: r.employeeId, employeeType: r.employeeType, template: r.template, salary: r.status, annualCtcAsSaved: rupees(r.annualCtcPaise), thatIsAMonth: rupees(Math.round(r.annualCtcPaise / 12)), ifItWasMonthly: `${rupees(r.annualCtcPaise * 12)} a year` })),
          note: rows.length ? 'These may be monthly figures saved in the yearly box, or genuinely low pay. Confirm with HR, then prepare_fix_monthly_ctc for the ones to multiply by 12.' : 'No CTC looks like a monthly amount.',
        },
        tables: rows.length ? [{ title: 'CTCs that look monthly', columns: ['Person', 'Template', 'Annual CTC saved', 'A month', '×12'], rows: rows.map((r) => [r.name, r.template ?? '—', rupees(r.annualCtcPaise), rupees(Math.round(r.annualCtcPaise / 12)), rupees(r.annualCtcPaise * 12)]) }] : undefined,
        links: [{ label: 'Open salary templates', view: 'templates' }],
      };
    },
  },
  {
    name: 'prepare_fix_monthly_ctc',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: () => 'Prepared: multiply monthly-looking CTCs by 12',
    description: `Prepare ONE card that multiplies by 12 the annual CTC of the chosen people whose CTC looks like a monthly amount (under ${rupees(LOOKS_MONTHLY_PAISE)} a year; see ctc_looks_monthly), through the same salary structure save the Salary details page uses. Input: names (names, employee IDs or userIds) or all true (everyone ctc_looks_monthly lists). The card shows each person's CTC and net pay before → after and the totals. The CTC is corrected from the date their salary already applies from. Changes nothing until HR confirms; Undo puts the old CTCs back. Not for real pay rises (prepare_assign_salary_template).`,
    input_schema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } }, all: { type: 'boolean', description: 'Everyone whose CTC looks monthly' } } },
    api: { method: 'PUT', path: '/admin/payroll/salary-structures/x' },
    async run(ctx, i) {
      const rows = await looksMonthly(ctx);
      const wanted = Array.isArray(i.names) ? (i.names as unknown[]).map((x) => str(x, 120)).filter(Boolean) : [];
      if (!wanted.length && i.all !== true) throw new Error('Say whose CTC to fix: names, or all true for everyone ctc_looks_monthly lists');
      const skipped: { who: string; reason: string }[] = [];
      let chosen = rows;
      if (wanted.length) {
        const ids = new Set<string>();
        for (const w of wanted) {
          try {
            const p = await findPerson(ctx, w);
            if (rows.some((r) => r.userId === p.userId)) ids.add(p.userId);
            else {
              const s = await salaryStructures().findOne({ org: ctx.org, userId: p.userId }, { projection: { _id: 0, annualCtcPaise: 1 } });
              skipped.push({ who: p.name, reason: s?.annualCtcPaise ? `${rupees(s.annualCtcPaise)} a year does not look like a monthly amount` : 'No CTC saved' });
            }
          } catch (e) { skipped.push({ who: w, reason: (e as Error).message }); }
        }
        chosen = rows.filter((r) => ids.has(r.userId));
      }
      if (!chosen.length) return { data: { prepared: false, message: 'Nobody to fix.', skipped } };
      const items: { userId: string; name: string; fromPaise: number; toPaise: number; effectiveFrom: string | null; netBefore: number | null; netAfter: number | null }[] = [];
      for (const r of chosen) {
        const toPaise = r.annualCtcPaise * 12;
        let netBefore: number | null = null, netAfter: number | null = null;
        if (r.template) {
          try {
            netBefore = (await previewSalaryStructure(ctx.userId, r.userId, {})).computed.netMonthlyPaise;
            netAfter = (await previewSalaryStructure(ctx.userId, r.userId, { annualCtcPaise: toPaise })).computed.netMonthlyPaise;
          } catch { /* a structure that does not compute still gets its CTC fixed; the card says so */ }
        }
        items.push({ userId: r.userId, name: r.name, fromPaise: r.annualCtcPaise, toPaise, effectiveFrom: r.effectiveFrom, netBefore, netAfter });
      }
      const sum = (k: 'fromPaise' | 'toPaise') => items.reduce((t, x) => t + x[k], 0);
      const net = (p: number | null) => (p === null ? 'not worked out' : rupees(p));
      const draft = await payrollRuns().findOne({ org: ctx.org, status: 'draft' }, { projection: { period: 1 } });
      const paid = await payrollRuns().find({ org: ctx.org, status: 'paid' }, { projection: { period: 1 } }).sort({ period: -1 }).limit(1).toArray();
      const lines: Line[] = [
        { text: `Multiply the annual CTC by 12 for ${plural(items.length, 'person', 'people')}: ${items.slice(0, 8).map((x) => `${x.name} ${rupees(x.fromPaise)} → ${rupees(x.toPaise)} a year (net ${net(x.netBefore)} → ${net(x.netAfter)} a month)`).join('; ')}${items.length > 8 ? `; and ${items.length - 8} more in the table` : ''}.` },
        { text: `Totals: annual CTC ${rupees(sum('fromPaise'))} → ${rupees(sum('toPaise'))}; monthly CTC ${rupees(Math.round(sum('fromPaise') / 12))} → ${rupees(Math.round(sum('toPaise') / 12))}.` },
        { text: 'Each is saved as a CTC change on their salary, dated from the day their salary already applies from, and shows in the salary history.', tone: 'info' },
        draft ? { text: `${monthLabel(draft.period)}'s draft run picks it up when it is next calculated (prepare_run_step, action calculate).`, tone: 'info' } : { text: 'The next run is worked out on the corrected CTC.', tone: 'info' },
        ...(paid.length ? [{ text: `Months already submitted (latest ${monthLabel(paid[0].period)}) stay as paid: if they were paid on the wrong CTC, the difference is not paid automatically. Add it as arrears with prepare_one_time_pay.`, tone: 'warn' as const }] : []),
        { text: 'Nothing is paid by this change itself. Undo puts the old CTCs back.', tone: 'info' },
        ...(skipped.length ? [{ text: `Left out: ${skipped.slice(0, 5).map((s) => `${s.who} (${s.reason})`).join('; ')}.`, tone: 'warn' as const }] : []),
      ];
      const proposalId = await propose(ctx, {
        kind: 'payroll.fix_monthly_ctc', area: 'payroll', title: `Correct ${plural(items.length, 'CTC')} typed as monthly (×12)`,
        summary: `Multiply ${plural(items.length, 'annual CTC')} by 12: ${rupees(sum('fromPaise'))} → ${rupees(sum('toPaise'))} a year in all.`,
        lines, undoable: true,
        preview: { field: 'Annual CTC', rows: items.map((x) => ({ name: x.name, current: `${rupees(x.fromPaise)} a year (net ${net(x.netBefore)} a month)`, next: `${rupees(x.toPaise)} a year (net ${net(x.netAfter)} a month)` })), skipped },
        payload: { items },
      });
      return { data: { prepared: true, people: items.length, totalAnnualCtc: { before: rupees(sum('fromPaise')), after: rupees(sum('toPaise')) }, skipped, note: 'Nothing changes until HR confirms. The card lists every person: do not repeat them.' }, proposalId, links: [{ label: 'Open salary templates', view: 'templates' }] };
    },
  },
  {
    name: 'pay_cycle',
    area: 'payroll',
    payroll: true,
    label: () => 'Pay cycle and pay schedule',
    description: "The company's pay cycle and pay schedule: which days each month's run pays for (from payroll_periods: e.g. the 26th to the 25th, so November pays 26 Oct – 25 Nov; or the calendar month), this and next month's pay dates and base days, any month with its own dates or base days, and Setup › Pay Schedule (the day salary is paid, the first pay period, whether it is locked). Use for 'what is our pay cycle', 'when does November's pay period end', 'what day do we pay'. To change the pay day or first pay period use prepare_pay_schedule.",
    input_schema: { type: 'object', properties: {} },
    api: { method: 'GET', path: '/admin/pay-cycle' },
    async run(ctx) {
      const rows = await payrollPeriods().find({ org: ctx.org }).toArray();
      const cycle = rows.find((r) => r.period === DEFAULT_PAYROLL_PERIOD);
      const startDay = cycle?.startDay ?? 1;
      const thisMonth = ctx.today.slice(0, 7);
      const range = async (p: string) => {
        try { const r = await payrollPeriodRange(ctx.org, p); return { month: monthLabel(p), from: r.from, to: r.to, baseDays: r.baseDays }; } catch (e) { return { month: monthLabel(p), problem: (e as Error).message }; }
      };
      const setup = await getOrgSetup(ctx.userId);
      const s = setup.paySchedule;
      return {
        data: {
          cycle: !cycle ? 'The calendar month (1st to the last day): no pay cycle is set for this company.' : startDay === 1 ? 'The calendar month (1st to the last day).' : `The ${ordinal(startDay)} to the ${ordinal(startDay - 1)}: a month's run pays from the ${ordinal(startDay)} of the month before to the ${ordinal(startDay - 1)} of the month.`,
          current: await range(thisMonth), next: await range(addMonths(thisMonth, 1)),
          monthsWithTheirOwnDates: rows.filter((r) => r.period !== DEFAULT_PAYROLL_PERIOD).sort((a, b) => a.period.localeCompare(b.period)).map((r) => ({ month: monthLabel(r.period), from: r.from ?? null, to: r.to ?? null, baseDays: r.baseDays ?? null, note: r.note ?? null })),
          paySchedule: { payDay: s.payDay === 'last_day' ? 'the last day of the month' : `the ${ordinal(Number(s.payDay))} of the month`, firstPayPeriod: s.firstPayPeriod ? monthLabel(s.firstPayPeriod) : 'not set', locked: setup.payScheduleLocked },
          note: 'Base days are the days a month\'s salary is spread over (the days in the pay period unless a month sets its own); loss of pay comes off those. The cycle\'s start day is set by Sowaka for the company (there is no dashboard setting for it yet); the pay day and first pay period are on Setup › Pay Schedule.',
        },
        links: [{ label: 'Open pay schedule', view: 'payschedule' }],
      };
    },
  },
  {
    name: 'prepare_pay_schedule',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: () => 'Prepared: change the pay schedule',
    description: "Prepare changing Setup › Pay Schedule through the page's own save: payDay (the day salary is paid: 1 to 28, or 'last_day') and/or firstPayPeriod (YYYY-MM, the first month payroll runs for). Refused while the schedule is locked after the first run. Changes nothing until HR confirms; Undo puts the old schedule back. The pay cycle's start day (e.g. 26th to 25th) is NOT changed here: there is no dashboard setting for it; Sowaka sets it, and changing it moves every open month's dates. If HR asks to change the cycle, give cycleStartDay and the tool explains that.",
    input_schema: {
      type: 'object',
      properties: {
        payDay: { type: 'string', description: "A day 1–28 (like '7'), or 'last_day'" },
        firstPayPeriod: { type: 'string', description: 'YYYY-MM' },
        cycleStartDay: { type: 'number', description: 'Only when HR asks to change the cycle itself (explained, not changed)' },
      },
    },
    api: { method: 'PUT', path: '/admin/payroll/org-setup' },
    async run(ctx, i) {
      if (i.cycleStartDay !== undefined && i.payDay === undefined && i.firstPayPeriod === undefined) {
        const cycle = await payrollPeriods().findOne({ org: ctx.org, period: DEFAULT_PAYROLL_PERIOD });
        return { data: { prepared: false, current: cycle?.startDay && cycle.startDay > 1 ? `the ${ordinal(cycle.startDay)} to the ${ordinal(cycle.startDay - 1)}` : 'the calendar month', message: 'The pay cycle\'s start day cannot be changed from Suwi or the dashboard: Sowaka sets it for the company. Changing it moves the dates of every month not yet submitted (and the month in between needs its own dates so no day is paid twice or missed), so ask Sowaka to do it with a date to start from. The pay day and first pay period can be changed here.' } };
      }
      const setup = await getOrgSetup(ctx.userId);
      if (setup.payScheduleLocked) return { data: { prepared: false, message: 'The pay schedule is locked after the first payroll run, so it cannot be changed.' } };
      const before = setup.paySchedule as PaySchedule;
      const after: PaySchedule = { ...before };
      if (i.payDay !== undefined) {
        const v = String(i.payDay).trim().toLowerCase().replace(/\s+/g, '_');
        if (v === 'last_day' || v === 'last') after.payDay = 'last_day';
        else {
          const d = num(v.replace(/(st|nd|rd|th)$/, ''), NaN);
          if (!Number.isInteger(d) || d < 1 || d > 28) throw new Error("payDay must be 1 to 28, or 'last_day'");
          after.payDay = d;
        }
      }
      if (i.firstPayPeriod !== undefined) {
        if (!isPeriod(i.firstPayPeriod)) throw new Error('firstPayPeriod must be YYYY-MM');
        after.firstPayPeriod = i.firstPayPeriod;
      }
      const day = (p: PaySchedule['payDay']) => (p === 'last_day' ? 'the last day of the month' : `the ${ordinal(Number(p))}`);
      const changes: string[] = [];
      if (after.payDay !== before.payDay) changes.push(`Pay day: ${day(before.payDay)} → ${day(after.payDay)}`);
      if (after.firstPayPeriod !== before.firstPayPeriod) changes.push(`First pay period: ${before.firstPayPeriod ? monthLabel(before.firstPayPeriod) : 'not set'} → ${monthLabel(after.firstPayPeriod!)}`);
      if (!changes.length) return { data: { prepared: false, message: 'That is already the pay schedule.' } };
      const company = await companies().findOne({ id: ctx.org }, { projection: { _id: 0, paySchedule: 1 } });
      const proposalId = await propose(ctx, {
        kind: 'payroll.pay_schedule', area: 'payroll', title: 'Change the pay schedule',
        summary: `${changes.join('; ')}.`,
        lines: [
          ...changes.map((text) => ({ text })),
          { text: 'This is what Setup › Pay Schedule records. It does not change which days a month\'s run pays for (the pay cycle), any run, or anyone\'s pay.', tone: 'info' as const },
          { text: 'Undo puts the old schedule back.', tone: 'info' as const },
        ],
        undoable: true,
        payload: { after, before: company?.paySchedule ?? null },
      });
      return { data: { prepared: true, changes, note: 'Nothing changes until HR confirms.' }, proposalId, links: [{ label: 'Open pay schedule', view: 'payschedule' }] };
    },
  },
  {
    name: 'claim_types',
    area: 'claims',
    payroll: true,
    label: () => 'Claim types and their limits',
    description: "The company's reimbursement claim types (Setup › Reimbursement Types): each with its limit per claim (₹, or no limit), how many days back a claim may be dated, the salary component its bills are for (FBP), and whether it is on. Sowaka has a limit PER CLAIM and a backdating window; it has no per-day or per-month limit on a type and no 'bill required' switch (claims_to_check flags claims without a bill). Use for 'what are our claim limits', 'is there a travel limit'. To change one use prepare_claim_type; for what people claimed use claims_by_person.",
    input_schema: { type: 'object', properties: {} },
    api: { method: 'GET', path: '/admin/reimbursement-types' },
    async run(ctx) {
      const types = await listReimbursementTypes(ctx.userId);
      return {
        data: {
          types: types.map((t) => ({ name: t.name, limitPerClaim: t.maxLimit > 0 ? rupees(Math.round(t.maxLimit * 100)) : 'no limit', backdateDays: t.backdateDays, billsForSalaryComponent: t.payHeadCode, on: t.active, description: t.description || undefined })),
          note: 'Limits are per claim. There is no per-day limit and no bill-required setting.',
        },
        links: [{ label: 'Open reimbursement types', view: 'reimbursementtypes' }],
      };
    },
  },
  {
    name: 'prepare_claim_type',
    area: 'claims',
    payroll: true,
    acts: true,
    label: (i) => `Prepared: claim type ${i.type ?? i.name ?? ''}`,
    description: "Prepare adding or changing a reimbursement claim type through Setup › Reimbursement Types' own save: type (an existing type's name to change; omit to add a new one), name (the new type's name, or a rename), limitPerClaimRupees (0 = no limit), backdateDays (0–365), description, on (true/false to switch it on or off). Sowaka's limit is PER CLAIM: there is no per-day limit and no bill-required switch. When HR asks for a daily limit ('a ₹6,000 daily travel limit'), set perDay true and the card says plainly that it becomes a per-claim limit, so HR can decide. Changes nothing until HR confirms; Undo restores the type as it was (or removes a new one while nobody has claimed against it).",
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Existing type to change' },
        name: { type: 'string', description: 'Name for a new type, or a new name' },
        limitPerClaimRupees: { type: 'number' }, backdateDays: { type: 'number' }, description: { type: 'string' }, on: { type: 'boolean' },
        perDay: { type: 'boolean', description: 'HR asked for a per-day limit' },
      },
    },
    api: { method: 'PATCH', path: '/admin/reimbursement-types/x' },
    async run(ctx, i) {
      const types = await listReimbursementTypes(ctx.userId);
      const given = str(i.type, 60);
      const current = given ? typeByName(types, given) : str(i.name, 60) ? typeByName(types, str(i.name, 60)) : undefined;
      if (given && !current) throw new Error(`No claim type called "${given}". The types are: ${types.map((t) => t.name).join(', ') || 'none'}. Leave type out to add a new one.`);
      if (!current && !str(i.name, 60)) throw new Error('Give the new type a name');
      const base = current ? typeFields(current) : { name: str(i.name, 60), description: '', maxLimit: 0, backdateDays: 30, active: true };
      const next = { ...base };
      if (current && str(i.name, 60) && norm(i.name) !== norm(current.name)) next.name = str(i.name, 60);
      if (i.limitPerClaimRupees !== undefined) next.maxLimit = num(i.limitPerClaimRupees, NaN, 0, 10_000_000);
      if (i.backdateDays !== undefined) next.backdateDays = Math.round(num(i.backdateDays, NaN, 0, 365));
      if (i.description !== undefined) next.description = str(i.description, 300);
      if (typeof i.on === 'boolean') next.active = i.on;
      if (!Number.isFinite(next.maxLimit) || !Number.isFinite(next.backdateDays)) throw new Error('limitPerClaimRupees and backdateDays must be numbers');
      const asType = (f: typeof next) => ({ ...f, id: '', payHeadCode: null }) as ClaimType;
      const changes: string[] = [];
      if (!current) changes.push(`Add the claim type "${next.name}": ${limitText(next)}, back-dated up to ${next.backdateDays} days${next.active ? '' : ', switched off'}.`);
      else {
        if (next.name !== base.name) changes.push(`Name: ${base.name} → ${next.name}`);
        if (next.maxLimit !== base.maxLimit) changes.push(`Limit: ${limitText(base)} → ${limitText(next)}`);
        if (next.backdateDays !== base.backdateDays) changes.push(`Back-dating: ${base.backdateDays} → ${next.backdateDays} days`);
        if (next.description !== base.description) changes.push('Description changed');
        if (next.active !== base.active) changes.push(next.active ? 'Switched on: people can claim it again' : 'Switched off: it leaves the app\'s list; past claims stay');
        if (!changes.length) return { data: { prepared: false, message: `${typeText(current)}: already like that.` } };
      }
      const lines: Line[] = [
        ...changes.map((text) => ({ text })),
        ...(i.perDay === true ? [{ text: `Sowaka has no per-day limit: this is a limit per claim. A single ${next.name} claim over ${limitText(next).replace(' a claim', '')} is flagged; two claims on the same day are each checked on their own.`, tone: 'warn' as const }] : []),
        { text: 'It applies to claims raised from now on; claims already made keep their amounts (claims_to_check flags pending ones over the limit).', tone: 'info' },
        { text: current ? 'Undo puts the type back as it was.' : 'Undo removes the new type while nobody has claimed against it.', tone: 'info' },
      ];
      const proposalId = await propose(ctx, {
        kind: 'payroll.claim_type', area: 'claims', title: current ? `Change the ${current.name} claim type` : `Add the ${next.name} claim type`,
        summary: changes.join(' '), lines, undoable: true,
        payload: { typeId: current?.id ?? null, before: current ? typeFields(current) : null, after: next },
      });
      return { data: { prepared: true, now: current ? typeText(current) : 'new', after: typeText(asType(next)), perClaimNotPerDay: i.perDay === true || undefined, note: 'Nothing changes until HR confirms.' }, proposalId, links: [{ label: 'Open reimbursement types', view: 'reimbursementtypes' }] };
    },
  },
);

// ———————————————————————————————————————————— executors

type CtcItem = { userId: string; name: string; fromPaise: number; toPaise: number; effectiveFrom: string | null };

defineExecutor('payroll.fix_monthly_ctc', {
  async run(p) {
    const items = p.payload.items as CtcItem[];
    const done: { userId: string; name: string; fromPaise: number; revisions: SalaryStructure['revisions'] | null }[] = [];
    const failed: string[] = [];
    for (const x of items) {
      try {
        const now = await salaryStructures().findOne({ org: p.org, userId: x.userId });
        if (now?.annualCtcPaise !== x.fromPaise) throw new Error(`CTC changed since this was prepared (now ${rupees(now?.annualCtcPaise ?? 0)})`);
        await upsertSalaryStructure(p.userId, x.userId, { annualCtcPaise: x.toPaise, ...(x.effectiveFrom ? { effectiveFrom: x.effectiveFrom } : {}) });
        done.push({ userId: x.userId, name: x.name, fromPaise: x.fromPaise, revisions: now.revisions ?? null });
      } catch (e) { failed.push(`${x.name} (${(e as Error).message})`); }
    }
    const total = items.filter((x) => done.some((d) => d.userId === x.userId)).reduce((t, x) => t + x.toPaise, 0);
    return {
      message: `Multiplied ${plural(done.length, 'CTC')} by 12 (now ${rupees(total)} a year in all).${failed.length ? ` Not done: ${failed.slice(0, 5).join('; ')}.` : ''}`,
      undo: { done },
    };
  },
  async undo(p) {
    const done = (p.undo?.done ?? []) as { userId: string; name: string; fromPaise: number; revisions: SalaryStructure['revisions'] | null }[];
    const failed: string[] = [];
    for (const d of done) {
      try {
        await upsertSalaryStructure(p.userId, d.userId, { annualCtcPaise: d.fromPaise });
        // The save records each CTC change as a revision; the correction and its undo were not real revisions,
        // so the history goes back to what it was (as prepare_assign_salary_template's Undo does).
        await salaryStructures().updateOne({ org: p.org, userId: d.userId }, { $set: { revisions: d.revisions ?? [] } as never });
      } catch (e) { failed.push(`${d.name} (${(e as Error).message})`); }
    }
    return `Put back ${plural(done.length - failed.length, 'earlier CTC')}.${failed.length ? ` Not done: ${failed.join('; ')}.` : ''}`;
  },
});

defineExecutor('payroll.pay_schedule', {
  async run(p) {
    const after = p.payload.after as PaySchedule;
    await updateOrgSetup(p.userId, { paySchedule: after });
    return { message: `Pay schedule saved: pay day ${after.payDay === 'last_day' ? 'the last day of the month' : `the ${ordinal(Number(after.payDay))}`}${after.firstPayPeriod ? `, first pay period ${monthLabel(after.firstPayPeriod)}` : ''}.` };
  },
  async undo(p) {
    const before = p.payload.before as PaySchedule | null;
    // No schedule saved before: the page showed its default (monthly, the last day).
    await updateOrgSetup(p.userId, { paySchedule: before ?? { frequency: 'monthly', payDay: 'last_day' } });
    return 'The earlier pay schedule is back.';
  },
});

type TypeFields = ReturnType<typeof typeFields>;
defineExecutor('payroll.claim_type', {
  async run(p) {
    const { typeId, after } = p.payload as { typeId: string | null; after: TypeFields };
    if (typeId) {
      const t = await updateReimbursementType(p.userId, typeId, after);
      return { message: `Saved: ${typeText(t)}.` };
    }
    const t = await createReimbursementType(p.userId, after);
    return { message: `Added: ${typeText(t)}.`, undo: { createdId: t.id } };
  },
  async undo(p) {
    const { typeId, before } = p.payload as { typeId: string | null; before: TypeFields | null };
    if (typeId && before) {
      const t = await updateReimbursementType(p.userId, typeId, before);
      return `Back as it was: ${typeText(t)}.`;
    }
    await deleteReimbursementType(p.userId, String(p.undo?.createdId ?? ''));
    return 'The new claim type is removed.';
  },
});
