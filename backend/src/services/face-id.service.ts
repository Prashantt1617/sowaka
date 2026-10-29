import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import {
  attendanceRecords, attendanceRegularizations, companies, faceLivenessSessions, faceVerifications, offices, users,
} from '../config/db';
import { env } from '../config/env';
import { AttendanceRegularization, FaceCheckNote, PunchFaceCheck } from '../models/attendance.model';
import {
  FACE_CONSENT_AGREE, FACE_CONSENT_VERSION, FaceCheckReason, faceIdSettingsOf, FaceIdSettingsView, FaceVerification, UserFaceId,
} from '../models/face.model';
import { User } from '../models/user.model';
import { requestViewer } from '../middleware/request-viewer';
import { logger } from '../utils/logger';
import { forgetAuthUser } from './auth-cache';
import { locateForPunch } from './geofence.service';
import { notifyCorrectionSubmitted } from './request-notifications.service';
import { deleteFacePhoto, hasReceiptStorage, uploadFacePhoto } from './s3-receipt.service';
import { collectionIdFor, DetectedFace, faceEngine, FaceServiceUnavailable } from './rekognition.service';

/**
 * Face ID: who may punch in as whom.
 *
 * An employee enrols one photo of their face (after saying yes to the consent
 * text); Rekognition indexes it into their company's collection under their
 * user id. At a punch-in the app sends a fresh selfie — or, once Face
 * Liveness is switched on, the id of a liveness session it streamed — and
 * this searches the collection with it. Only a match to this person's own
 * enrolled face, at FACE_MATCH_THRESHOLD or above, passes. A pass hands back
 * a token that the punch spends: single use, short-lived, and tied to the
 * user, so the app's word that the check passed is never needed.
 *
 * Every check is logged with its score and outcome. The selfie is not kept.
 */

export class FaceIdError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** What each outcome tells the person. Worded here once, so the app never waits on a release to change it. */
export const FACE_MESSAGES: Record<FaceCheckReason, string> = {
  matched: 'Face verified',
  no_face: "We couldn't see a face. Hold the phone at eye level and look at the screen.",
  multiple_faces: 'More than one face is in view. Make sure only you are in the picture.',
  too_dark: "It's too dark. Move to a brighter spot or face a light.",
  too_bright: 'There is too much light. Move out of direct sunlight or away from the bright window behind you.',
  blurry: 'The picture is blurry. Hold the phone still and try again.',
  face_turned: 'Look straight at the camera, with your head level.',
  eyes_closed: 'Keep your eyes open and look at the camera.',
  face_covered: 'Take off anything covering your face, like a mask, sunglasses or a cap.',
  too_small: 'Move closer, so your face fills the circle.',
  not_a_match: "This doesn't match the face set up for your account.",
  // Never says whose face it was: that would tell a colleague they are enrolled.
  other_person: "This doesn't match the face set up for your account.",
  liveness_failed: "We couldn't confirm a live person in front of the camera. Try again in good light.",
  not_enrolled: 'Set up Face ID first.',
  already_enrolled_elsewhere: 'This face is already set up on another account. Ask HR to help.',
  unavailable: "Face check isn't available right now. You can send today's punch-in to your manager instead.",
};

/**
 * Failed checks count towards the fallback for the rest of the day (India
 * time): `FACE_MAX_ATTEMPTS` tries a day, then the punch can go to the manager.
 * A pass starts the count again. The hourly caps below bound the bill.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export function startOfTodayIst(now = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
}
const VERIFY_PER_HOUR = 20;
/** How long an "unavailable" answer keeps the manager fallback open. */
const UNAVAILABLE_FALLBACK_MS = 30 * 60_000;
const ENROL_PER_HOUR = 10;

export { faceIdSettingsOf };

async function settingsForOrg(org: string | undefined): Promise<FaceIdSettingsView> {
  if (!org) return faceIdSettingsOf(null);
  return faceIdSettingsOf(await companies().findOne({ id: org }, { projection: { _id: 0, faceId: 1 } }));
}

async function personFor(userId: string): Promise<User> {
  const user = (requestViewer(userId) as User | undefined) ?? (await users().findOne({ userId }, { projection: { profilePhotoUrl: 0 } }));
  if (!user) throw new FaceIdError(404, 'User not found');
  if (!user.org) throw new FaceIdError(409, 'Your account is not attached to a company');
  return user;
}

/** The enrolment as stored, read fresh: the signed-in copy may predate an enrolment seconds old. */
async function enrolmentOf(userId: string): Promise<UserFaceId | undefined> {
  const row = await users().findOne({ userId }, { projection: { _id: 0, faceId: 1 } });
  return row?.faceId?.faceId ? row.faceId : undefined;
}

