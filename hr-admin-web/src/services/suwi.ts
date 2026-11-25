// Suwi, the HR assistant: ask, confirm or undo a prepared action, settings and activity.
import { api } from './http';

/** A review Suwi walked a manager through: opens the review page with these scores and comments filled in. */
export type SuwiReviewPrefill = { userId: string; period: string; parameters: { parameterId: string; score: number; note: string }[] };
export type SuwiLink = { label: string; view?: string; userId?: string; tab?: string; review?: SuwiReviewPrefill };
export type SuwiProposal = {
  id: string; kind: string; area: string; title: string; summary: string;
  lines: { text: string; why?: string; tone?: 'info' | 'warn' }[];
  effectiveFrom?: string; undoable: boolean; typeToConfirm?: string;
  status: 'pending' | 'done' | 'failed' | 'cancelled' | 'undone' | 'expired'; message?: string;
  /** A bulk change: each person's current and new value, and who was left out. */
  preview?: { field: string; rows: { name: string; current: string; next: string }[]; skipped: { who: string; reason: string }[] };
};
/** A list Suwi shows as a table under its answer (drawn from the data, not written by the model). */
export type SuwiTable = { title: string; columns: string[]; rows: (string | number)[][] };
export type SuwiAnswer = { text: string; checked: string[]; links: SuwiLink[]; proposals: SuwiProposal[]; costUsd: number; tables?: SuwiTable[]; path?: SuwiPath };
export type SuwiPath = 'instant' | 'model' | 'cache' | 'planner' | 'prepared' | 'router';
export type SuwiHistoryTurn = { role: 'user' | 'assistant'; text: string };

/**
 * A slow answer comes back as a ticket (`pending`); the answer is then fetched
 * every half second (with `partial`: the text written so far) until it is ready, for up to 5 minutes; meanwhile `onChecking` hears what Suwi is
 * looking at ("Attendance for 17 Nov"), for the panel to show. The signal keeps each check
 * out of the 20-second GET cache in http.ts.
 */
/** A file sent with a question: an image as base64, or a spreadsheet already read into CSV text. */
export type SuwiAttachment =
  | { kind: 'image'; name: string; mimeType: 'image/png' | 'image/jpeg'; data: string }
  | { kind: 'table'; name: string; text: string };
export async function askSuwi(question: string, page: string, history: SuwiHistoryTurn[], attachment?: SuwiAttachment, onChecking?: (what: string) => void, onPartial?: (textSoFar: string) => void): Promise<SuwiAnswer> {
  type Reply = { answer?: SuwiAnswer; pending?: string; checking?: string; partial?: string };
  const first = await api<Reply>('/suwi/ask', { method: 'POST', body: { question, page, history, ...(attachment ? { attachments: [attachment] } : {}) } });
  if (first.answer) return first.answer;
  if (first.checking) onChecking?.(first.checking);
  if (first.partial) onPartial?.(first.partial);
  const until = Date.now() + 5 * 60_000;
  // Quick checks while the answer is being written, so its first words show as soon as they exist.
  while (first.pending && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 500));
    const next = await api<Reply>(`/suwi/ask/${encodeURIComponent(first.pending)}`, { signal: new AbortController().signal });
    if (next.answer) return next.answer;
    if (next.checking) onChecking?.(next.checking);
    if (next.partial) onPartial?.(next.partial);
  }
  throw new Error('Suwi is taking too long to answer. Try again in a moment.');
}
export const confirmSuwiAction = (id: string, typed?: string) =>
  api<{ action: SuwiProposal }>(`/suwi/actions/${id}/confirm`, { method: 'POST', body: { typed } }).then((r) => r.action);
export const cancelSuwiAction = (id: string) => api(`/suwi/actions/${id}/cancel`, { method: 'POST' });
export const undoSuwiAction = (id: string) =>
  api<{ action: SuwiProposal }>(`/suwi/actions/${id}/undo`, { method: 'POST' }).then((r) => r.action);

export type SuwiLevel = 'answer' | 'suggest' | 'act';
export type SuwiSettingsDTO = {
  settings: { enabled: boolean; monthlyBudgetUsd: number; levels: Record<string, SuwiLevel>; spentThisMonthUsd: number };
  areas: { key: string; label: string; covers: string }[];
  levelLabels: Record<SuwiLevel, string>;
  service: { provider: string; model: string; ready: boolean };
  canEdit: boolean;
};
export const getSuwiSettings = () => api<SuwiSettingsDTO>('/suwi/settings');
export const saveSuwiSettings = (patch: { enabled?: boolean; monthlyBudgetUsd?: number; levels?: Record<string, SuwiLevel> }) =>
  api<{ settings: SuwiSettingsDTO['settings'] }>('/suwi/settings', { method: 'PUT', body: patch }).then((r) => r.settings);
/** One prompt in Suwi's history: what was asked, what Suwi answered, whether it worked, and its actions' outcome. */
export type SuwiActivityRow = {
  id: string; at: string; who: string; page: string | null;
  prompt: string; response: string | null;
  status: 'answered' | 'incomplete' | 'failed'; error: string | null;
  attachment: string | null;
  checks: { label: string; ok: boolean }[];
  actions: { title: string; status: 'pending' | 'done' | 'failed' | 'cancelled' | 'undone' | 'expired'; message: string | null }[];
  costUsd: number | null;
};
export const getSuwiActivity = (before?: string) =>
  api<{ activity: SuwiActivityRow[]; nextBefore: string | null }>(`/suwi/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`);

// —— Suwi › Response times (dashboard admins): how long each question took, and where the time went.
export type SuwiTimingRow = {
  at: string; userId: string; user: string | null; page: string | null; question: string; status: string | null;
  path: SuwiPath | null; totalMs: number | null; firstTextMs: number | null; writer: string | null; mode: string | null; live: boolean | null;
  rounds: { step?: string; model?: string; ms: number; input: number; output: number }[] | null;
  tools: { name: string; label?: string; ms: number; ok: boolean; timedOut?: boolean; memo?: boolean }[];
  tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null; costUsd: number | null;
};
export const getSuwiTimings = (q: { before?: string; path?: string; slowMs?: number; q?: string; limit?: number } = {}) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== 0) params.set(k, String(v));
  const qs = params.toString();
  return api<{ timings: SuwiTimingRow[]; next: string | null }>(`/suwi/timings${qs ? `?${qs}` : ''}`);
};
