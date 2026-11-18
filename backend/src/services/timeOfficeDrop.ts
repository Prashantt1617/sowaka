import { users } from '../config/db';
import { forgetTimeOfficeListReads } from './lifecycle/readCache';

/**
 * Drop the kept Time office lists of this person's company (timeOfficeLists.ts). For writes that
 * don't come through a dropping route (lifecycle/readCache.ts): a punch outside the office opens a
 * correction request, and a later punch-out completes it. Called without waiting on it.
 */
export async function forgetCorrectionsListOf(userId: string): Promise<void> {
  try {
    const org = (await users().findOne({ userId }, { projection: { _id: 0, org: 1 } }))?.org;
    if (org) forgetTimeOfficeListReads(org);
  } catch { /* the copy's own minute catches it */ }
}
