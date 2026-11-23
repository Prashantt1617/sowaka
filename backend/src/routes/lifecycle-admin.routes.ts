import { Router, type NextFunction, type Request, type Response } from 'express';
import { hasAllDashboardTabs, requireDashboardAccess, requireDashboardTabs } from '../middleware/admin.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { LIFECYCLE_TABS } from '../models/dashboard-tabs';
import {
  actOnTaskByHr, decideBankPfRequest, decisionWithoutPay, journeyForViewer, journeyPanel, lifecycleViewer, onboardingBoard, onboardingCounts, closedJourneys, boardJoiners,
  moveJourneysToTemplate, surveyAnswers, updateJourneyByHr,
} from '../services/lifecycle/board';
import { nudgeTask } from '../services/lifecycle/nudges';
import { LifecycleError, lifecycleEnabled, loadJourney, requireLifecycle } from '../services/lifecycle/engine';
import { probationOf, recordDecision } from '../services/lifecycle/probation';
import { createTemplate, deleteTemplate, getTemplate, isKind, listTemplates, templateJourneys, updateTemplate } from '../services/lifecycle/templates';
import multer from 'multer';
import { MAX_VIDEO_BYTES, saveTemplateDesign, templateDesign, templateMediaBytes, templatePreview, uploadTemplateMedia } from '../services/lifecycle/design';
import { UTF8_FILE_NAMES, contentDisposition } from '../services/lifecycle/files';
import { approveProfileSection, hrProfileView, hrSaveProfileSection, preboardingPeople, unlockProfileSection } from '../services/lifecycle/preboardingProfile';
import { grantAppAccess, saveBasicDetails } from '../services/lifecycle/joinerBasics';
import { pendingSetupForViewer, savePendingSetup } from '../services/lifecycle/pendingSetup';

/**
 * The dashboard's onboarding side of the employee lifecycle, mounted at
 * `/admin/lifecycle` (docs/lifecycle/CONTRACT.md "Dashboard — onboarding").
 * Behind dashboard access and the lifecycle tabs; every route but /settings
 * answers 404 `{ error: 'Not available' }` while `features.lifecycle` is off.
 * Errors are `{ error }`.
 */
export const lifecycleAdminRouter = Router();

type Caller = { userId: string; name: string; org: string };

function caller(req: Request): Caller {
  const user = req.auth?.user;
  if (!user) throw new LifecycleError(401, 'Authentication required');
  if (!user.org) throw new LifecycleError(409, 'Your account is not attached to a company');
  return { userId: user.userId, name: user.name, org: user.org };
}

/** Answers `{ error }` for a refusal with a status; anything else goes to the error middleware. */
export function lifecycleHandler(fn: (req: Request) => Promise<unknown>, status = 200) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (error) {
      const code = (error as { statusCode?: unknown }).statusCode;
      if (typeof code === 'number' && code >= 400 && code < 500) {
        // `details`: extra fields beside `error` (e.g. the existing app account on a second "Generate app access").
        const details = (error as { details?: Record<string, unknown> }).details;
        res.status(code).json({ ...(details ?? {}), error: (error as Error).message });
        return;
      }
      next(error);
    }
  };
}

/** 404 `{ error: 'Not available' }` while the company's `features.lifecycle` is off. */
export async function lifecycleGate(req: Request, res: Response, next: NextFunction) {
  try {
    await requireLifecycle(req.auth?.user?.org);
  } catch {
    res.status(404).json({ error: 'Not available' });
    return;
  }
  next();
}

const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;
/** What this dashboard user may see on a joiner: pay (a payroll tab) and documents (HR). */
const viewerOf = (req: Request) => lifecycleViewer(req.auth?.user as { dashboardAdmin?: boolean; dashboardTabs?: string[] } | undefined);

async function ownJourney(req: Request) {
  const me = caller(req);
  const j = await loadJourney(String(req.params.id));
  if (j.org !== me.org) throw new LifecycleError(404, 'Journey not found');
  return { me, j };
}

lifecycleAdminRouter.use(requireAuth, requireDashboardAccess, requireDashboardTabs);

// Read by the dashboard to show the group at all, so it answers while the switch is off.
lifecycleAdminRouter.get('/settings', lifecycleHandler(async (req) => {
  const me = caller(req);
  const user = req.auth?.user;
  const mine = new Set(user?.dashboardTabs ?? []);
  const tabs = hasAllDashboardTabs(user) ? [...LIFECYCLE_TABS] : LIFECYCLE_TABS.filter((tab) => mine.has(tab));
  return { enabled: await lifecycleEnabled(me.org), tabs };
}));

lifecycleAdminRouter.use(lifecycleGate);

