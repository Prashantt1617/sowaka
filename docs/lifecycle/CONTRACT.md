# Employee lifecycle — build contract

Branch `employee-lifecycle` (from main 7d19bd5c). Every part of the build follows this file and
`backend/src/models/lifecycle.model.ts` (the shapes) and `backend/src/config/db.ts` (the collections).
The design specs (read the ones your part needs, in full):

| Spec | What it is |
|---|---|
| `SPECS/canvas-6Zs.md` | **The dev handover. Authoritative.** Data model, jobs, notifications, permissions, task seeds (T1, T2), every screen P/W/A/M/R/H/S/O |
| `SPECS/canvas-3Rb.md` | Pre-boarding portal + app onboarding + HR onboarding, with the v3 portal dev spec and the older probation screens (v2/v1) |
| `SPECS/canvas-BeN.md` | HR dashboard lifecycle (onboarding + offboarding boards, start an exit, settlement, insights, templates, documents) |
| `SPECS/canvas-Y1R.md` | App offboarding (resign, resignation tab, off-boarding page, handover, exit interview, manager card) |
| `SPECS/doc-4gB.md` | Onboarding v2 screen plan on the Sowaka design system (portal P1–P9, app A1–A12, M1–M6, HR H1–H7) |

`SPECS` = `/private/tmp/claude-501/-Users-kritik-sowaka/58eab287-5a56-46ff-961a-427d5ab396c1/scratchpad/lifecycle/specs`.
Where specs disagree, 6Zs wins, then the decisions below.

## Decisions (open questions settled for this build)

