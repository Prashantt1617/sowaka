/**
 * Paid Days Templates: how attendance becomes paid days, per person, apart
 * from the salary template. Every company has one Default; anyone without a
 * template of their own is on it. The first time a company's templates are
 * read, the Default is made from the paid-days settings its salary templates
 * carried until now (and a template for any salary template that differed,
 * given to the people on it), so no one's pay changes with the move.
 */
import { paidDaysTemplates, salaryStructures, salaryTemplates, users } from '../config/db';
import { requestViewer } from '../middleware/request-viewer';
import { PaidDaysTemplate } from '../models/paidDaysTemplate.model';
import { SalaryDeductionRule } from '../models/deduction.model';
import { parseDeductionRules } from './salaryTemplate.service';

export class PaidDaysTemplateError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'PaidDaysTemplateError';
  }
}

export const DEFAULT_PAID_DAYS_CODE = 'DEFAULT';

type Settings = Pick<PaidDaysTemplate, 'allDaysPaid' | 'deductionRules' | 'monthlyPaidLeaveDays'>;

const settingsKey = (s: Settings) => JSON.stringify([s.allDaysPaid, s.deductionRules, s.monthlyPaidLeaveDays]);

type LegacyTemplate = { code: string; name: string; paidDaysEnabled?: boolean; deductionRules?: SalaryDeductionRule[]; monthlyPaidLeaveDays?: number };
export interface PaidDaysSeedPlan {
  templates: (Omit<PaidDaysTemplate, 'org' | 'createdAt' | 'updatedAt'>)[];
  /** Salary template code → the paid days template its people move to (only where it differs from the Default). */
  moves: { salaryTemplateCode: string; paidDaysTemplateCode: string }[];
}

/** What the first read makes from the salary templates' old settings (pure, for the seed and its check). */
export function planPaidDaysSeed(templates: LegacyTemplate[], peopleOn: Map<string, number>): PaidDaysSeedPlan {
  const settingsOf = (t: LegacyTemplate): Settings => ({
    allDaysPaid: !(t.paidDaysEnabled ?? true),
    deductionRules: t.deductionRules ?? [],
    monthlyPaidLeaveDays: t.monthlyPaidLeaveDays ?? 0,
  });
  // The Default carries the settings most people are paid by now.
  const ranked = [...templates].sort((a, b) => (peopleOn.get(b.code) ?? 0) - (peopleOn.get(a.code) ?? 0) || a.name.localeCompare(b.name));
  const base: Settings = ranked[0] ? settingsOf(ranked[0]) : { allDaysPaid: false, deductionRules: [], monthlyPaidLeaveDays: 0 };
  const plan: PaidDaysSeedPlan = {
    templates: [{ code: DEFAULT_PAID_DAYS_CODE, name: 'Default', description: 'For everyone not given another paid days template', ...base, isDefault: true }],
    moves: [],
  };
  for (const t of ranked.slice(1)) {
    const own = settingsOf(t);
    if (settingsKey(own) === settingsKey(base)) continue;
    const code = t.code === DEFAULT_PAID_DAYS_CODE ? `${t.code}_1` : t.code;
    plan.templates.push({ code, name: t.name, description: `Moved from the "${t.name}" salary template`, ...own, isDefault: false });
    plan.moves.push({ salaryTemplateCode: t.code, paidDaysTemplateCode: code });
  }
  return plan;
}

/** Make the company's templates from its salary templates' old settings, once. */
export async function ensurePaidDaysTemplates(org: string): Promise<void> {
  // Seeded once the Default exists: it is written last, so an interrupted seed finishes next time.
  if (await paidDaysTemplates().countDocuments({ org, isDefault: true }, { limit: 1 })) return;
  const templates = await salaryTemplates().find({ org }).toArray();
  const counts = new Map<string, number>();
  for (const t of templates) counts.set(t.code, await salaryStructures().countDocuments({ org, salaryTemplateCode: t.code }));
  const plan = planPaidDaysSeed(templates, counts);
  const now = new Date();
  const seed = (t: PaidDaysSeedPlan['templates'][number]) =>
    paidDaysTemplates().updateOne({ org, code: t.code }, { $setOnInsert: { ...t, org, createdAt: now, updatedAt: now } }, { upsert: true });
  for (const t of plan.templates.filter((x) => !x.isDefault)) await seed(t);
  for (const m of plan.moves) {
    await salaryStructures().updateMany(
      { org, salaryTemplateCode: m.salaryTemplateCode, paidDaysTemplateCode: { $exists: false } },
      { $set: { paidDaysTemplateCode: m.paidDaysTemplateCode } },
    );
  }
  for (const t of plan.templates.filter((x) => x.isDefault)) await seed(t);
}

