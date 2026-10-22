// A report from a question: Suwi picks one of the existing payroll or
// attendance reports, with the period and filters it understood, and this
// returns a preview (the first rows and the totals) and the criteria in
// words, from the same service functions the Reports page calls, so the
// numbers agree. Export stays on the Reports page. Never bank numbers or PAN.
import { tabsForRequest } from '../../models/dashboard-tabs';
import { hasAllDashboardTabs } from '../../middleware/admin.middleware';
import { liabilitySummary, payrollSummary, ptAnnualReturn, ptSummary, salaryRegister } from '../../services/payrollReports.service';
import { attendanceReport } from '../../services/attendance-report.service';
import { defineTools, num, rupees, str, SuwiContext, SuwiLink } from '../tools';
import { allRuns, bestByPeriod, fyOfPeriod, isPeriod, lastDayOf, monthLabel } from './payroll-common';

const REPORTS = {
  summary: { title: 'Payroll Summary', api: '/admin/payroll/reports/payroll-summary', what: 'every component paid over a period, and net pay and cost to company' },
  register: { title: 'Salary Register – Monthly', api: '/admin/payroll/reports/salary-register', what: 'one row per person for a month: days, gross, deductions, tax, net pay' },
  liability: { title: 'Payroll Liability Summary', api: '/admin/payroll/reports/liability-summary', what: 'what is owed to EPFO, ESIC, the tax department and states' },
  pt: { title: 'Professional Tax Summary', api: '/admin/payroll/reports/pt-summary', what: 'professional tax per person for a month' },
  ptannual: { title: 'PT Annual Return Statement', api: '/admin/payroll/reports/pt-annual', what: 'professional tax per month for a financial year' },
  attendance: { title: 'Attendance report', api: '/admin/reports/attendance', what: 'per person: present, half days, lates, early exits, missed punches, absences, leave' },
} as const;
type Key = keyof typeof REPORTS;

/** The same tab rule the report's own API applies. */
function mayOpen(ctx: SuwiContext, path: string) {
  if (hasAllDashboardTabs(ctx.user)) return true;
  const need = tabsForRequest('GET', path);
  return need === null || need.some((t) => (ctx.user.dashboardTabs ?? []).includes(t));
}
const norm = (s: unknown) => String(s ?? '').toLowerCase().trim();

