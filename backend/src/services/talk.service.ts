import { randomUUID } from 'node:crypto';
import { companies, talkSessions, users } from '../config/db';
import {
  SESSION_FEELINGS, SESSION_NOTE_MAX, SESSION_REVIEW_WINDOW_DAYS,
  SessionFeeling, TALK_BOOKING_HORIZON_DAYS, TalkSession,
} from '../models/talk.model';
import { CounsellorProfile, User } from '../models/user.model';
import { HELP_TOPICS } from '../models/help.model';
import { resolveProfilePhoto } from './s3-connect-media.service';
import { env } from '../config/env';
import { createZoomMeeting, ZoomError } from './zoom.service';

/**
 * Talk: booking a counselling session.
 *
 * Counsellors are one pool across every company; a Toyota employee books a
 * Sowaka counsellor. What a person may do is decided by their own company
 * having the Talk tab, and a counsellor is anyone flagged as one.
 */
export class TalkError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'TalkError';
  }
}

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export interface CounsellorView {
  userId: string;
  name: string;
  headline: string;
  photoUrl?: string;
  slotMinutes: number;
  /** The Help profile. Empty strings and lists where nothing was set. */
  about: string;
  yearsExperience: number | null;
  languages: string[];
  /** Topic ids the counsellor works with, with their labels for chips. */
  focusAreas: string[];
  focusLabels: string[];
  ageRange: string;
  gender: string;
}

export interface SlotView {
  startsAt: string;
  endsAt: string;
  /** 'HH:mm' in the counsellor's timezone, for the chip. */
  label: string;
  /** Who is free then. Empty slots are not sent. */
  counsellorIds: string[];
}

export interface SessionView {
  id: string;
  counsellor: {
    userId: string; name: string; headline: string; photoUrl?: string;
    /** The rest of the person, so a session can show the same card the list does. */
    yearsExperience?: number | null; languages?: string[]; focusLabels?: string[];
  };
  startsAt: string;
  endsAt: string;
  status: TalkSession['status'];
  joinUrl?: string;
  /** The link is a stand-in from a machine with no Zoom credentials. */
  placeholderLink: boolean;
  /** What they said just before joining, once they have. */
  checkIn?: { feeling: SessionFeeling; note?: string };
  /** What they made of it afterwards, once they have said. */
  review?: { rating: number; note?: string };
}

/** The person, provided their company shows Talk. */
async function requireTalkUser(userId: string): Promise<User & { org: string }> {
  const user = await users().findOne({ userId });
  if (!user) throw new TalkError(404, 'User not found');
  const company = user.org ? await companies().findOne({ id: user.org }) : null;
  if (!company?.enabledTabs?.includes('talk')) {
    throw new TalkError(403, 'Talk is not available for your company');
  }
  return user as User & { org: string };
}

export type CounsellorRow = User & { counsellor: CounsellorProfile };

export async function counsellorRows(): Promise<CounsellorRow[]> {
  const rows = await users()
    .find({ isCounsellor: true, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } })
    .sort({ name: 1 })
    .toArray();
  // A counsellor without a profile has nothing to book; they are left out
  // rather than shown with no hours.
  return rows.flatMap((row) => (row.counsellor ? [row as CounsellorRow] : []));
}

export async function toCounsellorView(row: CounsellorRow): Promise<CounsellorView> {
  const profile = row.counsellor;
  const focusAreas = profile.focusAreas ?? [];
  return {
    userId: row.userId,
    name: row.name,
    headline: profile.headline ?? row.designation ?? 'Counsellor',
    photoUrl: await resolveProfilePhoto(row),
    slotMinutes: profile.slotMinutes,
    about: profile.about ?? '',
    yearsExperience: profile.yearsExperience ?? null,
    languages: profile.languages ?? [],
    focusAreas,
    focusLabels: focusAreas.map((id) => HELP_TOPICS.find((t) => t.id === id)?.label ?? id),
    ageRange: profile.ageRange ?? '',
    gender: profile.gender ?? '',
  };
}

export async function listCounsellors(viewerUserId: string): Promise<CounsellorView[]> {
  await requireTalkUser(viewerUserId);
  return Promise.all((await counsellorRows()).map(toCounsellorView));
}

