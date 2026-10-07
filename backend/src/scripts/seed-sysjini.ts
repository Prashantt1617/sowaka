import crypto from 'node:crypto';
import { closeDb, companies, connectDb, users } from '../config/db';
import { User } from '../models/user.model';
import { assignManager } from '../services/reporting.service';
import { logger } from '../utils/logger';

const companyId = 'sysjini';
const employeeEmail = 'prithvirajtiwari28@gmail.com';
const managerEmail = 'prithvi.raj@sysjini.in';

async function seed(): Promise<void> {
  await connectDb();
  const now = new Date();

  await companies().updateOne(
    { id: companyId },
    {
      $set: { name: 'sysjini', updatedAt: now },
      $setOnInsert: { id: companyId, createdAt: Date.now() },
    },
    { upsert: true },
  );

  const employee = createUser({
    email: employeeEmail,
    name: 'Prithviraj Tiwari',
    employeeId: 'SYS-001',
    role: 'employee',
    designation: 'Software Engineer',
    department: 'Engineering',
    location: 'Bengaluru, India',
    state: 'karnataka',
    joiningDate: new Date('2024-06-10T00:00:00.000Z'),
    birthday: new Date('1998-08-18T00:00:00.000Z'),
    teamDescription: 'Building reliable products and internal platforms for Sysjini.',
    recognition: { label: 'Rising Star', period: 'Q2 2026' },
  });
  const manager = createUser({
    email: managerEmail,
    name: 'Prithvi Raj',
    employeeId: 'SYS-002',
    role: 'manager',
    designation: 'Engineering Manager',
    department: 'Engineering',
    location: 'Bengaluru, India',
    state: 'karnataka',
    joiningDate: new Date('2022-01-17T00:00:00.000Z'),
    birthday: new Date('1992-03-12T00:00:00.000Z'),
    teamDescription: 'A product engineering team focused on dependable, human-centred software.',
    recognition: { label: 'People Champion', period: 'Q2 2026' },
  });

  for (const user of [employee, manager]) {
    await users().updateOne(
      { email: user.email },
      {
        $set: {
          userId: user.userId,
          employeeId: user.employeeId,
          name: user.name,
          email: user.email,
          lifecycleStatus: user.lifecycleStatus,
          onboardingStatus: user.onboardingStatus,
          role: user.role,
          org: user.org,
          location: user.location,
          state: user.state,
          designation: user.designation,
          department: user.department,
          teamDescription: user.teamDescription,
          employeeType: user.employeeType,
          joiningDate: user.joiningDate,
          birthday: user.birthday,
          recognition: user.recognition,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: Date.now() },
      },
      { upsert: true },
    );
  }

  // The manager acts as the one making the change: same company, so it is allowed.
  await assignManager(manager.userId, employee.userId, manager.userId);

  logger.info('Sysjini seed completed', {
    companyId,
    employeeUserId: employee.userId,
    managerUserId: manager.userId,
  });
}

function createUser(input: {
  email: string;
  name: string;
  employeeId: string;
  role: 'manager' | 'employee';
  designation: string;
  department: string;
  location: string;
  state: string;
  joiningDate: Date;
  birthday: Date;
  teamDescription: string;
  recognition: { label: string; period: string };
}): User {
  return {
    ...input,
    userId: crypto.createHash('sha1').update(input.email).digest('hex').slice(0, 12),
    lifecycleStatus: 'active',
    onboardingStatus: 'completed',
    noticeStatus: 'none',
    employeeType: 'full_time',
    org: companyId,
  };
}

seed()
  .catch((error) => {
    logger.error('Sysjini seed failed', {}, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
