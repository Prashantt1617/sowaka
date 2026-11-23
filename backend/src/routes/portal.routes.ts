/**
 * The pre-boarding portal's API (`/portal/*`, CONTRACT "Portal"). No employee
 * session: the offer link carries its own token, and everything after sign-in
 * a portal JWT (`aud: 'portal'`) sent as `Authorization: Bearer`. App session
 * tokens are refused here, and portal tokens by the app's `requireAuth`.
 * Sign-in, forgot-password and the offer link are rate-limited per IP.
 */
import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { journeys, lifecycleFiles } from '../config/db';
import { journeyMayRead } from '../services/lifecycle/design';
import type { Journey } from '../models/lifecycle.model';
import { removeDocumentFile, uploadDocumentFiles } from '../services/lifecycle/documents';
import { companyDisplayName, companyOf, lifecycleEnabled, orgOfClientToken } from '../services/lifecycle/emails';
import { contentDisposition, fileForJourney, LifecycleOfferError, readFileBytes, UTF8_FILE_NAMES, MULTER_FILE_LIMIT } from '../services/lifecycle/files';
import { letterPdfForPortal, openLetter, portalLetters, signLetter } from '../services/lifecycle/letters';
import {
  acceptOffer, acceptOfferForJourney, createDateRequest, offerLinkPdf, openOfferLink, orgOfOfferToken, portalOfferForJourney, portalOfferPdfForJourney,
} from '../services/lifecycle/offers';
import {
  aboutYouView, markMeetSeen, meetItems, portalDocuments, portalHome, portalPassIcs, portalPassOrLocked, saveAboutYou,
  joiningDetails,
} from '../services/lifecycle/portal';
import { profileView, saveProfileSection, saveProfilePhoto } from '../services/lifecycle/profile';
import { CLOSED_STATUSES, forgotPassword, journeyForPortalToken, resetPassword, signIn, verifyMediaToken, requestSignInCode, signInWithCode } from '../services/lifecycle/portalAuth';
import { sendLifecycleError } from './lifecycle-offer.routes';
import { env } from '../config/env';

/**
 * The portal lives on each company's own address (<org>.getsowaka.com/onboarding). A request
 * from a company's address must be about that company: a Convrse offer opened under another
 * company's address is refused as if it did not exist. Shared addresses (join., go., www.)
 * and anything off the product domain carry no company and are not checked.
 */
const SHARED_LABELS = new Set(['join', 'go', 'www', 'app', 'api', 'care', 'admin']);
export function companyOfRequest(req: Request): string | null {
  const domain = env.dashboardDomain;
  if (!domain) return null;
  for (const raw of [req.header('origin'), req.header('referer')]) {
    if (!raw) continue;
    let host = '';
    try { host = new URL(raw).hostname.toLowerCase(); } catch { continue; }
    if (!host.endsWith(`.${domain}`)) return null;
    const label = host.slice(0, -(domain.length + 1));
    if (!/^[a-z0-9-]+$/.test(label) || SHARED_LABELS.has(label)) return null;
    return label;
  }
  return null;
}
function assertCompany(req: Request, org: string | null | undefined) {
  const label = companyOfRequest(req);
  if (label && org && label !== org) throw new LifecycleOfferError(404, 'This link is for another company. Open it from the email you were sent.');
}
const offerHost = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  assertCompany(req, await orgOfOfferToken(String(req.params.token ?? '')));
  return fn(req, res);
};

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
    assertCompany(req, journey.org);
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

const docsUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MULTER_FILE_LIMIT, files: 4 }, ...UTF8_FILE_NAMES }).array('files', 4);
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
r.get('/offer/:token', handle(offerHost(async (req) => openOfferLink(param(req, 'token'), clientIp(req)))));
r.get('/offer/:token/pdf', handle(offerHost(async (req, res) => sendPdf(res, await offerLinkPdf(param(req, 'token'), clientIp(req)), req.query.download === '1'))));
r.post('/offer/:token/accept', handle(offerHost(async (req) => acceptOffer(param(req, 'token'), { ip: clientIp(req), userAgent: req.header('user-agent') }))));

