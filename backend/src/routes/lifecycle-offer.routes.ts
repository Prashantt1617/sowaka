/**
 * Dashboard › Employee lifecycle: offers, documents, letters (CONTRACT
 * "Dashboard — offers, documents, letters"). Mounted at `/admin/lifecycle`
 * before the main /admin router; each route carries its own guard (requireAuth,
 * dashboard access, tab rules, features.lifecycle) so the paths it does not
 * own fall through to the onboarding router untouched.
 *
 * Errors are `{ error }`. A company without features.lifecycle gets 404
 * `{ error: 'Not available' }`. CTC is only for people who may see pay.
 */
import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { candidateDocuments, journeys, letters, letterTemplates, offers } from '../config/db';
import { hasAllDashboardTabs, requireDashboardAccess, requireDashboardTabs } from '../middleware/admin.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { AdminError } from '../services/admin.service';
import { journeyDocumentsView, reviewDocument } from '../services/lifecycle/documents';
import { lifecycleEnabled } from '../services/lifecycle/emails';
import { contentDisposition, fileForOrg, LifecycleOfferError, readFileBytes, UTF8_FILE_NAMES, MULTER_FILE_LIMIT } from '../services/lifecycle/files';
import {
  createLetter, createLetterTemplate, letterWithoutPay, listLetters, listLetterTemplates, mergeValues, resolveAttachments, salaryBreakup, saveLetterDraft,
  sendConfirmationLetter, sendLetter, updateLetterTemplate, uploadLetterAttachment, uploadLetterPdf, valuesWithoutPay,
} from '../services/lifecycle/letters';
import { documentStatusOnly, lifecycleViewer } from '../services/lifecycle/board';
import {
  confirmOffer, createOffer, decideDateRequest, declineOffer, finaliseOffer, type HrActor, markJoined, markNotJoining, offerView, reopenOffer, reviseOffer,
  sendOffer, uploadOfferPdf,
} from '../services/lifecycle/offers';
import { logger } from '../utils/logger';

type DashUser = { userId: string; name: string; org?: string; dashboardAdmin?: boolean; dashboardTabs?: string[] };

const OFFER_TABS = ['onboarding', 'lifecycle_documents'];
const LETTER_TABS = ['lifecycle_documents', 'onboarding', 'offboarding'];
const FILE_TABS = ['onboarding', 'lifecycle_documents', 'offboarding'];
const userOf = (req: Request) => req.auth!.user as unknown as DashUser;
/**
 * The one "may see pay" rule (board.ts `lifecycleViewer`, as the dashboard's
 * `canSeePay` decides it): a dashboard admin, someone never limited, or a
 * holder of Payroll runs / Salary details. Documents is not a pay tab.
 */
export function actorOf(req: Request): HrActor {
  const user = userOf(req);
  return { userId: user.userId, name: user.name, org: user.org ?? '', seesPay: lifecycleViewer(user).seesPay };
}
/** HR (admin, never limited, or People › Employees) sees candidates' documents; the onboarding tab alone sees status only. */
const seesDocuments = (req: Request) => lifecycleViewer(userOf(req)).seesDocuments;

export function sendLifecycleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof LifecycleOfferError) {
    res.status(error.statusCode).json({ ...(error.details ?? {}), error: error.message });
    return;
  }
  if (error instanceof AdminError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  if (error instanceof multer.MulterError) {
    res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Files must be 10 MB or smaller' : 'The upload is invalid' });
    return;
  }
  next(error);
}

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (error) {
    sendLifecycleError(error, res, next);
  }
};

/** features.lifecycle, then the lifecycle tab(s) this route needs (admins and unrestricted people pass). */
const gate = (tabs: string[]) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = userOf(req);
    if (!(await lifecycleEnabled(user.org))) { res.status(404).json({ error: 'Not available' }); return; }
    if (!hasAllDashboardTabs(user) && !(user.dashboardTabs ?? []).some((t) => tabs.includes(t))) {
      logger.warn('Lifecycle tab access denied', { path: req.originalUrl.split('?')[0], userId: user.userId });
      res.status(403).json({ error: "You don't have access to this part of the dashboard" });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MULTER_FILE_LIMIT, files: 1 }, ...UTF8_FILE_NAMES }).single('file');