// Templates (S2–S4)
lifecycleAdminRouter.get('/templates', lifecycleHandler(async (req) => {
  const kind = req.query.kind;
  if (kind !== undefined && kind !== '' && !isKind(kind)) throw new LifecycleError(400, 'kind is onboarding or offboarding');
  return { templates: await listTemplates(caller(req).org, isKind(kind) ? kind : undefined) };
}));
lifecycleAdminRouter.post('/templates', lifecycleHandler(async (req) => {
  const me = caller(req);
  return { template: await createTemplate(me.org, body(req), me.name) };
}, 201));
// Onboarding · Final designs (docs/lifecycle/FINAL-DESIGNS.md §4.1): the template editor's whole document, media, the Employee preview.
const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VIDEO_BYTES + 1, files: 1 }, ...UTF8_FILE_NAMES }).single('file');
lifecycleAdminRouter.get('/templates/media/:fileId', async (req, res, next) => {
  try {
    const file = await templateMediaBytes(caller(req).org, String(req.params.fileId));
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', contentDisposition(file.name));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.bytes);
  } catch (error) {
    const code = (error as { statusCode?: unknown }).statusCode;
    if (typeof code === 'number' && code >= 400 && code < 500) { res.status(code).json({ error: (error as Error).message }); return; }
    next(error);
  }
});
lifecycleAdminRouter.get('/templates/:id/design', lifecycleHandler(async (req) => templateDesign(caller(req).org, String(req.params.id))));
lifecycleAdminRouter.put('/templates/:id/design', lifecycleHandler(async (req) => {
  const me = caller(req);
  return saveTemplateDesign(me.org, String(req.params.id), body(req), me.name);
}));
lifecycleAdminRouter.get('/templates/:id/preview', lifecycleHandler(async (req) => templatePreview(caller(req).org, String(req.params.id), req.query.stage)));
lifecycleAdminRouter.post('/templates/:id/media', (req, res, next) => mediaUpload(req, res, (error) => {
  if (error) { res.status(400).json({ error: error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 'A video can be up to 50 MB' : 'The upload did not work' }); return; }
  next();
}), lifecycleHandler(async (req) => uploadTemplateMedia(caller(req).org, String(req.params.id), req.file as never), 201));
// A template's Joiners tab: who follows it (?scope=all: every open journey of its kind, for Edit joiners).
lifecycleAdminRouter.get('/templates/:id/journeys', lifecycleHandler(async (req) => templateJourneys(caller(req).org, String(req.params.id), req.query.scope)));
// Edit joiners: move joiners onto this onboarding template ({ journeyIds }); off another is onto this one.
lifecycleAdminRouter.post('/templates/:id/journeys', lifecycleHandler(async (req) => moveJourneysToTemplate(caller(req).org, String(req.params.id), body(req))));
lifecycleAdminRouter.get('/templates/:id', lifecycleHandler(async (req) => ({ template: await getTemplate(caller(req).org, String(req.params.id)) })));
lifecycleAdminRouter.put('/templates/:id', lifecycleHandler(async (req) => {
  const me = caller(req);
  return { template: await updateTemplate(me.org, String(req.params.id), body(req), me.name) };
}));
lifecycleAdminRouter.delete('/templates/:id', lifecycleHandler(async (req) => ({ template: await deleteTemplate(caller(req).org, String(req.params.id)) })));

