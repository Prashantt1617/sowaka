import { ObjectId } from 'mongodb';
import { feedbackRecords, kpiAssignments, kpiParameters, kpiTemplates, users } from '../config/db';
import { KpiAssignment, KpiParameter, KpiTemplate } from '../models/kpi.model';
import { currentPeriodFor, nextPeriod } from './cycle';

export class KpiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_TITLE = 80;
const MAX_SUBTITLE = 160;
const MAX_DESCRIPTION = 600;
/** A template is capped at ten parameters; the form is a scroll, not a survey. */
const MAX_PARAMETERS_PER_SET = 10;

/** `YYYY-MM`, the same cycle key feedback records use. */
function requirePeriod(value: unknown): string {
  const period = String(value ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new KpiError(400, 'Period must be in YYYY-MM format');
  }
  return period;
}

function text(value: unknown, field: string, max: number, required = true): string {
  const trimmed = String(value ?? '').trim();
  if (required && !trimmed) throw new KpiError(400, `${field} is required`);
  if (trimmed.length > max) throw new KpiError(400, `${field} cannot exceed ${max} characters`);
  return trimmed;
}

function objectId(value: string, field: string): ObjectId {
  if (!ObjectId.isValid(value)) throw new KpiError(400, `${field} is invalid`);
  return new ObjectId(value);
}

/**
 * Assignments may only be written for a cycle that has not opened yet.
 *
 * A manager scoring right now must not have the parameters change underneath
 * them, and two managers in one cycle must not be judging against different
 * sets. So the live cycle is frozen and every change lands in the next one —
 * the same rule parameter wording follows.
 */
async function requireFutureCycle(org: string, period: string): Promise<void> {
  const live = await currentPeriodFor(org);
  if (period <= live) {
    throw new KpiError(
      409,
      `The cycle in progress cannot be changed. Assign for ${nextPeriod(live)} or later instead.`,
    );
  }
}

/** The caller's org. Every read and write below is scoped to it. */
async function requireOrg(adminUserId: string): Promise<string> {
  const admin = await users().findOne({ userId: adminUserId });
  if (!admin) throw new KpiError(404, 'User not found');
  if (!admin.org) throw new KpiError(409, 'User is not attached to a company');
  return admin.org;
}

// ---------------------------------------------------------------- parameters

function parameterView(doc: KpiParameter & { _id?: ObjectId }, authorName?: string) {
  return {
    id: doc._id!.toHexString(),
    title: doc.title,
    subtitle: doc.subtitle,
    description: doc.description,
    archived: doc.archived,
    createdByName: authorName,
    createdAt: doc.createdAt?.toISOString(),
    // Present only while an edit is waiting for its cycle to open.
    pendingEdit: doc.pendingEdit
      ? {
          subtitle: doc.pendingEdit.subtitle,
          description: doc.pendingEdit.description,
          effectiveFrom: doc.pendingEdit.effectiveFrom,
          editedAt: doc.pendingEdit.editedAt?.toISOString(),
        }
      : undefined,
  };
}

/**
 * Applies any staged edit whose cycle has opened.
 *
 * Promotion is lazy rather than scheduled: there is no job runner here, and a
 * read is the only moment the result matters. Doing it on read also means the
 * dashboard and the manager's form can never disagree about which wording is
 * live.
 */
async function promoteDueEdits(org: string, period: string): Promise<void> {
  const due = await kpiParameters()
    .find({ org, 'pendingEdit.effectiveFrom': { $lte: period } })
    .toArray();
  if (!due.length) return;
  await Promise.all(
    due.map((row) =>
      kpiParameters().updateOne(
        { _id: row._id },
        {
          $set: {
            subtitle: row.pendingEdit!.subtitle,
            description: row.pendingEdit!.description,
            updatedAt: new Date(),
          },
          $unset: { pendingEdit: '' },
        },
      ),
    ),
  );
}

