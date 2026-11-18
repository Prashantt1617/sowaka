/**
 * Wire shapes for the portal endpoints (docs/lifecycle/CONTRACT.md › Portal).
 * Shared enums come straight from backend/src/models/lifecycle.model.ts (type-only
 * import, erased at build time). Dates are 'YYYY-MM-DD'; instants are ISO strings.
 *
 * Fields marked "not in CONTRACT" are optional extras the portal uses when the
 * server sends them and falls back on when it does not.
 */
import type {
  AboutYou as ModelAboutYou,
  CandidateDocumentStatus,
  Day1Pass,
  LetterKind,
  OfferFields,
  OnboardingStatus,
  OwnerRole,
  PlantState,
  TaskKind,
  TaskSurface,
  JourneyTaskStatus,
  LifecyclePhase,
  SystemTaskKey,
  DateChangeRequest,
} from '../../../backend/src/models/lifecycle.model';

export type { PlantState, Day1Pass, OfferFields, LetterKind, OnboardingStatus };

export interface Company {
  name: string;
  logoUrl?: string;
}

export interface HrContact {
  name: string;
  email: string;
}

export type OfferState =
  | 'offer'
  | 'accepted'
  | 'finalised'
  | 'declined'
  | 'expired'
  | 'replaced'
  | 'not_joining'
  | 'closed';

/** Offer fields as the portal sees them: no internal ids, the manager by name. */
export type PortalOfferFields = Omit<OfferFields, 'managerUserId'> & {
  managerName?: string;
  /** not in CONTRACT: "Neha R., Design lead" shows the manager's role. */
  managerDesignation?: string;
};

export interface PortalOfferView {
  state: OfferState;
  company: Company;
  candidateName: string;
  version: number;
  changedFields?: Array<keyof OfferFields>;
  fields: PortalOfferFields;
  validTill: string;
  pdfUrl: string;
  hrContact: HrContact;
  companyVideoUrl?: string;
  /** not in CONTRACT: "We've emailed your login details to ka***@gmail.com" (P5). */
  loginEmailMasked?: string;
  /** not in CONTRACT: the dates on the W4 steps ("You accepted · Sun 30 Nov"). */
  acceptedAt?: string;
  finalisedAt?: string;
  /** not in CONTRACT: P4 "Accepted version · 3 pages". */
  pdfPages?: number;
}

export interface TaskView {
  id: string;
  systemKey?: SystemTaskKey;
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
}

export type HomeView = 'tasks_open' | 'offer_updated' | 'letter_ready' | 'pass_unlocked' | 'joined' | 'closed';
export type PathKey = 'offer' | 'docs' | 'about' | 'meet' | 'letter' | 'pass';
/** `waiting`: the candidate's part is done and HR has it (documents in review: "With HR"). */
export type PathState = 'done' | 'current' | 'todo' | 'locked' | 'waiting';

export interface PortalHome {
  status: OnboardingStatus;
  view: HomeView;
  candidateName: string;
  company: Company;
  tj: string;
  daysToGo: number;
  plant: PlantState;
  path: Array<{ key: PathKey; label: string; state: PathState; due?: string }>;
  upNext?: { key: PathKey; title: string; due?: string; /** not in CONTRACT */ helper?: string };
  tasks: TaskView[];
  batch: { count: number; names: string[] };
  workEmail?: string;
  hrContact: HrContact;
  banner?: { kind: 'offer_updated'; changedFields: Array<keyof OfferFields> };
  /** not in CONTRACT: "Product designer · joining Mon 1 Dec". */
  designation?: string;
  /** not in CONTRACT: hero eyebrow "Mon 1 Dec · 9:30 AM" (Day1Pass.reportingTime). */
  reportingTime?: string;
  /** not in CONTRACT: "Open until Mon 8 Dec" on the joined view (Tj + 7 or end of month 1). */
  portalOpenUntil?: string;
  /** not in CONTRACT: P7a's request waiting on HR (home says so instead of "Can't join on …?"). */
  pendingDateRequest?: { requestedTj: string };
  /** not in CONTRACT: which closed screen (view 'closed'). */
  closedState?: string;
}

/** not in CONTRACT: what sign-in answers (200 `{ closed }`, no session) when the candidate's portal is closed and the password is right. */
export interface ClosedSignIn {
  state: 'declined' | 'expired' | 'not_joining' | 'moved_to_app';
  company: Company;
  hrContact: HrContact;
}

/** not in CONTRACT: GET /portal/client/:token, the client a mail's link names (`?c=`). */
export interface PortalClient {
  company: Company;
  hrContact?: HrContact;
}

export interface DocumentFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

export interface CandidateDocumentView {
  id: string;
  docKey: string;
  label: string;
  required: boolean;
  status: CandidateDocumentStatus;
  hrNote?: string;
  uploadedAt?: string;
  reviewedAt?: string;
  files: DocumentFile[];
  /** not in CONTRACT: reel tag, title and hint ("ID proof" · "Upload your PAN and Aadhaar" · "Both sides, in good light…"). */
  tag?: string;
  title?: string;
  hint?: string;
  dueAt?: string;
}

export type AboutYou = Omit<ModelAboutYou, 'savedAt'> & {
  savedAt?: string;
  /** not in CONTRACT: the candidate's own phone (shown, and the emergency number may not equal it). */
  phone?: string;
  /** not in CONTRACT: last day the answers can change (Tj − 1). */
  editableUntil?: string;
};

export interface MeetItem {
  id: string;
  kind: 'manager_note' | 'video' | 'card';
  title: string;
  text?: string;
  videoUrl?: string;
  seen: boolean;
  /** not in CONTRACT: reel tag, line under the title, and the note's author. */
  tag?: string;
  subtitle?: string;
  authorName?: string;
  authorRole?: string;
}

export type LetterState = 'locked' | 'ready' | 'opened' | 'signed';

export interface PortalLetter {
  id: string;
  kind: LetterKind;
  state: LetterState;
  pdfUrl: string;
  /** not in CONTRACT: display title ("Appointment letter"), file name and page count. */
  title?: string;
  fileName?: string;
  pages?: number;
}

export type PortalPass = Day1Pass & {
  /** not in CONTRACT: 'open' (the pass), or 'locked' before Tj − 7 with the day it opens (200, not a 403). */
  state?: 'open' | 'locked';
  opensOn?: string;
  message?: string;
  managerName?: string;
  buddyName?: string;
  /** not in CONTRACT: the pass shows the joiner's name, role and team. */
  candidateName?: string;
  designation?: string;
  department?: string;
};

export type DateRequestReason = DateChangeRequest['reason'];

export interface DateRequestView {
  id: string;
  requestedTj: string;
  reason: DateRequestReason;
  note?: string;
  status: DateChangeRequest['status'];
  createdAt: string;
}
