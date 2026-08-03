import { webcrypto } from 'node:crypto';

// MongoDB's SCRAM auth relies on the Web Crypto global, which Node < 20 does not
// expose by default. Polyfill it before any driver connection runs. (Harmless on Node 20+.)
if (!globalThis.crypto) {
  (globalThis as typeof globalThis & { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
}

import { Collection, Db, MongoClient } from 'mongodb';
import { env } from './env';
import { AuthSessionDocument, OtpChallenge } from '../models/auth.model';
import { User } from '../models/user.model';
import { Leave } from '../models/leave.model';
import { Company } from '../models/company.model';
import { FeedbackRecord } from '../models/feedback.model';
import { Holiday } from '../models/holiday.model';
import { RecognitionNomination } from '../models/recognition.model';
import { OvertimeRequest } from '../models/overtime.model';
import { ReimbursementClaim } from '../models/reimbursement.model';
import { ConnectPost } from '../models/connect.model';
import { Game, GameScore } from '../models/game.model';
import { AppNotification, DeviceToken } from '../models/notification.model';
import { AttendanceRecord, AttendanceRegularization } from '../models/attendance.model';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDb(): Promise<Db> {
  if (db) return db;
  if (!env.mongoUri) {
    throw new Error('MONGODB_URI is not configured');
  }

  client = new MongoClient(env.mongoUri);
  await client.connect();
  db = client.db(env.mongoDbName);
  await ensureIndexes(db);
  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not connected. Call connectDb() first.');
  }
  return db;
}

export function otpChallenges(): Collection<OtpChallenge> {
  return getDb().collection<OtpChallenge>('otp_challenges');
}

export function authSessions(): Collection<AuthSessionDocument> {
  return getDb().collection<AuthSessionDocument>('auth_sessions');
}

export function users(): Collection<User> {
  return getDb().collection<User>('users');
}

export function leaves(): Collection<Leave> {
  return getDb().collection<Leave>('leaves');
}

export function companies(): Collection<Company> {
  return getDb().collection<Company>('companies');
}

export function holidays(): Collection<Holiday> {
  return getDb().collection<Holiday>('holidays');
}

export function feedbackRecords(): Collection<FeedbackRecord> {
  return getDb().collection<FeedbackRecord>('feedback_records');
}

export function recognitionNominations(): Collection<RecognitionNomination> {
  return getDb().collection<RecognitionNomination>('recognition_nominations');
}

export function overtimeRequests(): Collection<OvertimeRequest> {
  return getDb().collection<OvertimeRequest>('overtime_requests');
}

export function reimbursementClaims(): Collection<ReimbursementClaim> {
  return getDb().collection<ReimbursementClaim>('reimbursement_claims');
}

export function connectPosts(): Collection<ConnectPost> {
  return getDb().collection<ConnectPost>('connect_posts');
}

export function connectMedia(): Collection<{
  objectKey: string;
  contentType: string;
  size: number;
  bytes: Buffer;
  createdAt: Date;
}> {
  return getDb().collection('connect_media');
}

export function games(): Collection<Game> {
  return getDb().collection<Game>('games');
}

export function gameScores(): Collection<GameScore> {
  return getDb().collection<GameScore>('game_scores');
}

export function deviceTokens(): Collection<DeviceToken> {
  return getDb().collection<DeviceToken>('device_tokens');
}

export function notifications(): Collection<AppNotification> {
  return getDb().collection<AppNotification>('notifications');
}

export function attendanceRecords(): Collection<AttendanceRecord> {
  return getDb().collection<AttendanceRecord>('attendance_records');
}

export function attendanceRegularizations(): Collection<AttendanceRegularization> {
  return getDb().collection<AttendanceRegularization>('attendance_regularizations');
}

async function ensureIndexes(database: Db): Promise<void> {
  await database
    .collection<OtpChallenge>('otp_challenges')
    .createIndex({ email: 1 }, { unique: true });

  const sessionsCollection = database.collection<AuthSessionDocument>('auth_sessions');
  await sessionsCollection.createIndex({ tokenHash: 1 }, { unique: true });
  await sessionsCollection.createIndex({ userId: 1 });
  await sessionsCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  const usersCollection = database.collection<User>('users');
  // Legacy index from the earlier auth-only schema (keyed on `id`); replaced by `userId`.
  await usersCollection.dropIndex('id_1').catch(() => undefined);
  await usersCollection.createIndex({ email: 1 }, { unique: true });
  await usersCollection.createIndex({ userId: 1 }, { unique: true });
  await usersCollection.createIndex({ employeeId: 1 }, { unique: true, sparse: true });
  await usersCollection.createIndex({ managerUserId: 1 });
  await usersCollection.createIndex({ org: 1 });
  await usersCollection.createIndex({ department: 1 });

  const leavesCollection = database.collection<Leave>('leaves');
  await leavesCollection.createIndex({ userId: 1 });
  await leavesCollection.createIndex({ status: 1 });
  await leavesCollection.createIndex({ userId: 1, startDate: -1 });
  await leavesCollection.createIndex({ userId: 1, status: 1, startDate: 1, endDate: 1 });

  const feedbackCollection = database.collection<FeedbackRecord>('feedback_records');
  await feedbackCollection.createIndex(
    { managerUserId: 1, employeeUserId: 1, period: 1 },
    { unique: true },
  );
  await feedbackCollection.createIndex({ employeeUserId: 1, period: -1 });

  const nominationsCollection =
    database.collection<RecognitionNomination>('recognition_nominations');
  await nominationsCollection.createIndex(
    { managerUserId: 1, period: 1, category: 1 },
    { unique: true },
  );

  const overtimeCollection = database.collection<OvertimeRequest>('overtime_requests');
  await overtimeCollection.createIndex({ userId: 1, createdAt: -1 });
  await overtimeCollection.createIndex({ managerUserId: 1, status: 1, createdAt: -1 });

  const reimbursementCollection =
    database.collection<ReimbursementClaim>('reimbursement_claims');
  await reimbursementCollection.createIndex({ userId: 1, createdAt: -1 });
  await reimbursementCollection.createIndex({ managerUserId: 1, status: 1, createdAt: -1 });

  await database.collection<Company>('companies').createIndex({ id: 1 }, { unique: true });

  const holidaysCollection = database.collection<Holiday>('holidays');
  await holidaysCollection.dropIndex('org_1_date_1').catch(() => undefined);
  await holidaysCollection.createIndex({ org: 1, state: 1, date: 1 }, { unique: true });
  await holidaysCollection.createIndex({ org: 1, state: 1, date: -1 });

  const connectCollection = database.collection<ConnectPost>('connect_posts');
  await connectCollection.createIndex({ id: 1 }, { unique: true });
  await connectCollection.createIndex({ systemKey: 1 }, { unique: true, sparse: true });
  await connectCollection.createIndex({ org: 1, publishedAt: -1 });
  await connectCollection.createIndex({ org: 1, 'audience.department': 1, publishedAt: -1 });

  const gamesCollection = database.collection<Game>('games');
  await gamesCollection.createIndex({ id: 1 }, { unique: true });
  await gamesCollection.createIndex({ org: 1, active: 1, updatedAt: -1 });
  const scoresCollection = database.collection<GameScore>('game_scores');
  await scoresCollection.createIndex({ gameId: 1, userId: 1 }, { unique: true });
  await scoresCollection.createIndex({ gameId: 1, score: -1, achievedAt: 1 });

  const tokensCollection = database.collection<DeviceToken>('device_tokens');
  await tokensCollection.createIndex({ token: 1 }, { unique: true });
  await tokensCollection.createIndex({ userId: 1 });
  const notificationsCollection = database.collection<AppNotification>('notifications');
  await notificationsCollection.createIndex({ id: 1 }, { unique: true });
  await notificationsCollection.createIndex({ userId: 1, createdAt: -1 });
  await notificationsCollection.createIndex({ userId: 1, readAt: 1, createdAt: -1 });

  const attendanceCollection = database.collection<AttendanceRecord>('attendance_records');
  await attendanceCollection.createIndex({ sourceKey: 1 }, { unique: true });
  await attendanceCollection.createIndex({ userId: 1, workDate: 1 });
  await attendanceCollection.createIndex({ employeeId: 1, workDate: 1 });
  const regularizationsCollection =
    database.collection<AttendanceRegularization>('attendance_regularizations');
  await regularizationsCollection.createIndex({ userId: 1, workDate: 1, status: 1 });
  await regularizationsCollection.createIndex({ managerUserId: 1, status: 1, createdAt: -1 });
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
