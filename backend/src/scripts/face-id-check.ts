/**
 * Scratch-database check of Face ID with Rekognition faked: consent and the
 * enrolment photo's quality gate, one face per account, setup at the first
 * punch (its token carrying that punch), the check at an
 * in-app punch, in or out, and the token it hands back (single use, this person's only,
 * short-lived, given back when the punch fails further on), the refusals,
 * the manager fallback after three tries or while the service is down, Face
 * Liveness sessions, HR's switches, reset and log, and the face going with a
 * deleted employee, and the log's retention cleanup. It drops and recreates its own database, and refuses any
 * other. Run with
 * MONGODB_DB=face_verify_scratch NOTIFY_ORGS=nobody-scratch EMAIL_ORGS=nobody-scratch AWS_S3_BUCKET= npm run face-id:check
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  attendanceRecords, attendanceRegularizations, companies, connectDb, faceVerifications, getDb, offices, shiftPolicies, users,
} from '../config/db';
import { env } from '../config/env';
import { decideRegularization, recordPunch } from '../services/attendance.service';
import { deleteEmployeeForAdmin } from '../services/admin.service';
import {
  claimFaceToken, enrolFace, FACE_MESSAGES, faceCheckNeeded, pruneFaceLog, faceIdOverviewForAdmin, faceStatusFor, listFaceChecksForAdmin,
  requestFaceFallback, resetFaceIdForAdmin, startLivenessSession, updateFaceIdSettingsForAdmin, verifyFace,
} from '../services/face-id.service';
import { FACE_CONSENT_VERSION } from '../models/face.model';
import { hasReceiptStorage } from '../services/s3-receipt.service';
import {
  collectionIdFor, DetectedFace, FaceEngine, FaceMatch, FaceServiceUnavailable, setFaceEngineForTests,
} from '../services/rekognition.service';

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}
async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    const e = error as { statusCode?: number; message?: string; details?: { face?: Record<string, unknown> } & Record<string, unknown> };
    return { status: e.statusCode, message: e.message, face: e.details?.face, details: e.details };
  }
}

// --- a fake Rekognition. What a photo shows is read from its height, which
// the app-side re-encode keeps: 401 is Asha, 402 Bala, 407 someone who looks
// a lot like Asha, and the rest are photos with something wrong with them.
const SHOWS: Record<number, string> = {
  401: 'asha', 402: 'bala', 403: 'nobody', 404: 'dark', 405: 'two', 406: 'down', 407: 'lookalike', 408: 'chetan', 409: 'dev', 410: 'esha',
};
const photo = (height: number) => sharp({ create: { width: 400, height, channels: 3, background: '#a08070' } }).jpeg().toBuffer();
async function shown(image: Buffer) {
  const { height = 0 } = await sharp(image).metadata();
  return SHOWS[height] ?? 'nobody';
}
const goodFace = (extra: Partial<DetectedFace> = {}): DetectedFace => ({
  confidence: 99.9, width: 0.45, height: 0.55, brightness: 70, sharpness: 80, yaw: 2, pitch: -3, roll: 1,
  eyesOpen: { value: true, confidence: 99 }, occluded: { value: false, confidence: 99 }, sunglasses: { value: false, confidence: 99 }, ...extra,
});
const collections = new Map<string, { faceId: string; externalImageId: string; person: string }[]>();
const sessions = new Map<string, { status: string; confidence: number; person: string }>();
let calls = 0;
let nextFace = 1;
const fake: FaceEngine = {
  async ensureCollection(id) { if (!collections.has(id)) collections.set(id, []); },
  async detectFaces(image) {
    calls += 1;
    const who = await shown(image);
    if (who === 'down') throw new FaceServiceUnavailable('fake: timed out');
    if (who === 'nobody') return [];
    if (who === 'dark') return [goodFace({ brightness: 12 })];
    if (who === 'two') return [goodFace(), goodFace({ width: 0.3 })];
    return [goodFace()];
  },
  async indexFace(id, image, externalImageId) {
    calls += 1;
    const faceId = `face-${nextFace++}`;
    collections.get(id)!.push({ faceId, externalImageId, person: await shown(image) });
    return { faceId };
  },
  async searchFace(id, image, threshold): Promise<FaceMatch[] | null> {
    calls += 1;
    const who = await shown(image);
    if (who === 'down') throw new FaceServiceUnavailable('fake: timed out');
    if (['nobody', 'dark'].includes(who)) return null;
    return (collections.get(id) ?? [])
      .map((face) => ({
        faceId: face.faceId,
        externalImageId: face.externalImageId,
        similarity: face.person === who ? 99.6 : who === 'lookalike' && face.person === 'asha' ? 90.2 : 10,
      }))
      .filter((match) => match.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity);
  },
  async deleteFaces(id, faceIds) {
    collections.set(id, (collections.get(id) ?? []).filter((face) => !faceIds.includes(face.faceId)));
  },
  async createLivenessSession() { return `sess-${sessions.size + 1}`; },
  async livenessResult(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return { status: 'EXPIRED' };
    return { status: session.status, confidence: session.confidence, referenceImage: await photo(Number(Object.entries(SHOWS).find(([, who]) => who === session.person)?.[0])) };
  },
};

const ORG = 'sowaka';
const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', managerUserId: 'mgr', ...extra,
});
const consent = { consent: true, consentVersion: FACE_CONSENT_VERSION };

(async () => {
  if (hasReceiptStorage()) throw new Error('run with AWS_S3_BUCKET= so no enrolment photo reaches the bucket');
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'face_verify_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  setFaceEngineForTests(fake);
  env.face.liveness = false;

  await companies().insertOne({ id: ORG, name: 'Sowaka' } as never);
  await shiftPolicies().insertOne({ org: ORG, correction: { punchFormat: 'Geotag (powered by Sowaka)' } } as never);
  await users().insertMany([
    person('mgr', 'Manav Manager', { employeeId: 'E-MGR', managerUserId: undefined }),
    person('hr', 'Hema HR', { employeeId: 'E-HR', dashboardAccess: true, dashboardAdmin: true }),
    person('asha', 'Asha', { employeeId: 'E-A' }),
    person('bala', 'Bala', { employeeId: 'E-B' }),
    person('chetan', 'Chetan', { employeeId: 'E-C' }),
    person('dev', 'Dev', { employeeId: 'E-D' }),
    person('esha', 'Esha', { employeeId: 'E-E' }),
    person('gita', 'Gita', { employeeId: 'E-G' }),
  ] as never[]);
  const collection = collectionIdFor(ORG);
  check('a company gets its own collection', collection === 'sowaka-sowaka', collection);

  // --- off by default
  const off = await faceStatusFor('asha');
  check('off by default: no check at punch', !off.checkAtPunch && !off.enrolled, off);
  check('the consent line and its version come with the status', off.consent.version === FACE_CONSENT_VERSION && off.consent.agree.startsWith('I agree to Face ID keeping a template'), off.consent);
  check('without Face Liveness the app runs its own check', off.liveness.mode === 'device', off.liveness);
  const punchedOff = await recordPunch('chetan', 'in');
  check('switched off, a geotagged punch-in needs no face', typeof (punchedOff as { punchIn?: string }).punchIn === 'string', punchedOff);

  // --- enrolment: consent first, then a photo good enough to measure against
  check('enrolment without consent is refused', (await refusal(() => enrolFace('asha', { photo: Buffer.from('x') })))?.status === 400);
  const stale = await refusal(async () => enrolFace('asha', { photo: await photo(401), consent: true, consentVersion: '2020-old' }));
  check('consent to older wording is sent back with the new wording', stale?.status === 409 && stale.face?.reason === 'consent_changed', stale);
  const dark = await refusal(async () => enrolFace('asha', { photo: await photo(404), ...consent }));
  check('a dark photo: too dark, in words', dark?.status === 422 && dark.face?.reason === 'too_dark' && dark.message === FACE_MESSAGES.too_dark, dark);
  const two = await refusal(async () => enrolFace('asha', { photo: await photo(405), ...consent }));
  check('two people in the photo: more than one face', two?.face?.reason === 'multiple_faces', two);
  const none = await refusal(async () => enrolFace('asha', { photo: await photo(403), ...consent }));
  check('no face: no face found', none?.face?.reason === 'no_face', none);
  const garbage = await refusal(() => enrolFace('asha', { photo: Buffer.from('not an image'), ...consent }));
  check('a file that is not a picture is refused, not a crash', garbage?.status === 400, garbage);
  const enrolled = await enrolFace('asha', { photo: await photo(401), ...consent });
  check('a good photo enrols', enrolled.enrolled === true, enrolled);
  const asha = await users().findOne({ userId: 'asha' });
  check('the record keeps the face id, the consent time and version, and no photo without a bucket',
    Boolean(asha?.faceId?.faceId) && asha?.faceId?.consentVersion === FACE_CONSENT_VERSION && asha.faceId.consentAt instanceof Date && !asha.faceId.photoKey, asha?.faceId);
  check('the face is in the company collection under her user id', Boolean(collections.get(collection)?.some((face) => face.externalImageId === 'asha')), collections.get(collection));

  // --- one face, one account
  const borrowed = await refusal(async () => enrolFace('bala', { photo: await photo(401), ...consent }));
  check("Bala cannot enrol Asha's face on his account", borrowed?.face?.reason === 'already_enrolled_elsewhere', borrowed);
  await enrolFace('bala', { photo: await photo(402), ...consent });
  await enrolFace('dev', { photo: await photo(409), ...consent });
  await enrolFace('esha', { photo: await photo(410), ...consent });
  // Whoever holds an enrolled phone must not swap in their own face: setting
  // up again goes through HR's reset.
  const again = await refusal(async () => enrolFace('asha', { photo: await photo(402), ...consent }));
  check('setting up again is refused, pointing to HR', again?.status === 409 && again.face?.reason === 'already_enrolled', again);
  const ashaFaces = collections.get(collection)!.filter((face) => face.externalImageId === 'asha');
  check('and her one enrolled face stays', ashaFaces.length === 1, ashaFaces);

  // --- HR switches it on
  const settings = await updateFaceIdSettingsForAdmin('hr', { checkAtPunch: true });
  check('one switch: faces checked at punches', settings.checkAtPunch === true, settings);
  check('a setting must be true or false', (await refusal(() => updateFaceIdSettingsForAdmin('hr', { checkAtPunch: 'yes' })))?.status === 400);
  await users().updateOne({ userId: 'chetan' }, { $set: { employeeId: 'E-C2' } });
  const notSetUp = await refusal(() => recordPunch('chetan', 'in'));
  check('not set up: the punch is refused with set up first', notSetUp?.status === 428 && notSetUp.face?.reason === 'not_enrolled' && notSetUp.face?.setup === true, notSetUp);
  const noToken = await refusal(() => recordPunch('asha', 'in'));
  check('enrolled, no check: the punch is refused with verify first', noToken?.status === 403 && noToken.face?.reason === 'check_required', noToken);
  const forged = await refusal(() => recordPunch('asha', 'in', undefined, undefined, false, 'made-up-token'));
  check('a made-up token is refused', forged?.status === 403 && forged.face?.reason === 'check_expired', forged);
  const oldApp = await refusal(() => recordPunch('esha', 'out'));
  check('a punch-out is face-checked too, and an old app is told to update',
    oldApp?.status === 403 && oldApp.face?.updateApp === true && /Update the Sowaka app/.test(oldApp.message ?? ''), oldApp);
  check('geotag and in-app punches are checked; biometric and Auto Punch are not',
    ['Geotag (powered by Sowaka)', 'In-app punch in', 'Biometric', 'Present by default (Auto Punch)']
      .map((format) => faceCheckNeeded({ checkAtPunch: true }, format)).join() === 'true,true,false,false');
  check('nothing is checked while the switch is off', !faceCheckNeeded({ checkAtPunch: false }, 'In-app punch in'));

  // --- the check: wrong faces fail, with reasons, and count towards the fallback
  const asBala = await verifyFace('asha', { photo: await photo(402), challenge: 'blink', devicePassed: true });
  check("Bala's face on Asha's phone: not a match, no token", !asBala.passed && asBala.reason === 'other_person' && !('token' in asBala) && asBala.attemptsLeft === 2, asBala);
  check("the message does not say whose face it was", asBala.message === FACE_MESSAGES.not_a_match, asBala.message);
  const early = await refusal(() => requestFaceFallback('asha'));
  check('the fallback stays shut before the tries run out', early?.status === 409 && early.face?.attemptsLeft === 2, early);
  const blank = await verifyFace('asha', { photo: await photo(403) });
  check('no face in the selfie: no face found', blank.reason === 'no_face' && blank.attemptsLeft === 1, blank);
  const lookalike = await verifyFace('asha', { photo: await photo(407) });
  check('a lookalike at 90: below the 95 mark, logged with its score', lookalike.reason === 'not_a_match' && lookalike.similarity === 90.2 && lookalike.fallbackAvailable, lookalike);
  const log = await faceVerifications().find({ userId: 'asha', kind: 'verify' }).sort({ at: 1 }).toArray();
  check('every check is logged with its outcome, score and liveness', log.length === 3 && log[0].matchedUserId === 'bala' && log[0].liveness?.mode === 'device' && log[0].liveness.challenge === 'blink' && log[2].similarity === 90.2, log);

  // --- a pass: the token, spent once, by this person only
  const pass = await verifyFace('asha', { photo: await photo(401) });
  check('her own face passes with a token', pass.passed && typeof pass.token === 'string' && pass.similarity === 99.6, pass);
  const bobPass = await verifyFace('bala', { photo: await photo(402) });
  const stolen = await refusal(() => recordPunch('asha', 'in', undefined, undefined, false, bobPass.token));
  check("Bala's token does not punch Asha in", stolen?.status === 403, stolen);
  const punched = await recordPunch('asha', 'in', undefined, undefined, false, pass.token) as { punchIn?: string };
  check('her token punches her in', typeof punched.punchIn === 'string', punched);
  const day = await attendanceRecords().findOne({ employeeId: 'E-A' });
  check('the day keeps the check it went through on', day?.punchInFace?.similarity === 99.6 && day.punchInFace.liveness === 'device', day?.punchInFace);
  check('a spent token is spent', (await refusal(() => claimFaceToken('asha', pass.token, 'again')))?.status === 403);
  const late = await verifyFace('bala', { photo: await photo(402) });
  const lateHash = createHash('sha256').update(late.token!).digest('hex');
  await faceVerifications().updateOne({ tokenHash: lateHash }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const expired = await refusal(() => recordPunch('bala', 'in', undefined, undefined, false, late.token));
  const expiredRow = await faceVerifications().countDocuments({ userId: 'bala', passed: true, expiresAt: { $lt: new Date() } });
  check('an expired token is refused', expired?.status === 403 && expiredRow >= 1, expired);

  // --- face first, then location: a punch refused outside gives the token back
  await offices().insertOne({ id: 'off-1', org: ORG, name: 'HQ', latitude: 28.4595, longitude: 77.0266, radiusMeters: 200, active: true, createdAt: new Date(), updatedAt: new Date() });
  const devPass = await verifyFace('dev', { photo: await photo(409) });
  const far = { latitude: 28.6139, longitude: 77.209, accuracy: 10 };
  const outside = await refusal(() => recordPunch('dev', 'in', far, undefined, false, devPass.token));
  check('outside the office: asked for a reason', outside?.status === 409 && Boolean(outside.details?.outsideLocation), outside);
  const request = await recordPunch('dev', 'in', far, 'Client visit', false, devPass.token) as { request?: { kind?: string } };
  check('the same check carries the punch with a reason', request.request?.kind === 'out_of_location', request);
  const ool = await attendanceRegularizations().findOne({ userId: 'dev', kind: 'out_of_location' });
  check('the out-of-location request keeps the face check for the day', ool?.punchInFace?.similarity === 99.6, ool);
  check('and then the token is spent', (await refusal(() => claimFaceToken('dev', devPass.token, 'again')))?.status === 403);

  // --- the way out: three failures, or the service down, go to the manager
  for (const height of [402, 403, 407]) await verifyFace('esha', { photo: await photo(height) });
  const fallback = await requestFaceFallback('esha', { latitude: 28.4596, longitude: 77.0267, accuracy: 12 });
  check('after three tries the punch-in goes to the manager', fallback.title === 'Punch-in without face check' && Boolean(fallback.id), fallback);
  const row = await attendanceRegularizations().findOne({ userId: 'esha', kind: 'face_check' });
  check('as a correction request, with the time, the tries and where from',
    row?.status === 'pending' && row.managerUserId === 'mgr' && row.punchIn instanceof Date && row.faceCheck?.attempts === 3 && row.faceCheck.inside === true && row.faceCheck.officeName === 'HQ', row);
  check('only one per day', (await refusal(() => requestFaceFallback('esha')))?.status === 409);
  const outPass = await verifyFace('esha', { photo: await photo(410) });
  const pendingOut = await recordPunch('esha', 'out', { latitude: 28.4596, longitude: 77.0267, accuracy: 12 }, undefined, false, outPass.token) as { request?: unknown; punchOut?: string };
  check('a checked punch-out rides on the request', Boolean(pendingOut.request) && typeof pendingOut.punchOut === 'string', pendingOut);
  check('and spends its token', (await refusal(() => claimFaceToken('esha', outPass.token, 'again')))?.status === 403);
  await decideRegularization('mgr', row!._id!.toHexString(), { decision: 'approved' });
  const eshaDay = await attendanceRecords().findOne({ employeeId: 'E-E' });
  check('approved, the day takes the punch-in and punch-out', eshaDay?.punchIn?.getTime() === row!.punchIn!.getTime() && Boolean(eshaDay?.punchOut), eshaDay);

  // --- a punch-out whose check fails three times goes to the manager too
  // --- setup at the first punch: Chetan has not set up Face ID
  const setUpAtPunch = await enrolFace('chetan', { photo: await photo(408), ...consent });
  check('setting up at a punch hands back a punch token', typeof setUpAtPunch.token === 'string' && Boolean(setUpAtPunch.expiresAt), setUpAtPunch);
  const tokenRow = await faceVerifications().findOne({ userId: 'chetan', kind: 'enrol', passed: true });
  check('the same five minutes as a check', Math.abs(tokenRow!.expiresAt!.getTime() - tokenRow!.at.getTime() - 300_000) < 5000, tokenRow?.expiresAt);
  check("Bala cannot spend Chetan's setup token", (await refusal(() => claimFaceToken('bala', setUpAtPunch.token, 'x')))?.status === 403);
  const chetanIn = await recordPunch('chetan', 'in', { latitude: 28.4596, longitude: 77.0267, accuracy: 12 }, undefined, false, setUpAtPunch.token) as { punchIn?: string };
  check('the setup carries that punch, with no second selfie', typeof chetanIn.punchIn === 'string', chetanIn);
  check('and the setup token is spent', (await refusal(() => claimFaceToken('chetan', setUpAtPunch.token, 'again')))?.status === 403);
  const later = await refusal(() => recordPunch('chetan', 'out', { latitude: 28.4596, longitude: 77.0267, accuracy: 12 }));
  check('every later punch needs the normal check', later?.status === 403 && later.face?.reason === 'check_required', later);

  // --- a setup that fails three times at a punch opens the same fallback
  const setupFails: Awaited<ReturnType<typeof refusal>>[] = [];
  for (const height of [403, 404, 405]) setupFails.push(await refusal(async () => enrolFace('gita', { photo: await photo(height), ...consent })));
  check('each failed setup says why, with the tries left',
    JSON.stringify(setupFails.map((r) => [r?.face?.reason, r?.face?.attemptsLeft])) === JSON.stringify([['no_face', 2], ['too_dark', 1], ['multiple_faces', 0]]), setupFails.map((r) => r?.face));
  check('the third opens the fallback', setupFails[2]?.face?.fallback === true, setupFails[2]?.face);
  const gitaFallback = await requestFaceFallback('gita');
  check('and the punch-in goes to the manager', gitaFallback.title === 'Punch-in without face check', gitaFallback);
  const earlyOut = await refusal(() => requestFaceFallback('chetan', undefined, 'out'));
  check('the punch-out fallback stays shut before the tries run out', earlyOut?.status === 409, earlyOut);
  for (const height of [402, 403, 407]) await verifyFace('chetan', { photo: await photo(height) });
  const outFallback = await requestFaceFallback('chetan', undefined, 'out');
  check('after three tries the punch-out goes to the manager', outFallback.title === 'Punch-out without face check', outFallback);
  const outRow = await attendanceRegularizations().findOne({ userId: 'chetan', kind: 'face_check' });
  check('as a request for the punch-out alone', outRow?.punchOut instanceof Date && !outRow.punchIn && outRow.faceCheck?.punchType === 'out', outRow);
  await decideRegularization('mgr', outRow!._id!.toHexString(), { decision: 'approved' });
  const chetanDay = await attendanceRecords().findOne({ employeeId: 'E-C2' });
  check('approved, the day keeps its punch-in and takes the punch-out', Boolean(chetanDay?.punchIn) && chetanDay?.punchOut?.getTime() === outRow!.punchOut!.getTime(), chetanDay);

  await users().updateOne({ userId: 'bala' }, { $set: { employeeId: 'E-B2' } });
  const down = await verifyFace('bala', { photo: await photo(406) });
  check('AWS unreachable: said so, and the fallback opens at once', !down.passed && down.reason === 'unavailable' && down.fallbackAvailable && down.message === FACE_MESSAGES.unavailable, down);
  const balaFallback = await requestFaceFallback('bala');
  check('and sends the punch-in to the manager', Boolean(balaFallback.id), balaFallback);

  // --- Face Liveness, once switched on
  env.face.liveness = true;
  const livenessStatus = await faceStatusFor('asha');
  check('with Face Liveness on the app is told to stream', livenessStatus.liveness.mode === 'aws', livenessStatus.liveness);
  const selfieOnly = await refusal(async () => verifyFace('asha', { photo: await photo(401) }));
  check('a selfie alone is no longer enough', selfieOnly?.status === 400 && selfieOnly.face?.reason === 'liveness_required', selfieOnly);
  const { sessionId } = await startLivenessSession('asha');
  sessions.set(sessionId, { status: 'SUCCEEDED', confidence: 98.5, person: 'asha' });
  const notHers = await verifyFace('bala', { livenessSessionId: sessionId });
  check("someone else's session is not theirs to use", notHers.reason === 'liveness_failed', notHers);
  const live = await verifyFace('asha', { livenessSessionId: sessionId });
  check('a live session with her face passes', live.passed && Boolean(live.token), live);
  check('a session is read once', (await verifyFace('asha', { livenessSessionId: sessionId })).reason === 'liveness_failed');
  const spoof = await startLivenessSession('asha');
  sessions.set(spoof.sessionId, { status: 'SUCCEEDED', confidence: 40, person: 'asha' });
  const spoofed = await verifyFace('asha', { livenessSessionId: spoof.sessionId });
  const spoofLog = await faceVerifications().findOne({ 'liveness.sessionId': spoof.sessionId });
  check('a low liveness score fails, logged with it', spoofed.reason === 'liveness_failed' && spoofLog?.liveness?.confidence === 40, spoofLog?.liveness);
  env.face.liveness = false;

  // --- HR: who has set it up, the log, reset, and deleting an employee
  const overview = await faceIdOverviewForAdmin('hr');
  const ashaRow = overview.people.find((row) => row.userId === 'asha');
  check('HR sees who has set it up', overview.enrolledCount === 5 && overview.people.find((row) => row.userId === 'mgr')?.enrolled === false, overview.enrolledCount);
  check("HR sees each person's failures this month", (ashaRow?.failedLast30Days ?? 0) >= 4, ashaRow);
  const checks = await listFaceChecksForAdmin('hr', {});
  check('the failed checks, named, with the colleague a face matched', checks.length > 0 && checks.every((row) => !row.passed) && checks.some((row) => row.matchedName === 'Bala'), checks.slice(0, 2));
  check('the log never carries a token', checks.every((row) => !('tokenHash' in row)));
  const failsBeforeReset = (await faceStatusFor('asha')).failedAttempts;
  await resetFaceIdForAdmin('hr', 'asha');
  check('a reset is logged, and is not a failed try', (await faceStatusFor('asha')).failedAttempts === failsBeforeReset
    && (await faceVerifications().countDocuments({ userId: 'asha', kind: 'reset' })) === 1);
  const reset = await users().findOne({ userId: 'asha' });
  check('reset removes the enrolment and the face from the collection',
    !reset?.faceId && !collections.get(collection)!.some((face) => face.externalImageId === 'asha'), reset?.faceId);
  check('then the check asks for setup again', (await refusal(async () => verifyFace('asha', { photo: await photo(401) })))?.status === 428);
  await deleteEmployeeForAdmin('hr', 'dev', 'Dev');
  check("deleting an employee deletes their face", !collections.get(collection)!.some((face) => face.externalImageId === 'dev'), collections.get(collection));
  check('every reason has words', Object.values(FACE_MESSAGES).every((message) => message.length > 5));

  // --- the log's retention: counted first, deleted only when asked
  const old = new Date(Date.now() - 400 * 86_400_000);
  await faceVerifications().insertOne({ org: ORG, userId: 'asha', kind: 'verify', at: old, passed: false, reason: 'not_a_match' });
  const recent = await faceVerifications().countDocuments({ at: { $gte: new Date(Date.now() - 86_400_000) } });
  const dry = await pruneFaceLog();
  check('a dry run counts the year-old row and deletes nothing', dry.checks === 1 && !dry.deleted && (await faceVerifications().countDocuments({ at: old })) === 1, dry);
  const applied = await pruneFaceLog({ apply: true });
  check('applied, it deletes only rows past the retention',
    applied.checks === 1 && (await faceVerifications().countDocuments({ at: old })) === 0
      && (await faceVerifications().countDocuments({ at: { $gte: new Date(Date.now() - 86_400_000) } })) === recent, applied);
  console.log(`(${calls} fake Rekognition calls)`);

  await db.dropDatabase();
  console.log(failed === 0 ? '\nall face-id checks passed' : `\n${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
