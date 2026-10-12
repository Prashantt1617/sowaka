/**
 * Who may see a Connect post, and the rules for custom audience lists.
 *
 * Pure — no database — so the check script can prove the rules directly
 * (`npx tsx src/scripts/audience-lists-check.ts`). Every place that decides
 * who sees a post asks one of these: the feed query (`feedAudienceFilter`),
 * a single read and everything done to a post (`audienceAllows`), the
 * notifications (`audienceAllows` again, per recipient), and what the post
 * says about its own audience (`audienceView`).
 */
import {
  AUDIENCE_LIST_MEMBERS_MAX,
  AUDIENCE_LIST_NAME_MAX,
} from '../models/audience-list.model';
import type { ConnectAudience } from '../models/connect.model';

/** The label a list post wears for anyone but its author. */
export const PRIVATE_AUDIENCE_LABEL = 'Private';

/** The people a visibility check needs to know about the viewer. */
export interface AudienceViewer {
  userId: string;
  managerUserId?: string | null;
  department?: string | null;
}

/**
 * Every reporting group the viewer is part of: the one they lead and the one
 * they belong to. A Team post is visible when it targets either.
 */
export function visibleTeamIds(viewer: AudienceViewer): string[] {
  return [viewer.userId, viewer.managerUserId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
}

/**
 * Whether this audience is a custom list. Either marker counts, so a post
 * that somehow carried one without the other still fails closed — it is
 * read as a list post and shown only to the people it names.
 */
export function isListAudience(audience: Pick<ConnectAudience, 'listId' | 'userIds'> | undefined): boolean {
  if (!audience) return false;
  return (typeof audience.listId === 'string' && audience.listId.length > 0) || Array.isArray(audience.userIds);
}

/**
 * Whether [viewer] may see a post with this audience. The single rule every
 * read, write and notification about a post goes through.
 *
 * - A list post: only the people snapshotted onto it (the author included).
 * - A Team post: the reporting group it was sent to.
 * - A legacy department post: that department.
 * - Otherwise: the whole company (the org itself is checked by the caller,
 *   which only ever loads posts of the viewer's own company).
 */
export function audienceAllows(
  audience: ConnectAudience | undefined,
  viewer: AudienceViewer,
): boolean {
  if (!audience) return true;
  if (isListAudience(audience)) {
    return Array.isArray(audience.userIds) && audience.userIds.includes(viewer.userId);
  }
  if (audience.teamId) return visibleTeamIds(viewer).includes(audience.teamId);
  if (audience.department) return audience.department === viewer.department;
  return true;
}

/**
 * The feed's audience clause, the same rule as `audienceAllows` written as a
 * query. Every non-list branch also requires the post to carry no list
 * marker, so a list post can only ever be reached through its own branch.
 *
 * MongoDB's driver writes an `undefined` field as null, so `null` here
 * matches both a missing field and a stored null.
 */
export function feedAudienceFilter(viewer: AudienceViewer): Record<string, unknown> {
  const notAList = { 'audience.listId': null, 'audience.userIds': null };
  return {
    $or: [
      { ...notAList, 'audience.teamId': null, 'audience.department': null },
      { ...notAList, 'audience.teamId': { $in: visibleTeamIds(viewer) } },
      // Posts written while Team meant "same department". Only for a viewer
      // who has one: matching a missing department against null would show
      // them every Team post in the company.
      ...(viewer.department
        ? [{ ...notAList, 'audience.teamId': null, 'audience.department': viewer.department }]
        : []),
      { 'audience.userIds': viewer.userId },
    ],
  };
}

/**
 * What the post tells this viewer about its own audience. The author sees
 * the list's name; everyone else sees "Private" and nothing more — not the
 * list, not its name, not who else is on it.
 */
export function audienceView(
  audience: ConnectAudience,
  viewerUserId: string,
  authorUserId: string | undefined,
): ConnectAudience {
  if (!isListAudience(audience)) {
    // Never the list markers, even as nulls the driver wrote.
    const rest = { ...audience };
    delete rest.listId;
    delete rest.listName;
    delete rest.userIds;
    return rest;
  }
  const isAuthor = Boolean(authorUserId) && authorUserId === viewerUserId;
  if (isAuthor) {
    return {
      label: audience.listName || PRIVATE_AUDIENCE_LABEL,
      org: audience.org,
      listId: audience.listId,
      listName: audience.listName,
    };
  }
  return { label: PRIVATE_AUDIENCE_LABEL, org: audience.org };
}

/**
 * Where a change to a post is announced: a list post only to the people who
 * can see it, each on their own channel; anything else to its room.
 */
export function realtimeUserIds(audience: ConnectAudience): string[] | null {
  if (!isListAudience(audience)) return null;
  return Array.isArray(audience.userIds) ? [...new Set(audience.userIds)] : [];
}

/**
 * The audience a list post is published with. The author is always in it,
 * whatever the list says; the members are copied, so the post keeps them
 * whatever happens to the list afterwards.
 */
export function listAudience(
  list: { id: string; name: string },
  org: string,
  authorUserId: string,
  memberUserIds: readonly string[],
): ConnectAudience {
  return {
    label: PRIVATE_AUDIENCE_LABEL,
    org,
    listId: list.id,
    listName: list.name,
    userIds: [...new Set([authorUserId, ...memberUserIds])],
  };
}

/**
 * The tags a post may keep: on a list post, only people who can see it.
 * Anyone else is dropped rather than refused — they are never named on the
 * post, never stored and never notified.
 */
export function taggableWithin(audience: ConnectAudience, userIds: readonly string[]): string[] {
  if (!isListAudience(audience)) return [...userIds];
  const allowed = new Set(audience.userIds ?? []);
  return userIds.filter((id) => allowed.has(id));
}

// ---------------------------------------------------------------- lists

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** "3D  Crew " and "3d crew" are the same name to one owner. */
export function listNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A list's name: trimmed, inner runs of spaces collapsed, 1–40 characters. */
export function checkListName(value: unknown): Checked<{ name: string; nameKey: string }> {
  if (typeof value !== 'string') return { ok: false, message: 'Give the list a name' };
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0) return { ok: false, message: 'Give the list a name' };
  if ([...name].length > AUDIENCE_LIST_NAME_MAX) {
    return { ok: false, message: `A list name can be up to ${AUDIENCE_LIST_NAME_MAX} characters` };
  }
  return { ok: true, value: { name, nameKey: listNameKey(name) } };
}

/**
 * The members as sent: strings only, each once, never the owner (who sees
 * their own posts anyway), 1–500 people. Whether each one is a colleague is
 * the service's to check against the directory.
 */
export function checkMemberIds(value: unknown, ownerUserId: string): Checked<string[]> {
  if (!Array.isArray(value)) return { ok: false, message: 'Pick the people for this list' };
  const ids = [
    ...new Set(
      value
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && id.length <= 80 && id !== ownerUserId),
    ),
  ];
  if (ids.length === 0) return { ok: false, message: 'Pick at least one person' };
  if (ids.length > AUDIENCE_LIST_MEMBERS_MAX) {
    return { ok: false, message: `A list can have up to ${AUDIENCE_LIST_MEMBERS_MAX} people` };
  }
  return { ok: true, value: ids };
}

/**
 * The people of one company who may be on a list or in the directory: active
 * colleagues, never counsellors (a pool shared across companies). An older
 * account without an org is placed by its email domain, as the tag picker
 * does.
 */
export function colleagueFilter(org: string): Record<string, unknown> {
  return {
    lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
    isCounsellor: { $ne: true },
    $or: [{ org }, { org: { $exists: false }, email: { $regex: `@${escapeRegex(org)}$` } }],
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