// The board (H1) and the side panel (H1b)
lifecycleAdminRouter.get('/board', lifecycleHandler(async (req) => {
  const me = caller(req);
  return onboardingBoard(me.org, me.userId, req.query as Record<string, unknown>);
}));
// The sidebar's Onboarding badge (Needs you + Late).
lifecycleAdminRouter.get('/counts', lifecycleHandler(async (req) => onboardingCounts(caller(req).org)));
// Everyone on the board, light: the Documents page's joiner picker (no cards, tasks or photos).
lifecycleAdminRouter.get('/joiners', lifecycleHandler(async (req) => boardJoiners(caller(req).org)));
// The board's Closed view: offers that ended before joining (declined, expired, not joining).
lifecycleAdminRouter.get('/closed', lifecycleHandler(async (req) => closedJourneys(caller(req).org, req.query as Record<string, unknown>)));
lifecycleAdminRouter.get('/journeys/:id', lifecycleHandler(async (req) => {
  const { me, j } = await ownJourney(req);
  return journeyPanel(me.org, j.id, new Date(), viewerOf(req), j);
}));
lifecycleAdminRouter.put('/journeys/:id', lifecycleHandler(async (req) => {
  const { me, j } = await ownJourney(req);
  const out = await updateJourneyByHr(me.org, j.id, body(req));
  return { journey: journeyForViewer(out.journey, viewerOf(req)) };
}));
// The pre-boarding profile (HR only: the answers, the documents' files): each section's answers and
// documents; approving a done section locks it for the candidate, unlocking (DELETE) opens it again;
// PUT changes a section's answers (the portal's body and checks), approved or not.
async function hrJourney(req: Request) {
  if (!viewerOf(req).seesDocuments) throw new LifecycleError(403, 'Only HR can see the employee profile');
  const { me, j } = await ownJourney(req);
  if (j.kind !== 'onboarding') throw new LifecycleError(404, 'Journey not found');
  return { me, j };
}
lifecycleAdminRouter.get('/journeys/:id/profile', lifecycleHandler(async (req) => hrProfileView((await hrJourney(req)).j)));
lifecycleAdminRouter.put('/journeys/:id/profile/:section', lifecycleHandler(async (req) => {
  const { me, j } = await hrJourney(req);
  // Basic details (employee ID, work email, role, team, location, type, Tj) live on the journey itself.
  if (req.params.section === 'basic') return hrProfileView(await saveBasicDetails(j, req.body));
  return hrSaveProfileSection(me, j, req.params.section, req.body);
}));
// "Generate app access": the joiner's app account before joining (409 with `appAccess` when it exists).
lifecycleAdminRouter.post('/journeys/:id/app-access', lifecycleHandler(async (req) => {
  const { me, j } = await hrJourney(req);
  return hrProfileView(await grantAppAccess(me, j, req.body));
}));
// Week 1's setup (KPI, salary, shift templates) chosen before the joiner has an account: kept on the journey
// and applied when the account is made (services/lifecycle/pendingSetup.ts). Each kind needs its template page's tabs.
lifecycleAdminRouter.put('/journeys/:id/pending-setup', lifecycleHandler(async (req) => {
  const { me, j } = await ownJourney(req);
  const user = req.auth?.user as { dashboardAdmin?: boolean; dashboardTabs?: string[] } | undefined;
  const pendingSetup = await savePendingSetup({ userId: me.userId, name: me.name, dashboardAdmin: user?.dashboardAdmin, dashboardTabs: user?.dashboardTabs }, j, req.body);
  return { pendingSetup: pendingSetupForViewer(pendingSetup, viewerOf(req).seesPay) };
}));
lifecycleAdminRouter.post('/journeys/:id/profile/:section/approve', lifecycleHandler(async (req) => {
  const { me, j } = await hrJourney(req);
  return approveProfileSection(me, j, req.params.section);
}));
lifecycleAdminRouter.delete('/journeys/:id/profile/:section/approve', lifecycleHandler(async (req) => unlockProfileSection((await hrJourney(req)).j, req.params.section)));
// The Employees page's "In pre-boarding" filter: joiners not yet joined (and not closed), soonest first.
lifecycleAdminRouter.get('/preboarding', lifecycleHandler(async (req) => preboardingPeople(caller(req).org)));
// Nudge / Remind: whoever the task waits on, once per task per day.
lifecycleAdminRouter.post('/journeys/:id/tasks/:taskId/nudge', lifecycleHandler(async (req) => {
  const { me, j } = await ownJourney(req);
  return nudgeTask(me.org, j.id, String(req.params.taskId), me);
}));
lifecycleAdminRouter.post('/journeys/:id/tasks/:taskId', lifecycleHandler(async (req) => {
  const { me, j } = await ownJourney(req);
  return { task: await actOnTaskByHr(me.org, j.id, String(req.params.taskId), body(req), me) };
}));
// Not in the contract's table: the week-1 bank/PF change the joiner asked for (approve writes it to payroll).
lifecycleAdminRouter.post('/journeys/:id/bank-pf-request', lifecycleHandler(async (req) => {
  const { me, j } = await ownJourney(req);
  return decideBankPfRequest(me.org, j.id, body(req), me, viewerOf(req));
}));

// Probation (H1c)
lifecycleAdminRouter.get('/journeys/:id/probation', lifecycleHandler(async (req) => {
  const { j } = await ownJourney(req);
  const out = await probationOf(j.id);
  return viewerOf(req).seesPay ? out : { ...out, decision: decisionWithoutPay(out.decision) };
}));
lifecycleAdminRouter.post('/journeys/:id/decision', lifecycleHandler(async (req) => {
  const { me, j } = await ownJourney(req);
  const { seesPay } = viewerOf(req);
  const decision = await recordDecision(j.id, { ...me, seesPay }, body(req));
  return { decision: seesPay ? decision : decisionWithoutPay(decision) };
}));

// Survey answers, HR only (names included; never shown to managers)
lifecycleAdminRouter.get('/surveys', lifecycleHandler(async (req) => surveyAnswers(caller(req).org, req.query.kind)));
