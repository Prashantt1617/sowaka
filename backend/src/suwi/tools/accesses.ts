// People › Accesses from Suwi: who can open the HR dashboard and which tabs each person sees, and
// giving or taking away access and tabs ("Give Tanu Claims access"). Reads and writes go through the
// same service the Accesses page uses (dashboard-access.service), as the HR person; like that page it is
// a dashboard admin's alone. Suwi never changes the asker's own access. Undo puts the person's access,
// admin flag, tabs and Support role back exactly as they were.
import { users } from '../../config/db';
import { DASHBOARD_TABS, type DashboardTab } from '../../models/dashboard-tabs';
import { listDashboardAccesses, setDashboardAccess } from '../../services/dashboard-access.service';
import { defineTools, str } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { findPerson, norm } from './people';

/** Each tab as the dashboard names it (theme.ts / setupGroups.ts). */
export const TAB_LABEL: Record<DashboardTab, string> = {
  organisation: 'Organisation profile', overview: 'HR control room', leave: 'Leave requests', overtime: 'Overtime', attendance: 'Attendance corrections',
  oolcheckins: 'OOL check-ins', departments: 'Departments', designations: 'Designations', employees: 'Employees', orgchart: 'Org chart', usersroles: 'Accesses',
  salarydetails: 'Salary details', holidaybank: 'Holiday Bank', shifttypes: 'Shift templates', shiftbulk: 'Shift bulk assign', offices: 'Offices', faceid: 'Face check',
  kpi: 'KPI parameters', kpitemplates: 'KPI templates', kpibulk: 'KPI bulk assign', feedback: 'Performance reviews', cycle: 'Review cycle',
  attendancereport: 'Attendance report', payschedule: 'Pay schedule', taxdetails: 'Tax details', payheads: 'Salary components', statutorycomponents: 'Statutory & tax',
  templates: 'Salary templates', paiddays: 'Paid days templates', payruns: 'Payroll runs', payrolldash: 'Payroll dashboard', payrollreports: 'Payroll reports',
  payrollbulk: 'Payroll bulk assign', fbprequests: 'FBP requests', fbpsplits: 'FBP splits', reimbursements: 'Reimbursements (claims)', reimbursementtypes: 'Reimbursement types',
  appusage: 'App usage', feed: 'Feed', engagementplan: 'Engagement plan', contests: 'Contests', games: 'Games', placements: 'Placements',
  onboarding: 'Onboarding', offboarding: 'Offboarding', exit_insights: 'Exit insights', lifecycle_documents: 'Lifecycle documents', lifecycle_templates: 'Lifecycle templates',
};
/** What HR calls a tab when it isn't the tab's own name. */
const ALIAS: Record<string, DashboardTab[]> = {
  claims: ['reimbursements'], claim: ['reimbursements'], reimbursement: ['reimbursements'], expenses: ['reimbursements'], 'claim types': ['reimbursementtypes'],
  payroll: ['payruns'], 'pay runs': ['payruns'], salary: ['salarydetails'], salaries: ['salarydetails'], people: ['employees'], 'employee list': ['employees'],
  accesses: ['usersroles'], 'leave requests': ['leave'], leaves: ['leave'], corrections: ['attendance'], regularizations: ['attendance'], overview: ['overview'],
  'control room': ['overview'], holidays: ['holidaybank'], shifts: ['shifttypes'], kpis: ['kpi'], reviews: ['feedback'], 'attendance report': ['attendancereport'],
  tax: ['taxdetails'], statutory: ['statutorycomponents'], fbp: ['fbprequests', 'fbpsplits'], engagement: ['appusage', 'feed', 'engagementplan', 'contests', 'games'],
};
const PAY_TABS: DashboardTab[] = ['payruns', 'salarydetails'];

/** Tab keys from what HR said ("claims", "Leave requests", "payruns"); an unclear word is an error naming the choices. */
export function tabsFrom(v: unknown): DashboardTab[] {
  const words = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/,| and /) : []).map((x) => str(x, 60)).filter(Boolean);
  const out = new Set<DashboardTab>();
  for (const w of words) {
    const k = norm(w).replace(/ (tab|page|access)$/, '');
    const exact = (DASHBOARD_TABS as readonly string[]).includes(w) ? [w as DashboardTab]
      : ALIAS[k] ?? DASHBOARD_TABS.filter((t) => norm(TAB_LABEL[t]) === k || norm(t) === k);
    const hits = exact.length ? exact : DASHBOARD_TABS.filter((t) => norm(TAB_LABEL[t]).includes(k));
    if (!hits.length) throw new Error(`No dashboard tab called "${w}". Tabs: ${DASHBOARD_TABS.map((t) => TAB_LABEL[t]).join(', ')}`);
    if (hits.length > 1 && !ALIAS[k]) throw new Error(`"${w}" could be ${hits.map((t) => TAB_LABEL[t]).join(', ')}: say which`);
    for (const t of hits) out.add(t);
  }
  return [...out];
}