const oneFile = (req: Request, res: Response, next: NextFunction) => upload(req, res, (error) => (error ? sendLifecycleError(error, res, next) : next()));

const guard = (tabs: string[]) => [requireAuth, requireDashboardAccess, requireDashboardTabs, gate(tabs)];
const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;
const param = (req: Request, name: string) => String(req.params[name] ?? '');

export const lifecycleOfferRouter = Router();
const r = lifecycleOfferRouter;

// ─── Offers ─────────────────────────────────────────────────────────────────
r.post('/offers', ...guard(OFFER_TABS), handle(async (req) => {
  const b = body(req);
  return createOffer(actorOf(req), { candidate: b.candidate as never, fields: b.fields, templateId: b.templateId });
}));
/** Add user › Confirm new user: the offer was given outside the app; the joiner is created confirmed (finalised), no offer email. */
r.post('/offers/confirm', ...guard(OFFER_TABS), handle(async (req) => {
  const b = body(req);
  return confirmOffer(actorOf(req), { candidate: b.candidate as never, fields: b.fields, templateId: b.templateId, emailPortal: b.emailPortal });
}));
r.get('/offers/:journeyId', ...guard(OFFER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  if (!(await journeys().findOne({ id: param(req, 'journeyId'), org: hr.org }, { projection: { _id: 1 } }))) throw new LifecycleOfferError(404, 'Joiner not found');
  return { offer: await offerView(param(req, 'journeyId'), { hidePay: !hr.seesPay }) };
}));
r.put('/offers/:journeyId', ...guard(OFFER_TABS), handle(async (req) => ({ offer: await reviseOffer(actorOf(req), param(req, 'journeyId'), body(req).fields) })));
r.post('/offers/:journeyId/pdf', ...guard(OFFER_TABS), oneFile, handle(async (req) => ({ offer: await uploadOfferPdf(actorOf(req), param(req, 'journeyId'), req.file) })));
r.post('/offers/:journeyId/send', ...guard(OFFER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  const b = body(req);
  const extras = await resolveAttachments(hr, b.attachments);
  const offer = await sendOffer(hr, param(req, 'journeyId'), { subject: b.subject, body: b.body, cc: b.cc, withPortalLink: b.withPortalLink, attachments: extras.files });
  // A draft of this email saved on an offer letter (Documents › Save draft) is now sent.
  const now = new Date();
  await letters().updateMany({ org: hr.org, journeyId: param(req, 'journeyId'), kind: 'offer', 'email.sentAt': { $exists: false } }, { $set: {
    'email.sentAt': now, 'email.to': (await journeys().findOne({ id: param(req, 'journeyId') }, { projection: { _id: 0, candidate: 1 } }))?.candidate?.personalEmail ?? '',
    'email.subject': String(b.subject ?? ''), 'email.body': String(b.body ?? ''), 'email.withPortalLink': b.withPortalLink !== false, 'email.attachments': extras.list,
    ...(offer.pdfFileId ? { pdfFileId: offer.pdfFileId } : {}),
  } });
  return { offer: hr.seesPay ? offer : await offerView(param(req, 'journeyId'), { hidePay: true }) };
}));
r.post('/offers/:journeyId/finalise', ...guard(OFFER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  await finaliseOffer(hr, param(req, 'journeyId'));
  return { offer: await offerView(param(req, 'journeyId'), { hidePay: !hr.seesPay }) };
}));
r.post('/offers/:journeyId/decline', ...guard(OFFER_TABS), handle(async (req) => ({ journey: await declineOffer(actorOf(req), param(req, 'journeyId'), body(req).note) })));
r.post('/offers/:journeyId/reopen', ...guard(OFFER_TABS), handle(async (req) => ({ journey: await reopenOffer(actorOf(req), param(req, 'journeyId')) })));
r.post('/offers/:journeyId/not-joining', ...guard(OFFER_TABS), handle(async (req) => ({ journey: await markNotJoining(actorOf(req), param(req, 'journeyId'), body(req).note) })));
r.post('/offers/:journeyId/mark-joined', ...guard(OFFER_TABS), handle(async (req) => markJoined(actorOf(req), param(req, 'journeyId'), body(req))));

