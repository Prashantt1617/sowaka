/**
 * People › Tasks: everyone whose setup is incomplete — no shift template, no
 * KPI template for the cycle, no salary, no bank details, or basic details
 * missing. Nothing is stored: a task is done the moment the data is there.
 * Salary and bank tasks are shown only to people with payroll access.
 */
import { employeePaymentDetails, kpiAssignments, salaryStructures, shiftTemplates, users } from '../config/db';
import { requestViewer } from '../middleware/request-viewer';
import { AdminError } from './admin.service';
import { hasPayrollAccess } from './payrollAccess.service';
import { currentPeriodFor } from './cycle';

export type TaskKey = 'details' | 'shift' | 'kpi' | 'salary' | 'bank';
export interface PersonTasks {
  userId: string;
  name: string;
  employeeId: string;
  designation: string;
  department: string;
  joiningDate: string;
  tasks: { key: TaskKey; label: string; detail: string }[];
}

const DETAILS: [keyof import('../models/user.model').User, string][] = [
  ['employeeId', 'Employee ID'], ['phone', 'Mobile'], ['joiningDate', 'Date of joining'], ['designation', 'Designation'],
  ['department', 'Department'], ['location', 'Work location'], ['gender', 'Gender'], ['birthday', 'Date of birth'], ['managerUserId', 'Reporting manager'],
];

export async function peopleTasks(viewerUserId: string) {
  const viewer = requestViewer(viewerUserId) ?? (await users().findOne({ userId: viewerUserId }));
  if (!viewer?.org || viewer.dashboardAccess !== true) throw new AdminError(403, 'No dashboard access');
  const open = viewer.dashboardAdmin === true || !Array.isArray(viewer.dashboardTabs) || viewer.dashboardTabs.includes('employees');
  if (!open) throw new AdminError(403, 'People › Tasks needs access to Employees');
  const org = viewer.org;
  const payroll = hasPayrollAccess(viewer);

  const people = (await users().find({ org }).toArray()).filter((p) => p.lifecycleStatus !== 'offboarded' && p.lifecycleStatus !== 'terminated');
  const ids = people.map((p) => p.userId);
  const onShift = new Set((await shiftTemplates().find({ org, deletedAt: { $exists: false } } as never).project<{ assignedUserIds?: string[] }>({ assignedUserIds: 1 }).toArray()).flatMap((t) => t.assignedUserIds ?? []));
  // A KPI set for the cycle in progress or a later one.
  const period = await currentPeriodFor(org);
  const onKpi = new Set((await kpiAssignments().find({ org, userId: { $in: ids }, period: { $gte: period } }).project<{ userId: string }>({ userId: 1 }).toArray()).map((a) => a.userId));
  const salary = payroll ? new Map((await salaryStructures().find({ org }).toArray()).map((s) => [s.userId, s])) : new Map();
  const bank = payroll ? new Map((await employeePaymentDetails().find({ org }).toArray()).map((d) => [d.userId, d])) : new Map();
  // The person at the top reports to nobody; that's not missing.
  const top = new Set(people.filter((p) => !p.managerUserId && people.some((q) => q.managerUserId === p.userId)).map((p) => p.userId));

  const out: PersonTasks[] = [];
  for (const p of people) {
    const tasks: PersonTasks['tasks'] = [];
    const missing = DETAILS.filter(([f]) => !(f === 'managerUserId' && top.has(p.userId)) && (p[f] === undefined || p[f] === null || String(p[f]).trim() === '')).map(([, label]) => label);
    if (missing.length) tasks.push({ key: 'details', label: 'Basic details', detail: missing.join(', ') });
    if (!onShift.has(p.userId)) tasks.push({ key: 'shift', label: 'Shift template', detail: 'No shift template assigned' });
    if (!onKpi.has(p.userId)) tasks.push({ key: 'kpi', label: 'KPI template', detail: `No KPIs for ${period} or later` });
    if (payroll) {
      const s = salary.get(p.userId);
      if (!s || !s.salaryTemplateCode || !s.annualCtcPaise) tasks.push({ key: 'salary', label: 'Salary', detail: !s ? 'No salary assigned' : !s.salaryTemplateCode ? 'No salary template' : 'No CTC' });
      const b = bank.get(p.userId);
      const gaps = [!b?.accountNumber && 'Account number', !b?.ifsc && 'IFSC', !b?.pan && 'PAN'].filter(Boolean) as string[];
      if (b?.payMode && b.payMode !== 'bank_transfer') gaps.splice(0, 2);
      if (gaps.length) tasks.push({ key: 'bank', label: 'Bank & PAN', detail: gaps.join(', ') });
    }
    if (tasks.length) {
      out.push({
        userId: p.userId, name: p.name, employeeId: p.employeeId ?? '', designation: p.designation ?? '', department: p.department ?? '',
        joiningDate: p.joiningDate ? new Date(p.joiningDate).toISOString().slice(0, 10) : '', tasks,
      });
    }
  }
  // Newest joiners first: they're the ones most likely still being set up.
  out.sort((a, b) => b.joiningDate.localeCompare(a.joiningDate) || a.name.localeCompare(b.name));
  return { period, payroll, total: people.length, people: out };
}
