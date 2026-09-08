// Typed calls against the KPI admin endpoints (/admin/kpi/*).
//
// Parameters are the org's catalogue of what people are scored on, templates
// are reusable sets of them, and an assignment pins one set to one employee for
// one review cycle. Assignments are copied from a template at assign time, so
// editing a template afterwards does not change anyone already assigned.
import { api } from './http';

export type KpiParameterDTO = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  archived: boolean;
  /** Absent on parameters created before authorship was recorded. */
  createdByName?: string;
  /** ISO timestamp. */
  createdAt?: string;
  /** A wording change waiting for its cycle to open. */
  pendingEdit?: {
    subtitle: string;
    description: string;
    /** Cycle key the new wording becomes live in. */
    effectiveFrom: string;
    editedAt?: string;
  };
};

/** The org's live review cycle. Cycles run monthly from a configurable day. */
export type KpiCycleDTO = {
  /** `YYYY-MM`, keyed by the month the cycle opens in. */
  period: string;
  next: string;
  /** Day of month cycles open on (1-28). */
  startDay: number;
  /** `YYYY-MM-DD` bounds, half-open. */
  start: string;
  end: string;
};

export const getKpiCycle = () =>
  api<{ cycle: KpiCycleDTO }>('/admin/kpi/cycle').then((r) => r.cycle);

/**
 * Targeting facets. Each populated facet must match and they combine as an
 * intersection, so designations + locations means "these roles in these
 * places", not "either". An empty facet places no constraint.
 */
export type KpiTargeting = {
  locations: string[];
  designations: string[];
  departments: string[];
  managerUserIds: string[];
};

export type KpiTemplateDTO = {
  id: string;
  name: string;
  description: string;
  parameterIds: string[];
  /** Percentage per parameter id, whole numbers summing to 100. */
  weights: Record<string, number>;
  /** Distinct employees on this template in the live cycle — read-only. */
  employeeCount: number;
  /** Distinct employees on it for the next cycle, which is what HR edits. */
  upcomingCount: number;
  /** Assignments made from it in any cycle — what blocks deletion. */
  assignmentCount: number;
} & KpiTargeting;

/** One person an ad-hoc rule set selects, with the fields the rules filter on. */
export type KpiAudienceRowDTO = {
  userId: string;
  name: string;
  employeeId?: string;
  designation?: string;
  department?: string;
  location?: string;
  managerName?: string;
  /** What they hold for the cycle, so overwriting is a visible choice. */
  currentTemplateId?: string;
  currentTemplateName?: string;
  parameterCount: number;
};

/** One employee currently on a template, with their own weights. */
export type KpiTemplateMemberDTO = {
  userId: string;
  name: string;
  employeeId?: string;
  designation?: string;
  department?: string;
  location?: string;
  branch?: string;
  recognition?: string;
  managerName?: string;
  /** Their assigned set — may differ from the template after an individual edit. */
  parameterIds: string[];
  weights: Record<string, number>;
};

/** Who is on a template right now, for export. */
export const kpiTemplateMembers = (id: string, period: string) =>
  api<{ period: string; templateName: string; members: KpiTemplateMemberDTO[] }>(
    `/admin/kpi/templates/${id}/members?period=${period}`,
  );

/** Resolves rules built on the spot — the first step of bulk assignment. */
export const resolveKpiAudience = (targeting: Partial<KpiTargeting>, period: string) =>
  api<{ period: string; audience: KpiAudienceRowDTO[] }>('/admin/kpi/audience', {
    method: 'POST',
    body: { ...targeting, period },
  }).then((r) => r.audience);

/** One person a template's targeting selects, with what they already hold. */
export type KpiAudienceMemberDTO = {
  userId: string;
  name: string;
  employeeId?: string;
  designation?: string;
  location?: string;
  department?: string;
  /** Already on this exact template — re-assigning changes nothing. */
  hasThisTemplate: boolean;
  /** Holds a different set — assigning would replace it. */
  hasOtherAssignment: boolean;
  parameterCount: number;
};

export type KpiAssignmentDTO = {
  userId: string;
  /** `YYYY-MM` */
  period: string;
  templateId?: string;
  /** Percentage per parameter id, whole numbers summing to 100. */
  weights: Record<string, number>;
  parameters: KpiParameterDTO[];
};

// ---- Parameters ----

export const listKpiParameters = (includeArchived = false) =>
  api<{ parameters: KpiParameterDTO[] }>(
    `/admin/kpi/parameters${includeArchived ? '?includeArchived=true' : ''}`,
  ).then((r) => r.parameters);

