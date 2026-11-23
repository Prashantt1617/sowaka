/**
 * Week 1's HR setup before the joiner has an account (the onboarding journey's "Assign a KPI template",
 * "Assign a salary template", "Assign a shift template"): HR may choose them at any time. Without an
 * account (no `userId`, no `appAccess.userId`) the choice is kept on the journey as `pendingSetup`, and
 * when the account is made (Generate app access, or Mark joined making it) each choice is applied through
 * the template pages' own assigns:
 *   KPI     kpi.service assignKpis (the cycle in progress), as POST /admin/kpi/assignments
 *   Salary  salaryTemplatePeople.service assignPeopleToTemplate (upsertSalaryStructure), as POST …/salary-templates/:code/people
 *   Shift   shift.service assignShiftToUsers (the move starts tomorrow), as POST /admin/shifts/:id/assign
 * as the HR person who chose it (they had that page's access). Applied, a choice is cleared and noted in
 * `setupApplied`; one that fails never stops the account being made: it stays, with `error`, and the row
 * says "Couldn't apply: <reason>" (HR then assigns it directly, which clears it).
 *
 * Who may choose: the tabs the template page's own assign needs (the same rule the server applies to it).
 */
import { ObjectId } from 'mongodb';
import { journeys, kpiTemplates, salaryTemplates, shiftTemplates } from '../../config/db';
import { hasAllDashboardTabs } from '../../middleware/admin.middleware';
import { tabsForRequest } from '../../models/dashboard-tabs';
import type { Journey, PendingSetup, PendingSetupKind } from '../../models/lifecycle.model';
import { logger } from '../../utils/logger';
import { cycleInfoFor } from '../cycle';
import { assignKpis } from '../kpi.service';
import { assignPeopleToTemplate } from '../salaryTemplatePeople.service';
import { assignShiftToUsers } from '../shift.service';
import { LifecycleError } from './errors';

export const SETUP_KINDS: PendingSetupKind[] = ['kpi', 'salary', 'shift'];
type DashboardUser = { dashboardAdmin?: boolean; dashboardTabs?: string[] } | undefined;

/** The template page's assign each kind goes through (its tab rule decides who may choose it here). */
const ASSIGN_API: Record<PendingSetupKind, string> = {
  kpi: '/admin/kpi/assignments',
  salary: '/admin/payroll/salary-templates/CODE/people',
  shift: '/admin/shifts/ID/assign',
};

/** Whether this dashboard user may assign this kind (the tabs the template page's own assign needs). */
export function mayAssignSetup(user: DashboardUser, kind: PendingSetupKind): boolean {
  if (hasAllDashboardTabs(user)) return true;
  const needed = tabsForRequest('POST', ASSIGN_API[kind]);
  if (!needed) return true;
  const mine = new Set(user?.dashboardTabs ?? []);
  return needed.some((t) => mine.has(t));
}

const NOUN: Record<PendingSetupKind, string> = { kpi: 'KPI templates', salary: 'Salary templates', shift: 'Shift templates' };
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ENDED = ['declined', 'expired', 'not_joining'];

/** The account the journey has: the employee (joined) or the one Generate app access made. */
export const accountOf = (j: Pick<Journey, 'userId' | 'appAccess'>): string | undefined => j.userId ?? j.appAccess?.userId;

const oid = (id: string): ObjectId | null => (ObjectId.isValid(id) && String(new ObjectId(id)) === id.toLowerCase() ? new ObjectId(id) : null);

/**
 * PUT …/journeys/:id/pending-setup — `{ kpi?, salary?, shift? }`, each kind given is set, `null` clears it:
 *   kpi: { templateId }   salary: { templateCode, annualCtcPaise, effectiveFrom: 'YYYY-MM-DD' }   shift: { templateId }
 * Setting needs no account yet (409 once they have one: assign directly); clearing works at any time (after a
 * direct assign the dashboard clears a choice that could not be applied). Each kind needs that template page's
 * tabs (403). The template must exist (404), a salary template be active (409). Returns the pending setup.
 */
