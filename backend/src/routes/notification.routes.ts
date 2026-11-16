import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { notificationInbox, notificationSoundFile, notificationSounds, readAllNotifications, unreadNotificationCount, readNotification, registerToken, testNotification, unregisterToken } from '../controllers/notification.controller';

export const notificationRouter = Router();
notificationRouter.post('/test', testNotification);
// A sound's file needs no sign-in (see notificationSoundFile); the list of them does.
notificationRouter.get('/sounds/file/:id', notificationSoundFile);
notificationRouter.use(requireAuth);
notificationRouter.post('/devices', registerToken);
notificationRouter.delete('/devices', unregisterToken);
notificationRouter.get('/sounds', notificationSounds);
notificationRouter.get('/', notificationInbox);
// The bell's dot: a count, not the inbox.
notificationRouter.get('/unread-count', unreadNotificationCount);
notificationRouter.patch('/read-all', readAllNotifications);
notificationRouter.patch('/:notificationId/read', readNotification);
