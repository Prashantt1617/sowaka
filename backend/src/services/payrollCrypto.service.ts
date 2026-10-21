/**
 * The server's side of payroll end-to-end encryption: it stores and hands
 * out public keys, keys wrapped under secrets it never sees, and sealed
 * records. It cannot open any of them. Every call needs payroll access.
 */
import { payrollCrypto, payrollRuns, payslips, salaryStructures, users } from '../config/db';
import { PayrollCryptoGrant, PayrollCryptoOrg, PayrollCryptoUserKey } from '../models/payrollCrypto.model';
import type { Sealed, SealedForPerson, UserKeyRecord } from '../shared/payroll/crypto';
import { hasPayrollAccess } from './payrollAccess.service';

export class PayrollCryptoError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'PayrollCryptoError';
  }
}

async function payrollUser(userId: string) {
  const user = await users().findOne({ userId }, { projection: { _id: 0, userId: 1, org: 1, name: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1 } });
  if (!user?.org) throw new PayrollCryptoError(403, 'No organisation on this account');
  if (!hasPayrollAccess(user)) throw new PayrollCryptoError(403, 'Salary encryption needs payroll access');
  return { userId: user.userId, org: user.org, name: user.name };
}

export async function orgCryptoState(org: string): Promise<PayrollCryptoOrg | null> {
  return (await payrollCrypto().findOne({ kind: 'org', org })) as PayrollCryptoOrg | null;
}

/** True when the org's salaries live sealed: the plaintext payroll endpoints refuse amounts. */
export async function isEncryptedOrg(org: string): Promise<boolean> {
  return (await orgCryptoState(org))?.mode === 'encrypted';
}

const isSealed = (v: unknown): v is Sealed =>
  !!v && typeof v === 'object' && (v as Sealed).v === 1 && typeof (v as Sealed).iv === 'string' && typeof (v as Sealed).ct === 'string' && Number.isInteger((v as Sealed).keyVersion);
const isSealedForPerson = (v: unknown): v is SealedForPerson =>
  !!v && typeof v === 'object' && (v as SealedForPerson).v === 1 && typeof (v as SealedForPerson).wrappedKey === 'string';
const MAX_BLOB = 200_000;
function requireSealed(v: unknown, what: string, keyVersion: number): Sealed {
  if (!isSealed(v) || v.ct.length > MAX_BLOB) throw new PayrollCryptoError(400, `${what} must be a sealed blob`);
  if (v.keyVersion !== keyVersion) throw new PayrollCryptoError(409, `${what} is sealed with key version ${v.keyVersion}; the org is on ${keyVersion}`);
  return { v: 1, keyVersion: v.keyVersion, iv: v.iv, ct: v.ct };
}

/** Everything the dashboard needs to unlock, set up, grant or rotate. */
export async function cryptoStatus(viewerUserId: string) {
  const me = await payrollUser(viewerUserId);
  const state = await orgCryptoState(me.org);
  const docs = await payrollCrypto().find({ org: me.org, kind: { $in: ['user_key', 'grant'] } }).toArray();
  const keys = new Map(docs.filter((d): d is PayrollCryptoUserKey & { _id: never } => d.kind === 'user_key').map((d) => [d.userId, d]));
  const grants = docs.filter((d): d is PayrollCryptoGrant & { _id: never } => d.kind === 'grant' && d.keyVersion === (state?.keyVersion ?? 0));
  const granted = new Set(grants.map((g) => g.userId));
  const people = await users().find({ org: me.org, dashboardAccess: true }, { projection: { _id: 0, userId: 1, name: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1, lifecycleStatus: 1 } }).toArray();
  const members = people
    .filter((p) => hasPayrollAccess(p) && p.lifecycleStatus !== 'offboarded' && p.lifecycleStatus !== 'terminated')
    .map((p) => ({ userId: p.userId, name: p.name, hasKey: keys.has(p.userId), publicKey: keys.get(p.userId)?.publicKey, granted: granted.has(p.userId) }));
  const myKey = keys.get(me.userId);
  const myGrant = grants.find((g) => g.userId === me.userId);
  return {
    mode: state?.mode ?? 'plaintext',
    keyVersion: state?.keyVersion ?? 0,
    rotationRequired: state?.rotationRequired === true,
    recovery: state ? state.recovery : null,
    me: {
      userId: me.userId,
      key: myKey ? { publicKey: myKey.publicKey, wrappedPrivateKey: myKey.wrappedPrivateKey, salt: myKey.salt, iv: myKey.iv, iterations: myKey.iterations } : null,
      wrappedDataKey: myGrant?.wrappedDataKey ?? null,
    },
    members,
  };
}

function requireKeyRecord(raw: unknown): UserKeyRecord {
  const r = (raw ?? {}) as Record<string, unknown>;
  for (const f of ['publicKey', 'wrappedPrivateKey', 'salt', 'iv']) {
    if (typeof r[f] !== 'string' || !(r[f] as string).length || (r[f] as string).length > 10_000) throw new PayrollCryptoError(400, `key.${f} is required`);
  }
  const iterations = Number(r.iterations);
  if (!Number.isInteger(iterations) || iterations < 100_000) throw new PayrollCryptoError(400, 'key.iterations must be at least 100000');
  return { publicKey: r.publicKey as string, wrappedPrivateKey: r.wrappedPrivateKey as string, salt: r.salt as string, iv: r.iv as string, iterations };
}

