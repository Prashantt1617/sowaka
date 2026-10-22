/**
 * Suwi's line on People › Import: after a preview, what in the stored import
 * plan could hurt (people losing their manager, values removed, emails or
 * employee IDs changing, new people with no manager, the account limit), by
 * rule, then phrased in one sentence by the model when it is set up and the
 * company's Suwi budget allows. Reads the plan only; never shows a value.
 */
import { ObjectId } from 'mongodb';
import { getDb, users } from '../config/db';
import type { ImportPlan } from '../services/employeeImport.service';
import { callModel, costUsd, llmConfigured, SUWI_MODEL } from './llm';
import { auditCol, settingsFor, spentThisMonthUsd } from './store';

export interface ImportRisk { key: string; level: 'high' | 'medium' | 'info'; count: number; text: string; people: string[] }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const names = (xs: string[]) => [...new Set(xs)].slice(0, 5);

/** The risks in a plan, most serious first. Pure: no reads, no writes. */
export function importRisks(plan: ImportPlan): ImportRisk[] {
  const out: ImportRisk[] = [];
  const changesOf = (field: string, kind?: string) => plan.updates.filter((u) => u.changes.some((c) => c.field === field && (!kind || c.kind === kind)));
  const add = (key: string, level: ImportRisk['level'], people: string[], text: (n: number) => string, count = people.length) => { if (count) out.push({ key, level, count, text: text(count), people: names(people) }); };

  add('manager_removed', 'high', changesOf('manager', 'removed').map((u) => u.name), (n) => `${plural(n, 'person loses', 'people lose')} their reporting manager`);
  add('email_changed', 'high', changesOf('email', 'changed').map((u) => u.name), (n) => `${plural(n, 'person signs', 'people sign')} in with a new work email`);
  add('employee_id_changed', 'high', changesOf('employeeId').filter((u) => u.changes.some((c) => c.field === 'employeeId' && c.kind !== 'added')).map((u) => u.name), (n) => `${plural(n, 'employee ID changes', 'employee IDs change')} (attendance is matched on it)`);
  const removed = plan.updates.flatMap((u) => u.changes.filter((c) => c.kind === 'removed').map(() => u.name));
  add('values_removed', 'medium', removed, (n) => `${plural(n, 'value is', 'values are')} removed`, removed.length);
  add('manager_changed', 'medium', changesOf('manager', 'changed').map((u) => u.name), (n) => `${plural(n, 'person gets', 'people get')} a new manager (waiting requests move with them)`);
  add('name_changed', 'medium', changesOf('name', 'changed').map((u) => u.name), (n) => `${plural(n, 'name changes', 'names change')}`);
  add('joining_changed', 'medium', changesOf('joiningDate', 'changed').map((u) => u.name), (n) => `${plural(n, 'joining date changes', 'joining dates change')} (leave accrual and tenure use it)`);
  add('ctc_changed', 'medium', changesOf('annualCtc').map((u) => u.name), (n) => `${plural(n, 'salary is', 'salaries are')} set or changed`);

  const managerLabel = plan.columns.find((c) => c.field === 'manager')?.label;
  const newNoManager = plan.newEmployees.filter((n) => !managerLabel || !n.values[managerLabel]).map((n) => n.values[plan.columns.find((c) => c.field === 'name')?.label ?? ''] || `Row ${n.row}`);
  add('new_no_manager', 'medium', newNoManager, (n) => `${plural(n, 'new employee has', 'new employees have')} no reporting manager (they can't apply for leave until they do)`);
  const idLabel = plan.columns.find((c) => c.field === 'employeeId')?.label;
  const newNoId = plan.newEmployees.filter((n) => !idLabel || !n.values[idLabel]).map((n) => n.values[plan.columns.find((c) => c.field === 'name')?.label ?? ''] || `Row ${n.row}`);
  add('new_no_id', 'info', newNoId, (n) => `${plural(n, 'new employee has', 'new employees have')} no employee ID`);

  const lim = plan.accountLimit;
  if (lim.max !== null && lim.afterImport > lim.max) out.push({ key: 'account_limit', level: 'high', count: lim.afterImport - lim.max, text: `${plural(lim.afterImport - lim.max, 'account', 'accounts')} over the plan's limit of ${lim.max}`, people: [] });
  const whole = plan.errors.find((e) => e.row === 0);
  if (whole) out.push({ key: 'blocked', level: 'high', count: 1, text: whole.message, people: [] });
  add('rows_not_imported', 'info', plan.errors.filter((e) => e.row > 0).map((e) => `Row ${e.row}`), (n) => `${plural(n, 'row is', 'rows are')} not imported`);
  add('cells_skipped', 'info', plan.skippedCells.map((c) => c.name), (n) => `${plural(n, 'cell is', 'cells are')} skipped`, plan.skippedCells.length);
  const rank = { high: 0, medium: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** One plain line from the rules alone. */
export function ruleSummary(plan: ImportPlan, risks: ImportRisk[]): string {
  const scale = `${plural(plan.newEmployees.length, 'new employee', 'new employees')}, ${plural(plan.updates.length, 'person', 'people')} updated`;
  const serious = risks.filter((r) => r.level !== 'info');
  if (!serious.length) return `Low risk: ${scale}; nothing removed and no manager, email or ID changes.`;
  const parts = serious.slice(0, 3).map((r) => r.text);
  return `Check before approving: ${parts.join('; ')}${serious.length > 3 ? `; and ${serious.length - 3} more` : ''}. (${scale}.)`;
}

const imports = () => getDb().collection<{ _id: ObjectId; org: string; status: string; plan: ImportPlan; createdByUserId: string }>('employee_imports');

export async function importRiskFor(userId: string, importId: string) {
  const me = await users().findOne({ userId });
  if (!me?.org) throw Object.assign(new Error('No organisation on this account'), { statusCode: 403 });
  // Import is a dashboard admin's page; the summary follows the same rule.
  if (me.dashboardAdmin !== true) throw Object.assign(new Error('Only a dashboard admin can import employee details'), { statusCode: 403 });
  if (!ObjectId.isValid(importId)) throw Object.assign(new Error('Invalid import'), { statusCode: 400 });
  const imp = await imports().findOne({ _id: new ObjectId(importId), org: me.org });
  if (!imp) throw Object.assign(new Error('Import not found'), { statusCode: 404 });
  const settings = await settingsFor(me.org);
  if (!settings.enabled) return { enabled: false as const };

  const risks = importRisks(imp.plan);
  const rules = ruleSummary(imp.plan, risks);
  let summary = rules;
  let phrasedBy: 'rules' | 'model' = 'rules';
  const serious = risks.filter((r) => r.level !== 'info');
  // Only worth a model call when there is something to weigh; within budget.
  if (serious.length && llmConfigured() && (await spentThisMonthUsd(me.org)) < settings.monthlyBudgetUsd) {
    try {
      const facts = { newEmployees: imp.plan.newEmployees.length, peopleUpdated: imp.plan.updates.length, risks: risks.map(({ level, text, people }) => ({ level, text, examples: people.slice(0, 3) })) };
      const reply = await callModel({
        system: 'You are Suwi, the HR assistant in Sowaka. Sum up the risk of an employee import for HR in ONE plain sentence of at most 30 words, before they approve it. Lead with the most serious risk, keep the numbers exactly as given, name at most two people, no advice beyond "check" or "review". No markdown.',
        messages: [{ role: 'user', content: JSON.stringify(facts) }],
        maxTokens: 120,
      });
      const cost = costUsd(reply.model || SUWI_MODEL, reply.usage);
      const text = reply.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim();
      await auditCol().insertOne({ org: me.org, userId, kind: 'question', at: new Date(), page: 'employeeimport', question: 'Import risk summary', answer: text.slice(0, 500), model: SUWI_MODEL, costUsd: cost, tools: [] });
      if (text && text.length <= 400) { summary = text; phrasedBy = 'model'; }
    } catch { /* the rule line stands */ }
  }
  return { enabled: true as const, importId, status: imp.status, level: risks[0]?.level ?? 'info', summary, phrasedBy, risks };
}
