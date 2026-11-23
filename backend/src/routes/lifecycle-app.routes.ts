import { Router, type Request } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  actOnMeeting, actOnNote, actOnOwnTask, actOnPerson, addNote, assignStarterTask, checkinForMe, introView, joinerForManager,
  joinersForManager, lifecycleMe, managerProbationMonth, managerTaskDone, markWeekDoneSeen, meetingFor, notesForJoiner,
  onboardingHome, peopleView, postIntro, postWelcome, probationForMe, replyToStarterTask, revealForMe, revealSeenForMe, saveDay1Feeling, saveIntro, saveSetup,
  meetingRowMet, meetingRowNotes, saveWeek1Step, sendSurvey, starterDone, starterTasksForJoiner, surveyView, teamForJoiner, tourLessonDone, week1View,
} from '../services/lifecycle/appOnboarding';
import { LifecycleError } from '../services/lifecycle/engine';
import { contentDisposition } from '../services/lifecycle/files';
import { letterPdfForEmployee } from '../services/lifecycle/letters';
import { portalSessionForAppUser } from '../services/lifecycle/portalAuth';
import { answerApproval, teamApproval, teamJoiner, teamJoiners, teamTaskAction } from '../services/lifecycle/teamTasks';
import { newJoinersForTeammate } from '../services/lifecycle/teamNewJoiners';
import { lifecycleGate, lifecycleHandler } from './lifecycle-admin.routes';
import multer from 'multer';
import type { Response, NextFunction } from 'express';
import { MULTER_FILE_LIMIT, UTF8_FILE_NAMES } from '../services/lifecycle/files';
import {
  joinerCheckin, joinerForm, joinerGoals, joinerLetterPdf, joinerLetters, joinerMedia, joinerOnboarding, joinerOpenLetter, joinerSignLetter, joinerTaskAction,
  markWatched, saveJoinerGoal, sendJoinerCheckin, sendJoinerForm, uploadJoinerFormFile,
} from '../services/lifecycle/joinerApp';
import { joinerPayroll, joinerProfileDetails, saveJoinerProfileSection, sendJoinerPayroll } from '../services/lifecycle/joinerDetails';
import {
  answerApprovalV2, approvalViewV2, assignBuddy, buddyOptions, commentOnGoals, introduceOnFeed, inviteSenior, markCheckinRead, reviewView, scheduleMeetings,
  sendReview, sendWelcomeMessage, teamCheckin, teamGoals, teamJoinerPage, teamRowAction, teamRowNotes,
} from '../services/lifecycle/teamApp';

/**
 * The app's lifecycle endpoints for the joiner and their manager, mounted at
 * `/lifecycle` (docs/lifecycle/CONTRACT.md "App — joiner and manager"). The
 * employee's session; manager routes check the journey is one of theirs.
 * `/me` answers `{ enabled: false }` while `features.lifecycle` is off; every
 * other route is 404 `{ error: 'Not available' }` then.
 */
export const lifecycleAppRouter = Router();

function me(req: Request) {
  const user = req.auth?.user;
  if (!user) throw new LifecycleError(401, 'Authentication required');
  if (!user.org) throw new LifecycleError(409, 'Your account is not attached to a company');
  return { userId: user.userId, name: user.name, org: user.org };
}
const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;
const param = (req: Request, name: string) => String(req.params[name] ?? '');

lifecycleAppRouter.use(requireAuth);

lifecycleAppRouter.get('/me', lifecycleHandler(async (req) => lifecycleMe(me(req))));

lifecycleAppRouter.use(lifecycleGate);

