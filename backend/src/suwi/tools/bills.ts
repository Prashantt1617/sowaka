// Bills: reading the receipt on a claim. The file comes down from storage
// through the same presigned link the dashboard's viewer uses, is hashed (so
// the same bill on two claims is caught without any model call), and is shown
// to the small model once; the read is cached per claim and file in
// suwi_bill_reads, so a bill costs one read however often HR asks about it.
import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { getDb, reimbursementClaims, users } from '../../config/db';
import { getReceiptDownloadUrl } from '../../services/reimbursement.service';
import { callModel, costUsd, LlmReply, SUWI_MODEL } from '../llm';
import { auditCol } from '../store';
import { defineTools, rupees, str, SuwiContext } from '../tools';

/** The cheaper model reads first; the main one only re-reads when it isn't sure. */
export const SUWI_SMALL_MODEL = process.env.SUWI_SMALL_MODEL || SUWI_MODEL;
const LOW_CONFIDENCE = 0.6;
const MAX_BYTES = 12 * 1024 * 1024;

export interface BillRead {
  amount: number | null;
  date: string | null;
  vendor: string | null;
  gstin: string | null;
  /** 0 to 1: how sure the model is of the amount and date. */
  confidence: number;
}
interface BillReadRow {
  _id?: ObjectId;
  org: string;
  claimId: string;
  /** SHA-256 of the file bytes: the same bill filed twice has the same hash. */
  hash: string;
  size: number;
  contentType: string;
  read?: BillRead;
  model?: string;
  costUsd?: number;
  at: Date;
}
const billReads = () => getDb().collection<BillReadRow>('suwi_bill_reads');

/** Tests swap this for a stub so no bill read costs money. */
export const billModel: { call: typeof callModel } = { call: callModel };

const PROMPT = `This is a receipt or invoice an employee attached to an expense claim. Read it and reply with only a JSON object, no prose:
{"amount": <the total paid, in rupees, as a number, or null>, "date": <the bill date as YYYY-MM-DD, or null>, "vendor": <the seller or service name, or null>, "gstin": <the 15-character GSTIN if printed, or null>, "confidence": <0 to 1: how sure you are of the amount and date>}
If it is not a bill at all (a photo, a screenshot of something else, a logo), use nulls and confidence 0.`;

