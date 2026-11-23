// Week 1's HR setup, the data side: what a joiner is on now for each of the three (KPI, salary and
// shift templates), read from the template pages' own APIs, and who may assign each (the tabs those
// pages need; the server checks the same). Drawn by Week1Setup.tsx.
// Before they have an account (no userId, no app access) nothing is "on" yet: HR's choice is kept on the
// journey (`journey.pendingSetup`) and applied when the account is made; the templates to pick from load
// when the picker opens (`reload`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { canOpen, canSeePay } from '../../access';
import { getKpiAssignment, getKpiCycle, listKpiTemplates } from '../../../services/kpi';
import type { KpiCycleDTO } from '../../../services/kpi';
import { getShifts } from '../../../services/hrms';
import { listSalaryStructures, listSalaryTemplates } from '../../../services/payroll';
import { dayLabel } from '../../../services/salaryTemplatePeople';
import type { StructureRowWithFrom } from '../../../services/salaryTemplatePeople';
import type { PendingSetup } from '../../../services/lifecycle';
import { periodLabel } from '../../period';
import { errText, rupees } from './format';

export type SetupKind = 'kpi' | 'salary' | 'shift';
export const SETUP_KINDS: SetupKind[] = ['kpi', 'salary', 'shift'];

export interface SetupOption { id: string; name: string; note?: string }
export interface SetupState {
  /** 'idle': before an account, the templates not loaded yet (the picker loads them). */
  status: 'idle' | 'loading' | 'ready' | 'error' | 'no_access';
  /** On a template of this kind (the tick). */
  assigned: boolean;
  /** The template they are on now. */
  now?: string;
  /** A line under it (the cycle, the CTC, following the default…). */
  detail?: string;
  currentId?: string;
  options: SetupOption[];
  /** May assign here (the template page's tabs). */
  canAssign: boolean;
  error?: string;
}
export type Week1Setup = {
  rows: Record<SetupKind, SetupState>;
  reload: (kind: SetupKind) => Promise<void>;
  /** The KPI cycle in progress (what an assignment here goes live in). */
  cycle: KpiCycleDTO | null;
  /** Their salary as payroll has it (its CTC prefills a change). */
  salary: StructureRowWithFrom | null;
};

const blank = (canAssign: boolean, status: SetupState['status'] = 'loading'): SetupState => ({ status, assigned: false, options: [], canAssign });

/**
 * What the joiner is on now for each of the three, loaded once they have an account (`userId`: theirs once
 * joined, or the one app access made). Before that only the templates to choose from, when the picker asks
 * (`reload`). `reload(kind)` reads one again after an assign.
 */
