import { companies, users } from '../config/db';
import {
  closestMatch,
  HelpIntakeInput,
  MatchableCounsellor,
  matchReasons,
  normaliseIntake,
  rankMatches,
  unmetPreferences,
} from '../models/help.model';
import { HelpIntake, HelpMatch, User } from '../models/user.model';
import {
  CounsellorView,
  counsellorRows,
  listMySessions,
  SessionView,
  toCounsellorView, sessionAwaitingReview } from './talk.service';

/**
 * Help: a matched counsellor first, chosen from the person's own answers.
 *
 * The intake runs once, on the first open of Help, and can be edited from
 * Help home. Its answers and the match sit on the person's record. Booking
 * someone else never changes the match; only new answers or Sowaka do.
 */
export class HelpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HelpError';
  }
}

export interface HelpIntakeView extends HelpIntakeInput {
  answeredAt: string;
}

export interface HelpMatchView {
  counsellor: CounsellorView;
  reasons: string[];
  unmet: string[];
  source: HelpMatch['source'];
}

export interface HelpHomeView {
  /** False until the intake has been answered (or skipped through) once. */
  intakeDone: boolean;
  match: HelpMatchView | null;
  /**
   * Set when the answers fit nobody: the closest counsellor and what they do
   * not meet, so the person can accept them anyway or change the answers.
   */
  noMatch: { counsellor: CounsellorView; unmet: string[]; reasons: string[] } | null;
  upcoming: SessionView | null;
  /** A session that finished recently and has not been spoken about yet. */
  awaitingReview: SessionView | null;
  /** Sessions had, with anyone, newest first. */
  history: SessionView[];
}

/** The person, provided their company shows Help (the 'talk' tab). */
async function requireHelpUser(userId: string): Promise<User & { org: string }> {
  const user = await users().findOne({ userId });
  if (!user) throw new HelpError(404, 'User not found');
  const company = user.org ? await companies().findOne({ id: user.org }) : null;
  if (!company?.enabledTabs?.includes('talk')) {
    throw new HelpError(403, 'Help is not available for your company');
  }
  return user as User & { org: string };
}

function intakeInput(intake: HelpIntake): HelpIntakeInput {
  const { answeredAt: _answeredAt, ...rest } = intake;
  return rest;
}

function toIntakeView(intake: HelpIntake): HelpIntakeView {
  return { ...intakeInput(intake), answeredAt: intake.answeredAt.toISOString() };
}

async function pool(): Promise<MatchableCounsellor[]> {
  return counsellorRows();
}

/** Who a person is matched with, re-read each time so a renamed profile shows. */
async function matchView(user: User, rows: MatchableCounsellor[]): Promise<HelpMatchView | null> {
  const match = user.helpMatch;
  if (!match) return null;
  const row = rows.find((r) => r.userId === match.counsellorUserId);
  if (!row) return null;
  return {
    counsellor: await toCounsellorView(row as Parameters<typeof toCounsellorView>[0]),
    reasons: match.reasons,
    unmet: match.unmet,
    source: match.source,
  };
}

async function noMatchView(user: User, rows: MatchableCounsellor[]) {
  if (user.helpMatch || !user.helpIntake) return null;
  const input = intakeInput(user.helpIntake);
  const closest = closestMatch(input, rows);
  if (!closest) return null;
  return {
    counsellor: await toCounsellorView(closest as Parameters<typeof toCounsellorView>[0]),
    unmet: unmetPreferences(input, closest),
    reasons: matchReasons(input, closest),
  };
}

export async function helpHome(viewerUserId: string): Promise<HelpHomeView> {
  const user = await requireHelpUser(viewerUserId);
  const rows = await pool();
  const [sessions, awaitingReview] = await Promise.all([
    listMySessions(viewerUserId),
    sessionAwaitingReview(viewerUserId),
  ]);
  return {
    intakeDone: Boolean(user.helpIntake),
    match: await matchView(user, rows),
    noMatch: await noMatchView(user, rows),
    upcoming: sessions.upcoming[0] ?? null,
    awaitingReview,
    history: sessions.past,
  };
}

