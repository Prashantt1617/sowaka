/**
 * The HR dashboard's tabs, by the view key the dashboard uses, and the API
 * paths each one needs. An admin (or anyone with no tab list) can open all of
 * them; everyone else only the tabs People › Accesses gives them, and the
 * server refuses the APIs behind the rest.
 */
export const DASHBOARD_TABS = [
  'organisation', 'overview',
  'leave', 'overtime', 'attendance', 'oolcheckins',
  'departments', 'designations', 'employees', 'orgchart', 'usersroles',
  // Not a sidebar tab: the Salary details tab on an employee's profile, given
  // on its own because opening Employees should not show what people earn.
  'salarydetails',
  'holidaybank', 'shifttypes', 'shiftbulk', 'offices',
  'kpi', 'kpitemplates', 'kpibulk', 'feedback', 'cycle',
  'attendancereport',
  'payschedule', 'taxdetails', 'payheads', 'statutorycomponents', 'templates', 'payruns',
  'reimbursements', 'reimbursementtypes',
  'games', 'engagementposts', 'relaygame', 'contentreports',
] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

type Rule = { path: RegExp; read?: DashboardTab[]; write?: DashboardTab[] };

/**
 * First match wins. `read` gates GET, `write` everything else; a side left out
 * is open to anyone with dashboard access (shared lookups like the employee
 * list, offices or shift templates that many tabs read). Paths not listed are
 * open: the rules guard what is sensitive, not every lookup.
 */
const RULES: Rule[] = [
  // Who sees what is the admin's alone (enforced separately as well).
  { path: /^\/admin\/accesses/, read: [], write: [] },
  // Payroll
  { path: /^\/admin\/payroll\/org-setup/, read: ['payschedule', 'taxdetails', 'payruns'], write: ['payschedule', 'taxdetails'] },
  { path: /^\/admin\/payroll\/pay-heads/, read: ['payheads', 'templates', 'salarydetails', 'payruns', 'statutorycomponents'], write: ['payheads'] },
  { path: /^\/admin\/payroll\/statutory-/, read: ['statutorycomponents', 'templates', 'salarydetails', 'payruns'], write: ['statutorycomponents'] },
  { path: /^\/admin\/payroll\/salary-templates\/preview/, read: ['templates', 'salarydetails'], write: ['templates', 'salarydetails'] },
  { path: /^\/admin\/payroll\/salary-templates/, read: ['templates', 'salarydetails', 'payruns'], write: ['templates'] },
  // What one person earns: their Salary details tab, or the template page
  // that assigns people to a template.
  { path: /^\/admin\/payroll\/salary-structures/, read: ['salarydetails', 'templates', 'payruns'], write: ['salarydetails', 'templates'] },
  { path: /^\/admin\/payroll\/runs/, read: ['payruns'], write: ['payruns'] },
  { path: /^\/admin\/payroll/, read: ['payschedule', 'taxdetails', 'payheads', 'statutorycomponents', 'templates', 'payruns', 'salarydetails'], write: ['payruns'] },
  // An employee's pay and calendar
  { path: /^\/admin\/employees\/[^/]+\/payslips/, read: ['salarydetails', 'payruns'] },
  { path: /^\/admin\/employees\/[^/]+\/calendar/, read: ['employees', 'attendancereport'], write: ['employees'] },
  { path: /^\/admin\/employees/, write: ['employees'] },
  { path: /^\/admin\/reporting/, write: ['employees', 'orgchart'] },
  // Requests
  { path: /^\/admin\/leaves/, read: ['leave', 'overview'], write: ['leave', 'overview'] },
  { path: /^\/admin\/overtime/, read: ['overtime', 'overview'], write: ['overtime', 'overview'] },
  { path: /^\/admin\/reimbursements/, read: ['reimbursements', 'overview'], write: ['reimbursements', 'overview'] },
  { path: /^\/admin\/regularizations/, read: ['attendance', 'overview'], write: ['attendance', 'overview'] },
  { path: /^\/admin\/out-of-location/, read: ['oolcheckins'] },
  { path: /^\/admin\/reports\/attendance/, read: ['attendancereport', 'overview', 'employees', 'payruns'] },
  // Set-up
  { path: /^\/admin\/offices/, write: ['offices'] },
  { path: /^\/admin\/(shifts|shift-policy)/, write: ['shifttypes', 'shiftbulk'] },
  { path: /^\/admin\/reimbursement-types/, write: ['reimbursementtypes'] },
  { path: /^\/admin\/company\/settings/, write: ['organisation', 'departments', 'designations', 'cycle'] },
  { path: /^\/admin\/feedback/, read: ['feedback', 'overview'] },
  { path: /^\/admin\/kpi/, write: ['kpi', 'kpitemplates', 'kpibulk', 'feedback', 'cycle'] },
  // Connect
  { path: /^\/admin\/games/, read: ['games', 'engagementposts'], write: ['games', 'engagementposts'] },
  { path: /^\/admin\/relay/, read: ['relaygame', 'engagementposts'], write: ['relaygame'] },
  { path: /^\/admin\/connect\/reports/, read: ['contentreports'], write: ['contentreports'] },
  { path: /^\/holidays/, write: ['holidaybank'] },
];

/** The tabs that open this request, or null when it is open to every dashboard user. */
export function tabsForRequest(method: string, path: string): DashboardTab[] | null {
  for (const rule of RULES) {
    if (!rule.path.test(path)) continue;
    const tabs = method === 'GET' || method === 'HEAD' ? rule.read : rule.write;
    return tabs ?? null;
  }
  return null;
}
