// Final settlements and investment proofs from Suwi (24 Nov, Suwi training: payroll):
//  - final_settlement: what a leaver's final settlement holds, line by line in rupees, as
//    People › Exits › a person shows it (exitDetail: the draft worked out now, or the frozen one).
//  - prepare_settlement_step: approve it (Undo reopens it) or mark it paid, through the same
//    settlementAction the Exits page's buttons call. Notice pay and notice recovery are switched
//    off for every company: Suwi never adds them, and refuses a statement that still carries one.
//  - prepare_review_proofs: approve or send back employees' investment proofs (Payroll › Tax ›
//    Investment proofs) through the same decision service, one card for many.
import { exitDetail, listExits, settlementAction } from '../../services/exit.service';
import { decideProofForHr, listProofsForHr } from '../../services/employeePayroll.declaration';
import { defineTools, rupees, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { norm } from './people';
import { fyOfPeriod } from './payroll-common';
import { niceDate } from './team';

type Line = { text: string; why?: string; tone?: 'info' | 'warn' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const NOTICE = /^notice_/;
const NOTICE_OFF = 'Notice pay and notice recovery are switched off: salary runs to the last working day, with nothing added or recovered for notice.';

type ExitRow = Awaited<ReturnType<typeof listExits>>[number];
/** A leaver by userId, employee ID or name, among the company's recorded exits. */
async function leaverOf(ctx: SuwiContext, ref: unknown): Promise<ExitRow> {
  const r = str(ref, 120);
  if (!r) throw new Error('Say whose settlement: a name, employee ID or userId');
  const rows = await listExits(ctx.userId);
  const exact = rows.find((x) => x.userId === r || (x.employeeId && x.employeeId.toLowerCase() === r.toLowerCase()));
  if (exact) return exact;
  const n = norm(r);
  const full = rows.filter((x) => norm(x.name) === n);
  const hits = full.length ? full : rows.filter((x) => norm(x.name).split(' ').includes(n) || norm(x.name).includes(n));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`No recorded exit for "${r}"`);
  throw new Error(`More than one leaver matches "${r}": ${hits.slice(0, 6).map((x) => `${x.name} (last day ${x.lastWorkingDay})`).join(', ')}. Ask which.`);
}

type Detail = Awaited<ReturnType<typeof exitDetail>>;
type Statement = NonNullable<Detail['settlement']>;
const shownLines = (s: Statement) => s.lines.filter((l) => !NOTICE.test(l.key));
const noticeMoney = (s: Statement) => s.lines.filter((l) => NOTICE.test(l.key) && l.amountPaise > 0);
const lineText = (l: Statement['lines'][number]) => `${l.side === 'deduction' ? '−' : '+'}${rupees(l.amountPaise)} ${l.label}${l.note ? ` (${l.note})` : ''}${l.estimated ? ' [estimated: no run has made this payslip yet]' : ''}${l.changedReason ? ` [changed by ${l.changedByName ?? 'HR'}: ${l.changedReason}]` : ''}`;

const STEPS = ['approve', 'mark_paid'] as const;
type Step = (typeof STEPS)[number];

type ProofRow = Awaited<ReturnType<typeof listProofsForHr>>['proofs'][number];
const proofWhat = (p: ProofRow) => `${p.label}${p.section ? ` (${p.section})` : ''}: declared ${rupees(p.declaredPaise)}, proof ${rupees(p.amountPaise)}`;
const covers = (p: ProofRow) => p.declaredPaise > 0 && p.amountPaise >= p.declaredPaise;

defineTools(
  {
    name: 'final_settlement',
    area: 'payroll',
    payroll: true,
    label: (i) => (i.person ? `Final settlement for ${i.person}` : 'Final settlements'),
    description: `A leaver's final settlement (full and final), as People › Exits › the person shows it: each line in rupees (held salary months, the last month, leave encashment, gratuity, PF, income tax, other deductions; HR's changes with their reason), earnings, deductions, the amount payable, its status (draft: worked out afresh each time; approved: frozen; paid), the clearance list, and when it starts if it has not. Without person: everyone with a recorded exit and where their settlement stands. ${NOTICE_OFF} Use for 'what does X's settlement hold', 'whose settlements are due'. To approve it or mark it paid use prepare_settlement_step.`,
    input_schema: { type: 'object', properties: { person: { type: 'string', description: 'Name, employee ID or userId of the leaver' } } },
    api: { method: 'GET', path: '/admin/exits' },
    async run(ctx, i) {
      if (!str(i.person)) {
        const rows = await listExits(ctx.userId);
        return {
          data: {
            exits: rows.map((x) => ({ name: x.name, kind: x.kindLabel, lastWorkingDay: x.lastWorkingDay, stage: x.stage === 'notice' ? 'serving notice' : x.stage === 'left' ? 'settled' : 'settlement due', settlement: x.settlement ? { status: x.settlement.status, payable: rupees(x.settlement.payablePaise) } : 'not started', clearanceDone: x.clearanceDone })),
            note: NOTICE_OFF,
          },
          links: [{ label: 'Open exits', view: 'exits' }],
        };
      }
      const who = await leaverOf(ctx, i.person);
      const d = await exitDetail(ctx.userId, who.userId);
      const s = d.settlement;
      const clearance = d.exit.clearance.map((c) => ({ item: c.label, done: c.done }));
      if (!s) {
        return { data: { name: who.name, lastWorkingDay: who.lastWorkingDay, settlement: 'not started', why: d.exit.caseOpen ? 'An absconding is settled only once HR closes the case.' : `It starts the day after the last working day (${niceDate(who.lastWorkingDay)}), when their access ends.`, clearance, note: NOTICE_OFF } };
      }
      return {
        data: {
          name: who.name, kind: d.exit.kindLabel, lastWorkingDay: who.lastWorkingDay, status: s.status,
          ...(s.notSetUp ? { notSetUp: s.notSetUp } : {}),
          lines: shownLines(s).map(lineText),
          earnings: rupees(s.earningsPaise), deductions: rupees(s.deductionsPaise), payable: rupees(s.payablePaise),
          ...(s.tax ? { incomeTax: s.tax } : {}),
          approved: s.approvedAt ? `${s.approvedAt.slice(0, 10)} by ${s.approvedByName ?? 'HR'}` : null,
          paid: s.paidAt ? `${s.paidAt.slice(0, 10)} by ${s.paidByName ?? 'HR'}` : null,
          clearance, clearanceDone: d.exit.clearanceDone,
          ...(noticeMoney(s).length ? { warning: `This statement was approved with a notice line (${noticeMoney(s).map(lineText).join('; ')}), but notice money is switched off: reopen it on the Exits page so it is worked out again.` } : {}),
          note: `${s.status === 'draft' ? 'A draft is worked out again each time it is read, so it follows runs made since; approving freezes it. ' : ''}Nothing is paid until HR marks it paid after the transfer. ${NOTICE_OFF}`,
        },
        links: [{ label: 'Open exits', view: 'exits' }],
      };
    },
  },
  {
    name: 'prepare_settlement_step',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: (i) => `Prepared: ${i.action === 'mark_paid' ? 'mark paid' : 'approve'} the final settlement${i.person ? ` for ${i.person}` : ''}`,
    description: `Prepare approving a leaver's final settlement (it freezes the statement; Undo reopens it) or marking an approved one paid (after the company has transferred the money; the held payslips it covers are settled so no run pays them again; no Undo), through the Exits page's own settlement actions. Input: person, action (approve or mark_paid), clearanceReason (needed to approve while the clearance list is not complete: why approve anyway). The card shows every line and the payable amount in rupees. ${NOTICE_OFF} Suwi never adds notice money and refuses a statement that carries any. To change a line, HR uses the Exits page. Changes nothing until HR confirms.`,
    input_schema: { type: 'object', properties: { person: { type: 'string' }, action: { type: 'string', enum: [...STEPS] }, clearanceReason: { type: 'string', description: 'Why approve with clearance still open' } }, required: ['person', 'action'] },
    api: { method: 'POST', path: '/admin/employees/x/exit/settlement/approve' },
    async run(ctx, i) {
      const action = str(i.action) as Step;
      if (!STEPS.includes(action)) throw new Error('action must be approve or mark_paid');
      const who = await leaverOf(ctx, i.person);
      const d = await exitDetail(ctx.userId, who.userId);
      const s = d.settlement;
      const no = (message: string) => ({ data: { prepared: false, name: who.name, message }, links: [{ label: 'Open exits', view: 'exits' }] });
      if (!s) return no(`${who.name}'s settlement has not started: ${d.exit.caseOpen ? 'close the absconding case first' : `it starts the day after the last working day (${niceDate(who.lastWorkingDay)})`}.`);
      if (s.notSetUp) return no(s.notSetUp);
      if (noticeMoney(s).length) return no(`${who.name}'s statement carries notice money (${noticeMoney(s).map(lineText).join('; ')}), which is switched off. Reopen it on the Exits page so it is worked out again, then ask again.`);
      if (action === 'approve' && s.status !== 'draft') return no(`${who.name}'s settlement is already ${s.status}.`);
      if (action === 'mark_paid' && s.status !== 'approved') return no(s.status === 'paid' ? `${who.name}'s settlement is already paid (${s.paidAt?.slice(0, 10)}).` : `${who.name}'s settlement is a draft: approve it first (action approve).`);
      const open = d.exit.clearance.filter((c) => !c.done).map((c) => c.label);
      const reason = str(i.clearanceReason, 300);
      if (action === 'approve' && open.length && !reason) return no(`Clearance is not complete for ${who.name} (${open.join('; ')}). Tick it on the Exits page, or give clearanceReason: why approve anyway (it is kept on the statement).`);
      const lines: Line[] = [
        ...shownLines(s).map((l) => ({ text: lineText(l) })),
        { text: `Earnings ${rupees(s.earningsPaise)} − deductions ${rupees(s.deductionsPaise)} = payable ${rupees(s.payablePaise)} to ${who.name}.` },
        { text: NOTICE_OFF, tone: 'info' },
        action === 'approve'
          ? { text: `Approving freezes the statement at these amounts${open.length ? `, with clearance still open (${open.join('; ')}) because: "${reason}"` : ''}. Nothing is paid yet: mark it paid once the company has transferred ${rupees(s.payablePaise)}.`, tone: 'info' }
          : { text: `Records that the company has paid ${rupees(s.payablePaise)} to ${who.name}; the held payslips it covers are settled so no monthly run pays them again. Sowaka does not transfer the money.`, tone: 'warn' },
        { text: action === 'approve' ? 'Undo reopens it as a draft.' : 'This cannot be undone from Suwi.', tone: action === 'approve' ? 'info' : 'warn' },
      ];
      const proposalId = await propose(ctx, {
        kind: 'payroll.settlement_step', area: 'payroll',
        title: `${action === 'approve' ? 'Approve' : 'Mark paid'}: ${who.name}'s final settlement of ${rupees(s.payablePaise)}`,
        summary: `${action === 'approve' ? 'Approve' : 'Mark paid'} ${who.name}'s final settlement: payable ${rupees(s.payablePaise)}.`,
        lines, undoable: action === 'approve',
        payload: { action, userId: who.userId, name: who.name, payablePaise: s.payablePaise, clearanceReason: reason || null },
      });
      return { data: { prepared: true, name: who.name, payable: rupees(s.payablePaise), note: 'Nothing changes until HR confirms. The card lists every line: do not repeat them.' }, proposalId, links: [{ label: 'Open exits', view: 'exits' }] };
    },
  },
  {
    name: 'prepare_review_proofs',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: (i) => `Prepared: ${i.decision === 'rejected' ? 'send back' : 'approve'} investment proofs`,
    description: "Prepare ONE card that approves or sends back employees' uploaded investment proofs (Payroll › Tax › Investment proofs), through the same decision the page's buttons make. Input: decision (approved or rejected = send back), and which: names, proofIds, matchingOnly true (only proofs whose amount is at least what the person declared for that item: 'approve the proofs that match their declarations'), or all true; fy (like 2026-27, default this year); reason (required to send back: the employee sees it in the app). The card shows each proof's item, declared amount and proof amount. Only proofs waiting for review are taken; your own are left out. Changes nothing until HR confirms; a decision cannot be undone from Suwi. For who has not declared or uploaded at all, use tax_proofs_status.",
    input_schema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['approved', 'rejected'] },
        names: { type: 'array', items: { type: 'string' } }, proofIds: { type: 'array', items: { type: 'string' } },
        matchingOnly: { type: 'boolean', description: 'Only proofs that cover the declared amount' }, all: { type: 'boolean' },
        fy: { type: 'string' }, reason: { type: 'string', description: 'Why it is sent back (3–500 characters)' },
      },
      required: ['decision'],
    },
    api: { method: 'POST', path: '/admin/payroll/investment-proofs/x/decision' },
    async run(ctx, i) {
      const decision = str(i.decision);
      if (decision !== 'approved' && decision !== 'rejected') throw new Error('decision must be approved or rejected');
      const reason = str(i.reason, 500);
      if (decision === 'rejected' && reason.length < 3) throw new Error('Say why the proofs are sent back (reason): the employee sees it in the app');
      const fy = typeof i.fy === 'string' && /^\d{4}-\d{2}$/.test(i.fy) ? i.fy : fyOfPeriod(ctx.today.slice(0, 7));
      const ids = Array.isArray(i.proofIds) ? (i.proofIds as unknown[]).map((x) => str(x, 40)).filter(Boolean) : [];
      const names = Array.isArray(i.names) ? (i.names as unknown[]).map((x) => norm(x)).filter(Boolean) : [];
      if (!ids.length && !names.length && i.matchingOnly !== true && i.all !== true) throw new Error('Say which proofs: names, proofIds, matchingOnly true, or all true');
      const waiting = (await listProofsForHr(ctx.userId, { fy, status: 'uploaded' })).proofs;
      const skipped: { who: string; reason: string }[] = [];
      let chosen = waiting;
      if (ids.length) {
        chosen = chosen.filter((p) => ids.includes(p.id));
        for (const id of ids) if (!waiting.some((p) => p.id === id)) skipped.push({ who: id, reason: 'Not a proof waiting for review' });
      }
      if (names.length) chosen = chosen.filter((p) => names.some((n) => norm(p.employeeName).includes(n)));
      if (i.matchingOnly === true) {
        for (const p of chosen.filter((x) => !covers(x))) skipped.push({ who: p.employeeName ?? p.userId, reason: `${proofWhat(p)}: ${p.declaredPaise ? 'the proof is for less than declared' : 'nothing declared for this item'}` });
        chosen = chosen.filter(covers);
      }
      for (const p of chosen.filter((x) => x.userId === ctx.userId)) skipped.push({ who: p.employeeName ?? p.userId, reason: 'Your own proof: another payroll person has to review it' });
      chosen = chosen.filter((p) => p.userId !== ctx.userId);
      if (!chosen.length) return { data: { prepared: false, fy, waitingForReview: waiting.length, message: 'No proof waiting for review matches.', skipped: skipped.slice(0, 20) } };
      const people = new Set(chosen.map((p) => p.userId)).size;
      const sum = (k: 'declaredPaise' | 'amountPaise') => chosen.reduce((t, p) => t + p[k], 0);
      const verb = decision === 'approved' ? 'Approve' : 'Send back';
      const title = `${verb} ${plural(chosen.length, 'investment proof')} for FY ${fy}`;
      const proposalId = await propose(ctx, {
        kind: 'payroll.review_proofs', area: 'payroll', title,
        summary: `${verb} ${plural(chosen.length, 'proof')} from ${plural(people, 'person', 'people')}: declared ${rupees(sum('declaredPaise'))}, proofs ${rupees(sum('amountPaise'))} in all.`,
        lines: [
          { text: `${verb} ${plural(chosen.length, 'proof')} from ${plural(people, 'person', 'people')} (each in the table)${decision === 'rejected' ? ` with the reason "${reason}"` : ''}. Declared ${rupees(sum('declaredPaise'))}, proofs ${rupees(sum('amountPaise'))} in all.` },
          decision === 'approved'
            ? { text: 'Each approved proof stands for that declaration; once every item a person declared is approved, their declaration shows as proofs verified.', tone: 'info' }
            : { text: 'Each employee sees the proof sent back with the reason in the app and can upload it again.', tone: 'info' },
          { text: 'Nothing is paid or deducted by this; income tax follows on the next payroll run.', tone: 'info' },
          { text: 'A decision cannot be undone from Suwi.', tone: 'warn' },
          ...(skipped.length ? [{ text: `Left out: ${plural(skipped.length, 'proof')} (listed under the table).`, tone: 'warn' as const }] : []),
        ],
        undoable: false,
        preview: { field: decision === 'approved' ? 'Approved' : 'Sent back', rows: chosen.slice(0, 300).map((p) => ({ name: p.employeeName ?? p.userId, current: proofWhat(p), next: decision === 'approved' ? 'Approved' : 'Sent back' })), skipped: skipped.slice(0, 100) },
        payload: { decision, reason, items: chosen.map((p) => ({ id: p.id, name: p.employeeName ?? p.userId, what: p.label })) },
      });
      return { data: { prepared: true, fy, proofs: chosen.length, people, leftOut: skipped.length, skippedSample: skipped.slice(0, 5), note: 'Nothing is decided until HR confirms. The card lists every proof: do not repeat them.' }, proposalId };
    },
  },
);

