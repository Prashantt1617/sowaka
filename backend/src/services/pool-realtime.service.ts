import type { Server as SocketServer, Namespace, Socket } from 'socket.io';
import { users } from '../config/db';
import type { User } from '../models/user.model';
import { authenticateSocket } from './connect-realtime.service';
import { resolveProfilePhoto } from './s3-connect-media.service';
import {
  PoolError,
  Seat,
  againRoom,
  forgetSent,
  hello,
  hostRoom,
  inviteToRoom,
  joinRoom,
  leaveRoom,
  onConnected,
  onDisconnected,
  openInvitesFor,
  placeBall,
  quickJoin,
  setPoolEmitter,
  startRoom,
  takeShot,
  tickPool,
} from './pool-room.service';
import { verifyTicket } from './scribble-ticket.service';
import { VoiceGame, dropMic, listenForVoice, voiceOn } from './game-voice.service';
import { readRoom, seatOf } from './pool-store';
import { seatedIds } from './pool-rooms-engine';
import { logger } from '../utils/logger';

/**
 * Sowaka Pool's socket layer: the `/pool` namespace on the app's socket server
 * (path `/connect/socket`, the Redis backplane the relay attaches), built like
 * Tile Up's (`tileup-realtime.service.ts`).
 *
 * A handshake carries a game ticket (what the page has; the same tickets
 * Scribble's page carries, see `scribble-ticket.service`) or, for an app that
 * holds the session, the session token the other namespaces take. Requests
 * are acked as `{ok, data}` or `{ok:false, status, message}`.
 */

const TICK_MS = 500;

let namespace: Namespace | undefined;
let timer: NodeJS.Timeout | undefined;

const userRoom = (userId: string) => `pool:user:${userId}`;

/** Pool Table's side of game voice: the caller's table is the room they are seated in. */
const poolVoice: VoiceGame = {
  async tableOf(org, userId) {
    const code = await seatOf(org, userId);
    if (!code) return null;
    const room = await readRoom(org, code);
    if (!room) return null;
    return { channel: `pool:${org}:${code}`, members: seatedIds(room) };
  },
  emitTo(userId, event, payload) {
    namespace?.to(userRoom(userId)).emit(event, payload);
  },
};
const roomChannel = (org: string, code: string) => `pool:room:${org}:${code}`;

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

const SIGN_IN_FAILED = 'Pool Table could not sign you in. Close and reopen the game to keep playing.';

export function initPoolRealtime(io: SocketServer): Namespace {
  namespace = io.of('/pool');
  const ns = namespace;

  setPoolEmitter({
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
      logger.error('Pool socket setup failed', { userId: socket.data.userId }, error);
      socket.emit('room:fatal', { code: 'setup_failed', message: 'Pool Table could not start. Close and reopen the game to keep playing.' });
      socket.disconnect(true);
      return null;
    });
    listen(socket, seated);
  });

  start();
  logger.info('Pool realtime ready', { namespace: '/pool' });
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
  logger.info('Pool socket connected', { userId, org, transport: socket.conn.transport.name });
  forgetSent(userId);
  await onConnected(seat);
  // The invites that arrived while the game was closed, replayed to this socket
  // as if they had just been sent: the page draws its card from each. Only
  // ever a nicety, so a store fault here does not cost them the room.
  try {
    for (const invite of await openInvitesFor(org, userId)) socket.emit('room:invite', { from: invite.from, code: invite.code, expiresAt: invite.expiresAt });
  } catch (error) {
    logger.error('Pool invite replay failed', { userId, org }, error);
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
        if (error instanceof PoolError) {
          reply({ ok: false, status: error.status, message: error.message });
          return;
        }
        logger.error('Pool request failed', { event, userId }, error);
        reply({ ok: false, status: 500, message: 'Something went wrong. Try again.' });
      }
    });
  };

  // `voice`: the company has game voice on, so the page offers the mic (companies.features.gameVoice).
  on('room:hello', buckets.small, async (seat) => ({ ...(await hello(seat)), voice: await voiceOn(seat.org) }));
  on('room:host', buckets.host, (seat, p) => hostRoom(seat, { open: p.open, size: p.size }));
  on('room:join', buckets.join, (seat, p) => joinRoom(seat, p.code, { rejoin: p.rejoin === true }));
  on('room:quick', buckets.join, (seat, p) => quickJoin(seat, { size: p.size }));
  on('room:leave', buckets.small, async (seat) => {
    await leaveRoom(seat);
    return {};
  });
  on('room:invite', buckets.invite, (seat, p) => inviteToRoom(seat, p.userId));
  on('room:start', buckets.small, async (seat) => {
    await startRoom(seat);
    return {};
  });
  on('room:again', buckets.small, async (seat) => {
    await againRoom(seat);
    return {};
  });
  on('pool:place', buckets.move, (seat, p) => placeBall(seat, { x: p.x, y: p.y }));
  on('pool:shot', buckets.move, (seat, p) => takeShot(seat, { aim: p.aim, power: p.power, spin: p.spin }));
  listenForVoice(socket, poolVoice, async () => {
    const seat = await seated;
    return seat ? { org: seat.org, userId: seat.userId, name: seat.name } : null;
  });

  socket.on('disconnect', async (reason) => {
    logger.info('Pool socket disconnected', { userId, reason });
    try {
      // Another socket of theirs (a second tab, a reconnect that beat this
      // close) keeps them online. Asked across every instance.
      const seat = await seated;
      if (!seat) return;
      const remaining = await namespace?.in(userRoom(userId)).fetchSockets();
      if (remaining && remaining.length > 0) return;
      // Gone mid-message: the mic is free for the others.
      await dropMic(poolVoice, seat.org, userId);
      forgetSent(userId);
      await onDisconnected(seat);
      // A socket that arrived while that was written must not be left offline.
      const arrived = await namespace?.in(userRoom(userId)).fetchSockets();
      if (arrived && arrived.length > 0) await onConnected(seat);
    } catch (error) {
      logger.error('Pool disconnect handling failed', { userId }, error);
    }
  });
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    void tickPool().catch((error) => logger.error('Pool tick failed', {}, error));
  }, TICK_MS);
  timer.unref?.();
}

export function closePoolRealtime(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  namespace = undefined;
  setPoolEmitter(null);
  people.clear();
}
