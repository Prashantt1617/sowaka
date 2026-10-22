// Payroll explained: one person's payslip for a month against the month
// before, line by line, with the reasons the run recorded (LOP days and the
// dates behind them, revisions, the PF ceiling, tax source, one-time amounts,
// claims); and the company's payroll cost this month against last, split by
// cause. Read-only, payroll access only; nothing here changes a run.
import { payHeads, reimbursementClaims, salaryStructures, users } from '../../config/db';
import { ObjectId } from 'mongodb';
import { employeeCalendar } from '../../services/attendance-report.service';
import { EPF_CEILING_SCHEDULE } from '../../models/statutoryRule.model';
import { defineTools, rupees, str, SuwiContext } from '../tools';
import { addMonths, allRuns, bestByPeriod, delta, lastDayOf, monthLabel, pct, showLines, slipLines, slipsOfRun, STATUS_LABEL, StoredRun, StoredSlip, taxSource } from './payroll-common';
import { payslips } from '../../config/db';

const ACTIVE = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as const;

/** Lines keyed by code, so two months can be matched line by line. */
const byCode = (lines: { code: string; name: string; paise: number }[]) => new Map(lines.map((l) => [l.code, l]));
function lineDiffs(now: { code: string; name: string; paise: number }[], before: { code: string; name: string; paise: number }[]) {
  const a = byCode(now), b = byCode(before);
  const out: { name: string; before: string; now: string; change: string; changePaise: number }[] = [];
  for (const code of new Set([...a.keys(), ...b.keys()])) {
    const n = a.get(code)?.paise ?? 0, p = b.get(code)?.paise ?? 0;
    if (n === p) continue;
    out.push({ name: (a.get(code) ?? b.get(code))!.name, before: rupees(p), now: rupees(n), change: delta(n - p), changePaise: n - p });
  }
  return out.sort((x, y) => Math.abs(y.changePaise) - Math.abs(x.changePaise));
}

/** Absent and half days in a month, from the same calendar the dashboard shows. */
async function lostDays(ctx: SuwiContext, userId: string, month: string) {
  try {
    const cal = await employeeCalendar(ctx.userId, userId, month);
    const absent = cal.days.filter((d) => d.status === 'absent').map((d) => d.date);
    const half = cal.days.filter((d) => d.status === 'half_day').map((d) => d.date);
    const hrMarked = cal.days.filter((d) => d.hr).map((d) => `${d.date} (${d.status})`);
    return { absentDays: absent.length, absentDates: absent.slice(0, 12), halfDays: half.length, halfDayDates: half.slice(0, 12), markedByHr: hrMarked.slice(0, 8) };
  } catch {
    return undefined;
  }
}

function monthView(s: StoredSlip, run: StoredRun) {
  const L = slipLines(s);
  const i = s.inputs;
  const oneTime = Object.entries(i?.componentAmounts ?? {}).map(([code, paise]) => ({ code, amount: rupees(paise) }));
  return {
    period: s.period,
    month: monthLabel(s.period),
    runStatus: STATUS_LABEL[run.status] ?? run.status,
    payslipId: s._id.toHexString(),
    days: {
      daysInMonth: i?.workingDays ?? 0, lopDays: i?.lopDays ?? 0, paidDays: i?.payableDays ?? 0,
      lopFromAttendance: i?.attendanceLopDays, lopTypedByHr: i?.lopEnteredByHr === true,
      attendanceRules: (i?.attendanceDeductions ?? []).filter((r) => r.days > 0).map((r) => `${r.label}: ${r.count} → ${r.days} day${r.days === 1 ? '' : 's'}`),
      paidLeaveApplied: i?.paidLeaveDaysApplied ?? 0,
    },
    monthlyCtc: rupees(s.monthlyCtcPaise), annualCtc: rupees(s.annualCtcPaise),
    earnings: showLines(L.earnings), gross: rupees(L.grossPaise), grossIfNoLop: rupees(L.fullGrossPaise), lostToLop: rupees(L.lopLossPaise),
    deductions: showLines(L.deductions), totalDeductions: rupees(L.deductionsPaise),
    reimbursements: showLines(L.reimbursements), totalReimbursements: rupees(L.reimbursementsPaise),
    netPay: rupees(L.netPayablePaise),
    employer: showLines(L.employer), costToCompany: rupees(L.employerCostPaise),
    pfWage: rupees(s.pfWagePaise), esiCovered: s.esiApplicable === true,
    incomeTax: { amount: rupees(L.incomeTaxPaise), source: taxSource(s), ...(i?.tds ? { regime: i.tds.regime, annualTax: rupees(i.tds.annualTaxPaise), deductedBefore: rupees(i.tds.alreadyDeductedPaise), monthsLeft: i.tds.monthsLeft, proofs: i.tds.proofs ?? 'none' } : {}) },
    oneTimeAmounts: oneTime,
    overtime: i?.overtimePaise ? { hours: i.approvedOtHours, amount: rupees(i.overtimePaise), typedByHr: i.overtimeEnteredByHr === true } : undefined,
    claimsPaid: (i?.reimbursementClaimIds ?? []).length,
    _L: L,
  };
}

