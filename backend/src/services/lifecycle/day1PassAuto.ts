/**
 * The Day-1 pass the server makes by itself: at Tj − 7 (or on the next job run for a joiner already
 * inside the week) the template's joining and reporting details become the joiner's stored pass —
 * date (Tj), reporting time, the place and its map link (or a meeting link for a remote first day),
 * who to ask for, the manager, the buddy, the HR contact, what to bring and the day's agenda (the
 * template's Day-1 meetings, one after another from the reporting time) — marked `auto`.
 *
 * Until HR saves the pass (board.ts `cleanDay1Pass` drops the mark and the pass is HR's), the job
 * keeps it in step with the template and the people on the journey, and a moved joining date takes
 * it along (engine.ts `moveAnchorDay`: a new date more than a week away clears it, to be made again
 * at the new Tj − 7). The agenda lines it makes (`tpl-…` ids, no task) are what the day holds, not
 * meetings of their own: `syncDay1Meetings` leaves them alone unless HR ties one to a task.
 */
import { journeys, users } from '../../config/db';
import type { Day1Pass, Journey, MeetWith } from '../../models/lifecycle.model';
import { designOf, reportingFor } from './design';
import { peopleOf } from './designRows';
import { addDays, companyOf, daysBetween, hrContactFor, istDate } from './emails';
import { AGENDA_TASK_KEYS, TEMPLATE_AGENDA_PREFIX } from './engine';
import { scopedJourneys } from './scriptScope';

