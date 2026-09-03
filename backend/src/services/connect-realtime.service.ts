import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { authSessions } from '../config/db';
import { env } from '../config/env';
import type { User } from '../models/user.model';
import { hashSessionToken } from './auth.service';
import { logger } from '../utils/logger';

export type ConnectChangeAction = 'created' | 'updated' | 'deleted';

export interface ConnectChange {
  postId: string;
  action: ConnectChangeAction;
  /**
   * Whoever caused the change. Clients skip their own events — the REST
   * response that triggered them already carries the updated post.
   */
  actorUserId?: string;
}

interface ConnectChangeTarget extends ConnectChange {
  org: string;
  /** Team-scoped posts only reach that reporting group; `null`/undefined is company-wide. */
  teamId?: string | null;
  /** @deprecated Legacy department-scoped posts. */
  department?: string | null;
}

let io: SocketServer | undefined;

/**
 * Posts are scoped by org and optionally narrowed to one reporting group (see
 * `getConnectFeed`), so rooms mirror exactly that: every socket joins its org
 * room plus a room for each team it belongs to — the one it leads and the one
 * it reports into — and a change is emitted to whichever room matches the
 * post's audience.
 */
function orgRoom(org: string): string {
  return `connect:org:${org}`;
}

function teamRoom(org: string, teamId: string): string {
  return `connect:org:${org}:team:${teamId}`;
}

/** @deprecated Rooms for posts written while Team meant "same department". */
function departmentRoom(org: string, department: string): string {
  return `connect:org:${org}:dept:${department}`;
}

export function initConnectRealtime(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    path: '/connect/socket',
    cors: { origin: env.corsOrigins, credentials: true },
    // Fall back to HTTP long-polling where a proxy in front of the API won't
    // pass a WebSocket upgrade through — the client degrades silently rather
    // than losing live updates entirely.
    transports: ['websocket', 'polling'],
  });

  io.use(async (socket, next) => {
    try {
      const token = socketToken(socket);
      if (!token) {
        next(new Error('Authentication required'));
        return;
      }
      // Session and user resolve in a single round trip: this database is
      // remote and a findOne costs up to ~1.5s, so doing it twice made every
      // socket handshake feel broken.
      const [record] = await authSessions()
        .aggregate<{ userId: string; user?: User }>([
          { $match: { tokenHash: hashSessionToken(token), expiresAt: { $gt: new Date() } } },
          { $limit: 1 },
          {
            $lookup: {
              from: 'users',
              localField: 'userId',
              foreignField: 'userId',
              as: 'user',
              // Only what room-joining needs: profile photos live inline as
              // base64 data URIs and would otherwise ride along on every
              // handshake.
              pipeline: [
                {
                  $project: {
                    _id: 0,
                    org: 1,
                    email: 1,
                    department: 1,
                    managerUserId: 1,
                    lifecycleStatus: 1,
                  },
                },
              ],
            },
          },
          { $project: { _id: 0, userId: 1, user: { $first: '$user' } } },
        ])
        .toArray();
      if (!record) {
        next(new Error('Session expired or invalid'));
        return;
      }
      const user = record.user;
      if (!user || user.lifecycleStatus === 'offboarded' || user.lifecycleStatus === 'terminated') {
        next(new Error('User is not active'));
        return;
      }
      const org = user.org ?? user.email.split('@').at(1) ?? 'default';
      socket.data.userId = record.userId;
      socket.data.org = org;
      socket.data.department = user.department;
      socket.data.managerUserId = user.managerUserId;
      next();
    } catch (error) {
      logger.error('Connect socket authentication failed', {}, error);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const org = socket.data.org as string;
    const department = socket.data.department as string | undefined;
    const userId = socket.data.userId as string;
    const managerUserId = socket.data.managerUserId as string | undefined;
    void socket.join(orgRoom(org));
    // The team this socket leads, and the one it reports into — mirrors
    // `visibleTeamIds` in the feed query.
    void socket.join(teamRoom(org, userId));
    if (managerUserId) void socket.join(teamRoom(org, managerUserId));
    if (department) void socket.join(departmentRoom(org, department));
    logger.info('Connect socket connected', {
      userId,
      org,
      managerUserId,
      transport: socket.conn.transport.name,
    });

    socket.on('disconnect', (reason) => {
      logger.info('Connect socket disconnected', { userId: socket.data.userId, reason });
    });
  });

  logger.info('Connect realtime ready', { path: '/connect/socket' });
  return io;
}

function socketToken(socket: Socket): string | undefined {
  const fromAuth = socket.handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
  const header = socket.handshake.headers.authorization ?? '';
  const [scheme, headerToken] = header.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && headerToken) return headerToken;
  const query = socket.handshake.query?.token;
  return typeof query === 'string' && query.length > 0 ? query : undefined;
}

/**
 * Broadcasts that one post changed. Deliberately carries no post body: every
 * viewer sees a different rendering of the same post (their own `liked`,
 * `selectedPollOptionId`, `actionValue`, per-comment `liked`), so clients
 * fetch their own view of it rather than trusting a shared payload.
 */
export function emitConnectChange(change: ConnectChangeTarget): void {
  if (!io) return;
  const { org, teamId, department, ...payload } = change;
  const room = teamId
    ? teamRoom(org, teamId)
    : department
      ? departmentRoom(org, department)
      : orgRoom(org);
  io.to(room).emit('connect:changed', payload);
}

export function closeConnectRealtime(): void {
  io?.close();
  io = undefined;
}
