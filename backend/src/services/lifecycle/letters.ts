/**
 * Letter templates and letters (CONTRACT decision 11; 6Zs H3/H3b/H3c, P12).
 *
 * Templates are HTML with {{merge.fields}}; each org gets a default per kind
 * (offer, appointment, NDA, confirmation, extension, relieving). The server
 * fills the merge values from the company, the journey and its offer, and the
 * employee record, and says which are missing; the dashboard renders the
 * letter and makes the PDF in the browser, then uploads it here. The server
 * never renders HTML to PDF.
 *
 * Appointment letter and NDA are signed on the portal: open the PDF first,
 * then draw or type a signature. The signature (image or typed name, time,
 * IP, device) is stamped onto the stored PDF with pdf-lib when it is
 * installed; without it the signature record is kept with the original PDF.
 */
import { randomUUID } from 'node:crypto';
import { candidateAccounts, journeys, letters, letterTemplates, lifecycleFiles, offers, users } from '../../config/db';
import type { Journey, Letter, LetterKind, LetterTemplate, OfferVersion } from '../../models/lifecycle.model';
import {
  addDays, companyAddress, companyDisplayName, companyOf, fireOnce, forgetFired, formatDay, formatRupees, istDate, mails, portalLink, sendLifecycleEmail,
} from './emails';
import { completeTask, reopenTask } from './engine';
import { checkUpload, LifecycleOfferError, readFileBytes, sniffContentType, storeFile } from './files';

export const LETTER_KINDS: LetterKind[] = ['offer', 'appointment', 'nda', 'confirmation', 'extension', 'relieving'];
/** The two the candidate signs on the portal. */
export const SIGNED_KINDS: LetterKind[] = ['appointment', 'nda'];
const REF_PREFIX: Record<LetterKind, string> = { offer: 'OL', appointment: 'AL', nda: 'NDA', confirmation: 'CL', extension: 'EL', relieving: 'RL' };

// ─── Merge fields ───────────────────────────────────────────────────────────

/**
 * Every merge field, flat `{{key}}` (the dashboard also reads `{{merge.key}}`),
 * with the label the dashboard shows. Values are display text: "6 months",
 * "60 days", "₹14,50,000", "Mon 1 Dec 2026".
 */
export const MERGE_FIELDS: Record<string, string> = {
  companyName: 'Company name', companyAddress: 'Company address', refNo: 'Ref no.', letterDate: 'Letter date',
  candidateName: 'Full name', firstName: 'First name', employeeId: 'Employee ID',
  designation: 'Designation', department: 'Department', location: 'Work location', managerName: 'Reporting manager',
  joiningDate: 'Joining date', ctc: 'Yearly CTC', ctcWords: 'Yearly CTC in words', probationMonths: 'Probation', probationEndsOn: 'Probation ends on',
  noticeDays: 'Notice period', validTill: 'Offer valid till', offerDate: 'Offer date', acceptedOn: 'Offer accepted on', responsibilities: 'Responsibilities',
  confirmationDate: 'Confirmed from', extensionMonths: 'Extended by', extensionUntil: 'Probation now ends on',
  lastWorkingDay: 'Last working day', hrName: 'Signed by (HR)',
};

/** What each letter cannot go out without (6Zs H3's field table). */
export const REQUIRED_FIELDS: Record<LetterKind, string[]> = {
  offer: ['candidateName', 'designation', 'department', 'managerName', 'location', 'joiningDate', 'ctc', 'probationMonths', 'noticeDays', 'validTill'],
  appointment: ['candidateName', 'designation', 'department', 'managerName', 'location', 'joiningDate', 'acceptedOn', 'ctc', 'probationMonths', 'noticeDays'],
  nda: ['candidateName', 'designation', 'companyName', 'companyAddress', 'letterDate'],
  confirmation: ['candidateName', 'employeeId', 'designation', 'department', 'managerName', 'confirmationDate'],
  extension: ['candidateName', 'employeeId', 'designation', 'probationEndsOn', 'extensionMonths', 'extensionUntil'],
  relieving: ['candidateName', 'employeeId', 'designation', 'joiningDate', 'lastWorkingDay'],
};

const SIGN_OFF = `<p>Warm regards,</p><p><strong>{{hrName}}</strong><br />Human Resources<br />{{companyName}}</p>`;
const ROW = (label: string, key: string) => `<tr><td style="padding:6px 18px 6px 0;color:#484848">${label}</td><td style="padding:6px 0"><strong>{{${key}}}</strong></td></tr>`;

/**
 * The seeded default templates: plain, professional wording for an Indian
 * company. Body only, from the salutation down: the dashboard puts the
 * letterhead, reference number, date and title above it. HR edits them in Documents.
 */
