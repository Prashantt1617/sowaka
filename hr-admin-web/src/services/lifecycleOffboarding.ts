// Employee lifecycle › Offboarding and Exit insights (docs/lifecycle/CONTRACT.md › Offboarding).
// The exit itself, its clearance list and the final settlement stay the live exits' (hrms.ts).
import { api, BASE_URL, getToken } from './http';

export type ExitType = 'resignation' | 'retirement' | 'end_of_contract' | 'termination' | 'absconding';
export type NoticeHandling = 'served' | 'not_applicable' | 'waived' | 'recovered' | 'paid_in_lieu';
export type BoardTab = 'resignations' | 'notice' | 'exit';
export type BoardColumn = 'with_manager' | 'with_hr' | 'accepted' | 'handover' | 'clearance' | 'exit_interview' | 'last_week' | 'last_day' | 'settlement_due' | 'settlement_sent' | 'closed';
export type OwnerRole = 'employee' | 'manager' | 'hr' | 'it' | 'admin' | 'finance' | 'payroll' | 'automatic' | 'done';
export type ClearanceTeam = 'manager' | 'admin' | 'it' | 'finance';
export type Owner = { role: OwnerRole; name?: string };
export type Flag = { key: 'needs_you' | 'late' | 'recovery' | 'all_clear' | 'closed'; label: string; tone: 'risk' | 'warn' | 'ok' };
export type Viewer = { kind: 'hr'; seesPay: boolean; canAct: boolean } | { kind: 'team'; team: Exclude<ClearanceTeam, 'manager'> | null; seesPay: boolean; canAct: false };

export type BoardCard = {
  key: string; userId: string; resignationId?: string; journeyId?: string;
  name: string; employeeId: string; designation: string; department: string;
  exitType: ExitType | null; exitTypeLabel: string; tl: string | null; lastDayLine: string;
  nextStep: string; owner: Owner; due: string | null; late: boolean; flag: Flag | null;
  column: BoardColumn; tab: BoardTab; waitingOnHr: boolean;
  /** HR's Remind for the card's next step (HR viewers only). */
  nudge?: NudgeOption;
};
/** A reminder HR can send (Remind {name}): once per item per day. */
export type NudgeOption = { item: string; label: string; to: string; what: string; late: boolean; sentToday: boolean };
export type BoardDTO = {
  tab: BoardTab;
  columns: { key: BoardColumn; label: string; cards: BoardCard[] }[];
  counts: Record<BoardTab, number>;
  waitingOnHr: number;
  viewer: Viewer;
  today: string;
};

export type TaskView = {
  id: string; systemKey?: string; phase: string; title: string; helper?: string; ownerRole: string; ownerName?: string;
  kind: string; surface: string; mustDo: boolean; status: 'locked' | 'todo' | 'in_review' | 'sent_back' | 'done' | 'skipped' | 'cancelled';
  opensAt?: string | null; dueAt?: string | null; dueLabel?: string; doneAt?: string; doneByName?: string; note?: string; late: boolean;
};
export type ResignationDTO = {
  id: string; userId: string; managerUserId: string | null; managerName: string; reason: string; note: string; submittedAt: string;
  noticeDays: number; lastDayByNotice: string; status: 'with_manager' | 'with_hr' | 'withdrawn' | 'accepted';
  manager: { action: 'accept' | 'change_day' | 'release_early'; date?: string; note?: string; at: string; byName: string } | null;
  hrAcceptedAt: string | null; hrAcceptedByName: string | null; agreedLastDay: string | null; journeyId: string | null; tl: string; daysLeft: number | null;
};
export type HandoverItemDTO = { id: string; title: string; upload: { kind: 'file' | 'link'; name?: string; url?: string; at: string } | null; done: boolean; doneAt: string | null };
export type ClearanceRow = { key: string; label: string; team: ClearanceTeam; done: boolean; doneAt: string | null; doneByName: string; amountPaise?: number; note?: string; canTick: boolean };
export type WaitingOn = { owner: Owner; task: string; due: string | null; late: boolean };

