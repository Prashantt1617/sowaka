/**
 * Employee lifecycle: pre-boarding (offer → portal → joining day), onboarding
 * (week 1 → probation → confirmation) and the app side of offboarding.
 *
 * This file is the shared contract every part builds on (backend services,
 * the dashboard, the pre-boarding portal and the app). docs/lifecycle/CONTRACT.md
 * describes the endpoints that read and write these shapes. Change a shape here
 * only together with every reader.
 *
 * Ground rules (from the design handover):
 * - Every date comes from Tj (joining day) or Tl (last working day). Store the
 *   rule, not the date; recompute open tasks when Tj or Tl moves.
 * - Template changes apply to journeys that start after saving; a running
 *   journey keeps its snapshot.
 * - Done, skipped or cancelled tasks never move.
 * - Times are in the company's time zone (Asia/Kolkata unless set). Dates
 *   travel as 'YYYY-MM-DD' strings; instants as Date (ISO in JSON).
 */

// ─── Templates ──────────────────────────────────────────────────────────────

export type LifecycleKind = 'onboarding' | 'offboarding';

export type OnboardingPhase = 'pre_boarding' | 'first_week' | 'probation';
export type OffboardingPhase = 'resignation' | 'when_accepted' | 'notice_period' | 'last_day' | 'after_exit';
export type LifecyclePhase = OnboardingPhase | OffboardingPhase;

export type OwnerRole =
  | 'employee'          // the joiner (candidate on the portal before Tj) or the leaver
  | 'manager'
  | 'hr'
  | 'it'
  | 'admin'
  | 'finance'
  | 'manager_employee'  // either side marks it done (e.g. "Meet your manager")
  | 'hr_manager'
  | 'automatic'
  | 'buddy'               // the joiner's buddy (team-side task, Teams › Joiners)
  | 'head_of_department' // the joiner's head of department: the department head, else the manager's manager
  | 'senior';            // Final designs: "someone senior" (template assignees.seniorUserId, else the head of department)

export type TaskKind =
  | 'ack' | 'form' | 'upload' | 'sign' | 'meeting' | 'reel' | 'survey'
  | 'assign' | 'review' | 'system' | 'post' | 'tour' | 'face' | 'checkin' | 'letter';

/** Where the owner does the task. */
export type TaskSurface = 'portal' | 'app' | 'dashboard' | 'backend' | 'outside';

export type DueAnchor =
  | 'offer_sent' | 'accepted' | 'finalised'
  | 'tj'                 // joining day
  | 'month_start' | 'month_end'   // probation month n (or "each")
  | 'tl'                 // last working day
  | 'exit_accepted';     // HR accepted the resignation / started the exit

/**
 * A due or opens rule. Examples:
 *   { anchor: 'tj', offset: -5, unit: 'days' }
 *   { anchor: 'tl', offset: 2, unit: 'working_days' }
 *   { anchor: 'month_end', month: 'each' }
 *   { anchor: 'month_start', month: [3, 6] }
 * `null` on a task means "no date" (shown as —).
 */
export interface DueRule {
  anchor: DueAnchor;
  offset?: number;               // default 0
  unit?: 'days' | 'working_days'; // default 'days'
  /** For month_start / month_end: which probation month(s). */
  month?: number | number[] | 'each' | 'last';
}

/**
 * Stable keys for tasks the product itself drives (a screen completes them).
 * Custom HR tasks have no systemKey and are ticked by their owner.
 */
export type SystemTaskKey =
  // pre-boarding
  | 'send_offer' | 'accept_offer' | 'finalise_offer' | 'portal_sign_in' | 'upload_documents'
  | 'review_documents' | 'about_you' | 'meet_us' | 'device_request' | 'sign_letters'
  | 'day1_pass' | 'manager_setup' | 'mark_joined' | 'new_joining_date' | 'assign_buddy'
  // first week
  | 'welcome_induction' | 'meet_manager' | 'vision_culture' | 'meet_team' | 'laptop_setup'
  | 'register_face' | 'app_tour' | 'week1_reels' | 'intro_post' | 'people_to_meet'
  | 'starter_task' | 'one_on_one_notes' | 'probation_goals' | 'day7_survey' | 'week1_done' | 'check_logins'
  // probation
  | 'monthly_goals' | 'monthly_checkin' | 'monthly_review' | 'pulse_survey'
  | 'confirmation_discussion' | 'confirmation_letter' | 'confirmation_reveal' | 'manager_30day_note'
  // offboarding
  | 'send_resignation' | 'manager_resignation_action' | 'hr_accept_exit' | 'hr_start_exit'
  | 'handover_checklist' | 'tell_clearance_teams' | 'offboarding_page'
  | 'upload_handover' | 'exit_interview' | 'save_documents' | 'finance_clearance' | 'return_assets'
  | 'salary_hold' | 'kt_session' | 'mark_handover_done' | 'close_account' | 'thank_you_note'
  | 'final_settlement' | 'relieving_letter' | 'epfo_exit' | 'gratuity' | 'stay_in_touch' | 'delete_face_data';

