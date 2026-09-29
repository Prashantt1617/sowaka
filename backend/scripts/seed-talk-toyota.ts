// Talk, first company: Toyota gets every tab including Care and Talk, a few
// people to sign in as, and Kritik and Tanvi become the counsellor pool.
//
//   npx tsx scripts/seed-talk-toyota.ts
//
// Safe to re-run: everything is an upsert or a set to the same value. This is
// what the Sowaka control dashboard will do from a screen later; until then
// it is this file.
import { randomUUID } from 'node:crypto';
import { companies, connectDb, gardenNotes, users } from '../src/config/db';
import { GardenNote } from '../src/models/garden.model';
import { currentSeason } from '../src/services/garden.service';
import { AppTab } from '../src/models/company.model';
import { CounsellorProfile, User } from '../src/models/user.model';

const ORG = 'toyota';
const ALL_TABS: AppTab[] = ['connect', 'team', 'games', 'care', 'talk'];

const WEEKDAY_HOURS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '10:00', end: '18:00' }));

const COUNSELLORS: { email: string; headline: string }[] = [
  { email: '7009981594kritik@gmail.com', headline: 'Workplace wellbeing' },
  { email: 'tanvi@getsowaka.com', headline: 'Stress and burnout' },
];

// name@toyota.in, as asked. The first is a manager the rest report to, so the
// Team tab has something to show as well.
const PEOPLE: { name: string; email: string; designation: string; department: string; role: 'manager' | 'employee' }[] = [
  { name: 'Arjun Mehta', email: 'arjun@toyota.in', designation: 'Plant HR Lead', department: 'People', role: 'manager' },
  { name: 'Priya Nair', email: 'priya@toyota.in', designation: 'Quality Engineer', department: 'Quality', role: 'employee' },
  { name: 'Rohan Iyer', email: 'rohan@toyota.in', designation: 'Line Supervisor', department: 'Production', role: 'employee' },
  { name: 'Sneha Rao', email: 'sneha@toyota.in', designation: 'Supply Analyst', department: 'Supply Chain', role: 'employee' },
  { name: 'Vikram Desai', email: 'vikram@toyota.in', designation: 'Service Advisor', department: 'After Sales', role: 'employee' },
];

async function main() {
  await connectDb();
  const now = new Date();

  // 1. The company, with every tab.
  await companies().updateOne(
    { id: ORG },
    {
      $set: { name: 'Toyota', enabledTabs: ALL_TABS, updatedAt: now },
      $setOnInsert: { id: ORG, weekoffDays: [0], createdAt: Date.now() },
    },
    { upsert: true },
  );
  console.log(`company ${ORG}: tabs ${ALL_TABS.join(', ')}`);

  // 2. The people.
  let managerUserId: string | undefined;
  for (const person of PEOPLE) {
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
      location: 'Bengaluru',
      employeeType: 'full_time',
      lifecycleStatus: 'active',
      onboardingStatus: 'completed',
      noticeStatus: 'none',
      isLeadership: false,
      dashboardAccess: person.role === 'manager',
      overtimeEligible: true,
      joiningDate: new Date('2024-04-01T00:00:00Z'),
      updatedAt: now,
      ...(person.role === 'employee' && managerUserId ? { managerUserId } : {}),
    };
    await users().updateOne(
      { email: person.email },
      { $set: doc, $setOnInsert: { createdAt: Date.now() } },
      { upsert: true },
    );
    if (person.role === 'manager') managerUserId = userId;
    console.log(`  ${existing ? 'kept   ' : 'created'} ${person.name} <${person.email}>`);
  }

  // 3. The counsellors.
  for (const { email, headline } of COUNSELLORS) {
    const row = await users().findOne({ email });
    if (!row) {
      console.log(`  ! no user ${email}; not made a counsellor`);
      continue;
    }
    const profile: CounsellorProfile = {
      // Empty: they have no Zoom user of their own yet, so the account's host
      // (ZOOM_HOST_USER) creates their meetings.
      zoomUserId: '',
      workingHours: row.counsellor?.workingHours?.length ? row.counsellor.workingHours : WEEKDAY_HOURS,
      slotMinutes: row.counsellor?.slotMinutes ?? 50,
      timezone: row.counsellor?.timezone ?? 'Asia/Kolkata',
      headline: row.counsellor?.headline ?? headline,
    };
    await users().updateOne({ email }, { $set: { isCounsellor: true, counsellor: profile, updatedAt: now } });
    console.log(`  counsellor ${row.name} <${email}> · ${profile.workingHours.length} days · ${profile.slotMinutes} min`);
  }
  // 4. A few notes in the garden, so the first open is not an empty meadow.
  // Only when the season has none: re-running never doubles them up.
  const season = currentSeason();
  const existing = await gardenNotes().countDocuments({ org: ORG, season });
  if (existing === 0) {
    const byEmail = new Map<string, string>();
    for (const person of PEOPLE) {
      const row = await users().findOne({ email: person.email });
      if (row) byEmail.set(person.email, row.userId);
    }
    const id = (email: string) => byEmail.get(email)!;
    const samples: Array<[string, string, GardenNote['kind'], string]> = [
      ['sneha@toyota.in', 'rohan@toyota.in', 'hibiscus', 'Covered the late shift so I could get to my daughter’s school thing.'],
      ['arjun@toyota.in', 'priya@toyota.in', 'apple', 'Your root-cause write-up taught the whole line something.'],
      ['vikram@toyota.in', 'sneha@toyota.in', 'orange', 'The Monday huddle had energy again because of you.'],
      ['priya@toyota.in', 'arjun@toyota.in', 'tulip', 'Thanks for the loaner laptop, no questions asked.'],
      ['rohan@toyota.in', 'priya@toyota.in', 'sunflower', 'Every shift is warmer with you on it.'],
      ['sneha@toyota.in', 'vikram@toyota.in', 'grapes', 'You got the two teams talking to each other.'],
      ['arjun@toyota.in', 'sneha@toyota.in', 'lotus', 'Calm on the audit day when nobody else was.'],
      ['vikram@toyota.in', 'priya@toyota.in', 'mango', 'Stayed past close to get the delivery out. Extra mile, truly.'],
    ];
    const base = Date.now() - 6 * 3_600_000;
    let n = 0;
    for (const [from, to, kind, note] of samples) {
      if (!byEmail.has(from) || !byEmail.has(to)) continue;
      await gardenNotes().insertOne({
        id: randomUUID(), org: ORG, fromUserId: id(from), toUserId: id(to), kind, note, season,
        createdAt: new Date(base + n * 37 * 60_000),
      });
      n += 1;
    }
    console.log(`garden: ${n} notes planted for ${season}`);
  } else {
    console.log(`garden: ${existing} notes already this season, left alone`);
  }
  process.exit(0);
}

void main();
