/**
 * The pre-boarding portal's own sign-in (CONTRACT decision 1, Auth › Portal).
 *
 * - Offer links: a random token per offer version, only its sha256 stored.
 * - Candidate accounts: created at HR's finalise with a generated password
 *   (scrypt), 5 wrong tries lock the account for 15 minutes, forgot/reset by
 *   email without ever saying whether the email exists.
 * - Sessions: a JWT (HS256) with `aud: 'portal'`, `sub: journeyId`, 12 hours.
 *
 * Kept apart from the app's sessions both ways: an app token is 64 random hex
 * characters looked up by its hash in `auth_sessions`, which a portal JWT never
 * is (so `requireAuth` refuses it as "Session expired or invalid"); and a
 * portal token must parse as a JWT signed with the portal key, carry
 * `aud: 'portal'` and `typ: 'portal'`, which an app token cannot.
 */
import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { candidateAccounts, journeys } from '../../config/db';
import { env } from '../../config/env';
import type { CandidateAccount, Journey } from '../../models/lifecycle.model';
import { logger } from '../../utils/logger';
import { companyDisplayName, companyOf, hrContactFor, lifecycleEnabled, mails, portalLink, sendLifecycleEmail } from './emails';
import { completeTask, setJourneyStatus } from './engine';
import { LifecycleOfferError } from './files';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export const PORTAL_TOKEN_TTL_SECONDS = 12 * 60 * 60;
export const MAX_WRONG_TRIES = 5;
export const LOCK_MINUTES = 15;
const RESET_TTL_MS = 60 * 60 * 1000;

/** Journeys whose portal is shut: sign-in and every portal action are refused. */
export const CLOSED_STATUSES = new Set(['declined', 'expired', 'not_joining', 'moved_to_app', 'confirmed']);

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const newLinkToken = () => randomBytes(32).toString('base64url');

// ─── Passwords ──────────────────────────────────────────────────────────────

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** 12 characters, no look-alikes (0/O, 1/l/I), at least one upper, lower, digit and symbol. */
export function generatePassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#%+='];
  const all = sets.join('');
  const chars = sets.map((set) => set[randomInt(set.length)]);
  while (chars.length < 12) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

export function checkNewPassword(password: unknown): string {
  const value = typeof password === 'string' ? password : '';
  if (value.length < 8) throw new LifecycleOfferError(400, 'Use at least 8 characters');
  if (value.length > 128) throw new LifecycleOfferError(400, 'Use at most 128 characters');
  return value;
}

// ─── Portal sessions (JWT, aud 'portal') ────────────────────────────────────

let key: Buffer | null = null;
function signingKey(): Buffer {
  if (key) return key;
  if (env.portalJwtSecret) key = createHash('sha256').update(`portal-jwt:${env.portalJwtSecret}`).digest();
  else if (env.mongoUri) {
    key = createHash('sha256').update(`portal-jwt:derived:${env.mongoUri}`).digest();
    logger.warn('PORTAL_JWT_SECRET is not set; portal sessions are signed with a key derived from the database URI', {});
  } else throw new Error('Portal sessions need PORTAL_JWT_SECRET or MONGODB_URI to sign with');
  return key;
}
const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');
const mac = (body: string) => createHmac('sha256', signingKey()).update(body).digest('base64url');

export interface PortalClaims { aud: 'portal'; typ: 'portal'; sub: string; org: string; iat: number; exp: number }

