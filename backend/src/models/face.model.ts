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

/**
 * HR's switch, per company. Absent means off. There is no separate setup
 * switch: someone who has not set up Face ID does so at their first punch
 * once the check is on.
 */
export interface CompanyFaceIdSettings {
  /** Every punch made in the app, in or out, needs a face check first. */
  checkAtPunch?: boolean;
  /** @deprecated The setup switch before setup moved to the first punch; ignored. */
  setupRequired?: boolean;
  updatedAt?: Date;
  updatedBy?: string;
}

export type FaceIdSettingsView = { checkAtPunch: boolean };

export function faceIdSettingsOf(company: { faceId?: CompanyFaceIdSettings } | null | undefined): FaceIdSettingsView {
  return { checkAtPunch: company?.faceId?.checkAtPunch === true };
}

/** The face enrolled for one person, on their user record. */
export interface UserFaceId {
  /** Rekognition's id for the indexed face (the front photo's). */
  faceId: string;
  /** Every face indexed for this person: front, then the turned photos. All carry their user id. */
  faceIds?: string[];
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
  /** The screen detector called the burst a photo or a screen. */
  | 'spoof'
  /** The screen detector was unsure: another look, closer. */
  | 'uncertain'
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
  /** A reset is logged too, as the record of a face removed; it is never a failure. */
  kind: 'enrol' | 'verify' | 'reset';
  at: Date;
  passed: boolean;
  reason: FaceCheckReason;
  /** Similarity of the best match to this person's face, 0-100. */
  similarity?: number;
  /** Who the face matched when it was somebody else. */
  matchedUserId?: string;
  liveness?: {
    /**
     * `server_spoof`: the server ran the screen detector on the burst of face
     * crops the phone sent, against a one-time challenge; `server_flash`: the
     * colour flash of builds 59 and 60 (old rows); `device`: the phone's own
     * word, only logged; `aws`: a Rekognition Face Liveness session.
     */
    mode: 'aws' | 'device' | 'server_flash' | 'server_spoof' | 'none';
    /** Rekognition's confidence, for an AWS session. */
    confidence?: number;
    sessionId?: string;
    /** What the app says its own check measured. Not trusted, only logged. */
    challenge?: string;
    devicePassed?: boolean;
    /** The server's challenge this check answered. */
    challengeId?: string;
    /** Screen detector medians, real-face probability 0–1: the phone's (logged) and the server's (decides). */
    spoofPhone?: number;
    spoofServer?: number;
    /** Each crop's server score, in burst order. */
    spoofScores?: number[];
    /** Micro-motion over the burst, at the 160 px crop scale: mean drift, and its non-rigid part. */
    motionMean?: number;
    motionRigid?: number;
    /** Old flash rows. */
    colours?: FlashColourName[];
    measured?: string;
    flashPassed?: boolean;
  };
  durationMs?: number;
  /** sha256 of the token handed back, for a passed verify or enrolment. */
  tokenHash?: string;
  expiresAt?: Date;
  usedAt?: Date;
  /** The punch the token let through. */
  usedFor?: string;
  error?: string;
}

export type FlashColourName = 'red' | 'green' | 'blue';

/**
 * A light check the server set for one selfie: which two colours the phone
 * must flash, for whom, until when. Claimed once by the selfie that answers
 * it; a second selfie with the same id, or one after it expired, is refused.
 */
export interface FaceChallenge {
  id: string;
  org: string;
  userId: string;
  /** Old challenges carried colours for the flash; new ones are only a one-time id. */
  colours?: FlashColourName[];
  createdAt: Date;
  expiresAt: Date;
  usedAt?: Date;
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
// v3 (29 Oct 2026): the line about where it is stored was taken off the
// setup screen at Sowaka's request; v2 had "It is stored by AWS in Mumbai and
// deleted when I leave." Whoever agreed to v2 keeps that record.
export const FACE_CONSENT_VERSION = '2026-10-v4';
export const FACE_CONSENT_AGREE =
  'Sowaka keeps a template of your face to confirm it\u2019s you when you punch in.';