export interface TemplateTask {
  id: string;
  phase: LifecyclePhase;
  title: string;
  helper?: string;
  ownerRole: OwnerRole;
  kind: TaskKind;
  surface: TaskSurface;
  systemKey?: SystemTaskKey;
  opensRule?: DueRule | null;
  dueRule?: DueRule | null;
  /** Free-text label for rules the engine cannot express ("Manager sets", "Each upload"). */
  dueLabel?: string;
  mustDo: boolean;
  enabled: boolean;
  order: number;
  /** From the Recommended panel: off until HR adds it. `why` explains the recommendation. */
  recommended?: { why: string; added: boolean };
  /** Documents task: the list the candidate uploads. */
  documents?: Array<{ key: string; label: string; required: boolean }>;
  /**
   * Opens only once another task is done ('done', the default) or under way
   * ('started': in review, sent back or done), e.g. the letters after the last
   * document is approved. A month task waits for the same month's task.
   */
  after?: { key: SystemTaskKey; when?: 'done' | 'started' };
  /**
   * A team-side task (services/lifecycle/teamTasks.ts): shown to the manager, the buddy or the
   * head of department in Teams › Joiners and ticked there (journey.teamTasks), never made into a
   * journey task. Its step comes from `dueRule` (none: once confirmed); `title` may use {n}
   * (first name) and {p} (first name’s); `helper` is the row's quiet line.
   */
  team?: TeamTaskSpec;
  /**
   * A meeting's agenda (a meeting, a check-in or the confirmation discussion): the points the
   * joiner's meeting screen lists with a notes box each, and the manager's for the same meeting.
   * HR edits it in Templates; absent: the seed's for the task's systemKey.
   */
  agenda?: string[];
  /** A Final-designs row (FINAL-DESIGNS.md §2): what it is on the template editor and in the apps. */
  design?: DesignItem;
  /** An older row the Final designs replace (the migration): kept, switched off. */
  replacedBy?: 'final_designs';
}

// ─── Onboarding · Final designs (23 Nov; docs/lifecycle/FINAL-DESIGNS.md) ────

/** pre "Before joining", d1 "Day 1", w1 "Week 1", m1 "Month 1", mid "Months 2 to 5" ("Month 2" on 3 months), fin the last month. */
export type DesignStage = 'pre' | 'd1' | 'w1' | 'm1' | 'mid' | 'fin';
export const DESIGN_STAGES: readonly DesignStage[] = ['pre', 'd1', 'w1', 'm1', 'mid', 'fin'];
export type DesignSection = 'meeting' | 'task' | 'checkin' | 'watch' | 'training' | 'access' | 'team';
export type JoinerTaskType = 'do' | 'review' | 'ack' | 'sign' | 'other' | 'form';
/** "Do in Sowaka": the app screen it opens (it ticks itself off). */
export type DoScreen = 'punch' | 'profile' | 'tax' | 'payroll' | 'leave' | 'overtime';
/** "Review": the page it opens, then "Looks good". */
export type ReviewPage = 'shift' | 'payroll_policy' | 'kpis' | 'leave_balance';
export type MeetWith = 'hr' | 'manager' | 'buddy' | 'it' | 'head_of_department';
/** Leadership has two: someone senior (settings.assignees.seniorUserId, else the head of department) and the head of department. */
export type TeamRole = 'manager' | 'buddy' | 'hr' | 'it' | 'senior' | 'head_of_department';
export type CheckinAnswerType = 'rating' | 'yes_no' | 'short' | 'long' | 'choice';
export type FormAnswerType = 'short' | 'long' | 'choice' | 'date' | 'file';
export type TourLessonKey = 'punch' | 'missed' | 'leave' | 'overtime' | 'approveLeave' | 'approveOvertime';
export type MediaBackground = 'rust' | 'blue' | 'ink' | 'green' | 'purple' | 'sand';

