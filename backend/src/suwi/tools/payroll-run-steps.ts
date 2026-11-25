// Payroll run steps from Suwi (24 Nov, Suwi training: payroll). Three prepared actions over a month's
// run, each ONE card, each calling the same service the Payroll Runs page calls:
//  - prepare_one_time_pay: "this month only" pay items (incentive, bonus, arrears, a one-off
//    deduction) for one or many people on the draft run, then recalculate (the page's
//    Save & recalculate: recomputeRun with componentAmounts). Undo puts the earlier amounts back.
//  - prepare_run_step: calculate / recalculate, submit, reopen, or mark an approved run paid
//    (createRun, recomputeRun, submitRun, recallRun, markRunPaid). Submit and mark paid list the
//    run's blockers first and refuse while there are any.
//  - prepare_payslip_notice: tells the people on a submitted run that their payslip is ready
//    (app notification, and email where the company may get email: EMAIL_ORGS).
// Money moves only when a run is submitted and the company pays it; every card says so.
import { ObjectId } from 'mongodb';
import { employeePaymentDetails, payHeads, payrollRuns, payslips, reimbursementClaims, salaryStructures, users } from '../../config/db';
import { Payslip } from '../../models/payrollRun.model';
import { createRun, markRunPaid, recallRun, recomputeRun, submitRun } from '../../services/payrollRun.service';
import { notifiesOrg, notifyUsers } from '../../services/notification.service';
import { orgMayEmail } from '../../services/lifecycle/emails';
import { statutorySettingsFor } from '../../services/statutorySettings.service';
import { tdsConfigsFor } from '../../services/tds.service';
import { payrollAccessOf } from '../../services/payrollAccess.service';
import { defineTools, num, rupees, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { SuwiProposal } from '../store';
import { findPerson, norm } from './people';
import { fyOfPeriod, isPeriod, lastDayOf, monthLabel, StoredRun } from './payroll-common';
import { niceDate } from './team';

type Line = { text: string; why?: string; tone?: 'info' | 'warn' };
type Slip = Payslip & { _id: ObjectId };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[], n = 6) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` and ${xs.length - n} more` : ''}`;
const NOT_PAID_YET = 'Nothing is paid by this: money reaches people only once the run is submitted and the company makes the bank transfer.';
const GONE = new Set(['offboarded', 'terminated']);

/** The month asked for: YYYY-MM, else the open draft's month when there is exactly one, else this month. */
async function periodFor(ctx: SuwiContext, v: unknown): Promise<string> {
  if (isPeriod(v)) return v;
  const drafts = await payrollRuns().find({ org: ctx.org, status: 'draft' }, { projection: { period: 1 } }).toArray();
  return drafts.length === 1 ? drafts[0].period : ctx.today.slice(0, 7);
}

/** The month's run (a rejected one does not count: a new run replaces it). */
async function runOf(org: string, period: string): Promise<StoredRun | null> {
  return (await payrollRuns().findOne({ org, period, status: { $ne: 'rejected' } } as never)) as StoredRun | null;
}
const slipsOf = async (run: StoredRun) => (await payslips().find({ org: run.org, runId: run._id.toHexString() }).toArray()) as Slip[];

/** The run's money, in rupees, as every card shows it. */
function totalsLine(run: StoredRun): string {
  const t = run.totals;
  const held = t.heldCount ? `; ${plural(t.heldCount, 'person')} on notice held (${rupees(t.heldPaise ?? 0)}), paid with their final settlement` : '';
  return `${plural(run.employeeCount, 'person', 'people')}: gross ${rupees(t.grossPaise)}, deductions ${rupees(t.employeeDeductionsPaise)}, net pay ${rupees(t.netPaise)}, reimbursements ${rupees(t.reimbursementsPaise)}, employer cost ${rupees(t.employerCostPaise)}${held}.`;
}

/**
 * What stops a run from being submitted (or an approved one marked paid): the checks
 * payroll_run_check calls blockers, worked out for this run. Plain sentences.
 */
export async function runBlockers(ctx: Pick<SuwiContext, 'org' | 'today'>, run: StoredRun, slips: Slip[]): Promise<string[]> {
  const out: string[] = [];
  const from = run.periodFrom ?? `${run.period}-01`;
  const to = run.periodTo ?? lastDayOf(run.period);
  const label = monthLabel(run.period);
  if (run.status === 'draft' || run.status === 'pending_approval') {
    if (ctx.today <= to) out.push(`${label}'s pay period (${niceDate(from)} to ${niceDate(to)}) is not over: attendance and loss of pay can still change. Recalculate after ${niceDate(to)}, then submit.`);
    const onRun = new Set(slips.map((s) => s.userId));
    const live = await salaryStructures().find({ org: ctx.org, status: 'active' }, { projection: { _id: 0, userId: 1, salaryTemplateCode: 1 } }).toArray();
    const missing = live.filter((s) => !onRun.has(s.userId));
    if (missing.length) {
      const people = await users().find({ org: ctx.org, userId: { $in: missing.map((s) => s.userId) } }, { projection: { _id: 0, userId: 1, name: 1, joiningDate: 1, endDate: 1, lifecycleStatus: 1 } }).toArray();
      const due = people.filter((u) => !GONE.has(u.lifecycleStatus ?? '') && (!u.joiningDate || new Date(u.joiningDate).toISOString().slice(0, 10) <= to) && (!u.endDate || new Date(u.endDate).toISOString().slice(0, 10) >= from));
      if (due.length) out.push(`${plural(due.length, 'person has', 'people have')} an active salary but no payslip on this run: ${list(due.map((u) => u.name))}. Recalculate the run (or give them a salary template).`);
    }
  }
  const claimIds = slips.flatMap((s) => s.inputs?.reimbursementClaimIds ?? []).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (claimIds.length) {
    const stale = await reimbursementClaims().countDocuments({ _id: { $in: claimIds }, status: { $ne: 'approved' } });
    if (stale) out.push(`${plural(stale, 'reimbursement claim')} on this run ${stale === 1 ? 'was' : 'were'} paid or changed since it was calculated. Recalculate first.`);
  }
  const paying = slips.filter((s) => !s.held && s.netPayablePaise > 0);
  const details = await employeePaymentDetails().find({ org: ctx.org, userId: { $in: paying.map((s) => s.userId) } } as never).toArray() as unknown as { userId: string; accountNumber?: string; pan?: string; uan?: string }[];
  const byUser = new Map(details.map((d) => [d.userId, d]));
  const noBank = paying.filter((s) => !byUser.get(s.userId)?.accountNumber).map((s) => s.employeeName);
  if (noBank.length) out.push(`No bank account for ${list(noBank)}: the bank file would have no account to pay into. Add it on their profile (Bank & PAN).`);
  const noPan = paying.filter((s) => !byUser.get(s.userId)?.pan).map((s) => s.employeeName);
  if (noPan.length) out.push(`No PAN for ${list(noPan)}: their TDS cannot be credited to them. Add it on their profile (Bank & PAN).`);
  const settings = await statutorySettingsFor(ctx.org);
  if (settings.epf.enabled) {
    const uanOf = new Map((await salaryStructures().find({ org: ctx.org, userId: { $in: slips.map((s) => s.userId) } }, { projection: { _id: 0, userId: 1, statutory: 1 } }).toArray()).map((s) => [s.userId, s.statutory?.uan]));
    const noUan = slips.filter((s) => s.deductions.some((d) => d.key === 'epf' && d.amountPaise > 0) && !uanOf.get(s.userId) && !byUser.get(s.userId)?.uan).map((s) => s.employeeName);
    if (noUan.length) out.push(`PF is deducted but no UAN is recorded for ${list(noUan)}. Add it on their Salary details or Bank & PAN.`);
  }
  if (settings.tds?.enabled && (await tdsConfigsFor(fyOfPeriod(run.period))).size === 0) out.push(`Income tax is on, but no tax rates are set up for FY ${fyOfPeriod(run.period)}, so no TDS was worked out. Add them under Statutory Components › Income Tax.`);
  return out;
}