// ─── Date-change requests ───────────────────────────────────────────────────
r.post('/date-requests/:id', ...guard(OFFER_TABS), handle(async (req) => ({ request: await decideDateRequest(actorOf(req), param(req, 'id'), body(req)) })));

// ─── Documents and files ────────────────────────────────────────────────────
r.get('/journeys/:id/documents', ...guard(OFFER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  if (!(await journeys().findOne({ id: param(req, 'id'), org: hr.org }, { projection: { _id: 1 } }))) throw new LifecycleOfferError(404, 'Joiner not found');
  const documents = await journeyDocumentsView(param(req, 'id'));
  return { documents: seesDocuments(req) ? documents : documents.map(documentStatusOnly) };
}));
r.post('/documents/:id/review', ...guard(OFFER_TABS), handle(async (req) => {
  if (!seesDocuments(req)) throw new LifecycleOfferError(403, 'Only HR reviews candidates’ documents');
  return { document: await reviewDocument(actorOf(req), param(req, 'id'), body(req)) };
}));
r.get('/files/:id', ...guard([...FILE_TABS, 'employees']), handle(async (req, res) => {
  const hr = actorOf(req);
  const file = await fileForOrg(hr.org, param(req, 'id'));
  // People › Employees alone (HR on an employee's profile) opens candidates' documents only, nothing else stored here.
  const user = userOf(req);
  if (!hasAllDashboardTabs(user) && !(user.dashboardTabs ?? []).some((t) => FILE_TABS.includes(t))
    && !(await candidateDocuments().findOne({ org: hr.org, fileIds: file.id }, { projection: { _id: 1 } }))) {
    throw new LifecycleOfferError(403, "You don't have access to this file");
  }
  // An offer or appointment letter PDF states the CTC.
  if (!hr.seesPay && (
    await offers().findOne({ org: hr.org, 'versions.pdfFileId': file.id }, { projection: { _id: 1 } })
    || await letters().findOne({ org: hr.org, kind: { $in: ['offer', 'appointment'] }, $or: [{ pdfFileId: file.id }, { signedPdfFileId: file.id }] }, { projection: { _id: 1 } })
    || await letters().findOne({ org: hr.org, 'email.attachments': { $elemMatch: { fileId: file.id, kind: 'salary_breakup' } } }, { projection: { _id: 1 } })
  )) throw new LifecycleOfferError(403, 'This file needs access to pay');
  // Candidates' documents and ID proofs are HR's: the onboarding tab alone sees their status, never the files.
  if (!seesDocuments(req) && await candidateDocuments().findOne({ org: hr.org, fileIds: file.id }, { projection: { _id: 1 } })) {
    throw new LifecycleOfferError(403, 'Only HR can open candidates’ documents');
  }
  const bytes = await readFileBytes(file);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', contentDisposition(file.name, req.query.download === '1'));
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(bytes);
  return undefined;
}));