export interface DesignQuestion { id: string; text: string; type: CheckinAnswerType | FormAnswerType; options?: string[] }
export interface DesignMedia { type: 'video' | 'image' | 'text' | 'pdf'; fileId?: string; text?: string; bg?: MediaBackground; minutes?: number; /** The uploaded file's name, for the editor (lane D). */ name?: string }

/** What a Final-designs template row is (absent on older rows). */
export interface DesignItem {
  section: DesignSection;
  stage: DesignStage;
  meetWith?: MeetWith;
  /** The key "Monthly goals" meeting (and the manager's goal comments): one per probation month. */
  everyMonth?: boolean;
  taskType?: JoinerTaskType;
  screen?: DoScreen | ReviewPage;
  /** "Acknowledge company policies" reads App policies instead of one PDF. */
  source?: 'policies';
  link?: string;
  fileId?: string;
  letterTemplateId?: string;
  /** Sign: 'appointment' (made from the accepted offer) and letter template ids. */
  signDocs?: string[];
  questions?: DesignQuestion[];
  media?: DesignMedia;
  /** team / access: who does it. */
  role?: TeamRole;
  /** HR's optional how-to line (≤ 140) the teammate sees behind an (i). */
  how?: string;
}

/** The joiner's answers to one check-in (lifecycle_checkin_answers). Seen by the joiner, their manager and HR. */
export interface CheckinAnswers {
  id: string;
  org: string;
  journeyId: string;
  userId: string;
  /** The template row's id. */
  checkinId: string;
  title: string;
  questions: Array<{ id: string; text: string; type: CheckinAnswerType; options?: string[] }>;
  answers: Array<{ questionId: string; value: number | string | null }>;
  sentAt: Date;
}

/** One monthly goal (lifecycle_probation_months.goals[]). */
export interface ProbationGoal {
  text: string;
  /** The joiner's "How's it going?": Just started, Making progress, Going well. */
  status?: 'start' | 'progress' | 'well';
  note?: string;
  noteAt?: Date;
  /** The manager's comment after the monthly talk. */
  comment?: string;
  commentAt?: Date;
  commentByName?: string;
}

export type TeamTaskKind = 'help' | 'approve' | 'review' | 'task' | 'meet' | 'team' | 'goal' | 'doc' | 'chat';
/** Stable key (ticks are kept by it), the row's look, and what the joiner sees for it. */
export interface TeamTaskSpec {
  key: string;
  kind: TeamTaskKind;
  /** May be done before its step. */
  early?: boolean;
  pair?: string;
  agenda?: string[];
}

export interface LifecycleTemplateSettings {
  // onboarding
  probationMonths?: 3 | 6;
  portalOpenUntil?: 'week_1' | 'month_1';
  /** Appointment letter + NDA are signed in the app on Day 1 instead of the portal. */
  signLettersOnDay1?: boolean;
  /** Final designs: the four fixed pre-boarding rows (false = removed). */
  preboarding?: { offerLetter: boolean; joiningDetails: boolean; profile: boolean; watch: boolean };
  /** Final designs: "Joining and reporting details", the same for every joiner on the template. */
  reporting?: { time?: string; place?: string; bring?: string; notes?: string; meets: 'hr' | 'manager' | 'buddy' };
  /** Final designs: Sowaka tour lessons kept (absent: all). */
  tourLessons?: TourLessonKey[];
  /** Final designs: "Remind teammates when a task is late" (absent: on). */
  remindLateTeamTasks?: boolean;
  /** Final designs: who does the HR tasks, the IT & admin tasks, and counts as someone senior. */
  assignees?: { hrUserId?: string; itUserId?: string; seniorUserId?: string };
  /** Final designs: the probation template, a shift template (Setup › Shift templates). */
  probationShiftTemplateId?: string;
  // offboarding
  noticeDays?: 30 | 60 | 90 | number;
  exitInterviewOpensDays?: 5 | 7 | number;   // Tl − n
  accountCloses?: 'tl_plus_1' | 'tl_end_of_shift';
  settlementWorkingDays?: number;            // default 2 (Tl + n working days)
  gratuityDays?: number;                     // default 30
  /** The app's off-boarding page for HR-started exits of these kinds (off by default for termination, absconding). */
  appPageFor?: Array<'resignation' | 'retirement' | 'end_of_contract' | 'termination' | 'absconding'>;
}

