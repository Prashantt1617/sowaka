import {
  attendanceRecords,
  feedbackRecords,
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
import { env } from '../config/env';
import { assignedParametersFor } from './kpi.service';
import { currentPeriodFor, cycleInfoFor } from './cycle';
import { shiftPolicyFor } from './shift.service';
import { holidaysForUser } from './holiday.service';
import { notifyFeedbackSubmitted } from './feedback-notifications.service';
import {
  presignConnectMedia,
  resolveProfilePhoto,
  uploadConnectMedia,
  type ConnectMediaFile,
} from './s3-connect-media.service';

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
  /**
   * True for someone who reports to the person the chart is about. The chain
   * above them is a single line; their own reports hang below it, so a chart
   * still says something for someone at the top of the tree.
   */
  isReport?: boolean;
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

/**
 * The feedback the app has to re-read while it runs: the viewer's own growth
 * history, and where each of their reports stands this cycle.
 *
 * A review stays editable until the cycle closes, so what the app loaded at
 * sign-in goes stale the moment a manager revises one. Kept small and separate
 * from the workspace, which aggregates far more than this needs.
 */
export async function getFeedbackSnapshot(managerUserId: string) {
  const viewer = await users().findOne({ userId: managerUserId });
  if (!viewer) throw new ManagerError(404, 'User not found');
  const approver = viewer.managerUserId
    ? await users().findOne({ userId: viewer.managerUserId })
    : null;
  const cycle = await cycleInfoFor(viewer.org ?? '');
  const reportIds = (
    await users()
      .find({
        managerUserId,
        org: viewer.org ?? '',
        lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
      })
      .project({ userId: 1 })
      .toArray()
  ).map((row) => (row as { userId: string }).userId);

  const [ownHistory, reportRecords] = await Promise.all([
    feedbackRecords()
      .find({ employeeUserId: managerUserId, status: 'sent' })
      .sort({ period: 1 })
      .toArray(),
    reportIds.length
      ? feedbackRecords()
          .find({ managerUserId, employeeUserId: { $in: reportIds }, period: cycle.period })
          .toArray()
      : Promise.resolve([]),
  ]);

  return {
    period: cycle.period,
    cycleEndsOn: cycle.end,
    managerScore: Number((ownHistory.at(-1)?.overallScore ?? 0).toFixed(1)),
    growthHistory: ownHistory.map((record) => ({
      period: record.period,
      overallScore: Number(record.overallScore.toFixed(1)),
      parameters: record.parameters,
      sentAt: record.sentAt ?? record.updatedAt,
      managerName: approver?.name ?? 'Your manager',
    })),
    team: reportRecords.map((record) => ({
      userId: record.employeeUserId,
      feedbackStatus: record.status,
      score: Number(record.overallScore.toFixed(1)),
      parameters: record.parameters,
      extra: record.extra ?? '',
    })),
  };
}

export async function getManagerWorkspace(managerUserId: string) {
  const manager = await users().findOne({ userId: managerUserId });
  if (!manager) throw new ManagerError(404, 'Manager not found');
  const approver = manager.managerUserId
    ? await users().findOne({ userId: manager.managerUserId })
    : null;

  // Scoped to the manager's own company: `managerUserId` alone is not unique
  // across orgs, and without this another company's employees can appear in
  // the team list. A user with no org is scoped to their own org — which is
  // no org — rather than falling back to an unscoped query that would hand
  // them every company's roster.
  const orgFilter = { org: manager.org ?? '' };

  // The whole org, so each report's own reporting line can be walked rather
  // than assumed to run through whoever is looking at it.
  const orgRoster = await users().find(orgFilter).toArray();
  const orgUsersById = new Map(orgRoster.map((user) => [user.userId, user]));

  const directReports = await users()
    .find({
      managerUserId,
      ...orgFilter,
      lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
    })
    .sort({ name: 1, userId: 1 })
    .toArray();

  // Someone with no direct reports still has a team: their peers under the
  // same manager. This is what the read-only Team view shows an individual
  // contributor.
  let reports = directReports;
  if (directReports.length === 0 && manager.managerUserId) {
    reports = await users()
      .find({
        managerUserId: manager.managerUserId,
        ...orgFilter,
        userId: { $ne: managerUserId },
        lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
      })
      .sort({ name: 1, userId: 1 })
      .toArray();
  }
  // Your own manager is part of your team however you got here — they head it.
  // Managers with reports of their own were previously missing them entirely.
  if (approver && !reports.some((report) => report.userId === approver.userId)) {
    reports = [approver, ...reports];
  }
  // Recognition is limited to the manager's own direct reports — never the
  // peer/manager fallback above.
  const recognitionCandidates = directReports;
  const cycle = await cycleInfoFor(manager.org ?? '');
  const period = cycle.period;
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
  // Each report is scored on their own assigned parameters, so the blank form
  // the app renders differs per person. Resolved once here rather than per row.
  const assignedByUser = new Map<string, Awaited<ReturnType<typeof assignedParametersFor>>>(
    await Promise.all(
      reportIds.map(async (id) =>
        [id, await assignedParametersFor(manager.org ?? '', id, period)] as const,
      ),
    ),
  );

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
      // Always the parameters HR has assigned for this cycle, with whatever
      // was already scored carried across. A draft saved before HR changed
      // the assignment used to be sent back as-is, and the form then posted a
      // set the server refuses — leaving that person unreviewable.
      parameters: reconcileParameters(
        assignedByUser.get(report.userId) ?? [],
        current?.parameters,
      ),
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
      orgChart: buildOrgChart(report, orgUsersById),
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
  // Only the holidays this employee observes: their own work location's, plus
  // the all-locations days. Another office's holiday is not a day off here.
  const orgHolidays = await holidaysForUser(manager);
  // The shift the app grades a day against: half-day and full-day hour
  // thresholds, plus the grace either side of the shift window. HR sets these
  // per shift in the dashboard; the app must not carry its own copy.
  const shift = await shiftPolicyFor(manager.userId);

  return {
    period,
    // The day the cycle closes, so the app can say how long a review it has
    // already shared stays open to edits.
    cycleEndsOn: cycle.end,
    approverName: approver?.name ?? 'Your manager',
    // The viewer's own reporting line, so their profile shows the same chart
    // their team members' profiles do.
    myOrgChart: buildOrgChart(manager, orgUsersById),
    managerScore: Number((ownFeedback?.overallScore ?? 0).toFixed(1)),
    weekoffDays: companyConfig.weekoffDays,
    shift,
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
      parameters: blankParameters(assignedByUser.get(employee.userId) ?? []),
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
  const employee = await requireDirectReport(managerUserId, employeeUserId);
  const status = input.status.trim().toLowerCase() as FeedbackRecordStatus;
  if (status !== 'saved' && status !== 'sent') {
    throw new ManagerError(400, 'Feedback status must be saved or sent');
  }

  // What this employee is scored on comes from HR's assignment for this cycle.
  // There is no default set, so an unassigned employee cannot be reviewed —
  // scoring someone against parameters nobody chose for them is worse than
  // blocking until HR decides.
  const org = employee.org ?? '';
  const period = await currentPeriodFor(org);
  // A review already sent this cycle stays sent: editing it until the cycle
  // closes is allowed, but a later Save must not quietly pull it back to a
  // draft the employee can no longer see.
  const previous = await feedbackRecords().findOne({ managerUserId, employeeUserId, period });
  const effectiveStatus: FeedbackRecordStatus = previous?.status === 'sent' ? 'sent' : status;
  const assigned = await assignedParametersFor(org, employeeUserId, period);
  if (!assigned.length) {
    throw new ManagerError(
      409,
      'No KPI parameters are assigned to this employee for this cycle. Ask HR to assign them.',
    );
  }
  if (!Array.isArray(input.parameters) || input.parameters.length !== assigned.length) {
    throw new ManagerError(400, 'All feedback parameters are required');
  }
  const parameters = input.parameters.map((value, index) => {
    const parameter = value as Partial<FeedbackParameter>;
    const expected = assigned[index];
    const score = Number(parameter.score);
    const note = String(parameter.note ?? '').trim();
    // The id has to be sent and has to match: a client that omitted it used to
    // skip this check entirely and be trusted positionally, which is exactly
    // how a stale form scores the wrong parameter.
    if (!parameter.parameterId) {
      throw new ManagerError(400, 'Each feedback parameter must carry its parameterId');
    }
    if (parameter.parameterId !== expected.id) {
      throw new ManagerError(409, 'These parameters have changed. Reload before saving.');
    }
    if (!Number.isFinite(score) || score < 0 || score > 5) {
      throw new ManagerError(400, 'Feedback scores must be between 0 and 5');
    }
    if (effectiveStatus === 'sent' && score === 0) {
      throw new ManagerError(400, 'A score is required for every parameter before sending');
    }
    if (note.length > 1000) throw new ManagerError(400, 'Feedback note is too long');
    // Copy is snapshotted so the review still reads correctly if HR later
    // renames or archives the parameter.
    return {
      parameterId: expected.id,
      name: expected.title,
      subtitle: expected.subtitle,
      // Snapshotted with the copy: re-weighting the template later must not
      // restate what this review meant.
      weight: expected.weight,
      score,
      note,
    } as FeedbackParameter;
  });
  const extra = String(input.extra ?? '').trim();
  if (extra.length > 2000) throw new ManagerError(400, 'Additional feedback is too long');
  // Weighted mean. Weights are percentages summing to 100, so the result stays
  // on the same 0-5 scale as each parameter: 0.5x5 + 0.3x5 + 0.2x5 = 5.
  const totalWeight = parameters.reduce((sum, p) => sum + (p.weight ?? 0), 0);
  const overallScore = totalWeight > 0
    ? parameters.reduce((sum, p) => sum + p.score * (p.weight ?? 0), 0) / totalWeight
    : parameters.reduce((sum, p) => sum + p.score, 0) / parameters.length;
  const now = new Date();
  const existing = previous;
  const record = await feedbackRecords().findOneAndUpdate(
    { managerUserId, employeeUserId, period },
    {
      $set: {
        status: effectiveStatus,
        parameters,
        extra,
        overallScore,
        updatedAt: now,
        // The first send stamps the time; a later edit keeps that stamp, so
        // the review reads as submitted when it was, not when it was tweaked.
        ...(effectiveStatus === 'sent' && !existing?.sentAt ? { sentAt: now } : {}),
      },
      $setOnInsert: { managerUserId, employeeUserId, period, createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (effectiveStatus === 'sent' && existing?.status !== 'sent') {
    // Notifies both sides: the manager gets their progress for the cycle, the
    // employee gets the review. Only on the first send — re-editing a sent
    // review should not re-announce it.
    await notifyFeedbackSubmitted(managerUserId, employeeUserId, period, now);
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
  if (hrUsers.length) {
    await notifyUsers(hrUsers.map((hr) => hr.userId), {
      scenario: 'nomination_received', title: 'New nomination',
      body: `${manager?.name ?? 'A manager'} nominated ${employee?.name ?? 'an employee'} for ${category}`,
      data: { destination: 'nomination_review', period, category, employeeUserId,
        employeeName: employee?.name ?? 'Employee' },
    });
  }
  return { period, category, employeeUserId, reason };
}

async function requireDirectReport(managerUserId: string, employeeUserId: string) {
  const employee = await users().findOne({ userId: employeeUserId });
  if (!employee) throw new ManagerError(404, 'Employee not found');
  if (employee.managerUserId !== managerUserId) {
    throw new ManagerError(403, 'Only a direct report can be selected');
  }
  return employee;
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
/**
 * This employee's own reporting line, top of the chain down to them.
 *
 * It used to be assembled from the *viewer's* line — [viewer's manager, viewer,
 * employee] — which was right only when the viewer happened to be that person's
 * manager. Anyone else looking at the profile saw their own chain with a
 * stranger pinned on the end, so two people under different managers appeared
 * to share one, and a viewer could show up twice in their own chart.
 *
 * Walked from `managerUserId`, with each id visited once: a reporting loop in
 * the data stops the walk instead of looping forever.
 */
function buildOrgChart(report: User, byUserId: Map<string, User>): OrgChartNode[] {
  const node = (user: User, isSelf: boolean): OrgChartNode => ({
    userId: user.userId,
    name: user.name,
    designation: user.designation ?? user.department ?? '',
    isSelf,
  });

  const chain: User[] = [];
  const seen = new Set<string>([report.userId]);
  let current: User | undefined = report.managerUserId
    ? byUserId.get(report.managerUserId)
    : undefined;
  while (current && !seen.has(current.userId)) {
    seen.add(current.userId);
    chain.unshift(current);
    current = current.managerUserId ? byUserId.get(current.managerUserId) : undefined;
  }

  // Whoever reports to them, so the head of the tree — who has no chain above
  // them at all — still gets a chart worth showing.
  const directReports = [...byUserId.values()]
    .filter((user) => user.managerUserId === report.userId && user.userId !== report.userId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((user) => ({ ...node(user, false), isReport: true }));

  return [
    ...chain.map((user) => node(user, false)),
    node(report, true),
    ...directReports,
  ];
}

/**
 * @deprecated Calendar-month fallback. Prefer `currentPeriodFor(org)`, which
 * honours the org's configured cycle start day; this remains only for callers
 * that have no org to hand.
 */
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

/**
 * A blank form for an employee's assigned parameters. Empty when HR has not
 * assigned any — the app shows the "no KPIs assigned" state rather than an
 * arbitrary default set.
 */
/**
 * The current assignment, carrying over scores and notes from a draft written
 * against an older one. Matched on the parameter id, falling back to the name
 * for drafts written before ids were stored.
 */
function reconcileParameters(
  assigned: Array<{ id: string; title: string; subtitle: string; weight: number }>,
  saved: FeedbackParameter[] | undefined,
): FeedbackParameter[] {
  const blanks = blankParameters(assigned);
  if (!saved?.length) return blanks;
  const byId = new Map(saved.map((p) => [p.parameterId, p]));
  const byName = new Map(saved.map((p) => [p.name, p]));
  return blanks.map((blank) => {
    const previous = byId.get(blank.parameterId) ?? byName.get(blank.name);
    return previous
      ? { ...blank, score: previous.score, note: previous.note }
      : blank;
  });
}

function blankParameters(
  assigned: Array<{ id: string; title: string; subtitle: string; weight: number }>,
): FeedbackParameter[] {
  return assigned.map((p) => ({
    parameterId: p.id,
    name: p.title,
    subtitle: p.subtitle,
    // Carried onto the blank form so the app can show what each parameter is
    // worth before anything is scored.
    weight: p.weight,
    score: 0,
    note: '',
  }));
}

export class ManagerError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}
