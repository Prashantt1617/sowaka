// Each dashboard view is its own code chunk, fetched the first time it is
// opened (or sooner: when its sidebar item is hovered), so the first load
// only downloads the shell and the page HR lands on.
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { View } from './theme';

type Loader = () => Promise<{ default: ComponentType }>;

const LOADERS: Partial<Record<View, Loader>> = {
  organisation: () => import('./views/Organisation').then((m) => ({ default: m.Organisation })),
  overview: () => import('./views/Overview').then((m) => ({ default: m.Overview })),
  leave: () => import('./views/LeaveRequests').then((m) => ({ default: m.LeaveRequests })),
  overtime: () => import('./views/Overtime').then((m) => ({ default: m.Overtime })),
  attendance: () => import('./views/AttendanceCorrections').then((m) => ({ default: m.AttendanceCorrections })),
  kpi: () => import('./views/KpiParameters').then((m) => ({ default: m.KpiParameters })),
  kpibulk: () => import('./views/KpiBulkAssign').then((m) => ({ default: m.KpiBulkAssign })),
  kpitemplates: () => import('./views/KpiTemplates').then((m) => ({ default: m.KpiTemplates })),
  feedback: () => import('./views/Feedback').then((m) => ({ default: m.Feedback })),
  reimbursements: () => import('./views/Reimbursements').then((m) => ({ default: m.Reimbursements })),
  departments: () => import('./views/Departments').then((m) => ({ default: m.Departments })),
  designations: () => import('./views/Designations').then((m) => ({ default: m.Designations })),
  employees: () => import('./views/Employees').then((m) => ({ default: m.Employees })),
  employeeimport: () => import('./views/EmployeeImport').then((m) => ({ default: m.EmployeeImport })),
  peopletasks: () => import('./views/PeopleTasks').then((m) => ({ default: m.PeopleTasks })),
  attendancereport: () => import('./views/AttendanceReport').then((m) => ({ default: m.AttendanceReport })),
  orgchart: () => import('./views/OrgChart').then((m) => ({ default: m.OrgChart })),
  usersroles: () => import('./views/Accesses').then((m) => ({ default: m.Accesses })),
  reimbursementtypes: () => import('./views/ReimbursementTypes').then((m) => ({ default: m.ReimbursementTypes })),
  cycle: () => import('./views/ReviewCycle').then((m) => ({ default: m.ReviewCycle })),
  games: () => import('./views/Games').then((m) => ({ default: m.Games })),
  relaygame: () => import('./views/RelayGame').then((m) => ({ default: m.RelayGame })),
  engagementposts: () => import('./views/EngagementPosts').then((m) => ({ default: m.EngagementPosts })),
  contentreports: () => import('./views/ContentReports').then((m) => ({ default: m.ContentReports })),
  payheads: () => import('./views/PayHeadMaster').then((m) => ({ default: m.PayHeadMaster })),
  templates: () => import('./views/SalaryTemplates').then((m) => ({ default: m.SalaryTemplates })),
  paiddays: () => import('./views/PaidDaysTemplates').then((m) => ({ default: m.PaidDaysTemplates })),
  payrolldash: () => import('./views/PayrollDashboard').then((m) => ({ default: m.PayrollDashboard })),
  payrollreports: () => import('./views/PayrollReports').then((m) => ({ default: m.PayrollReports })),
  statutorycomponents: () => import('./views/StatutoryComponents').then((m) => ({ default: m.StatutoryComponents })),
  payruns: () => import('./views/PayrollRuns').then((m) => ({ default: m.PayrollRuns })),
  payschedule: () => import('./views/OrgSetup').then((m) => ({ default: m.PaySchedule })),
  taxdetails: () => import('./views/OrgSetup').then((m) => ({ default: m.TaxDetails })),
  shiftbulk: () => import('./views/ShiftBulkAssign').then((m) => ({ default: m.ShiftBulkAssign })),
  shifttypes: () => import('./views/ShiftTemplates').then((m) => ({ default: m.ShiftTemplates })),
  holidaybank: () => import('./views/HolidayBank').then((m) => ({ default: m.HolidayBank })),
  offices: () => import('./views/Offices').then((m) => ({ default: m.Offices })),
  oolcheckins: () => import('./views/OutOfLocation').then((m) => ({ default: m.OutOfLocation })),
  support: () => import('./views/SupportDesk').then((m) => ({ default: m.SupportDesk })),
  suwi: () => import('./views/SuwiSettings').then((m) => ({ default: m.SuwiSettings })),
};

/**
 * A tab left open across a release asks for chunk names the new release no
 * longer has. Load the page again (once, so a real outage cannot loop) and
 * the new release's names come with it.
 */
const RELOADED_AT = 'sowaka.chunkReloadAt';
function reloadForNewRelease(err: unknown): Promise<never> {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last > 30_000) {
      sessionStorage.setItem(RELOADED_AT, String(Date.now()));
      window.location.reload();
      return new Promise<never>(() => {});
    }
  } catch {
    // No session storage: fall through and surface the error.
  }
  throw err;
}

/** The lazy component for a view, or undefined for one without its own page. */
export const VIEW_COMPONENTS: Partial<Record<View, LazyExoticComponent<ComponentType>>> = Object.fromEntries(
  Object.entries(LOADERS).map(([view, load]) => [view, lazy(() => load().catch(reloadForNewRelease))]),
);

const prefetched = new Set<View>();

/** Starts downloading a view's code without rendering it (hover, focus, the landing page). */
export function prefetchView(view: View): void {
  const load = LOADERS[view];
  if (!load || prefetched.has(view)) return;
  prefetched.add(view);
  // A failed prefetch is retried for real when the view is opened.
  load().catch(() => prefetched.delete(view));
}
