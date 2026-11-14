// Labels for the exit rules (Setup › Payroll › Exit settings and the Record exit dialog).
import type { ExitRuleKind, ExitRules } from '../../services/hrms';

export const RULE_KIND_LABEL: Record<ExitRuleKind, string> = {
  resigned: 'Resigned', terminated: 'Terminated', absconded: 'Absconded', consultant: 'Moved to consultant', retired: 'Retired', other: 'Other',
};
export const RULE_KINDS: ExitRuleKind[] = ['resigned', 'terminated', 'absconded', 'consultant', 'retired', 'other'];

type Choices<K extends keyof ExitRules> = { key: K; label: string; hint: string; options: [ExitRules[K], string][] };
export const RULE_ROWS: [Choices<'holdPay'>, Choices<'access'>, Choices<'leaveEncashment'>, Choices<'gratuity'>, Choices<'noticePay'>, Choices<'noticeRecovery'>] = [
  { key: 'holdPay', label: 'Pay from notice', hint: 'Held pay is paid with the final settlement', options: [[true, 'Hold'], [false, 'Pay as usual']] },
  { key: 'access', label: 'App access ends', hint: 'At once, or the day after the last working day', options: [['day_after', 'Next day'], ['at_once', 'At once'], ['never', 'Never']] },
  { key: 'leaveEncashment', label: 'Leave encashment', hint: 'Leave balance paid out in the settlement', options: [['pay', 'Pay'], ['hr_decides', 'HR decides'], ['none', 'Don’t pay']] },
  { key: 'gratuity', label: 'Gratuity', hint: 'After 5 years of service', options: [['pay', 'Pay'], ['hr_decides', 'HR decides'], ['none', 'Don’t pay']] },
  { key: 'noticePay', label: 'Notice pay', hint: 'Paid instead of notice when the company ends the job', options: [['none', 'No'], ['hr_chooses', 'If HR chooses'], ['pay', 'Pay']] },
  { key: 'noticeRecovery', label: 'Notice shortfall', hint: 'Recovered when they leave without serving notice', options: [['none', 'Don’t recover'], ['days_not_served', 'Unserved days'], ['whole_notice', 'Whole notice']] },
];
/** A rule's value as a select's string, and back. */
export const asText = (v: ExitRules[keyof ExitRules]) => String(v);
export const fromText = (key: keyof ExitRules, text: string): ExitRules[keyof ExitRules] => (key === 'holdPay' ? text === 'true' : text) as ExitRules[keyof ExitRules];
