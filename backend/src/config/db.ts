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
import { Office } from '../models/office.model';
import { Leave } from '../models/leave.model';
import { Company } from '../models/company.model';
import { FeedbackRecord } from '../models/feedback.model';
import { Holiday } from '../models/holiday.model';
import { RecognitionNomination } from '../models/recognition.model';
import { OvertimeRequest } from '../models/overtime.model';
import { ReimbursementClaim } from '../models/reimbursement.model';
import { ConnectPost } from '../models/connect.model';
import { Game, GameScore } from '../models/game.model';
import { GameCatalogEntry } from '../models/game-catalog.model';
import { GameChallenge } from '../models/game-challenge.model';
import {
  RelayEvent,
  RelayPresence,
  RelayItem,
  RelayTeam,
  RelayTeamProgress,
} from '../models/relay.model';
import { AppNotification, DeviceToken } from '../models/notification.model';
import { AttendanceOverride, AttendanceRecord, AttendanceRegularization } from '../models/attendance.model';
import { PayHead } from '../models/payHead.model';
import { StateStatutoryRule } from '../models/statutoryRule.model';
import { SalaryStructure } from '../models/salaryStructure.model';
import { SalaryTemplate } from '../models/salaryTemplate.model';
import { PayrollRun, Payslip } from '../models/payrollRun.model';
import { KpiAssignment, KpiParameter, KpiTemplate } from '../models/kpi.model';
import { LeaveYearEnd, OrgShiftPolicy, ShiftAssignment, ShiftTemplate } from '../models/shift.model';
import { ReimbursementType } from '../models/reimbursement-type.model';
import { ConnectBlock, ContentReport } from '../models/moderation.model';
import { TalkSession } from '../models/talk.model';
import { GardenNote } from '../models/garden.model';
import { CareWriting, JournalEntry, PairQuiz } from '../models/care.model';
import { SupportEvent, SupportMessage, SupportTicket } from '../models/support.model';
import { PolicyDocument } from '../models/policy-document.model';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDb(): Promise<Db> {
  if (db) return db;
  if (!env.mongoUri) {
    throw new Error('MONGODB_URI is not configured');
  }

  // Compress the wire. Every result set crosses a link that has measured
  // anywhere from 300ms to 45s for the same 1,400 documents; sending fewer
  // bytes is the one lever that helps whatever the link is doing. zlib is
  // built into Node, so nothing native to install, and Atlas negotiates it.
  client = new MongoClient(env.mongoUri, { compressors: ['zlib'] });
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

export function contentReports(): Collection<ContentReport> {
  return getDb().collection<ContentReport>('content_reports');
}

export function connectBlocks(): Collection<ConnectBlock> {
  return getDb().collection<ConnectBlock>('connect_blocks');
}

export function games(): Collection<Game> {
  return getDb().collection<Game>('games');
}

export function gameScores(): Collection<GameScore> {
  return getDb().collection<GameScore>('game_scores');
}

/** The Games tab's games, one document per game; see GameCatalogEntry. */
export function gameCatalog(): Collection<GameCatalogEntry> {
  return getDb().collection<GameCatalogEntry>('game_catalog');
}

/** Each company's policies as the app shows them, one document per policy; see PolicyDocument. */
export function policyDocuments(): Collection<PolicyDocument> {
  return getDb().collection<PolicyDocument>('policy_documents');
}

/** Colleagues challenging each other to a catalog game; see GameChallenge. */
export function gameChallenges(): Collection<GameChallenge> {
  return getDb().collection<GameChallenge>('game_challenges');
}

export function relayEvents(): Collection<RelayEvent> {
  return getDb().collection<RelayEvent>('relay_events');
}

export function relayTeams(): Collection<RelayTeam> {
  return getDb().collection<RelayTeam>('relay_teams');
}

export function relayItems(): Collection<RelayItem> {
  return getDb().collection<RelayItem>('relay_items');
}

export function relayProgress(): Collection<RelayTeamProgress> {
  return getDb().collection<RelayTeamProgress>('relay_progress');
}

export function relayPresence(): Collection<RelayPresence> {
  return getDb().collection<RelayPresence>('relay_presence');
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

export function shiftTemplates(): Collection<ShiftTemplate> {
  return getDb().collection<ShiftTemplate>('shift_templates');
}

export function shiftAssignments(): Collection<ShiftAssignment> {
  return getDb().collection<ShiftAssignment>('shift_assignments');
}

export function offices(): Collection<Office> {
  return getDb().collection<Office>('offices');
}

export function shiftPolicies(): Collection<OrgShiftPolicy> {
  return getDb().collection<OrgShiftPolicy>('shift_policies');
}

export function leaveYearEnds(): Collection<LeaveYearEnd> {
  return getDb().collection<LeaveYearEnd>('leave_year_ends');
}

export function reimbursementTypes(): Collection<ReimbursementType> {
  return getDb().collection<ReimbursementType>('reimbursement_types');
}

export function payHeads(): Collection<PayHead> {
  return getDb().collection<PayHead>('pay_heads');
}

export function attendanceOverrides(): Collection<AttendanceOverride> {
  return getDb().collection<AttendanceOverride>('attendance_overrides');
}

export function statutoryRules(): Collection<StateStatutoryRule> {
  return getDb().collection<StateStatutoryRule>('statutory_rules');
}

export function salaryStructures(): Collection<SalaryStructure> {
  return getDb().collection<SalaryStructure>('salary_structures');
}

export function salaryTemplates(): Collection<SalaryTemplate> {
  return getDb().collection<SalaryTemplate>('salary_templates');
}

export function payrollRuns(): Collection<PayrollRun> {
  return getDb().collection<PayrollRun>('payroll_runs');
}

export function payslips(): Collection<Payslip> {
  return getDb().collection<Payslip>('payslips');
}

export function kpiParameters(): Collection<KpiParameter> {
  return getDb().collection<KpiParameter>('kpi_parameters');
}

export function kpiTemplates(): Collection<KpiTemplate> {
  return getDb().collection<KpiTemplate>('kpi_templates');
}

export function kpiAssignments(): Collection<KpiAssignment> {
  return getDb().collection<KpiAssignment>('kpi_assignments');
}

export function talkSessions(): Collection<TalkSession> {
  return getDb().collection<TalkSession>('talk_sessions');
}

export function gardenNotes(): Collection<GardenNote> {
  return getDb().collection<GardenNote>('gratitude_notes');
}

export function journalEntries(): Collection<JournalEntry> {
  return getDb().collection<JournalEntry>('care_journal_entries');
}

/** One document per catalogue: `{ id: 'catalog', ...CareCatalog }`. */
export function careContent(): Collection<{ id: string } & Record<string, unknown>> {
  return getDb().collection('care_content');
}

export function pairQuizzes(): Collection<PairQuiz> {
  return getDb().collection<PairQuiz>('care_pair_quizzes');
}

export function careWritings(): Collection<CareWriting> {
  return getDb().collection<CareWriting>('care_writings');
}

/** Support desk: one row per ticket an employee raises. */
export function supportTickets(): Collection<SupportTicket> {
  return getDb().collection<SupportTicket>('support_tickets');
}

/** Support desk: the thread of each ticket. */
export function supportMessages(): Collection<SupportMessage> {
  return getDb().collection<SupportMessage>('support_messages');
}

/** Support desk: append-only audit trail of each ticket. */
export function supportEvents(): Collection<SupportEvent> {
  return getDb().collection<SupportEvent>('support_events');
}

/** Support desk: one running ticket number per org. */
export function supportCounters(): Collection<{ org: string; seq: number }> {
  return getDb().collection<{ org: string; seq: number }>('support_counters');
}

async function ensureIndexes(database: Db): Promise<void> {
  // One HR mark per person per day; the calendars read them by person and range.
  await database.collection('attendance_overrides').createIndex({ org: 1, userId: 1, workDate: 1 }, { unique: true });
  await database
    .collection<OtpChallenge>('otp_challenges')
    .createIndex({ email: 1 }, { unique: true });

  const sessionsCollection = database.collection<AuthSessionDocument>('auth_sessions');
  await sessionsCollection.createIndex({ tokenHash: 1 }, { unique: true });
  await sessionsCollection.createIndex({ userId: 1 });
  await sessionsCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  const talk = database.collection<TalkSession>('talk_sessions');
  await talk.createIndex({ id: 1 }, { unique: true });
  // A counsellor's slot is taken once: the same start twice is refused at the
  // index, not only by the check that runs before it.
  await talk.createIndex(
    { counsellorUserId: 1, startsAt: 1 },
    { unique: true, partialFilterExpression: { status: 'booked' } },
  );
  await talk.createIndex({ clientUserId: 1, startsAt: -1 });

  const garden = database.collection<GardenNote>('gratitude_notes');
  await garden.createIndex({ id: 1 }, { unique: true });
  // The garden and the timeline are one read per company per season; a tree
  // is one read per person.
  await garden.createIndex({ org: 1, season: 1, createdAt: -1 });
  await garden.createIndex({ toUserId: 1, season: 1 });
  await garden.createIndex({ fromUserId: 1, createdAt: -1 });

  const writings = database.collection<CareWriting>('care_writings');
  await writings.createIndex({ id: 1 }, { unique: true });
  // One piece of writing per person per key; a letter has its own key.
  await writings.createIndex({ userId: 1, key: 1 }, { unique: true });
  await database.collection('care_content').createIndex({ id: 1 }, { unique: true });
  // One quiz of each kind per person; a partner finds it by its link.
  const pairs = database.collection<PairQuiz>('care_pair_quizzes');
  await pairs.createIndex({ userId: 1, kind: 1 }, { unique: true });
  await pairs.createIndex({ code: 1 }, { unique: true });

  const journal = database.collection<JournalEntry>('care_journal_entries');
  await journal.createIndex({ id: 1 }, { unique: true });
  // A person's week, oldest first; the digest walks every person the same way.
  await journal.createIndex({ userId: 1, createdAt: 1 });

  const supportTicketsCollection = database.collection<SupportTicket>('support_tickets');
  await supportTicketsCollection.createIndex({ id: 1 }, { unique: true });
  await supportTicketsCollection.createIndex({ org: 1, ticketNo: 1 }, { unique: true });
  await database.collection('support_counters').createIndex({ org: 1 }, { unique: true });
  // A head's New / Assigned / All lists.
  await supportTicketsCollection.createIndex({ org: 1, status: 1, lastMessageAt: -1 });
  // Each desk, and the sweep that returns a departed assignee's tickets.
  await supportTicketsCollection.createIndex({ org: 1, assigneeUserId: 1, status: 1 });
  // The app's list of one's own tickets.
  await supportTicketsCollection.createIndex({ requesterUserId: 1, lastMessageAt: -1 });
  const supportMessagesCollection = database.collection<SupportMessage>('support_messages');
  await supportMessagesCollection.createIndex({ id: 1 }, { unique: true });
  await supportMessagesCollection.createIndex({ ticketId: 1, createdAt: 1 });
  const supportEventsCollection = database.collection<SupportEvent>('support_events');
  await supportEventsCollection.createIndex({ id: 1 }, { unique: true });
  await supportEventsCollection.createIndex({ ticketId: 1, createdAt: 1 });

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

  const reportsCollection = database.collection<ContentReport>('content_reports');
  await reportsCollection.createIndex({ id: 1 }, { unique: true });
  await reportsCollection.createIndex({ org: 1, status: 1, createdAt: -1 });
  // One open report per person per piece of content: reporting twice should
  // not put the same complaint in HR's queue twice. `commentId` is absent on
  // post reports, and a sparse-free compound index treats that as null, which
  // is exactly the distinction wanted.
  await reportsCollection.createIndex({ reporterUserId: 1, postId: 1, commentId: 1 });

  const blocksCollection = database.collection<ConnectBlock>('connect_blocks');
  await blocksCollection.createIndex({ userId: 1, blockedUserId: 1 }, { unique: true });
  await blocksCollection.createIndex({ userId: 1, createdAt: -1 });

  const gamesCollection = database.collection<Game>('games');
  await gamesCollection.createIndex({ id: 1 }, { unique: true });
  await gamesCollection.createIndex({ org: 1, active: 1, updatedAt: -1 });
  const scoresCollection = database.collection<GameScore>('game_scores');
  await scoresCollection.createIndex({ gameId: 1, userId: 1 }, { unique: true });
  await scoresCollection.createIndex({ gameId: 1, score: -1, achievedAt: 1 });
  await database.collection<GameCatalogEntry>('game_catalog').createIndex({ key: 1 }, { unique: true });
  // One document per policy per company, and how a company's are found.
  await database.collection<PolicyDocument>('policy_documents').createIndex({ org: 1, key: 1 }, { unique: true });
  const challengesCollection = database.collection<GameChallenge>('game_challenges');
  await challengesCollection.createIndex({ id: 1 }, { unique: true });
  // Each player's list, newest first, and the counts that cap open challenges.
  await challengesCollection.createIndex({ challengerUserId: 1, status: 1, createdAt: -1 });
  await challengesCollection.createIndex({ opponentUserId: 1, status: 1, createdAt: -1 });
  // The sweep that expires what nobody finished in time.
  await challengesCollection.createIndex({ status: 1, expiresAt: 1 });
  // What each player has already been paid today, for the daily and same-pair caps.
  await challengesCollection.createIndex({ 'awards.userId': 1, gameKey: 1, closedAt: -1 });

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

  const payHeadsCollection = database.collection<PayHead>('pay_heads');
  // Codes are the stable reference used by Salary Structures, unique per org.
  await payHeadsCollection.createIndex({ org: 1, code: 1 }, { unique: true });
  await payHeadsCollection.createIndex({ org: 1, category: 1, name: 1 });

  const statutoryRulesCollection = database.collection<StateStatutoryRule>('statutory_rules');
  // One rule set per org per state; the payroll run resolves by (org, state).
  await statutoryRulesCollection.createIndex({ org: 1, state: 1 }, { unique: true });

  const salaryStructuresCollection = database.collection<SalaryStructure>('salary_structures');
  // One salary structure per employee in v1 (Salary Revision history comes later).
  await salaryStructuresCollection.createIndex({ org: 1, userId: 1 }, { unique: true });

  const salaryTemplatesCollection = database.collection<SalaryTemplate>('salary_templates');
  // Template codes are the stable reference used by Salary Structures, unique per org.
  await salaryTemplatesCollection.createIndex({ org: 1, code: 1 }, { unique: true });

  const payrollRunsCollection = database.collection<PayrollRun>('payroll_runs');
  // One run per org per period (a rejected run is replaced on recreate).
  await payrollRunsCollection.createIndex({ org: 1, period: 1 }, { unique: true });
  await payrollRunsCollection.createIndex({ org: 1, status: 1, period: -1 });

  const kpiParametersCollection = database.collection<KpiParameter>('kpi_parameters');
  await kpiParametersCollection.createIndex({ org: 1, archived: 1, title: 1 });

  const kpiTemplatesCollection = database.collection<KpiTemplate>('kpi_templates');
  await kpiTemplatesCollection.createIndex({ org: 1, name: 1 }, { unique: true });

  const shiftTemplatesCollection = database.collection<ShiftTemplate>('shift_templates');
  await shiftTemplatesCollection.createIndex({ org: 1, name: 1 }, { unique: true });
  await shiftTemplatesCollection.createIndex({ org: 1, active: 1, isDefault: -1 });

  // Assignment history: "which template covered this employee on this date".
  const shiftAssignmentsCollection = database.collection<ShiftAssignment>('shift_assignments');
  await shiftAssignmentsCollection.createIndex({ userId: 1, effectiveFrom: -1 });
  await shiftAssignmentsCollection.createIndex({ org: 1, effectiveFrom: -1 });

  // One policy document per org — the Shifts › Policies setup.
  const shiftPoliciesCollection = database.collection<OrgShiftPolicy>('shift_policies');
  await shiftPoliciesCollection.createIndex({ org: 1 }, { unique: true });

  const reimbursementTypesCollection = database.collection<ReimbursementType>('reimbursement_types');
  await reimbursementTypesCollection.createIndex({ org: 1, name: 1 }, { unique: true });

  // One row per employee, per leave type, per closed year.
  const leaveYearEndsCollection = database.collection<LeaveYearEnd>('leave_year_ends');
  await leaveYearEndsCollection.createIndex({ org: 1, userId: 1, year: 1, type: 1 }, { unique: true });

  const kpiAssignmentsCollection = database.collection<KpiAssignment>('kpi_assignments');
  // One assignment per employee per cycle; re-assigning replaces it.
  await kpiAssignmentsCollection.createIndex({ org: 1, userId: 1, period: 1 }, { unique: true });
  await kpiAssignmentsCollection.createIndex({ org: 1, period: 1 });

  const payslipsCollection = database.collection<Payslip>('payslips');
  await payslipsCollection.createIndex({ org: 1, runId: 1 });
  await payslipsCollection.createIndex({ userId: 1, period: -1 });

  const relayEventsCollection = database.collection<RelayEvent>('relay_events');
  await relayEventsCollection.createIndex({ id: 1 }, { unique: true });
  await relayEventsCollection.createIndex({ org: 1, updatedAt: -1 });
  const relayTeamsCollection = database.collection<RelayTeam>('relay_teams');
  await relayTeamsCollection.createIndex({ id: 1 }, { unique: true });
  // One team per key per event: re-importing a roster replaces it rather than doubling it.
  await relayTeamsCollection.createIndex({ eventId: 1, teamKey: 1 }, { unique: true });
  await relayTeamsCollection.createIndex({ eventId: 1, 'members.userId': 1 });
  const relayItemsCollection = database.collection<RelayItem>('relay_items');
  await relayItemsCollection.createIndex({ id: 1 }, { unique: true });
  // Items belong to the event and are shared across teams, read a round at a time.
  await relayItemsCollection.createIndex({ eventId: 1, round: 1 });
  const relayProgressCollection = database.collection<RelayTeamProgress>('relay_progress');
  await relayProgressCollection.createIndex({ eventId: 1, teamId: 1 }, { unique: true });
  await relayProgressCollection.createIndex({ eventId: 1, totalPoints: -1, totalSecondsUsed: 1 });
  const relayPresenceCollection = database.collection<RelayPresence>('relay_presence');
  await relayPresenceCollection.createIndex({ eventId: 1, userId: 1 }, { unique: true });
  await relayPresenceCollection.createIndex({ eventId: 1, teamId: 1 });
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