/** The wording in force for `period`, whether or not promotion has run yet. */
function wordingFor(doc: KpiParameter, period: string) {
  const pending = doc.pendingEdit;
  if (pending && period >= pending.effectiveFrom) {
    return { subtitle: pending.subtitle, description: pending.description };
  }
  return { subtitle: doc.subtitle, description: doc.description };
}

export async function listKpiParameters(adminUserId: string, includeArchived = false) {
  const org = await requireOrg(adminUserId);
  await promoteDueEdits(org, await currentPeriodFor(org));
  const filter = includeArchived ? { org } : { org, archived: false };
  const rows = await kpiParameters().find(filter).sort({ title: 1 }).toArray();
  // One lookup for every author on the page rather than one per row.
  const authorIds = [...new Set(rows.map((r) => r.createdByUserId).filter(Boolean))] as string[];
  const authors = authorIds.length
    ? await users().find({ userId: { $in: authorIds } }).toArray()
    : [];
  const nameById = new Map(authors.map((a) => [a.userId, a.name]));
  return rows.map((r) => parameterView(r, r.createdByUserId ? nameById.get(r.createdByUserId) : undefined));
}

export async function createKpiParameter(
  adminUserId: string,
  input: { title?: unknown; subtitle?: unknown; description?: unknown },
) {
  const org = await requireOrg(adminUserId);
  const now = new Date();
  const doc: KpiParameter = {
    org,
    title: text(input.title, 'Title', MAX_TITLE),
    subtitle: text(input.subtitle, 'Subtitle', MAX_SUBTITLE, false),
    description: text(input.description, 'Description', MAX_DESCRIPTION, false),
    archived: false,
    createdByUserId: adminUserId,
    createdAt: now,
    updatedAt: now,
  };
  const result = await kpiParameters().insertOne(doc);
  const author = await users().findOne({ userId: adminUserId });
  return parameterView({ ...doc, _id: result.insertedId }, author?.name);
}

/**
 * Stages a wording change for the next cycle.
 *
 * Only the subtitle and guidance can change, and never for the cycle in
 * progress: managers are scoring against the current text right now, so
 * rewriting it mid-cycle would leave two managers judging the same parameter
 * against different words. The title is fixed for good, since it is what a sent
 * review is labelled with.
 */
export async function updateKpiParameter(
  adminUserId: string,
  id: string,
  input: { subtitle?: unknown; description?: unknown },
) {
  const org = await requireOrg(adminUserId);
  const period = await currentPeriodFor(org);
  await promoteDueEdits(org, period);

  const _id = objectId(id, 'Parameter id');
  const existing = await kpiParameters().findOne({ _id, org });
  if (!existing) throw new KpiError(404, 'Parameter not found');

  // Staged on top of what is live now, so leaving a field out keeps it.
  const subtitle = input.subtitle !== undefined
    ? text(input.subtitle, 'Subtitle', MAX_SUBTITLE, false)
    : existing.subtitle;
  const description = input.description !== undefined
    ? text(input.description, 'Description', MAX_DESCRIPTION, false)
    : existing.description;

  if (subtitle === existing.subtitle && description === existing.description) {
    // Nothing to schedule; drop any earlier staged edit that this reverts.
    await kpiParameters().updateOne({ _id, org }, { $unset: { pendingEdit: '' } });
    return parameterView({ ...existing, pendingEdit: undefined });
  }

  const pendingEdit = {
    subtitle,
    description,
    effectiveFrom: nextPeriod(period),
    editedByUserId: adminUserId,
    editedAt: new Date(),
  };
  await kpiParameters().updateOne({ _id, org }, { $set: { pendingEdit, updatedAt: new Date() } });
  return parameterView({ ...existing, pendingEdit });
}

/** Drops a staged edit, leaving the live wording untouched. */
export async function cancelKpiParameterEdit(adminUserId: string, id: string) {
  const org = await requireOrg(adminUserId);
  const _id = objectId(id, 'Parameter id');
  const result = await kpiParameters().updateOne({ _id, org }, { $unset: { pendingEdit: '' } });
  if (!result.matchedCount) throw new KpiError(404, 'Parameter not found');
  return { id, cancelled: true };
}

