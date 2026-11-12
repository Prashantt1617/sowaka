import { ObjectId } from 'mongodb';
/**
 * /suwi: ask a question, confirm / cancel / undo a prepared action, and the
 * company's Suwi settings and activity. Dashboard users only; what each person
 * can reach is decided per tool by the same tab rules as the rest of the API.
 */
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response, Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess } from '../middleware/admin.middleware';
import { users } from '../config/db';
import { logger } from '../utils/logger';
import { askSuwi } from './agent';
import { cancelProposal, confirmProposal, undoProposal } from './proposals';
import { auditCol, proposalsCol, LEVEL_LABEL, saveSettings, settingsFor, spentThisMonthUsd } from './store';
import { llmConfigured, SUWI_MODEL, SUWI_PROVIDER } from './llm';
import { SUWI_AREAS } from './tools';
import { INSIGHT_KINDS, INSIGHT_ROUTE, InsightKind, insightFor, mayRead } from './insight';

export const suwiRouter = Router();
suwiRouter.use(requireAuth, requireDashboardAccess);

const me = (req: Request) => req.auth!.user!;
const fail = (res: Response, e: unknown, next: NextFunction) => {
  const code = (e as { statusCode?: number }).statusCode;
  if (code) { res.status(code).json({ success: false, message: (e as Error).message }); return; }
  next(e);
};

/**
 * A question that takes longer than FIRST_WAIT_MS is answered with a ticket
 * (202, `pending`), and the panel asks for the answer with GET /ask/:id until
 * it is ready. No proxy in between then holds one request open long enough to
 * cut it (CloudFront gives up on an answer after 60 s); a quick question is
 * answered in one go, as before. Tickets live in this process for 10 minutes.
 */
type AskJob = { userId: string; at: number; answer?: unknown; error?: unknown };
const askJobs = new Map<string, AskJob>();
const FIRST_WAIT_MS = 20_000;
const JOB_TTL_MS = 10 * 60_000;
const failed = (e: unknown) => {
  const code = (e as { statusCode?: number }).statusCode;
  return code ? { status: code, message: (e as Error).message } : { status: 500, message: 'Suwi could not answer just now. Try again in a moment.' };
};

suwiRouter.post('/ask', async (req, res, next) => {
  const u = me(req);
  const job: AskJob = { userId: u.userId, at: Date.now() };
  const run = askSuwi(u, req.body ?? {}).then(
    (answer) => { job.answer = answer; },
    (e: unknown) => { job.error = e; },
  );
  let timer: NodeJS.Timeout | undefined;
  const done = await Promise.race([run.then(() => true), new Promise<boolean>((r) => { timer = setTimeout(() => r(false), FIRST_WAIT_MS); })]);
  clearTimeout(timer);
  if (done) {
    if (job.error !== undefined) { fail(res, job.error, next); return; }
    res.json({ success: true, answer: job.answer });
    return;
  }
  for (const [id, j] of askJobs) if (Date.now() - j.at > JOB_TTL_MS) askJobs.delete(id);
  const id = randomUUID();
  askJobs.set(id, job);
  // Logged here, since nobody may come back for it.
  void run.then(() => { if (job.error !== undefined && !(job.error as { statusCode?: number }).statusCode) logger.error('Suwi answer failed', { userId: u.userId }, job.error); });
  res.status(202).json({ success: true, pending: id });
});

suwiRouter.get('/ask/:id', (req, res) => {
  const id = String(req.params.id);
  const job = askJobs.get(id);
  if (!job || job.userId !== me(req).userId) { res.status(404).json({ success: false, message: 'That answer is no longer here. Ask again.' }); return; }
  if (job.answer !== undefined) { askJobs.delete(id); res.json({ success: true, answer: job.answer }); return; }
  if (job.error !== undefined) { askJobs.delete(id); const f = failed(job.error); res.status(f.status).json({ success: false, message: f.message }); return; }
  res.json({ success: true, pending: id });
});

suwiRouter.post('/actions/:id/confirm', async (req, res, next) => {
  try { res.json({ success: true, action: await confirmProposal(me(req).userId, me(req).org!, String(req.params.id), req.body?.typed) }); } catch (e) { fail(res, e, next); }
});
suwiRouter.post('/actions/:id/cancel', async (req, res, next) => {
  try { res.json({ success: true, ...(await cancelProposal(me(req).userId, me(req).org!, String(req.params.id))) }); } catch (e) { fail(res, e, next); }
});
suwiRouter.post('/actions/:id/undo', async (req, res, next) => {
  try { res.json({ success: true, action: await undoProposal(me(req).userId, me(req).org!, String(req.params.id)) }); } catch (e) { fail(res, e, next); }
});

