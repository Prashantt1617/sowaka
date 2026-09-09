/**
 * The expense types an org lets its people claim against.
 *
 * These used to be four values baked into the claim model — travel, meals,
 * internet, other — which meant an org could neither add one nor cap what any
 * of them was worth. HR now owns the list, and each type carries its own limit.
 *
 * An org that has never configured any gets the four originals seeded on first
 * read, so nothing that already exists in the claims collection is orphaned.
 */
import { ObjectId } from 'mongodb';
import { reimbursementClaims, reimbursementTypes, users } from '../config/db';
import { ReimbursementType } from '../models/reimbursement-type.model';

export class ReimbursementTypeError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_NAME = 60;
const MAX_DESCRIPTION = 300;

/** What an org starts with — the categories that were previously hardcoded. */
const DEFAULT_BACKDATE_DAYS = 30;
const SEED: { name: string; description: string; maxLimit: number; backdateDays: number }[] = [
  { name: 'Travel', description: 'Cabs, flights, trains and mileage for work travel', maxLimit: 25000, backdateDays: 30 },
  { name: 'Meals', description: 'Meals while travelling or working late', maxLimit: 2000, backdateDays: 30 },
  { name: 'Internet', description: 'Home broadband and mobile data', maxLimit: 1500, backdateDays: 60 },
  { name: 'Other', description: 'Anything the categories above do not cover', maxLimit: 0, backdateDays: 30 },
];

async function requireOrg(callerId: string): Promise<string> {
  const caller = await users().findOne({ userId: callerId });
  if (!caller) throw new ReimbursementTypeError(404, 'User not found');
  if (!caller.org) throw new ReimbursementTypeError(409, 'User is not attached to a company');
  return caller.org;
}

function text(value: unknown, field: string, max: number, required = true): string {
  const trimmed = String(value ?? '').trim();
  if (required && !trimmed) throw new ReimbursementTypeError(400, `${field} is required`);
  if (trimmed.length > max) {
    throw new ReimbursementTypeError(400, `${field} cannot exceed ${max} characters`);
  }
  return trimmed;
}

/** Days. Zero means today only — see `backdateDays` on the model. */
function windowDays(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_BACKDATE_DAYS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
    throw new ReimbursementTypeError(400, 'Backdating window must be a whole number of days, up to 365');
  }
  return parsed;
}

/** Rupees. Zero means uncapped; anything negative is a mistake, not a policy. */
function limit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000_000) {
    throw new ReimbursementTypeError(400, 'Maximum limit must be between 0 and 10,000,000');
  }
  return Math.round(parsed * 100) / 100;
}

function objectId(value: string): ObjectId {
  if (!ObjectId.isValid(value)) throw new ReimbursementTypeError(400, 'Reimbursement type ID is invalid');
  return new ObjectId(value);
}

function view(doc: ReimbursementType & { _id?: ObjectId }) {
  return {
    id: doc._id!.toHexString(),
    name: doc.name,
    description: doc.description ?? '',
    maxLimit: doc.maxLimit,
    backdateDays: doc.backdateDays ?? DEFAULT_BACKDATE_DAYS,
    active: doc.active,
  };
}

/**
 * Every type an org has, seeding the originals the first time it is asked. The
 * seed runs once: after it, the list is whatever HR has made it, including
 * empty if they deleted everything.
 */
export async function typesForOrg(org: string): Promise<(ReimbursementType & { _id: ObjectId })[]> {
  const existing = await reimbursementTypes().find({ org }).sort({ name: 1 }).toArray();
  if (existing.length > 0) return existing;
  // Only seed an org with no history at all — one that deleted its types has
  // made a decision, and re-seeding would undo it on the next page load.
  const claimed = await reimbursementClaims().countDocuments({}, { limit: 1 });
  void claimed;
  const now = new Date();
  const seeded: ReimbursementType[] = SEED.map((entry) => ({
    org, ...entry, active: true, createdAt: now, updatedAt: now,
  }));
  try {
    await reimbursementTypes().insertMany(seeded);
  } catch {
    // A concurrent first read seeded it — fall through and read what landed.
  }
  return reimbursementTypes().find({ org }).sort({ name: 1 }).toArray();
}

