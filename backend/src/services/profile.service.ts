import { attendanceRecords, users } from '../config/db';
import type { User, UserLifecycleStatus } from '../models/user.model';
import {
  groupActivity,
  monthBounds,
  monthKey,
  placesMoved,
  podiumOf,
  rankByPoints,
  type Contender,
  type RankedEntry,
} from './leaderboard';
import { buildOrgChart, ManagerError, reportsUpTo } from './manager.service';
import { pointEvents } from './points-ledger.service';
import { resolveProfilePhoto } from './s3-connect-media.service';

/** Gone from the company, and so from every list of it. */
const inactive: UserLifecycleStatus[] = ['offboarded', 'terminated'];

/**
 * The people a leaderboard ranks: everyone still employed in the viewer's own
 * company. Counsellors are one pool across every company, not its employees,
 * so they are left out. A viewer with no org is ranked alone rather than
 * against an unscoped query — the same rule the workspace follows. Also the
 * Games tab's leaderboard (`games-home.service.ts`).
 */
export async function rosterFor(viewer: User, extraFields: Partial<Record<keyof User, 1>> = {}) {
  if (!viewer.org) return [viewer];
  return users()
    .find(
      { org: viewer.org, lifecycleStatus: { $nin: inactive }, isCounsellor: { $ne: true } },
      { projection: { _id: 0, userId: 1, name: 1, points: 1, org: 1, ...extraFields } },
    )
    .toArray();
}

async function requireViewer(viewerUserId: string): Promise<User> {
  const viewer = await users().findOne({ userId: viewerUserId }, { projection: { _id: 0, profilePhotoUrl: 0 } });
  if (!viewer) throw new ManagerError(404, 'User not found');
  return viewer;
}

/** Photos for the few rows that show one, resolved in one go. */
async function photosFor(userIds: string[]): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map();
  const rows = await users()
    .find(
      { userId: { $in: userIds } },
      { projection: { _id: 0, userId: 1, profilePhotoKey: 1, profilePhotoUrl: 1 } },
    )
    .toArray();
  const resolved = await Promise.all(
    rows.map(async (row) => [row.userId, (await resolveProfilePhoto(row)) ?? null] as const),
  );
  return new Map(resolved);
}

export interface LeaderboardPerson extends RankedEntry {
  photoUrl: string | null;
}

/**
 * The company's leaderboard by engagement points.
 *
 * `entries` is everyone, ranked; the podium and the people named (the viewer,
 * and whoever's profile it is) also carry a photo, which is all the screen
 * draws one for.
 */
export async function getLeaderboard(viewerUserId: string, subjectUserId?: string) {
  const viewer = await requireViewer(viewerUserId);
  const roster: Contender[] = await rosterFor(viewer);
  const ranked = rankByPoints(roster);
  const podium = podiumOf(ranked);
  const find = (userId: string | undefined) =>
    userId ? ranked.find((entry) => entry.userId === userId) ?? null : null;
  const own = find(viewer.userId);
  // Someone outside the viewer's company, or gone, is simply not on it.
  const subject = subjectUserId && subjectUserId !== viewer.userId ? find(subjectUserId) : null;
  const photos = await photosFor(
    [...new Set([...podium.map((entry) => entry.userId), own?.userId, subject?.userId])].filter(
      (id): id is string => Boolean(id),
    ),
  );
  const withPhoto = (entry: RankedEntry | null): LeaderboardPerson | null =>
    entry ? { ...entry, photoUrl: photos.get(entry.userId) ?? null } : null;

  return {
    total: ranked.length,
    viewer: withPhoto(own),
    subject: withPhoto(subject),
    podium: podium.map((entry) => withPhoto(entry)!),
    entries: ranked,
  };
}

/**
 * Someone's standing and a month of where their points came from: the
 * viewer's own, or — with `subjectUserId` — a colleague's in the same company,
 * for the Rank tab on their profile.
 *
 * Read only from the ledger, which starts the day it was added: points earned
 * before then are in the balance but have no activity behind them.
 */
