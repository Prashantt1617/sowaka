/**
 * The candidate's documents (P8/W8, H1b review). The list comes from the
 * journey's template snapshot (the upload task's `documents`); PDF, JPG or PNG
 * up to 10 MB, checked by their bytes. HR approves each one or sends it back
 * with a note; the last approval moves the journey to `docs_approved` and
 * unlocks the appointment letter and NDA (unless the template signs them on
 * Day 1 in the app).
 */
import { randomUUID } from 'node:crypto';
import { candidateDocuments, journeys, lifecycleFiles } from '../../config/db';
import type { CandidateDocument, Journey } from '../../models/lifecycle.model';
import { companyDisplayName, companyOf, mails, sendLifecycleEmail } from './emails';
import { completeTask, reopenTask, setJourneyStatus, setTaskInReview } from './engine';
import { checkUpload, fileMeta, LifecycleOfferError, removeFile, storeFile } from './files';
import { unlockJourneyLetters } from './letters';

export type CandidateDocumentView = CandidateDocument & { files: Array<{ id: string; name: string; contentType: string; size: number }> };

/** When the template names no list: T1's "ID, address proof, education, last payslip". */
export const DEFAULT_DOCUMENTS: Array<{ key: string; label: string; required: boolean }> = [
  { key: 'id_proof', label: 'ID proof (PAN and Aadhaar)', required: true },
  { key: 'address_proof', label: 'Address proof', required: true },
  { key: 'education', label: 'Education (highest degree)', required: true },
  { key: 'last_payslip', label: 'Last payslip', required: false },
];
const MAX_FILES_PER_DOCUMENT = 4;

export function documentListFor(journey: Pick<Journey, 'templateSnapshot'>): Array<{ key: string; label: string; required: boolean }> {
  const task = journey.templateSnapshot.tasks.find((t) => t.systemKey === 'upload_documents' && t.enabled !== false);
  const list = task?.documents?.filter((d) => d.key && d.label);
  return list?.length ? list : DEFAULT_DOCUMENTS;
}

/** The journey's document rows, made from its template's list the first time. */
export async function ensureJourneyDocuments(journey: Journey): Promise<CandidateDocument[]> {
  const existing = await candidateDocuments().find({ journeyId: journey.id }, { projection: { _id: 0 } }).toArray();
  if (existing.length) return existing;
  const rows: CandidateDocument[] = documentListFor(journey).map((d) => ({
    id: randomUUID(), org: journey.org, journeyId: journey.id, docKey: d.key, label: d.label, required: d.required, fileIds: [], status: 'todo',
  }));
  if (rows.length) await candidateDocuments().insertMany(rows.map((r) => ({ ...r })));
  return rows;
}

/** Sent back first, then to do, with HR, approved; template order within each. */
const ORDER: Record<CandidateDocument['status'], number> = { sent_back: 0, todo: 1, in_review: 2, approved: 3 };

/** ENGINE-API read function (the HR side panel), also the portal's list. */
export async function journeyDocumentsView(journeyId: string): Promise<CandidateDocumentView[]> {
  const journey = await journeys().findOne({ id: journeyId });
  if (journey) await ensureJourneyDocuments(journey);
  const docs = await candidateDocuments().find({ journeyId }, { projection: { _id: 0 } }).toArray();
  const files = await lifecycleFiles().find({ id: { $in: docs.flatMap((d) => d.fileIds) } }, { projection: { _id: 0 } }).toArray();
  const order = journey ? documentListFor(journey).map((d) => d.key) : [];
  return docs
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || order.indexOf(a.docKey) - order.indexOf(b.docKey))
    .map((d) => ({ ...d, files: d.fileIds.map((id) => files.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => Boolean(f)).map(fileMeta) }));
}

export async function allRequiredApproved(journeyId: string): Promise<boolean> {
  const docs = await candidateDocuments().find({ journeyId }, { projection: { _id: 0, required: 1, status: 1 } }).toArray();
  return docs.length > 0 && docs.filter((d) => d.required).every((d) => d.status === 'approved');
}

const UPLOAD_OPEN = new Set(['accepted', 'finalised', 'active', 'docs_approved']);