/**
 * Register (or replace) my keypair. Replacing it drops my grant: someone
 * holding the data key has to grant me again (or I recover with the
 * recovery key).
 */
export async function registerMyKey(viewerUserId: string, raw: unknown) {
  const me = await payrollUser(viewerUserId);
  const key = requireKeyRecord(raw);
  await payrollCrypto().updateOne(
    { kind: 'user_key', org: me.org, userId: me.userId },
    { $set: { kind: 'user_key', org: me.org, userId: me.userId, ...key, createdAt: new Date() } },
    { upsert: true },
  );
  await payrollCrypto().deleteMany({ kind: 'grant', org: me.org, userId: me.userId });
  return cryptoStatus(viewerUserId);
}

/** Turn encryption on for the org: my grant and the recovery wrap of a fresh data key. */
export async function setupOrgCrypto(viewerUserId: string, input: { wrappedDataKey?: unknown; recovery?: unknown }) {
  const me = await payrollUser(viewerUserId);
  if (await orgCryptoState(me.org)) throw new PayrollCryptoError(409, 'Salary encryption is already set up for this organisation');
  const key = await payrollCrypto().findOne({ kind: 'user_key', org: me.org, userId: me.userId });
  if (!key) throw new PayrollCryptoError(409, 'Create your key first');
  const rec = (input.recovery ?? {}) as Record<string, unknown>;
  if (typeof input.wrappedDataKey !== 'string' || typeof rec.wrapped !== 'string' || typeof rec.iv !== 'string') {
    throw new PayrollCryptoError(400, 'wrappedDataKey and recovery { wrapped, iv } are required');
  }
  const now = new Date();
  await payrollCrypto().insertOne({
    kind: 'org', org: me.org, mode: 'encrypted', keyVersion: 1,
    recovery: { wrapped: rec.wrapped, iv: rec.iv, keyVersion: 1 },
    createdByUserId: me.userId, createdAt: now, updatedAt: now,
  });
  await payrollCrypto().insertOne({ kind: 'grant', org: me.org, userId: me.userId, keyVersion: 1, wrappedDataKey: input.wrappedDataKey, grantedByUserId: me.userId, createdAt: now });
  return cryptoStatus(viewerUserId);
}

/** A key holder grants the current data key to other payroll users (wrapped to their public keys in the browser). */
export async function grantDataKey(viewerUserId: string, grants: unknown) {
  const me = await payrollUser(viewerUserId);
  const state = await orgCryptoState(me.org);
  if (!state) throw new PayrollCryptoError(409, 'Salary encryption is not set up');
  const mine = await payrollCrypto().findOne({ kind: 'grant', org: me.org, userId: me.userId, keyVersion: state.keyVersion });
  if (!mine) throw new PayrollCryptoError(403, 'You do not hold the current data key');
  if (!Array.isArray(grants)) throw new PayrollCryptoError(400, 'grants must be a list');
  const status = await cryptoStatus(viewerUserId);
  const allowed = new Map(status.members.filter((m) => m.hasKey).map((m) => [m.userId, m]));
  for (const g of grants as Record<string, unknown>[]) {
    const userId = String(g?.userId ?? '');
    if (!allowed.has(userId)) throw new PayrollCryptoError(400, `${userId} has no payroll access or no key yet`);
    if (typeof g.wrappedDataKey !== 'string') throw new PayrollCryptoError(400, 'wrappedDataKey is required');
    await payrollCrypto().updateOne(
      { kind: 'grant', org: me.org, userId, keyVersion: state.keyVersion },
      { $set: { kind: 'grant', org: me.org, userId, keyVersion: state.keyVersion, wrappedDataKey: g.wrappedDataKey, grantedByUserId: me.userId, createdAt: new Date() } },
      { upsert: true },
    );
  }
  return cryptoStatus(viewerUserId);
}

/**
 * Called when someone's dashboard access changes: if they no longer have
 * payroll access, their grant goes and the org must rotate (they may still
 * hold the old data key in a browser).
 */
export async function onPayrollAccessChanged(org: string, userId: string): Promise<void> {
  const state = await orgCryptoState(org);
  if (!state) return;
  const user = await users().findOne({ userId }, { projection: { _id: 0, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1 } });
  if (hasPayrollAccess(user)) return;
  const removed = await payrollCrypto().deleteMany({ kind: 'grant', org, userId });
  if (removed.deletedCount > 0) {
    await payrollCrypto().updateOne({ kind: 'org', org }, { $set: { rotationRequired: true, updatedAt: new Date() } });
  }
}

/**
 * Data-key rotation, done by a key holder in the browser: everything re-sealed
 * with a new key, the new key granted to everyone still allowed, a new
 * recovery wrap. Applied record by record; the version check refuses a mix.
 */