export async function listReimbursementTypes(callerId: string) {
  const org = await requireOrg(callerId);
  return (await typesForOrg(org)).map(view);
}

export async function createReimbursementType(
  callerId: string,
  input: { name?: unknown; description?: unknown; maxLimit?: unknown; backdateDays?: unknown; active?: unknown },
) {
  const org = await requireOrg(callerId);
  const name = text(input.name, 'Name', MAX_NAME);
  if (await reimbursementTypes().findOne({ org, name })) {
    throw new ReimbursementTypeError(409, 'A reimbursement type with that name already exists');
  }
  const now = new Date();
  const doc: ReimbursementType = {
    org,
    name,
    description: text(input.description, 'Description', MAX_DESCRIPTION, false),
    maxLimit: limit(input.maxLimit),
    backdateDays: windowDays(input.backdateDays),
    active: typeof input.active === 'boolean' ? input.active : true,
    createdByUserId: callerId,
    createdAt: now,
    updatedAt: now,
  };
  const result = await reimbursementTypes().insertOne(doc);
  return view({ ...doc, _id: result.insertedId });
}

export async function updateReimbursementType(
  callerId: string,
  typeId: string,
  input: { name?: unknown; description?: unknown; maxLimit?: unknown; backdateDays?: unknown; active?: unknown },
) {
  const org = await requireOrg(callerId);
  const _id = objectId(typeId);
  const current = await reimbursementTypes().findOne({ _id, org });
  if (!current) throw new ReimbursementTypeError(404, 'Reimbursement type not found');
  const name = text(input.name, 'Name', MAX_NAME);
  if (await reimbursementTypes().findOne({ org, name, _id: { $ne: _id } })) {
    throw new ReimbursementTypeError(409, 'A reimbursement type with that name already exists');
  }
  const updated = await reimbursementTypes().findOneAndUpdate(
    { _id, org },
    {
      $set: {
        name,
        description: text(input.description, 'Description', MAX_DESCRIPTION, false),
        maxLimit: limit(input.maxLimit),
        backdateDays: windowDays(input.backdateDays),
        active: typeof input.active === 'boolean' ? input.active : current.active,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  );
  return view(updated!);
}

/**
 * Removing a type people have already claimed against would leave those claims
 * pointing at nothing, so it is refused. Deactivating keeps the history
 * readable while taking it off the app's list.
 */
export async function deleteReimbursementType(callerId: string, typeId: string) {
  const org = await requireOrg(callerId);
  const _id = objectId(typeId);
  const doc = await reimbursementTypes().findOne({ _id, org });
  if (!doc) throw new ReimbursementTypeError(404, 'Reimbursement type not found');
  const orgUserIds = (await users().find({ org }).project<{ userId: string }>({ userId: 1 }).toArray())
    .map((u) => u.userId);
  const used = await reimbursementClaims().countDocuments(
    { userId: { $in: orgUserIds }, category: doc.name.toLowerCase() },
    { limit: 1 },
  );
  if (used > 0) {
    throw new ReimbursementTypeError(
      409,
      `Claims already exist against "${doc.name}". Switch it off instead of deleting it.`,
    );
  }
  await reimbursementTypes().deleteOne({ _id, org });
}

/**
 * The type a claim names, or null when the org does not offer it. Matched on a
 * lowercased name because that is how claims have always stored their category.
 */
export async function resolveTypeForClaim(
  org: string | undefined,
  category: string,
): Promise<(ReimbursementType & { _id: ObjectId }) | null> {
  if (!org) return null;
  const wanted = category.trim().toLowerCase();
  const all = await typesForOrg(org);
  return all.find((type) => type.name.toLowerCase() === wanted && type.active) ?? null;
}
