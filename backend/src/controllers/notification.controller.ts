import { NextFunction, Request, Response } from 'express';
import { listNotificationRows, withoutDeletedPosts, markAllNotificationsRead, markNotificationRead, registerDeviceToken, sendTestPush, unregisterDeviceToken } from '../services/notification.service';
import { resolveNotifications, withoutEndedGames } from '../services/notification-resolution.service';

const userId = (req: Request) => req.auth!.userId;
export async function testNotification(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await sendTestPush(String(req.body.token ?? ''))) });
  } catch (error) { next(error); }
}
export async function registerToken(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...(await registerDeviceToken(userId(req), String(req.body.token ?? ''), String(req.body.platform ?? ''))) }); } catch (error) { next(error); }
}
export async function unregisterToken(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...(await unregisterDeviceToken(userId(req), String(req.body.token ?? ''))) }); } catch (error) { next(error); }
}
export async function notificationInbox(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await listNotificationRows(userId(req));
    // Whether a row's post is gone, whether it has been overtaken by events and
    // whether its game has ended are separate questions about the same rows, so
    // they are asked side by side rather than one after another.
    const [kept, resolved, current] = await Promise.all([
      withoutDeletedPosts(rows),
      resolveNotifications(userId(req), rows),
      withoutEndedGames(rows),
    ]);
    const keep = new Set(kept);
    const live = new Set(current);
    // `resolved` is `rows`, row for row, some marked resolved.
    res.json({ success: true, notifications: resolved.filter((_, i) => keep.has(rows[i]) && live.has(rows[i])) });
  } catch (error) { next(error); }
}
export async function readNotification(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...(await markNotificationRead(userId(req), String(req.params.notificationId))) }); } catch (error) { next(error); }
}
export async function readAllNotifications(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...(await markAllNotificationsRead(userId(req))) }); } catch (error) { next(error); }
}
