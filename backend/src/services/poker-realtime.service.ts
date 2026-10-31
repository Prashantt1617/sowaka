import type { Namespace, Server as SocketServer, Socket } from 'socket.io';
import { users } from '../config/db';
import { authenticateSocket } from './connect-realtime.service';
import {
  act,
  eventFor,
  hello,
  joinQueue,
  leaveQueue,
  mineFor,
  onGone,
  placePick,
  PokerError,
  PokerIdentity,
  setPokerEmitter,
  sharedFor,
  sitBackIn,
  startPractice,
  tickPoker,
  unwatch,
  watch,
} from './poker-room.service';
import {
  actInRoom,
  againRoom,
  forgetRoomSent,
  hostRoom,
  houseRoom,
  inviteToRoom,
  joinRoom,
  kickFromRoom,
  leaveRoom,
  onRoomConnected,
  onRoomDisconnected,
  openInvitesFor,
  openRooms,
  PokerRoomError,
  practiceRoom,
  quickJoin,
  roomsHello,
  setPokerRoomEmitter,
  settingsRoom,
  sitInRoom,
  startRoom,
  tickPokerRooms,
} from './poker-rooms.service';
import { resolveProfilePhoto } from './s3-connect-media.service';
import { verifyTicket } from './scribble-ticket.service';
import { logger } from '../utils/logger';

/**
 * Speed Poker's socket layer: the `/poker` namespace on the app's socket
 * server (path `/connect/socket`), built like Tile Up's. A handshake carries
 * the game page's ticket, an office screen's TV ticket (read only), or a
 * session. Requests are acked `{ok, data}` or `{ok:false, status, message}`.
 *
 * Rooms: `poker:user:<id>` (their own table views and toasts),
 * `poker:event:<eventId>` (the shared lobby), `poker:watch:<tableId>`
 * (a table's spectator view), `poker:room:<org>:<code>` (a group-game
 * table's feed).
 *
 * Two games share the namespace: the group game (`room:*`, rooms any company
 * with the catalog key can open, `poker-rooms.service.ts`) and an event's day
 * (`queue:*`, `table:*`, `picks:*`, only while the host has one on).
 */

const TICK_MS = 500;

let namespace: Namespace | undefined;
let timer: NodeJS.Timeout | undefined;

const userRoom = (userId: string) => `poker:user:${userId}`;
const eventRoom = (eventId: string) => `poker:event:${eventId}`;
const watchRoom = (tableId: string) => `poker:watch:${tableId}`;
const roomChannel = (org: string, code: string) => `poker:room:${org}:${code}`;

class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly rate: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
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

const people = new Map<string, { value: Awaited<ReturnType<typeof readPerson>>; expiresAt: number }>();

function readPerson(userId: string) {
  return users().findOne(
    { userId },
    { projection: { _id: 0, userId: 1, name: 1, org: 1, email: 1, lifecycleStatus: 1, location: 1, profilePhotoKey: 1, profilePhotoUrl: 1 } },
  );
}

