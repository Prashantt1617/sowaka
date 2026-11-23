/**
 * HR's approval of an Employee profile section (the dashboard's pre-boarding profile). An approved
 * section is locked for the candidate: the portal (and the joiner app, which edits through the
 * portal) refuses saves to it and uploads to its documents until HR unlocks it. Kept apart from
 * profile.ts and documents.ts so both can use it without importing each other.
 */
import type { CandidateDocument, Journey, ProfileSectionKey } from '../../models/lifecycle.model';
import { LifecycleOfferError } from './files';

export const PROFILE_LOCKED_MESSAGE = 'HR has approved this section. Write to HR if something needs to change.';

/** Which of the template's documents each section shows (by key, then by words in the label). */
export function sectionOfDocument(doc: Pick<CandidateDocument, 'docKey' | 'label'>): ProfileSectionKey {
  const k = `${doc.docKey} ${doc.label}`.toLowerCase();
  if (/photo|picture|selfie/.test(k)) return 'photo';
  if (/cheque|check|passbook|bank/.test(k)) return 'bank';
  if (/address/.test(k)) return 'contact';
  if (/educat|degree|certificate|marksheet|payslip|pay slip|relieving|experience|resume|\bcv\b|previous_offer|offer letter/.test(k)) return 'education';
  return 'ids';
}

export const sectionLocked = (journey: Pick<Journey, 'profileApprovals'>, section: ProfileSectionKey): boolean => Boolean(journey.profileApprovals?.[section]);

/** 409 when HR has approved the section. */
export function assertSectionOpen(journey: Pick<Journey, 'profileApprovals'>, section: ProfileSectionKey): void {
  if (sectionLocked(journey, section)) throw new LifecycleOfferError(409, PROFILE_LOCKED_MESSAGE);
}
