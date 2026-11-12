/**
 * Form 16: the TDS certificate an employer gives each employee after a FY.
 *
 * Sowaka does not generate it (see suwi/tools/payroll-tax.ts): HR gets Part A
 * from TRACES and Part B from their tax tool, and uploads the PDFs here, one
 * per person or a batch whose file names carry the PAN or the employee ID.
 * The app's Payroll › Downloads › Form 16 lists a person's years and opens a
 * file through a short-lived link.
 *
 * The app shows it only where Sowaka has switched it on for the company
 * (companies.features.form16, see form16AppEnabled): off, the person's list
 * is empty and their files are not found, whatever is uploaded, so an app
 * build that does not know the switch shows nothing either. HR's side works
 * either way, so HR can upload ahead of turning it on.
 *
 * Rows live in `form16_documents`, one per person, FY and part (A, B or
 * combined); the files in the receipts bucket under `…/form16/`.
 *
 * The dates are the law's, worked out from the FY, never stored: Form 16 is
 * due by 15 June after the FY ends (Rule 31 of the Income-tax Rules), and the
 * return for a salaried person by 31 July after it (section 139(1)).
 */
import { ObjectId } from 'mongodb';
import { employeePaymentDetails, getDb, payrollRuns, payslips, users } from '../config/db';
import { FORM16_PARTS, Form16Document, Form16Part } from '../models/form16.model';
import { fyOf } from '../shared/payroll/tds';
import {
  EmployeePayrollError, dayLabel, dayOf, form16AppEnabled, istPeriodOf, meOf, parseFyParam, payrollViewerOrg, payrollViewerOrgFor,
} from './employeePayroll.common';
import { decryptField, fieldKeyConfigured } from './fieldCrypto';
import { deleteReimbursementReceipt, hasReceiptStorage, presignReceiptDownload, uploadForm16 } from './s3-receipt.service';

type StoredForm16 = Form16Document & { _id: ObjectId };

export function form16Documents() {
  return getDb().collection<Form16Document>('form16_documents');
}

let indexed: Promise<unknown> | null = null;
/** The collection's indexes, made once per process on first use. */
function ensureIndexes() {
  indexed ??= Promise.all([
    form16Documents().createIndex({ org: 1, userId: 1, fy: 1, part: 1 }, { unique: true }),
    form16Documents().createIndex({ org: 1, fy: 1 }),
  ]).catch((error) => {
    indexed = null;
    throw error;
  });
  return indexed;
}

// —— storage (S3), swappable so the checks never reach the bucket ——

export interface Form16Storage {
  available(): boolean;
  upload(org: string, userId: string, file: { originalName: string; contentType: string; size: number; bytes: Buffer }): Promise<{ objectKey: string }>;
  remove(objectKey: string): Promise<void>;
  url(objectKey: string, fileName: string): Promise<string>;
}

const s3Storage: Form16Storage = {
  available: hasReceiptStorage,
  upload: (org, userId, file) => uploadForm16(org, userId, file),
  remove: deleteReimbursementReceipt,
  url: presignReceiptDownload,
};
let storage: Form16Storage = s3Storage;
export function setForm16StorageForTests(next: Form16Storage | null) {
  storage = next ?? s3Storage;
}

export type Form16File = { originalname: string; mimetype: string; size: number; buffer: Buffer };

/** The largest Form 16 PDF taken (a TRACES Part A is about 100 KB). */
export const FORM16_MAX_BYTES = 3 * 1024 * 1024;
/** Files per bulk request; the dashboard sends a big batch in several. */
export const FORM16_MAX_BULK_FILES = 30;

// —— the dates ——

const fyStart = (fy: string) => Number(fy.slice(0, 4));
const fyName = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
/** The FY it is in India today. */
export const currentFy = (now: Date) => fyOf(istPeriodOf(now)).fy;
export const previousFy = (fy: string) => fyName(fyStart(fy) - 1);
/** 15 June after the FY ends: when Form 16 is due. */
export const form16DueOn = (fy: string) => `${fyStart(fy) + 1}-06-15`;
/** 31 July after the FY ends: the last day to file the year's return without a late fee. */
export const returnDueOn = (fy: string) => `${fyStart(fy) + 1}-07-31`;
const fyFirstPeriod = (fy: string) => `${fyStart(fy)}-04`;
const fyLastPeriod = (fy: string) => `${fyStart(fy) + 1}-03`;