export function useWeek1Setup(userId: string | undefined): Week1Setup {
  const { user } = useStore();
  // The tabs each template page needs (booleans, so a new user object with the same tabs reloads nothing).
  const mayKpi = canOpen(user, 'kpitemplates') || canOpen(user, 'kpibulk') || canOpen(user, 'kpi');
  const maySalary = canOpen(user, 'templates');
  const seesSalary = maySalary || canSeePay(user);
  const mayShift = canOpen(user, 'shifttypes') || canOpen(user, 'shiftbulk');
  const may = useMemo(() => ({ kpi: mayKpi, salary: maySalary, salarySees: seesSalary, shift: mayShift }), [mayKpi, maySalary, seesSalary, mayShift]);
  const [rows, setRows] = useState<Record<SetupKind, SetupState>>(() => ({ kpi: blank(may.kpi), salary: blank(may.salary), shift: blank(may.shift) }));
  const [cycle, setCycle] = useState<KpiCycleDTO | null>(null);
  const [salary, setSalary] = useState<StructureRowWithFrom | null>(null);
  const put = (kind: SetupKind, next: SetupState) => setRows((r) => ({ ...r, [kind]: next }));

  const reload = useCallback(async (kind: SetupKind) => {
    try {
      // No account yet: the templates to choose from (the choice itself is on the journey).
      if (!userId) {
        if (kind === 'salary' && !may.salarySees) { put('salary', { status: 'no_access', canAssign: false, assigned: false, options: [] }); return; }
        setRows((r) => ({ ...r, [kind]: { ...r[kind], status: 'loading' } }));
        if (kind === 'kpi') {
          const [cyc, templates] = await Promise.all([getKpiCycle(), listKpiTemplates()]);
          setCycle(cyc);
          put('kpi', { status: 'ready', canAssign: may.kpi, assigned: false, options: templates.map((t) => ({ id: t.id, name: t.name, note: `${t.parameterIds.length} parameter${t.parameterIds.length === 1 ? '' : 's'}` })) });
        } else if (kind === 'shift') {
          const usable = (await getShifts()).filter((t) => t.active || t.isDefault);
          put('shift', { status: 'ready', canAssign: may.shift, assigned: false, options: usable.map((t) => ({ id: t.id, name: t.name, note: t.isDefault ? 'default' : undefined })) });
        } else {
          const templates = await listSalaryTemplates();
          put('salary', { status: 'ready', canAssign: may.salary, assigned: false, options: templates.filter((t) => t.active).map((t) => ({ id: t.code, name: t.name })) });
        }
        return;
      }
      if (kind === 'kpi') {
        const [cyc, templates] = await Promise.all([getKpiCycle(), listKpiTemplates()]);
        const [live, next] = await Promise.all([getKpiAssignment(userId, cyc.period), getKpiAssignment(userId, cyc.next)]);
        setCycle(cyc);
        const nameOf = (templateId?: string) => (templateId ? templates.find((t) => t.id === templateId)?.name ?? 'A deleted template' : 'Custom set');
        const held = live ?? next;
        put('kpi', {
          status: 'ready', canAssign: may.kpi, assigned: Boolean(held),
          now: held ? nameOf(held.templateId) : undefined,
          detail: live ? `${periodLabel(cyc.period)} cycle` : next ? `From ${periodLabel(cyc.next)}` : undefined,
          currentId: held?.templateId,
          options: templates.map((t) => ({ id: t.id, name: t.name, note: `${t.parameterIds.length} parameter${t.parameterIds.length === 1 ? '' : 's'}` })),
        });
      } else if (kind === 'shift') {
        const shifts = await getShifts();
        // Who someone follows: an active template (or the default) they are on, else the default.
        const usable = shifts.filter((t) => t.active || t.isDefault);
        const mine = usable.find((t) => t.assignedUserIds.includes(userId));
        const fallback = shifts.find((t) => t.isDefault);
        put('shift', {
          status: 'ready', canAssign: may.shift, assigned: Boolean(mine),
          now: mine?.name,
          detail: mine ? (mine.isDefault ? 'The default shift' : undefined) : fallback ? `Follows ${fallback.name}, the default, until assigned` : undefined,
          currentId: mine?.id,
          options: usable.map((t) => ({ id: t.id, name: t.name, note: t.isDefault ? 'default' : undefined })),
        });
      } else {
        if (!may.salarySees) { put('salary', { status: 'no_access', canAssign: false, assigned: false, options: [] }); return; }
        const [templates, structures] = await Promise.all([listSalaryTemplates(), listSalaryStructures()]);
        const row = (structures as StructureRowWithFrom[]).find((r) => r.userId === userId) ?? null;
        setSalary(row);
        const live = row?.status === 'active' && row.salaryTemplateCode ? row : null;
        put('salary', {
          status: 'ready', canAssign: may.salary, assigned: Boolean(live),
          now: live ? templates.find((t) => t.code === live.salaryTemplateCode)?.name ?? live.salaryTemplateCode : undefined,
          detail: live
            ? [live.annualCtcPaise > 0 ? `${rupees(live.annualCtcPaise / 100)} a year` : '', live.effectiveFrom ? `from ${dayLabel(live.effectiveFrom)}` : ''].filter(Boolean).join(' · ') || undefined
            : row?.status === 'draft' ? 'Salary saved as a draft' : undefined,
          currentId: live?.salaryTemplateCode,
          options: templates.filter((t) => t.active).map((t) => ({ id: t.code, name: t.name })),
        });
      }
    } catch (e) {
      setRows((r) => ({ ...r, [kind]: { ...r[kind], status: 'error', error: errText(e, 'Could not load') } }));
    }
  }, [userId, may]);

  useEffect(() => {
    const first = userId ? 'loading' : 'idle';
    setRows({ kpi: blank(may.kpi, first), salary: may.salarySees || userId ? blank(may.salary, first) : blank(false, 'no_access'), shift: blank(may.shift, first) });
    setSalary(null);
    if (!userId) return;
    for (const k of SETUP_KINDS) void reload(k);
  }, [userId, may, reload]);

  return { rows, reload, cycle, salary };
}

/** The template a pending choice names (the picker's value: a KPI template id, a salary template code, a shift id). */
export function pendingIdOf(pending: PendingSetup | undefined, kind: SetupKind): string | undefined {
  if (kind === 'kpi') return pending?.kpi?.templateId;
  if (kind === 'salary') return pending?.salary?.templateCode;
  return pending?.shift?.shiftTemplateId;
}

/**
 * Week 1's "n of 3 set up": on a template now (with an account), or chosen for when they join (a choice that could
 * not be applied is not set up). `known` once what they are on now has loaded (always, before an account).
 */
export function setupDoneCount(setup: Week1Setup, hasAccount: boolean, pending: PendingSetup | undefined): { done: number; known: boolean } {
  const chosen = (k: SetupKind) => Boolean(pending?.[k]) && !pending?.[k]?.error;
  const done = SETUP_KINDS.filter((k) => chosen(k) || (hasAccount && setup.rows[k].status === 'ready' && setup.rows[k].assigned)).length;
  return { done, known: !hasAccount || SETUP_KINDS.every((k) => setup.rows[k].status !== 'loading') };
}
