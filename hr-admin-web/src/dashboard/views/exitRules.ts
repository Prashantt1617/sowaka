// Labels and plain-words explanations for the exit rules (Setup › Payroll › Exit settings and Record exit).
import type { ExitRuleKind, ExitRules } from '../../services/hrms';

export const RULE_KIND_LABEL: Record<ExitRuleKind, string> = {
  resigned: 'Resigned', terminated: 'Terminated', absconded: 'Absconded', consultant: 'Moved to consultant', retired: 'Retired', other: 'Other',
};
export const RULE_KINDS: ExitRuleKind[] = ['resigned', 'terminated', 'absconded', 'consultant', 'retired', 'other'];

/** What the two notice rules mean, in one line each: the (i) beside them, here and on Record exit. */
export const NOTICE_PAY_INFO = 'When the company ends someone’s job before their notice is over, it pays them for the days they won’t work. Used when letting someone go early. It is taxed like salary; no PF is taken.';
export const NOTICE_SHORTFALL_INFO = 'When someone leaves before finishing their notice, the pay for the days they didn’t give is taken from their final settlement. You can turn it off for one person, for example when you let them go early.';

type Choices<K extends keyof ExitRules> = { key: K; label: string; hint: string; info?: string; options: [ExitRules[K], string][] };
export const RULE_ROWS: [Choices<'holdPay'>, Choices<'access'>, Choices<'noticePay'>, Choices<'noticeRecovery'>] = [
  { key: 'holdPay', label: 'Salary during notice', hint: 'Held salary is paid with the final settlement', options: [[true, 'Hold'], [false, 'Pay as usual']] },
  { key: 'access', label: 'App turns off', hint: 'They can’t sign in from then on', options: [['day_after', 'Day after last day'], ['at_once', 'Right away'], ['never', 'Never']] },
  { key: 'noticePay', label: 'Notice pay', hint: 'Paid for notice they won’t work', info: NOTICE_PAY_INFO, options: [['none', 'No'], ['hr_chooses', 'HR decides'], ['pay', 'Yes']] },
  { key: 'noticeRecovery', label: 'Notice shortfall', hint: 'Taken back for notice they didn’t give', info: NOTICE_SHORTFALL_INFO, options: [['none', 'No'], ['days_not_served', 'Days not given'], ['whole_notice', 'Whole notice']] },
];
/** A rule's value as a select's string, and back. */
export const asText = (v: ExitRules[keyof ExitRules]) => String(v);
export const fromText = (key: keyof ExitRules, text: string): ExitRules[keyof ExitRules] => (key === 'holdPay' ? text === 'true' : text) as ExitRules[keyof ExitRules];
