// Typed calls for the HR dashboard's employee lifecycle: the onboarding board
// and its joiner panel, templates (onboarding and offboarding), offers,
// candidate documents and letters. The shapes mirror
// backend/src/models/lifecycle.model.ts and docs/lifecycle/CONTRACT.md, with
// dates as they travel in JSON ('YYYY-MM-DD' days, ISO instants).
import { api, apiUpload, ApiError, BASE_URL, getToken } from './http';

// —— Templates ———————————————————————————————————————————————————————————

export type LifecycleKind = 'onboarding' | 'offboarding';
export type OnboardingPhase = 'pre_boarding' | 'first_week' | 'probation';
export type OffboardingPhase = 'resignation' | 'when_accepted' | 'notice_period' | 'last_day' | 'after_exit';
export type LifecyclePhase = OnboardingPhase | OffboardingPhase;

export type OwnerRole = 'employee' | 'manager' | 'hr' | 'it' | 'admin' | 'finance' | 'manager_employee' | 'hr_manager' | 'automatic';
export type TaskKind = 'ack' | 'form' | 'upload' | 'sign' | 'meeting' | 'reel' | 'survey' | 'assign' | 'review' | 'system' | 'post' | 'tour' | 'face' | 'checkin' | 'letter';
export type TaskSurface = 'portal' | 'app' | 'dashboard' | 'backend' | 'outside';
export type DueAnchor = 'offer_sent' | 'accepted' | 'finalised' | 'tj' | 'month_start' | 'month_end' | 'tl' | 'exit_accepted';

export interface DueRule {
  anchor: DueAnchor;
  offset?: number;
  unit?: 'days' | 'working_days';
  month?: number | number[] | 'each' | 'last';
}

export interface TemplateTask {
  id: string;
  phase: LifecyclePhase;
  title: string;
  helper?: string;
  ownerRole: OwnerRole;
  kind: TaskKind;
  surface: TaskSurface;
  systemKey?: string;
  opensRule?: DueRule | null;
  dueRule?: DueRule | null;
  dueLabel?: string;
  mustDo: boolean;
  enabled: boolean;
  order: number;
  recommended?: { why: string; added: boolean };
  documents?: Array<{ key: string; label: string; required: boolean }>;
}

export type ExitTypeKey = 'resignation' | 'retirement' | 'end_of_contract' | 'termination' | 'absconding';

export interface LifecycleTemplateSettings {
  probationMonths?: 3 | 6;
  portalOpenUntil?: 'week_1' | 'month_1';
  signLettersOnDay1?: boolean;
  noticeDays?: number;
  exitInterviewOpensDays?: number;
  accountCloses?: 'tl_plus_1' | 'tl_end_of_shift';
  settlementWorkingDays?: number;
  gratuityDays?: number;
  appPageFor?: ExitTypeKey[];
}

export interface LifecycleTemplate {
  id: string;
  kind: LifecycleKind;
  name: string;
  group?: string;
  isDefault: boolean;
  active: boolean;
  settings: LifecycleTemplateSettings;
  tasks: TemplateTask[];
  createdAt?: string;
  updatedAt?: string;
  updatedByName?: string;
}
export type TemplateListItem = LifecycleTemplate & { journeysUsing: number; recommendedNotAdded: number };

// —— Board and journeys ——————————————————————————————————————————————————

export type BoardTab = 'pre_boarding' | 'first_week' | 'probation';
export type BoardColumn =
  | 'offer_sent' | 'accepted' | 'documents' | 'letters' | 'ready_to_join'
  | 'day1' | 'week1_tasks' | 'day7_survey' | 'week_done'
  | 'month1' | 'months_2_5' | 'final_month' | 'confirmed';
export type JourneyFlag = 'needs_you' | 'late' | 'quiet' | 'joining_risk' | 'needs_attention' | 'expires_soon' | 'due_soon' | 'decide' | 'all_set' | 'done' | 'confirmed';
export type BoardFilter = 'needs_you' | 'late' | 'needs_attention' | 'quiet' | 'joining_risk' | 'due_soon' | 'mine';
export type OnboardingStatus = 'draft' | 'offer_sent' | 'accepted' | 'finalised' | 'active' | 'docs_approved' | 'joined' | 'moved_to_app' | 'confirmed' | 'declined' | 'expired' | 'not_joining';
export type OnboardingStage = 'pre_boarding' | 'welcome_week1' | 'settling_in' | 'growing_gains' | 'final_month' | 'ready_to_perform';

