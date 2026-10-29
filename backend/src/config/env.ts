import dotenv from 'dotenv';

dotenv.config();

/**
 * Environments a developer convenience may be switched on in. Anything else —
 * production, staging, a name nobody anticipated, or NODE_ENV left unset — is
 * treated as somewhere real people sign in.
 */
const DEV_ENVIRONMENTS = new Set(['development', 'test']);

// Origins always allowed, regardless of the CORS_ORIGIN env var. Extra origins
// can be supplied via CORS_ORIGIN (comma-separated) and are merged in.
const defaultCorsOrigins = [
  'http://localhost:5173',
  'http://localhost:8080',
  'http://localhost:8765',
  'https://dikcsyvq9i7v1.cloudfront.net', // Flutter web app
  'https://dkikczh1847dh.cloudfront.net', // HR admin dashboard
];

const configuredCorsOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Every company's dashboard lives on its own subdomain of the product
 * domain — convrse.getsowaka.com, acmt.getsowaka.com — and a new company
 * must not need a server change to sign in. So any https origin on that
 * domain is allowed, alongside the fixed list. `DASHBOARD_DOMAIN` moves it.
 */
const dashboardDomain = (process.env.DASHBOARD_DOMAIN ?? 'getsowaka.com').trim().toLowerCase();

/** The domain itself, or one label under it. Compared, not pattern-matched:
 *  a regex built from an env value turns a typo into a hole. */
function isDashboardOrigin(origin: string): boolean {
  if (!dashboardDomain) return false;
  const lower = origin.trim().toLowerCase();
  if (!lower.startsWith('https://')) return false;
  const host = lower.slice('https://'.length);
  if (host === dashboardDomain) return true;
  if (!host.endsWith(`.${dashboardDomain}`)) return false;
  const label = host.slice(0, -(dashboardDomain.length + 1));
  return /^[a-z0-9-]+$/.test(label);
}

/** `"a, b"` -> `['a','b']`; `*` or `all` means unrestricted, i.e. empty. */
function orgList(raw: string | undefined): string[] {
  const value = String(raw ?? '').trim();
  if (value === '*' || value.toLowerCase() === 'all') return [];
  return value.split(',').map((org) => org.trim()).filter(Boolean);
}

/**
 * The email allowlist, which only an explicit `*` (or `all`) may lift.
 *
 * An unset or empty `EMAIL_ORGS` falls back to the safe default rather than to
 * "everyone": a blank value in a deploy config is far more likely to be a
 * mistake than a decision to start mailing every org.
 */
const DEFAULT_EMAIL_ORGS = ['sowaka', 'convrse'];

