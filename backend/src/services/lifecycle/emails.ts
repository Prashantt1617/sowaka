/**
 * Lifecycle email (CONTRACT decision 13). Candidates are not users, so the
 * usual gate (`isAllowedRecipient`, which looks the address up in `users`)
 * cannot be used; `sendLifecycleEmail` applies the same EMAIL_ORGS rule to the
 * org the mail is for instead. Without SMTP (a developer's machine) mail is
 * logged, and outside production every mail is kept in an in-memory outbox
 * the check scripts read (`lifecycleOutbox()`).
 *
 * Also the small shared pieces every lifecycle mail and read model needs: the
 * company's display name and HR contact, IST dates, and once-only job keys.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { companies, getDb, users } from '../../config/db';
import { env } from '../../config/env';
import type { Company } from '../../models/company.model';
import type { Journey } from '../../models/lifecycle.model';
import { logger } from '../../utils/logger';
import { scriptForcesFeatures } from './scriptScope';

export interface LifecycleAttachment { filename: string; content: Buffer; contentType: string }
export interface OutboxEntry {
  org: string; to: string; cc: string[]; subject: string; html: string;
  attachments: LifecycleAttachment[]; sent: boolean; suppressed: boolean; at: Date;
}

const transporter = env.zohoSmtp.user && env.zohoSmtp.pass
  ? nodemailer.createTransport({
    host: env.zohoSmtp.host, port: env.zohoSmtp.port, secure: env.zohoSmtp.secure,
    auth: { user: env.zohoSmtp.user, pass: env.zohoSmtp.pass }, connectionTimeout: 10_000, socketTimeout: 10_000,
  })
  : null;

const OUTBOX_MAX = 200;
const outbox: OutboxEntry[] = [];
/** Every lifecycle mail this process composed (newest last). Never kept in production: login mails carry a password. */
export function lifecycleOutbox(): OutboxEntry[] { return outbox; }
export function clearLifecycleOutbox(): void { outbox.length = 0; }

/** The EMAIL_ORGS rule, for an org rather than a user row: `*` lifts it, otherwise the org must be listed. */
export function orgMayEmail(org: string): boolean {
  // An interceptor stands in for delivery (nothing leaves the process), so the rule has nothing to guard.
  if (interceptor) return true;
  return env.emailOrgs.length === 0 || env.emailOrgs.includes(org);
}

type Interceptor = (entry: OutboxEntry) => void;
let interceptor: Interceptor | null = null;
/**
 * Scripts only (the demo seed, which runs where SMTP is configured): while set, every lifecycle
 * mail is handed to this instead of SMTP and never sent; the caller's action carries on as if it
 * had been delivered. `null` restores normal sending.
 */
export function interceptLifecycleEmails(handler: Interceptor | null): void {
  interceptor = handler;
}

/** Whether a mail can really go out: SMTP set up. Without it (development) mails are only logged and kept in the outbox. */
export function smtpConfigured(): boolean { return transporter !== null; }

const mask = (email: string) => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
};

/**
 * Sends one lifecycle mail. Never throws: a failed send is logged, and the
 * caller's action (an offer sent, a password set) has already happened.
 * Returns whether SMTP accepted it.
 */