/**
 * Archives rather than deletes. Templates, assignments and sent reviews all
 * reference parameters by id, and a sent review must stay readable.
 */
export async function archiveKpiParameter(adminUserId: string, id: string, archived: boolean) {
  const org = await requireOrg(adminUserId);
  const _id = objectId(id, 'Parameter id');
  const result = await kpiParameters().updateOne(
    { _id, org },
    { $set: { archived, updatedAt: new Date() } },
  );
  if (!result.matchedCount) throw new KpiError(404, 'Parameter not found');
  return { id, archived };
}

/**
 * Removes a parameter, but only while nothing references it.
 *
 * Deleting one that is referenced would leave dangling ids: a template that
 * silently loses a parameter, an assignment a manager is scoring against, or a
 * sent review whose `parameterId` no longer resolves — which is what makes a
 * KPI trendable across cycles. Every period is checked, not just the current
 * one, so history is safe.
 */
export async function deleteKpiParameter(adminUserId: string, id: string) {
  const org = await requireOrg(adminUserId);
  const _id = objectId(id, 'Parameter id');
  const existing = await kpiParameters().findOne({ _id, org });
  if (!existing) throw new KpiError(404, 'Parameter not found');
  const hex = _id.toHexString();

  const [templates, assignments, reviews] = await Promise.all([
    kpiTemplates().countDocuments({ org, parameterIds: hex }),
    kpiAssignments().countDocuments({ org, parameterIds: hex }),
    // Parameter ids are globally unique, so this needs no org scoping.
    feedbackRecords().countDocuments({ 'parameters.parameterId': hex }),
  ]);

  if (templates || assignments || reviews) {
    const used = [
      templates && `${templates} template${templates === 1 ? '' : 's'}`,
      assignments && `${assignments} employee assignment${assignments === 1 ? '' : 's'}`,
      reviews && `${reviews} submitted review${reviews === 1 ? '' : 's'}`,
    ].filter(Boolean).join(', ');
    throw new KpiError(409, `"${existing.title}" is still used by ${used}, so it cannot be deleted.`);
  }

  await kpiParameters().deleteOne({ _id, org });
  return { id, deleted: true };
}

/** Weights total this, as whole percentage points. */
const WEIGHT_TOTAL = 100;

/**
 * Percentage weights for a parameter set, defaulting to an even split.
 *
 * They must cover exactly the given ids and sum to 100, so the weighted mean of
 * 0-5 parameter scores is itself on the 0-5 scale. An even split that does not
 * divide cleanly puts the remainder on the first parameters, one point each,
 * rather than leaving the total short.
 */
function resolveWeights(parameterIds: string[], input: unknown): Record<string, number> {
  if (input === undefined || input === null) {
    const base = Math.floor(WEIGHT_TOTAL / parameterIds.length);
    let remainder = WEIGHT_TOTAL - base * parameterIds.length;
    const out: Record<string, number> = {};
    for (const id of parameterIds) {
      out[id] = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
    }
    return out;
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new KpiError(400, 'Weights must be an object of parameter id to percentage');
  }
  const raw = input as Record<string, unknown>;
  const out: Record<string, number> = {};
  let total = 0;
  for (const id of parameterIds) {
    const value = Number(raw[id]);
    if (!Number.isInteger(value) || value < 1 || value > WEIGHT_TOTAL) {
      throw new KpiError(400, `Each weight must be a whole number from 1 to ${WEIGHT_TOTAL}`);
    }
    out[id] = value;
    total += value;
  }
  const extra = Object.keys(raw).filter((id) => !parameterIds.includes(id));
  if (extra.length) throw new KpiError(400, 'Weights include parameters that are not in the set');
  if (total !== WEIGHT_TOTAL) {
    throw new KpiError(400, `Weights must add up to ${WEIGHT_TOTAL}% — they currently total ${total}%`);
  }
  return out;
}

