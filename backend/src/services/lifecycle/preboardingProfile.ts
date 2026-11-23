/**
 * The dashboard's pre-boarding profile (HR): what the candidate entered in each Employee profile
 * section, as label/value pairs, with the section's documents and HR's approval; approving locks the
 * section for the candidate (profileLock.ts), unlocking opens it again. Also the Employees page's
 * "In pre-boarding" list, and a joined employee's onboarding documents.
 *
 * Secrets stay as stored: the account number and Aadhaar (and PAN) as their last four only.
 * Document files are linked through the dashboard's authorised file route (`/admin/lifecycle/files/:id`,
 * opened with the dashboard's Bearer token), never a public URL.
 */
import { candidateDocuments, journeys, lifecycleFiles } from '../../config/db';
import type { CandidateDocument, Journey, ProfileApproval } from '../../models/lifecycle.model';
import { documentListFor, journeyDocumentsView, type CandidateDocumentView } from './documents';
import { LifecycleOfferError } from './files';
import { PROFILE_SECTION_TITLE, PROFILE_SECTIONS, sectionStates, type ProfileSection } from './profile';
import { sectionOfDocument } from './profileLock';

/** The dashboard's authorised link to a stored lifecycle file (fetched with its Bearer token). */
export const lifecycleFileUrl = (fileId: string) => `/admin/lifecycle/files/${encodeURIComponent(fileId)}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '1998-03-12' → '12 Mar 1998'. */
function longDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : day;
}
/** '2020-03' → 'Mar 2020'. */
function monthOf(month?: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : 'now';
}
const addressLine = (a?: { line: string; city: string; state: string; pin: string }) => (a ? `${a.line}, ${a.city}, ${a.state} ${a.pin}` : '');
type Contact = { name: string; relation: string; phone: string; altPhone?: string };
const contactLine = (c: Contact) => `${c.name} (${c.relation}) · ${c.phone}${c.altPhone ? ` · ${c.altPhone}` : ''}`;

export interface ProfileField { label: string; value: string }

/** What the candidate entered in one section, in the portal's order and words (empty answers left out). */
export function sectionFields(journey: Pick<Journey, 'profile' | 'aboutYou' | 'candidate'>, section: ProfileSection): ProfileField[] {
  const p = journey.profile ?? {};
  const about = journey.aboutYou ?? {};
  const rows: Array<[string, string | undefined]> = [];
  switch (section) {
    case 'personal':
      if (p.personal) {
        rows.push(['Full name', p.personal.fullName], ['Preferred name', p.personal.preferredName], ['Date of birth', p.personal.dob ? longDay(p.personal.dob) : undefined],
          ['Gender', p.personal.gender], ['Marital status', p.personal.maritalStatus], ['Nationality', p.personal.nationality], ['Blood group', p.personal.bloodGroup]);
      }
      break;
    case 'contact':
      if (p.contact) {
        rows.push(['Personal email', journey.candidate?.personalEmail], ['Mobile', p.contact.mobile], ['Current address', addressLine(p.contact.current)],
          ['Permanent address', p.contact.permanentSame ? 'Same as current address' : addressLine(p.contact.permanent)]);
      }
      break;
    case 'emergency':
      if (about.emergencyContact) {
        const c = about.emergencyContact;
        rows.push(['Name', c.name], ['Relationship', c.relation], ['Mobile', c.phone], ['Other number', c.altPhone]);
      }
      if (about.emergencyContact2) rows.push(['Second contact', contactLine(about.emergencyContact2)]);
      break;
    case 'bank':
      if (p.bank) {
        rows.push(['Account holder', p.bank.holderName], ['Account number', p.bank.accountLast4 ? `•••• ${p.bank.accountLast4}` : undefined], ['IFSC', p.bank.ifsc], ['Bank', p.bank.bankName]);
      }
      if (about.pf) rows.push(['PF', about.pf.firstJob ? 'First job: no UAN yet' : about.pf.uan ? `UAN ${about.pf.uan}` : 'Has a UAN, not given']);
      break;
    case 'education':
      if (p.education) rows.push(['Highest qualification', p.education.qualification], ['College or university', p.education.institution], ['Year of passing', p.education.year]);
      if (p.experience) {
        if (p.experience.firstJob || !p.experience.jobs.length) rows.push(['Experience', 'First job']);
        else p.experience.jobs.forEach((j, i) => rows.push([i === 0 ? 'Last job' : `Job ${i + 1}`, `${j.role} at ${j.company} (${monthOf(j.from)} – ${monthOf(j.to)})`]));
      }
      break;
    case 'ids':
      rows.push(['Aadhaar', p.ids?.aadhaarLast4 ? `•••• •••• ${p.ids.aadhaarLast4}` : undefined], ['PAN', p.ids?.panLast4 ? `••••••${p.ids.panLast4}` : undefined]);
      break;
    default:
      break;
  }
  return rows.filter((r): r is [string, string] => typeof r[1] === 'string' && r[1].trim() !== '').map(([label, value]) => ({ label, value }));
}

const fileView = (f: CandidateDocumentView['files'][number]) => ({ id: f.id, name: f.name, contentType: f.contentType, size: f.size, url: lifecycleFileUrl(f.id) });
const documentView = (d: CandidateDocumentView) => ({ id: d.id, label: d.label, required: d.required, status: d.status, ...(d.hrNote ? { hrNote: d.hrNote } : {}), files: d.files.map(fileView) });
const approvalView = (a?: ProfileApproval) => (a ? { byName: a.byName, at: new Date(a.at).toISOString() } : undefined);

/** GET /admin/lifecycle/journeys/:id/profile — the whole pre-boarding profile, as HR reads it. */
export async function hrProfileView(journey: Journey) {
  const docs = await journeyDocumentsView(journey.id);
  const done = sectionStates(journey, docs);
  const c = journey.candidate;
  return {
    journeyId: journey.id,
    candidate: {
      name: c?.name ?? '',
      ...(c?.personalEmail ? { personalEmail: c.personalEmail } : {}),
      ...(c?.phone ? { phone: c.phone } : {}),
      ...(journey.designation ? { designation: journey.designation } : {}),
      ...(journey.department ? { department: journey.department } : {}),
      ...(journey.tj ? { tj: journey.tj } : {}),
      status: String(journey.status),
    },
    done: PROFILE_SECTIONS.filter((k) => done[k]).length,
    total: PROFILE_SECTIONS.length,
    sections: PROFILE_SECTIONS.map((key) => {
      const approved = approvalView(journey.profileApprovals?.[key]);
      return {
        key, title: PROFILE_SECTION_TITLE[key], done: done[key], ...(approved ? { approved } : {}),
        fields: sectionFields(journey, key),
        documents: docs.filter((d) => sectionOfDocument(d) === key).map(documentView),
      };
    }),
  };
}

function sectionOf(raw: unknown): ProfileSection {
  const s = PROFILE_SECTIONS.find((k) => k === raw);
  if (!s) throw new LifecycleOfferError(400, `section is one of ${PROFILE_SECTIONS.join(', ')}`);
  return s;
}

/** POST …/profile/:section/approve — only a section that is done; it locks for the candidate. */
export async function approveProfileSection(hr: { userId: string; name: string }, journey: Journey, sectionRaw: unknown, now = new Date()) {
  const section = sectionOf(sectionRaw);
  const done = sectionStates(journey, await journeyDocumentsView(journey.id));
  if (!done[section]) throw new LifecycleOfferError(409, 'This section isn\'t complete yet');
  const approval: ProfileApproval = { byUserId: hr.userId, byName: hr.name, at: now };
  await journeys().updateOne({ id: journey.id }, { $set: { [`profileApprovals.${section}`]: approval, updatedAt: now } });
  return hrProfileView({ ...journey, profileApprovals: { ...(journey.profileApprovals ?? {}), [section]: approval } });
}

/** DELETE …/profile/:section/approve — unlocks it again (nothing to undo is fine). */
export async function unlockProfileSection(journey: Journey, sectionRaw: unknown, now = new Date()) {
  const section = sectionOf(sectionRaw);
  const approvals = { ...(journey.profileApprovals ?? {}) };
  if (approvals[section]) {
    delete approvals[section];
    await journeys().updateOne({ id: journey.id }, { $unset: { [`profileApprovals.${section}`]: '' }, $set: { updatedAt: now } });
  }
  return hrProfileView({ ...journey, profileApprovals: approvals });
}

/** Statuses that are no longer pre-boarding: joined (or later) or closed. */
const NOT_PREBOARDING = ['joined', 'moved_to_app', 'confirmed', 'declined', 'expired', 'not_joining'];

export interface PreboardingRow {
  journeyId: string; name: string; designation?: string; department?: string; tj?: string; status: string;
  profileDone: number; profileTotal: number; approvedSections: number; documentsWaiting: number;
}

/** GET /admin/lifecycle/preboarding — everyone still in pre-boarding (the Employees page's filter), soonest joining first; a bare array. */
export async function preboardingPeople(org: string): Promise<PreboardingRow[]> {
  const list = await journeys().find(
    { org, kind: 'onboarding', status: { $nin: NOT_PREBOARDING }, closedAt: { $exists: false } } as never,
    { projection: { _id: 0, id: 1, org: 1, kind: 1, candidate: 1, designation: 1, department: 1, tj: 1, status: 1, profile: 1, aboutYou: 1, profileApprovals: 1, templateSnapshot: 1 } },
  ).toArray() as Journey[];
  const rows = list.length
    ? await candidateDocuments().find({ journeyId: { $in: list.map((j) => j.id) } }, { projection: { _id: 0, journeyId: 1, docKey: 1, label: 1, required: 1, status: 1 } }).toArray()
    : [];
  const byJourney = new Map<string, Array<Pick<CandidateDocument, 'docKey' | 'label' | 'required' | 'status'>>>();
  for (const d of rows) byJourney.set(d.journeyId, [...(byJourney.get(d.journeyId) ?? []), d]);
  const people = list.map((j) => {
    // A journey whose documents were never listed yet has the template's list, nothing uploaded.
    const docs = byJourney.get(j.id) ?? (j.templateSnapshot ? documentListFor(j).map((d) => ({ docKey: d.key, label: d.label, required: d.required, status: 'todo' as const })) : []);
    const done = sectionStates(j, docs as unknown as CandidateDocumentView[]);
    return {
      journeyId: j.id, name: j.candidate?.name ?? '—',
      ...(j.designation ? { designation: j.designation } : {}), ...(j.department ? { department: j.department } : {}), ...(j.tj ? { tj: j.tj } : {}),
      status: String(j.status),
      profileDone: PROFILE_SECTIONS.filter((k) => done[k]).length, profileTotal: PROFILE_SECTIONS.length,
      approvedSections: PROFILE_SECTIONS.filter((k) => j.profileApprovals?.[k]).length,
      documentsWaiting: docs.filter((d) => d.status === 'in_review').length,
    };
  });
  people.sort((a, b) => (a.tj ?? '9999-12-31').localeCompare(b.tj ?? '9999-12-31') || a.name.localeCompare(b.name));
  return people;
}

export interface OnboardingDocumentEntry {
  id: string; name: string; type: string | null; url?: string; uploadedAt: string | null; size: number | null;
  source: 'onboarding'; label: string; status: CandidateDocument['status']; required: boolean;
  files: Array<{ id: string; name: string; contentType: string; size: number; url?: string }>;
}

/** Within a journey, by status like the panel: sent back, to do, with HR, approved (template order otherwise). */
const STATUS_ORDER: Record<CandidateDocument['status'], number> = { sent_back: 0, todo: 1, in_review: 2, approved: 3 };

/**
 * Joined employees' onboarding documents (each person's latest onboarding journey, by userId), shaped
 * like the filed documents (id, name, type, url, uploadedAt, size) plus `source: 'onboarding'`, label,
 * status, required and every file. `withFiles: false` (someone outside HR) gives status only, no files
 * or links. Three reads for any number of people (the Employees list).
 */
export async function onboardingDocumentsByUser(org: string, userIds: string[], withFiles: boolean): Promise<Map<string, OnboardingDocumentEntry[]>> {
  const out = new Map<string, OnboardingDocumentEntry[]>();
  if (!userIds.length) return out;
  const js = await journeys().find({ org, kind: 'onboarding', userId: { $in: userIds } }, { projection: { _id: 0, id: 1, userId: 1, createdAt: 1 } }).sort({ createdAt: -1 }).toArray();
  const journeyOf = new Map<string, string>();
  for (const j of js) if (j.userId && !journeyOf.has(j.userId)) journeyOf.set(j.userId, j.id);
  if (!journeyOf.size) return out;
  const docs = await candidateDocuments().find({ org, journeyId: { $in: [...journeyOf.values()] } }, { projection: { _id: 0 } }).toArray();
  const fileIds = withFiles ? docs.flatMap((d) => d.fileIds) : [];
  const files = fileIds.length ? await lifecycleFiles().find({ id: { $in: fileIds } }, { projection: { _id: 0, id: 1, name: 1, contentType: 1, size: 1 } }).toArray() : [];
  const fileById = new Map(files.map((f) => [f.id, f]));
  const byJourney = new Map<string, CandidateDocument[]>();
  for (const d of docs) byJourney.set(d.journeyId, [...(byJourney.get(d.journeyId) ?? []), d]);
  for (const [userId, journeyId] of journeyOf) {
    const list = (byJourney.get(journeyId) ?? []).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    if (!list.length) continue;
    out.set(userId, list.map((d) => {
      const fs = withFiles ? d.fileIds.map((id) => fileById.get(id)).filter((f): f is NonNullable<typeof f> => Boolean(f))
        .map((f) => ({ id: f.id, name: f.name, contentType: f.contentType, size: f.size, url: lifecycleFileUrl(f.id) })) : [];
      return {
        id: d.id, name: d.label, type: null, ...(fs[0] ? { url: fs[0].url } : {}),
        uploadedAt: d.uploadedAt ? new Date(d.uploadedAt).toISOString() : null,
        size: fs.length ? fs.reduce((n, f) => n + f.size, 0) : null,
        source: 'onboarding' as const, label: d.label, status: d.status, required: d.required, files: fs,
      };
    }));
  }
  return out;
}

/** One joined employee's onboarding documents (see onboardingDocumentsByUser). */
export async function employeeOnboardingDocuments(org: string, userId: string, withFiles: boolean): Promise<OnboardingDocumentEntry[]> {
  return (await onboardingDocumentsByUser(org, [userId], withFiles)).get(userId) ?? [];
}