export async function sendLifecycleEmail(
  org: string,
  to: string,
  subject: string,
  html: string,
  attachments: LifecycleAttachment[] = [],
  opts: { cc?: string[]; replyTo?: string } = {},
): Promise<boolean> {
  const recipient = String(to ?? '').trim().toLowerCase();
  const cc = [...new Set((opts.cc ?? []).map((a) => a.trim().toLowerCase()).filter((a) => a && a !== recipient && /^\S+@\S+\.\S+$/.test(a)))];
  const allowed = orgMayEmail(org) && /^\S+@\S+\.\S+$/.test(recipient);
  const entry: OutboxEntry = { org, to: recipient, cc, subject, html, attachments, sent: false, suppressed: !allowed, at: new Date() };
  if (interceptor) {
    interceptor(entry);
    return true;
  }
  if (env.nodeEnv !== 'production') {
    outbox.push(entry);
    if (outbox.length > OUTBOX_MAX) outbox.splice(0, outbox.length - OUTBOX_MAX);
  }
  if (!allowed) {
    logger.info('Lifecycle email suppressed: org is outside EMAIL_ORGS', { recipient: mask(recipient), org, subject });
    return false;
  }
  if (!transporter) {
    logger.info('SMTP is not configured; lifecycle email logged only', { recipient: mask(recipient), org, subject, attachments: attachments.map((a) => a.filename) });
    // Development only: the mail's text (links, the portal login) so a local run can follow it. Never in production.
    if (env.nodeEnv !== 'production') logger.info('Lifecycle email (development copy)', { to: recipient, subject, text: htmlToText(html) });
    return false;
  }
  try {
    await transporter.sendMail({
      from: env.zohoSmtp.from, to: recipient, ...(cc.length ? { cc } : {}), ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      subject, html, text: htmlToText(html),
      attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
    entry.sent = true;
    return true;
  } catch (error) {
    logger.error('Lifecycle email delivery failed', { recipient: mask(recipient), org, subject }, error);
    return false;
  }
}

function htmlToText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Once-only keys for timed mails ─────────────────────────────────────────

/** True the first time a key is claimed, false ever after: what makes every timed mail idempotent. */
export async function fireOnce(key: string, org: string): Promise<boolean> {
  try {
    await getDb().collection<{ _id: string; org: string; at: Date }>('lifecycle_portal_jobs').insertOne({ _id: key, org, at: new Date() });
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
}

/** Lets a key fire again (a resend that should be possible after a change). */
export async function forgetFired(key: string): Promise<void> {
  await getDb().collection<{ _id: string }>('lifecycle_portal_jobs').deleteOne({ _id: key });
}

// ─── Dates (IST) ────────────────────────────────────────────────────────────

/** Today's date in IST, 'YYYY-MM-DD'. */
export function istDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
export function istHour(now: Date = new Date()): number {
  return new Date(now.getTime() + 5.5 * 3_600_000).getUTCHours();
}
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
export function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'Mon 1 Dec 2026'. */
export function formatDay(day: string | undefined): string {
  if (!day || !isDay(day)) return '';
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** '₹14,00,000' (Indian grouping). */
export function formatRupees(amount: number | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '';
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

// ─── Company and HR contact ─────────────────────────────────────────────────

export async function companyOf(org: string): Promise<Company | null> {
  return companies().findOne({ id: org }, { projection: { _id: 0 } });
}
export function companyDisplayName(company: Company | null, org: string): string {
  return company?.profile?.displayName?.trim() || company?.name?.trim() || company?.profile?.registeredName?.trim() || org;
}
export function companyAddress(company: Company | null): string {
  const p = company?.profile;
  const parts = [p?.addressLine1, p?.addressLine2, p?.city, p?.state, p?.pincode].map((x) => x?.trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : (company?.address?.trim() ?? '');
}
export async function lifecycleEnabled(org: string | undefined): Promise<boolean> {
  if (!org) return false;
  if (scriptForcesFeatures(org)) return true;
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, features: 1 } });
  return company?.features?.lifecycle === true;
}

/** Who the candidate writes to: the company's reply-to/contact address, else the HR person who made the offer. */
export async function hrContactFor(journey: Pick<Journey, 'org' | 'createdByUserId'>, company?: Company | null): Promise<{ name: string; email: string }> {
  const c = company === undefined ? await companyOf(journey.org) : company;
  const creator = await users().findOne({ userId: journey.createdByUserId }, { projection: { _id: 0, name: 1, email: 1 } });
  const email = c?.profile?.replyToEmail?.trim() || c?.profile?.primaryContactEmail?.trim() || creator?.email || '';
  const name = c?.profile?.senderName?.trim() || creator?.name || 'HR';
  return { name, email };
}

export const firstName = (name: string | undefined) => String(name ?? '').trim().split(/\s+/)[0] || 'there';

// ─── Mail bodies ────────────────────────────────────────────────────────────

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** HR's plain text as paragraphs (blank lines split them). */
export function textToHtml(body: string): string {
  return String(body ?? '').split(/\n{2,}/).map((block) => `<p style="margin:0 0 14px">${block.split('\n').map(escapeHtml).join('<br />')}</p>`).join('');
}

/** The one layout every lifecycle mail uses: company name on top, the content, an optional button, "Powered by SOWAKA". */
export function layout(companyName: string, content: string, button?: { label: string; url: string }): string {
  const cta = button
    ? `<p style="margin:22px 0"><a href="${escapeHtml(button.url)}" style="background:#0571A6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">${escapeHtml(button.label)}</a></p>`
      + `<p style="margin:0 0 14px;font-size:12px;color:#717171">Or open this link: <a href="${escapeHtml(button.url)}" style="color:#0571A6">${escapeHtml(button.url)}</a></p>`
    : '';
  return `<div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;max-width:560px">`
    + `<p style="margin:0 0 18px;font-weight:700;font-size:16px">${escapeHtml(companyName)}</p>${content}${cta}`
    + `<p style="margin:28px 0 0;font-size:12px;color:#717171">Powered by <span style="color:#B23500;font-weight:700">SOWAKA</span></p></div>`;
}

const p = (text: string) => `<p style="margin:0 0 14px">${text}</p>`;

// ─── Links into the portal, and the client they belong to ─────────────────

/**
 * Sign-in, forgot and reset show the client's logo and HR contact. A device
 * that never opened the offer link has no remembered client, so every portal
 * link in a mail carries `c=<client token>`: the org id and a short HMAC, which
 * `GET /portal/client/:token` answers with the logo and HR contact. Signed, so
 * the endpoint cannot be walked through org ids.
 */
function clientKey(): Buffer {
  return createHash('sha256').update(`portal-client:${env.portalJwtSecret || env.mongoUri || 'local'}`).digest();
}
const clientMac = (org: string) => createHmac('sha256', clientKey()).update(`client:${org}`).digest('base64url').slice(0, 22);
export function clientToken(org: string): string {
  return `${Buffer.from(org).toString('base64url')}.${clientMac(org)}`;
}
/** The org a client token names, or null when it is not one of ours. */
export function orgOfClientToken(token: unknown): string | null {
  const [orgB64, mac] = String(token ?? '').split('.');
  if (!orgB64 || !mac || mac.length !== 22) return null;
  const org = Buffer.from(orgB64, 'base64url').toString('utf8');
  if (!/^[\w.-]{1,64}$/.test(org)) return null;
  const expected = Buffer.from(clientMac(org));
  const actual = Buffer.from(mac);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? org : null;
}

/** `${PORTAL_BASE_URL}${path}`; with an org, `c=<client token>` rides along (see `clientToken`). */
export const portalLink = (pathAndQuery: string, org?: string) => {
  // PORTAL_BASE_URL may name the company: https://{org}.getsowaka.com/onboarding. Without a company, the shared join address.
  const base = env.portalBaseUrl.includes('{org}') ? env.portalBaseUrl.replace('{org}', org || 'join') : env.portalBaseUrl;
  if (!org) return `${base}${pathAndQuery}`;
  return `${base}${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}c=${clientToken(org)}`;
};

/** The portal's sign-in, with their email already in the box (the link goes only to that address). */
export const signInLink = (email: string, org?: string) => portalLink(`/sign-in?email=${encodeURIComponent(email.trim())}`, org);

export const mails = {
  offer(company: string, body: string, link: string | null) {
    return layout(company, textToHtml(body), link ? { label: 'View and accept your offer', url: link } : undefined);
  },
  /** Finalise: the portal's link. They sign in with this same email and a code we send then: no password to keep. */
  portalReady(company: string, name: string, email: string, org?: string) {
    return layout(company,
      p(`Hi ${escapeHtml(firstName(name))},`)
      + p(`HR has confirmed your offer. Your joining portal is ready: upload your documents, meet the team and get your Day-1 pass, all before you join.`)
      + p(`Sign in with this email address, <b>${escapeHtml(email)}</b>. We'll email you a one-time code each time; there's no password to remember.`),
      { label: 'Open your joining portal', url: signInLink(email, org) });
  },
  /** The sign-in code itself. */
  portalCode(company: string, code: string, minutes: number) {
    return layout(company,
      p(`Your code to sign in to your ${escapeHtml(company)} joining portal is:`)
      + p(`<span style="font-family:monospace;font-size:26px;letter-spacing:6px;font-weight:700">${escapeHtml(code)}</span>`)
      + p(`It works for ${minutes} minutes. If you didn't ask for it, ignore this email.`));
  },
  /** Mark joined: the app is theirs now, signed in with the new work email (a code by email, no password). */
  joinedWelcome(company: string, name: string, workEmail: string) {
    return layout(company,
      p(`Hi ${escapeHtml(firstName(name))},`)
      + p(`Welcome to ${escapeHtml(company)}! You're all set up. From today, your first week, your tasks and everything else are in the Sowaka app.`)
      + p(`<b>Sign in with your work email:</b> ${escapeHtml(workEmail)}<br />We'll email a sign-in code to that address each time; there's no password to remember.`)
      + p(`Don't have the app yet? The button below opens it, or takes you to the App Store or Google Play.`),
      { label: 'Open the Sowaka app', url: 'https://go.getsowaka.com/open' });
  },
  loginReminder(company: string, name: string, email: string, _sentOn: string, org?: string) {
    return layout(company,
      p(`Hi ${escapeHtml(firstName(name))},`)
      + p(`Your joining portal is waiting for you. Sign in with <b>${escapeHtml(email)}</b>; we'll email you a one-time code.`),
      { label: 'Open your joining portal', url: signInLink(email, org) });
  },
  quietNudge(company: string, name: string, upNext: string | undefined, org?: string) {
    return layout(company,
      p(`Hi ${escapeHtml(firstName(name))},`)
      + p(`A quick reminder: a few things are still waiting on your joining portal.${upNext ? ` Next up: <b>${escapeHtml(upNext)}</b>.` : ''}`)
      + p(`It only takes a few minutes.`),
      { label: 'Open your portal', url: portalLink('/', org) });
  },
  documentSentBack(company: string, name: string, label: string, note: string, org?: string) {
    return layout(company,
      p(`Hi ${escapeHtml(firstName(name))},`)
      + p(`HR looked at your <b>${escapeHtml(label)}</b> and needs another copy.`)
      + `<p style="margin:0 0 14px;padding:12px 14px;background:#FFF4E5;border-radius:12px"><b>Note from HR:</b> ${escapeHtml(note)}</p>`
      + p(`Please upload it again on your portal.`),
      { label: 'Upload again', url: portalLink('/documents', org) });
  },
  lettersReady(company: string, name: string, due: string, org?: string) {
    return layout(company,
      p(`Hi ${escapeHtml(firstName(name))},`)
      + p(`HR has approved your documents. Your appointment letter and NDA are ready: open each PDF, read it, then sign it on your portal${due ? ` by ${escapeHtml(due)}` : ''}.`),
      { label: 'Read and sign', url: portalLink('/letters', org) });
  },
  letterNudge(company: string, name: string, due: string, org?: string) {
    return layout(company,
      p(`Hi ${escapeHtml(firstName(name))},`)
      + p(`Your appointment letter and NDA are still waiting for your signature${due ? ` (due ${escapeHtml(due)})` : ''}. It takes about three minutes.`),
      { label: 'Read and sign', url: portalLink('/letters', org) });
  },
  day1Pass(company: string, name: string, lines: Array<[string, string]>, org?: string) {
    return layout(company,
      p(`Hi ${escapeHtml(firstName(name))},`)
      + p(`Your first day is one week away. Here is where to go and when; your Day-1 pass on the portal has it all, with an "Add to calendar" button.`)
      + `<table style="border-collapse:collapse;margin:0 0 14px">${lines.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#717171">${escapeHtml(k)}</td><td style="padding:4px 0"><b>${escapeHtml(v)}</b></td></tr>`).join('')}</table>`,
      { label: 'Open your Day-1 pass', url: portalLink('/pass', org) });
  },
  dateChange(company: string, name: string, approved: boolean, requested: string, note?: string, org?: string) {
    return layout(company,
      p(`Hi ${escapeHtml(firstName(name))},`)
      + (approved
        ? p(`Good news: HR has agreed to your new joining date, <b>${escapeHtml(requested)}</b>. Your task due dates have moved to match. HR will send you an updated offer to accept.`)
        : p(`HR couldn't move your joining date to ${escapeHtml(requested)}. Your joining date stays as it was.`))
      + (note ? `<p style="margin:0 0 14px;padding:12px 14px;background:#F7F7F9;border-radius:12px"><b>Note from HR:</b> ${escapeHtml(note)}</p>` : ''),
      { label: 'Open your portal', url: portalLink('/', org) });
  },
  passwordReset(company: string, name: string, link: string) {
    return layout(company,
      p(`Hi ${escapeHtml(firstName(name))},`)
      + p(`Someone asked to reset the password for your joining portal. If it was you, set a new one with the button below. The link works for one hour.`)
      + p(`If it wasn't you, ignore this email: your password stays as it is.`),
      { label: 'Set a new password', url: link });
  },
  hrOfferAccepted(company: string, candidate: string, version: number) {
    return layout(company,
      p(`${escapeHtml(candidate)} accepted ${version > 1 ? `the updated offer (version ${version})` : 'their offer'}.`)
      + p(`Finalise it on the dashboard (Onboarding › Pre-boarding): that creates their portal login and emails it to them.`));
  },
  /** A revised offer accepted by someone already finalised: no second finalise; the letters it changed are named. */
  hrRevisionAccepted(company: string, candidate: string, version: number, letters: string[]) {
    return layout(company,
      p(`${escapeHtml(candidate)} accepted the updated offer (version ${version}). Their portal and progress stay as they were: nothing to finalise again.`)
      + (letters.length
        ? p(`These letters no longer match the offer and need signing again: ${escapeHtml(letters.join(', '))}. Make them again in Documents; the portal asks ${escapeHtml(candidate.split(' ')[0] || candidate)} to sign once they are ready.`)
        : p('Their signed letters still match the offer.')));
  },
  hrFinaliseReminder(company: string, candidate: string) {
    return layout(company,
      p(`${escapeHtml(candidate)} accepted their offer over a working day ago and is waiting for HR to finalise it.`)
      + p(`Finalise it on the dashboard (Onboarding › Pre-boarding) so their portal login goes out.`));
  },
  letter(company: string, body: string, link: string | null) {
    return layout(company, textToHtml(body), link ? { label: 'Open your joining portal', url: link } : undefined);
  },
};