1. **Sign-in.** Portal: the personal email + a password HR's finalise generates and emails (scrypt hash, 5 wrong tries → 15 min lock, forgot-password link by email). App: the existing work email + one-time code. Fix every "same email and password" copy (P16) to "Sign in to the app with your work email — we'll send a code".
2. **Candidates are not users.** No `users` row exists until HR's **Mark joined** (on/after Tj), which calls `createEmployeeForAdmin` with the work email, Tj as joiningDate, designation/department/location/manager/employeeType from the accepted offer, and sets `journey.userId`. So candidates never show in the directory, headcount, payroll or account limit before they join. The candidate's personal email is copied to `user.personalEmail` (new optional field) for the settlement email later.
3. **Switch.** Everything new sits behind `companies.features.lifecycle` (server refuses the routes with 404 `{error:'Not available'}` when off; dashboard hides the group; app hides tiles). Where it is on, the Offboarding board replaces People › Exits in the sidebar; where it is off, the current Exits page stays. Locally switch it on for the scratch `sowaka` org only. Never on production.
4. **Due dates (template values win at runtime).** Seed: intro post Tj + 3; week-1 reels Tj + 5; Day-7 survey opens Tj + 6, due Tj + 7; goals lock Tj + 7; documents Tj − 5; letters Tj − 2 (nudge daily from Tj − 3); Day-1 pass opens Tj − 7; handover upload Tl − 7; exit interview opens Tl − 5; finance Tl − 2; settlement Tl + 2 working days; gratuity Tl + 30. Working days use the company's holidays and week-offs (the existing holiday service / shift week-offs; fall back to Sat–Sun off when the company has none).
5. **Probation** is built (it is module 6): monthly goals (manager, month start), check-in (both, month end), review (manager); pulse survey M3/M6 (same 4 questions); final-month decision in the dashboard (confirm / extend / not confirm, salary, KPI template, designation, reporting); confirmation/extension letter from Documents; the reveal in the app. Plant: seed (pre-boarding, water 0–3) → sprout Tj → seedling Tj + 7 → sapling end of month 1 → bud at the start of the final month → bloom on confirm. Restyle the v2 probation screens with the Kit.
6. **Bottom nav**: build with the live app's labels and tabs (Home / Team / Action / Games), not the canvas labels.
7. **Privacy copy** on resignation: "Only your manager and HR can see this." Managers never see pay. The final settlement is emailed as a PDF, never shown in the app. "On notice" never shows on My Team.
8. **Web portal**: responsive. Screens drawn only for mobile (About you, Meet us, closed and branch screens) render the mobile layout centred at max 430 px on desktop.
9. **Face data at exit**: seed "Delete face data" as a Recommended offboarding task (off by default).
10. **Screens not drawn** (finalise offer, send a document back, mark joined, not joining, decline/reopen, date-change approval, confirmation decision, manager's set-up of people-to-meet/buddy/goals): build them as dialogs / sheets in the existing style of the surface, using the fields in 6Zs §10.
11. **Letters → PDF.** The dashboard renders the letter HTML (merge fields filled) and makes the PDF in the browser with the html2pdf already used for settlements (`hr-admin-web/src/dashboard/settlementDoc.ts`, `pdf.ts`), then uploads it. The server never renders HTML to PDF. Signing: the server stamps the signature onto the stored PDF with `pdf-lib` (add it to backend) and stores the signed PDF.
12. **Files**: `lifecycle_files` rows; bytes in S3 under `lifecycle/<org>/<journeyId>/…` when S3 is configured (`hasReceiptStorage()`), else under `backend/.local-uploads/` (gitignored) for development. Served through authorised endpoints only (never public URLs). PDF/JPG/PNG ≤ 10 MB for candidate uploads.
13. **Email**: through `email.service` (nodemailer). Candidates are not users, so add `sendLifecycleEmail(org, to, subject, html, attachments?)` that applies the same company gate as `isAllowedRecipient` does for the org (EMAIL_ORGS) but does not require a users row. Locally there is no SMTP: emails are logged, and the check scripts read them from an in-memory outbox (`lifecycleOutbox()` export for tests).
14. **Push / in-app notifications**: use the existing notification service (`notification.service.ts`) with new kinds prefixed `lifecycle_` (e.g. `lifecycle_starter_task`, `lifecycle_resignation`). Every timed job fires once (store `remindedAt` / a fired-key) in the company's time zone.
15. **Exits**: offboarding builds on the live exits (`user.exit`, `exit.service.ts`, `exitSettlement.service.ts`). HR accepting a resignation calls the existing `recordExit` (kind `resigned`, noticeFrom = submitted date, lastWorkingDay = agreed Tl) and creates the offboarding journey from the offboarding template. Clearance stays `user.exit.clearance` (gains `team: 'manager'|'admin'|'it'|'finance'`); the settlement stays `exitSettlement.service`. Do not change settlement maths.
16. **Demo data** only in scratch databases; fictional names; never touch convrse / acmt / toyota / cde / sowakahq data. Never use `backend/.env` MONGODB_URI locally.

## Service layout (backend/src/services/lifecycle/)

| File | Owner | Exports others call |
|---|---|---|
| `dueRules.ts` | BE-journey | `resolveRule(rule, anchors, ctx) → Date | null`, `addWorkingDays(org, date, n)` |
| `templates.ts` | BE-journey | `ensureDefaultTemplates(org)`, `defaultTemplate(org, kind)`, CRUD |
| `seed.ts` | BE-journey | `ONBOARDING_SEED`, `OFFBOARDING_SEED` (6Zs §2.1 / §2.2, every row, recommended ones off) |
| `engine.ts` | BE-journey | `createOnboardingJourney(org, byUserId, input) → Journey` (status draft, snapshot template, tasks materialised and locked/opened by rules), `setAnchor(journeyId, anchor, at)`, `moveTj(journeyId, tj)`, `moveTl(journeyId, tl)`, `completeTask(journeyId, systemKey, by?)`, `reopenTask(...)`, `onJoined(journeyId, userId)`, `closeJourney(journeyId, reason)`, `createOffboardingJourney(org, userId, tl, exitType, byUserId)`, `refreshJourney(journeyId)` (flags, plant, column, stage) |
| `board.ts` | BE-journey | onboarding board read model |
| `appOnboarding.ts` | BE-journey | app endpoints (joiner + manager) |
| `probation.ts` | BE-journey | months, check-ins, decision |
| `jobs.ts` | BE-journey | `runLifecycleJobs(now)` — called from `notification-scheduler.service.ts` every tick; idempotent |
| `offers.ts` | BE-offer | create/revise/send/finalise/decline/reopen/not-joining/mark-joined, date-change requests |
| `documents.ts`, `files.ts` | BE-offer | candidate documents, file storage/serving |
| `letters.ts` | BE-offer | letter templates (seed default offer/appointment/NDA/confirmation/extension/relieving), letters, merge values, missing-field check, email draft/send |
| `portalAuth.ts`, `portal.ts` | BE-offer | link tokens, candidate accounts, the portal read model |
| `emails.ts` | BE-offer | `sendLifecycleEmail`, `lifecycleOutbox` |
| `offboarding.ts`, `resignations.ts`, `insights.ts` | Offboarding | resign/withdraw/manager action/HR accept, offboarding board, handover, exit interview from the app, insights, settlement email |

BE-offer calls only the engine exports above (never writes `lifecycle_journey_tasks` directly). The engine owns task state; `completeTask` is how anyone marks a product-driven task done.

## Auth

- **Dashboard** (`/admin/lifecycle/*`): mounted under the existing `/admin` stack (requireAuth + dashboard access + tab gate). Tab keys (`backend/src/models/dashboard-tabs.ts` and the dashboard's list): `onboarding`, `offboarding`, `exit_insights`, `lifecycle_documents`, `lifecycle_templates`. IT / Admin / Finance staff = people given only the `offboarding` (and/or `onboarding`) tab: their clearance items and device requests show; pay figures are hidden unless they also hold a payroll tab.
- **App** (`/lifecycle/*`): `requireAuth` (existing employee session). Manager endpoints check `managerUserId === me`.
- **Portal** (`/portal/*`): no employee session.
  - Offer link: `GET /portal/offer/:token` — the raw token from the email; the server matches `sha256(token)` against the current or older versions (older → `replaced`).
  - Candidate session: `POST /portal/auth/sign-in {email, password}` → `{ token }`, a JWT signed with the app's JWT secret, `aud: 'portal'`, `sub: journeyId`, 12 h. Sent as `Authorization: Bearer`. An app token must never pass as a portal token or the reverse.
  - Rate-limit sign-in and the offer link per IP.

## Endpoints

JSON in and out. Errors are `{ error: string }` with 400/401/403/404/409. Dates are `YYYY-MM-DD`; instants are ISO. `TaskView` = `{ id, systemKey?, phase, title, helper?, ownerRole, ownerName?, kind, surface, mustDo, status, opensAt?, dueAt?, dueLabel?, doneAt?, doneByName?, note?, late: boolean, month? }`.

### Dashboard — onboarding (BE-journey)

| Method + path | Body / query | Returns |
|---|---|---|
| GET `/admin/lifecycle/settings` | — | `{ enabled: boolean, tabs: string[] }` (dashboard uses this to show the group) |
| GET `/admin/lifecycle/templates?kind=` | | `{ templates: Array<LifecycleTemplate & { journeysUsing: number, recommendedNotAdded: number }> }` |
| POST `/admin/lifecycle/templates` | `{ kind, name, group?, copyFromId? }` | `{ template }` |
| GET/PUT/DELETE `/admin/lifecycle/templates/:id` | PUT: `{ name?, group?, active?, isDefault?, settings?, tasks? }` | `{ template }` (DELETE refuses the default or one in use) |
| GET `/admin/lifecycle/board?tab=pre_boarding|first_week|probation&q=&filter=&from=&to=` | filter: `needs_you|late|quiet|joining_risk|due_soon|mine` | `{ tab, columns: Array<{ key: OnboardingBoardColumn, label, cards: BoardCard[] }>, counts: Record<tab, number> }` where `BoardCard = { journeyId, name, designation?, department?, managerName?, photoUrl?, tj?, dayLabel, status, column, flags: JourneyFlag[], waitingOn: Array<{ ownerRole, ownerName?, title, dueAt? }>, progress: { done, total }, plant }` |
| GET `/admin/lifecycle/journeys/:id` | | `{ journey: JourneyView, tasks: TaskView[], documents, letters, offer: OfferView, dateRequests, probation: { months, decision? }, batch: Array<{ journeyId, name }> }` — the side panel. `JourneyView` = Journey minus templateSnapshot, plus `managerName`, `buddyName`, `dayLabel`, `flags`, `column`, `tab`. `documents`/`letters`/`offer` are filled by calling BE-offer's read functions (`journeyDocumentsView`, `journeyLettersView`, `offerView`). |
| POST `/admin/lifecycle/journeys/:id/tasks/:taskId` | `{ action: 'done'|'reopen'|'skip', note? }` | `{ task: TaskView }` (skip refused for must-do) |
| PUT `/admin/lifecycle/journeys/:id` | `{ managerUserId?, buddyUserId?, day1Pass?, templateId? (only before offer sent) }` | `{ journey }` |
| GET `/admin/lifecycle/journeys/:id/probation` | | `{ months: ProbationMonth[], decision? }` |
| POST `/admin/lifecycle/journeys/:id/decision` | `ConfirmationDecision` minus decidedAt/By/letterId | `{ decision }` (extend restarts a review cycle for extendMonths) |
| GET `/admin/lifecycle/surveys?kind=day7|m3|m6` | | `{ responses: Array<{ name, answers, createdAt }> }` (HR only) |

### Dashboard — offers, documents, letters (BE-offer)

| Method + path | Body | Returns |
|---|---|---|
| POST `/admin/lifecycle/offers` | `{ candidate: { name, personalEmail, phone? }, fields: OfferFields, templateId? }` | `{ journeyId, offer: OfferView }` (journey status draft) |
| PUT `/admin/lifecycle/offers/:journeyId` | `{ fields }` | `{ offer }` — draft: edits in place; after sending: creates the next version with `changedFields`, older ones `replaced`; if finalised, the journey returns to `accepted`→ HR finalises again; appointment letter regenerated after |
| POST `/admin/lifecycle/offers/:journeyId/pdf` | multipart `file` (PDF from the dashboard) | `{ offer }` (pdf for the current version) |
| POST `/admin/lifecycle/offers/:journeyId/send` | `{ subject, body, cc? }` | `{ offer }` — status offer_sent; email with PDF attachment + link `${PORTAL_BASE_URL}/o/<token>` |
| POST `/admin/lifecycle/offers/:journeyId/finalise` | — | `{ offer }` — only when accepted; creates the candidate account, emails login + password, status finalised, manager gets the set-up to-do |
| POST `/admin/lifecycle/offers/:journeyId/decline` · `/reopen` · `/not-joining` | `{ note? }` | `{ journey }` |
| POST `/admin/lifecycle/offers/:journeyId/mark-joined` | `{ workEmail, employeeId? }` | `{ journey, userId }` |
| POST `/admin/lifecycle/date-requests/:id` | `{ decision: 'approve'|'decline', note? }` | `{ request }` — approve revises the offer's Tj and moves every open due date |
| GET `/admin/lifecycle/journeys/:id/documents` | | `{ documents: CandidateDocumentView[] }` (`+ files: Array<{ id, name, contentType, size }>`) |
| POST `/admin/lifecycle/documents/:id/review` | `{ decision: 'approve'|'send_back', note? }` | `{ document }` (last approval → docs_approved, unlocks letters) |
| GET `/admin/lifecycle/files/:id` | | the bytes (auth checked, same org) |
| GET/POST/PUT `/admin/lifecycle/letter-templates[/:id]` | `{ kind, name, body, isDefault? }` | `{ templates }` / `{ template }` |
| GET `/admin/lifecycle/letters/merge?kind=&journeyId=&userId=` | | `{ values: Record<string,string>, missing: string[] }` — fields from the offer/journey/user/company |
| POST `/admin/lifecycle/letters` | `{ kind, journeyId?, userId?, templateId, values }` | `{ letter }` |
| POST `/admin/lifecycle/letters/:id/pdf` | multipart `file` | `{ letter }` |
| POST `/admin/lifecycle/letters/:id/send` | `{ to, cc?, subject, body, withPortalLink? }` | `{ letter }` |
| GET `/admin/lifecycle/letters?journeyId=&userId=&kind=` | | `{ letters }` |

### Portal (BE-offer)

| Method + path | Auth | Returns |
|---|---|---|
| GET `/portal/offer/:token` | link | `PortalOfferView = { state: 'offer'|'accepted'|'finalised'|'declined'|'expired'|'replaced'|'not_joining'|'closed', company: { name, logoUrl? }, candidateName, version, changedFields?, fields (no internal ids; manager by name), validTill, pdfUrl, hrContact: { name, email }, companyVideoUrl? }` |
| GET `/portal/offer/:token/pdf` | link | the PDF |
| POST `/portal/offer/:token/accept` | link | `PortalOfferView` (stores time, IP, user-agent; latest version only) |
| POST `/portal/auth/sign-in` | — | `{ token }` |
| POST `/portal/auth/forgot` `{ email }` · POST `/portal/auth/reset` `{ token, password }` | — | `{ ok: true }` (forgot never reveals whether the email exists) |
| GET `/portal/me` | portal | `PortalHome = { status, view: 'tasks_open'|'offer_updated'|'letter_ready'|'pass_unlocked'|'joined'|'closed', candidateName, company, tj, daysToGo, plant, path: Array<{ key: 'offer'|'docs'|'about'|'meet'|'letter'|'pass', label, state: 'done'|'current'|'todo'|'locked' }>, upNext?: { key, title, due? }, tasks: TaskView[], batch: { count, names: string[] }, workEmail?, hrContact, banner?: { kind: 'offer_updated', changedFields } }` |
| GET `/portal/documents` · POST `/portal/documents/:id/upload` (multipart `files`) · DELETE `/portal/documents/:id/files/:fileId` | portal | `{ documents }` |
| GET/PUT `/portal/about` | portal | `AboutYou` (editable until Tj − 1) |
| GET `/portal/meet` · POST `/portal/meet/seen` `{ itemId }` | portal | `{ items: Array<{ id, kind: 'manager_note'|'video'|'card', title, text?, videoUrl?, seen }> }` |
| GET `/portal/letters` · POST `/portal/letters/:id/opened` · POST `/portal/letters/:id/sign` `{ method, typedName?, imageDataUrl? }` · GET `/portal/letters/:id/pdf` | portal | `{ letters: Array<{ id, kind, state: 'locked'|'ready'|'opened'|'signed', pdfUrl }> }` |
| GET `/portal/pass` · GET `/portal/pass.ics` | portal | `Day1Pass` + manager/buddy names (locked before Tj − 7 → 403) |
| POST `/portal/date-request` | portal | `{ requestedTj, reason, note? }` → `{ request }` |
| POST `/portal/activity` | portal | `{ ok }` (updates lastActivityAt; also done implicitly on every portal call) |

`PORTAL_BASE_URL` env (default `http://localhost:5181`) builds the links in emails. CORS allows it.

### App — joiner and manager (BE-journey)

| Method + path | Returns |
|---|---|
| GET `/lifecycle/me` | `{ enabled, onboarding?: { journeyId, stage, dayLabel, plant, tileVisible }, offboarding?: { journeyId?, resignationId?, status, tl?, pageVisible } }` — drives the Action tiles and profile tabs |
| GET `/lifecycle/onboarding` | `{ journeyId, stage, dayLabel, tj, plant, upNext?: TaskView & { meeting? }, today: TaskView[], later: TaskView[], done: TaskView[], journey: Array<{ key: OnboardingStage, label, state: 'done'|'current'|'todo' }> }` |
| POST `/lifecycle/onboarding/tasks/:taskId` | `{ action: 'done'|'skip', note? }` → `{ task }` |
| GET/PUT `/lifecycle/onboarding/week1` | `Week1Reels` + `{ policies: Array<{ id, title, version, url? }>, bank: { masked, ifsc? }, pf: { uan? }, goals: string[] }`; PUT `{ step: 'policies'|'tax'|'bank_pf'|'goals', value }` saves one reel (bank/PF edit raises an HR-approval request; payroll keeps the old value) |
| GET/PUT `/lifecycle/onboarding/intro` · POST `/lifecycle/onboarding/intro/post` | `IntroPost`; post creates the Connect post (new-joiner style) and pushes the manager "say hi" |
| GET `/lifecycle/onboarding/people` · POST `/lifecycle/onboarding/people/:id` `{ action: 'met'|'not_yet' }` | `{ people: Array<{ id, userId, name, designation?, photoUrl?, why?, metAt? }> }` |
| GET `/lifecycle/onboarding/starter-tasks` · POST `/lifecycle/onboarding/starter-tasks/:id/done` `{ note? }` | `{ tasks: StarterTask[] }` |
| GET `/lifecycle/onboarding/notes` · POST `/lifecycle/onboarding/notes/:id` `{ action: 'seen'|'reply', text? }` | shared notes only |
| GET `/lifecycle/onboarding/meetings/:id` · POST `/lifecycle/onboarding/meetings/:id` `{ met: 'yes'|'moved', newTime? }` | `Meeting` |
| GET/POST `/lifecycle/onboarding/survey` | `{ kind, open, sent }` / POST `{ answers }` |
| GET `/lifecycle/onboarding/probation` · PUT `/lifecycle/onboarding/probation/:month/checkin` `{ text, rating? }` | months (goals read-only for the joiner) |
| GET `/lifecycle/onboarding/reveal` · POST `/lifecycle/onboarding/reveal/seen` | `{ outcome?, letterUrl? }` |
| GET `/lifecycle/manager/joiners` | `{ joiners: Array<{ journeyId, userId?, name, photoUrl?, designation?, dayLabel, stage, plant, todayCount, overdue: number, preboarding: boolean }> }` (onboarding or probation, reports only) |
| GET `/lifecycle/manager/joiners/:journeyId` | `{ joiner, tasks: TaskView[] (manager-visible), setup: { people, buddy?, welcomeNote?, goals }, starterTasks, notes, meetings, surveySummary?: { count, avg } (only 3+ team answers) }` |
| PUT `/lifecycle/manager/joiners/:journeyId/setup` | `{ people?: Array<{ userId, why? }>, buddyUserId?, welcomeNote?: { kind: 'text', text } , goals?: string[] }` (goals refused after lock) |
| POST `/lifecycle/manager/joiners/:journeyId/starter-tasks` | `{ title, links?, note?, dueAt? }` → push to the joiner |
| POST `/lifecycle/manager/starter-tasks/:id/reply` | `{ text }` |
| POST `/lifecycle/manager/joiners/:journeyId/notes` | `{ text, shared }` |
| POST `/lifecycle/manager/joiners/:journeyId/tasks/:taskId` | `{ action: 'done' }` (meet team, meet manager…) |
| PUT `/lifecycle/manager/joiners/:journeyId/probation/:month` | `{ goals?, checkin?: { text, rating? }, review?: { text } }` |

### Offboarding (Offboarding agent) — app and dashboard

| Method + path | Returns |
|---|---|
| GET `/lifecycle/resignation` | `{ resignation?: ResignationView, noticeDays, lastDayByNotice, canResign: boolean }` (`ResignationView` = Resignation + `tl?`, `daysLeft?`, `managerName`) |
| POST `/lifecycle/resignation` | `{ reason, note? }` → `{ resignation }` (no last-day picker) |
| POST `/lifecycle/resignation/withdraw` | until HR accepts |
| GET `/lifecycle/offboarding` | `{ tl, daysLeft, tasks: TaskView[], handover: HandoverItem[] + handoverNote?, interview: { opensAt, open, sent }, documents: Array<{ kind: 'payslip'|'form16', label, url }> }` (the R3 page; refused when the page is off for the exit type) |
| POST `/lifecycle/offboarding/handover/:id` | multipart `file` or `{ url }` → `{ item }`; DELETE removes the upload |
| POST `/lifecycle/offboarding/interview` | `{ reason, workingHere, manager, comeBack, change? }` — saves to `user.exit.interview` (HR only) and an anonymised `surveyResponses` row (kind exit) |
| GET `/lifecycle/manager/resignations` · POST `/lifecycle/manager/resignations/:id` | `{ action: 'accept'|'change_day'|'release_early', date?, note? }` |
| GET `/lifecycle/manager/leavers/:userId` · PUT `/lifecycle/manager/leavers/:userId/handover` | `{ items: string[], note? }` · POST `.../handover/done` |
| GET `/admin/lifecycle/offboarding/board?tab=resignations|notice|exit` | columns per 6Zs §7.3 (With manager · With HR · Accepted / Handover · Clearance · Exit interview · Last week / Last day today · Settlement due · Settlement sent · Closed), cards with flags and waiting-on |
| GET `/admin/lifecycle/offboarding/:userId` | the drawer: exit view (existing `exitDetail`) + resignation + journey tasks + handover + clearance by team |
| POST `/admin/lifecycle/resignations/:id/accept` | `{ lastWorkingDay, note? }` → records the exit + creates the offboarding journey |
| POST `/admin/lifecycle/offboarding/:userId/start` | Start an exit (O2): `{ exitType, lastWorkingDay, noticeHandling, templateId?, managerUserId?, hrNote?, tellManagerNow?, showAppPage? }` → maps onto `recordExit` + journey |
| POST `/admin/lifecycle/offboarding/:userId/settlement/email` | `{ pdfBase64, to }` → emails the settlement PDF to the personal email; status settlement_sent |
| GET `/admin/lifecycle/exit-insights?from=&to=&groupBy=department|tenure` | anonymised: counts per reason, averages, come-back split, themes; any group under 5 answers hidden; no quotes |

### App ↔ server, as reconciled (el/reconcile-app)

`npm run lifecycle:fixtures` (backend) writes every app endpoint's real answer to
`mobile-app/test/fixtures/lifecycle/*.json`; `test/lifecycle_server_fixtures_test.dart` runs the
app's HTTP clients and parsers on them. Regenerate both after changing a shape. Fields added beside
the ones above:

- `GET /lifecycle/manager/resignations` also lists **accepted** resignations whose exit is under way
  (with `tl` = the exit's last day); the app hides them from Requests but keeps the report's
  Resignation tab (the handover) from them.
- `GET /lifecycle/manager/leavers/:userId` (and the PUT/POST handover answers): top-level `tl`,
  `daysLeft`, `acceptedAt`; `resignation` is the whole `ResignationView`; `handover` gains
  `addedAt`, `dueAt`, `doneAt`; `otherSteps` (clearance by team, never an amount) carry
  `id, title, status, ownerRole, helper` beside `label, team, done`. `status` stays the exit object.
- `GET /lifecycle/offboarding`: `managerName`, `acceptedAt`, `noticeFrom`, `handoverDueAt`,
  `handoverAddedAt`, `handoverDone`, `handoverDoneAt`.
- `GET /lifecycle/onboarding/probation`: `totalMonths`, `currentMonth`, `managerName`.
  `GET /lifecycle/manager/joiners/:id`: `joiner.goalsLocked`. `POST …/starter-tasks/:id/done`: `task` beside `tasks`.
- App onboarding audit fixes (el/fix-app-onb): joiner `TaskView`s carry `readOnly` + `doneBy` (Day-1 items
  HR/IT/the manager do, counted in `progress`), `helper` is the app copy (`APP_COPY` in seed.ts, never the
  template's HR helper), and every meeting task carries `meetingId` + `meeting` (with `with`, `canConfirm`)
  on both the home and M2. M2 tasks carry `canMarkDone` (false for `hr_manager`, which
  `POST …/tasks/:taskId` refuses with 403) and manager wording; M2 adds `journey`, `joinerNextDue`,
  `welcomePost: { canPost, postedAt? }` and `surveySummaries: Array<{ kind, count, avg }>` (per kind, 3+
  distinct people; `surveySummary` = the first). New: `POST /lifecycle/manager/joiners/:journeyId/welcome
  { text }` (once per joiner). `/me` onboarding gains `subtitle`; home gains `weekDoneStats`; people gains
  `closed`, `managerName`, `role`; week1 policies gain `readMinutes`, `updatedOn`, `summary`, `body`;
  intro gains `message`, `likes`, `commentCount`, `comments`; reveal gains `kpis: { name, items }` and passes
  `letterUrl` through. Check-ins take `goalRatings`, `win`, `ask`; reviews take `feedback` (4 chips), `askAck`.
- Auth refusals of an ended account (`/auth/request-otp`, `/auth/verify-otp` 403; `/auth/me` and the
  auth check 401 "User is not active") carry `accountClosed: { company, lastWorkingDay, hrEmail }`,
  only when the person has an exit recorded and their company has `features.lifecycle` on.
- Offboarding pushes carry `data: { type: lifecycle_offboarding | lifecycle_resignation, destination, …ids }`
  (`OffboardingDestination`, services/lifecycle/offboarding.ts; the app's `offboarding_launcher.dart`):
  `lifecycle_resignation_request` (manager's Requests card; `resignationId`, `userId`) for a new or withdrawn
  resignation; `lifecycle_resignation` (own Resignation tab) when the manager passes it to HR
  (`lifecycle_resignation_with_hr`, new), HR accepts / starts the exit, or the last day moves;
  `lifecycle_handover` (R3b) when the checklist is shared; `lifecycle_exit_interview` (R5);
  `lifecycle_leaver` (manager's R8b; `userId`) for the checklist ask, uploads and a moved last day;
  `lifecycle_clearance` (dashboard only) for clearance and gratuity.
- The app reads `GET /lifecycle/manager/leavers` too, so HR-started exits get the manager's R8b; the
  leaver of an HR-started exit gets the R2b countdown (tab named "Exit"). `GET /lifecycle/offboarding`
  carries `exitType`; `GET /lifecycle/resignation`'s `reasons` fill R1.
- An exit (HR accepting a resignation, or HR starting one) closes any open onboarding journey of that
  person (`closeOnboardingForExit`; status kept, `closedReason` says why).
- The template's `accountCloses: 'tl_end_of_shift'` ends access on Tl once the person's shift ends
  (runOffboardingJobs; overnight shifts and the default `tl_plus_1` stay with closeDueExits at Tl + 1).

## Who builds what

| Part | Branch (off employee-lifecycle) | Owns |
|---|---|---|
| BE-journey | `el/be-journey` | `services/lifecycle/{dueRules,templates,seed,engine,board,appOnboarding,probation,jobs}.ts`, `routes/lifecycle-admin.routes.ts` (onboarding/templates/board/probation part), `routes/lifecycle-app.routes.ts` (onboarding + manager joiner part), mount in `routes/index.ts`, scheduler hook, `scripts/lifecycle-check.ts` (`npm run lifecycle:check`) |
| BE-offer | `el/be-offer` | `services/lifecycle/{offers,documents,files,letters,portalAuth,portal,emails}.ts`, `routes/lifecycle-offer.routes.ts` (admin offers/docs/letters) + `routes/portal.routes.ts`, `scripts/portal-check.ts` (`npm run portal:check`), `.gitignore` for `.local-uploads` |
| Portal web | `el/portal-web` | new `preboarding-web/` (Vite + React + TS, mobile-first, responsive) |
| Dashboard onboarding | `el/dash-onboarding` | `hr-admin-web/src/dashboard/views/lifecycle/` (board, side panel, probation tab, templates list + editor for both kinds, Documents/letters), `hr-admin-web/src/services/lifecycle.ts`, sidebar group + Setup card |
| App onboarding | `el/app-onboarding` | `mobile-app/lib/features/lifecycle/onboarding/` + manager joiner screens, the Action tile, profile Onboarding tab, Team tab New joiners |
| Offboarding (backend + dashboard) | `el/offboarding` | `services/lifecycle/{offboarding,resignations,insights}.ts`, `routes/lifecycle-offboarding.routes.ts`, exit.service extensions, `hr-admin-web/src/dashboard/views/lifecycle/offboarding/` (O1–O4), `scripts/offboarding-check.ts` |
| App offboarding | `el/app-offboarding` | `mobile-app/lib/features/lifecycle/offboarding/` (R0–R8b) |

Shared files you may touch with small, additive edits only (I merge): `routes/index.ts`, `notification-scheduler.service.ts`, `Chrome.tsx`/sidebar, app router/Action tab/profile tabs/Team tab, `package.json` scripts. Never edit `lifecycle.model.ts` or the `db.ts` lifecycle block without saying so in your report (add new optional fields there only if you must, and list them).

## Local running

- One mongod for everyone: `mongodb://127.0.0.1:27133`. Use your own database name (`el_<part>_scratch`, e.g. `el_journey_scratch`). Check scripts set `MONGODB_DB` to their own name.
- Ports: BE-journey API 4111, BE-offer API 4112, offboarding API 4116 + dashboard 5186, dashboard onboarding 5184, portal 5181. Kill what you start before you finish.
- node_modules: symlink `<worktree>/node_modules → /Users/kritik/sowaka/node_modules` and `<worktree>/hr-admin-web/node_modules → /Users/kritik/sowaka/hr-admin-web/node_modules`. Never delete those targets. New npm packages (pdf-lib, pdfjs-dist, the portal's deps): install inside your worktree's package only and say so; the portal gets its own `preboarding-web/node_modules`.
- Type checks: backend `npx tsc -p tsconfig.json --noEmit`; dashboard `npx tsc -b` (not `tsc -p .`, which checks nothing); app `flutter analyze` + `flutter test` for what you add.
- Commit on your branch with clear messages. Do not push, merge, or deploy anything.