export type DrawerDTO = {
  viewer: Viewer;
  person: { userId: string; name: string; employeeId: string; designation: string; department: string; joiningDate: string | null; personalEmail?: string; managerName: string };
  card: BoardCard;
  statusLabel: string;
  track: { steps: string[]; current: number };
  waitingOn: WaitingOn[];
  resignation: ResignationDTO | null;
  exit: { kind: string; lastWorkingDay: string; noticeFrom: string | null; noticeDays: number | null; accessEndedAt: string | null; team: { newManagerUserId: string; newManagerName: string } | null; caseOpen: boolean } | null;
  tasks: TaskView[];
  handover: { items: HandoverItemDTO[]; note: string };
  clearance: ClearanceRow[];
  interview: { applies: boolean; opensAt: string | null; open: boolean; sent: boolean } | null;
  appPage: boolean;
  nudges: NudgeOption[];
  settlement: { status: 'draft' | 'approved' | 'paid'; payablePaise: number; dueOn: string; emailedTo: string | null; emailedAt: string | null } | null;
  details: { label: string; value: string }[];
};

export type SettlementChecksDTO = {
  open: boolean;
  attendance: { ok: boolean; label: string };
  clearance: { done: number; total: number; ok: boolean };
  salary: { ok: boolean; label: string };
  personalEmail: { ok: boolean; value: string };
  /** What still stops the send (HR may send anyway, with a reason). */
  blocking: string[];
  dueOn: string;
  /** For the PDF's footer: "Questions: {hrEmail}". */
  hrEmail: string;
  draft: { to: string; subject: string; message: string; savedAt: string; byName: string } | null;
};

export type StartExitInput = {
  exitType: ExitType; lastWorkingDay: string; noticeHandling?: NoticeHandling; templateId?: string; managerUserId?: string; hrNote?: string;
  tellManagerNow?: boolean; showAppPage?: boolean; newManagerUserId?: string; moveTeamNow?: boolean; noticeFrom?: string;
};

export type InsightsDTO = {
  from: string; to: string; groupBy: 'department' | 'tenure'; minGroup: number;
  left: { total: number; resigned: number; hrStarted: number };
  answered: { count: number; resignations: number; percent: number };
  hidden: boolean;
  workingHere: { average: number | null; answers: number } | null;
  manager: { average: number | null; answers: number } | null;
  comeBack: { yes: number; maybe: number; no: number; answered: number } | null;
  reasons: { key: string; label: string; count: number; percent: number }[];
  reasonAnswers: number;
  themes: { label: string; count: number; percent: number }[];
  hiddenThemes: number;
  untaggedAnswers: number;
  groups: { key: string; label: string; left: number; answers: number; workingHere: number | null; manager: number | null; hidden: boolean }[];
};

const BASE = '/admin/lifecycle';
const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : '';
};

export const getOffboardingBoard = (tab: BoardTab, opts: { q?: string; from?: string; to?: string } = {}) => api<BoardDTO>(`${BASE}/offboarding/board${q({ tab, ...opts })}`);
export const getOffboardingDetail = (userId: string) => api<DrawerDTO>(`${BASE}/offboarding/${userId}`);
export const acceptResignation = (resignationId: string, body: { lastWorkingDay?: string; note?: string; newManagerUserId?: string; moveTeamNow?: boolean; recoverShortfall?: boolean }) =>
  api<{ resignation: ResignationDTO; journeyId: string }>(`${BASE}/resignations/${resignationId}/accept`, { method: 'POST', body });
export const startExit = (userId: string, body: StartExitInput) => api<DrawerDTO & { journeyId: string }>(`${BASE}/offboarding/${userId}/start`, { method: 'POST', body });
export const setClearance = (userId: string, body: { key: string; done: boolean; amountPaise?: number | null; note?: string | null }) =>
  api<DrawerDTO>(`${BASE}/offboarding/${userId}/clearance`, { method: 'PUT', body });
