import { NextFunction, Request, Response } from 'express';
import {
  enrolFace, faceIdOverviewForAdmin, FaceIdError, faceStatusFor, listFaceChecksForAdmin, requestFaceFallback,
  resetFaceIdForAdmin, startLivenessSession, updateFaceIdSettingsForAdmin, verifyFace,
} from '../services/face-id.service';

function userId(req: Request) {
  if (!req.auth?.userId) throw new FaceIdError(401, 'Authentication required');
  return req.auth.userId;
}

/** Whether Face ID is on for this person's company, whether they have set it up, and how to check. */
export async function faceStatus(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...(await faceStatusFor(userId(req))) }); } catch (error) { next(error); }
}

/** The consented enrolment photo, as multipart `photo`, with `consent` and `consentVersion`. */
export async function enrol(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body ?? {};
    const result = await enrolFace(userId(req), {
      photo: req.file?.buffer, consent: body.consent, consentVersion: body.consentVersion,
    });
    res.status(201).json({ success: true, ...result });
  } catch (error) { next(error); }
}

export async function livenessSession(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json({ success: true, ...(await startLivenessSession(userId(req))) }); } catch (error) { next(error); }
}

/** A selfie as multipart `photo`, or a finished liveness session's id; answers pass or fail, never a verdict from the app. */
export async function verify(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body ?? {};
    res.json({
      success: true,
      ...(await verifyFace(userId(req), {
        photo: req.file?.buffer,
        livenessSessionId: body.livenessSessionId,
        challenge: body.challenge,
        devicePassed: body.devicePassed,
      })),
    });
  } catch (error) { next(error); }
}

/** After the tries run out: today's punch-in goes to the manager instead. */
export async function fallback(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body ?? {};
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    const reading = Number.isFinite(lat) && Number.isFinite(lng)
      ? { latitude: lat, longitude: lng, accuracy: Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : undefined }
      : undefined;
    const type = body.type === 'out' ? 'out' : 'in';
    res.status(201).json({ success: true, request: await requestFaceFallback(userId(req), reading, type) });
  } catch (error) { next(error); }
}

// ---------------------------------------------------------------- dashboard

export async function adminFaceOverview(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...(await faceIdOverviewForAdmin(userId(req))) }); } catch (error) { next(error); }
}

export async function adminFaceSettings(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, settings: await updateFaceIdSettingsForAdmin(userId(req), req.body ?? {}) }); } catch (error) { next(error); }
}

export async function adminFaceReset(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...(await resetFaceIdForAdmin(userId(req), String(req.params.userId ?? ''))) }); } catch (error) { next(error); }
}

export async function adminFaceChecks(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, checks: await listFaceChecksForAdmin(userId(req), req.query) }); } catch (error) { next(error); }
}
