/**
 * The portal's Employee profile (the 18 Nov portal design, A2 / C1–C7): seven
 * sections the candidate fills before joining. Personal details, contact and
 * address, bank account, education and experience and ID numbers are kept here
 * (`journey.profile`); the emergency contact and PF stay in About you
 * (portal.ts, which also completes the About-you task); the uploads stay the
 * template's documents, shown inside the section they belong to; the photo is
 * one stored file. The account number, Aadhaar and PAN are kept encrypted with
 * only their last four in the clear; nobody reads them back on the portal.
 * Editable, like About you, until the day before joining.
 */
import { journeys } from '../../config/db';
import type { CandidateProfile, Journey, ProfileAddress } from '../../models/lifecycle.model';
import { encryptField, fieldKeyConfigured } from '../fieldCrypto';
import { journeyDocumentsView, type CandidateDocumentView } from './documents';
import { addDays, istDate } from './emails';
import { checkUpload, LifecycleOfferError, removeFile, storeFile } from './files';
import { CLOSED_STATUSES } from './portalAuth';

export const PROFILE_SECTIONS = ['personal', 'contact', 'emergency', 'bank', 'education', 'ids', 'photo'] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];
const SECTION_TITLE: Record<ProfileSection, string> = {
  personal: 'Personal details', contact: 'Contact and address', emergency: 'Emergency contact', bank: 'Bank account and PF',
  education: 'Education and experience', ids: 'ID documents (Aadhaar, PAN)', photo: 'Photo',
};
const GENDERS = ['Female', 'Male', 'Other', 'Prefer not to say'] as const;
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed', 'Prefer not to say'] as const;
const QUALIFICATIONS = ['Class 10', 'Class 12', 'Diploma', 'Graduate', 'Postgraduate', 'Doctorate', 'Other'] as const;
export const PROFILE_OPTIONS = { genders: GENDERS, marital: MARITAL, qualifications: QUALIFICATIONS };

/** Which of the template's documents each section shows (by key, then by words in the label). */
export function sectionOfDocument(doc: Pick<CandidateDocumentView, 'docKey' | 'label'>): ProfileSection {
  const k = `${doc.docKey} ${doc.label}`.toLowerCase();
  if (/photo|picture|selfie/.test(k)) return 'photo';
  if (/cheque|check|passbook|bank/.test(k)) return 'bank';
  if (/address/.test(k)) return 'contact';
  if (/educat|degree|certificate|marksheet|payslip|pay slip|relieving|experience|offer letter from/.test(k)) return 'education';
  return 'ids';
}

// As portal.ts has them (kept here so the two modules do not import each other).
const aboutYouOf = (journey: Journey) => journey.aboutYou ?? {};
function indianMobile(value: unknown): string | null {
  const digits = String(value ?? '').replace(/[\s()-]/g, '').replace(/^\+?91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}
const text = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list.includes(v as T) ? (v as T) : undefined);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isMonth = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

function address(v: unknown, what: string): ProfileAddress {
  const a = (v ?? {}) as Record<string, unknown>;
  const out = { line: text(a.line, 200), city: text(a.city, 80), state: text(a.state, 80), pin: text(a.pin, 6) };
  if (!out.line) throw new LifecycleOfferError(400, `Add the house, building and street of your ${what}`);
  if (!out.city) throw new LifecycleOfferError(400, `Add the city of your ${what}`);
  if (!out.state) throw new LifecycleOfferError(400, `Pick the state of your ${what}`);
  if (!/^[1-9]\d{5}$/.test(out.pin)) throw new LifecycleOfferError(400, `The PIN code of your ${what} is 6 digits`);
  return out;
}

const secret = (plain: string) => (fieldKeyConfigured() ? { enc: encryptField(plain) } : {});