export function signPortalToken(journeyId: string, org: string, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const claims: PortalClaims = { aud: 'portal', typ: 'portal', sub: journeyId, org, iat, exp: iat + PORTAL_TOKEN_TTL_SECONDS };
  const body = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify(claims))}`;
  return `${body}.${mac(body)}`;
}

/** The claims of a valid, unexpired portal token, or null for anything else (an app token included). */
export function verifyPortalToken(token: string, now = new Date()): PortalClaims | null {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: string; typ?: string };
    if (h.alg !== 'HS256' || h.typ !== 'JWT') return null;
    const expected = Buffer.from(mac(`${header}.${payload}`));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<PortalClaims>;
    if (claims.aud !== 'portal' || claims.typ !== 'portal' || typeof claims.sub !== 'string' || typeof claims.org !== 'string') return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) return null;
    return claims as PortalClaims;
  } catch {
    return null;
  }
}

// ─── Rate limits (per IP, in memory) ────────────────────────────────────────

const buckets = new Map<string, { count: number; resetAt: number }>();
/** Throws 429 past `max` calls in `windowMs` for this key. In memory: each instance counts its own. */
export function rateLimit(bucket: string, ip: string, max: number, windowMs: number, now = Date.now()): void {
  const id = `${bucket}:${ip || 'unknown'}`;
  const entry = buckets.get(id);
  if (!entry || entry.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return;
  }
  entry.count += 1;
  if (entry.count > max) throw new LifecycleOfferError(429, 'Too many tries. Please wait a few minutes and try again.');
}
export function resetRateLimits(): void { buckets.clear(); }

export const LIMITS = {
  signIn: { max: 20, windowMs: 15 * 60 * 1000 },
  code: { max: 8, windowMs: 15 * 60 * 1000 },
  forgot: { max: 5, windowMs: 15 * 60 * 1000 },
  offerLink: { max: 60, windowMs: 15 * 60 * 1000 },
};

// ─── Accounts ───────────────────────────────────────────────────────────────

/** Creates the candidate's account with a fresh password, or returns null when the journey already has one. */
export async function createCandidateAccount(journey: Journey): Promise<{ account: CandidateAccount; password: string } | null> {
  if (await candidateAccounts().findOne({ journeyId: journey.id })) return null;
  const email = String(journey.candidate?.personalEmail ?? '').trim().toLowerCase();
  if (!email) throw new LifecycleOfferError(400, "The candidate's personal email is missing");
  // One login per email across the product: an old account of a closed journey gives way.
  const existing = await candidateAccounts().findOne({ email });
  if (existing) {
    const other = await journeys().findOne({ id: existing.journeyId }, { projection: { _id: 0, status: 1 } });
    if (other && !CLOSED_STATUSES.has(String(other.status))) throw new LifecycleOfferError(409, 'This email already has a joining portal for another offer');
    await candidateAccounts().deleteOne({ email });
  }
  const password = generatePassword();
  const account: CandidateAccount = {
    journeyId: journey.id, org: journey.org, email, passwordHash: await hashPassword(password), failedTries: 0, createdAt: new Date(),
  };
  await candidateAccounts().insertOne({ ...account });
  return { account, password };
}

export async function signIn(emailInput: unknown, passwordInput: unknown, ip: string, now = new Date()): Promise<{ token: string } | { closed: Awaited<ReturnType<typeof closedScreen>> }> {
  rateLimit('portal-sign-in', ip, LIMITS.signIn.max, LIMITS.signIn.windowMs, now.getTime());
  const email = String(emailInput ?? '').trim().toLowerCase();
  const password = String(passwordInput ?? '');
  const wrong = () => new LifecycleOfferError(401, 'That email and password don’t match');
  if (!email || !password) throw new LifecycleOfferError(400, 'Enter your email and password');
  const account = await candidateAccounts().findOne({ email });
  if (!account) {
    // Same work as a real check, so timing does not tell whether the email exists.
    await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
    throw wrong();
  }
  if (account.lockedUntil && account.lockedUntil.getTime() > now.getTime()) {
    const minutes = Math.ceil((account.lockedUntil.getTime() - now.getTime()) / 60_000);
    throw new LifecycleOfferError(403, `Too many wrong tries. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.`);
  }
  // A password copied from the login email often brings a space or line break with it; the generated
  // ones never have either, so the trimmed copy is tried too (a password that really ends in a space still works).
  const matches = (await verifyPassword(password, account.passwordHash))
    || (password.trim() !== password && password.trim() !== '' && await verifyPassword(password.trim(), account.passwordHash));
  if (!matches) {
    const tries = (account.failedTries ?? 0) + 1;
    if (tries >= MAX_WRONG_TRIES) {
      await candidateAccounts().updateOne({ email }, { $set: { failedTries: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) } });
      throw new LifecycleOfferError(403, `Too many wrong tries. Try again in ${LOCK_MINUTES} minutes, or reset your password.`);
    }
    await candidateAccounts().updateOne({ email }, { $set: { failedTries: tries } });
    throw wrong();
  }
  return finishSignIn(account, now, wrong);
}


type SignedIn = { token: string } | { closed: Awaited<ReturnType<typeof closedScreen>> };

/** The account's owner is proven (password or code): a session, or which closed screen. */
async function finishSignIn(account: CandidateAccount, now: Date, wrong: () => Error): Promise<SignedIn> {
  const journey = await journeys().findOne({ id: account.journeyId });
  if (!journey || !(await lifecycleEnabled(journey.org))) throw wrong();
  if (CLOSED_STATUSES.has(String(journey.status))) {
    // The right password on a closed portal: a normal answer naming which closed screen (P16, PX, P3b, P3c);
    // not an error (the screen is the right one, and a 403 had the browser log a failed call). No session.
    await candidateAccounts().updateOne({ email: account.email }, { $set: { failedTries: 0 }, $unset: { lockedUntil: '' } });
    return { closed: await closedScreen(journey) };
  }
  const first = !account.lastSignInAt;
  await candidateAccounts().updateOne({ email: account.email }, { $set: { failedTries: 0, lastSignInAt: now }, $unset: { lockedUntil: '' } });
  if (first && journey.status === 'finalised') {
    await setJourneyStatus(journey.id, 'active', { lastActivityAt: now });
  } else {
    await journeys().updateOne({ id: journey.id }, { $set: { lastActivityAt: now } });
  }
  if (first) await completeTask(journey.id, 'portal_sign_in', { name: journey.candidate?.name });
  return { token: signPortalToken(journey.id, journey.org, now) };
}

export type ClosedScreenState = 'declined' | 'expired' | 'not_joining' | 'moved_to_app';
/** What a closed portal shows after a correct sign-in: which screen, the client's logo and HR. */
export async function closedScreen(journey: Journey): Promise<{ state: ClosedScreenState; company: { name: string; logoUrl?: string }; hrContact: { name: string; email: string } }> {
  const status = String(journey.status);
  const state: ClosedScreenState = status === 'declined' || status === 'expired' || status === 'not_joining' ? status : 'moved_to_app';
  const company = await companyOf(journey.org);
  return {
    state,
    company: { name: companyDisplayName(company, journey.org), ...(company?.lifecyclePortal?.logoUrl ? { logoUrl: company.lifecyclePortal.logoUrl } : {}) },
    hrContact: await hrContactFor(journey, company),
  };
}

// ─── Media links (a manager's video note in <video src>, which cannot send a Bearer token) ─

const MEDIA_TTL_SECONDS = PORTAL_TOKEN_TTL_SECONDS;
/** A short-lived, signed path for one of the journey's files: `/portal/media/<token>`. */
export function mediaPath(journeyId: string, fileId: string, now = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + MEDIA_TTL_SECONDS;
  const body = b64(JSON.stringify({ typ: 'media', j: journeyId, f: fileId, exp }));
  return `/portal/media/${body}.${mac(`media.${body}`)}`;
}
/** The journey and file a media token names, or null (forged, expired, or anything else). */
export function verifyMediaToken(token: string, now = new Date()): { journeyId: string; fileId: string } | null {
  const [body, signature] = String(token ?? '').split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(mac(`media.${body}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { typ?: string; j?: unknown; f?: unknown; exp?: unknown };
    if (claims.typ !== 'media' || typeof claims.j !== 'string' || typeof claims.f !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 <= now.getTime()) return null;
    return { journeyId: claims.j, fileId: claims.f };
  } catch {
    return null;
  }
}

