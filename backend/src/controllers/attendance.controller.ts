import { NextFunction, Request, Response } from 'express';
import {
  AttendanceError, decideRegularization, getManagerRegularizations, punchOfficesFor,
  getMyAttendance, getTeamMemberAttendance, recordPunch, requestRegularization,
} from '../services/attendance.service';

function userId(req: Request) {
  if (!req.auth?.userId) throw new AttendanceError(401, 'Authentication required');
  return req.auth.userId;
}
export async function listMine(req: Request, res: Response, next: NextFunction) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = String(req.query.from ?? `${today.slice(0, 8)}01`);
    const data = await getMyAttendance(userId(req), from, String(req.query.to ?? today));
    res.json({ success: true, ...data });
  } catch (error) { next(error); }
}
export async function listTeamMemberAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    const employeeUserId = String(req.params.employeeUserId ?? '');
    const today = new Date().toISOString().slice(0, 10);
    const from = String(req.query.from ?? `${today.slice(0, 8)}01`);
    const data = await getTeamMemberAttendance(
      userId(req), employeeUserId, from, String(req.query.to ?? today),
    );
    res.json({ success: true, ...data });
  } catch (error) { next(error); }
}
export async function punch(req: Request, res: Response, next: NextFunction) {
  try {
    // Raw as the device saw it. No verdict is accepted from the client — the
    // service decides whether this falls inside an office.
    const body = req.body ?? {};
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    const reading =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? {
            latitude: lat,
            longitude: lng,
            accuracy: Number.isFinite(Number(body.accuracy))
              ? Number(body.accuracy)
              : undefined,
            mocked: body.mocked === true,
          }
        : undefined;
    const result = await recordPunch(userId(req), String(body.type ?? ''), reading);
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}

/** Where this employee's org lets them punch from. */
export async function punchLocations(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, offices: await punchOfficesFor(userId(req)) });
  } catch (error) { next(error); }
}
export async function createRegularization(req: Request, res: Response, next: NextFunction) {
  try {
    const regularization = await requestRegularization(userId(req), req.body ?? {});
    res.status(201).json({ success: true, regularization });
  } catch (error) { next(error); }
}
export async function listInbox(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, regularizations: await getManagerRegularizations(userId(req)) }); }
  catch (error) { next(error); }
}
export async function updateDecision(req: Request, res: Response, next: NextFunction) {
  try {
    const regularization = await decideRegularization(userId(req), String(req.params.id ?? ''), req.body ?? {});
    res.json({ success: true, regularization });
  } catch (error) { next(error); }
}