// ———————————————————————————————————————————— one-time pay items

/** The pay items HR may enter for one month, as the Payroll Runs page lists them: one-time earnings and deductions. */
async function oneTimeItems(org: string) {
  const heads = await payHeads().find({ org, active: true }, { projection: { _id: 0, code: 1, name: 1, payslipName: 1, category: 1, recurrence: 1, taxable: 1 } }).toArray();
  return heads.filter((h) => (h.category === 'earning' && h.recurrence === 'one_time') || h.category === 'deduction');
}
type Item = Awaited<ReturnType<typeof oneTimeItems>>[number];
const itemLabel = (h: Item) => h.payslipName || h.name;

function matchItem(items: Item[], given: string): Item {
  const n = norm(given);
  if (!n) throw new Error('Say which pay item (for example Bonus, Incentive, Arrears, Salary Advance)');
  const names = (h: Item) => [h.code, h.name, h.payslipName ?? ''].map(norm).filter(Boolean);
  const exact = items.filter((h) => names(h).includes(n) || norm(h.code) === n.replace(/ /g, '_'));
  if (exact.length === 1) return exact[0];
  const near = exact.length ? exact : items.filter((h) => names(h).some((x) => x.includes(n) || n.includes(x)));
  if (near.length === 1) return near[0];
  const offered = items.map((h) => `${itemLabel(h)} (${h.category === 'deduction' ? 'deduction' : 'one-time earning'})`).join(', ') || 'none';
  if (!near.length) throw new Error(`This company has no one-time pay item called "${given}". Its one-time items are: ${offered}. Use one of them, or add the component first (prepare_salary_component, as a one-time earning or a deduction).`);
  throw new Error(`"${given}" matches more than one pay item: ${near.map(itemLabel).join(', ')}. Ask which.`);
}

