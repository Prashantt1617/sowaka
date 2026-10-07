// Which dashboard tabs a person may open. The server enforces the same rules
// on the APIs behind each tab; this only decides what the sidebar shows.
import type { AuthUser } from '../services/auth';
import type { View } from './theme';

/** Not a sidebar tab: the Salary details tab on an employee's profile. */
export const SALARY_DETAILS = 'salarydetails';
export type AccessKey = View | typeof SALARY_DETAILS;

/** Every tab, unless HR limited them. People › Accesses is an admin's alone. */
export function canOpen(user: AuthUser | null | undefined, view: AccessKey): boolean {
  if (!user?.dashboardAccess) return false;
  if (view === 'usersroles') return user.dashboardAdmin === true;
  if (user.dashboardAdmin === true || !Array.isArray(user.dashboardTabs)) return true;
  return user.dashboardTabs.includes(view);
}