export async function rotateDataKey(viewerUserId: string, input: Record<string, unknown>) {
  const me = await payrollUser(viewerUserId);
  const state = await orgCryptoState(me.org);
  if (!state) throw new PayrollCryptoError(409, 'Salary encryption is not set up');
  const next = state.keyVersion + 1;
  if (Number(input.keyVersion) !== next) throw new PayrollCryptoError(409, `Rotate to key version ${next}`);
  const mine = await payrollCrypto().findOne({ kind: 'grant', org: me.org, userId: me.userId, keyVersion: state.keyVersion });
  if (!mine) throw new PayrollCryptoError(403, 'You do not hold the current data key');
  const rec = (input.recovery ?? {}) as Record<string, unknown>;
  if (typeof rec.wrapped !== 'string' || typeof rec.iv !== 'string') throw new PayrollCryptoError(400, 'recovery { wrapped, iv } is required');
  const grants = Array.isArray(input.grants) ? (input.grants as Record<string, unknown>[]) : [];
  if (!grants.some((g) => g.userId === me.userId)) throw new PayrollCryptoError(400, 'Include a grant for yourself');
  const status = await cryptoStatus(viewerUserId);
  const allowed = new Set(status.members.filter((m) => m.hasKey).map((m) => m.userId));
  for (const g of grants) if (!allowed.has(String(g.userId)) || typeof g.wrappedDataKey !== 'string') throw new PayrollCryptoError(400, `Grant for ${String(g.userId)} is not allowed`);

  // Every sealed record must come back re-sealed: count before writing anything.
  const structures = Array.isArray(input.structures) ? (input.structures as Record<string, unknown>[]) : [];
  const slips = Array.isArray(input.payslips) ? (input.payslips as Record<string, unknown>[]) : [];
  const runs = Array.isArray(input.runs) ? (input.runs as Record<string, unknown>[]) : [];
  const [nStructures, nSlips, nRuns] = await Promise.all([
    salaryStructures().countDocuments({ org: me.org, sealed: { $exists: true } }),
    payslips().countDocuments({ org: me.org, sealed: { $exists: true } }),
    payrollRuns().countDocuments({ org: me.org, sealedTotals: { $exists: true } }),
  ]);
  if (structures.length !== nStructures || slips.length !== nSlips || runs.length !== nRuns) {
    throw new PayrollCryptoError(409, `Re-seal everything: ${nStructures} salaries, ${nSlips} payslips, ${nRuns} runs (got ${structures.length}, ${slips.length}, ${runs.length})`);
  }
  const sealedStructures = structures.map((s) => ({ userId: String(s.userId), sealed: requireSealed(s.sealed, 'structure', next) }));
  const sealedSlips = slips.map((s) => ({ id: String(s.id), sealed: requireSealed(s.sealed, 'payslip', next), forEmployee: isSealedForPerson(s.sealedForEmployee) ? s.sealedForEmployee : undefined }));
  const sealedRuns = runs.map((r) => ({ id: String(r.id), sealed: requireSealed(r.sealedTotals, 'run', next) }));

  const { ObjectId } = await import('mongodb');
  const now = new Date();
  // Two phases so a failure part-way loses nothing: the new key is granted
  // (and recoverable) before any record moves to it; the old grants go last.
  await payrollCrypto().deleteMany({ kind: 'grant', org: me.org, keyVersion: next });
  await payrollCrypto().insertMany(grants.map((g) => ({ kind: 'grant' as const, org: me.org, userId: String(g.userId), keyVersion: next, wrappedDataKey: String(g.wrappedDataKey), grantedByUserId: me.userId, createdAt: now })));
  await payrollCrypto().updateOne({ kind: 'org', org: me.org }, { $set: { pendingRecovery: { wrapped: rec.wrapped, iv: rec.iv, keyVersion: next }, updatedAt: now } });
  for (const s of sealedStructures) await salaryStructures().updateOne({ org: me.org, userId: s.userId }, { $set: { sealed: s.sealed } });
  for (const s of sealedSlips) await payslips().updateOne({ org: me.org, _id: new ObjectId(s.id) }, { $set: { sealed: s.sealed, ...(s.forEmployee ? { sealedForEmployee: s.forEmployee } : {}) } });
  for (const r of sealedRuns) await payrollRuns().updateOne({ org: me.org, _id: new ObjectId(r.id) }, { $set: { sealedTotals: r.sealed } });
  await payrollCrypto().updateOne(
    { kind: 'org', org: me.org },
    { $set: { keyVersion: next, recovery: { wrapped: rec.wrapped, iv: rec.iv, keyVersion: next }, rotationRequired: false, updatedAt: new Date() }, $unset: { pendingRecovery: '' } },
  );
  await payrollCrypto().deleteMany({ kind: 'grant', org: me.org, keyVersion: { $ne: next } });
  return cryptoStatus(viewerUserId);
}

export { isSealed, isSealedForPerson, requireSealed };