export interface PlantState {
  stage: 0 | 1 | 2 | 3 | 4 | 5;
  water: 0 | 1 | 2 | 3;
  leaves: number;
  droop: boolean;
}

/** `taskId` / `canNudge` / `nudgedToday` power Nudge and Remind {name}. */
export interface WaitingOn { taskId: string; ownerRole: OwnerRole; ownerName?: string; title: string; dueAt?: string | null; late?: boolean; canNudge: boolean; nudgedToday?: boolean }

export interface BoardCard {
  journeyId: string;
  name: string;
  designation?: string;
  department?: string;
  managerName?: string;
  photoUrl?: string;
  tj?: string;
  dayLabel: string;
  status: OnboardingStatus | string;
  column: BoardColumn;
  flags: JourneyFlag[];
  waitingOn: WaitingOn[];
  progress: { done: number; total: number };
  plant: PlantState;
  /** Days since the candidate last did anything (the Quiet flag) and days left on the offer (Expires soon). */
  quietDays?: number;
  expiresInDays?: number;
}

export interface BoardDTO {
  tab: BoardTab;
  columns: Array<{ key: BoardColumn; label: string; cards: BoardCard[] }>;
  counts: Record<BoardTab, number>;
}

export type JourneyTaskStatus = 'locked' | 'todo' | 'in_review' | 'sent_back' | 'done' | 'skipped' | 'cancelled';

export interface TaskView {
  id: string;
  systemKey?: string;
  phase: LifecyclePhase;
  title: string;
  helper?: string;
  ownerRole: OwnerRole;
  ownerName?: string;
  kind: TaskKind;
  surface: TaskSurface;
  mustDo: boolean;
  status: JourneyTaskStatus;
  opensAt?: string | null;
  dueAt?: string | null;
  dueLabel?: string;
  doneAt?: string;
  doneByName?: string;
  note?: string;
  late: boolean;
  month?: number;
  /** On the panel: whether Nudge can remind its owner, and whether someone did today. */
  canNudge?: boolean;
  nudgedToday?: boolean;
}

/** The Day-1 tasks an agenda line can stand for (one line each). */
export const AGENDA_TASK_KEYS = ['welcome_induction', 'meet_manager', 'meet_team', 'vision_culture'] as const;
export type AgendaTaskKey = (typeof AGENDA_TASK_KEYS)[number];
export const AGENDA_TASK_LABEL: Record<AgendaTaskKey, string> = {
  welcome_induction: 'Welcome and induction', meet_manager: 'Meet your manager', meet_team: 'Meet your team', vision_culture: 'Company vision and culture',
};

export interface CandidateDetails { name: string; personalEmail: string; phone?: string; workEmail?: string }

export interface Day1Pass {
  date?: string;
  reportingTime?: string;
  place?: string;
  mapLink?: string;
  meetingLink?: string;
  askFor?: { name: string; phone?: string };
  hrContact?: { name: string; email?: string; phone?: string };
  bring?: string[];
  /** `id`: the line's own (its meeting follows it). `taskKey`: the Day-1 task HR says it is; null none; absent on lines saved before (the server guesses once from the title). */
  agenda?: Array<{ id?: string; time: string; title: string; with?: string; taskKey?: AgendaTaskKey | null }>;
}

export interface ConfirmationDecision {
  outcome: 'confirm' | 'extend' | 'not_confirm';
  extendMonths?: number;
  salary?: number;
  kpiTemplateId?: string;
  designation?: string;
  reportingToUserId?: string;
  letterId?: string;
  decidedAt?: string;
  decidedByName?: string;
  revealedAt?: string;
}

