import { randomUUID } from 'node:crypto';
import { MongoServerError } from 'mongodb';
import { audienceLists, users } from '../config/db';
import { AUDIENCE_LISTS_PER_OWNER_MAX, AudienceList } from '../models/audience-list.model';
import { User } from '../models/user.model';
import { checkListName, checkMemberIds, colleagueFilter } from './audience-list-rules';
import { ConnectError, orgForUser } from './connect.service';
import { resolveProfilePhoto } from './s3-connect-media.service';

/**
 * Custom audience lists: saved shortcuts of people, one owner each, that a
 * Connect post can be sent to. Only the owner ever reads or changes one, and
 * every query is scoped to them and their company, so another person's list
 * is a 404 — not even confirmed to exist.
 */

/** The most people the picker's directory returns. */
export const AUDIENCE_PEOPLE_MAX = 5000;

export interface AudienceListView {
  id: string;
  name: string;
  /** Members still at the company; anyone who has since left is not counted. */
  memberUserIds: string[];
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

async function requireViewer(viewerUserId: string): Promise<User & { org: string }> {
  const viewer = await users().findOne(
    { userId: viewerUserId },
    { projection: { _id: 0, userId: 1, org: 1, email: 1, lifecycleStatus: 1 } },
  );
  if (!viewer) throw new ConnectError(404, 'User not found');
  return { ...(viewer as User), org: orgForUser(viewer) };
}

/** Which of these people are active colleagues in [org]. */
async function activeColleagueIds(org: string, userIds: readonly string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await users()
    .find({ userId: { $in: [...userIds] }, ...colleagueFilter(org) }, { projection: { _id: 0, userId: 1 } })
    .toArray();
  return new Set(rows.map((row) => row.userId));
}

function view(list: AudienceList, active: Set<string>): AudienceListView {
  const memberUserIds = list.memberUserIds.filter((id) => active.has(id));
  return {
    id: list.id,
    name: list.name,
    memberUserIds,
    memberCount: memberUserIds.length,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}

/** Refuses anyone who is not an active colleague, rather than quietly dropping them. */
async function requireColleagues(org: string, userIds: string[]): Promise<Set<string>> {
  const active = await activeColleagueIds(org, userIds);
  if (active.size !== userIds.length) {
    throw new ConnectError(400, "Some of these people can't be added to a list");
  }
  return active;
}

function isDuplicateKey(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

const duplicateName = (name: string) => new ConnectError(409, `You already have a list called “${name}”`);

/** The viewer's lists, A to Z, each with the members still at the company. */
export async function listAudienceLists(viewerUserId: string): Promise<AudienceListView[]> {
  const viewer = await requireViewer(viewerUserId);
  const lists = await audienceLists()
    .find({ ownerUserId: viewer.userId, org: viewer.org })
    .sort({ nameKey: 1 })
    .toArray();
  const active = await activeColleagueIds(viewer.org, [...new Set(lists.flatMap((list) => list.memberUserIds))]);
  return lists.map((list) => view(list, active));
}

export async function createAudienceList(
  viewerUserId: string,
  input: { name?: unknown; memberUserIds?: unknown },
): Promise<AudienceListView> {
  const viewer = await requireViewer(viewerUserId);
  const name = checkListName(input.name);
  if (!name.ok) throw new ConnectError(400, name.message);
  const members = checkMemberIds(input.memberUserIds, viewer.userId);
  if (!members.ok) throw new ConnectError(400, members.message);
  const [active, owned, clash] = await Promise.all([
    requireColleagues(viewer.org, members.value),
    audienceLists().countDocuments({ ownerUserId: viewer.userId }),
    audienceLists().findOne({ ownerUserId: viewer.userId, nameKey: name.value.nameKey }, { projection: { _id: 0, id: 1 } }),
  ]);
  if (clash) throw duplicateName(name.value.name);
  if (owned >= AUDIENCE_LISTS_PER_OWNER_MAX) {
    throw new ConnectError(409, `You can keep up to ${AUDIENCE_LISTS_PER_OWNER_MAX} lists. Delete one to make another.`);
  }
  const now = new Date();
  const list: AudienceList = {
    id: randomUUID(),
    org: viewer.org,
    ownerUserId: viewer.userId,
    name: name.value.name,
    nameKey: name.value.nameKey,
    memberUserIds: members.value,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await audienceLists().insertOne({ ...list });
  } catch (error) {
    // Two creates racing with one name: the index settles it.
    if (isDuplicateKey(error)) throw duplicateName(list.name);
    throw error;
  }
  return view(list, active);
}

/** Renames a list, replaces its members, or both. Posts already sent to it keep theirs. */
export async function updateAudienceList(
  viewerUserId: string,
  listId: string,
  input: { name?: unknown; memberUserIds?: unknown },
): Promise<AudienceListView> {
  const viewer = await requireViewer(viewerUserId);
  const list = await audienceLists().findOne({ id: listId, ownerUserId: viewer.userId, org: viewer.org });
  if (!list) throw new ConnectError(404, 'List not found');
  const changes: Partial<AudienceList> = {};
  if (input.name !== undefined) {
    const name = checkListName(input.name);
    if (!name.ok) throw new ConnectError(400, name.message);
    if (name.value.nameKey !== list.nameKey) {
      const clash = await audienceLists().findOne(
        { ownerUserId: viewer.userId, nameKey: name.value.nameKey, id: { $ne: list.id } },
        { projection: { _id: 0, id: 1 } },
      );
      if (clash) throw duplicateName(name.value.name);
    }
    changes.name = name.value.name;
    changes.nameKey = name.value.nameKey;
  }
  if (input.memberUserIds !== undefined) {
    const members = checkMemberIds(input.memberUserIds, viewer.userId);
    if (!members.ok) throw new ConnectError(400, members.message);
    await requireColleagues(viewer.org, members.value);
    changes.memberUserIds = members.value;
  }
  if (Object.keys(changes).length === 0) throw new ConnectError(400, 'Nothing to change');
  changes.updatedAt = new Date();
  try {
    await audienceLists().updateOne({ id: list.id, ownerUserId: viewer.userId }, { $set: changes });
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicateName(changes.name ?? list.name);
    throw error;
  }
  const saved = { ...list, ...changes };
  return view(saved, await activeColleagueIds(viewer.org, saved.memberUserIds));
}

export async function deleteAudienceList(viewerUserId: string, listId: string): Promise<{ id: string }> {
  const viewer = await requireViewer(viewerUserId);
  const result = await audienceLists().deleteOne({ id: listId, ownerUserId: viewer.userId, org: viewer.org });
  if (result.deletedCount === 0) throw new ConnectError(404, 'List not found');
  return { id: listId };
}

/**
 * The whole company for the list picker, A to Z, bar the viewer: active
 * colleagues only, with what the picker shows and searches — name, photo,
 * designation, department and city. Photos come as links only, as the tag
 * picker's do: an older account's photo kept inline would make a
 * company-sized answer megabytes long.
 */
export async function listAudiencePeople(viewerUserId: string) {
  const viewer = await requireViewer(viewerUserId);
  const rows = await users()
    .find(
      { userId: { $ne: viewer.userId }, ...colleagueFilter(viewer.org) },
      {
        projection: {
          _id: 0, userId: 1, name: 1, designation: 1, department: 1, role: 1,
          location: 1, branch: 1, profilePhotoKey: 1,
        },
      },
    )
    .limit(AUDIENCE_PEOPLE_MAX)
    .toArray();
  const links = new Map(
    (
      await users()
        .find(
          { userId: { $in: rows.map((row) => row.userId) }, profilePhotoUrl: { $regex: '^http' } },
          { projection: { _id: 0, userId: 1, profilePhotoUrl: 1 } },
        )
        .toArray()
    ).map((row) => [row.userId, row.profilePhotoUrl]),
  );
  const people = await Promise.all(
    rows.map(async (row) => ({
      userId: row.userId,
      name: row.name,
      designation: row.designation ?? '',
      department: row.department ?? '',
      city: (row.location ?? row.branch ?? '').trim(),
      photoUrl: await resolveProfilePhoto({ profilePhotoKey: row.profilePhotoKey, profilePhotoUrl: links.get(row.userId) }),
    })),
  );
  // By name as a person reads it, not by code point: "aarav" before "Zoya".
  return people.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
