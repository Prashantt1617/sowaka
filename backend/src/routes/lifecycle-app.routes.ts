import { Router, type Request } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  actOnMeeting, actOnNote, actOnOwnTask, actOnPerson, addNote, assignStarterTask, checkinForMe, introView, joinerForManager,
  joinersForManager, lifecycleMe, managerProbationMonth, managerTaskDone, markWeekDoneSeen, meetingFor, notesForJoiner,
  onboardingHome, peopleView, postIntro, postWelcome, probationForMe, replyToStarterTask, revealForMe, revealSeenForMe, saveIntro, saveSetup,
  saveWeek1Step, sendSurvey, starterDone, starterTasksForJoiner, surveyView, week1View,
} from '../services/lifecycle/appOnboarding';
import { LifecycleError } from '../services/lifecycle/engine';
import { lifecycleGate, lifecycleHandler } from './lifecycle-admin.routes';

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
lifecycleAppRouter.post('/onboarding/week-done/seen', lifecycleHandler(async (req) => markWeekDoneSeen(me(req))));
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
lifecycleAppRouter.get('/onboarding/survey', lifecycleHandler(async (req) => surveyView(me(req))));
lifecycleAppRouter.post('/onboarding/survey', lifecycleHandler(async (req) => sendSurvey(me(req), body(req))));
lifecycleAppRouter.get('/onboarding/probation', lifecycleHandler(async (req) => probationForMe(me(req))));
lifecycleAppRouter.put('/onboarding/probation/:month/checkin', lifecycleHandler(async (req) => checkinForMe(me(req), Number(param(req, 'month')), body(req))));
lifecycleAppRouter.get('/onboarding/reveal', lifecycleHandler(async (req) => revealForMe(me(req))));
lifecycleAppRouter.post('/onboarding/reveal/seen', lifecycleHandler(async (req) => revealSeenForMe(me(req))));

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