/** Stored weights, or an even split for sets written before weighting existed. */
export function weightsOrEven(
  parameterIds: string[],
  weights?: Record<string, number>,
): Record<string, number> {
  if (weights && parameterIds.every((id) => typeof weights[id] === 'number')) return weights;
  return resolveWeights(parameterIds, undefined);
}

/** Validates that every id exists in this org and is not archived. */
async function resolveParameterIds(org: string, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new KpiError(400, 'At least one parameter is required');
  }
  if (ids.length > MAX_PARAMETERS_PER_SET) {
    throw new KpiError(400, `A set cannot exceed ${MAX_PARAMETERS_PER_SET} parameters`);
  }
  const unique = [...new Set(ids.map((id) => String(id)))];
  if (unique.length !== ids.length) throw new KpiError(400, 'Parameters must be unique');
  const found = await kpiParameters()
    .find({ org, _id: { $in: unique.map((id) => objectId(id, 'Parameter id')) } })
    .toArray();
  if (found.length !== unique.length) throw new KpiError(400, 'One or more parameters do not exist');
  const archived = found.filter((row) => row.archived);
  if (archived.length) {
    throw new KpiError(400, `Cannot use archived parameters: ${archived.map((r) => r.title).join(', ')}`);
  }
  return unique;
}

// ----------------------------------------------------------------- templates

function templateView(doc: KpiTemplate & { _id?: ObjectId }) {
  return {
    id: doc._id!.toHexString(),
    name: doc.name,
    description: doc.description,
    parameterIds: doc.parameterIds,
    weights: weightsOrEven(doc.parameterIds, doc.weights),
    // Defaulted: templates created before targeting gained these facets have
    // them absent, and an absent facet means "no constraint" either way.
    locations: doc.locations ?? [],
    designations: doc.designations ?? [],
    departments: doc.departments ?? [],
    managerUserIds: doc.managerUserIds ?? [],
  };
}

/** Trimmed, de-duplicated, empties dropped — the shape every facet is stored in. */
function facet(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))];
}

const FACETS = ['locations', 'designations', 'departments', 'managerUserIds'] as const;

/** Only the facets present on `input`, so a partial update leaves the rest alone. */
function facetUpdate(input: Record<string, unknown>) {
  const out: Record<string, string[]> = {};
  for (const key of FACETS) {
    if (input[key] !== undefined) out[key] = facet(input[key]);
  }
  return out;
}

export async function listKpiTemplates(adminUserId: string) {
  const org = await requireOrg(adminUserId);
  const [rows, counts] = await Promise.all([
    kpiTemplates().find({ org }).sort({ name: 1 }).toArray(),
    templateUsage(org),
  ]);
  return rows.map((row) => {
    const id = row._id!.toHexString();
    const use = counts.get(id) ?? { employees: 0, upcoming: 0, assignments: 0 };
    return {
      ...templateView(row),
      employeeCount: use.employees,
      upcomingCount: use.upcoming,
      assignmentCount: use.assignments,
    };
  });
}

/**
 * People on each template: distinct employees in the live cycle, and every
 * assignment ever made from it.
 *
 * The first is what HR wants to see; the second is what makes deletion safe,
 * since a template nobody is on today may still be what a past cycle's
 * assignment was built from.
 */
async function templateUsage(org: string) {
  const period = await currentPeriodFor(org);
  const upcoming = nextPeriod(period);
  const rows = await kpiAssignments()
    .find({ org, templateId: { $exists: true } })
    .project({ templateId: 1, userId: 1, period: 1 })
    .toArray();
  const out = new Map<string, { employees: number; upcoming: number; assignments: number }>();
  const live = new Map<string, Set<string>>();
  const next = new Map<string, Set<string>>();
  for (const row of rows as unknown as { templateId: string; userId: string; period: string }[]) {
    const entry = out.get(row.templateId) ?? { employees: 0, upcoming: 0, assignments: 0 };
    entry.assignments += 1;
    out.set(row.templateId, entry);
    const bucket = row.period === period ? live : row.period === upcoming ? next : null;
    if (bucket) {
      const users = bucket.get(row.templateId) ?? new Set<string>();
      users.add(row.userId);
      bucket.set(row.templateId, users);
    }
  }
  for (const [id, users] of live) out.get(id)!.employees = users.size;
  for (const [id, users] of next) out.get(id)!.upcoming = users.size;
  return out;
}

