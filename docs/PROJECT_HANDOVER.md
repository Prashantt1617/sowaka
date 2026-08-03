# Sowaka HRMS — Developer Handover

> Repository state reviewed: 3 August 2026 (`main`, commit `67a1a06`). This document describes the code as it exists now. Re-check it whenever the data model, routes, deployment, or workflows change.

## 1. What this repository is

Sowaka is a monorepo containing three applications:

| Application | Technology | Purpose |
|---|---|---|
| `backend/` | Node.js 20+, Express 4, TypeScript, MongoDB | Shared API, business rules, persistence, schedulers and external integrations |
| `hr-admin-web/` | React 19, Vite 6, TypeScript | HR dashboard for org-wide visibility, employee setup, settings, games and administrative overrides |
| `mobile-app/` | Flutter/Dart | Employee and manager experience: Connect, approvals, feedback, recognition, attendance and claims |

Both clients call the same JSON HTTP API. MongoDB is the operational source of truth. ESSL SQL Server is an inbound attendance source; S3 stores private receipts and optional Connect media; Firebase Cloud Messaging sends push notifications; Zoho SMTP delivers login OTPs. There is no direct web/mobile-to-database access.

## 2. Repository map

```text
sowaka/
├── backend/
│   └── src/
│       ├── config/       environment and MongoDB/index initialization
│       ├── controllers/  HTTP request/response adaptation
│       ├── middleware/   auth, access, uploads, errors, request IDs
│       ├── models/       TypeScript document contracts (not an ORM)
│       ├── routes/       endpoint registration
│       ├── scripts/      seed and ESSL attendance import utilities
│       ├── services/     business rules and integrations
│       └── server.ts     process startup, schedulers and shutdown
├── hr-admin-web/
│   └── src/
│       ├── dashboard/    dashboard shell, store, adapters, views and drawers
│       └── services/     bearer-auth HTTP client and typed API calls
├── mobile-app/
│   └── lib/
│       ├── features/     auth, Connect, manager/manage/grow, notifications, profile
│       ├── routes/       named routes
│       └── services/     API configuration and FCM/local notifications
└── docs/                 operational and product documentation
```

The root npm workspaces include only `backend` and `hr-admin-web`. Flutter commands must run inside `mobile-app`.

## 3. Local setup

### Prerequisites

- Node.js 20 or newer and npm 10 or newer.
- Flutter compatible with Dart `^3.10.4` (the repository was configured with Flutter 3+).
- A reachable MongoDB database.
- For real OTPs: a Zoho SMTP mailbox/app password.
- For push: a Firebase project and client platform configuration.
- For receipt/video uploads: an S3 bucket and suitable IAM permissions.
- For ESSL attendance import only: network access and credentials for the SQL Server instance.

### Install and run

```bash
npm install
cp backend/.env.example backend/.env
cp hr-admin-web/.env.example hr-admin-web/.env
npm run backend:dev
npm run web:dev

cd mobile-app
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:4000
```

Android emulators reach a host backend through `http://10.0.2.2:4000`; iOS simulator and Flutter web normally use `http://localhost:4000`. Both current clients default to the hosted CloudFront API, so always pass `API_BASE_URL` for local Flutter development and set `VITE_API_BASE_URL=http://localhost:4000` for local web development.

Health check: `GET /health`.

### Build and quality commands

```bash
npm run backend:build
npm run web:build
npm run lint

cd mobile-app
flutter analyze
flutter test
```

There is currently no substantive automated backend/web test suite in the repository. Treat successful builds, lint/analyze, and manual workflow smoke tests as the existing release gate until tests are added.

Current validation at handover: the backend TypeScript build passes. The web production build is currently blocked because `dashboard/icons.tsx` and `dashboard/theme.ts` do not include the newer `settings` member required by `Record<View, ...>`. This is an existing code issue, not a documentation issue, and should be the first small compile fix. Flutter analysis could not be completed in the restricted handover environment because Flutter attempted to update its global SDK cache; rerun it in a normal developer shell.

## 4. Configuration and secrets

Use `backend/.env.example` as the authoritative variable list. Important groups are:

