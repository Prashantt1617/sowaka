// The Setup page's cards: every settings page, grouped by what it sets up. These pages are off
// their old sidebar sections (hidden there, so who may open them is unchanged) and reached from Setup.
import type { View } from './theme';

export type SetupGroup = { key: string; title: string; icon: View; items: { view: View; label: string }[] };

export const SETUP_GROUPS: SetupGroup[] = [
  { key: 'attendance', title: 'Attendance', icon: 'shifttypes', items: [
    { view: 'shifttypes', label: 'Shift templates' },
    { view: 'holidaybank', label: 'Holiday bank' },
    { view: 'offices', label: 'Offices' },
  ] },
  { key: 'payroll', title: 'Payroll', icon: 'payruns', items: [
    { view: 'payschedule', label: 'Pay schedule' },
    { view: 'payheads', label: 'Salary components' },
    { view: 'statutorycomponents', label: 'Statutory components' },
    { view: 'templates', label: 'Salary templates' },
    { view: 'paiddays', label: 'Paid days templates' },
  ] },
  { key: 'tax', title: 'Tax', icon: 'taxdetails', items: [
    { view: 'taxdetails', label: 'Tax details' },
    { view: 'payrollconfig', label: 'Statutory & tax settings' },
  ] },
  { key: 'performance', title: 'Performance', icon: 'kpi', items: [
    { view: 'kpi', label: 'KPI parameters' },
    { view: 'kpitemplates', label: 'KPI templates' },
    { view: 'cycle', label: 'Review cycle' },
  ] },
  { key: 'reimbursements', title: 'Reimbursements', icon: 'reimbursementtypes', items: [
    { view: 'reimbursementtypes', label: 'Reimbursement types' },
  ] },
  { key: 'organisation', title: 'Organisation details', icon: 'organisation', items: [
    { view: 'organisation', label: 'Organisation profile' },
    { view: 'departments', label: 'Departments' },
    { view: 'designations', label: 'Designations' },
  ] },
];

export const SETUP_VIEWS: View[] = SETUP_GROUPS.flatMap((g) => g.items.map((i) => i.view));

/** The Bulk assign page's cards: every bulk assignment, off its old section (hidden there) like Setup's pages. */
export const BULK_GROUPS: SetupGroup[] = [
  { key: 'shifts', title: 'Shifts', icon: 'shifttypes', items: [{ view: 'shiftbulk', label: 'Assign shift templates' }] },
  { key: 'payroll', title: 'Payroll', icon: 'payruns', items: [{ view: 'payrollbulk', label: 'Assign salary templates' }] },
  { key: 'performance', title: 'Performance', icon: 'kpi', items: [{ view: 'kpibulk', label: 'Assign KPI templates' }] },
];

export const BULK_VIEWS: View[] = BULK_GROUPS.flatMap((g) => g.items.map((i) => i.view));
