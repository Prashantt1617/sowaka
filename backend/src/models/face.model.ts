/**
 * Face ID: the face an employee enrolled, the checks made against it at a
 * punch, and HR's switches for it.
 *
 * Biometric data under the DPDP Act, so only what the check needs is kept:
 * Rekognition's face vector (in the company's collection, not here), the one
 * enrolment photo (encrypted, in the private bucket, so a face can be
 * re-indexed or a dispute looked into), and a log line per check with its
 * score. Punch selfies are never stored.
 */

/** HR's switches, per company. Absent means both off. */
export interface CompanyFaceIdSettings {
  /** Everyone must set up Face ID in the app, whatever their attendance source. */
  setupRequired?: boolean;
  /** A geotagged punch-in needs a face check first. Implies setup. */
  checkAtPunch?: boolean;
  updatedAt?: Date;
  updatedBy?: string;
}

export type FaceIdSettingsView = { setupRequired: boolean; checkAtPunch: boolean };

export function faceIdSettingsOf(company: { faceId?: CompanyFaceIdSettings } | null | undefined): FaceIdSettingsView {
  const checkAtPunch = company?.faceId?.checkAtPunch === true;
  // Checking a face nobody has enrolled refuses everyone, so the check implies the setup.
  return { setupRequired: checkAtPunch || company?.faceId?.setupRequired === true, checkAtPunch };
}

/** The face enrolled for one person, on their user record. */
export interface UserFaceId {
  /** Rekognition's id for the indexed face. */
  faceId: string;
  collectionId: string;
  /** The enrolment photo in the private bucket. */
  photoKey?: string;
  enrolledAt: Date;
  /** When and to which wording they consented. */
  consentAt: Date;
  consentVersion: string;
  /** How the enrolment photo graded, for HR's list. */
  quality?: { sharpness?: number; brightness?: number };
}

export type FaceCheckReason =
  | 'matched'
  | 'no_face'
  | 'multiple_faces'
  | 'too_dark'
  | 'too_bright'
  | 'blurry'
  | 'face_turned'
  | 'eyes_closed'
  | 'face_covered'
  | 'too_small'
  | 'not_a_match'
  | 'other_person'
  | 'liveness_failed'
  | 'not_enrolled'
  | 'already_enrolled_elsewhere'
  | 'unavailable';

/**
 * One check, pass or fail, for HR's log and the fallback's attempt count.
 * A passed check carries the token that lets one punch through.
 */
export interface FaceVerification {
  org: string;
  userId: string;
  kind: 'enrol' | 'verify';
  at: Date;
  passed: boolean;
  reason: FaceCheckReason;
  /** Similarity of the best match to this person's face, 0-100. */
  similarity?: number;
  /** Who the face matched when it was somebody else. */
  matchedUserId?: string;
  liveness?: {
    mode: 'aws' | 'device' | 'none';
    /** Rekognition's confidence, for an AWS session. */
    confidence?: number;
    sessionId?: string;
    /** What the app says its own check asked and saw. Not trusted, only logged. */
    challenge?: string;
    devicePassed?: boolean;
  };
  durationMs?: number;
  /** sha256 of the token handed back, for a passed verify. */
  tokenHash?: string;
  expiresAt?: Date;
  usedAt?: Date;
  /** The punch the token let through. */
  usedFor?: string;
  error?: string;
}

/** A Face Liveness session the backend opened, so a result is only read by its owner, once. */
export interface FaceLivenessSession {
  sessionId: string;
  org: string;
  userId: string;
  createdAt: Date;
  usedAt?: Date;
}

/**
 * The consent, as the one line the person ticks on the setup screen, word for
 * word. Its version is recorded with the enrolment, with the time they
 * agreed. Change the version with the words: an app that showed the old line
 * is sent the new one to agree to before it can enrol.
 */
export const FACE_CONSENT_VERSION = '2026-10-v2';
export const FACE_CONSENT_AGREE =
  'I agree to Face ID keeping a template of my face, made from this selfie, to confirm it\u2019s me when I punch in. ' +
  'It is stored by AWS in Mumbai and deleted when I leave.';
