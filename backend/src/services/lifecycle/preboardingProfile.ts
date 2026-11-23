/**
 * The dashboard's pre-boarding profile (HR): what the candidate entered in each Employee profile
 * section, as label/value pairs, with the section's documents and HR's approval; approving locks the
 * section for the candidate (profileLock.ts), unlocking opens it again. Also the Employees page's
 * "In pre-boarding" list, and a joined employee's onboarding documents.
 *
 * HR can also change any section's answers (PUT …/profile/:section, the portal's body and checks),
 * approved or not; each section carries its raw `values` to prefill that form.
 *
 * Bank account and PF is not a section (24 Nov): it is its own task the joiner declares in the app
 * (`bankPf`, shown on the Salary details tab), which HR can edit too (PUT …/profile/bank, hrSaveBankPf).
 *
 * Secrets stay as stored: the account number and Aadhaar (and PAN) as their last four only.
 * Document files are linked through the dashboard's authorised file route (`/admin/lifecycle/files/:id`,
 * opened with the dashboard's Bearer token), never a public URL.
 */
import { candidateDocuments, journeys, lifecycleFiles, offers, users } from '../../config/db';
import { setPaymentDetails } from '../employeePayment.service';
import type { AboutYou, CandidateDocument, CandidateProfile, Journey, ProfileApproval } from '../../models/lifecycle.model';
import { documentListFor, journeyDocumentsView, type CandidateDocumentView } from './documents';
import { completeTask } from './engine';
import { LifecycleOfferError } from './files';
import { aboutYouValue, bankPfStatus, PROFILE_OPTIONS, PROFILE_SECTION_TITLE, PROFILE_SECTIONS, RELATIONS, sectionStates, sectionValue, type ProfileSection } from './profile';
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

/**
 * One section's saved answers in the shape HR's PUT takes (to prefill HR's form); `{}` when nothing is
 * saved. Secrets never leave: `accountLast4`, `aadhaarLast4`, `panLast4` stand for them (leave the
 * number blank on the PUT to keep it).
 */
export function sectionValues(journey: Pick<Journey, 'profile' | 'aboutYou'>, section: ProfileSection): Record<string, unknown> {
  const p = journey.profile ?? {};
  const about = journey.aboutYou ?? {};
  const has = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  switch (section) {
    case 'personal': {
      const x = p.personal;
      return x ? has({ fullName: x.fullName, preferredName: x.preferredName, dob: x.dob, gender: x.gender, maritalStatus: x.maritalStatus, nationality: x.nationality }) : {};
    }
    case 'contact': {
      const x = p.contact;
      return x ? has({ mobile: x.mobile, current: x.current, permanentSame: x.permanentSame, permanent: x.permanentSame ? undefined : x.permanent }) : {};
    }
    case 'emergency':
      return has({ emergencyContact: about.emergencyContact, emergencyContact2: about.emergencyContact2 });
    case 'bank': {
      const x = p.bank;
      return has({
        ...(x ? { holderName: x.holderName, ifsc: x.ifsc, bankName: x.bankName, accountLast4: x.accountLast4 } : {}),
        pf: about.pf ? has({ firstJob: about.pf.firstJob, uan: about.pf.uan }) : undefined,
      });
    }
    case 'education':
      return has({
        ...(p.education ? { qualification: p.education.qualification, institution: p.education.institution, year: p.education.year } : {}),
        ...(p.experience ? { firstJob: p.experience.firstJob, jobs: p.experience.jobs } : {}),
      });
    case 'ids':
      return has({ aadhaarLast4: p.ids?.aadhaarLast4, panLast4: p.ids?.panLast4 });
    default:
      return {};
  }
}

/**
 * The Basic details card (mirrors the employee profile's): what HR edits with PUT …/profile/basic
 * (employeeId, workEmail, designation, department, workLocation, employeeType, tj), the candidate's
 * own name, mobile, gender and date of birth, the reporting manager, and the app account if made.
 */