export async function getPointsActivity(
  viewerUserId: string,
  monthInput?: string,
  subjectUserId?: string,
) {
  const self = await requireViewer(viewerUserId);
  const viewer =
    subjectUserId && subjectUserId !== self.userId
      ? await users().findOne(
          { userId: subjectUserId, org: self.org ?? '\0', lifecycleStatus: { $nin: inactive } },
          { projection: { _id: 0, profilePhotoUrl: 0 } },
        )
      : self;
  if (!viewer) throw new ManagerError(404, 'Person not found');
  const current = monthKey(new Date());
  const month = monthInput && monthBounds(monthInput) ? monthInput : current;
  const bounds = monthBounds(month)!;

  const roster = await rosterFor(viewer);
  const ranked = rankByPoints(roster);
  const own = ranked.find((entry) => entry.userId === viewer.userId);

  const photoFuture = users()
    .findOne({ userId: viewer.userId }, { projection: { _id: 0, profilePhotoKey: 1, profilePhotoUrl: 1 } })
    .then(resolveProfilePhoto);
  const [events, monthsWithActivity, earnedThisMonth, photo] = await Promise.all([
    pointEvents()
      .find({ userId: viewer.userId, createdAt: { $gte: bounds.start, $lt: bounds.end } })
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray(),
    pointEvents()
      .aggregate<{ _id: string }>([
        { $match: { userId: viewer.userId } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } } } },
      ])
      .toArray(),
    // Everyone's net change this month, to re-rank the company as it stood on
    // the first and say how far the viewer has moved since.
    viewer.org
      ? pointEvents()
          .aggregate<{ _id: string; delta: number }>([
            { $match: { org: viewer.org, createdAt: { $gte: monthBounds(current)!.start } } },
            { $group: { _id: '$userId', delta: { $sum: '$delta' } } },
          ])
          .toArray()
      : Promise.resolve([]),
    photoFuture,
  ]);

  const activity = groupActivity(events);
  // The last six months are always offered, so the month filter always has
  // somewhere to go, plus any older month that has activity.
  const recent = Array.from({ length: 6 }, (_, back) => {
    const now = new Date();
    return monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)));
  });
  const months = [...new Set([...recent, ...monthsWithActivity.map((row) => row._id)])]
    .filter((value) => monthBounds(value))
    .sort()
    .reverse();

  return {
    name: viewer.name,
    photoUrl: photo ?? null,
    rank: own?.rank ?? null,
    points: own?.points ?? 0,
    total: ranked.length,
    // Places climbed since the month began; negative is down. Zero until the
    // ledger has seen a change this month.
    movement: placesMoved(
      roster,
      new Map(earnedThisMonth.map((row) => [row._id, row.delta])),
      viewer.userId,
    ),
    month,
    months,
    earned: events.reduce((sum, event) => sum + event.delta, 0),
    activity,
  };
}

/**
 * A colleague's profile as anyone in the company may see it: who they are,
 * their work details, where they sit and whether they are in today — the
 * month itself comes from `/attendance/team/:userId`, open to the whole
 * company. Nothing about their requests, reviews or documents — those come
 * with the viewer's own team, for the people who report to them.
 */
export async function getPersonProfile(viewerUserId: string, personUserId: string) {
  const viewer = await requireViewer(viewerUserId);
  const notFound = new ManagerError(404, 'Person not found');
  if (!viewer.org || !personUserId) throw notFound;

  const roster = await users()
    .find(
      { org: viewer.org },
      {
        projection: {
          _id: 0,
          profilePhotoUrl: 0,
          documents: 0,
          helpIntake: 0,
          helpMatch: 0,
          counsellor: 0,
        },
      },
    )
    .toArray();
  const byId = new Map(roster.map((user) => [user.userId, user]));
  const person = byId.get(personUserId);
  if (!person || inactive.includes(person.lifecycleStatus) || person.isCounsellor) {
    throw notFound;
  }
  // Today's punches, matched as the team view matches them: by userId for app
  // punches, by employeeId for SQL-imported ones.
  const today = new Date().toISOString().slice(0, 10);
  const [photo, todaysRecord] = await Promise.all([
    users()
      .findOne(
        { userId: person.userId },
        { projection: { _id: 0, profilePhotoKey: 1, profilePhotoUrl: 1 } },
      )
      .then(resolveProfilePhoto),
    attendanceRecords().findOne(
      {
        workDate: today,
        $or: [
          { userId: person.userId },
          ...(person.employeeId ? [{ employeeId: person.employeeId }] : []),
        ],
      },
      { projection: { _id: 0, punchIn: 1, punchOut: 1 } },
    ),
  ]);

  return {
    userId: person.userId,
    name: person.name,
    designation: person.designation ?? '',
    department: person.department ?? person.designation ?? 'Team',
    photoUrl: photo ?? null,
    isSelf: person.userId === viewer.userId,
    isManager: person.userId === viewer.managerUserId,
    reportsToViewer: person.managerUserId === viewer.userId,
    inViewerChain: reportsUpTo(person, viewer.userId, byId),
    recognitionLabel: person.recognition?.label?.trim() || null,
    email: person.email,
    employeeId: person.employeeId ?? null,
    joiningDate: person.joiningDate ? new Date(person.joiningDate).toISOString().slice(0, 10) : null,
    employmentType: person.employeeType ?? null,
    managerName: (person.managerUserId && byId.get(person.managerUserId)?.name) || null,
    todayStatus: todaysRecord?.punchIn ? 'present' : 'not_punched_in',
    punchIn: todaysRecord?.punchIn ? todaysRecord.punchIn.toISOString() : null,
    punchOut: todaysRecord?.punchOut ? todaysRecord.punchOut.toISOString() : null,
    // Walked over the whole org, as the workspace draws the team's charts.
    orgChart: buildOrgChart(person, byId),
  };
}