// ─── Letter templates and letters ───────────────────────────────────────────
r.get('/letter-templates', ...guard(LETTER_TABS), handle(async (req) => ({ templates: await listLetterTemplates(actorOf(req).org, req.query.kind) })));
r.get('/letter-templates/:id', ...guard(LETTER_TABS), handle(async (req) => {
  const template = await letterTemplates().findOne({ id: param(req, 'id'), org: actorOf(req).org }, { projection: { _id: 0 } });
  if (!template) throw new LifecycleOfferError(404, 'Template not found');
  return { template };
}));
r.post('/letter-templates', ...guard(LETTER_TABS), handle(async (req) => ({ template: await createLetterTemplate(actorOf(req).org, body(req)) })));
r.put('/letter-templates/:id', ...guard(LETTER_TABS), handle(async (req) => ({ template: await updateLetterTemplate(actorOf(req).org, param(req, 'id'), body(req)) })));

/** Offer and appointment letters carry the CTC: only for people who may see pay. */
const PAY_LETTERS = new Set(['offer', 'appointment']);
const payCheck = (hr: HrActor, kind: unknown) => {
  if (!hr.seesPay && PAY_LETTERS.has(String(kind))) throw new LifecycleOfferError(403, 'This letter needs access to pay');
};
r.get('/letters/merge', ...guard(LETTER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  payCheck(hr, req.query.kind);
  const merged = await mergeValues(hr.org, { kind: req.query.kind, journeyId: req.query.journeyId, userId: req.query.userId }, hr.name);
  // Every kind's values carry the offer's CTC: never to someone without pay access.
  return hr.seesPay ? merged : { values: valuesWithoutPay(merged.values), missing: merged.missing };
}));
/** Annexure A: the offer's CTC split by a salary template (pay only). */
r.get('/letters/salary-breakup', ...guard(LETTER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  if (!hr.seesPay) throw new LifecycleOfferError(403, 'The salary breakup needs access to pay');
  return salaryBreakup(hr.org, String(req.query.journeyId ?? ''), req.query.template);
}));
/** An extra file for a letter's email (salary breakup, joining checklist, policies). */
r.post('/letters/attachments', ...guard(LETTER_TABS), oneFile, handle(async (req) => uploadLetterAttachment(actorOf(req), body(req), req.file)));
r.post('/letters', ...guard(LETTER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  payCheck(hr, body(req).kind);
  const letter = await createLetter(hr, body(req));
  return { letter: hr.seesPay ? letter : letterWithoutPay(letter) };
}));
/** The letter's kind, for the pay check on its own routes (another org's letter is 404 in the service). */
const letterPayCheck = async (hr: HrActor, id: string) => {
  const letter = await letters().findOne({ id, org: hr.org }, { projection: { _id: 0, kind: 1 } });
  if (letter) payCheck(hr, letter.kind);
};
r.post('/letters/:id/pdf', ...guard(LETTER_TABS), oneFile, handle(async (req) => {
  const hr = actorOf(req);
  await letterPayCheck(hr, param(req, 'id'));
  return { letter: await uploadLetterPdf(hr, param(req, 'id'), req.file) };
}));
r.post('/letters/:id/send', ...guard(LETTER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  await letterPayCheck(hr, param(req, 'id'));
  const letter = await sendLetter(hr, param(req, 'id'), body(req));
  return { letter: hr.seesPay ? letter : letterWithoutPay(letter) };
}));
/** The joiner panel's Generate confirmation letter / Resend: the letter to the employee's work email (their account's). */
r.post('/letters/:id/send-confirmation', ...guard(LETTER_TABS), handle(async (req) => sendConfirmationLetter(actorOf(req), param(req, 'id'))));
/** H3c's Save draft: the email kept on the letter until it is sent. */
r.put('/letters/:id/draft', ...guard(LETTER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  await letterPayCheck(hr, param(req, 'id'));
  const letter = await saveLetterDraft(hr, param(req, 'id'), body(req));
  return { letter: hr.seesPay ? letter : letterWithoutPay(letter) };
}));
r.get('/letters', ...guard(LETTER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  const rows = await listLetters(hr.org, req.query);
  return { letters: hr.seesPay ? rows : rows.filter((l) => !PAY_LETTERS.has(l.kind)).map(letterWithoutPay) };
}));