defineTools(
  {
    name: 'payslip_explain',
    area: 'payroll',
    payroll: true,
    label: (i) => `${i.name ?? 'Their'} payslip for ${i.month ?? 'the latest month'} and the month before`,
    description: "One person's payslip lines for a month (earnings, deductions, reimbursements, employer cost, days paid, income tax and where it came from) and the same for the previous month, with every line that changed and the reasons the run recorded: LOP days with the dates, attendance rules, salary revisions effective in either month, the PF ceiling, one-time amounts, overtime, claims, tax source. Use for 'explain X's payslip', 'why did X's pay change / drop', 'why is PF different', 'why was tax higher'. Needs the userId (search_people). Figures are in rupees; do not recompute them.",
    input_schema: {
      type: 'object',
      properties: {
        userId: { type: 'string' }, name: { type: 'string', description: 'Their name, for the label' },
        month: { type: 'string', description: 'YYYY-MM. Default: their latest payslip' },
      },
      required: ['userId'],
    },
    api: { method: 'GET', path: '/admin/employees/x/payslips' },
    async run(ctx, i) {
      const userId = str(i.userId);
      const person = await users().findOne({ userId, org: ctx.org }, { projection: { _id: 0, name: 1, joiningDate: 1, endDate: 1, lifecycleStatus: 1 } });
      if (!person) return { data: { found: false, note: 'No one with that id in this company.' } };
      const runs = bestByPeriod(await allRuns(ctx.org));
      const mine = (await payslips().find({ org: ctx.org, userId }).sort({ period: -1 }).toArray() as StoredSlip[]).filter((s) => runs.get(s.period)?._id.toHexString() === s.runId);
      if (!mine.length) return { data: { found: true, name: person.name, note: 'No payslips for this person yet.' }, links: [{ label: `Open ${person.name}'s salary`, userId, tab: 'salary' }] };
      const want = typeof i.month === 'string' && /^\d{4}-\d{2}$/.test(i.month) ? i.month : mine[0].period;
      const cur = mine.find((s) => s.period === want);
      if (!cur) return { data: { found: true, name: person.name, note: `No payslip for ${monthLabel(want)}. Months with one: ${mine.map((s) => s.period).join(', ')}.` }, links: [{ label: `Open ${person.name}'s salary`, userId, tab: 'salary' }] };
      const prev = mine.find((s) => s.period < want);
      const now = monthView(cur, runs.get(cur.period)!);
      const before = prev ? monthView(prev, runs.get(prev.period)!) : undefined;

      // Reasons the two months differ.
      const reasons: string[] = [];
      const [attNow, attBefore] = await Promise.all([lostDays(ctx, userId, cur.period), prev ? lostDays(ctx, userId, prev.period) : undefined]);
      const structure = await salaryStructures().findOne({ org: ctx.org, userId }, { projection: { _id: 0, revisions: 1, salaryTemplateCode: 1, annualCtcPaise: 1, status: 1 } });
      const from = prev ? `${prev.period}-01` : `${cur.period}-01`, to = lastDayOf(cur.period);
      const revisions = (structure?.revisions ?? []).filter((r) => r.effectiveFrom >= from && r.effectiveFrom <= to && r.previousCtcPaise > 0)
        .map((r) => ({ effectiveFrom: r.effectiveFrom, from: rupees(r.previousCtcPaise), to: rupees(r.annualCtcPaise), change: delta(r.annualCtcPaise - r.previousCtcPaise) }));
      for (const r of revisions) reasons.push(`Annual CTC revised ${r.from} → ${r.to} effective ${r.effectiveFrom}.`);
      if (before && cur.annualCtcPaise !== prev!.annualCtcPaise && !revisions.length) reasons.push(`Annual CTC on the payslip changed ${rupees(prev!.annualCtcPaise)} → ${rupees(cur.annualCtcPaise)}.`);
      if (before && now.days.lopDays !== before.days.lopDays) reasons.push(`Loss of pay ${before.days.lopDays} → ${now.days.lopDays} days (${now.days.lopTypedByHr ? 'typed by HR on the run' : 'from attendance'}): ${rupees(now._L.lopLossPaise)} of earnings not paid this month vs ${rupees(before._L.lopLossPaise)} before.`);
      else if (now.days.lopDays > 0) reasons.push(`${now.days.lopDays} loss-of-pay day${now.days.lopDays === 1 ? '' : 's'} (${now.days.lopTypedByHr ? 'typed by HR on the run' : 'from attendance'}): ${rupees(now._L.lopLossPaise)} of earnings not paid.`);
      const joined = person.joiningDate ? new Date(person.joiningDate).toISOString().slice(0, 10) : undefined;
      if (joined && joined.slice(0, 7) === cur.period && joined > `${cur.period}-01`) reasons.push(`Joined on ${joined}: paid from that day.`);
      if (before && joined && joined.slice(0, 7) === prev!.period && joined > `${prev!.period}-01`) reasons.push(`Joined on ${joined}, so ${monthLabel(prev!.period)} was a part month.`);
      const ceilingChange = EPF_CEILING_SCHEDULE.filter((s) => s.from >= from && s.from <= to);
      if (ceilingChange.length) reasons.push(`The PF wage ceiling changed on ${ceilingChange.map((c) => `${c.from} (to ${rupees(c.ceilingPaise)})`).join(', ')}; a month that straddles the change uses a day-weighted ceiling.`);
      if (before && cur.pfWagePaise !== prev!.pfWagePaise) reasons.push(`PF wage ${rupees(prev!.pfWagePaise)} → ${rupees(cur.pfWagePaise)}.`);
      if (before && now.esiCovered !== before.esiCovered) reasons.push(now.esiCovered ? 'ESI applies this month and did not before.' : 'ESI no longer applies this month (coverage holds till the end of a contribution period, then is re-tested).');
      if (before && now._L.incomeTaxPaise !== before._L.incomeTaxPaise) reasons.push(`Income tax ${rupees(before._L.incomeTaxPaise)} → ${rupees(now._L.incomeTaxPaise)} (this month ${now.incomeTax.source}; last month ${before.incomeTax.source}).${now.incomeTax.source === 'TDS engine' ? ' The engine re-projects the year every month: what has been paid so far, the months left, declarations and bills all move it.' : ''}`);
      if (now.oneTimeAmounts.length) reasons.push(`One-time amounts on this run: ${now.oneTimeAmounts.map((o) => `${o.code} ${o.amount}`).join(', ')}.`);
      if (before?.oneTimeAmounts.length) reasons.push(`One-time amounts last month: ${before.oneTimeAmounts.map((o) => `${o.code} ${o.amount}`).join(', ')}.`);
      if (before && now.claimsPaid !== before.claimsPaid) reasons.push(`Expense claims paid: ${before.claimsPaid} last month, ${now.claimsPaid} this month.`);
      if (before && now.overtime?.amount !== before.overtime?.amount) reasons.push(`Overtime ${before.overtime?.amount ?? '₹0'} → ${now.overtime?.amount ?? '₹0'}.`);
      if (runs.get(cur.period)!.status === 'draft') reasons.push(`${monthLabel(cur.period)} is a draft run: these figures can still change before it is submitted.`);

      const { _L: _a, ...nowOut } = now;
      const { _L: _b, ...beforeOut } = before ?? ({} as typeof now);
      return {
        data: {
          found: true, name: person.name, userId,
          thisMonth: { ...nowOut, attendance: attNow },
          previousMonth: before ? { ...beforeOut, attendance: attBefore } : null,
          differences: before ? {
            netPay: { before: before.netPay, now: now.netPay, change: delta(now._L.netPayablePaise - before._L.netPayablePaise) },
            gross: { before: before.gross, now: now.gross, change: delta(now._L.grossPaise - before._L.grossPaise) },
            earnings: lineDiffs(now._L.earnings, before._L.earnings),
            deductions: lineDiffs(now._L.deductions, before._L.deductions),
            reimbursements: lineDiffs(now._L.reimbursements, before._L.reimbursements),
            employer: lineDiffs(now._L.employer, before._L.employer),
          } : null,
          reasons,
          salaryRevisionsInWindow: revisions,
          olderPayslips: mine.filter((s) => s.period < (prev?.period ?? want)).map((s) => s.period),
          note: 'Amounts are from the payslips as the run computed them. Earnings show the full-month figure where loss of pay reduced the paid amount.',
        },
        links: [
          { label: `Open ${person.name}'s salary`, userId, tab: 'salary' },
          { label: 'Open payroll runs', view: 'payruns' },
          { label: 'Open the salary register', view: 'payrollreports' },
        ],
      };
    },
  },
  {
    name: 'payroll_cost_change',
    area: 'payroll',
    payroll: true,
    label: (i) => `Payroll cost for ${i.month ?? 'the latest run'} against the month before`,
    description: "Why the company's payroll total moved: this month's run against the previous month's (gross, deductions, net pay, reimbursements, cost to company), split by cause: joiners (on this run only), leavers (on last month's only), loss of pay, salary revisions, one-time amounts and arrears, overtime, expense claims, tax and statutory changes; plus held payouts on this run and claims still waiting (pending, or approved and not yet on a run). Use for 'why is payroll higher this month', 'what changed in payroll cost', 'how much did we pay in October'.",
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM. Default: the latest run' } } },
    api: { method: 'GET', path: '/admin/payroll/reports/payroll-summary' },
    async run(ctx, i) {
      const runs = bestByPeriod(await allRuns(ctx.org));
      const periods = [...runs.keys()].sort();
      if (!periods.length) return { data: { note: 'No payroll runs yet.' }, links: [{ label: 'Open payroll runs', view: 'payruns' }] };
      const month = typeof i.month === 'string' && runs.has(i.month) ? i.month : periods[periods.length - 1];
      const prevPeriod = periods.filter((p) => p < month).pop();
      const run = runs.get(month)!;
      const prev = prevPeriod ? runs.get(prevPeriod)! : undefined;
      const [slipsNow, slipsBefore] = await Promise.all([slipsOfRun(ctx.org, run), prev ? slipsOfRun(ctx.org, prev) : Promise.resolve([] as StoredSlip[])]);
      const sum = (slips: StoredSlip[], f: (s: StoredSlip) => number) => slips.reduce((t, s) => t + f(s), 0);
      const totals = (slips: StoredSlip[]) => ({
        people: slips.length, grossPaise: sum(slips, (s) => s.grossPaise), deductionsPaise: sum(slips, (s) => s.employeeDeductionsPaise), netPaise: sum(slips, (s) => s.netPayablePaise),
        reimbursementsPaise: sum(slips, (s) => s.reimbursementsPaise ?? 0), employerPaise: sum(slips, (s) => s.employer?.totalPaise ?? 0), costPaise: sum(slips, (s) => s.employerCostPaise),
        taxPaise: sum(slips, (s) => slipLines(s).incomeTaxPaise),
      });
      const T = totals(slipsNow), P = totals(slipsBefore);
      const show = (t: ReturnType<typeof totals>) => ({ people: t.people, gross: rupees(t.grossPaise), deductions: rupees(t.deductionsPaise), incomeTax: rupees(t.taxPaise), netPay: rupees(t.netPaise), reimbursements: rupees(t.reimbursementsPaise), employerContributions: rupees(t.employerPaise), costToCompany: rupees(t.costPaise) });

      const beforeBy = new Map(slipsBefore.map((s) => [s.userId, s]));
      const nowBy = new Map(slipsNow.map((s) => [s.userId, s]));
      const heads = new Map((await payHeads().find({ org: ctx.org }, { projection: { _id: 0, code: 1, name: 1, componentType: 1 } }).toArray()).map((h) => [h.code, h]));
      type Cause = { cause: string; costChange: string; costChangePaise: number; netChange: string; people: { userId: string; name: string; amount: string }[] };
      const cause = (name: string): Cause => ({ cause: name, costChange: '', costChangePaise: 0, netChange: '', people: [] });
      const joiners = cause('Joiners: on this run, not on last month\'s'), leavers = cause('Leavers: on last month\'s run, not on this'), lop = cause('Loss of pay (earnings not paid for unpaid days)');
      const revisions = cause('Salary revisions (monthly CTC changed)'), oneTime = cause('One-time amounts and arrears'), overtime = cause('Overtime'), claims = cause('Expense claims paid with salary');
      const statutory = cause('Employer contributions (PF, ESI, LWF, benefits)'), tax = cause('Income tax withheld (net pay only; not a cost)');
      let netLop = 0, netJoin = 0, netLeave = 0, netRev = 0, netOne = 0, netOt = 0, netClaims = 0, netTax = 0, netStat = 0;
      const add = (c: Cause, s: StoredSlip, costPaise: number, netPaise: number) => {
        if (!costPaise && !netPaise) return;
        c.costChangePaise += costPaise;
        if (c.people.length < 8) c.people.push({ userId: s.userId, name: s.employeeName, amount: delta(costPaise || netPaise) });
      };
      const oneTimeOf = (s: StoredSlip) => Object.entries(s.inputs?.componentAmounts ?? {}).reduce((t, [code, v]) => {
        const paid = s.earnings.find((e) => e.code === code)?.paidPaise ?? s.deductions.find((d) => d.key === code)?.amountPaise ?? v;
        return t + (heads.get(code)?.componentType === 'hold_amount' || heads.get(code)?.componentType === 'salary_advance' || s.deductions.some((d) => d.key === code) ? -paid : paid);
      }, 0);
      for (const s of slipsNow) {
        const b = beforeBy.get(s.userId);
        if (!b) { add(joiners, s, s.employerCostPaise, s.netPayablePaise); netJoin += s.netPayablePaise; continue; }
        const Ln = slipLines(s), Lb = slipLines(b);
        const lopDelta = -(Ln.lopLossPaise - Lb.lopLossPaise);
        add(lop, s, lopDelta, lopDelta); netLop += lopDelta;
        const ctcDelta = s.monthlyCtcPaise - b.monthlyCtcPaise;
        add(revisions, s, ctcDelta, ctcDelta); netRev += ctcDelta;
        const oneDelta = oneTimeOf(s) - oneTimeOf(b);
        add(oneTime, s, oneDelta, oneDelta); netOne += oneDelta;
        const otDelta = (s.inputs?.overtimePaise ?? 0) - (b.inputs?.overtimePaise ?? 0);
        add(overtime, s, otDelta, otDelta); netOt += otDelta;
        const claimDelta = (Ln.reimbursementsPaise - Lb.reimbursementsPaise);
        add(claims, s, claimDelta, claimDelta); netClaims += claimDelta;
        const statDelta = (s.employer?.totalPaise ?? 0) - (b.employer?.totalPaise ?? 0) - (ctcDelta > 0 ? 0 : 0);
        add(statutory, s, statDelta, 0); netStat += statDelta;
        const taxDelta = -(Ln.incomeTaxPaise - Lb.incomeTaxPaise);
        add(tax, s, 0, taxDelta); netTax += taxDelta;
      }
      for (const b of slipsBefore) if (!nowBy.has(b.userId)) { add(leavers, b, -b.employerCostPaise, -b.netPayablePaise); netLeave -= b.netPayablePaise; }
      const finish = (c: Cause, net: number) => { c.costChange = delta(c.costChangePaise); c.netChange = delta(net); return c; };
      const causes = [finish(joiners, netJoin), finish(leavers, netLeave), finish(lop, netLop), finish(revisions, netRev), finish(oneTime, netOne), finish(overtime, netOt), finish(claims, netClaims), finish(statutory, netStat), finish(tax, netTax)]
        .filter((c) => c.costChangePaise !== 0 || c.netChange !== 'no change');
      const explained = causes.reduce((t, c) => t + c.costChangePaise, 0);

      // Held payouts on this run, and claims still waiting.
      const held = slipsNow.flatMap((s) => s.deductions.filter((d) => heads.get(d.key)?.componentType === 'hold_amount' && d.amountPaise > 0).map((d) => ({ userId: s.userId, name: s.employeeName, amount: rupees(d.amountPaise) })));
      const ids = (await users().find({ org: ctx.org, ...ACTIVE } as never, { projection: { _id: 0, userId: 1 } }).toArray()).map((u) => u.userId);
      const onRuns = new Set((await payslips().find({ org: ctx.org }, { projection: { 'inputs.reimbursementClaimIds': 1 } }).toArray()).flatMap((s) => s.inputs?.reimbursementClaimIds ?? []));
      const waiting = await reimbursementClaims().find({ userId: { $in: ids }, status: { $in: ['pending', 'approved'] } }).toArray();
      const pending = waiting.filter((c) => c.status === 'pending');
      const approvedNotOnRun = waiting.filter((c) => c.status === 'approved' && !onRuns.has((c as { _id?: ObjectId })._id?.toHexString() ?? ''));
      const paise = (list: typeof waiting) => list.reduce((t, c) => t + Math.round((c.amount ?? 0) * 100), 0);

      return {
        data: {
          month: monthLabel(month), runStatus: STATUS_LABEL[run.status] ?? run.status,
          previousMonth: prev ? monthLabel(prev.period) : null, previousRunStatus: prev ? STATUS_LABEL[prev.status] ?? prev.status : null,
          thisMonth: show(T),
          previousMonthTotals: prev ? show(P) : null,
          change: prev ? {
            costToCompany: `${delta(T.costPaise - P.costPaise)} (${pct(T.costPaise - P.costPaise, P.costPaise)}%)`,
            netPay: `${delta(T.netPaise - P.netPaise)} (${pct(T.netPaise - P.netPaise, P.netPaise)}%)`,
            gross: delta(T.grossPaise - P.grossPaise), incomeTax: delta(T.taxPaise - P.taxPaise), reimbursements: delta(T.reimbursementsPaise - P.reimbursementsPaise),
          } : null,
          causes,
          unexplainedCostChange: prev ? delta(T.costPaise - P.costPaise - explained) : null,
          heldPayouts: held,
          claimsWaiting: { pending: pending.length, pendingAmount: rupees(paise(pending)), approvedNotYetOnARun: approvedNotOnRun.length, approvedAmount: rupees(paise(approvedNotOnRun)) },
          note: prev ? 'Cost to company = gross + salary reimbursements + employer contributions. Each cause shows the change it made to cost (and to net pay); "unexplained" is what the causes above do not account for (statutory re-tests, rounding, hidden lines).' : 'Only one run so far, so there is nothing to compare with.',
        },
        links: [{ label: 'Open payroll runs', view: 'payruns' }, { label: 'Open the payroll summary', view: 'payrollreports' }, { label: 'Open reimbursements', view: 'reimbursements' }],
      };
    },
  },
);

export { addMonths };