async function fetchReceipt(ctx: SuwiContext, claimId: string): Promise<{ bytes: Buffer; contentType: string; hash: string }> {
  const { url } = await getReceiptDownloadUrl(ctx.userId, claimId, true);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`The receipt could not be fetched from storage (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('The receipt is too large to read (over 12 MB)');
  const claim = await reimbursementClaims().findOne({ _id: new ObjectId(claimId) }, { projection: { receiptContentType: 1 } });
  const contentType = claim?.receiptContentType || res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  return { bytes, contentType, hash: createHash('sha256').update(bytes).digest('hex') };
}

/** The file's hash for a claim, fetching and recording it the first time. No model call. */
export async function receiptHash(ctx: SuwiContext, claimId: string): Promise<string> {
  const row = await billReads().findOne({ org: ctx.org, claimId });
  if (row) return row.hash;
  const f = await fetchReceipt(ctx, claimId);
  await billReads().updateOne({ org: ctx.org, claimId }, { $setOnInsert: { org: ctx.org, claimId, hash: f.hash, size: f.bytes.length, contentType: f.contentType, at: new Date() } }, { upsert: true });
  return f.hash;
}

function parseRead(reply: LlmReply): BillRead | null {
  const text = reply.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(/[^\d.]/g, ''))) ? Number(v.replace(/[^\d.]/g, '')) : null);
    const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
    const date = s(j.date);
    return {
      amount: n(j.amount), date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, vendor: s(j.vendor), gstin: s(j.gstin)?.toUpperCase() ?? null,
      confidence: Math.max(0, Math.min(1, n(j.confidence) ?? 0)),
    };
  } catch { return null; }
}

async function askModel(ctx: SuwiContext, model: string, f: { bytes: Buffer; contentType: string }, claimId: string): Promise<{ read: BillRead | null; cost: number }> {
  const reply = await billModel.call({
    model, system: 'You read Indian expense bills for an HR team. Reply with JSON only.', maxTokens: 300,
    messages: [{ role: 'user', content: PROMPT, images: [{ mimeType: f.contentType, data: f.bytes.toString('base64') }] }],
  });
  const cost = costUsd(reply.model || model, reply.usage);
  // Counted against the company's Suwi budget like any question.
  await auditCol().insertOne({ org: ctx.org, userId: ctx.userId, kind: 'question', at: new Date(), question: `Read the bill on claim ${claimId}`, answer: '', tools: [], model: reply.model || model, costUsd: cost, tokens: { input: reply.usage.input_tokens ?? 0, output: reply.usage.output_tokens ?? 0, cacheRead: 0, cacheWrite: 0 } });
  return { read: parseRead(reply), cost };
}

/** What the bill says, read once per claim and file. */
export async function readBill(ctx: SuwiContext, claimId: string): Promise<{ read: BillRead; hash: string; model: string; cached: boolean }> {
  const have = await billReads().findOne({ org: ctx.org, claimId });
  if (have?.read) return { read: have.read, hash: have.hash, model: have.model ?? '', cached: true };
  const f = await fetchReceipt(ctx, claimId);
  let model = SUWI_SMALL_MODEL;
  let { read, cost } = await askModel(ctx, model, f, claimId);
  if ((read?.confidence ?? 0) < LOW_CONFIDENCE && SUWI_SMALL_MODEL !== SUWI_MODEL) {
    const again = await askModel(ctx, SUWI_MODEL, f, claimId);
    if ((again.read?.confidence ?? 0) > (read?.confidence ?? 0)) { read = again.read; model = SUWI_MODEL; }
    cost += again.cost;
  }
  read ??= { amount: null, date: null, vendor: null, gstin: null, confidence: 0 };
  await billReads().updateOne(
    { org: ctx.org, claimId },
    { $set: { hash: f.hash, size: f.bytes.length, contentType: f.contentType, read, model, costUsd: cost, at: new Date() }, $setOnInsert: { org: ctx.org, claimId } },
    { upsert: true },
  );
  return { read, hash: f.hash, model, cached: false };
}

/** Other claims in this company carrying the very same file. */
export async function sameBillElsewhere(org: string, claimId: string, hash: string) {
  const rows = await billReads().find({ org, hash, claimId: { $ne: claimId } }, { projection: { claimId: 1 } }).toArray();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.claimId).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const claims = await reimbursementClaims().find({ _id: { $in: ids } }, { projection: { userId: 1, status: 1, amount: 1, expenseDate: 1 } }).toArray();
  const names = new Map((await users().find({ userId: { $in: claims.map((c) => c.userId) } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray()).map((u) => [u.userId, u.name]));
  return claims.map((c) => ({ claimId: c._id.toHexString(), userId: c.userId, name: names.get(c.userId) ?? c.userId, status: c.status, amount: c.amount, expenseDate: c.expenseDate.toISOString().slice(0, 10) }));
}

/** The bill against the claim, as short tags HR can scan. */
export function billTags(read: BillRead, claim: { amount: number; expenseDate: string }): string[] {
  const tags: string[] = [];
  if (read.confidence === 0 || (read.amount === null && read.date === null)) return ['bill unreadable or not a bill'];
  if (read.amount === null) tags.push('amount not found on the bill');
  else if (Math.abs(read.amount - claim.amount) <= Math.max(1, claim.amount * 0.01)) tags.push('amount matches the bill');
  else tags.push(`bill says ${rupees(read.amount * 100)}, claim says ${rupees(claim.amount * 100)}`);
  if (read.date === null) tags.push('date not found on the bill');
  else if (read.date === claim.expenseDate) tags.push('date matches the bill');
  else tags.push(`bill dated ${read.date}, claim dated ${claim.expenseDate}`);
  if (read.confidence < LOW_CONFIDENCE) tags.push('low-confidence read');
  return tags;
}

defineTools({
  name: 'read_bill',
  area: 'claims',
  label: (i) => `Read the bill on claim ${str(i.claimId).slice(-6)}`,
  description: "Read the receipt attached to one reimbursement claim (image or PDF) and compare it with the claim: amount, date, vendor, GSTIN, confidence; whether the amount and date match; and whether the same file was attached to another claim. Costs a model read the first time; cached after. Get claim ids from claims_to_check or claims_by_person.",
  input_schema: { type: 'object', properties: { claimId: { type: 'string' } }, required: ['claimId'] },
  api: { method: 'GET', path: '/admin/reimbursements' },
  async run(ctx, i) {
    const id = str(i.claimId);
    if (!ObjectId.isValid(id)) throw new Error('Invalid claim id');
    const claim = await reimbursementClaims().findOne({ _id: new ObjectId(id) });
    if (!claim) throw new Error('Claim not found');
    const owner = await users().findOne({ userId: claim.userId, org: ctx.org }, { projection: { _id: 0, name: 1 } });
    if (!owner) throw new Error('Claim not found');
    if (!claim.receiptObjectKey) return { data: { claimId: id, name: owner.name, hasReceipt: false, message: 'No bill is attached to this claim.' } };
    const expenseDate = claim.expenseDate.toISOString().slice(0, 10);
    const r = await readBill(ctx, id);
    const same = await sameBillElsewhere(ctx.org, id, r.hash);
    return {
      data: {
        claim: { id, userId: claim.userId, name: owner.name, type: claim.category, amount: claim.amount, expenseDate, status: claim.status, receiptName: claim.receiptName },
        bill: r.read, checks: [...billTags(r.read, { amount: claim.amount, expenseDate }), ...same.map((s) => `same file as ${s.name}'s ${s.status} claim of ${rupees(s.amount * 100)} dated ${s.expenseDate}`)],
        sameBillAs: same, readBy: r.model, cached: r.cached,
      },
      links: [{ label: 'Open reimbursements', view: 'reimbursements' }],
    };
  },
});