async function personOf(userId: string) {
  const held = people.get(userId);
  if (held && held.expiresAt > Date.now()) return held.value;
  const value = await readPerson(userId);
  if (value) people.set(userId, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

const SIGN_IN_FAILED = 'Speed Poker could not sign you in. Close and reopen it to keep playing.';

export function initPokerRealtime(io: SocketServer): Namespace {
  namespace = io.of('/poker');
  const ns = namespace;

  setPokerEmitter({
    toUser: (userId, event, payload) => ns.to(userRoom(userId)).emit(event, payload),
    toWatchers: (tableId, event, payload) => ns.to(watchRoom(tableId)).emit(event, payload),
    toEvent: (eventId, event, payload) => ns.to(eventRoom(eventId)).emit(event, payload),
    watch: (userId, tableId, on) => {
      const sockets = ns.in(userRoom(userId));
      if (on) sockets.socketsJoin(watchRoom(tableId));
      else sockets.socketsLeave(watchRoom(tableId));
    },
  });

  setPokerRoomEmitter({
    toUser: (userId, event, payload) => ns.to(userRoom(userId)).emit(event, payload),
    toRoom: (org, code, event, payload) => ns.to(roomChannel(org, code)).emit(event, payload),
    seat: (userId, org, code, inside) => {
      const sockets = ns.in(userRoom(userId));
      if (inside) sockets.socketsJoin(roomChannel(org, code));
      else sockets.socketsLeave(roomChannel(org, code));
    },
  });

  ns.use(async (socket, next) => {
    const auth = socket.handshake.auth ?? {};
    if (typeof auth.tv === 'string' && auth.tv) {
      const verdict = verifyTicket(auth.tv, 'poker-tv');
      if (!verdict.ok) return next(Object.assign(new Error(verdict.error), { data: { code: verdict.error } }));
      socket.data.tv = true;
      socket.data.userId = `tv:${verdict.ticket.userId}`;
      socket.data.org = verdict.ticket.org;
      return next();
    }
    if (typeof auth.ticket === 'string' && auth.ticket) {
      const verdict = verifyTicket(auth.ticket, 'ticket');
      if (!verdict.ok) return next(Object.assign(new Error(verdict.error), { data: { code: verdict.error } }));
      socket.data.userId = verdict.ticket.userId;
      socket.data.org = verdict.ticket.org;
      return next();
    }
    const identity = await authenticateSocket(socket);
    if ('error' in identity) return next(Object.assign(new Error('not_allowed'), { data: { code: 'not_allowed' } }));
    socket.data.userId = identity.userId;
    socket.data.org = identity.org;
    next();
  });

  ns.on('connection', (socket) => {
    const ready = welcome(socket).catch((error) => {
      logger.error('Poker socket setup failed', { userId: socket.data.userId }, error);
      socket.emit('poker:fatal', { message: 'Speed Poker could not start. Close and reopen it.' });
      socket.disconnect(true);
      return null;
    });
    listen(socket, ready);
  });

  start();
  logger.info('Speed Poker realtime ready', { namespace: '/poker' });
  return ns;
}

/** Who this is now (still employed, same company), and into their rooms. */
async function welcome(socket: Socket): Promise<PokerIdentity | null> {
  const userId = socket.data.userId as string;
  const org = socket.data.org as string;
  let who: PokerIdentity;
  if (socket.data.tv) {
    who = { userId, org, name: 'Office screen', photoUrl: null, office: null };
  } else {
    const person = await personOf(userId);
    const personOrg = person?.org ?? person?.email?.split('@').at(1) ?? null;
    if (!person || person.lifecycleStatus === 'offboarded' || person.lifecycleStatus === 'terminated' || personOrg !== org) {
      socket.emit('poker:fatal', { message: SIGN_IN_FAILED });
      socket.disconnect(true);
      return null;
    }
    who = { userId, org, name: person.name || 'Someone', photoUrl: (await resolveProfilePhoto(person).catch(() => null)) ?? null, office: person.location ?? null };
  }
  await socket.join(userRoom(userId));
  if (!socket.data.tv) {
    // Back into their group-game table, and the invites that came while the page was closed.
    forgetRoomSent(userId);
    await onRoomConnected(who);
    try {
      for (const invite of await openInvitesFor(org, userId)) socket.emit('room:invite', invite);
    } catch (error) {
      logger.error('Poker invite replay failed', { userId, org }, error);
    }
  }
  const event = await eventFor(org);
  if (event) await socket.join(eventRoom(event.id));
  return who;
}

function listen(socket: Socket, ready: Promise<PokerIdentity | null>) {
  const tv = Boolean(socket.data.tv);
  const buckets = { move: new Bucket(3, 8), small: new Bucket(4, 10), pick: new Bucket(1, 5), host: new Bucket(5 / 60, 5), join: new Bucket(10 / 60, 10), invite: new Bucket(1, 5) };

  const on = (event: string, bucket: Bucket, handler: (who: PokerIdentity, p: Record<string, unknown>) => Promise<unknown>, watchOnly = false) => {
    socket.on(event, async (payload: unknown, ack: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (value: unknown) => void) : () => undefined;
      if (!bucket.take()) return reply({ ok: false, status: 429, message: 'Slow down a little and try again.' });
      try {
        const who = await ready;
        if (!who) return reply({ ok: false, status: 403, message: SIGN_IN_FAILED });
        if (tv && !watchOnly) return reply({ ok: false, status: 403, message: 'This screen can only watch.' });
        const data = await handler(who, payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {});
        reply({ ok: true, data: data ?? {} });
      } catch (error) {
        if (error instanceof PokerError || error instanceof PokerRoomError) return reply({ ok: false, status: error.status, message: error.message });
        logger.error('Poker request failed', { event, userId: socket.data.userId }, error);
        reply({ ok: false, status: 500, message: 'Something went wrong. Try again.' });
      }
    });
  };

  on(
    'poker:hello',
    buckets.small,
    async (who) => {
      if (tv) {
        const event = await eventFor(who.org);
        return { tv: true, shared: event && event.status !== 'draft' ? await sharedFor(event) : null };
      }
      return hello(who);
    },
    true,
  );
  on('poker:mine', buckets.small, async (who) => {
    const event = await eventFor(who.org);
    return event ? { mine: await mineFor(event, who) } : {};
  });
  on('queue:join', buckets.small, (who) => joinQueue(who));
  on('queue:leave', buckets.small, (who) => leaveQueue(who));
  on('practice:start', buckets.small, (who) => startPractice(who));
  on('table:act', buckets.move, (who, p) => act(who, p.tableId, p.action));
  on('table:sitin', buckets.small, (who, p) => sitBackIn(who, p.tableId));
  on('table:watch', buckets.small, (who, p) => watch(who, p.tableId), true);
  on('table:unwatch', buckets.small, (who, p) => unwatch(who, p.tableId), true);
  on('picks:place', buckets.pick, (who, p) => placePick(who, p));

  // The group game: rooms, no event.
  on('room:hello', buckets.small, (who) => roomsHello(who));
  on('room:list', buckets.small, async (who) => ({ rooms: await openRooms(who.org) }));
  on('room:host', buckets.host, (who, p) => hostRoom(who, { open: p.open !== false }));
  on('room:practice', buckets.host, (who) => practiceRoom(who));
  on('room:quick', buckets.join, (who) => quickJoin(who));
  on('room:join', buckets.join, (who, p) => joinRoom(who, p.code, { rejoin: p.rejoin === true }));
  on('room:leave', buckets.small, async (who) => {
    await leaveRoom(who);
    return {};
  });
  on('room:invite', buckets.invite, (who, p) => inviteToRoom(who, p.userId));
  on('room:start', buckets.small, async (who) => {
    await startRoom(who);
    return {};
  });
  on('room:settings', buckets.small, (who, p) => settingsRoom(who, { minutes: p.minutes, open: p.open }));
  on('room:house', buckets.small, (who, p) => houseRoom(who, p.delta));
  on('room:kick', buckets.small, async (who, p) => {
    await kickFromRoom(who, p.userId);
    return {};
  });
  on('room:again', buckets.small, async (who) => {
    await againRoom(who);
    return {};
  });
  on('room:act', buckets.move, (who, p) => actInRoom(who, p.action));
  on('room:sitin', buckets.small, (who) => sitInRoom(who));

  socket.on('disconnect', async () => {
    try {
      const who = await ready;
      if (!who || tv) return;
      const remaining = await namespace?.in(userRoom(who.userId)).fetchSockets();
      if (remaining && remaining.length > 0) return;
      forgetRoomSent(who.userId);
      await onRoomDisconnected(who);
      // A socket that arrived while that was written must not be left offline.
      const arrived = await namespace?.in(userRoom(who.userId)).fetchSockets();
      if (arrived && arrived.length > 0) await onRoomConnected(who);
      await onGone(who);
    } catch (error) {
      logger.error('Poker disconnect handling failed', { userId: socket.data.userId }, error);
    }
  });
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    void tickPoker().catch((error) => logger.error('Poker tick failed', {}, error));
    void tickPokerRooms().catch((error) => logger.error('Poker room tick failed', {}, error));
  }, TICK_MS);
  timer.unref?.();
}

export function closePokerRealtime(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  namespace = undefined;
  setPokerEmitter(null);
  setPokerRoomEmitter(null);
  people.clear();
}
