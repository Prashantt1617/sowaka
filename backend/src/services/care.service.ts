import { randomUUID } from 'node:crypto';
import catalogFile from '../content/care-catalog.json';
import { companies, journalEntries, users } from '../config/db';
import { CareCatalog, JOURNAL_KEEP_DAYS, JournalEntry } from '../models/care.model';
import { User } from '../models/user.model';
import { sendPlainEmail } from './email.service';
import { logger } from '../utils/logger';

/**
 * Care: the catalogue of media behind the activities, and Write.
 *
 * Writing is the person's alone. It is kept for a week: every Sunday night,
 * India time, the week's entries are emailed to them and cleared here. If the
 * mail cannot be sent the entries stay and the next night tries again, so
 * nothing is ever removed without first having been delivered.
 */
export class CareError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'CareError';
  }
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** When the digest runs, on the IST clock. */
const DIGEST_HOUR_IST = 21;
const MAX_ENTRY_CHARS = 8000;

async function requireCareUser(userId: string): Promise<User & { org: string }> {
  const user = await users().findOne({ userId });
  if (!user) throw new CareError(404, 'User not found');
  const company = user.org ? await companies().findOne({ id: user.org }) : null;
  if (!company?.enabledTabs?.includes('care')) {
    throw new CareError(403, 'Care is not available for your company');
  }
  return user as User & { org: string };
}

// ---------------------------------------------------------------------------
// Catalogue

/**
 * The media Sowaka provides, from a JSON file beside the code so a swap is a
 * file change, not a code change. Bundled at build time.
 */
export function careCatalog(): CareCatalog {
  const { _note: _drop, ...catalog } = catalogFile as CareCatalog & { _note?: string };
  return catalog;
}

export async function getCatalog(viewerUserId: string): Promise<CareCatalog> {
  await requireCareUser(viewerUserId);
  return careCatalog();
}

// ---------------------------------------------------------------------------
// Write

export interface JournalEntryView {
  id: string;
  text: string;
  prompt?: string;
  context: string;
  createdAt: string;
  updatedAt: string;
}

export interface JournalView {
  entries: JournalEntryView[];
  /** When the next clear-out happens, so the screen can say so. */
  clearsAt: string;
  /** Where the writing will be mailed. */
  email: string;
}

