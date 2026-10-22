import { AsyncLocalStorage } from 'node:async_hooks';
import type { User } from '../models/user.model';

/**
 * The signed-in user's record, as `requireAuth` read it, for the rest of the
 * same request.
 *
 * Most dashboard handlers begin by reading the caller's own user document to
 * learn their org, which `requireAuth` had read a moment earlier. On a link
 * where every round trip to the cluster costs a few hundred milliseconds, that
 * second read was a visible part of every page. This hands the same record on
 * instead. It lives only as long as the request, so nothing can go stale.
 *
 * Callers fall back to reading the database whenever this has nothing — a
 * scheduler, a script, a socket, or a request for a different user.
 */
type Viewer = Omit<User, 'profilePhotoUrl'>;
const scope = new AsyncLocalStorage<{ user: Viewer }>();

/** Runs the rest of the request with this user as its viewer. */
export function runAsViewer(user: Viewer, next: () => void): void {
  scope.run({ user }, next);
}

/** The signed-in user's record when `userId` is who this request is for; otherwise undefined. */
export function requestViewer(userId: string): Viewer | undefined {
  const user = scope.getStore()?.user;
  return user && user.userId === userId ? user : undefined;
}
