// Starting points for a department's KPI set. Suwi offers these when HR asks
// "what should we measure in Sales?", adapted to the designations and headcount
// it sees; the model may rename, drop or re-weight them before the template is
// prepared. Weights are whole percentages adding to 100, the rule
// createKpiTemplate enforces. Guidance is one line, written as the manager's
// form shows it: a question to hold the month against, never a verdict.

export interface SuggestedParameter { title: string; guidance: string; weight: number }
export interface DepartmentSuggestion {
  /** Display name, e.g. "Sales". */
  department: string;
  /** Normalised department names and common aliases this set is offered for. */
  matches: string[];
  parameters: SuggestedParameter[];
  /** For anyone in the department who has reports: added at its weight, the others lowered to keep 100. */
  forManagers?: SuggestedParameter;
}

const LEADERSHIP: SuggestedParameter = {
  title: 'Leadership',
  guidance: 'For anyone with reports: are their people growing, unblocked and clear on what matters this month?',
  weight: 15,
};

export const DEPARTMENT_KPI_DEFAULTS: DepartmentSuggestion[] = [
  {
    department: 'Engineering',
    matches: ['engineering', 'tech', 'technology', 'software', 'development', 'dev', 'it', 'platform', 'qa', 'quality assurance'],
    parameters: [
      { title: 'Delivery', guidance: 'What shipped this cycle against what was committed, and did it land when it was due?', weight: 35 },
      { title: 'Code Quality', guidance: 'Would the next engineer thank them or curse them? Consider tests, readability and how little rework followed.', weight: 25 },
      { title: 'Ownership', guidance: 'Do they carry work through to done, including the unglamorous last mile, without being chased?', weight: 20 },
      { title: 'Collaboration', guidance: 'Reviews, pairing and handovers: does the team move faster with this person in the room?', weight: 20 },
    ],
    forManagers: LEADERSHIP,
  },
  {
    department: 'Sales',
    matches: ['sales', 'business development', 'bd', 'inside sales', 'field sales', 'revenue', 'go to market', 'gtm'],
    parameters: [
      { title: 'Revenue vs Target', guidance: 'Closed revenue against this cycle\'s target; name the number, not the effort.', weight: 40 },
      { title: 'Pipeline Health', guidance: 'Meetings booked, qualified opportunities added and how many moved a stage this cycle.', weight: 25 },
      { title: 'CRM Hygiene', guidance: 'Are deals, next steps and close dates in the CRM current enough that a colleague could pick them up?', weight: 15 },
      { title: 'Customer Focus', guidance: 'Do they sell what the customer needs, follow up when promised and hand over cleanly after the close?', weight: 10 },
      { title: 'Collaboration', guidance: 'How they work with marketing, product and success: shared leads, feedback passed on, deals not hoarded.', weight: 10 },
    ],
    forManagers: LEADERSHIP,
  },
  {
    department: 'Design',
    matches: ['design', 'ux', 'ui', 'product design', 'creative', 'visual design', 'user experience'],
    parameters: [
      { title: 'Design Craft', guidance: 'Fidelity, consistency with the existing system and attention to the states nobody asked for.', weight: 35 },
      { title: 'User Insight', guidance: 'Did decisions this cycle rest on something seen or heard from users, or on assumption?', weight: 25 },
      { title: 'Delivery', guidance: 'Were designs ready when engineering needed them, with the detail needed to build without guessing?', weight: 20 },
      { title: 'Collaboration', guidance: 'How they take critique, give it and work across product and engineering.', weight: 20 },
    ],
    forManagers: LEADERSHIP,
  },
  {
    department: 'Product',
    matches: ['product', 'product management', 'pm'],
    parameters: [
      { title: 'Outcomes', guidance: 'Did what shipped move the metric it was meant to? Judge the result, not the roadmap.', weight: 35 },
      { title: 'Prioritisation', guidance: 'Were the right things chosen and the wrong things said no to, with reasons the team understood?', weight: 25 },
      { title: 'Communication', guidance: 'Can a reader understand their spec or update without a follow-up call?', weight: 20 },
      { title: 'Customer Focus', guidance: 'How often did user evidence change a decision this cycle?', weight: 20 },
    ],
    forManagers: LEADERSHIP,
  },
  {
    department: 'Marketing',
    matches: ['marketing', 'growth', 'brand', 'content', 'digital marketing', 'communications', 'comms'],
    parameters: [
      { title: 'Campaign Results', guidance: 'Leads, sign-ups or reach against what the campaign set out to do; name the number.', weight: 35 },
      { title: 'Content Quality', guidance: 'Clear, on-brand and correct the first time; how much needed redoing?', weight: 25 },
      { title: 'Delivery', guidance: 'Did campaigns and assets go out when planned?', weight: 20 },
      { title: 'Collaboration', guidance: 'How they work with sales and product: briefs taken, feedback passed back, leads handed over.', weight: 20 },
    ],
    forManagers: LEADERSHIP,
  },
  {
    department: 'Customer Success',
    matches: ['customer success', 'customer support', 'support', 'client success', 'account management', 'customer service', 'service', 'helpdesk', 'cs'],
    parameters: [
      { title: 'Customer Retention', guidance: 'Renewals and churn in their accounts this cycle, and whether warning signs were raised early.', weight: 35 },
      { title: 'Response Quality', guidance: 'Were replies timely, accurate and resolved on the first pass? Look at the tickets, not the tone.', weight: 30 },
      { title: 'Customer Focus', guidance: 'Do they talk to customers or assume? How often did their feedback reach product?', weight: 20 },
      { title: 'Collaboration', guidance: 'Escalations handed over cleanly, and product or engineering kept in the loop.', weight: 15 },
    ],
    forManagers: LEADERSHIP,
  },
  {
    department: 'Operations',
    matches: ['operations', 'ops', 'logistics', 'supply chain', 'fleet', 'facilities', 'administration', 'admin', 'procurement'],
    parameters: [
      { title: 'Process Reliability', guidance: 'Did the things they own run on time without surprises? Count the misses, not the saves.', weight: 35 },
      { title: 'Cost Awareness', guidance: 'Spend against plan in what they handle, and whether a cheaper way was looked for.', weight: 20 },
      { title: 'Dependability', guidance: 'When they say a date, does it hold, and when it cannot, do people hear early?', weight: 25 },
      { title: 'Collaboration', guidance: 'How other teams experience working with them: handovers, responsiveness, clarity.', weight: 20 },
    ],
    forManagers: LEADERSHIP,
  },
  {
    department: 'Finance',
    matches: ['finance', 'accounts', 'accounting', 'payroll', 'audit', 'treasury'],
    parameters: [
      { title: 'Accuracy', guidance: 'Errors found after the fact in what they prepared; one is worth noting, a pattern is the score.', weight: 35 },
      { title: 'Timeliness', guidance: 'Close, filings and payments done by their dates without last-day scrambles.', weight: 30 },
      { title: 'Compliance', guidance: 'Were statutory and policy rules followed as written, with exceptions raised rather than worked around?', weight: 20 },
      { title: 'Communication', guidance: 'Can a non-finance reader understand their report or answer without a follow-up?', weight: 15 },
    ],
    forManagers: LEADERSHIP,
  },
  {
    department: 'People',
    matches: ['people', 'hr', 'human resources', 'people and culture', 'people culture', 'talent', 'recruitment', 'recruiting', 'talent acquisition'],
    parameters: [
      { title: 'Hiring Delivery', guidance: 'Roles filled against plan and time-to-hire; name the numbers.', weight: 30 },
      { title: 'Employee Experience', guidance: 'Questions answered, onboarding done and issues closed in the time people were told.', weight: 30 },
      { title: 'Compliance', guidance: 'Policies, records and statutory steps kept current and followed as written.', weight: 20 },
      { title: 'Communication', guidance: 'Are announcements and answers clear enough that nobody has to ask twice?', weight: 20 },
    ],
    forManagers: LEADERSHIP,
  },
];

/** When no department set matches: the four most companies start with. */
export const GENERIC_KPI_DEFAULTS: SuggestedParameter[] = [
  { title: 'Performance', guidance: 'What was delivered this cycle against what was committed?', weight: 40 },
  { title: 'Ownership', guidance: 'Do they carry work through to done, including the unglamorous last mile?', weight: 20 },
  { title: 'Collaboration', guidance: 'Does the team move faster with this person in the room?', weight: 20 },
  { title: 'Communication', guidance: 'Can a reader understand their update without a follow-up call?', weight: 20 },
];

export const normaliseName = (s: unknown) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/** The default set for a department name, matching on whole words and common aliases. */
export function suggestionFor(department: string): DepartmentSuggestion | null {
  const n = normaliseName(department);
  if (!n) return null;
  const words = new Set(n.split(' '));
  const exact = DEPARTMENT_KPI_DEFAULTS.find((d) => d.matches.includes(n));
  if (exact) return exact;
  // "Sales Ops" or "Engineering – Platform": the first set whose alias is a whole word of the name.
  return DEPARTMENT_KPI_DEFAULTS.find((d) => d.matches.some((m) => !m.includes(' ') && words.has(m))) ?? null;
}