// ---------------------------------------------------------------------------
// Time. Working hours are wall-clock in the counsellor's zone; sessions are
// stored as instants. Intl does the conversion so no library is needed and
// zones with daylight saving still come out right.

function wallClockToUtc(date: string, time: string, timeZone: string): Date {
  const naive = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(naive);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const shownAsUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return new Date(naive.getTime() - (shownAsUtc - naive.getTime()));
}

/** 'YYYY-MM-DD' of an instant in a zone. */
function dateInZone(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function timeInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

function addDays(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

/**
 * The days someone may book: tomorrow through the horizon, in the counsellor's
 * zone. Today is out — a session needs a little notice on both sides.
 */
function bookableRange(timeZone: string): { first: string; last: string } {
  const today = dateInZone(new Date(), timeZone);
  return { first: addDays(today, 1), last: addDays(today, TALK_BOOKING_HORIZON_DAYS) };
}

/** Every slot in a counsellor's hours on a date, booked or not. */
function slotsInHours(counsellor: CounsellorProfile, date: string): { startsAt: Date; endsAt: Date }[] {
  const timeZone = counsellor.timezone || DEFAULT_TIMEZONE;
  const weekday = weekdayOf(date);
  const length = counsellor.slotMinutes * 60_000;
  const slots: { startsAt: Date; endsAt: Date }[] = [];
  for (const hours of counsellor.workingHours.filter((row) => row.weekday === weekday)) {
    const open = wallClockToUtc(date, hours.start, timeZone).getTime();
    const close = wallClockToUtc(date, hours.end, timeZone).getTime();
    for (let start = open; start + length <= close; start += length) {
      slots.push({ startsAt: new Date(start), endsAt: new Date(start + length) });
    }
  }
  return slots;
}

/**
 * Who is free when, on one day. Both wizards read this: "choose a counsellor"
 * keeps the slots naming their pick, "book a slot" shows every time and then
 * who is free at the chosen one.
 */
export async function availabilityOn(viewerUserId: string, date: string): Promise<{ date: string; slots: SlotView[] }> {
  await requireTalkUser(viewerUserId);
  if (!isIsoDate(date)) throw new TalkError(400, 'Date must be YYYY-MM-DD');
  const range = bookableRange(DEFAULT_TIMEZONE);
  if (date < range.first || date > range.last) return { date, slots: [] };

  const rows = await counsellorRows();
  if (rows.length === 0) return { date, slots: [] };
  const dayStart = wallClockToUtc(date, '00:00', DEFAULT_TIMEZONE);
  const dayEnd = wallClockToUtc(addDays(date, 1), '00:00', DEFAULT_TIMEZONE);
  const taken = await talkSessions()
    .find({
      counsellorUserId: { $in: rows.map((row) => row.userId) },
      status: 'booked',
      startsAt: { $gte: dayStart, $lt: dayEnd },
    })
    .project<{ counsellorUserId: string; startsAt: Date }>({ counsellorUserId: 1, startsAt: 1 })
    .toArray();
  const takenKeys = new Set(taken.map((row) => `${row.counsellorUserId}|${row.startsAt.getTime()}`));

  const byStart = new Map<number, SlotView>();
  for (const row of rows) {
    for (const slot of slotsInHours(row.counsellor, date)) {
      if (takenKeys.has(`${row.userId}|${slot.startsAt.getTime()}`)) continue;
      const key = slot.startsAt.getTime();
      const view =
        byStart.get(key) ??
        ({
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          label: timeInZone(slot.startsAt, row.counsellor.timezone || DEFAULT_TIMEZONE),
          counsellorIds: [],
        } satisfies SlotView);
      view.counsellorIds.push(row.userId);
      byStart.set(key, view);
    }
  }
  return {
    date,
    slots: [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, view]) => view),
  };
}

// ---------------------------------------------------------------------------