/** The pass opens (and is made) this many days before the joining day. */
export const AUTO_PASS_DAYS = 7;
/** Journeys whose pass is made: the offer accepted, not joined yet. */
const PRE_JOIN = ['accepted', 'finalised', 'active', 'docs_approved'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A web address that is not a map: a meeting link (a remote first day). */
const WEB = /^https:\/\/\S+$/i;
const MAP = /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\.com|openstreetmap\.org/i;
/** Each Day-1 meeting on the agenda takes this long (as the meetings HR's agenda makes). */
const SLOT_MINUTES = 30;
const ROLE_LABEL: Record<MeetWith, string> = { hr: 'HR', manager: 'Your manager', buddy: 'Your buddy', it: 'IT', head_of_department: 'Head of department' };

const addMinutes = (hhmm: string, minutes: number) => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** Anything on a pass HR saved (an empty one is treated as none). */
const hasContent = (p: Day1Pass) => Boolean(p.reportingTime || p.place || p.mapLink || p.meetingLink || p.askFor || p.hrContact || p.bring?.length || p.agenda?.length);
/** HR's own pass: saved by HR with something on it. The server never overwrites it. */
export const isHrPass = (p: Day1Pass | undefined): boolean => Boolean(p && !p.auto && hasContent(p));

/** The pass the template makes for this joiner today (no `auto` mark). */
export async function templatePass(journey: Journey): Promise<Day1Pass> {
  const [{ rows, settings }, reporting, company] = await Promise.all([designOf(journey), reportingFor(journey), companyOf(journey.org)]);
  const people = await peopleOf(journey, settings);
  const ids = [...new Set(Object.values(people).filter((v): v is string => typeof v === 'string'))];
  const found = ids.length ? await users().find({ userId: { $in: ids } }, { projection: { _id: 0, userId: 1, name: 1, phone: 1 } }).toArray() : [];
  const byId = new Map(found.map((u) => [u.userId, u]));
  const personOf = (role: MeetWith) => {
    const id = role === 'head_of_department' ? people.head_of_department : people[role];
    return id ? byId.get(id) : undefined;
  };
  const manager = journey.managerUserId ? byId.get(journey.managerUserId) : undefined;
  const buddy = journey.buddyUserId ? byId.get(journey.buddyUserId) : undefined;

  const time = reporting?.time && HHMM.test(reporting.time) ? reporting.time : undefined;
  const placeIsLink = Boolean(reporting?.place && WEB.test(reporting.place) && !MAP.test(reporting.place));
  const meets = reporting ? personOf(reporting.meets) : undefined;
  const bring = (reporting?.bring ?? '').split(/\n/).map((b) => b.trim()).filter(Boolean).slice(0, 20);
  const hr = await hrContactFor(journey, company);

  // The day's agenda: the template's Day-1 meetings (Final designs), else an older template's Day-1 meeting tasks.
  const meetingsOfDay1 = rows.filter((r) => r.design?.section === 'meeting' && r.design.stage === 'd1');
  const lines: Array<{ id: string; title: string; with?: string }> = meetingsOfDay1.length
    ? meetingsOfDay1.map((r) => {
      const role = r.design!.meetWith;
      const who = role ? personOf(role)?.name ?? ROLE_LABEL[role] : undefined;
      return { id: r.id, title: r.title, ...(who ? { with: who } : {}) };
    })
    : (journey.templateSnapshot?.tasks ?? [])
      .filter((t) => t.enabled && !t.design && t.systemKey && (AGENDA_TASK_KEYS as readonly string[]).includes(t.systemKey))
      .sort((a, b) => a.order - b.order)
      .map((t) => ({ id: t.systemKey!, title: t.title }));
  const start = time ?? '10:00';
  const agenda = lines.slice(0, 20).map((l, i) => ({
    id: `${TEMPLATE_AGENDA_PREFIX}${l.id}`.slice(0, 64).replace(/[^\w-]/g, '-'), time: addMinutes(start, SLOT_MINUTES * (i + 1)),
    title: l.title.slice(0, 120), ...(l.with ? { with: l.with.slice(0, 120) } : {}), taskKey: null,
  }));

  return {
    ...(journey.tj ? { date: journey.tj } : {}),
    ...(time ? { reportingTime: time } : {}),
    ...(reporting?.place && !placeIsLink ? { place: reporting.place } : {}),
    ...(reporting?.mapLink ? { mapLink: reporting.mapLink } : {}),
    ...(placeIsLink ? { meetingLink: reporting!.place } : {}),
    ...(meets ? { askFor: { name: meets.name, ...(meets.phone ? { phone: meets.phone } : {}) } } : {}),
    ...(hr.name ? { hrContact: { name: hr.name, ...(hr.email ? { email: hr.email } : {}) } } : {}),
    ...(bring.length ? { bring } : {}),
    ...(agenda.length ? { agenda } : {}),
    ...(manager ? { managerName: manager.name } : {}),
    ...(buddy ? { buddyName: buddy.name } : {}),
  };
}

const withoutMark = (p: Day1Pass) => { const { auto: _a, ...rest } = p; return JSON.stringify(rest); };

/**
 * Makes (or keeps up to date) the joiner's automatic pass when the joining day is a week away or less.
 * Never touches HR's pass. Returns what it did.
 */
export async function ensureAutoDay1Pass(journey: Journey, now = new Date()): Promise<'made' | 'updated' | null> {
  if (journey.kind !== 'onboarding' || !journey.tj || !(PRE_JOIN as readonly string[]).includes(String(journey.status))) return null;
  const toGo = daysBetween(istDate(now), journey.tj);
  if (toGo > AUTO_PASS_DAYS || toGo < 0) return null;
  const current = journey.day1Pass;
  if (isHrPass(current)) return null;
  const fresh = await templatePass(journey);
  if (current?.auto && withoutMark(current) === withoutMark(fresh)) return null;
  const next: Day1Pass = { ...fresh, auto: { at: current?.auto?.at ?? now } };
  // Only while the pass is still not HR's (HR saving meanwhile wins).
  const res = await journeys().updateOne(
    { id: journey.id, ...(current?.auto ? { 'day1Pass.auto': { $exists: true } } : current ? { 'day1Pass.auto': { $exists: false } } : { day1Pass: { $exists: false } }) },
    { $set: { day1Pass: next, updatedAt: now } },
  );
  if (!res.modifiedCount) return null;
  return current?.auto ? 'updated' : 'made';
}

/** The job's sweep: every pre-joining joiner of these companies whose joining day is within the week. */
export async function makeAutoDay1Passes(orgs: string[], now = new Date()): Promise<{ made: number; updated: number }> {
  const today = istDate(now);
  const list = await journeys().find({
    org: { $in: orgs }, ...scopedJourneys(), kind: 'onboarding', status: { $in: [...PRE_JOIN] },
    tj: { $gte: today, $lte: addDays(today, AUTO_PASS_DAYS) }, closedAt: { $exists: false },
  }).toArray();
  let made = 0;
  let updated = 0;
  for (const journey of list) {
    const r = await ensureAutoDay1Pass(journey, now);
    if (r === 'made') made += 1;
    if (r === 'updated') updated += 1;
  }
  return { made, updated };
}