/** A FY HR can file a Form 16 for: one that has ended. */
function endedFy(raw: unknown, now: Date): string {
  if (raw === undefined || raw === null || raw === '') throw new EmployeePayrollError(400, 'Say which FY the Form 16 is for, like 2025-26');
  const fy = parseFyParam(raw, now);
  if (fyStart(fy) < 2000) throw new EmployeePayrollError(400, 'fy is like 2025-26');
  if (fyStart(fy) >= fyStart(currentFy(now))) {
    throw new EmployeePayrollError(409, `FY ${fy} has not ended yet. Form 16 is issued after the year ends, by ${dayLabel(form16DueOn(fy))}.`, { reason: 'fy_not_ended' });
  }
  return fy;
}

function partOf(raw: unknown): Form16Part {
  if (raw === undefined || raw === null || raw === '') return 'combined';
  const value = String(raw).trim();
  const part = value === 'a' ? 'A' : value === 'b' ? 'B' : value;
  if (!FORM16_PARTS.includes(part as Form16Part)) throw new EmployeePayrollError(400, 'part is A, B or combined');
  return part as Form16Part;
}

function documentView(d: StoredForm16) {
  return { id: d._id.toHexString(), fy: d.fy, part: d.part, fileName: d.fileName, size: d.size, uploadedAt: d.uploadedAt.toISOString() };
}

// —— the employee's own ——

/** Whether the person has a released payslip in the FY: Sowaka paid them, so a Form 16 is owed. */
async function paidIn(userId: string, fy: string): Promise<boolean> {
  const runIds = await payslips().distinct('runId', { userId, period: { $gte: fyFirstPeriod(fy), $lte: fyLastPeriod(fy) } });
  const ids = runIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (ids.length === 0) return false;
  return (await payrollRuns().countDocuments({ _id: { $in: ids }, status: { $in: ['approved', 'paid'] } }, { limit: 1 })) > 0;
}

/**
 * The person's Form 16 years, newest first: this FY (not due yet), every FY
 * with a file, and last FY when Sowaka paid them in it but nothing is filed
 * yet. `status`: ready (files to download), pending (not due yet: ready by
 * `readyBy`), missing (past due and nothing filed: ask HR).
 */
export async function myForm16(userId: string, now = new Date()) {
  await ensureIndexes();
  const { org } = await meOf(userId);
  const thisFy = currentFy(now);
  const lastFy = previousFy(thisFy);
  // Hidden in the app at this company: no years, no tip, nothing to open.
  if (!(await form16AppEnabled(org))) return { enabled: false as const, currentFy: thisFy, filing: null, years: [] };
  const rows = (await form16Documents().find({ org, userId }).sort({ fy: -1, part: 1 }).toArray()) as StoredForm16[];
  const byFy = new Map<string, StoredForm16[]>();
  for (const row of rows) byFy.set(row.fy, [...(byFy.get(row.fy) ?? []), row]);
  const fys = new Set([thisFy, ...byFy.keys()]);
  if (!byFy.has(lastFy) && (await paidIn(userId, lastFy))) fys.add(lastFy);
  const today = dayOf(now);
  const years = [...fys]
    .filter((fy) => fyStart(fy) <= fyStart(thisFy))
    .sort((a, b) => fyStart(b) - fyStart(a))
    .map((fy) => {
      const docs = fy === thisFy ? [] : (byFy.get(fy) ?? []);
      const readyBy = form16DueOn(fy);
      const status = docs.length > 0 ? 'ready' : fy === thisFy || today <= readyBy ? 'pending' : 'missing';
      return { fy, status, readyBy, documents: docs.map(documentView) };
    });
  return { enabled: true as const, currentFy: thisFy, filing: { fy: lastFy, lastDate: returnDueOn(lastFy) }, years };
}