export async function createKpiTemplate(
  adminUserId: string,
  input: Record<string, unknown>,
) {
  const org = await requireOrg(adminUserId);
  const now = new Date();
  const parameterIds = await resolveParameterIds(org, input.parameterIds);
  const doc: KpiTemplate = {
    org,
    name: text(input.name, 'Name', MAX_TITLE),
    description: text(input.description, 'Description', MAX_SUBTITLE, false),
    parameterIds,
    weights: resolveWeights(parameterIds, input.weights),
    locations: facet(input.locations),
    designations: facet(input.designations),
    departments: facet(input.departments),
    managerUserIds: facet(input.managerUserIds),
    createdAt: now,
    updatedAt: now,
  };
  try {
    const result = await kpiTemplates().insertOne(doc);
    return templateView({ ...doc, _id: result.insertedId });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new KpiError(409, 'A template with that name already exists');
    }
    throw error;
  }
}

export async function updateKpiTemplate(
  adminUserId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const org = await requireOrg(adminUserId);
  const _id = objectId(id, 'Template id');
  const existing = await kpiTemplates().findOne({ _id, org });
  if (!existing) throw new KpiError(404, 'Template not found');
  const update = {
    ...(input.name !== undefined ? { name: text(input.name, 'Name', MAX_TITLE) } : {}),
    ...(input.description !== undefined
      ? { description: text(input.description, 'Description', MAX_SUBTITLE, false) } : {}),
    ...(input.parameterIds !== undefined
      ? { parameterIds: await resolveParameterIds(org, input.parameterIds) } : {}),
    ...facetUpdate(input),
    updatedAt: new Date(),
  };
  await kpiTemplates().updateOne({ _id, org }, { $set: update });
  // Deliberately does not touch existing assignments: an assignment is what the
  // employee is being judged on this cycle and must not shift mid-review.
  return templateView({ ...existing, ...update });
}

/**
 * Everyone in the org this template's targeting selects, with what they already
 * have for the cycle so HR can see who would be overwritten before assigning.
 *
 * Facets intersect: a populated facet must match, an empty one is ignored. A
 * template with no facets at all targets the whole org, which is deliberate —
 * "everyone" is a legitimate thing to want.
 */
export async function kpiTemplateAudience(
  adminUserId: string,
  id: string,
  periodInput: unknown,
) {
  const org = await requireOrg(adminUserId);
  const period = requirePeriod(periodInput);
  const template = await kpiTemplates().findOne({ _id: objectId(id, 'Template id'), org });
  if (!template) throw new KpiError(404, 'Template not found');

  const locations = template.locations ?? [];
  const designations = template.designations ?? [];
  const departments = template.departments ?? [];
  const managerUserIds = template.managerUserIds ?? [];

  const roster = await users().find({ org }).sort({ name: 1 }).toArray();
  const matched = roster.filter((u) => {
    if (locations.length && !locations.includes(u.location ?? '')) return false;
    if (designations.length && !designations.includes(u.designation ?? '')) return false;
    if (departments.length && !departments.includes(u.department ?? '')) return false;
    if (managerUserIds.length && !managerUserIds.includes(u.managerUserId ?? '')) return false;
    return true;
  });

  const assignments = await kpiAssignments()
    .find({ org, period, userId: { $in: matched.map((u) => u.userId) } })
    .toArray();
  const assignedByUser = new Map(assignments.map((a) => [a.userId, a]));
  const templateId = template._id!.toHexString();

  return {
    templateId,
    period,
    audience: matched.map((u) => {
      const current = assignedByUser.get(u.userId);
      return {
        userId: u.userId,
        name: u.name,
        employeeId: u.employeeId,
        designation: u.designation,
        location: u.location ?? u.branch,
        department: u.department,
        // Already carrying this exact template, so assigning again is a no-op.
        hasThisTemplate: current?.templateId === templateId,
        // Carrying something else — assigning would replace it.
        hasOtherAssignment: Boolean(current) && current?.templateId !== templateId,
        parameterCount: current?.parameterIds.length ?? 0,
      };
    }),
  };
}

