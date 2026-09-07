import crypto from 'crypto';
import type { Filter } from 'mongodb';
import { env } from '../config/env';
import { authSessions, companies, otpChallenges, users } from '../config/db';
import { AuthUser } from '../models/auth.model';
import { User } from '../models/user.model';
import { generateOtp, hashOtp, isValidEmail } from '../utils/otp.util';
import { sendOtpEmail } from './email.service';
import { resolveProfilePhoto } from './s3-connect-media.service';

const defaultCompany = 'Sowaka';

const maxAttempts = 5;

export async function requestLoginOtp(emailInput: string): Promise<void> {
  const email = normalizeEmail(emailInput);
  if (!isValidEmail(email)) {
    throw new AuthError(400, 'Please enter a valid work email');
  }
  await requireEligibleUser(email);

  const otp = generateOtp();
  const now = Date.now();
  await otpChallenges().updateOne(
    { email },
    {
      $set: {
        email,
        otpHash: hashOtp(email, otp),
        expiresAt: now + env.otpTtlMinutes * 60 * 1000,
        attempts: 0,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  await sendOtpEmail(email, otp);
}

export async function verifyLoginOtp(
  emailInput: string,
  otpInput: string,
): Promise<{ token: string; user: AuthUser }> {
  const email = normalizeEmail(emailInput);
  const otp = otpInput.trim();

  if (!isValidEmail(email) || !/^\d{6}$/.test(otp)) {
    throw new AuthError(400, 'Invalid email or code');
  }

  const existingUser = await requireEligibleUser(email);

  const challenge = await otpChallenges().findOne({ email });
  if (!challenge) {
    throw new AuthError(400, 'Code expired or not requested');
  }

  if (challenge.expiresAt < Date.now()) {
    await otpChallenges().deleteOne({ email });
    throw new AuthError(400, 'Code expired');
  }

  if (challenge.attempts >= maxAttempts) {
    await otpChallenges().deleteOne({ email });
    throw new AuthError(429, 'Too many attempts. Request a new code');
  }

  const expectedHash = challenge.otpHash;
  const actualHash = hashOtp(email, otp);
  // Local convenience for working without a mail server. The accepted code has
  // no default and must be set explicitly per environment: the previous fixed
  // `123456` shipped to production behind a flag that was also set there, which
  // let anyone sign in as any registered user with a publicly known code.
  // Gated on the environment too, so both would have to be wrong at once.
  const valid =
    env.otpBypassCode && env.nodeEnv !== 'production' && otp === env.otpBypassCode
      ? true
      : timingSafeEqualHex(expectedHash, actualHash);

  if (!valid) {
    await otpChallenges().updateOne({ email }, { $inc: { attempts: 1 } });
    throw new AuthError(401, 'Incorrect code');
  }

  await otpChallenges().deleteOne({ email });

  const user = await completeLogin(existingUser);
  const token = crypto.randomBytes(32).toString('hex');
  await authSessions().insertOne({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + env.authSessionTtlDays * 24 * 60 * 60 * 1000),
  });
  return { token, user };
}

export async function revokeSession(token: string): Promise<void> {
  if (token) {
    await authSessions().deleteOne({ tokenHash: hashSessionToken(token) });
  }
}

export async function getCurrentAuthUser(userId: string): Promise<AuthUser> {
  const user = await users().findOne({ userId });
  if (!user || user.lifecycleStatus === 'offboarded' || user.lifecycleStatus === 'terminated') {
    throw new AuthError(401, 'User is not active');
  }

  const role = (await users().countDocuments({ managerUserId: user.userId }, { limit: 1 }))
    ? 'manager'
    : 'employee';
  return toAuthUser({ ...user, role });
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function requireEligibleUser(email: string): Promise<User> {
  const user = await users().findOne({ email });
  if (!user) {
    throw new AuthError(403, 'This email is not registered. Contact HR for access');
  }
  if (user.lifecycleStatus === 'offboarded' || user.lifecycleStatus === 'terminated') {
    throw new AuthError(403, 'This employee account is not active');
  }
  return user;
}

async function completeLogin(user: User): Promise<AuthUser> {
  const role = (await users().countDocuments({ managerUserId: user.userId }, { limit: 1 }))
    ? 'manager'
    : 'employee';

  const now = new Date();
  await users().updateOne(
    { userId: user.userId },
    { $set: { role, lastLoginAt: now, updatedAt: now } },
  );

  return toAuthUser({ ...user, role });
}

/**
 * Colleagues shown on the post-login welcome screen. Scoped to the viewer's org
 * and projected deliberately: a full user document carries the profile photo,
 * and this runs right after sign-in.
 */
export async function getTeammates(viewerUserId: string, limit = 12) {
  const viewer = await users().findOne(
    { userId: viewerUserId },
    { projection: { _id: 0, org: 1, email: 1 } },
  );
  if (!viewer) return { teammates: [], total: 0 };
  const org = viewer.org ?? viewer.email.split('@').at(1) ?? 'default';
  const filter: Filter<User> = {
    userId: { $ne: viewerUserId },
    lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
    $or: [{ org }, { email: { $regex: `@${org}$` } }],
  };
  const [rows, total] = await Promise.all([
    users()
      .find(filter, {
        projection: {
          _id: 0, userId: 1, name: 1, designation: 1, department: 1,
          role: 1, profilePhotoKey: 1, profilePhotoUrl: 1,
        },
      })
      .sort({ name: 1 })
      .limit(limit)
      .toArray(),
    users().countDocuments(filter),
  ]);
  const teammates = await Promise.all(
    rows.map(async (row) => ({
      userId: row.userId,
      name: row.name,
      designation: row.designation ?? row.role ?? 'Teammate',
      department: row.department ?? '',
      photoUrl: await resolveProfilePhoto(row),
    })),
  );
  return { teammates, total };
}

async function toAuthUser(user: User): Promise<AuthUser> {
  const [company, manager, profilePhotoUrl] = await Promise.all([
    user.org ? companies().findOne({ id: user.org }) : null,
    // Only the name is used below, and a full user document carries the
    // profile photo with it.
    user.managerUserId
      ? users().findOne({ userId: user.managerUserId }, { projection: { _id: 0, name: 1 } })
      : null,
    resolveProfilePhoto(user),
  ]);

  return {
    id: user.userId,
    email: user.email,
    name: user.name,
    role: user.role ?? 'employee',
    company: company?.name ?? user.org ?? defaultCompany,
    profilePhotoUrl,
    location: user.location ?? user.branch,
    state: user.state,
    designation: user.designation,
    employmentType: user.employeeType,
    department: user.department,
    teamDescription: user.teamDescription,
    managerName: manager?.name,
    joiningDate: toIsoDate(user.joiningDate),
    birthday: toIsoDate(user.birthday),
    recognition: user.recognition,
    dashboardAccess: user.dashboardAccess === true,
    isLeadership: user.isLeadership === true,
  };
}

function toIsoDate(value: Date | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export class AuthError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