export interface JourneyView {
  id: string;
  kind: LifecycleKind;
  userId?: string;
  candidate?: CandidateDetails;
  managerUserId?: string;
  buddyUserId?: string;
  templateId: string;
  status: OnboardingStatus | string;
  stage?: OnboardingStage;
  tj?: string;
  tl?: string;
  anchors?: Partial<Record<'offer_sent' | 'accepted' | 'finalised' | 'exit_accepted', string>>;
  offerId?: string;
  designation?: string;
  department?: string;
  location?: string;
  plant?: PlantState;
  day1Pass?: Day1Pass;
  probation?: { months: number; extendedBy?: number; decision?: ConfirmationDecision };
  lastActivityAt?: string;
  closedAt?: string;
  closedReason?: string;
  createdAt?: string;
  updatedAt?: string;
  /** The week-1 bank / PF change waiting for HR (HR's view only; the account and UAN show their last four). */
  bankPfRequest?: BankPfRequest;
  waitingOn?: WaitingOn[];
  managerName?: string;
  buddyName?: string;
  dayLabel: string;
  flags: JourneyFlag[];
  column: BoardColumn;
  tab: BoardTab;
}

export interface BankPfRequest {
  status: 'pending' | 'approved' | 'declined';
  changes: { bankName?: string; ifsc?: string; accountLast4?: string; uanLast4?: string };
  note?: string;
  requestedAt: string;
  decidedAt?: string;
  decidedByName?: string;
  hrNote?: string;
}

// —— Offers, documents, letters ——————————————————————————————————————————

export interface OfferFields {
  designation: string;
  department?: string;
  location?: string;
  /** Annual CTC in rupees. Never shown to anyone without payroll access. */
  ctc: number;
  tj: string;
  managerUserId?: string;
  probationMonths: number;
  noticeDays: number;
  validTill: string;
  responsibilities?: string;
  employeeType?: 'full_time' | 'intern' | 'contract';
}

export type OfferVersionStatus = 'draft' | 'sent' | 'accepted' | 'replaced' | 'declined' | 'expired' | 'withdrawn';

export interface OfferView {
  journeyId: string;
  version: number;
  status: OfferVersionStatus | string;
  fields: OfferFields & { managerName?: string };
  changedFields?: Array<keyof OfferFields>;
  sentAt?: string;
  acceptedAt?: string;
  finalisedAt?: string;
  validTill: string;
  pdfFileId?: string;
  versions: Array<{ version: number; status: OfferVersionStatus | string; sentAt?: string; acceptedAt?: string }>;
}

export type CandidateDocumentStatus = 'todo' | 'in_review' | 'approved' | 'sent_back';
export interface FileMeta { id: string; name: string; contentType: string; size: number }
export interface CandidateDocumentView {
  id: string;
  journeyId: string;
  docKey: string;
  label: string;
  required: boolean;
  fileIds: string[];
  status: CandidateDocumentStatus;
  hrNote?: string;
  uploadedAt?: string;
  reviewedAt?: string;
  reviewedByName?: string;
  files: FileMeta[];
}

export type LetterKind = 'offer' | 'appointment' | 'nda' | 'confirmation' | 'extension' | 'relieving';
export type AttachmentKind = 'salary_breakup' | 'joining_checklist' | 'policies' | 'other';
export interface LetterAttachment { fileId: string; name: string; kind: AttachmentKind }
/** A letter's email: HR's saved draft until `sentAt`. */
export interface LetterEmail { to: string; cc?: string[]; subject: string; body: string; sentAt?: string; savedAt?: string; withPortalLink?: boolean; attachments?: LetterAttachment[] }
export interface LetterView {
  id: string;
  kind: LetterKind;
  refNo: string;
  state: 'draft' | 'sent' | 'ready' | 'opened' | 'signed';
  pdfFileId?: string;
  signedPdfFileId?: string;
  sentAt?: string;
  signedAt?: string;
  /** From GET /letters (the list); the panel's letters leave it out. */
  email?: LetterEmail;
  createdAt?: string;
}