type Ask = { person: string; item: string; amountPaise: number | null };
function asksFrom(i: Record<string, unknown>): Ask[] {
  const raw = Array.isArray(i.items) && i.items.length ? (i.items as Record<string, unknown>[]) : [i];
  return raw.slice(0, 200).map((r) => {
    const remove = r.remove === true || i.remove === true;
    const amount = num(r.amountRupees ?? i.amountRupees, NaN, 0, 1e9);
    if (!remove && !Number.isFinite(amount)) throw new Error('Give amountRupees for each item (or remove true to take an item off)');
    return { person: str(r.person ?? r.name ?? r.userId ?? i.person, 120), item: str(r.item ?? i.item, 80), amountPaise: remove || amount === 0 ? null : Math.round(amount * 100) };
  });
}

type Change = { userId: string; name: string; code: string; label: string; kind: 'earning' | 'deduction'; fromPaise: number | null; toPaise: number | null; netPaise: number };

// ———————————————————————————————————————————— tools

const RUN_STEPS = ['calculate', 'submit', 'reopen', 'mark_paid'] as const;
type RunStep = (typeof RUN_STEPS)[number];

defineTools(
  {
    name: 'prepare_one_time_pay',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: (i) => `Prepared: this month only pay${i.period ? ` for ${i.period}` : ''}`,
    description: "Prepare ONE card that adds, changes or removes 'this month only' pay items (a one-time earning such as Bonus, Incentive, Arrears, or a one-off deduction such as Salary Advance or Hold Amount) for one or MANY people on a month's DRAFT payroll run, then recalculates the run, exactly like Payroll Runs › a person › This month only › Save & recalculate. Input: period (YYYY-MM; default the open draft's month), and items [{person (name, employee ID or userId), item (the pay item's name or code), amountRupees}] or a single person/item/amountRupees; remove true (or amount 0) takes an item off. The amount REPLACES what that item already holds for that month. Only the company's own one-time earnings and deductions can be used (the error lists them); a new kind of item is added first with prepare_salary_component. The card shows each person's amount and the totals; nothing changes until HR confirms, and nothing is paid until the run is submitted. Undo puts the earlier amounts back while the run is still a draft. Not for permanent pay changes (prepare_assign_salary_template) or for calculating/submitting a run (prepare_run_step).",
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'YYYY-MM; default the open draft run\'s month' },
        items: { type: 'array', items: { type: 'object', properties: { person: { type: 'string' }, item: { type: 'string' }, amountRupees: { type: 'number' }, remove: { type: 'boolean' } } }, description: 'One row per person and pay item' },
        person: { type: 'string' }, item: { type: 'string' }, amountRupees: { type: 'number', description: 'Rupees, not paise' },
        remove: { type: 'boolean', description: 'Take the item off instead of setting an amount' },
      },
    },
    api: { method: 'POST', path: '/admin/payroll/runs/x/recompute' },
    async run(ctx, i) {
      const period = await periodFor(ctx, i.period);
      const label = monthLabel(period);
      const run = await runOf(ctx.org, period);
      if (!run) return { data: { prepared: false, message: `${label} has no payroll run yet. Calculate it first (prepare_run_step with action calculate), then add one-time pay.` }, links: [{ label: 'Open payroll runs', view: 'payruns' }] };
      if (run.status !== 'draft') return { data: { prepared: false, message: `${label}'s run is ${run.status === 'paid' ? 'submitted' : run.status.replace('_', ' ')}: one-time pay can only go on a draft. Reopen it first (prepare_run_step with action reopen), or put the amount on next month's run.` }, links: [{ label: 'Open payroll runs', view: 'payruns' }] };
      const items = await oneTimeItems(ctx.org);
      const asks = asksFrom(i);
      const slips = await slipsOf(run);
      const slipOf = new Map(slips.map((s) => [s.userId, s]));
      const skipped: { who: string; reason: string }[] = [];
      const changes: Change[] = [];
      for (const a of asks) {
        const head = matchItem(items, a.item);
        let who;
        try { who = await findPerson(ctx, a.person); } catch (e) { skipped.push({ who: a.person || '?', reason: (e as Error).message }); continue; }
        const slip = slipOf.get(who.userId);
        if (!slip) { skipped.push({ who: who.name, reason: `Not on ${label}'s run (no active salary structure), so there is no payslip to add to` }); continue; }
        const fromPaise = slip.inputs?.componentAmounts?.[head.code] ?? null;
        if (fromPaise === a.amountPaise) { skipped.push({ who: who.name, reason: `${itemLabel(head)} is already ${a.amountPaise === null ? 'not on their payslip' : rupees(a.amountPaise)}` }); continue; }
        const prior = changes.findIndex((c) => c.userId === who.userId && c.code === head.code);
        if (prior >= 0) changes.splice(prior, 1);
        changes.push({ userId: who.userId, name: who.name, code: head.code, label: itemLabel(head), kind: head.category === 'deduction' ? 'deduction' : 'earning', fromPaise, toPaise: a.amountPaise, netPaise: slip.netPayablePaise });
      }
      if (!changes.length) return { data: { prepared: false, message: 'Nothing to change.', skipped } };
      const sum = (kind: Change['kind']) => changes.filter((c) => c.kind === kind).reduce((t, c) => t + (c.toPaise ?? 0) - (c.fromPaise ?? 0), 0);
      const earn = sum('earning'), ded = sum('deduction');
      const people = new Set(changes.map((c) => c.userId)).size;
      const amount = (p: number | null) => (p === null ? 'none' : rupees(p));
      const lines: Line[] = [
        { text: `${label} only, on the draft run: ${changes.map((c) => `${c.name} ${c.label} ${c.toPaise === null ? `removed (was ${rupees(c.fromPaise ?? 0)})` : `${c.kind === 'deduction' ? '−' : '+'}${rupees(c.toPaise)}${c.fromPaise !== null ? ` (was ${rupees(c.fromPaise)})` : ''}`}`).slice(0, 12).join('; ')}${changes.length > 12 ? `; and ${changes.length - 12} more in the table` : ''}.` },
        { text: `Totals: one-time earnings ${earn >= 0 ? '+' : '−'}${rupees(Math.abs(earn))}, one-time deductions ${ded >= 0 ? '+' : '−'}${rupees(Math.abs(ded))}, for ${plural(people, 'person', 'people')}. The run's net pay now: ${rupees(run.totals.netPaise)}.` },
        { text: `Then the whole run is recalculated, as Save & recalculate does: net pay, PF, ESI and TDS on these items follow each component's own settings, so take-home moves by less than the gross amount where tax applies. What HR typed earlier on this run (paid days, tax, other one-time items) stays.`, tone: 'info' },
        { text: NOT_PAID_YET, tone: 'info' },
        { text: 'Undo puts the earlier amounts back and recalculates, while the run is still a draft.', tone: 'info' },
        ...(skipped.length ? [{ text: `Left out: ${skipped.map((s) => `${s.who} (${s.reason})`).slice(0, 5).join('; ')}.`, tone: 'warn' as const }] : []),
      ];
      const proposalId = await propose(ctx, {
        kind: 'payroll.one_time_pay', area: 'payroll',
        title: `${label} one-time pay for ${plural(people, 'person', 'people')}`,
        summary: `Set ${plural(changes.length, 'this month only pay item')} on ${label}'s draft run and recalculate it. Nothing is paid until the run is submitted.`,
        lines, effectiveFrom: `${period}-01`, undoable: true,
        preview: { field: 'This month only', rows: changes.map((c) => ({ name: c.name, current: `${c.label} ${amount(c.fromPaise)} (net pay ${rupees(c.netPaise)})`, next: `${c.label} ${amount(c.toPaise)}` })), skipped },
        payload: { period, runId: run._id.toHexString(), changes },
      });
      return {
        data: { prepared: true, period, people, changes: changes.map((c) => ({ name: c.name, item: c.label, from: amount(c.fromPaise), to: amount(c.toPaise) })), totals: { oneTimeEarnings: rupees(earn), oneTimeDeductions: rupees(ded) }, skipped, note: 'Nothing changes until HR confirms on the card; nothing is paid until the run is submitted. The card lists every person: do not repeat them.' },
        proposalId,
        links: [{ label: 'Open payroll runs', view: 'payruns' }],
      };
    },
  },
  {
    name: 'prepare_run_step',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: (i) => `Prepared: ${String(i.action ?? 'calculate').replace('_', ' ')} ${i.period ?? 'this month'}'s payroll`,
    description: "Prepare ONE step on a month's payroll run, as the Payroll Runs page's buttons do. action: calculate (make the month's draft run, or recalculate the draft: 'recalculate November's run'), submit (final: payslips reach the app, the month's days lock, claims on it are marked paid), reopen (a submitted run back to draft to correct it; refused while a later month is submitted), mark_paid (only for a run approved under the old approval step). Input: action, period (YYYY-MM; default the open draft's month). Submit and mark_paid list the run's blockers first (the month not over, people with a salary but no payslip, missing bank account / PAN / UAN, claims changed since calculating, income tax on without rates) and REFUSE while there are any. The card shows each person's net pay and the run's totals in rupees. Changes nothing until HR confirms. For calculate-and-submit in one go with a pre-flight use prepare_payroll_run; for one-time amounts use prepare_one_time_pay; to only check readiness use payroll_run_check.",
    input_schema: { type: 'object', properties: { action: { type: 'string', enum: [...RUN_STEPS] }, period: { type: 'string', description: 'YYYY-MM' } }, required: ['action'] },
    api: { method: 'POST', path: '/admin/payroll/runs/x/submit' },
    async run(ctx, i) {
      const action = str(i.action) as RunStep;
      if (!RUN_STEPS.includes(action)) throw new Error(`action must be one of ${RUN_STEPS.join(', ')}`);
      const period = await periodFor(ctx, i.period);
      const label = monthLabel(period);
      const run = await runOf(ctx.org, period);
      const links = [{ label: 'Open payroll runs', view: 'payruns' }];
      const no = (message: string, extra: Record<string, unknown> = {}) => ({ data: { prepared: false, period, status: run?.status ?? 'no run', message, ...extra }, links });
      const slips = run ? await slipsOf(run) : [];
      const netRows = (next: string) => slips.slice().sort((a, b) => a.employeeName.localeCompare(b.employeeName)).slice(0, 300).map((s) => ({ name: s.employeeName, current: `Net pay ${rupees(s.netPayablePaise)}${s.held ? ' (held: on notice)' : ''}`, next }));
      const lines: Line[] = [];
      let title = '';
      let typeToConfirm: string | undefined;
      let field = '';
      let next = '';
      if (action === 'calculate') {
        if (run && run.status !== 'draft') return no(`${label}'s run is ${run.status === 'paid' ? 'submitted' : run.status.replace('_', ' ')}: only a draft is recalculated. Reopen it first (action reopen).`);
        const live = await salaryStructures().countDocuments({ org: ctx.org, status: 'active', salaryTemplateCode: { $exists: true, $nin: [null, ''] } } as never);
        if (!run && !live) return no('Nobody has an active salary structure: there is nothing to calculate.');
        title = run ? `Recalculate ${label}'s payroll run` : `Calculate ${label}'s payroll run`;
        lines.push(run
          ? { text: `Recalculate the draft from today's attendance, salaries and approved claims. Now: ${totalsLine(run)}`, why: 'What HR typed on this run (paid days, income tax, one-time items, overtime) is kept; everything else is worked out again.' }
          : { text: `Make ${label}'s draft run: a payslip for each of the ${plural(live, 'person', 'people')} with an active salary, from attendance, salaries and approved claims.`, why: 'People without an active salary structure are skipped, not paid late.' });
        lines.push({ text: 'A draft is a working copy: employees do not see it, and the amounts can still change. The new totals and each person\'s net pay show on Payroll Runs after Confirm.', tone: 'info' });
        lines.push({ text: NOT_PAID_YET, tone: 'info' });
        field = 'Recalculated'; next = 'Worked out again on Confirm';
      } else if (action === 'submit' || action === 'mark_paid') {
        if (!run) return no(`${label} has no payroll run yet. Calculate it first (action calculate).`);
        if (run.status === 'paid') return no(`${label}'s run was already submitted${run.paidAt ? ` on ${run.paidAt.toISOString().slice(0, 10)}` : ''}.`);
        if (action === 'mark_paid' && run.status !== 'approved') return no(run.status === 'draft' ? `${label}'s run is a draft: drafts are finished with Submit (action submit), which also records them as paid.` : `${label}'s run is ${run.status.replace('_', ' ')}: only an approved run is marked paid.`);
        if (action === 'submit' && run.status === 'approved') return no(`${label}'s run was approved under the old approval step: use action mark_paid.`);
        const blockers = await runBlockers(ctx, run, slips);
        if (blockers.length) return no(`${label}'s run cannot be ${action === 'submit' ? 'submitted' : 'marked paid'} yet: fix the blockers first.`, { refused: true, blockers });
        title = action === 'submit' ? `Submit ${label}'s payroll` : `Mark ${label}'s payroll paid`;
        lines.push({ text: `No blockers. ${totalsLine(run)}` });
        lines.push(action === 'submit'
          ? { text: 'Submit is final: each person\'s payslip reaches the app, the month\'s attendance days lock, and the reimbursement claims on the run are marked paid.', why: 'If something is wrong afterwards, reopen the run (action reopen) while no later month is submitted.', tone: 'warn' }
          : { text: 'The run is recorded as paid and the reimbursement claims on it are marked paid, so no later run pays them again.', tone: 'warn' });
        lines.push({ text: 'Sowaka records the run; the bank transfer itself is made by the company (the bank file is on Payroll Runs). People are paid when that transfer goes through.', tone: 'info' });
        typeToConfirm = label.split(' ')[0].toUpperCase();
        field = action === 'submit' ? 'Submitted' : 'Paid'; next = action === 'submit' ? 'Payslip released' : 'Marked paid';
      } else {
        if (!run) return no(`${label} has no payroll run.`);
        if (run.status === 'draft') return no(`${label}'s run is already a draft.`);
        if (run.status === 'paid') {
          const later = await payrollRuns().findOne({ org: ctx.org, period: { $gt: period }, status: 'paid' }, { projection: { period: 1 } });
          if (later) return no(`${monthLabel(later.period)} is already submitted and was worked out from ${label}: reopen ${monthLabel(later.period)} first.`);
        }
        title = `Reopen ${label}'s payroll as a draft`;
        lines.push({ text: `Back to draft: ${totalsLine(run)}` });
        lines.push({ text: `${label}'s payslips disappear from employees' app until it is submitted again; the claims paid in it go back to approved (the corrected run pays them); attendance for the month can be corrected again.`, tone: 'warn' });
        lines.push({ text: 'Money already transferred is not taken back: reopening only lets HR correct the figures. Submit again when done (action submit).', tone: 'info' });
        typeToConfirm = label.split(' ')[0].toUpperCase();
        field = 'Reopened'; next = 'Back to draft';
      }
      lines.push({ text: 'This card has no Undo.', tone: 'warn', why: action === 'reopen' ? 'Submit the run again to undo a reopen.' : action === 'calculate' ? 'A recalculation keeps HR\'s typed figures; there is nothing to put back.' : 'Reopen the run if it must change.' });
      const proposalId = await propose(ctx, {
        kind: 'payroll.run_step', area: 'payroll', title,
        summary: `${title}.${typeToConfirm ? ` Type ${typeToConfirm} to confirm.` : ''} Nothing is paid until the run is submitted and the company makes the transfer.`,
        lines, effectiveFrom: `${period}-01`, undoable: false, ...(typeToConfirm ? { typeToConfirm } : {}),
        ...(slips.length ? { preview: { field, rows: netRows(next), skipped: [] } } : {}),
        payload: { action, period, runId: run?._id.toHexString() ?? null },
      });
      return {
        data: { prepared: true, period, action, status: run?.status ?? 'no run', totals: run ? { people: run.employeeCount, gross: rupees(run.totals.grossPaise), netPay: rupees(run.totals.netPaise), employerCost: rupees(run.totals.employerCostPaise) } : null, typeToConfirm, note: 'Nothing changes until HR confirms on the card. Each person\'s net pay is in the card\'s table: do not list them.' },
        proposalId, links,
      };
    },
  },
  {
    name: 'prepare_payslip_notice',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: (i) => `Prepared: tell people their ${i.period ?? ''} payslip is ready`,
    description: "Prepare telling the people on a SUBMITTED month's run that their payslip is ready ('send October payslips', 'release payslips'): an app notification, and an email where the company may receive email from Sowaka (EMAIL_ORGS; the card says when email is off). The message carries no amounts: people open the payslip in the app. Input: period (YYYY-MM), names (optional, only these people). Payslips are released by submitting the run: for a draft this refuses and points to prepare_run_step with action submit. Nothing is sent until HR confirms; a sent notice cannot be taken back.",
    input_schema: { type: 'object', properties: { period: { type: 'string', description: 'YYYY-MM' }, names: { type: 'array', items: { type: 'string' }, description: 'Only these people (names, employee IDs or userIds)' } } },
    api: { method: 'POST', path: '/admin/payroll/runs/x/submit' },
    async run(ctx, i) {
      const period = await periodFor(ctx, i.period);
      const label = monthLabel(period);
      const run = await runOf(ctx.org, period);
      if (!run) return { data: { prepared: false, message: `${label} has no payroll run, so there are no payslips.` } };
      if (run.status !== 'paid' && run.status !== 'approved') return { data: { prepared: false, message: `${label}'s run is a ${run.status.replace('_', ' ')}: payslips are released by submitting it (prepare_run_step with action submit), which puts them in the app. Then they can be told.` }, links: [{ label: 'Open payroll runs', view: 'payruns' }] };
      if (!notifiesOrg(ctx.org)) return { data: { prepared: false, message: 'Notifications are switched off for this company on this server, so nobody would receive anything.' } };
      const slips = await slipsOf(run);
      const wanted = Array.isArray(i.names) ? (i.names as unknown[]).map((x) => str(x, 120)).filter(Boolean) : [];
      const skipped: { who: string; reason: string }[] = [];
      let chosen = slips;
      if (wanted.length) {
        const ids = new Set<string>();
        for (const w of wanted) {
          try { ids.add((await findPerson(ctx, w)).userId); } catch (e) { skipped.push({ who: w, reason: (e as Error).message }); }
        }
        chosen = slips.filter((s) => ids.has(s.userId));
        for (const id of ids) if (!slips.some((s) => s.userId === id)) skipped.push({ who: id, reason: `No payslip on ${label}'s run` });
      }
      const active = new Set((await users().find({ org: ctx.org, userId: { $in: chosen.map((s) => s.userId) }, lifecycleStatus: { $nin: [...GONE] } } as never, { projection: { _id: 0, userId: 1 } }).toArray()).map((u) => u.userId));
      for (const s of chosen) if (!active.has(s.userId)) skipped.push({ who: s.employeeName, reason: 'Has left: the app no longer reaches them' });
      chosen = chosen.filter((s) => active.has(s.userId));
      if (!chosen.length) return { data: { prepared: false, message: 'Nobody to tell.', skipped } };
      const email = orgMayEmail(ctx.org);
      const total = chosen.reduce((t, s) => t + s.netPayablePaise, 0);
      const proposalId = await propose(ctx, {
        kind: 'payroll.payslip_notice', area: 'payroll',
        title: `Tell ${plural(chosen.length, 'person', 'people')} their ${label} payslip is ready`,
        summary: `An app notification${email ? ' and an email' : ''} to each person on ${label}'s submitted run saying their payslip is ready in the app. No amounts are in the message.`,
        lines: [
          { text: `To ${plural(chosen.length, 'person', 'people')} (listed in the table); their net pay for ${label} adds up to ${rupees(total)}.` },
          { text: `Message: "Your ${label} payslip is ready. Open Payroll in the Sowaka app to see or download it."` },
          email
            ? { text: 'Email: on for this company, so each person also gets it by email (to their work email).', tone: 'info' }
            : { text: 'Email is off for this company (Sowaka only emails companies on its email list), so only the app notification goes out.', tone: 'warn' },
          { text: run.status === 'paid' ? `The payslips are already in the app (the run was submitted${run.paidAt ? ` on ${run.paidAt.toISOString().slice(0, 10)}` : ''}); this only tells people.` : 'The run is approved, so the payslips are already visible in the app; it is not marked paid yet.', tone: 'info' },
          { text: 'A sent notice cannot be taken back.', tone: 'warn' },
          ...(skipped.length ? [{ text: `Left out: ${skipped.slice(0, 5).map((s) => `${s.who} (${s.reason})`).join('; ')}.`, tone: 'warn' as const }] : []),
        ],
        undoable: false,
        preview: { field: 'Told', rows: chosen.slice(0, 300).map((s) => ({ name: s.employeeName, current: `Net pay ${rupees(s.netPayablePaise)}`, next: email ? 'App + email' : 'App only' })), skipped },
        payload: { period, userIds: chosen.map((s) => s.userId) },
      });
      return { data: { prepared: true, period, people: chosen.length, email: email ? 'on' : 'off for this company', skipped, note: 'Nothing is sent until HR confirms. It cannot be taken back.' }, proposalId };
    },
  },
);