export const changeLastDay = (userId: string, body: { lastWorkingDay: string; recoverShortfall?: boolean }) => api<DrawerDTO>(`${BASE}/offboarding/${userId}/last-day`, { method: 'POST', body });
export const setAppPage = (userId: string, showAppPage: boolean) => api<DrawerDTO>(`${BASE}/offboarding/${userId}/app-page`, { method: 'POST', body: { showAppPage } });
export const taskDone = (userId: string, systemKey: string, note?: string) => api<DrawerDTO>(`${BASE}/offboarding/${userId}/tasks/${systemKey}`, { method: 'POST', body: { action: 'done', ...(note ? { note } : {}) } });
export const closeExit = (userId: string, note?: string) => api<DrawerDTO>(`${BASE}/offboarding/${userId}/close`, { method: 'POST', body: note ? { note } : {} });
export const getSettlementChecks = (userId: string) => api<SettlementChecksDTO>(`${BASE}/offboarding/${userId}/settlement/checks`);
export const emailSettlementPdf = (userId: string, body: { pdfBase64: string; to: string; subject?: string; message?: string; overrideReason?: string }) =>
  api<DrawerDTO>(`${BASE}/offboarding/${userId}/settlement/email`, { method: 'POST', body });
export const saveSettlementDraft = (userId: string, body: { to: string; subject: string; message: string }) =>
  api<SettlementChecksDTO>(`${BASE}/offboarding/${userId}/settlement/draft`, { method: 'PUT', body });
export const sendNudge = (userId: string, item: string) => api<DrawerDTO & { nudged: { item: string; to: string } }>(`${BASE}/offboarding/${userId}/nudge`, { method: 'POST', body: { item } });
export type OffboardingCountDTO = { count: number; needsYou: number; late: number; viewer: Viewer };
export const getOffboardingCount = () => api<OffboardingCountDTO>(`${BASE}/offboarding/count`);
export type ClearanceTeamDTO = { team: Exclude<ClearanceTeam, 'manager'> | null; guess: Exclude<ClearanceTeam, 'manager'> | null; department: string };
export const getClearanceTeam = (userId: string) => api<ClearanceTeamDTO>(`${BASE}/offboarding/clearance-team/${userId}`);
export const putClearanceTeam = (userId: string, team: Exclude<ClearanceTeam, 'manager'> | null) => api<ClearanceTeamDTO>(`${BASE}/offboarding/clearance-team/${userId}`, { method: 'PUT', body: { team } });
/** Opens a handover upload in a new tab: a short-lived link where files are stored, else the bytes (development). */
export async function openHandoverFile(userId: string, itemId: string): Promise<void> {
  const tab = window.open('', '_blank');
  const res = await fetch(`${BASE_URL}${BASE}/offboarding/${userId}/handover/${itemId}/file`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) { tab?.close(); throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message || 'Could not open the file'); }
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    const { url } = (await res.json()) as { url: string };
    if (tab) tab.location.href = url; else window.open(url, '_blank');
    return;
  }
  const href = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = href; else window.open(href, '_blank');
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
export const getExitInsights = (from: string, to: string, groupBy: 'department' | 'tenure') => api<InsightsDTO>(`${BASE}/exit-insights${q({ from, to, groupBy })}`);
export type ExitAnswersDTO = { answers: { id: string; text: string; theme: string | null }[]; themes: string[]; custom: string[]; untagged: number };
export const getExitAnswers = (from: string, to: string) => api<ExitAnswersDTO>(`${BASE}/exit-insights/answers${q({ from, to })}`);
export const tagExitAnswer = (id: string, theme: string | null) => api<{ answer: { id: string; theme: string | null } }>(`${BASE}/exit-insights/answers/${id}`, { method: 'PUT', body: { theme } });
