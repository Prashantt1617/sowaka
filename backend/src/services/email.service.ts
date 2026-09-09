import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { users } from '../config/db';
import { logger } from '../utils/logger';

const transporter =
  env.zohoSmtp.user && env.zohoSmtp.pass
    ? nodemailer.createTransport({
        host: env.zohoSmtp.host,
        port: env.zohoSmtp.port,
        secure: env.zohoSmtp.secure,
        auth: {
          user: env.zohoSmtp.user,
          pass: env.zohoSmtp.pass,
        },
        connectionTimeout: 10_000,
        socketTimeout: 10_000,
      })
    : null;

/**
 * Whether this process may email an address at all.
 *
 * Checked here rather than at each caller so every route out — OTP,
 * notifications, anything added later — passes the same gate. An address with
 * no user record is refused while an allowlist is set: unrecognised is not the
 * same as safe, and email is the one channel that leaves the app and cannot be
 * recalled.
 *
 * Gated on `emailOrgs`, not `notifyOrgs`: push and in-app notifications are a
 * separate decision, and restricting mail must not silently mute an org's app.
 */
export async function isAllowedRecipient(email: string): Promise<boolean> {
  if (env.emailOrgs.length === 0) return true;
  const user = await users().findOne({ email: email.trim().toLowerCase() });
  const allowed = Boolean(user?.org && env.emailOrgs.includes(user.org));
  if (!allowed) {
    logger.info('Email suppressed: recipient is outside EMAIL_ORGS', {
      recipient: maskEmail(email),
      org: user?.org ?? 'unknown',
      allowed: env.emailOrgs,
    });
  }
  return allowed;
}

export async function sendOtpEmail(email: string, otp: string): Promise<void> {
  if (!(await isAllowedRecipient(email))) return;
  if (!transporter) {
    if (env.nodeEnv !== 'production' || env.otpDevBypass) {
      logger.warn('SMTP is not configured; using local OTP delivery', {
        recipient: maskEmail(email),
        otp: env.nodeEnv === 'production' ? undefined : otp,
      });
      return;
    }
    throw new Error('Zoho SMTP credentials are not configured');
  }

  try {
    await transporter.sendMail({
      from: env.zohoSmtp.from,
      to: email,
      subject: 'Your Sowaka Connect sign-in code',
      text: `Your Sowaka Connect sign-in code is ${otp}. It expires in ${env.otpTtlMinutes} minutes.`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#2A2420;line-height:1.5">
          <h2 style="margin:0 0 12px">Sowaka Connect sign-in</h2>
          <p>Your 6-digit sign-in code is:</p>
          <div style="font-size:30px;font-weight:700;letter-spacing:6px;margin:16px 0">${otp}</div>
          <p>This code expires in ${env.otpTtlMinutes} minutes.</p>
        </div>
      `,
    });
  } catch (error) {
    logger.error(
      'SMTP delivery failed',
      {
        host: env.zohoSmtp.host,
        port: env.zohoSmtp.port,
        secure: env.zohoSmtp.secure,
        recipient: maskEmail(email),
      },
      error,
    );

    if (env.nodeEnv !== 'production' && env.otpDevBypass) {
      logger.warn('Using local OTP bypass after SMTP failure', {
        recipient: maskEmail(email),
        otp,
      });
      return;
    }
    throw error;
  }
}

/**
 * Delivers the email copy that accompanies a notification.
 *
 * Unlike the OTP mail this never throws: an email that fails to send must not
 * fail the action that triggered it (approving leave, sharing feedback), and
 * the in-app notification has already been recorded regardless.
 */
export async function sendNotificationEmail(
  email: string,
  subject: string,
  body: string,
  /** Copied recipients, filtered by the same allowlist as the primary one. */
  cc: string[] = [],
): Promise<void> {
  if (!(await isAllowedRecipient(email))) return;
  const allowedCc: string[] = [];
  for (const address of [...new Set(cc.map((a) => a.trim().toLowerCase()).filter(Boolean))]) {
    if (address !== email.trim().toLowerCase() && (await isAllowedRecipient(address))) {
      allowedCc.push(address);
    }
  }
  if (!transporter) {
    logger.warn('SMTP is not configured; skipping notification email', {
      recipient: maskEmail(email),
      subject,
    });
    return;
  }

  try {
    await transporter.sendMail({
      from: env.zohoSmtp.from,
      to: email,
      ...(allowedCc.length ? { cc: allowedCc } : {}),
      subject,
      text: body,
      html: bodyToHtml(body),
    });
  } catch (error) {
    logger.error(
      'Notification email delivery failed',
      { recipient: maskEmail(email), subject },
      error,
    );
  }
}

/**
 * Renders the plain-text body as HTML: blank lines separate paragraphs, and a
 * line that is nothing but a URL becomes a link.
 */
function bodyToHtml(body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n').map((line) => {
        const trimmed = line.trim();
        if (/^https?:\/\/\S+$/.test(trimmed)) {
          const escaped = escapeHtml(trimmed);
          return `<a href="${escaped}" style="color:#0571A6">${escaped}</a>`;
        }
        return escapeHtml(line);
      });
      return `<p style="margin:0 0 14px">${lines.join('<br />')}</p>`;
    })
    .join('');
  return `<div style="font-family:Arial,sans-serif;color:#2A2420;line-height:1.5">${paragraphs}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}