/** Builds one section's stored value from what the portal sent (each section checked on its own). */
function sectionValue(section: ProfileSection, input: Record<string, unknown>, journey: Journey, now: Date): Partial<CandidateProfile> {
  switch (section) {
    case 'personal': {
      const fullName = text(input.fullName, 100);
      if (!fullName) throw new LifecycleOfferError(400, 'Add your full name as on your ID');
      const dob = text(input.dob, 10);
      if (!isDay(dob)) throw new LifecycleOfferError(400, 'Add your date of birth');
      const age = (now.getTime() - Date.parse(`${dob}T00:00:00Z`)) / (365.25 * 86_400_000);
      if (age < 14 || age > 90) throw new LifecycleOfferError(400, 'Check your date of birth');
      const gender = oneOf(input.gender, GENDERS);
      if (!gender) throw new LifecycleOfferError(400, 'Pick your gender');
      const maritalStatus = oneOf(input.maritalStatus, MARITAL);
      return { personal: { fullName, ...(text(input.preferredName, 60) ? { preferredName: text(input.preferredName, 60) } : {}), dob, gender, ...(maritalStatus ? { maritalStatus } : {}), nationality: text(input.nationality, 60) || 'Indian' } };
    }
    case 'contact': {
      const mobile = indianMobile(input.mobile);
      if (!mobile) throw new LifecycleOfferError(400, 'Your mobile number must be +91 and 10 digits');
      const current = address(input.current, 'current address');
      const permanentSame = input.permanentSame !== false;
      return { contact: { mobile, current, permanentSame, ...(permanentSame ? {} : { permanent: address(input.permanent, 'permanent address') }) } };
    }
    case 'bank': {
      const holderName = text(input.holderName, 100);
      if (!holderName) throw new LifecycleOfferError(400, 'Add the account holder’s name');
      const ifsc = text(input.ifsc, 11).toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new LifecycleOfferError(400, 'That IFSC is not valid: 4 letters, 0, then 6 letters or digits');
      const kept = journey.profile?.bank;
      const acc = text(input.accountNumber, 24).replace(/\s+/g, '');
      if (!acc && kept?.accountLast4) return { bank: { ...kept, holderName, ifsc, ...(text(input.bankName, 80) ? { bankName: text(input.bankName, 80) } : {}) } };
      if (!/^\d{6,20}$/.test(acc)) throw new LifecycleOfferError(400, 'An account number is 6 to 20 digits');
      if (text(input.accountNumberAgain, 24).replace(/\s+/g, '') !== acc) throw new LifecycleOfferError(400, 'The two account numbers don’t match');
      const s = secret(acc);
      return { bank: { holderName, ifsc, accountLast4: acc.slice(-4), ...(s.enc ? { accountNumberEnc: s.enc } : {}), ...(text(input.bankName, 80) ? { bankName: text(input.bankName, 80) } : {}) } };
    }
    case 'education': {
      const qualification = oneOf(input.qualification, QUALIFICATIONS);
      if (!qualification) throw new LifecycleOfferError(400, 'Pick your highest qualification');
      const institution = text(input.institution, 120);
      if (!institution) throw new LifecycleOfferError(400, 'Add your college, university or school');
      const year = text(input.year, 4);
      const y = Number(year);
      if (!/^\d{4}$/.test(year) || y < 1960 || y > now.getUTCFullYear() + 1) throw new LifecycleOfferError(400, 'Add the year you passed, like 2020');
      const firstJob = input.firstJob === true;
      const jobs = firstJob ? [] : (Array.isArray(input.jobs) ? input.jobs : []).slice(0, 5).map((raw, i) => {
        const j = (raw ?? {}) as Record<string, unknown>;
        const company = text(j.company, 120); const role = text(j.role, 80); const from = text(j.from, 7); const to = text(j.to, 7);
        const which = i === 0 ? 'your last job' : `job ${i + 1}`;
        if (!company) throw new LifecycleOfferError(400, `Add the company for ${which}`);
        if (!role) throw new LifecycleOfferError(400, `Add your role at ${company}`);
        if (!isMonth(from)) throw new LifecycleOfferError(400, `Add when you started at ${company}`);
        if (to && !isMonth(to)) throw new LifecycleOfferError(400, `Check when you left ${company}`);
        if (to && to < from) throw new LifecycleOfferError(400, `The end at ${company} is before its start`);
        return { company, role, from, ...(to ? { to } : {}) };
      });
      if (!firstJob && !jobs.length) throw new LifecycleOfferError(400, 'Add your last job, or choose “No, this is my first job”');
      return { education: { qualification, institution, year }, experience: { firstJob, jobs } };
    }
    case 'ids': {
      const kept = journey.profile?.ids;
      const aadhaar = text(input.aadhaar, 14).replace(/\s+/g, '');
      const pan = text(input.pan, 10).toUpperCase();
      const ids = { ...(kept ?? {}) } as NonNullable<CandidateProfile['ids']>;
      if (aadhaar) {
        if (!/^[2-9]\d{11}$/.test(aadhaar)) throw new LifecycleOfferError(400, 'An Aadhaar number is 12 digits');
        const s = secret(aadhaar);
        ids.aadhaarLast4 = aadhaar.slice(-4);
        if (s.enc) ids.aadhaarEnc = s.enc; else delete ids.aadhaarEnc;
      }
      if (pan) {
        if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) throw new LifecycleOfferError(400, 'A PAN looks like ABCDE1234F');
        const s = secret(pan);
        ids.panLast4 = pan.slice(-4);
        if (s.enc) ids.panEnc = s.enc; else delete ids.panEnc;
      }
      if (!ids.aadhaarLast4) throw new LifecycleOfferError(400, 'Add your Aadhaar number');
      if (!ids.panLast4) throw new LifecycleOfferError(400, 'Add your PAN');
      return { ids };
    }
    default:
      throw new LifecycleOfferError(400, 'That section is saved elsewhere');
  }
}

function editable(journey: Journey, now: Date) {
  if (CLOSED_STATUSES.has(String(journey.status)) || ['joined', 'moved_to_app', 'confirmed'].includes(String(journey.status))) throw new LifecycleOfferError(409, 'This can no longer be changed here');
  if (journey.tj && istDate(now) >= journey.tj) throw new LifecycleOfferError(409, 'Your profile locks the day before you join; ask HR to change anything');
}

