import type { Collection, Document, WithId } from 'mongodb';
import { users } from '../config/db';
import { User } from '../models/user.model';
import { requestUserFor } from './request-user';

/**
 * All users in the same organization as the given dashboard user — the scope of
 * "org-wide" for the HR dashboard. If the admin has no org set, falls back to
 * every user (single-tenant deployments).
 */
export async function orgUsers(
  adminUserId: string,
  /**
   * Only these fields of each person, for a caller that reads no more: whole
   * records carry older accounts' inline photos, and a company's worth of
   * those is megabytes. Every record whole when absent.
   */
  fields?: string[],
): Promise<User[]> {
  const filter = await orgFilterFor(adminUserId);
  if (!filter) return [];
  const projection = fields ? Object.fromEntries([['_id', 0], ...fields.map((field) => [field, 1])]) : undefined;
  return users().find(filter, projection ? { projection } : {}).toArray();
}

/** The filter `orgUsers` scopes by; null when the caller has no user record. */
async function orgFilterFor(adminUserId: string): Promise<{ org?: string } | null> {
  // The signed-in caller's org is already known from this request's auth
  // check; reading their record again would add a round trip to every list.
  const caller = requestUserFor(adminUserId);
  const admin = caller ?? (await users().findOne({ userId: adminUserId }, { projection: { _id: 0, org: 1 } }));
  if (!admin) return null;
  return admin.org ? { org: admin.org } : {};
}

/**
 * `orgUsers` together with everyone's rows in another collection, in one
 * round trip rather than two. The org-wide lists used to read the roster and
 * then the rows by `$in` over it, a full trip to the cluster each. Same
 * people, same rows: a row is in when its `foreignField` names someone in
 * the org.
 *
 * - `onlyWithRows` leaves out people who have no rows, for a list that only
 *   shows a person beside their own rows.
 * - `userFields` trims each person to the fields the caller reads; whole user
 *   records can carry inline profile photos.
 * - `alsoLookup` appends further `$lookup` stages over the same people; what
 *   they find stays on each employee under its `as`.
 *
 * Rows come back in no promised order: sort them with `sortLikeMongo`.
 */
export async function orgUsersWithRows<Row extends Document>(
  adminUserId: string,
  rows: Collection<Row>,
  options: {
    foreignField?: string;
    onlyWithRows?: boolean;
    userFields?: string[];
    alsoLookup?: Document[];
  } = {},
): Promise<{ employees: User[]; rows: WithId<Row>[] }> {
  const filter = await orgFilterFor(adminUserId);
  if (!filter) return { employees: [], rows: [] };
  const as = '__orgRows';
  const projection = options.userFields
    ? Object.fromEntries([['_id', 0], ...options.userFields.map((field) => [field, 1])])
    : null;
  const found = await users()
    .aggregate<Document>(
      [
        { $match: filter },
        ...(projection ? [{ $project: projection }] : []),
        { $lookup: { from: rows.collectionName, localField: 'userId', foreignField: options.foreignField ?? 'userId', as } },
        ...(options.alsoLookup ?? []),
        ...(options.onlyWithRows ? [{ $match: { [`${as}.0`]: { $exists: true } } }] : []),
      ],
      // Everyone in the first batch: the default of 101 documents sent a
      // larger org back to the cluster for the rest.
      { batchSize: 100_000 },
    )
    .toArray();
  const seen = new Set<string>();
  const out: WithId<Row>[] = [];
  const employees = found.map(({ [as]: own, ...employee }) => {
    // Two records sharing a userId would each have looked up the same rows.
    for (const row of own as WithId<Row>[]) {
      const key = String(row._id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return employee as User;
  });
  return { employees, rows: out };
}

/**
 * Sorts in memory as MongoDB's `.sort()` orders these keys: missing and null
 * lowest, then numbers, then strings, then Dates; strings by code unit. Ties
 * keep no promised order, as with the database.
 */
export function sortLikeMongo<T>(items: T[], keys: Array<[keyof T & string, 1 | -1]>): T[] {
  const rank = (value: unknown) =>
    value === undefined || value === null
      ? 0
      : typeof value === 'number'
        ? 1
        : typeof value === 'string'
          ? 2
          : value instanceof Date
            ? 4
            : 3;
  const comparable = (value: unknown) => (value instanceof Date ? value.getTime() : (value as number | string));
  return items.sort((a, b) => {
    for (const [key, direction] of keys) {
      const x: unknown = a[key];
      const y: unknown = b[key];
      const byRank = rank(x) - rank(y);
      if (byRank !== 0) return byRank * direction;
      if (rank(x) === 0 || rank(x) === 3) continue;
      const cx = comparable(x);
      const cy = comparable(y);
      if (cx < cy) return -direction;
      if (cx > cy) return direction;
    }
    return 0;
  });
}
