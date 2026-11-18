// The onboarding board's columns and card wording, shared by the board (H1) and the joiner
// panel (H1b). Pre-boarding shows the design's four steps (Offer sent, Offer confirmed,
// Employee profile, Joining), each one or two of the server's columns; the other tabs show
// the server's columns as they are.
import type { BoardCard, BoardColumn, BoardTab } from '../../../services/lifecycle';
import { daysTo } from './format';

export interface Tone { bg: string; fg: string }
export const TONE = {
  risk: { bg: 'var(--bad-bg)', fg: 'var(--bad)' },
  warn: { bg: 'var(--warn-bg)', fg: 'var(--warn)' },
  ok: { bg: 'var(--ok-bg)', fg: 'var(--ok)' },
  wait: { bg: 'var(--mute-bg)', fg: 'var(--ink-2)' },
  soon: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
} satisfies Record<string, Tone>;

export interface ColumnDef { key: string; label: string; from: BoardColumn[] }
export const PRE_COLUMNS: ColumnDef[] = [
  { key: 'offer_sent', label: 'Offer sent', from: ['offer_sent'] },
  { key: 'confirmed', label: 'Offer confirmed', from: ['accepted'] },
  { key: 'profile', label: 'Employee profile', from: ['documents', 'letters'] },
  { key: 'joining', label: 'Joining', from: ['ready_to_join'] },
];
export const OTHER_COLUMNS: Record<Exclude<BoardTab, 'pre_boarding'>, ColumnDef[]> = {
  first_week: [
    { key: 'day1', label: 'Day 1', from: ['day1'] }, { key: 'week1_tasks', label: 'Week-1 tasks', from: ['week1_tasks'] },
    { key: 'day7_survey', label: 'Day-7 survey', from: ['day7_survey'] }, { key: 'week_done', label: 'Week done', from: ['week_done'] },
  ],
  probation: [
    { key: 'month1', label: 'Month 1', from: ['month1'] }, { key: 'months_2_5', label: 'Months 2–5', from: ['months_2_5'] },
    { key: 'final_month', label: 'Final month', from: ['final_month'] }, { key: 'confirmed', label: 'Confirmed', from: ['confirmed'] },
  ],
};
export const columnsOf = (tab: BoardTab): ColumnDef[] => (tab === 'pre_boarding' ? PRE_COLUMNS : OTHER_COLUMNS[tab]);
/** A server column's step on the board, as the design names it ("Employee profile" for Documents and Letters to sign). */
export function columnLabel(column: string): string {
  for (const cols of [PRE_COLUMNS, OTHER_COLUMNS.first_week, OTHER_COLUMNS.probation]) {
    const hit = cols.find((c) => c.from.includes(column as BoardColumn));
    if (hit) return hit.label;
  }
  return column;
}
export const TAB_LABELS: Record<BoardTab | 'closed', string> = { pre_boarding: 'Pre-boarding', first_week: 'First week', probation: 'Probation', closed: 'Closed' };

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** "This week", "Next week" or "In 12 days" before a joining day; "Joined" after it. */
export function weekOf(tj?: string): string {
  if (!tj) return '';
  const n = daysTo(tj);
  if (n < 0) return 'Joined';
  if (n <= 6) return n === 0 ? 'Today' : 'This week';
  if (n <= 13) return 'Next week';
  return `In ${n} days`;
}

/** The offer's reply state on a pre-boarding card and in the list's Offer filter. */
export type OfferState = 'Not sent' | 'Overdue' | 'Reply due soon' | 'Awaiting reply' | 'Confirmed';
export const OFFER_STATES: OfferState[] = ['Overdue', 'Reply due soon', 'Awaiting reply', 'Not sent', 'Confirmed'];
const OFFER_TONE: Record<OfferState, Tone> = { 'Not sent': TONE.wait, Overdue: TONE.risk, 'Reply due soon': TONE.warn, 'Awaiting reply': TONE.wait, Confirmed: TONE.ok };

export function offerOf(card: Pick<BoardCard, 'column' | 'status' | 'replyBy'>): { state: OfferState; label: string; tone: Tone } {
  if (card.column !== 'offer_sent') return { state: 'Confirmed', label: 'Confirmed', tone: OFFER_TONE.Confirmed };
  if (card.status === 'draft') return { state: 'Not sent', label: 'Offer not sent yet', tone: OFFER_TONE['Not sent'] };
  const n = card.replyBy ? daysTo(card.replyBy) : null;
  if (n !== null && n < 0) return { state: 'Overdue', label: `Overdue by ${days(-n)}`, tone: OFFER_TONE.Overdue };
  if (n !== null && n <= 2) return { state: 'Reply due soon', label: n === 0 ? 'Reply due today' : n === 1 ? 'Reply due tomorrow' : `Reply due in ${days(n)}`, tone: OFFER_TONE['Reply due soon'] };
  return { state: 'Awaiting reply', label: 'Awaiting reply', tone: OFFER_TONE['Awaiting reply'] };
}

/** The pre-boarding profile's share done: the candidate's pre-boarding tasks (details, documents, letters). */
export const pctOf = (p: { done: number; total: number }) => (p.total ? Math.round((p.done / p.total) * 100) : 0);
export const pctColour = (v: number) => (v >= 100 ? 'var(--ok)' : v >= 50 ? 'var(--accent-ink)' : v > 0 ? 'var(--warn)' : 'var(--ink-3)');