/**
 * The checks on one pending request or claim, for the box at the top of its
 * drawer. Null when the area is set to "Answer only", the request isn't this
 * company's, or this person can't see that page: the box then hides itself.
 */
suwiRouter.get('/insight/:kind/:id', async (req, res, next) => {
  try {
    const u = me(req);
    const kind = String(req.params.kind) as InsightKind;
    if (!INSIGHT_KINDS.includes(kind)) { res.status(404).json({ success: false, message: 'Unknown request kind' }); return; }
    const s = await settingsFor(u.org!);
    const level = s.levels[kind === 'claim' ? 'claims' : 'requests'];
    if (!s.enabled || level === 'answer' || !mayRead(u, INSIGHT_ROUTE[kind])) { res.json({ success: true, insight: null }); return; }
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    res.json({ success: true, insight: await insightFor(u.org!, today, kind, String(req.params.id), u.userId) });
  } catch (e) { fail(res, e, next); }
});

/** Settings → Suwi: everyone with dashboard access can read; only an admin changes it. */
suwiRouter.get('/settings', async (req, res, next) => {
  try {
    const org = me(req).org!;
    const [s, spent] = await Promise.all([settingsFor(org), spentThisMonthUsd(org)]);
    res.json({
      success: true,
      settings: { enabled: s.enabled, monthlyBudgetUsd: s.monthlyBudgetUsd, levels: s.levels, spentThisMonthUsd: Math.round(spent * 100) / 100 },
      areas: SUWI_AREAS, levelLabels: LEVEL_LABEL,
      service: { provider: SUWI_PROVIDER, model: SUWI_MODEL, ready: llmConfigured() },
      canEdit: me(req).dashboardAdmin === true,
    });
  } catch (e) { fail(res, e, next); }
});
suwiRouter.put('/settings', async (req, res, next) => {
  try {
    if (me(req).dashboardAdmin !== true) { res.status(403).json({ success: false, message: 'Only a dashboard admin can change Suwi settings' }); return; }
    const s = await saveSettings(me(req).org!, me(req).userId, req.body ?? {});
    res.json({ success: true, settings: { enabled: s.enabled, monthlyBudgetUsd: s.monthlyBudgetUsd, levels: s.levels } });
  } catch (e) { fail(res, e, next); }
});

/**
 * Suwi's prompt history: every question someone asked (not the morning digest or the import
 * summary, which nobody typed), newest first, with the full answer, whether it worked, the
 * checks it ran and what became of each action it prepared. Admins see everyone's, others
 * their own. Paged: `before` (an ISO time from the last row) and `limit` (up to 100).
 */
suwiRouter.get('/activity', async (req, res, next) => {
  try {
    const u = me(req);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const before = typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
    const filter: Record<string, unknown> = {
      org: u.org, kind: 'question', page: { $nin: ['digest'] }, question: { $ne: 'Import risk summary' },
      ...(u.dashboardAdmin === true ? {} : { userId: u.userId }),
      ...(before ? { at: { $lt: before } } : {}),
    };
    const rows = await auditCol().find(filter as never).sort({ at: -1 }).limit(limit + 1).toArray();
    const page = rows.slice(0, limit);
    const names = new Map((await users().find({ userId: { $in: [...new Set(page.map((r) => r.userId))] } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray()).map((x) => [x.userId, x.name]));
    const ids = page.flatMap((r) => r.proposalIds ?? []).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    const props = new Map((ids.length ? await proposalsCol().find({ _id: { $in: ids } }, { projection: { title: 1, status: 1, message: 1 } }).toArray() : [])
      .map((p) => [String(p._id), { title: p.title, status: p.status, message: p.message ?? null }]));
    res.json({
      success: true,
      activity: page.map((r) => ({
        id: String(r._id), at: r.at.toISOString(), who: names.get(r.userId) ?? 'Someone', kind: r.kind, page: r.page ?? null,
        // Answers were kept to their first 4,000 characters before 12 Nov 2026.
        prompt: r.question ?? '', response: r.answer ?? null,
        // Rows from before statuses were kept were all answered (failures were not recorded then).
        status: r.status ?? (r.answer ? 'answered' : 'failed'), error: r.error ?? null,
        attachment: r.attachment?.name ?? null,
        checks: (r.tools ?? []).map((t) => ({ label: t.label, ok: t.ok })),
        actions: (r.proposalIds ?? []).map((id) => props.get(id)).filter(Boolean),
        costUsd: r.costUsd ?? null,
      })),
      nextBefore: rows.length > limit ? page[page.length - 1].at.toISOString() : null,
    });
  } catch (e) { fail(res, e, next); }
});
