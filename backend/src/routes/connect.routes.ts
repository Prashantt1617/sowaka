import { Router } from 'express';
import {
  actOnConnectPost,
  blockPerson,
  commentOnConnectPost,
  connectFeed,
  connectLinkPreview,
  connectPost,
  createPost,
  deletePost,
  listBlockedPeople,
  reactToConnectComment,
  reactToConnectPost,
  reportPost,
  submitChallengeEntry,
  unblockPerson,
  voteChallengeEntry,
  updatePost,
} from '../controllers/connect.controller';
import { uploadConnectPostMedia } from '../middleware/connect-media-upload.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { playerGame, playerSubmitScore } from '../controllers/game.controller';

export const connectRouter = Router();
connectRouter.use(requireAuth);
connectRouter.get('/feed', connectFeed);
// Composer preview: resolve a link's artwork before the post is created.
connectRouter.get('/link-preview', connectLinkPreview);
connectRouter.get('/posts/:postId', connectPost);
connectRouter.get('/games/:gameId', playerGame);
connectRouter.post('/games/:gameId/scores', playerSubmitScore);
connectRouter.post('/posts', uploadConnectPostMedia, createPost);
connectRouter.post('/posts/:postId/reaction', reactToConnectPost);
connectRouter.post('/posts/:postId/comments', commentOnConnectPost);
connectRouter.post('/posts/:postId/comments/:commentId/reaction', reactToConnectComment);
connectRouter.post('/posts/:postId/actions', actOnConnectPost);
// Moderation, as the app offers it: report a post or one of its comments, and
// mute a colleague. `commentId` in the body narrows a report to one comment.
connectRouter.post('/posts/:postId/report', reportPost);
// Photo challenge: one entry each (re-posting replaces it), one vote each.
connectRouter.post('/posts/:postId/challenge/entries', uploadConnectPostMedia, submitChallengeEntry);
connectRouter.post('/posts/:postId/challenge/vote', voteChallengeEntry);
connectRouter.get('/blocks', listBlockedPeople);
connectRouter.post('/blocks', blockPerson);
connectRouter.delete('/blocks/:userId', unblockPerson);
connectRouter.patch('/posts/:postId', uploadConnectPostMedia, updatePost);
connectRouter.delete('/posts/:postId', deletePost);
