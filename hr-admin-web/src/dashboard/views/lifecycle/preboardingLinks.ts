// The pre-boarding screens' shared words and links: the address of a candidate's
// pre-boarding profile (its own, so it opens in a new tab too), the handoff that
// brings Employees back to its Pre-boarding list, where a candidate is, and a
// document's review status.
import { viewHash } from '../../viewLink';
import type { CandidateDocumentStatus } from '../../../services/lifecycle';

/**
 * The pre-boarding profile's address: this dashboard's own path (whatever it is served under), on the profile.
 * `focus` opens it on one card (`#preboarding/<journeyId>/<focus>`): 'documents', a profile section
 * ('personal', 'contact'…) or 'bank' (Salary details › Bank account and PF).
 */
export function preboardingHref(journeyId: string, focus?: string): string {
  return `${window.location.pathname}#${viewHash('preboarding', journeyId)}${focus ? `/${encodeURIComponent(focus)}` : ''}`;
}

/** The page's own part of the address: the candidate's journey, and the card to open on. */
export function preboardingParam(param: string): { journeyId: string; focus?: string } {
  const [journeyId, focus] = param.split('/');
  return { journeyId: journeyId ?? '', ...(focus ? { focus } : {}) };
}

/** Employees opens on its Pre-boarding list once (set when a pre-boarding row or the profile's back arrow leaves it). */
export const PREBOARDING_LIST_KEY = 'sowaka.employees.preboarding';
export function rememberPreboardingList() {
  try { sessionStorage.setItem(PREBOARDING_LIST_KEY, '1'); } catch { /* Employees opens on its usual list */ }
}

/** Where a candidate is, in the board's words. */
export const CANDIDATE_STATUS: Record<string, string> = {
  draft: 'Offer not sent yet', offer_sent: 'Offer sent', accepted: 'Offer accepted', finalised: 'Portal sent', active: 'On the portal',
  docs_approved: 'Documents approved', joined: 'Joined', moved_to_app: 'On the app', confirmed: 'Confirmed', declined: 'Declined', expired: 'Offer expired', not_joining: 'Not joining',
};
export const candidateStatus = (s: string) => CANDIDATE_STATUS[s] ?? s.replace(/_/g, ' ');

type Tone = { bg: string; fg: string };
export const DOC_STATUS: Record<CandidateDocumentStatus, { label: string; tone: Tone }> = {
  todo: { label: 'Not uploaded', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
  in_review: { label: 'With HR', tone: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' } },
  approved: { label: 'Approved', tone: { bg: 'var(--ok-bg)', fg: 'var(--ok)' } },
  sent_back: { label: 'Sent back', tone: { bg: 'var(--warn-bg)', fg: 'var(--warn)' } },
};
export const docStatus = (s?: string) => DOC_STATUS[s as CandidateDocumentStatus] ?? null;

