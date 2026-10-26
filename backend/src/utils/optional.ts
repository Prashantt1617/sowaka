import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from './logger';

/**
 * The id of the request being served, for a log line written deep inside a
 * service that was never handed `req`. Set once per request, just before the
 * routes run (after the body is parsed, which would otherwise lose it).
 * Undefined outside a request: a scheduler, a script, a socket.
 */
const scope = new AsyncLocalStorage<{ requestId?: string }>();

export function runWithRequestId(requestId: string | undefined, next: () => void): void {
  scope.run({ requestId }, next);
}

export function currentRequestId(): string | undefined {
  return scope.getStore()?.requestId;
}

/**
 * One part of a response that the rest does not depend on — a count on a
 * dashboard, the faces under a card. Run beside the others; should it fail,
 * the response goes out with `fallback` in its place and the failure is
 * logged with the request's id, rather than taking every other part down too.
 *
 * Only for what the screen can do without. Anything the response is about
 * still fails the request with its own error.
 */
export async function optional<T>(
  part: string,
  work: () => Promise<T>,
  fallback: T,
  context: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    logger.error(`${part} failed; answered without it`, { requestId: currentRequestId(), part, ...context }, error);
    return fallback;
  }
}
