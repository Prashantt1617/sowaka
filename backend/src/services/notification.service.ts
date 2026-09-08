import { randomUUID } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { deviceTokens, getDb, leaves, notifications, users } from '../config/db';
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
  return notifications().find({ userId }).sort({ createdAt: -1 }).limit(100).toArray();
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
}

export interface NotificationInput {
  scenario: string; title: string; body: string; data: Record<string, string>;
  /** Email copy to send alongside the push. Omit for in-app-only scenarios. */
  email?: NotificationEmail;
}

export async function notifyUsers(userIds: string[], input: NotificationInput) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueIds.length) return;
  const all = await users().find({ userId: { $in: uniqueIds } }).toArray();
  // Same allowlist the mail transport enforces — see `env.notifyOrgs`. Applied
  // here too so a suppressed org gets no push and no stored notification
  // either, not just no email.
  const recipients = env.notifyOrgs.length
    ? all.filter((user) => env.notifyOrgs.includes(user.org ?? ''))
    : all;
  if (recipients.length !== all.length) {
    logger.info('Notification suppressed for orgs outside NOTIFY_ORGS', {
      allowed: env.notifyOrgs, suppressed: all.length - recipients.length, scenario: input.scenario,
    });
  }
  if (!recipients.length) return;
  const now = new Date();
  // `email` is copy for delivery, not part of the stored notification record.
  const { email, ...record } = input;
  await notifications().insertMany(recipients.map((user) => ({ id: randomUUID(), userId: user.userId,
    org: user.org ?? user.email.split('@').at(1) ?? 'default', ...record, createdAt: now })));
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
      );
    }
  }
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

export async function queueBatchedNotification(
  recipientUserId: string,
  scenario: string,
  entityId: string,
  actorName: string,
  title: string,
  data: Record<string, string>,
) {
  const key = `${recipientUserId}:${scenario}:${entityId}`;
  await getDb().collection('notification_batches').updateOne(
    { key },
    { $set: { recipientUserId, scenario, entityId, title, data, updatedAt: new Date() },
      $addToSet: { actorNames: actorName }, $inc: { count: 1 }, $setOnInsert: { key, createdAt: new Date() } },
    { upsert: true },
  );
}

export async function flushNotificationBatches(includeDaily = false) {
  const collection = getDb().collection('notification_batches');
  const batches = await collection.find(includeDaily ? {} : { scenario: { $ne: 'nomination_received' } }).toArray();
  for (const batch of batches) {
    const names = (batch.actorNames as string[] | undefined) ?? [];
    const count = Number(batch.count ?? names.length);
    const first = names[0] ?? 'Someone';
    const body = batch.scenario === 'post_liked'
      ? count > 1 ? `${first} and ${count - 1} others liked your post` : `${first} liked your post`
      : batch.scenario === 'poll_voted'
        ? `${count} new vote${count === 1 ? '' : 's'} on your poll "${batch.title}"`
        : batch.scenario === 'nomination_received'
          ? `${count} nomination${count === 1 ? '' : 's'} received today`
        : `${count} new responses to "${batch.title}"`;
    await notifyUsers([String(batch.recipientUserId)], {
      scenario: String(batch.scenario), title: 'Sowaka Connect', body,
      data: batch.data as Record<string, string>,
    });
    await collection.deleteOne({ _id: batch._id });
  }
}

export async function sendTodayLifecycleNotifications(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = value('year'); const month = value('month'); const day = value('day');
  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const employees = await users().find({ lifecycleStatus: { $nin: ['offboarded', 'terminated'] } }).toArray();
  const byOrg = new Map<string, string[]>();
  for (const employee of employees) {
    const org = employee.org ?? employee.email.split('@').at(1) ?? 'default';
    byOrg.set(org, [...(byOrg.get(org) ?? []), employee.userId]);
  }
  for (const employee of employees) {
    const org = employee.org ?? employee.email.split('@').at(1) ?? 'default';
    const recipients = byOrg.get(org) ?? [];
    const events: Array<{ scenario: string; body: string }> = [];
    if (employee.birthday?.getUTCMonth() === month - 1 && employee.birthday.getUTCDate() === day) {
      events.push({ scenario: 'birthday', body: `It's ${employee.name}'s birthday today - wish them well!` });
    }
    if (employee.joiningDate?.getUTCMonth() === month - 1 && employee.joiningDate.getUTCDate() === day) {
      const years = year - employee.joiningDate.getUTCFullYear();
      if (years > 0) events.push({ scenario: 'work_anniversary', body: `${employee.name} completes ${years} year${years === 1 ? '' : 's'} at Sowaka today` });
      if (years === 0) events.push({ scenario: 'new_joiner', body: `Welcome ${employee.name} to the team!` });
    }
    for (const event of events) {
      const alreadySent = await notifications().findOne({ userId: recipients[0], scenario: event.scenario, 'data.dateKey': dateKey, 'data.employeeUserId': employee.userId });
      if (!alreadySent) await notifyUsers(recipients, { scenario: event.scenario, title: 'Sowaka Connect', body: event.body,
        data: { destination: 'employee_profile', employeeUserId: employee.userId, dateKey } });
    }
  }
}

export async function sendPendingLeaveReminders(now = new Date()) {
  const dateKey = now.toISOString().slice(0, 10);
  const pending = await leaves().find({ status: 'pending' }).toArray();
  const employees = await users().find({ userId: { $in: [...new Set(pending.map((leave) => leave.userId))] } }).toArray();
  const managerByEmployee = new Map(employees.map((employee) => [employee.userId, employee.managerUserId]));
  const counts = new Map<string, number>();
  for (const leave of pending) {
    const managerId = managerByEmployee.get(leave.userId);
    if (managerId) counts.set(managerId, (counts.get(managerId) ?? 0) + 1);
  }
  for (const [managerId, count] of counts) {
    const sent = await notifications().findOne({ userId: managerId, scenario: 'pending_leave_reminder', 'data.dateKey': dateKey });
    if (!sent) await notifyUsers([managerId], { scenario: 'pending_leave_reminder', title: 'Leave approvals',
      body: `You have ${count} leave request${count === 1 ? '' : 's'} waiting for approval`,
      data: { destination: 'manage_leave', dateKey } });
  }
}