/**
 * Employees matching an ad-hoc rule set, with what they currently hold.
 *
 * Separate from `kpiTemplateAudience`, which reads a template's own stored
 * rules. Bulk assignment builds its rules on the spot and only picks a template
 * at the end, so the two are not the same question.
 */
export async function resolveKpiAudience(
  adminUserId: string,
  input: { period?: unknown } & Record<string, unknown>,
) {
  const org = await requireOrg(adminUserId);
  const period = requirePeriod(input.period);

  const locations = facet(input.locations);
  const designations = facet(input.designations);
  const departments = facet(input.departments);
  const managerUserIds = facet(input.managerUserIds);

  const roster = await users().find({ org }).sort({ name: 1 }).toArray();
  const matched = roster.filter((u) => {
    if (locations.length && !locations.includes(u.location ?? '')) return false;
    if (designations.length && !designations.includes(u.designation ?? '')) return false;
    if (departments.length && !departments.includes(u.department ?? '')) return false;
    if (managerUserIds.length && !managerUserIds.includes(u.managerUserId ?? '')) return false;
    return true;
  });

  const [assignments, templates] = await Promise.all([
    kpiAssignments().find({ org, period, userId: { $in: matched.map((u) => u.userId) } }).toArray(),
    kpiTemplates().find({ org }).toArray(),
  ]);
  const assignedByUser = new Map(assignments.map((a) => [a.userId, a]));
  const templateName = new Map(templates.map((t) => [t._id!.toHexString(), t.name]));
  const nameById = new Map(roster.map((u) => [u.userId, u.name]));

  return {
    period,
    audience: matched.map((u) => {
      const current = assignedByUser.get(u.userId);
      return {
        userId: u.userId,
        name: u.name,
        employeeId: u.employeeId,
        designation: u.designation,
        department: u.department,
        location: u.location,
        managerName: u.managerUserId ? nameById.get(u.managerUserId) : undefined,
        // What they hold right now, so overwriting is a visible choice.
        currentTemplateId: current?.templateId,
        currentTemplateName: current?.templateId ? templateName.get(current.templateId) : undefined,
        parameterCount: current?.parameterIds.length ?? 0,
      };
    }),
  };
}

/**
 * The employees on a template for a cycle, with the detail an export needs.
 *
 * Reads the assignments rather than re-running any rules: this answers "who is
 * actually on it", which after individual edits is not the same question as
 * "who would the rules pick".
 */
