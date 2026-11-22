# Onboarding · Final designs (23 Nov) — server contract

Branch `fd-server` (from main 10729312). This file is the contract the four screen lanes build on:
**J** joiner app, **T** teammates app (manager, buddy, head of department), **H** HR and IT & admin in the app,
**D** dashboard template. It supersedes the 20 Nov prototype parts of `CONTRACT.md` (PR #258 app lifecycle,
#266 onboarding) for everything listed under "Old endpoints and screens" below. Everything else in `CONTRACT.md`
(offers, portal, letters, documents, offboarding, the board) stands.

The designs: canvas "Sowaka · Onboarding · Final designs" (notes d1, d2, j1, m1, h1; `App.dc.html`,
`Main.dc.html`, `MgrTeamsProto.dc.html`). Demo names in them are placeholders: every value below comes from
the database.

Conventions as in `CONTRACT.md`: JSON in and out; errors `{ error: string }` with 400/401/403/404/409;
dates `YYYY-MM-DD` (company time zone), instants ISO. `{n}` / `{p}` in a title = first name / first name’s,
filled by the server before it answers (the app never fills them).

---

## 1. One source per fact

| Fact | Single source (collection · field) | Written by | Read by |
|---|---|---|---|
| The template (every item, every setting) | `lifecycle_templates` · `tasks[]` rows with `design` (+ `settings`) | Dashboard `PUT …/templates/:id/design` | the dashboard editor and preview, and new journeys (copied at start) |
| A joiner's version of the template (every design row and setting: meetings and agendas, check-in questions, watch list, trainings, teammate rows and how-to lines, assignees, reporting details, reminder switch, tour) | `lifecycle_journeys` · `templateSnapshot` (copied from the template when the journey starts; the migration wrote it for journeys already running) | engine at journey start; the migration | every joiner, teammate and HR/IT view of that joiner, the Day-1 pass, the reminder job. A template edit reaches new joiners only ("New joiners get this from now on") |
| Joiner's tasks (Do in Sowaka, Review, Read and acknowledge, Sign, More tasks, forms) | `lifecycle_journey_tasks` (one row per template task row, made by the engine when the journey starts) | engine; product facts (first punch, profile, tax, payroll, policies, letters) sync on read; joiner `POST /lifecycle/joiner/tasks/:id` | joiner app, HR/IT app stats, dashboard board/panel |
| Devices and accesses (ready / setting up) | `lifecycle_journey_tasks` rows with `design.section = 'access'` (owner `it` or `hr`) | IT/HR app `POST /lifecycle/staff/…/tasks/accesses`, dashboard board tick | joiner app, teammates' View progress, HR/IT app, board |
| Meetings: met / done | `lifecycle_journeys` · `teamTasks[<rowKey>]` (one tick shared by both people) | joiner "Mark as met", teammate "Mark as done" (either one) | joiner, teammate, HR/IT, dashboard panel |
| A meeting's time (Schedule first-week meetings, senior meeting) | `lifecycle_meetings` (`journeyId`, `rowKey`, `startsAt`) | manager / head of department | joiner (`startsAt`), teammates |
| Own agenda notes | `lifecycle_meeting_notes` (per person, private) | each person | only that person |
| Teammate tasks done (manager, buddy, HR, IT & admin, leadership) | `lifecycle_journeys` · `teamTasks[<key>]` (`<key>@<month>` for monthly rows) | teammates' apps | teammates, HR/IT, dashboard panel (`teamRowsForHr`) |
| HR's task checks (payroll "Looks right / Ask", access card no.) | `lifecycle_journeys` · `staffChecks[<key>]` | HR/IT app | HR/IT app |
| Check-in answers | `lifecycle_checkin_answers` (new; one doc per journey × check-in) | joiner | joiner (own), manager, HR (never buddy/head of department) |
| "Read" a check-in | `lifecycle_journeys` · `teamTasks['mgr_read_checkin@<checkinId>']` | manager | manager, HR |
| Monthly goals text | `lifecycle_probation_months` · `goals[].text` | manager (`PUT /lifecycle/manager/joiners/:id/probation/:month {goals}`, kept) | joiner, manager, HR |
| Goal "How's it going?" + note | `lifecycle_probation_months` · `goals[].status`, `goals[].note` | joiner | joiner, manager |
| Manager's goal comments | `lifecycle_probation_months` · `goals[].comment` | manager | joiner (after the talk), manager |
| Watch list / trainings watched | `lifecycle_journeys` · `watched[<itemId>]` | joiner | joiner, teammates' View progress, HR/IT |
| Sowaka tour lessons | `lifecycle_journeys` · `tour.done` (unchanged) + first punch | joiner | joiner, View progress, HR/IT |
| Profile sections (joiner's 7, HR's 9) | `lifecycle_journeys` · `profile`, `aboutYou`; `employee_payment_details`; `tax_declarations`; the salary structure | portal / app profile; payroll | joiner (7), HR (9), View progress (%) |
| Buddy | `lifecycle_journeys` · `buddyUserId` | manager (app) or HR (dashboard) | all |
| Manager's welcome message | `lifecycle_journeys` · `meetUs.managerNote` (the portal's Meet us note) | manager | portal (as today), joiner |
| Feed introduction | `lifecycle_journeys` · `managerWelcome` + the Connect post | manager | feed, teammates |
| Confirmation review / recommendation | `lifecycle_journeys` · `probation.recommendation` (+ `review` text) | manager | head of department, HR, dashboard decision |
| Head of department's approval | `lifecycle_journeys` · `probation.hodApproval` | head of department | HR, dashboard decision |
| Who does HR / IT & admin / "someone senior" tasks | the joiner's `templateSnapshot.settings.assignees` (from the template at start) | dashboard (for new joiners) | server (who sees what) |
| Joining and reporting details (time, place, what to bring, who meets them) | the joiner's `templateSnapshot.settings.reporting`, under what HR typed on the joiner (`journey.day1Pass` wins) | dashboard | portal's Day-1 pass (`portalPass`), teammates' JOINING DETAILS |