// ———————————————————————————————————————————— executors

const nameOf = (slips: Slip[]) => new Map(slips.map((s) => [s.userId, s.employeeName]));

async function draftRun(p: SuwiProposal): Promise<StoredRun> {
  const run = await runOf(p.org, String(p.payload.period));
  if (!run || run._id.toHexString() !== p.payload.runId) throw new Error(`${monthLabel(String(p.payload.period))}'s run was replaced since this was prepared; ask Suwi again.`);
  if (run.status !== 'draft') throw new Error(`${monthLabel(run.period)}'s run is no longer a draft; reopen it first.`);
  return run;
}

/** Sets amounts (null clears) on the draft through the page's Save & recalculate, and says what each net became. */
async function setAmounts(p: SuwiProposal, amounts: { userId: string; code: string; paise: number | null }[]) {
  const run = await draftRun(p);
  const before = new Map((await slipsOf(run)).map((s) => [s.userId, s.netPayablePaise]));
  const componentAmounts: Record<string, Record<string, number | null>> = {};
  for (const a of amounts) (componentAmounts[a.userId] ??= {})[a.code] = a.paise;
  const after = await recomputeRun(p.userId, run._id.toHexString(), { componentAmounts });
  const slips = await slipsOf(run);
  const names = nameOf(slips);
  const nets = [...new Set(amounts.map((a) => a.userId))].map((u) => {
    const now = slips.find((s) => s.userId === u)?.netPayablePaise ?? 0;
    return `${names.get(u) ?? u} net pay ${rupees(before.get(u) ?? 0)} → ${rupees(now)}`;
  });
  return `${nets.slice(0, 8).join('; ')}${nets.length > 8 ? ` and ${nets.length - 8} more` : ''}. ${monthLabel(run.period)}'s run now: net pay ${rupees(after.totals.netPaise)} for ${plural(after.employeeCount, 'person', 'people')}. Nothing is paid until it is submitted.`;
}

