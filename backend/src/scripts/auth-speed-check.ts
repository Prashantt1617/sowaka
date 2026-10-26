/**
 * Scratch-database check of sign-in and the teammate lists after their reads
 * were put together: the same answers as before, in fewer round trips. It
 * drops and recreates its own database, and refuses any other. Run with
 * MONGODB_DB=sowaka_authspeed_scratch EMAIL_ORGS=nobody-scratch npm run auth-speed:check
 * (EMAIL_ORGS keeps every code from being mailed).
 */
import { authSessions, connectDb, getDb, otpChallenges, users } from '../config/db';
import { cachedAuth } from '../services/auth-cache';
import { AuthError, getTeammates, hashSessionToken, requestLoginOtp, verifyLoginOtp } from '../services/auth.service';
import { hashOtp } from '../utils/otp.util';

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}

const ORG = 'sowaka';
const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', ...extra,
});
const people = [
  person('mgr', 'Manav Manager', { department: 'Eng', role: 'employee', profilePhotoUrl: 'https://cdn.test/mgr.jpg' }),
  person('a', 'Asha', { managerUserId: 'mgr', department: 'Eng', profilePhotoUrl: 'data:image/png;base64,AAAA' }),
  person('b', 'Bala', { managerUserId: 'mgr', department: 'Eng', profilePhotoKey: 'connect/b.jpg' }),
  person('c', 'Chetan', { managerUserId: 'mgr', department: 'Sales' }),
  person('d', 'Divya', { managerUserId: 'a', department: 'Design' }),
  person('counsellor', 'Cora Counsellor', { isCounsellor: true }),
  person('left', 'Leaver', { managerUserId: 'mgr', department: 'Eng', lifecycleStatus: 'offboarded' }),
  { userId: 'old', name: 'Olu Oldaccount', email: 'old@sowaka', lifecycleStatus: 'active' },
  { userId: 'other', name: 'Other Org', email: 'other@toyota.test', org: 'toyota', lifecycleStatus: 'active' },
];

async function rejects(work: Promise<unknown>, status: number) {
  try {
    await work;
    return false;
  } catch (error) {
    return error instanceof AuthError && error.statusCode === status;
  }
}

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'sowaka_authspeed_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany(people as never[]);

  // --- requesting a code
  check('an unknown address is refused', await rejects(requestLoginOtp('nobody@sowaka.test'), 403));
  check('a leaver is refused', await rejects(requestLoginOtp('left@sowaka.test'), 403));
  await requestLoginOtp('MGR@sowaka.test ');
  const challenge = await otpChallenges().findOne({ email: 'mgr@sowaka.test' });
  check('a code is kept for a registered address', Boolean(challenge?.otpHash) && challenge?.attempts === 0, challenge);

  // --- verifying it (a known code put in its place)
  await otpChallenges().updateOne({ email: 'mgr@sowaka.test' }, { $set: { otpHash: hashOtp('mgr@sowaka.test', '111111') } });
  check('a wrong code is refused', await rejects(verifyLoginOtp('mgr@sowaka.test', '222222'), 401));
  check('and counted', (await otpChallenges().findOne({ email: 'mgr@sowaka.test' }))?.attempts === 1);
  check('no code at all is refused', await rejects(verifyLoginOtp('a@sowaka.test', '111111'), 400));
  check('an unknown address is refused before its code', await rejects(verifyLoginOtp('nobody@sowaka.test', '111111'), 403));

  const result = await verifyLoginOtp('mgr@sowaka.test', '111111');
  check('the right code signs in', result.token.length === 64 && result.user.id === 'mgr', result.user);
  check('as a manager, since people report to them', result.user.role === 'manager', result.user.role);
  check('the photo link comes back', result.user.profilePhotoUrl === 'https://cdn.test/mgr.jpg', result.user.profilePhotoUrl);
  check('the company falls back to the org', result.user.company === ORG, result.user.company);
  const tokenHash = hashSessionToken(result.token);
  const session = await authSessions().findOne({ tokenHash });
  check('the session is kept', session?.userId === 'mgr' && session.expiresAt > new Date(), session);
  check('the code is spent', (await otpChallenges().findOne({ email: 'mgr@sowaka.test' })) === null);
  const record = await users().findOne({ userId: 'mgr' });
  check('the role is written', record?.role === 'manager', record?.role);
  check('the sign-in is stamped', record?.lastLoginAt instanceof Date, record?.lastLoginAt);
  const remembered = cachedAuth(tokenHash);
  check('the new session is remembered for the first calls', remembered?.user.userId === 'mgr' && remembered.user.role === 'manager', remembered);
  check('without the photo', remembered !== null && !('profilePhotoUrl' in remembered.user));
  check('and without a Mongo _id on the session', remembered !== null && !('_id' in remembered.session));

  // A second sign-in with the role unchanged writes the stamp alone.
  await otpChallenges().updateOne(
    { email: 'b@sowaka.test' },
    { $set: { email: 'b@sowaka.test', otpHash: hashOtp('b@sowaka.test', '333333'), expiresAt: Date.now() + 60_000, attempts: 0, createdAt: Date.now() } },
    { upsert: true },
  );
  const asB = await verifyLoginOtp('b@sowaka.test', '333333');
  check('someone nobody reports to signs in as an employee', asB.user.role === 'employee', asB.user.role);
  check('their manager is named', asB.user.managerName === 'Manav Manager', asB.user.managerName);
  check('their photo is its media path', asB.user.profilePhotoUrl === '/media/connect%2Fb.jpg', asB.user.profilePhotoUrl);

  // --- the tag picker: the whole company
  const company = await getTeammates('mgr', 500, 'company');
  const names = company.teammates.map((t) => t.userId);
  check('the company is everyone but the viewer, counsellors, leavers and other orgs', JSON.stringify(names) === JSON.stringify(['a', 'b', 'c', 'd', 'old']), names);
  check('an account with no org is found by its address', names.includes('old'));
  check('an inline photo is left behind', company.teammates.find((t) => t.userId === 'a')?.photoUrl === undefined);
  check('a stored photo is its media path', company.teammates.find((t) => t.userId === 'b')?.photoUrl === '/media/connect%2Fb.jpg');
  const limited = await getTeammates('mgr', 2, 'company');
  check('a page size cuts the list, not the total', limited.teammates.length === 2 && limited.total === 5, limited);
  const viewer = await users().findOne({ userId: 'mgr' });
  const preloaded = await getTeammates('mgr', 500, 'company', viewer ?? undefined);
  check('the preloaded viewer gives the same list', JSON.stringify(preloaded) === JSON.stringify(company));

  // --- the welcome screen: the team
  const team = await getTeammates('b', 12, 'team');
  check("a report's team: their manager first, then the department under them", JSON.stringify(team.teammates.map((t) => t.userId)) === JSON.stringify(['mgr', 'a']), team.teammates.map((t) => t.userId));
  check('the manager photo link comes through', team.teammates[0]?.photoUrl === 'https://cdn.test/mgr.jpg', team.teammates[0]);
  check('a team keeps an inline photo, as it always has', team.teammates[1]?.photoUrl === 'data:image/png;base64,AAAA', team.teammates[1]);
  const managersTeam = await getTeammates('mgr', 12, 'team');
  check("a manager's team is their reports", JSON.stringify(managersTeam.teammates.map((t) => t.userId)) === JSON.stringify(['a', 'b', 'c']), managersTeam.teammates.map((t) => t.userId));
  const loner = await getTeammates('counsellor', 12, 'team');
  check('no team and no department: no team section', loner.total === 0, loner);

  await db.dropDatabase();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