| Group | Variables | Effect when absent |
|---|---|---|
| API | `NODE_ENV`, `PORT`, `CORS_ORIGIN`, `MOBILE_APP_API_BASE_URL` | Port defaults to 4000; known local/hosted origins are always added |
| MongoDB | `MONGODB_URI`, `MONGODB_DB` | Backend refuses to start without URI |
| Auth | `OTP_TTL_MINUTES`, `OTP_DEV_BYPASS`, `AUTH_SESSION_TTL_DAYS` | Normal OTP/session defaults apply; never enable bypass in production |
| Email | `ZOHO_SMTP_*` | OTP delivery cannot work as a real user flow |
| Firebase | `FIREBASE_SERVICE_ACCOUNT_JSON`, `ENABLE_NOTIFICATION_TEST_ENDPOINT` | In-app inbox can persist, but FCM delivery is unavailable |
| S3 | `AWS_*`, receipt/connect prefixes and encryption variables | Receipts fail; Connect photos may fall back to MongoDB; videos require S3 |
| Attendance import | `ATTENDANCE_SQL_*`, column/table mappings, timezone and batch size | Normal API still runs; import script cannot run |

Security notes:

- Never commit `.env`, Firebase service-account JSON, SMTP credentials, AWS keys, database URIs or FCM tokens.
- `backend/src/firebase-service-account.json` exists in the tree and must be audited immediately. If it contains a real key, rotate/revoke the key, remove it from Git history, and use `FIREBASE_SERVICE_ACCOUNT_JSON` at runtime.
- `POST /notifications/test` is deliberately unauthenticated when enabled. Keep `ENABLE_NOTIFICATION_TEST_ENDPOINT=false` except during a short diagnostic.
- Prefer IAM roles over long-lived AWS keys and private S3 buckets with short-lived presigned downloads.
- Web bearer data is stored client-side by `services/auth.ts`; mobile persists its session using `shared_preferences`. Review secure storage requirements before production hardening.

## 5. Backend architecture

### Request lifecycle

1. `request-context.middleware` creates a request ID.
2. Helmet, CORS, JSON parsing and Morgan logging run.
3. A route controller validates/adapts request values and calls a service.
4. Protected routes use `requireAuth`, which hashes the bearer token, looks up an unexpired session, and rejects offboarded/terminated users.
5. Dashboard routes additionally use `requireDashboardAccess`.
6. Services enforce org, manager, ownership, status and self-approval rules and access MongoDB collections directly.
7. `notFoundHandler` and `errorHandler` produce the final error response with request context.

On startup, `server.ts` connects to MongoDB, creates indexes, starts Connect and notification schedulers, then listens. SIGINT/SIGTERM stop schedulers, close the HTTP server and close MongoDB.

### Identity, roles and authorization

- `User.userId` is the stable identity and foreign key used throughout the system. MongoDB `_id` must not be used as a cross-module identity.
- Email must already exist in `users`; login never self-registers an unknown employee.
- A user's `role` is derived at login/`/auth/me`: anyone with at least one direct report (`managerUserId == their userId`) becomes `manager`; otherwise `employee`.
- `dashboardAccess` is independent of role and gates `/admin/**` operations.
- `isLeadership` identifies users with no manager who do not raise approval-gated requests.
- Data is scoped by `org`. Dashboard services return only the signed-in dashboard user's org.
- Manager inboxes are based on the request's/employee's `managerUserId`, not merely on a client-supplied role.
- Reporting assignment rejects self-management, cycles, inactive users, missing users and cross-org assignments.
- Dashboard users cannot override their own requests; this is enforced server-side and mirrored in web UI.

### MongoDB collections

| Collection | Main responsibility / notable keys |
|---|---|
| `users` | employee master; unique `email`, `userId`, sparse `employeeId`; manager/org/department indexes |
| `companies` | org name, week-off weekday numbers, overtime-disabled departments; unique `id` |
| `otp_challenges` | one challenge per email, hash/expiry/attempt count |
| `auth_sessions` | hashed bearer token; TTL index on `expiresAt` |
| `leaves` | employee leave applications and manager/admin decision audit fields |
| `overtime_requests` | manager-bound half/full-day requests and decisions |
| `reimbursement_claims` | claims, private receipt metadata and HR decision/payment state |
| `feedback_records` | one manager/employee/period record, saved or sent, scored parameters |
| `recognition_nominations` | one manager/category/period nomination |
| `holidays` | unique org/state/date holidays |
| `connect_posts` | org/audience-scoped feed, reactions, comments, actions and poll votes |
| `connect_media` | MongoDB fallback bytes for Connect photos when S3 is unavailable |
| `games` / `game_scores` | hosted-game definitions and each user's best score |
| `device_tokens` / `notifications` | FCM registrations and persistent per-user inbox |
| `notification_batches` | pending batched reaction/poll notification work |
| `attendance_records` | ESSL/manual punches, idempotent `sourceKey` |
| `attendance_regularizations` | employee correction request and manager decision |
| `attendance_import_state` | persisted ESSL source-ID watermark |

