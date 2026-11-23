// Who is on which salary template, who has none (and so is left out of a pay
// run), and putting people on a template with their CTC. Money is INTEGER PAISE.
import { api } from './http';
import type { StructureListRow } from './payroll';

export type MissingSalaryReason = 'none' | 'no_template' | 'no_ctc' | 'draft' | 'template_gone';

export type PersonWithoutSalary = {
  userId: string;
  name: string;
  employeeId?: string;
  /** YYYY-MM-DD */
  joiningDate?: string;
  department?: string;
  designation?: string;
  reason: MissingSalaryReason;
  salaryTemplateCode?: string;
};

export type PeopleWithoutSalary = {
  period: string;
  /** The pay dates of `period`, YYYY-MM-DD. */
  from: string;
  to: string;
  /** The pay period today falls in. */
  current: { period: string; from: string; to: string };
  people: PersonWithoutSalary[];
};

/** Who a run for `period` (default: the current pay period) leaves out for want of a live salary. */
export const getPeopleWithoutSalary = (period?: string) =>
  api<PeopleWithoutSalary>(`/admin/payroll/people-without-salary${period ? `?period=${encodeURIComponent(period)}` : ''}`);

export type TemplatePersonInput = { userId: string; annualCtcPaise: number; effectiveFrom: string };
export type TemplatePersonResult = { userId: string; name: string; ok: boolean; movedFrom?: string; message?: string };

/** Puts people on a salary template, each with an annual CTC and the day it applies from. */
export const assignTemplatePeople = (code: string, people: TemplatePersonInput[]) =>
  api<{ template: string; saved: number; results: TemplatePersonResult[] }>(`/admin/payroll/salary-templates/${encodeURIComponent(code)}/people`, {
    method: 'POST',
    body: { people },
  });

/** A salary as the list gives it, with the day it applies from on its template. */
export type StructureRowWithFrom = StructureListRow & { effectiveFrom?: string };

export const REASON_TEXT: Record<MissingSalaryReason, string> = {
  none: 'No salary template',
  no_template: 'No salary template',
  no_ctc: 'Template set, no CTC',
  draft: 'Salary saved as a draft',
  template_gone: 'Template was deleted',
};

/** 'YYYY-MM-DD' → '12 Nov 2026'. */
export function dayLabel(day?: string): string {
  if (!day) return '—';
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
