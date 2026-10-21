/**
 * Turning a template plus one person's overrides into the component list the
 * calculator takes. Pure, shared by the server and the dashboard.
 */
import type { PayHead } from '../../models/payHead.model';
import type { SalaryTemplateComponent } from '../../models/salaryTemplate.model';
import type { StructureOverrides } from '../../models/salaryStructure.model';

/**
 * A person's component list: the template's, minus what they don't get, with
 * their own calculations where edited, plus what only they get. Basic is never
 * removed. Codes not in the catalog are dropped.
 */
export function applyOverrides(
  components: SalaryTemplateComponent[],
  overrides: StructureOverrides | undefined,
  catalogByCode: Map<string, PayHead>,
): (SalaryTemplateComponent & { source: 'template' | 'edited' | 'added' })[] {
  const removed = new Set((overrides?.remove ?? []).filter((code) => catalogByCode.get(code)?.componentType !== 'basic'));
  const edits = overrides?.edit ?? {};
  const out: (SalaryTemplateComponent & { source: 'template' | 'edited' | 'added' })[] = [];
  for (const c of components) {
    if (removed.has(c.payHeadCode) || !catalogByCode.has(c.payHeadCode)) continue;
    const edited = edits[c.payHeadCode];
    out.push(edited ? { ...c, calculation: edited, source: 'edited' } : { ...c, source: 'template' });
  }
  const present = new Set(out.map((c) => c.payHeadCode));
  for (const a of overrides?.add ?? []) {
    if (present.has(a.payHeadCode) || !catalogByCode.has(a.payHeadCode)) continue;
    present.add(a.payHeadCode);
    out.push({ payHeadCode: a.payHeadCode, calculation: a.calculation, source: 'added' });
  }
  return out;
}

export function resolveTemplateComponents(
  components: SalaryTemplateComponent[],
  catalogByCode: Map<string, PayHead>,
): PayHead[] {
  const resolved: PayHead[] = [];
  for (const c of components) {
    const head = catalogByCode.get(c.payHeadCode);
    if (!head) continue;
    resolved.push({
      ...head,
      calculation: c.calculation,
      // The payslip label and visibility: the template's, else the component's.
      payslipName: c.payslipName?.trim() || head.payslipName,
      showInPayslip: c.showInPayslip ?? head.showInPayslip,
      active: true,
    });
  }
  return resolved;
}