/**
 * Failed checks since the last pass, within the window: what the fallback
 * counts. A failed setup counts like a failed check, since setup is the first
 * punch's check.
 */
async function recentFailures(userId: string): Promise<{ failures: number; lastReason?: FaceCheckReason }> {
  const since = startOfTodayIst();
  const rows = await faceVerifications()
    .find({ userId, kind: { $in: ['enrol', 'verify'] }, at: { $gte: since } }, { projection: { _id: 0, passed: 1, reason: 1, at: 1 } })
    .sort({ at: -1 })
    .limit(env.face.maxAttempts + 5)
    .toArray();
  let failures = 0;
  for (const row of rows) {
    if (row.passed) break;
    failures += 1;
  }
  // The service being down is a moment, not a day: it opens the fallback
  // only while it is recent.
  const last = rows[0];
  const recent = last?.at instanceof Date && Date.now() - last.at.getTime() < UNAVAILABLE_FALLBACK_MS;
  const lastReason = last?.reason === 'unavailable' && !recent ? undefined : last?.reason;
  return { failures, lastReason };
}

function fallbackOpen(state: { failures: number; lastReason?: FaceCheckReason }) {
  return state.failures >= env.face.maxAttempts || state.lastReason === 'unavailable';
}

async function underHourlyCap(userId: string, kind: 'enrol' | 'verify', cap: number) {
  const since = new Date(Date.now() - 60 * 60_000);
  const count = await faceVerifications().countDocuments({ userId, kind, at: { $gte: since } });
  if (count >= cap) {
    throw new FaceIdError(429, 'Too many tries in the last hour. Wait a while, or send your punch-in to your manager.', {
      face: { reason: 'rate_limited', fallback: kind === 'verify' },
    });
  }
}

/** The consent line the app shows, word for word, and the version it sends back with the enrolment. */
function consentView() {
  return { version: FACE_CONSENT_VERSION, agree: FACE_CONSENT_AGREE };
}

/** What the app needs to decide whether to ask for setup, and how to check. */
export async function faceStatusFor(userId: string) {
  const user = await personFor(userId);
  const [settings, enrolment, state] = await Promise.all([
    settingsForOrg(user.org),
    enrolmentOf(userId),
    recentFailures(userId),
  ]);
  return {
    checkAtPunch: settings.checkAtPunch,
    enrolled: Boolean(enrolment),
    enrolledAt: enrolment?.enrolledAt?.toISOString(),
    consent: consentView(),
    liveness: env.face.liveness
      ? { mode: 'aws' as const, region: env.face.region, identityPoolId: env.face.livenessIdentityPoolId }
      : { mode: 'device' as const },
    maxAttempts: env.face.maxAttempts,
    failedAttempts: state.failures,
    fallbackAvailable: settings.checkAtPunch && fallbackOpen(state),
  };
}

/**
 * Turns whatever the phone sent into what Rekognition reads best: upright,
 * at most 1280 px, a JPEG well under its 5 MB limit. The re-encode also drops
 * the photo's metadata (the camera's GPS among it) before anything is stored.
 */
async function normalise(bytes: Buffer): Promise<Buffer> {
  try {
    return await sharp(bytes, { failOn: 'none' })
      .rotate()
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw new FaceIdError(400, "That photo couldn't be read. Take it again.", { face: { reason: 'no_face' } });
  }
}

/** The enrolment photo's quality gate: strict, because every later check is measured against it. */
export function enrolmentProblem(faces: DetectedFace[]): FaceCheckReason | null {
  const clear = faces.filter((face) => face.confidence >= 90);
  if (clear.length === 0) return 'no_face';
  // A face far in the background still counts: an enrolment photo is of one person.
  if (clear.filter((face) => face.width >= 0.08).length > 1) return 'multiple_faces';
  const face = [...clear].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return qualityProblem(face, { minBrightness: 30, maxBrightness: 97, minSharpness: 30, maxAngle: 20, minWidth: 0.2 });
}

/** Why a punch face did not match, when it was the photo rather than the person. */
export function verifyProblem(faces: DetectedFace[]): FaceCheckReason | null {
  const clear = faces.filter((face) => face.confidence >= 90);
  if (clear.length === 0) return 'no_face';
  if (clear.filter((face) => face.width >= 0.12).length > 1) return 'multiple_faces';
  const face = [...clear].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return qualityProblem(face, { minBrightness: 20, maxBrightness: 98, minSharpness: 15, maxAngle: 30, minWidth: 0.12 });
}

