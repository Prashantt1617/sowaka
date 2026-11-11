import { NextFunction, Request, Response, Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess, requireDashboardTabs } from '../middleware/admin.middleware';
import { ConnectError } from '../services/connect.service';
import {
  feedPage,
  feedPostDetail,
  feedSummary,
  pinFeedPost,
  removeFeedComment,
  removeFeedPost,
  unpinFeedPost,
} from '../services/engagement-feed.service';

/** Dashboard › Engagement › Feed: mounted at /admin/engagement/feed. */
export const engagementFeedRouter = Router();
engagementFeedRouter.use(requireAuth, requireDashboardAccess, requireDashboardTabs);

function admin(req: Request) {
  const user = req.auth?.user;
  if (!user) throw new ConnectError(401, 'Authentication required');
  return user;
}

type Handler = (req: Request) => Promise<Record<string, unknown>>;
const handle = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, ...(await fn(req)) });
  } catch (error) {
    next(error);
  }
};

// Tiles, the pin limit, and the people "See the feed as" can pick.
engagementFeedRouter.get('/summary', handle(async (req) => feedSummary(admin(req))));
// The feed a page at a time: `as` = all | company | team | list | person:<userId>.
engagementFeedRouter.get(
  '/posts',
  handle(async (req) =>
    feedPage(admin(req), {
      as: req.query.as == null ? undefined : String(req.query.as),
      cursor: req.query.cursor == null ? undefined : String(req.query.cursor),
    }),
  ),
);
engagementFeedRouter.get('/posts/:postId', handle(async (req) => feedPostDetail(admin(req), String(req.params.postId))));
engagementFeedRouter.put('/posts/:postId/pin', handle(async (req) => pinFeedPost(admin(req), String(req.params.postId), req.body?.until)));
engagementFeedRouter.delete('/posts/:postId/pin', handle(async (req) => unpinFeedPost(admin(req), String(req.params.postId))));
engagementFeedRouter.delete('/posts/:postId', handle(async (req) => removeFeedPost(admin(req), String(req.params.postId))));
engagementFeedRouter.delete(
  '/posts/:postId/comments/:commentId',
  handle(async (req) => removeFeedComment(admin(req), String(req.params.postId), String(req.params.commentId))),
);