/** Always `{ ok: true }`: whether the email exists is never said. */
export async function forgotPassword(emailInput: unknown, ip: string, now = new Date()): Promise<{ ok: true }> {
  rateLimit('portal-forgot', ip, LIMITS.forgot.max, LIMITS.forgot.windowMs, now.getTime());
  const email = String(emailInput ?? '').trim().toLowerCase();
  const account = email ? await candidateAccounts().findOne({ email }) : null;
  if (!account) return { ok: true };
  const journey = await journeys().findOne({ id: account.journeyId });
  if (!journey || CLOSED_STATUSES.has(String(journey.status)) || !(await lifecycleEnabled(journey.org))) return { ok: true };
  const token = newLinkToken();
  await candidateAccounts().updateOne({ email }, { $set: { resetTokenHash: sha256(token), resetTokenExpiresAt: new Date(now.getTime() + RESET_TTL_MS) } });
  const company = await companyOf(journey.org);
  await sendLifecycleEmail(journey.org, email, 'Reset your joining portal password',
    // The portal routes /reset/:token (the token is base64url, so it needs no escaping in a path).
    mails.passwordReset(companyDisplayName(company, journey.org), journey.candidate?.name ?? '', portalLink(`/reset/${token}`, journey.org)));
  return { ok: true };
}

