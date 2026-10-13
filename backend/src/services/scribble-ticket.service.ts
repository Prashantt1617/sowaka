import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * The credential a Scribble page carries.
 *
 * The app loads a game page as a string under a policy that forbids any
 * connection, so the page cannot use the session (the app never hands a page
 * the session anyway). Instead the page endpoint signs a short statement of
 * who fetched it — user, org, name, expiry — and the page presents that to the
 * `/scribble` socket namespace. Nothing is stored: the signature is the record.
 *
 * Two kinds, never interchangeable:
 *   - `ticket`: opens the socket. Lives 12 h, longer than any room (2 h), so
 *     reconnects through a whole session reuse it.
 *   - `hop`: appears in a URL once — the page reloads itself to
 *     `/play/scribble?ticket=<hop>` to escape the app's policy — and buys the
 *     page with a fresh `ticket` inside it. Lives 2 minutes, because the hop
 *     happens within milliseconds of the page loading, yet long enough that
 *     a WebView reloading its own URL after a memory squeeze still works. A
 *     hop token is refused at the socket, so a URL in a log opens nothing.
 */

export type ScribbleTicketKind = 'ticket' | 'hop';

export interface ScribbleTicket {
  userId: string;
  org: string;
  name: string;
  kind: ScribbleTicketKind;
  /** Epoch ms. */
  exp: number;
  iat: number;
}

export type TicketFailure = 'ticket_invalid' | 'ticket_expired';

export const TICKET_TTL_MS = 12 * 60 * 60 * 1000;
export const HOP_TTL_MS = 2 * 60 * 1000;

const PREFIX = 's1';

let key: Buffer | null = null;

function signingKey(): Buffer {
  if (key) return key;
  if (env.scribbleTicketSecret) {
    key = createHash('sha256').update(`scribble-ticket:${env.scribbleTicketSecret}`).digest();
    return key;
  }
  if (env.mongoUri) {
    // Shared by every instance without configuration; see env.scribbleTicketSecret.
    key = createHash('sha256').update(`scribble-ticket:derived:${env.mongoUri}`).digest();
    logger.warn('SCRIBBLE_TICKET_SECRET is not set; Scribble tickets are signed with a key derived from the database URI', {});
    return key;
  }
  throw new Error('Scribble tickets need SCRIBBLE_TICKET_SECRET or MONGODB_URI to sign with');
}

/** Settles the signing key at boot, so a derived key is warned about then, not on the first page fetch. */
export function initScribbleTickets(): void {
  signingKey();
}

const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');

function sign(body: string): string {
  return createHmac('sha256', signingKey()).update(body).digest('base64url');
}

export interface TicketSubject {
  userId: string;
  org: string;
  name: string;
}

export function mintTicket(
  subject: TicketSubject,
  options: { kind?: ScribbleTicketKind; ttlMs?: number; now?: number } = {},
): string {
  const kind = options.kind ?? 'ticket';
  const now = options.now ?? Date.now();
  const ttl = options.ttlMs ?? (kind === 'hop' ? HOP_TTL_MS : TICKET_TTL_MS);
  const payload: ScribbleTicket = {
    userId: subject.userId,
    org: subject.org,
    name: subject.name,
    kind,
    iat: now,
    exp: now + ttl,
  };
  const body = `${PREFIX}.${b64(JSON.stringify(payload))}`;
  return `${body}.${sign(body)}`;
}

/**
 * The statement behind a ticket, provided the signature holds, it is of the
 * `kind` asked for, and it has not expired. The kind is checked before the
 * expiry so a hop token at the socket is "invalid", never merely "expired".
 */
export function verifyTicket(
  raw: unknown,
  kind: ScribbleTicketKind,
  now = Date.now(),
): { ok: true; ticket: ScribbleTicket } | { ok: false; error: TicketFailure } {
  if (typeof raw !== 'string' || raw.length > 2048) return { ok: false, error: 'ticket_invalid' };
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, error: 'ticket_invalid' };
  const body = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, error: 'ticket_invalid' };
  }
  let ticket: ScribbleTicket;
  try {
    ticket = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as ScribbleTicket;
  } catch {
    return { ok: false, error: 'ticket_invalid' };
  }
  if (
    !ticket ||
    typeof ticket.userId !== 'string' ||
    !ticket.userId ||
    typeof ticket.org !== 'string' ||
    !ticket.org ||
    typeof ticket.exp !== 'number' ||
    ticket.kind !== kind
  ) {
    return { ok: false, error: 'ticket_invalid' };
  }
  if (ticket.exp <= now) return { ok: false, error: 'ticket_expired' };
  return { ok: true, ticket: { ...ticket, name: typeof ticket.name === 'string' ? ticket.name : '' } };
}

/** A URL with any `ticket=` value blanked, for logs. */
export function redactTicket(url: string): string {
  return url.replace(/([?&]ticket=)[^&#\s]*/gi, '$1[redacted]');
}
