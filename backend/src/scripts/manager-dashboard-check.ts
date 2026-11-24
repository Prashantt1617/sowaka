/**
 * Checks managers on the HR dashboard (24 Nov 2026): a manager sees and acts on their subtree only, may
 * assign KPIs HR set up but not set them up. On a scratch database only:
 *   npm run manager-dashboard:check
 * Tree: HR; M -> R1, R2; R2 -> R3; Boss -> O (an outsider).
 */
import { companies, connectDb, getDb, leaves, users } from '../config/db';
import type { User } from '../models/user.model';
import { dashboardGrantOf, MANAGER_TABS } from '../services/manager-scope';
import { runAsRequestUser } from '../services/request-user';
import { listAllEmployeesForAdmin } from '../services/admin.service';
import { leavesForAdmin } from '../services/timeOfficeLists';
import { attendanceReport } from '../services/attendance-report.service';
import { adminDecideLeave } from '../services/leave.service';
import { assignKpis, createKpiParameter } from '../services/kpi.service';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
const ORG = 'mgrco';
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId.toLowerCase()}@x.test`, org: ORG, lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
} as User);
const asM = <T>(fn: () => Promise<T>) => runAsRequestUser({ userId: 'M', org: ORG, teamScope: true }, fn);
const asHR = <T>(fn: () => Promise<T>) => runAsRequestUser({ userId: 'HR', org: ORG }, fn);
async function errorOf(fn: () => Promise<unknown>): Promise<{ statusCode?: number; name?: string; message?: string } | null> {
  try { await fn(); return null; } catch (e) { return e as { statusCode?: number; name?: string; message?: string }; }
}
const ids = (rows: Array<{ userId?: string }>) => new Set(rows.map((r) => r.userId));
const TEAM = ['M', 'R1', 'R2', 'R3'];

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await companies().insertOne({ id: ORG, name: 'Mgr Co', features: { managerDashboard: true } } as never);
  await users().insertMany([
    person('HR', { dashboardAccess: true, dashboardAdmin: true, canEditEmployeeDetails: true }),
    person('Boss'), person('M', { managerUserId: 'Boss' }),
    person('R1', { managerUserId: 'M' }), person('R2', { managerUserId: 'M' }), person('R3', { managerUserId: 'R2' }),
    person('O', { managerUserId: 'Boss' }),
  ]);
  const day = new Date(Date.now() + 10 * 86_400_000);
  const leaveOf = (userId: string, managerUserId: string) => ({
    userId, type: 'casual', startDate: day, endDate: day, days: 1, reason: 'x', status: 'pending', managerUserId, org: ORG, createdAt: new Date(),
  });
  const { insertedIds } = await leaves().insertMany([leaveOf('O', 'Boss'), leaveOf('R3', 'R2')] as never);
  const [leaveO, leaveR3] = [String(insertedIds[0]), String(insertedIds[1])];

  console.log('Grant');
  const grant = await dashboardGrantOf((await users().findOne({ userId: 'M' }))!);
  ok('M gets the manager tabs and team scope', grant.access && grant.teamScope && JSON.stringify(grant.tabs) === JSON.stringify([...MANAGER_TABS]), grant);
  const r1 = await dashboardGrantOf((await users().findOne({ userId: 'R1' }))!);
  ok('R1 (no reports) gets no dashboard', !r1.access, r1);

  console.log('Lists');
  const empM = ids(await asM(() => listAllEmployeesForAdmin('M', { seesDocuments: false, org: ORG })) as Array<{ userId?: string }>);
  ok('M\'s employee list is M, R1, R2, R3 only', TEAM.every((u) => empM.has(u)) && !empM.has('O') && !empM.has('Boss') && !empM.has('HR'), [...empM]);
  const empHR = ids(await asHR(() => listAllEmployeesForAdmin('HR', { seesDocuments: true, org: ORG })) as Array<{ userId?: string }>);
  ok('HR\'s employee list has everyone', ['HR', 'Boss', 'O', ...TEAM].every((u) => empHR.has(u)), [...empHR]);
  const lvM = ids(await asM(() => leavesForAdmin('M')) as Array<{ userId?: string }>);
  ok('M\'s leave list has R3\'s leave, not O\'s', lvM.has('R3') && !lvM.has('O'), [...lvM]);
  const lvHR = ids(await asHR(() => leavesForAdmin('HR')) as Array<{ userId?: string }>);
  ok('HR\'s leave list has both', lvHR.has('R3') && lvHR.has('O'), [...lvHR]);
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const from = `${today.slice(0, 8)}01`;
  const repM = await asM(() => attendanceReport('M', { from, to: today }));
  const peopleM = new Set(Object.keys(repM.people));
  ok('M\'s attendance report is the team', TEAM.every((u) => peopleM.has(u)) && !peopleM.has('O') && repM.days.every((d) => TEAM.includes(d[0])), [...peopleM]);
  const repHR = await asHR(() => attendanceReport('HR', { from, to: today }));
  ok('HR\'s attendance report has O', 'O' in repHR.people, Object.keys(repHR.people));

  console.log('Writes');
  const decideO = await errorOf(() => asM(() => adminDecideLeave('M', leaveO, { decision: 'approved' })));
  ok('M deciding O\'s leave is refused (403)', decideO?.statusCode === 403 && decideO.name === 'OutOfTeamError', decideO?.message);
  const decideR3 = await errorOf(() => asM(() => adminDecideLeave('M', leaveR3, { decision: 'approved' })));
  ok('M deciding R3\'s leave is allowed', decideR3 === null, decideR3?.message);
  const kpiO = await errorOf(() => asM(() => assignKpis('M', { userId: 'O', period: '2027-01', parameterIds: [] })));
  ok('M assigning a KPI to O is refused (team)', kpiO?.name === 'OutOfTeamError', kpiO?.message);
  const kpiR3 = await errorOf(() => asM(() => assignKpis('M', { userId: 'R3', period: '2027-01', parameterIds: [] })));
  ok('M assigning a KPI to R3 passes the team check (any error is the KPI set-up\'s own)', kpiR3?.name !== 'OutOfTeamError', kpiR3?.message);
  const param = await errorOf(() => asM(() => createKpiParameter('M', { title: 'Sales', description: 'x' })));
  ok('M creating a KPI parameter is refused (403)', param?.statusCode === 403, param?.message);
  const paramHR = await errorOf(() => asHR(() => createKpiParameter('HR', { title: 'Sales', description: 'x' })));
  ok('HR creating a KPI parameter works', paramHR === null, paramHR?.message);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
