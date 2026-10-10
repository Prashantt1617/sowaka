import crypto from 'crypto';
import type { Filter } from 'mongodb';
import { env } from '../config/env';
import { authSessions, companies, otpChallenges, users } from '../config/db';
import { AuthUser } from '../models/auth.model';
import { User } from '../models/user.model';
import { generateOtp, hashOtp, isValidEmail } from '../utils/otp.util';
import { OtpDeliveryError, sendOtpEmail } from './email.service';
import { logger } from '../utils/logger';
import { resolveProfilePhoto } from './s3-connect-media.service';
import { DEFAULT_APP_TABS } from '../models/company.model';
import { supportRoleOf } from '../models/support.model';
import { enabledGamesOf } from './game-catalog.service';

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

  try {
    await sendOtpEmail(email, otp);
  } catch (error) {
    if (error instanceof OtpDeliveryError) {
      throw new AuthError(503, "We couldn't send your sign-in code just now. Please try again in a minute.");
    }
    throw error;
  }
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
  // A store reviewer cannot receive a mailed code, so a named few accounts may
  // use a fixed one. Scoped to the allowlist and logged every time; the older
  // blanket dev bypass stays for local work only.
  const testAccount = otp === '123456' && env.otpTestEmails.includes(email);
  if (testAccount) {
    logger.warn('Login with the fixed test code', {
      email: `${email.slice(0, 2)}***@${email.split('@')[1] ?? ''}`,
    });
  }
  const valid = testAccount || (env.otpDevBypass && otp === '123456')
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
 * The people shown on the post-login welcome screen: your own team, not the
 * whole company. The same idea of a team as the manager workspace: your
 * manager heading it, whoever reports to your manager and works in your
 * department, and your own reports if you have any. Someone with none of
 * those sees their department instead, and with no department either the
 * screen simply has no team section.
 *
 * Projected deliberately: a full user document carries the profile photo, and
 * this runs right after sign-in.
 */
/**
 * Everyone the viewer can tag in a post or a comment: the whole company, by
 * name, bar themselves, counsellors (a pool shared across companies) and
 * anyone who has left. Photos come only as links: an older account's photo
 * kept inline would make a company-sized list megabytes long.
 */
async function companyForTagging(viewerUserId: string, org: string, limit: number) {
  const rows = await users()
    .find(
      {
        userId: { $ne: viewerUserId },
        lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
        isCounsellor: { $ne: true },
        $or: [{ org }, { org: { $exists: false }, email: { $regex: `@${org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` } }],
      },
      { projection: { _id: 0, userId: 1, name: 1, designation: 1, department: 1, role: 1, profilePhotoKey: 1 } },
    )
    .sort({ name: 1 })
    .toArray();
  const shown = rows.slice(0, limit);
  const links = new Map(
    (
      await users()
        .find(
          { userId: { $in: shown.map((row) => row.userId) }, profilePhotoUrl: { $regex: '^http' } },
          { projection: { _id: 0, userId: 1, profilePhotoUrl: 1 } },
        )
        .toArray()
    ).map((row) => [row.userId, row.profilePhotoUrl]),
  );
  const teammates = await Promise.all(
    shown.map(async (row) => ({
      userId: row.userId,
      name: row.name,
      designation: row.designation ?? row.role ?? 'Teammate',
      department: row.department ?? '',
      photoUrl: await resolveProfilePhoto({ profilePhotoKey: row.profilePhotoKey, profilePhotoUrl: links.get(row.userId) }),
    })),
  );
  return { teammates, total: rows.length };
}

/**
 * The viewer's team, for the welcome screen: their manager, the people under
 * the same manager in their department, and their own reports. With
 * `scope: 'company'` (the tag picker), everyone at the company instead.
 */
export async function getTeammates(viewerUserId: string, limit = 12, scope: 'team' | 'company' = 'team') {
  const viewer = await users().findOne(
    { userId: viewerUserId },
    { projection: { _id: 0, org: 1, email: 1, managerUserId: 1, department: 1 } },
  );
  if (!viewer) return { teammates: [], total: 0 };
  const org = viewer.org ?? viewer.email.split('@').at(1) ?? 'default';
  if (scope === 'company') return companyForTagging(viewerUserId, org, limit);
  const projection = {
    _id: 0, userId: 1, name: 1, designation: 1, department: 1,
    role: 1, profilePhotoKey: 1, profilePhotoUrl: 1, managerUserId: 1,
  };
  const inOrg: Filter<User> = {
    userId: { $ne: viewerUserId },
    lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
    $or: [{ org }, { email: { $regex: `@${org}$` } }],
  };
  const department = viewer.department ?? '';

  const related = await users()
    .find(
      {
        ...inOrg,
        $and: [
          {
            $or: [
              ...(viewer.managerUserId
                ? [{ userId: viewer.managerUserId }, { managerUserId: viewer.managerUserId }]
                : []),
              { managerUserId: viewerUserId },
            ],
          },
        ],
      },
      { projection },
    )
    .sort({ name: 1 })
    .toArray();
  const manager = related.find((row) => row.userId === viewer.managerUserId);
  const team = [
    ...(manager ? [manager] : []),
    ...related.filter(
      (row) =>
        row.userId !== viewer.managerUserId &&
        (row.managerUserId === viewerUserId || (row.department ?? '') === department),
    ),
  ];

  let rows = team;
  if (rows.length === 0 && department.length > 0) {
    rows = await users()
      .find({ ...inOrg, department }, { projection })
      .sort({ name: 1 })
      .toArray();
  }
  const total = rows.length;
  const teammates = await Promise.all(
    rows.slice(0, limit).map(async (row) => ({
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
    org: user.org,
    profilePhotoUrl,
    interests: user.interests ?? [],
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
    // The app draws only the tabs it is told about. A company that has never
    // been given a list gets the four the app has always had.
    enabledTabs: company?.enabledTabs?.length ? company.enabledTabs : DEFAULT_APP_TABS,
    // Which games, so the app shows only what is on — the garden's tree
    // included, which used to follow the Games tab alone.
    enabledGames: enabledGamesOf(company),
    dashboardAccess: user.dashboardAccess === true,
    dashboardAdmin: user.dashboardAdmin === true,
    // The dashboard tabs this person may open; null means every tab.
    dashboardTabs: user.dashboardAdmin === true || !Array.isArray(user.dashboardTabs) ? null : user.dashboardTabs,
    // Whether the dashboard shows the Support desk, and which desk.
    supportRole: supportRoleOf(user),
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