export async function savePendingSetup(user: DashboardUser & { userId: string; name: string }, journey: Journey, input: unknown, now = new Date()): Promise<PendingSetup> {
  if (journey.kind !== 'onboarding') throw new LifecycleError(404, 'Journey not found');
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const kinds = SETUP_KINDS.filter((k) => body[k] !== undefined);
  if (!kinds.length) throw new LifecycleError(400, 'Give kpi, salary or shift');
  for (const k of kinds) {
    if (!mayAssignSetup(user, k)) throw new LifecycleError(403, `You need access to ${NOUN[k]} to choose this`);
  }
  const setting = kinds.filter((k) => body[k] !== null);
  if (setting.length) {
    if (journey.closedAt || ENDED.includes(String(journey.status))) throw new LifecycleError(409, 'This joiner’s journey is closed');
    if (accountOf(journey)) throw new LifecycleError(409, 'They have an account now: assign it directly');
  }
  const by = { userId: user.userId, name: user.name };
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  for (const k of kinds) {
    const v = body[k];
    if (v === null) { unset[`pendingSetup.${k}`] = ''; continue; }
    if (typeof v !== 'object' || Array.isArray(v)) throw new LifecycleError(400, `${k} must be an object or null`);
    const o = v as Record<string, unknown>;
    if (k === 'kpi') {
      const id = String(o.templateId ?? '').trim();
      const _id = oid(id);
      const t = _id ? await kpiTemplates().findOne({ _id, org: journey.org }, { projection: { name: 1 } }) : null;
      if (!t) throw new LifecycleError(404, 'KPI template not found');
      set['pendingSetup.kpi'] = { templateId: id, name: t.name, by, at: now };
    } else if (k === 'shift') {
      const id = String(o.templateId ?? o.shiftTemplateId ?? '').trim();
      const _id = oid(id);
      const t = _id ? await shiftTemplates().findOne({ _id, org: journey.org, deletedAt: { $exists: false } }, { projection: { name: 1 } }) : null;
      if (!t) throw new LifecycleError(404, 'Shift template not found');
      set['pendingSetup.shift'] = { shiftTemplateId: id, name: t.name, by, at: now };
    } else {
      const code = String(o.templateCode ?? '').trim().toUpperCase();
      const t = code ? await salaryTemplates().findOne({ org: journey.org, code }, { projection: { name: 1, active: 1 } }) : null;
      if (!t) throw new LifecycleError(404, 'Salary template not found');
      if (!t.active) throw new LifecycleError(409, `${t.name} is inactive: make it active before putting people on it`);
      const ctc = Number(o.annualCtcPaise);
      if (!Number.isInteger(ctc) || ctc <= 0) throw new LifecycleError(400, 'Enter the annual CTC');
      const from = String(o.effectiveFrom ?? '');
      if (!DAY.test(from) || new Date(`${from}T00:00:00Z`).toISOString().slice(0, 10) !== from) throw new LifecycleError(400, 'The day it applies from must be a date, YYYY-MM-DD');
      set['pendingSetup.salary'] = { templateCode: code, annualCtcPaise: ctc, effectiveFrom: from, name: t.name, by, at: now };
    }
  }
  await journeys().updateOne({ id: journey.id }, { $set: { ...set, updatedAt: now }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  const fresh = await journeys().findOne({ id: journey.id }, { projection: { _id: 0, pendingSetup: 1 } });
  return fresh?.pendingSetup ?? {};
}

/** The pending setup as a viewer without pay access may see it (the salary choice without its CTC). */
export function pendingSetupForViewer(p: PendingSetup | undefined, seesPay: boolean): PendingSetup | undefined {
  if (!p || seesPay || !p.salary) return p;
  const { annualCtcPaise: _c, ...salary } = p.salary;
  return { ...p, salary: salary as NonNullable<PendingSetup['salary']> };
}

export interface SetupApplyResult { kind: PendingSetupKind; ok: boolean; name: string; message?: string }

/**
 * Applies each pending choice to the account just made (`userId`), through the template pages' own assigns, as
 * the HR person who chose it. Applied: cleared, noted in `setupApplied`. Failed: kept, with `error` and
 * `failedAt`, and logged. Never throws: the account is made whatever happens here.
 */
export async function applyPendingSetup(journeyId: string, userId: string, now = new Date()): Promise<SetupApplyResult[]> {
  const results: SetupApplyResult[] = [];
  let pending: PendingSetup | undefined;
  let org = '';
  try {
    const j = await journeys().findOne({ id: journeyId }, { projection: { _id: 0, org: 1, pendingSetup: 1 } });
    pending = j?.pendingSetup;
    org = j?.org ?? '';
  } catch (error) {
    logger.warn('Pending setup: could not read the journey', { journeyId }, error);
    return results;
  }
  if (!pending) return results;
  for (const kind of SETUP_KINDS) {
    const choice = pending[kind];
    if (!choice) continue;
    try {
      if (kind === 'kpi') {
        const c = choice as NonNullable<PendingSetup['kpi']>;
        const cycle = await cycleInfoFor(org);
        await assignKpis(c.by.userId, { userId, period: cycle.period, templateId: c.templateId });
      } else if (kind === 'salary') {
        const c = choice as NonNullable<PendingSetup['salary']>;
        const out = await assignPeopleToTemplate(c.by.userId, c.templateCode, { people: [{ userId, annualCtcPaise: c.annualCtcPaise, effectiveFrom: c.effectiveFrom }] });
        const mine = out.results.find((r) => r.userId === userId);
        if (!mine?.ok) throw new Error(mine?.message || 'Could not put them on this template');
      } else {
        const c = choice as NonNullable<PendingSetup['shift']>;
        await assignShiftToUsers(c.by.userId, c.shiftTemplateId, [userId]);
      }
      await journeys().updateOne({ id: journeyId }, {
        $unset: { [`pendingSetup.${kind}`]: '' },
        $set: { [`setupApplied.${kind}`]: { name: choice.name, userId, at: now } },
      } as never);
      results.push({ kind, ok: true, name: choice.name });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300) || 'Something went wrong';
      logger.warn('Pending setup: could not apply a choice', { journeyId, userId, kind }, error);
      await journeys().updateOne({ id: journeyId }, { $set: { [`pendingSetup.${kind}.error`]: message, [`pendingSetup.${kind}.failedAt`]: now } } as never).catch(() => undefined);
      results.push({ kind, ok: false, name: choice.name, message });
    }
  }
  return results;
}
