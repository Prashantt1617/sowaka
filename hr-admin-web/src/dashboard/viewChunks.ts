// Each dashboard view is its own code chunk, fetched the first time it is
// opened (or sooner: when its sidebar item is hovered), so the first load
// only downloads the shell and the page HR lands on.
import type { ComponentType } from 'react';
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
function reloadForNewRelease(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last > 30_000) {
      sessionStorage.setItem(RELOADED_AT, String(Date.now()));
      window.location.reload();
      return true;
    }
  } catch {
    // No session storage: no reload; the page area stays empty instead.
  }
  return false;
}

// A page's code, as a promise React's `use` can read without suspending once
// it has arrived: a page prefetched on hover then opens in the same frame as
// the click, with no fallback in between.
type PagePromise = Promise<ComponentType> & { status?: 'pending' | 'fulfilled' | 'rejected'; value?: ComponentType; reason?: unknown };
const pages = new Map<View, PagePromise>();
// Pages that have been asked to render: if their code fails to arrive, the
// likely cause is a new release, and the page is loaded again.
const shown = new Set<View>();

const codeFailures = new WeakSet<Error>();

/** Whether an error is a page's code failing to arrive (and not the page itself failing). */
export function isPageCodeFailure(err: unknown): boolean {
  return err instanceof Error && codeFailures.has(err);
}

function load(view: View, loader: Loader): PagePromise {
  const existing = pages.get(view);
  if (existing) return existing;
  const page: PagePromise = loader().then(
    (m) => {
      page.status = 'fulfilled';
      page.value = m.default;
      return m.default;
    },
    (err: unknown) => {
      // Not kept: the next hover or open tries again.
      pages.delete(view);
      if (shown.has(view) && reloadForNewRelease()) return new Promise<never>(() => {});
      const failure = err instanceof Error ? err : new Error(String(err));
      codeFailures.add(failure);
      page.status = 'rejected';
      page.reason = failure;
      throw failure;
    },
  );
  page.status = 'pending';
  pages.set(view, page);
  return page;
}

/** Whether a view has a page of its own (others show the placeholder). */
export function hasViewPage(view: View): boolean {
  return view in LOADERS;
}

/** The view's page component, for `use()` inside the view's Suspense boundary. */
export function viewPage(view: View): Promise<ComponentType> {
  shown.add(view);
  return load(view, LOADERS[view]!);
}

/** Starts downloading a view's code without rendering it (hover, focus, the landing page, idle time). */
export function prefetchView(view: View): void {
  const loader = LOADERS[view];
  if (!loader) return;
  load(view, loader).catch(() => undefined);
}

/** Every page's code, one after another, for when the browser has nothing better to do. */
export function prefetchAllViews(): void {
  const queue = Object.keys(LOADERS) as View[];
  const next = () => {
    const view = queue.shift();
    if (!view) return;
    const loader = LOADERS[view]!;
    load(view, loader).catch(() => undefined).finally(next);
  };
  next();
}
