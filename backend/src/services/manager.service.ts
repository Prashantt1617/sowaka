import {
  attendanceRecords,
  feedbackRecords,
  holidays,
  recognitionNominations,
  users,
} from '../config/db';
import { getCompanyConfig } from './company-settings.service';
import {
  FeedbackParameter,
  FeedbackRecordStatus,
} from '../models/feedback.model';
import { User } from '../models/user.model';
import { RecognitionNomination } from '../models/recognition.model';
import { notifyUsers, queueBatchedNotification } from './notification.service';
import {
  presignConnectMedia,
  resolveProfilePhoto,
  uploadConnectMedia,
  type ConnectMediaFile,
} from './s3-connect-media.service';

// Parameter set and order come from the feedback design. These become
// HR-configurable once the HR dashboard lands.
const feedbackParameterNames = [
  'Performance',
  'Collaboration',
  'Ownership',
  'Communication',
] as const;
const recognitionCategories = new Set<RecognitionNomination['category']>([
  'artist',
  'mentor',
  'culture',
  'rising',
]);

export interface OrgChartNode {
  userId: string;
  name: string;
  designation: string;
  isSelf: boolean;
}

export interface TeamMemberDocumentView {
  name: string;
  url: string;
  type: string | null;
  uploadedAt: string | null;
}

export interface ManagerTeamMemberView {
  userId: string;
  name: string;
  department: string;
  designation: string;
  /** True for the viewer's own manager, shown as "(Manager)" in the team list. */
  isManager?: boolean;
  score: number;
  /** Overall score from the most recent *earlier* period, for the delta pill. */
  previousScore: number | null;
  nextDate: string;
  feedbackStatus: 'pending' | 'saved' | 'sent';
  missedMonths: number;
  parameters: FeedbackParameter[];
  extra: string;
  todayStatus: 'present' | 'not_punched_in';
  birthday: string | null;
  photoUrl: string | null;
  punchIn: string | null;
  punchOut: string | null;
  // Profile detail shown on the manager's read-only view of a report.
  email: string;
  employeeId: string | null;
  joiningDate: string | null;
  employmentType: string | null;
  managerName: string | null;
  orgChart: OrgChartNode[];
  documents: TeamMemberDocumentView[];
  /** Every sent review for this report, oldest first, for the growth timeline. */
  history: {
    period: string;
    overallScore: number;
    parameters: FeedbackParameter[];
    sentAt: Date;
  }[];
}

export async function updateProfilePhoto(userId: string, file: ConnectMediaFile) {
  const user = await users().findOne({ userId });
  if (!user) throw new ManagerError(404, 'User not found');
  let photoUrl: string;
  let objectKey: string;
  try {
    const uploaded = await uploadConnectMedia(userId, file);
    objectKey = uploaded.objectKey;
    photoUrl = await presignConnectMedia(objectKey);
  } catch {
    throw new ManagerError(503, 'Photo storage is unavailable');
  }
  // Only the key is persisted. Storing the resolved value put a multi-hundred-KB
  // `data:` URI inside a document that every authenticated request reads.
  await users().updateOne(
    { userId },
    { $set: { profilePhotoKey: objectKey }, $unset: { profilePhotoUrl: '' } },
  );
  return photoUrl;
}

