import { getDb } from '../config/db';
import { logger } from '../utils/logger';

/**
 * Errors the app hit on the phone — a post that never reached the server
 * leaves no other trace. Kept 30 days, then dropped by a TTL index.
 */
export interface ClientError {
  userId: string;
  event: string;
  message: string;
  context?: Record<string, string>;
  appVersion?: string;
  platform?: string;
  happenedAt: Date;
  receivedAt: Date;
}

const MAX_EVENTS = 20;
const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : undefined;

export function clientErrors() {
  return getDb().collection<ClientError>('client_errors');
}

export async function recordClientErrors(userId: string, body: unknown) {
  const raw = (body as { events?: unknown })?.events;
  const events = Array.isArray(raw) ? raw.slice(0, MAX_EVENTS) : [];
  const receivedAt = new Date();
  const rows: ClientError[] = [];
  for (const item of events) {
    const e = (item ?? {}) as Record<string, unknown>;
    const event = text(e.event, 80);
    if (!event) continue;
    const at = new Date(String(e.at ?? ''));
    const context: Record<string, string> = {};
    if (e.context && typeof e.context === 'object') {
      for (const [key, value] of Object.entries(e.context as Record<string, unknown>).slice(0, 12)) {
        if (value != null) context[key.slice(0, 40)] = String(value).slice(0, 300);
      }
    }
    rows.push({
      userId,
      event,
      message: text(e.message, 1000) ?? '',
      ...(Object.keys(context).length ? { context } : {}),
      appVersion: text(e.appVersion, 40),
      platform: text(e.platform, 20),
      // A phone with a wrong clock or a stale queue still files the row.
      happenedAt: Number.isNaN(at.getTime()) ? receivedAt : at,
      receivedAt,
    });
  }
  if (!rows.length) return { recorded: 0 };
  await clientErrors().insertMany(rows);
  for (const row of rows) {
    logger.warn('Client error', {
      userId,
      event: row.event,
      clientMessage: row.message,
      happenedAt: row.happenedAt.toISOString(),
      appVersion: row.appVersion,
      platform: row.platform,
      ...row.context,
    });
  }
  return { recorded: rows.length };
}
