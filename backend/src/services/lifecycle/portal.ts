/**
 * The pre-boarding portal's read model and the candidate's own forms
 * (6Zs §3: P7 home and its views, P9 About you, P10 Meet us, P14 Day-1 pass),
 * plus the portal's timed mails (`runPortalJobs`).
 *
 * Path strip: Offer · Docs · About · Team · Sign · Day 1 (keys offer, docs,
 * about, meet, letter, pass). Up next = the first of: a document sent back →
 * the open item due soonest → an item not started.
 */
import { candidateAccounts, companies, dateChangeRequests, journeys, letters, offers, policyDocuments, users } from '../../config/db';
import type { AboutYou, Day1Pass, Journey, OfferFields } from '../../models/lifecycle.model';
import { journeyDocumentsView } from './documents';
import {
  addDays, companyDisplayName, companyOf, daysBetween, fireOnce, formatDay, hrContactFor, istDate, istHour, mails, sendLifecycleEmail,
} from './emails';
import { closeJourney, completeTask, isManagerMeeting, journeyTasksView, type TaskView } from './engine';
import { LifecycleOfferError } from './files';
import { maybeSendLettersReady, portalLetters, SIGNED_KINDS } from './letters';
import { CLOSED_STATUSES, mediaPath } from './portalAuth';
import { addWorkingDaysKey, workCalendar } from './dueRules';

type PathKey = 'offer' | 'docs' | 'about' | 'meet' | 'letter' | 'pass';
/** `waiting`: the candidate's part is done and HR has it (every required document uploaded, in review). */
type StepState = 'done' | 'current' | 'todo' | 'locked' | 'waiting';

export interface PortalHome {
  status: string;
  view: 'tasks_open' | 'offer_updated' | 'letter_ready' | 'pass_unlocked' | 'joined' | 'closed';
  candidateName: string;
  company: { name: string; logoUrl?: string };
  tj?: string;
  daysToGo: number | null;
  plant: { stage: number; water: number; leaves: number; droop: boolean };
  path: Array<{ key: PathKey; label: string; state: StepState; due?: string }>;
  upNext?: { key: PathKey | 'app'; title: string; due?: string; helper?: string };
  tasks: TaskView[];
  batch: { count: number; names: string[] };
  workEmail?: string;
  hrContact: { name: string; email: string };
  banner?: { kind: 'offer_updated'; changedFields: Array<keyof OfferFields> };
  /** For the closed screens: which one (declined, expired, not_joining, moved_to_app). */
  closedState?: string;
  /** P7a: a date request waiting on HR. */
  pendingDateRequest?: { requestedTj: string };
  /** "Product designer · joining Mon 1 Dec". */
  designation?: string;
  /** The hero eyebrow's time (the Day-1 pass's reporting time, 'HH:mm'). */
  reportingTime?: string;
  /** The last day the portal stays open: Tj + 7, or a month after Tj (template's portalOpenUntil). */
  portalOpenUntil?: string;
}

const LABELS: Record<PathKey, string> = { offer: 'Offer', docs: 'Docs', about: 'About', meet: 'Team', letter: 'Sign', pass: 'Day 1' };
const TASK_KEY: Partial<Record<PathKey, string>> = { offer: 'accept_offer', docs: 'upload_documents', about: 'about_you', meet: 'meet_us', letter: 'sign_letters', pass: 'day1_pass' };
/** Due dates when the template's task has none (CONTRACT decision 4). */
const DEFAULT_DUE: Partial<Record<PathKey, number>> = { docs: -5, about: -3, meet: -1, letter: -2 };