export interface LifecycleTemplate {
  id: string;
  org: string;
  kind: LifecycleKind;
  name: string;          // Standard, Faculty, Interns…
  /** Employee group it is for (free text shown on the list, e.g. "Full-time staff"). */
  group?: string;
  isDefault: boolean;    // one default per org per kind
  active: boolean;
  settings: LifecycleTemplateSettings;
  tasks: TemplateTask[];
  createdAt: Date;
  updatedAt: Date;
  updatedByName?: string;
}

// ─── Journeys ───────────────────────────────────────────────────────────────

/** Candidate / joiner status (one machine across pre-boarding and onboarding). */
export type OnboardingStatus =
  | 'draft'          // HR started an offer, not sent
  | 'offer_sent'
  | 'accepted'       // candidate accepted the latest version; waits for HR
  | 'finalised'      // HR accepted from their end; portal login emailed
  | 'active'         // first portal sign-in
  | 'docs_approved'
  | 'joined'         // HR marked joined on Tj: the employee record exists (userId set)
  | 'moved_to_app'   // portal closed (Tj + 7 or end of month 1)
  | 'confirmed'      // probation decision: confirmed
  // side states
  | 'declined' | 'expired' | 'not_joining';

/** The joiner's stage in the app, after Tj. */
export type OnboardingStage = 'pre_boarding' | 'welcome_week1' | 'settling_in' | 'growing_gains' | 'final_month' | 'ready_to_perform';

/** HR board tab and column. */
export type OnboardingBoardTab = 'pre_boarding' | 'first_week' | 'probation';
export type OnboardingBoardColumn =
  | 'offer_sent' | 'accepted' | 'documents' | 'letters' | 'ready_to_join'
  | 'day1' | 'week1_tasks' | 'day7_survey' | 'week_done'
  | 'month1' | 'months_2_5' | 'final_month' | 'confirmed';

export type JourneyFlag =
  | 'needs_you' | 'late' | 'quiet' | 'joining_risk' | 'needs_attention'
  | 'expires_soon' | 'due_soon' | 'decide' | 'all_set' | 'done' | 'confirmed';

export interface PlantState {
  stage: 0 | 1 | 2 | 3 | 4 | 5;   // seed, sprout, seedling, sapling, bud, bloom
  water: 0 | 1 | 2 | 3;           // pre-boarding progress
  leaves: number;                 // finished groups add a leaf
  droop: boolean;                 // something overdue → "Needs water" (never red)
}

export interface CandidateDetails {
  name: string;
  personalEmail: string;
  phone?: string;
  /** Set by HR at "Mark joined"; the app signs in with it. */
  workEmail?: string;
}

