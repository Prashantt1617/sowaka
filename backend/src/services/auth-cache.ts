import type { User } from '../models/user.model';
import type { AuthSessionDocument } from '../models/auth.model';

/**
 * Signed-in requests, remembered for a few seconds. Every signed-in request
 * starts by looking up its session and user, and the cluster is a ~200 ms
 * round trip from the server: when a push brings the whole company into the
 * app at once, those lookups alone kept most of the connection pool busy.
 * An app screen makes several requests in a row with the same token, so
 * holding the answer briefly saves a round trip on nearly all of them.
 *
 * Kept short so a change to the person (their tabs, their access) shows
 * within seconds. Sign-out and offboarding forget the entry at once.
 */
export type CachedAuth = {
  session: AuthSessionDocument;
  user: Omit<User, 'profilePhotoUrl'>;
  at: number;
};

const TTL_MS = 10_000;
const MAX_ENTRIES = 20_000;
const byTokenHash = new Map<string, CachedAuth>();

export function cachedAuth(tokenHash: string): CachedAuth | null {
  const kept = byTokenHash.get(tokenHash);
  if (!kept) return null;
  if (Date.now() - kept.at > TTL_MS || kept.session.expiresAt.getTime() <= Date.now()) {
    byTokenHash.delete(tokenHash);
    return null;
  }
  return kept;
}

export function rememberAuth(tokenHash: string, session: AuthSessionDocument, user: Omit<User, 'profilePhotoUrl'>): void {
  if (byTokenHash.size >= MAX_ENTRIES) byTokenHash.clear();
  byTokenHash.set(tokenHash, { session, user, at: Date.now() });
}

export function forgetAuthToken(tokenHash: string): void {
  byTokenHash.delete(tokenHash);
}

/** Every remembered session of one person (offboarding ends them all). */
export function forgetAuthUser(userId: string): void {
  for (const [key, kept] of byTokenHash) if (kept.session.userId === userId) byTokenHash.delete(key);
}
