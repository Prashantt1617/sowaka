/**
 * Secret Squad's sockets: namespace `/squad` on the Connect socket server
 * (docs/secret-squad.md). A socket proves who it is with a game ticket (the
 * page inside the app) or a session token (the page signed in in a browser),
 * then sits in its person's room and in its office's room.
 */
import type { Namespace, Server as SocketServer, Socket } from 'socket.io';
import { authenticateSocket } from './connect-realtime.service';
import { verifyTicket } from './scribble-ticket.service';
import {
  SquadRuleError,
  SquadViewer,
  answerSquad,
  checkSquad,
  forgetSquadSent,
  joinSquad,
  leaveSquad,
  officeKey,
  openDueSessions,
  setSquadEmitter,
  squadPresence,
  stateFor,
  tickSquad,
  viewerFor,
} from './secret-squad.service';
import { logger } from '../utils/logger';

const TICK_MS = 500;
const OPEN_MS = 5_000;

let namespace: Namespace | undefined;
let ticker: NodeJS.Timeout | undefined;
let opener: NodeJS.Timeout | undefined;

const userRoom = (userId: string) => `squad:user:${userId}`;
const officeRoom = (org: string, office: string) => `squad:office:${org}:${officeKey(office)}`;

class Bucket {
  private tokens: number;
  private last: number;
  constructor(private readonly rate: number, private readonly burst: number) {
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

export function initSquadRealtime(io: SocketServer): Namespace {
  namespace = io.of('/squad');
  const ns = namespace;

  setSquadEmitter({
    toUser: (userId, event, payload) => ns.to(userRoom(userId)).emit(event, payload),
    toOffice: (org, office, except, event, payload) =>
      ns.to(officeRoom(org, office)).except(except.map(userRoom)).emit(event, payload),
  });

  ns.use(async (socket, next) => {
    const userId = await identify(socket);
    if (!userId) {
      const error = new Error('not_allowed') as Error & { data?: unknown };
      error.data = { code: 'not_allowed' };
      next(error);
      return;
    }
    socket.data.userId = userId;
    next();
  });

  ns.on('connection', (socket) => {
    // Listeners first: a page asks for things the moment it connects.
    const seated = welcome(socket).catch((error) => {
      logger.error('Secret Squad socket setup failed', { userId: socket.data.userId }, error);
      socket.emit('squad:fatal', { code: 'setup_failed', message: 'Secret Squad could not start. Close and reopen it.' });
      socket.disconnect(true);
      return null;
    });
    listen(socket, seated);
  });

  start();
  logger.info('Secret Squad realtime ready', { namespace: '/squad' });
  return ns;
}

/** The ticket's person, or the session token's; null if neither checks out. */
async function identify(socket: Socket): Promise<string | null> {
  const ticket = socket.handshake.auth?.ticket;
  if (ticket !== undefined && ticket !== null && ticket !== '') {
    const verdict = verifyTicket(ticket, 'ticket');
    return verdict.ok ? verdict.ticket.userId : null;
  }
  const identity = await authenticateSocket(socket);
  return 'error' in identity ? null : identity.userId;
}

async function welcome(socket: Socket): Promise<SquadViewer | null> {
  const viewer = await viewerFor(socket.data.userId as string);
  if (!viewer) {
    socket.emit('squad:fatal', { code: 'not_allowed', message: 'Secret Squad could not sign you in.' });
    socket.disconnect(true);
    return null;
  }
  if (!viewer.office) {
    socket.emit('squad:fatal', { code: 'no_office', message: "You're not on an office list for Secret Squad yet. Ask HR to add you." });
    socket.disconnect(true);
    return null;
  }
  await socket.join([userRoom(viewer.userId), officeRoom(viewer.org, viewer.office)]);
  forgetSquadSent(viewer.userId);
  await squadPresence(viewer, true);
  socket.emit('squad:state', await stateFor(viewer));
  return viewer;
}

function listen(socket: Socket, seated: Promise<SquadViewer | null>) {
  const userId = socket.data.userId as string;
  const buckets = {
    join: new Bucket(10 / 60, 6),
    check: new Bucket(1, 4),
    small: new Bucket(4, 8),
  };

  const on = (event: string, bucket: Bucket, handler: (viewer: SquadViewer, payload: Record<string, unknown>) => Promise<unknown>) => {
    socket.on(event, async (payload: unknown, ack: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (value: unknown) => void) : () => undefined;
      if (!bucket.take()) {
        reply({ ok: false, status: 429, message: 'Slow down a little and try again.' });
        return;
      }
      try {
        const viewer = await seated;
        if (!viewer) {
          reply({ ok: false, status: 403, message: 'Secret Squad could not sign you in.' });
          return;
        }
        const data = await handler(viewer, payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {});
        reply({ ok: true, data: data ?? {} });
      } catch (error) {
        if (error instanceof SquadRuleError) {
          reply({ ok: false, status: error.status, message: error.message });
          return;
        }
        logger.error('Secret Squad request failed', { event, userId }, error);
        reply({ ok: false, status: 500, message: 'Something went wrong. Try again.' });
      }
    });
  };

  on('squad:join', buckets.join, (viewer) => joinSquad(viewer));
  on('squad:leave', buckets.small, (viewer) => leaveSquad(viewer));
  on('squad:check', buckets.check, (viewer, p) => checkSquad(viewer, { code: p.code, qr: p.qr }));
  on('squad:answer', buckets.small, (viewer, p) => answerSquad(viewer, { askId: p.askId, allow: p.allow }));
  on('squad:sync', buckets.small, async (viewer) => {
    forgetSquadSent(viewer.userId);
    socket.emit('squad:state', await stateFor(viewer));
    return {};
  });

  socket.on('disconnect', async () => {
    try {
      const viewer = await seated;
      if (!viewer) return;
      // Another socket of theirs (a second tab, a reconnect) keeps them online.
      const remaining = await namespace?.in(userRoom(userId)).fetchSockets();
      if (remaining && remaining.length > 0) return;
      forgetSquadSent(userId);
      await squadPresence(viewer, false);
      const arrived = await namespace?.in(userRoom(userId)).fetchSockets();
      if (arrived && arrived.length > 0) await squadPresence(viewer, true);
    } catch (error) {
      logger.error('Secret Squad disconnect handling failed', { userId }, error);
    }
  });
}

function start() {
  if (!ticker) {
    let busy = false;
    ticker = setInterval(() => {
      if (busy) return;
      busy = true;
      void tickSquad()
        .catch((error) => logger.error('Secret Squad tick failed', {}, error))
        .finally(() => { busy = false; });
    }, TICK_MS);
    ticker.unref?.();
  }
  if (!opener) {
    let busy = false;
    opener = setInterval(() => {
      if (busy) return;
      busy = true;
      void openDueSessions()
        .catch((error) => logger.error('Secret Squad opening failed', {}, error))
        .finally(() => { busy = false; });
    }, OPEN_MS);
    opener.unref?.();
  }
}

export function closeSquadRealtime(): void {
  if (ticker) clearInterval(ticker);
  if (opener) clearInterval(opener);
  ticker = undefined;
  opener = undefined;
  namespace = undefined;
  setSquadEmitter(null);
}
