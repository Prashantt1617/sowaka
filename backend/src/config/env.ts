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
  mobileAppApiBaseUrl: process.env.MOBILE_APP_API_BASE_URL ?? 'http://10.0.2.2:4000',
  // Where notification emails point their "view this" links.
  appWebUrl: process.env.APP_WEB_URL ?? 'https://dikcsyvq9i7v1.cloudfront.net',
  mongoUri: process.env.MONGODB_URI ?? '',
  mongoDbName: process.env.MONGODB_DB ?? 'sowaka',
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