// The joiner
lifecycleAppRouter.get('/onboarding', lifecycleHandler(async (req) => onboardingHome(me(req))));
lifecycleAppRouter.post('/onboarding/tasks/:taskId', lifecycleHandler(async (req) => actOnOwnTask(me(req), param(req, 'taskId'), body(req))));
lifecycleAppRouter.put('/onboarding/day1-feeling', lifecycleHandler(async (req) => saveDay1Feeling(me(req), body(req))));
lifecycleAppRouter.post('/onboarding/week-done/seen', lifecycleHandler(async (req) => markWeekDoneSeen(me(req))));
// The joining portal inside the app: a portal session for their own journey while its portal is open (no code).
lifecycleAppRouter.post('/portal-session', lifecycleHandler(async (req) => portalSessionForAppUser(me(req))));
lifecycleAppRouter.get('/onboarding/week1', lifecycleHandler(async (req) => week1View(me(req))));
lifecycleAppRouter.put('/onboarding/week1', lifecycleHandler(async (req) => saveWeek1Step(me(req), body(req), String(req.get('user-agent') ?? ''))));
lifecycleAppRouter.get('/onboarding/intro', lifecycleHandler(async (req) => introView(me(req))));
lifecycleAppRouter.put('/onboarding/intro', lifecycleHandler(async (req) => saveIntro(me(req), body(req))));
lifecycleAppRouter.post('/onboarding/intro/post', lifecycleHandler(async (req) => postIntro(me(req), body(req))));
lifecycleAppRouter.get('/onboarding/people', lifecycleHandler(async (req) => peopleView(me(req))));
lifecycleAppRouter.post('/onboarding/people/:id', lifecycleHandler(async (req) => actOnPerson(me(req), param(req, 'id'), body(req))));
lifecycleAppRouter.get('/onboarding/starter-tasks', lifecycleHandler(async (req) => starterTasksForJoiner(me(req))));
lifecycleAppRouter.post('/onboarding/starter-tasks/:id/done', lifecycleHandler(async (req) => starterDone(me(req), param(req, 'id'), body(req))));
lifecycleAppRouter.get('/onboarding/notes', lifecycleHandler(async (req) => notesForJoiner(me(req))));
lifecycleAppRouter.post('/onboarding/notes/:id', lifecycleHandler(async (req) => actOnNote(me(req), param(req, 'id'), body(req))));
lifecycleAppRouter.get('/onboarding/meetings/:id', lifecycleHandler(async (req) => meetingFor(me(req), param(req, 'id'))));
lifecycleAppRouter.post('/onboarding/meetings/:id', lifecycleHandler(async (req) => actOnMeeting(me(req), param(req, 'id'), body(req))));
// Meetings (new-joiner prototype): Mark as met and the joiner's own agenda notes on any meeting row; Your team.
lifecycleAppRouter.post('/onboarding/meeting-rows/:rowId', lifecycleHandler(async (req) => meetingRowMet(me(req), param(req, 'rowId'), body(req))));
lifecycleAppRouter.put('/onboarding/meeting-rows/:rowId/notes', lifecycleHandler(async (req) => meetingRowNotes(me(req), param(req, 'rowId'), body(req))));
lifecycleAppRouter.get('/onboarding/team', lifecycleHandler(async (req) => teamForJoiner(me(req))));
lifecycleAppRouter.post('/onboarding/tour/:lesson', lifecycleHandler(async (req) => tourLessonDone(me(req), param(req, 'lesson'))));
lifecycleAppRouter.get('/onboarding/survey', lifecycleHandler(async (req) => surveyView(me(req))));
lifecycleAppRouter.post('/onboarding/survey', lifecycleHandler(async (req) => sendSurvey(me(req), body(req))));
lifecycleAppRouter.get('/onboarding/probation', lifecycleHandler(async (req) => probationForMe(me(req))));
lifecycleAppRouter.put('/onboarding/probation/:month/checkin', lifecycleHandler(async (req) => checkinForMe(me(req), Number(param(req, 'month')), body(req))));
lifecycleAppRouter.get('/onboarding/reveal', lifecycleHandler(async (req) => revealForMe(me(req))));
lifecycleAppRouter.post('/onboarding/reveal/seen', lifecycleHandler(async (req) => revealSeenForMe(me(req))));
// Their own letter PDF (the reveal's letterUrl): only letters of theirs that HR has sent or they signed.
lifecycleAppRouter.get('/onboarding/letters/:id/pdf', async (req, res, next) => {
  try {
    const who = me(req);
    const file = await letterPdfForEmployee(who.org, who.userId, param(req, 'id'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition(file.name, req.query.download === '1'));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.bytes);
  } catch (error) {
    const code = (error as { statusCode?: unknown }).statusCode;
    if (typeof code === 'number' && code >= 400 && code < 500) { res.status(code).json({ error: (error as Error).message }); return; }
    next(error);
  }
});

