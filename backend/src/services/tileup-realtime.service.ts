import type { Server as SocketServer, Namespace, Socket } from 'socket.io';
import { users } from '../config/db';
import type { User } from '../models/user.model';
import { authenticateSocket } from './connect-realtime.service';
import { resolveProfilePhoto } from './s3-connect-media.service';
import {
  TileUpError,
  Seat,
  againRoom,
  forgetSent,
  hostRoom,
  inviteToRoom,
  joinRoom,
  kickFromRoom,
  leaveRoom,
  onConnected,
  onDisconnected,
  openInvitesFor,
  passMove,
  playMove,
  setTileUpEmitter,
  settingsRoom,
  startRoom,
  swapMove,
  tickTileUp,
} from './tileup-room.service';
import { verifyTicket } from './scribble-ticket.service';
import { logger } from '../utils/logger';

/**
 * Tile Up's socket layer: the `/tileup` namespace on the app's socket server
 * (path `/connect/socket`, the Redis backplane the relay attaches), built like
 * Scribble's (`scribble-realtime.service.ts`).
 *
 * A handshake carries a game ticket (what the page has; the same tickets
 * Scribble's page carries, see `scribble-ticket.service`) or, for an app that
 * holds the session, the session token the other namespaces take. Requests
 * are acked as `{ok, data}` or `{ok:false, status, message}`.
 */

const TICK_MS = 500;

let namespace: Namespace | undefined;
let timer: NodeJS.Timeout | undefined;

const userRoom = (userId: string) => `tileup:user:${userId}`;
const roomChannel = (org: string, code: string) => `tileup:room:${org}:${code}`;

/** A token bucket: `rate` a second, up to `burst` in hand. */
class Bucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly rate: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
    this.last = Date.now();
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

interface Identity {
  userId: string;
  org: string;
  name: string;
}

/** The person behind a user id, briefly remembered: a reconnect storm must not cost a database read each. */
const people = new Map<string, { value: Pick<User, 'userId' | 'name' | 'org' | 'email' | 'lifecycleStatus' | 'profilePhotoKey' | 'profilePhotoUrl'> | null; expiresAt: number }>();
const PEOPLE_TTL_MS = 60_000;

async function personOf(userId: string) {
  const held = people.get(userId);
  if (held && held.expiresAt > Date.now()) return held.value;
  const value = await users().findOne(
    { userId },
    { projection: { _id: 0, userId: 1, name: 1, org: 1, email: 1, lifecycleStatus: 1, profilePhotoKey: 1, profilePhotoUrl: 1 } },
  );
  if (value) people.set(userId, { value, expiresAt: Date.now() + PEOPLE_TTL_MS });
  return value;
}

const SIGN_IN_FAILED = 'Tile Up could not sign you in. Close and reopen Tile Up to keep playing.';

export function initTileUpRealtime(io: SocketServer): Namespace {
  namespace = io.of('/tileup');
  const ns = namespace;

  setTileUpEmitter({
    toUser: (userId, event, payload) => ns.to(userRoom(userId)).emit(event, payload),
    toRoom: (org, code, event, payload) => ns.to(roomChannel(org, code)).emit(event, payload),
    // Through the adapter, so a socket of theirs on another instance moves too.
    seat: (userId, org, code, inside) => {
      const sockets = ns.in(userRoom(userId));
      if (inside) sockets.socketsJoin(roomChannel(org, code));
      else sockets.socketsLeave(roomChannel(org, code));
    },
  });

  ns.use(async (socket, next) => {
    const identity = await identify(socket);
    if ('error' in identity) {
      const error = new Error(identity.error) as Error & { data?: unknown };
      error.data = { code: identity.error };
      next(error);
      return;
    }
    socket.data.userId = identity.userId;
    socket.data.org = identity.org;
    socket.data.name = identity.name;
    next();
  });

  ns.on('connection', (socket) => {
    // Handlers go on now, before anything is awaited: a page sends its first
    // request the moment it connects, and a listener added later misses it.
    // Each one waits for the seat, which the setup settles.
    const seated = welcome(socket).catch((error) => {
      logger.error('Tile Up socket setup failed', { userId: socket.data.userId }, error);
      socket.emit('room:fatal', { code: 'setup_failed', message: 'Tile Up could not start. Close and reopen Tile Up to keep playing.' });
      socket.disconnect(true);
      return null;
    });
    listen(socket, seated);
  });

  start();
  logger.info('Tile Up realtime ready', { namespace: '/tileup' });
  return ns;
}

/** Who this is: from a ticket, else from the session the app's sockets carry. */
async function identify(socket: Socket): Promise<Identity | { error: string }> {
  const ticket = socket.handshake.auth?.ticket;
  if (ticket !== undefined && ticket !== null && ticket !== '') {
    const verdict = verifyTicket(ticket, 'ticket');
    if (!verdict.ok) return { error: verdict.error };
    return { userId: verdict.ticket.userId, org: verdict.ticket.org, name: verdict.ticket.name };
  }
  const identity = await authenticateSocket(socket);
  if ('error' in identity) return { error: 'not_allowed' };
  return { userId: identity.userId, org: identity.org, name: '' };
}