const isoDay = (iso: string | null | undefined) => (iso ? istDate(new Date(iso)) : undefined);
const CHANGED_LABEL: Partial<Record<keyof OfferFields, string>> = {
  tj: 'joining date', ctc: 'salary', designation: 'role', department: 'team', location: 'location', managerUserId: 'manager',
  probationMonths: 'probation', noticeDays: 'notice period', responsibilities: 'responsibilities', employeeType: 'employment type',
};
/** ['tj', 'ctc'] → "Joining date and salary changed" (the reply-by date is not a term, so it is left out, as on the banner). */
export function changesLine(fields: Array<keyof OfferFields> | undefined): string | undefined {
  const names = (fields ?? []).filter((k) => k !== 'validTill').map((k) => CHANGED_LABEL[k] ?? String(k));
  if (!names.length) return undefined;
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)} changed`;
}
/** The offer the candidate is looking at: the newest version HR has sent (a draft revision stays HR's until it is sent). */
export const sentVersion = <V extends { status: string }>(versions: V[] | undefined): V | undefined => [...(versions ?? [])].reverse().find((v) => v.status !== 'draft');
function addMonthsDay(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  t.setUTCDate(Math.min(d.getUTCDate(), new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()));
  return t.toISOString().slice(0, 10);
}

// ─── Meet us ────────────────────────────────────────────────────────────────

export interface MeetItem {
  id: string; kind: 'manager_note' | 'video' | 'card'; title: string; text?: string; videoUrl?: string; seen: boolean;
  /** The reel's tag, the line under the title, and the note's author. */
  tag?: string; subtitle?: string; authorName?: string; authorRole?: string;
}

export async function meetItems(journey: Journey): Promise<MeetItem[]> {
  const seen = new Set(journey.meetUs?.seen ?? []);
  const items: Omit<MeetItem, 'seen'>[] = [];
  const note = journey.meetUs?.managerNote;
  const manager = journey.managerUserId ? await users().findOne({ userId: journey.managerUserId }, { projection: { _id: 0, name: 1, designation: 1 } }) : null;
  if (note && (note.text || note.fileId)) {
    items.push({
      id: 'manager_note', kind: 'manager_note',
      title: note.kind === 'video' ? `A hello from ${manager?.name ?? 'your manager'}` : 'Why we picked you',
      tag: 'FROM YOUR MANAGER', subtitle: note.kind === 'video' ? 'Your manager · video' : 'A note from your manager',
      // The portal adds "· your manager" after the role ("Neha R. · Design lead · your manager").
      ...(manager?.name ? { authorName: manager.name } : {}), ...(manager?.designation ? { authorRole: manager.designation } : {}),
      // A signed link: <video src> cannot send the portal's Bearer token.
      ...(note.text ? { text: note.text } : {}), ...(note.kind === 'video' && note.fileId ? { videoUrl: mediaPath(journey.id, note.fileId) } : {}),
    });
  }
  const company = await companyOf(journey.org);
  if (company?.lifecyclePortal?.videoUrl) {
    items.push({ id: 'company_video', kind: 'video', tag: 'HOW WE WORK', title: company.lifecyclePortal.videoTitle || `Life at ${companyDisplayName(company, journey.org)}`, subtitle: 'Who we are and what we value', videoUrl: company.lifecyclePortal.videoUrl });
  }
  const offer = await offers().findOne({ journeyId: journey.id });
  const responsibilities = sentVersion(offer?.versions)?.fields.responsibilities;
  if (responsibilities) items.push({ id: 'role', kind: 'card', tag: 'YOUR ROLE', title: 'Your role, explained', subtitle: journey.designation ? `What you'll do as ${journey.designation}` : 'Your job description', text: responsibilities });
  const policies = await policyDocuments().find({ org: journey.org, active: true }, { projection: { _id: 0, title: 1, summary: 1 } }).sort({ order: 1 }).limit(20).toArray();
  if (policies.length) {
    items.push({ id: 'policies', kind: 'card', tag: 'POLICIES', title: 'Company policies', subtitle: `${policies.length} short read${policies.length === 1 ? '' : 's'}. You’ll confirm them in week 1`, text: policies.map((p) => (p.summary ? `${p.title}: ${p.summary}` : p.title)).join('\n') });
  }
  return items.map((item) => ({ ...item, seen: seen.has(item.id) }));
}

/** The client reports "seen" (80% of a video, 3 s on a card); the last one completes the task. */
export async function markMeetSeen(journey: Journey, itemId: unknown): Promise<MeetItem[]> {
  const items = await meetItems(journey);
  const id = String(itemId ?? '');
  if (!items.some((i) => i.id === id)) throw new LifecycleOfferError(404, 'Item not found');
  const fresh = await journeys().findOneAndUpdate({ id: journey.id }, { $addToSet: { 'meetUs.seen': id }, $set: { lastActivityAt: new Date() } }, { returnDocument: 'after' });
  const next = await meetItems(fresh ?? journey);
  if (next.length && next.every((i) => i.seen)) await completeTask(journey.id, 'meet_us', { name: journey.candidate?.name });
  return next;
}