// The manager
lifecycleAppRouter.get('/manager/joiners', lifecycleHandler(async (req) => joinersForManager(me(req))));
lifecycleAppRouter.get('/manager/joiners/:journeyId', lifecycleHandler(async (req) => joinerForManager(me(req), param(req, 'journeyId'))));
lifecycleAppRouter.put('/manager/joiners/:journeyId/setup', lifecycleHandler(async (req) => saveSetup(me(req), param(req, 'journeyId'), body(req))));
lifecycleAppRouter.post('/manager/joiners/:journeyId/starter-tasks', lifecycleHandler(async (req) => assignStarterTask(me(req), param(req, 'journeyId'), body(req)), 201));
lifecycleAppRouter.post('/manager/starter-tasks/:id/reply', lifecycleHandler(async (req) => replyToStarterTask(me(req), param(req, 'id'), body(req))));
lifecycleAppRouter.post('/manager/joiners/:journeyId/notes', lifecycleHandler(async (req) => addNote(me(req), param(req, 'journeyId'), body(req)), 201));
lifecycleAppRouter.post('/manager/joiners/:journeyId/welcome', lifecycleHandler(async (req) => postWelcome(me(req), param(req, 'journeyId'), body(req)), 201));
lifecycleAppRouter.post('/manager/joiners/:journeyId/tasks/:taskId', lifecycleHandler(async (req) => managerTaskDone(me(req), param(req, 'journeyId'), param(req, 'taskId'), body(req))));
lifecycleAppRouter.put('/manager/joiners/:journeyId/probation/:month', lifecycleHandler(async (req) => managerProbationMonth(me(req), param(req, 'journeyId'), Number(param(req, 'month')), body(req))));

// Teams › Joiners for the manager, the buddy and the head of department (services/lifecycle/teamTasks.ts):
// the joiners I'm connected to, one joiner's page with my tasks for them, ticks, and the confirmation approval.
lifecycleAppRouter.get('/team/joiners', lifecycleHandler(async (req) => teamJoiners(me(req))));
// Teams › Joiners for every teammate (peers under the same manager, the same department, the manager and the buddy):
// the people joining tomorrow or in their first month, each opening their profile (services/lifecycle/teamNewJoiners.ts).
lifecycleAppRouter.get('/team/new-joiners', lifecycleHandler(async (req) => newJoinersForTeammate(me(req))));
lifecycleAppRouter.get('/team/joiners/:journeyId', lifecycleHandler(async (req) => teamJoiner(me(req), param(req, 'journeyId'))));
lifecycleAppRouter.post('/team/joiners/:journeyId/tasks/:taskId', lifecycleHandler(async (req) => teamTaskAction(me(req), param(req, 'journeyId'), param(req, 'taskId'), body(req))));
lifecycleAppRouter.get('/team/joiners/:journeyId/approval', lifecycleHandler(async (req) => teamApproval(me(req), param(req, 'journeyId'))));
lifecycleAppRouter.post('/team/joiners/:journeyId/approval', lifecycleHandler(async (req) => answerApproval(me(req), param(req, 'journeyId'), body(req))));

// ─── Onboarding · Final designs (docs/lifecycle/FINAL-DESIGNS.md §4.2–§4.4) ──

const oneFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: MULTER_FILE_LIMIT, files: 1 }, ...UTF8_FILE_NAMES }).single('file');
const withFile = (req: Request, res: Response, next: NextFunction) => oneFile(req, res, (error) => {
  if (error) { res.status(400).json({ error: 'A file can be up to 10 MB' }); return; }
  next();
});
/** Bytes with Range (a watch-list video is played in pieces). */
function sendBytes(req: Request, res: Response, file: { name: string; contentType: string; bytes: Buffer }) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Accept-Ranges', 'bytes');
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  const size = file.bytes.length;
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.status(416).setHeader('Content-Range', `bytes */${size}`); res.end(); return; }
    res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.send(file.bytes.subarray(start, end + 1));
    return;
  }
  res.send(file.bytes);
}
const bytesRoute = (load: (req: Request) => Promise<{ name: string; contentType?: string; bytes: Buffer }>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = await load(req);
      sendBytes(req, res, { ...file, contentType: file.contentType ?? 'application/pdf' });
    } catch (error) {
      const code = (error as { statusCode?: unknown }).statusCode;
      if (typeof code === 'number' && code >= 400 && code < 500) { res.status(code).json({ error: (error as Error).message }); return; }
      next(error);
    }
  };

// The joiner
lifecycleAppRouter.get('/joiner/onboarding', lifecycleHandler(async (req) => joinerOnboarding(me(req))));
lifecycleAppRouter.post('/joiner/tasks/:taskId', lifecycleHandler(async (req) => joinerTaskAction(me(req), param(req, 'taskId'), body(req))));
lifecycleAppRouter.get('/joiner/forms/:taskId', lifecycleHandler(async (req) => joinerForm(me(req), param(req, 'taskId'))));
lifecycleAppRouter.post('/joiner/forms/:taskId', lifecycleHandler(async (req) => sendJoinerForm(me(req), param(req, 'taskId'), body(req))));
lifecycleAppRouter.post('/joiner/forms/:taskId/files', withFile, lifecycleHandler(async (req) => uploadJoinerFormFile(me(req), param(req, 'taskId'), req.file as never), 201));
lifecycleAppRouter.get('/joiner/checkins/:id', lifecycleHandler(async (req) => joinerCheckin(me(req), param(req, 'id'))));
lifecycleAppRouter.post('/joiner/checkins/:id', lifecycleHandler(async (req) => sendJoinerCheckin(me(req), param(req, 'id'), body(req))));
lifecycleAppRouter.get('/joiner/goals', lifecycleHandler(async (req) => joinerGoals(me(req))));
lifecycleAppRouter.put('/joiner/goals/:month/:index', lifecycleHandler(async (req) => saveJoinerGoal(me(req), param(req, 'month'), param(req, 'index'), body(req))));
lifecycleAppRouter.post('/joiner/watch/:itemId', lifecycleHandler(async (req) => markWatched(me(req), param(req, 'itemId'))));
lifecycleAppRouter.get('/joiner/media/:fileId', bytesRoute((req) => joinerMedia(me(req), param(req, 'fileId'))));
lifecycleAppRouter.get('/joiner/letters', lifecycleHandler(async (req) => joinerLetters(me(req))));
lifecycleAppRouter.post('/joiner/letters/:id/opened', lifecycleHandler(async (req) => joinerOpenLetter(me(req), param(req, 'id'))));
lifecycleAppRouter.post('/joiner/letters/:id/sign', lifecycleHandler(async (req) => joinerSignLetter(me(req), param(req, 'id'), body(req), { ip: req.ip ?? '', userAgent: String(req.get('user-agent') ?? '') })));
lifecycleAppRouter.get('/joiner/letters/:id/pdf', bytesRoute((req) => joinerLetterPdf(me(req), param(req, 'id'))));
// App build 90: the Employee profile's empty sections, filled once in the app; the payroll details task (to HR, then payroll).
lifecycleAppRouter.get('/joiner/profile', lifecycleHandler(async (req) => joinerProfileDetails(me(req))));
lifecycleAppRouter.put('/joiner/profile/:section', lifecycleHandler(async (req) => saveJoinerProfileSection(me(req), param(req, 'section'), body(req))));
lifecycleAppRouter.get('/joiner/payroll', lifecycleHandler(async (req) => joinerPayroll(me(req))));
lifecycleAppRouter.post('/joiner/payroll', lifecycleHandler(async (req) => sendJoinerPayroll(me(req), body(req))));

