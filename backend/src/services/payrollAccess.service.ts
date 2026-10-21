/**
 * Who may see what people earn and their bank / tax identifiers: a dashboard
 * admin, anyone never limited to some tabs, or someone given the Payroll
 * Runs or Salary details tab in People › Accesses.
 */
import { users } from '../config/db';
import { User } from '../models/user.model';

export function hasPayrollAccess(user: Pick<User, 'dashboardAccess' | 'dashboardAdmin' | 'dashboardTabs'> | null | undefined): boolean {
  if (!user || user.dashboardAccess !== true) return false;
  if (user.dashboardAdmin === true || !Array.isArray(user.dashboardTabs)) return true;
  return user.dashboardTabs.includes('payruns') || user.dashboardTabs.includes('salarydetails');
}

export async function payrollAccessOf(userId: string): Promise<boolean> {
  const user = await users().findOne({ userId }, { projection: { _id: 0, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1 } });
  return hasPayrollAccess(user);
}