export async function getManagerWorkspace(managerUserId: string) {
  const manager = await users().findOne({ userId: managerUserId });
  if (!manager) throw new ManagerError(404, 'Manager not found');
  const approver = manager.managerUserId
    ? await users().findOne({ userId: manager.managerUserId })
    : null;

  const directReports = await users()
    .find({
      managerUserId,
      lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
    })
    .sort({ name: 1, userId: 1 })
    .toArray();

  // Someone with no direct reports still has a team: their peers under the
  // same manager, plus that manager. This is what the read-only Team view
  // shows an individual contributor.
  let reports = directReports;
  if (directReports.length === 0 && manager.managerUserId) {
    const peers = await users()
      .find({
        managerUserId: manager.managerUserId,
        userId: { $ne: managerUserId },
        lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
      })
      .sort({ name: 1, userId: 1 })
      .toArray();
    reports = approver ? [approver, ...peers] : peers;
  }
  // Recognition is limited to the manager's own direct reports — never the
  // peer/manager fallback above.
  const recognitionCandidates = directReports;
  const period = currentPeriod();
  const reportIds = reports.map((report) => report.userId);
  const reportEmployeeIds = reports
    .map((report) => report.employeeId)
    .filter((value): value is string => Boolean(value));
  const today = new Date().toISOString().slice(0, 10);
  const [
    currentFeedback,
    latestSent,
    previousSent,
    nominations,
    nominationHistory,
    ownFeedbackHistory,
    reportHistory,
    todaysAttendance,
  ] = await Promise.all([
      feedbackRecords().find({ managerUserId, employeeUserId: { $in: reportIds }, period }).toArray(),
      feedbackRecords()
        .aggregate([
          { $match: { managerUserId, employeeUserId: { $in: reportIds }, status: 'sent' } },
          { $sort: { period: -1 } },
          { $group: { _id: '$employeeUserId', record: { $first: '$$ROOT' } } },
        ])
        .toArray(),
      feedbackRecords()
        .aggregate([
          {
            $match: {
              managerUserId,
              employeeUserId: { $in: reportIds },
              status: 'sent',
              period: { $lt: period },
            },
          },
          { $sort: { period: -1 } },
          { $group: { _id: '$employeeUserId', record: { $first: '$$ROOT' } } },
        ])
        .toArray(),
      recognitionNominations().find({ managerUserId, period }).toArray(),
      recognitionNominations()
        .find({ managerUserId })
        .sort({ period: -1, updatedAt: -1 })
        .limit(50)
        .toArray(),
      feedbackRecords()
        .find({ employeeUserId: managerUserId, status: 'sent' })
        .sort({ period: 1 })
        .toArray(),
      reportIds.length
        ? feedbackRecords()
            .find({ managerUserId, employeeUserId: { $in: reportIds }, status: 'sent' })
            .sort({ period: 1 })
            .toArray()
        : Promise.resolve([]),
      reportIds.length
        ? attendanceRecords()
            .find({
              workDate: today,
              $or: [
                { userId: { $in: reportIds } },
                ...(reportEmployeeIds.length ? [{ employeeId: { $in: reportEmployeeIds } }] : []),
              ],
            })
            .toArray()
        : Promise.resolve([]),
    ]);
  // A report's punch record may be keyed by userId (self-service app punches)
  // or employeeId (SQL-imported punches) — check both, preferring employeeId
  // since every record has one but not every record has userId.
  const attendanceByEmployeeId = new Map(
    todaysAttendance.filter((record) => record.employeeId).map((record) => [record.employeeId, record]),
  );
  const attendanceByUserId = new Map(
    todaysAttendance.filter((record) => record.userId).map((record) => [record.userId, record]),
  );
  const todaysRecordFor = (report: (typeof reports)[number]) =>
    (report.employeeId && attendanceByEmployeeId.get(report.employeeId)) ||
    attendanceByUserId.get(report.userId);
  // Resolve nominee names for the current + historical nominations (a past
  // nominee may no longer be a direct report).
  const nomineeIds = [...new Set(nominationHistory.map((n) => n.employeeUserId))];
  const nomineeUsers = nomineeIds.length
    ? await users().find({ userId: { $in: nomineeIds } }).toArray()
    : [];
  const nomineeName = new Map(nomineeUsers.map((u) => [u.userId, u.name]));
  const ownFeedback = ownFeedbackHistory.at(-1);

  const currentByEmployee = new Map(
    currentFeedback.map((record) => [record.employeeUserId, record]),
  );
  const latestByEmployee = new Map(
    latestSent.map((value) => {
      const record = value.record as { employeeUserId: string; period: string; overallScore: number };
      return [record.employeeUserId, record] as const;
    }),
  );
  const historyByEmployee = new Map<string, typeof reportHistory>();
  for (const record of reportHistory) {
    const list = historyByEmployee.get(record.employeeUserId) ?? [];
    list.push(record);
    historyByEmployee.set(record.employeeUserId, list);
  }
  const previousByEmployee = new Map(
    previousSent.map((value) => {
      const record = value.record as { employeeUserId: string; overallScore: number };
      return [record.employeeUserId, record.overallScore] as const;
    }),
  );
  const nextDate = endOfCurrentMonth().toISOString().slice(0, 10);
  const team: ManagerTeamMemberView[] = await Promise.all(reports.map(async (report) => {
    const current = currentByEmployee.get(report.userId);
    const latest = latestByEmployee.get(report.userId);
    const todaysRecord = todaysRecordFor(report);
    return {
      userId: report.userId,
      name: report.name,
      department: report.department ?? report.designation ?? 'Team',
      isManager: report.userId === manager.managerUserId,
      designation: report.designation ?? '',
      score: current?.overallScore ?? latest?.overallScore ?? 0,
      previousScore: previousByEmployee.get(report.userId) ?? null,
      nextDate,
      feedbackStatus: current?.status ?? 'pending',
      missedMonths: current ? 0 : monthsSince(latest?.period, period),
      parameters: current?.parameters ?? defaultParameters(),
      extra: current?.extra ?? '',
      todayStatus: todaysRecord?.punchIn ? 'present' : 'not_punched_in',
      birthday: report.birthday ? report.birthday.toISOString().slice(0, 10) : null,
      photoUrl: (await resolveProfilePhoto(report)) ?? null,
      punchIn: todaysRecord?.punchIn ? todaysRecord.punchIn.toISOString() : null,
      punchOut: todaysRecord?.punchOut ? todaysRecord.punchOut.toISOString() : null,
      email: report.email,
      employeeId: report.employeeId ?? null,
      joiningDate: report.joiningDate ? report.joiningDate.toISOString().slice(0, 10) : null,
      employmentType: report.employeeType ?? null,
      managerName: manager.name,
      // Reporting line from the top of the chain down to this report. The chain
      // is walked from `managerUserId` links already loaded above.
      orgChart: buildOrgChart(report, manager, approver),
      history: (historyByEmployee.get(report.userId) ?? []).map((record) => ({
        period: record.period,
        overallScore: Number(record.overallScore.toFixed(1)),
        parameters: record.parameters,
        sentAt: record.sentAt ?? record.updatedAt,
      })),
      documents: (report.documents ?? []).map((document) => ({
        name: document.name,
        url: document.url,
        type: document.type ?? null,
        uploadedAt: document.uploadedAt ? document.uploadedAt.toISOString() : null,
      })),
    };
  }));

  // Company config for the overtime apply flow: which weekdays are week-offs,
  // whether overtime is enabled for this user's department, and the org holidays.
  const companyConfig = await getCompanyConfig(manager.org);
  // Both gates apply: HR can switch a single employee off, or a whole team.
  const overtimeEnabled =
    manager.overtimeEligible !== false &&
    !companyConfig.overtimeDisabledDepartments.includes((manager.department ?? '').trim());
  const orgHolidays = manager.org
    ? await holidays().find({ org: manager.org }).sort({ date: 1 }).toArray()
    : [];

  return {
    period,
    approverName: approver?.name ?? 'Your manager',
    managerScore: Number((ownFeedback?.overallScore ?? 0).toFixed(1)),
    weekoffDays: companyConfig.weekoffDays,
    overtimeEnabled,
    holidays: orgHolidays.map((holiday) => ({
      date: holiday.date.toISOString().slice(0, 10),
      name: holiday.name,
    })),
    growthHistory: ownFeedbackHistory.map((record) => ({
      period: record.period,
      overallScore: Number(record.overallScore.toFixed(1)),
      parameters: record.parameters,
      sentAt: record.sentAt ?? record.updatedAt,
      managerName: approver?.name ?? 'Your manager',
    })),
    team,
    recognitionCandidates: recognitionCandidates.map((employee) => ({
      userId: employee.userId,
      name: employee.name,
      department: employee.department ?? employee.designation ?? 'Team',
      score: 0,
      nextDate,
      feedbackStatus: 'pending' as const,
      missedMonths: 0,
      parameters: defaultParameters(),
      extra: '',
    })),
    nominations: nominations.map((nomination) => ({
      category: nomination.category,
      employeeUserId: nomination.employeeUserId,
      employeeName: nomineeName.get(nomination.employeeUserId) ?? 'Teammate',
      reason: nomination.reason ?? '',
    })),
    recognitionHistory: nominationHistory.map((nomination) => ({
      period: nomination.period,
      category: nomination.category,
      employeeUserId: nomination.employeeUserId,
      employeeName: nomineeName.get(nomination.employeeUserId) ?? 'Teammate',
      reason: nomination.reason ?? '',
      createdAt: (nomination.createdAt ?? nomination.updatedAt)?.toISOString?.() ?? undefined,
    })),
  };
}

