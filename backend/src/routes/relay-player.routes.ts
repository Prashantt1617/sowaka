import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { playerCard } from '../services/relay-runtime.service';

/**
 * What a player's own app asks for outside the game itself.
 *
 * Play happens over the socket; this is only the feed card's question of what
 * is on and which team the viewer is on.
 */
export const relayPlayerRouter = Router();

relayPlayerRouter.use(requireAuth);

relayPlayerRouter.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await playerCard(String(req.auth?.userId ?? '')));
  } catch (error) {
    next(error);
  }
});