/** Checks the person is still who the ticket says, and puts them back in their room. */
async function welcome(socket: Socket): Promise<Seat | null> {
  const userId = socket.data.userId as string;
  const org = socket.data.org as string;
  // The ticket says who they were when the page was fetched; the record says
  // who they are now. Someone offboarded since, or moved company, is refused.
  const person = await personOf(userId);
  const personOrg = person?.org ?? person?.email?.split('@').at(1) ?? null;
  if (!person || person.lifecycleStatus === 'offboarded' || person.lifecycleStatus === 'terminated' || personOrg !== org) {
    socket.emit('room:fatal', { code: 'not_allowed', message: SIGN_IN_FAILED });
    socket.disconnect(true);
    return null;
  }
  const seat: Seat = {
    userId,
    org,
    name: person.name || (socket.data.name as string) || 'Someone',
    photoUrl: (await resolveProfilePhoto(person)) ?? null,
  };
  await socket.join(userRoom(userId));
  logger.info('Tile Up socket connected', { userId, org, transport: socket.conn.transport.name });
  forgetSent(userId);
  await onConnected(seat);
  // The invites that arrived while Tile Up was closed, replayed to this socket
  // as if they had just been sent: the page draws its card from each. Only
  // ever a nicety, so a store fault here does not cost them the room.
  try {
    for (const invite of await openInvitesFor(org, userId)) socket.emit('room:invite', { from: invite.from, code: invite.code, expiresAt: invite.expiresAt });
  } catch (error) {
    logger.error('Tile Up invite replay failed', { userId, org }, error);
  }
  return seat;
}

function listen(socket: Socket, seated: Promise<Seat | null>) {
  const userId = socket.data.userId as string;
  const buckets = {
    host: new Bucket(5 / 60, 5),
    join: new Bucket(10 / 60, 10),
    invite: new Bucket(1, 5),
    move: new Bucket(2, 6),
    small: new Bucket(5, 10),
  };

  const on = (event: string, bucket: Bucket, handler: (seat: Seat, payload: Record<string, unknown>) => Promise<unknown>) => {
    socket.on(event, async (payload: unknown, ack: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (value: unknown) => void) : () => undefined;
      if (!bucket.take()) {
        reply({ ok: false, status: 429, message: 'Slow down a little and try again.' });
        return;
      }
      try {
        const seat = await seated;
        if (!seat) {
          reply({ ok: false, status: 403, message: SIGN_IN_FAILED });
          return;
        }
        const data = await handler(seat, payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {});
        reply({ ok: true, data: data ?? {} });
      } catch (error) {
        if (error instanceof TileUpError) {
          reply({ ok: false, status: error.status, message: error.message });
          return;
        }
        logger.error('Tile Up request failed', { event, userId }, error);
        reply({ ok: false, status: 500, message: 'Something went wrong. Try again.' });
      }
    });
  };

  on('room:host', buckets.host, (seat) => hostRoom(seat));
  on('room:join', buckets.join, (seat, p) => joinRoom(seat, p.code, { rejoin: p.rejoin === true }));
  on('room:leave', buckets.small, async (seat) => {
    await leaveRoom(seat);
    return {};
  });
  on('room:invite', buckets.invite, (seat, p) => inviteToRoom(seat, p.userId));
  on('room:start', buckets.small, async (seat) => {
    await startRoom(seat);
    return {};
  });
  on('room:settings', buckets.small, (seat, p) => settingsRoom(seat, { secs: p.secs }));
  on('room:kick', buckets.small, async (seat, p) => {
    await kickFromRoom(seat, p.userId);
    return {};
  });
  on('room:again', buckets.small, async (seat) => {
    await againRoom(seat);
    return {};
  });
  on('tileup:play', buckets.move, (seat, p) => playMove(seat, p.tiles));
  on('tileup:swap', buckets.move, (seat, p) => swapMove(seat, p.letters));
  on('tileup:pass', buckets.move, (seat) => passMove(seat));

  socket.on('disconnect', async (reason) => {
    logger.info('Tile Up socket disconnected', { userId, reason });
    try {
      // Another socket of theirs (a second tab, a reconnect that beat this
      // close) keeps them online. Asked across every instance.
      const seat = await seated;
      if (!seat) return;
      const remaining = await namespace?.in(userRoom(userId)).fetchSockets();
      if (remaining && remaining.length > 0) return;
      forgetSent(userId);
      await onDisconnected(seat);
      // A socket that arrived while that was written must not be left offline.
      const arrived = await namespace?.in(userRoom(userId)).fetchSockets();
      if (arrived && arrived.length > 0) await onConnected(seat);
    } catch (error) {
      logger.error('Tile Up disconnect handling failed', { userId }, error);
    }
  });
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    void tickTileUp().catch((error) => logger.error('Tile Up tick failed', {}, error));
  }, TICK_MS);
  timer.unref?.();
}

export function closeTileUpRealtime(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  namespace = undefined;
  setTileUpEmitter(null);
  people.clear();
}