/** Annexure A: the offer's CTC split by one of the company's salary templates (rupees). */
export interface SalaryBreakup {
  templates: Array<{ code: string; name: string }>;
  templateCode?: string;
  breakup: null | {
    templateName: string; ctcAnnual: number; ctcMonthly: number; grossMonthly: number;
    lines: Array<{ name: string; group: 'earning' | 'reimbursement' | 'benefit' | 'employer'; monthly: number; annual: number }>;
  };
  reason?: string;
}
export interface LetterTemplateDTO { id: string; kind: LetterKind; name: string; body: string; isDefault: boolean; updatedAt?: string }

export interface DateChangeRequestDTO {
  id: string;
  journeyId: string;
  requestedTj: string;
  reason: 'Notice period' | 'Personal' | 'Something else' | string;
  note?: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: string;
  decidedAt?: string;
  decidedByName?: string;
}

export interface ProbationMonthDTO {
  id: string;
  monthNo: number;
  goals: Array<{ text: string }>;
  goalsSetAt?: string;
  lockedAt?: string;
  checkinEmployee?: { text: string; rating?: number; at: string };
  checkinManager?: { text: string; rating?: number; at: string };
  review?: { text: string; at: string };
}

export interface JourneyDetail {
  journey: JourneyView;
  tasks: TaskView[];
  documents: CandidateDocumentView[];
  letters: LetterView[];
  offer: OfferView | null;
  dateRequests: DateChangeRequestDTO[];
  probation: { months: ProbationMonthDTO[]; decision?: ConfirmationDecision };
  batch: Array<{ journeyId: string; name: string }>;
  /** What this viewer may see: pay (a payroll tab) and candidates' documents (HR). */
  viewer?: { seesPay: boolean; seesDocuments: boolean };
}

export interface TemplateJourney {
  journeyId: string; kind: LifecycleKind; name: string; designation?: string; department?: string; userId?: string;
  status: string; tj?: string; tl?: string; tab?: BoardTab; column?: BoardColumn;
}

// —— Calls ———————————————————————————————————————————————————————————————

const L = '/admin/lifecycle';
const qs = (params: Record<string, string | undefined>) => {
  const p = Object.entries(params).filter(([, v]) => v != null && v !== '') as [string, string][];
  return p.length ? `?${new URLSearchParams(p).toString()}` : '';
};
const json = (method: 'POST' | 'PUT' | 'DELETE', body?: unknown) => ({ method, body: body ?? {} });

/** The company's switch is off: the routes answer 404 "Not available". */
export function isNotAvailable(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404 && /not available/i.test(e.message);
}

export const getLifecycleSettings = () => api<{ enabled: boolean; tabs: string[] }>(`${L}/settings`);

// Templates
export const listTemplates = (kind?: LifecycleKind) =>
  api<{ templates: TemplateListItem[] }>(`${L}/templates${qs({ kind })}`).then((r) => r.templates);
export const createTemplate = (input: { kind: LifecycleKind; name: string; group?: string; copyFromId?: string }) =>
  api<{ template: LifecycleTemplate }>(`${L}/templates`, json('POST', input)).then((r) => r.template);
export const getTemplate = (id: string) => api<{ template: LifecycleTemplate }>(`${L}/templates/${id}`).then((r) => r.template);
export const updateTemplate = (id: string, patch: Partial<Pick<LifecycleTemplate, 'name' | 'group' | 'active' | 'isDefault' | 'settings' | 'tasks'>>) =>
  api<{ template: LifecycleTemplate }>(`${L}/templates/${id}`, json('PUT', patch)).then((r) => r.template);
export const deleteTemplate = (id: string) => api<unknown>(`${L}/templates/${id}`, { method: 'DELETE' });

// Board and journeys
export const getBoard = (p: { tab: BoardTab; q?: string; filter?: BoardFilter; from?: string; to?: string }) =>
  api<BoardDTO>(`${L}/board${qs(p)}`);
