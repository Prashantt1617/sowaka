/**
 * The app's Payroll home, salary and earnings as the API serves them: each person's own answer kept
 * for them alone (keptReads.keptForPerson: their userId and today's India day in the key, dropped by
 * any write at their company and by any write of their own, punches included). Opening Home, then
 * Salary, then Earnings and back read the company's payroll setup, the person's payslips and the pay
 * period's attendance again on every screen; a second open in the quarter hour is now from memory
 * (one refresh behind the reader once a minute has passed). Scripts and checks call the services
 * themselves and always read live.
 */
import { meOf } from './employeePayroll.common';
import { myEarnings } from './employeePayroll.earnings';
import { myPayrollHome } from './employeePayroll.home';
import { mySalarySummary } from './employeePayroll.salary';
import { keptForPerson } from './keptReads';

const param = (value: unknown) => (value === undefined || value === '' ? null : value);

export async function keptPayrollHome(userId: string, periodRaw: unknown) {
  const { org } = await meOf(userId);
  return keptForPerson(org, userId, 'pay-home', { period: param(periodRaw) }, () => myPayrollHome(userId, periodRaw));
}

export async function keptSalarySummary(userId: string, periodRaw: unknown, viewRaw: unknown) {
  const { org } = await meOf(userId);
  return keptForPerson(org, userId, 'pay-salary', { period: param(periodRaw), view: param(viewRaw) }, () => mySalarySummary(userId, periodRaw, new Date(), viewRaw));
}

export async function keptEarnings(userId: string, fyRaw: unknown) {
  const { org } = await meOf(userId);
  return keptForPerson(org, userId, 'pay-earnings', { fy: param(fyRaw) }, () => myEarnings(userId, fyRaw));
}
