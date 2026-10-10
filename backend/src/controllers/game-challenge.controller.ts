import { NextFunction, Request, Response } from 'express';
import {
  acceptChallenge,
  ChallengeViewer,
  createChallenge,
  declineChallenge,
  finishChallenge,
  GameChallengeError,
  getChallenge,
  listColleagues,
  listMyChallenges,
  reportLive,
} from '../services/game-challenge.service';

function viewerOf(req: Request): ChallengeViewer {
  const user = req.auth?.user;
  if (!req.auth?.userId || !user) throw new GameChallengeError(401, 'Authentication required');
  return { userId: req.auth.userId, name: user.name, email: user.email, org: user.org };
}

const idOf = (req: Request) => String(req.params.id ?? '');

type Handler = (req: Request) => Promise<Record<string, unknown>>;

const handle = (work: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, ...(await work(req)) });
  } catch (error) {
    next(error);
  }
};

export const colleaguesHandler = handle(async (req) => ({
  colleagues: await listColleagues(viewerOf(req), req.query.q, req.query.limit),
}));

export const listHandler = handle(async (req) => listMyChallenges(viewerOf(req), req.query.game));

export const createHandler = handle(async (req) => ({
  challenge: await createChallenge(viewerOf(req), req.body ?? {}),
}));

export const getHandler = handle(async (req) => ({ challenge: await getChallenge(viewerOf(req), idOf(req)) }));

export const acceptHandler = handle(async (req) => ({ challenge: await acceptChallenge(viewerOf(req), idOf(req)) }));

export const declineHandler = handle(async (req) => ({ challenge: await declineChallenge(viewerOf(req), idOf(req)) }));

export const liveHandler = handle(async (req) => reportLive(viewerOf(req), idOf(req), req.body?.score));

export const finishHandler = handle(async (req) => ({
  challenge: await finishChallenge(viewerOf(req), idOf(req), req.body?.score),
}));