export async function resetPassword(tokenInput: unknown, passwordInput: unknown, now = new Date()): Promise<{ ok: true }> {
  const token = String(tokenInput ?? '');
  const password = checkNewPassword(passwordInput);
  const account = token ? await candidateAccounts().findOne({ resetTokenHash: sha256(token) }) : null;
  if (!account || !account.resetTokenExpiresAt || account.resetTokenExpiresAt.getTime() <= now.getTime()) {
    throw new LifecycleOfferError(400, 'This reset link has expired. Ask for a new one.');
  }
  await candidateAccounts().updateOne({ email: account.email }, {
    $set: { passwordHash: await hashPassword(password), failedTries: 0 },
    $unset: { resetTokenHash: '', resetTokenExpiresAt: '', lockedUntil: '' },
  });
  return { ok: true };
}

/** The journey behind a Bearer portal token, or a 401. Closed journeys still resolve (the home shows the closed screen). */
export async function journeyForPortalToken(authorization: string | undefined, now = new Date()): Promise<Journey> {
  const [scheme, token] = String(authorization ?? '').split(' ');
  const claims = scheme?.toLowerCase() === 'bearer' && token ? verifyPortalToken(token, now) : null;
  if (!claims) throw new LifecycleOfferError(401, 'Please sign in again');
  const journey = await journeys().findOne({ id: claims.sub, org: claims.org });
  if (!journey || journey.kind !== 'onboarding') throw new LifecycleOfferError(401, 'Please sign in again');
  if (!(await lifecycleEnabled(journey.org))) throw new LifecycleOfferError(404, 'Not available');
  if (!(await candidateAccounts().findOne({ journeyId: journey.id }, { projection: { _id: 1 } }))) throw new LifecycleOfferError(401, 'Please sign in again');
  return journey;
}

// ─── The portal inside the app (an app user's own journey, no code) ─────────

/**
 * The signed-in app user's own onboarding journey while its portal is still
 * open: bound to them at Mark joined, not closed, a candidate account behind
 * it (journeyForPortalToken needs one) and not yet moved to the app (Tj + 7 or
 * the end of month 1). Null otherwise.
 */
