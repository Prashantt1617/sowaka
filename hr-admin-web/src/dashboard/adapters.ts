// Map backend DTOs to the dashboard's view-model types.
import type { EmpType, FeedbackStatus, LeaveType, OtDuration, ReqStatus } from './theme';
import { mediaUrl } from '../services/api';
import type { Correction, CorrectionKind, Emp, FbEmp, Feedback, FbMgr, Leave, OtChoice, Overtime, Reimb } from './seed';
import type { AuthUser } from '../services/auth';
import type {
  ClaimDTO,
  EmployeeDTO,
  FeedbackDTO,
  LeaveDTO,
  OvertimeCompensation,
  OvertimeDTO,
  RegularizationDTO,
  WorkspaceDTO,
} from '../services/hrms';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-07-10" / ISO timestamp -> "10 Jul". */
export function fmtDay(input: string): string {
  const [y, m, d] = input.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return input;
  return `${d} ${MON[m - 1]}`;
}

function weekday(dateOnly: string): string {
  const [y, m, d] = dateOnly.slice(0, 10).split('-').map(Number);
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function ts(iso: string): number {
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
}

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Inclusive date-range test on a row's canonical ISO date (YYYY-MM-DD). Empty
 *  bounds are treated as open-ended. */
export function inDateRange(refISO: string, from: string, to: string): boolean {
  const d = (refISO || '').slice(0, 10);
  if (!d) return !from && !to;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/** Human-readable label for a 0-5 rating (matches the app's scoreWord bands). */
export function ratingWord(score: number): string {
  if (!score || score <= 0) return 'Not rated';
  if (score >= 4) return 'Exceeds expectation';
  if (score >= 2.5) return 'Meets expectation';
  return 'Needs work';
}

/**
 * A cancelled leave's label says what it had been. Older servers send no `cancelledFrom`: a
 * cancellation request approved, or a decision on record before the cancel, means it was approved.
 */
export function leaveStatusLabel(dto: Pick<LeaveDTO, 'status' | 'cancelledFrom' | 'cancelRequest' | 'decidedAt'>): string {
  if (dto.status !== 'cancelled') return cap(dto.status);
  const from = dto.cancelledFrom ?? (dto.cancelRequest?.status === 'approved' || (!dto.cancelRequest && dto.decidedAt) ? 'approved' : 'pending');
  return from === 'approved' ? 'Cancelled approved leave' : 'Cancelled pending leave';
}

export function adaptLeave(dto: LeaveDTO, managerName: string): Leave {
  const byAdmin = dto.decidedByRole === 'admin';
  const request = dto.cancelRequest;
  return {
    id: dto.id,
    name: dto.employee.name,
    team: dto.employee.department || 'Team',
    // "Emergency Leave" lists as "Emergency", like "Casual" — the column says leave.
    type: (dto.typeName ? dto.typeName.replace(/\s+leave$/i, '') : cap(dto.type)) as LeaveType,
    from: fmtDay(dto.startDate),
    to: fmtDay(dto.endDate),
    days: `${dto.days} day${dto.days === 1 ? '' : 's'}`,
    dayN: dto.days,
    status: cap(dto.status) as ReqStatus,
    manager: managerName,
    applied: fmtDay(dto.createdAt),
    ord: ts(dto.createdAt),
    eRemark: dto.reason,
    mRemark: dto.managerNote || '',
    refISO: dto.startDate,
    endISO: dto.endDate,
    submitterId: dto.userId,
    byAdmin,
    statusLabel: leaveStatusLabel(dto),
    unpaid: dto.unpaid === true,
    cancelNote: dto.cancelNote || request?.note || '',
    cancelledOn: dto.cancelledAt ? fmtDay(dto.cancelledAt) : undefined,
    cancelRequest: request && {
      status: cap(request.status) as 'Pending' | 'Approved' | 'Declined',
      requested: fmtDay(request.requestedAt),
      requestedOrd: ts(request.requestedAt),
      note: request.note || '',
      decisionNote: request.decisionNote || '',
      byAdmin: request.decidedByRole === 'admin',
    },
  };
}

export function adaptOvertime(dto: OvertimeDTO, managerName: string): Overtime {
  const byAdmin = dto.decidedByRole === 'admin';
  return {
    id: dto.id,
    name: dto.employee.name,
    team: dto.employee.department || 'Team',
    appliedOn: fmtDay(dto.createdAt),
    otDate: fmtDay(dto.workDate),
    duration: (dto.duration === 'full_day' ? 'Full day' : 'Half day') as OtDuration,
    ...otCompensation(dto),
    hours: dto.hours,
    day: weekday(dto.workDate),
    status: cap(dto.status) as ReqStatus,
    manager: managerName,
    eRemark: dto.note || '',
    mRemark: dto.managerNote || '',
    ord: ts(dto.createdAt),
    refISO: dto.workDate,
    submitterId: dto.userId,
    byAdmin,
  };
}

/**
 * What the employee asked for and, once approved, what was decided, in the
 * app form's words. Nothing on a request from before the choice existed.
 */
function otCompensation(
  dto: OvertimeDTO,
): Pick<Overtime, 'preference' | 'preferenceCredit' | 'preferredChoice' | 'decision' | 'decisionCredit' | 'decisionDiffers' | 'compOffAvailable' | 'compOffDays' | 'paidInPayroll'> {
  // A server from before the approver's decision sends only `compensation`,
  // which is then the preference.
  const preferred = dto.preferredCompensation !== undefined ? dto.preferredCompensation : dto.compensation ?? null;
  const decided = dto.status === 'approved' ? dto.compensation ?? null : null;
  const preferredChoice = preferred ? otChoiceOf(preferred) : undefined;
  const decidedChoice = decided ? otChoiceOf(decided) : undefined;
  return {
    preference: preferredChoice && OT_CHOICE_LABEL[preferredChoice],
    preferenceCredit: preferred ? compOffCreditOf(preferred) : undefined,
    preferredChoice,
    decision: decidedChoice && OT_CHOICE_LABEL[decidedChoice],
    decisionCredit: decided ? compOffCreditOf(decided) : undefined,
    decisionDiffers: Boolean(decidedChoice && preferredChoice && decidedChoice !== preferredChoice),
    compOffAvailable: dto.compOffAvailable ?? true,
    ...otOutcome(dto),
  };
}

/**
 * What an approved request adds, as the server counts it (compOffDaysOf and
 * OVERTIME_PAID_IN_PAYROLL in backend models/overtime.model.ts): comp-off
 * decided credits its days and is not paid; pay decided credits nothing and
 * is paid; a request with no choice (from before it existed) credits the half
 * or full day claimed and is paid as it always was. Nothing until approved.
 */
function otOutcome(dto: OvertimeDTO): Pick<Overtime, 'compOffDays' | 'paidInPayroll'> {
  if (dto.status !== 'approved') return { compOffDays: 0, paidInPayroll: false };
  const c = dto.compensation;
  if (c?.kind === 'comp_off') return { compOffDays: c.days, paidInPayroll: false };
  if (c?.kind === 'pay') return { compOffDays: 0, paidInPayroll: true };
  // From before the choice existed: overtime was comp-off then, never pay.
  return { compOffDays: dto.duration === 'full_day' ? 1 : 0.5, paidInPayroll: false };
}

/** How each choice reads, in the app form's words. */
export const OT_CHOICE_LABEL: Record<OtChoice, string> = {
  pay: 'Overtime Pay',
  comp_off_1: 'Leave (Comp-off) · Full day',
  'comp_off_0.5': 'Leave (Comp-off) · Half day',
};

export function otChoiceOf(c: OvertimeCompensation): OtChoice {
  if (c.kind === 'pay') return 'pay';
  return c.days === 1 ? 'comp_off_1' : 'comp_off_0.5';
}

export function otCompensationOf(choice: OtChoice): OvertimeCompensation {
  if (choice === 'pay') return { kind: 'pay' };
  return { kind: 'comp_off', days: choice === 'comp_off_1' ? 1 : 0.5 };
}

function compOffCreditOf(c: OvertimeCompensation): string | undefined {
  return c.kind === 'comp_off' ? `+${c.days} Comp-off` : undefined;
}

/** "Comp-off · +1" for a narrow table cell; "Overtime Pay" as is. */
export function otShortLabel(label: string | undefined, credit: string | undefined): string {
  if (credit) return `Comp-off · ${credit.replace(' Comp-off', '')}`;
  return label || '—';
}

/** How each requested day type reads in the table. */
const DAY_TYPE: Record<string, string> = {
  full_day: 'Full day',
  half_day: 'Half day',
  wfh: 'Work from home',
  client_visit: 'Client visit',
  office_visit: 'Client visit',
  leave: 'Leave',
};

/**
 * What a request is, from the request itself: its kind and what it asks for.
 * Never from the day's punches, which a decision changes afterwards.
 */
export function correctionKindOf(dto: Pick<RegularizationDTO, 'kind' | 'requestedDayType' | 'requestedPunchIn' | 'requestedPunchOut'>): CorrectionKind {
  if (dto.kind === 'out_of_location') return 'ool';
  if (dto.kind === 'face_check') return 'face';
  switch (dto.requestedDayType) {
    case 'full_day': return 'full';
    case 'half_day': return 'half';
    case 'wfh': return 'wfh';
    case 'client_visit':
    case 'office_visit': return 'visit';
    case 'leave': return 'leave';
    default: return dto.requestedPunchIn || dto.requestedPunchOut ? 'times' : 'other';
  }
}

/** A face check request asks for the punch it held: "Punch-in at 09:42 am". */
function faceCheckAsk(dto: RegularizationDTO, clock: (iso?: string) => string): string {
  const out = dto.faceCheck?.punchType === 'out';
  const at = clock(out ? dto.requestedPunchOut : dto.requestedPunchIn);
  return `${out ? 'Punch-out' : 'Punch-in'}${at ? ` at ${at}` : ''}`;
}

export function adaptCorrection(dto: RegularizationDTO, managerName: string): Correction {
  const clock = (iso?: string) =>
    (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '');
  const punchIn = clock(dto.punchIn);
  const punchOut = clock(dto.punchOut);
  return {
    id: dto.id,
    name: dto.employee.name,
    team: dto.employee.department || 'Team',
    employeeCode: dto.employeeCode || dto.employeeId,
    appliedOn: fmtDay(dto.createdAt),
    workDate: fmtDay(dto.workDate),
    day: weekday(dto.workDate),
    // An out-of-location request reads under its own heading, reason included.
    dayType: dto.kind === 'out_of_location'
      ? (dto.title ?? 'Out of location request')
      : DAY_TYPE[dto.requestedDayType ?? ''] ?? 'Correction',
    status: cap(dto.status) as ReqStatus,
    // The server resolves the approver; the roster name is only a fallback.
    manager: dto.manager || managerName,
    eRemark: dto.note || (dto.outsideLocation ? `${dto.outsideLocation.reason} · ${dto.outsideLocation.place}` : ''),
    mRemark: dto.managerNote || '',
    recorded: punchIn || punchOut ? `${punchIn || '—'} → ${punchOut || '—'}` : 'No punch',
    ord: ts(dto.createdAt),
    refISO: dto.workDate,
    submitterId: dto.userId,
    byAdmin: dto.decidedByRole === 'admin',
    kind: correctionKindOf(dto),
    askedFor: dto.kind === 'out_of_location'
      ? 'Full day'
      : dto.kind === 'face_check'
        ? faceCheckAsk(dto, clock)
        : DAY_TYPE[dto.requestedDayType ?? ''] ?? (dto.requestedPunchIn || dto.requestedPunchOut ? `${clock(dto.requestedPunchIn) || '—'} → ${clock(dto.requestedPunchOut) || '—'}` : 'Correction'),
    punchInISO: dto.punchIn,
    punchOutISO: dto.punchOut,
    ool: dto.outsideLocation
      ? { reason: dto.outsideLocation.reason, place: dto.outsideLocation.place, latitude: dto.outsideLocation.latitude, longitude: dto.outsideLocation.longitude, at: dto.outsideLocation.at }
      : undefined,
  };
}

export function adaptReimb(dto: ClaimDTO, managerName: string): Reimb {
  const byAdmin = dto.decidedByRole === 'admin';
  return {
    id: dto.id,
    name: dto.employee.name,
    team: dto.employee.department || 'Team',
    manager: managerName,
    type: cap(dto.category),
    amount: '₹' + dto.amount.toLocaleString('en-IN'),
    amountN: dto.amount,
    billDate: fmtDay(dto.expenseDate),
    applyDate: fmtDay(dto.createdAt),
    status: cap(dto.status) as ReqStatus,
    bill: dto.receiptName || '—',
    hasBill: Boolean(dto.hasReceipt),
    ord: ts(dto.createdAt),
    eRemark: dto.note || '',
    mRemark: dto.managerNote || '',
    refISO: dto.expenseDate,
    submitterId: dto.userId,
    byAdmin,
  };
}

const FB_STATUS: Record<string, FeedbackStatus> = {
  sent: 'Submitted',
  saved: 'Draft',
  pending: 'Pending',
};

/** Org-wide employee directory (rule 5). */
/** Backend stores snake-ish values; the table's pill expects these labels. */
function empTypeOf(value?: string): EmpType {
  if (value === 'intern') return 'Intern';
  if (value === 'contract') return 'Contract';
  return 'Full-time';
}

/** `2024-10-01` -> `01 Oct 2024`; an em dash when the field is unset. */
function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function adaptEmployees(dtos: EmployeeDTO[]): Emp[] {
  return dtos.map((e) => ({
    id: e.userId,
    name: e.name,
    email: e.email || '',
    employeeId: e.employeeId || '—',
    photoUrl: mediaUrl(e.profilePhotoUrl),
    // Designation is the person's actual job title; `role` is only the
    // manager/employee reporting flag, which is not what the table means by Role.
    role: e.designation || (e.isLeadership ? 'Leadership' : cap(e.role)),
    team: e.department || '—',
    location: e.location || '—',
    // Unlike `location`, these stay empty rather than dashed: they feed KPI
    // template targeting, where a placeholder would become a filter option.
    branch: e.branch || '',
    recognition: e.recognition || '',
    empType: empTypeOf(e.employeeType),
    manager: e.managerName || '—',
    managerId: e.managerUserId || '',
    dob: fmtDate(e.birthday),
    joining: fmtDate(e.joiningDate),
    joiningDate: e.joiningDate || '',
    birthday: e.birthday || '',
    gender: e.gender || '',
    phone: e.phone || '',
    isDirector: e.isDirector === true,
    documents: (e.documents ?? []).map((doc) => ({
      id: doc.id,
      name: doc.name,
      type: doc.type ?? 'Document',
      url: doc.url,
      uploadedOn: doc.uploadedAt ? fmtDay(doc.uploadedAt) : '',
    })),
  }));
}

/** Org-wide feedback list + per-manager rollup + per-employee cycle state (rule 5).
 *  Each record expands into one row per rated parameter plus an Overall row,
 *  so the table shows feedback against every parameter with its rating label.
 *  The roster is needed as well as the records: completion is measured against
 *  who reports to whom, not against which reviews happen to exist. */
export function adaptFeedbackList(
  records: FeedbackDTO[],
  employees: EmployeeDTO[],
  /** The org's live cycle key. Passed in because it depends on the company's
   *  configured start day, which the browser cannot derive. */
  period: string,
): { fbs: Feedback[]; fbMgrs: FbMgr[]; fbEmps: FbEmp[] } {
  const fbs: Feedback[] = [];
  records.forEach((r, i) => {
    const base = {
      name: r.employeeName,
      team: r.department || 'Team',
      manager: r.managerName || '—',
      status: FB_STATUS[r.status] ?? 'Pending',
      date: fmtDay(r.updatedAt || r.sentAt || ''),
      refISO: (r.updatedAt || r.sentAt || '').slice(0, 10),
      ord: records.length - i,
      text: r.extra || '',
    };
    // Overall row first, then one row per parameter.
    fbs.push({
      ...base,
      id: `${r.id}:overall`,
      parameter: 'Overall',
      rating: r.overallScore,
      ratingDesc: ratingWord(r.overallScore),
      isOverall: true,
      note: r.extra || 'No summary provided.',
    });
    for (const [pi, p] of (r.parameters ?? []).entries()) {
      fbs.push({
        ...base,
        id: `${r.id}:p${pi}`,
        parameter: p.name,
        rating: p.score,
        ratingDesc: ratingWord(p.score),
        isOverall: false,
        note: p.note || '—',
      });
    }
  });

  // The cycle's record per employee. Records arrive newest-first, so the first
  // one seen for an employee in the current period is the one that counts.
  const currentByEmployee = new Map<string, FeedbackDTO>();
  const historyByEmployee = new Map<string, FbEmp['history']>();
  for (const r of records) {
    if (r.period === period) {
      // Drafts are not results: an unsent form is treated as no review at all.
      if (r.status === 'sent' && !currentByEmployee.has(r.employeeUserId)) {
        currentByEmployee.set(r.employeeUserId, r);
      }
      continue;
    }
    // Only sent reviews are history: an abandoned draft from a past cycle is
    // not a result anyone should read a trend from.
    if (r.status !== 'sent') continue;
    const list = historyByEmployee.get(r.employeeUserId) ?? [];
    list.push({
      period: r.period,
      overall: r.overallScore,
      date: fmtDay(r.sentAt || r.updatedAt || ''),
      params: (r.parameters ?? []).map((p) => ({
        name: p.name,
        score: p.score,
        note: p.note || '',
      })),
      extra: r.extra || '',
    });
    historyByEmployee.set(r.employeeUserId, list);
  }
  for (const list of historyByEmployee.values()) list.sort((a, b) => b.period.localeCompare(a.period));

  const fbEmps: FbEmp[] = employees.map((e) => {
    const record = currentByEmployee.get(e.userId);
    return {
      userId: e.userId,
      name: e.name,
      team: e.department || e.designation || 'Team',
      designation: e.designation || '—',
      managerId: e.managerUserId ?? '',
      managerName: e.managerName || '—',
      status: record ? 'sent' : 'none',
      overall: record?.overallScore ?? 0,
      date: record ? fmtDay(record.sentAt || record.updatedAt || '') : '',
      params: (record?.parameters ?? []).map((p) => ({
        name: p.name,
        score: p.score,
        note: p.note || '',
      })),
      extra: record?.extra || '',
      history: historyByEmployee.get(e.userId) ?? [],
    };
  });

  // Denominators come from the roster: a manager with five reports and no
  // reviews yet is 0/5, not absent. Counting records would hide exactly the
  // managers this page exists to chase.
  const empByUser = new Map(fbEmps.map((e) => [e.userId, e]));
  const byMgr = new Map<string, { name: string; done: number; total: number; scopes: Set<string> }>();
  for (const e of employees) {
    const managerId = e.managerUserId;
    if (!managerId || !empByUser.has(managerId)) continue;
    const g = byMgr.get(managerId) ?? {
      name: empByUser.get(managerId)?.name ?? e.managerName ?? '—',
      done: 0,
      total: 0,
      scopes: new Set<string>(),
    };
    g.total += 1;
    if (empByUser.get(e.userId)?.status === 'sent') g.done += 1;
    if (e.department) g.scopes.add(e.department);
    byMgr.set(managerId, g);
  }
  const fbMgrs: FbMgr[] = [...byMgr.entries()]
    .map(([id, g]) => ({
      id,
      name: g.name,
      scope: g.scopes.size ? [...g.scopes].join(' · ') : 'Team',
      done: g.done,
      total: g.total,
      reminded: false,
    }))
    .sort((a, b) => a.done / a.total - b.done / b.total || b.total - a.total);

  return { fbs, fbMgrs, fbEmps };
}

export function adaptWorkspace(ws: WorkspaceDTO, user: AuthUser): {
  fbMgrs: FbMgr[];
  fbs: Feedback[];
  emps: Emp[];
} {
  const team = ws.team ?? [];
  const done = team.filter((t) => t.feedbackStatus === 'sent').length;
  const scopes = Array.from(new Set(team.map((t) => t.department).filter(Boolean)));

  const fbMgrs: FbMgr[] = [
    {
      id: user.id,
      name: user.name,
      scope: scopes.length ? scopes.join(' · ') : 'Your team',
      done,
      total: team.length,
      reminded: false,
    },
  ];

  const fbs: Feedback[] = team.map((t, i) => ({
    id: t.userId,
    name: t.name,
    team: t.department || 'Team',
    manager: user.name,
    parameter: 'Overall',
    rating: t.score,
    ratingDesc: ratingWord(t.score),
    isOverall: true,
    status: FB_STATUS[t.feedbackStatus] ?? 'Pending',
    date: fmtDay(t.nextDate),
    ord: team.length - i,
    refISO: (t.nextDate || '').slice(0, 10),
    note: t.extra || 'No summary provided.',
    text: t.extra || 'No feedback submitted for this period yet.',
  }));

  const emps: Emp[] = team.map((t) => ({
    id: t.userId,
    name: t.name,
    email: '',
    employeeId: '—',
    photoUrl: '',
    role: '—',
    team: t.department || 'Team',
    location: '—',
    branch: '',
    recognition: '',
    empType: 'Full-time' as EmpType,
    manager: user.name,
    managerId: user.id,
    dob: '—',
    joining: '—',
    joiningDate: '',
    birthday: '',
    gender: '',
    phone: '',
    isDirector: false,
    documents: [],
  }));

  return { fbMgrs, fbs, emps };
}