// Teams › Joiners (manager, buddy, head of department, someone senior)
lifecycleAppRouter.get('/team/joiners/:journeyId/page', lifecycleHandler(async (req) => teamJoinerPage(me(req), param(req, 'journeyId'))));
lifecycleAppRouter.post('/team/joiners/:journeyId/rows/:rowId', lifecycleHandler(async (req) => teamRowAction(me(req), param(req, 'journeyId'), param(req, 'rowId'), body(req))));
lifecycleAppRouter.put('/team/joiners/:journeyId/rows/:rowId/notes', lifecycleHandler(async (req) => teamRowNotes(me(req), param(req, 'journeyId'), param(req, 'rowId'), body(req))));
lifecycleAppRouter.get('/team/joiners/:journeyId/buddy-options', lifecycleHandler(async (req) => buddyOptions(me(req), param(req, 'journeyId'))));
lifecycleAppRouter.post('/team/joiners/:journeyId/buddy', lifecycleHandler(async (req) => assignBuddy(me(req), param(req, 'journeyId'), body(req))));
lifecycleAppRouter.post('/team/joiners/:journeyId/schedule', lifecycleHandler(async (req) => scheduleMeetings(me(req), param(req, 'journeyId'), body(req))));
lifecycleAppRouter.post('/team/joiners/:journeyId/welcome-message', lifecycleHandler(async (req) => sendWelcomeMessage(me(req), param(req, 'journeyId'), body(req))));
lifecycleAppRouter.post('/team/joiners/:journeyId/feed', lifecycleHandler(async (req) => introduceOnFeed(me(req), param(req, 'journeyId'), body(req))));
lifecycleAppRouter.get('/team/joiners/:journeyId/goals/:month', lifecycleHandler(async (req) => teamGoals(me(req), param(req, 'journeyId'), param(req, 'month'))));
lifecycleAppRouter.post('/team/joiners/:journeyId/goals/:month', lifecycleHandler(async (req) => commentOnGoals(me(req), param(req, 'journeyId'), param(req, 'month'), body(req))));
lifecycleAppRouter.get('/team/joiners/:journeyId/checkins/:checkinId', lifecycleHandler(async (req) => teamCheckin(me(req), param(req, 'journeyId'), param(req, 'checkinId'))));
lifecycleAppRouter.post('/team/joiners/:journeyId/checkins/:checkinId/read', lifecycleHandler(async (req) => markCheckinRead(me(req), param(req, 'journeyId'), param(req, 'checkinId'))));
lifecycleAppRouter.get('/team/joiners/:journeyId/review', lifecycleHandler(async (req) => reviewView(me(req), param(req, 'journeyId'))));
lifecycleAppRouter.post('/team/joiners/:journeyId/review', lifecycleHandler(async (req) => sendReview(me(req), param(req, 'journeyId'), body(req))));
lifecycleAppRouter.get('/team/joiners/:journeyId/confirmation', lifecycleHandler(async (req) => approvalViewV2(me(req), param(req, 'journeyId'))));
lifecycleAppRouter.post('/team/joiners/:journeyId/confirmation', lifecycleHandler(async (req) => answerApprovalV2(me(req), param(req, 'journeyId'), body(req))));
lifecycleAppRouter.post('/team/joiners/:journeyId/senior-meeting', lifecycleHandler(async (req) => inviteSenior(me(req), param(req, 'journeyId'), body(req))));

// HR and IT & admin work onboarding from the dashboard only: the app's old Actions › Onboarding
// screens (`/lifecycle/staff/*`, builds up to 1.4.3) are gone, and answer 404 for everyone.
lifecycleAppRouter.all(/^\/staff(?:\/.*)?$/, lifecycleHandler(async () => { throw new LifecycleError(404, 'Not available'); }));
