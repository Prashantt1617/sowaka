import { Router } from 'express';
import {
  actOnConnectPost,
  commentOnConnectPost,
  connectFeed,
  connectLinkPreview,
  connectPost,
  createPost,
  deletePost,
  reactToConnectComment,
  reactToConnectPost,
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
connectRouter.patch('/posts/:postId', uploadConnectPostMedia, updatePost);
connectRouter.delete('/posts/:postId', deletePost);