export const DEFAULT_LETTER_TEMPLATES: Record<LetterKind, { name: string; body: string }> = {
  offer: {
    name: 'Offer letter',
    body: `<p>Dear {{candidateName}},</p>
<p>We are pleased to offer you the position of <strong>{{designation}}</strong> in the {{department}} team at {{companyName}}. You will report to {{managerName}} and work from {{location}}.</p>
<p>Your joining date will be <strong>{{joiningDate}}</strong>. Your yearly compensation is set out below, with the full salary breakup in Annexure A.</p>
<table style="border-collapse:collapse;margin:12px 0">
${ROW('Designation', 'designation')}
${ROW('Joining date', 'joiningDate')}
${ROW('Yearly CTC', 'ctc')}
${ROW('Probation', 'probationMonths')}
${ROW('Notice period', 'noticeDays')}
</table>
<p>Your yearly cost to company is {{ctc}} ({{ctcWords}}).</p>
<p>This offer is subject to the satisfactory verification of your documents, qualifications and references. The full terms of your employment will be set out in your appointment letter, which you will receive once your documents are approved.</p>
<p>Please accept this offer by <strong>{{validTill}}</strong> using the link in the email we have sent you. If we do not hear from you by then, the offer will lapse. If you have any questions, simply reply to that email.</p>
<p>We look forward to having you with us.</p>
${SIGN_OFF}`,
  },
  appointment: {
    name: 'Appointment letter',
    body: `<p>Dear {{candidateName}},</p>
<p>Further to your acceptance of our offer on {{acceptedOn}}, we are pleased to appoint you as <strong>{{designation}}</strong> in the {{department}} team of {{companyName}} (“the Company”), with effect from <strong>{{joiningDate}}</strong>, on the terms below.</p>
<ol>
<li><strong>Place of work and reporting.</strong> You will be based at {{location}} and report to {{managerName}}, or to anyone the Company names in their place. The Company may ask you to work from another office or location as the business requires.</li>
<li><strong>Compensation.</strong> Your yearly cost to company is {{ctc}} ({{ctcWords}}), with the breakup in Annexure A. Salary is paid monthly into your bank account, after income tax and statutory deductions (Provident Fund, ESI and Professional Tax, as they apply to you).</li>
<li><strong>Probation.</strong> You will be on probation for {{probationMonths}} from your joining date. On its satisfactory completion you will be confirmed in writing. The Company may extend the probation; it will tell you in writing if it does.</li>
<li><strong>Notice period.</strong> Either side may end this employment by giving {{noticeDays}} notice in writing, or pay in lieu of the notice not served, at the Company’s discretion. The Company may end the employment without notice for misconduct.</li>
<li><strong>Working hours, leave and holidays.</strong> These follow the Company’s policies for your location, as they stand from time to time.</li>
<li><strong>Confidentiality and intellectual property.</strong> You will keep the Company’s information confidential, as set out in the non-disclosure agreement you sign with this letter. Work you create in the course of your employment belongs to the Company.</li>
<li><strong>Conduct and policies.</strong> You will follow the Company’s code of conduct and policies, which you will acknowledge in your first week and which the Company may update.</li>
<li><strong>Verification.</strong> This appointment depends on the documents and information you have given us being true and complete. If any of it is found to be false, the Company may end the employment at once.</li>
<li><strong>Exclusive service.</strong> While employed you will not take up other paid work without the Company’s written consent.</li>
</ol>
<p>Please read this letter carefully and sign it on your joining portal to confirm that you accept these terms.</p>
${SIGN_OFF}
<p style="margin-top:28px">Accepted and agreed: {{candidateName}}</p>`,
  },
  nda: {
    name: 'Non-disclosure agreement',
    body: `<p>Dear {{candidateName}},</p>
<p>As you join {{companyName}}, {{companyAddress}} (“the Company”), as {{designation}}, this agreement of {{letterDate}} sets out how you will treat the Company’s confidential information. Please read it carefully before you sign.</p>
<ol>
<li><strong>Confidential information</strong> means any information about the Company, its clients, partners and people that is not public: business plans, finances, pricing, client and employee data, designs, source code, processes and know-how, in any form.</li>
<li><strong>Your obligations.</strong> You will use confidential information only to do your work for the Company; not share it with anyone outside the Company, or inside it without a need to know; protect it with reasonable care; and return or delete it when you leave or when asked.</li>
<li><strong>What is not covered.</strong> Information that is or becomes public through no fault of yours, that you already lawfully knew, or that you must disclose by law (in which case you will tell the Company first, where allowed).</li>
<li><strong>Personal data.</strong> You will handle personal data of clients and colleagues only as the Company’s policies and applicable Indian data protection law allow.</li>
<li><strong>Intellectual property.</strong> Everything you create in the course of your employment, including inventions, code, designs and documents, belongs to the Company, and you will sign whatever is reasonably needed to confirm this.</li>
<li><strong>Duration.</strong> These obligations apply during your employment and for three years after it ends; for trade secrets, for as long as they remain secret.</li>
<li><strong>Remedies.</strong> A breach may cause the Company harm that money cannot fully repair, so the Company may seek an injunction as well as damages.</li>
<li><strong>Governing law.</strong> This agreement is governed by the laws of India, and the courts where the Company’s registered office is located have jurisdiction.</li>
</ol>
<p>By signing on your joining portal you confirm that you have read and agree to this agreement.</p>
${SIGN_OFF}`,
  },
  confirmation: {
    name: 'Confirmation letter',
    body: `<p>Dear {{candidateName}},</p>
<p>We are pleased to confirm your employment as <strong>{{designation}}</strong> in the {{department}} team with effect from <strong>{{confirmationDate}}</strong>, on your successful completion of probation.</p>
<p>You will continue to report to {{managerName}}. Your employee ID {{employeeId}} stays the same, and all other terms of your appointment letter remain unchanged.</p>
<p>Thank you for everything you have brought to the team so far. We look forward to your continued growth with us.</p>
${SIGN_OFF}`,
  },
  extension: {
    name: 'Probation extension letter',
    body: `<p>Dear {{candidateName}},</p>
<p>Your probation as {{designation}} (employee ID {{employeeId}}), which was due to end on {{probationEndsOn}}, has been extended by {{extensionMonths}}, until <strong>{{extensionUntil}}</strong>.</p>
<p>This gives you and your manager more time to work on the goals you have discussed. You will continue to have monthly check-ins, and we will confirm the outcome in writing at the end of the extended period.</p>
<p>All other terms of your appointment letter remain unchanged. Please speak to your manager or to HR if you have any questions.</p>
${SIGN_OFF}`,
  },
  relieving: {
    name: 'Relieving letter',
    body: `<p>To whom it may concern,</p>
<p>This is to certify that <strong>{{candidateName}}</strong> (employee ID {{employeeId}}) worked with {{companyName}} as {{designation}} from {{joiningDate}} to {{lastWorkingDay}}.</p>
<p>{{firstName}} has been relieved of their duties with effect from the close of working hours on {{lastWorkingDay}}.</p>
<p>We thank them for their contribution and wish them well in their future endeavours.</p>
${SIGN_OFF}`,
  },
};