Indexes are created in `backend/src/config/db.ts`. Any new query pattern or uniqueness rule should be added there and reviewed for production migration impact.

### API map

All protected endpoints expect `Authorization: Bearer <token>`.

| Prefix | Endpoints | Consumer / purpose |
|---|---|---|
| `/auth` | `POST request-otp`, `POST verify-otp`, `GET me`, `POST logout` | Both clients; six-digit email OTP and session lifecycle |
| `/leaves` | `POST /`, `GET mine`, `GET balance`, `GET inbox`, `PATCH :id/decision` | Mobile employee submission/history and manager approval |
| `/overtime` | `POST /`, `GET mine`, `GET inbox`, `PATCH :id/decision` | Mobile employee submission and manager approval |
| `/reimbursements` | `POST /`, `GET mine`, `GET inbox`, `GET :id/receipt-url` | Mobile claims; multipart receipt is optional at transport level; decisions are HR-only |
| `/attendance` | `GET mine?from&to`, `POST regularizations`, `GET regularizations/inbox`, `PATCH regularizations/:id/decision` | Mobile attendance calendar and manager correction approvals |
| `/manager` | `GET workspace`, `PUT feedback/:employeeUserId`, `PUT recognition/:category` | Mobile Manage/Grow workspace |
| `/connect` | feed; game read/score; post create/edit/delete, reaction, comment and action | Mobile social feed and hosted games |
| `/holidays` | list; dashboard-only create/upload/delete | Mobile visibility plus HR maintenance; bulk upload accepts CSV |
| `/notifications` | device register/remove, inbox, mark read; optional test push | Mobile FCM and inbox |
| `/admin` | org-wide leaves/overtime/reimbursements/feedback/employees/games/settings and decisions | HR web, guarded by `dashboardAccess` |
| `/admin/reporting` | get/set/remove employee manager; manager direct reports | Dashboard-capable callers; currently not fully surfaced in web UI |

Consult `backend/src/routes/*.routes.ts` and controller/service code for request fields and exact response shapes; there is no generated OpenAPI contract yet.

## 6. End-to-end business flows

### Authentication

1. HR first creates an eligible user (seed or `POST /admin/employees`).
2. Client posts email to `/auth/request-otp`.
3. Backend validates the registered active employee, stores a hashed challenge, and sends the OTP through Zoho SMTP.
4. Client posts email + six-digit code to `/auth/verify-otp`.
5. Backend allows at most five failed attempts, removes the challenge on success, recalculates role, stores a SHA-256 hash of a random 32-byte session token, and returns the raw token once.
6. Clients persist the token and use it for every protected request. Logout deletes the server session; MongoDB TTL removes expired sessions.

Development bypass code `123456` works only when `OTP_DEV_BYPASS=true`.

### Employee creation and reporting

HR creates an employee from the web Employees view. The backend creates the user in the dashboard user's org, validates optional manager assignment, and generates a new-joiner Connect post. Manager assignment is a `User.managerUserId` edge. The reporting API supports later changes, but the current web UI primarily resolves a manager by the selected employee name during creation; a complete reporting-management UI remains to be built.

### Leave

The mobile user submits type, inclusive start/end dates and reason. The backend calculates working days using company week-offs and org/state holidays, checks balance/overlap and binds the request to the authenticated employee. The employee sees `/mine` and balance; their current manager sees `/inbox`. A manager decision validates the live reporting relationship. HR can see all org requests and override via `/admin/leaves/:id/decision`, with audit role/note and self-override protection. Submission, decision and pending reminders feed notifications.

### Overtime

The mobile user requests a half or full day, project and note. Eligibility depends on manager/leadership state, work date, company week-off configuration and department-level overtime enablement. Manager inbox/decision uses the reporting relationship. HR has org-wide visibility and override. Company controls live under the web Settings screen.

### Reimbursement

The mobile user submits expense date, amount, category, optional note and optional receipt. Receipt middleware uploads to a private S3 prefix; downloads use short-lived presigned URLs. The claim records the submitter's manager, but the code explicitly reserves final decisions for HR dashboard `/admin/reimbursements/:id/decision`; there is no manager decision route. If claim creation fails after upload, service logic should keep storage cleanup behavior under review. Status supports `pending`, `approved`, `declined`, and `paid`.

### Attendance and regularization