async function toSessionView(session: TalkSession, counsellor: User | null): Promise<SessionView> {
  const now = Date.now();
  // Completed is a reading, not a write: once the end has passed the session
  // is over whatever the record says.
  const status = session.status === 'booked' && session.endsAt.getTime() < now ? 'completed' : session.status;
  return {
    id: session.id,
    counsellor: {
      userId: session.counsellorUserId,
      name: counsellor?.name ?? 'Counsellor',
      headline: counsellor?.counsellor?.headline ?? counsellor?.designation ?? 'Counsellor',
      photoUrl: await resolveProfilePhoto(counsellor),
      yearsExperience: counsellor?.counsellor?.yearsExperience ?? null,
      languages: counsellor?.counsellor?.languages ?? [],
      focusLabels: (counsellor?.counsellor?.focusAreas ?? []).map(
        (id) => HELP_TOPICS.find((t) => t.id === id)?.label ?? id,
      ),
    },
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    status,
    // The join link is the client's; the host link never leaves the server.
    joinUrl: status === 'cancelled' ? undefined : session.zoom?.joinUrl,
    placeholderLink: session.zoom?.placeholder === true,
    ...(session.checkIn ? { checkIn: { feeling: session.checkIn.feeling, note: session.checkIn.note } } : {}),
    ...(session.review ? { review: { rating: session.review.rating, note: session.review.note } } : {}),
  };
}

/**
 * "How did you feel about the session?" answered afterwards: a rating out of
 * five and, if they like, a few words. One per session; asked again it is
 * replaced.
 */
