import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess, requireDashboardTabs } from '../middleware/admin.middleware';
import { AdminError } from '../services/admin.service';
import {
  adminHandoverFile, appHandoverFile, changeLastDay, clearanceTeamOf, closeOffboarding, emailSettlement, managerLeaver, managerLeavers, markHandoverDone, myOffboarding,
  offboardingBoard, offboardingCount, offboardingDetail, offboardingTaskDone, removeHandoverUpload, requireLifecycleOrg, saveSettlementDraft, sendExitInterview, sendNudge,
  setAppPage, setClearanceTeam, setHandoverChecklist, setOffboardingClearance, settlementChecks, startExit, uploadHandover,
} from '../services/lifecycle/offboarding';
import type { UploadFile } from '../services/lifecycle/offboarding';
import { acceptResignation, managerResignationAction, managerResignations, myResignation, resign, withdrawResignation } from '../services/lifecycle/resignations';
import { exitAnswers, exitInsights, tagExitAnswer } from '../services/lifecycle/insights';

/**
 * Offboarding (docs/lifecycle/CONTRACT.md › Offboarding). Errors are `{ error, message }` with
 * the service's status. Every route answers 404 "Not available" where features.lifecycle is off.
 */
type Handler = (req: Request) => Promise<unknown>;
const send = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req);
    res.status(200).json({ success: true, ...(out as object) });
  } catch (error) {
    if (error instanceof AdminError) res.status(error.statusCode).json({ success: false, error: error.message, message: error.message });
    else next(error);
  }
};
const me = (req: Request) => req.auth!.userId;
const param = (req: Request, key: string) => String(req.params[key] ?? '');
const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

async function lifecycleOn(req: Request, res: Response, next: NextFunction) {
  try { await requireLifecycleOrg(req.auth?.user?.org); next(); }
  catch { res.status(404).json({ success: false, error: 'Not available', message: 'Not available' }); }
}

/** A handover file: 10 MB, any type; served back as what its bytes say (PDF, JPEG, PNG) or as a download. */
const handoverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } }).single('file');
function readUpload(req: Request, res: Response, next: NextFunction) {
  if (!req.is('multipart/form-data')) return next();
  handoverUpload(req, res, (error: unknown) => {
    if (!error) return next();
    const tooBig = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ success: false, error: tooBig ? 'A file must be 10 MB or smaller' : 'The upload is invalid', message: tooBig ? 'A file must be 10 MB or smaller' : 'The upload is invalid' });
  });
}
function sniff(bytes: Buffer): string {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return 'application/octet-stream';
}
const fileOf = (req: Request): UploadFile | undefined => (req.file ? { name: req.file.originalname || 'file', contentType: sniff(req.file.buffer), bytes: req.file.buffer } : undefined);

/** Sends a handover file: JSON `{ url }` for a stored one (S3), else the bytes. */
const sendFile = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = (await fn(req)) as { url: string } | { bytes: Buffer; name: string; contentType: string };
    if ('url' in out) { res.status(200).json({ success: true, url: out.url }); return; }
    const inline = out.contentType !== 'application/octet-stream';
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${out.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(out.bytes);
  } catch (error) {
    if (error instanceof AdminError) res.status(error.statusCode).json({ success: false, error: error.message, message: error.message });
    else next(error);
  }
};

// ———————————————————————————————— the app: /lifecycle (the leaver and the manager)
export const lifecycleOffboardingRouter = Router();
lifecycleOffboardingRouter.use(requireAuth, lifecycleOn);
lifecycleOffboardingRouter.get('/resignation', send((req) => myResignation(me(req))));
lifecycleOffboardingRouter.post('/resignation', send((req) => resign(me(req), body(req))));
lifecycleOffboardingRouter.post('/resignation/withdraw', send((req) => withdrawResignation(me(req))));
lifecycleOffboardingRouter.get('/offboarding', send((req) => myOffboarding(me(req))));
lifecycleOffboardingRouter.post('/offboarding/handover/:id', readUpload, send((req) => uploadHandover(me(req), param(req, 'id'), { file: fileOf(req), url: body(req).url })));
lifecycleOffboardingRouter.delete('/offboarding/handover/:id', send((req) => removeHandoverUpload(me(req), param(req, 'id'))));
lifecycleOffboardingRouter.get('/offboarding/handover/:id/file', sendFile((req) => appHandoverFile(me(req), param(req, 'id'))));
lifecycleOffboardingRouter.post('/offboarding/interview', send((req) => sendExitInterview(me(req), body(req))));
lifecycleOffboardingRouter.get('/manager/resignations', send((req) => managerResignations(me(req))));
lifecycleOffboardingRouter.post('/manager/resignations/:id', send((req) => managerResignationAction(me(req), param(req, 'id'), body(req))));
lifecycleOffboardingRouter.get('/manager/leavers', send((req) => managerLeavers(me(req))));
lifecycleOffboardingRouter.get('/manager/leavers/:userId', send((req) => managerLeaver(me(req), param(req, 'userId'))));
lifecycleOffboardingRouter.put('/manager/leavers/:userId/handover', send((req) => setHandoverChecklist(me(req), param(req, 'userId'), body(req))));
lifecycleOffboardingRouter.post('/manager/leavers/:userId/handover/done', send((req) => markHandoverDone(me(req), param(req, 'userId'))));