export interface Journey {
  id: string;
  org: string;
  kind: LifecycleKind;
  /** The employee record; absent for an onboarding journey until "Mark joined". */
  userId?: string;
  candidate?: CandidateDetails;          // onboarding
  managerUserId?: string;
  buddyUserId?: string;
  templateId: string;
  /** The template as it was when the journey started (tasks + settings). */
  templateSnapshot: Pick<LifecycleTemplate, 'name' | 'settings' | 'tasks'>;
  status: OnboardingStatus | OffboardingStatus;
  stage?: OnboardingStage;
  /** 'YYYY-MM-DD' anchors. */
  tj?: string;
  tl?: string;
  /** Instants for the event anchors. */
  anchors: Partial<Record<'offer_sent' | 'accepted' | 'finalised' | 'exit_accepted', Date>>;
  /** Current offer (onboarding). */
  offerId?: string;
  designation?: string;
  department?: string;
  location?: string;
  plant?: PlantState;
  /** Day-1 pass content HR fills (shown at Tj − 7). */
  day1Pass?: Day1Pass;
  /** Meet-us content: manager note (text or video key), the company's culture video, JD cards. */
  meetUs?: { managerNote?: { kind: 'text' | 'video'; text?: string; fileId?: string; at?: Date }; seen?: string[] };
  /** Probation (onboarding). `goals`: the probation goals the manager sets in week 1 (lock Tj + 7). */
  probation?: {
    months: number; extendedBy?: number; decision?: ConfirmationDecision; goals?: string[]; goalsLockedAt?: Date;
    /** The manager's recommendation from the app (Teams › Joiners); HR still decides. */
    recommendation?: {
      outcome: 'confirm' | 'extend'; note?: string; byUserId: string; byName?: string; at: Date;
      /** Final designs (MgrConfReview): extend by, and the three answers. */
      extendMonths?: number; review?: { kpis: string; strengths: string; next: string };
    };
    /** The head of department's answer to it ('extended' — Final designs HodApprove: extend by `extendMonths`). */
    hodApproval?: { outcome: 'approved' | 'discuss' | 'extended'; extendMonths?: number; comment?: string; byUserId: string; byName?: string; at: Date };
  };
  /** Offboarding: how they leave, and whether the app's off-boarding page shows (O2 override of the template's appPageFor). */
  exitType?: ExitType;
  showAppPage?: boolean;
  /** App onboarding: the week-1 reels, the intro post, a bank/PF change waiting for HR. */
  week1?: Week1Reels;
  intro?: IntroPost;
  bankPfRequest?: BankPfChangeRequest;
  /** When the joiner first saw "Week 1, done!" (A8). */
  week1DoneSeenAt?: Date;
  /** "How was today?" on "Day 1, done!" (the joiner's own answer; HR sees it on the joiner panel). */
  day1Feeling?: { answer: Day1Feeling; at: Date };
  /** The Sowaka tour's lessons the joiner has finished (app keys: punch, missed, leave, overtime, …), in order done. */
  tour?: { done: string[]; updatedAt?: Date };
  /** The manager's welcome post on Connect for the joiner (M2 "Post a welcome"), once per joiner. */
  managerWelcome?: { text: string; postedAt: Date; connectPostId?: string };
  /**
   * The team side's own ticks (services/lifecycle/teamTasks.ts): the buddy's, the head of
   * department's and the manager's tasks that have no template row, by team task id. The
   * manager's recommendation and the head of department's approval carry an outcome and a note.
   */
  teamTasks?: Record<string, TeamTaskTick>;
  /** Final designs: when the joiner watched / read each watch-list item or training (template row id). */
  watched?: Record<string, Date>;
  /** Final designs: HR's and IT's checks on their task screens (by team key). */
  staffChecks?: Record<string, { checks?: Record<string, string>; accessCardNo?: string; at: Date; byName?: string }>;
  /** Final designs: fill-in form answers saved to the profile (by journey task id). */
  forms?: Record<string, { answers: Array<{ questionId: string; value: string | null }>; sentAt: Date }>;
  /** Timed jobs already fired for this journey (each key once). */
  firedJobs?: string[];
  /** Kept by refreshJourney for lists and counts; the board recomputes them on read. */
  flags?: JourneyFlag[];
  boardTab?: OnboardingBoardTab;
  boardColumn?: OnboardingBoardColumn;
  /** The portal's About you (emergency contact, PF), editable until Tj − 1. */
  aboutYou?: AboutYou;
  /** The portal's Employee profile (services/lifecycle/profile.ts), editable until Tj − 1. */
  profile?: CandidateProfile;
  /** Last time the candidate did anything on the portal (for the Quiet flag). */
  lastActivityAt?: Date;
  closedAt?: Date;
  closedReason?: string;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
}

/** One team-side task done (teamTasks.ts). */
export interface TeamTaskTick {
  doneAt: Date;
  byUserId: string;
  byName?: string;
  /** The manager's recommendation ('confirm' | 'extend') or the head of department's answer ('approved' | 'discuss'). */
  outcome?: string;
  note?: string;
}

export type JourneyTaskStatus = 'locked' | 'todo' | 'in_review' | 'sent_back' | 'done' | 'skipped' | 'cancelled';

export interface JourneyTask {
  id: string;
  org: string;
  journeyId: string;
  templateTaskId: string;
  systemKey?: SystemTaskKey;
  phase: LifecyclePhase;
  title: string;
  helper?: string;
  ownerRole: OwnerRole;
  /** Resolved owner; absent for candidate-owned (portal) tasks and team roles (it/admin/finance). */
  ownerUserId?: string;
  kind: TaskKind;
  surface: TaskSurface;
  mustDo: boolean;
  order: number;
  /** For probation month tasks: which month. */
  month?: number;
  status: JourneyTaskStatus;
  opensAt?: Date | null;
  dueAt?: Date | null;
  dueLabel?: string;
  doneAt?: Date;
  doneByUserId?: string;
  doneByName?: string;
  note?: string;
  /** When the due date last changed (the owner is told once). */
  dueChangedAt?: Date;
  remindedAt?: Date;
}

// ─── Offers, documents, letters, portal ─────────────────────────────────────

export interface OfferFields {
  designation: string;
  department?: string;
  location?: string;
  /** Annual CTC in rupees. Never shown to managers. */
  ctc: number;
  tj: string;                  // 'YYYY-MM-DD'
  managerUserId?: string;
  probationMonths: number;
  noticeDays: number;
  validTill: string;           // 'YYYY-MM-DD'
  responsibilities?: string;
  employeeType?: 'full_time' | 'intern' | 'contract';
}