`attendance:import` reads ESSL punches from SQL Server in source-ID order, converts using the configured timezone/column mapping, upserts idempotently by `sourceKey`, and advances `attendance_import_state`. It is a command, not an always-on worker. The mobile app requests a date range and can raise a full/first/second-half correction. The employee's manager receives and decides corrections. `attendance:seed` creates deterministic weekday sample data while preserving imported/manual rows.

### Feedback and recognition

`GET /manager/workspace` assembles the current period, direct reports, feedback status/parameters, nominations, request inboxes and relevant settings. Managers save feedback as draft (`saved`) or send it (`sent`); one record exists per manager/employee/period. Sending triggers feedback notification. Recognition supports categories `artist`, `mentor`, `culture`, and `rising`, one nomination per manager/category/period. The HR web reads feedback org-wide; its “send reminder” interaction is client-only today and does not send email/push or persist.

### Connect feed and lifecycle posts

The feed is scoped to the viewer's org and audience department. Authorized users can create media/text variants, edit/delete their permitted posts, react, comment, vote or perform post-specific actions. Comments notify immediately; likes and poll activity are batched. The Connect scheduler runs lifecycle generation at 07:00 Asia/Kolkata, creating idempotent birthday/anniversary content; employee creation can generate new-joiner content. Photos can fall back to MongoDB; video requires S3.

### Hosted games

HR defines hosted HTTPS games, edits them, and publishes an active game into Connect. Mobile opens the URL in an authenticated app WebView, but does not pass the bearer token into the hosted page. The injected `window.Sowaka.submitScore(score)` bridge accepts a finite non-negative score and calls the protected score API. Only each employee's best score is retained; leaderboard ordering uses score then achieved time. See `docs/hosted-games.md`.

### Notifications

Mobile initializes Firebase, requests permissions, registers/refreshed device tokens with `/notifications/devices`, displays local notifications, and provides a persistent inbox/read state. Backend stores inbox rows even when push cannot be delivered, sends immediate workflow notifications, queues batched social activity, removes invalid FCM tokens, and runs scheduled jobs. Current scheduler behavior includes hourly batch flushing, 09:00 IST lifecycle/pending-leave work, and 18:00 IST daily digests where source data exists. Deep-link destinations and known missing producers are documented in `docs/notifications.md`.

## 7. HR admin web details

- `AuthProvider` restores the stored session/user, and `Gate` requires `dashboardAccess` before creating the dashboard store.
- `services/http.ts` centralizes base URL, bearer header, JSON parsing and `ApiError` behavior.
- `services/hrms.ts` contains typed backend DTO calls. `dashboard/adapters.ts` converts DTOs into display-oriented records.
- `dashboard/store.tsx` owns most state, initial parallel loading, filtering, drawers, decisions, employee creation and toast behavior. This is a large central store and the likely refactor boundary as the dashboard grows.
- Implemented views: Overview, Leave requests, Overtime, Feedback, Reimbursements, Employees, Games and Settings.
- Navigation entries Attendance, Onboarding, Exit, Payroll and Org chart currently fall through to `Placeholder`; they are not implemented modules.
- Settings controls company week-offs and disabled overtime departments, plus holiday management where wired.
- The web app is a client-rendered single page without a server-side routing layer.

## 8. Mobile app details

- `AuthGate` restores a cached session, validates it with `/auth/me`, clears it only on 401/403, and permits offline reuse of cached identity on network errors.
- `HomeScreen` currently always enters `ManagerScreen`; `ManagerBloc` uses the session role to choose whether Manage is available. Employees default to Grow-oriented access, while managers get team/approval surfaces.
- State management is custom stream/BLoC-like classes, not the external `bloc` package. Dispose controllers/timers whenever adding screens.
- `ManagerApiService.fetchDashboard()` aggregates workspace, leave/overtime/reimbursement histories and inboxes, settings, attendance and balance into the mobile dashboard model.
- Manager leave inbox polling runs while the manager BLoC is active; avoid adding overlapping polling without lifecycle controls.
- Connect has its own BLoC/API/model layer and supports multipart media.
- Notifications are initialized before `runApp`; Firebase client values can come from platform files or Dart defines (`FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_PROJECT_ID`).
- Profile, Quick Actions, Manage, Grow, Connect and notifications are presentation modules inside the manager shell. Some UI affordances explicitly say “Coming soon”; verify API wiring before treating any visible control as implemented.

## 9. Deployment topology

The checked-in examples point both clients at a backend CloudFront hostname, while the web itself also has a CloudFront origin in CORS. The repository does not contain a complete deployment pipeline or infrastructure-as-code. Before taking over production, obtain and document outside this repository:

