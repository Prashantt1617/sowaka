/**
 * The people side of salary templates.
 *
 * A pay run pays only people with an ACTIVE salary structure on a template that
 * exists (payrollRun.service buildRunPayslips); everyone else is left out of it
 * without a word. `peopleWithoutSalary` names them for a period, so the run page
 * can say who is missing and why. `assignPeopleToTemplate` puts people on a
 * template from Payroll › Salary templates › Edit employees: each with their
 * annual CTC and the day it applies from, saved one by one through the same
 * upsertSalaryStructure the employee's Salary details use (same checks, same
 * breakup, a revision in the history when the CTC changes).
 */
import { salaryStructures, salaryTemplates, users } from '../config/db';
import { requestViewer } from '../middleware/request-viewer';
import { joinedOn, leftOn } from './attendance-report.service';
import { payrollPeriodHolding, payrollPeriodRange, type PeriodRange } from './payroll-inputs.service';
import { SalaryStructureError, upsertSalaryStructure } from './salaryStructure.service';

/** Why someone is not on a run. */
export type MissingSalaryReason =
  /** No salary structure at all. */
  | 'none'
  /** A structure saved piece by piece, still without a template. */
  | 'no_template'
  /** On a template, still without an annual CTC. */
  | 'no_ctc'
  /** Template and CTC, but saved as a draft. */
  | 'draft'
  /** The template it names was deleted. */
  | 'template_gone';

export interface PersonWithoutSalary {
  userId: string;
  name: string;
  employeeId?: string;
  /** 'YYYY-MM-DD' */
  joiningDate?: string;
  department?: string;
  designation?: string;
  reason: MissingSalaryReason;
  /** The template a half-finished structure names, if any. */
  salaryTemplateCode?: string;
}

const GONE = ['offboarded', 'terminated'];
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_PEOPLE = 300;

const periodOf = (range: PeriodRange) => `${range.year}-${String(range.month).padStart(2, '0')}`;
/** Today in India, 'YYYY-MM-DD'. */
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** The pay period today falls in, by the company's cycle (26th–25th at Convrse). */
async function currentPeriod(org: string): Promise<PeriodRange> {
  const today = istToday();
  return (await payrollPeriodHolding(org, today)) ?? payrollPeriodRange(org, today.slice(0, 7));
}

/**
 * Who a run for `period` (default: the current pay period) leaves out for want
 * of a live salary: people still with the company (not offboarded or
 * terminated, not left before the period began) who joined on or before its
 * last day, and have no active salary structure on an existing template.
 */
export async function peopleWithoutSalary(adminUserId: string, periodInput?: string) {
  const org = await requireAdminOrg(adminUserId);
  const current = await currentPeriod(org);
  if (periodInput !== undefined && periodInput !== '' && !PERIOD.test(periodInput)) {
    throw new SalaryStructureError(400, "period must be in 'YYYY-MM' format");
  }
  const range = periodInput ? await payrollPeriodRange(org, periodInput) : current;
  const [roster, structures, templates] = await Promise.all([
    users()
      .find(
        // Service accounts and counsellors are nobody's employees; nor is anyone who has left.
        { org, lifecycleStatus: { $nin: GONE }, hiddenFromDirectory: { $ne: true }, isCounsellor: { $ne: true } } as never,
        { projection: { _id: 0, userId: 1, name: 1, employeeId: 1, joiningDate: 1, endDate: 1, department: 1, designation: 1 } },
      )
      .toArray(),
    salaryStructures().find({ org }, { projection: { _id: 0, userId: 1, salaryTemplateCode: 1, annualCtcPaise: 1, status: 1 } }).toArray(),
    salaryTemplates().find({ org }, { projection: { _id: 0, code: 1 } }).toArray(),
  ]);
  const templateCodes = new Set(templates.map((t) => t.code));
  const structureOf = new Map(structures.map((s) => [s.userId, s]));
  const people: PersonWithoutSalary[] = [];
  for (const person of roster) {
    const joined = joinedOn(person);
    if (joined && joined > range.to) continue; // not joined yet in this period
    const left = leftOn(person);
    if (left && left < range.from) continue; // left before it began
    const s = structureOf.get(person.userId);
    let reason: MissingSalaryReason | null;
    if (!s) reason = 'none';
    else if (!s.salaryTemplateCode) reason = 'no_template';
    else if (!templateCodes.has(s.salaryTemplateCode)) reason = 'template_gone';
    else if (!(s.annualCtcPaise > 0)) reason = 'no_ctc';
    else if (s.status !== 'active') reason = 'draft';
    else reason = null;
    if (!reason) continue;
    people.push({
      userId: person.userId,
      name: person.name,
      employeeId: person.employeeId || undefined,
      joiningDate: joined,
      department: person.department || undefined,
      designation: person.designation || undefined,
      reason,
      salaryTemplateCode: s?.salaryTemplateCode,
    });
  }
  // Newest joiners first: they are the ones usually missed.
  people.sort((a, b) => (b.joiningDate ?? '').localeCompare(a.joiningDate ?? '') || a.name.localeCompare(b.name));
  return {
    period: periodOf(range),
    from: range.from,
    to: range.to,
    current: { period: periodOf(current), from: current.from, to: current.to },
    people,
  };
}