export async function openPortalJourneyForUser(userId: string, org: string): Promise<Journey | null> {
  if (!userId || !org) return null;
  const journey = await journeys().find({ userId, org, kind: 'onboarding', closedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(1).next();
  if (!journey || CLOSED_STATUSES.has(String(journey.status))) return null;
  if (!(await candidateAccounts().findOne({ journeyId: journey.id }, { projection: { _id: 1 } }))) return null;
  return journey;
}

/**
 * A portal session for the app user's own journey: the app opens the portal in
 * its own page, signed in without a code (POST /lifecycle/portal-session). The
 * token is the portal's usual one (aud 'portal', sub journeyId, 12 hours); the
 * portal's `/app` entry reads it from the URL's fragment, which never reaches a
 * server or a log.
 */
export async function portalSessionForAppUser(me: { userId: string; org: string }, now = new Date()): Promise<{ token: string; expiresAt: string; url: string }> {
  const journey = await openPortalJourneyForUser(me.userId, me.org);
  if (!journey) throw new LifecycleOfferError(404, 'No joining portal for you');
  const token = signPortalToken(journey.id, journey.org, now);
  await journeys().updateOne({ id: journey.id }, { $set: { lastActivityAt: now } });
  return {
    token,
    expiresAt: new Date((Math.floor(now.getTime() / 1000) + PORTAL_TOKEN_TTL_SECONDS) * 1000).toISOString(),
    url: `${portalLink('/app', journey.org)}#t=${token}`,
  };
}

// ─── Sign-in by a code to their email (no password) ─────────────────────────

const CODE_TTL_MINUTES = 10;
const isTestEmail = (email: string) => env.otpTestEmails.includes(email);

/**
 * Emails a one-time sign-in code to a portal's email. Always answers the same,
 * so the page does not tell whether an email has a portal. Test addresses
 * (OTP_TEST_EMAILS) take the fixed code 123456 and get no mail.
 */
export async function requestSignInCode(emailInput: unknown, ip: string, now = new Date()): Promise<{ ok: true }> {
  rateLimit('portal-code', ip, LIMITS.code.max, LIMITS.code.windowMs, now.getTime());
  const email = String(emailInput ?? '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new LifecycleOfferError(400, 'Enter the email your joining portal was sent to');
  const account = await candidateAccounts().findOne({ email });
  if (!account) return { ok: true };
  const journey = await journeys().findOne({ id: account.journeyId }, { projection: { _id: 0, org: 1 } });
  if (!journey || !(await lifecycleEnabled(journey.org))) return { ok: true };
  if (isTestEmail(email)) return { ok: true };
  const code = String(randomInt(100000, 1000000));
  await candidateAccounts().updateOne({ email }, { $set: { codeHash: sha256(`${email}:${code}`), codeExpiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000), codeTries: 0 } });
  const company = await companyOf(journey.org);
  const name = companyDisplayName(company, journey.org);
  await sendLifecycleEmail(journey.org, email, `${code} is your ${name} joining portal code`, mails.portalCode(name, code, CODE_TTL_MINUTES));
  return { ok: true };
}

/** The code from the email: a session (or the closed screen). Five wrong codes lock it for 15 minutes. */
export async function signInWithCode(emailInput: unknown, codeInput: unknown, ip: string, now = new Date()): Promise<SignedIn> {
  rateLimit('portal-sign-in', ip, LIMITS.signIn.max, LIMITS.signIn.windowMs, now.getTime());
  const email = String(emailInput ?? '').trim().toLowerCase();
  const code = String(codeInput ?? '').replace(/\s+/g, '');
  const wrong = () => new LifecycleOfferError(401, 'That code doesn’t match. Check the latest email, or send a new code.');
  if (!email || !/^\d{6}$/.test(code)) throw new LifecycleOfferError(400, 'Enter the 6-digit code from the email');
  const account = await candidateAccounts().findOne({ email });
  if (!account) throw wrong();
  if (account.lockedUntil && account.lockedUntil.getTime() > now.getTime()) {
    const minutes = Math.ceil((account.lockedUntil.getTime() - now.getTime()) / 60_000);
    throw new LifecycleOfferError(403, `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
  const testOk = isTestEmail(email) && code === '123456';
  if (testOk) logger.warn('Portal sign-in with a fixed code', { email: email.replace(/^(.{2}).*@/, '$1***@') });
  const live = Boolean(account.codeHash && account.codeExpiresAt && account.codeExpiresAt.getTime() > now.getTime());
  const matches = testOk || (live && sha256(`${email}:${code}`) === account.codeHash);
  if (!matches) {
    const tries = (account.codeTries ?? 0) + 1;
    if (tries >= MAX_WRONG_TRIES) {
      await candidateAccounts().updateOne({ email }, { $set: { codeTries: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) }, $unset: { codeHash: '', codeExpiresAt: '' } });
      throw new LifecycleOfferError(403, `Too many wrong codes. Try again in ${LOCK_MINUTES} minutes.`);
    }
    await candidateAccounts().updateOne({ email }, { $set: { codeTries: tries } });
    if (!live && !testOk) throw new LifecycleOfferError(401, 'That code has expired. Send a new one.');
    throw wrong();
  }
  // A code works once.
  await candidateAccounts().updateOne({ email }, { $set: { codeTries: 0 }, $unset: { codeHash: '', codeExpiresAt: '' } });
  return finishSignIn(account, now, wrong);
}
