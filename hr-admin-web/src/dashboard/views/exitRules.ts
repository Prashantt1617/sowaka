// Labels and plain-words explanations for the exit rules (Setup › Payroll › Exit settings and Record exit).
import type { ExitRuleKind, ExitRules } from '../../services/hrms';

export const RULE_KIND_LABEL: Record<ExitRuleKind, string> = {
  resigned: 'Resigned', terminated: 'Terminated', absconded: 'Absconded', consultant: 'Moved to consultant', retired: 'Retired', other: 'Other',
};
export const RULE_KINDS: ExitRuleKind[] = ['resigned', 'terminated', 'absconded', 'consultant', 'retired', 'other'];

export const HOLD_PAY_INFO = 'From the day they resign or are told, each month’s payslip is still worked out but not paid. All of it is paid together in the final settlement.';
export const ACCESS_INFO = 'When they are signed out of the app and can no longer sign in. Until then everything works as before.';

type Choices<K extends keyof ExitRules> = { key: K; label: string; hint: string; info: string; options: [ExitRules[K], string][] };
// No notice pay or shortfall columns: notice is off everywhere (24 Nov 2026, HR).
export const RULE_ROWS: [Choices<'holdPay'>, Choices<'access'>] = [
  { key: 'holdPay', label: 'Salary until they leave', hint: 'Held salary is paid with the final settlement', info: HOLD_PAY_INFO, options: [[true, 'Hold'], [false, 'Pay as usual']] },
  { key: 'access', label: 'App turns off', hint: 'They can’t sign in from then on', info: ACCESS_INFO, options: [['day_after', 'Day after last day'], ['at_once', 'Right away'], ['never', 'Never']] },
];
/** A rule's value as a select's string, and back. */
export const asText = (v: ExitRules[keyof ExitRules]) => String(v);
export const fromText = (key: keyof ExitRules, text: string): ExitRules[keyof ExitRules] => (key === 'holdPay' ? text === 'true' : text) as ExitRules[keyof ExitRules];