export async function uploadDocumentFiles(journey: Journey, docId: string, files: Array<{ originalname?: string; buffer: Buffer }>, now = new Date()): Promise<CandidateDocumentView[]> {
  if (!UPLOAD_OPEN.has(String(journey.status))) throw new LifecycleOfferError(409, 'Documents can no longer be changed here');
  if (!files.length) throw new LifecycleOfferError(400, 'Choose a file to upload');
  const doc = await candidateDocuments().findOne({ id: docId, journeyId: journey.id });
  if (!doc) throw new LifecycleOfferError(404, 'Document not found');
  if (doc.status === 'approved') throw new LifecycleOfferError(409, 'HR has already approved this document');
  if (doc.fileIds.length + files.length > MAX_FILES_PER_DOCUMENT) throw new LifecycleOfferError(400, `Up to ${MAX_FILES_PER_DOCUMENT} files per document`);
  // Every file checked before any is stored: a bad second file must not leave the first behind.
  const types = files.map((f) => checkUpload(f.buffer));
  const stored = [];
  for (const [i, f] of files.entries()) {
    stored.push(await storeFile(journey.org, journey.id, { name: f.originalname || `${doc.label}`, contentType: types[i], bytes: f.buffer }, 'candidate'));
  }
  await candidateDocuments().updateOne({ id: doc.id }, { $push: { fileIds: { $each: stored.map((s) => s.id) } }, $set: { status: 'in_review', uploadedAt: now } });
  await journeys().updateOne({ id: journey.id }, { $set: { lastActivityAt: now } });
  const docs = await candidateDocuments().find({ journeyId: journey.id }).toArray();
  if (docs.filter((d) => d.required).every((d) => d.status === 'in_review' || d.status === 'approved')) await setTaskInReview(journey.id, 'upload_documents');
  return journeyDocumentsView(journey.id);
}

export async function removeDocumentFile(journey: Journey, docId: string, fileId: string): Promise<CandidateDocumentView[]> {
  if (!UPLOAD_OPEN.has(String(journey.status))) throw new LifecycleOfferError(409, 'Documents can no longer be changed here');
  const doc = await candidateDocuments().findOne({ id: docId, journeyId: journey.id });
  if (!doc || !doc.fileIds.includes(fileId)) throw new LifecycleOfferError(404, 'File not found');
  if (doc.status === 'approved') throw new LifecycleOfferError(409, 'HR has already approved this document');
  const left = doc.fileIds.filter((id) => id !== fileId);
  await candidateDocuments().updateOne({ id: doc.id }, { $set: { fileIds: left, ...(left.length ? {} : { status: doc.hrNote ? 'sent_back' : 'todo' }) } });
  await removeFile(fileId);
  return journeyDocumentsView(journey.id);
}

/** HR approves, or sends back with a note (the candidate is emailed and it leads their Up next). */
export async function reviewDocument(
  hr: { org: string; userId: string; name: string },
  docId: string,
  input: { decision?: unknown; note?: unknown },
  now = new Date(),
): Promise<CandidateDocumentView> {
  const doc = await candidateDocuments().findOne({ id: docId, org: hr.org });
  if (!doc) throw new LifecycleOfferError(404, 'Document not found');
  const journey = await journeys().findOne({ id: doc.journeyId, org: hr.org });
  if (!journey) throw new LifecycleOfferError(404, 'Document not found');
  const decision = String(input.decision ?? '');
  const note = String(input.note ?? '').trim();
  if (decision !== 'approve' && decision !== 'send_back') throw new LifecycleOfferError(400, 'Decision must be approve or send_back');
  if (doc.status !== 'in_review' && !(decision === 'send_back' && doc.status === 'approved')) throw new LifecycleOfferError(409, 'Only an uploaded document can be reviewed');
  if (decision === 'send_back') {
    if (!note) throw new LifecycleOfferError(400, 'Say what needs fixing');
    if (note.length > 1000) throw new LifecycleOfferError(400, 'The note is too long');
    await candidateDocuments().updateOne({ id: doc.id }, { $set: { status: 'sent_back', hrNote: note, reviewedAt: now, reviewedByName: hr.name } });
    await reopenTask(journey.id, 'upload_documents', note, true);
    if (journey.candidate?.personalEmail) {
      const company = await companyOf(journey.org);
      await sendLifecycleEmail(journey.org, journey.candidate.personalEmail, `Please upload your ${doc.label} again`,
        mails.documentSentBack(companyDisplayName(company, journey.org), journey.candidate.name, doc.label, note));
    }
  } else {
    await candidateDocuments().updateOne({ id: doc.id }, { $set: { status: 'approved', reviewedAt: now, reviewedByName: hr.name }, $unset: { hrNote: '' } });
    if (await allRequiredApproved(journey.id)) await onAllApproved(journey, hr);
  }
  return (await journeyDocumentsView(journey.id)).find((d) => d.id === doc.id)!;
}

async function onAllApproved(journey: Journey, hr: { userId: string; name: string }) {
  await completeTask(journey.id, 'upload_documents', { name: journey.candidate?.name });
  await completeTask(journey.id, 'review_documents', { userId: hr.userId, name: hr.name });
  // A revised offer waiting for acceptance keeps its status; finalising it again restores docs_approved.
  if (['finalised', 'active'].includes(String(journey.status))) await setJourneyStatus(journey.id, 'docs_approved');
  await unlockJourneyLetters(journey.id);
}
