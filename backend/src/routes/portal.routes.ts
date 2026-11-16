/**
 * The pre-boarding portal's API (`/portal/*`, CONTRACT "Portal"). No employee
 * session: the offer link carries its own token, and everything after sign-in
 * a portal JWT (`aud: 'portal'`) sent as `Authorization: Bearer`. App session
 * tokens are refused here, and portal tokens by the app's `requireAuth`.
 * Sign-in, forgot-password and the offer link are rate-limited per IP.
 */
import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { journeys } from '../config/db';
import type { Journey } from '../models/lifecycle.model';
import { removeDocumentFile, uploadDocumentFiles } from '../services/lifecycle/documents';
import { contentDisposition, fileForJourney, readFileBytes } from '../services/lifecycle/files';
import { letterPdfForPortal, openLetter, portalLetters, signLetter } from '../services/lifecycle/letters';
import {
  acceptOffer, acceptOfferForJourney, createDateRequest, offerLinkPdf, openOfferLink, portalOfferForJourney, portalOfferPdfForJourney,
} from '../services/lifecycle/offers';
import {
  aboutYouView, markMeetSeen, meetItems, portalDocuments, portalHome, portalPass, portalPassIcs, saveAboutYou,
} from '../services/lifecycle/portal';
import { CLOSED_STATUSES, forgotPassword, journeyForPortalToken, resetPassword, signIn } from '../services/lifecycle/portalAuth';
import { sendLifecycleError } from './lifecycle-offer.routes';

/**
 * The caller's address. Behind the proxy every request arrives from loopback
 * with the client in X-Forwarded-For (the proxy appends it last), so the last
 * entry is the one that cannot be forged; a direct caller is its own address.
 */
export function clientIp(req: Request): string {
  const remote = (req.socket?.remoteAddress ?? req.ip ?? '').replace(/^::ffff:/, '');
  const forwarded = String(req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const proxied = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/.test(remote);
  return (proxied && forwarded.length ? forwarded[forwarded.length - 1] : remote) || 'unknown';
}

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (error) {
    sendLifecycleError(error, res, next);
  }
};

const journeyOf = (res: Response) => res.locals.portalJourney as Journey;

/** A signed-in candidate. Every call counts as activity (the Quiet flag), at most once a minute. */
async function requirePortal(req: Request, res: Response, next: NextFunction) {
  try {
    const journey = await journeyForPortalToken(req.header('authorization'));
    res.locals.portalJourney = journey;
    const now = new Date();
    if (!CLOSED_STATUSES.has(String(journey.status)) && (!journey.lastActivityAt || now.getTime() - journey.lastActivityAt.getTime() > 60_000)) {
      await journeys().updateOne({ id: journey.id }, { $set: { lastActivityAt: now } });
      journey.lastActivityAt = now;
    }
    next();
  } catch (error) {
    sendLifecycleError(error, res, next);
  }
}

const docsUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 4 } }).array('files', 4);
const files = (req: Request, res: Response, next: NextFunction) => docsUpload(req, res, (error) => (error ? sendLifecycleError(error, res, next) : next()));
const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;
const param = (req: Request, name: string) => String(req.params[name] ?? '');
const sendPdf = (res: Response, file: { name: string; bytes: Buffer }, download: boolean) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(file.name, download));
  res.send(file.bytes);
  return undefined;
};

export const portalRouter = Router();
const r = portalRouter;

// ─── The offer link (no login) ──────────────────────────────────────────────
r.get('/offer/:token', handle(async (req) => openOfferLink(param(req, 'token'), clientIp(req))));
r.get('/offer/:token/pdf', handle(async (req, res) => sendPdf(res, await offerLinkPdf(param(req, 'token'), clientIp(req)), req.query.download === '1')));
r.post('/offer/:token/accept', handle(async (req) => acceptOffer(param(req, 'token'), { ip: clientIp(req), userAgent: req.header('user-agent') })));