/** Fills {{key}} or {{merge.key}}; a missing one shows as [Label], as the dashboard's preview does. */
export function fillTemplate(body: string, values: Record<string, string>): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return body.replace(/\{\{\s*(?:merge\.)?([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => (values[key] ? esc(values[key]) : `[${MERGE_FIELDS[key] ?? key}]`));
}

function addMonths(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
}
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const firstOf = (name: string | undefined) => String(name ?? '').trim().split(/\s+/)[0] ?? '';

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function under100(n: number): string { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`; }
function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} hundred` : '', rest ? under100(rest) : ''].filter(Boolean).join(' and ');
}
/** Rupees in words, Indian style: 1450000 → "Rupees fourteen lakh fifty thousand only". */
export function rupeesInWords(amount: number): string {
  let n = Math.round(amount);
  if (!Number.isFinite(n) || n <= 0) return '';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000); n %= 10_000_000;
  const lakh = Math.floor(n / 100_000); n %= 100_000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${crore >= 100 ? under1000(crore) : under100(crore)} crore`);
  if (lakh) parts.push(`${under100(lakh)} lakh`);
  if (thousand) parts.push(`${under100(thousand)} thousand`);
  if (n) parts.push(under1000(n));
  return `Rupees ${parts.join(' ')} only`;
}

/** The latest version the candidate accepted (the appointment letter's source), else the current one. */
function acceptedVersion(versions: OfferVersion[]): OfferVersion | undefined {
  return [...versions].reverse().find((v) => v.acceptedAt && v.status === 'accepted') ?? [...versions].reverse().find((v) => v.acceptedAt) ?? versions[versions.length - 1];
}

/** The merge values for a letter from what the system knows, and the required ones still missing. */
export async function mergeValues(org: string, input: { kind?: unknown; journeyId?: unknown; userId?: unknown }, hrName = '', now = new Date()): Promise<{ values: Record<string, string>; missing: string[] }> {
  const kind = String(input.kind ?? '') as LetterKind;
  if (!LETTER_KINDS.includes(kind)) throw new LifecycleOfferError(400, 'Unknown letter kind');
  const journeyId = typeof input.journeyId === 'string' && input.journeyId ? input.journeyId : undefined;
  let userId = typeof input.userId === 'string' && input.userId ? input.userId : undefined;
  const journey = journeyId ? await journeys().findOne({ id: journeyId, org }) : null;
  if (journeyId && !journey) throw new LifecycleOfferError(404, 'Joiner not found');
  userId ??= journey?.userId;
  const user = userId ? await users().findOne({ userId, org }, { projection: { _id: 0, profilePhotoUrl: 0 } }) : null;
  if (userId && !user) throw new LifecycleOfferError(404, 'Employee not found');
  if (!journey && !user) throw new LifecycleOfferError(400, 'Pick a joiner or an employee');
  const company = await companyOf(org);
  const offer = journey ? await offers().findOne({ journeyId: journey.id }) : null;
  const version = offer ? (kind === 'offer' ? offer.versions[offer.versions.length - 1] : acceptedVersion(offer.versions)) : undefined;
  const f = version?.fields;
  const managerId = user?.managerUserId ?? f?.managerUserId ?? journey?.managerUserId;
  const manager = managerId ? await users().findOne({ userId: managerId }, { projection: { _id: 0, name: 1 } }) : null;
  const name = user?.name ?? journey?.candidate?.name ?? '';
  const tj = user?.joiningDate ? user.joiningDate.toISOString().slice(0, 10) : f?.tj ?? journey?.tj;
  const probationMonths = journey?.probation?.months ?? f?.probationMonths;
  const extendedBy = journey?.probation?.extendedBy ?? journey?.probation?.decision?.extendMonths;
  const endsOn = tj && probationMonths ? addMonths(tj, probationMonths) : undefined;
  const firstSent = offer?.versions.find((v) => v.sentAt)?.sentAt;
  const values: Record<string, string> = {
    companyName: companyDisplayName(company, org),
    companyAddress: companyAddress(company),
    letterDate: formatDay(istDate(now)),
    refNo: kind === 'offer' && version?.refNo ? version.refNo : '',
    candidateName: name,
    firstName: firstOf(name),
    employeeId: user?.employeeId ?? '',
    designation: journey?.probation?.decision?.designation ?? user?.designation ?? f?.designation ?? journey?.designation ?? '',
    department: user?.department ?? f?.department ?? journey?.department ?? '',
    location: user?.location ?? f?.location ?? journey?.location ?? '',
    managerName: manager?.name ?? '',
    joiningDate: formatDay(tj),
    ctc: f ? formatRupees(f.ctc) : '',
    ctcWords: f ? rupeesInWords(f.ctc) : '',
    probationMonths: probationMonths !== undefined ? plural(probationMonths, 'month') : '',
    probationEndsOn: formatDay(endsOn),
    noticeDays: f ? plural(f.noticeDays, 'day') : user?.exit?.noticeDays ? plural(user.exit.noticeDays, 'day') : '',
    validTill: formatDay(f?.validTill),
    offerDate: formatDay(firstSent ? istDate(firstSent) : istDate(now)),
    acceptedOn: version?.acceptedAt ? formatDay(istDate(version.acceptedAt)) : '',
    responsibilities: f?.responsibilities ?? '',
    confirmationDate: tj && probationMonths !== undefined ? formatDay(addMonths(tj, probationMonths + (extendedBy ?? 0))) : '',
    extensionMonths: extendedBy ? plural(extendedBy, 'month') : '',
    extensionUntil: endsOn && extendedBy ? formatDay(addMonths(endsOn, extendedBy)) : '',
    lastWorkingDay: formatDay(user?.exit?.lastWorkingDay),
    hrName,
  };
  return { values, missing: missingFields(kind, values) };
}

export function missingFields(kind: LetterKind, values: Record<string, string>): string[] {
  return REQUIRED_FIELDS[kind].filter((k) => !String(values[k] ?? '').trim());
}

// ─── Templates ──────────────────────────────────────────────────────────────

export async function ensureDefaultLetterTemplates(org: string): Promise<void> {
  const have = new Set((await letterTemplates().find({ org }, { projection: { _id: 0, kind: 1 } }).toArray()).map((t) => t.kind));
  const missing = LETTER_KINDS.filter((k) => !have.has(k));
  if (!missing.length) return;
  await letterTemplates().insertMany(missing.map((kind) => ({
    id: randomUUID(), org, kind, name: DEFAULT_LETTER_TEMPLATES[kind].name, body: DEFAULT_LETTER_TEMPLATES[kind].body, isDefault: true, updatedAt: new Date(),
  })));
}

export async function listLetterTemplates(org: string, kind?: unknown): Promise<LetterTemplate[]> {
  await ensureDefaultLetterTemplates(org);
  const filter = typeof kind === 'string' && LETTER_KINDS.includes(kind as LetterKind) ? { org, kind: kind as LetterKind } : { org };
  return letterTemplates().find(filter, { projection: { _id: 0 } }).sort({ kind: 1, isDefault: -1, name: 1 }).toArray();
}

function cleanTemplateInput(input: { kind?: unknown; name?: unknown; body?: unknown; isDefault?: unknown }, partial: boolean) {
  const out: Partial<Pick<LetterTemplate, 'kind' | 'name' | 'body' | 'isDefault'>> = {};
  if (!partial || input.kind !== undefined) {
    if (!LETTER_KINDS.includes(String(input.kind) as LetterKind)) throw new LifecycleOfferError(400, 'Unknown letter kind');
    out.kind = String(input.kind) as LetterKind;
  }
  if (!partial || input.name !== undefined) {
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 120) throw new LifecycleOfferError(400, 'Give the template a name');
    out.name = name;
  }
  if (!partial || input.body !== undefined) {
    const body = String(input.body ?? '');
    if (!body.trim()) throw new LifecycleOfferError(400, 'The template is empty');
    if (body.length > 200_000) throw new LifecycleOfferError(400, 'The template is too long');
    if (/<script|\son\w+\s*=|javascript:/i.test(body)) throw new LifecycleOfferError(400, 'Templates cannot contain scripts');
    out.body = body;
  }
  if (input.isDefault !== undefined) out.isDefault = input.isDefault === true;
  return out;
}

export async function createLetterTemplate(org: string, input: { kind?: unknown; name?: unknown; body?: unknown; isDefault?: unknown }): Promise<LetterTemplate> {
  await ensureDefaultLetterTemplates(org);
  const clean = cleanTemplateInput(input, false);
  const template: LetterTemplate = { id: randomUUID(), org, kind: clean.kind!, name: clean.name!, body: clean.body!, isDefault: clean.isDefault === true, updatedAt: new Date() };
  if (template.isDefault) await letterTemplates().updateMany({ org, kind: template.kind }, { $set: { isDefault: false } });
  await letterTemplates().insertOne({ ...template });
  return template;
}

export async function updateLetterTemplate(org: string, id: string, input: { kind?: unknown; name?: unknown; body?: unknown; isDefault?: unknown }): Promise<LetterTemplate> {
  const existing = await letterTemplates().findOne({ id, org });
  if (!existing) throw new LifecycleOfferError(404, 'Template not found');
  const clean = cleanTemplateInput(input, true);
  if (clean.kind && clean.kind !== existing.kind) throw new LifecycleOfferError(400, 'A template’s kind cannot change');
  if (clean.isDefault === false && existing.isDefault) throw new LifecycleOfferError(400, 'Make another template the default instead');
  if (clean.isDefault === true) await letterTemplates().updateMany({ org, kind: existing.kind, id: { $ne: id } }, { $set: { isDefault: false } });
  return (await letterTemplates().findOneAndUpdate({ id, org }, { $set: { ...clean, updatedAt: new Date() } }, { returnDocument: 'after', projection: { _id: 0 } }))!;
}

async function defaultTemplate(org: string, kind: LetterKind): Promise<LetterTemplate> {
  await ensureDefaultLetterTemplates(org);
  return (await letterTemplates().findOne({ org, kind, isDefault: true })) ?? (await letterTemplates().findOne({ org, kind }))!;
}

// ─── Letters ────────────────────────────────────────────────────────────────

export interface LetterView {
  id: string; kind: LetterKind; refNo: string; state: 'draft' | 'sent' | 'ready' | 'opened' | 'signed';
  pdfFileId?: string; signedPdfFileId?: string; sentAt?: Date; signedAt?: Date; templateId: string; missing: string[];
}

function letterState(letter: Letter): LetterView['state'] {
  if (letter.signature) return 'signed';
  if (letter.openedAt) return 'opened';
  if (SIGNED_KINDS.includes(letter.kind) && letter.pdfFileId) return 'ready';
  if (letter.email?.sentAt) return 'sent';
  return 'draft';
}
const toView = (l: Letter): LetterView => ({
  id: l.id, kind: l.kind, refNo: l.refNo, state: letterState(l), pdfFileId: l.pdfFileId, signedPdfFileId: l.signedPdfFileId,
  sentAt: l.email?.sentAt, signedAt: l.signature?.signedAt, templateId: l.templateId, missing: missingFields(l.kind, l.values),
});

/** ENGINE-API read function (the HR side panel). */
export async function journeyLettersView(journeyId: string): Promise<LetterView[]> {
  return (await letters().find({ journeyId }, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray()).map(toView);
}

export async function listLetters(org: string, q: { journeyId?: unknown; userId?: unknown; kind?: unknown }): Promise<Array<Letter & { state: LetterView['state']; missing: string[] }>> {
  const filter: Record<string, unknown> = { org };
  if (typeof q.journeyId === 'string' && q.journeyId) filter.journeyId = q.journeyId;
  if (typeof q.userId === 'string' && q.userId) filter.userId = q.userId;
  if (typeof q.kind === 'string' && LETTER_KINDS.includes(q.kind as LetterKind)) filter.kind = q.kind;
  const rows = await letters().find(filter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(500).toArray();
  return rows.map((l) => ({ ...l, state: letterState(l), missing: missingFields(l.kind, l.values) }));
}

function cleanValues(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 80)) {
    if (!/^[a-zA-Z0-9_.]{1,64}$/.test(k) || v === undefined || v === null) continue;
    out[k] = String(v).slice(0, 5000);
  }
  return out;
}

/**
 * A letter for a joiner or an employee, its values the server's merge with
 * HR's edits on top. For a joiner's appointment letter or NDA that is not yet
 * signed, the existing row is updated rather than a second one made.
 */
export async function createLetter(hr: { org: string; name: string }, input: { kind?: unknown; journeyId?: unknown; userId?: unknown; templateId?: unknown; values?: unknown }): Promise<Letter> {
  const kind = String(input.kind ?? '') as LetterKind;
  if (!LETTER_KINDS.includes(kind)) throw new LifecycleOfferError(400, 'Unknown letter kind');
  const merged = await mergeValues(hr.org, input, hr.name);
  const journeyId = typeof input.journeyId === 'string' && input.journeyId ? input.journeyId : undefined;
  const journey = journeyId ? await journeys().findOne({ id: journeyId, org: hr.org }) : null;
  const userId = (typeof input.userId === 'string' && input.userId) || journey?.userId || undefined;
  const template = typeof input.templateId === 'string' && input.templateId
    ? await letterTemplates().findOne({ id: input.templateId, org: hr.org })
    : await defaultTemplate(hr.org, kind);
  if (!template) throw new LifecycleOfferError(404, 'Template not found');
  if (template.kind !== kind) throw new LifecycleOfferError(400, 'That template is for another kind of letter');
  const values = { ...merged.values, ...cleanValues(input.values) };
  if (journey && SIGNED_KINDS.includes(kind)) {
    const open = await letters().findOne({ journeyId: journey.id, kind, signature: { $exists: false } });
    if (open) {
      values.refNo = open.refNo;
      return (await letters().findOneAndUpdate({ id: open.id }, { $set: { values, templateId: template.id } }, { returnDocument: 'after', projection: { _id: 0 } }))!;
    }
  }
  const refNo = values.refNo || await nextLetterRef(hr.org, kind);
  values.refNo = refNo;
  const letter: Letter = {
    id: randomUUID(), org: hr.org, ...(journey ? { journeyId: journey.id } : {}), ...(userId ? { userId } : {}),
    kind, templateId: template.id, refNo, values, createdAt: new Date(), createdByName: hr.name,
  };
  await letters().insertOne({ ...letter });
  return letter;
}

async function nextLetterRef(org: string, kind: LetterKind): Promise<string> {
  // Imported here: offers.ts imports this module.
  const { nextRefNo } = await import('./offers');
  return nextRefNo(org, REF_PREFIX[kind]);
}

export async function uploadLetterPdf(hr: { org: string }, letterId: string, file: { originalname?: string; buffer: Buffer } | undefined): Promise<Letter> {
  if (!file) throw new LifecycleOfferError(400, 'Attach the letter PDF as "file"');
  const letter = await letters().findOne({ id: letterId, org: hr.org });
  if (!letter) throw new LifecycleOfferError(404, 'Letter not found');
  if (letter.signature) throw new LifecycleOfferError(409, 'This letter is signed; make a new one instead');
  checkUpload(file.buffer, { pdfOnly: true });
  const title = DEFAULT_LETTER_TEMPLATES[letter.kind].name;
  const stored = await storeFile(hr.org, letter.journeyId, { name: file.originalname || `${title} - ${letter.values.candidateName ?? ''}.pdf`, contentType: 'application/pdf', bytes: file.buffer }, 'hr');
  const updated = (await letters().findOneAndUpdate({ id: letterId }, { $set: { pdfFileId: stored.id }, $unset: { openedAt: '' } }, { returnDocument: 'after', projection: { _id: 0 } }))!;
  if (updated.journeyId && SIGNED_KINDS.includes(updated.kind)) await maybeSendLettersReady(updated.journeyId);
  return updated;
}

/** H3c's Send email: the PDF attached. An offer letter for a joiner goes out as the offer itself (its personal link). */
export async function sendLetter(
  hr: { org: string; userId: string; name: string; seesPay: boolean },
  letterId: string,
  input: { to?: unknown; cc?: unknown; subject?: unknown; body?: unknown; withPortalLink?: unknown },
): Promise<Letter> {
  const letter = await letters().findOne({ id: letterId, org: hr.org });
  if (!letter) throw new LifecycleOfferError(404, 'Letter not found');
  if (!letter.pdfFileId) throw new LifecycleOfferError(409, 'Generate the PDF first');
  const missing = missingFields(letter.kind, letter.values);
  if (missing.length) throw new LifecycleOfferError(409, `Fill the missing details first: ${missing.map((k) => MERGE_FIELDS[k] ?? k).join(', ')}`);
  const to = String(input.to ?? '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(to)) throw new LifecycleOfferError(400, 'A valid recipient email is required');
  const cc = Array.isArray(input.cc) ? input.cc.map((a) => String(a).trim().toLowerCase()).filter((a) => /^\S+@\S+\.\S+$/.test(a)).slice(0, 10) : [];
  const subject = String(input.subject ?? '').trim() || `Your ${DEFAULT_LETTER_TEMPLATES[letter.kind].name.toLowerCase()}`;
  const body = String(input.body ?? '').trim();
  if (!body) throw new LifecycleOfferError(400, 'Write the email');
  if (subject.length > 200 || body.length > 20_000) throw new LifecycleOfferError(400, 'The email is too long');
  const withPortalLink = input.withPortalLink === true;
  const now = new Date();
  if (letter.kind === 'offer' && letter.journeyId) {
    const { sendOffer } = await import('./offers');
    const offer = await offers().findOne({ journeyId: letter.journeyId });
    const v = offer?.versions[offer.versions.length - 1];
    if (offer && v?.status === 'draft' && !v.pdfFileId) {
      await offers().updateOne({ id: offer.id, 'versions.version': v.version }, { $set: { 'versions.$.pdfFileId': letter.pdfFileId } });
    }
    await sendOffer(hr, letter.journeyId, { subject, body, cc });
  } else {
    const file = await lifecycleFiles().findOne({ id: letter.pdfFileId, org: hr.org });
    if (!file) throw new LifecycleOfferError(409, 'Generate the PDF first');
    const company = await companyOf(hr.org);
    const link = withPortalLink && letter.journeyId && (await candidateAccounts().findOne({ journeyId: letter.journeyId })) ? portalLink('/') : null;
    await sendLifecycleEmail(hr.org, to, subject, mails.letter(companyDisplayName(company, hr.org), body, link),
      [{ filename: file.name, content: await readFileBytes(file), contentType: 'application/pdf' }], { cc });
  }
  return (await letters().findOneAndUpdate({ id: letterId }, { $set: { email: { to, ...(cc.length ? { cc } : {}), subject, body, sentAt: now, withPortalLink } } }, { returnDocument: 'after', projection: { _id: 0 } }))!;
}

// ─── Journey letters: unlock, regenerate, letters-ready mail ────────────────

const signsOnDay1 = (journey: Pick<Journey, 'templateSnapshot'>) => journey.templateSnapshot.settings.signLettersOnDay1 === true;

async function docsApproved(journeyId: string): Promise<boolean> {
  const { allRequiredApproved } = await import('./documents');
  return allRequiredApproved(journeyId);
}

/** The last document approved: appointment letter and NDA are drafted from the accepted offer, and signing opens (portal) unless the template signs them on Day 1. */
export async function unlockJourneyLetters(journeyId: string): Promise<void> {
  const journey = await journeys().findOne({ id: journeyId });
  if (!journey || signsOnDay1(journey)) return;
  for (const kind of SIGNED_KINDS) {
    if (!(await letters().findOne({ journeyId, kind, signature: { $exists: false } })) && !(await letters().findOne({ journeyId, kind }))) {
      await createLetter({ org: journey.org, name: (await users().findOne({ userId: journey.createdByUserId }, { projection: { _id: 0, name: 1 } }))?.name ?? '' }, { kind, journeyId });
    }
  }
  await reopenTask(journeyId, 'sign_letters');
  await maybeSendLettersReady(journeyId);
}

/** After a revised offer is finalised again: unsigned letters take the new values and need a new PDF; signed ones get a fresh draft beside them. */
export async function regenerateAppointmentLetters(journeyId: string): Promise<void> {
  const journey = await journeys().findOne({ id: journeyId });
  if (!journey) return;
  const rows = await letters().find({ journeyId, kind: { $in: SIGNED_KINDS } }).toArray();
  if (!rows.length) return;
  const hrName = (await users().findOne({ userId: journey.createdByUserId }, { projection: { _id: 0, name: 1 } }))?.name ?? '';
  for (const kind of SIGNED_KINDS) {
    const ofKind = rows.filter((r) => r.kind === kind);
    if (!ofKind.length) continue;
    const open = ofKind.find((r) => !r.signature);
    const { values } = await mergeValues(journey.org, { kind, journeyId }, hrName);
    if (open) {
      values.refNo = open.refNo;
      await letters().updateOne({ id: open.id }, { $set: { values }, $unset: { pdfFileId: '', openedAt: '' } });
    } else {
      await createLetter({ org: journey.org, name: hrName }, { kind, journeyId });
    }
  }
  await reopenTask(journeyId, 'sign_letters');
  await forgetFired(`letters_ready:${journeyId}`);
}

/** Once both letters have their PDF and the documents are approved: "your letters are ready" (once per set). */
export async function maybeSendLettersReady(journeyId: string): Promise<boolean> {
  const journey = await journeys().findOne({ id: journeyId });
  if (!journey || signsOnDay1(journey) || !journey.candidate?.personalEmail) return false;
  if (!['active', 'docs_approved', 'finalised'].includes(String(journey.status))) return false;
  if (!(await docsApproved(journeyId))) return false;
  const open = await letters().find({ journeyId, kind: { $in: SIGNED_KINDS }, signature: { $exists: false } }).toArray();
  if (!open.length || open.some((l) => !l.pdfFileId)) return false;
  if (!(await fireOnce(`letters_ready:${journeyId}`, journey.org))) return false;
  const company = await companyOf(journey.org);
  await sendLifecycleEmail(journey.org, journey.candidate.personalEmail, 'Your appointment letter is ready to sign',
    mails.lettersReady(companyDisplayName(company, journey.org), journey.candidate.name, formatDay(journey.tj ? addDays(journey.tj, -2) : undefined)));
  return true;
}

// ─── Portal: list, open, sign ───────────────────────────────────────────────

export interface PortalLetter { id: string; kind: LetterKind; title: string; fileName: string; state: 'locked' | 'ready' | 'opened' | 'signed'; pdfUrl: string | null; signedAt?: Date }

export async function portalLetters(journey: Journey): Promise<PortalLetter[]> {
  const unlocked = !signsOnDay1(journey) && (await docsApproved(journey.id));
  const rows = await letters().find({ journeyId: journey.id, kind: { $in: SIGNED_KINDS } }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
  const fileIds = rows.flatMap((r) => [r.signedPdfFileId, r.pdfFileId]).filter((id): id is string => Boolean(id));
  const fileNames = new Map((await lifecycleFiles().find({ id: { $in: fileIds } }, { projection: { _id: 0, id: 1, name: 1 } }).toArray()).map((f) => [f.id, f.name]));
  return SIGNED_KINDS.map((kind) => {
    // The newest of a kind (a regenerated letter replaces a signed one).
    const row = rows.find((r) => r.kind === kind);
    const title = kind === 'nda' ? 'Non-disclosure agreement' : 'Appointment letter';
    const fallback = kind === 'nda' ? 'NDA.pdf' : 'Appointment letter.pdf';
    if (!row || !unlocked || !row.pdfFileId) return { id: row?.id ?? kind, kind, title, fileName: fallback, state: 'locked' as const, pdfUrl: null };
    const state = row.signature ? 'signed' as const : row.openedAt ? 'opened' as const : 'ready' as const;
    const fileName = fileNames.get(row.signedPdfFileId ?? '') ?? fileNames.get(row.pdfFileId) ?? fallback;
    return { id: row.id, kind, title, fileName, state, pdfUrl: `/portal/letters/${row.id}/pdf`, ...(row.signature ? { signedAt: row.signature.signedAt } : {}) };
  });
}

async function portalLetter(journey: Journey, letterId: string): Promise<{ letter: Letter; view: PortalLetter }> {
  const view = (await portalLetters(journey)).find((l) => l.id === letterId);
  const letter = view ? await letters().findOne({ id: letterId, journeyId: journey.id }) : null;
  if (!view || !letter) throw new LifecycleOfferError(404, 'Letter not found');
  if (view.state === 'locked') throw new LifecycleOfferError(403, 'This letter opens once HR has approved your documents');
  return { letter, view };
}

export async function letterPdfForPortal(journey: Journey, letterId: string): Promise<{ name: string; bytes: Buffer }> {
  const { letter } = await portalLetter(journey, letterId);
  const file = await lifecycleFiles().findOne({ id: letter.signedPdfFileId ?? letter.pdfFileId, journeyId: journey.id });
  if (!file) throw new LifecycleOfferError(404, 'File not found');
  return { name: file.name, bytes: await readFileBytes(file) };
}

export async function openLetter(journey: Journey, letterId: string, now = new Date()): Promise<PortalLetter[]> {
  const { letter } = await portalLetter(journey, letterId);
  if (!letter.openedAt) await letters().updateOne({ id: letter.id }, { $set: { openedAt: now } });
  await journeys().updateOne({ id: journey.id }, { $set: { lastActivityAt: now } });
  return portalLetters(journey);
}

const PORTAL_OPEN = new Set(['active', 'docs_approved', 'finalised']);

export async function signLetter(
  journey: Journey,
  letterId: string,
  input: { method?: unknown; typedName?: unknown; imageDataUrl?: unknown },
  meta: { ip: string; userAgent?: string },
  now = new Date(),
): Promise<PortalLetter[]> {
  if (!PORTAL_OPEN.has(String(journey.status))) throw new LifecycleOfferError(409, 'Letters can’t be signed right now');
  const { letter, view } = await portalLetter(journey, letterId);
  if (view.state === 'signed') throw new LifecycleOfferError(409, 'Already signed');
  if (!letter.openedAt) throw new LifecycleOfferError(409, 'Open the PDF to sign');
  const method = String(input.method ?? '');
  let typedName: string | undefined;
  let image: { bytes: Buffer; type: 'image/png' | 'image/jpeg' } | undefined;
  if (method === 'type') {
    typedName = String(input.typedName ?? '').trim().replace(/\s+/g, ' ');
    if (typedName.length < 2 || typedName.length > 80) throw new LifecycleOfferError(400, 'Type your full name');
  } else if (method === 'draw') {
    const match = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(input.imageDataUrl ?? ''));
    if (!match) throw new LifecycleOfferError(400, 'Draw your signature');
    const bytes = Buffer.from(match[2], 'base64');
    const type = sniffContentType(bytes);
    if (bytes.length > 1024 * 1024 || (type !== 'image/png' && type !== 'image/jpeg')) throw new LifecycleOfferError(400, 'The signature image is not valid');
    image = { bytes, type };
  } else throw new LifecycleOfferError(400, 'Draw or type your signature');
  const ip = meta.ip.slice(0, 64);
  const device = String(meta.userAgent ?? '').slice(0, 300);
  const imageFile = image ? await storeFile(journey.org, journey.id, { name: `Signature - ${letter.refNo}.${image.type === 'image/png' ? 'png' : 'jpg'}`, contentType: image.type, bytes: image.bytes }, 'candidate') : undefined;
  const signature: NonNullable<Letter['signature']> = {
    method: method as 'draw' | 'type', ...(typedName ? { typedName } : {}), ...(imageFile ? { imageFileId: imageFile.id } : {}), signedAt: now, ip, device,
  };
  // Claimed first, so two taps cannot both sign.
  const claimed = await letters().findOneAndUpdate({ id: letter.id, signature: { $exists: false } }, { $set: { signature } }, { returnDocument: 'after' });
  if (!claimed) throw new LifecycleOfferError(409, 'Already signed');
  const original = await lifecycleFiles().findOne({ id: letter.pdfFileId, journeyId: journey.id });
  if (original) {
    const stamped = await pdfStamper.stamp(await readFileBytes(original), {
      name: journey.candidate?.name ?? '', method: signature.method, typedName, image, signedAt: now, ip, device, refNo: letter.refNo,
    }).catch(() => null);
    if (stamped) {
      const signedFile = await storeFile(journey.org, journey.id, { name: original.name.replace(/\.pdf$/i, '') + ' (signed).pdf', contentType: 'application/pdf', bytes: stamped }, 'system');
      await letters().updateOne({ id: letter.id }, { $set: { signedPdfFileId: signedFile.id } });
    }
  }
  await journeys().updateOne({ id: journey.id }, { $set: { lastActivityAt: now } });
  const list = await portalLetters(journey);
  if (list.every((l) => l.state === 'signed')) await completeTask(journey.id, 'sign_letters', { name: journey.candidate?.name });
  return list;
}

// ─── Stamping the signature onto the PDF ────────────────────────────────────

export interface SignatureStamp {
  name: string; method: 'draw' | 'type'; typedName?: string; image?: { bytes: Buffer; type: 'image/png' | 'image/jpeg' };
  signedAt: Date; ip?: string; device?: string; refNo: string;
}
/** Returns the signed PDF, or null when it cannot stamp (the signature record is then kept with the original). */
export interface PdfStamper { stamp(pdf: Buffer, sig: SignatureStamp): Promise<Buffer | null> }

const latin1 = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const istStamp = (at: Date) => `${new Date(at.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')} IST`;

/** pdf-lib, loaded when it is there (it is not a backend dependency yet). */
export const pdfLibStamper: PdfStamper = {
  async stamp(pdf, sig) {
    let lib: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const name = 'pdf-lib';
      lib = await import(name);
    } catch {
      return null;
    }
    const { PDFDocument, StandardFonts, rgb } = lib;
    const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const script = await doc.embedFont(StandardFonts.TimesRomanItalic);
    const grey = rgb(0.28, 0.28, 0.28);
    const pages = doc.getPages();
    const last = pages[pages.length - 1];
    const { width } = last.getSize();
    const x = width - 260;
    if (sig.image) {
      const img = sig.image.type === 'image/png' ? await doc.embedPng(sig.image.bytes) : await doc.embedJpg(sig.image.bytes);
      const fit = img.scaleToFit(200, 48);
      last.drawImage(img, { x, y: 70, width: fit.width, height: fit.height });
    } else {
      last.drawText(latin1(sig.typedName ?? sig.name), { x, y: 78, size: 20, font: script });
    }
    last.drawText(latin1(`Signed by ${sig.name}`), { x, y: 58, size: 8, font: bold, color: grey });
    last.drawText(latin1(`${istStamp(sig.signedAt)}  |  IP ${sig.ip ?? '-'}`), { x, y: 47, size: 7, font, color: grey });
    // A record page at the end: what was signed, by whom, when and from where.
    const page = doc.addPage();
    const { height } = page.getSize();
    const lines: Array<[string, string]> = [
      ['Document', sig.refNo], ['Signed by', sig.name], ['Method', sig.method === 'draw' ? 'Drawn signature' : `Typed name (${sig.typedName ?? ''})`],
      ['Signed at', istStamp(sig.signedAt)], ['IP address', sig.ip ?? '-'], ['Device', sig.device ?? '-'],
    ];
    page.drawText('Signature record', { x: 56, y: height - 72, size: 16, font: bold });
    let y = height - 110;
    for (const [label, value] of lines) {
      page.drawText(latin1(label), { x: 56, y, size: 10, font: bold, color: grey });
      const chunks = latin1(value).match(/.{1,80}/g) ?? [''];
      for (const chunk of chunks) { page.drawText(chunk, { x: 160, y, size: 10, font }); y -= 14; }
      y -= 6;
    }
    return Buffer.from(await doc.save());
  },
};

export let pdfStamper: PdfStamper = pdfLibStamper;
/** For tests: swap the stamper. */
export function setPdfStamper(stamper: PdfStamper): void { pdfStamper = stamper; }
