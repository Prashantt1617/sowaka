import { randomUUID } from 'node:crypto';
import { companies, gardenNotes, users } from '../config/db';
import {
  GARDEN_DAILY_LIMIT,
  GARDEN_KINDS,
  GARDEN_NOTE_MAX,
  GardenKind,
  GardenNote,
  KIND_MEANING,
} from '../models/garden.model';
import { User } from '../models/user.model';
import { resolveProfilePhoto } from './s3-connect-media.service';

export class GardenError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'GardenError';
  }
}

const TIMEZONE = 'Asia/Kolkata';

/** 'YYYY-MM' of now, in India time: the season the garden is in. */
export function currentSeason(at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit' }).formatToParts(at);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}`;
}

/** 'YYYY-MM-DD' of now, in India time, for the daily allowance. */
function todayKey(at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function startOfTodayIst(): Date {
  const key = todayKey();
  // Midnight IST is 18:30 UTC the day before.
  return new Date(`${key}T00:00:00+05:30`);
}

/** The person, provided their company shows the Games tab. */
async function requireGardener(userId: string): Promise<User & { org: string }> {
  const user = await users().findOne({ userId });
  if (!user) throw new GardenError(404, 'User not found');
  const company = user.org ? await companies().findOne({ id: user.org }) : null;
  if (!company?.enabledTabs?.includes('games')) {
    throw new GardenError(403, 'The garden is not available for your company');
  }
  return user as User & { org: string };
}

const ACTIVE = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as const;

export interface GardenPerson {
  userId: string;
  name: string;
  department: string;
  photoUrl?: string;
  isMe: boolean;
}

export interface GardenSprite {
  id: string;
  kind: GardenKind;
  fromUserId: string;
}

export interface GardenView {
  season: string;
  /** Days left before the garden clears. */
  daysLeft: number;
  people: GardenPerson[];
  /** Per tree, what is on it this season. Keyed by userId. */
  trees: Record<string, GardenSprite[]>;
  kinds: typeof KIND_MEANING;
  givenToday: number;
  dailyLimit: number;
}

function daysLeftInSeason(): number {
  const [y, m] = currentSeason().split('-').map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1));
  const today = new Date(`${todayKey()}T00:00:00Z`);
  return Math.max(0, Math.round((nextMonth.getTime() - today.getTime()) / 86_400_000));
}

async function peopleOf(org: string, viewerId: string): Promise<GardenPerson[]> {
  const rows = await users()
    .find({ org, ...ACTIVE })
    .project<Pick<User, 'userId' | 'name' | 'department' | 'designation' | 'profilePhotoKey' | 'profilePhotoUrl'>>({
      userId: 1, name: 1, department: 1, designation: 1, profilePhotoKey: 1, profilePhotoUrl: 1,
    })
    .sort({ name: 1 })
    .toArray();
  return Promise.all(
    rows.map(async (row) => ({
      userId: row.userId,
      name: row.name,
      department: row.department ?? row.designation ?? '',
      photoUrl: await resolveProfilePhoto(row),
      isMe: row.userId === viewerId,
    })),
  );
}

export async function gardenFor(viewerId: string): Promise<GardenView> {
  const viewer = await requireGardener(viewerId);
  const season = currentSeason();
  const [people, notes, givenToday] = await Promise.all([
    peopleOf(viewer.org, viewerId),
    gardenNotes().find({ org: viewer.org, season, removedAt: { $exists: false } }).sort({ createdAt: 1 }).toArray(),
    gardenNotes().countDocuments({ fromUserId: viewerId, createdAt: { $gte: startOfTodayIst() } }),
  ]);
  const trees: Record<string, GardenSprite[]> = {};
  for (const person of people) trees[person.userId] = [];
  for (const note of notes) {
    (trees[note.toUserId] ??= []).push({ id: note.id, kind: note.kind, fromUserId: note.fromUserId });
  }
  return { season, daysLeft: daysLeftInSeason(), people, trees, kinds: KIND_MEANING, givenToday, dailyLimit: GARDEN_DAILY_LIMIT };
}

export interface NoteView {
  id: string;
  kind: GardenKind;
  kindName: string;
  meaning: string;
  note: string;
  from: { userId: string; name: string; photoUrl?: string };
  to: { userId: string; name: string; photoUrl?: string };
  createdAt: string;
  /** The viewer may take it off: it is on their own tree. */
  removable: boolean;
}