/** A short-lived link to one of the person's own files. */
export async function myForm16File(userId: string, documentId: string) {
  const { org } = await meOf(userId);
  if (!(await form16AppEnabled(org))) throw new EmployeePayrollError(404, 'Form 16 not found', { reason: 'form16_off' });
  if (!ObjectId.isValid(documentId)) throw new EmployeePayrollError(404, 'Form 16 not found');
  const doc = (await form16Documents().findOne({ _id: new ObjectId(documentId), org, userId })) as StoredForm16 | null;
  if (!doc) throw new EmployeePayrollError(404, 'Form 16 not found');
  return { url: await storage.url(doc.objectKey, doc.fileName), fileName: doc.fileName };
}

// —— HR ——

const viewer = (viewerUserId: string) => payrollViewerOrg(viewerUserId, 'manage Form 16');

/**
 * Stores one file as a person's Form 16 for a FY: the same part replaced, a
 * combined file replacing both parts and a part replacing a combined file.
 */
async function store(org: string, userId: string, fy: string, part: Form16Part, file: Form16File, uploadedBy: string, now: Date) {
  if (file.mimetype !== 'application/pdf') throw new EmployeePayrollError(400, 'Form 16 must be a PDF');
  if (file.size > FORM16_MAX_BYTES) throw new EmployeePayrollError(413, 'Form 16 must be 3 MB or smaller');
  if (!storage.available()) throw new EmployeePayrollError(503, 'File uploads are not set up on this server');
  const stored = await storage.upload(org, userId, { originalName: file.originalname, contentType: 'application/pdf', size: file.size, bytes: file.buffer });
  const fileName = (file.originalname || `Form16-${fy}.pdf`).normalize('NFC').slice(-120);
  const replaces: Form16Part[] = part === 'combined' ? ['A', 'B', 'combined'] : [part, 'combined'];
  const old = (await form16Documents().find({ org, userId, fy, part: { $in: replaces } }).toArray()) as StoredForm16[];
  const saved = (await form16Documents().findOneAndUpdate(
    { org, userId, fy, part },
    { $set: { org, userId, fy, part, objectKey: stored.objectKey, fileName, size: file.size, uploadedBy, uploadedAt: now } },
    { upsert: true, returnDocument: 'after' },
  )) as StoredForm16 | null;
  const superseded = old.filter((d) => d.part !== part);
  if (superseded.length) await form16Documents().deleteMany({ _id: { $in: superseded.map((d) => d._id) } });
  // The files no one points at any more: best effort, a failure leaves an orphan, not an error.
  for (const d of old) if (d.objectKey !== stored.objectKey) await storage.remove(d.objectKey).catch(() => undefined);
  return documentView(saved!);
}

