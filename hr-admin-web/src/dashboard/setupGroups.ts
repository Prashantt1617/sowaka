// The Setup page's cards: every settings page, grouped by what it sets up. These pages are off
// their old sidebar sections (hidden there, so who may open them is unchanged) and reached from Setup.
import type { View } from './theme';

export type SetupGroup = {
  key: string; title: string; icon: View;
  /** `open`: a value the page reads once on opening (the Employee lifecycle card opens Templates on one kind). */
  items: { view: View; label: string; open?: string }[];
  /** A card that is new: a small badge and the blue outline. */
  isNew?: boolean;
  /** Shown only where the company has this feature switched on. */
  feature?: 'lifecycle';
};

export const SETUP_GROUPS: SetupGroup[] = [
  { key: 'organisation', title: 'Organisation details', icon: 'organisation', items: [
    { view: 'organisation', label: 'Organisation profile' },
    { view: 'departments', label: 'Departments' },
    { view: 'designations', label: 'Designations' },
  ] },
  { key: 'attendance', title: 'Attendance', icon: 'shifttypes', items: [
    { view: 'shifttypes', label: 'Shift templates' },
    { view: 'holidaybank', label: 'Holiday bank' },
    { view: 'offices', label: 'Offices' },
  ] },
  { key: 'payroll', title: 'Payroll', icon: 'payruns', items: [
    { view: 'payschedule', label: 'Pay schedule' },
    { view: 'payheads', label: 'Salary components' },
    { view: 'templates', label: 'Salary templates' },
    { view: 'paiddays', label: 'Paid days templates' },
    { view: 'exitsettings', label: 'Exit settings' },
  ] },
  { key: 'tax', title: 'Tax', icon: 'taxdetails', items: [
    { view: 'taxdetails', label: 'Tax details' },
    { view: 'statutorycomponents', label: 'Statutory & tax' },
  ] },
  { key: 'performance', title: 'Performance', icon: 'kpi', items: [
    { view: 'kpi', label: 'KPI parameters' },
    { view: 'kpitemplates', label: 'KPI templates' },
    { view: 'cycle', label: 'Review cycle' },
  ] },
  { key: 'reimbursements', title: 'Reimbursements', icon: 'reimbursementtypes', items: [
    { view: 'reimbursementtypes', label: 'Reimbursement types' },
  ] },
  { key: 'notifications', title: 'Notifications', icon: 'notificationlook', isNew: true, items: [
    { view: 'notificationlook', label: 'Notification sounds and pictures' },
  ] },
  { key: 'lifecycle', title: 'Employee lifecycle', icon: 'onboarding', isNew: true, feature: 'lifecycle', items: [
    { view: 'lifecycle_templates', label: 'Onboarding templates', open: 'onboarding' },
    { view: 'lifecycle_templates', label: 'Offboarding templates', open: 'offboarding' },
    { view: 'lifecycle_letter_templates', label: 'Document templates' },
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

/** Salary components opens on the tab named here once (FBP splits sets it to 'fbpbills'). */
export const OPEN_TAB_KEY = 'sowaka.payheads.tab';

/** Templates opens on the kind named here once (the Setup card's Onboarding / Offboarding templates). */
export const LIFECYCLE_TEMPLATES_KIND_KEY = 'sowaka.lifecycle.templates.kind';