- Cloud provider account/region, DNS and TLS ownership.
- What sits behind each CloudFront distribution (API gateway/load balancer/origin and static bucket).
- Backend runtime/service definition, environment-secret source, scaling and health-check settings.
- MongoDB cluster/project, backups, retention, indexes and IP/network access.
- S3 bucket policy/CORS/lifecycle/encryption and IAM role.
- Firebase project, Android/iOS app IDs, APNs key and service account.
- Zoho mailbox/app password ownership and sending limits.
- ESSL SQL Server network route, service account and import schedule/owner.
- Android/iOS signing keys, bundle IDs, store accounts and release process.
- Observability, alerting, log retention, incident contacts and rollback process.

Avoid treating CloudFront hostnames in source as proof of the underlying deployment architecture.

## 10. Seeding and operations

```bash
cd backend
npm run seed:sysjini
npm run attendance:seed -- SYS-001 2026-07-01 2026-07-31
npm run attendance:import
```

Read each script before running it against shared data. The Sysjini seed creates users/reporting/sample domain state and is the present setup mechanism for some permissions/relationships. Attendance import is incremental by persisted numeric source watermark; recovery variables can override the starting ID/date. Back up data and record any manual override used for backfills.

## 11. Known gaps and technical risks

1. No OpenAPI schema, contract generation, migrations framework, CI workflow or meaningful automated backend/web coverage.
2. Several HR navigation destinations are placeholders; feedback reminder UI is simulated only.
3. Notification destinations are reserved for domain workflows that do not yet exist (campaign schedules, survey closing, feedback sessions/read receipts, attendance reports).
4. Attendance import must be externally scheduled; it is not started by the API process.
5. Production infrastructure, secrets ownership and release procedure are not represented in the repository.
6. A Firebase service-account-named JSON file is under `backend/src`; perform credential/history audit immediately.
7. Session tokens are persisted in browser/local preferences rather than an HttpOnly web cookie or mobile secure keystore.
8. The web store and mobile manager presentation/state files are large and tightly coupled, increasing regression risk.
9. Client and backend types are manually duplicated; schema drift is possible.
10. Error monitoring, metrics, rate limiting, audit-log retention and formal data privacy/retention controls are not evident.
11. OTP request rate limiting is not visibly enforced beyond per-challenge verification attempts; add IP/email throttling before broad exposure.
12. CORS has compiled-in hosted origins in addition to environment origins; revisit for environment isolation.

## 12. Recommended takeover sequence

1. Run builds/analyzers and manually smoke-test auth, each request flow, employee creation, Connect, a hosted game and notifications against a disposable database.
2. Inventory/rotate secrets, remove credential artifacts, disable OTP/test bypasses and document account owners.
3. Capture production topology and establish backup/restore plus rollback drills.
4. Add API integration tests for auth/authorization, org isolation, self-approval, reporting cycles, balance/overlap, upload cleanup and idempotency.
5. Add OpenAPI or a shared schema, then generate/validate TypeScript and Dart client contracts.
6. Add CI for backend build/lint/tests, web build/lint/tests and Flutter analyze/tests.
7. Prioritize placeholder modules explicitly in the product backlog; do not silently imply they are live.
8. Move browser/mobile credentials to an approved secure-session design and introduce rate limiting/audit logging.

## 13. Definition of done for future changes

- Business rules live in backend services and are enforced independent of UI.
- Every query/action is scoped by authenticated identity and org; manager actions validate the current reporting edge.
- New collections/query patterns include indexes and a rollout/backfill plan.
- API change updates both clients, docs, error handling and compatibility plan.
- External side effects are idempotent or retry-safe and observable.
- Upload failure paths clean up orphaned objects.
- New notification producers use an existing documented destination or extend the data/deep-link contract.
- Builds, lint/analyze and relevant tests pass; manual release notes identify configuration changes.

## 14. Reference files

- Root commands/setup: `README.md`, `package.json`
- Backend config/schema/routes: `backend/src/config/{env,db}.ts`, `backend/src/models/`, `backend/src/routes/`
- Backend rules: `backend/src/services/`
- Web API/state: `hr-admin-web/src/services/`, `hr-admin-web/src/dashboard/store.tsx`
- Mobile API/state: `mobile-app/lib/features/*/data/`, `mobile-app/lib/features/*/bloc/`
- Notifications: `docs/notifications.md`
- Hosted game bridge: `docs/hosted-games.md`
- Product and architecture flows: `docs/PRD_ARCHITECTURE_FLOW.md`