/** Who should have a Form 16 for the FY, and what is filed for each. */
export async function form16ForHr(viewerUserId: string, fyRaw: unknown, now = new Date()) {
  await ensureIndexes();
  const org = await viewer(viewerUserId);
  const fy = fyRaw === undefined || fyRaw === '' ? previousFy(currentFy(now)) : parseFyParam(fyRaw, now);
  const fyEnd = new Date(`${fyStart(fy) + 1}-04-01T00:00:00Z`);
  const [docs, paidUserIds, shownInApp] = await Promise.all([
    form16Documents().find({ org, fy }).toArray() as Promise<StoredForm16[]>,
    payslips().distinct('userId', { org, period: { $gte: fyFirstPeriod(fy), $lte: fyLastPeriod(fy) } }),
    form16AppEnabled(org),
  ]);
  // Everyone working here who had joined by the FY's end, anyone paid in it, anyone with a file.
  const people = await users().find(
    {
      org,
      $or: [
        { userId: { $in: [...new Set([...paidUserIds, ...docs.map((d) => d.userId)])] } },
        {
          lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
          hiddenFromDirectory: { $ne: true },
          $and: [{ $or: [{ joiningDate: { $exists: false } }, { joiningDate: null }, { joiningDate: { $lt: fyEnd } }] }],
        },
      ],
    } as never,
    { projection: { _id: 0, userId: 1, name: 1, employeeId: 1 } },
  ).toArray();
  const pans = await employeePaymentDetails().find({ org, userId: { $in: people.map((p) => p.userId) } }, { projection: { _id: 0, userId: 1, panLast4: 1 } }).toArray();
  const panLast4 = new Map(pans.map((p) => [p.userId, p.panLast4 ?? null]));
  const byUser = new Map<string, StoredForm16[]>();
  for (const d of docs) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
  const employees = people
    .map((p) => ({
      userId: p.userId,
      name: p.name ?? p.userId,
      employeeId: p.employeeId ?? null,
      panLast4: panLast4.get(p.userId) ?? null,
      documents: (byUser.get(p.userId) ?? []).sort((a, b) => a.part.localeCompare(b.part)).map(documentView),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    fy,
    readyBy: form16DueOn(fy),
    ended: fyStart(fy) < fyStart(currentFy(now)),
    // Whether employees see Form 16 in the app (companies.features.form16, set by Sowaka in the database).
    shownInApp,
    counts: { employees: employees.length, withForm16: employees.filter((e) => e.documents.length > 0).length },
    employees,
  };
}

/** One person's Form 16 for a FY, uploaded from their row. */
export async function uploadForm16ForHr(
  viewerUserId: string,
  userId: string,
  input: { fy?: unknown; part?: unknown; file?: Form16File },
  now = new Date(),
) {
  await ensureIndexes();
  const org = await payrollViewerOrgFor(viewerUserId, userId, 'manage Form 16');
  const fy = endedFy(input.fy, now);
  const part = partOf(input.part);
  if (!input.file) throw new EmployeePayrollError(400, 'Attach the Form 16 PDF');
  return store(org, userId, fy, part, input.file, viewerUserId, now);
}

const PAN_IN_NAME = /(?:^|[^A-Z0-9])([A-Z]{5}[0-9]{4}[A-Z])(?=[^A-Z0-9]|$)/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The part a file name says: "…_PartA.pdf", "Part-B", "Part B"; otherwise combined. */
function partInName(name: string): Form16Part {
  const upper = name.toUpperCase();
  const a = /PART[\s_-]*A(?![A-Z])/.test(upper);
  const b = /PART[\s_-]*B(?![A-Z])/.test(upper);
  return a && !b ? 'A' : b && !a ? 'B' : 'combined';
}

/**
 * A batch of PDFs for one FY, each matched to a person by the PAN in its
 * name (against their payment details) or else by their employee ID, as a
 * whole word of the name. A file that matches nobody, or more than one
 * person, is listed back and not stored.
 */
export async function bulkUploadForm16ForHr(
  viewerUserId: string,
  input: { fy?: unknown; part?: unknown; files?: Form16File[] },
  now = new Date(),
) {
  await ensureIndexes();
  const org = await viewer(viewerUserId);
  const fy = endedFy(input.fy, now);
  const forced = input.part === undefined || input.part === '' ? null : partOf(input.part);
  const files = input.files ?? [];
  if (files.length === 0) throw new EmployeePayrollError(400, 'Attach the Form 16 PDFs');
  if (files.length > FORM16_MAX_BULK_FILES) throw new EmployeePayrollError(400, `Send at most ${FORM16_MAX_BULK_FILES} files at a time`);

  const people = await users().find({ org }, { projection: { _id: 0, userId: 1, name: 1, employeeId: 1 } }).toArray();
  const person = new Map(people.map((p) => [p.userId, p]));
  const withIds = people.filter((p) => typeof p.employeeId === 'string' && p.employeeId.trim() !== '');
  const canReadPan = fieldKeyConfigured();
  const uploaded: Array<{ fileName: string; userId: string; name: string; employeeId: string | null; matchedBy: 'pan' | 'employeeId'; document: ReturnType<typeof documentView> }> = [];
  const unmatched: Array<{ fileName: string; reason: string }> = [];
  const seen = new Set<string>();

  for (const file of files) {
    const fileName = file.originalname || 'file';
    const base = fileName.replace(/\.pdf$/i, '').toUpperCase();
    let matches: string[] = [];
    let matchedBy: 'pan' | 'employeeId' = 'pan';
    const pansInName = [...base.matchAll(PAN_IN_NAME)].map((m) => m[1]);
    if (pansInName.length > 0 && canReadPan) {
      const candidates = await employeePaymentDetails().find(
        { org, panLast4: { $in: pansInName.map((p) => p.slice(-4)) } },
        { projection: { _id: 0, userId: 1, pan: 1 } },
      ).toArray();
      for (const c of candidates) {
        let pan = '';
        try {
          pan = c.pan ? decryptField(c.pan).toUpperCase() : '';
        } catch {
          continue; // saved under another key: reads as masked, cannot match
        }
        if (pansInName.includes(pan) && person.has(c.userId)) matches.push(c.userId);
      }
    }
    // A file named by PAN is matched by PAN only: falling back to employee IDs could land another
    // person's Form 16 on someone whose ID happens to appear in the name (a year's digits, say).
    if (matches.length === 0 && pansInName.length === 0) {
      matchedBy = 'employeeId';
      // Years (2026-27, AY 2027-28) are not employee IDs.
      const named = base.replace(/\b\d{4}-\d{2,4}\b/g, ' ');
      matches = withIds
        .filter((p) => new RegExp(`(?:^|[^A-Z0-9])${escape(p.employeeId!.trim().toUpperCase())}(?=[^A-Z0-9]|$)`).test(named))
        .map((p) => p.userId);
    }
    matches = [...new Set(matches)];
    if (matches.length === 0) {
      unmatched.push({
        fileName,
        reason: pansInName.length > 0 && !canReadPan
          ? 'PANs can\'t be read on this server; name the file by employee ID'
          : pansInName.length > 0
            ? 'No employee has this PAN saved in Bank & PAN: save their PAN, or name the file by employee ID'
            : 'No employee with this PAN or employee ID',
      });
      continue;
    }
    if (matches.length > 1) {
      unmatched.push({ fileName, reason: `Matches ${matches.length} employees: ${matches.map((id) => person.get(id)?.name ?? id).join(', ')}` });
      continue;
    }
    const userId = matches[0];
    const part = forced ?? partInName(fileName);
    const key = `${userId}|${part}`;
    if (seen.has(key)) {
      unmatched.push({ fileName, reason: `Another file in this batch is already ${person.get(userId)?.name ?? userId}'s ${part === 'combined' ? 'Form 16' : `Part ${part}`}` });
      continue;
    }
    seen.add(key);
    try {
      const document = await store(org, userId, fy, part, file, viewerUserId, now);
      const p = person.get(userId)!;
      uploaded.push({ fileName, userId, name: p.name ?? userId, employeeId: p.employeeId ?? null, matchedBy, document });
    } catch (error) {
      if (!(error instanceof EmployeePayrollError) || error.statusCode === 503) throw error;
      unmatched.push({ fileName, reason: error.message });
    }
  }
  return { fy, uploaded, unmatched };
}

async function hrDocument(org: string, documentId: string): Promise<StoredForm16> {
  if (!ObjectId.isValid(documentId)) throw new EmployeePayrollError(404, 'Form 16 not found');
  const doc = (await form16Documents().findOne({ _id: new ObjectId(documentId), org })) as StoredForm16 | null;
  if (!doc) throw new EmployeePayrollError(404, 'Form 16 not found');
  return doc;
}

export async function form16FileForHr(viewerUserId: string, documentId: string) {
  const org = await viewer(viewerUserId);
  const doc = await hrDocument(org, documentId);
  return { url: await storage.url(doc.objectKey, doc.fileName), fileName: doc.fileName };
}

export async function deleteForm16ForHr(viewerUserId: string, documentId: string) {
  const org = await viewer(viewerUserId);
  const doc = await hrDocument(org, documentId);
  await form16Documents().deleteOne({ _id: doc._id, org });
  await storage.remove(doc.objectKey).catch(() => undefined);
  return { removed: documentView(doc) };
}
