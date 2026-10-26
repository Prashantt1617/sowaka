import crypto from 'crypto';
import { forgetAuthToken, rememberAuth } from './auth-cache';
import type { Filter } from 'mongodb';
import { env } from '../config/env';
import { authSessions, companies, otpChallenges, users } from '../config/db';
import { AuthSessionDocument, AuthUser } from '../models/auth.model';
import { User } from '../models/user.model';
import { generateOtp, hashOtp, isValidEmail } from '../utils/otp.util';
import { OtpDeliveryError, sendOtpEmail } from './email.service';
import { logger } from '../utils/logger';
import { resolveProfilePhoto } from './s3-connect-media.service';
import { Company, DEFAULT_APP_TABS } from '../models/company.model';
import { faceIdSettingsOf } from '../models/face.model';
import { supportRoleOf } from '../models/support.model';
import { enabledGamesOf } from './game-catalog.service';
import { placementsFeatureOf } from './placements.service';

const defaultCompany = 'Sowaka';

const maxAttempts = 5;

export async function requestLoginOtp(emailInput: string): Promise<void> {
  const email = normalizeEmail(emailInput);
  if (!isValidEmail(email)) {
    throw new AuthError(400, 'Please enter a valid work email');
  }
  // Only whether they may sign in, and their org for the mail gate: the whole
  // record carries the profile photo.
  const user = await requireEligibleUser(email, { _id: 0, lifecycleStatus: 1, org: 1 });

  const otp = generateOtp();
  const now = Date.now();
  // The code is kept and mailed at the same time, not one after the other:
  // the cluster is a round trip away and the mail is a second or so, and the
  // person is watching a spinner. A mail that fails still ends in the 503; a
  // code kept but never mailed is replaced by the next request.
  const delivery = sendOtpEmail(email, otp, user).catch((error: unknown) => {
    if (error instanceof OtpDeliveryError) {
      throw new AuthError(503, "We couldn't send your sign-in code just now. Please try again in a minute.");
    }
    throw error;
  });
  await Promise.all([
    otpChallenges().updateOne(
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
    ),
    delivery,
  ]);
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

  // The person and their code in one round trip rather than two.
  const [existingUser, challenge] = await Promise.all([
    requireEligibleUser(email),
    otpChallenges().findOne({ email }),
  ]);
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
  // A shared desk may have its own fixed code instead (OTP_FIXED_CODES).
  const fixedCode = env.otpFixedCodes.get(email);
  const testAccount = (otp === '123456' && env.otpTestEmails.includes(email))
    || (fixedCode !== undefined && otp === fixedCode);
  if (testAccount) {
    logger.warn('Login with a fixed code', {
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

  // Everything signing in writes and reads goes in one round trip: the code
  // spent, the session kept, and the person brought up to date. One after
  // another they were six trips, well over a second before "You're in".
  const token = crypto.randomBytes(32).toString('hex');
  const session: AuthSessionDocument = {
    tokenHash: hashSessionToken(token),
    userId: existingUser.userId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + env.authSessionTtlDays * 24 * 60 * 60 * 1000),
  };
  const [, signedIn] = await Promise.all([
    otpChallenges().deleteOne({ email }),
    completeLogin(existingUser),
    authSessions().insertOne({ ...session }),
  ]);

  // The app's first calls with the new token (its profile, the welcome
  // screen's team, the home screen) then skip the session lookup.
  const { profilePhotoUrl: _photo, ...withoutPhoto } = signedIn.record;
  rememberAuth(session.tokenHash, session, withoutPhoto);
  return { token, user: signedIn.user };
}

export async function revokeSession(token: string): Promise<void> {
  if (token) {
    forgetAuthToken(hashSessionToken(token));
    await authSessions().deleteOne({ tokenHash: hashSessionToken(token) });
  }
}

export async function getCurrentAuthUser(
  userId: string,
  /** The user as the auth check read them moments ago, photo aside. */
  preloaded?: Pick<User, 'org' | 'managerUserId'>,
): Promise<AuthUser> {
  // Whether anyone reports to them needs only their id, so both reads go
  // together. The record itself is read fresh (an edit made a second ago
  // must show), but its company and manager are asked for alongside it from
  // what the auth check saw, and only asked again if those have since moved.
  const [user, reports, company, manager] = await Promise.all([
    users().findOne({ userId }),
    users().countDocuments({ managerUserId: userId }, { limit: 1 }),
    preloaded ? companyFor(preloaded.org) : undefined,
    preloaded ? managerNameFor(preloaded.managerUserId) : undefined,
  ]);
  if (!user || user.lifecycleStatus === 'offboarded' || user.lifecycleStatus === 'terminated') {
    throw new AuthError(401, 'User is not active');
  }

  const role = reports ? 'manager' : 'employee';
  return toAuthUser(
    { ...user, role },
    preloaded && preloaded.org === user.org && preloaded.managerUserId === user.managerUserId
      ? { company: company ?? null, manager: manager ?? null }
      : undefined,
  );
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function requireEligibleUser(email: string, projection?: Record<string, 0 | 1>): Promise<User> {
  const user = await users().findOne({ email }, projection ? { projection } : undefined);
  if (!user) {
    throw new AuthError(403, 'This email is not registered. Contact HR for access');
  }
  if (user.lifecycleStatus === 'offboarded' || user.lifecycleStatus === 'terminated') {
    throw new AuthError(403, 'This employee account is not active');
  }
  return user;
}

async function completeLogin(user: User): Promise<{ user: AuthUser; record: User }> {
  // Whether anyone reports to them, the sign-in stamp, and their company and
  // manager are all independent: asked together. The role is written apart,
  // and only on the rare sign-in where it has changed.
  //
  // Only the role is needed to sign in. The stamp, the company's name and the
  // manager's are extras: one that fails is logged and the sign-in goes on
  // (the company falls back to the org, the manager to none).
  const now = new Date();
  const extra = <T>(what: string, work: Promise<T>) =>
    work.catch((error: unknown) => {
      logger.warn('Sign-in went on without one of its extras', {
        what,
        userId: user.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
  const [reports, , company, manager] = await Promise.all([
    users().countDocuments({ managerUserId: user.userId }, { limit: 1 }),
    extra('lastLoginAt', users().updateOne({ userId: user.userId }, { $set: { lastLoginAt: now, updatedAt: now } })),
    extra('company', Promise.resolve(companyFor(user.org))),
    extra('manager', Promise.resolve(managerNameFor(user.managerUserId))),
  ]);
  const role = reports ? 'manager' : 'employee';
  if (role !== user.role) {
    // Not waited for: the answer already carries the new role.
    void extra('role', users().updateOne({ userId: user.userId }, { $set: { role, updatedAt: now } }));
  }

  const record: User = { ...user, role, lastLoginAt: now, updatedAt: now };
  return {
    user: await toAuthUser(record, { company: company ?? null, manager: manager ?? null }),
    record,
  };
}

/**
 * The people a teammate list shows, with only what it draws: name, role and
 * the photo. A photo held as a link comes back as the link; one an older
 * account keeps inline (a base64 data URI of hundreds of KB) stays behind
 * unless asked for, since a company-sized list of those would be megabytes
 * long. One round trip.
 */
type TeammateRow = Pick<
  User,
  'userId' | 'name' | 'designation' | 'department' | 'role' | 'profilePhotoKey' | 'profilePhotoUrl' | 'managerUserId'
>;
function teammateRows(match: Filter<User>, { inlinePhotos = false } = {}): Promise<TeammateRow[]> {
  return users()
    .aggregate<TeammateRow>([
      { $match: match },
      { $sort: { name: 1 } },
      {
        $project: {
          _id: 0, userId: 1, name: 1, designation: 1, department: 1, role: 1, profilePhotoKey: 1, managerUserId: 1,
          profilePhotoUrl: inlinePhotos
            ? 1
            : {
                $cond: [
                  { $regexMatch: { input: { $ifNull: ['$profilePhotoUrl', ''] }, regex: '^http' } },
                  '$profilePhotoUrl',
                  '$$REMOVE',
                ],
              },
        },
      },
    ])
    .toArray();
}

/**
 * Everyone at the company: their org, or (older accounts with no org) an
 * address at its domain. The org half is what the index serves; the address
 * half only ever looks at the few records with no org.
 */
function inOrgFilter(viewerUserId: string, org: string): Filter<User> {
  return {
    userId: { $ne: viewerUserId },
    lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
    $or: [{ org }, { org: { $exists: false }, email: { $regex: `@${org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` } }],
  };
}

async function toTeammates(rows: TeammateRow[]) {
  return Promise.all(
    rows.map(async (row) => ({
      userId: row.userId,
      name: row.name,
      designation: row.designation ?? row.role ?? 'Teammate',
      department: row.department ?? '',
      photoUrl: await resolveProfilePhoto(row),
    })),
  );
}

/**
 * Everyone the viewer can tag in a post or a comment: the whole company, by
 * name, bar themselves, counsellors (a pool shared across companies) and
 * anyone who has left.
 */
async function companyForTagging(viewerUserId: string, org: string, limit: number) {
  const rows = await teammateRows({ ...inOrgFilter(viewerUserId, org), isCounsellor: { $ne: true } });
  return { teammates: await toTeammates(rows.slice(0, limit)), total: rows.length };
}

/**
 * The viewer's team, for the welcome screen: their manager, the people under
 * the same manager in their department, and their own reports. Someone with
 * none of those sees their department instead, and with no department either
 * the screen simply has no team section. With `scope: 'company'` (the tag
 * picker), everyone at the company instead.
 *
 * The viewer is the record the auth check already read, when there is one.
 */
export async function getTeammates(
  viewerUserId: string,
  limit = 12,
  scope: 'team' | 'company' = 'team',
  preloaded?: Pick<User, 'org' | 'email' | 'managerUserId' | 'department'>,
) {
  const viewer =
    preloaded ??
    (await users().findOne(
      { userId: viewerUserId },
      { projection: { _id: 0, org: 1, email: 1, managerUserId: 1, department: 1 } },
    ));
  if (!viewer) return { teammates: [], total: 0 };
  const org = viewer.org ?? viewer.email.split('@').at(1) ?? 'default';
  if (scope === 'company') return companyForTagging(viewerUserId, org, limit);
  const inOrg = inOrgFilter(viewerUserId, org);
  const department = viewer.department ?? '';

  // A team is a handful of people, and the welcome screen has always shown
  // an older account's inline photo too.
  const related = await teammateRows({
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
  }, { inlinePhotos: true });
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
    rows = await teammateRows({ ...inOrg, department }, { inlinePhotos: true });
  }
  return { teammates: await toTeammates(rows.slice(0, limit)), total: rows.length };
}

function companyFor(org: string | undefined) {
  return org ? companies().findOne({ id: org }) : null;
}

function managerNameFor(managerUserId: string | undefined) {
  // Only the name is used, and a full user document carries the profile
  // photo with it.
  return managerUserId
    ? users().findOne({ userId: managerUserId }, { projection: { _id: 0, name: 1 } })
    : null;
}

async function toAuthUser(
  user: User,
  /** The company and manager when already read for this user's org and manager. */
  prefetched?: { company: Company | null; manager: { name?: string } | null },
): Promise<AuthUser> {
  const [company, manager, profilePhotoUrl] = await Promise.all([
    prefetched ? prefetched.company : companyFor(user.org),
    prefetched ? prefetched.manager : managerNameFor(user.managerUserId),
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
    employeeId: user.employeeId,
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
    // Whether the profile offers Edit details (own and their reports'); the server checks it again.
    canEditEmployees: user.canEditEmployeeDetails === true,
    isLeadership: user.isLeadership === true,
    // Whether the composer offers contests; the server refuses one without it.
    canCreateContests: user.canCreateContests === true,
    // Whether their punches are face-checked and whether they have set up
    // Face ID, so the punch screen knows which to open: no extra call.
    faceId: {
      enrolled: Boolean(user.faceId?.faceId),
      atPunch: faceIdSettingsOf(company).checkAtPunch,
    },
    // Features only some companies have, so the app and the dashboard show
    // their screens only there; the server refuses their routes elsewhere.
    features: {
      placements: placementsFeatureOf(company),
    },
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