export type OfferVersionStatus = 'draft' | 'sent' | 'accepted' | 'replaced' | 'declined' | 'expired' | 'withdrawn';

export interface OfferVersion {
  version: number;
  fields: OfferFields;
  changedFields?: Array<keyof OfferFields>;
  refNo?: string;
  /** The PDF HR generated in the dashboard and uploaded. */
  pdfFileId?: string;
  status: OfferVersionStatus;
  sentAt?: Date;
  /** sha256 of the link token; the raw token is only in the email link. */
  linkTokenHash?: string;
  acceptedAt?: Date;
  acceptedIp?: string;
  acceptedDevice?: string;
  finalisedAt?: Date;
  finalisedByUserId?: string;
}

export interface Offer {
  id: string;
  org: string;
  journeyId: string;
  versions: OfferVersion[];     // the last one is current
  createdAt: Date;
  updatedAt: Date;
}

export interface CandidateAccount {
  journeyId: string;
  org: string;
  email: string;                // the candidate's personal email (login)
  passwordHash: string;         // scrypt
  failedTries: number;
  lockedUntil?: Date;
  lastSignInAt?: Date;
  loginSentAt?: Date;
  resetTokenHash?: string;
  resetTokenExpiresAt?: Date;
  /** The one-time sign-in code emailed to `email` (hashed), when it stops working, and wrong tries at it. */
  codeHash?: string;
  codeExpiresAt?: Date;
  codeTries?: number;
  createdAt: Date;
}

export type CandidateDocumentStatus = 'todo' | 'in_review' | 'approved' | 'sent_back';

export interface CandidateDocument {
  id: string;
  org: string;
  journeyId: string;
  docKey: string;               // from the template's documents list
  label: string;
  required: boolean;
  fileIds: string[];
  status: CandidateDocumentStatus;
  hrNote?: string;
  uploadedAt?: Date;
  reviewedAt?: Date;
  reviewedByName?: string;
  /** Files a re-upload after Send back replaced: kept as a note only (the files are removed). */
  superseded?: Array<{ name: string; at: Date; reason?: string }>;
}

/** A stored file (S3 when configured, else backend/.local-uploads for development). */
export interface LifecycleFile {
  id: string;
  org: string;
  journeyId?: string;
  objectKey: string;
  name: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
  uploadedBy: 'candidate' | 'employee' | 'hr' | 'manager' | 'system';
}

export type LetterKind = 'offer' | 'appointment' | 'nda' | 'confirmation' | 'extension' | 'relieving';

export interface LetterTemplate {
  id: string;
  org: string;
  kind: LetterKind;
  name: string;
  /** HTML with {{merge.fields}}. */
  body: string;
  isDefault: boolean;
  updatedAt: Date;
}

export interface Letter {
  id: string;
  org: string;
  journeyId?: string;
  userId?: string;
  kind: LetterKind;
  templateId: string;
  refNo: string;
  values: Record<string, string>;
  pdfFileId?: string;
  signedPdfFileId?: string;
  /** Appointment / NDA: opened before signing is allowed. */
  openedAt?: Date;
  signature?: { method: 'draw' | 'type'; typedName?: string; imageFileId?: string; signedAt: Date; ip?: string; device?: string };
  /** A signed letter a revised offer made out of date (its fields changed): kept as history; a new one is signed. */
  outdatedAt?: Date;
  outdatedFields?: string[];
  /** The email: HR's saved draft until `sentAt`. `attachments`: extra files sent with the letter PDF (H3c suggested extras). */
  email?: { to: string; cc?: string[]; subject: string; body: string; sentAt?: Date; withPortalLink?: boolean; attachments?: LetterAttachment[]; savedAt?: Date };
  createdAt: Date;
  createdByName?: string;
}

/** An extra file on a letter's email. `salary_breakup` states pay: only for people who may see it. */
export interface LetterAttachment { fileId: string; name: string; kind: 'salary_breakup' | 'joining_checklist' | 'policies' | 'other' }