export async function reviewSession(
  viewerUserId: string,
  sessionId: string,
  input: { rating: unknown; note?: string },
): Promise<SessionView> {
  await requireTalkUser(viewerUserId);
  const rating = Math.trunc(Number(input.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw new TalkError(400, 'Rate the session from one to five');
  const note = (input.note ?? '').trim();
  if (note.length > SESSION_NOTE_MAX) throw new TalkError(400, `Keep it under ${SESSION_NOTE_MAX} characters`);
  const session = await talkSessions().findOne({ id: sessionId, clientUserId: viewerUserId });
  if (!session) throw new TalkError(404, 'Session not found');
  if (session.status === 'cancelled') throw new TalkError(409, 'That session was cancelled');
  if (session.endsAt.getTime() > Date.now()) throw new TalkError(409, 'That session has not happened yet');
  const review = { rating, ...(note ? { note } : {}), at: new Date() };
  await talkSessions().updateOne({ id: session.id }, { $set: { review, updatedAt: new Date() } });
  const counsellor = await users().findOne({ userId: session.counsellorUserId });
  return toSessionView({ ...session, review }, counsellor);
}

/**
 * The session that finished recently and has not been spoken about yet, if
 * there is one. Older than the window, the question is dropped rather than
 * kept asking.
 */
export async function sessionAwaitingReview(viewerUserId: string): Promise<SessionView | null> {
  await requireTalkUser(viewerUserId);
  const since = new Date(Date.now() - SESSION_REVIEW_WINDOW_DAYS * 86_400_000);
  const session = await talkSessions().findOne(
    {
      clientUserId: viewerUserId,
      status: { $ne: 'cancelled' },
      review: { $exists: false },
      endsAt: { $lte: new Date(), $gte: since },
    },
    { sort: { endsAt: -1 } },
  );
  if (!session) return null;
  const counsellor = await users().findOne({ userId: session.counsellorUserId });
  return toSessionView(session, counsellor);
}

/**
 * "How are you feeling?" answered just before joining. One answer per
 * session; asked again it is replaced. Only the person who booked may say,
 * and only while the session is still to come or under way.
 */
export async function checkInSession(
  viewerUserId: string,
  sessionId: string,
  input: { feeling: string; note?: string },
): Promise<SessionView> {
  await requireTalkUser(viewerUserId);
  const feeling = input.feeling.trim() as SessionFeeling;
  if (!(SESSION_FEELINGS as readonly string[]).includes(feeling)) throw new TalkError(400, 'Pick how you are feeling');
  const note = (input.note ?? '').trim();
  if (note.length > SESSION_NOTE_MAX) throw new TalkError(400, `Keep it under ${SESSION_NOTE_MAX} characters`);
  const session = await talkSessions().findOne({ id: sessionId, clientUserId: viewerUserId });
  if (!session) throw new TalkError(404, 'Session not found');
  if (session.status !== 'booked') throw new TalkError(409, 'That session is not on');
  if (session.endsAt.getTime() < Date.now()) throw new TalkError(409, 'That session has ended');
  const checkIn = { feeling, ...(note ? { note } : {}), at: new Date() };
  await talkSessions().updateOne({ id: session.id }, { $set: { checkIn, updatedAt: new Date() } });
  const counsellor = await users().findOne({ userId: session.counsellorUserId });
  return toSessionView({ ...session, checkIn }, counsellor);
}

export async function listMySessions(viewerUserId: string): Promise<{ upcoming: SessionView[]; past: SessionView[] }> {
  await requireTalkUser(viewerUserId);
  const rows = await talkSessions().find({ clientUserId: viewerUserId }).sort({ startsAt: -1 }).toArray();
  const counsellorIds = [...new Set(rows.map((row) => row.counsellorUserId))];
  const counsellors = await users().find({ userId: { $in: counsellorIds } }).toArray();
  const byId = new Map(counsellors.map((row) => [row.userId, row]));
  const views = await Promise.all(rows.map((row) => toSessionView(row, byId.get(row.counsellorUserId) ?? null)));
  const now = Date.now();
  return {
    upcoming: views
      .filter((view) => view.status === 'booked' && new Date(view.endsAt).getTime() >= now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    past: views.filter((view) => !(view.status === 'booked' && new Date(view.endsAt).getTime() >= now)),
  };
}

export async function bookSession(
  viewerUserId: string,
  input: { counsellorUserId: string; startsAt: string },
): Promise<SessionView> {
  const client = await requireTalkUser(viewerUserId);
  const counsellor = await users().findOne({ userId: input.counsellorUserId, isCounsellor: true });
  if (!counsellor?.counsellor) throw new TalkError(404, 'Counsellor not found');
  if (counsellor.userId === viewerUserId) throw new TalkError(400, 'You cannot book yourself');
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw new TalkError(400, 'startsAt must be an ISO time');

  const timeZone = counsellor.counsellor.timezone || DEFAULT_TIMEZONE;
  const date = dateInZone(startsAt, timeZone);
  const range = bookableRange(timeZone);
  if (date < range.first || date > range.last) {
    throw new TalkError(400, `Sessions can be booked from tomorrow up to ${TALK_BOOKING_HORIZON_DAYS} days ahead`);
  }
  const slot = slotsInHours(counsellor.counsellor, date).find(
    (candidate) => candidate.startsAt.getTime() === startsAt.getTime(),
  );
  if (!slot) throw new TalkError(400, 'That time is outside the counsellor’s hours');

  const now = new Date();
  const existing = await talkSessions().findOne({
    clientUserId: viewerUserId,
    status: 'booked',
    endsAt: { $gte: now },
  });
  if (existing) throw new TalkError(409, 'You already have a session coming up. One at a time.');

  const clash = await talkSessions().findOne({
    counsellorUserId: counsellor.userId,
    status: 'booked',
    startsAt: slot.startsAt,
  });
  if (clash) throw new TalkError(409, 'That slot has just been taken. Pick another.');

  // Zoom first, the record second: a refusal from Zoom leaves nothing behind.
  // It is reported as a failed dependency with its own words, not as a server
  // fault, because the person can act on it (try again, or tell Sowaka).
  const zoom = await createZoomMeeting({
    // The counsellor's own Zoom user where they have one; the account's
    // host otherwise. An empty profile value means "not their own".
    hostUserId: counsellor.counsellor.zoomUserId || env.zoom.hostUser,
    topic: `Counselling session with ${counsellor.name}`,
    startsAt: slot.startsAt,
    durationMinutes: counsellor.counsellor.slotMinutes,
    timezone: timeZone,
  }).catch((error: unknown) => {
    if (error instanceof ZoomError) throw new TalkError(424, `${error.message}. Nothing was booked.`);
    throw error;
  });

  const session: TalkSession = {
    id: randomUUID(),
    clientUserId: viewerUserId,
    clientOrg: client.org,
    counsellorUserId: counsellor.userId,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    status: 'booked',
    zoom: {
      meetingId: zoom.meetingId,
      joinUrl: zoom.joinUrl,
      startUrl: zoom.startUrl,
      ...(zoom.placeholder ? { placeholder: true } : {}),
    },
    createdAt: now,
    updatedAt: now,
  };
  try {
    await talkSessions().insertOne(session);
  } catch (error) {
    // The unique index caught a race the check above did not.
    if ((error as { code?: number }).code === 11000) {
      throw new TalkError(409, 'That slot has just been taken. Pick another.');
    }
    throw error;
  }
  return toSessionView(session, counsellor);
}
