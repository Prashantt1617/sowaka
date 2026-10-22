import { users } from '../config/db';
import { User } from '../models/user.model';
import { requestUserFor } from './request-user';

/**
 * All users in the same organization as the given dashboard user — the scope of
 * "org-wide" for the HR dashboard. If the admin has no org set, falls back to
 * every user (single-tenant deployments).
 */
export async function orgUsers(adminUserId: string): Promise<User[]> {
  // The signed-in caller's org is already known from this request's auth
  // check; reading their record again would add a round trip to every list.
  const caller = requestUserFor(adminUserId);
  const admin = caller ?? (await users().findOne({ userId: adminUserId }, { projection: { _id: 0, org: 1 } }));
  if (!admin) return [];
  const filter = admin.org ? { org: admin.org } : {};
  return users().find(filter).toArray();
}