function toEntryView(entry: JournalEntry): JournalEntryView {
  return {
    id: entry.id,
    text: entry.text,
    ...(entry.prompt ? { prompt: entry.prompt } : {}),
    context: entry.context,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

/** The coming Sunday at the digest hour, IST, as an instant. */
export function nextDigestAt(now = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const daysToSunday = (7 - ist.getUTCDay()) % 7;
  let candidate = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + daysToSunday, DIGEST_HOUR_IST, 0, 0, 0);
  if (candidate <= ist.getTime()) candidate += 7 * 24 * 60 * 60 * 1000;
  return new Date(candidate - IST_OFFSET_MS);
}

export async function listJournal(viewerUserId: string): Promise<JournalView> {
  const user = await requireCareUser(viewerUserId);
  const rows = await journalEntries().find({ userId: viewerUserId }).sort({ createdAt: -1 }).toArray();
  return { entries: rows.map(toEntryView), clearsAt: nextDigestAt().toISOString(), email: user.email };
}

function cleanText(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
  if (!text) throw new CareError(400, 'Write something first');
  return text.slice(0, MAX_ENTRY_CHARS);
}

function cleanContext(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^(general|topic:[a-z-]{1,32}|tool:[a-z-]{1,32})$/.test(text) ? text : 'general';
}

export async function addEntry(
  viewerUserId: string,
  input: { text: unknown; prompt?: unknown; context?: unknown },
): Promise<JournalEntryView> {
  const user = await requireCareUser(viewerUserId);
  const now = new Date();
  const entry: JournalEntry = {
    id: randomUUID(),
    userId: viewerUserId,
    org: user.org,
    text: cleanText(input.text),
    ...(typeof input.prompt === 'string' && input.prompt.trim() ? { prompt: input.prompt.trim().slice(0, 300) } : {}),
    context: cleanContext(input.context),
    createdAt: now,
    updatedAt: now,
  };
  await journalEntries().insertOne(entry);
  return toEntryView(entry);
}

export async function updateEntry(viewerUserId: string, id: string, input: { text: unknown }): Promise<JournalEntryView> {
  await requireCareUser(viewerUserId);
  const now = new Date();
  const updated = await journalEntries().findOneAndUpdate(
    { id, userId: viewerUserId },
    { $set: { text: cleanText(input.text), updatedAt: now } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new CareError(404, 'That entry is no longer here');
  return toEntryView(updated);
}

export async function deleteEntry(viewerUserId: string, id: string): Promise<void> {
  await requireCareUser(viewerUserId);
  const result = await journalEntries().deleteOne({ id, userId: viewerUserId });
  if (result.deletedCount === 0) throw new CareError(404, 'That entry is no longer here');
}

// ---------------------------------------------------------------------------
// The weekly digest

function istDateLabel(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

function digestBody(name: string, entries: JournalEntry[]): string {
  const lines: string[] = [];
  lines.push(`Hi ${name.split(' ')[0] || 'there'},`);
  lines.push('');
  lines.push('Here is what you wrote in Care this week. It has been cleared from the app, as promised, and is yours to keep.');
  for (const entry of [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    lines.push('');
    lines.push(`— ${istDateLabel(entry.createdAt)}${entry.prompt ? ` · ${entry.prompt}` : ''}`);
    lines.push('');
    lines.push(entry.text);
  }
  lines.push('');
  lines.push('Only you receive this. Nobody at your company can see what you write.');
  lines.push('');
  lines.push('sowaka');
  return lines.join('\n');
}

/** Whether, on the IST clock, this instant falls on a Sunday. */
function isSundayIst(at: Date): boolean {
  return new Date(at.getTime() + IST_OFFSET_MS).getUTCDay() === 0;
}

/**
 * Mails and clears. On Sunday everyone with entries gets their week; on any
 * other night only people whose oldest entry has outlived the week, which
 * happens when a Sunday send failed. Entries are removed only after the mail
 * was handed to SMTP.
 */
export async function runJournalDigest(now = new Date()): Promise<{ mailed: number; kept: number }> {
  const sunday = isSundayIst(now);
  const cutoff = new Date(now.getTime() - JOURNAL_KEEP_DAYS * 24 * 60 * 60 * 1000);
  const perUser = await journalEntries()
    .aggregate<{ _id: string; oldest: Date }>([
      { $group: { _id: '$userId', oldest: { $min: '$createdAt' } } },
    ])
    .toArray();
  let mailed = 0;
  let kept = 0;
  for (const { _id: userId, oldest } of perUser) {
    if (!sunday && oldest > cutoff) {
      kept += 1;
      continue;
    }
    const user = await users().findOne({ userId }, { projection: { _id: 0, name: 1, email: 1 } });
    const entries = await journalEntries().find({ userId, createdAt: { $lte: now } }).toArray();
    if (!user?.email || entries.length === 0) {
      kept += 1;
      continue;
    }
    const sent = await sendPlainEmail(user.email, 'Your writing this week', digestBody(user.name, entries));
    if (!sent) {
      kept += 1;
      continue;
    }
    await journalEntries().deleteMany({ id: { $in: entries.map((e) => e.id) } });
    mailed += 1;
  }
  logger.info('Care journal digest ran', { mailed, kept, sunday });
  return { mailed, kept };
}

// ---------------------------------------------------------------------------
// Scheduler: every night at the digest hour, IST.

let timer: NodeJS.Timeout | undefined;

function millisecondsUntilNextDigestHour(now = new Date()): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  let next = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), DIGEST_HOUR_IST, 0, 0, 0);
  if (next <= ist.getTime()) next += 24 * 60 * 60 * 1000;
  return next - ist.getTime();
}

export function startCareScheduler(): void {
  const schedule = () => {
    timer = setTimeout(async () => {
      try {
        await runJournalDigest();
      } catch (error) {
        logger.error('Care journal digest failed', {}, error);
      }
      schedule();
    }, millisecondsUntilNextDigestHour());
    timer.unref();
  };
  schedule();
  logger.info('Care journal scheduler started', { time: `${DIGEST_HOUR_IST}:00`, timeZone: 'Asia/Kolkata' });
}

export function stopCareScheduler(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
