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

export type OwnerRole = 'employee' | 'manager' | 'hr' | 'it' | 'admin' | 'finance' | 'manager_employee' | 'hr_manager' | 'automatic' | 'buddy' | 'head_of_department';
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
  /** A team-side task (the manager's, buddy's or head of department's, assigned and followed by HR on the dashboard); kept as it is on save. */
  team?: { key: string; kind: string; early?: boolean; pair?: string; agenda?: string[] };
  /** A meeting's agenda: the points the joiner's and the manager's meeting screens list. Empty: the standard one. */
  agenda?: string[];
}

/** The manager's recommendation from the app and the head of department's answer, by HR's decision. */
export interface ConfirmationRecommendation { outcome: 'confirm' | 'extend'; note?: string; byUserId: string; byName?: string; at: string }
export interface ConfirmationHodApproval { outcome: 'approved' | 'discuss'; comment?: string; byUserId: string; byName?: string; at: string }

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
export type TemplateListItem = LifecycleTemplate & { journeysUsing: number; recommendedNotAdded: number; /** An onboarding template with Final-designs rows. */ design?: boolean };

// —— Onboarding template design (Final designs; docs/lifecycle/FINAL-DESIGNS.md §2, §4.1) ——————————

export type DesignStage = 'pre' | 'd1' | 'w1' | 'm1' | 'mid' | 'fin';
export type JoinerTaskType = 'do' | 'review' | 'ack' | 'sign' | 'other' | 'form';
export type MeetWith = 'hr' | 'manager' | 'buddy' | 'it' | 'head_of_department';
export type TeamRole = 'manager' | 'buddy' | 'hr' | 'it' | 'senior' | 'head_of_department';
export type CheckinAnswerType = 'rating' | 'yes_no' | 'short' | 'long' | 'choice';
export type FormAnswerType = 'short' | 'long' | 'choice' | 'date' | 'file';
export type TourLesson = 'punch' | 'missed' | 'leave' | 'overtime' | 'approveLeave' | 'approveOvertime';
export type MediaBackground = 'rust' | 'blue' | 'ink' | 'green' | 'purple' | 'sand';
export interface DesignQuestion<T extends string = string> { id?: string; text: string; type: T; options?: string[] }
export interface DesignMedia { type: 'video' | 'image' | 'text' | 'pdf'; fileId?: string; text?: string; bg?: MediaBackground; minutes?: number; name?: string; /** A video's still frame: its tile's thumbnail. */ posterFileId?: string }
export interface DesignWatchItem { id?: string; title: string; stage: DesignStage; media: DesignMedia }
export interface DesignReporting { time?: string; place?: string; mapLink?: string; bring?: string; notes?: string; meets: 'hr' | 'manager' | 'buddy' }
export interface DesignMeeting { id?: string; title: string; meetWith: MeetWith; stage: DesignStage; agenda: string[]; everyMonth?: boolean }
export interface DesignTask {
  id?: string; title: string; type: JoinerTaskType; stage: DesignStage;
  screen?: string; source?: 'policies'; link?: string; fileId?: string; letterTemplateId?: string; signDocs?: string[];
  questions?: Array<DesignQuestion<FormAnswerType>>;
}
export interface DesignCheckin { id?: string; title: string; stage: DesignStage; questions: Array<DesignQuestion<CheckinAnswerType>> }
export interface DesignAccess { id?: string; title: string; role: 'it' | 'hr' }
export interface DesignTeamTask { id?: string; key?: string; title: string; role: TeamRole; stage: DesignStage; how?: string; everyMonth?: boolean }
export interface TemplateDesign {
  templateId: string; name: string; isDefault: boolean; updatedAt?: string; updatedByName?: string;
  preboarding: {
    rows: { offerLetter: boolean; joiningDetails: boolean; profile: boolean; watch: boolean };
    reporting: DesignReporting;
    videos: DesignWatchItem[];
  };
  meetings: DesignMeeting[];
  tasks: DesignTask[];
  checkins: DesignCheckin[];
  tour: TourLesson[];
  watch: DesignWatchItem[];
  trainings: DesignWatchItem[];
  /** The app's names for the sections HR can rename (older servers send none). */
  labels?: { trainings: string };
  accesses: DesignAccess[];
  probation: { months: 3 | 6; shiftTemplateId?: string };
  team: { remindLate: boolean; assignees: { hrUserId?: string; itUserId?: string; seniorUserId?: string }; tasks: DesignTeamTask[] };
}
export type TemplatePreview =
  | { stage: 'pre'; header: 'Welcome'; stageLabel: string; joining: { time?: string; place?: string; meets: 'hr' | 'manager' | 'buddy' } | null;
      offerLetter: boolean; profile: { sections: number } | null; watch: { first: string; ready: number; total: number } | null }
  | { stage: Exclude<DesignStage, 'pre'>; header: 'Onboarding'; stageLabel: string; meetings: { count: number; who: MeetWith[] };
      tasks: { first?: string; count: number }; tour: { first: TourLesson | null } | null; watch: { first: string; ready: number; total: number } | null;
      devices: { count: number } | null; profile: true };