export interface TemplatePersonResult {
  userId: string;
  name: string;
  ok: boolean;
  /** The template they were on before, when this moved them. */
  movedFrom?: string;
  message?: string;
}

/**
 * Put people on a salary template, each with an annual CTC (required) and the
 * day it applies from. Someone on another template moves: their own component
 * changes belonged to that template and are cleared, their per-person amounts
 * and statutory details stay. Each person is saved on their own; one refusal
 * does not stop the others, and the result says who was not saved and why.
 */
export async function assignPeopleToTemplate(adminUserId: string, codeInput: string, body: unknown) {
  const org = await requireAdminOrg(adminUserId);
  const code = String(codeInput ?? '').trim().toUpperCase();
  const template = await salaryTemplates().findOne({ org, code });
  if (!template) throw new SalaryStructureError(404, 'Salary template not found');
  if (!template.active) throw new SalaryStructureError(409, `${template.name} is inactive: make it active before putting people on it`);

  const raw = (body ?? {}) as { people?: unknown };
  if (!Array.isArray(raw.people) || raw.people.length === 0) throw new SalaryStructureError(400, 'people must be a list of { userId, annualCtcPaise?, effectiveFrom? } (both needed for someone with no salary yet)');
  if (raw.people.length > MAX_PEOPLE) throw new SalaryStructureError(400, `At most ${MAX_PEOPLE} people at a time`);
  const asked = raw.people.map((p) => (p ?? {}) as Record<string, unknown>);
  const ids = asked.map((p) => String(p.userId ?? '').trim());
  if (ids.some((id) => !id)) throw new SalaryStructureError(400, 'Every person needs a userId');
  if (new Set(ids).size !== ids.length) throw new SalaryStructureError(400, 'A person is listed twice');

  const roster = await users()
    .find({ org, userId: { $in: ids } }, { projection: { _id: 0, userId: 1, name: 1, lifecycleStatus: 1 } })
    .toArray();
  const byId = new Map(roster.map((u) => [u.userId, u]));
  const current = new Map(
    (await salaryStructures().find({ org, userId: { $in: ids } }, { projection: { _id: 0, userId: 1, salaryTemplateCode: 1, annualCtcPaise: 1 } }).toArray())
      .map((s) => [s.userId, s]),
  );
  // Everything is checked before anything is saved: a typo in one row saves nobody.
  // Someone who already has a CTC simply moves here with it (25 Nov 2026, HR: "it simply moves to this template
  // and the payroll run after has its calculations on this template"): no CTC or date is asked, and the move
  // applies to the next run's whole period. A pay change with a date is a salary revision, which splits the period.
  const rows = asked.map((p, i) => {
    const userId = ids[i];
    const person = byId.get(userId);
    if (!person) throw new SalaryStructureError(404, `Employee ${userId} is not in this company`);
    if (GONE.includes(person.lifecycleStatus)) throw new SalaryStructureError(409, `${person.name} has left the company`);
    const had = current.get(userId)?.annualCtcPaise ?? 0;
    const keeps = p.annualCtcPaise === undefined || p.annualCtcPaise === null;
    const ctc = keeps ? had : Number(p.annualCtcPaise);
    if (!Number.isInteger(ctc) || ctc <= 0) throw new SalaryStructureError(400, `${person.name}: enter the annual CTC`);
    const from = p.effectiveFrom === undefined || p.effectiveFrom === null || p.effectiveFrom === '' ? '' : String(p.effectiveFrom);
    if (!from && !(keeps && had > 0)) throw new SalaryStructureError(400, `${person.name}: pick the day their salary applies from`);
    if (from && (!DAY.test(from) || new Date(`${from}T00:00:00Z`).toISOString().slice(0, 10) !== from)) {
      throw new SalaryStructureError(400, `${person.name}: the effective-from date must be a date, YYYY-MM-DD`);
    }
    return { userId, name: person.name, annualCtcPaise: ctc, effectiveFrom: from || undefined };
  });

  const existing = new Map([...current].map(([id, s]) => [id, s.salaryTemplateCode]));
  const results: TemplatePersonResult[] = [];
  for (const row of rows) {
    const before = existing.get(row.userId);
    const moving = !!before && before !== code;
    try {
      await upsertSalaryStructure(adminUserId, row.userId, {
        salaryTemplateCode: code,
        annualCtcPaise: row.annualCtcPaise,
        ...(row.effectiveFrom ? { effectiveFrom: row.effectiveFrom } : {}),
        status: 'active',
        // As Salary details' Revise does on a change of template: the old template's own changes go.
        ...(moving ? { overrides: {} } : {}),
      });
      results.push({ userId: row.userId, name: row.name, ok: true, ...(moving ? { movedFrom: before } : {}) });
    } catch (error) {
      if (!(error instanceof Error) || !('statusCode' in error)) throw error;
      results.push({ userId: row.userId, name: row.name, ok: false, message: error.message });
    }
  }
  return { template: code, saved: results.filter((r) => r.ok).length, results };
}

async function requireAdminOrg(adminUserId: string): Promise<string> {
  const admin = requestViewer(adminUserId) ?? (await users().findOne({ userId: adminUserId }));
  if (!admin) throw new SalaryStructureError(404, 'User not found');
  if (!admin.org) throw new SalaryStructureError(409, 'User is not attached to a company');
  return admin.org;
}