type Access = { access: boolean; admin: boolean; tabs: string[] | null; supportRole: string | null };
const labels = (tabs: string[]) => tabs.map((t) => TAB_LABEL[t as DashboardTab] ?? t).join(', ');
const describe = (a: Access) => (!a.access ? 'No dashboard access' : a.admin ? 'Admin (every tab, and Accesses)' : a.tabs === null ? 'Every tab (not an admin)' : `${a.tabs.length} tab${a.tabs.length === 1 ? '' : 's'}: ${labels(a.tabs)}`);

async function accessOf(org: string, userId: string): Promise<Access> {
  const u = await users().findOne({ userId, org }, { projection: { _id: 0, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1, supportRole: 1 } });
  const access = u?.dashboardAccess === true;
  return { access, admin: access && u?.dashboardAdmin === true, tabs: access && !u?.dashboardAdmin && Array.isArray(u?.dashboardTabs) ? u!.dashboardTabs! : null, supportRole: access ? u?.supportRole ?? null : null };
}

defineTools(
  {
    name: 'dashboard_accesses',
    area: 'people',
    label: (i) => (i.person ? `${i.person}'s dashboard access` : 'Who has dashboard access'),
    description: 'People › Accesses: everyone who can open the HR dashboard, whether they are an admin, and which tabs they see (or one person\'s, with person). Use for "who can see payroll?", "what can Tanu open?". To change access use prepare_dashboard_access.',
    input_schema: { type: 'object', properties: { person: { type: 'string', description: 'Name, employee ID or userId' }, tab: { type: 'string', description: 'Only people who can open this tab (e.g. claims, payroll)' } } },
    api: { method: 'GET', path: '/admin/accesses' },
    async run(ctx, i) {
      if (ctx.user.dashboardAdmin !== true) throw new Error('Only a dashboard admin can see People › Accesses');
      const { users: rows } = await listDashboardAccesses(ctx.userId);
      let list = rows;
      if (str(i.person)) { const p = await findPerson(ctx, i.person); list = rows.filter((r) => r.userId === p.userId); if (!list.length) return { data: { person: p.name, access: 'No dashboard access' } }; }
      if (str(i.tab)) { const want = tabsFrom(i.tab); list = list.filter((r) => r.admin || r.tabs === null || want.some((t) => r.tabs!.includes(t))); }
      const view = list.map((r) => ({ name: r.name, userId: r.userId, access: describe({ access: true, admin: r.admin, tabs: r.tabs, supportRole: r.supportRole ?? null }), supportRole: r.supportRole ?? null }));
      return {
        data: { total: view.length, people: view.slice(0, 40), note: view.length > 8 ? 'HR sees everyone in the table: do not list them.' : undefined },
        tables: view.length > 8 ? [{ title: `Dashboard access (${view.length})`, columns: ['Who', 'Access'], rows: view.map((v) => [v.name, v.access]) }] : undefined,
        links: [{ label: 'Open Accesses', view: 'usersroles' }],
      };
    },
  },
  {
    name: 'prepare_dashboard_access',
    area: 'people',
    acts: true,
    label: (i) => `Prepared: change ${str(i.person) || 'someone'}'s dashboard access`,
    description: 'Prepare giving or removing HR dashboard access and tabs for ONE person (People › Accesses), e.g. "Give Tanu Claims access" (give ["claims"]), "take payroll away from Ravi" (remove ["payroll"]), "make Asha an admin" (admin true), "remove Meena\'s dashboard access" (removeAccess true). Tabs may be named as HR says them (claims, leave requests, payroll, attendance report...). give adds to what they have; setTabs replaces the whole list; allTabs gives every tab without admin. Never for the asker\'s own access. Changes nothing until HR confirms; Undo puts their access back as it was.',
    input_schema: {
      type: 'object',
      properties: {
        person: { type: 'string', description: 'Name, employee ID or userId' },
        give: { type: 'array', items: { type: 'string' }, description: 'Tabs to add' }, remove: { type: 'array', items: { type: 'string' }, description: 'Tabs to take away' },
        setTabs: { type: 'array', items: { type: 'string' }, description: 'Exactly these tabs (replaces the list)' }, allTabs: { type: 'boolean', description: 'Every tab, not an admin' },
        admin: { type: 'boolean', description: 'true makes them a dashboard admin; false takes admin away (they keep every tab unless setTabs says otherwise)' },
        removeAccess: { type: 'boolean', description: 'Take away dashboard access entirely' },
      },
      required: ['person'],
    },
    api: { method: 'PUT', path: '/admin/accesses/x' },
    async run(ctx, i) {
      if (ctx.user.dashboardAdmin !== true) throw new Error('Only a dashboard admin can change who has dashboard access');
      const person = await findPerson(ctx, i.person);
      if (person.userId === ctx.userId) throw new Error('Suwi never changes your own dashboard access. Another admin can, on People › Accesses.');
      const cur = await accessOf(ctx.org, person.userId);
      const give = tabsFrom(i.give), remove = tabsFrom(i.remove), setTabs = i.setTabs !== undefined ? tabsFrom(i.setTabs) : null;
      let next: Access;
      if (i.removeAccess === true) next = { access: false, admin: false, tabs: null, supportRole: null };
      else if (i.admin === true) next = { access: true, admin: true, tabs: null, supportRole: cur.supportRole };
      else {
        if (cur.admin && i.admin !== false && (remove.length || setTabs)) throw new Error(`${person.name} is an admin and sees every tab. To limit their tabs, take admin away too (admin false).`);
        const all = [...DASHBOARD_TABS] as string[];
        const base = !cur.access ? [] : cur.admin || cur.tabs === null ? all : cur.tabs;
        let tabs: string[] | null = i.allTabs === true ? null : setTabs ?? [...new Set([...base, ...give])].filter((t) => !remove.includes(t as DashboardTab));
        // Everything they had was "every tab" and nothing was added or removed: keep it as every tab.
        if (tabs && cur.access && (cur.admin || cur.tabs === null) && !setTabs && !remove.length) tabs = null;
        if (cur.admin && i.admin !== false) tabs = null;
        if (tabs && !tabs.length && !cur.supportRole) next = { access: false, admin: false, tabs: null, supportRole: null };
        else next = { access: true, admin: cur.admin && i.admin !== false, tabs, supportRole: cur.supportRole };
        if (!give.length && !remove.length && !setTabs && i.allTabs !== true && i.admin !== false) throw new Error('Say what to change: give, remove, setTabs, allTabs, admin or removeAccess');
      }
      if (JSON.stringify({ ...next, tabs: next.tabs ? [...next.tabs].sort() : null }) === JSON.stringify({ ...cur, tabs: cur.tabs ? [...cur.tabs].sort() : null })) {
        return { data: { nothingToDo: true, person: person.name, access: describe(cur), note: 'They already have exactly that.' } };
      }
      const had = new Set(!cur.access ? [] : cur.admin || cur.tabs === null ? DASHBOARD_TABS : cur.tabs);
      const will = new Set(!next.access ? [] : next.admin || next.tabs === null ? DASHBOARD_TABS : next.tabs);
      const added = [...will].filter((t) => !had.has(t)), taken = [...had].filter((t) => !will.has(t));
      const title = !next.access ? `Remove ${person.name}'s dashboard access` : next.admin && !cur.admin ? `Make ${person.name} a dashboard admin` : added.length && !taken.length ? `Give ${person.name} ${labels(added)}` : `Change ${person.name}'s dashboard tabs`;
      const proposalId = await propose(ctx, {
        kind: 'dashboard_access', area: 'people', title,
        summary: `Now: ${describe(cur)}. After: ${describe(next)}.`,
        lines: [
          ...(added.length ? [{ text: `Can open: ${labels(added)}.` }] : []),
          ...(taken.length ? [{ text: `Can no longer open: ${labels(taken)}.` }] : []),
          ...(!next.access ? [{ text: `${person.name} can no longer sign in to the HR dashboard${cur.supportRole ? ', and their Support desk role ends (their open tickets go back to the Support heads)' : ''}. Their employee record and app are not affected.` }] : []),
          ...(next.admin && !cur.admin ? [{ text: 'An admin sees every tab, including Accesses, and can change anyone\'s access.', tone: 'warn' as const }] : []),
          ...(added.some((t) => PAY_TABS.includes(t as DashboardTab)) ? [{ text: 'Payroll access: they will see salaries, payslips, and bank, PAN and UAN details.', tone: 'warn' as const }] : []),
          { text: 'The server checks the tabs on every request, so the change applies at their next page load.', tone: 'info' },
          { text: 'Undo puts their access back exactly as it is now.', tone: 'info' },
        ],
        effectiveFrom: ctx.today, undoable: true,
        payload: { byUserId: ctx.userId, userId: person.userId, name: person.name, next, before: cur },
      });
      return { data: { prepared: true, title, now: describe(cur), after: describe(next), note: 'Nothing changes until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open Accesses', view: 'usersroles' }] };
    },
  },
);

/** One access as the service takes it. */
const body = (a: Access) => (!a.access ? { access: false } : { access: true, admin: a.admin, ...(a.admin ? {} : { tabs: a.tabs }), supportRole: a.supportRole });

defineExecutor('dashboard_access', {
  async run(p) {
    const { byUserId, userId, name, next } = p.payload as { byUserId: string; userId: string; name: string; next: Access };
    if (userId === byUserId) throw new Error('Suwi never changes your own dashboard access');
    await setDashboardAccess(byUserId, userId, body(next));
    return { message: `${name}: ${describe(next)}.` };
  },
  async undo(p) {
    const { byUserId, userId, name, before } = p.payload as { byUserId: string; userId: string; name: string; before: Access };
    await setDashboardAccess(byUserId, userId, body(before));
    return `${name}'s dashboard access is back as it was: ${describe(before)}.`;
  },
});