defineTools({
  name: 'payroll_report',
  area: 'payroll',
  payroll: true,
  label: (i) => `${REPORTS[(i.report as Key) ?? 'summary']?.title ?? 'A report'} preview`,
  description: `Run one of the existing reports and return a preview (first rows and the totals) with the criteria spelled out, and a link to the Reports page where it can be exported. Pick the report that answers the question: ${Object.entries(REPORTS).map(([k, r]) => `${k} (${r.title}: ${r.what})`).join('; ')}. Period: month (YYYY-MM) for register and pt; from/to months for summary and liability; fy (2026-27) for ptannual; fromDate/toDate (YYYY-MM-DD) for attendance. Filters: department, name; for the register also minLopDays and sortBy (net, gross, lop, tax); for attendance minLate, minAbsent. includeDrafts adds months whose run is not submitted yet. Defaults: the latest month with a run.`,
  input_schema: {
    type: 'object',
    properties: {
      report: { type: 'string', enum: Object.keys(REPORTS) },
      month: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, fy: { type: 'string' },
      fromDate: { type: 'string' }, toDate: { type: 'string' },
      includeDrafts: { type: 'boolean' },
      department: { type: 'string' }, name: { type: 'string' },
      minLopDays: { type: 'number' }, sortBy: { type: 'string', enum: ['net', 'gross', 'lop', 'tax', 'name'] },
      minLate: { type: 'number' }, minAbsent: { type: 'number' },
      rows: { type: 'number', description: 'Preview rows, default 10, max 40' },
    },
    required: ['report'],
  },
  api: { method: 'GET', path: '/admin/payroll/reports/payroll-summary' },
  async run(ctx, i) {
    const key = (Object.keys(REPORTS).includes(str(i.report)) ? str(i.report) : 'summary') as Key;
    const R = REPORTS[key];
    if (!mayOpen(ctx, R.api)) return { data: { report: R.title, note: "You don't have access to that report." } };
    const limit = num(i.rows, 10, 1, 40);
    const runs = bestByPeriod(await allRuns(ctx.org));
    const latest = [...runs.keys()].sort().pop() ?? ctx.today.slice(0, 7);
    const latestFinal = [...runs.values()].filter((r) => r.status === 'paid' || r.status === 'approved').map((r) => r.period).sort().pop();
    const drafts = i.includeDrafts === true || (i.includeDrafts === undefined && !isPeriod(i.month) && !isPeriod(i.to) && !latestFinal);
    const opts = { includeDrafts: drafts };
    const dep = norm(i.department), who = norm(i.name);
    const criteria: string[] = [];
    const links: SuwiLink[] = [{ label: `Open ${R.title} in Reports`, view: key === 'attendance' ? 'attendancereport' : 'payrollreports' }];
    if (key !== 'attendance') criteria.push(drafts ? 'Includes runs not yet submitted (drafts)' : 'Submitted runs only (approved or paid)');
    const defaultMonth = isPeriod(i.month) ? i.month : drafts ? latest : latestFinal ?? latest;

    if (key === 'summary' || key === 'liability') {
      const to = isPeriod(i.to) ? i.to : isPeriod(i.month) ? i.month : defaultMonth;
      const from = isPeriod(i.from) ? i.from : isPeriod(i.month) ? i.month : to;
      criteria.unshift(from === to ? monthLabel(from) : `${monthLabel(from)} to ${monthLabel(to)}`);
      if (key === 'summary') {
        const r = await payrollSummary(ctx.userId, from, to, opts);
        return {
          data: {
            report: R.title, criteria, runsIncluded: r.runs.map((x) => `${x.period} (${x.status})`), employees: r.employees,
            sections: r.sections.map((s) => ({ title: s.title, rows: s.rows.slice(0, limit).map((x) => ({ name: x.name, amount: rupees(x.paise) })), more: Math.max(0, s.rows.length - limit), total: `${s.totalLabel}: ${rupees(s.totalPaise)}` })),
            netPay: rupees(r.netPayPaise), costToCompany: rupees(r.costToCompanyPaise),
            ...(dep || who ? { filterNote: 'This report is company-wide; department and name filters do not apply to it. The salary register can be filtered.' } : {}),
          },
          links,
        };
      }
      const r = await liabilitySummary(ctx.userId, from, to, opts);
      return { data: { report: R.title, criteria, runsIncluded: r.runs.map((x) => `${x.period} (${x.status})`), rows: r.rows.map((x) => ({ name: x.name, employee: rupees(x.employeePaise), employer: rupees(x.employerPaise), total: rupees(x.totalPaise) })), total: rupees(r.totalPaise) }, links };
    }

    if (key === 'register' || key === 'pt') {
      const month = defaultMonth;
      // Without drafts, a month whose run isn't submitted yet looks empty: say what is there instead of "no run".
      const unsubmitted = !drafts && runs.get(month) && runs.get(month)!.status !== 'paid' && runs.get(month)!.status !== 'approved'
        ? `${monthLabel(month)}'s run is ${runs.get(month)!.status} (not submitted yet); ask again with includeDrafts: true to see it.` : null;
      criteria.unshift(monthLabel(month));
      if (dep) criteria.push(`Department contains "${i.department}"`);
      if (who) criteria.push(`Name contains "${i.name}"`);
      if (key === 'pt') {
        const r = await ptSummary(ctx.userId, month, opts);
        const rows = r.rows.filter((x) => !who || norm(x.name).includes(who));
        return { data: { report: R.title, criteria, run: r.run?.status ?? unsubmitted ?? 'no run', people: rows.length, rows: rows.slice(0, limit).map((x) => ({ employeeId: x.employeeId, name: x.name, workLocation: x.workLocation, pt: rupees(x.ptPaise) })), total: rupees(rows.reduce((t, x) => t + x.ptPaise, 0)) }, links };
      }
      const r = await salaryRegister(ctx.userId, month, opts);
      let rows = r.rows.filter((x) => (!dep || norm(x.department).includes(dep)) && (!who || norm(x.name).includes(who)) && x.lopDays >= num(i.minLopDays, 0));
      if (num(i.minLopDays, 0) > 0) criteria.push(`At least ${i.minLopDays} loss-of-pay days`);
      const sort = str(i.sortBy);
      const by: Record<string, (x: (typeof rows)[number]) => number> = { net: (x) => x.netPayPaise, gross: (x) => x.grossPaise, lop: (x) => x.lopDays, tax: (x) => x.incomeTaxPaise };
      if (by[sort]) { rows = [...rows].sort((a, b) => by[sort](b) - by[sort](a)); criteria.push(`Sorted by ${sort}, highest first`); }
      const sum = (f: (x: (typeof rows)[number]) => number) => rows.reduce((t, x) => t + f(x), 0);
      return {
        data: {
          report: R.title, criteria, run: r.run?.status ?? unsubmitted ?? 'no run for this month', people: rows.length,
          rows: rows.slice(0, limit).map((x) => ({ userId: x.userId, employeeId: x.employeeId, name: x.name, department: x.department, paymentMode: x.paymentMode || 'not set', days: `${x.paidDays}/${x.baseDays}`, lopDays: x.lopDays, gross: rupees(x.grossPaise), deductions: rupees(x.totalDeductionsPaise), incomeTax: rupees(x.incomeTaxPaise), reimbursements: rupees(x.reimbursementsPaise), netPay: rupees(x.netPayPaise) })),
          more: Math.max(0, rows.length - limit),
          totals: { gross: rupees(sum((x) => x.grossPaise)), deductions: rupees(sum((x) => x.totalDeductionsPaise)), incomeTax: rupees(sum((x) => x.incomeTaxPaise)), reimbursements: rupees(sum((x) => x.reimbursementsPaise)), netPay: rupees(sum((x) => x.netPayPaise)), employerContributions: rupees(sum((x) => x.employerTotalPaise)) },
          note: 'Bank details are left out here; the Excel export on the Reports page has every column.',
        },
        links,
      };
    }

    if (key === 'ptannual') {
      const fy = typeof i.fy === 'string' && /^\d{4}-\d{2}$/.test(i.fy) ? i.fy : fyOfPeriod(ctx.today.slice(0, 7));
      criteria.unshift(`FY ${fy}`);
      const r = await ptAnnualReturn(ctx.userId, fy, opts);
      return { data: { report: R.title, criteria, rows: r.rows.map((x) => ({ periodEnd: x.periodEnd, status: x.status, employees: x.employees, pt: rupees(x.ptPaise) })), total: rupees(r.totalPaise) }, links };
    }

    // Attendance.
    const ok = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const fromMonth = isPeriod(i.month) ? i.month : undefined;
    const to = ok(i.toDate) ? String(i.toDate) : fromMonth ? (lastDayOf(fromMonth) < ctx.today ? lastDayOf(fromMonth) : ctx.today) : ctx.today;
    const from = ok(i.fromDate) ? String(i.fromDate) : fromMonth ? `${fromMonth}-01` : `${to.slice(0, 7)}-01`;
    criteria.push(`${from} to ${to}`);
    if (dep) criteria.push(`Department contains "${i.department}"`);
    if (who) criteria.push(`Name contains "${i.name}"`);
    const r = await attendanceReport(ctx.userId, { from, to });
    const per = new Map<string, { present: number; halfDay: number; late: number; early: number; missed: number; absent: number; leave: number }>();
    for (const [uid, , status, late, , , , , early] of r.days) {
      const p = per.get(uid) ?? { present: 0, halfDay: 0, late: 0, early: 0, missed: 0, absent: 0, leave: 0 };
      if (status === 'present') p.present++; else if (status === 'half_day') p.halfDay++; else if (status === 'missed_punch') p.missed++; else if (status === 'absent') p.absent++; else if (status === 'on_leave') p.leave++;
      if (late > 0) p.late++;
      if (early > 0) p.early++;
      per.set(uid, p);
    }
    let rows = [...per.entries()].map(([userId, c]) => ({ userId, name: r.people[userId]?.name ?? userId, department: r.people[userId]?.department ?? '', ...c }))
      .filter((x) => (!dep || norm(x.department).includes(dep)) && (!who || norm(x.name).includes(who)) && x.late >= num(i.minLate, 0) && x.absent >= num(i.minAbsent, 0));
    if (num(i.minLate, 0)) criteria.push(`At least ${i.minLate} late arrivals`);
    if (num(i.minAbsent, 0)) criteria.push(`At least ${i.minAbsent} absences`);
    rows = rows.sort((a, b) => b.absent - a.absent || b.late - a.late);
    const total = (k: 'present' | 'halfDay' | 'late' | 'early' | 'missed' | 'absent' | 'leave') => rows.reduce((t, x) => t + x[k], 0);
    return {
      data: { report: R.title, criteria, people: rows.length, rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit), totals: { present: total('present'), halfDays: total('halfDay'), lates: total('late'), earlyExits: total('early'), missedPunches: total('missed'), absences: total('absent'), leaveDays: total('leave') } },
      links,
    };
  },
});

