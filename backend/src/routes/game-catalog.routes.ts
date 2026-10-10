import { Router } from 'express';
import {
  catalogHandler,
  homeHandler,
  leaderboardHandler,
  playHandler,
  pointsLeaderboardHandler,
  submitScoreHandler,
} from '../controllers/game-catalog.controller';
import {
  acceptHandler,
  colleaguesHandler,
  createHandler,
  declineHandler,
  finishHandler,
  getHandler,
  listHandler,
  liveHandler,
} from '../controllers/game-challenge.controller';
import { requireAuth } from '../middleware/auth.middleware';

/**
 * The Games tab, from the app: which games the person's company has, and the
 * scores of the ones that keep them. Every handler checks the game is on the
 * company's list (`companies.enabledGames`), so a game it does not have is
 * refused even with a session.
 */
export const gamesRouter = Router();
gamesRouter.use(requireAuth);
gamesRouter.get('/catalog', catalogHandler);
/**
 * The Games tab's home in one round trip (points and rank, a colleague's new
 * best, what is live, challenges waiting, the games played, the catalog, who
 * is playing now), and its leaderboard of individuals by engagement points,
 * `?period=week|all`. Read only. Before `/:key`, like the challenges.
 */
gamesRouter.get('/home', homeHandler);
gamesRouter.get('/leaderboard', pointsLeaderboardHandler);
/**
 * Colleague challenges: the same boards for two people at one company, and
 * their scores compared. Before the `/:key` routes, which they would
 * otherwise match. Only the two players can read or play one.
 */
gamesRouter.get('/challenges', listHandler);
gamesRouter.post('/challenges', createHandler);
gamesRouter.get('/challenges/colleagues', colleaguesHandler);
gamesRouter.get('/challenges/:id', getHandler);
gamesRouter.post('/challenges/:id/accept', acceptHandler);
gamesRouter.post('/challenges/:id/decline', declineHandler);
gamesRouter.post('/challenges/:id/live', liveHandler);
gamesRouter.post('/challenges/:id/finish', finishHandler);
gamesRouter.post('/:key/score', submitScoreHandler);
gamesRouter.get('/:key/leaderboard', leaderboardHandler);

/**
 * A web game's page, fetched by the app with the person's session and loaded
 * into its own screen. Not opened as a link: the session never travels in a
 * URL, so it never lands in a log or a history.
 */
export const playRouter = Router();
playRouter.use(requireAuth);
playRouter.get('/:key', playHandler);