// ─── About you ──────────────────────────────────────────────────────────────

const RELATIONS = ['Parent', 'Partner', 'Sibling', 'Friend'] as const;
/** '+91' and 10 digits (6–9 first), as '+91XXXXXXXXXX'; null when it is not one. */
export function indianMobile(value: unknown): string | null {
  const digits = String(value ?? '').replace(/[\s()-]/g, '').replace(/^\+?91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export function aboutYouOf(journey: Journey): AboutYou { return journey.aboutYou ?? {}; }

/** What the About you screen reads: the answers, the candidate's own phone (the emergency number may not be it) and the last day to edit (Tj − 1). */
export function aboutYouView(journey: Journey): AboutYou & { phone?: string; editableUntil?: string } {
  const phone = indianMobile(journey.candidate?.phone) ?? (journey.candidate?.phone || undefined);
  return { ...aboutYouOf(journey), ...(phone ? { phone } : {}), ...(journey.tj ? { editableUntil: addDays(journey.tj, -1) } : {}) };
}

/** Saves one step or both ("save on every Next"); editable until the day before joining. */
export async function saveAboutYou(journey: Journey, input: { emergencyContact?: unknown; pf?: unknown }, now = new Date()): Promise<AboutYou & { phone?: string; editableUntil?: string }> {
  if (CLOSED_STATUSES.has(String(journey.status)) || String(journey.status) === 'joined') throw new LifecycleOfferError(409, 'This can no longer be changed here');
  if (journey.tj && istDate(now) >= journey.tj) throw new LifecycleOfferError(409, 'These details lock the day before you join; ask HR to change them');
  const about: AboutYou = { ...aboutYouOf(journey) };
  if (input.emergencyContact !== undefined) {
    const ec = (input.emergencyContact ?? {}) as Record<string, unknown>;
    const name = String(ec.name ?? '').trim();
    if (!name || name.length > 80) throw new LifecycleOfferError(400, 'Add your emergency contact’s name');
    const relation = String(ec.relation ?? '') as (typeof RELATIONS)[number];
    if (!RELATIONS.includes(relation)) throw new LifecycleOfferError(400, 'Pick how they are related to you');
    const phone = indianMobile(ec.phone);
    if (!phone) throw new LifecycleOfferError(400, 'Their phone must be +91 and 10 digits');
    if (phone === indianMobile(journey.candidate?.phone)) throw new LifecycleOfferError(400, 'Add someone else’s number, not your own');
    about.emergencyContact = { name, relation, phone };
  }
  if (input.pf !== undefined) {
    const pf = (input.pf ?? {}) as Record<string, unknown>;
    if (pf.firstJob === true) about.pf = { firstJob: true };
    else {
      const uan = String(pf.uan ?? '').replace(/\s/g, '');
      if (!/^\d{12}$/.test(uan)) throw new LifecycleOfferError(400, 'Your UAN is 12 digits');
      about.pf = { firstJob: false, uan };
    }
  }
  if (input.emergencyContact === undefined && input.pf === undefined) throw new LifecycleOfferError(400, 'Nothing to save');
  about.savedAt = now;
  await journeys().updateOne({ id: journey.id }, { $set: { aboutYou: about, lastActivityAt: now } });
  if (about.emergencyContact && about.pf) await completeTask(journey.id, 'about_you', { name: journey.candidate?.name });
  return aboutYouView({ ...journey, aboutYou: about });
}

// ─── Day-1 pass ─────────────────────────────────────────────────────────────

export const PASS_OPENS_DAYS = 7;
const passOpen = (journey: Journey, now: Date) => Boolean(journey.tj && daysBetween(istDate(now), journey.tj) <= PASS_OPENS_DAYS);

export type PortalPass = Day1Pass & { date: string; candidateName: string; designation?: string; department?: string; managerName?: string; buddyName?: string; companyName: string };

export async function portalPass(journey: Journey, now = new Date()): Promise<PortalPass> {
  if (!journey.tj) throw new LifecycleOfferError(403, 'Your Day-1 pass is not ready yet');
  if (!passOpen(journey, now)) throw new LifecycleOfferError(403, `Your Day-1 pass opens on ${formatDay(addDays(journey.tj, -PASS_OPENS_DAYS))}`);
  const [manager, buddy, company] = await Promise.all([
    journey.managerUserId ? users().findOne({ userId: journey.managerUserId }, { projection: { _id: 0, name: 1 } }) : null,
    journey.buddyUserId ? users().findOne({ userId: journey.buddyUserId }, { projection: { _id: 0, name: 1 } }) : null,
    companyOf(journey.org),
  ]);
  const pass = journey.day1Pass ?? {};
  return {
    ...pass,
    // The manager meeting names the current manager (the line HR typed goes stale when the manager changes).
    ...(pass.agenda ? { agenda: pass.agenda.map((a) => (isManagerMeeting(a) && manager?.name ? { ...a, with: manager.name } : a)) } : {}),
    date: journey.day1Pass?.date ?? journey.tj,
    candidateName: journey.candidate?.name ?? '', designation: journey.designation, department: journey.department,
    ...(manager ? { managerName: manager.name } : {}), ...(buddy ? { buddyName: buddy.name } : {}),
    companyName: companyDisplayName(company, journey.org),
  };
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
const icsStamp = (at: Date) => at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** The Day-1 event (reporting time to the last agenda item + 1 h, else 8 hours), in UTC. */
export async function portalPassIcs(journey: Journey, now = new Date()): Promise<string> {
  const pass = await portalPass(journey, now);
  const at = (hhmm: string | undefined) => new Date(Date.parse(`${pass.date}T${/^\d{2}:\d{2}$/.test(hhmm ?? '') ? hhmm : '09:30'}:00+05:30`));
  const start = at(pass.reportingTime);
  const lastAgenda = (pass.agenda ?? []).map((a) => at(a.time)).filter((d) => d > start).sort((a, b) => b.getTime() - a.getTime())[0];
  const end = lastAgenda ? new Date(lastAgenda.getTime() + 3_600_000) : new Date(start.getTime() + 8 * 3_600_000);
  const description = [
    pass.askFor?.name ? `Ask for: ${pass.askFor.name}${pass.askFor.phone ? ` (${pass.askFor.phone})` : ''}` : '',
    pass.managerName ? `Your manager: ${pass.managerName}` : '', pass.buddyName ? `Your buddy: ${pass.buddyName}` : '',
    pass.bring?.length ? `Bring: ${pass.bring.join(', ')}` : '', pass.meetingLink ? `Join: ${pass.meetingLink}` : '',
    ...(pass.agenda ?? []).map((a) => `${a.time} ${a.title}${a.with ? ` (${a.with})` : ''}`),
  ].filter(Boolean).join('\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sowaka//Pre-boarding portal//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:day1-${journey.id}@getsowaka.com`, `DTSTAMP:${icsStamp(now)}`, `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(`Day 1 at ${pass.companyName}`)}`,
    ...(pass.place || pass.meetingLink ? [`LOCATION:${icsText(pass.place ?? pass.meetingLink ?? '')}`] : []),
    ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

// ─── Home ───────────────────────────────────────────────────────────────────

export async function portalHome(journey: Journey, now = new Date()): Promise<PortalHome> {
  const status = String(journey.status);
  const today = istDate(now);
  // Every read the page needs, started together: each needs only the journey (closed and joined pages need fewer).
  const quiet = <T>(p: Promise<T>) => { p.catch(() => undefined); return p; };
  const isOpen = !CLOSED_STATUSES.has(status);
  const pre = isOpen && status !== 'joined';
  const companyRead = companyOf(journey.org);
  const tasksRead = isOpen ? quiet(journeyTasksView(journey.id, 'employee')) : null;
  const offerRead = pre ? quiet(offers().findOne({ journeyId: journey.id })) : null;
  const docsRead = pre ? quiet(journeyDocumentsView(journey.id)) : null;
  const meetRead = pre ? quiet(meetItems(journey)) : null;
  const lettersRead = pre && journey.templateSnapshot.settings.signLettersOnDay1 !== true ? quiet(portalLetters(journey)) : null;
  const company = await companyRead;
  const base = {
    status, candidateName: journey.candidate?.name ?? '',
    company: { name: companyDisplayName(company, journey.org), ...(company?.lifecyclePortal?.logoUrl ? { logoUrl: company.lifecyclePortal.logoUrl } : {}) },
    tj: journey.tj, daysToGo: journey.tj ? daysBetween(today, journey.tj) : null,
    hrContact: await hrContactFor(journey, company),
    ...(journey.designation ? { designation: journey.designation } : {}),
    ...(journey.day1Pass?.reportingTime ? { reportingTime: journey.day1Pass.reportingTime } : {}),
    ...(journey.tj ? { portalOpenUntil: journey.templateSnapshot.settings.portalOpenUntil === 'month_1' ? addMonthsDay(journey.tj, 1) : addDays(journey.tj, 7) } : {}),
  };
  const plantOf = (water: number) => journey.plant ?? { stage: status === 'joined' ? 1 : 0, water, leaves: 0, droop: false };
  if (CLOSED_STATUSES.has(status)) {
    return { ...base, view: 'closed', closedState: status, plant: plantOf(0), path: [], tasks: [], batch: { count: 0, names: [] } };
  }
  const tasks = await (tasksRead ?? journeyTasksView(journey.id, 'employee'));
  if (status === 'joined') {
    const week1 = tasks.filter((t) => t.phase === 'first_week');
    return {
      ...base, view: 'joined', plant: plantOf(3), path: [], tasks: week1, batch: { count: 0, names: [] },
      ...(journey.candidate?.workEmail ? { workEmail: journey.candidate.workEmail } : {}),
      upNext: { key: 'app', title: 'Continue in the app', helper: 'Sign in with your work email and a one-time code' },
    };
  }

  const offer = await (offerRead ?? offers().findOne({ journeyId: journey.id }));
  // A revision HR has only saved is not the candidate's yet: home changes when it is sent.
  const latest = sentVersion(offer?.versions);
  const offerDone = latest?.status === 'accepted';
  const docs = await (docsRead ?? journeyDocumentsView(journey.id));
  const required = docs.filter((d) => d.required);
  const sentBack = docs.find((d) => d.status === 'sent_back');
  // Done only when every required document is approved and nothing is waiting to be uploaded again (an optional one included).
  const docsDone = required.length > 0 && required.every((d) => d.status === 'approved') && !sentBack;
  // Every required document is in and HR is reviewing: nothing for the candidate to do there now.
  const docsWaiting = !docsDone && !sentBack && required.length > 0 && required.every((d) => d.status === 'in_review' || d.status === 'approved');
  const about = aboutYouOf(journey);
  const aboutDone = Boolean(about.emergencyContact && about.pf);
  const meet = await (meetRead ?? meetItems(journey));
  const meetDone = meet.length > 0 ? meet.every((i) => i.seen) : true;
  const onDay1 = journey.templateSnapshot.settings.signLettersOnDay1 === true;
  const portalLetterList = onDay1 ? [] : await (lettersRead ?? portalLetters(journey));
  const lettersDone = portalLetterList.length > 0 && portalLetterList.every((l) => l.state === 'signed');
  const lettersReady = portalLetterList.some((l) => l.state === 'ready' || l.state === 'opened');
  const passUnlocked = passOpen(journey, now);

  const dueOf = (key: PathKey): string | undefined => {
    const task = tasks.find((t) => t.systemKey === TASK_KEY[key]);
    if (task?.dueAt) return isoDay(task.dueAt);
    if (key === 'offer') return latest?.fields.validTill;
    if (key === 'pass') return journey.tj;
    const offset = DEFAULT_DUE[key];
    return journey.tj && offset !== undefined ? addDays(journey.tj, offset) : undefined;
  };
  const steps: Array<{ key: PathKey; done: boolean; locked: boolean; started: boolean; waiting?: boolean }> = [
    { key: 'offer', done: offerDone, locked: false, started: true },
    { key: 'docs', done: docsDone, locked: false, started: docs.some((d) => d.fileIds.length > 0), waiting: docsWaiting },
    { key: 'about', done: aboutDone, locked: false, started: Boolean(about.emergencyContact || about.pf) },
    { key: 'meet', done: meetDone, locked: false, started: meet.some((i) => i.seen) },
    ...(onDay1 ? [] : [{ key: 'letter' as const, done: lettersDone, locked: !lettersReady && !lettersDone, started: portalLetterList.some((l) => l.state === 'opened') }]),
    { key: 'pass', done: passUnlocked && today >= (journey.tj ?? '9999'), locked: !passUnlocked, started: false },
  ];

  // Up next: sent back → due soonest → not started. A step waiting on HR is not the candidate's to do.
  const open = steps.filter((s) => !s.done && !s.locked && !s.waiting);
  const titles: Record<PathKey, string> = {
    offer: (latest?.version ?? 1) > 1 ? 'Review your updated offer' : 'Accept your offer', docs: 'Upload your documents', about: 'Tell us about you',
    meet: 'Meet the team', letter: 'Sign your appointment letter', pass: 'Check your Day-1 pass',
  };
  const helpers: Record<PathKey, string> = {
    offer: ((latest?.version ?? 1) > 1 && changesLine(latest?.changedFields)) || 'Read it, then accept',
    docs: sentBack?.hrNote ?? 'One document at a time · PDF, JPG or PNG', about: 'Emergency contact and PF · 2 quick steps',
    meet: 'Short videos and cards from the team', letter: 'Open each PDF, then sign', pass: 'Where to go, when, and who to meet',
  };
  let upNext: PortalHome['upNext'];
  if (!offerDone) upNext = { key: 'offer', title: titles.offer, due: dueOf('offer'), helper: helpers.offer };
  else if (sentBack) upNext = { key: 'docs', title: `Re-upload your ${sentBack.label}`, due: dueOf('docs'), helper: helpers.docs };
  else {
    const dated = open.map((s) => ({ s, due: dueOf(s.key) })).filter((x) => x.due).sort((a, b) => a.due!.localeCompare(b.due!));
    const pick = dated[0]?.s ?? open.find((s) => !s.started) ?? open[0];
    if (pick) upNext = { key: pick.key, title: titles[pick.key], due: dueOf(pick.key), helper: helpers[pick.key] };
    else if (docsWaiting) upNext = { key: 'docs', title: 'HR is checking your documents', helper: 'You’ll hear from HR when they’re approved' };
  }
  const currentKey = upNext && upNext.key !== 'app' ? upNext.key : open[0]?.key;
  const path = steps.map((s) => ({
    key: s.key, label: LABELS[s.key], due: dueOf(s.key),
    state: (s.done ? 'done' : s.locked ? 'locked' : s.waiting ? 'waiting' : s.key === currentKey ? 'current' : 'todo') as StepState,
  }));
  const doneCount = steps.filter((s) => s.done).length;

  const view: PortalHome['view'] = !offerDone ? 'offer_updated' : lettersReady && !lettersDone ? 'letter_ready' : passUnlocked ? 'pass_unlocked' : 'tasks_open';
  const others = journey.tj ? await journeys().find({
    org: journey.org, kind: 'onboarding', tj: journey.tj, id: { $ne: journey.id }, status: { $in: ['accepted', 'finalised', 'active', 'docs_approved'] },
  }, { projection: { _id: 0, 'candidate.name': 1 } }).limit(50).toArray() : [];
  const account = await candidateAccounts().findOne({ journeyId: journey.id }, { projection: { _id: 0, lastSignInAt: 1 } });
  const pending = await dateChangeRequests().findOne({ journeyId: journey.id, status: 'pending' }, { projection: { _id: 0, requestedTj: 1 } });
  return {
    ...base, view,
    plant: plantOf(Math.min(3, Math.floor((doneCount * 3) / 5))),
    path, ...(upNext ? { upNext } : {}),
    tasks: tasks.filter((t) => t.surface === 'portal'),
    batch: { count: others.length, names: others.slice(0, 5).map((o) => String(o.candidate?.name ?? '').split(' ')[0]).filter(Boolean) },
    ...(!offerDone && (latest?.version ?? 1) > 1 && account ? { banner: { kind: 'offer_updated' as const, changedFields: latest?.changedFields ?? [] } } : {}),
    ...(pending ? { pendingDateRequest: { requestedTj: pending.requestedTj } } : {}),
  };
}

// ─── Timed mails ────────────────────────────────────────────────────────────

const PRE_JOIN_PORTAL: string[] = ['finalised', 'active', 'docs_approved'];


/**
 * The portal's timed work, idempotent (each mail claims a once-only key), for
 * companies with features.lifecycle. Expiry runs on every call; mails go out
 * only between 09:00 and 20:00 IST. Hook: call every hour from
 * notification-scheduler's runHourlyJobs.
 */
export async function runPortalJobs(now = new Date()): Promise<{ expired: number; mails: number }> {
  const orgs = (await companies().find({ 'features.lifecycle': true }, { projection: { _id: 0, id: 1 } }).toArray()).map((c) => c.id);
  if (!orgs.length) return { expired: 0, mails: 0 };
  const today = istDate(now);
  let expired = 0;
  let sent = 0;

  // Valid-till passed with the offer unaccepted (stops once accepted).
  for (const offer of await offers().find({ org: { $in: orgs }, versions: { $elemMatch: { status: 'sent', 'fields.validTill': { $lt: today } } } }).toArray()) {
    for (const v of offer.versions.filter((x) => x.status === 'sent' && x.fields.validTill < today)) {
      await offers().updateOne({ id: offer.id, 'versions.version': v.version, 'versions.status': 'sent' }, { $set: { 'versions.$.status': 'expired', updatedAt: now } });
      expired += 1;
    }
    const journey = await journeys().findOne({ id: offer.journeyId, status: 'offer_sent' });
    if (journey) await closeJourney(journey.id, 'expired', `Not accepted by ${formatDay(offer.versions[offer.versions.length - 1].fields.validTill)}`);
  }

  const hour = istHour(now);
  if (hour < 9 || hour >= 20) return { expired, mails: 0 };
  const open = await journeys().find({ org: { $in: orgs }, kind: 'onboarding', status: { $in: ['accepted', 'finalised', 'active', 'docs_approved'] as const } }).toArray();
  const companyNames = new Map<string, string>();
  const nameFor = async (org: string) => {
    if (!companyNames.has(org)) companyNames.set(org, companyDisplayName(await companyOf(org), org));
    return companyNames.get(org)!;
  };
  for (const journey of open) {
    const email = journey.candidate?.personalEmail;
    const name = journey.candidate?.name ?? '';
    if (!email) continue;
    const companyName = await nameFor(journey.org);
    const status = String(journey.status);

    // HR: accepted, not finalised within a working day.
    if (status === 'accepted' && journey.anchors.accepted) {
      const offer = await offers().findOne({ journeyId: journey.id });
      const v = sentVersion(offer?.versions);
      // A working day of the company's calendar (its week-offs and holidays), as the finalise task's due date is.
      const oneWorkingDay = v?.status === 'accepted' && !v.finalisedAt
        ? addWorkingDaysKey(istDate(journey.anchors.accepted), 1, await workCalendar(journey.org, { location: journey.location }))
        : null;
      if (v && oneWorkingDay && today > oneWorkingDay && await fireOnce(`finalise_reminder:${journey.id}:v${v.version}`, journey.org)) {
        const creator = await users().findOne({ userId: journey.createdByUserId, org: journey.org }, { projection: { _id: 0, email: 1 } });
        if (creator?.email) { await sendLifecycleEmail(journey.org, creator.email, `Waiting for you: finalise ${name}'s offer`, mails.hrFinaliseReminder(companyName, name)); sent += 1; }
      }
    }
    if (!PRE_JOIN_PORTAL.includes(status)) continue;
    const account = await candidateAccounts().findOne({ journeyId: journey.id });
    if (!account) continue;

    // Two days after the login went out, no sign-in yet.
    if (!account.lastSignInAt && account.loginSentAt && now.getTime() - account.loginSentAt.getTime() >= 2 * 86_400_000
      && await fireOnce(`login_reminder:${journey.id}`, journey.org)) {
      await sendLifecycleEmail(journey.org, email, 'Your joining portal is waiting', mails.loginReminder(companyName, name, account.email, formatDay(istDate(account.loginSentAt)), journey.org));
      sent += 1;
    }

    // Three quiet days after signing in: one nudge per quiet stretch.
    const last = journey.lastActivityAt ?? account.lastSignInAt;
    if (account.lastSignInAt && last && now.getTime() - last.getTime() >= 3 * 86_400_000 && journey.tj && today < journey.tj
      && await fireOnce(`quiet:${journey.id}:${last.toISOString()}`, journey.org)) {
      const home = await portalHome(journey, now);
      await sendLifecycleEmail(journey.org, email, 'A few things are waiting on your joining portal', mails.quietNudge(companyName, name, home.upNext?.title, journey.org));
      sent += 1;
    }

    if (!journey.tj) continue;
    const toGo = daysBetween(today, journey.tj);

    // Letters ready (catch-up for the event), then daily from Tj − 3 while unsigned.
    if (await maybeSendLettersReady(journey.id)) sent += 1;
    if (toGo <= 3 && toGo >= 0) {
      const unsigned = await letters().find({ journeyId: journey.id, kind: { $in: SIGNED_KINDS }, signature: { $exists: false }, pdfFileId: { $exists: true } }).toArray();
      const lettersOpen = unsigned.length > 0 && (await portalLetters(journey)).some((l) => l.state === 'ready' || l.state === 'opened');
      if (lettersOpen && await fireOnce(`letter_nudge:${journey.id}:${today}`, journey.org)) {
        await sendLifecycleEmail(journey.org, email, 'Reminder: sign your appointment letter', mails.letterNudge(companyName, name, formatDay(addDays(journey.tj, -2)), journey.org));
        sent += 1;
      }
    }

    // Tj − 7: the Day-1 pass opens and the reporting details go out (again if Tj moves).
    if (toGo <= PASS_OPENS_DAYS && toGo >= 0 && await fireOnce(`day1_pass:${journey.id}:${journey.tj}`, journey.org)) {
      const pass = await portalPass(journey, now);
      await completeTask(journey.id, 'day1_pass');
      await sendLifecycleEmail(journey.org, email, `Your first day: ${formatDay(pass.date)}`, mails.day1Pass(companyName, name, [
        ['Date', formatDay(pass.date)], ['Reporting time', pass.reportingTime ?? ''], ['Where', pass.place ?? pass.meetingLink ?? ''],
        ['Ask for', pass.askFor?.name ?? ''], ['Your manager', pass.managerName ?? ''], ['Bring', (pass.bring ?? []).join(', ')],
      ], journey.org));
      sent += 1;
    }
  }
  return { expired, mails: sent };
}

/** Documents rows for the portal: the files' own links are portal paths. */
const DOC_HINTS: Array<[RegExp, string]> = [
  [/id|pan|aadhaar/i, 'Both sides, in good light, with no glare.'],
  [/address/i, 'A utility bill, rent agreement or passport page.'],
  [/educat|degree/i, 'Degree certificate and final mark sheet.'],
  [/payslip/i, 'From your current or last employer.'],
  [/reliev/i, 'From your last employer.'],
  [/photo/i, 'Plain background, face clearly visible.'],
];
/**
 * 6Zs P8's reel copy for the documents the default template lists, matched on
 * the label (HR can rename a document, and then its own words are used).
 */
const DOC_COPY: Array<[RegExp, { title: string; tag: string }]> = [
  [/^id proof \(pan and aadhaar\)$/i, { title: 'Upload your PAN and Aadhaar', tag: 'ID proof' }],
  [/^address proof$/i, { title: 'Upload an address proof', tag: 'Address proof' }],
  [/^education( \(highest degree\)| certificates)?$/i, { title: 'Upload your highest degree', tag: 'Education' }],
];
/** "Upload your last payslip" from "Last payslip"; an acronym ("PAN card") keeps its capitals. */
const uploadTitle = (label: string) => `Upload your ${/^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label}`;

/** The reel's title, tag, hint and due date ride along with each document. */
export async function portalDocuments(journey: Journey) {
  const docs = await journeyDocumentsView(journey.id);
  const task = (await journeyTasksView(journey.id, 'employee')).find((t) => t.systemKey === 'upload_documents');
  const dueAt = isoDay(task?.dueAt) ?? (journey.tj ? addDays(journey.tj, DEFAULT_DUE.docs!) : undefined);
  return docs.map((d) => {
    const hint = DOC_HINTS.find(([re]) => re.test(`${d.docKey} ${d.label}`))?.[1];
    const copy = DOC_COPY.find(([re]) => re.test(d.label.trim()))?.[1];
    return {
      ...d, title: copy?.title ?? uploadTitle(d.label), tag: copy?.tag ?? d.label.replace(/\s*\([^)]*\)\s*$/, ''),
      ...(hint ? { hint } : {}), ...(dueAt ? { dueAt } : {}),
      files: d.files.map((f) => ({ ...f, url: `/portal/files/${f.id}` })),
    };
  });
}

