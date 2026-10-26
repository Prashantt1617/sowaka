import { NextFunction, Request, Response } from 'express';
import { listNotificationRows, listUnreadNotificationRows, withoutDeletedPosts, markAllNotificationsRead, markNotificationRead, registerDeviceToken, sendTestPush, unregisterDeviceToken } from '../services/notification.service';
import { resolveNotifications, withoutEndedGames } from '../services/notification-resolution.service';
import { optional } from '../utils/optional';

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
    //
    // Each filter fails on its own: should the posts be unreadable, the rows
    // about them stay in rather than the inbox not opening.
    const [kept, resolved, current] = await Promise.all([
      optional('Inbox deleted-posts filter', () => withoutDeletedPosts(rows), rows),
      resolveNotifications(userId(req), rows),
      withoutEndedGames(rows),
    ]);
    const keep = new Set(kept);
    const live = new Set(current);
    // `resolved` is `rows`, row for row, some marked resolved.
    res.json({ success: true, notifications: resolved.filter((_, i) => keep.has(rows[i]) && live.has(rows[i])) });
  } catch (error) { next(error); }
}
/**
 * How many rows the inbox would show unread, for the bell's dot, without
 * sending the inbox: unread, not about a deleted post or an ended game, and
 * not already done with (resolved), exactly as the inbox counts them.
 */
export async function unreadNotificationCount(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await listUnreadNotificationRows(userId(req));
    if (rows.length === 0) {
      res.json({ success: true, unread: 0 });
      return;
    }
    const [kept, resolved, current] = await Promise.all([
      optional('Unread count deleted-posts filter', () => withoutDeletedPosts(rows), rows),
      resolveNotifications(userId(req), rows),
      withoutEndedGames(rows),
    ]);
    const keep = new Set(kept);
    const live = new Set(current);
    const unread = resolved.filter((row, i) => keep.has(rows[i]) && live.has(rows[i]) && !row.resolved).length;
    res.json({ success: true, unread });
  } catch (error) { next(error); }
}
export async function readNotification(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...(await markNotificationRead(userId(req), String(req.params.notificationId))) }); } catch (error) { next(error); }
}
export async function readAllNotifications(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...(await markAllNotificationsRead(userId(req))) }); } catch (error) { next(error); }
}
