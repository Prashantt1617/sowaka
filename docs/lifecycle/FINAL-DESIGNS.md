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
| The template (every item, every setting) | `lifecycle_templates` · `tasks[]` rows with `design` (+ `settings`) | Dashboard `PUT …/templates/:id/design` | everything below |
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
| Who does HR / IT & admin / "someone senior" tasks | template `settings.assignees` | dashboard | server (who sees what) |

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

How rows become behaviour (no engine changes):

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
| IT & admin | the access rows (Laptop, Work email, Office Wi-Fi, Sowaka Connect), shown to IT as one row `it_accesses` "Set up {p} accesses" (w1, early) |
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
| PUT `/admin/lifecycle/templates/:id/design` | `TemplateDesign` minus read-only fields (whole document; "Save template") | `TemplateDesign` (saved). Applies to journeys that start after saving for tasks and accesses; meetings, check-ins, watch list and team rows follow the template as it is now (as team rows do today). |
| POST `/admin/lifecycle/templates/:id/media` | multipart `file` (video mp4/mov ≤ 50 MB; image jpg/png; pdf ≤ 10 MB) | `{ file: { id, name, contentType, size } }` |
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
interface TemplatePreview { stage: DesignStage; header: 'Welcome' | 'Onboarding'; stageLabel: string;
  tiles: Array<{ key: 'joining' | 'offer' | 'profile' | 'watch' | 'meetings' | 'tasks' | 'tour' | 'devices'; title: string; line: string; sub: string }> }
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
| POST `/lifecycle/joiner/tasks/:taskId` | `{ action: 'looks_good' \| 'acknowledged' \| 'opened' \| 'done' }` (Review → looks_good; Read and acknowledge (PDF) → acknowledged; More tasks → opened (after the link opens) or done) | `{ task: JoinerTaskRow }` (409 for Do in Sowaka, Sign, policies, forms: they finish from their own screen) |
| GET `/lifecycle/joiner/forms/:taskId` · POST same `{ answers: Array<{ questionId, value: string \| null }> }` · POST `/lifecycle/joiner/forms/:taskId/files` multipart `file` → `{ fileId }` | | `{ form: { taskId, title, questions, answers?, sentAt? } }` — answers saved to the joiner's profile (`journey.forms[taskId]`) |
| GET `/lifecycle/joiner/checkins/:id` | | `JoinerCheckin` |
| POST `/lifecycle/joiner/checkins/:id` | `{ answers: Array<{ questionId: string; value: number \| 'yes' \| 'no' \| string \| null }> }` (null = skipped long answer) | `JoinerCheckin` (409 once sent, or before it opens) |
| GET `/lifecycle/joiner/goals` | | `JoinerGoals` |
| PUT `/lifecycle/joiner/goals/:month/:index` | `{ status?: 'start' \| 'progress' \| 'well', note?: string (≤ 500, '' clears) }` | `JoinerGoals` |
| POST `/lifecycle/joiner/watch/:itemId` | `{}` | `{ watched: true, at }` |
| GET `/lifecycle/joiner/media/:fileId` | | the bytes of a template media file of the joiner's template (Range supported for video) |
| GET `/lifecycle/joiner/letters` · POST `/lifecycle/joiner/letters/:id/opened` · POST `/lifecycle/joiner/letters/:id/sign` `{ method: 'draw' \| 'type', typedName?, imageDataUrl? }` · GET `/lifecycle/joiner/letters/:id/pdf` | | the Sign task's documents, same shapes as the portal's (`portalLetters`), signing through the same service |
| kept: POST `/lifecycle/onboarding/meeting-rows/:rowId` `{ met: boolean }` · PUT `/lifecycle/onboarding/meeting-rows/:rowId/notes` `{ notes: string[] }` | | Mark as met (the shared tick) and own notes; `rowId` = `JoinerMeetingRow.id` |
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
| GET `/lifecycle/team/joiners/:journeyId` | | `TeamJoinerPage` |
| POST `/lifecycle/team/joiners/:journeyId/tasks/:taskId` | `{ action: 'done' \| 'undo' }` | `TeamJoinerPage` (kept; meetings tick the shared row) |
| GET `/lifecycle/team/joiners/:journeyId/buddy-options` · POST `…/buddy` `{ buddyUserId }` | | `{ options: Array<{ userId, name, designation?, photoUrl? }>, current?: string }` / `TeamJoinerPage` (ticks `mgr_assign_buddy`) |
| POST `/lifecycle/team/joiners/:journeyId/schedule` | `{ meetings: Array<{ rowKey: string; startsAt: string }> }` | `TeamJoinerPage` (writes `lifecycle_meetings`, pushes the invite to both, ticks `mgr_schedule` when every Day-1/Week-1 meeting has a time) |
| POST `/lifecycle/team/joiners/:journeyId/welcome-message` | `{ text }` (≤ 1000) | `TeamJoinerPage` (`meetUs.managerNote`, ticks `mgr_welcome`) |
| POST `/lifecycle/team/joiners/:journeyId/feed` | `{ text }` | `TeamJoinerPage` (Connect post + `managerWelcome`, ticks `mgr_feed_intro`; 409 before Day 1) |
| GET `/lifecycle/team/joiners/:journeyId/goals/:month` · POST same `{ comments: Array<{ index: number; text: string }> }` | | `{ month, goals: GoalView[] }` ("Send to {n}" ticks `mgr_goal_comments@month`) |
| GET `/lifecycle/team/joiners/:journeyId/checkins/:checkinId` · POST `…/read` | | `{ title, sentAt?, state: 'waiting' \| 'ready' \| 'read', questions, answers }` (manager only) |
| POST `/lifecycle/team/joiners/:journeyId/review` | `{ outcome: 'confirm' \| 'extend', extendMonths?: 1 \| 2 \| 3, kpis: string, strengths: string, next: string }` | `TeamJoinerPage` (onto `probation.recommendation`; ticks `mgr_confirmation_review`; head of department told) |
| GET `/lifecycle/team/joiners/:journeyId/approval` · POST same `{ action: 'approve' \| 'extend', extendMonths?: 1 \| 2 \| 3, comment? }` | | approval view: `{ state: 'waiting' \| 'ready' \| 'approved' \| 'extended', recommendation?: { byName, outcome, extendMonths?, kpis, strengths, next, note?, at }, facts: Array<{ label, value }>, answer? }` |
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
  progress: { rows: ProgressStat[]; footer: string; joining?: string /* "Joins 1 Dec · 9:30 AM · Pune office" */ };
  lists: Record<'meet' | 'tasks' | 'ci' | 'watch' | 'tour' | 'dev' | 'prof', ProgressListRow[]>;
  reachOut: Array<{ key: 'welcome_message' | 'announcement' | 'feed' | 'game' | 'team_post' | 'chat'; title: string; line: string }>;
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
type StaffTaskScreen =
  | { key: 'hr_prepare_kit' | 'hr_hand_kit'; idCard: { name; designation?; department?; employeeId?; emergencyContact?; photoUrl?; missing: string[] }; accessCardNo?: string }
  | { key: 'hr_check_payroll'; sections: StaffProfile['sections']; checks: Record<string, string> }
  | { key: 'hr_check_form'; sections: StaffProfile['sections']; checks: Record<string, string> }
  | { key: 'hr_confirmation_letter'; facts: Array<{ label; value }>; letter?: { id: string; state: string; pdfUrl?: string } }
  | { key: 'it_accesses'; accesses: Array<{ id: string; title: string; ready: boolean; details: Array<{ label: string; value: string }> }> }
  | { key: string; meeting: { agenda: string[]; notes: string[] } };
