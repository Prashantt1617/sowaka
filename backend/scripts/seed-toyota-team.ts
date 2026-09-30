/**
 * Toyota demo org: a Demo Admin with HR dashboard access, four team leads
 * reporting to them, and four people under each lead — with one birthday
 * and one work anniversary falling today, so the feed carries both cards.
 *
 *   npx tsx scripts/seed-toyota-team.ts
 *
 * Safe to re-run: people are upserted by email, and the lifecycle posts are
 * keyed by person and date, so nothing is duplicated.
 */
import { randomUUID } from 'node:crypto';
import { connectDb, users } from '../src/config/db';
import { User } from '../src/models/user.model';
import { generateDailyLifecyclePosts } from '../src/services/connect.service';

const ORG = 'toyota';
const LOCATION = 'Bengaluru';
const JOINED = new Date('2024-04-01T00:00:00Z');

type Person = {
  name: string; email: string; designation: string; department: string;
  role: 'manager' | 'employee'; dashboardAccess?: boolean;
  birthday?: Date; joiningDate?: Date; reportsTo?: string;
};

const ADMIN: Person = {
  name: 'Demo Admin', email: 'demo@tfsin.demo', designation: 'HR Admin',
  department: 'People & Culture', role: 'manager', dashboardAccess: true,
};

const LEADS: { lead: Person; team: Person[] }[] = [
  {
    lead: { name: 'Shailaja', email: 'shailaja@tfsin.demo', designation: 'Team Lead', department: 'Customer Care', role: 'manager', reportsTo: ADMIN.email },
    team: [
      // Turns a year wiser today, so the feed has a birthday card.
      { name: 'Meera Pillai', email: 'meera.pillai@tfsin.demo', designation: 'Customer Care Executive', department: 'Customer Care', role: 'employee', birthday: todayInYear(1995) },
      { name: 'Kiran Naidu', email: 'kiran.naidu@tfsin.demo', designation: 'Customer Care Executive', department: 'Customer Care', role: 'employee' },
      { name: 'Anjali Hegde', email: 'anjali.hegde@tfsin.demo', designation: 'Customer Care Executive', department: 'Customer Care', role: 'employee' },
      { name: 'Suresh Babu', email: 'suresh.babu@tfsin.demo', designation: 'Senior Executive', department: 'Customer Care', role: 'employee' },
    ],
  },
  {
    lead: { name: 'Gayatri', email: 'gayatri@tfsin.demo', designation: 'Team Lead', department: 'Collections', role: 'manager', reportsTo: ADMIN.email },
    team: [
      // Joined two years ago today, so the feed has an anniversary card.
      { name: 'Deepa Krishnan', email: 'deepa.krishnan@tfsin.demo', designation: 'Collections Officer', department: 'Collections', role: 'employee', joiningDate: todayInYear(2024) },
      { name: 'Manoj Reddy', email: 'manoj.reddy@tfsin.demo', designation: 'Collections Officer', department: 'Collections', role: 'employee' },
      { name: 'Lakshmi Gowda', email: 'lakshmi.gowda@tfsin.demo', designation: 'Collections Officer', department: 'Collections', role: 'employee' },
      { name: 'Ravi Shankar', email: 'ravi.shankar@tfsin.demo', designation: 'Senior Officer', department: 'Collections', role: 'employee' },
    ],
  },
  {
    lead: { name: 'Archana', email: 'archana@tfsin.demo', designation: 'Team Lead', department: 'Operations', role: 'manager', reportsTo: ADMIN.email },
    team: [
      { name: 'Nithya Raj', email: 'nithya.raj@tfsin.demo', designation: 'Operations Analyst', department: 'Operations', role: 'employee' },
      { name: 'Harish Kumar', email: 'harish.kumar@tfsin.demo', designation: 'Operations Analyst', department: 'Operations', role: 'employee' },
      { name: 'Divya Menon', email: 'divya.menon@tfsin.demo', designation: 'Operations Analyst', department: 'Operations', role: 'employee' },
      { name: 'Prakash Rao', email: 'prakash.rao@tfsin.demo', designation: 'Senior Analyst', department: 'Operations', role: 'employee' },
    ],
  },
  {
    lead: { name: 'Purushothama', email: 'purushothama@tfsin.demo', designation: 'Team Lead', department: 'Sales Finance', role: 'manager', reportsTo: ADMIN.email },
    team: [
      { name: 'Swathi Bhat', email: 'swathi.bhat@tfsin.demo', designation: 'Finance Executive', department: 'Sales Finance', role: 'employee' },
      { name: 'Ganesh Murthy', email: 'ganesh.murthy@tfsin.demo', designation: 'Finance Executive', department: 'Sales Finance', role: 'employee' },
      { name: 'Pooja Shetty', email: 'pooja.shetty@tfsin.demo', designation: 'Finance Executive', department: 'Sales Finance', role: 'employee' },
      { name: 'Vinay Kulkarni', email: 'vinay.kulkarni@tfsin.demo', designation: 'Senior Executive', department: 'Sales Finance', role: 'employee' },
    ],
  },
];

/** Today's month and day (IST) in the given year, as a UTC midnight date. */
function todayInYear(year: number): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '01';
  return new Date(`${year}-${part('month')}-${part('day')}T00:00:00.000Z`);
}

async function upsert(person: Person, managerUserId?: string): Promise<string> {
  const now = new Date();
  const existing = await users().findOne({ email: person.email });
  const userId = existing?.userId ?? randomUUID();
  const doc: Partial<User> = {
    userId,
    email: person.email,
    name: person.name,
    org: ORG,
    role: person.role,
    designation: person.designation,
    department: person.department,
    location: LOCATION,
    employeeType: 'full_time',
    lifecycleStatus: 'active',
    onboardingStatus: 'completed',
    noticeStatus: 'none',
    isLeadership: false,
    dashboardAccess: person.dashboardAccess ?? false,
    overtimeEligible: true,
    joiningDate: person.joiningDate ?? existing?.joiningDate ?? JOINED,
    ...(person.birthday ? { birthday: person.birthday } : {}),
    ...(managerUserId ? { managerUserId } : {}),
    updatedAt: now,
  };
  await users().updateOne(
    { email: person.email },
    { $set: doc, $setOnInsert: { createdAt: Date.now() } },
    { upsert: true },
  );
  console.log(`  ${existing ? 'kept   ' : 'created'} ${person.name} <${person.email}>${managerUserId ? '' : ' (HR access)'}`);
  return userId;
}

async function main() {
  await connectDb();
  console.log('Demo Admin');
  const adminId = await upsert(ADMIN);
  for (const { lead, team } of LEADS) {
    console.log(`${lead.name}'s team`);
    const leadId = await upsert(lead, adminId);
    for (const member of team) await upsert(member, leadId);
  }
  console.log('Today\'s birthday and anniversary cards');
  await generateDailyLifecyclePosts();
  console.log('done');
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
