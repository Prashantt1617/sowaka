/**
 * Prepared actions. A tool in an "Act after you confirm" area never changes
 * anything: it works out the consequences and saves a proposal. The panel
 * shows it as a "What will happen" card; only HR's Confirm runs it, through
 * the same service the dashboard's own button uses, as that HR person. Each
 * result goes in the audit log as "via Suwi", with Undo where it's possible.
 */
import { ObjectId } from 'mongodb';
import { SuwiContext } from './tools';
import { auditCol, proposalsCol, SuwiProposal } from './store';

export class SuwiActionError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'SuwiActionError';
  }
}

export interface Executor {
  /** Makes the change. Returns a one-line result, and what Undo needs. */
  run: (p: SuwiProposal) => Promise<{ message: string; undo?: Record<string, unknown> }>;
  undo?: (p: SuwiProposal) => Promise<string>;
}
const EXECUTORS = new Map<string, Executor>();
export function defineExecutor(kind: string, e: Executor) {
  if (EXECUTORS.has(kind)) throw new Error(`Suwi executor ${kind} defined twice`);
  EXECUTORS.set(kind, e);
}

const TTL_MS = 30 * 60_000;

/** Saves a prepared change; returns its id for the card. */
export async function propose(ctx: SuwiContext, p: Omit<SuwiProposal, '_id' | 'org' | 'userId' | 'status' | 'createdAt'>): Promise<string> {
  if (!EXECUTORS.has(p.kind)) throw new Error(`No executor for ${p.kind}`);
  const { insertedId } = await proposalsCol().insertOne({ ...p, org: ctx.org, userId: ctx.userId, status: 'pending', createdAt: new Date() });
  return insertedId.toHexString();
}

/** The card as the panel shows it (no payload). */
export function proposalView(p: SuwiProposal) {
  return {
    id: p._id!.toHexString(), kind: p.kind, area: p.area, title: p.title, summary: p.summary, lines: p.lines,
    effectiveFrom: p.effectiveFrom, undoable: p.undoable, typeToConfirm: p.typeToConfirm, status: p.status, message: p.message,
  };
}

async function mine(userId: string, org: string, id: string) {
  if (!ObjectId.isValid(id)) throw new SuwiActionError(400, 'Invalid action');
  const p = await proposalsCol().findOne({ _id: new ObjectId(id), org, userId });
  if (!p) throw new SuwiActionError(404, 'That action was not found');
  return p;
}

export async function getProposal(userId: string, org: string, id: string) {
  return proposalView(await mine(userId, org, id));
}

export async function confirmProposal(userId: string, org: string, id: string, typed?: unknown) {
  const p = await mine(userId, org, id);
  if (p.status !== 'pending') throw new SuwiActionError(409, `This action is already ${p.status}`);
  if (Date.now() - p.createdAt.getTime() > TTL_MS) {
    await proposalsCol().updateOne({ _id: p._id }, { $set: { status: 'expired' } });
    throw new SuwiActionError(409, 'This was prepared more than 30 minutes ago. Ask Suwi again so the details are current.');
  }
  if (p.typeToConfirm && String(typed ?? '').trim().toLowerCase() !== p.typeToConfirm.trim().toLowerCase()) {
    throw new SuwiActionError(400, `Type ${p.typeToConfirm} to confirm`);
  }
  // Claim it first so a double click can't run it twice.
  const claimed = await proposalsCol().updateOne({ _id: p._id, status: 'pending' }, { $set: { status: 'done', decidedAt: new Date() } });
  if (!claimed.modifiedCount) throw new SuwiActionError(409, 'This action is already being handled');
  const ex = EXECUTORS.get(p.kind)!;
  try {
    const r = await ex.run(p);
    await proposalsCol().updateOne({ _id: p._id }, { $set: { message: r.message, ...(r.undo ? { undo: r.undo } : {}) } });
    await auditCol().insertOne({ org, userId, kind: 'action', at: new Date(), action: { proposalId: id, kind: p.kind, title: p.title, result: 'done', message: r.message } });
    return { ...proposalView({ ...p, status: 'done', message: r.message }), undoable: p.undoable && Boolean(ex.undo) };
  } catch (e) {
    const message = (e as Error).message;
    await proposalsCol().updateOne({ _id: p._id }, { $set: { status: 'failed', message } });
    await auditCol().insertOne({ org, userId, kind: 'action', at: new Date(), action: { proposalId: id, kind: p.kind, title: p.title, result: 'failed', message } });
    throw new SuwiActionError((e as { statusCode?: number }).statusCode ?? 400, message);
  }
}

export async function cancelProposal(userId: string, org: string, id: string) {
  await proposalsCol().updateOne({ _id: new ObjectId(id), org, userId, status: 'pending' }, { $set: { status: 'cancelled', decidedAt: new Date() } });
  return { cancelled: true };
}

export async function undoProposal(userId: string, org: string, id: string) {
  const p = await mine(userId, org, id);
  const ex = EXECUTORS.get(p.kind);
  if (p.status !== 'done' || !p.undoable || !ex?.undo) throw new SuwiActionError(409, 'This action cannot be undone');
  const message = await ex.undo(p);
  await proposalsCol().updateOne({ _id: p._id }, { $set: { status: 'undone', message } });
  await auditCol().insertOne({ org, userId, kind: 'action', at: new Date(), action: { proposalId: id, kind: p.kind, title: p.title, result: 'undone', message } });
  return proposalView({ ...p, status: 'undone', message });
}