// ———————————————————————————————— the dashboard: /admin/lifecycle (the offboarding and exit_insights tabs)
export const lifecycleOffboardingAdminRouter = Router();
lifecycleOffboardingAdminRouter.use(requireAuth, requireDashboardAccess, requireDashboardTabs, lifecycleOn);
lifecycleOffboardingAdminRouter.get('/offboarding/board', send((req) => offboardingBoard(me(req), req.query as Record<string, string>)));
// Before /offboarding/:userId, which would take "count" for a person.
lifecycleOffboardingAdminRouter.get('/offboarding/count', send((req) => offboardingCount(me(req))));
lifecycleOffboardingAdminRouter.get('/offboarding/clearance-team/:userId', send((req) => clearanceTeamOf(me(req), param(req, 'userId'))));
lifecycleOffboardingAdminRouter.put('/offboarding/clearance-team/:userId', send((req) => setClearanceTeam(me(req), param(req, 'userId'), body(req))));
lifecycleOffboardingAdminRouter.get('/offboarding/:userId', send((req) => offboardingDetail(me(req), param(req, 'userId'))));
lifecycleOffboardingAdminRouter.post('/resignations/:id/accept', send((req) => acceptResignation(me(req), param(req, 'id'), body(req))));
lifecycleOffboardingAdminRouter.post('/offboarding/:userId/start', send((req) => startExit(me(req), param(req, 'userId'), body(req))));
lifecycleOffboardingAdminRouter.put('/offboarding/:userId/clearance', send((req) => setOffboardingClearance(me(req), param(req, 'userId'), body(req))));
lifecycleOffboardingAdminRouter.post('/offboarding/:userId/last-day', send((req) => changeLastDay(me(req), param(req, 'userId'), body(req))));
lifecycleOffboardingAdminRouter.post('/offboarding/:userId/app-page', send((req) => setAppPage(me(req), param(req, 'userId'), body(req))));
lifecycleOffboardingAdminRouter.post('/offboarding/:userId/tasks/:systemKey', send((req) => offboardingTaskDone(me(req), param(req, 'userId'), param(req, 'systemKey'), body(req))));
lifecycleOffboardingAdminRouter.get('/offboarding/:userId/settlement/checks', send((req) => settlementChecks(me(req), param(req, 'userId'))));
lifecycleOffboardingAdminRouter.put('/offboarding/:userId/settlement/draft', send((req) => saveSettlementDraft(me(req), param(req, 'userId'), body(req))));
lifecycleOffboardingAdminRouter.post('/offboarding/:userId/nudge', send((req) => sendNudge(me(req), param(req, 'userId'), body(req))));
lifecycleOffboardingAdminRouter.post('/offboarding/:userId/settlement/email', send((req) => emailSettlement(me(req), param(req, 'userId'), body(req))));
lifecycleOffboardingAdminRouter.post('/offboarding/:userId/close', send((req) => closeOffboarding(me(req), param(req, 'userId'), body(req))));
lifecycleOffboardingAdminRouter.get('/offboarding/:userId/handover/:id/file', sendFile((req) => adminHandoverFile(me(req), param(req, 'userId'), param(req, 'id'))));
lifecycleOffboardingAdminRouter.get('/exit-insights/answers', send((req) => exitAnswers(me(req), req.query as Record<string, string>)));
lifecycleOffboardingAdminRouter.put('/exit-insights/answers/:id', send((req) => tagExitAnswer(me(req), param(req, 'id'), body(req))));
lifecycleOffboardingAdminRouter.get('/exit-insights', send((req) => exitInsights(me(req), req.query as Record<string, string>)));
