// Week 1's HR setup, the data side: what a joiner is on now for each of the three (KPI, salary and
// shift templates), read from the template pages' own APIs, and who may assign each (the tabs those
// pages need; the server checks the same). Drawn by Week1Setup.tsx.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { canOpen, canSeePay } from '../../access';
import { getKpiAssignment, getKpiCycle, listKpiTemplates } from '../../../services/kpi';
import type { KpiCycleDTO } from '../../../services/kpi';
import { getShifts } from '../../../services/hrms';
import { listSalaryStructures, listSalaryTemplates } from '../../../services/payroll';
import { dayLabel } from '../../../services/salaryTemplatePeople';
import type { StructureRowWithFrom } from '../../../services/salaryTemplatePeople';
import { periodLabel } from '../../period';
import { errText, rupees } from './format';

export type SetupKind = 'kpi' | 'salary' | 'shift';
export const SETUP_KINDS: SetupKind[] = ['kpi', 'salary', 'shift'];

export interface SetupOption { id: string; name: string; note?: string }
export interface SetupState {
  status: 'loading' | 'ready' | 'error' | 'no_access';
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

const blank = (canAssign: boolean): SetupState => ({ status: 'loading', assigned: false, options: [], canAssign });

/**
 * What the joiner is on now for each of the three, loaded once they have a userId (nothing before:
 * the rows say "After they join"). `reload(kind)` reads one again after an assign.
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
    if (!userId) return;
    try {
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
    setRows({ kpi: blank(may.kpi), salary: blank(may.salary), shift: blank(may.shift) });
    setSalary(null);
    if (!userId) return;
    for (const k of SETUP_KINDS) void reload(k);
  }, [userId, may, reload]);

  return { rows, reload, cycle, salary };
}