export interface ProfileAddress { line: string; city: string; state: string; pin: string }
/** The candidate's own details from the portal's Employee profile. Secrets are kept encrypted (`*Enc`) with their last four. */
export interface CandidateProfile {
  personal?: { fullName: string; preferredName?: string; dob: string; gender: string; maritalStatus?: string; nationality?: string; bloodGroup?: string };
  contact?: { mobile: string; current: ProfileAddress; permanentSame: boolean; permanent?: ProfileAddress };
  bank?: { holderName: string; ifsc: string; accountLast4: string; accountNumberEnc?: string; bankName?: string };
  education?: { qualification: string; institution: string; year: string };
  experience?: { firstJob: boolean; jobs: Array<{ company: string; role: string; from: string; to?: string }> };
  ids?: { aadhaarLast4?: string; aadhaarEnc?: string; panLast4?: string; panEnc?: string };
  photoFileId?: string;
  savedAt?: Date;
}

export interface EmergencyContact { name: string; relation: 'Parent' | 'Partner' | 'Sibling' | 'Friend'; phone: string; altPhone?: string }
export interface AboutYou {
  emergencyContact?: EmergencyContact;
  /** An optional second person to call (the portal's "Add another contact"). */
  emergencyContact2?: EmergencyContact;
  pf?: { firstJob: boolean; uan?: string };
  savedAt?: Date;
}

export interface Day1Pass {
  date?: string;               // defaults to Tj
  reportingTime?: string;      // 'HH:mm'
  place?: string;
  mapLink?: string;
  meetingLink?: string;
  askFor?: { name: string; phone?: string };
  hrContact?: { name: string; email?: string; phone?: string };
  bring?: string[];
  /** `id` is the line's own (meetings follow it, not its words); `taskKey` is the task HR says it is (null: none). */
  agenda?: Array<{ id?: string; time: string; title: string; with?: string; taskKey?: 'meet_manager' | 'meet_team' | 'welcome_induction' | 'vision_culture' | null }>;
}

export interface DateChangeRequest {
  id: string;
  org: string;
  journeyId: string;
  requestedTj: string;
  reason: 'Notice period' | 'Personal' | 'Something else';
  note?: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: Date;
  decidedAt?: Date;
  decidedByName?: string;
}

// ─── App onboarding ─────────────────────────────────────────────────────────

export interface PeopleToMeet {
  id: string;
  org: string;
  journeyId: string;
  personUserId: string;
  why?: string;
  metAt?: Date;
  skippedAt?: Date;
}

export interface StarterTask {
  id: string;
  org: string;
  journeyId: string;
  title: string;
  links?: string[];
  note?: string;
  dueAt?: Date;
  assignedByUserId: string;
  assignedAt: Date;
  doneAt?: Date;
  doneNote?: string;
  managerReply?: string;
}

export interface OneOnOneNote {
  id: string;
  org: string;
  journeyId: string;
  authorUserId: string;
  text: string;
  shared: boolean;
  sharedAt?: Date;
  seenAt?: Date;
  replies?: Array<{ byUserId: string; text: string; at: Date }>;
  createdAt: Date;
}

export interface Meeting {
  id: string;
  org: string;
  journeyId: string;
  journeyTaskId?: string;
  title: string;
  startsAt: Date;
  endsAt?: Date;
  place?: string;
  link?: string;
  attendeeUserIds: string[];
  met?: 'yes' | 'moved';
  newTime?: Date;
  remindedAt?: Date;
  /** Who it is with, as the Day-1 agenda line names them ("Neha R.", "the founders"). */
  with?: string;
  /** The Day-1 agenda line it was made from (its `id`); removed with the line. */
  agendaId?: string;
  /** Final designs: the team row it times (`<key>` or `<key>@<month>`; Schedule first-week meetings, the senior meeting). */
  rowKey?: string;
}

/** "Day 1, done!" · How was today? */
export const DAY1_FEELINGS = ['great', 'okay', 'tough'] as const;
export type Day1Feeling = typeof DAY1_FEELINGS[number];

/**
 * Someone's own notes on a meeting's agenda (the joiner's meeting screen, "Only you can see your
 * notes"): one text per agenda point, kept by the meeting row's id (a journey task id, `team:<key>`
 * for a buddy or head-of-department meeting, `person:<id>` for someone the manager picked). Read by
 * nobody but `userId`: no HR or manager view reads this collection.
 */
export interface MeetingNotes {
  id: string;
  org: string;
  journeyId: string;
  rowId: string;
  userId: string;
  notes: string[];
  updatedAt: Date;
}

export interface Week1Reels {
  policies?: { versions: Array<{ id: string; version: string }>; at: Date; device?: string };
  taxRegime?: { regime: 'new' | 'old'; at: Date };
  bankPf?: { confirmedAt: Date; changeRequested?: boolean };
  goalsReadAt?: Date;
}

