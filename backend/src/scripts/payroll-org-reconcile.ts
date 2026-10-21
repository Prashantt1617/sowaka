/**
 * Read-only reconciliation of one org's salary structures: each is computed
 * in memory with the live calculator and checked that its components add
 * back to the monthly CTC to the paisa (gross + reimbursements + employer
 * benefits + employer contributions kept inside CTC). Also reports each
 * template's components and the catalog components no template uses.
 *
 * Prints counts and component codes only — never a person or an amount.
 * Opens its own read-only connection (no index builds, no writes).
 *
 *   npx tsx src/scripts/payroll-org-reconcile.ts convrse
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { PayHead } from '../models/payHead.model';
import { SalaryStructure } from '../models/salaryStructure.model';
import { SalaryTemplate } from '../models/salaryTemplate.model';
import { ResolvedRuleSet, StateStatutoryRule } from '../models/statutoryRule.model';
import { StatutorySettings } from '../models/statutorySettings.model';
import { computePayslip } from '../services/payroll-run.calculator';
import { calculateSalaryStructure } from '../services/salary-calculator';
import { applyOverrides, resolveTemplateComponents } from '../services/salaryTemplate.service';
import { DEFAULT_BONUS, DEFAULT_STATE_RULES } from '../services/statutory.service';
import { defaultStatutorySettings, workStateOf } from '../services/statutorySettings.service';

async function main() {
  const org = process.argv[2];
  const period = process.argv[3] ?? new Date().toISOString().slice(0, 7);
  if (!org) throw new Error('usage: payroll-org-reconcile.ts <org> [YYYY-MM]');
  const client = new MongoClient(process.env.MONGODB_URI!, { readPreference: 'secondaryPreferred' });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB);
    // An end-to-end encrypted org's amounts can't be read here, by design.
    if (await db.collection('payroll_crypto').findOne({ kind: 'org', org, mode: 'encrypted' })) {
      console.log(JSON.stringify({ org, period, encrypted: true, skipped: 'salaries are end-to-end encrypted — skipped' }, null, 1));
      return;
    }
    const [structures, catalog, templates, storedSettings, rules] = await Promise.all([
      db.collection<SalaryStructure>('salary_structures').find({ org }).toArray(),
      db.collection<PayHead>('pay_heads').find({ org }).toArray(),
      db.collection<SalaryTemplate>('salary_templates').find({ org }).toArray(),
      db.collection<StatutorySettings>('statutory_settings').findOne({ org }),
      db.collection<StateStatutoryRule>('statutory_rules').find({ org }).toArray(),
    ]);
    const users = await db
      .collection<{ userId: string; state?: string; location?: string }>('users')
      .find({ userId: { $in: structures.map((s) => s.userId) } }, { projection: { _id: 0, userId: 1, state: 1, location: 1 } })
      .toArray();
    const settings: StatutorySettings = storedSettings ? { ...defaultStatutorySettings(org), ...storedSettings } : defaultStatutorySettings(org);
    const byCode = new Map(catalog.map((h) => [h.code, h]));
    const tplByCode = new Map(templates.map((t) => [t.code, t]));
    const userById = new Map(users.map((u) => [u.userId, u]));
    const ruleSetFor = (stateRaw: string | undefined): ResolvedRuleSet => {
      const state = (stateRaw ?? '').trim().toLowerCase();
      const stored = rules.find((r) => r.state === state);
      const d = DEFAULT_STATE_RULES[state] ?? {};
      return { state, pt: stored?.pt ?? d.pt, lwf: stored?.lwf ?? d.lwf, bonus: stored?.bonus ?? d.bonus ?? DEFAULT_BONUS };
    };

    const result = { org, period, structures: structures.length, active: 0, ok: 0, mismatched: 0, noBalancing: 0, overBudget: 0, errored: 0, reasons: {} as Record<string, number> };
    const reason = (r: string) => (result.reasons[r] = (result.reasons[r] ?? 0) + 1);
    const month = Number(period.slice(5));
    for (const s of structures) {
      if (s.status === 'active') result.active++;
      try {
        const t = s.salaryTemplateCode ? tplByCode.get(s.salaryTemplateCode) : undefined;
        if (!t) throw new Error('template missing');
        const missing = [...t.components.map((c) => c.payHeadCode), ...(s.overrides?.add ?? []).map((a) => a.payHeadCode)].filter((c) => !byCode.has(c));
        if (missing.length) reason(`component not in catalog: ${[...new Set(missing)].join(',')}`);
        const heads = resolveTemplateComponents(applyOverrides(t.components, s.overrides, byCode), byCode);
        const ruleSet = ruleSetFor(workStateOf(userById.get(s.userId) ?? {}));
        const monthly = Math.round(s.annualCtcPaise / 12);
        const base = calculateSalaryStructure({
          monthlyCtcPaise: monthly, payHeads: heads, componentValues: s.componentValues, balancingComponentCode: t.balancingComponentCode,
          ruleSet, month, period, bonusCategory: s.bonusCategory, statutory: s.statutory, settings, statutoryWages: t.statutoryWages,
        });
        const slip = computePayslip(base, { workingDays: 30, lopDays: 0, overtimePaise: 0, reimbursementsPaise: 0, ruleSet, month, statutory: s.statutory, settings, period });
        const reimb = base.reimbursements.reduce((a, l) => a + l.monthlyPaise, 0);
        const ctcFromParts = base.grossMonthlyPaise + reimb + base.benefitsMonthlyPaise + base.includedInCtcPaise;
        const slipConsistent = slip.grossPaise === base.grossMonthlyPaise && slip.netPayablePaise === slip.grossPaise - slip.employeeDeductionsPaise + slip.reimbursementsPaise;
        if (!slipConsistent) reason(`payslip totals do not add up (gross equal: ${slip.grossPaise === base.grossMonthlyPaise}; slip earnings prorate: ${base.earnings.filter((l) => l.prorate).length}/${base.earnings.length}; paid==full: ${slip.earnings.every((e) => e.paidPaise === e.fullPaise)})`);
        if (base.overBudget) { result.overBudget++; reason('components exceed CTC (over budget)'); }
        if (!t.balancingComponentCode) {
          result.noBalancing++;
          if (ctcFromParts !== monthly) reason('template has no balancing component: parts differ from CTC');
        }
        if (ctcFromParts === monthly && slipConsistent) result.ok++;
        else result.mismatched++;
      } catch (e) {
        result.errored++;
        reason(`error: ${(e as Error).message}`);
      }
    }

    const used = new Set(templates.flatMap((t) => t.components.map((c) => c.payHeadCode)));
    const report = {
      ...result,
      catalog: catalog.length,
      activeCatalog: catalog.filter((h) => h.active).length,
      catalogNotInAnyTemplate: catalog.filter((h) => !used.has(h.code)).map((h) => h.code),
      templates: templates.map((t) => ({
        code: t.code,
        components: t.components.map((c) => c.payHeadCode),
        balancing: t.balancingComponentCode ?? null,
        people: structures.filter((s) => s.salaryTemplateCode === t.code).length,
        unknownComponents: t.components.map((c) => c.payHeadCode).filter((c) => !byCode.has(c)),
      })),
    };
    console.log(JSON.stringify(report, null, 1));
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
