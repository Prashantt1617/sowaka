// Claims: the pending pile with the checks the dashboard's rules imply (bill
// attached, per-claim limit, backdating window, monthly cap of the linked
// salary component, duplicates, the same file on two claims, what the bill
// itself says), totals per person, and the one action Suwi can take here:
// approving a chosen set after HR confirms. Approval goes through the same
// service as the dashboard's button, and cannot be undone: there is no
// service that turns an approved claim back into a pending one.
import { ObjectId } from 'mongodb';
import { payHeads, payslips } from '../../config/db';
import { adminDecideReimbursement, listAllReimbursementsForAdmin } from '../../services/reimbursement.service';
import { typesForOrg } from '../../services/reimbursement-type.service';
import { billCategories, billsByComponent, reimbursementsPaidBefore } from '../../services/reimbursementBills.service';
import { tdsConfigsFor } from '../../services/tds.service';
import { fyOf, roundToTenRupees, taxOnIncome } from '../../shared/payroll/tds';
import { defineTools, monthOf, num, rupees, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { billTags, readBill, receiptHash, sameBillElsewhere } from './bills';

type ClaimView = Awaited<ReturnType<typeof listAllReimbursementsForAdmin>>[number];
const days = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export interface CheckedClaim {
  id: string; userId: string; name: string; department: string; type: string; amount: number; expenseDate: string; filed: string; daysWaiting: number; hasReceipt: boolean;
  checks: string[];
  bill?: { amount: number | null; date: string | null; vendor: string | null; confidence: number };
}

/**
 * Every pending claim with what needs a closer look. `bills`: 'hash' also
 * fetches each receipt to catch the same file on two claims (no model cost);
 * 'read' also reads the bills not yet read (a model call each, capped).
 */
export async function checkedPending(ctx: SuwiContext, bills: 'none' | 'hash' | 'read' = 'none', maxReads = 10): Promise<CheckedClaim[]> {
  const [all, types, heads] = await Promise.all([
    listAllReimbursementsForAdmin(ctx.userId),
    typesForOrg(ctx.org),
    payHeads().find({ org: ctx.org, category: 'reimbursement' }, { projection: { _id: 0, code: 1, name: 1, maxClaimablePaise: 1 } }).toArray(),
  ]);
  const typeOf = new Map(types.map((t) => [t.name.toLowerCase(), t]));
  const headOf = new Map(heads.map((h) => [h.code, h]));
  const pending = all.filter((c) => c.status === 'pending');
  const out: CheckedClaim[] = [];
  let reads = 0;
  for (const c of pending) {
    const checks: string[] = [];
    const t = typeOf.get(c.category);
    if (!c.hasReceipt) checks.push('no bill attached');
    if (!t) checks.push(`type "${c.category}" is no longer offered`);
    else {
      if (!t.active) checks.push(`${t.name} is switched off`);
      if (t.maxLimit > 0 && c.amount > t.maxLimit) checks.push(`over the ${t.name} limit of ${rupees(t.maxLimit * 100)} per claim`);
      const back = days(c.expenseDate, c.createdAt);
      if (back > (t.backdateDays ?? 30)) checks.push(`dated ${back} days before it was filed (${t.name} allows ${t.backdateDays ?? 30})`);
      const head = t.payHeadCode ? headOf.get(t.payHeadCode) : undefined;
      if (head?.maxClaimablePaise) {
        const month = c.expenseDate.slice(0, 7);
        const inMonth = all.filter((o) => o.userId === c.userId && o.category === c.category && o.status !== 'declined' && o.expenseDate.slice(0, 7) === month).reduce((s, o) => s + o.amount, 0);
        if (inMonth * 100 > head.maxClaimablePaise) checks.push(`takes ${head.name} past its monthly cap of ${rupees(head.maxClaimablePaise)} (${rupees(inMonth * 100)} claimed for ${month})`);
      }
    }
    const twin = all.find((o) => o.id !== c.id && o.userId === c.userId && o.amount === c.amount && o.expenseDate === c.expenseDate);
    if (twin) checks.push(`same amount and date as ${c.employee.name.split(' ')[0]}'s ${twin.status} claim of ${twin.createdAt.slice(0, 10)}`);
    let bill: CheckedClaim['bill'];
    if (c.hasReceipt && bills !== 'none') {
      try {
        let hash: string;
        if (bills === 'read' && reads < maxReads) {
          const r = await readBill(ctx, c.id);
          if (!r.cached) reads++;
          hash = r.hash;
          bill = { amount: r.read.amount, date: r.read.date, vendor: r.read.vendor, confidence: r.read.confidence };
          checks.push(...billTags(r.read, c).filter((x) => !x.startsWith('amount matches') && !x.startsWith('date matches')));
        } else hash = await receiptHash(ctx, c.id);
        for (const s of await sameBillElsewhere(ctx.org, c.id, hash)) checks.push(`same file as ${s.name}'s ${s.status} claim of ${rupees(s.amount * 100)} dated ${s.expenseDate}`);
      } catch (e) {
        checks.push(`bill could not be checked (${(e as Error).message})`);
      }
    }
    out.push({
      id: c.id, userId: c.userId, name: c.employee.name, department: c.employee.department, type: title(c.category), amount: c.amount, expenseDate: c.expenseDate,
      filed: c.createdAt.slice(0, 10), daysWaiting: Math.max(0, days(c.createdAt, ctx.today)), hasReceipt: c.hasReceipt, checks, ...(bill ? { bill } : {}),
    });
  }
  return out.sort((a, b) => b.daysWaiting - a.daysWaiting);
}

/** What approving these does to taxable income, in one line, from the payroll bills logic. Rough on purpose. */
async function taxLine(ctx: SuwiContext, claims: CheckedClaim[]): Promise<{ text: string; why?: string; tone?: 'info' | 'warn' }> {
  const cats = await billCategories(ctx.org);
  const linked = claims.filter((c) => cats.has(c.type.toLowerCase()));
  const plain = claims.filter((c) => !cats.has(c.type.toLowerCase()));
  const paidOut = plain.length ? `${rupees(plain.reduce((s, c) => s + c.amount, 0) * 100)} in expense claims goes out with the next payroll run.` : '';
  if (!linked.length) return { text: `${paidOut} Taxable income is unchanged.`.trim(), why: 'None of these types is linked to a salary reimbursement component, so they are paid out, not set against salary already paid.' };
  const d = new Date(Date.parse(`${ctx.today}T00:00:00Z`));
  const next = `${d.getUTCFullYear() + (d.getUTCMonth() === 11 ? 1 : 0)}-${String(((d.getUTCMonth() + 1) % 12) + 1).padStart(2, '0')}`;
  const uids = [...new Set(linked.map((c) => c.userId))];
  const [paid, billed, heads] = await Promise.all([reimbursementsPaidBefore(ctx.org, uids, next), billsByComponent(cats, uids, next, new Date()), payHeads().find({ org: ctx.org, category: 'reimbursement' }, { projection: { _id: 0, code: 1, taxable: 1 } }).toArray()]);
  const notTaxable = new Set(heads.filter((h) => h.taxable === false).map((h) => h.code));
  let dropPaise = 0;
  let savedPaise = 0;
  let noRun = 0;
  const { fy } = fyOf(next);
  const configs = await tdsConfigsFor(fy);
  for (const uid of uids) {
    const room = new Map<string, number>();
    let drop = 0;
    for (const c of linked.filter((x) => x.userId === uid)) {
      const code = cats.get(c.type.toLowerCase())!;
      if (notTaxable.has(code)) continue;
      const left = room.get(code) ?? Math.max(0, (paid.get(uid)?.get(code) ?? 0) - (billed.get(uid)?.get(code) ?? 0));
      const use = Math.min(Math.round(c.amount * 100), left);
      room.set(code, left - use);
      drop += use;
    }
    dropPaise += drop;
    if (!drop) continue;
    const slip = await payslips().find({ org: ctx.org, userId: uid, 'inputs.tds': { $exists: true } } as never, { projection: { 'inputs.tds': 1 }, sort: { period: -1 }, limit: 1 }).next();
    const tds = slip?.inputs?.tds;
    const cfg = tds ? configs.get(tds.regime) : undefined;
    if (!tds || !cfg) { noRun++; continue; }
    savedPaise += Math.max(0, taxOnIncome(roundToTenRupees(tds.taxableIncomePaise), cfg).annualTaxPaise - taxOnIncome(roundToTenRupees(Math.max(0, tds.taxableIncomePaise - drop)), cfg).annualTaxPaise);
  }
  const who = uids.length === 1 ? linked[0].name.split(' ')[0] : `${uids.length} people`;
  const text = dropPaise
    ? `Taxable income drops by about ${rupees(dropPaise)} for ${who}; about ${rupees(savedPaise)} less tax, given back over the months left in this financial year from the next run.${noRun ? ` (No TDS run yet for ${noRun}, so their tax part is not counted.)` : ''} ${paidOut}`.trim()
    : `These bills don't lower taxable income yet: nothing of ${linked.map((c) => c.type).filter((v, i, a) => a.indexOf(v) === i).join(', ')} has been paid this financial year beyond what bills already cover. ${paidOut}`.trim();
  return { text, why: 'A salary reimbursement (Fuel, Internet…) is paid every month and taxed until bills come in. Approved bills make that much of what was paid this year tax-free, never more than was paid; TDS is reworked on the year\'s figures each month, so the saving spreads over the coming runs. The figure here is an estimate from the latest TDS worksheet.' };
}

defineTools(
  {
    name: 'claims_to_check',
    area: 'claims',
    label: (i) => (i.bills === 'read' ? 'Pending claims, bills read' : 'Pending claims and their checks'),
    description: 'Pending reimbursement claims split into clean ones and ones that need a closer look, with the reason for each: no bill attached, over the type\'s per-claim limit, dated beyond the type\'s backdating window, past the linked salary component\'s monthly cap, same amount and date as another claim, the same file attached to another claim, or the bill not matching the claim. bills="hash" fetches each receipt to catch duplicate files (no model cost); bills="read" also reads each bill (amount, date, vendor) and compares, at most maxReads new reads. Use for "which claims need a closer look", "anything odd in the pending claims", "are any bills reused".',
    input_schema: { type: 'object', properties: { bills: { type: 'string', enum: ['none', 'hash', 'read'], description: 'Default hash' }, maxReads: { type: 'number', description: 'Default 10' }, limit: { type: 'number' } } },
    api: { method: 'GET', path: '/admin/reimbursements' },
    async run(ctx, i) {
      const mode = (['none', 'hash', 'read'] as const).find((m) => m === i.bills) ?? 'hash';
      const rows = await checkedPending(ctx, mode, num(i.maxReads, 10, 0, 20));
      const limit = num(i.limit, 25, 1, 200);
      const clean = rows.filter((r) => !r.checks.length);
      const check = rows.filter((r) => r.checks.length);
      const sum = (xs: CheckedClaim[]) => xs.reduce((s, r) => s + r.amount, 0);
      return {
        data: {
          pending: rows.length, totalAmount: sum(rows),
          clean: { count: clean.length, amount: sum(clean), claims: clean.slice(0, limit) },
          needsALook: { count: check.length, amount: sum(check), claims: check.slice(0, limit) },
          billsRead: mode === 'read' ? rows.filter((r) => r.bill).length : 0,
          note: mode === 'none' ? 'Receipts were not fetched; ask with bills="hash" or "read" to check the files themselves.' : mode === 'hash' ? 'Files were compared by hash; bills not yet read were not compared with the claim (ask with bills="read").' : undefined,
        },
        links: [{ label: 'Open reimbursements', view: 'reimbursements' }],
      };
    },
  },
  {
    name: 'claims_by_person',
    area: 'claims',
    label: (i) => `Claims per person, ${i.period === 'fy' ? 'this financial year' : i.period === 'all' ? 'all time' : i.month ?? 'this month'}`,
    description: 'Reimbursement claim totals per person: approved, paid, pending and declined (count and ₹), with a split by type. By expense month (default this month), this financial year, or all time; optionally one person (userId from search_people) or one type. Use for FBP/limit questions like "how much has X claimed for internet this year", "who has the most pending".',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' }, period: { type: 'string', enum: ['month', 'fy', 'all'] }, userId: { type: 'string' }, type: { type: 'string', description: 'Reimbursement type name' }, limit: { type: 'number' } } },
    api: { method: 'GET', path: '/admin/reimbursements' },
    async run(ctx, i) {
      const period = str(i.period) || 'month';
      const month = monthOf(i.month, ctx.today);
      const fyStart = fyOf(month).firstPeriod;
      const fyEnd = `${Number(fyStart.slice(0, 4)) + 1}-03`;
      const uid = str(i.userId);
      const type = str(i.type).toLowerCase();
      const all = (await listAllReimbursementsForAdmin(ctx.userId)).filter((c) => {
        const m = c.expenseDate.slice(0, 7);
        if (period === 'month' && m !== month) return false;
        if (period === 'fy' && (m < fyStart || m > fyEnd)) return false;
        if (uid && c.userId !== uid) return false;
        if (type && c.category !== type) return false;
        return true;
      });
      const per = new Map<string, { userId: string; name: string; department: string; approved: { count: number; amount: number }; paid: { count: number; amount: number }; pending: { count: number; amount: number }; declined: { count: number; amount: number }; byType: Record<string, number> }>();
      for (const c of all) {
        const p = per.get(c.userId) ?? { userId: c.userId, name: c.employee.name, department: c.employee.department, approved: { count: 0, amount: 0 }, paid: { count: 0, amount: 0 }, pending: { count: 0, amount: 0 }, declined: { count: 0, amount: 0 }, byType: {} };
        const s = p[c.status as 'approved' | 'paid' | 'pending' | 'declined'];
        s.count++; s.amount += c.amount;
        if (c.status !== 'declined') p.byType[title(c.category)] = (p.byType[title(c.category)] ?? 0) + c.amount;
        per.set(c.userId, p);
      }
      const rows = [...per.values()].sort((a, b) => (b.approved.amount + b.paid.amount + b.pending.amount) - (a.approved.amount + a.paid.amount + a.pending.amount));
      const tot = (k: 'approved' | 'paid' | 'pending' | 'declined') => rows.reduce((s, r) => s + r[k].amount, 0);
      const types = await typesForOrg(ctx.org);
      return {
        data: {
          period: period === 'month' ? month : period === 'fy' ? `FY ${fyOf(month).fy}` : 'all time', people: rows.length, claims: all.length,
          totals: { approved: tot('approved'), paid: tot('paid'), pending: tot('pending'), declined: tot('declined') },
          limits: types.filter((t) => t.active).map((t) => ({ type: t.name, perClaim: t.maxLimit || null, backdateDays: t.backdateDays ?? 30, salaryComponent: t.payHeadCode ?? null })),
          rows: rows.slice(0, num(i.limit, 25, 1, 200)),
          note: 'Approved and paid both count as settled; paid means a payroll run has included it. Amounts in ₹.',
        },
        links: [{ label: 'Open reimbursements', view: 'reimbursements' }],
      };
    },
  },
  {
    name: 'prepare_approve_claims',
    area: 'claims',
    acts: true,
    label: (i) => `Prepared: approve ${Array.isArray(i.claimIds) ? i.claimIds.length : 'the clean'} claims`,
    description: 'Prepare approving a set of pending reimbursement claims. Changes nothing: it makes a "What will happen" card (total, people, what the bills say, the effect on taxable income) for HR to confirm by typing the count. With no claimIds, it takes every pending claim that passed all checks (claims_to_check). Never includes the asker\'s own claims. Approval cannot be undone.',
    input_schema: { type: 'object', properties: { claimIds: { type: 'array', items: { type: 'string' }, description: 'Claim ids to approve; omit for all clean pending claims' } } },
    api: { method: 'PATCH', path: '/admin/reimbursements/x/decision' },
    async run(ctx, i) {
      const wanted = Array.isArray(i.claimIds) ? [...new Set(i.claimIds.map(String))].filter((id) => ObjectId.isValid(id)).slice(0, 200) : null;
      const all = await checkedPending(ctx, 'hash');
      const chosen = (wanted ? all.filter((c) => wanted.includes(c.id)) : all.filter((c) => !c.checks.length));
      const missing = wanted ? wanted.filter((id) => !all.some((c) => c.id === id)) : [];
      const own = chosen.filter((c) => c.userId === ctx.userId);
      const claims = chosen.filter((c) => c.userId !== ctx.userId);
      if (!claims.length) return { data: { nothingToDo: true, message: wanted ? `None of those claims is pending${own.length ? ' (your own claims can\'t be decided by you)' : ''}.` : 'No pending claim passed every check; nothing to approve as a batch. Ask for the ones that need a look.' } };
      const total = claims.reduce((s, c) => s + c.amount, 0);
      const people = [...new Set(claims.map((c) => c.name))];
      const flagged = claims.filter((c) => c.checks.length);
      const tax = await taxLine(ctx, claims);
      const byType = Object.entries(claims.reduce<Record<string, number>>((m, c) => ({ ...m, [c.type]: (m[c.type] ?? 0) + c.amount }), {}));
      const who = people.length === 1 ? people[0] : `${people.length} people`;
      const proposalId = await propose(ctx, {
        kind: 'approve_claims', area: 'claims', title: `Approve ${claims.length} claim${claims.length === 1 ? '' : 's'} (${rupees(total * 100)})`,
        summary: `${claims.length} claim${claims.length === 1 ? '' : 's'} from ${who}, ${rupees(total * 100)} in all: ${byType.map(([t, a]) => `${t} ${rupees(a * 100)}`).join(', ')}.`,
        lines: [
          { text: `People: ${people.slice(0, 8).join(', ')}${people.length > 8 ? ` and ${people.length - 8} more` : ''}.` },
          { text: flagged.length ? `${flagged.length} of these had a check against it: ${flagged.slice(0, 4).map((c) => `${c.name.split(' ')[0]} (${c.checks[0]})`).join('; ')}${flagged.length > 4 ? '; …' : ''}.` : 'Every claim here passed the checks: bill attached, within its type\'s limit and backdating window, no duplicate amount, date or file.', tone: flagged.length ? 'warn' : 'info', why: 'Checks come from Reimbursement types (limit per claim, days back), the linked salary component\'s monthly cap, and the files themselves.' },
          ...(claims.some((c) => c.bill) ? [{ text: `Bills read: ${claims.filter((c) => c.bill).map((c) => `${c.name.split(' ')[0]} ${c.bill!.amount === null ? 'unreadable' : rupees(c.bill!.amount * 100)}${c.bill!.vendor ? ` at ${c.bill!.vendor}` : ''}`).slice(0, 6).join('; ')}.` }] : []),
          tax,
          { text: 'Each claim is approved as you, with the note "Approved via Suwi"; the person sees it in their app at once.' },
          { text: 'This cannot be undone: an approved claim can only go on to Paid, not back to Pending.', tone: 'warn', why: 'Sowaka has no step that reopens a decided claim; the next payroll run picks approved claims up. If one is wrong, decline it before that run or correct it on the run.' },
          ...(own.length ? [{ text: `${own.length} of your own claim${own.length === 1 ? ' was' : 's were'} left out; someone else must decide those.`, tone: 'info' as const }] : []),
          ...(missing.length ? [{ text: `${missing.length} id${missing.length === 1 ? '' : 's'} not found among pending claims; left out.`, tone: 'info' as const }] : []),
        ],
        undoable: false, typeToConfirm: String(claims.length),
        payload: { claimIds: claims.map((c) => c.id), byUserId: ctx.userId, total, names: people },
      });
      return { data: { prepared: true, title: `Approve ${claims.length} claims`, claims: claims.length, total, people, flagged: flagged.length, leftOut: { own: own.length, notPending: missing.length }, tax: tax.text, note: `Nothing is saved until HR types ${claims.length} and presses Confirm on the card. Approval cannot be undone.` }, proposalId };
    },
  },
);

defineExecutor('approve_claims', {
  async run(p) {
    const { claimIds, byUserId, total } = p.payload as { claimIds: string[]; byUserId: string; total: number };
    const failed: string[] = [];
    let done = 0;
    for (const id of claimIds) {
      try { await adminDecideReimbursement(byUserId, id, 'approved', 'Approved via Suwi'); done++; } catch (e) { failed.push((e as Error).message); }
    }
    if (!done) throw new Error(`No claim could be approved: ${failed[0] ?? 'unknown error'}`);
    return { message: `Approved ${done} claim${done === 1 ? '' : 's'} (${rupees(total * 100)}).${failed.length ? ` ${failed.length} could not be: ${[...new Set(failed)].join('; ')}.` : ''}` };
  },
});