defineExecutor('payroll.one_time_pay', {
  async run(p) {
    const changes = p.payload.changes as Change[];
    const message = await setAmounts(p, changes.map((c) => ({ userId: c.userId, code: c.code, paise: c.toPaise })));
    return { message: `Saved ${plural(changes.length, 'this month only item')} and recalculated. ${message}`, undo: { previous: changes.map((c) => ({ userId: c.userId, code: c.code, paise: c.fromPaise })) } };
  },
  async undo(p) {
    const previous = ((p.undo?.previous ?? []) as { userId: string; code: string; paise: number | null }[]);
    return `Put the earlier amounts back and recalculated. ${await setAmounts(p, previous)}`;
  },
});

defineExecutor('payroll.run_step', {
  async run(p) {
    const { action, period } = p.payload as { action: RunStep; period: string; runId: string | null };
    const label = monthLabel(period);
    const run = await runOf(p.org, period);
    if (p.payload.runId && run?._id.toHexString() !== p.payload.runId) throw new Error(`${label}'s run was replaced since this was prepared; ask Suwi again.`);
    if (action === 'calculate') {
      if (run && run.status !== 'draft') throw new Error(`${label}'s run is no longer a draft.`);
      const done = run ? await recomputeRun(p.userId, run._id.toHexString(), {}) : (await createRun(p.userId, { period })).run;
      return { message: `${run ? 'Recalculated' : 'Calculated'} ${label}'s draft run: ${plural(done.employeeCount, 'person', 'people')}, gross ${rupees(done.totals.grossPaise)}, net pay ${rupees(done.totals.netPaise)}, employer cost ${rupees(done.totals.employerCostPaise)}. Nothing is paid until it is submitted.` };
    }
    if (!run) throw new Error(`${label} has no payroll run.`);
    if (action === 'reopen') {
      await recallRun(p.userId, run._id.toHexString());
      return { message: `${label}'s run is a draft again: its payslips are out of the app until it is submitted again.` };
    }
    // Checked again at Confirm: something may have changed in the half hour since.
    const blockers = await runBlockers({ org: p.org, today: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10) }, run, await slipsOf(run));
    if (blockers.length) throw new Error(`Not done: ${blockers.join(' ')}`);
    if (!(await payrollAccessOf(p.userId))) throw Object.assign(new Error('Only people with payroll access can do this'), { statusCode: 403 });
    const done = action === 'submit' ? await submitRun(p.userId, run._id.toHexString()) : await markRunPaid(p.userId, run._id.toHexString());
    return { message: `${label} ${action === 'submit' ? 'submitted' : 'marked paid'} for ${plural(done.employeeCount, 'person', 'people')}: net pay ${rupees(done.totals.netPaise)}, employer cost ${rupees(done.totals.employerCostPaise)}.${action === 'submit' ? ' Payslips are now in the app.' : ''}` };
  },
});

defineExecutor('payroll.payslip_notice', {
  async run(p) {
    const period = String(p.payload.period);
    const label = monthLabel(period);
    const run = await runOf(p.org, period);
    if (!run || (run.status !== 'paid' && run.status !== 'approved')) throw new Error(`${label}'s run is not submitted any more (it was reopened?): nothing sent.`);
    const onRun = new Set((await slipsOf(run)).map((s) => s.userId));
    const ids = (p.payload.userIds as string[]).filter((u) => onRun.has(u));
    if (!ids.length) return { message: 'Nobody on the run any more: nothing sent.' };
    await notifyUsers(ids, {
      scenario: 'payslip_ready',
      title: `Your ${label} payslip is ready`,
      body: 'Open Payroll in the Sowaka app to see or download it.',
      data: { period },
      email: { subject: `Your ${label} payslip is ready`, body: `Hi {firstName},\n\nYour payslip for ${label} is ready. Open Payroll in the Sowaka app to see or download it.\n\nThank you.` },
    });
    return { message: `Told ${plural(ids.length, 'person', 'people')} their ${label} payslip is ready (app${orgMayEmail(p.org) ? ' and email' : ' only: email is off for this company'}).` };
  },
});
