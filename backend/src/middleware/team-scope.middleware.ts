/**
 * Managers on the HR dashboard (team scope, 24 Nov 2026): after the tab check, refuses what carries pay or is
 * HR's alone, and any per-person route on someone outside the manager's subtree. HR (no team scope) passes.
 */
import { NextFunction, Request, Response } from 'express';
import { journeys, resignations } from '../config/db';
import { assertInTeam, scopedUserIds } from '../services/manager-scope';

/** Never for a team-scoped caller, whatever the tabs say. */
const REFUSED: Array<{ path: RegExp; methods?: string[] }> = [
  { path: /^\/admin\/accesses/ },
  { path: /^\/admin\/exits/ },
  { path: /^\/admin\/exit-settings/ },
  { path: /^\/admin\/employees\/[^/]+\/exit/ },
  { path: /^\/admin\/employees\/[^/]+\/payslips/ },
  { path: /^\/admin\/employees\/import/ },
  { path: /^\/admin\/leave-balances\/import/ },
  { path: /^\/admin\/(salary|payroll|payslips|tax|fnf|settlement)/ },
  { path: /^\/admin\/company\/settings/, methods: ['POST', 'PUT', 'PATCH', 'DELETE'] },
  { path: /^\/admin\/employees\/?$/, methods: ['POST'] },
  { path: /^\/admin\/employees\/[^/]+\/?$/, methods: ['DELETE'] },
  // KPI set-up is HR's: parameters, templates (assigning one is allowed) and the cycle.
  { path: /^\/admin\/kpi\/cycle/, methods: ['POST', 'PUT', 'PATCH', 'DELETE'] },
  { path: /^\/admin\/kpi\/parameters/, methods: ['POST', 'PUT', 'PATCH', 'DELETE'] },
  { path: /^\/admin\/kpi\/templates\/?$/, methods: ['POST'] },
  { path: /^\/admin\/kpi\/templates\/[^/]+\/?$/, methods: ['PUT', 'PATCH', 'DELETE'] },
  // Employee lifecycle: offers, letters and documents carry pay; templates, settings and exit insights are HR's.
  { path: /^\/admin\/lifecycle\/(offers|letters|letter-templates|templates|exit-insights|settlement)/ },
  { path: /^\/admin\/lifecycle\/settings/, methods: ['POST', 'PUT', 'PATCH', 'DELETE'] },
  { path: /^\/admin\/lifecycle\/journeys\/[^/]+\/pending-setup/ },
];

/** A journey's own routes: its joiner, or the manager they join under, must be in the caller's team. */
const JOURNEY = /^\/admin\/lifecycle\/journeys\/([^/?]+)/;
/** Offboarding routes on one person. */
const LEAVER = /^\/admin\/lifecycle\/(?:offboarding|resignations)\/([^/?]+)/;
const NOT_LEAVERS = new Set(['board', 'count', 'counts', 'settings', 'clearance-team', 'clearance-teams', 'nudges']);

/** Per-person routes: the person must be in the caller's team. */
const PERSON = /^\/admin\/(?:employees|kpi\/assignments)\/([^/?]+)/;
const NOT_PEOPLE = new Set(['import', 'preboarding']);

export function isTeamScoped(req: Request): boolean {
  return (req.auth?.user as { dashboardScope?: string } | undefined)?.dashboardScope === 'team';
}

export async function requireTeamScope(req: Request, res: Response, next: NextFunction) {
  if (!isTeamScoped(req)) return next();
  const path = (req.originalUrl || req.url).split('?')[0];
  const refused = REFUSED.find((r) => r.path.test(path) && (!r.methods || r.methods.includes(req.method)));
  if (refused) {
    res.status(403).json({ success: false, message: 'Only HR can do this', requestId: req.requestId });
    return;
  }
  const userId = req.auth?.user?.userId ?? '';
  const journey = JOURNEY.exec(path);
  if (journey) {
    const j = await journeys().findOne({ id: decodeURIComponent(journey[1]) }, { projection: { _id: 0, userId: 1, managerUserId: 1 } });
    const team = await scopedUserIds(userId);
    if (team && !(j && ((j.userId && team.has(j.userId)) || (j.managerUserId && team.has(j.managerUserId))))) {
      res.status(403).json({ success: false, message: 'That person is not in your team', requestId: req.requestId });
      return;
    }
  }
  const leaver = LEAVER.exec(path);
  if (leaver && !NOT_LEAVERS.has(leaver[1])) {
    const id = decodeURIComponent(leaver[1]);
    // A resignation route names the resignation; others name the person.
    const r = await resignations().findOne({ id }, { projection: { _id: 0, userId: 1 } });
    try { await assertInTeam(userId, r?.userId ?? id); } catch {
      res.status(403).json({ success: false, message: 'That person is not in your team', requestId: req.requestId });
      return;
    }
  }
  const m = PERSON.exec(path);
  if (m && !NOT_PEOPLE.has(m[1])) {
    try {
      await assertInTeam(req.auth?.user?.userId ?? '', decodeURIComponent(m[1] ?? ''));
    } catch {
      res.status(403).json({ success: false, message: 'That person is not in your team', requestId: req.requestId });
      return;
    }
  }
  next();
}

/** Suwi reads the whole company: not for a manager on the dashboard (24 Nov 2026). */
export function refuseTeamScope(req: Request, res: Response, next: NextFunction) {
  if (!isTeamScoped(req)) return next();
  res.status(403).json({ success: false, message: 'Suwi is for HR', requestId: req.requestId });
}