/** Offers that ended before joining: the board's Closed view (declined, expired, not joining). */
export interface ClosedJourneyRow {
  journeyId: string; name: string; designation?: string; department?: string;
  status: 'declined' | 'expired' | 'not_joining'; closedAt?: string; closedReason?: string; tj?: string;
}
export const getClosedJourneys = (q?: string) => api<{ journeys: ClosedJourneyRow[] }>(`${L}/closed${qs({ q })}`).then((r) => r.journeys);
export const getJourney = (id: string) => api<JourneyDetail>(`${L}/journeys/${id}`);
export const journeyTaskAction = (id: string, taskId: string, action: 'done' | 'reopen' | 'skip', note?: string) =>
  api<{ task: TaskView }>(`${L}/journeys/${id}/tasks/${taskId}`, json('POST', { action, ...(note ? { note } : {}) })).then((r) => r.task);
export const updateJourney = (id: string, patch: { managerUserId?: string; buddyUserId?: string; day1Pass?: Day1Pass; templateId?: string }) =>
  api<{ journey: JourneyView }>(`${L}/journeys/${id}`, json('PUT', patch)).then((r) => r.journey);
export const nudgeTask = (id: string, taskId: string) =>
  api<{ nudged: { taskId: string; channel: 'email' | 'push'; who: 'candidate' | 'joiner' | 'manager'; to: string; at: string } }>(`${L}/journeys/${id}/tasks/${taskId}/nudge`, json('POST')).then((r) => r.nudged);
export const decideBankPfRequest = (id: string, decision: 'approve' | 'decline', note?: string) =>
  api<{ journey: JourneyView }>(`${L}/journeys/${id}/bank-pf-request`, json('POST', { decision, ...(note ? { note } : {}) })).then((r) => r.journey);
/** The sidebar's Onboarding badge: joiners who need HR now or are late. */
export const getLifecycleCounts = () => api<{ onboarding: { badge: number; needsYou: number; late: number } }>(`${L}/counts`);
export const getTemplateJourneys = (id: string) => api<{ journeys: TemplateJourney[] }>(`${L}/templates/${id}/journeys`).then((r) => r.journeys);
export const getProbation = (id: string) => api<{ months: ProbationMonthDTO[]; decision?: ConfirmationDecision }>(`${L}/journeys/${id}/probation`);
export const recordDecision = (id: string, body: Omit<ConfirmationDecision, 'decidedAt' | 'decidedByName' | 'letterId' | 'revealedAt'>) =>
  api<{ decision: ConfirmationDecision }>(`${L}/journeys/${id}/decision`, json('POST', body)).then((r) => r.decision);

// Offers
export const createOffer = (input: { candidate: { name: string; personalEmail: string; phone?: string }; fields: OfferFields; templateId?: string }) =>
  api<{ journeyId: string; offer: OfferView }>(`${L}/offers`, json('POST', input));
export const updateOffer = (journeyId: string, fields: OfferFields) =>
  api<{ offer: OfferView }>(`${L}/offers/${journeyId}`, json('PUT', { fields })).then((r) => r.offer);
const pdfForm = (pdf: Blob, filename: string) => {
  const form = new FormData();
  form.append('file', new File([pdf], filename, { type: 'application/pdf' }));
  return form;
};
export const uploadOfferPdf = (journeyId: string, pdf: Blob, filename: string) =>
  apiUpload<{ offer: OfferView }>(`${L}/offers/${journeyId}/pdf`, pdfForm(pdf, filename)).then((r) => r.offer);
export const sendOffer = (journeyId: string, email: { subject: string; body: string; cc?: string[]; withPortalLink?: boolean; attachments?: LetterAttachment[] }) =>
  api<{ offer: OfferView }>(`${L}/offers/${journeyId}/send`, json('POST', email)).then((r) => r.offer);
export const finaliseOffer = (journeyId: string) =>
  api<{ offer: OfferView }>(`${L}/offers/${journeyId}/finalise`, json('POST')).then((r) => r.offer);
export const offerStatusAction = (journeyId: string, action: 'decline' | 'reopen' | 'not-joining', note?: string) =>
  api<{ journey: JourneyView }>(`${L}/offers/${journeyId}/${action}`, json('POST', note ? { note } : {})).then((r) => r.journey);
export const markJoined = (journeyId: string, input: { workEmail: string; employeeId?: string }) =>
  api<{ journey: JourneyView; userId: string }>(`${L}/offers/${journeyId}/mark-joined`, json('POST', input));
