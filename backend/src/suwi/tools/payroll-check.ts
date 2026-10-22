// Is this month's payroll ready? The current draft run's blockers (missing
// bank, PAN, UAN, template, a month still open, claims changed since the run
// was computed, TDS without rates) and flags worth a look before submitting,
// each worked out against last month's run: pay jumps and drops, unusual loss
// of pay, joiners and leavers paid a full month, large claims, tax moved with
// no salary change. Read-only.
import { ObjectId } from 'mongodb';
import { employeePaymentDetails, payslips, reimbursementClaims, salaryStructures, users } from '../../config/db';
import { peopleTasks } from '../../services/peopleTasks.service';
import { statutorySettingsFor } from '../../services/statutorySettings.service';
import { tdsConfigsFor } from '../../services/tds.service';
import { defineTools, rupees } from '../tools';
import { allRuns, bestByPeriod, daysInMonth, delta, fyOfPeriod, lastDayOf, monthLabel, pct, slipLines, slipsOfRun, STATUS_LABEL, taxSource } from './payroll-common';

type Item = { person?: { userId: string; name: string }; what: string; numbers?: string; fix?: string };
const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0);

defineTools({
  name: 'payroll_run_check',
  area: 'payroll',
  payroll: true,
  label: () => 'The current payroll run: blockers and flags',
  description: "Whether this month's payroll run is ready to submit. Returns the current (not yet submitted) run with its totals, blockers (people with a salary but no template or no payslip, missing bank account / PAN / UAN, the month not over yet, claims changed since the run was computed, TDS on without rates for the year) and flags against last month's run with the person and the numbers: net pay up or down more than 15%, loss of pay far above their usual, joiners or leavers paid a full month, claims larger than usual, tax changed with no salary change, people dropped from or new on the run. Use for 'is payroll ready', 'anything odd in this month's run', 'what should I check before submitting'. For a month already submitted use payroll_cost_change.",
  input_schema: { type: 'object', properties: {} },
  api: { method: 'GET', path: '/admin/payroll/runs' },
  async run(ctx) {
    const runs = await allRuns(ctx.org);
    const best = bestByPeriod(runs);
    const open = runs.find((r) => r.status !== 'paid' && r.status !== 'approved');
    if (!open) {
      const last = runs[0];
      return {
        data: { currentRun: null, note: last ? `No run is open. The latest run, ${monthLabel(last.period)}, is ${STATUS_LABEL[last.status]}.` : 'No payroll runs yet.' },
        links: [{ label: 'Open payroll runs', view: 'payruns' }],
      };
    }
    const period = open.period;
    const monthEnd = lastDayOf(period);
    const days = daysInMonth(period);
    const slips = await slipsOfRun(ctx.org, open);
    const onRun = new Set(slips.map((s) => s.userId));
    const prevPeriod = [...best.keys()].filter((p) => p < period).sort().pop();
    const prevSlips = prevPeriod ? await slipsOfRun(ctx.org, best.get(prevPeriod)!) : [];
    const prevBy = new Map(prevSlips.map((s) => [s.userId, s]));
    const blockers: Item[] = [];
    const flags: Item[] = [];
    const info: string[] = [];

    // People with an active salary who should be on the run but are not.
    const structures = await salaryStructures().find({ org: ctx.org, status: 'active' }, { projection: { _id: 0, userId: 1, salaryTemplateCode: 1, statutory: 1 } }).toArray();
    const people = new Map((await users().find({ org: ctx.org, userId: { $in: [...new Set([...structures.map((s) => s.userId), ...prevSlips.map((s) => s.userId)])] } }, { projection: { _id: 0, userId: 1, name: 1, joiningDate: 1, endDate: 1, lifecycleStatus: 1 } }).toArray()).map((u) => [u.userId, u]));
    const gone = (status?: string) => status === 'offboarded' || status === 'terminated';
    for (const s of structures) {
      const u = people.get(s.userId);
      if (!u || onRun.has(s.userId) || gone(u.lifecycleStatus)) continue;
      const joined = u.joiningDate ? new Date(u.joiningDate).toISOString().slice(0, 10) : undefined;
      if (joined && joined > monthEnd) continue;
      blockers.push({ person: { userId: u.userId, name: u.name }, what: s.salaryTemplateCode ? 'Has an active salary but no payslip on this run' : 'Has a salary but no salary template, so no payslip was made', fix: s.salaryTemplateCode ? 'Recalculate the run' : 'Assign a template on their Salary details, then recalculate the run' });
    }

    // Bank and PAN (the same gaps People › Tasks shows), and UAN where PF is deducted.
    try {
      const tasks = await peopleTasks(ctx.userId);
      for (const p of tasks.people) {
        const bank = p.tasks.find((t) => t.key === 'bank');
        if (bank && onRun.has(p.userId)) blockers.push({ person: { userId: p.userId, name: p.name }, what: `Missing ${bank.detail}`, fix: 'Add on their profile (Bank & PAN)' });
      }
    } catch { info.push('Bank and PAN gaps could not be checked: that needs access to Employees.'); }
    const settings = await statutorySettingsFor(ctx.org);
    if (settings.epf.enabled) {
      const pay = new Map((await employeePaymentDetails().find({ org: ctx.org, userId: { $in: [...onRun] } } as never).toArray() as unknown as { userId: string; uan?: string }[]).map((d) => [d.userId, d]));
      const uanOf = new Map(structures.map((s) => [s.userId, s.statutory?.uan]));
      for (const s of slips) {
        if (s.deductions.some((d) => d.key === 'epf') && !uanOf.get(s.userId) && !pay.get(s.userId)?.uan) {
          blockers.push({ person: { userId: s.userId, name: s.employeeName }, what: 'PF is deducted but no UAN is recorded', fix: 'Add the UAN on their Salary details or Bank & PAN' });
        }
      }
    }

    // The month itself, claims, and tax.
    if (ctx.today <= monthEnd) {
      const left = Math.round((Date.parse(`${monthEnd}T00:00:00Z`) - Date.parse(`${ctx.today}T00:00:00Z`)) / 86_400_000) + 1;
      blockers.push({ what: `${monthLabel(period)} is not over: ${left} day${left === 1 ? '' : 's'} still to come (today included), so attendance and loss of pay can still change`, fix: 'Recalculate after the month ends, then submit' });
    }
    const claimIds = slips.flatMap((s) => s.inputs?.reimbursementClaimIds ?? []).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    if (claimIds.length) {
      const stale = await reimbursementClaims().countDocuments({ _id: { $in: claimIds }, status: { $ne: 'approved' } });
      if (stale) blockers.push({ what: `${stale} reimbursement claim${stale === 1 ? '' : 's'} on this run ${stale === 1 ? 'was' : 'were'} paid or changed since it was calculated; submitting will refuse`, fix: 'Recalculate the run, then submit' });
    }
    const onAnyRun = new Set((await payslips().find({ org: ctx.org }, { projection: { 'inputs.reimbursementClaimIds': 1 } }).toArray()).flatMap((s) => s.inputs?.reimbursementClaimIds ?? []));
    const approvedLeft = (await reimbursementClaims().find({ userId: { $in: [...onRun] }, status: 'approved' }).toArray()).filter((c) => !onAnyRun.has((c as { _id?: ObjectId })._id?.toHexString() ?? ''));
    if (approvedLeft.length) flags.push({ what: `${approvedLeft.length} approved claim${approvedLeft.length === 1 ? '' : 's'} not on any run yet`, numbers: rupees(approvedLeft.reduce((t, c) => t + Math.round((c.amount ?? 0) * 100), 0)), fix: 'Recalculate the run to include them' });
    if (settings.tds?.enabled) {
      const cfg = await tdsConfigsFor(fyOfPeriod(period));
      if (!cfg.size) blockers.push({ what: `Income tax is on, but no tax rates are set up for FY ${fyOfPeriod(period)}, so no TDS was worked out`, fix: 'Add the year\'s rates under Statutory Components › Income Tax' });
      for (const c of cfg.values()) if (c.status !== 'confirmed') flags.push({ what: `The ${c.regime} regime rates for FY ${c.fy} are still marked "to confirm"` });
    }
    const typedTax = slips.filter((s) => taxSource(s) === 'typed by HR');
    if (typedTax.length) info.push(`Income tax typed by HR (engine not used) for: ${typedTax.map((s) => s.employeeName).join(', ')}.`);
    const typedLop = slips.filter((s) => s.inputs?.lopEnteredByHr);
    if (typedLop.length) info.push(`Loss of pay typed by HR (attendance not used) for: ${typedLop.map((s) => `${s.employeeName} (${s.inputs.lopDays} days)`).join(', ')}.`);

    // Each person against last month and their own history.
    const liveRuns = new Set([...best.values()].map((r) => r._id.toHexString()));
    const history = await payslips().find({ org: ctx.org, userId: { $in: [...onRun] }, period: { $lt: period } }, { projection: { userId: 1, runId: 1, 'inputs.lopDays': 1, reimbursementsPaise: 1, reimbursementLines: 1 } }).toArray();
    const usual = new Map<string, { lop: number[]; claims: number[] }>();
    for (const h of history) {
      if (!liveRuns.has(h.runId)) continue;
      const u = usual.get(h.userId) ?? { lop: [], claims: [] };
      u.lop.push(h.inputs?.lopDays ?? 0);
      u.claims.push((h.reimbursementsPaise ?? 0) - (h.reimbursementLines ?? []).reduce((t, l) => t + l.amountPaise, 0));
      usual.set(h.userId, u);
    }
    for (const s of slips) {
      const who = { userId: s.userId, name: s.employeeName };
      const L = slipLines(s);
      const b = prevBy.get(s.userId);
      const u = people.get(s.userId);
      const joined = u?.joiningDate ? new Date(u.joiningDate).toISOString().slice(0, 10) : undefined;
      const ended = u?.endDate ? new Date(u.endDate).toISOString().slice(0, 10) : undefined;
      const lop = s.inputs?.lopDays ?? 0;
      if (b) {
        const Lb = slipLines(b);
        const change = pct(L.netPayablePaise - Lb.netPayablePaise, Lb.netPayablePaise);
        if (Math.abs(change) > 15) flags.push({ person: who, what: `Net pay ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% on last month`, numbers: `${rupees(Lb.netPayablePaise)} → ${rupees(L.netPayablePaise)}; loss of pay ${b.inputs?.lopDays ?? 0} → ${lop} days; monthly CTC ${rupees(b.monthlyCtcPaise)} → ${rupees(s.monthlyCtcPaise)}${Object.keys(s.inputs?.componentAmounts ?? {}).length ? `; one-time amounts ${Object.entries(s.inputs.componentAmounts!).map(([c, v]) => `${c} ${rupees(v)}`).join(', ')}` : ''}` });
        const sameSalary = s.monthlyCtcPaise === b.monthlyCtcPaise && lop === (b.inputs?.lopDays ?? 0) && L.grossPaise === Lb.grossPaise;
        if (sameSalary && L.incomeTaxPaise !== Lb.incomeTaxPaise) flags.push({ person: who, what: 'Income tax changed with no change in salary', numbers: `${rupees(Lb.incomeTaxPaise)} → ${rupees(L.incomeTaxPaise)} (this month ${taxSource(s)}, last month ${taxSource(b)})` });
      } else if (prevPeriod && (!joined || joined.slice(0, 7) < period)) {
        flags.push({ person: who, what: `New on the run (not on ${monthLabel(prevPeriod)}'s), though they joined ${joined ?? 'before this month'}` });
      }
      const hist = usual.get(s.userId);
      if (hist?.lop.length && lop >= 2 && lop > avg(hist.lop) + 2) flags.push({ person: who, what: 'Loss of pay far above their usual', numbers: `${lop} days this month; usual ${Math.round(avg(hist.lop) * 10) / 10} a month over ${hist.lop.length} earlier month${hist.lop.length === 1 ? '' : 's'}${s.inputs?.lopEnteredByHr ? ' (typed by HR)' : ' (from attendance)'}` });
      else if (!hist?.lop.length && lop >= 5) flags.push({ person: who, what: 'High loss of pay on their first run', numbers: `${lop} of ${days} days unpaid${s.inputs?.lopEnteredByHr ? ' (typed by HR)' : ' (from attendance)'}` });
      if (joined && joined.slice(0, 7) === period && joined > `${period}-01`) {
        const before = Number(joined.slice(8, 10)) - 1;
        if (lop < before) flags.push({ person: who, what: `Joined on ${joined} but paid for more days than since joining`, numbers: `${s.inputs?.payableDays} paid days; ${before} day${before === 1 ? '' : 's'} before joining; loss of pay ${lop}` });
        else info.push(`${s.employeeName} joined on ${joined}: paid ${s.inputs?.payableDays} of ${days} days.`);
      }
      const leaving = gone(u?.lifecycleStatus) || (ended !== undefined && ended <= monthEnd);
      if (leaving && (s.inputs?.payableDays ?? 0) >= days) flags.push({ person: who, what: `Leaving${ended ? ` on ${ended}` : ''} but paid a full month`, numbers: `${s.inputs?.payableDays} of ${days} days paid` });
      const claims = L.reimbursements.find((l) => l.code === '__claims')?.paise ?? 0;
      const usualClaims = hist ? avg(hist.claims) : 0;
      if (claims > Math.max(2 * usualClaims, 5_000_00)) flags.push({ person: who, what: 'Expense claims larger than usual', numbers: `${rupees(claims)} this month (${s.inputs?.reimbursementClaimIds?.length ?? 0} claims); usual ${rupees(usualClaims)} a month` });
    }
    for (const b of prevSlips) {
      if (onRun.has(b.userId)) continue;
      const u = people.get(b.userId);
      if (gone(u?.lifecycleStatus)) info.push(`${b.employeeName} (${u!.lifecycleStatus}) was on ${monthLabel(prevPeriod!)}'s run and is not on this one.`);
      else flags.push({ person: { userId: b.userId, name: b.employeeName }, what: `On ${monthLabel(prevPeriod!)}'s run but not on this one, and still active`, numbers: `Was paid ${rupees(b.netPayablePaise)}` });
    }

    const t = open.totals;
    const prevRun = prevPeriod ? best.get(prevPeriod)! : undefined;
    const net = (x: typeof t) => x.netPaise + x.reimbursementsPaise;
    return {
      data: {
        currentRun: { period, month: monthLabel(period), status: STATUS_LABEL[open.status] ?? open.status, people: open.employeeCount, gross: rupees(t.grossPaise), deductions: rupees(t.employeeDeductionsPaise), netPay: rupees(net(t)), reimbursements: rupees(t.reimbursementsPaise), lastCalculated: open.updatedAt.toISOString().slice(0, 10) },
        comparedWith: prevRun ? { month: monthLabel(prevRun.period), status: STATUS_LABEL[prevRun.status], people: prevSlips.length, netPay: rupees(net(prevRun.totals)), netPayChange: delta(net(t) - net(prevRun.totals)) } : null,
        ready: blockers.length ? 'Blocked' : flags.length ? 'No blockers; check the flags, then submit' : 'No blockers or flags',
        blockers, flags, info,
        note: 'Flags are things to look at, not errors: a run can be submitted with them. Submitting happens on Payroll Runs, not here.',
      },
      links: [{ label: 'Open payroll runs', view: 'payruns' }, { label: 'Open People › Tasks', view: 'peopletasks' }],
    };
  },
});