async function basicView(journey: Journey) {
  const p = journey.profile ?? {};
  const [offer, manager] = await Promise.all([
    offers().findOne({ journeyId: journey.id }, { projection: { _id: 0, versions: 1 } }),
    journey.managerUserId ? users().findOne({ userId: journey.managerUserId, org: journey.org }, { projection: { _id: 0, userId: 1, name: 1 } }) : null,
  ]);
  // HR's value on the journey, else the offer's (what the account would get).
  const versions = offer?.versions ?? [];
  const f = ([...versions].reverse().find((v) => v.status !== 'draft') ?? versions.at(-1))?.fields;
  const designation = journey.designation ?? f?.designation;
  const department = journey.department ?? f?.department;
  const workLocation = journey.location ?? f?.location;
  const employeeType = journey.employeeType ?? f?.employeeType;
  const mobile = p.contact?.mobile ?? journey.candidate?.phone;
  return {
    name: p.personal?.fullName ?? journey.candidate?.name ?? '',
    ...(journey.employeeId ? { employeeId: journey.employeeId } : {}),
    ...(journey.candidate?.workEmail ? { workEmail: journey.candidate.workEmail } : {}),
    ...(designation ? { designation } : {}),
    ...(department ? { department } : {}),
    ...(workLocation ? { workLocation } : {}),
    ...(employeeType ? { employeeType } : {}),
    ...(journey.tj ? { tj: journey.tj } : {}),
    ...(mobile ? { mobile } : {}),
    ...(p.personal?.gender ? { gender: p.personal.gender } : {}),
    ...(p.personal?.dob ? { dob: p.personal.dob } : {}),
    ...(manager ? { reportingManager: { userId: manager.userId, name: manager.name } } : {}),
    ...(journey.appAccess ? { appAccess: {
      userId: journey.appAccess.userId, createdAt: new Date(journey.appAccess.createdAt).toISOString(),
      ...(journey.appAccess.emailedTo ? { emailedTo: journey.appAccess.emailedTo } : {}),
      ...(journey.appAccess.emailedAt ? { emailedAt: new Date(journey.appAccess.emailedAt).toISOString() } : {}),
    } } : {}),
  };
}

const pfLine = (pf: { firstJob?: boolean; uan?: string; uanLast4?: string } | undefined) =>
  !pf ? undefined : pf.firstJob ? 'First job: no UAN yet' : pf.uan ? `UAN ${pf.uan}` : pf.uanLast4 ? `UAN •••• ${pf.uanLast4}` : 'Has a UAN, not given';

/**
 * Bank account and PF as the Salary details tab shows it: the task's state (bankPfStatus: to do,
 * declared in the app, approved), and the newest details: the joiner's declaration from the app
 * unless HR changed them after it, else what HR (or, before 24 Nov, the portal) saved on the journey.
 * Secrets as their last four. `values` prefill HR's edit form (PUT …/profile/bank).
 */
