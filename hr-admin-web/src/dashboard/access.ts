// Which dashboard tabs a person may open. The server enforces the same rules
// on the APIs behind each tab; this only decides what the sidebar shows.
import type { AuthUser } from '../services/auth';
import type { View } from './theme';
import { BULK_VIEWS, SETUP_VIEWS } from './setupGroups';
import { lifecycleOn } from './lifecycleSwitch';

/** Not a sidebar tab: the Salary details tab on an employee's profile. */
export const SALARY_DETAILS = 'salarydetails';
export type AccessKey = View | typeof SALARY_DETAILS;

/** The Placements section's pages; Clients and Candidates go with the placements tab. */
export const PLACEMENT_VIEWS: AccessKey[] = ['placements', 'placementclients', 'placementcustomers'];

/** The employee lifecycle's pages. */
export const LIFECYCLE_VIEWS: AccessKey[] = ['onboarding', 'offboarding', 'exit_insights', 'lifecycle_documents', 'lifecycle_templates', 'lifecycle_letter_templates', 'preboarding'];

/** Pay figures (CTC, salary) show only to someone who may open payroll. */
export function canSeePay(user: AuthUser | null | undefined): boolean {
  return canOpen(user, 'payruns') || canOpen(user, SALARY_DETAILS);
}

/** Every tab, unless HR limited them. People › Accesses is an admin's alone; Support desk needs a Support role. */
export function canOpen(user: AuthUser | null | undefined, view: AccessKey): boolean {
  if (!user?.dashboardAccess) return false;
  if (view === 'usersroles' || view === 'employeeimport') return user.dashboardAdmin === true;
  // How every push sounds and looks, for the whole company: an admin's, as the server decides it.
  // Hidden from every dashboard (17 Nov 2026): Sowaka sets each company's sounds and pictures directly.
  if (view === 'notificationlook') return false;
  // Exits is a company feature (on at sowaka only for now), then a dashboard admin's.
  if (view === 'exits' || view === 'exitsettings') return user.features?.exits === true && user.dashboardAdmin === true;
  // The employee lifecycle is a company feature (GET /admin/lifecycle/settings) before it is a tab;
  // while that is still being asked, a page already open stays open. Document templates go with Documents.
  if (LIFECYCLE_VIEWS.includes(view)) {
    if (lifecycleOn() === false) return false;
    if (view === 'lifecycle_letter_templates') return canOpen(user, 'lifecycle_documents');
    // A candidate's pre-boarding profile is no tab of its own: it goes with the onboarding board or Employees.
    if (view === 'preboarding') return canOpen(user, 'onboarding') || canOpen(user, 'employees');
  }
  // Setup › Policies goes with Organisation settings, as the server decides it.
  if (view === 'policies') return canOpen(user, 'organisation');
  // Setup is a page of links: open to whoever may open any of the pages on it.
  if (view === 'setup') return SETUP_VIEWS.some((v) => canOpen(user, v));
  if (view === 'bulkassign') return BULK_VIEWS.some((v) => canOpen(user, v));
  // FBP bill types: the same reimbursement types API, for whoever had it on FBP splits or has Reimbursement Types.
  // Suwi is for everyone with dashboard access; what it can reach is decided per question.
  // Response times read every question in the company: dashboard admins only (as GET /suwi/timings).
  if (view === 'suwitimings') return user.dashboardAdmin === true;
  if (view === 'suwi') return true;
  // Investment proofs and Statutory & tax settings go with payroll access, as the server decides it: Payroll Runs or Salary details.
  if (view === 'investmentproofs' || view === 'payrollconfig') return canOpen(user, 'payruns') || canOpen(user, SALARY_DETAILS);
  // FBP requests and FBP splits come with the same payroll access, or can be given on their own.
  if ((view === 'fbprequests' || view === 'fbpsplits') && (canOpen(user, 'payruns') || canOpen(user, SALARY_DETAILS))) return true;
  // Time office › Company calendar reads the attendance report and the leave list: it opens
  // for whoever may read both (Attendance and Leave requests, as Requests gives) or the
  // attendance report as before.
  if (view === 'companycalendar') {
    return canOpen(user, 'attendancereport') || (canOpen(user, 'attendance') && canOpen(user, 'leave'));
  }
  // Time office › Punch log goes with any of the attendance pages, as the server allows it.
  if (view === 'punchlog') return canOpen(user, 'attendancereport') || canOpen(user, 'attendance') || canOpen(user, 'oolcheckins');
  // Time office › Leave balances goes with Leave requests, as the server allows it (its edits need Employees too).
  if (view === 'leavebalances') return canOpen(user, 'leave');
  // People › Tasks goes with Employees.
  if (view === 'peopletasks') return canOpen(user, 'employees');
  // The Diwali Cup TV (and its void) is HR's: an admin, or someone never limited to some tabs.
  if (view === 'cuptv') return user.dashboardAdmin === true || !Array.isArray(user.dashboardTabs);
  // Support desk is a role, never a tab: full access and Admin don't include it.
  if (view === 'support') return user.supportRole === 'head' || user.supportRole === 'staff';
  // Placements is a company feature first, then the one placements tab for all three pages.
  if (PLACEMENT_VIEWS.includes(view)) {
    if (user.features?.placements !== true) return false;
    if (view !== 'placements') return canOpen(user, 'placements');
  }
  if (user.dashboardAdmin === true || !Array.isArray(user.dashboardTabs)) return true;
  return user.dashboardTabs.includes(view);
}

/**
 * Which of the shared request lists this person may load, by the same tabs the server checks
 * (Overview opens all five). Asking for one they can't open is a refused request on every load.
 */
export function inboxAccess(user: AuthUser | null | undefined): { leaves: boolean; overtime: boolean; claims: boolean; corrections: boolean; feedback: boolean } {
  const any = (...views: AccessKey[]) => views.some((v) => canOpen(user, v));
  return {
    leaves: any('leave', 'overview'),
    overtime: any('overtime', 'overview'),
    claims: any('reimbursements', 'overview'),
    corrections: any('attendance', 'overview'),
    feedback: any('feedback', 'overview'),
  };
}
