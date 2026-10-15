import { randomUUID } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { connectPosts, deviceTokens, getDb, notifications, users } from '../config/db';
import { env } from '../config/env';
import { sendNotificationEmail } from './email.service';
import { logger } from '../utils/logger';

/** Greeting name for email copy; falls back to a neutral form when unset. */
function firstName(name?: string): string {
  return name?.trim().split(/\s+/).at(0) || 'there';
}

export class NotificationError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

function messaging() {
  if (!env.firebaseServiceAccountJson) return undefined;
  if (!getApps().length) {
    try { initializeApp({ credential: cert(JSON.parse(env.firebaseServiceAccountJson)) }); }
    catch (error) { logger.error('Firebase initialization failed', {}, error); return undefined; }
  }
  return getMessaging();
}

export async function sendTestPush(tokenInput: string) {
  if (!env.notificationTestEndpointEnabled) {
    throw new NotificationError(404, 'Notification test endpoint is disabled');
  }
  const token = tokenInput.trim();
  if (!token || token.length > 4096) {
    throw new NotificationError(400, 'A valid FCM token is required');
  }
  const firebase = messaging();
  if (!firebase) {
    throw new NotificationError(503, 'Firebase Admin is not configured');
  }
  const messageId = await firebase.send({
    token,
    notification: {
      title: 'Sowaka test notification',
      body: 'Push notifications are configured correctly.',
    },
    data: {
      scenario: 'notification_test',
      destination: 'connect',
    },
    android: {
      priority: 'high',
      notification: { channelId: 'sowaka_notifications' },
    },
    apns: { payload: { aps: { sound: 'default' } } },
    webpush: {
      notification: { icon: '/icons/Icon-192.png' },
      fcmOptions: { link: '/' },
    },
  });
  return { sent: true, messageId };
}