export function bankPfView(journey: Pick<Journey, 'profile' | 'aboutYou' | 'bankPfRequest' | 'profileEditedByHr'>, docs: CandidateDocumentView[] = []) {
  const status = bankPfStatus(journey);
  const req = journey.bankPfRequest?.source === 'payroll_task' && journey.bankPfRequest.status !== 'declined' ? journey.bankPfRequest : undefined;
  const edited = journey.profileEditedByHr?.bank;
  const fromApp = Boolean(req && !(edited && new Date(edited.at).getTime() > new Date(req.requestedAt).getTime()));
  const saved = journey.profile?.bank;
  const savedPf = journey.aboutYou?.pf;
  const bank = fromApp && req
    ? { holderName: req.changes.accountHolder, ifsc: req.changes.ifsc, bankName: req.changes.bankName, accountLast4: req.changes.accountLast4 }
    : { holderName: saved?.holderName, ifsc: saved?.ifsc, bankName: saved?.bankName, accountLast4: saved?.accountLast4 };
  const pf = fromApp && req ? { firstJob: req.firstJob === true, ...(req.changes.uanLast4 ? { uanLast4: req.changes.uanLast4 } : {}) } : savedPf;
  const nominees = req?.nominees ?? [];
  const rows: Array<[string, string | undefined]> = [
    ['Account holder', bank.holderName], ['Account number', bank.accountLast4 ? `•••• ${bank.accountLast4}` : undefined], ['IFSC', bank.ifsc], ['Bank', bank.bankName],
    ['PF', pfLine(pf)],
    ...nominees.map((n, i): [string, string] => [nominees.length === 1 ? 'PF nominee' : `PF nominee ${i + 1}`, `${n.name} (${n.relation}) · ${n.share}%`]),
  ];
  const has = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));
  const editedByHr = approvalView(edited);
  const iso = (d?: Date) => (d ? new Date(d).toISOString() : undefined);
  return {
    title: PROFILE_SECTION_TITLE.bank,
    state: status.state,
    ...(status.declaredAt ? { declaredAt: iso(status.declaredAt) } : {}),
    ...(status.approvedAt ? { approved: { byName: status.approvedByName ?? 'HR', at: iso(status.approvedAt)! } } : {}),
    ...(status.sentBackAt ? { sentBack: { at: iso(status.sentBackAt)!, ...(status.hrNote ? { note: status.hrNote } : {}) } } : {}),
    ...(editedByHr ? { editedByHr } : {}),
    // Where the details shown come from: the joiner's declaration in the app, or the journey (HR's edit, or the portal before 24 Nov).
    source: fromApp ? 'app' as const : editedByHr ? 'hr' as const : saved || savedPf ? 'portal' as const : 'none' as const,
    fields: rows.filter((r): r is [string, string] => typeof r[1] === 'string' && r[1].trim() !== '').map(([label, value]) => ({ label, value })),
    values: has({ ...bank, pf: pf ? has({ firstJob: pf.firstJob, uan: (pf as { uan?: string }).uan, uanLast4: (pf as { uanLast4?: string }).uanLast4 }) : undefined }),
    // A cancelled cheque or passbook the template asks for: no longer under a profile section.
    documents: docs.filter((d) => sectionOfDocument(d) === 'bank').map(documentView),
  };
}