// ─── Sign-in ────────────────────────────────────────────────────────────────
r.post('/auth/sign-in', handle(async (req) => {
  const out = await signIn(body(req).email, body(req).password, clientIp(req));
  // Signed in under another company's address: refuse rather than hand over a session for the wrong portal.
  if (out && typeof out === 'object' && 'token' in out && typeof (out as { token: unknown }).token === 'string') {
    assertCompany(req, (await journeyForPortalToken(`Bearer ${(out as { token: string }).token}`)).org);
  }
  return out;
}));
// Sign-in by a one-time code to the portal's email (the portal's way in; the password route stays for older pages).
r.post('/auth/code', handle(async (req) => requestSignInCode(body(req).email, clientIp(req))));
r.post('/auth/verify', handle(async (req) => {
  const out = await signInWithCode(body(req).email, body(req).code, clientIp(req));
  if (out && typeof out === 'object' && 'token' in out && typeof (out as { token: unknown }).token === 'string') {
    assertCompany(req, (await journeyForPortalToken(`Bearer ${(out as { token: string }).token}`)).org);
  }
  return out;
}));
r.post('/auth/forgot', handle(async (req) => forgotPassword(body(req).email, clientIp(req))));
r.post('/auth/reset', handle(async (req) => resetPassword(body(req).token, body(req).password)));

/**
 * The client a mail's link names (`?c=`): its logo and HR contact, for sign-in,
 * forgot and reset on a device that never opened the offer link.
 */
r.get('/client/:token', handle(async (req) => {
  const org = orgOfClientToken(param(req, 'token'));
  if (!org || !(await lifecycleEnabled(org))) throw new LifecycleOfferError(404, 'Not found');
  const company = await companyOf(org);
  const email = company?.profile?.replyToEmail?.trim() || company?.profile?.primaryContactEmail?.trim() || '';
  return {
    company: { name: companyDisplayName(company, org), ...(company?.lifecyclePortal?.logoUrl ? { logoUrl: company.lifecyclePortal.logoUrl } : {}) },
    ...(email ? { hrContact: { name: company?.profile?.senderName?.trim() || 'HR', email } } : {}),
  };
}));

/**
 * A signed media link (`/portal/media/<token>`, from GET /portal/meet): a
 * `<video src>` cannot send the Bearer token, so the link itself is the
 * permission (one file of one journey, 12 hours). Serves byte ranges, which
 * Safari needs to play a video at all.
 */
r.get('/media/:token', handle(async (req, res) => {
  const claims = verifyMediaToken(param(req, 'token'));
  if (!claims) throw new LifecycleOfferError(404, 'File not found');
  const journey = await journeys().findOne({ id: claims.journeyId }, { projection: { _id: 0, org: 1, kind: 1 } });
  if (!journey || journey.kind !== 'onboarding' || !(await lifecycleEnabled(journey.org))) throw new LifecycleOfferError(404, 'File not found');
  // The joiner's own file, or a template's (the pre-boarding watch list) that is part of their design.
  const file = await fileForJourney(claims.journeyId, claims.fileId).catch(async (error) => {
    const full = await journeys().findOne({ id: claims.journeyId });
    const shared = full && (await journeyMayRead(full, claims.fileId))
      ? await lifecycleFiles().findOne({ id: claims.fileId, org: full.org, journeyId: { $exists: false } }, { projection: { _id: 0 } })
      : null;
    if (!shared) throw error;
    return shared;
  });
  const bytes = await readFileBytes(file);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', contentDisposition(file.name, false));
  res.setHeader('Accept-Ranges', 'bytes');
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.header('range') ?? ''));
  if (range && (range[1] || range[2])) {
    const size = bytes.length;
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!range[1]) end = size - 1;
    if (start >= size || start > end) {
      res.setHeader('Content-Range', `bytes */${size}`);
      res.status(416).send(Buffer.alloc(0));
      return undefined;
    }
    start = Math.max(0, start);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.status(206).send(bytes.subarray(start, end + 1));
    return undefined;
  }
  res.send(bytes);
  return undefined;
}));

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

r.get('/profile', requirePortal, handle(async (_req, res) => profileView(journeyOf(res))));
r.put('/profile/:section', requirePortal, handle(async (req, res) => saveProfileSection(journeyOf(res), param(req, 'section'), body(req))));
r.post('/profile/photo', requirePortal, files, handle(async (req, res) => saveProfilePhoto(journeyOf(res), ((req.files as Express.Multer.File[] | undefined) ?? [])[0])));
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

// Before it opens: 200 { state: 'locked', opensOn } (a normal screen, not an error the browser logs).
r.get('/pass', requirePortal, handle(async (_req, res) => portalPassOrLocked(journeyOf(res))));
r.get('/joining', requirePortal, handle(async (_req, res) => joiningDetails(journeyOf(res))));
/** The first day in a calendar, from the Joining details tile (any day; the pass's own agenda is in it once set). */
r.get('/pass.ics', requirePortal, handle(async (req, res) => {
  const ics = await portalPassIcs(journeyOf(res), new Date(), { anyDay: req.query.anyDay === '1' });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="day-1.ics"');
  res.send(ics);
  return undefined;
}));

r.post('/date-request', requirePortal, handle(async (req, res) => ({ request: await createDateRequest(journeyOf(res), body(req)) })));
