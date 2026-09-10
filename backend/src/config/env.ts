import dotenv from 'dotenv';

dotenv.config();

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
function emailOrgList(raw: string | undefined): string[] {
  if (raw === undefined) return ['sowaka'];
  const value = raw.trim().toLowerCase();
  if (value === '*' || value === 'all') return [];
  const orgs = orgList(raw);
  return orgs.length > 0 ? orgs : ['sowaka'];
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: [...new Set([...defaultCorsOrigins, ...configuredCorsOrigins])],
  mobileAppApiBaseUrl: process.env.MOBILE_APP_API_BASE_URL ?? 'http://10.0.2.2:4000',
  // Where notification emails point their "view this" links.
  appWebUrl: process.env.APP_WEB_URL ?? 'https://dikcsyvq9i7v1.cloudfront.net',
  mongoUri: process.env.MONGODB_URI ?? '',
  mongoDbName: process.env.MONGODB_DB ?? 'sowaka',
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES ?? 10),
  otpDevBypass: process.env.OTP_DEV_BYPASS === 'true',
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
   * Defaults to sowaka rather than to unrestricted, because email is the one
   * channel that reaches people outside the app and cannot be taken back. Only
   * sowaka is meant to receive mail for now, in every environment — so the safe
   * state is the one that needs no deployment config to hold. Set `EMAIL_ORGS`
   * to a list to widen it, or to `*` to lift the restriction entirely.
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
