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
import { journeys, letters, letterTemplates, offers } from '../config/db';
import { hasAllDashboardTabs, requireDashboardAccess, requireDashboardTabs } from '../middleware/admin.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { AdminError } from '../services/admin.service';
import { journeyDocumentsView, reviewDocument } from '../services/lifecycle/documents';
import { lifecycleEnabled } from '../services/lifecycle/emails';
import { contentDisposition, fileForOrg, LifecycleOfferError, readFileBytes } from '../services/lifecycle/files';
import {
  createLetter, createLetterTemplate, listLetters, listLetterTemplates, mergeValues, sendLetter, updateLetterTemplate, uploadLetterPdf,
} from '../services/lifecycle/letters';
import {
  createOffer, decideDateRequest, declineOffer, finaliseOffer, type HrActor, markJoined, markNotJoining, offerView, reopenOffer, reviseOffer,
  sendOffer, uploadOfferPdf,
} from '../services/lifecycle/offers';
import { logger } from '../utils/logger';

type DashUser = { userId: string; name: string; org?: string; dashboardAdmin?: boolean; dashboardTabs?: string[] };

const OFFER_TABS = ['onboarding', 'lifecycle_documents'];
const LETTER_TABS = ['lifecycle_documents', 'onboarding', 'offboarding'];
const FILE_TABS = ['onboarding', 'lifecycle_documents', 'offboarding'];
/** Tabs that carry pay: the offer's CTC shows only with one of these (or every tab). */
const PAY_TABS = ['payruns', 'salarydetails', 'lifecycle_documents'];

const userOf = (req: Request) => req.auth!.user as unknown as DashUser;
export function actorOf(req: Request): HrActor {
  const user = userOf(req);
  return {
    userId: user.userId, name: user.name, org: user.org ?? '',
    seesPay: hasAllDashboardTabs(user) || (user.dashboardTabs ?? []).some((t) => PAY_TABS.includes(t)),
  };
}

export function sendLifecycleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof LifecycleOfferError || error instanceof AdminError) {
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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } }).single('file');
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
r.get('/offers/:journeyId', ...guard(OFFER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  if (!(await journeys().findOne({ id: param(req, 'journeyId'), org: hr.org }, { projection: { _id: 1 } }))) throw new LifecycleOfferError(404, 'Joiner not found');
  return { offer: await offerView(param(req, 'journeyId'), { hidePay: !hr.seesPay }) };
}));
r.put('/offers/:journeyId', ...guard(OFFER_TABS), handle(async (req) => ({ offer: await reviseOffer(actorOf(req), param(req, 'journeyId'), body(req).fields) })));
r.post('/offers/:journeyId/pdf', ...guard(OFFER_TABS), oneFile, handle(async (req) => ({ offer: await uploadOfferPdf(actorOf(req), param(req, 'journeyId'), req.file) })));
r.post('/offers/:journeyId/send', ...guard(OFFER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  const offer = await sendOffer(hr, param(req, 'journeyId'), body(req));
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
  return { documents: await journeyDocumentsView(param(req, 'id')) };
}));
r.post('/documents/:id/review', ...guard(OFFER_TABS), handle(async (req) => ({ document: await reviewDocument(actorOf(req), param(req, 'id'), body(req)) })));
r.get('/files/:id', ...guard(FILE_TABS), handle(async (req, res) => {
  const hr = actorOf(req);
  const file = await fileForOrg(hr.org, param(req, 'id'));
  // An offer or appointment letter PDF states the CTC.
  if (!hr.seesPay && (
    await offers().findOne({ org: hr.org, 'versions.pdfFileId': file.id }, { projection: { _id: 1 } })
    || await letters().findOne({ org: hr.org, kind: { $in: ['offer', 'appointment'] }, $or: [{ pdfFileId: file.id }, { signedPdfFileId: file.id }] }, { projection: { _id: 1 } })
  )) throw new LifecycleOfferError(403, 'This file needs access to pay');
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
  return mergeValues(hr.org, { kind: req.query.kind, journeyId: req.query.journeyId, userId: req.query.userId }, hr.name);
}));
r.post('/letters', ...guard(LETTER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  payCheck(hr, body(req).kind);
  return { letter: await createLetter(hr, body(req)) };
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
  return { letter: await sendLetter(hr, param(req, 'id'), body(req)) };
}));
r.get('/letters', ...guard(LETTER_TABS), handle(async (req) => {
  const hr = actorOf(req);
  const rows = await listLetters(hr.org, req.query);
  return { letters: hr.seesPay ? rows : rows.filter((l) => !PAY_LETTERS.has(l.kind)) };
}));