function qualityProblem(
  face: DetectedFace,
  limits: { minBrightness: number; maxBrightness: number; minSharpness: number; maxAngle: number; minWidth: number },
): FaceCheckReason | null {
  if (face.width < limits.minWidth) return 'too_small';
  if ((face.brightness ?? 100) < limits.minBrightness) return 'too_dark';
  if ((face.brightness ?? 0) > limits.maxBrightness) return 'too_bright';
  if ((face.sharpness ?? 100) < limits.minSharpness) return 'blurry';
  if ([face.yaw, face.pitch].some((angle) => Math.abs(angle ?? 0) > limits.maxAngle) || Math.abs(face.roll ?? 0) > limits.maxAngle + 5) {
    return 'face_turned';
  }
  if (face.sunglasses?.value && face.sunglasses.confidence >= 80) return 'face_covered';
  if (face.occluded?.value && face.occluded.confidence >= 80) return 'face_covered';
  if (face.eyesOpen && !face.eyesOpen.value && face.eyesOpen.confidence >= 80) return 'eyes_closed';
  return null;
}

async function log(row: FaceVerification) {
  try {
    await faceVerifications().insertOne(row);
  } catch (error) {
    // The check's outcome still stands; a missing log line is logged instead.
    logger.error('Face check log write failed', { userId: row.userId, kind: row.kind, reason: row.reason }, error);
  }
}

function failure(reason: FaceCheckReason, extra: Record<string, unknown> = {}) {
  return new FaceIdError(reason === 'unavailable' ? 503 : 422, FACE_MESSAGES[reason], { face: { reason, ...extra } });
}

// ------------------------------------------------------------------ enrol

export async function enrolFace(
  userId: string,
  input: { photo?: Buffer; consent?: unknown; consentVersion?: unknown },
) {
  const user = await personFor(userId);
  const org = user.org!;
  if (input.consent !== true && input.consent !== 'true') {
    throw new FaceIdError(400, 'Agree to the Face ID consent to continue', { face: { reason: 'consent_required' } });
  }
  if (String(input.consentVersion ?? '') !== FACE_CONSENT_VERSION) {
    // The words changed since the app showed them: show the new ones first.
    throw new FaceIdError(409, 'The Face ID consent has changed. Read it again to continue.', {
      face: { reason: 'consent_changed', consent: consentView() },
    });
  }
  if (!input.photo?.length) throw new FaceIdError(400, 'Take a photo of your face', { face: { reason: 'no_face' } });
  // Set up once: a second setup would let whoever holds the phone swap in
  // their own face and punch with it. Setting up again goes through HR's reset.
  if (await enrolmentOf(userId)) {
    throw new FaceIdError(409, 'Face ID is already set up. Ask HR to reset it if you need to set it up again.', {
      face: { reason: 'already_enrolled' },
    });
  }
  await underHourlyCap(userId, 'enrol', ENROL_PER_HOUR);

  const started = Date.now();
  const image = await normalise(input.photo);
  const collectionId = collectionIdFor(org);
  const engine = faceEngine();
  const base = { org, userId, kind: 'enrol' as const, at: new Date(), liveness: { mode: 'none' as const } };
  /**
   * A failed setup, logged, with the tries left: at a punch it is that
   * punch's check, so three of them open the manager fallback as checks do.
   */
  const refuse = async (reason: FaceCheckReason, extra: Partial<FaceVerification> = {}) => {
    await log({ ...base, passed: false, reason, durationMs: Date.now() - started, ...extra });
    const [state, settings] = await Promise.all([recentFailures(userId), settingsForOrg(org)]);
    return failure(reason, {
      attemptsLeft: Math.max(0, env.face.maxAttempts - state.failures),
      fallback: settings.checkAtPunch && fallbackOpen(state),
    });
  };
  try {
    await engine.ensureCollection(collectionId);
    const faces = await engine.detectFaces(image);
    const problem = enrolmentProblem(faces);
    if (problem) throw await refuse(problem);
    // One face, one account: a face already enrolled for someone else would
    // let them punch in as this person, which is the whole thing to prevent.
    const matches = (await engine.searchFace(collectionId, image, env.face.matchThreshold)) ?? [];
    const elsewhere = matches.find((match) => match.externalImageId && match.externalImageId !== userId);
    if (elsewhere) {
      throw await refuse('already_enrolled_elsewhere', { similarity: elsewhere.similarity, matchedUserId: elsewhere.externalImageId });
    }
    const indexed = await engine.indexFace(collectionId, image, userId);
    if (!indexed) throw await refuse('no_face');
    let photoKey: string | undefined;
    if (hasReceiptStorage()) {
      try {
        photoKey = await uploadFacePhoto(org, userId, image);
      } catch (error) {
        // A face without its photo cannot be re-indexed later; undo it.
        await engine.deleteFaces(collectionId, [indexed.faceId]).catch(() => undefined);
        throw new FaceServiceUnavailable('Enrolment photo upload failed', error);
      }
    }
    const main = [...faces].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const now = new Date();
    const enrolment: UserFaceId = {
      faceId: indexed.faceId,
      collectionId,
      ...(photoKey ? { photoKey } : {}),
      enrolledAt: now,
      consentAt: now,
      consentVersion: FACE_CONSENT_VERSION,
      quality: { sharpness: round(main?.sharpness), brightness: round(main?.brightness) },
    };
    const previous = await users().findOneAndUpdate(
      { userId },
      { $set: { faceId: enrolment, updatedAt: now } },
      { returnDocument: 'before', projection: { _id: 0, faceId: 1 } },
    );
    forgetAuthUser(userId);
    // A second enrolment replaces the first; the old face must not keep matching.
    const stale = [
      ...matches.filter((match) => match.externalImageId === userId).map((match) => match.faceId),
      ...(previous?.faceId?.faceId ? [previous.faceId.faceId] : []),
    ].filter((faceId) => faceId !== indexed.faceId);
    if (stale.length) await engine.deleteFaces(collectionId, [...new Set(stale)]).catch((error) => {
      logger.error('Stale face could not be removed', { userId, collectionId, faceIds: stale }, error);
    });
    if (previous?.faceId?.photoKey && previous.faceId.photoKey !== photoKey) {
      await deleteFacePhoto(previous.faceId.photoKey).catch(() => undefined);
    }
    // Setting up at a punch is that punch's check: the face was just
    // matched against nobody else's and taken live, so it hands back the
    // same single-use token a passed check does, and the punch goes on
    // without a second selfie.
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + env.face.tokenTtlSeconds * 1000);
    await log({ ...base, passed: true, reason: 'matched', durationMs: Date.now() - started, tokenHash: hashToken(token), expiresAt });
    return { enrolled: true, enrolledAt: now.toISOString(), token, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    if (error instanceof FaceServiceUnavailable) {
      logger.error('Face enrolment: Rekognition unavailable', { userId, org }, error);
      await log({ ...base, passed: false, reason: 'unavailable', error: error.message, durationMs: Date.now() - started });
      const settings = await settingsForOrg(org);
      throw new FaceIdError(503, FACE_MESSAGES.unavailable, { face: { reason: 'unavailable', fallback: settings.checkAtPunch } });
    }
    throw error;
  }
}