// ─── Sign-in ────────────────────────────────────────────────────────────────
r.post('/auth/sign-in', handle(async (req) => signIn(body(req).email, body(req).password, clientIp(req))));
r.post('/auth/forgot', handle(async (req) => forgotPassword(body(req).email, clientIp(req))));
r.post('/auth/reset', handle(async (req) => resetPassword(body(req).token, body(req).password)));

// ─── Signed in ──────────────────────────────────────────────────────────────
r.get('/me', requirePortal, handle(async (_req, res) => portalHome(journeyOf(res))));
r.post('/activity', requirePortal, handle(async () => ({ ok: true })));
/** The signed-in candidate's current offer (a revised one is reviewed from home): latest version only, as on the link. */
r.get('/me/offer', requirePortal, handle(async (_req, res) => portalOfferForJourney(journeyOf(res))));
r.get('/me/offer/pdf', requirePortal, handle(async (req, res) => sendPdf(res, await portalOfferPdfForJourney(journeyOf(res)), req.query.download === '1')));
r.post('/me/offer/accept', requirePortal, handle(async (req, res) => acceptOfferForJourney(journeyOf(res), { ip: clientIp(req), userAgent: req.header('user-agent') })));

r.get('/documents', requirePortal, handle(async (_req, res) => ({ documents: await portalDocuments(journeyOf(res)) })));
r.post('/documents/:id/upload', requirePortal, files, handle(async (req, res) => {
  await uploadDocumentFiles(journeyOf(res), param(req, 'id'), (req.files as Express.Multer.File[] | undefined) ?? []);
  return { documents: await portalDocuments(journeyOf(res)) };
}));
r.delete('/documents/:id/files/:fileId', requirePortal, handle(async (req, res) => {
  await removeDocumentFile(journeyOf(res), param(req, 'id'), param(req, 'fileId'));
  return { documents: await portalDocuments(journeyOf(res)) };
}));
/** The candidate's own files (their uploads, the manager's video note). */
r.get('/files/:id', requirePortal, handle(async (req, res) => {
  const file = await fileForJourney(journeyOf(res).id, param(req, 'id'));
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', contentDisposition(file.name, false));
  res.send(await readFileBytes(file));
  return undefined;
}));

r.get('/about', requirePortal, handle(async (_req, res) => aboutYouView(journeyOf(res))));
r.put('/about', requirePortal, handle(async (req, res) => saveAboutYou(journeyOf(res), body(req))));

r.get('/meet', requirePortal, handle(async (_req, res) => ({ items: await meetItems(journeyOf(res)) })));
r.post('/meet/seen', requirePortal, handle(async (req, res) => ({ items: await markMeetSeen(journeyOf(res), body(req).itemId) })));

r.get('/letters', requirePortal, handle(async (_req, res) => ({ letters: await portalLetters(journeyOf(res)) })));
r.post('/letters/:id/opened', requirePortal, handle(async (req, res) => ({ letters: await openLetter(journeyOf(res), param(req, 'id')) })));
r.post('/letters/:id/sign', requirePortal, handle(async (req, res) => ({
  letters: await signLetter(journeyOf(res), param(req, 'id'), body(req), { ip: clientIp(req), userAgent: req.header('user-agent') }),
})));
r.get('/letters/:id/pdf', requirePortal, handle(async (req, res) => sendPdf(res, await letterPdfForPortal(journeyOf(res), param(req, 'id')), req.query.download === '1')));

r.get('/pass', requirePortal, handle(async (_req, res) => portalPass(journeyOf(res))));
r.get('/pass.ics', requirePortal, handle(async (_req, res) => {
  const ics = await portalPassIcs(journeyOf(res));
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="day-1.ics"');
  res.send(ics);
  return undefined;
}));

r.post('/date-request', requirePortal, handle(async (req, res) => ({ request: await createDateRequest(journeyOf(res), body(req)) })));
