/**
 * What Suwi keeps: per-company settings (on/off, monthly budget, how much it
 * may do in each area), the audit log of every question, tool call and
 * confirmed action, and the actions it has prepared and is waiting on HR for.
 */
import { ObjectId } from 'mongodb';
import { getDb } from '../config/db';
import { SUWI_AREAS, SuwiArea, SuwiLevel } from './tools';

export interface SuwiSettings {
  org: string;
  enabled: boolean;
  /** US$ a month; questions stop at the limit until next month. */
  monthlyBudgetUsd: number;
  levels: Record<SuwiArea, SuwiLevel>;
  updatedAt?: Date;
  updatedByUserId?: string;
}

export interface SuwiAuditEntry {
  _id?: ObjectId;
  org: string;
  userId: string;
  kind: 'question' | 'action' | 'settings';
  at: Date;
  page?: string;
  question?: string;
  answer?: string;
  tools?: { name: string; label: string; ms: number; ok: boolean }[];
  /** The file sent with the question (its name only; the file itself is not kept). */
  attachment?: { name: string; kind: 'image' | 'spreadsheet' };
  /** A confirmed or undone action, recorded as "via Suwi". */
  action?: { proposalId: string; kind: string; title: string; result: 'done' | 'failed' | 'undone'; message?: string };
  model?: string;
  costUsd?: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface SuwiProposal {
  _id?: ObjectId;
  org: string;
  userId: string;
  kind: string;
  area: SuwiArea;
  title: string;
  /** Plain-words summary, 1–4 lines. */
  summary: string;
  /** The "What will happen" lines, each with an optional Why? explainer. */
  lines: { text: string; why?: string; tone?: 'info' | 'warn' }[];
  effectiveFrom?: string;
  undoable: boolean;
  /** What HR must type to confirm a big change (a count or a name), if anything. */
  typeToConfirm?: string;
  /** Everything the executor needs; never shown to Claude after creation. */
  payload: Record<string, unknown>;
  /** Filled by the executor so Undo can put things back. */
  undo?: Record<string, unknown>;
  status: 'pending' | 'done' | 'failed' | 'cancelled' | 'undone' | 'expired';
  createdAt: Date;
  decidedAt?: Date;
  message?: string;
}

const settingsCol = () => getDb().collection<SuwiSettings>('suwi_settings');
export const auditCol = () => getDb().collection<SuwiAuditEntry>('suwi_audit');
export const proposalsCol = () => getDb().collection<SuwiProposal>('suwi_proposals');

export const DEFAULT_LEVELS: Record<SuwiArea, SuwiLevel> = {
  requests: 'act', attendance: 'act', people: 'act', payroll: 'suggest', claims: 'act', performance: 'act', connect: 'act', settings: 'answer',
};

/** Companies that have Suwi until an admin turns it off; every other company starts with it off. */
const ON_BY_DEFAULT = new Set(['sowaka', 'convrse']);

export async function settingsFor(org: string): Promise<SuwiSettings> {
  const s = await settingsCol().findOne({ org });
  return {
    org,
    enabled: s?.enabled ?? ON_BY_DEFAULT.has(org),
    monthlyBudgetUsd: s?.monthlyBudgetUsd ?? 25,
    levels: { ...DEFAULT_LEVELS, ...(s?.levels ?? {}) },
    updatedAt: s?.updatedAt,
    updatedByUserId: s?.updatedByUserId,
  };
}

export async function saveSettings(org: string, userId: string, patch: { enabled?: unknown; monthlyBudgetUsd?: unknown; levels?: unknown }) {
  const cur = await settingsFor(org);
  const next: SuwiSettings = { ...cur, updatedAt: new Date(), updatedByUserId: userId };
  const changes: string[] = [];
  if (typeof patch.enabled === 'boolean' && patch.enabled !== cur.enabled) { next.enabled = patch.enabled; changes.push(patch.enabled ? 'Turned Suwi on' : 'Turned Suwi off'); }
  if (patch.monthlyBudgetUsd !== undefined) {
    const b = Number(patch.monthlyBudgetUsd);
    if (!Number.isFinite(b) || b < 0 || b > 10000) throw Object.assign(new Error('Budget must be between $0 and $10,000 a month'), { statusCode: 400 });
    if (b !== cur.monthlyBudgetUsd) { next.monthlyBudgetUsd = Math.round(b * 100) / 100; changes.push(`Monthly budget $${cur.monthlyBudgetUsd} → $${next.monthlyBudgetUsd}`); }
  }
  if (patch.levels && typeof patch.levels === 'object') {
    for (const a of SUWI_AREAS) {
      const v = (patch.levels as Record<string, unknown>)[a.key];
      if (v === 'answer' || v === 'suggest' || v === 'act') {
        if (v !== cur.levels[a.key]) changes.push(`${a.label}: ${LEVEL_LABEL[cur.levels[a.key]]} → ${LEVEL_LABEL[v]}`);
        next.levels[a.key] = v;
      }
    }
  }
  await settingsCol().updateOne({ org }, { $set: next }, { upsert: true });
  if (changes.length) await auditCol().insertOne({ org, userId, kind: 'settings', at: new Date(), answer: changes.join('; ') });
  return next;
}
export const LEVEL_LABEL: Record<SuwiLevel, string> = { answer: 'Answer only', suggest: 'Suggest', act: 'Act after you confirm' };

/** This month's spend for a company, from the audit log. */
export async function spentThisMonthUsd(org: string): Promise<number> {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const [r] = await auditCol().aggregate<{ t: number }>([
    { $match: { org, at: { $gte: start }, costUsd: { $gt: 0 } } },
    { $group: { _id: null, t: { $sum: '$costUsd' } } },
  ]).toArray();
  return r?.t ?? 0;
}