export const createKpiParameter = (input: { title: string; subtitle?: string; description?: string }) =>
  api<{ parameter: KpiParameterDTO }>('/admin/kpi/parameters', { method: 'POST', body: input })
    .then((r) => r.parameter);

/**
 * Stages a wording change. Only the subtitle and guidance can change, and the
 * change lands in the next cycle — never the one in progress, where managers
 * are already scoring against the current text.
 */
export const updateKpiParameter = (
  id: string,
  input: { subtitle?: string; description?: string },
) =>
  api<{ parameter: KpiParameterDTO }>(`/admin/kpi/parameters/${id}`, { method: 'PUT', body: input })
    .then((r) => r.parameter);

/** Drops a staged edit before its cycle opens; the live wording is untouched. */
export const cancelKpiParameterEdit = (id: string) =>
  api<{ id: string; cancelled: boolean }>(`/admin/kpi/parameters/${id}/pending`, { method: 'DELETE' });

/**
 * Permanent removal, refused by the server (409) while any template,
 * assignment or submitted review still references the parameter — in any
 * cycle, not just the current one.
 */
export const deleteKpiParameter = (id: string) =>
  api<{ id: string; deleted: boolean }>(`/admin/kpi/parameters/${id}`, { method: 'DELETE' });

/** Archived parameters leave pickers but stay readable on past reviews. */
export const archiveKpiParameter = (id: string, archived: boolean) =>
  api<{ id: string; archived: boolean }>(`/admin/kpi/parameters/${id}/archive`, {
    method: 'POST',
    body: { archived },
  });

// ---- Templates ----

export const listKpiTemplates = () =>
  api<{ templates: KpiTemplateDTO[] }>('/admin/kpi/templates').then((r) => r.templates);

export const createKpiTemplate = (input: {
  name: string;
  description?: string;
  parameterIds: string[];
  /** Percentages summing to 100. Omit for an even split. */
  weights?: Record<string, number>;
} & Partial<KpiTargeting>) =>
  api<{ template: KpiTemplateDTO }>('/admin/kpi/templates', { method: 'POST', body: input })
    .then((r) => r.template);

export const updateKpiTemplate = (
  id: string,
  input: { name?: string; description?: string; parameterIds?: string[] } & Partial<KpiTargeting>,
) =>
  api<{ template: KpiTemplateDTO }>(`/admin/kpi/templates/${id}`, { method: 'PUT', body: input })
    .then((r) => r.template);

export const deleteKpiTemplate = (id: string) =>
  api<{ id: string; deleted: boolean }>(`/admin/kpi/templates/${id}`, { method: 'DELETE' });

/** Everyone the template's targeting selects, resolved server-side. */
export const kpiTemplateAudience = (id: string, period: string) =>
  api<{ templateId: string; period: string; audience: KpiAudienceMemberDTO[] }>(
    `/admin/kpi/templates/${id}/audience?period=${period}`,
  ).then((r) => r.audience);

/** Assigns the template to the chosen employees, replacing what they had. */
export const assignTemplateToUsers = (id: string, userIds: string[], period: string) =>
  api<{ templateId: string; period: string; assigned: number }>(
    `/admin/kpi/templates/${id}/assign`,
    { method: 'POST', body: { userIds, period } },
  );

// ---- Assignments ----

export const listKpiAssignments = (period: string) =>
  api<{ assignments: KpiAssignmentDTO[] }>(`/admin/kpi/assignments?period=${period}`)
    .then((r) => r.assignments);

export const getKpiAssignment = (userId: string, period: string) =>
  api<{ assignment: KpiAssignmentDTO | null }>(`/admin/kpi/assignments/${userId}?period=${period}`)
    .then((r) => r.assignment);

/**
 * Assign by template (copied at assign time) or by an explicit parameter list.
 * Re-assigning replaces whatever the employee had for that cycle.
 */
export const assignKpis = (input: {
  userId: string;
  period: string;
  templateId?: string;
  /** Sending an explicit set requires weights for exactly that set. */
  parameterIds?: string[];
  weights?: Record<string, number>;
}) =>
  api<{ assignment: KpiAssignmentDTO }>('/admin/kpi/assignments', { method: 'POST', body: input })
    .then((r) => r.assignment);

export const removeKpiAssignment = (userId: string, period: string) =>
  api<{ deleted: boolean }>(`/admin/kpi/assignments/${userId}?period=${period}`, { method: 'DELETE' });

/**
 * Calendar-month fallback for callers with no cycle loaded yet.
 *
 * Correct only while the org opens cycles on the 1st. Anything that matters
 * should use the period from `getKpiCycle()`, which honours the configured
 * start day.
 */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}