/** A bank or PF edit from the week-1 reel: payroll keeps the old value until HR approves. */
export interface BankPfChangeRequest {
  status: 'pending' | 'approved' | 'declined';
  /** Account number and UAN are encrypted (fieldCrypto); only the last four are kept in the clear. */
  changes: { bankName?: string; ifsc?: string; accountNumberEnc?: string; accountLast4?: string; uanEnc?: string; uanLast4?: string };
  note?: string;
  requestedAt: Date;
  decidedAt?: Date;
  decidedByName?: string;
  hrNote?: string;
}

export interface IntroPost {
  photoKey?: string;
  line: string;                 // ≤ 80 characters
  funFacts: string[];           // ≤ 3
  postedAt?: Date;
  connectPostId?: string;
}

export interface ProbationMonth {
  id: string;
  org: string;
  journeyId: string;
  monthNo: number;
  goals: ProbationGoal[];
  goalsSetAt?: Date;
  lockedAt?: Date;
  /** The joiner's side (PB1): how the month felt 1–4, a 1–5 self-rating per goal (in goal order), one win, one ask. */
  checkinEmployee?: { text: string; rating?: number; goalRatings?: number[]; win?: string; ask?: string; at: Date };
  /** The manager's side: their 1–5 rating and a 1–5 rating per goal. */
  checkinManager?: { text: string; rating?: number; goalRatings?: number[]; at: Date };
  /** PB2: the review, one-tap feedback chips, and "On it" for what the joiner asked. */
  review?: { text: string; feedback?: string[]; askAck?: boolean; at: Date };
  /** The manager sent the joiner's self check-in back (team side, MgrReview): the joiner sends it again. */
  sentBack?: { text?: string; at: Date; byName?: string };
}

export interface ConfirmationDecision {
  outcome: 'confirm' | 'extend' | 'not_confirm';
  extendMonths?: number;
  /** Annual CTC after confirmation; HR only. */
  salary?: number;
  kpiTemplateId?: string;
  designation?: string;
  reportingToUserId?: string;
  letterId?: string;
  decidedAt: Date;
  decidedByName: string;
  revealedAt?: Date;
}

export type SurveyKind = 'day7' | 'm3' | 'm6' | 'exit';

/**
 * Day-7 / M3 / M6: q1 emoji 1–5, q2 'yes' | 'mostly' | 'no', q3 emoji 1–5, q4 optional text.
 * Exit: reason, workingHere 1–5, manager 1–5, comeBack, change.
 * Exit answers are stored without userId (org, department, tenure band, month only).
 */
export interface SurveyResponse {
  id: string;
  org: string;
  kind: SurveyKind;
  journeyId?: string;           // absent for exit answers
  userId?: string;              // absent for exit answers
  managerUserId?: string;       // day7/m3/m6, for the team summary (3+ answers)
  department?: string;
  tenureBand?: '<1y' | '1-2y' | '2-5y' | '5y+';
  month?: string;               // 'YYYY-MM'
  answers: Record<string, string | number | null>;
  /** HR-assigned theme for a free-text exit answer. */
  theme?: string;
  createdAt: Date;
}

// ─── Offboarding (on top of the live exits: user.exit) ─────────────────────

export type OffboardingStatus =
  | 'with_manager' | 'with_hr' | 'withdrawn'
  | 'accepted' | 'handover' | 'clearance' | 'exit_interview' | 'last_week'
  | 'last_day' | 'settlement_due' | 'settlement_sent' | 'closed';

export type ExitType = 'resignation' | 'retirement' | 'end_of_contract' | 'termination' | 'absconding';

export interface Resignation {
  id: string;
  org: string;
  userId: string;
  managerUserId?: string;
  reason: string;
  note?: string;
  submittedAt: Date;
  noticeDays: number;
  lastDayByNotice: string;       // 'YYYY-MM-DD'
  status: 'with_manager' | 'with_hr' | 'withdrawn' | 'accepted';
  manager?: { action: 'accept' | 'change_day' | 'release_early'; date?: string; note?: string; at: Date; byName: string };
  hrAcceptedAt?: Date;
  hrAcceptedByName?: string;
  agreedLastDay?: string;
  withdrawnAt?: Date;
  /** The offboarding journey created when HR accepts. */
  journeyId?: string;
}

export interface HandoverItem {
  id: string;
  org: string;
  journeyId: string;
  userId: string;
  title: string;
  createdByUserId: string;
  upload?: { kind: 'file' | 'link'; fileId?: string; url?: string; name?: string; at: Date };
  done: boolean;
  doneAt?: Date;
}