// ----------------------------------------------------------------- verify

/** Opens a Face Liveness session for the app to stream into. Only once Face Liveness is on. */
export async function startLivenessSession(userId: string) {
  const user = await personFor(userId);
  if (!env.face.liveness) throw new FaceIdError(409, 'Face Liveness is not switched on');
  await underHourlyCap(userId, 'verify', VERIFY_PER_HOUR);
  try {
    const sessionId = await faceEngine().createLivenessSession();
    await faceLivenessSessions().insertOne({ sessionId, org: user.org!, userId, createdAt: new Date() });
    return { sessionId, region: env.face.region, identityPoolId: env.face.livenessIdentityPoolId };
  } catch (error) {
    if (error instanceof FaceServiceUnavailable) {
      logger.error('Face Liveness session failed', { userId }, error);
      throw failure('unavailable', { fallback: true });
    }
    throw error;
  }
}

/**
 * Checks the face in front of the phone against the one enrolled.
 *
 * Always answers with the outcome rather than throwing on a mismatch: a
 * failed check is a result the screen shows, with how many tries are left
 * and whether the manager fallback is open. Only a request that cannot be a
 * check at all (not enrolled, no photo) is an error.
 */
export async function verifyFace(
  userId: string,
  input: { photo?: Buffer; livenessSessionId?: unknown; challenge?: unknown; devicePassed?: unknown },
) {
  const user = await personFor(userId);
  const org = user.org!;
  const enrolment = await enrolmentOf(userId);
  if (!enrolment) throw new FaceIdError(428, FACE_MESSAGES.not_enrolled, { face: { reason: 'not_enrolled', setup: true } });
  await underHourlyCap(userId, 'verify', VERIFY_PER_HOUR);

  const started = Date.now();
  const engine = faceEngine();
  const challenge = typeof input.challenge === 'string' ? input.challenge.slice(0, 40) : undefined;
  let liveness: FaceVerification['liveness'] = env.face.liveness
    ? { mode: 'aws' }
    : { mode: 'device', challenge, devicePassed: input.devicePassed === true || input.devicePassed === 'true' };

  const outcome = async (reason: FaceCheckReason, extra: Partial<FaceVerification> = {}) => {
    const passed = reason === 'matched';
    const token = passed ? randomBytes(32).toString('base64url') : undefined;
    const expiresAt = passed ? new Date(Date.now() + env.face.tokenTtlSeconds * 1000) : undefined;
    await log({
      org, userId, kind: 'verify', at: new Date(), passed, reason, liveness, durationMs: Date.now() - started,
      ...(token ? { tokenHash: hashToken(token), expiresAt } : {}),
      ...extra,
    });
    const state = passed ? { failures: 0 } : await recentFailures(userId);
    const attemptsLeft = Math.max(0, env.face.maxAttempts - state.failures);
    return {
      passed,
      reason,
      message: FACE_MESSAGES[reason],
      ...(token ? { token, expiresAt: expiresAt!.toISOString() } : {}),
      ...(typeof extra.similarity === 'number' ? { similarity: extra.similarity } : {}),
      attemptsLeft,
      fallbackAvailable: !passed && fallbackOpen(state),
    };
  };

  try {
    let image: Buffer;
    if (env.face.liveness) {
      const sessionId = typeof input.livenessSessionId === 'string' ? input.livenessSessionId : '';
      if (!sessionId) throw new FaceIdError(400, 'Run the liveness check first', { face: { reason: 'liveness_required' } });
      // The session must be one this person opened, and is read once.
      const session = await faceLivenessSessions().findOneAndUpdate(
        { sessionId, userId, usedAt: { $exists: false }, createdAt: { $gte: new Date(Date.now() - 10 * 60_000) } },
        { $set: { usedAt: new Date() } },
      );
      if (!session) return outcome('liveness_failed', { error: 'unknown or used session' });
      const result = await engine.livenessResult(sessionId);
      liveness = { mode: 'aws', sessionId, confidence: round(result.confidence) };
      if (result.status !== 'SUCCEEDED' || (result.confidence ?? 0) < env.face.livenessThreshold || !result.referenceImage) {
        return outcome('liveness_failed');
      }
      image = result.referenceImage;
    } else {
      if (!input.photo?.length) throw new FaceIdError(400, 'Take a photo of your face', { face: { reason: 'no_face' } });
      image = await normalise(input.photo);
    }

    // Matches are asked for from a lower bar than the pass mark, so a near
    // miss is logged with its score rather than as nothing at all.
    const matches = await engine.searchFace(enrolment.collectionId, image, Math.min(80, env.face.matchThreshold));
    const best = matches?.[0];
    if (best && best.faceId === enrolment.faceId && best.similarity >= env.face.matchThreshold) {
      return outcome('matched', { similarity: round(best.similarity) });
    }
    if (best && best.externalImageId !== userId && best.similarity >= env.face.matchThreshold) {
      // Someone else's enrolled face, at the pass mark: the case Face ID is for.
      logger.warn('Face check matched another employee', { userId, org, similarity: round(best.similarity) });
      return outcome('other_person', { similarity: round(best.similarity), matchedUserId: best.externalImageId });
    }
    const own = matches?.find((match) => match.faceId === enrolment.faceId);
    // No match: say why when the photo is the reason, so the next try can be better.
    const problem = matches === null || !own ? verifyProblem(await engine.detectFaces(image)) : null;
    return outcome(problem ?? 'not_a_match', own ? { similarity: round(own.similarity) } : {});
  } catch (error) {
    if (error instanceof FaceServiceUnavailable) {
      logger.error('Face check: Rekognition unavailable', { userId, org }, error);
      return outcome('unavailable', { error: error.message });
    }
    throw error;
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function round(value?: number) {
  return typeof value === 'number' ? Math.round(value * 100) / 100 : undefined;
}

// ------------------------------------------------------------------ punch

/**
 * The punch formats whose punches are taken in the app, and so are checked:
 * geotagged and in-app punch in, both ways. A biometric device's punches
 * arrive from the device, and an Auto Punch day has none, so neither is.
 */
const APP_PUNCH_FORMATS = new Set(['Geotag (powered by Sowaka)', 'In-app punch in']);

/** Whether this punch needs a face check: the company checks, and the shift punches in the app. */
export function faceCheckNeeded(settings: FaceIdSettingsView, punchFormat: string) {
  return settings.checkAtPunch && APP_PUNCH_FORMATS.has(punchFormat);
}

/**
 * Spends a passed check's token on a punch. Throws the refusal the punch
 * screen acts on when there is none: set up Face ID first, or check again.
 * The returned handle gives the token back if the punch then fails for
 * another reason (outside the office, say), so the same check can carry the
 * punch that follows within its few minutes.
 */
export async function claimFaceToken(userId: string, token: unknown, usedFor: string): Promise<{
  face: PunchFaceCheck;
  release: () => Promise<void>;
}> {
  const raw = typeof token === 'string' ? token.trim() : '';
  const now = new Date();
  const row = raw
    ? await faceVerifications().findOneAndUpdate(
        { tokenHash: hashToken(raw), userId, kind: { $in: ['verify', 'enrol'] }, passed: true, usedAt: { $exists: false }, expiresAt: { $gt: now } },
        { $set: { usedAt: now, usedFor } },
      )
    : null;
  if (!row) {
    const enrolled = Boolean(await enrolmentOf(userId));
    // No token at all is, in practice, an app from before Face ID: it shows
    // this message as it is, so the message says what to do. The current app
    // reads `details.face` and opens the selfie or the setup instead.
    const message = !raw
      ? 'Your company now checks your face when you punch in or out. Update the Sowaka app from the App Store or Google Play to punch.'
      : enrolled
        ? 'Your face check has expired. Take the selfie again to punch.'
        : 'Set up Face ID to punch.';
    throw new FaceIdError(enrolled ? 403 : 428, message, {
      face: { reason: enrolled ? (raw ? 'check_expired' : 'check_required') : 'not_enrolled', setup: !enrolled, updateApp: !raw },
    });
  }
  return {
    face: { similarity: row.similarity, liveness: row.liveness?.mode ?? 'none', at: row.at },
    release: async () => {
      await faceVerifications()
        .updateOne({ _id: row._id, usedFor }, { $unset: { usedAt: '', usedFor: '' } })
        .catch((error) => logger.error('Face token release failed', { userId }, error));
    },
  };
}

/**
 * The way out after the tries run out, or while the face service is down:
 * the punch-in goes to the manager (or HR) as a request through the
 * attendance correction flow. Only open once the checks have actually failed
 * — otherwise it would be a way round the check. Approved, the day takes this
 * punch time; until then it stands as absent.
 */
export async function requestFaceFallback(
  userId: string,
  reading?: { latitude: number; longitude: number; accuracy?: number },
  /** The punch the check was for; a punch-in when an older build leaves it out. */
  type: 'in' | 'out' = 'in',
) {
  const user = await personFor(userId);
  if (!user.employeeId) throw new FaceIdError(409, 'Employee ID is not configured');
  const settings = await settingsForOrg(user.org);
  if (!settings.checkAtPunch) throw new FaceIdError(409, 'Your company does not check faces at punch-in or punch-out');
  const state = await recentFailures(userId);
  if (!fallbackOpen(state)) {
    throw new FaceIdError(409, `Try the face check again. After ${env.face.maxAttempts} tries you can send it to your manager.`, {
      face: { reason: 'fallback_closed', attemptsLeft: Math.max(0, env.face.maxAttempts - state.failures) },
    });
  }
  const at = new Date();
  const workDate = at.toISOString().slice(0, 10);
  const [today, pending] = await Promise.all([
    attendanceRecords().findOne({ employeeId: user.employeeId, workDate }),
    attendanceRegularizations().findOne({ userId, workDate, status: 'pending' }),
  ]);
  const note: FaceCheckNote = { at, punchType: type, reason: state.lastReason ?? 'not_a_match', attempts: state.failures };
  if (type === 'in') {
    if (today?.punchIn) throw new FaceIdError(409, 'Already punched in today');
    if (pending) throw new FaceIdError(409, 'A request for today is already with your manager');
  } else {
    if (today?.punchOut) throw new FaceIdError(409, 'Already punched out today');
    if (pending) {
      // The day is open only as a request the manager has not settled: the
      // punch-out rides on it, as a punch-out does on an out-of-location one.
      if ((pending.kind !== 'out_of_location' && pending.kind !== 'face_check') || pending.punchOut) {
        throw new FaceIdError(409, 'A request for today is already with your manager');
      }
      await attendanceRegularizations().updateOne({ _id: pending._id }, { $set: { punchOut: at, faceCheckOut: note } });
      return { id: pending._id.toHexString(), workDate, requestedAt: at.toISOString(), title: 'Punch-out without face check', note: pending.note ?? '' };
    }
    if (!today?.punchIn) throw new FaceIdError(409, 'Punch in before punching out');
  }

  if (reading && Number.isFinite(reading.latitude) && Number.isFinite(reading.longitude)) {
    // Where it was tried from, for the manager to weigh; never a refusal here.
    const sites = await offices().find({ org: user.org, active: true }).toArray();
    const verdict = sites.length ? await locateForPunch(user.org!, reading, sites).catch(() => null) : null;
    Object.assign(note, {
      latitude: reading.latitude, longitude: reading.longitude, accuracy: reading.accuracy,
      ...(verdict ? { officeName: verdict.office?.name, distanceMeters: verdict.distanceMeters, inside: verdict.inside } : {}),
    });
  }
  const punch = type === 'in' ? 'punch-in' : 'punch-out';
  const reasonText = note.reason === 'unavailable'
    ? `Face check was unavailable at ${punch}`
    : `Face check did not pass after ${note.attempts} tries at ${punch}`;
  const row: AttendanceRegularization = {
    userId,
    employeeId: user.employeeId,
    // No manager: HR settles it from the dashboard, which lists every request in the org.
    managerUserId: user.managerUserId ?? '',
    workDate,
    kind: 'face_check',
    faceCheck: note,
    // Approved, the day takes this time for the punch that was tried.
    ...(type === 'in' ? { punchIn: at } : { punchOut: at }),
    note: reasonText,
    status: 'pending',
    createdAt: at,
  };
  const result = await attendanceRegularizations().insertOne(row);
  await notifyCorrectionSubmitted({ employeeUserId: userId, requestId: String(result.insertedId), workDate, reason: reasonText })
    .catch((error) => logger.error('Face fallback notification failed', { userId }, error));
  return {
    id: result.insertedId.toHexString(), workDate, requestedAt: at.toISOString(),
    title: type === 'in' ? 'Punch-in without face check' : 'Punch-out without face check', note: reasonText,
  };
}

// --------------------------------------------------------------- retention

/**
 * The check log older than FACE_LOG_RETENTION_MONTHS (12 by default), and
 * liveness sessions older than a day, which are only ever read within
 * minutes. Counts only, unless `apply`. Run by hand with
 * `npm run face-log:cleanup`; no scheduler calls it yet.
 */
export async function pruneFaceLog(options: { apply?: boolean; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const before = new Date(now);
  before.setUTCMonth(before.getUTCMonth() - env.face.logRetentionMonths);
  const sessionsBefore = new Date(now.getTime() - 86_400_000);
  const checks = { at: { $lt: before } };
  const sessions = { createdAt: { $lt: sessionsBefore } };
  if (!options.apply) {
    const [checkRows, sessionRows] = await Promise.all([
      faceVerifications().countDocuments(checks),
      faceLivenessSessions().countDocuments(sessions),
    ]);
    return { before: before.toISOString(), checks: checkRows, sessions: sessionRows, deleted: false };
  }
  const [checkRows, sessionRows] = await Promise.all([
    faceVerifications().deleteMany(checks),
    faceLivenessSessions().deleteMany(sessions),
  ]);
  return { before: before.toISOString(), checks: checkRows.deletedCount, sessions: sessionRows.deletedCount, deleted: true };
}

// ------------------------------------------------------------------ remove

/**
 * Deletes someone's face: from the collection, the photo from the bucket, and
 * the enrolment from their record. On a reset this must succeed, or the old
 * face would keep matching; on an employee's deletion the caller logs and
 * carries on.
 */
export async function forgetFace(user: Pick<User, 'userId' | 'org' | 'faceId'>, by?: string) {
  const enrolment = user.faceId;
  if (!enrolment?.faceId) return { removed: false };
  await faceEngine().deleteFaces(enrolment.collectionId, [enrolment.faceId]);
  if (enrolment.photoKey) await deleteFacePhoto(enrolment.photoKey);
  await users().updateOne({ userId: user.userId }, { $unset: { faceId: '' }, $set: { updatedAt: new Date() } });
  forgetAuthUser(user.userId);
  await log({
    org: user.org ?? '', userId: user.userId, kind: 'reset', at: new Date(), passed: false, reason: 'not_enrolled',
    error: by ? `reset by ${by}` : 'removed',
  });
  return { removed: true };
}

// ------------------------------------------------------------------ admin

async function adminOrg(adminUserId: string): Promise<string> {
  const admin = (requestViewer(adminUserId) as User | undefined) ?? (await users().findOne({ userId: adminUserId }, { projection: { _id: 0, org: 1 } }));
  if (!admin?.org) throw new FaceIdError(403, 'No organisation on this account');
  return admin.org;
}

/** HR's page: the switches, and who has set up Face ID, with their last check and failures this month. */
export async function faceIdOverviewForAdmin(adminUserId: string) {
  const org = await adminOrg(adminUserId);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [company, people, checks] = await Promise.all([
    companies().findOne({ id: org }, { projection: { _id: 0, faceId: 1 } }),
    users()
      .find(
        { org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } },
        { projection: { _id: 0, userId: 1, name: 1, employeeId: 1, department: 1, designation: 1, 'faceId.enrolledAt': 1, 'faceId.faceId': 1 } },
      )
      .sort({ name: 1 })
      .toArray(),
    faceVerifications()
      .aggregate<{ _id: string; failed: number; lastAt: Date; lastPassed: boolean }>([
        { $match: { org, kind: { $in: ['enrol', 'verify'] }, at: { $gte: since } } },
        { $sort: { at: -1 } },
        { $group: { _id: '$userId', failed: { $sum: { $cond: ['$passed', 0, 1] } }, lastAt: { $first: '$at' }, lastPassed: { $first: '$passed' } } },
      ])
      .toArray(),
  ]);
  const byUser = new Map(checks.map((row) => [row._id, row]));
  const rows = people.map((person) => {
    const check = byUser.get(person.userId);
    return {
      userId: person.userId,
      name: person.name,
      employeeId: person.employeeId ?? null,
      department: person.department ?? null,
      designation: person.designation ?? null,
      enrolled: Boolean(person.faceId?.faceId),
      enrolledAt: person.faceId?.enrolledAt?.toISOString() ?? null,
      lastCheckAt: check?.lastAt?.toISOString() ?? null,
      lastCheckPassed: check ? check.lastPassed : null,
      failedLast30Days: check?.failed ?? 0,
    };
  });
  return {
    settings: faceIdSettingsOf(company),
    liveness: env.face.liveness ? 'aws' : 'device',
    matchThreshold: env.face.matchThreshold,
    enrolledCount: rows.filter((row) => row.enrolled).length,
    people: rows,
  };
}

export async function updateFaceIdSettingsForAdmin(adminUserId: string, input: { checkAtPunch?: unknown }) {
  const org = await adminOrg(adminUserId);
  if (typeof input.checkAtPunch !== 'boolean') throw new FaceIdError(400, 'checkAtPunch must be true or false');
  const updated = await companies().findOneAndUpdate(
    { id: org },
    {
      $set: { 'faceId.checkAtPunch': input.checkAtPunch, 'faceId.updatedAt': new Date(), 'faceId.updatedBy': adminUserId },
      // The old setup switch, if it was ever set: setup now happens at the first punch.
      $unset: { 'faceId.setupRequired': '' },
    },
    { returnDocument: 'after', projection: { _id: 0, faceId: 1 } },
  );
  if (!updated) throw new FaceIdError(404, 'Company not found');
  return faceIdSettingsOf(updated);
}

export async function resetFaceIdForAdmin(adminUserId: string, employeeUserId: string) {
  const org = await adminOrg(adminUserId);
  const employee = await users().findOne({ userId: employeeUserId, org }, { projection: { _id: 0, userId: 1, org: 1, faceId: 1 } });
  if (!employee) throw new FaceIdError(404, 'Employee not found');
  try {
    return await forgetFace(employee, adminUserId);
  } catch (error) {
    logger.error('Face ID reset failed', { employeeUserId, org }, error);
    throw new FaceIdError(503, "Face ID couldn't be reset right now. Try again in a few minutes.");
  }
}

/** Checks in a date range, newest first; failures only unless asked for all. */
export async function listFaceChecksForAdmin(
  adminUserId: string,
  query: { from?: unknown; to?: unknown; all?: unknown; userId?: unknown },
) {
  const org = await adminOrg(adminUserId);
  const day = (value: unknown, fallback: Date) => {
    const text = typeof value === 'string' ? value : '';
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : fallback;
    if (Number.isNaN(parsed.valueOf())) throw new FaceIdError(400, 'Dates must use YYYY-MM-DD');
    return parsed;
  };
  const from = day(query.from, new Date(Date.now() - 7 * 86_400_000));
  const to = new Date(day(query.to, new Date()).getTime() + 86_400_000);
  const filter: Record<string, unknown> = { org, at: { $gte: from, $lt: to } };
  // Failed checks only: a reset is logged as not passed, but it is not a failure.
  if (query.all !== 'true') Object.assign(filter, { passed: false, kind: { $in: ['enrol', 'verify'] } });
  if (typeof query.userId === 'string' && query.userId) filter.userId = query.userId;
  const rows = await faceVerifications()
    .find(filter, { projection: { _id: 0, tokenHash: 0 } })
    .sort({ at: -1 })
    .limit(500)
    .toArray();
  const names = new Map(
    (await users()
      .find({ org, userId: { $in: [...new Set(rows.flatMap((row) => [row.userId, row.matchedUserId ?? '']))] } }, { projection: { _id: 0, userId: 1, name: 1, employeeId: 1 } })
      .toArray()).map((person) => [person.userId, person]),
  );
  return rows.map((row) => ({
    at: row.at.toISOString(),
    userId: row.userId,
    name: names.get(row.userId)?.name ?? 'Former employee',
    employeeId: names.get(row.userId)?.employeeId ?? null,
    kind: row.kind,
    passed: row.passed,
    reason: row.reason,
    message: FACE_MESSAGES[row.reason] ?? row.reason,
    similarity: row.similarity ?? null,
    // HR sees that a face matched a colleague's, and whose: that is buddy punching.
    matchedName: row.matchedUserId ? names.get(row.matchedUserId)?.name ?? 'Another employee' : null,
    liveness: row.liveness?.mode ?? 'none',
    livenessConfidence: row.liveness?.confidence ?? null,
    deviceCheckPassed: row.liveness?.devicePassed ?? null,
    usedForPunch: Boolean(row.usedAt),
  }));
}
