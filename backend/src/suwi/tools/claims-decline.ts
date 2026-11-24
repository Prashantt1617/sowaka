// Declining (or "sending back") reimbursement claims from Suwi, the other side of prepare_approve_claims
// (24 Nov, Suwi training: time). Sowaka has no "returned" state for a claim: the dashboard's only answer
// besides approving is Decline with a note, and the employee files again. So "send back the duplicate
// fuel bill" is a decline whose note says what to fix. One card for one or many; nothing changes until
// HR confirms; the executor calls adminDecideReimbursement, the service behind the dashboard's Decline
// button. A decided claim cannot be reopened, so there is no undo.
import { ObjectId } from 'mongodb';
import { adminDecideReimbursement } from '../../services/reimbursement.service';
import { defineTools, str } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { checkedPending, CheckedClaim } from './claims';

const inr = (r: number) => `₹${r.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lower = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 80).toLowerCase()).filter(Boolean) : str(v, 80) ? [str(v, 80).toLowerCase()] : []);

defineTools({
  name: 'prepare_decline_claims',
  area: 'claims',
  acts: true,
  label: (i) => (i.sendBack ? 'Prepared: send back claims' : 'Prepared: decline claims'),
  description: 'Prepare ONE card that declines (or "sends back") one or MANY pending reimbursement claims with a reason the employee sees, e.g. "send back the duplicate fuel bill", "decline Ravi\'s internet claim, no bill". reason is required (max 500 characters). Pick claims by claimIds (from claims_to_check), or by names, type (Fuel, Internet…), expense dates (from/to), and flagged: "duplicate" (same amount and date or the same file as another claim), "no_bill", "over_limit", "backdated", or "any" (every claim with a check against it). sendBack true words it as sent back to be filed again: Sowaka has no separate "returned" state, so a sent-back claim is declined with the note and the employee files a corrected one. Changes nothing until HR confirms; cannot be undone. Own claims are left out. For approving use prepare_approve_claims.',
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why, in words the employee reads (e.g. "Duplicate of your 3 Nov fuel bill; please file it once")' },
      sendBack: { type: 'boolean', description: 'HR said "send back" / "return": the note asks them to file again' },
      claimIds: { type: 'array', items: { type: 'string' } },
      names: { type: 'array', items: { type: 'string' }, description: "People's names" },
      type: { type: 'string', description: 'Claim type, e.g. Fuel' },
      from: { type: 'string', description: 'YYYY-MM-DD expense date from' }, to: { type: 'string', description: 'YYYY-MM-DD expense date to' },
      flagged: { type: 'string', enum: ['duplicate', 'no_bill', 'over_limit', 'backdated', 'any'] },
    },
    required: ['reason'],
  },
  api: { method: 'PATCH', path: '/admin/reimbursements/x/decision' },
  async run(ctx, i) {
    const reason = str(i.reason, 500);
    if (!reason) throw new Error('Give the reason the employee will see (why it is declined or what to fix)');
    const ids = Array.isArray(i.claimIds) ? [...new Set(i.claimIds.map(String))].filter((id) => ObjectId.isValid(id)) : [];
    const who = lower(i.names);
    const type = str(i.type).toLowerCase();
    const from = str(i.from), to = str(i.to) || from;
    const flagged = str(i.flagged);
    if (!ids.length && !who.length && !type && !from && !flagged) throw new Error('Say which claims: claimIds, names, a type, expense dates, or flagged');
    const all = await checkedPending(ctx, 'hash');
    const FLAG: Record<string, (c: CheckedClaim) => boolean> = {
      duplicate: (c) => c.checks.some((x) => /^same (amount and date|file) as/.test(x)),
      no_bill: (c) => !c.hasReceipt,
      over_limit: (c) => c.checks.some((x) => /^over the |monthly cap/.test(x)),
      backdated: (c) => c.checks.some((x) => /^dated \d+ days before/.test(x)),
      any: (c) => c.checks.length > 0,
    };
    let chosen = ids.length ? all.filter((c) => ids.includes(c.id)) : all;
    if (who.length) chosen = chosen.filter((c) => who.some((n) => c.name.toLowerCase().includes(n)));
    if (type) chosen = chosen.filter((c) => c.type.toLowerCase() === type || c.type.toLowerCase().includes(type));
    if (from) chosen = chosen.filter((c) => c.expenseDate.slice(0, 10) >= from && c.expenseDate.slice(0, 10) <= to);
    if (flagged && FLAG[flagged]) chosen = chosen.filter(FLAG[flagged]);
    const missing = ids.filter((id) => !all.some((c) => c.id === id));
    const own = chosen.filter((c) => c.userId === ctx.userId);
    const claims = chosen.filter((c) => c.userId !== ctx.userId);
    if (!claims.length) return { data: { nothingToDo: true, message: `No pending claim matches${own.length ? ' (your own claims can\'t be decided by you)' : ''}.`, notPending: missing.length } };
    const total = claims.reduce((s, c) => s + c.amount, 0);
    const note = i.sendBack && !/file|resubmit|again/i.test(reason) ? `${reason} Please file it again once corrected.` : reason;
    const verb = i.sendBack ? 'Send back' : 'Decline';
    const title = `${verb} ${plural(claims.length, 'claim')} (${inr(total)})`;
    const proposalId = await propose(ctx, {
      kind: 'decline_claims', area: 'claims', title,
      summary: `${claims.length === 1 ? `${claims[0].name}'s ${claims[0].type} claim of ${inr(claims[0].amount)} dated ${claims[0].expenseDate.slice(0, 10)}` : `${plural(claims.length, 'claim')} from ${plural(new Set(claims.map((c) => c.userId)).size, 'person', 'people')}`}, ${inr(total)} in all, ${i.sendBack ? 'sent back' : 'declined'} with the note: "${note}"`,
      lines: [
        { text: `Each claim is declined as you, with the note "${note}"; the person sees it in their app at once and nothing is paid for it.` },
        ...(i.sendBack ? [{ text: 'Sowaka has no "returned" state: a sent-back claim shows as Declined with your note, and the person files a corrected claim, which comes back to the pending pile.', tone: 'info' as const }] : []),
        ...(claims.some((c) => c.checks.length) ? [{ text: `Checks on these: ${claims.filter((c) => c.checks.length).slice(0, 4).map((c) => `${c.name.split(' ')[0]} (${c.checks[0]})`).join('; ')}.`, tone: 'info' as const }] : []),
        { text: 'This cannot be undone: a declined claim cannot be reopened; the person would have to file it again.', tone: 'warn' },
        ...(own.length ? [{ text: `${plural(own.length, 'claim')} of your own left out; someone else must decide those.`, tone: 'info' as const }] : []),
        ...(missing.length ? [{ text: `${plural(missing.length, 'id')} not found among pending claims; left out.`, tone: 'info' as const }] : []),
      ],
      undoable: false, typeToConfirm: claims.length >= 10 ? String(claims.length) : undefined,
      preview: { field: i.sendBack ? 'Sent back' : 'Declined', rows: claims.map((c) => ({ name: c.name, current: `${c.type} ${inr(c.amount)}, ${c.expenseDate.slice(0, 10)}`, next: i.sendBack ? 'Sent back (declined)' : 'Declined' })), skipped: [...own.map((c) => ({ who: c.name, reason: 'Your own claim' })), ...missing.map((id) => ({ who: id, reason: 'Not a pending claim' }))] },
      payload: { claimIds: claims.map((c) => c.id), byUserId: ctx.userId, note, total, sendBack: Boolean(i.sendBack) },
    });
    return { data: { prepared: true, title, claims: claims.length, total, employeeNote: note, note: 'Nothing changes until HR presses Confirm on the card. HR sees each claim in the table.' }, proposalId };
  },
});

defineExecutor('decline_claims', {
  async run(p) {
    const { claimIds, byUserId, note, total, sendBack } = p.payload as { claimIds: string[]; byUserId: string; note: string; total: number; sendBack: boolean };
    const failed: string[] = [];
    let done = 0;
    for (const id of claimIds) {
      try { await adminDecideReimbursement(byUserId, id, 'declined', note); done++; } catch (e) { failed.push((e as Error).message); }
    }
    if (!done) throw new Error(`No claim could be declined: ${failed[0] ?? 'unknown error'}`);
    return { message: `${sendBack ? 'Sent back' : 'Declined'} ${plural(done, 'claim')} (${inr(total)}) with your note.${failed.length ? ` ${failed.length} could not be: ${[...new Set(failed)].join('; ')}.` : ''}` };
  },
});
