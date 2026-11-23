/**
 * Offers and their versions, and everything HR does to a candidate before they
 * are an employee: create, revise, upload the PDF, send, finalise, decline,
 * reopen, not joining, mark joined, and the candidate's date-change requests.
 * The candidate's side of the offer link (open, accept) is here too.
 *
 * Rules (6Zs §1.3, §3.2, CONTRACT):
 * - Only the latest sent version can be accepted. Revising after sending
 *   makes a draft v+1 with `changedFields`; it is HR's until HR sends it
 *   (6Zs §3.2.1 "Replaced: HR sends a revised offer"). On send, older
 *   versions become `replaced` (their links say so), the journey takes the
 *   new terms and, if HR had finalised, goes back to `accepted` so HR
 *   finalises the new version again (the appointment letter is then
 *   regenerated). Until then the candidate keeps seeing the version they have.
 * - The link token is random; only its sha256 is stored, per version.
 * - Valid-till expires an unaccepted offer; it stops counting once accepted.
 * - Candidates are not users until Mark joined, which creates the employee
 *   with `createEmployeeForAdmin` and hands over to the engine's `onJoined`.
 */
import { randomUUID } from 'node:crypto';
import { candidateAccounts, dateChangeRequests, getDb, journeys, lifecycleFiles, offers, users } from '../../config/db';
import type {
  DateChangeRequest, Journey, JourneyTask, Offer, OfferFields, OfferVersion,
} from '../../models/lifecycle.model';
import { AdminError, createEmployeeForAdmin } from '../admin.service';
import { notifyUsers } from '../notification.service';
import { allRequiredApproved } from './documents';
import {
  addDays, companyDisplayName, companyOf, formatDay, hrContactFor, isDay, istDate, lifecycleEnabled, mails, portalLink, sendLifecycleEmail,
} from './emails';
import type { LifecycleAttachment } from './emails';
import { nonWorkingDayReason } from './dueRules';
import { closeJourney, completeTask, createOnboardingJourney, moveTj, onJoined, refreshJourney, reopenTask, setJourneyStatus, syncProbationTasks } from './engine';
import { checkUpload, LifecycleOfferError, pdfPageCount, readFileBytes, storeFile } from './files';
import { regenerateAppointmentLetters, outdateChangedLetters } from './letters';
import { noticeDaysFor } from './templates';
import { CLOSED_STATUSES, createCandidateAccount, LIMITS, newLinkToken, rateLimit, sha256 } from './portalAuth';

/** The dashboard user acting, as the routes resolve them. `seesPay`: may see and set CTC. */
export interface HrActor { userId: string; name: string; org: string; seesPay: boolean }

export interface OfferView {
  journeyId: string; version: number; status: OfferVersion['status'];
  fields: Omit<OfferFields, 'ctc'> & { ctc?: number; managerName?: string };
  changedFields?: Array<keyof OfferFields>; refNo?: string; sentAt?: Date; acceptedAt?: Date; finalisedAt?: Date;
  validTill: string; pdfFileId?: string;
  versions: Array<{ version: number; status: OfferVersion['status']; sentAt?: Date; acceptedAt?: Date; changedFields?: Array<keyof OfferFields> }>;
}

export type PortalOfferState = 'offer' | 'accepted' | 'finalised' | 'declined' | 'expired' | 'replaced' | 'not_joining' | 'closed';
export interface PortalOfferView {
  state: PortalOfferState;
  company: { name: string; logoUrl?: string };
  candidateName: string;
  version: number;
  changedFields?: Array<keyof OfferFields>;
  fields: Omit<OfferFields, 'managerUserId'> & { managerName?: string; managerDesignation?: string };
  validTill: string;
  pdfUrl: string | null;
  hrContact: { name: string; email: string };
  companyVideoUrl?: string;
  /** P5: the masked email the login went to. */
  loginEmailMasked?: string;
  /** W4's step dates. */
  acceptedAt?: Date;
  finalisedAt?: Date;
  /** P4 "Accepted version · 3 pages". */
  pdfPages?: number;
}

const FIELD_KEYS: Array<keyof OfferFields> = [
  'designation', 'department', 'location', 'ctc', 'tj', 'managerUserId', 'probationMonths', 'noticeDays', 'validTill', 'responsibilities', 'employeeType',
];
const PRE_JOIN = ['draft', 'offer_sent', 'accepted', 'finalised', 'active', 'docs_approved'] as const;
const PRE_JOIN_OPEN = new Set<string>(PRE_JOIN);

const current = (offer: Offer) => offer.versions[offer.versions.length - 1];
/** The newest version HR has sent: what the candidate sees and accepts (a draft revision is still HR's). */
const latestSent = (offer: Offer): OfferVersion => [...offer.versions].reverse().find((v) => v.status !== 'draft') ?? current(offer);

/** `lean`: without the template snapshot's task list (most of a journey's bytes), for callers that never read it. */
async function journeyOf(org: string, journeyId: string, lean = false): Promise<Journey> {
  const journey = await journeys().findOne({ id: journeyId, org, kind: 'onboarding' }, lean ? { projection: { _id: 0, 'templateSnapshot.tasks': 0 } } : {});
  if (!journey) throw new LifecycleOfferError(404, 'Joiner not found');
  return journey;
}
async function offerOf(journeyId: string): Promise<Offer> {
  const offer = await offers().findOne({ journeyId });
  if (!offer) throw new LifecycleOfferError(404, 'Offer not found');
  return offer;
}

