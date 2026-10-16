import { NextFunction, Request, Response } from 'express';
import { listNotifications, markAllNotificationsRead, markNotificationRead, registerDeviceToken, sendTestPush, unregisterDeviceToken } from '../services/notification.service';
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
    const rows = await resolveNotifications(userId(req), await listNotifications(userId(req)));
    res.json({ success: true, notifications: await withoutEndedGames(rows) });
  } catch (error) { next(error); }
}
export async function readNotification(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...(await markNotificationRead(userId(req), String(req.params.notificationId))) }); } catch (error) { next(error); }
}
export async function readAllNotifications(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...(await markAllNotificationsRead(userId(req))) }); } catch (error) { next(error); }
}