const docDone = (d: CandidateDocumentView) => d.status !== 'todo' && d.status !== 'sent_back';

/** Whether each section is done: its fields saved and its required uploads sent. */
export function sectionStates(journey: Journey, docs: CandidateDocumentView[]): Record<ProfileSection, boolean> {
  const p = journey.profile ?? {};
  const about = aboutYouOf(journey);
  const uploads = (s: ProfileSection) => docs.filter((d) => d.required && sectionOfDocument(d) === s).every(docDone);
  return {
    personal: Boolean(p.personal),
    contact: Boolean(p.contact) && uploads('contact'),
    emergency: Boolean(about.emergencyContact),
    bank: Boolean(p.bank) && Boolean(about.pf) && uploads('bank'),
    education: Boolean(p.education) && uploads('education'),
    ids: Boolean(p.ids?.aadhaarLast4 && p.ids?.panLast4) && uploads('ids'),
    photo: Boolean(p.photoFileId) || docs.some((d) => sectionOfDocument(d) === 'photo' && docDone(d)),
  };
}

/** What the portal shows: the answers (secrets as their last four only), each section's state and its uploads. */
export async function profileView(journey: Journey, docs?: CandidateDocumentView[]) {
  const list = docs ?? await journeyDocumentsView(journey.id);
  const p = journey.profile ?? {};
  const about = aboutYouOf(journey);
  const done = sectionStates(journey, list);
  const { bank, ids, ...open } = p;
  return {
    sections: PROFILE_SECTIONS.map((key) => ({ key, title: SECTION_TITLE[key], done: done[key], documentIds: list.filter((d) => sectionOfDocument(d) === key).map((d) => d.id) })),
    done: PROFILE_SECTIONS.filter((k) => done[k]).length,
    total: PROFILE_SECTIONS.length,
    profile: {
      ...open,
      ...(bank ? { bank: { holderName: bank.holderName, ifsc: bank.ifsc, accountLast4: bank.accountLast4, ...(bank.bankName ? { bankName: bank.bankName } : {}) } } : {}),
      ...(ids ? { ids: { aadhaarLast4: ids.aadhaarLast4, panLast4: ids.panLast4 } } : {}),
    },
    emergencyContact: about.emergencyContact,
    ...(about.emergencyContact2 ? { emergencyContact2: about.emergencyContact2 } : {}),
    pf: about.pf,
    personalEmail: journey.candidate?.personalEmail,
    phone: indianMobile(journey.candidate?.phone) ?? undefined,
    candidateName: journey.candidate?.name,
    options: PROFILE_OPTIONS,
    ...(journey.tj ? { editableUntil: addDays(journey.tj, -1), finishBy: addDays(journey.tj, -3) } : {}),
  };
}

export async function saveProfileSection(journey: Journey, sectionRaw: unknown, input: unknown, now = new Date()) {
  editable(journey, now);
  const section = oneOf(sectionRaw, PROFILE_SECTIONS);
  if (!section) throw new LifecycleOfferError(400, `section is one of ${PROFILE_SECTIONS.join(', ')}`);
  const value = sectionValue(section, (input ?? {}) as Record<string, unknown>, journey, now);
  const profile: CandidateProfile = { ...(journey.profile ?? {}), ...value, savedAt: now };
  await journeys().updateOne({ id: journey.id }, { $set: { profile, lastActivityAt: now } });
  return profileView({ ...journey, profile });
}

/** The photo for the ID card: one JPG or PNG, replacing the last. */
export async function saveProfilePhoto(journey: Journey, file: { originalname?: string; buffer: Buffer } | undefined, now = new Date()) {
  editable(journey, now);
  if (!file) throw new LifecycleOfferError(400, 'Choose a photo');
  const type = checkUpload(file.buffer);
  if (type === 'application/pdf') throw new LifecycleOfferError(400, 'Your photo must be a JPG or PNG');
  const stored = await storeFile(journey.org, journey.id, { name: file.originalname || 'photo', contentType: type, bytes: file.buffer }, 'candidate');
  const old = journey.profile?.photoFileId;
  const profile: CandidateProfile = { ...(journey.profile ?? {}), photoFileId: stored.id, savedAt: now };
  await journeys().updateOne({ id: journey.id }, { $set: { profile, lastActivityAt: now } });
  if (old) await removeFile(old).catch(() => undefined);
  return profileView({ ...journey, profile });
}

/** HR's view (the joiner panel): every answer, the secrets as their last four. */
export function profileForHr(journey: Pick<Journey, 'profile'>) {
  const p = journey.profile;
  if (!p) return undefined;
  const { bank, ids, ...open } = p;
  return {
    ...open,
    ...(bank ? { bank: { holderName: bank.holderName, ifsc: bank.ifsc, accountLast4: bank.accountLast4, ...(bank.bankName ? { bankName: bank.bankName } : {}) } } : {}),
    ...(ids ? { ids: { aadhaarLast4: ids.aadhaarLast4, panLast4: ids.panLast4 } } : {}),
  };
}
