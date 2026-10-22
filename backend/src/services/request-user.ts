import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who the current request is signed in as, as `requireAuth` read them.
 *
 * Lets deep helpers such as `orgUsers` skip re-reading the caller's own user
 * record, a full round trip to the database, when the request already holds
 * it. Anything that finds no scope, or a different user, reads as before.
 */
export interface RequestUser {
  userId: string;
  org?: string;
}

const scope = new AsyncLocalStorage<RequestUser>();

export function runAsRequestUser<T>(user: RequestUser, fn: () => T): T {
  return scope.run(user, fn);
}

/** The signed-in user of this request, when `userId` is them. */
export function requestUserFor(userId: string): RequestUser | undefined {
  const user = scope.getStore();
  return user && user.userId === userId ? user : undefined;
}