/** For a payroll run: each template by code, and the Default. */
export async function paidDaysResolver(org: string) {
  await ensurePaidDaysTemplates(org);
  const all = await paidDaysTemplates().find({ org }).toArray();
  const byCode = new Map(all.map((t) => [t.code, t]));
  const fallback = all.find((t) => t.isDefault) ?? byCode.get(DEFAULT_PAID_DAYS_CODE) ?? all[0];
  return (code: string | undefined): PaidDaysTemplate | undefined => (code ? byCode.get(code) : undefined) ?? fallback;
}

// —— API ——

async function orgOf(adminUserId: string): Promise<string> {
  const admin = requestViewer(adminUserId) ?? (await users().findOne({ userId: adminUserId }, { projection: { _id: 0, org: 1 } }));
  if (!admin?.org) throw new PaidDaysTemplateError(409, 'User is not attached to a company');
  return admin.org;
}

function view(t: PaidDaysTemplate, people: number) {
  return {
    code: t.code,
    name: t.name,
    description: t.description ?? '',
    allDaysPaid: t.allDaysPaid,
    deductionRules: t.deductionRules,
    monthlyPaidLeaveDays: t.monthlyPaidLeaveDays,
    isDefault: t.isDefault,
    people,
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** How many people each template applies to: those given it, and for the Default everyone else with a salary. */
async function peopleCounts(org: string, all: PaidDaysTemplate[]) {
  const structures = await salaryStructures().find({ org }, { projection: { _id: 0, paidDaysTemplateCode: 1 } }).toArray();
  const codes = new Set(all.map((t) => t.code));
  const def = all.find((t) => t.isDefault)?.code;
  const counts = new Map<string, number>();
  for (const s of structures) {
    const code = s.paidDaysTemplateCode && codes.has(s.paidDaysTemplateCode) ? s.paidDaysTemplateCode : def;
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

export async function listPaidDaysTemplates(adminUserId: string) {
  const org = await orgOf(adminUserId);
  await ensurePaidDaysTemplates(org);
  const all = await paidDaysTemplates().find({ org }).sort({ isDefault: -1, name: 1 }).toArray();
  const counts = await peopleCounts(org, all);
  return all.map((t) => view(t, counts.get(t.code) ?? 0));
}

function parse(input: Record<string, unknown>): Omit<PaidDaysTemplate, 'org' | 'code' | 'isDefault' | 'createdAt' | 'updatedAt'> {
  const name = String(input.name ?? '').trim();
  if (!name) throw new PaidDaysTemplateError(400, 'Enter a name');
  if (name.length > 80) throw new PaidDaysTemplateError(400, 'The name is at most 80 characters');
  const description = String(input.description ?? '').trim();
  if (description.length > 500) throw new PaidDaysTemplateError(400, 'The description is at most 500 characters');
  let deductionRules: SalaryDeductionRule[];
  try {
    deductionRules = parseDeductionRules(input.deductionRules);
  } catch (e) {
    throw new PaidDaysTemplateError(400, (e as Error).message);
  }
  const leave = input.monthlyPaidLeaveDays === undefined || input.monthlyPaidLeaveDays === null ? 0 : Math.round(Number(input.monthlyPaidLeaveDays) * 2) / 2;
  if (!Number.isFinite(leave) || leave < 0 || leave > 31) throw new PaidDaysTemplateError(400, 'Paid leave days a month must be 0 to 31, in halves');
  return { name, description, allDaysPaid: Boolean(input.allDaysPaid), deductionRules, monthlyPaidLeaveDays: leave };
}

function codeFor(name: string, taken: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'PAID_DAYS';
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base}_${i}`;
  return code;
}

export async function createPaidDaysTemplate(adminUserId: string, input: Record<string, unknown>) {
  const org = await orgOf(adminUserId);
  await ensurePaidDaysTemplates(org);
  const doc = parse(input);
  const all = await paidDaysTemplates().find({ org }, { projection: { code: 1, name: 1 } }).toArray();
  if (all.some((t) => t.name.toLowerCase() === doc.name.toLowerCase())) throw new PaidDaysTemplateError(409, `A paid days template called "${doc.name}" already exists`);
  const code = codeFor(doc.name, new Set(all.map((t) => t.code)));
  const now = new Date();
  await paidDaysTemplates().insertOne({ ...doc, org, code, isDefault: false, createdAt: now, updatedAt: now });
  return (await listPaidDaysTemplates(adminUserId)).find((t) => t.code === code)!;
}

export async function updatePaidDaysTemplate(adminUserId: string, code: string, input: Record<string, unknown>) {
  const org = await orgOf(adminUserId);
  const doc = parse(input);
  const clash = await paidDaysTemplates().findOne({ org, code: { $ne: code }, name: { $regex: `^${doc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
  if (clash) throw new PaidDaysTemplateError(409, `A paid days template called "${doc.name}" already exists`);
  const result = await paidDaysTemplates().updateOne({ org, code }, { $set: { ...doc, updatedAt: new Date() } });
  if (result.matchedCount === 0) throw new PaidDaysTemplateError(404, 'Paid days template not found');
  return (await listPaidDaysTemplates(adminUserId)).find((t) => t.code === code)!;
}

export async function makeDefaultPaidDaysTemplate(adminUserId: string, code: string) {
  const org = await orgOf(adminUserId);
  const target = await paidDaysTemplates().findOne({ org, code });
  if (!target) throw new PaidDaysTemplateError(404, 'Paid days template not found');
  await paidDaysTemplates().updateMany({ org, code: { $ne: code } }, { $set: { isDefault: false } });
  await paidDaysTemplates().updateOne({ org, code }, { $set: { isDefault: true, updatedAt: new Date() } });
  return listPaidDaysTemplates(adminUserId);
}

export async function deletePaidDaysTemplate(adminUserId: string, code: string) {
  const org = await orgOf(adminUserId);
  const target = await paidDaysTemplates().findOne({ org, code });
  if (!target) throw new PaidDaysTemplateError(404, 'Paid days template not found');
  if (target.isDefault) throw new PaidDaysTemplateError(409, 'The Default cannot be deleted: make another template the Default first');
  const people = await salaryStructures().countDocuments({ org, paidDaysTemplateCode: code });
  if (people > 0) throw new PaidDaysTemplateError(409, `${people} ${people === 1 ? 'person is' : 'people are'} on this template. Move them to another one on their Salary details first.`);
  await paidDaysTemplates().deleteOne({ org, code });
  return { code, deleted: true };
}

/** Give one person a paid days template; null puts them back on the Default. */
export async function assignPaidDaysTemplate(adminUserId: string, userId: string, code: string | null) {
  const org = await orgOf(adminUserId);
  await ensurePaidDaysTemplates(org);
  const structure = await salaryStructures().findOne({ org, userId }, { projection: { _id: 1 } });
  if (!structure) throw new PaidDaysTemplateError(409, 'Assign a salary first');
  if (code) {
    const template = await paidDaysTemplates().findOne({ org, code });
    if (!template) throw new PaidDaysTemplateError(404, 'Paid days template not found');
    // Picking the Default is the same as no template of one's own.
    if (template.isDefault) code = null;
  }
  await salaryStructures().updateOne({ org, userId }, code ? { $set: { paidDaysTemplateCode: code } } : { $unset: { paidDaysTemplateCode: '' } });
  return { userId, paidDaysTemplateCode: code };
}