export const decideDateRequest = (id: string, decision: 'approve' | 'decline', note?: string) =>
  api<{ request: DateChangeRequestDTO }>(`${L}/date-requests/${id}`, json('POST', { decision, ...(note ? { note } : {}) })).then((r) => r.request);

// Candidate documents and files
export const getJourneyDocuments = (journeyId: string) =>
  api<{ documents: CandidateDocumentView[] }>(`${L}/journeys/${journeyId}/documents`).then((r) => r.documents);
export const reviewDocument = (id: string, decision: 'approve' | 'send_back', note?: string) =>
  api<{ document: CandidateDocumentView }>(`${L}/documents/${id}/review`, json('POST', { decision, ...(note ? { note } : {}) })).then((r) => r.document);

/** A stored file's bytes, through the authorised endpoint (never a public URL). */
export async function fetchLifecycleFile(id: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${L}/files/${encodeURIComponent(id)}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, data.error || data.message || `Could not open the file (${res.status})`);
  }
  return res.blob();
}

// Letters
export const listLetterTemplates = (kind?: LetterKind) =>
  api<{ templates: LetterTemplateDTO[] }>(`${L}/letter-templates${qs({ kind })}`).then((r) => (kind ? r.templates.filter((t) => t.kind === kind) : r.templates));
export const createLetterTemplate = (input: { kind: LetterKind; name: string; body: string; isDefault?: boolean }) =>
  api<{ template: LetterTemplateDTO }>(`${L}/letter-templates`, json('POST', input)).then((r) => r.template);
export const updateLetterTemplate = (id: string, input: { kind: LetterKind; name: string; body: string; isDefault?: boolean }) =>
  api<{ template: LetterTemplateDTO }>(`${L}/letter-templates/${id}`, json('PUT', input)).then((r) => r.template);
export const getMergeValues = (p: { kind: LetterKind; journeyId?: string; userId?: string }) =>
  api<{ values: Record<string, string>; missing: string[] }>(`${L}/letters/merge${qs(p)}`);
export const createLetter = (input: { kind: LetterKind; journeyId?: string; userId?: string; templateId: string; values: Record<string, string> }) =>
  api<{ letter: LetterView }>(`${L}/letters`, json('POST', input)).then((r) => r.letter);
export const uploadLetterPdf = (id: string, pdf: Blob, filename: string) =>
  apiUpload<{ letter: LetterView }>(`${L}/letters/${id}/pdf`, pdfForm(pdf, filename)).then((r) => r.letter);
export const sendLetter = (id: string, email: { to: string; cc?: string[]; subject: string; body: string; withPortalLink?: boolean; attachments?: LetterAttachment[] }) =>
  api<{ letter: LetterView }>(`${L}/letters/${id}/send`, json('POST', email)).then((r) => r.letter);
/** Save draft: the email stays on the letter until it is sent. */
export const saveLetterDraft = (id: string, email: { to?: string; cc?: string[]; subject?: string; body?: string; withPortalLink?: boolean; attachments?: LetterAttachment[] }) =>
  api<{ letter: LetterView }>(`${L}/letters/${id}/draft`, json('PUT', email)).then((r) => r.letter);
/** An extra file for a letter's email (salary breakup, joining checklist, company policies). */
export const uploadLetterAttachment = (file: Blob, filename: string, kind: AttachmentKind, journeyId?: string) => {
  const form = new FormData();
  form.append('file', new File([file], filename, { type: file.type || 'application/pdf' }));
  form.append('kind', kind);
  if (journeyId) form.append('journeyId', journeyId);
  return apiUpload<{ attachment: LetterAttachment; size: number; contentType: string }>(`${L}/letters/attachments`, form);
};
export const getSalaryBreakup = (journeyId: string, template?: string) =>
  api<SalaryBreakup>(`${L}/letters/salary-breakup${qs({ journeyId, template })}`);
export const listLetters = (p: { journeyId?: string; userId?: string; kind?: LetterKind }) =>
  api<{ letters: LetterView[] }>(`${L}/letters${qs(p)}`).then((r) => r.letters);
