/**
 * /suwi: ask a question, confirm / cancel / undo a prepared action, and the
 * company's Suwi settings and activity. Dashboard users only; what each person
 * can reach is decided per tool by the same tab rules as the rest of the API.
 */
import { NextFunction, Request, Response, Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess } from '../middleware/admin.middleware';
import { users } from '../config/db';
import { askSuwi } from './agent';
import { cancelProposal, confirmProposal, undoProposal } from './proposals';
import { auditCol, LEVEL_LABEL, saveSettings, settingsFor, spentThisMonthUsd } from './store';
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

suwiRouter.post('/ask', async (req, res, next) => {
  try { res.json({ success: true, answer: await askSuwi(me(req), req.body ?? {}) }); } catch (e) { fail(res, e, next); }
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
    res.json({ success: true, insight: await insightFor(u.org!, today, kind, String(req.params.id)) });
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

/** Recent Suwi activity: actions and settings changes for everyone; questions only your own (admins see all). */
suwiRouter.get('/activity', async (req, res, next) => {
  try {
    const u = me(req);
    const filter = u.dashboardAdmin === true ? { org: u.org } : { org: u.org, $or: [{ kind: { $ne: 'question' } }, { userId: u.userId }] };
    const rows = await auditCol().find(filter as never).sort({ at: -1 }).limit(50).toArray();
    const names = new Map((await users().find({ userId: { $in: [...new Set(rows.map((r) => r.userId))] } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray()).map((x) => [x.userId, x.name]));
    res.json({
      success: true,
      activity: rows.map((r) => ({
        at: r.at.toISOString(), who: names.get(r.userId) ?? 'Someone', kind: r.kind,
        text: r.kind === 'question' ? r.question : r.kind === 'action' ? `${r.action?.title}: ${r.action?.result}${r.action?.message ? ` (${r.action.message})` : ''}` : r.answer,
        tools: r.tools?.map((t) => t.label), costUsd: r.costUsd,
      })),
    });
  } catch (e) { fail(res, e, next); }
});