export async function registerDeviceToken(userId: string, tokenInput: string, platformInput: string) {
  const token = tokenInput.trim();
  if (!token) throw new NotificationError(400, 'FCM token is required');
  const platform = platformInput === 'ios' || platformInput === 'web' ? platformInput : 'android';
  const now = new Date();
  await deviceTokens().updateOne({ token }, { $set: { userId, platform, updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
  return { registered: true };
}

export async function unregisterDeviceToken(userId: string, token: string) {
  await deviceTokens().deleteOne({ userId, token }); return { registered: false };
}

export async function listNotifications(userId: string) {
  const rows = await notifications().find({ userId }).sort({ createdAt: -1 }).limit(100).toArray();
  // A notification about a post that has since been deleted leads nowhere.
  // Deleting a post now removes its notifications too; this covers the ones
  // written before that, and any a delete raced with.
  const postIds = [...new Set(rows.map((row) => row.data?.postId).filter((id): id is string => Boolean(id)))];
  if (postIds.length === 0) return rows;
  const live = new Set(
    (await connectPosts().find({ id: { $in: postIds } }, { projection: { _id: 0, id: 1 } }).toArray()).map((post) => post.id),
  );
  return rows.filter((row) => !row.data?.postId || live.has(row.data.postId));
}

/**
 * Everything notified about one post, gone with it: the notifications already
 * in people's inboxes and any still batched up to be sent.
 */
export async function removePostNotifications(postId: string) {
  await Promise.all([
    notifications().deleteMany({ 'data.postId': postId }),
    getDb().collection('notification_batches').deleteMany({ entityId: postId }),
    getDb().collection('notification_groups').deleteMany({ entityId: postId }),
  ]);
}

export async function markNotificationRead(userId: string, id: string) {
  const result = await notifications().updateOne({ userId, id }, { $set: { readAt: new Date() } });
  if (!result.matchedCount) throw new NotificationError(404, 'Notification not found');
  return { id, read: true };
}

export interface NotificationEmail {
  subject: string;
  /** `{firstName}` is substituted per recipient. */
  body: string;
  /** Copied recipients, e.g. HR on a manager's reminder. */
  cc?: string[];
}

export interface NotificationInput {
  scenario: string; title: string; body: string; data: Record<string, string>;
  /** Email copy to send alongside the push. Omit for in-app-only scenarios. */
  email?: NotificationEmail;
  /**
   * Whether the phone is pushed. False for the notification spec's "inbox
   * only" rows: the entry waits in the app's inbox, and the phone stays quiet.
   */
  push?: boolean;
  /**
   * Whether it is kept in the app's inbox. False for the spec's "email only"
   * rows (support staff), which go to a mailbox and nowhere else.
   */
  inbox?: boolean;
}

/**
 * Whether this process may notify someone in this org at all: the
 * NOTIFY_ORGS allowlist (see `env.notifyOrgs`), which keeps a dev server on
 * the shared database away from real employees.
 */
export function notifiesOrg(org: string | undefined): boolean {
  return env.notifyOrgs.length === 0 || env.notifyOrgs.includes(org ?? '');
}

export async function notifyUsers(userIds: string[], input: NotificationInput) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueIds.length) return;
  // Someone who has left hears nothing more from the app.
  const all = await users()
    .find({ userId: { $in: uniqueIds }, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } })
    .toArray();
  // Same allowlist the mail transport enforces — see `env.notifyOrgs`. Applied
  // here too so a suppressed org gets no push and no stored notification
  // either, not just no email.
  const recipients = all.filter((user) => notifiesOrg(user.org));
  if (recipients.length !== all.length) {
    logger.info('Notification suppressed for orgs outside NOTIFY_ORGS', {
      allowed: env.notifyOrgs, suppressed: all.length - recipients.length, scenario: input.scenario,
    });
  }
  if (!recipients.length) return;
  const now = new Date();
  // `email`, `push` and `inbox` are how it is delivered, not part of the stored record.
  const { email, push, inbox, ...record } = input;
  if (inbox !== false) {
    await notifications().insertMany(recipients.map((user) => ({ id: randomUUID(), userId: user.userId,
      org: user.org ?? user.email.split('@').at(1) ?? 'default', ...record, pushed: push !== false, createdAt: now })));
  }
  // Fire-and-forget: sendNotificationEmail never throws, but callers of
  // notifyUsers (leave/feedback request handlers) must not block on SMTP.
  // Iterates `recipients`, so NOTIFY_ORGS gates email as well as push.
  if (email) {
    for (const user of recipients) {
      if (!user.email) continue;
      void sendNotificationEmail(
        user.email,
        email.subject,
        email.body.replaceAll('{firstName}', firstName(user.name)),
        email.cc,
      );
    }
  }
  if (push === false) return;
  // Scoped to the filtered recipients rather than every id asked for —
  // otherwise a suppressed org still gets the push.
  const tokens = await deviceTokens()
    .find({ userId: { $in: recipients.map((user) => user.userId) } })
    .toArray();
  const firebase = messaging();
  if (!firebase || !tokens.length) return;
  const result = await firebase.sendEachForMulticast({
    tokens: tokens.map((entry) => entry.token),
    notification: { title: input.title, body: input.body },
    data: { ...input.data, scenario: input.scenario },
    android: { priority: 'high', notification: { channelId: 'sowaka_notifications' } },
    apns: { payload: { aps: { sound: 'default' } } },
  });
  const invalid = result.responses.flatMap((response, index) => {
    const code = response.error?.code ?? '';
    return !response.success && (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) ? [tokens[index].token] : [];
  });
  if (invalid.length) await deviceTokens().deleteMany({ token: { $in: invalid } });
}

/**
 * Spec row 51 — the joining day, 10:00 IST: the joiner's team hears they
 * arrived (their manager, the colleagues who share that manager, and their
 * department), never the joiner. Opens the joiner's profile.
 */
export async function sendNewJoinerNotifications(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const dateKey = `${value('year')}-${value('month')}-${value('day')}`;
  const joiners = await users().find({
    lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
    joiningDate: { $gte: new Date(`${dateKey}T00:00:00.000Z`), $lte: new Date(`${dateKey}T23:59:59.999Z`) },
  }).toArray();
  for (const joiner of joiners) {
    if (!joiner.org) continue;
    const roster = await users().find({ org: joiner.org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } }).toArray();
    const team = roster.filter((person) => person.userId !== joiner.userId && (
      person.userId === joiner.managerUserId
      || (joiner.managerUserId && person.managerUserId === joiner.managerUserId)
      || (joiner.department && person.department === joiner.department)
    ));
    if (!team.length) continue;
    const already = await notifications().findOne({ scenario: 'new_joiner', 'data.dateKey': dateKey, 'data.employeeUserId': joiner.userId });
    if (already) continue;
    await notifyUsers(team.map((person) => person.userId), {
      scenario: 'new_joiner',
      title: `${joiner.name} joined your team today 👋`,
      body: 'Say hello',
      data: { destination: 'employee_profile', employeeUserId: joiner.userId, dateKey },
    });
  }
}
