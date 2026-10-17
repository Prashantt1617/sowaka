/**
 * Checks Edit details on the dashboard: who may edit whose profile
 * (`User.canEditEmployeeDetails`: themselves and everyone below them), what a
 * save writes, and what it refuses. On a scratch database only:
 *   MONGODB_DB=employee_details_scratch npx tsx src/scripts/employee-details-check.ts
 */
import { connectDb, getDb, users } from '../config/db';
import type { User } from '../models/user.model';
import { AdminError, listAllEmployeesForAdmin, updateEmployeeDetailsForAdmin } from '../services/admin.service';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
async function refused(label: string, status: number, run: () => Promise<unknown>) {
  try {
    await run();
    ok(label, false, 'saved');
  } catch (error) {
    ok(label, error instanceof AdminError && error.statusCode === status, error instanceof Error ? error.message : error);
  }
}

const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@x.test`, org: 'acme', lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
} as User);

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany([
    person('founder', { canEditEmployeeDetails: true, dashboardAccess: true, employeeId: 'F1' }),
    person('staff', { managerUserId: 'founder', employeeId: 'S1' }),
    person('trainee', { managerUserId: 'staff', employeeId: 'T1' }),
    person('peer'),
    person('hr', { dashboardAccess: true }),
    person('other-org', { org: 'elsewhere', managerUserId: 'founder' }),
  ]);
  const get = (userId: string) => users().findOne({ userId }) as Promise<User>;

  console.log('who may edit');
  await refused('without the right: refused', 403, () => updateEmployeeDetailsForAdmin('hr', 'staff', { designation: 'X' }));
  await refused('someone outside their reporting line: refused', 403, () => updateEmployeeDetailsForAdmin('founder', 'peer', { designation: 'X' }));
  await refused('someone in another company: not found', 404, () => updateEmployeeDetailsForAdmin('founder', 'other-org', { designation: 'X' }));
  await updateEmployeeDetailsForAdmin('founder', 'founder', { designation: 'Founder & CEO' });
  ok('their own details', (await get('founder')).designation === 'Founder & CEO');
  await updateEmployeeDetailsForAdmin('founder', 'trainee', { department: 'Site' });
  ok('a report of a report', (await get('trainee')).department === 'Site');

  console.log('what a save writes');
  const result = await updateEmployeeDetailsForAdmin('founder', 'staff', {
    name: '  Pradip  K Parmar ', email: 'Pradip@CDE.test', employeeId: 'S2', joiningDate: '2024-06-03',
    birthday: '1990-02-14', mobile: '+91 98765 43210', gender: 'Male', designation: 'Engineer',
    department: 'Projects', location: 'Ahmedabad', employeeType: 'contract', isDirector: true,
  });
  const staff = await get('staff');
  ok('every field saved', staff.name === 'Pradip  K Parmar' && staff.email === 'pradip@cde.test' && staff.employeeId === 'S2'
    && staff.joiningDate?.toISOString().startsWith('2024-06-03') === true && staff.birthday?.toISOString().startsWith('1990-02-14') === true
    && staff.phone === '+91 98765 43210' && staff.gender === 'Male' && staff.designation === 'Engineer'
    && staff.department === 'Projects' && staff.location === 'Ahmedabad' && staff.employeeType === 'contract' && staff.isDirector === true, staff);
  ok('it says what changed', result.changed.includes('email') && result.changed.includes('isDirector'), result.changed);
  ok('the manager is untouched', staff.managerUserId === 'founder');
  await updateEmployeeDetailsForAdmin('founder', 'staff', { designation: 'Site engineer' });
  const again = await get('staff');
  ok('fields left out stay as they are', again.designation === 'Site engineer' && again.department === 'Projects' && again.phone === '+91 98765 43210');
  await updateEmployeeDetailsForAdmin('founder', 'staff', { mobile: '', birthday: '', employeeId: '' });
  const cleared = await get('staff');
  ok('an empty optional field clears it', cleared.phone === undefined && cleared.birthday === undefined && cleared.employeeId === undefined, cleared);
  const listed = (await listAllEmployeesForAdmin('founder')).find((e) => e.userId === 'staff');
  ok('the directory shows gender and director', listed?.gender === 'Male' && listed?.isDirector === true, listed);

  console.log('what it refuses');
  await refused('an email someone else has', 409, () => updateEmployeeDetailsForAdmin('founder', 'trainee', { email: 'PEER@x.test' }));
  await refused('an employee ID someone else has', 409, () => updateEmployeeDetailsForAdmin('founder', 'trainee', { employeeId: 'F1' }));
  await refused('an empty name', 400, () => updateEmployeeDetailsForAdmin('founder', 'trainee', { name: '  ' }));
  await refused('an invalid email', 400, () => updateEmployeeDetailsForAdmin('founder', 'trainee', { email: 'nope' }));
  await refused('no joining date', 400, () => updateEmployeeDetailsForAdmin('founder', 'trainee', { joiningDate: '' }));
  await refused('a bad date', 400, () => updateEmployeeDetailsForAdmin('founder', 'trainee', { birthday: '14/02/1990' }));
  await refused('an unknown employee type', 400, () => updateEmployeeDetailsForAdmin('founder', 'trainee', { employeeType: 'boss' }));
  await updateEmployeeDetailsForAdmin('founder', 'trainee', { email: 'TRAINEE@x.test', employeeId: 'T1' });
  ok('their own email and ID again is fine', (await get('trainee')).email === 'trainee@x.test');

  await db.dropDatabase();
  console.log(`\n${failed ? `${failed} failed, ` : 'all '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