defineExecutor('payroll.settlement_step', {
  async run(p) {
    const { action, userId, name, payablePaise, clearanceReason } = p.payload as { action: Step; userId: string; name: string; payablePaise: number; clearanceReason: string | null };
    // The amount HR saw is the amount approved: a draft is worked out afresh, so a run since may have moved it.
    const now = (await exitDetail(p.userId, userId)).settlement;
    if (!now) throw new Error(`${name}'s settlement is not open any more.`);
    if (now.payablePaise !== payablePaise) throw new Error(`${name}'s settlement changed since this was prepared (${rupees(payablePaise)} → ${rupees(now.payablePaise)}): ask Suwi again.`);
    if (noticeMoney(now).length) throw new Error(`${name}'s statement carries notice money, which is switched off: reopen it on the Exits page.`);
    await settlementAction(p.userId, userId, action === 'approve' ? 'approve' : 'paid', clearanceReason ? { clearanceOverrideReason: clearanceReason } : {});
    return { message: action === 'approve' ? `${name}'s final settlement is approved at ${rupees(payablePaise)}. Mark it paid once the transfer is made.` : `${name}'s final settlement of ${rupees(payablePaise)} is marked paid.` };
  },
  async undo(p) {
    const { action, userId, name } = p.payload as { action: Step; userId: string; name: string };
    if (action !== 'approve') throw new Error('A paid settlement cannot be undone.');
    await settlementAction(p.userId, userId, 'reopen', {});
    return `${name}'s final settlement is a draft again.`;
  },
});

defineExecutor('payroll.review_proofs', {
  async run(p) {
    const { decision, reason, items } = p.payload as { decision: 'approved' | 'rejected'; reason: string; items: { id: string; name: string; what: string }[] };
    const failed: string[] = [];
    for (const x of items) {
      try { await decideProofForHr(p.userId, x.id, { decision, ...(decision === 'rejected' ? { reason } : {}) }); } catch (e) { failed.push(`${x.name}, ${x.what} (${(e as Error).message})`); }
    }
    const done = items.length - failed.length;
    return { message: `${decision === 'approved' ? 'Approved' : 'Sent back'} ${plural(done, 'proof')}.${failed.length ? ` Not done: ${failed.slice(0, 5).join('; ')}${failed.length > 5 ? ` and ${failed.length - 5} more` : ''}.` : ''}` };
  },
});