function emailOrgList(raw: string | undefined): string[] {
  if (raw === undefined) return [...DEFAULT_EMAIL_ORGS];
  const value = raw.trim().toLowerCase();
  if (value === '*' || value === 'all') return [];
  const orgs = orgList(raw);
  return orgs.length > 0 ? orgs : [...DEFAULT_EMAIL_ORGS];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  /**
   * Whether this process is a developer's own machine, by the same allowlist
   * the OTP bypass uses. Anything not named here — including an unset NODE_ENV
   * — is somewhere real people sign in, and is treated as such.
   */
  isLocal: DEV_ENVIRONMENTS.has(process.env.NODE_ENV ?? ''),
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: [...new Set([...defaultCorsOrigins, ...configuredCorsOrigins])],
  /** True for an origin the dashboard may call from; see [isDashboardOrigin]. */
  isDashboardOrigin,
  mobileAppApiBaseUrl: process.env.MOBILE_APP_API_BASE_URL ?? 'http://10.0.2.2:4000',
  // The app's link domain: notification emails point their "view this" links at `${appWebUrl}/open?...`,
  // which opens the app where it is installed (see services/app-link.ts) and the dashboard's /open page where not.
  appWebUrl: process.env.APP_WEB_URL ?? 'https://go.getsowaka.com',
  mongoUri: process.env.MONGODB_URI ?? '',
  mongoDbName: process.env.MONGODB_DB ?? 'sowaka',
  /** Most connections to the cluster at once (MONGO_MAX_POOL). The cluster is a ~200 ms round trip away, so each request holds one for a while. */
  mongoMaxPool: Math.max(10, Number(process.env.MONGO_MAX_POOL) || 200),
  /** Connections kept open between bursts (MONGO_MIN_POOL): opening one is a TLS handshake of about a second. */
  mongoMinPool: Math.max(0, Number(process.env.MONGO_MIN_POOL) || (process.env.NODE_ENV === 'production' ? 20 : 0)),
  /** How long a request may wait for a free connection before it fails (MONGO_WAIT_MS), instead of queueing past the proxy's timeout. */
  mongoWaitQueueMs: Math.max(1000, Number(process.env.MONGO_WAIT_MS) || 15_000),
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES ?? 10),
  /**
   * Lets `123456` stand in for any mailed code — for local work only.
   *
   * Accepted only where NODE_ENV names a local environment, and refused
   * everywhere else however the flag is set. This was a plain flag, and
   * production was running with it on: the fixed code opened every account in
   * every org, including HR and other tenants.
   *
   * The guard names the environments that may have it rather than the one that
   * may not. Refusing only `production` left it live wherever NODE_ENV was
   * unset (the default), misspelled, or simply a name nobody had thought of —
   * which is every host that has not been deliberately configured, the ones
   * most likely to be wrong.
   */
  otpDevBypass:
    process.env.OTP_DEV_BYPASS === 'true' && DEV_ENVIRONMENTS.has(process.env.NODE_ENV ?? ''),
  /**
   * Accounts that may sign in with the fixed code `123456`, from
   * `OTP_TEST_EMAILS` (comma-separated).
   *
   * For store-review accounts, which cannot receive a mailed code. Deliberately
   * an allowlist rather than a flag: `OTP_DEV_BYPASS` opens every account in
   * every org to one guessable code, which is survivable on a laptop and not in
   * production. Each use is logged.
   */
  otpTestEmails: String(process.env.OTP_TEST_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  /**
   * Accounts that sign in with a fixed code of their own, from `OTP_FIXED_CODES`
   * (`email:code` pairs, comma-separated, six-digit codes). For shared desks whose
   * mailbox the person signing in cannot read. Kept in the host's settings,
   * never in the repo; each use is logged.
   */
  otpFixedCodes: new Map<string, string>(
    String(process.env.OTP_FIXED_CODES ?? '')
      .split(',')
      .map((pair) => pair.trim().split(':').map((part) => part.trim()))
      .filter((pair): pair is [string, string] => pair.length === 2 && /^\S+@\S+$/.test(pair[0]) && /^\d{6}$/.test(pair[1]))
      .map(([email, code]) => [email.toLowerCase(), code] as [string, string]),
  ),
  /**
   * Orgs that may receive push and in-app notifications, from `NOTIFY_ORGS`
   * (comma-separated). Empty means unrestricted.
   *
   * Local and production share one Atlas cluster, so an unguarded dev server
   * can reach every real employee in the database. A dev `.env` names the org
   * being worked on; production leaves it unset.
   */
  notifyOrgs: orgList(process.env.NOTIFY_ORGS),

  /**
   * Orgs that may receive email, from `EMAIL_ORGS`.
   *
   * Defaults to a named list rather than to unrestricted, because email is the
   * one channel that reaches people outside the app and cannot be taken back —
   * so the safe state is the one that needs no deployment config to hold. Set
   * `EMAIL_ORGS` to a list to change it, or to `*` to lift the restriction.
   */
  emailOrgs: emailOrgList(process.env.EMAIL_ORGS),
  authSessionTtlDays: Number(process.env.AUTH_SESSION_TTL_DAYS ?? 30),
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '',
  notificationTestEndpointEnabled:
    process.env.ENABLE_NOTIFICATION_TEST_ENDPOINT === 'true',
  s3: {
    region: process.env.AWS_REGION ?? '',
    bucket: process.env.AWS_S3_BUCKET ?? '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    sessionToken: process.env.AWS_SESSION_TOKEN ?? '',
    endpoint: process.env.AWS_S3_ENDPOINT ?? '',
    forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
    receiptPrefix: process.env.AWS_S3_RECEIPT_PREFIX ?? 'reimbursements/receipts',
    connectMediaPrefix: process.env.AWS_S3_CONNECT_MEDIA_PREFIX ?? 'connect/posts',
    serverSideEncryption: process.env.AWS_S3_SERVER_SIDE_ENCRYPTION ?? 'AES256',
    kmsKeyId: process.env.AWS_S3_KMS_KEY_ID ?? '',
    presignTtl: Number(process.env.AWS_S3_PRESIGN_TTL ?? 300),
  },
  /**
   * Face ID: Amazon Rekognition matches the face at a punch against the one
   * the employee enrolled. Whether a company uses it is HR's switch
   * (Company.faceId); these are the service's own settings. Credentials are
   * the S3 ones when set, otherwise the host's role, as for S3.
   */
  face: {
    region: (process.env.FACE_AWS_REGION ?? process.env.AWS_REGION ?? 'ap-south-1').trim() || 'ap-south-1',
    /** One collection per company: `<prefix><org>`. */
    collectionPrefix: (process.env.FACE_COLLECTION_PREFIX ?? 'sowaka-').trim(),
    /** How alike the punch face must be to the enrolled one, 0-100. */
    matchThreshold: clamp(Number(process.env.FACE_MATCH_THRESHOLD) || 95, 80, 99.9),
    /** How long a passed check may be used to punch, and only once. */
    tokenTtlSeconds: clamp(Number(process.env.FACE_TOKEN_TTL_SECONDS) || 300, 30, 900),
    /** Checks that matched someone else, or nobody, before the app offers to send the day to the manager. */
    maxAttempts: clamp(Number(process.env.FACE_MAX_ATTEMPTS) || 5, 1, 10),
    /**
     * Checks that could not be judged (poor picture, light check not
     * answered, service down) before the manager fallback opens too, so a
     * bad camera or room does not lock a person out of the day.
     */
    inconclusiveFallback: clamp(Number(process.env.FACE_INCONCLUSIVE_FALLBACK) || 8, 1, 30),
    /**
     * The server's light check: the face under each colour it set must shift
     * its chroma that colour's way by FACE_FLASH_CHROMA (YCbCr units) and
     * brighten by FACE_FLASH_BRIGHTEN, judged from the frames the phone
     * sends. Lenient until calibrated from `npm run face:calibrate`.
     */
    flashChroma: clamp(Number(process.env.FACE_FLASH_CHROMA) || 1.5, 0.2, 20),
    flashBrighten: clamp(Number(process.env.FACE_FLASH_BRIGHTEN) || 1, 0, 30),
    /**
     * `on`: a selfie without a server challenge answered is refused (apps
     * from before 1.3.9 (59) send none). Off, such a selfie is logged as
     * unverified and still matched.
     */
    requireChallenge: (process.env.FACE_REQUIRE_CHALLENGE ?? '').trim().toLowerCase() === 'on',
    /** Each Rekognition call gives up after this long. */
    timeoutMs: clamp(Number(process.env.FACE_REKOGNITION_TIMEOUT_MS) || 5000, 1000, 30_000),
    /** Retries after the first try, for throttling and network errors only. */
    retries: clamp(Number(process.env.FACE_REKOGNITION_RETRIES) || 1, 0, 5),
    /**
     * How long the check log is kept, in months (FACE_LOG_RETENTION_MONTHS).
     * Nothing deletes on its own: `npm run face-log:cleanup` removes older rows.
     */
    logRetentionMonths: clamp(Number(process.env.FACE_LOG_RETENTION_MONTHS) || 12, 1, 120),
    /** Where enrolment photos sit in the private bucket. */
    photoPrefix: (process.env.FACE_PHOTO_PREFIX ?? 'faces').replace(/^\/+|\/+$/g, ''),
    /**
     * Rekognition Face Liveness: `on` once the Cognito identity pool the app
     * streams through exists. Off, the app's own blink-or-turn check stands in.
     */
    liveness: (process.env.FACE_LIVENESS ?? '').trim().toLowerCase() === 'on',
    livenessThreshold: clamp(Number(process.env.FACE_LIVENESS_THRESHOLD) || 90, 50, 99.9),
    /** The identity pool the app gets its streaming credentials from. */
    livenessIdentityPoolId: (process.env.FACE_LIVENESS_IDENTITY_POOL_ID ?? '').trim(),
  },
  /**
   * Sowaka's own Zoom account, as a server-to-server app: the backend creates
   * a meeting for every counselling session as the counsellor, and nobody is
   * ever asked to sign in to Zoom. All three come from the app's page on
   * marketplace.zoom.us. Absent on a developer's machine, where a session gets
   * a placeholder link instead so the flow can still be walked through.
   */
  /**
   * Where the Care web pages live (https://care.getsowaka.com). Set in
   * production so the app opens them; unset, the app shows its own screens,
   * which is what a developer's machine wants.
   */
  careWebBase: (process.env.CARE_WEB_BASE ?? '').replace(/\/+$/, ''),
  /**
   * A folder of app pages (`<key>.html`) to serve from disk instead of the
   * database, for every company, as version "dev": for trying a page on the
   * simulator against a local backend with no database write. Honoured only
   * on a developer's machine (the OTP bypass's allowlist); ignored, loudly,
   * anywhere else.
   */
  appPageDir: DEV_ENVIRONMENTS.has(process.env.NODE_ENV ?? '') ? (process.env.APP_PAGE_DIR ?? '').trim() : '',
  /**
   * The same for game pages (`GET /play/:key`): a folder of `<key>.html`
   * served instead of the catalog's copy, as version "dev", on a developer's
   * machine only. For trying a game page in the simulator, or a live Scribble
   * build against a local backend, without uploading it to the catalog.
   */
  /**
   * For a local test of the Diwali Cup only: the Cup's page (`diwali-cup`) is
   * read from this file instead of game_catalog, without the catalog entry or
   * the company's game list. Ignored outside development and test.
   */
  cupPageFile: DEV_ENVIRONMENTS.has(process.env.NODE_ENV ?? '') ? (process.env.CUP_PAGE_FILE ?? '').trim() : '',
  gamePageDir: DEV_ENVIRONMENTS.has(process.env.NODE_ENV ?? '') ? (process.env.GAME_PAGE_DIR ?? '').trim() : '',
  /**
   * Signs the tickets a Scribble page carries (see `scribble-ticket.service`).
   * Unset, a key is derived from the Mongo connection string so every instance
   * agrees without configuration; set it in production all the same, so the
   * database credentials and the game's signing key are not one secret.
   */
  scribbleTicketSecret: (process.env.SCRIBBLE_TICKET_SECRET ?? '').trim(),
  /**
   * The Diwali Cup's runner (see `cup.service`): off with `CUP_RUNNER=off`.
   * `CUP_RUNNER_ORGS` (comma-separated) limits which orgs' events it moves;
   * outside production it defaults to `NOTIFY_ORGS`, and with neither set it
   * moves nothing, so a dev server on the shared database never runs a real
   * company's Cup.
   */
  cupRunner: (process.env.CUP_RUNNER ?? '').trim().toLowerCase() !== 'off',
  cupRunnerOrgs: orgList(process.env.CUP_RUNNER_ORGS ?? (process.env.NODE_ENV === 'production' ? '' : process.env.NOTIFY_ORGS ?? '-')),
  zoom: {
    accountId: process.env.ZOOM_ACCOUNT_ID ?? '',
    clientId: process.env.ZOOM_CLIENT_ID ?? '',
    clientSecret: process.env.ZOOM_CLIENT_SECRET ?? '',
    /**
     * Who hosts a meeting when the counsellor has no Zoom user of their own.
     * A single-user account hosts everything as its owner; once counsellors
     * are added to the account, their profile's zoomUserId takes over.
     */
    hostUser: process.env.ZOOM_HOST_USER ?? '',
  },
  zohoSmtp: {
    host: process.env.ZOHO_SMTP_HOST ?? 'smtp.zoho.com',
    port: Number(process.env.ZOHO_SMTP_PORT ?? 465),
    secure: process.env.ZOHO_SMTP_SECURE !== 'false',
    user: process.env.ZOHO_SMTP_USER ?? '',
    pass: process.env.ZOHO_SMTP_PASS ?? '',
    from: process.env.ZOHO_SMTP_FROM ?? process.env.ZOHO_SMTP_USER ?? '',
  },
};