async function namesFor(ids: string[]): Promise<Map<string, { name: string; photoUrl?: string }>> {
  const rows = await users()
    .find({ userId: { $in: [...new Set(ids)] } })
    .project<Pick<User, 'userId' | 'name' | 'profilePhotoKey' | 'profilePhotoUrl'>>({ userId: 1, name: 1, profilePhotoKey: 1, profilePhotoUrl: 1 })
    .toArray();
  return new Map(await Promise.all(rows.map(async (row) => [row.userId, { name: row.name, photoUrl: await resolveProfilePhoto(row) }] as const)));
}

async function toNoteViews(notes: GardenNote[], viewerId: string): Promise<NoteView[]> {
  const names = await namesFor(notes.flatMap((n) => [n.fromUserId, n.toUserId]));
  const who = (id: string) => ({ userId: id, name: names.get(id)?.name ?? 'Someone', photoUrl: names.get(id)?.photoUrl });
  return notes.map((n) => ({
    id: n.id,
    kind: n.kind,
    kindName: KIND_MEANING[n.kind].name,
    meaning: KIND_MEANING[n.kind].meaning,
    note: n.note,
    from: who(n.fromUserId),
    to: who(n.toUserId),
    createdAt: n.createdAt.toISOString(),
    removable: n.toUserId === viewerId,
  }));
}

/** One person's tree: every note on it this season, oldest first. */
export async function treeFor(viewerId: string, userId: string): Promise<{ person: GardenPerson; notes: NoteView[] }> {
  const viewer = await requireGardener(viewerId);
  const person = await users().findOne({ userId, org: viewer.org, ...ACTIVE });
  if (!person) throw new GardenError(404, 'Nobody by that name in your garden');
  const notes = await gardenNotes()
    .find({ org: viewer.org, toUserId: userId, season: currentSeason(), removedAt: { $exists: false } })
    .sort({ createdAt: 1 })
    .toArray();
  return {
    person: {
      userId: person.userId,
      name: person.name,
      department: person.department ?? person.designation ?? '',
      photoUrl: await resolveProfilePhoto(person),
      isMe: person.userId === viewerId,
    },
    notes: await toNoteViews(notes, viewerId),
  };
}

/** The whole company's gratitude this season, newest first. */
export async function timelineFor(viewerId: string, limit = 200): Promise<NoteView[]> {
  const viewer = await requireGardener(viewerId);
  const notes = await gardenNotes()
    .find({ org: viewer.org, season: currentSeason(), removedAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return toNoteViews(notes, viewerId);
}

export async function giveNote(
  viewerId: string,
  input: { toUserId: string; kind: string; note: string },
): Promise<NoteView> {
  const viewer = await requireGardener(viewerId);
  const kind = input.kind.trim() as GardenKind;
  if (!GARDEN_KINDS.includes(kind)) throw new GardenError(400, 'Pick a flower or a fruit');
  const note = input.note.trim();
  if (!note) throw new GardenError(400, 'Write a few words');
  if (note.length > GARDEN_NOTE_MAX) throw new GardenError(400, `Keep it under ${GARDEN_NOTE_MAX} characters`);
  const receiver = await users().findOne({ userId: input.toUserId, org: viewer.org, ...ACTIVE });
  if (!receiver) throw new GardenError(404, 'Nobody by that name in your garden');

  const since = startOfTodayIst();
  const [today, toThemToday] = await Promise.all([
    gardenNotes().countDocuments({ fromUserId: viewerId, createdAt: { $gte: since } }),
    gardenNotes().countDocuments({ fromUserId: viewerId, toUserId: receiver.userId, createdAt: { $gte: since } }),
  ]);
  if (today >= GARDEN_DAILY_LIMIT) {
    throw new GardenError(429, `That is ${GARDEN_DAILY_LIMIT} for today. The garden opens again tomorrow.`);
  }
  if (toThemToday >= 1) {
    throw new GardenError(429, `You have already added to ${receiver.userId === viewerId ? 'your own' : receiver.name + '’s'} tree today`);
  }
  const record: GardenNote = {
    id: randomUUID(),
    org: viewer.org,
    fromUserId: viewerId,
    toUserId: receiver.userId,
    kind,
    note,
    season: currentSeason(),
    createdAt: new Date(),
  };
  await gardenNotes().insertOne(record);
  return (await toNoteViews([record], viewerId))[0];
}

/** The receiver takes a note off their tree; it leaves the timeline too. */
export async function removeNote(viewerId: string, noteId: string): Promise<void> {
  await requireGardener(viewerId);
  const result = await gardenNotes().updateOne(
    { id: noteId, toUserId: viewerId, removedAt: { $exists: false } },
    { $set: { removedAt: new Date() } },
  );
  if (result.matchedCount === 0) throw new GardenError(404, 'That is not on your tree');
}