export async function upsertFeedback(
  managerUserId: string,
  employeeUserId: string,
  input: { status: string; parameters: unknown; extra?: string },
) {
  await requireDirectReport(managerUserId, employeeUserId);
  const status = input.status.trim().toLowerCase() as FeedbackRecordStatus;
  if (status !== 'saved' && status !== 'sent') {
    throw new ManagerError(400, 'Feedback status must be saved or sent');
  }
  if (!Array.isArray(input.parameters) || input.parameters.length !== feedbackParameterNames.length) {
    throw new ManagerError(400, 'All feedback parameters are required');
  }
  const parameters = input.parameters.map((value, index) => {
    const parameter = value as Partial<FeedbackParameter>;
    const score = Number(parameter.score);
    const note = String(parameter.note ?? '').trim();
    if (parameter.name !== feedbackParameterNames[index]) {
      throw new ManagerError(400, 'Feedback parameters are invalid');
    }
    if (!Number.isFinite(score) || score < 0 || score > 5) {
      throw new ManagerError(400, 'Feedback scores must be between 0 and 5');
    }
    if (status === 'sent' && score === 0) {
      throw new ManagerError(400, 'A score is required for every parameter before sending');
    }
    if (note.length > 1000) throw new ManagerError(400, 'Feedback note is too long');
    return { name: parameter.name, score, note } as FeedbackParameter;
  });
  const extra = String(input.extra ?? '').trim();
  if (extra.length > 2000) throw new ManagerError(400, 'Additional feedback is too long');
  const overallScore = parameters.reduce((sum, parameter) => sum + parameter.score, 0) /
    parameters.length;
  const now = new Date();
  const period = currentPeriod();
  const existing = await feedbackRecords().findOne({ managerUserId, employeeUserId, period });
  const record = await feedbackRecords().findOneAndUpdate(
    { managerUserId, employeeUserId, period },
    {
      $set: {
        status,
        parameters,
        extra,
        overallScore,
        updatedAt: now,
        ...(status === 'sent' ? { sentAt: now } : {}),
      },
      $setOnInsert: { managerUserId, employeeUserId, period, createdAt: now },
      ...(status === 'saved' && existing?.sentAt ? { $unset: { sentAt: '' } } : {}),
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (status === 'sent' && existing?.status !== 'sent') {
    const manager = await users().findOne({ userId: managerUserId });
    await notifyUsers([employeeUserId], {
      scenario: 'feedback_shared', title: 'Feedback ready',
      body: `${manager?.name ?? 'Your manager'} has shared your feedback for ${period}`,
      data: { destination: 'grow_feedback', employeeUserId, period },
    });
  }
  return record;
}

export async function nominateForRecognition(
  managerUserId: string,
  categoryInput: string,
  employeeUserId: string,
  reasonInput?: string,
) {
  const category = categoryInput.trim().toLowerCase() as RecognitionNomination['category'];
  if (!recognitionCategories.has(category)) {
    throw new ManagerError(400, 'Recognition category is invalid');
  }
  const reason = reasonInput?.trim();
  if (!reason) throw new ManagerError(400, 'Please add a reason for the nomination');
  if (reason.length > 500) throw new ManagerError(400, 'Nomination reason is too long');
  await requireRecognitionCandidate(managerUserId, employeeUserId);
  const now = new Date();
  const period = currentPeriod();
  await recognitionNominations().updateOne(
    { managerUserId, period, category },
    {
      $set: { employeeUserId, reason, updatedAt: now },
      $setOnInsert: { managerUserId, period, category, createdAt: now },
    },
    { upsert: true },
  );
  const [manager, employee] = await Promise.all([
    users().findOne({ userId: managerUserId }), users().findOne({ userId: employeeUserId }),
  ]);
  const hrUsers = manager?.org
    ? await users().find({ org: manager.org, dashboardAccess: true }).toArray()
    : [];
  for (const hr of hrUsers) {
    await queueBatchedNotification(hr.userId, 'nomination_received', `${period}:${category}`,
      manager?.name ?? 'A manager', category,
      { destination: 'nomination_review', period, category, employeeUserId,
        employeeName: employee?.name ?? 'Employee' });
  }
  return { period, category, employeeUserId, reason };
}

async function requireDirectReport(managerUserId: string, employeeUserId: string) {
  const employee = await users().findOne({ userId: employeeUserId });
  if (!employee) throw new ManagerError(404, 'Employee not found');
  if (employee.managerUserId !== managerUserId) {
    throw new ManagerError(403, 'Only a direct report can be selected');
  }
}

async function requireRecognitionCandidate(managerUserId: string, employeeUserId: string) {
  const [manager, employee] = await Promise.all([
    users().findOne({ userId: managerUserId }),
    users().findOne({ userId: employeeUserId }),
  ]);
  if (!manager) throw new ManagerError(404, 'Manager not found');
  if (!employee || ['offboarded', 'terminated'].includes(employee.lifecycleStatus)) {
    throw new ManagerError(404, 'Employee not found');
  }
  const sameCompany = manager.org && employee.org === manager.org;
  if (!sameCompany && employee.managerUserId !== managerUserId) {
    throw new ManagerError(403, 'Only an active employee in your company can be selected');
  }
}

/**
 * Reporting line shown on a report's profile, ordered top-down:
 * the manager's own manager (when there is one), the manager, then the report.
 */
function buildOrgChart(
  report: User,
  manager: User,
  approver: User | null,
): OrgChartNode[] {
  const node = (user: User, isSelf: boolean): OrgChartNode => ({
    userId: user.userId,
    name: user.name,
    designation: user.designation ?? user.department ?? '',
    isSelf,
  });
  return [
    ...(approver ? [node(approver, false)] : []),
    node(manager, false),
    node(report, true),
  ];
}

function currentPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function endOfCurrentMonth(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function monthsSince(previous: string | undefined, current: string): number {
  if (!previous) return 0;
  const [currentYear, currentMonth] = current.split('-').map(Number);
  const [previousYear, previousMonth] = previous.split('-').map(Number);
  return Math.max(0, currentYear * 12 + currentMonth - (previousYear * 12 + previousMonth) - 1);
}

function defaultParameters(): FeedbackParameter[] {
  return feedbackParameterNames.map((name) => ({ name, score: 0, note: '' }));
}

export class ManagerError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}