/** GET /admin/lifecycle/journeys/:id/profile — the whole pre-boarding profile, as HR reads it. */
export async function hrProfileView(journey: Journey) {
  const [docs, basic] = await Promise.all([journeyDocumentsView(journey.id), basicView(journey)]);
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
    basic,
    done: PROFILE_SECTIONS.filter((k) => done[k]).length,
    total: PROFILE_SECTIONS.length,
    sections: PROFILE_SECTIONS.map((key) => {
      const approved = approvalView(journey.profileApprovals?.[key]);
      const editedByHr = approvalView(journey.profileEditedByHr?.[key]);
      return {
        key, title: PROFILE_SECTION_TITLE[key], done: done[key], ...(approved ? { approved } : {}), ...(editedByHr ? { editedByHr } : {}),
        fields: sectionFields(journey, key),
        values: sectionValues(journey, key),
        documents: docs.filter((d) => sectionOfDocument(d) === key).map(documentView),
      };
    }),
    bankPf: bankPfView(journey, docs),
    // The choices HR's edit form offers (the portal's own lists).
    options: { ...PROFILE_OPTIONS, relations: RELATIONS },
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

/**
 * PUT …/profile/:section — HR changes a section's answers: the body the portal sends for it, checked
 * the same way and stored the same way (secrets encrypted, last four in the clear; a blank account
 * number, Aadhaar or PAN keeps what is stored). Emergency is `{ emergencyContact, emergencyContact2? }`
 * (null removes the second). Bank (not a section since 24 Nov) goes to hrSaveBankPf. Allowed on an
 * approved section (HR is who locks it) and after the candidate's own Tj − 1 lock, not once the joiner
 * has joined or the offer is closed. Records who changed it in `profileEditedByHr.<section>`.
 */
export async function hrSaveProfileSection(hr: { userId: string; name: string }, journey: Journey, sectionRaw: unknown, input: unknown, now = new Date()) {
  if (sectionRaw === 'bank') return hrSaveBankPf(hr, journey, input, now);
  const section = sectionOf(sectionRaw);
  if (NOT_PREBOARDING.includes(String(journey.status))) throw new LifecycleOfferError(409, 'Only someone still in pre-boarding can be changed here');
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const edited: ProfileApproval = { byUserId: hr.userId, byName: hr.name, at: now };
  let profile: CandidateProfile | undefined;
  let aboutYou: AboutYou | undefined;
  if (section === 'emergency') {
    if (body.emergencyContact === undefined) throw new LifecycleOfferError(400, 'Add the emergency contact');
    aboutYou = aboutYouValue(journey, { emergencyContact: body.emergencyContact, ...(body.emergencyContact2 !== undefined ? { emergencyContact2: body.emergencyContact2 } : {}) });
  } else {
    const value = sectionValue(section, body, journey, now);
    profile = { ...(journey.profile ?? {}), ...value, savedAt: now };
  }
  if (aboutYou) aboutYou.savedAt = now;
  await journeys().updateOne({ id: journey.id }, {
    $set: { ...(profile ? { profile } : {}), ...(aboutYou ? { aboutYou } : {}), [`profileEditedByHr.${section}`]: edited, updatedAt: now },
  });
  // As on the portal: About you is done once the emergency contact is in (PF is the app's Bank and PF task).
  if (aboutYou?.emergencyContact) await completeTask(journey.id, 'about_you', { userId: hr.userId, name: hr.name });
  return hrProfileView({
    ...journey,
    ...(profile ? { profile } : {}), ...(aboutYou ? { aboutYou } : {}),
    profileEditedByHr: { ...(journey.profileEditedByHr ?? {}), [section]: edited },
  });
}

const CLOSED_OFFER = ['declined', 'expired', 'not_joining'];
const JOINED = ['joined', 'moved_to_app', 'confirmed'];

/**
 * PUT …/profile/bank — HR changes Bank account and PF without the joiner: `{ holderName, accountNumber?,
 * ifsc, bankName?, pf?: { firstJob, uan? } }` (HR types the number once; blank keeps the one shown, the
 * app's declaration or the journey's; a blank UAN keeps the one shown; `pf` left out keeps it). Kept on
 * the journey (`profile.bank`, `aboutYou.pf`, secrets encrypted) with `profileEditedByHr.bank`; once
 * they have joined it goes to payroll too (setPaymentDetails: payroll access, payroll's own checks,
 * written first so a refusal saves nothing). The task's state stays the joiner's (bankPfStatus).
 */
export async function hrSaveBankPf(hr: { userId: string; name: string }, journey: Journey, input: unknown, now = new Date()) {
  if (CLOSED_OFFER.includes(String(journey.status)) || journey.closedAt) throw new LifecycleOfferError(409, 'This offer is closed');
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  // What the form showed: the joiner's declaration from the app, else the journey's own.
  const req = journey.bankPfRequest?.source === 'payroll_task' && journey.bankPfRequest.status !== 'declined' ? journey.bankPfRequest : undefined;
  const shown = bankPfView(journey);
  const fromApp = shown.source === 'app' && req;
  const kept: CandidateProfile['bank'] | undefined = fromApp
    ? (req.changes.accountLast4 ? { holderName: req.changes.accountHolder ?? '', ifsc: req.changes.ifsc ?? '', accountLast4: req.changes.accountLast4, ...(req.changes.accountNumberEnc ? { accountNumberEnc: req.changes.accountNumberEnc } : {}) } : undefined)
    : journey.profile?.bank;
  const typedAccount = typeof body.accountNumber === 'string' ? body.accountNumber.replace(/\s+/g, '') : '';
  // HR types a number once: the portal's "type it again" is the same number.
  const value = sectionValue('bank', { ...body, accountNumberAgain: body.accountNumberAgain ?? body.accountNumber }, { ...journey, profile: { ...(journey.profile ?? {}), ...(kept ? { bank: kept } : {}) } }, now);
  const bank = value.bank!;
  let pf: AboutYou['pf'] = fromApp ? { firstJob: req.firstJob === true, ...(req.changes.uanLast4 ? { uanLast4: req.changes.uanLast4 } : {}) } : journey.aboutYou?.pf;
  let typedUan = '';
  if (body.pf !== undefined) {
    const next = aboutYouValue(journey, { pf: body.pf }).pf!;
    typedUan = next.uan ?? '';
    // A blank UAN keeps the one shown.
    pf = next.firstJob || next.uan ? next : { firstJob: false, ...(pf && !pf.firstJob && pf.uan ? { uan: pf.uan } : {}), ...(pf && !pf.firstJob && !pf.uan && pf.uanLast4 ? { uanLast4: pf.uanLast4 } : {}) };
  }
  if (JOINED.includes(String(journey.status)) && journey.userId) {
    await setPaymentDetails(hr.userId, journey.userId, {
      accountHolder: bank.holderName, ifsc: bank.ifsc, ...(bank.bankName ? { bankName: bank.bankName } : {}),
      ...(typedAccount ? { accountNumber: typedAccount } : {}), ...(typedUan ? { uan: typedUan } : {}),
    });
  }
  const edited: ProfileApproval = { byUserId: hr.userId, byName: hr.name, at: now };
  const profile: CandidateProfile = { ...(journey.profile ?? {}), bank, savedAt: now };
  const aboutYou: AboutYou | undefined = pf ? { ...(journey.aboutYou ?? {}), pf, savedAt: now } : journey.aboutYou;
  await journeys().updateOne({ id: journey.id }, {
    $set: { profile, ...(pf ? { aboutYou } : {}), 'profileEditedByHr.bank': edited, updatedAt: now },
  });
  return hrProfileView({ ...journey, profile, ...(aboutYou ? { aboutYou } : {}), profileEditedByHr: { ...(journey.profileEditedByHr ?? {}), bank: edited } });
}

export interface PreboardingRow {
  journeyId: string; name: string; designation?: string; department?: string; tj?: string; status: string;
  profileDone: number; profileTotal: number; approvedSections: number; documentsWaiting: number;
}

/** GET /admin/lifecycle/preboarding — everyone still in pre-boarding (the Employees page's filter), soonest joining first; a bare array. */
export async function preboardingPeople(org: string): Promise<PreboardingRow[]> {
  const list = await journeys().find(
    { org, kind: 'onboarding', status: { $nin: NOT_PREBOARDING }, closedAt: { $exists: false } } as never,
    { projection: { _id: 0, id: 1, org: 1, kind: 1, candidate: 1, designation: 1, department: 1, tj: 1, status: 1, profile: 1, aboutYou: 1, profileApprovals: 1 } },
  ).toArray() as Journey[];
  const rows = list.length
    ? await candidateDocuments().find({ journeyId: { $in: list.map((j) => j.id) } }, { projection: { _id: 0, journeyId: 1, docKey: 1, label: 1, required: 1, status: 1 } }).toArray()
    : [];
  const byJourney = new Map<string, Array<Pick<CandidateDocument, 'docKey' | 'label' | 'required' | 'status'>>>();
  for (const d of rows) byJourney.set(d.journeyId, [...(byJourney.get(d.journeyId) ?? []), d]);
  // The template copy is large (5 s for a dozen journeys): read it only for a journey with no document rows yet.
  const bare = list.filter((j) => !byJourney.has(j.id)).map((j) => j.id);
  if (bare.length) {
    const snaps = await journeys().find({ id: { $in: bare } }, { projection: { _id: 0, id: 1, 'templateSnapshot.tasks.systemKey': 1, 'templateSnapshot.tasks.enabled': 1, 'templateSnapshot.tasks.documents': 1 } }).toArray();
    const snapOf = new Map(snaps.map((x) => [x.id, x.templateSnapshot]));
    for (const j of list) if (snapOf.has(j.id)) (j as { templateSnapshot?: unknown }).templateSnapshot = snapOf.get(j.id);
  }
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