/** The next reference number for a kind of letter: 'OL/2026/007'. One counter per org, prefix and year. */
export async function nextRefNo(org: string, prefix: string, now = new Date()): Promise<string> {
  const year = istDate(now).slice(0, 4);
  const row = await getDb().collection<{ _id: string; seq: number }>('lifecycle_counters').findOneAndUpdate(
    { _id: `${org}:${prefix}:${year}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' },
  );
  return `${prefix}/${year}/${String(row?.seq ?? 1).padStart(3, '0')}`;
}

// ─── Fields ─────────────────────────────────────────────────────────────────

async function cleanFields(org: string, input: unknown, base: Partial<OfferFields>, defaults: { probationMonths: number; noticeDays: number }): Promise<OfferFields> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const pick = <K extends keyof OfferFields>(k: K) => (k in raw ? raw[k] : base[k]) as unknown;
  const text = (k: keyof OfferFields, max: number, required = false) => {
    const v = pick(k);
    const s = typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim();
    if (required && !s) throw new LifecycleOfferError(400, `${LABELS[k]} is required`);
    if (s.length > max) throw new LifecycleOfferError(400, `${LABELS[k]} is too long`);
    return s || undefined;
  };
  const int = (k: keyof OfferFields, min: number, max: number, fallback: number) => {
    const v = pick(k);
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new LifecycleOfferError(400, `${LABELS[k]} must be a whole number from ${min} to ${max}`);
    return n;
  };
  const ctc = Number(pick('ctc'));
  if (!Number.isFinite(ctc) || ctc <= 0 || ctc > 1e10) throw new LifecycleOfferError(400, 'Yearly CTC must be a positive amount in rupees');
  const tj = pick('tj');
  if (!isDay(tj)) throw new LifecycleOfferError(400, 'Joining date must be a date (YYYY-MM-DD)');
  // A new joining date is after today (an unchanged one on a revision is left as it is).
  if (tj !== base.tj && tj <= istDate()) throw new LifecycleOfferError(400, `The joining date must be after today (${formatDay(istDate())})`);
  const validTillRaw = pick('validTill');
  // Valid for a week by default, never past the joining day.
  const validTill = validTillRaw === undefined || validTillRaw === null || validTillRaw === '' ? [addDays(istDate(), 7), tj].sort()[0] : validTillRaw;
  if (!isDay(validTill)) throw new LifecycleOfferError(400, 'Offer valid till must be a date (YYYY-MM-DD)');
  // The candidate must be able to accept before they join.
  if (tj < validTill) throw new LifecycleOfferError(400, `The joining date (${formatDay(tj)}) is before the offer’s valid-till date (${formatDay(validTill)}). Move the joining date, or make the offer valid till an earlier day.`);
  const managerUserId = text('managerUserId', 64);
  if (managerUserId && !(await users().findOne({ userId: managerUserId, org }, { projection: { _id: 1 } }))) {
    throw new LifecycleOfferError(400, 'The reporting manager is not in this company');
  }
  const employeeType = pick('employeeType');
  if (employeeType !== undefined && employeeType !== null && !['full_time', 'intern', 'contract'].includes(String(employeeType))) {
    throw new LifecycleOfferError(400, 'Employee type must be full_time, intern or contract');
  }
  const fields: OfferFields = {
    designation: text('designation', 120, true)!,
    ctc: Math.round(ctc), tj,
    probationMonths: int('probationMonths', 0, 24, defaults.probationMonths),
    noticeDays: int('noticeDays', 0, 365, defaults.noticeDays),
    validTill,
    employeeType: (employeeType as OfferFields['employeeType']) ?? 'full_time',
  };
  const department = text('department', 120); if (department) fields.department = department;
  const location = text('location', 120); if (location) fields.location = location;
  if (managerUserId) fields.managerUserId = managerUserId;
  // A new joining date on a week-off or holiday is refused unless HR says it is meant (Day 1 is a working day).
  if (tj !== base.tj && raw.allowNonWorkingDay !== true) {
    const why = await nonWorkingDayReason(org, tj, fields.location);
    if (why) {
      throw new LifecycleOfferError(409, `${formatDay(tj)} is ${why} at this company. Pick a working day, or keep it if the joiner really starts then.`, { code: 'non_working_day', day: tj, why });
    }
  }
  const responsibilities = text('responsibilities', 5000); if (responsibilities) fields.responsibilities = responsibilities;
  return fields;
}

const LABELS: Record<keyof OfferFields, string> = {
  designation: 'Designation', department: 'Department', location: 'Work location', ctc: 'Yearly CTC', tj: 'Joining date',
  managerUserId: 'Reporting manager', probationMonths: 'Probation', noticeDays: 'Notice period', validTill: 'Offer valid till',
  responsibilities: 'Responsibilities', employeeType: 'Employee type',
};

function changed(a: OfferFields, b: OfferFields): Array<keyof OfferFields> {
  return FIELD_KEYS.filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
}

async function fieldDefaults(org: string, journey?: Journey): Promise<{ probationMonths: number; noticeDays: number }> {
  return {
    probationMonths: journey?.templateSnapshot.settings.probationMonths ?? 6,
    // The notice a resignation gets: the default offboarding template's, else the company's Exit settings.
    noticeDays: await noticeDaysFor(org),
  };
}

// ─── Read models ────────────────────────────────────────────────────────────

async function nameOf(userId: string | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  return (await users().findOne({ userId }, { projection: { _id: 0, name: 1 } }))?.name;
}

/** The HR side panel's offer (ENGINE-API read function). `hidePay` drops the CTC for staff without pay access. */
export async function offerView(journeyId: string, opts: { hidePay?: boolean } = {}): Promise<OfferView | null> {
  const offer = await offers().findOne({ journeyId });
  if (!offer) return null;
  const v = current(offer);
  const { ctc, ...rest } = v.fields;
  return {
    journeyId, version: v.version, status: v.status,
    fields: { ...rest, ...(opts.hidePay ? {} : { ctc }), managerName: await nameOf(v.fields.managerUserId) },
    changedFields: v.changedFields, refNo: v.refNo, sentAt: v.sentAt, acceptedAt: v.acceptedAt, finalisedAt: v.finalisedAt,
    validTill: v.fields.validTill, pdfFileId: v.pdfFileId,
    versions: offer.versions.map((x) => ({ version: x.version, status: x.status, sentAt: x.sentAt, acceptedAt: x.acceptedAt, changedFields: x.changedFields })),
  };
}

const maskEmail = (email: string) => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
};

/** `pdfPath`: where this caller fetches the PDF (the link's own path, or the signed-in one). */
async function buildPortalOfferView(offer: Offer, version: OfferVersion, journey: Journey, pdfPath: string): Promise<PortalOfferView> {
  const latest = latestSent(offer);
  const status = String(journey.status);
  let state: PortalOfferState;
  if (status === 'declined') state = 'declined';
  else if (status === 'expired') state = 'expired';
  else if (status === 'not_joining') state = 'not_joining';
  // Joined: the portal is open for week 1, so the link says "all set" (Sign in / Back to home), not P16's "Week 1 is done".
  else if (['moved_to_app', 'confirmed'].includes(status)) state = 'closed';
  else if (version.version !== latest.version || version.status === 'replaced') state = 'replaced';
  else if (version.status === 'expired') state = 'expired';
  else if (version.status === 'declined') state = 'declined';
  else if (version.status === 'withdrawn') state = 'closed';
  else if (version.status === 'accepted') state = version.finalisedAt ? 'finalised' : 'accepted';
  else state = 'offer';
  const company = await companyOf(journey.org);
  const { managerUserId, ...fields } = version.fields;
  const account = state === 'finalised' ? await candidateAccounts().findOne({ journeyId: journey.id }, { projection: { _id: 0, email: 1 } }) : null;
  const showTerms = state === 'offer' || state === 'accepted' || state === 'finalised';
  const manager = showTerms && managerUserId ? await users().findOne({ userId: managerUserId }, { projection: { _id: 0, name: 1, designation: 1 } }) : null;
  const pdfFile = showTerms && version.pdfFileId ? await lifecycleFiles().findOne({ id: version.pdfFileId, journeyId: journey.id }, { projection: { _id: 0 } }) : null;
  const pdfPages = pdfFile ? await pdfPageCount(pdfFile) : undefined;
  return {
    state,
    company: { name: companyDisplayName(company, journey.org), ...(company?.lifecyclePortal?.logoUrl ? { logoUrl: company.lifecyclePortal.logoUrl } : {}) },
    candidateName: journey.candidate?.name ?? '',
    version: version.version,
    ...(version.changedFields?.length ? { changedFields: version.changedFields } : {}),
    // A closed link says only that it is closed: no terms, no PDF.
    fields: showTerms
      ? { ...fields, ...(manager?.name ? { managerName: manager.name } : {}), ...(manager?.designation ? { managerDesignation: manager.designation } : {}) }
      : ({ designation: fields.designation } as PortalOfferView['fields']),
    validTill: version.fields.validTill,
    pdfUrl: showTerms && version.pdfFileId ? pdfPath : null,
    hrContact: await hrContactFor(journey, company),
    ...(company?.lifecyclePortal?.videoUrl ? { companyVideoUrl: company.lifecyclePortal.videoUrl } : {}),
    ...(account ? { loginEmailMasked: maskEmail(account.email) } : {}),
    ...(version.acceptedAt ? { acceptedAt: version.acceptedAt } : {}),
    ...(version.finalisedAt ? { finalisedAt: version.finalisedAt } : {}),
    ...(pdfPages ? { pdfPages } : {}),
  };
}

// ─── HR: create, revise, PDF, send ──────────────────────────────────────────

export async function createOffer(hr: HrActor, input: { candidate?: { name?: unknown; personalEmail?: unknown; phone?: unknown }; fields?: unknown; templateId?: unknown }): Promise<{ journeyId: string; offer: OfferView }> {
  if (!hr.seesPay) throw new LifecycleOfferError(403, 'Making an offer needs access to pay');
  const name = String(input.candidate?.name ?? '').trim();
  const personalEmail = String(input.candidate?.personalEmail ?? '').trim().toLowerCase();
  const phone = String(input.candidate?.phone ?? '').trim();
  if (!name || name.length > 120) throw new LifecycleOfferError(400, "The candidate's full name is required");
  if (!/^\S+@\S+\.\S+$/.test(personalEmail)) throw new LifecycleOfferError(400, "A valid personal email is required");
  if (phone && !/^\+?[\d\s-]{8,20}$/.test(phone)) throw new LifecycleOfferError(400, 'Phone number is invalid');
  const open = await journeys().findOne({ org: hr.org, kind: 'onboarding', 'candidate.personalEmail': personalEmail, status: { $in: [...PRE_JOIN] } }, { projection: { _id: 0, id: 1 } });
  if (open) throw new LifecycleOfferError(409, 'This candidate already has an open offer');
  const fields = await cleanFields(hr.org, input.fields, {}, await fieldDefaults(hr.org));
  const templateId = typeof input.templateId === 'string' && input.templateId ? input.templateId : undefined;
  const made: { tasks?: JourneyTask[] } = {};
  const journey = await createOnboardingJourney(hr.org, hr.userId, {
    candidate: { name, personalEmail, ...(phone ? { phone } : {}) }, tj: fields.tj, managerUserId: fields.managerUserId,
    designation: fields.designation, department: fields.department, location: fields.location, templateId,
  }, made);
  // The template's probation, when HR did not give one.
  if (!(input.fields && typeof input.fields === 'object' && 'probationMonths' in input.fields) && journey.templateSnapshot.settings.probationMonths) {
    fields.probationMonths = journey.templateSnapshot.settings.probationMonths;
  }
  const now = new Date();
  const offer: Offer = {
    id: randomUUID(), org: hr.org, journeyId: journey.id,
    versions: [{ version: 1, fields, status: 'draft', refNo: await nextRefNo(hr.org, 'OL') }],
    createdAt: now, updatedAt: now,
  };
  await offers().insertOne({ ...offer });
  // Still a draft (setJourneyStatus 'draft' implies no anchor and no task): the offer id, then one
  // refresh with the offer there (its valid-till dates accepting it). Syncing the probation refreshes too.
  await journeys().updateOne({ id: journey.id }, { $set: { offerId: offer.id, updatedAt: now } });
  if (!(await applyOfferProbation(journey.id, fields.probationMonths))) {
    await refreshJourney(journey.id, now, made.tasks ? { journey: { ...journey, offerId: offer.id, updatedAt: now }, tasks: made.tasks } : undefined);
  }
  return { journeyId: journey.id, offer: (await offerView(journey.id))! };
}

/**
 * Draft: edits in place. Sent or later: a draft version + 1 with the changed
 * fields. Nothing changes for the candidate until HR sends it (`sendOffer`):
 * their link, home and the journey's terms stay on the version they have.
 */
export async function reviseOffer(hr: HrActor | null, journeyId: string, input: unknown, org?: string): Promise<OfferView> {
  if (hr && !hr.seesPay) throw new LifecycleOfferError(403, 'Changing an offer needs access to pay');
  const journey = await journeyOf(hr?.org ?? org ?? '', journeyId, true);
  if (!PRE_JOIN_OPEN.has(String(journey.status))) throw new LifecycleOfferError(409, 'This offer can no longer be changed');
  const offer = await offerOf(journeyId);
  const v = current(offer);
  const fields = await cleanFields(journey.org, input, v.fields, await fieldDefaults(journey.org, journey));
  const diff = changed(v.fields, fields);
  const now = new Date();
  if (v.status === 'draft') {
    await offers().updateOne({ id: offer.id, 'versions.version': v.version }, {
      $set: { 'versions.$.fields': fields, ...(v.version > 1 ? { 'versions.$.changedFields': changed(offer.versions[offer.versions.length - 2].fields, fields) } : {}), updatedAt: now },
      // The PDF showed the old terms.
      ...(diff.length ? { $unset: { 'versions.$.pdfFileId': '' } } : {}),
    });
  } else {
    if (!diff.length) throw new LifecycleOfferError(400, 'Nothing changed');
    const next: OfferVersion = { version: v.version + 1, fields, changedFields: diff, status: 'draft', refNo: v.refNo };
    await offers().updateOne({ id: offer.id }, { $push: { versions: next }, $set: { updatedAt: now } });
    await reopenTask(journeyId, 'send_offer');
  }
  // A first offer nobody has seen yet shapes the journey now; a revision does when it is sent.
  if (v.status === 'draft' && v.version === 1) await applyOfferTerms(journey, fields, now);
  return (await offerView(journeyId))!;
}

/** The journey takes an offer's terms: role, team, place, manager, Tj (moving every open due date) and the probation. */
async function applyOfferTerms(journey: Journey, fields: OfferFields, now: Date): Promise<void> {
  const set: Partial<Journey> = { designation: fields.designation, department: fields.department, location: fields.location, managerUserId: fields.managerUserId };
  await journeys().updateOne({ id: journey.id }, { $set: { ...set, updatedAt: now } });
  const tj = (await journeys().findOne({ id: journey.id }, { projection: { _id: 0, tj: 1 } }))?.tj;
  if (fields.tj !== tj) await moveTj(journey.id, fields.tj);
  await applyOfferProbation(journey.id, fields.probationMonths);
}

/**
 * The offer states the probation (the template's unless HR changed it on the form): the journey
 * takes it from the start, with its month tasks, so the board, the panel, the portal and the app
 * say the same length before joining as Mark joined (`onJoined`) does after. Same range as there.
 */
async function applyOfferProbation(journeyId: string, months: number | undefined): Promise<boolean> {
  if (!Number.isInteger(months) || months! < 1 || months! > 12) return false;
  const j = await journeys().findOne({ id: journeyId }, { projection: { _id: 0, probation: 1, userId: 1 } });
  if (!j || j.userId || j.probation?.months === months) return false;
  await journeys().updateOne({ id: journeyId }, { $set: { 'probation.months': months } });
  await syncProbationTasks(journeyId);
  return true;
}

/**
 * A revision goes out: older versions are replaced (their links say so), the
 * journey takes the new terms, and the candidate accepts again (HR then
 * finalises again when they had already).
 */
async function onRevisionSent(journey: Journey, offerId: string, version: OfferVersion, now: Date): Promise<void> {
  await offers().updateOne({ id: offerId }, { $set: { 'versions.$[old].status': 'replaced', updatedAt: now } }, {
    arrayFilters: [{ 'old.version': { $lt: version.version }, 'old.status': { $in: ['sent', 'accepted', 'expired', 'declined'] } }],
  });
  await applyOfferTerms(journey, version.fields, now);
  const status = String((await journeys().findOne({ id: journey.id }, { projection: { _id: 0, status: 1 } }))?.status ?? journey.status);
  if (['finalised', 'active', 'docs_approved'].includes(status)) {
    // Past finalise (a date change, a new role): the candidate accepts again, but keeps their portal and
    // progress; there is no second finalise. Letters it changed are dealt with when they accept.
    await reopenTask(journey.id, 'accept_offer');
  } else if (status === 'accepted') {
    await setJourneyStatus(journey.id, 'offer_sent');
    await reopenTask(journey.id, 'accept_offer');
  }
}

export async function uploadOfferPdf(hr: HrActor, journeyId: string, file: { originalname?: string; buffer: Buffer } | undefined): Promise<OfferView> {
  if (!hr.seesPay) throw new LifecycleOfferError(403, 'Changing an offer needs access to pay');
  if (!file) throw new LifecycleOfferError(400, 'Attach the offer letter PDF as "file"');
  const journey = await journeyOf(hr.org, journeyId);
  const offer = await offerOf(journeyId);
  const v = current(offer);
  if (v.status !== 'draft') throw new LifecycleOfferError(409, 'This version was sent; change the offer to make a new version');
  checkUpload(file.buffer, { pdfOnly: true });
  const stored = await storeFile(journey.org, journeyId, { name: file.originalname || `Offer letter - ${journey.candidate?.name ?? ''}.pdf`, contentType: 'application/pdf', bytes: file.buffer }, 'hr');
  await offers().updateOne({ id: offer.id, 'versions.version': v.version }, { $set: { 'versions.$.pdfFileId': stored.id, updatedAt: new Date() } });
  return (await offerView(journeyId))!;
}

/** Emails the offer (PDF attached, the personal link) and marks the version sent. Re-sending a sent version issues a new link. */
/** `attachments` go beside the offer PDF. `withPortalLink` is no longer used: no accept link is sent. */
export async function sendOffer(hr: HrActor, journeyId: string, input: { subject?: unknown; body?: unknown; cc?: unknown; withPortalLink?: unknown; attachments?: LifecycleAttachment[] }, now = new Date()): Promise<OfferView> {
  const journey = await journeyOf(hr.org, journeyId);
  if (!PRE_JOIN_OPEN.has(String(journey.status))) throw new LifecycleOfferError(409, 'This offer is closed');
  const offer = await offerOf(journeyId);
  const v = current(offer);
  if (v.status !== 'draft' && v.status !== 'sent') throw new LifecycleOfferError(409, 'This version can no longer be sent');
  if (!v.pdfFileId) throw new LifecycleOfferError(409, 'Upload the offer letter PDF first');
  if (v.fields.validTill < istDate(now)) throw new LifecycleOfferError(400, 'The offer’s valid-till date has passed; change it first');
  const file = await lifecycleFiles().findOne({ id: v.pdfFileId, org: journey.org });
  if (!file) throw new LifecycleOfferError(409, 'Upload the offer letter PDF first');
  const company = await companyOf(journey.org);
  const companyName = companyDisplayName(company, journey.org);
  const subject = String(input.subject ?? '').trim() || `Your offer from ${companyName}`;
  const body = String(input.body ?? '').trim()
    || `Hi ${journey.candidate?.name?.split(' ')[0] ?? ''},\n\nCongratulations! We are delighted to offer you the role of ${v.fields.designation} at ${companyName}. Your offer letter is attached.\n\n${onlineAcceptOn()
      ? `You can read it and accept it online using the button below. Please reply by ${formatDay(v.fields.validTill)}.`
      : `To accept it, please reply to this email by ${formatDay(v.fields.validTill)}. Once you do, we will send you the link to your joining portal.`} If you have any questions, just reply to this email.\n\nWarm regards,\n${hr.name}`;
  if (subject.length > 200 || body.length > 20_000) throw new LifecycleOfferError(400, 'The email is too long');
  const cc = Array.isArray(input.cc) ? input.cc.map(String).filter((a) => /^\S+@\S+\.\S+$/.test(a.trim())).slice(0, 10) : [];
  const token = newLinkToken();
  const revision = v.status === 'draft' && v.version > 1;
  await offers().updateOne({ id: offer.id, 'versions.version': v.version }, {
    $set: { 'versions.$.status': 'sent', 'versions.$.sentAt': now, 'versions.$.linkTokenHash': sha256(token), updatedAt: now },
  });
  if (revision) await onRevisionSent(journey, offer.id, v, now);
  const statusNow = String((await journeys().findOne({ id: journeyId }, { projection: { _id: 0, status: 1 } }))?.status ?? journey.status);
  if (['draft', 'offer_sent'].includes(statusNow)) await setJourneyStatus(journeyId, 'offer_sent');
  await completeTask(journeyId, 'send_offer', { userId: hr.userId, name: hr.name });
  const bytes = await readFileBytes(file);
  const contact = await hrContactFor(journey, company);
  // The offer goes as its PDF only: the candidate accepts by replying to HR, and HR marks it accepted
  // (finaliseOffer), which sends the joining portal. No accept link goes out (since 23 Nov 2026).
  await sendLifecycleEmail(journey.org, journey.candidate!.personalEmail, subject,
    mails.offer(companyName, body, onlineAcceptOn() && input.withPortalLink !== false ? portalLink(`/o/${token}`, journey.org) : null),
    [{ filename: file.name.endsWith('.pdf') ? file.name : `${file.name}.pdf`, content: bytes, contentType: 'application/pdf' }, ...(input.attachments ?? [])],
    { cc, replyTo: contact.email || undefined });
  return (await offerView(journeyId))!;
}

// ─── Candidate: the offer link ──────────────────────────────────────────────

async function offerByToken(token: string): Promise<{ offer: Offer; version: OfferVersion; journey: Journey }> {
  const hash = /^[A-Za-z0-9_-]{20,100}$/.test(token) ? sha256(token) : '';
  const offer = hash ? await offers().findOne({ 'versions.linkTokenHash': hash }) : null;
  const version = offer?.versions.find((x) => x.linkTokenHash === hash);
  const journey = offer ? await journeys().findOne({ id: offer.journeyId }) : null;
  if (!offer || !version || !journey || !(await lifecycleEnabled(journey.org))) throw new LifecycleOfferError(404, 'This link is not valid');
  return { offer, version, journey };
}

/** An unaccepted, sent version past its valid-till date expires (the job does this too; the link does not wait for it). */
async function expireIfDue(offer: Offer, version: OfferVersion, journey: Journey, now: Date): Promise<boolean> {
  if (version.status !== 'sent' || version.fields.validTill >= istDate(now)) return false;
  await offers().updateOne({ id: offer.id, 'versions.version': version.version }, { $set: { 'versions.$.status': 'expired', updatedAt: now } });
  version.status = 'expired';
  if (String(journey.status) === 'offer_sent') {
    await closeJourney(journey.id, 'expired', `Not accepted by ${formatDay(version.fields.validTill)}`);
    journey.status = 'expired';
  }
  return true;
}

/** The company an offer link belongs to, or null for a link that matches no offer (the routes' host check). */
export async function orgOfOfferToken(token: string): Promise<string | null> {
  try { return (await offerByToken(token)).journey.org; } catch { return null; }
}

export async function openOfferLink(token: string, ip: string, now = new Date()): Promise<PortalOfferView> {
  rateLimit('portal-offer', ip, LIMITS.offerLink.max, LIMITS.offerLink.windowMs, now.getTime());
  const { offer, version, journey } = await offerByToken(token);
  await expireIfDue(offer, version, journey, now);
  if (!CLOSED_STATUSES.has(String(journey.status))) await journeys().updateOne({ id: journey.id }, { $set: { lastActivityAt: now } });
  return buildPortalOfferView(offer, version, journey, `/portal/offer/${token}/pdf`);
}

export async function offerLinkPdf(token: string, ip: string, now = new Date()): Promise<{ name: string; bytes: Buffer }> {
  rateLimit('portal-offer', ip, LIMITS.offerLink.max, LIMITS.offerLink.windowMs, now.getTime());
  const { offer, version, journey } = await offerByToken(token);
  const view = await buildPortalOfferView(offer, version, journey, `/portal/offer/${token}/pdf`);
  if (!view.pdfUrl || !version.pdfFileId) throw new LifecycleOfferError(404, 'This offer is no longer open');
  const file = await lifecycleFiles().findOne({ id: version.pdfFileId, journeyId: journey.id });
  if (!file) throw new LifecycleOfferError(404, 'File not found');
  return { name: file.name, bytes: await readFileBytes(file) };
}

export async function acceptOffer(token: string, meta: { ip: string; userAgent?: string }, now = new Date()): Promise<PortalOfferView> {
  rateLimit('portal-offer', meta.ip, LIMITS.offerLink.max, LIMITS.offerLink.windowMs, now.getTime());
  const { offer, version, journey } = await offerByToken(token);
  return acceptVersion(offer, version, journey, meta, `/portal/offer/${token}/pdf`, now);
}

/**
 * Accepting online is off: the candidate replies to HR's email and HR marks the offer accepted.
 * Only the check scripts turn it on (OFFER_ONLINE_ACCEPT=1, never set on a server), to walk flows that start
 * with the candidate's accept.
 */
export const offerRules = { onlineAccept: false };
const onlineAcceptOn = () => offerRules.onlineAccept || process.env.OFFER_ONLINE_ACCEPT === '1';

/** Latest version only, once; stores time, IP and device; HR is emailed to finalise. */
async function acceptVersion(offer: Offer, version: OfferVersion, journey: Journey, meta: { ip: string; userAgent?: string }, pdfPath: string, now: Date): Promise<PortalOfferView> {
  if (!onlineAcceptOn()) throw new LifecycleOfferError(403, 'To accept this offer, reply to HR’s email. HR will confirm it and send you your joining portal.');
  await expireIfDue(offer, version, journey, now);
  const latest = latestSent(offer);
  if (CLOSED_STATUSES.has(String(journey.status)) || ['joined'].includes(String(journey.status))) throw new LifecycleOfferError(409, 'This offer is closed');
  if (version.version !== latest.version || version.status === 'replaced') throw new LifecycleOfferError(409, 'You have a newer offer. Open the latest email to see it.');
  if (version.status === 'accepted') return buildPortalOfferView(offer, version, journey, pdfPath);
  if (version.status !== 'sent') throw new LifecycleOfferError(409, 'This offer is no longer open');
  const updated = await offers().findOneAndUpdate(
    { id: offer.id, versions: { $elemMatch: { version: version.version, status: 'sent' } } },
    { $set: { 'versions.$.status': 'accepted', 'versions.$.acceptedAt': now, 'versions.$.acceptedIp': meta.ip.slice(0, 64), 'versions.$.acceptedDevice': String(meta.userAgent ?? '').slice(0, 300), updatedAt: now } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new LifecycleOfferError(409, 'This offer is no longer open');
  if (['finalised', 'active', 'docs_approved'].includes(String(journey.status))) {
    // A revision accepted by someone already finalised: it counts as finalised (their login exists), the
    // journey stays where they had got to, and letters whose fields changed are out of date to sign again.
    await offers().updateOne({ id: offer.id, 'versions.version': version.version }, { $set: { 'versions.$.finalisedAt': now, 'versions.$.finalisedByUserId': 'automatic', updatedAt: now } });
    await journeys().updateOne({ id: journey.id }, { $set: { lastActivityAt: now, updatedAt: now } });
    await completeTask(journey.id, 'accept_offer', { name: journey.candidate?.name });
    const changed = await outdateChangedLetters(journey.id, now);
    const company = await companyOf(journey.org);
    const creator = await users().findOne({ userId: journey.createdByUserId, org: journey.org }, { projection: { _id: 0, email: 1 } });
    if (creator?.email) {
      await sendLifecycleEmail(journey.org, creator.email, `${journey.candidate?.name ?? 'A candidate'} accepted the updated offer${changed.length ? ': letters to sign again' : ''}`,
        mails.hrRevisionAccepted(companyDisplayName(company, journey.org), journey.candidate?.name ?? '', version.version, changed.map((c) => (c.kind === 'nda' ? 'NDA' : 'appointment letter'))));
    }
    const freshJourney = (await journeys().findOne({ id: journey.id }))!;
    const fresh = (await offers().findOne({ id: offer.id }))!;
    return buildPortalOfferView(fresh, fresh.versions.find((x) => x.version === version.version)!, freshJourney, pdfPath);
  }
  await setJourneyStatus(journey.id, 'accepted', { lastActivityAt: now });
  await completeTask(journey.id, 'accept_offer', { name: journey.candidate?.name });
  // HR: the board alert is the engine's flag; the email is here.
  const company = await companyOf(journey.org);
  const creator = await users().findOne({ userId: journey.createdByUserId, org: journey.org }, { projection: { _id: 0, email: 1 } });
  if (creator?.email) {
    await sendLifecycleEmail(journey.org, creator.email, `${journey.candidate?.name ?? 'A candidate'} accepted the offer: finalise it`,
      mails.hrOfferAccepted(companyDisplayName(company, journey.org), journey.candidate?.name ?? '', version.version));
  }
  const fresh = (await journeys().findOne({ id: journey.id }))!;
  return buildPortalOfferView(updated, updated.versions.find((x) => x.version === version.version)!, fresh, pdfPath);
}

// ─── Candidate, signed in: the current offer (a revised one is reviewed from home) ──

const ME_PDF = '/portal/me/offer/pdf';
/** The latest version that was sent (a draft revision is not shown until HR sends it). */
async function sessionOffer(journey: Journey): Promise<{ offer: Offer; version: OfferVersion }> {
  const offer = await offerOf(journey.id);
  const version = [...offer.versions].reverse().find((v) => v.status !== 'draft');
  if (!version) throw new LifecycleOfferError(404, 'No offer has been sent yet');
  return { offer, version };
}

export async function portalOfferForJourney(journey: Journey, now = new Date()): Promise<PortalOfferView> {
  const { offer, version } = await sessionOffer(journey);
  await expireIfDue(offer, version, journey, now);
  return buildPortalOfferView(offer, version, journey, ME_PDF);
}

export async function portalOfferPdfForJourney(journey: Journey): Promise<{ name: string; bytes: Buffer }> {
  const { offer, version } = await sessionOffer(journey);
  const view = await buildPortalOfferView(offer, version, journey, ME_PDF);
  if (!view.pdfUrl || !version.pdfFileId) throw new LifecycleOfferError(404, 'This offer is no longer open');
  const file = await lifecycleFiles().findOne({ id: version.pdfFileId, journeyId: journey.id });
  if (!file) throw new LifecycleOfferError(404, 'File not found');
  return { name: file.name, bytes: await readFileBytes(file) };
}

export async function acceptOfferForJourney(journey: Journey, meta: { ip: string; userAgent?: string }, now = new Date()): Promise<PortalOfferView> {
  const { offer, version } = await sessionOffer(journey);
  return acceptVersion(offer, version, journey, meta, ME_PDF, now);
}

// ─── HR: finalise, decline, reopen, not joining, mark joined ────────────────

/** Two-sided acceptance: HR accepts the candidate's accepted version. The first time, the portal account is created and the login emailed. */
export async function finaliseOffer(hr: HrActor, journeyId: string, now = new Date()): Promise<OfferView> {
  const journey = await journeyOf(hr.org, journeyId);
  const status = String(journey.status);
  // HR records the candidate's yes (they replied to the email): from a sent offer, or a revision
  // sent to someone already finalised.
  const revision = ['finalised', 'active', 'docs_approved'].includes(status);
  if (!(onlineAcceptOn() ? status === 'accepted' : ['offer_sent', 'accepted'].includes(status) || revision)) throw new LifecycleOfferError(409, onlineAcceptOn() ? 'Only an accepted offer can be finalised' : 'Only a sent offer can be marked accepted');
  const offer = await offerOf(journeyId);
  // A revision HR is still drafting does not hold this up: the candidate accepted what they were sent.
  const v = latestSent(offer);
  if (v.status !== 'accepted' && !(v.status === 'sent' && !onlineAcceptOn())) {
    throw new LifecycleOfferError(409, v.status === 'sent' ? 'The candidate has not accepted the latest version yet' : 'Send the offer before marking it accepted');
  }
  if (v.finalisedAt) throw new LifecycleOfferError(409, 'Already finalised');
  await offers().updateOne({ id: offer.id, 'versions.version': v.version }, { $set: {
    ...(v.status === 'sent' ? { 'versions.$.status': 'accepted', 'versions.$.acceptedAt': now, 'versions.$.acceptedDevice': `Confirmed by HR (${hr.name})` } : {}),
    'versions.$.finalisedAt': now, 'versions.$.finalisedByUserId': hr.userId, updatedAt: now,
  } });
  if (v.status === 'sent') await completeTask(journeyId, 'accept_offer', { name: journey.candidate?.name });
  // A revision: letters whose fields changed are out of date and are signed again.
  if (revision && v.status === 'sent') await outdateChangedLetters(journeyId, now);
  const created = await createCandidateAccount(journey);
  const company = await companyOf(journey.org);
  const companyName = companyDisplayName(company, journey.org);
  if (created) {
    await setJourneyStatus(journeyId, 'finalised');
    await sendLifecycleEmail(journey.org, created.account.email, `Your ${companyName} joining portal is ready`,
      mails.portalReady(companyName, journey.candidate?.name ?? '', created.account.email, journey.org));
    await candidateAccounts().updateOne({ journeyId }, { $set: { loginSentAt: now } });
    // The manager's set-up to-do arrives in the app (the task itself opens on the finalised anchor).
    if (journey.managerUserId) {
      await notifyUsers([journey.managerUserId], {
        scenario: 'lifecycle_joiner_setup', title: `Set up ${journey.candidate?.name ?? 'your new joiner'}`,
        body: `Joining ${formatDay(journey.tj)}. Pick people to meet, write a welcome note and name a buddy.`,
        // `destination` opens the manager's set-up screen from the push (the launcher routes by it).
        data: { type: 'lifecycle_joiner_setup', destination: 'lifecycle_joiner_setup', journeyId },
      });
    }
  } else {
    // A revised offer finalised again: back where the candidate had got to.
    const account = await candidateAccounts().findOne({ journeyId });
    const status = (await allRequiredApproved(journeyId)) ? 'docs_approved' : account?.lastSignInAt ? 'active' : 'finalised';
    await setJourneyStatus(journeyId, status);
    await regenerateAppointmentLetters(journeyId);
  }
  await completeTask(journeyId, 'finalise_offer', { userId: hr.userId, name: hr.name });
  return (await offerView(journeyId))!;
}

async function tellManager(journey: Journey, scenario: string, title: string, body: string) {
  if (!journey.managerUserId) return;
  await notifyUsers([journey.managerUserId], { scenario, title, body, data: { type: scenario, journeyId: journey.id } });
}

/** The candidate said no by email. Only before they join; HR can reopen. */
export async function declineOffer(hr: HrActor, journeyId: string, note?: unknown): Promise<Journey> {
  const journey = await journeyOf(hr.org, journeyId);
  if (!['offer_sent', 'accepted'].includes(String(journey.status))) throw new LifecycleOfferError(409, 'Only a sent or accepted offer can be marked declined');
  const offer = await offerOf(journeyId);
  const v = latestSent(offer);
  await offers().updateOne({ id: offer.id, 'versions.version': v.version }, { $set: { 'versions.$.status': 'declined', updatedAt: new Date() } });
  await closeJourney(journeyId, 'declined', String(note ?? '').trim().slice(0, 1000) || 'Declined by email');
  await tellManager(journey, 'lifecycle_offer_declined', `${journey.candidate?.name ?? 'Your new joiner'} declined the offer`, 'HR marked the offer declined.');
  return (await journeys().findOne({ id: journeyId }, { projection: { _id: 0, templateSnapshot: 0 } }))!;
}

/** Declined or expired back to open: the same version again when it is still valid, else a draft for HR to revise. */
export async function reopenOffer(hr: HrActor, journeyId: string, now = new Date()): Promise<Journey> {
  const journey = await journeyOf(hr.org, journeyId);
  if (!['declined', 'expired'].includes(String(journey.status))) throw new LifecycleOfferError(409, 'Only a declined or expired offer can be reopened');
  const offer = await offerOf(journeyId);
  const v = latestSent(offer);
  await journeys().updateOne({ id: journeyId }, { $unset: { closedAt: '', closedReason: '' } });
  const stillValid = v.status === 'declined' && v.fields.validTill >= istDate(now) && Boolean(v.linkTokenHash);
  if (stillValid) {
    await offers().updateOne({ id: offer.id, 'versions.version': v.version }, { $set: { 'versions.$.status': 'sent', updatedAt: now }, $unset: { 'versions.$.acceptedAt': '' } });
    await setJourneyStatus(journeyId, 'offer_sent');
  } else {
    await setJourneyStatus(journeyId, 'draft');
    await reopenTask(journeyId, 'send_offer');
  }
  await reopenTask(journeyId, 'accept_offer');
  return (await journeys().findOne({ id: journeyId }, { projection: { _id: 0, templateSnapshot: 0 } }))!;
}

/** Any time after acceptance and before joining: tasks cancelled, portal locked, the manager told. */
export async function markNotJoining(hr: HrActor, journeyId: string, note?: unknown): Promise<Journey> {
  const journey = await journeyOf(hr.org, journeyId);
  if (!['accepted', 'finalised', 'active', 'docs_approved'].includes(String(journey.status))) throw new LifecycleOfferError(409, 'Only an accepted offer can be marked not joining');
  const offer = await offerOf(journeyId);
  const v = current(offer);
  if (v.status !== 'accepted') await offers().updateOne({ id: offer.id, 'versions.version': v.version }, { $set: { 'versions.$.status': 'withdrawn', updatedAt: new Date() } });
  await closeJourney(journeyId, 'not_joining', String(note ?? '').trim().slice(0, 1000) || 'Not joining');
  await tellManager(journey, 'lifecycle_not_joining', `${journey.candidate?.name ?? 'Your new joiner'} is not joining`, 'HR cancelled the joining.');
  return (await journeys().findOne({ id: journeyId }, { projection: { _id: 0, templateSnapshot: 0 } }))!;
}

/** On or after Tj: the employee record is created from the accepted offer and the engine takes over. */
export async function markJoined(hr: HrActor, journeyId: string, input: { workEmail?: unknown; employeeId?: unknown }, now = new Date()): Promise<{ journey: Journey; userId: string }> {
  const journey = await journeyOf(hr.org, journeyId);
  if (!['finalised', 'active', 'docs_approved'].includes(String(journey.status))) throw new LifecycleOfferError(409, 'Only a finalised offer can be marked joined');
  const offer = await offerOf(journeyId);
  const v = latestSent(offer);
  if (v.status !== 'accepted' || !v.finalisedAt) throw new LifecycleOfferError(409, 'The latest offer is not accepted and finalised');
  // The journey's Tj: an approved date change moves it before HR has sent (or the candidate accepted) the revised offer.
  const tj = journey.tj ?? v.fields.tj;
  if (istDate(now) < tj) throw new LifecycleOfferError(409, `Mark joined opens on the joining day (${formatDay(tj)})`);
  const workEmail = String(input.workEmail ?? '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(workEmail)) throw new LifecycleOfferError(400, 'A valid work email is required');
  const employeeId = String(input.employeeId ?? '').trim() || undefined;
  let userId: string;
  try {
    const employee = await createEmployeeForAdmin(hr.userId, {
      name: journey.candidate?.name, email: workEmail, designation: v.fields.designation, department: v.fields.department,
      location: v.fields.location, employeeType: v.fields.employeeType, managerUserId: v.fields.managerUserId,
      joiningDate: tj, employeeId, mobile: journey.candidate?.phone,
    });
    userId = employee.userId;
  } catch (error) {
    if (error instanceof AdminError) throw new LifecycleOfferError(error.statusCode, error.message);
    throw error;
  }
  if (journey.candidate?.personalEmail) await users().updateOne({ userId }, { $set: { personalEmail: journey.candidate.personalEmail } });
  await journeys().updateOne({ id: journeyId }, { $set: { 'candidate.workEmail': workEmail, updatedAt: now } });
  await completeTask(journeyId, 'mark_joined', { userId: hr.userId, name: hr.name });
  await onJoined(journeyId, userId);
  // The joiner hears where to go next: the app, signed in with the new work email. To the personal
  // address they have been reading all along, the work address copied (it may not be set up yet).
  const personal = journey.candidate?.personalEmail;
  if (personal) {
    const company = await companyOf(journey.org);
    await sendLifecycleEmail(journey.org, personal, `Welcome to ${companyDisplayName(company, journey.org)}: sign in to the Sowaka app`,
      mails.joinedWelcome(companyDisplayName(company, journey.org), journey.candidate?.name ?? '', workEmail),
      [], personal.toLowerCase() === workEmail ? {} : { cc: [workEmail] }).catch(() => { /* a mail that fails never undoes the joining */ });
  }
  return { journey: (await journeys().findOne({ id: journeyId }, { projection: { _id: 0, templateSnapshot: 0 } }))!, userId };
}

// ─── Date-change requests ───────────────────────────────────────────────────

const REASONS: DateChangeRequest['reason'][] = ['Notice period', 'Personal', 'Something else'];

export async function createDateRequest(journey: Journey, input: { requestedTj?: unknown; reason?: unknown; note?: unknown }, now = new Date()): Promise<DateChangeRequest> {
  if (!['accepted', 'finalised', 'active', 'docs_approved'].includes(String(journey.status))) throw new LifecycleOfferError(409, 'The joining date can no longer be changed here');
  const requestedTj = input.requestedTj;
  if (!isDay(requestedTj)) throw new LifecycleOfferError(400, 'Pick a date');
  if (requestedTj <= istDate(now)) throw new LifecycleOfferError(400, 'Pick a date after today');
  if (requestedTj === journey.tj) throw new LifecycleOfferError(400, 'That is already your joining date');
  const why = await nonWorkingDayReason(journey.org, requestedTj, journey.location);
  if (why) throw new LifecycleOfferError(400, `${formatDay(requestedTj)} is ${why}. Pick a working day.`, { code: 'non_working_day', day: requestedTj, why });
  const reason = String(input.reason ?? '') as DateChangeRequest['reason'];
  if (!REASONS.includes(reason)) throw new LifecycleOfferError(400, 'Pick a reason');
  const note = String(input.note ?? '').trim();
  if (note.length > 1000) throw new LifecycleOfferError(400, 'The note is too long');
  if (await dateChangeRequests().findOne({ journeyId: journey.id, status: 'pending' })) throw new LifecycleOfferError(409, 'You already asked for a new date; HR will reply soon');
  const request: DateChangeRequest = {
    id: randomUUID(), org: journey.org, journeyId: journey.id, requestedTj, reason, ...(note ? { note } : {}), status: 'pending', createdAt: now,
  };
  await dateChangeRequests().insertOne({ ...request });
  await notifyUsers([journey.createdByUserId], {
    scenario: 'lifecycle_date_request', title: `${journey.candidate?.name ?? 'A joiner'} asked for a new joining date`,
    body: `${formatDay(requestedTj)} instead of ${formatDay(journey.tj)} · ${reason}`, data: { type: 'lifecycle_date_request', journeyId: journey.id }, push: false,
  });
  return request;
}

/** Approve: the offer is revised with the new Tj (v+1 once sent), every open due date moves, the manager is told. Either way the candidate gets an email. */
export async function decideDateRequest(hr: HrActor, requestId: string, input: { decision?: unknown; note?: unknown }, now = new Date()): Promise<DateChangeRequest> {
  const request = await dateChangeRequests().findOne({ id: requestId, org: hr.org });
  if (!request) throw new LifecycleOfferError(404, 'Request not found');
  if (request.status !== 'pending') throw new LifecycleOfferError(409, 'Already decided');
  const decision = String(input.decision ?? '');
  if (decision !== 'approve' && decision !== 'decline') throw new LifecycleOfferError(400, 'Decision must be approve or decline');
  const note = String(input.note ?? '').trim().slice(0, 1000);
  const journey = await journeyOf(hr.org, request.journeyId);
  if (decision === 'approve') {
    if (!PRE_JOIN_OPEN.has(String(journey.status))) throw new LifecycleOfferError(409, 'This joiner’s offer is closed');
    // The candidate's date was a working day when asked (createDateRequest); HR's approval stands even if that changed.
    await reviseOffer(null, journey.id, { tj: request.requestedTj, allowNonWorkingDay: true }, hr.org);
    await moveTj(journey.id, request.requestedTj);
    await completeTask(journey.id, 'new_joining_date', { userId: hr.userId, name: hr.name });
    await tellManager(journey, 'lifecycle_joining_date_moved', `${journey.candidate?.name ?? 'Your new joiner'} now joins ${formatDay(request.requestedTj)}`, `Moved from ${formatDay(journey.tj)}.`);
  }
  const decided = await dateChangeRequests().findOneAndUpdate({ id: requestId, status: 'pending' }, {
    $set: { status: decision === 'approve' ? 'approved' : 'declined', decidedAt: now, decidedByName: hr.name },
  }, { returnDocument: 'after' });
  const company = await companyOf(journey.org);
  if (journey.candidate?.personalEmail) {
    await sendLifecycleEmail(journey.org, journey.candidate.personalEmail,
      decision === 'approve' ? `Your new joining date: ${formatDay(request.requestedTj)}` : 'About your joining date',
      mails.dateChange(companyDisplayName(company, journey.org), journey.candidate.name, decision === 'approve', formatDay(request.requestedTj), note || undefined, journey.org));
  }
  return decided!;
}

export async function journeyDateRequests(journeyId: string): Promise<DateChangeRequest[]> {
  return dateChangeRequests().find({ journeyId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
}
