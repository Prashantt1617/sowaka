// Suwi, the HR assistant: ask, confirm or undo a prepared action, settings and activity.
import { api } from './http';

export type SuwiLink = { label: string; view?: string; userId?: string; tab?: string };
export type SuwiProposal = {
  id: string; kind: string; area: string; title: string; summary: string;
  lines: { text: string; why?: string; tone?: 'info' | 'warn' }[];
  effectiveFrom?: string; undoable: boolean; typeToConfirm?: string;
  status: 'pending' | 'done' | 'failed' | 'cancelled' | 'undone' | 'expired'; message?: string;
};
export type SuwiAnswer = { text: string; checked: string[]; links: SuwiLink[]; proposals: SuwiProposal[]; costUsd: number };
export type SuwiHistoryTurn = { role: 'user' | 'assistant'; text: string };

/**
 * A slow answer comes back as a ticket (`pending`); the answer is then fetched
 * every 2 s until it is ready, for up to 5 minutes. The signal keeps each check
 * out of the 20-second GET cache in http.ts.
 */
export async function askSuwi(question: string, page: string, history: SuwiHistoryTurn[]): Promise<SuwiAnswer> {
  type Reply = { answer?: SuwiAnswer; pending?: string };
  const first = await api<Reply>('/suwi/ask', { method: 'POST', body: { question, page, history } });
  if (first.answer) return first.answer;
  const until = Date.now() + 5 * 60_000;
  while (first.pending && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000));
    const next = await api<Reply>(`/suwi/ask/${encodeURIComponent(first.pending)}`, { signal: new AbortController().signal });
    if (next.answer) return next.answer;
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
export type SuwiActivityRow = { at: string; who: string; kind: 'question' | 'action' | 'settings'; text?: string; tools?: string[]; costUsd?: number };
export const getSuwiActivity = () => api<{ activity: SuwiActivityRow[] }>('/suwi/activity').then((r) => r.activity);