export async function getIntake(viewerUserId: string): Promise<HelpIntakeView | null> {
  const user = await requireHelpUser(viewerUserId);
  return user.helpIntake ? toIntakeView(user.helpIntake) : null;
}

/**
 * Saves the answers and sets the match from them. When nobody fits, the match
 * is cleared rather than bent: the response carries the closest counsellor
 * and what they do not meet, and the person decides.
 */
export async function saveIntake(
  viewerUserId: string,
  raw: Partial<Record<keyof HelpIntakeInput, unknown>>,
): Promise<Pick<HelpHomeView, 'match' | 'noMatch'> & { intake: HelpIntakeView }> {
  await requireHelpUser(viewerUserId);
  const input = normaliseIntake(raw);
  const now = new Date();
  const intake: HelpIntake = { ...input, answeredAt: now };
  const rows = await pool();
  const best = rankMatches(input, rows)[0] ?? null;
  const match: HelpMatch | undefined = best
    ? { counsellorUserId: best.userId, reasons: matchReasons(input, best), unmet: [], source: 'intake', setAt: now }
    : undefined;
  await users().updateOne(
    { userId: viewerUserId },
    match
      ? { $set: { helpIntake: intake, helpMatch: match, updatedAt: now } }
      : { $set: { helpIntake: intake, updatedAt: now }, $unset: { helpMatch: '' } },
  );
  const user = { helpIntake: intake, helpMatch: match } as User;
  return {
    intake: toIntakeView(intake),
    match: await matchView(user, rows),
    noMatch: await noMatchView(user, rows),
  };
}

/**
 * "Show me who is available anyway": the person accepts a counsellor who does
 * not meet every preference. Recorded as such, with what went unmet, so the
 * profile can say so honestly.
 */
export async function acceptCounsellor(viewerUserId: string, counsellorUserId: string): Promise<HelpMatchView> {
  const user = await requireHelpUser(viewerUserId);
  if (!user.helpIntake) throw new HelpError(400, 'Answer the questions first');
  const rows = await pool();
  const row = rows.find((r) => r.userId === counsellorUserId);
  if (!row) throw new HelpError(404, 'Counsellor not found');
  const input = intakeInput(user.helpIntake);
  const unmet = unmetPreferences(input, row);
  const now = new Date();
  const match: HelpMatch = {
    counsellorUserId,
    reasons: matchReasons(input, row),
    unmet,
    source: unmet.length ? 'fallback' : 'intake',
    setAt: now,
  };
  await users().updateOne({ userId: viewerUserId }, { $set: { helpMatch: match, updatedAt: now } });
  return (await matchView({ ...user, helpMatch: match }, rows))!;
}

export interface CounsellorDetailView {
  counsellor: CounsellorView;
  /** This is the person's matched counsellor. */
  matched: boolean;
  /** Why, when matched; how they fit the answers otherwise. */
  reasons: string[];
  unmet: string[];
  /** The person's sessions with this counsellor. */
  sessions: { upcoming: SessionView[]; past: SessionView[] };
}

export async function counsellorDetail(viewerUserId: string, counsellorUserId: string): Promise<CounsellorDetailView> {
  const user = await requireHelpUser(viewerUserId);
  const rows = await pool();
  const row = rows.find((r) => r.userId === counsellorUserId);
  if (!row) throw new HelpError(404, 'Counsellor not found');
  const matched = user.helpMatch?.counsellorUserId === counsellorUserId;
  const input = user.helpIntake ? intakeInput(user.helpIntake) : null;
  const all = await listMySessions(viewerUserId);
  const withThem = (list: SessionView[]) => list.filter((s) => s.counsellor.userId === counsellorUserId);
  return {
    counsellor: await toCounsellorView(row as Parameters<typeof toCounsellorView>[0]),
    matched,
    reasons: matched && user.helpMatch ? user.helpMatch.reasons : input ? matchReasons(input, row) : [],
    unmet: matched && user.helpMatch ? user.helpMatch.unmet : input ? unmetPreferences(input, row) : [],
    sessions: { upcoming: withThem(all.upcoming), past: withThem(all.past) },
  };
}