```

Due text (server): late `"1 day late"` / `"N days late"` (red), `"Due today"` (amber), `"Due tomorrow"`,
`"Due <Mon…Sun>"` within 5 days, else `"Due 30 Nov"` (grey). A future row that cannot start early shows its
step label ("Week 1") and `"Opens in Week 1"`. Any HR/IT task can be done early except meetings.

---

## 5. Caching (existing methods only)

| Read | How it is kept | Dropped / patched by |
|---|---|---|
| The org's onboarding templates (design rows), read by every joiner / team / staff view and the dashboard's design GET | `cachedLifecycle(org, 'lc-templates', null, …)` (new `SwrKind`, swr-cache: fresh 60 s, Redis cache-bus drop across blue/green) | in `LIFECYCLE_READ_KINDS`: every API write in the org (`forgetReadsOnWrite`), and explicitly `forgetLifecycleReads(org)` after a design save |
| HR / IT & admin's Actions › Onboarding (cards, everyone, tile counts) | built per request from `boardData(org)` (`lc-board-data`, existing; its journey projection gains `teamTasks`, `templateId` already in) | patched per journey by every write (`patchBoardData`), as the board is |
| `/lifecycle/me` staff tile | same `boardData` | same |
| Joiner home, team person page, staff person page | read live (one journey, its tasks: a few KB), templates from `lc-templates` | — |

No new cache. The lifecycle jobs (`runLifecycleJobs`) already call `forgetLifecycleReads(null)`.

---

## 6. Old endpoints and screens these designs replace

Server endpoints stay until the app release with lanes J/T/H is the oldest one in use (old builds call them);
the screen lanes remove every screen/entry below now. Marked `@deprecated final-designs` in the routes.

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
| PUT `/lifecycle/manager/joiners/:id/probation/:month` | monthly review / check-in (PB2) | **kept only for `goals` (goal text)**; check-in/review parts replaced by goal comments + check-in read |
| team rows `mgr_plan_week`, `mgr_buddy_check`, `mgr_week_chat`, `mgr_mid_feedback`, `mgr_write_review`, `mgr_recommend`, `buddy_meet`, `buddy_policies`, `buddy_tools`, `buddy_intros`, `buddy_leave_ot`, `buddy_week1` (old wording), `buddy_month1` (old), `hod_meet`, `mgr_share_news` | Teams › Joiners rows (20 Nov) | the §3 keys (migration switches the old ones off) |
| Dashboard template editor (task table, Recommended panel, settings form) for onboarding | Setup › Employee lifecycle › Onboarding templates (old editor) | design editor on `/templates/:id/design` (offboarding keeps the old editor) |

Kept exactly: `/lifecycle/me`, `/lifecycle/portal-session` and the portal (Quick Actions opens the portal
inside the app before app access exists), `/lifecycle/onboarding/tour/:lesson`, `/onboarding/meeting-rows/*`,
`/onboarding/letters/:id/pdf`, `/lifecycle/team/joiners/:id/approval` (body gains `extend`), the board.

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
3. `sign_letters` gets `design` (Day-1 Sign task) and `settings.signLettersOnDay1 = true`.

Nothing is deleted. Running journeys keep their journey tasks and snapshot; their new views read meetings,
check-ins, watch list and team rows from the migrated template, and their tasks from their own journey tasks
(older tasks show by kind: an `ack` row as Read and acknowledge, `sign` as Sign, others as More tasks;
old meetings and surveys are not listed). Ticks under old team keys stay on the journey (history).
The dry run prints, per template: rows added, rows switched off, custom rows kept.

---

## 8. Checks

`npm run lifecycle:final-designs-check` (`src/scripts/lifecycle-final-designs-check.ts`, own scratch DB via
`LIFECYCLE_CHECK_MONGODB_URI`): design GET/PUT round trip and validation, seed = canvas order, rules per
stage, joiner view per step (Day 1 … Confirmed), task actions, check-in send/read, goals status/comment,
watch, team page for manager/buddy/head of department (Meera both), staff cards/tile/person/profile/tasks,
access ready → joiner device ready, the migration dry run and apply on a legacy template, a legacy journey
still reading, cache drop after a design save. The existing `lifecycle:check`, `lifecycle:team-check`,
`lifecycle:meetings-check` keep passing (they seed the legacy template explicitly).

## 9. Gaps (the canvas has no source; nothing is invented)

- Goal text: no screen in the canvas writes it. Kept: the manager's existing `PUT …/probation/:month {goals}`.
- ID card "Blood group", T-shirt size, desk, laptop asset number, Wi-Fi network: no field anywhere. Shown only
  when a value exists (none today); the kit/access screens list what is set.
- Buddy "groups and channels" (team groups with member counts): no Connect groups API; the screen is a tick.
- "Send a game", "Make an announcement", "Introduce to the team" reach-out blocks open existing app screens;
  no server change.
- Confirmation letter "Send to Dev" from the app: letters are made and sent on the dashboard (PDF made in the
  browser, CONTRACT decision 11); the app shows the facts and the letter's state.
- Fill-in forms: the canvas's add picker does not offer "Fill in a form" (d2 describes it); the server
  supports `type: 'form'` so D can add the entry if asked.
