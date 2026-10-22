// Rule-change proposals: the company's statutory settings against the rule set
// Sowaka ships (per-state PT and LWF defaults, the minimum-wage floor, the EPF
// ceiling). Each difference is a prepared action that applies the shipped rule
// through the statutory services; Undo puts the old value back. Payroll only.
import { statutoryRules } from '../../config/db';
import { DEFAULT_BONUS, DEFAULT_STATE_RULES, upsertStateRule } from '../../services/statutory.service';
import { getStatutoryOverview, statutorySettingsFor, updateStatutorySettings } from '../../services/statutorySettings.service';
import { EPF_CEILING_SCHEDULE, LwfRule, PtRule } from '../../models/statutoryRule.model';
import { MinWageRow } from '../../models/statutorySettings.model';
import { defineTools, rupees, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';

/** When the shipped rule set was last reviewed; the monthly cloud check updates the rules themselves. */
export const RULE_SET_DATE = '2026-10-01';

const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function ptSummary(pt: PtRule | undefined): string {
  if (!pt) return 'no professional tax';
  return pt.slabs.map((s) => `${s.upToPaise === null ? 'above that' : `up to ${rupees(s.upToPaise)}`}: ${rupees(s.amountPaise)}${s.monthOverride ? ` (${rupees(s.monthOverride.amountPaise)} in month ${s.monthOverride.month})` : ''}`).join('; ');
}
export function lwfSummary(lwf: LwfRule | undefined): string {
  if (!lwf) return 'no labour welfare fund';
  const side = (b: LwfRule['employee'] | LwfRule['employer']) => (b.mode === 'flat' ? rupees(b.amountPaise) : b.mode === 'percentage' ? `${b.percent}%${b.capPaise ? ` up to ${rupees(b.capPaise)}` : ''}` : `${b.factor}× employee`);
  return `${lwf.cycle === 'monthly' ? 'monthly' : 'half-yearly'} (months ${lwf.deductionMonths.join(', ')}), employee ${side(lwf.employee)}, employer ${side(lwf.employer)}`;
}

interface Diff {
  key: string;
  title: string;
  yours: string;
  shipped: string;
  why: string;
  /** What Confirm does, and what Undo restores. */
  apply: { kind: 'state_rule'; state: string; field: 'pt' | 'lwf'; value: PtRule | LwfRule; before: PtRule | LwfRule | undefined }
    | { kind: 'lwf_enable'; state: string }
    | { kind: 'min_wages'; state: string; rows: MinWageRow[]; before: Record<string, MinWageRow[]> };
}

/** Everything that differs between this company's settings and the shipped rule set. */
export async function statutoryDiffs(ctx: SuwiContext): Promise<{ diffs: Diff[]; notes: string[]; states: string[] }> {
  const overview = await getStatutoryOverview(ctx.userId);
  const settings = await statutorySettingsFor(ctx.org);
  const diffs: Diff[] = [];
  const notes: string[] = [];
  for (const state of overview.states) {
    const key = state.toLowerCase();
    const shipped = DEFAULT_STATE_RULES[key];
    const stored = await statutoryRules().findOne({ org: ctx.org, state: key });
    if (!shipped) { notes.push(`${title(state)}: Sowaka ships no PT or LWF rule for this state, so whatever is set is used as is.`); continue; }
    if (stored?.pt && !same(stored.pt, shipped.pt)) {
      diffs.push({ key: `pt:${key}`, title: `${title(state)} PT: ${shipped.pt ? `Sowaka's slabs from ${RULE_SET_DATE}` : 'no professional tax in the shipped rules'}`, yours: ptSummary(stored.pt), shipped: ptSummary(shipped.pt), why: 'The slabs your run uses were edited by hand and no longer match the rule set Sowaka maintains for this state.', apply: { kind: 'state_rule', state: key, field: 'pt', value: shipped.pt as PtRule, before: stored.pt } });
    }
    if (stored?.lwf && !same(stored.lwf, shipped.lwf)) {
      diffs.push({ key: `lwf:${key}`, title: `${title(state)} LWF: ${shipped.lwf ? `Sowaka's rule from ${RULE_SET_DATE}` : 'no LWF in the shipped rules'}`, yours: lwfSummary(stored.lwf), shipped: lwfSummary(shipped.lwf), why: 'The LWF amounts or months your run deducts were edited by hand and differ from the rule set Sowaka maintains.', apply: { kind: 'state_rule', state: key, field: 'lwf', value: shipped.lwf as LwfRule, before: stored.lwf } });
    }
    if (shipped.lwf && settings.lwfDisabledStates.includes(key)) {
      diffs.push({ key: `lwfon:${key}`, title: `${title(state)} LWF is switched off`, yours: 'LWF not deducted', shipped: lwfSummary(shipped.lwf), why: `${title(state)} levies Labour Welfare Fund; it is turned off in Statutory Components, so no one there contributes.`, apply: { kind: 'lwf_enable', state: key } });
    }
    if (settings.bonus.enabled && !(settings.bonus.minWages[key]?.length)) {
      const rows: MinWageRow[] = Object.entries(DEFAULT_BONUS.minWageByCategoryPaise).map(([category, minWagePaise]) => ({ category, minWagePaise, effectiveFrom: ctx.today.slice(0, 7) }));
      diffs.push({ key: `minwage:${key}`, title: `${title(state)}: no minimum wages for the statutory bonus`, yours: 'none set', shipped: rows.map((r) => `${r.category.replace('_', '-')} ${rupees(r.minWagePaise)}`).join(', '), why: 'Statutory bonus is on, but with no minimum wage for this state it is worked out on Basic alone; the floor Sowaka ships keeps it at least at the minimum wage.', apply: { kind: 'min_wages', state: key, rows, before: settings.bonus.minWages } });
    }
  }
  const ceiling = EPF_CEILING_SCHEDULE[EPF_CEILING_SCHEDULE.length - 1];
  notes.push(`EPF wage ceiling: ${rupees(ceiling.ceilingPaise)} from ${ceiling.from}, applied automatically to every run; nothing to set.`);
  return { diffs, notes, states: overview.states };
}

defineTools(
  {
    name: 'statutory_rule_check',
    area: 'payroll',
    payroll: true,
    label: () => 'Statutory settings against the shipped rule set',
    description: `Compare this company's statutory settings (PT slabs, LWF, minimum wages for bonus, EPF ceiling) with the rule set Sowaka ships (reviewed ${RULE_SET_DATE}) and list each difference as a proposal with a key. Use prepare_statutory_change with the key to prepare applying one.`,
    input_schema: { type: 'object', properties: {} },
    api: { method: 'GET', path: '/admin/payroll/statutory-settings' },
    async run(ctx) {
      const { diffs, notes, states } = await statutoryDiffs(ctx);
      return {
        data: { ruleSetDate: RULE_SET_DATE, workStates: states, proposals: diffs.map(({ key, title: t, yours, shipped, why }) => ({ key, title: t, yours, shipped, why })), notes, upToDate: diffs.length === 0 },
        links: [{ label: 'Open Statutory Components', view: 'statutorycomponents' }],
      };
    },
  },
  {
    name: 'prepare_statutory_change',
    area: 'payroll',
    payroll: true,
    acts: true,
    label: (i) => `Prepared: apply ${i.key}`,
    description: 'Prepare applying one proposal from statutory_rule_check (by its key). Changes nothing: HR sees a "What will happen" card and confirms; Undo restores the old value.',
    input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    api: { method: 'PUT', path: '/admin/payroll/statutory-settings' },
    async run(ctx, i) {
      const { diffs } = await statutoryDiffs(ctx);
      const d = diffs.find((x) => x.key === str(i.key));
      if (!d) throw new Error(`No open proposal "${str(i.key)}"; run statutory_rule_check for the current list`);
      const nextMonth = `${ctx.today.slice(0, 7)}-01`;
      const proposalId = await propose(ctx, {
        kind: 'statutory_change', area: 'payroll', title: d.title,
        summary: `Now: ${d.yours}. After: ${d.shipped}.`,
        lines: [
          { text: `Statutory Components changes to Sowaka's rule for ${title(d.apply.state)}.`, why: d.why },
          { text: `Applies to every payroll run from this month (${nextMonth}); runs already approved are not re-opened.`, why: 'A run is calculated when it is approved; changing a setting never rewrites an approved run or its payslips.' },
          { text: 'People in other states are not affected.' },
          ...(d.apply.kind === 'min_wages' ? [{ text: 'Check the categories against your people\'s employment categories; the floor is Sowaka\'s neutral default, not a state notification.', tone: 'warn' as const }] : []),
        ],
        effectiveFrom: nextMonth, undoable: true,
        payload: { apply: d.apply, byUserId: ctx.userId },
      });
      return { data: { prepared: true, title: d.title, yours: d.yours, shipped: d.shipped, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId };
    },
  },
);

defineExecutor('statutory_change', {
  async run(p) {
    const { apply, byUserId } = p.payload as { apply: Diff['apply']; byUserId: string };
    if (apply.kind === 'state_rule') {
      await upsertStateRule(byUserId, { state: apply.state, [apply.field]: apply.value });
      return { message: `${title(apply.state)} ${apply.field.toUpperCase()} now follows Sowaka's rule.` };
    }
    if (apply.kind === 'lwf_enable') {
      await updateStatutorySettings(byUserId, { lwf: { state: apply.state, enabled: true } });
      return { message: `LWF switched on for ${title(apply.state)}.` };
    }
    await updateStatutorySettings(byUserId, { bonus: { minWages: { ...apply.before, [apply.state]: apply.rows } } });
    return { message: `Minimum wages set for ${title(apply.state)} (${apply.rows.length} categories).` };
  },
  async undo(p) {
    const { apply, byUserId } = p.payload as { apply: Diff['apply']; byUserId: string };
    if (apply.kind === 'state_rule') {
      if (!apply.before) throw new Error('There was no earlier value to restore');
      await upsertStateRule(byUserId, { state: apply.state, [apply.field]: apply.before });
      return `${title(apply.state)} ${apply.field.toUpperCase()} put back as it was.`;
    }
    if (apply.kind === 'lwf_enable') {
      await updateStatutorySettings(byUserId, { lwf: { state: apply.state, enabled: false } });
      return `LWF switched off again for ${title(apply.state)}.`;
    }
    await updateStatutorySettings(byUserId, { bonus: { minWages: apply.before } });
    return `Minimum wages for ${title(apply.state)} removed again.`;
  },
});