export async function kpiTemplateMembers(
  adminUserId: string,
  id: string,
  periodInput: unknown,
) {
  const org = await requireOrg(adminUserId);
  const period = requirePeriod(periodInput);
  const template = await kpiTemplates().findOne({ _id: objectId(id, 'Template id'), org });
  if (!template) throw new KpiError(404, 'Template not found');

  const assignments = await kpiAssignments().find({ org, period, templateId: id }).toArray();
  if (!assignments.length) return { period, templateName: template.name, members: [] };

  const roster = await users().find({ org }).toArray();
  const byId = new Map(roster.map((u) => [u.userId, u]));
  const nameById = new Map(roster.map((u) => [u.userId, u.name]));

  const members = assignments
    .map((a) => {
      const u = byId.get(a.userId);
      if (!u) return null;
      return {
        userId: u.userId,
        name: u.name,
        employeeId: u.employeeId,
        designation: u.designation,
        department: u.department,
        location: u.location,
        managerName: u.managerUserId ? nameById.get(u.managerUserId) : undefined,
        // Their own weights, which may differ from the template's after an
        // individual edit — that difference is the point of exporting.
        weights: weightsOrEven(a.parameterIds, a.weights),
        parameterIds: a.parameterIds,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { period, templateName: template.name, members };
}

/** Assigns one template to many employees for a cycle, replacing what they had. */
export async function assignTemplateToUsers(
  adminUserId: string,
  id: string,
  input: { userIds?: unknown; period?: unknown },
) {
  const org = await requireOrg(adminUserId);
  const period = requirePeriod(input.period);
  const template = await kpiTemplates().findOne({ _id: objectId(id, 'Template id'), org });
  if (!template) throw new KpiError(404, 'Template not found');

  await requireFutureCycle(org, period);

  const userIds = Array.isArray(input.userIds)
    ? [...new Set(input.userIds.map((u) => String(u).trim()).filter(Boolean))]
    : [];
  if (!userIds.length) throw new KpiError(400, 'Select at least one employee');

  // Every id must be someone in this org — never assign across a tenant.
  const found = await users().find({ org, userId: { $in: userIds } }).toArray();
  if (found.length !== userIds.length) {
    throw new KpiError(400, 'One or more employees are not in this company');
  }

  // Re-resolved rather than trusting the stored list: a parameter may have been
  // archived since the template was built.
  const parameterIds = await resolveParameterIds(org, template.parameterIds);
  // Carried across with the parameters: an assignment materialises the whole
  // set, and a set without its weights silently becomes an even split.
  const weights = weightsOrEven(parameterIds, template.weights);
  const templateId = template._id!.toHexString();
  const now = new Date();

  await kpiAssignments().bulkWrite(
    found.map((u) => ({
      updateOne: {
        filter: { org, userId: u.userId, period },
        update: {
          $set: { parameterIds, weights, templateId, assignedByUserId: adminUserId, updatedAt: now },
          $setOnInsert: { org, userId: u.userId, period, createdAt: now },
        },
        upsert: true,
      },
    })),
  );

  return { templateId, period, assigned: found.length };
}

/** Deletable only while nobody is assigned from it, in any cycle. */
export async function deleteKpiTemplate(adminUserId: string, id: string) {
  const org = await requireOrg(adminUserId);
  const _id = objectId(id, 'Template id');
  const existing = await kpiTemplates().findOne({ _id, org });
  if (!existing) throw new KpiError(404, 'Template not found');

  const assignments = await kpiAssignments().countDocuments({ org, templateId: id });
  if (assignments > 0) {
    throw new KpiError(
      409,
      `"${existing.name}" is assigned to ${assignments} employee${assignments === 1 ? '' : 's'}, so it cannot be deleted. Move them to another template first.`,
    );
  }

  await kpiTemplates().deleteOne({ _id, org });
  return { id, deleted: true };
}

// --------------------------------------------------------------- assignments

async function assignmentView(doc: KpiAssignment) {
  const params = await kpiParameters()
    .find({ _id: { $in: doc.parameterIds.map((id) => new ObjectId(id)) } })
    .toArray();
  const byId = new Map(params.map((p) => [p._id!.toHexString(), p]));
  return {
    userId: doc.userId,
    period: doc.period,
    templateId: doc.templateId,
    weights: weightsOrEven(doc.parameterIds, doc.weights),
    // Ordered as assigned, which is the order the manager sees on the form.
    parameters: doc.parameterIds
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      // Wrapped rather than passed by reference: `map` would supply the index
      // as the author-name argument.
      .map((p) => parameterView(p)),
  };
}

export async function getKpiAssignment(adminUserId: string, userId: string, periodInput: unknown) {
  const org = await requireOrg(adminUserId);
  const period = requirePeriod(periodInput);
  const doc = await kpiAssignments().findOne({ org, userId, period });
  return doc ? assignmentView(doc) : null;
}

export async function listKpiAssignments(adminUserId: string, periodInput: unknown) {
  const org = await requireOrg(adminUserId);
  const period = requirePeriod(periodInput);
  const rows = await kpiAssignments().find({ org, period }).toArray();
  return Promise.all(rows.map(assignmentView));
}

/**
 * Assigns a set to one employee for one cycle, replacing whatever was there.
 *
 * Either `templateId` (copied at assign time) or an explicit `parameterIds`
 * list. Copying rather than referencing is what lets HR then add or remove
 * parameters for this one person without touching the template.
 */
export async function assignKpis(
  adminUserId: string,
  input: {
    userId?: unknown; period?: unknown; templateId?: unknown;
    parameterIds?: unknown; weights?: unknown;
  },
) {
  const org = await requireOrg(adminUserId);
  const userId = String(input.userId ?? '').trim();
  if (!userId) throw new KpiError(400, 'userId is required');
  const period = requirePeriod(input.period);

  const employee = await users().findOne({ userId, org });
  if (!employee) throw new KpiError(404, 'Employee not found in this company');
  await requireFutureCycle(org, period);

  let parameterIds: string[];
  let weights: Record<string, number>;
  let templateId: string | undefined;
  if (input.templateId && input.parameterIds === undefined) {
    templateId = String(input.templateId);
    const template = await kpiTemplates().findOne({ _id: objectId(templateId, 'Template id'), org });
    if (!template) throw new KpiError(404, 'Template not found');
    // Validated again: a parameter may have been archived since the template
    // was built.
    parameterIds = await resolveParameterIds(org, template.parameterIds);
    weights = weightsOrEven(parameterIds, template.weights);
  } else {
    templateId = input.templateId ? String(input.templateId) : undefined;
    parameterIds = await resolveParameterIds(org, input.parameterIds);
    // An explicit set may have added or dropped parameters relative to the
    // template it started from, so the weights have to be given for this set.
    weights = resolveWeights(parameterIds, input.weights);
  }

  const now = new Date();
  await kpiAssignments().updateOne(
    { org, userId, period },
    {
      $set: { parameterIds, weights, templateId, assignedByUserId: adminUserId, updatedAt: now },
      $setOnInsert: { org, userId, period, createdAt: now },
    },
    { upsert: true },
  );
  const saved = await kpiAssignments().findOne({ org, userId, period });
  return assignmentView(saved!);
}

export async function removeKpiAssignment(
  adminUserId: string,
  userId: string,
  periodInput: unknown,
) {
  const org = await requireOrg(adminUserId);
  const period = requirePeriod(periodInput);
  const result = await kpiAssignments().deleteOne({ org, userId, period });
  if (!result.deletedCount) throw new KpiError(404, 'Assignment not found');
  return { userId, period, deleted: true };
}

/**
 * The parameters a manager scores an employee on, for one cycle.
 *
 * Used by the feedback flow rather than the dashboard. Returns an empty list
 * when nothing is assigned — there is no default set, so feedback cannot be
 * given until HR assigns one.
 */
export async function assignedParametersFor(
  org: string,
  userId: string,
  period: string,
): Promise<Array<{ id: string; title: string; subtitle: string; description: string; weight: number }>> {
  const doc = await kpiAssignments().findOne({ org, userId, period });
  if (!doc) return [];
  const params = await kpiParameters()
    .find({ _id: { $in: doc.parameterIds.map((id) => new ObjectId(id)) } })
    .toArray();
  const byId = new Map(params.map((p) => [p._id!.toHexString(), p]));
  const weights = weightsOrEven(doc.parameterIds, doc.weights);
  return doc.parameterIds
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      id: p._id!.toHexString(),
      title: p.title,
      weight: weights[p._id!.toHexString()] ?? 0,
      // Resolved for the cycle being asked about, so a staged edit that has not
      // opened yet cannot change the form a manager is filling in now.
      ...wordingFor(p, period),
    }));
}