export interface TemplateMediaFile { id: string; name: string; contentType: string; size: number; minutes?: number }

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
  /** Optional documents waiting for HR's look (they don't hold Documents open). */
  optionalWaiting?: number;
  /** Days since the candidate last did anything (the Quiet flag) and days left on the offer (Expires soon). */
  quietDays?: number;
  expiresInDays?: number;
  /** Pre-boarding cards: when the current offer went out (and its version), when it was accepted, and its reply-by day. */
  offerSentAt?: string;
  offerVersion?: number;
  acceptedAt?: string;
  replyBy?: string;
}

export interface ProfileAddressView { line: string; city: string; state: string; pin: string }
export interface CandidateProfileView {
  personal?: { fullName: string; preferredName?: string; dob: string; gender: string; maritalStatus?: string; nationality?: string };
  contact?: { mobile: string; current: ProfileAddressView; permanentSame: boolean; permanent?: ProfileAddressView };
  bank?: { holderName: string; ifsc: string; accountLast4: string; bankName?: string };
  education?: { qualification: string; institution: string; year: string };
  experience?: { firstJob: boolean; jobs: Array<{ company: string; role: string; from: string; to?: string }> };
  ids?: { aadhaarLast4?: string; panLast4?: string };
  photoFileId?: string;
  savedAt?: string;
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
  /** On the panel: a Devices and accesses row (Laptop, Work email…), made from the template's access rows. */
  section?: 'access';
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
  /** The manager and buddy when the server made the pass. */
  managerName?: string;
  buddyName?: string;
  /** Made by the server at Tj − 7 from the template; gone once HR saves the pass. */
  auto?: { at: string };
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

/** One Week 1 setup choice made before the joiner had an account; `error` once applying it failed. */
interface PendingChoice { name: string; by: { userId: string; name: string }; at: string; error?: string; failedAt?: string }
export interface PendingSetup {
  kpi?: PendingChoice & { templateId: string };
  /** The CTC only for someone with pay access. */
  salary?: PendingChoice & { templateCode: string; annualCtcPaise?: number; effectiveFrom: string };
  shift?: PendingChoice & { shiftTemplateId: string };
}

export interface JourneyView {
  id: string;
  kind: LifecycleKind;
  userId?: string;
  /** The app account HR made before joining (Generate app access). */
  appAccess?: { userId: string; createdAt: string };
  /** Week 1's setup chosen before they had an account, applied when it is made (a failed one stays, with `error`). */
  pendingSetup?: PendingSetup;
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
  /** The joiner's "How was today?" on "Day 1, done!" in the app. */
  day1Feeling?: { answer: 'great' | 'okay' | 'tough'; at: string };
  probation?: { months: number; extendedBy?: number; decision?: ConfirmationDecision; recommendation?: ConfirmationRecommendation; hodApproval?: ConfirmationHodApproval };
  lastActivityAt?: string;
  closedAt?: string;
  closedReason?: string;
  createdAt?: string;
  updatedAt?: string;
  /** The week-1 bank / PF change waiting for HR (HR's view only; the account and UAN show their last four). */
  bankPfRequest?: BankPfRequest;
  /** The portal's Employee profile (HR only; the account number, Aadhaar and PAN as their last four). */
  profile?: CandidateProfileView;
  /** The portal's Employee profile sections done (the portal's and the app's "n of 5 sections done"; bank and PF is its own task since 24 Nov). */
  profileSections?: { done: number; total: number };
  /** The portal's About you: the emergency contact and PF (HR only). */
  aboutYou?: {
    emergencyContact?: { name: string; relation: string; phone: string; altPhone?: string };
    emergencyContact2?: { name: string; relation: string; phone: string; altPhone?: string };
    pf?: { firstJob: boolean; uan?: string };
  };
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
  /** 'payroll_task': the joiner app's "Complete your payroll details"; else an older week-1 change. */
  source?: 'week1' | 'payroll_task';
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
  refNo?: string;
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
  /** Where the email went (the confirmation letter: the employee's work email). */
  sentTo?: string;
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
  /** The manager sent the joiner's self check-in back from the app (team side). */
  sentBack?: { text?: string; at: string; byName?: string };
}

export interface JourneyDetail {
  journey: JourneyView;
  tasks: TaskView[];
  documents: CandidateDocumentView[];
  letters: LetterView[];
  offer: OfferView | null;
  dateRequests: DateChangeRequestDTO[];
  probation: { months: ProbationMonthDTO[]; decision?: ConfirmationDecision; recommendation?: ConfirmationRecommendation; hodApproval?: ConfirmationHodApproval };
  batch: Array<{ journeyId: string; name: string }>;
  /** What this viewer may see: pay (a payroll tab) and candidates' documents (HR). */
  viewer?: { seesPay: boolean; seesDocuments: boolean };
  /** The team side's rows (manager, buddy, head of department) as the app ticks them. */
  teamRows?: Array<{ id: string; title: string; owner: 'manager' | 'buddy' | 'head_of_department'; step: string; done: boolean; doneByName?: string; doneAt?: string }>;
  /** The joining and reporting details this joiner has (their copy of the template; absent when the template has none). */
  reporting?: DesignReporting;
  /** The reviews on the journey: each is done where it lives (its place), never by a tick on the journey. */
  reviews?: JourneyReview[];
  /** Whether their account (once joined, or app access given before) has signed in to the app, and when first and last. */
  appSignIn?: { signedIn: boolean; firstAt?: string; lastAt?: string };
  /** Their first punch-in ever (Joining day's "Punched in"). */
  firstPunch?: { punched: boolean; at?: string };
}

/** Where a review is done: the profile page's Documents, its joining-form sections, Salary details › Bank account and PF, the decision, the recommendation, the letter. */
export type ReviewPlace = 'documents' | 'joining_form' | 'bank_pf' | 'tax' | 'decision' | 'recommendation' | 'letter';
export interface JourneyReview {
  key: string; title: string; step: 'joining_day' | 'week_1' | 'final_month' | 'confirmed'; place: ReviewPlace; owner: OwnerRole;
  done: boolean; doneByName?: string; doneAt?: string;
  /** Not done: what it waits for. */
  line?: string;
  /** The joining form: the section to open. */
  focus?: string;
}

export interface TemplateJourney {
  journeyId: string; kind: LifecycleKind; name: string; designation?: string; department?: string; userId?: string;
  status: string; tj?: string; tl?: string; tab?: BoardTab; column?: BoardColumn;
  /** The joiner's stage in the app (after joining). */
  stage?: string;
  location?: string; employeeId?: string; managerUserId?: string; managerName?: string;
  /** The template the journey is on (with ?scope=all, not always this one). */
  templateId: string; templateName: string;
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
export const getTemplateDesign = (id: string) => api<TemplateDesign>(`${L}/templates/${id}/design`);
/** "Save template": the whole design (read-only fields left out; a new row has no id). */
export const saveTemplateDesign = (id: string, design: Omit<TemplateDesign, 'templateId' | 'name' | 'isDefault' | 'updatedAt' | 'updatedByName'>) =>
  api<TemplateDesign>(`${L}/templates/${id}/design`, json('PUT', design));
export const getTemplatePreview = (id: string, stage: DesignStage) => api<TemplatePreview>(`${L}/templates/${id}/preview${qs({ stage })}`);
/** A pre-boarding or watch-list video, an image, or a PDF (a training, a document to acknowledge). */
export const uploadTemplateMedia = (templateId: string, file: Blob, filename: string) => {
  const form = new FormData();
  form.append('file', file instanceof File ? file : new File([file], filename, { type: file.type || 'application/octet-stream' }));
  return apiUpload<{ file: TemplateMediaFile }>(`${L}/templates/${templateId}/media`, form).then((r) => r.file);
};

// Board and journeys
export const getBoard = (p: { tab: BoardTab; q?: string; filter?: BoardFilter; from?: string; to?: string }) =>
  api<BoardDTO>(`${L}/board${qs(p)}`);
/** Everyone on the onboarding board, light: the Documents page's joiner picker. */
export interface JoinerPick { journeyId: string; name: string; designation?: string; dayLabel: string; tab: BoardTab }
export const getJoinerPicks = () => api<{ joiners: JoinerPick[] }>(`${L}/joiners`).then((r) => r.joiners);
/** Offers that ended before joining: the board's Closed view (declined, expired, not joining). */
export interface ClosedJourneyRow {
  journeyId: string; name: string; designation?: string; department?: string;
  status: 'declined' | 'expired' | 'not_joining'; closedAt?: string; closedReason?: string; tj?: string; offerSentAt?: string;
}
export const getClosedJourneys = (q?: string) => api<{ journeys: ClosedJourneyRow[] }>(`${L}/closed${qs({ q })}`).then((r) => r.journeys);
export const getJourney = (id: string) => api<JourneyDetail>(`${L}/journeys/${id}`);
export const journeyTaskAction = (id: string, taskId: string, action: 'done' | 'reopen' | 'skip', note?: string) =>
  api<{ task: TaskView }>(`${L}/journeys/${id}/tasks/${taskId}`, json('POST', { action, ...(note ? { note } : {}) })).then((r) => r.task);
export const updateJourney = (id: string, patch: { managerUserId?: string; buddyUserId?: string; day1Pass?: Day1Pass; templateId?: string }) =>
  api<{ journey: JourneyView }>(`${L}/journeys/${id}`, json('PUT', patch)).then((r) => r.journey);
/**
 * Week 1's setup chosen before the joiner has an account (KPI, salary, shift templates): kept on the journey and
 * applied when the account is made. Each kind given is set, `null` clears it. Answers the pending setup.
 */
export const savePendingSetup = (id: string, patch: {
  kpi?: { templateId: string } | null;
  salary?: { templateCode: string; annualCtcPaise: number; effectiveFrom: string } | null;
  shift?: { templateId: string } | null;
}) => api<{ pendingSetup: PendingSetup }>(`${L}/journeys/${encodeURIComponent(id)}/pending-setup`, json('PUT', patch)).then((r) => r.pendingSetup);
export const nudgeTask = (id: string, taskId: string) =>
  api<{ nudged: { taskId: string; channel: 'email' | 'push'; who: 'candidate' | 'joiner' | 'manager'; to: string; at: string } }>(`${L}/journeys/${id}/tasks/${taskId}/nudge`, json('POST')).then((r) => r.nudged);
export const decideBankPfRequest = (id: string, decision: 'approve' | 'decline', note?: string) =>
  api<{ journey: JourneyView }>(`${L}/journeys/${id}/bank-pf-request`, json('POST', { decision, ...(note ? { note } : {}) })).then((r) => r.journey);
/** The sidebar's Onboarding badge: joiners who need HR now or are late. */
export const getLifecycleCounts = () => api<{ onboarding: { badge: number; needsYou: number; late: number } }>(`${L}/counts`);
/** Who follows a template; `all`: every open journey of its kind, each naming its template (Edit joiners). */
export const getTemplateJourneys = (id: string, scope?: 'all') => api<{ journeys: TemplateJourney[] }>(`${L}/templates/${id}/journeys${qs({ scope })}`).then((r) => r.journeys);
/** Edit joiners: moves joiners onto this onboarding template (a joiner is always on exactly one). */
export const moveJourneysToTemplate = (id: string, journeyIds: string[]) =>
  api<{ template: { id: string; name: string }; moved: Array<{ journeyId: string; fromTemplateId: string; kept?: number; added?: string[]; cancelled?: string[] }>; alreadyOn: number }>(
    `${L}/templates/${id}/journeys`, json('POST', { journeyIds }));
export const getProbation = (id: string) => api<{ months: ProbationMonthDTO[]; decision?: ConfirmationDecision }>(`${L}/journeys/${id}/probation`);
export const recordDecision = (id: string, body: Omit<ConfirmationDecision, 'decidedAt' | 'decidedByName' | 'letterId' | 'revealedAt'>) =>
  api<{ decision: ConfirmationDecision }>(`${L}/journeys/${id}/decision`, json('POST', body)).then((r) => r.decision);

// Offers
/**
 * A new joining date on a week-off or holiday is refused (409, code `non_working_day`, with `day`, `why`
 * and the sentence in `error`); `allowNonWorkingDay: true` inside `fields` sends it anyway, once HR has
 * said to use that date.
 */
export const NON_WORKING_DAY = 'non_working_day';
type OfferSave = { allowNonWorkingDay?: boolean };
const withAllow = (fields: OfferFields, opts: OfferSave) => (opts.allowNonWorkingDay ? { ...fields, allowNonWorkingDay: true } : fields);
export const createOffer = (input: { candidate: { name: string; personalEmail: string; phone?: string }; fields: OfferFields; templateId?: string }, opts: OfferSave = {}) =>
  api<{ journeyId: string; offer: OfferView }>(`${L}/offers`, json('POST', { ...input, fields: withAllow(input.fields, opts) }));
export const updateOffer = (journeyId: string, fields: OfferFields, opts: OfferSave = {}) =>
  api<{ offer: OfferView }>(`${L}/offers/${journeyId}`, json('PUT', { fields: withAllow(fields, opts) })).then((r) => r.offer);
export const getOffer = (journeyId: string) =>
  api<{ offer: OfferView | null }>(`${L}/offers/${journeyId}`).then((r) => r.offer);
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

/** A template's uploaded video, image or PDF, through the authorised endpoint: the editor's preview. */
export async function fetchTemplateMedia(fileId: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${L}/templates/media/${encodeURIComponent(fileId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
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
/** The joiner panel's confirmation letter: sent to the employee's work email (their account's), kept as the journey's confirmation letter. */
export const sendConfirmationLetter = (id: string) =>
  api<{ letter: LetterView; sentTo: string; sentAt: string }>(`${L}/letters/${id}/send-confirmation`, json('POST', {}));
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

// —— Pre-boarding profiles ———————————————————————————————————————————————
// Everyone before joining, and one candidate's Employee profile section by section
// (People › Employees › Pre-boarding). A section HR approves is locked: the
// candidate can no longer edit it on the portal or the app. Bank account and PF is
// not a section (24 Nov): `bankPf`, the joiner's own task, shown on Salary details.

export type PreboardingSectionKey = 'personal' | 'contact' | 'emergency' | 'bank' | 'education' | 'ids';
export interface PreboardingRow {
  journeyId: string;
  name: string;
  designation?: string;
  department?: string;
  /** Joining day, 'YYYY-MM-DD'. */
  tj?: string;
  status: string;
  profileDone: number;
  profileTotal: number;
  approvedSections: number;
  documentsWaiting: number;
}
/** A stored file; `url` opens it (an API path is fetched with the sign-in, a full link as it is). */
export interface StoredFileLink { id: string; name: string; contentType: string; size: number; url: string }
export interface PreboardingDocument {
  id: string;
  label: string;
  required: boolean;
  status: CandidateDocumentStatus;
  hrNote?: string;
  files: StoredFileLink[];
}
export interface PreboardingAddress { line: string; city: string; state: string; pin: string }
export interface PreboardingJob { company: string; role: string; /** 'YYYY-MM'. */ from: string; to?: string }
/**
 * What each section holds, as HR's edit form sends it (PUT …/profile/:section). The secrets travel
 * one way only: the GET answers their last four (`PreboardingSectionValues`), a PUT sends a new number
 * or leaves it out to keep the stored one.
 */
export interface PreboardingSectionInput {
  personal: { fullName: string; /** 'YYYY-MM-DD'. */ dob: string; gender: string; maritalStatus?: string; nationality?: string };
  contact: { mobile: string; current: PreboardingAddress; permanentSame: boolean; permanent?: PreboardingAddress };
  emergency: { emergencyContact: { name: string; relation: string; phone: string; altPhone?: string } };
  bank: { holderName: string; /** Blank or missing keeps the stored number. */ accountNumber?: string; ifsc: string; bankName?: string; pf: { firstJob: boolean; uan?: string } };
  education: { qualification: string; institution: string; year: string; firstJob: boolean; jobs: PreboardingJob[] };
  /** Blank or missing keeps the stored number. */
  ids: { aadhaar?: string; pan?: string };
}
/** The section's answers as the GET gives them: the input's shape, with secrets as their last four. */
export interface PreboardingSectionValues {
  personal: PreboardingSectionInput['personal'];
  contact: PreboardingSectionInput['contact'];
  emergency: PreboardingSectionInput['emergency'];
  bank: Omit<PreboardingSectionInput['bank'], 'accountNumber' | 'pf'> & { accountLast4?: string; pf?: { firstJob: boolean; uan?: string; uanLast4?: string } };
  education: PreboardingSectionInput['education'];
  ids: { aadhaarLast4?: string; panLast4?: string };
}
export interface PreboardingSection {
  key: PreboardingSectionKey;
  title: string;
  done: boolean;
  approved?: { byName: string; at: string };
  /** HR's last change to the candidate's answers here. */
  editedByHr?: { byName: string; at: string };
  fields: Array<{ label: string; value: string }>;
  /** The answers in the edit form's shape; missing or null while the candidate has not filled the section. */
  values?: Partial<PreboardingSectionValues[PreboardingSectionKey]> | null;
  documents: PreboardingDocument[];
}
/** The Employee profile's Basic details for a candidate: what they will have once they join. */
export interface PreboardingBasicInput {
  employeeId?: string;
  workEmail?: string;
  designation?: string;
  department?: string;
  workLocation?: string;
  /** As the employee record keeps it: 'full_time', 'contract' or 'intern'. */
  employeeType?: string;
  /** Joining day, 'YYYY-MM-DD'. */
  tj?: string;
}
export interface PreboardingBasic extends PreboardingBasicInput {
  /** Who they will report to (the journey's manager, from the offer); read-only here. */
  reportingManager?: { userId: string; name: string };
  /** Their app account, once HR created it from this card. */
  appAccess?: { userId: string; createdAt: string };
}
/** The choices the portal offers for its picked fields. */
export interface PreboardingOptions { genders: string[]; marital: string[]; qualifications: string[]; relations: string[] }
/**
 * Bank account and PF, the joiner's own task (not counted in the profile): to do, declared in the app
 * (the payroll details task, done once sent), or approved by HR (written to payroll). HR edits it with
 * savePreboardingSection(…, 'bank', …), no joiner needed.
 */
export interface PreboardingBankPf {
  title: string;
  state: 'todo' | 'declared' | 'approved';
  declaredAt?: string;
  approved?: { byName: string; at: string };
  /** HR sent the declaration back: to do again until the joiner sends it once more. */
  sentBack?: { at: string; note?: string };
  editedByHr?: { byName: string; at: string };
  /** Where the details shown come from: the app's declaration, HR's edit, the portal (before 24 Nov), or nothing yet. */
  source: 'app' | 'hr' | 'portal' | 'none';
  fields: Array<{ label: string; value: string }>;
  values: Partial<PreboardingSectionValues['bank']>;
  documents: PreboardingDocument[];
}
export interface PreboardingProfile {
  journeyId: string;
  candidate: { name: string; personalEmail?: string; phone?: string; designation?: string; department?: string; tj?: string; status: string };
  done: number;
  total: number;
  sections: PreboardingSection[];
  bankPf?: PreboardingBankPf;
  options?: PreboardingOptions;
  basic?: PreboardingBasic;
}

export const listPreboarding = () => api<PreboardingRow[]>(`${L}/preboarding`);
export const getPreboardingProfile = (journeyId: string) =>
  api<PreboardingProfile>(`${L}/journeys/${encodeURIComponent(journeyId)}/profile`);
/** Approves and locks a section (409 while it is not complete); `false` unlocks it. Both answer the whole profile. */
export const setPreboardingSectionApproved = (journeyId: string, section: PreboardingSectionKey, approved: boolean) =>
  api<PreboardingProfile>(`${L}/journeys/${encodeURIComponent(journeyId)}/profile/${section}/approve`, { method: approved ? 'POST' : 'DELETE' });
/** HR changes a candidate's answers in one section (400 with a message when something is not valid); answers the whole profile. */
export const savePreboardingSection = <K extends PreboardingSectionKey>(journeyId: string, section: K, body: PreboardingSectionInput[K]) =>
  api<PreboardingProfile>(`${L}/journeys/${encodeURIComponent(journeyId)}/profile/${section}`, json('PUT', body));
/** HR changes the candidate's Basic details (employee ID, work email, role, joining day); answers the whole profile. */
export const savePreboardingBasic = (journeyId: string, body: PreboardingBasicInput) =>
  api<PreboardingProfile>(`${L}/journeys/${encodeURIComponent(journeyId)}/profile/basic`, json('PUT', body));
/** Creates the candidate's app account with this employee ID and work email (409 when they have one, 400 for a taken ID or email). */
export const createPreboardingAppAccess = (journeyId: string, body: { employeeId: string; workEmail: string }) =>
  api<PreboardingProfile>(`${L}/journeys/${encodeURIComponent(journeyId)}/app-access`, json('POST', body));

/**
 * A file's bytes from the `url` the server gave: an API path (starting with '/') is
 * fetched with the sign-in; a full link (a short-lived signed one) as it is.
 */
export async function fetchFileUrl(url: string): Promise<Blob> {
  const own = url.startsWith('/');
  const token = getToken();
  const res = await fetch(own ? `${BASE_URL}${url}` : url, { headers: own && token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, data.error || data.message || `Could not open the file (${res.status})`);
  }
  return res.blob();
}