// Say so loudly rather than ignoring it quietly: a deployed host carrying this
// flag is a deployment that believed the fixed code was live, and whoever set
// it should find out from the boot log, not from someone signing in as another
// tenant. Fires on every environment the bypass is refused in, not just the one
// spelled `production` — an unset NODE_ENV is exactly the case worth shouting
// about.
if (process.env.OTP_DEV_BYPASS === 'true' && !env.otpDevBypass) {
  // eslint-disable-next-line no-console
  console.warn(
    `[security] OTP_DEV_BYPASS is set on a ${env.nodeEnv} host and has been ignored. ` +
      'The fixed code 123456 will not be accepted. Use OTP_TEST_EMAILS for store-review accounts.',
  );
}

if ((process.env.APP_PAGE_DIR ?? '').trim() && !env.appPageDir) {
  // eslint-disable-next-line no-console
  console.warn(`[app-pages] APP_PAGE_DIR is set on a ${env.nodeEnv} host and has been ignored; pages come from the database.`);
}

if ((process.env.CUP_PAGE_FILE ?? '').trim() && !env.cupPageFile) {
  console.warn('CUP_PAGE_FILE is ignored outside development and test');
}
if ((process.env.GAME_PAGE_DIR ?? '').trim() && !env.gamePageDir) {
  // eslint-disable-next-line no-console
  console.warn(`[game-pages] GAME_PAGE_DIR is set on a ${env.nodeEnv} host and has been ignored; pages come from the catalog.`);
}