Nothing in the app is counted or faked on the device: every count, percentage, "late", "due" text and stage
label below comes in the response. The app may filter a list it got by `step` (the joiner's "look ahead").

---

## 2. The template model (`backend/src/models/lifecycle.model.ts`)

The template stays one list of `TemplateTask` rows (so the engine, the board and running journeys keep
working). A Final-designs row carries `design`; older rows have none. The dashboard never edits rows
directly: it reads and writes the **design view** (§4.1), and the server turns it into rows and works out
every due/open rule from the stage (`designRules.ts`).

```ts
export type DesignStage = 'pre' | 'd1' | 'w1' | 'm1' | 'mid' | 'fin';
/** pre "Before joining", d1 "Day 1", w1 "Week 1", m1 "Month 1", mid "Months 2 to 5" ("Month 2" on 3 months), fin "Month 6" ("Month 3"). */

export type DesignSection = 'meeting' | 'task' | 'checkin' | 'watch' | 'training' | 'access' | 'team';
export type JoinerTaskType = 'do' | 'review' | 'ack' | 'sign' | 'other' | 'form';
/** "Do in Sowaka": the screen it opens and ticks itself off. */
export type DoScreen = 'punch' | 'profile' | 'tax' | 'payroll' | 'leave' | 'overtime';
/** "Review": the page it opens, then "Looks good". */
export type ReviewPage = 'shift' | 'payroll_policy' | 'kpis' | 'leave_balance';
export type MeetWith = 'hr' | 'manager' | 'buddy' | 'it' | 'head_of_department';
/** Leadership has two: someone senior (settings.assignees.seniorUserId, else the head of department) and the head of department. */
export type TeamRole = 'manager' | 'buddy' | 'hr' | 'it' | 'senior' | 'head_of_department';
export type CheckinAnswerType = 'rating' | 'yes_no' | 'short' | 'long' | 'choice';   // rating = 1 to 5
export type FormAnswerType = 'short' | 'long' | 'choice' | 'date' | 'file';
export type TourLesson = 'punch' | 'missed' | 'leave' | 'overtime' | 'approveLeave' | 'approveOvertime';

export interface DesignQuestion<T extends string> { id: string; text: string; type: T; options?: string[] }

export interface DesignItem {
  section: DesignSection;
  stage: DesignStage;
  /** meeting */
  meetWith?: MeetWith;
  /** meeting: the key "Monthly goals" meeting, one per probation month ("Every month"). */
  everyMonth?: boolean;
  /** task */
  taskType?: JoinerTaskType;
  screen?: DoScreen | ReviewPage;
  /** 'policies': "Acknowledge company policies" reads App policies instead of one PDF. */
  source?: 'policies';
  /** More tasks: optional outside link (https only). */
  link?: string;
  /** Read and acknowledge: the PDF (lifecycle_files) or a Document template it was picked from. */
  fileId?: string;
  letterTemplateId?: string;
  /** Sign: what the joiner signs on Day 1 ('appointment' = made from the accepted offer, else letter template ids). */
  signDocs?: string[];
  /** checkin: questions (rating / yes_no / short / long / choice). form: questions (short / long / choice / date / file). */
  questions?: Array<DesignQuestion<CheckinAnswerType | FormAnswerType>>;
  /** watch / training / pre-boarding video */
  media?: { type: 'video' | 'image' | 'text' | 'pdf'; fileId?: string; text?: string; bg?: 'rust' | 'blue' | 'ink' | 'green' | 'purple' | 'sand'; minutes?: number };
  /** team: who does it, and HR's optional how-to line (≤ 140) the teammate sees behind an (i). */
  role?: TeamRole;
  how?: string;
}

export interface TemplateTask {        // existing fields unchanged; added:
  design?: DesignItem;
  /** Set by the migration on an older row the Final designs replace: kept (history), switched off. */
  replacedBy?: 'final_designs';
}

export interface LifecycleTemplateSettings {   // existing fields unchanged; added (onboarding):
  /** The four fixed pre-boarding rows; false = removed. */
  preboarding?: { offerLetter: boolean; joiningDetails: boolean; profile: boolean; watch: boolean };
  /** "Joining and reporting details": every joiner on this template sees them (the Day-1 pass defaults). */
  reporting?: { time?: string; place?: string; bring?: string; notes?: string; meets: 'hr' | 'manager' | 'buddy' };
  /** Sowaka tour rows kept (removed ones are left out). Absent = all six. */
  tourLessons?: TourLesson[];
  /** "Remind teammates when a task is late" (default true). */
  remindLateTeamTasks?: boolean;
  /** Who does the HR tasks / IT & admin tasks / counts as someone senior (absent senior = head of department). */
  assignees?: { hrUserId?: string; itUserId?: string; seniorUserId?: string };
  /** Probation template: a shift template (Setup › Shift templates). Optional pointer; "Edit" goes there. */
  probationShiftTemplateId?: string;
}
```

A journey keeps the template version it started with for everything: `templateSnapshot` (tasks and settings,
design rows included) is copied when the journey starts, and every view of that joiner reads its design rows and
settings from there (`design.ts designOf`). Only a journey the migration has not reached (no design rows in
its snapshot) reads its template as it is now.

How rows become behaviour (one engine change: only `task` and `access` design rows become journey tasks):

| `design.section` | Becomes | Done state |
|---|---|---|
| `task` | journey task (engine), `ownerRole: 'employee'`, surface `app` | journey task status |
| `access` | journey task (engine), `ownerRole: role === 'hr' ? 'hr' : 'it'`, phase `first_week` | journey task status |
| `meeting` | team row (`team.kind = 'meet'`, owner from `meetWith`), not a journey task | `journey.teamTasks[key]` (`key@n` per month) |
| `team` | team row (`team.kind` from the screen it opens), not a journey task | `journey.teamTasks[key]` |
| `checkin` | read-time row; answers in `lifecycle_checkin_answers` | an answers doc with `sentAt` |
| `watch`, `training` | read-time row (`stage: 'pre'` = pre-boarding video) | `journey.watched[id]` |

Stage → rules (server only, `designRules.ts`; Tj = joining day; "Week 1" = Tj+1…Tj+6):

| stage | opens | due | step on the joiner's strip |
|---|---|---|---|
| pre | offer finalised | Tj − 1 | (pre-boarding; teammates' "Before Day 1") |
| d1 | Tj | Tj | Day 1 |
| w1 | Tj (doable early from Day 1) | Tj + 6 | Week 1 |
| m1 | Tj + 7 | end of month 1 | Month 1 |
| mid | start of month 2 | end of month 2 | Month 2 |
| fin | start of the last month | end of the last month | Month n |
| access (any) | offer finalised (IT can start early) | Tj + 6 "By end of Week 1" | Week 1 |
| check-in w1 / m1 / mid / d1 | 2 days before its due | end of its stage | its stage |
| check-in fin | when HR confirms (decision `confirm`) | — ("After confirmation") | Confirmed |
| every-month meeting / goal comments | start of month n | end of month n | Month n, n = 1…months |

`design.stage` and these rules are the only timing; "Months 2 to 5" has one date (end of month 2).

---

## 3. Seed ("Standard" for a new company, and what the migration adds)

Exactly the canvas's 53 items (`Main.dc.html` seed, in order) plus the pre-boarding machinery rows of the
old seed that still run under the hood and are not drawn in the editor (`send_offer`, `accept_offer`,
`finalise_offer`, `portal_sign_in`, `upload_documents`, `review_documents`, `about_you`, `meet_us`,
`day1_pass`, `mark_joined`, `new_joining_date`, `confirmation_discussion` (HR's decision on the board),
`confirmation_letter`, `confirmation_reveal`). `sign_letters` becomes the Day-1 "Sign your joining documents"
task (`design: { section: 'task', taskType: 'sign', stage: 'd1', signDocs: ['appointment'] }`,
`settings.signLettersOnDay1 = true`). Team-row keys (stable; ticks are stored by them):

| Role | key · title (stage) |
|---|---|
| meetings | `hr_welcome` Welcome and documents (d1, HR) · `mgr_first_goals` First goals (d1, Manager) · `buddy_team_works` How the team works (d1, Buddy) · `it_laptop_help` Laptop and login help (w1, IT) · `hr_salary_tax` Salary and tax (w1, HR) · `buddy_week1` Week 1 catch-up (w1, Buddy) · `mgr_monthly_goals` Monthly goals (m1, Manager, every month) · `mgr_month1_review` Month 1 review (m1, Manager) · `buddy_month1` Month 1 catch-up (m1, Buddy) · `mgr_confirmation` Confirmation discussion (fin, Manager) |
| Manager | `mgr_assign_buddy` Assign {n} a buddy (pre) · `mgr_schedule` Schedule {p} first-week meetings (pre) · `mgr_welcome` Send {n} a welcome message (pre, early) · `mgr_kpis` Set {p} KPIs (pre) · `mgr_feed_intro` Introduce {n} on the feed (d1, early) · `mgr_read_checkin` Read {p} <check-in> (one per check-in except end of probation, at its stage) · `mgr_goal_comments` Comment on {p} goals (m1, every month) · `mgr_confirmation_review` Write {p} confirmation review (fin) |
| Buddy | `buddy_show_around` Show {n} around the office · `buddy_punch_in` Tell {n} how punch-in works · `buddy_groups` Add {n} to the team’s groups and channels (all d1) |
| HR | `hr_prepare_kit` Prepare {p} onboarding kit (pre) · `hr_hand_kit` Hand over the onboarding kit (d1) · `hr_check_payroll` Check {p} payroll details (w1) · `hr_check_form` Check {p} joining form (w1) · `hr_confirmation_letter` Issue {p} confirmation letter (fin) |
| IT & admin | the access rows (Laptop, Work email, Office Wi-Fi, Sowaka Connect), shown to IT as one row `it_accesses` "Set up {p} accesses" (w1, early; made on read from the access rows, not stored); an access HR sets up gives HR the same row `hr_accesses` |
| Leadership | `senior_meet` Meet {n}, one to one or with other new joiners (w1, someone senior) · `hod_approve` Approve {p} confirmation (fin, head of department) |

Defaults: probation 6 months; reminder switch on; tour all six; preboarding rows all on; reporting
`meets: 'hr'`; assignees unset (HR = the joiner's HR contact `user.hrPrimaryUserId`, else whoever created
the offer; IT = nobody until set: the IT tasks then show only on the dashboard).

---

## 4. Endpoints

### 4.1 Dashboard (D) — `/admin/lifecycle/*` (onboarding templates tab gate, as today)

| Method + path | Body | Returns |
|---|---|---|
| GET `/admin/lifecycle/templates?kind=onboarding` | | as today; each template adds `design: boolean` (has Final-designs rows) |
| GET `/admin/lifecycle/templates/:id/design` | | `TemplateDesign` |
| PUT `/admin/lifecycle/templates/:id/design` | `TemplateDesign` minus read-only fields (whole document; "Save template") | `TemplateDesign` (saved). Applies to journeys that start after saving, for everything; running joiners keep the version they started with. |
| POST `/admin/lifecycle/templates/:id/media` | multipart `file` (video mp4/mov ≤ 50 MB; image jpg/png; pdf ≤ 10 MB) | `{ file: { id, name, contentType, size, minutes? } }` (`minutes`: a video's length, a PDF's pages; the editor puts it in `media.minutes`: "3 min", "5 min read") |
| GET `/admin/lifecycle/templates/media/:fileId` | | the bytes (same org) |
| GET `/admin/lifecycle/templates/:id/preview?stage=pre|d1|w1|m1|mid|fin` | | `TemplatePreview` (Employee preview's phone tiles) |

Assignee dropdowns use the existing employees list; Document templates the existing
`/admin/lifecycle/letter-templates`; the probation template the existing shift-templates list.

```ts
interface TemplateDesign {
  templateId: string; name: string; isDefault: boolean; updatedAt: string; updatedByName?: string;   // read-only
  preboarding: {
    rows: { offerLetter: boolean; joiningDetails: boolean; profile: boolean; watch: boolean };
    reporting: { time?: string; place?: string; bring?: string; notes?: string; meets: 'hr' | 'manager' | 'buddy' };
    videos: WatchItem[];                                   // stage 'pre'
  };
  meetings: Array<{ id: string; title: string; meetWith: MeetWith; stage: Exclude<DesignStage, 'pre'>; agenda: string[]; everyMonth?: boolean }>;
  tasks: Array<{ id: string; title: string; type: JoinerTaskType; stage: Exclude<DesignStage, 'pre'>;
    screen?: DoScreen | ReviewPage; source?: 'policies'; link?: string; fileId?: string; letterTemplateId?: string;
    signDocs?: string[]; questions?: Array<DesignQuestion<FormAnswerType>> }>;
  checkins: Array<{ id: string; title: string; stage: 'd1' | 'w1' | 'm1' | 'mid' | 'fin'; questions: Array<DesignQuestion<CheckinAnswerType>> }>;
  tour: TourLesson[];
  watch: WatchItem[];                                      // stage d1 | w1 | m1
  trainings: WatchItem[];                                  // media.type 'video' | 'pdf'
  accesses: Array<{ id: string; title: string; role: 'it' | 'hr' }>;
  probation: { months: 3 | 6; shiftTemplateId?: string };
  team: {
    remindLate: boolean;
    assignees: { hrUserId?: string; itUserId?: string; seniorUserId?: string };
    tasks: Array<{ id: string; key: string; title: string; role: TeamRole; stage: DesignStage; how?: string; everyMonth?: boolean }>;
  };
}
interface WatchItem { id: string; title: string; stage: DesignStage; media: { type: 'video' | 'image' | 'text' | 'pdf'; fileId?: string; text?: string; bg?: string; minutes?: number } }
/** The phone tiles' facts at one stage (the app copy — "Fill in your details", "A lesson a day" — is the dashboard's). */
type TemplatePreview =
  | { stage: 'pre'; header: 'Welcome'; stageLabel: string; joining: { time?: string; place?: string; meets: 'hr' | 'manager' | 'buddy' } | null;
      offerLetter: boolean; profile: { sections: 7 } | null; watch: { first: string; ready: number; total: number } | null }
  | { stage: Exclude<DesignStage, 'pre'>; header: 'Onboarding'; stageLabel: string; meetings: { count: number; who: MeetWith[] };
      tasks: { first?: string; count: number }; tour: { first: TourLesson | null } | null; watch: { first: string; ready: number; total: number } | null;
      devices: { count: number } | null; profile: true };
```

Validation: titles 1–120; agenda ≤ 12 points ≤ 160; questions ≤ 20 ≤ 200; `link` https; `how` ≤ 140;
`fileId` must be a file of the org; `meetWith`/`role`/`stage` from the enums; `probation.months` 3 or 6;
`shiftTemplateId` an active shift template of the org; assignee ids active colleagues of the org. Ids the
dashboard sends back keep the row (and its ticks); a new row has no id (the server makes one). A removed
row is deleted from the template (running journeys keep their journey tasks; their ticks stay on the journey).

### 4.2 Joiner app (J) — `/lifecycle/joiner/*` (new; employee session, `features.lifecycle` gate)

| Method + path | Body | Returns |
|---|---|---|
| GET `/lifecycle/joiner/onboarding` | | `JoinerOnboarding` (home + every tile's screen; the app opens tiles from this one answer) |
| POST `/lifecycle/joiner/tasks/:taskId` | `{ action: 'looks_good' \| 'acknowledged' \| 'opened' \| 'done' }` (Review → looks_good; Read and acknowledge (PDF) → acknowledged; More tasks → opened (after the link opens) or done; Confirmed's "Read your confirmation letter" (`id` `letter:<letterId>`) → any action marks it opened) | `JoinerOnboarding` (409 for Do in Sowaka, Sign, policies, forms: they finish from their own screen or the fact itself) |
| GET `/lifecycle/joiner/forms/:taskId` · POST same `{ answers: Array<{ questionId, value: string \| null }> }` · POST `/lifecycle/joiner/forms/:taskId/files` multipart `file` → `{ fileId }` | | `{ form: { taskId, title, questions, answers?, sentAt? } }` — answers saved to the joiner's profile (`journey.forms[taskId]`) |
| GET `/lifecycle/joiner/checkins/:id` | | `JoinerCheckin` |
| POST `/lifecycle/joiner/checkins/:id` | `{ answers: Array<{ questionId: string; value: number \| 'yes' \| 'no' \| string \| null }> }` (null = skipped long answer) | `JoinerCheckin` (409 once sent, or before it opens) |
| GET `/lifecycle/joiner/goals` | | `JoinerGoals` |
| PUT `/lifecycle/joiner/goals/:month/:index` | `{ status?: 'start' \| 'progress' \| 'well', note?: string (≤ 500, '' clears) }` | `JoinerGoals` |
| POST `/lifecycle/joiner/watch/:itemId` | `{}` | `{ watched: true, at }` |
| GET `/lifecycle/joiner/media/:fileId` | | the bytes of a template media file of the joiner's template (Range supported for video) |
| GET `/lifecycle/joiner/letters` · POST `/lifecycle/joiner/letters/:id/opened` · POST `/lifecycle/joiner/letters/:id/sign` `{ method: 'draw' \| 'type', typedName?, imageDataUrl? }` · GET `/lifecycle/joiner/letters/:id/pdf` | | the Sign task's documents, same shapes as the portal's (`portalLetters`), signing through the same service |
| kept: POST `/lifecycle/onboarding/meeting-rows/:rowId` `{ action: 'met' }` · PUT `/lifecycle/onboarding/meeting-rows/:rowId/notes` `{ notes: string[] }` | | Mark as met (the shared tick) and own notes; `rowId` = `JoinerMeetingRow.id` |
| kept: POST `/lifecycle/onboarding/tour/:lesson` | | Sowaka tour lesson done |
| kept: `/policies` (App policies) | | "Acknowledge company policies" ticks itself when every required policy is acknowledged |
| kept: GET `/lifecycle/me` | | adds `onboarding.tile: { title: 'Onboarding', subtitle: string, badge: string }` and `staff?: StaffTile` (HR / IT & admin's Actions tile) |
| kept: POST `/lifecycle/portal-session` | | the pre-boarding portal inside the app (Quick Actions) — unchanged |

```ts
type StepKey = 'd1' | 'w1' | `m${number}` | 'confirmed';
interface JoinerOnboarding {
  journeyId: string; companyName: string; firstName: string;
  step: StepKey;                         // where they are
  steps: Array<{ key: StepKey; label: string; state: 'done' | 'current' | 'future' }>;   // Day 1, Week 1, Month 1 … Month n, Confirmed
  hero: { eyebrow: 'YOU ARE HERE' | 'PROBATION COMPLETE'; label: string };            // "Day 1" … "Confirmed!"
  plant: PlantState;
  firstPunch: { at?: string; faceEnrolled: boolean };
  goals?: { month: number; count: number; nextTalk?: { on: string; inDays: number; withName?: string } };  // from Month 1 to the end of probation
  meetings: JoinerMeetingRow[];
  tasks: JoinerTaskRow[];
  checkins: JoinerCheckinRow[];
  watch: WatchRow[];                    // the status-style list (stage d1/w1/m1)
  trainings: WatchRow[];
  devices: Array<{ id: string; title: string; ready: boolean; readyAt?: string }>;
  tour: { lessons: TourLesson[]; managerLessons?: TourLesson[]; done: TourLesson[]; today?: TourLesson };
  profile: { sections: Array<{ key: string; title: string; state: 'done' | 'todo' | 'by_hr' }>; done: number; total: number; pct: number };
  summary: {                            // "now" counts for the tiles (current step)
    meetings: { met: number; total: number }; tasks: { toDo: number; upNext?: string }; watch: { count: number; first?: string; minutes?: number };
    devices: { ready: number; total: number }; checkinDue?: { id: string; title: string }; tour: { done: number; total: number; today?: string };
  };
}
interface JoinerMeetingRow {
  id: string;                           // rowId for meeting-rows endpoints: `team:<key>` or `team:<key>@<month>`
  title: string;                        // the topic
  withRole: MeetWith; roleLabel: 'HR' | 'Your manager' | 'Your buddy' | 'IT & admin' | 'Head of department';
  person?: { userId: string; name: string; initials: string; photoUrl?: string };
  step: StepKey; everyMonth: boolean; month?: number;
  met: boolean; metAt?: string; locked: boolean; opensOn?: string;
  carriedFrom?: StepKey;                // "From Day 1"
  agenda: string[]; notes: string[];    // notes: own, private
  startsAt?: string;                    // when the manager scheduled it
}
interface JoinerTaskRow {
  id: string; title: string; type: JoinerTaskType;
  verb: 'Start' | 'Continue' | 'Review' | 'Read' | 'Sign' | 'Open';
  meta?: string;                        // "Appointment letter", "0 of 3 done", "Bank account, PF and nominees"
  step: StepKey; state: 'todo' | 'in_progress' | 'done' | 'locked'; dueOn?: string; carriedFrom?: StepKey;
  progress?: { done: number; total: number };
  opens: { screen?: DoScreen | ReviewPage; policies?: true; letters?: true; form?: true; link?: string; fileUrl?: string };
}
interface JoinerCheckinRow { id: string; title: string; step: StepKey | 'confirmed'; questions: number; state: 'locked' | 'open' | 'sent'; opensOn?: string; sentAt?: string }
interface JoinerCheckin extends JoinerCheckinRow { questions: Array<{ id: string; text: string; type: CheckinAnswerType; options?: string[] }>; answers?: Array<{ questionId: string; value: number | string | null }> }
interface WatchRow { id: string; title: string; type: 'video' | 'image' | 'text' | 'pdf'; minutes?: number; url?: string; text?: string; bg?: string; step: StepKey; watched: boolean }
interface JoinerGoals {
  month: number; managerName?: string; nextTalk?: { on: string; inDays: number; withName?: string };
  current: GoalView[]; earlier: Array<{ month: number; goals: GoalView[] }>;   // earlier: most recent first
}
interface GoalView { index: number; text: string; status?: 'start' | 'progress' | 'well'; note?: string; comment?: string; commentByName?: string; commentAt?: string }
```

Labels: `status` start "Just started", progress "Making progress", well "Going well" (the app holds copy,
the server holds the value).

### 4.3 Teammates (T) — `/lifecycle/team/*` (manager, buddy, head of department; extended)

| Method + path | Body | Returns |
|---|---|---|
| GET `/lifecycle/team/joiners` | | `{ joiners: TeamJoinerRow[] }` |
| GET `/lifecycle/team/joiners/:journeyId/page` | | `TeamJoinerPage` (new path: the old `/team/joiners/:journeyId` keeps its 20 Nov shape for app builds in use) |
| POST `/lifecycle/team/joiners/:journeyId/rows/:rowId` | `{ action: 'done' \| 'undo' }` | `TeamJoinerPage` (a tick; meetings tick the shared row the joiner's Mark as met writes) |
| GET `/lifecycle/team/joiners/:journeyId/buddy-options` · POST `…/buddy` `{ buddyUserId }` | | `{ options: Array<{ userId, name, designation?, photoUrl? }>, current?: string }` / `TeamJoinerPage` (ticks `mgr_assign_buddy`) |
| POST `/lifecycle/team/joiners/:journeyId/schedule` | `{ meetings: Array<{ rowKey: string; startsAt: string }> }` | `TeamJoinerPage` (writes `lifecycle_meetings`, pushes the invite to both, ticks `mgr_schedule` when every Day-1/Week-1 meeting has a time) |
| POST `/lifecycle/team/joiners/:journeyId/welcome-message` | `{ text }` (≤ 1000) | `TeamJoinerPage` (`meetUs.managerNote`, ticks `mgr_welcome`) |
| POST `/lifecycle/team/joiners/:journeyId/feed` | `{ text }` | `TeamJoinerPage` (Connect post + `managerWelcome`, ticks `mgr_feed_intro`; 409 before Day 1) |
| GET `/lifecycle/team/joiners/:journeyId/goals/:month` · POST same `{ comments: Array<{ index: number; text: string }> }` | | `{ month, goals: GoalView[] }` ("Send to {n}" ticks `mgr_goal_comments@month`) |
| GET `/lifecycle/team/joiners/:journeyId/checkins/:checkinId` · POST `…/read` | | `{ title, sentAt?, state: 'waiting' \| 'ready' \| 'read', questions, answers }` (manager only) |
| POST `/lifecycle/team/joiners/:journeyId/review` | `{ outcome: 'confirm' \| 'extend', extendMonths?: 1 \| 2 \| 3, kpis: string, strengths: string, next: string }` | `TeamJoinerPage` (onto `probation.recommendation`; ticks `mgr_confirmation_review`; head of department told) |
| PUT `/lifecycle/team/joiners/:journeyId/rows/:rowId/notes` | `{ notes: string[] }` | `{ notes }` (my own notes on a meeting's agenda) |
| GET `/lifecycle/team/joiners/:journeyId/review` | | `{ facts: Array<{ label, value }>, approverName?, sent?: { outcome, extendMonths?, kpis, strengths, next, at } }` (MgrConfReview's block; "Send to <approverName>") |
| GET `/lifecycle/team/joiners/:journeyId/confirmation` · POST same `{ action: 'approve' \| 'extend', extendMonths?: 1 \| 2 \| 3, comment? }` (new path: the old `/approval` keeps approve / discuss for app builds in use) | | approval view: `{ state: 'waiting' \| 'ready' \| 'approved' \| 'extended', recommendation?: { byName, outcome, extendMonths?, kpis, strengths, next, note?, at }, facts: Array<{ label, value }>, answer? }` |
| POST `/lifecycle/team/joiners/:journeyId/senior-meeting` | `{ mode: 'one' \| 'group', startsAt, journeyIds?: string[] }` | `TeamJoinerPage` (one `lifecycle_meetings` row per joiner; ticks `senior_meet` on each) |

```ts
interface TeamJoinerRow {
  journeyId: string; userId?: string; name: string; initials: string; photoUrl?: string; designation?: string;
  relation: 'report' | 'buddy' | 'line'; relationLine?: string;   // "You’re the buddy" | "Reports to Sunny Kapoor" | none for direct reports
  step: number; stepLabel: string;     // "Joins 1 Dec" | "Day 1" | "Week 1" | "Month 1" … | "Confirmed"
  preboarding: boolean; plantStage: number; toDo: number;
}
interface TeamJoinerPage {
  joiner: { journeyId; userId?; name; first; initials; photoUrl?; designation?; department?; reportsTo: 'you' | string; buddy?: 'you' | string;
            stepLabel: string; plantStage: number; preboarding: boolean;
            status: { label: 'On track' | 'Joining soon' | 'Confirmation due' | string /* "1 task delayed" */; warn: boolean };
            delayed?: { title: string; waitingDays: number; ownerLabel: string } };
  relation: 'report' | 'buddy' | 'line'; readOnly: boolean;
  card: { title: string /* "Your tasks for Priya" | "Help Priya with" */; toDo: number };
  tasks: TeamTaskRow[];                 // current first, then coming up; the card shows the first 3 open
  progress: { rows: ProgressStat[]; joining?: { on: string; time?: string; place?: string } /* JOINING DETAILS before Day 1 */ };
  lists: Record<'meet' | 'tasks' | 'ci' | 'watch' | 'tour' | 'dev' | 'prof', ProgressListRow[]>;
  /** The ways, in order (titles and lines are the app's copy): before Day 1 welcome_message, announcement; after: feed, game, announcement, team_post, chat. */
  reachOut: Array<'welcome_message' | 'announcement' | 'feed' | 'game' | 'team_post' | 'chat'>;
}
interface TeamTaskRow {
  id: string; title: string; kind: TeamTaskKind; step: number; stepLabel: string; early: boolean; done: boolean; locked: boolean;
  pair?: string; how?: string; note?: string;
  pill?: { text: string; tone: 'blue' | 'green' | 'grey' | 'amber' | 'red' };   // "Ready to read", "Waiting for Priya", "Ready to approve" …
  opens: 'meeting' | 'buddy' | 'schedule' | 'chat' | 'feed' | 'goals' | 'checkin' | 'review' | 'approval' | 'around' | 'groups' | 'invite' | 'plain' | null;
  canTick: boolean; agenda?: string[]; month?: number; checkinId?: string; doneByName?: string;
}
interface ProgressStat { key: 'meet' | 'ci' | 'tasks' | 'watch' | 'tour' | 'dev' | 'prof'; title: string; done: number; total: number; unit: string; flag: { text: string; tone: 'ok' | 'warn' | 'todo' } }
interface ProgressListRow { title: string; meta?: string; status: string; tone: 'ok' | 'todo' | 'warn' | 'soon'; comingUp: boolean }
```

Who is listed: direct reports (`relation report`), the people I'm buddy for (`buddy`), and for a head of
department or anyone above the manager, the reporting line (`line`; only the head of department has tasks,
others read-only). Meera (manager of one, buddy of another) gets both in one list. HR and IT & admin never
see Teams › Joiners.

### 4.4 HR and IT & admin in the app (H) — `/lifecycle/staff/*` (new)

Who: the template's `assignees.hrUserId` (else the joiner's `hrPrimaryUserId`, else the offer's creator) is
HR for that joiner; `assignees.itUserId` is IT & admin. Someone who is both picks with `?as=hr|it`.

| Method + path | Body | Returns |
|---|---|---|
| GET `/lifecycle/staff/onboarding?as=` | | `StaffOnboarding` |
| GET `/lifecycle/staff/joiners/:journeyId?as=` | | `StaffJoinerPage` |
| GET `/lifecycle/staff/joiners/:journeyId/profile` | | `StaffProfile` (nine sections; sections 6–9 (bank, PF, salary, tax) only to HR, never IT) |
| GET `/lifecycle/staff/joiners/:journeyId/tasks/:key?as=` | | `StaffTaskScreen` (what is needed to do it) |
| POST `/lifecycle/staff/joiners/:journeyId/tasks/:key?as=` | `{ action: 'done' \| 'undo', checks?: Record<string, 'looks_right' \| 'ask' \| 'matches' \| 'mismatch'>, accessCardNo?: string, accesses?: Record<string /*task id*/, boolean> }` | `StaffJoinerPage` (meetings refuse early: 409 before their step) |

```ts
interface StaffTile { role: 'hr' | 'it'; open: number; late: number; dueToday: number; pill?: string /* "3 late" | "2 due today" | "4 to do" */ }
interface StaffOnboarding {
  viewingAs: 'hr' | 'it'; canSwitch: boolean;
  cards: Array<{ key: 'joining_soon' | 'week1' | 'month1' | 'probation'; title: 'Joining soon' | 'Week 1' | 'Month 1' | 'Probation';
                 count: number; late: number; people: StaffPersonRow[] }>;
  everyone: StaffPersonRow[];           // "View all employees"
}
interface StaffPersonRow { journeyId: string; name: string; initials: string; photoUrl?: string; stepLabel: string;
  pill: { text: string /* "All done" | "3 late" | "Due today" | "Due Thu" | "Due 30 Nov" */; tone: 'green' | 'red' | 'amber' | 'grey' } }
interface StaffJoinerPage {
  joiner: TeamJoinerPage['joiner'];
  viewingAs: 'hr' | 'it';
  card: { title: string; toDo: number };
  tasks: Array<TeamTaskRow & { dueOn?: string; due?: { text: string; tone: 'red' | 'amber' | 'grey' } }>;   // every row opens a screen
  onboarding: { status: string; rows: Array<ProgressStat> /* Profile, Meetings, Tasks, Check-ins, Sowaka tour, Watch list, Devices */ };
  lists: TeamJoinerPage['lists'];
}
interface StaffProfile { name: string; pct: number;
  sections: Array<{ key: 'personal' | 'contact' | 'emergency' | 'education' | 'ids' | 'bank' | 'pf' | 'salary' | 'tax'; title: string;
                    missing: number; rows: Array<{ label: string; value?: string /* absent = "Not filled yet" */ }> }> }
/** Every screen answers `{ key, done, checks? }` plus: */
type StaffTaskScreen =
  | { key: 'hr_prepare_kit' | 'hr_hand_kit'; idCard: { name: string; designation?: string; department?: string; employeeId?: string; bloodGroup?: string; emergencyContact?: string; photo: 'uploaded' | 'missing' }; accessCardNo?: string }
  | { key: 'hr_check_payroll'; sections: StaffProfile['sections'] /* bank, pf, tax */ }
  | { key: 'hr_check_form'; sections: StaffProfile['sections'] /* personal, contact, emergency, education */ }
  | { key: 'hr_confirmation_letter'; facts: Array<{ label: string; value: string }>; letter?: { id: string; state: 'draft' | 'ready' | 'sent' } }
  | { key: 'it_accesses' | 'hr_accesses'; accesses: Array<{ id: string; title: string; ready: boolean; details: Array<{ label: string; value: string }> }> }
  | { key: string; meeting: { agenda: string[] } }   // HR's / IT's meetings; own notes via the meeting-row notes
  | { key: string };                                  // a custom row: the how-to line and Mark as done
```

Added by lane H (the app's HR / IT screens needed them; staffApp.ts only):
- `StaffJoinerPage.step` (the joiner's step: which rows are now and which are COMING UP); its Profile row's
  `done` is the full profile's % (nine sections for HR, five for IT), the same number `…/profile` says.
- `StaffProfile.sections[].meta`: the tax section's `"FY 2026–27"` (HRPayroll shows it when nothing is missing).
- Every `StaffTaskScreen` has `possessive: 'her' | 'his' | 'their'` (from the profile's gender) for the
  screens' copy ("From her profile"); the kit's `idCard.company`; the payroll check's `cheque?: { uploaded }`
  (when the joiner's documents ask for a cancelled cheque); the letter's
  `preview: { head, title: 'Confirmation of employment', paragraphs }` (the org's confirmation template, or the
  letter made on the dashboard, filled with the dashboard's merge values, pay left out); a meeting's
  `meeting.notes` (my own).
- PUT `/lifecycle/staff/joiners/:journeyId/tasks/:key/notes` `{ notes: string[] }` → `{ notes }`: my own notes on
  one of my meetings (the meeting-row notes, `lifecycle_meeting_notes`, private to me).

Due text (server): late `"1 day late"` / `"N days late"` (red), `"Due today"` (amber), `"Due tomorrow"`,
`"Due <Mon…Sun>"` within 5 days, else `"Due 30 Nov"` (grey). A future row that cannot start early shows its
step label ("Week 1") and `"Opens in Week 1"`. Any HR/IT task can be done early except meetings.

---

## 5. Caching (existing methods only)

| Read | How it is kept | Dropped / patched by |
|---|---|---|
| The org's onboarding templates, read by the dashboard's design view and by a journey the migration has not reached (design journeys read their own snapshot, live) | `cachedLifecycle(org, 'lc-templates', null, …)` (new `SwrKind`, swr-cache: fresh 60 s, Redis cache-bus drop across blue/green) | in `LIFECYCLE_READ_KINDS`: every API write in the org (`forgetReadsOnWrite`), and explicitly `forgetLifecycleReads(org)` after a design save |
| HR / IT & admin's Actions › Onboarding (cards, everyone, tile counts) | built per request from `boardData(org)` (`lc-board-data`, existing; its journey projection gains `teamTasks`; who is HR / IT is read from the kept `templateSnapshot.settings`), then only my joiners are read whole | patched per journey by every write (`patchBoardData`), as the board is |
| `/lifecycle/me` staff tile | same `boardData` | same |
| Joiner home, team person page, staff person page | read live (one journey with its snapshot, its tasks: a few KB) | — |

No new cache. The lifecycle jobs (`runLifecycleJobs`) already call `forgetLifecycleReads(null)`.

---

## 6. Old endpoints and screens these designs replace

Server endpoints stay until the app release with lanes J/T/H is the oldest one in use (old builds call them);
the screen lanes remove every screen/entry below now. (They are listed here; the routes keep working unchanged.)

| Old (server) | Old screen (remove) | Replaced by |
|---|---|---|
| GET `/lifecycle/onboarding` (home: upNext/today/later/done, journey stages, day1, weekDone) | app onboarding home (20 Nov), Day-1 done, Week-1 done | GET `/lifecycle/joiner/onboarding` |
| GET/PUT `/lifecycle/onboarding/week1` (reels) | Week-1 reels | tasks (Do in Sowaka / Review / Read and acknowledge) |
| GET/PUT `/lifecycle/onboarding/intro`, POST `…/intro/post` | intro post | — (manager's "Introduce on the feed") |
| GET/POST `/lifecycle/onboarding/people[/:id]` | people to meet | meetings |
| GET/POST `/lifecycle/onboarding/starter-tasks…` | starter task | — |
| GET/POST `/lifecycle/onboarding/notes…` | shared 1:1 notes | — |
| GET/POST `/lifecycle/onboarding/meetings/:id` | meeting card (time/place) | meeting rows (`/onboarding/meeting-rows`, kept) |
| GET/POST `/lifecycle/onboarding/survey` | Day-7 / pulse survey | check-ins |
| GET `/lifecycle/onboarding/probation`, PUT `…/probation/:month/checkin` | monthly self check-in (PB1) | goals ("How's it going?") + check-ins |
| GET/POST `/lifecycle/onboarding/reveal[/seen]` | confirmation reveal | Confirmed home + "Read your confirmation letter" |
| PUT `/lifecycle/onboarding/day1-feeling`, POST `…/week-done/seen` | Day 1 done / Week 1 done | — |
| GET `/lifecycle/onboarding/team` | Your team (static) | (kept read; J lane decides — the canvas's "Your team" row) |
| GET `/lifecycle/manager/joiners[/:id]`, PUT `…/setup`, POST `…/starter-tasks`, `…/notes`, `…/welcome`, `…/tasks/:taskId`, POST `/lifecycle/manager/starter-tasks/:id/reply` | M0–M3 manager joiner screens | `/lifecycle/team/*` |
| GET `/lifecycle/team/joiners/:id`, POST `…/tasks/:taskId`, GET/POST `…/approval` (20 Nov shapes) | Teams › Joiners person page (20 Nov), recommend screen, approve / ask to discuss | GET `…/page`, POST `…/rows/:rowId`, the task screens of §4.3, GET/POST `…/confirmation` |
| PUT `/lifecycle/manager/joiners/:id/probation/:month` | monthly review / check-in (PB2) | **kept only for `goals` (goal text)**; check-in/review parts replaced by goal comments + check-in read |
| team rows `mgr_plan_week`, `mgr_buddy_check`, `mgr_week_chat`, `mgr_mid_feedback`, `mgr_write_review`, `mgr_recommend`, `buddy_meet`, `buddy_policies`, `buddy_tools`, `buddy_intros`, `buddy_leave_ot`, `buddy_week1` (old wording), `buddy_month1` (old), `hod_meet`, `mgr_share_news` | Teams › Joiners rows (20 Nov) | the §3 keys (migration switches the old ones off) |
| Dashboard template editor (task table, Recommended panel, settings form) for onboarding | Setup › Employee lifecycle › Onboarding templates (old editor) | design editor on `/templates/:id/design` (offboarding keeps the old editor) |

Kept exactly: `/lifecycle/me` (gains `onboarding.tile` and `staff`), `/lifecycle/portal-session` and the portal
(Quick Actions opens the portal inside the app before app access exists), `/lifecycle/onboarding/tour/:lesson`,
`/onboarding/meeting-rows/*` (gains `action: 'unmet'` and the design meeting rows), `/onboarding/letters/:id/pdf`,
GET `/lifecycle/team/joiners` (gains `initials`, `relationLine`, `plantStage`), the board.

Every deprecated route above stays for app builds in use (the 20 Nov app reads them) and answers as before;
remove them once the release with lanes J/T/H is the oldest build in use.

---

## 7. Migration (non-destructive; dry run by default)

`npm run lifecycle:final-designs-migrate -- [--org <id>] [--apply]` (`src/scripts/lifecycle-final-designs-migrate.ts`).
Never run against a real database without the user's yes. Per onboarding template **without** design rows:

1. Adds the §3 design rows (ids `fd-…`), with the template's `probationMonths` kept.
2. Switches off (`enabled: false`, `replacedBy: 'final_designs'`) the old rows the designs replace: first-week
   and probation rows (`welcome_induction`, `meet_manager`, `vision_culture`, `meet_team`, `laptop_setup`,
   `register_face`, `app_tour`, `week1_reels`, `intro_post`, `people_to_meet`, `starter_task`,
   `one_on_one_notes`, `probation_goals`, `day7_survey`, `week1_done`, `check_logins`, `monthly_goals`,
   `monthly_checkin`, `monthly_review`, `pulse_survey`, `manager_30day_note`, `manager_setup`, `assign_buddy`,
   `device_request`) and the old team rows (§6). Old HR custom rows are kept as they are (enabled) and listed.
   The two 20 Nov team rows whose keys the designs reuse (`hod_approve`, `mgr_welcome`) keep their row with a
   key of their own (`…_20nov`), so no key is listed twice and the older editor can still save the template.
3. `sign_letters` gets `design` (Day-1 Sign task) and `settings.signLettersOnDay1 = true`.

4. Running journeys on the template (open, snapshot without design rows) get, in their own `templateSnapshot`,
   the migrated template's meeting, check-in, watch-list, training and teammate rows and the new settings keys
   (`preboarding`, `reporting`, `tourLessons`, `remindLateTeamTasks`, `assignees`) — the view they have today,
   from then on fixed like any journey's. Never task or access rows (their tasks stay their own journey tasks),
   never `probationMonths` or `signLettersOnDay1` (their probation and where they sign stay as they started).

Nothing is deleted. Running journeys keep their journey tasks; their tasks show by kind (an `ack` row as Read
and acknowledge, `sign` as Sign, others as More tasks; old meetings and surveys are not listed). Ticks under
old team keys stay on the journey (history). The dry run prints, per template: rows added, rows switched off,
custom rows kept, and how many running journeys get the rows; it writes nothing.

---

## 8. Checks

`npm run lifecycle:final-designs-check` (`src/scripts/lifecycle-final-designs-check.ts`, own scratch DB via
`LIFECYCLE_CHECK_MONGODB_URI`): design GET/PUT round trip and validation, seed = canvas order, rules per
stage, joiner view per step (Day 1 … Confirmed), task actions, check-in send/read, goals status/comment,
watch, team page for manager/buddy/head of department (Meera both), staff cards/tile/person/profile/tasks,
access ready → joiner device ready, the migration dry run and apply on a legacy template, a legacy journey
still reading, cache drop after a design save. The existing `lifecycle:check`, `lifecycle:team-check`,
`lifecycle:meetings-check` keep passing (their npm scripts set `LIFECYCLE_ONBOARDING_SEED=legacy`, so they test
journeys made from the older template, as production's running journeys are).

## 8a. Artboard → facts → endpoint · field → source

Every artboard and prototype state on the canvas. "Copy" is fixed UI text the app holds (the same for
everyone: checklists like "Pantry and where people eat", lesson steps, reach-out block titles); every name,
number, date and status is data from the endpoint named, the same value on every surface.
J = `GET /lifecycle/joiner/onboarding`, P = `GET /lifecycle/team/joiners/:id/page`,
S = `GET /lifecycle/staff/joiners/:id`, O = `GET /lifecycle/staff/onboarding`, D = `GET/PUT /admin/lifecycle/templates/:id/design`.

### Joiner (page 1)

| Artboard / state | Facts shown or changed | Endpoint · field | Source |
|---|---|---|---|
| AppActions · Onboarding tile | title, line ("Today is your first day"), badge ("Day 1") | `GET /lifecycle/me` · `onboarding.tile` | journey (`tj`, step) |
| AppActions · Policies tile | "3 to acknowledge" | kept `GET /policies` · `toAcknowledge` | `policy_documents`, `policy_acknowledgements` |
| AppActions · tour overlay, Attendance card | slide to punch in | existing attendance | `attendance_records` |
| AppPunch · first punch-in | punch time + date, "Face registered" | J · `firstPunch.at`, `firstPunch.faceEnrolled` | `attendance_records`, `users.faceId` |
| AppHome · Day 1 (before / after punch) | step strip (Day 1 … Confirmed: done / current / future), hero eyebrow + label, plant; punch card until the first punch; tour card after; Meetings avatars + "x of y met"; Tasks UP NEXT + "n to do"; Tour "len · x of 4 done"; Watch "len · n items"; Devices "x of y ready"; Profile "n of 7 sections done" + % | J · `steps`, `hero`, `plant`, `firstPunch`, `tour`, `summary`, `meetings[].person`, `devices`, `profile` | journey, journey tasks, template design rows, `journey.watched`, `journey.tour` |
| AppHomeWeek1 · check-in due | Check-ins tile "<title> · about a minute", Start | J · `summary.checkinDue` | template check-in rows + `lifecycle_checkin_answers` |
| AppHomeMonth1 / Month3 / Month6 | "This month’s goals": "n goals · next talk in x days"; Meetings "x of y met" | J · `goals`, `summary.meetings` | `lifecycle_probation_months.goals`; Monthly goals meeting (`lifecycle_meetings.startsAt`, else the month's end) |
| AppHomeConfirmed | "PROBATION COMPLETE", "Confirmed!", Tasks "Read your confirmation letter", End of probation check-in | J · `hero`, `tasks[]`, `checkins[]` | journey `confirmed` + decision, `confirmation_letter` task, check-in rows |
| Look ahead (future chip) | that step's meetings / tasks / watch / tour lines, "IN WEEK 1", "Opens in …" | J · the same lists filtered by `step`; `locked`, `opensOn` | same rows (no extra call) |
| AppMeetings | topic, person name · role label, pills "From Day 1" / stage / "Every month", COMING UP, locked "Opens in Month 1", Met checkbox (toggles), Your team row | J · `meetings[]`; `POST /lifecycle/onboarding/meeting-rows/:rowId {action: 'met' \| 'unmet'}` | template meeting rows; `journey.teamTasks[key]` (shared with the teammate) |
| AppMeetingGoals · agenda and notes | topic, person + role, Met badge, "n things to talk about", agenda, own note per point (voice typing is the device's), Mark as met / Met | J · `meetings[].agenda`, `notes`, `met`; `PUT …/meeting-rows/:rowId/notes` | template agenda; `lifecycle_meeting_notes` (own only) |
| AppTeam · Your team | department, people count, Manager / Buddy badges, designations, Say hi | kept `GET /lifecycle/onboarding/team` | `users` |
| AppTasks | title, icon by type, meta ("Appointment letter", "0 of 3 done", "Bank account, PF and nominees"), % bar, pills, COMING UP, lock, done tick, verb Start / Continue / Review / Read / Sign / Open | J · `tasks[]` | journey tasks (from the template's task rows) + product facts (punch, profile, tax, payroll, policies, letters) |
| Task taps | Do in Sowaka → its screen; Review → page + "Looks good"; Read and acknowledge → App policies or the PDF + "I've read this"; Sign → documents to sign; More tasks → the link | `POST /lifecycle/joiner/tasks/:id`, `/policies/*`, `/lifecycle/joiner/letters/*` | journey task status, `policy_acknowledgements`, `lifecycle_letters` |
| AppPolicies (new joiner / policy updated) | n to acknowledge, title, version, read time, Acknowledged date, Updated + what changed, required / optional | kept `GET /policies`, `POST /policies/:id/acknowledge` | `policy_documents`, `policy_acknowledgements` |
| AppCheckins | title, "n questions · about a minute" / Done, Start / tick | J · `checkins[]` | template check-in rows + `lifecycle_checkin_answers` |
| AppCheckinRate / Yes / Long | "k of N", question, type (rating 1–5 and yes/no move on at a tap; long: Next / Send + Skip) | `GET /lifecycle/joiner/checkins/:id` | template `design.questions` |
| AppCheckinDone | "Thanks, <first name>" | `POST /lifecycle/joiner/checkins/:id`; J · `firstName` | `lifecycle_checkin_answers` |
| AppWatch | company name, n videos (duration, title, colour), Trainings (Read / Watch, "5 min read" / "20 min") | J · `companyName`, `watch[]`, `trainings[]`; `POST /lifecycle/joiner/watch/:id`; `GET /lifecycle/joiner/media/:fileId` | template rows + `lifecycle_files`; `journey.watched` |
| AppAccess | items, Ready / Setting up, "x of y ready" | J · `devices[]` | access journey tasks |
| Tour + AppLesson | 4 lessons (+2 "For managers"), Done / Today / Day n · len, Replay / Start / Play | J · `tour`; kept `POST /lifecycle/onboarding/tour/:lesson` | `journey.tour` + first punch; template `settings.tourLessons` |
| Your profile | 7 sections Done / To do / By HR, "n of 7 sections done", % | J · `profile` | `journey.profile`, `aboutYou`, documents |
| AppGoals | this month: goal, "How’s it going?" (3 values), note (Add / Edit note), manager comment; "Next talk with <manager>" + "In x days · date"; earlier months collapsed, most recent first | `GET /lifecycle/joiner/goals`, `PUT /lifecycle/joiner/goals/:month/:index` | `lifecycle_probation_months.goals[]` |

### Teammates (page 3)

| Artboard / state | Facts shown or changed | Endpoint · field | Source |
|---|---|---|---|
| Teams pills · Joiners badge | number of connected joiners | `GET /lifecycle/team/joiners` | journeys + relation |
| MgrProtoJoiners / BuddyProto / HodProto | photo / initials + plant, name, designation, "You’re the buddy" / "Reports to X", stage pill ("Joins 1 Dec", "Day 1" …) | `GET /lifecycle/team/joiners` · `TeamJoinerRow` | journeys, `users` |
| MgrProtoPriya / BuddyPriya / HodProtoSana | hero (photo, name, designation, Reports to you / X, Buddy: X / You’re the buddy / No buddy yet, stage + plant); card title + "n to do" / All done; first 3 open rows or "Nothing due right now. Next: …"; tiles (status + View progress; Reach out line) | P · `joiner`, `card`, `tasks`, `reachOut` | journey, team rows + ticks, journey tasks |
| MgrAllTasks · View all | every row, "n to do" / "All done for now", COMING UP | P · `tasks` | same |
| Task rows | title, pair line, "Opens in …", pills (stage / Ready to read / Read / Waiting for X / Ready to approve / Approved / Extended), tick or chevron, how-to (i) | P · `tasks[]` | template team rows (`design.how`), `teamTasks`, `lifecycle_checkin_answers`, `probation.*` |
| Tick a meeting ("Marked as done · Add notes") | the shared met tick | `POST /lifecycle/team/joiners/:id/rows/:rowId` | `teamTasks[key]` |
| MgrMeeting | title, "With <joiner>", agenda, own notes, Mark as done / Done, footer | P · `tasks[].agenda`; `PUT /lifecycle/team/joiners/:id/rows/:rowId/notes` | template agenda; `lifecycle_meeting_notes` (own) |
| MgrProgress · View progress | status, DELAYED (title, days, who), stat rows (Meetings met, Check-ins sent, Tasks done, Watch list watched, Sowaka tour lessons, Devices ready; before Day 1: Devices + Profile %), JOINING DETAILS, each stat's list | P · `progress`, `joiner.delayed`, `lists` | joiner's journey tasks, team rows, watched, tour, accesses, profile, `day1Pass` |
| MgrReachOut | the ways (before Day 1: 2; after: 5) | P · `reachOut` | journey (joined or not) |
| MgrAssignBuddy | colleagues (name, designation), current buddy, Assign / Save | `GET …/buddy-options`, `POST …/buddy` | `users`; `journey.buddyUserId` |
| MgrSchedule | Day 1 / Week 1 meetings (initials, title), "n of 3 set", a time each, Send invites | P · meeting rows `startsAt`; `POST …/schedule` | `lifecycle_meetings` |
| MgrWelcome | message prefilled (first name, joining date, first meeting time) | P · `joiner.first`, `joiner.tj`, meetings `startsAt`; `POST …/welcome-message` | `journey.meetUs.managerNote` |
| MgrFeed | author, post prefilled (name, designation, department), Post | P · `joiner`; `POST …/feed` | Connect post + `journey.managerWelcome` |
| Set KPIs (plain) | how-to line, Mark as done | P · `tasks[].how` | template `design.how`; `teamTasks` |
| MgrReview · a check-in | "<first>’s <check-in>", "Sent <when>", questions + answers, Mark as read | `GET …/checkins/:id`, `POST …/checkins/:id/read` | `lifecycle_checkin_answers`, `teamTasks['mgr_read_checkin@<id>']` |
| MgrGoals | goals with status + joiner's note, a comment box each, Send to <first> | `GET/POST …/goals/:month` | `lifecycle_probation_months.goals[]` |
| MgrConfReview | facts (monthly goals, check-ins sent, attendance on time %, leave taken, confirmation discussion), Confirm / Extend (1–3 months), three answers, Send to <head of department> | `GET …/review` (facts, approver name) + `POST …/review` | goals, answers, `attendance_records`, `leaves`, ticks → `journey.probation.recommendation` |
| HodApprove | recommended by + when, three answers, recommendation + note, facts, comments, Approve / Extend by n months | `GET/POST …/approval` | `probation.recommendation`, `probation.hodApproval` |
| BuddyAround / BuddyHowTo | checklist (copy), how-to line, Done | P · `tasks[].how`; `POST …/rows/:rowId` | template `design.how`; `teamTasks` |
| HodMeet | One to one / With other new joiners (the viewer's joiners at Day 1–Week 1), a time, Send invite | `GET /lifecycle/team/joiners` (step 1–2) + `POST …/senior-meeting` | `lifecycle_meetings`, `teamTasks['senior_meet']` |

### HR and IT & admin (page 4)

| Artboard / state | Facts shown or changed | Endpoint · field | Source |
|---|---|---|---|
| HRProto / ITProto · Actions | Onboarding tile: "n tasks for new joiners" / All done, pill (n late / n due today / n to do), highlighted | `GET /lifecycle/me` · `staff` | `lc-board-data` + template team rows |
| HROnboarding / ITOnboarding | "Viewing as HR / IT & admin", 4 cards (n employees / No one right now, "n late"), rows (name, stage, worst pill) | O · `cards` | same |
| HRAll | "Everyone in onboarding · n employees" | O · `everyone` | same |
| HRPerson / ITPerson | hero; "Your tasks for X" + n to do; due pills; COMING UP (meetings locked till their step, other tasks open early); "<first>’s onboarding" status + 7 stats and their lists | S | journeys, team rows + ticks, journey tasks, watched, tour, profile |
| HRProfile | nine sections (n missing / Complete), rows, "Not filled yet" | `GET …/profile` | `journey.profile`, `aboutYou`, `employee_payment_details`, `salary_structures`, `tax_declarations` |
| HRKit (prepare / hand over) | ID card (photo, company, name, designation · department, employee id, blood group, emergency contact, photo status), checklist (copy), access card number, Kit ready / Handed over | `GET/POST …/tasks/hr_prepare_kit` · `hr_hand_kit` | `users`, `journey.profile`, `aboutYou`, `journey.staffChecks` |
| HRPayroll | bank rows, cancelled cheque, PF and UAN, tax and investments, Looks right / Ask per section, Done | `GET/POST …/tasks/hr_check_payroll` | profile sections; `staffChecks` |
| HRForm | personal, contact, emergency, education (rows, n missing), Looks right / Ask, Done | `GET/POST …/tasks/hr_check_form` | same |
| HRLetter | approved by, recommended by, confirmed from, designation, salary change; letter preview; Send | `GET …/tasks/hr_confirmation_letter` | `probation.*`, decision, `lifecycle_letters` |
| ITAccess | "x of 4 ready", per access Ready / Not yet + setup rows, Save | `GET/POST …/tasks/it_accesses` | access journey tasks; `users` (work email, phone, manager) |

### Dashboard (page 2)

| Artboard / state | Facts shown or changed | Endpoint · field | Source |
|---|---|---|---|
| Header | template name, Default, Save template | D · `name`, `isDefault` | `lifecycle_templates` |
| Pre-boarding (4 rows) | Offer letter panel (from Document templates), Joining and reporting details (time, place, bring, anything else, who meets them), Employee profile, pre-boarding watch list (Video / Image / Text, file, text + background) | D · `preboarding.*`; `POST …/media` | template settings + rows, `lifecycle_files` |
| Onboarding · Meetings | groups by stage, title, who, agenda, key Monthly goals, Add a meeting | D · `meetings[]` | template rows |
| Onboarding · Tasks | groups by kind, title, stage, Sign: documents (Document templates), Add (kind first) | D · `tasks[]`; `GET /admin/lifecycle/letter-templates` | template rows |
| Onboarding · Check-ins | rows, when, questions (5 answer types) | D · `checkins[]` | template rows |
| Onboarding · Sowaka tour | six rows, removable | D · `tour` | template settings |
| Onboarding · Watch list / Trainings | tiles (title, stage, uploaded / Upload), "n to upload" | D · `watch[]`, `trainings[]` | template rows + `lifecycle_files` |
| Onboarding · Devices and accesses | title, who, By end of Week 1, Add | D · `accesses[]` | template rows |
| Probation | 3 / 6 months, probation template → Shift templates | D · `probation` | template settings |
| The team's part | reminder switch, tab counts, who does it (HR, IT & admin, someone senior pickers), rows by stage, task panel (title, when, how-to), Add | D · `team.*` | template settings + rows |
| Employee preview | stage tabs, phone tiles | `GET …/templates/:id/preview?stage=` | template |

## 9. Gaps (the canvas has no source; nothing is invented)

- Goal text: no screen in the canvas writes it. Kept: the manager's existing `PUT …/probation/:month {goals}`.
- ID card "Blood group", T-shirt size, desk, laptop asset number, Wi-Fi network: no field anywhere. The server
  reads `journey.profile.personal.bloodGroup` (new optional field; nothing writes it until the profile form
  asks for it) and shows the others only when a value exists (none today).
- Buddy "groups and channels" (team groups with member counts): no Connect groups API; the screen is a tick.
- "Send a game", "Make an announcement", "Introduce to the team" reach-out blocks open existing app screens;
  no server change.
- Confirmation letter "Send to Dev" from the app: letters are made and sent on the dashboard (PDF made in the
  browser, CONTRACT decision 11); the app shows the facts and the letter's state.
- Fill-in forms: the canvas's add picker does not offer "Fill in a form" (d2 describes it); the server
  supports `type: 'form'` so D can add the entry if asked.
