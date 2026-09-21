import type { Server as SocketServer, Namespace, Socket } from 'socket.io';
import { authenticateSocket } from './connect-realtime.service';
import {
  advanceEvent,
  eventTick,
  heartbeat,
  liveEventIds,
  markLeadAnswering,
  startDueEvents,
  PlayerSnapshot,
  touchPresence,
  skipQuestion,
  submitAnswer,
} from './relay-runtime.service';
import { RelayError } from './relay-import.service';
import { logger } from '../utils/logger';
import { createAdapter } from '@socket.io/redis-adapter';
import { redisPubSubPair } from '../config/redis';

/**
 * The game's socket layer.
 *
 * Two things shape it. A piece of a puzzle is emitted to one player's own room
 * and never to the team, because a clue that reaches the wrong device — even
 * hidden — is a clue that leaked. And state is pushed with its payload rather
 * than as a "something changed" nudge: a fetch in reply would add a round trip
 * and a database read to a path that has to keep a three-second cadence.
 */

const TICK_MS = 1000;

let namespace: Namespace | undefined;
let timer: NodeJS.Timeout | undefined;
/** What each player was last sent, so an unchanged tick costs nothing. */
const lastSent = new Map<string, string>();

function userRoom(userId: string): string {
  return `relay:user:${userId}`;
}

export function initRelayRealtime(io: SocketServer): Namespace {
  namespace = io.of('/relay');
  attachAdapter(io);

  namespace.use(async (socket, next) => {
    const identity = await authenticateSocket(socket);
    if ('error' in identity) {
      next(new Error(identity.error));
      return;
    }
    socket.data.userId = identity.userId;
    socket.data.org = identity.org;
    next();
  });

  namespace.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    void socket.join(userRoom(userId));
    logger.info('Relay socket connected', { userId, transport: socket.conn.transport.name });

    // A reconnecting phone is told what is true now rather than replaying what
    // it missed, which is only possible because state is derived from the clock.
    void pushTo(userId);

    socket.on('relay:heartbeat', () => {
      void heartbeat(userId).catch(() => undefined);
    });

    // Sent while the lead types; the other phones show that somebody is on it.
    socket.on('relay:typing', () => {
      void markLeadAnswering(userId).catch(() => undefined);
    });

    socket.on('relay:answer', async (payload: { text?: string }) => {
      await run(socket, userId, async () => {
        const result = await submitAnswer(userId, String(payload?.text ?? ''));
        socket.emit('relay:result', result);
        if (result.correct) await pushTeamOf(userId);
      });
    });

    socket.on('relay:skip', async () => {
      await run(socket, userId, async () => {
        const result = await skipQuestion(userId);
        socket.emit('relay:result', { correct: false, skipped: true, ...result });
        await pushTeamOf(userId);
      });
    });

    socket.on('disconnect', (reason) => {
      lastSent.delete(userId);
      logger.info('Relay socket disconnected', { userId, reason });
    });
  });

  start();
  logger.info('Relay realtime ready', { namespace: '/relay' });
  return namespace;
}

/**
 * Lets any server emit to a socket held by another.
 *
 * Without it, a clue decided on one instance cannot reach a phone connected to
 * a different one — the same split that made a prototype serve four versions of
 * one game. With a single server it is simply unused.
 */
function attachAdapter(target: SocketServer) {
  const pair = redisPubSubPair();
  if (!pair) {
    logger.info('Sockets running without a shared backplane', {});
    return;
  }
  try {
    // Set on the server, so Connect's own rooms get the same correctness.
    target.adapter(createAdapter(pair.pub, pair.sub));
    logger.info('Sockets sharing a Redis backplane', {});
  } catch (error) {
    logger.error('Could not attach the Redis adapter; sockets stay local', {}, error);
  }
}

async function run(socket: Socket, userId: string, action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof RelayError ? error.message : 'Something went wrong';
    socket.emit('relay:error', { message });
    if (!(error instanceof RelayError)) {
      logger.error('Relay socket action failed', { userId }, error);
    }
  }
}

/**
 * Sends a player their own view, and only if it differs from the last one.
 *
 * Most ticks change nothing for most people — a hint fires for one player at a
 * time — so comparing first keeps 220 sockets quiet between reveals.
 */
function emitIfChanged(userId: string, view: PlayerSnapshot) {
  const encoded = JSON.stringify(view);
  if (lastSent.get(userId) === encoded) return;
  lastSent.set(userId, encoded);
  namespace?.to(userRoom(userId)).emit('relay:state', view);
}

async function pushTo(userId: string) {
  for (const eventId of await liveEventIds()) {
    const views = await eventTick(eventId);
    const view = views.get(userId);
    if (view) {
      emitIfChanged(userId, view);
      return;
    }
  }
}

async function pushTeamOf(userId: string) {
  for (const eventId of await liveEventIds()) {
    const views = await eventTick(eventId);
    if (!views.has(userId)) continue;
    for (const [player, view] of views) emitIfChanged(player, view);
    return;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  // Never hold the process open on account of the game loop.
  timer.unref?.();
}

let ticking = false;

async function tick() {
  if (!namespace) return;
  // One pass at a time. Against a remote database a pass can outlast the
  // second between ticks, and letting them overlap stacks the work up exactly
  // when the most people are playing.
  if (ticking) return;
  ticking = true;
  try {
    // A scheduled event starts itself the moment it is due, so nobody has to
    // press anything on the day.
    await startDueEvents();
    const connected = [...new Set([...namespace.sockets.values()].map((s) => String(s.data.userId)))];
    for (const eventId of await liveEventIds()) {
      // Anyone holding a socket counts as present, before anything is derived
      // from who is present.
      await touchPresence(eventId, connected);
      // One owner moves the whole event on; the guard inside means a second
      // caller cannot double-advance, but with several backend instances this
      // still needs a lock rather than every instance trying.
      await advanceEvent(eventId);
      const views = await eventTick(eventId);
      for (const [userId, view] of views) emitIfChanged(userId, view);
    }
  } catch (error) {
    logger.error('Relay tick failed', {}, error);
  } finally {
    ticking = false;
  }
}

export function closeRelayRealtime(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  namespace = undefined;
  lastSent.clear();
}
