// Which dashboard tabs a person may open. The server enforces the same rules
// on the APIs behind each tab; this only decides what the sidebar shows.
import type { AuthUser } from '../services/auth';
import type { View } from './theme';

/** Not a sidebar tab: the Salary details tab on an employee's profile. */
export const SALARY_DETAILS = 'salarydetails';
export type AccessKey = View | typeof SALARY_DETAILS;

/** The Placements section's pages; Clients and Candidates go with the placements tab. */
export const PLACEMENT_VIEWS: AccessKey[] = ['placements', 'placementclients', 'placementcustomers'];

/** Every tab, unless HR limited them. People › Accesses is an admin's alone; Support desk needs a Support role. */
export function canOpen(user: AuthUser | null | undefined, view: AccessKey): boolean {
  if (!user?.dashboardAccess) return false;
  if (view === 'usersroles' || view === 'employeeimport') return user.dashboardAdmin === true;
  // Suwi is for everyone with dashboard access; what it can reach is decided per question.
  if (view === 'suwi') return true;
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
