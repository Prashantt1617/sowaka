// Payroll › Reports — what the finished runs add up to, as Zoho's payroll
// reports lay it out: Payroll Summary, Salary Register (one month), Payroll
// Liability Summary, Professional Tax (month and year) and each run's payment
// list. Every report can include draft runs to preview a month, and exports
// to Excel.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { Card, EmptyRow, ListPending } from '../ui';
import type { LoadState } from '../ui';
import {
  getLiabilitySummary, getRunPaymentDetails, getPayrollSummary, getPtAnnual, getPtSummary, getSalaryRegister, listRuns,
  type LiabilityReport, type PaymentDetailsReport, type PayrollRunDTO, type PayrollSummaryReport, type PtAnnualReport, type PtSummaryReport, type SalaryRegisterReport,
} from '../../services/payroll';

export type ReportKey = 'summary' | 'register' | 'liability' | 'pt' | 'ptannual' | 'payments';
const GROUPS: { title: string; items: { key: ReportKey; label: string; hint: string }[] }[] = [
  { title: 'Payroll overview', items: [
    { key: 'summary', label: 'Payroll Summary', hint: 'Every component paid over a period, and net pay' },
    { key: 'register', label: 'Salary Register – Monthly', hint: 'One row per person for a month, every column' },
    { key: 'liability', label: 'Payroll Liability Summary', hint: 'What is owed to EPFO, ESIC, the tax department and states' },
  ] },
  { title: 'Statutory', items: [
    { key: 'pt', label: 'Professional Tax Summary', hint: 'PT per person for a month' },
    { key: 'ptannual', label: 'PT Annual Return Statement', hint: 'PT per month for a financial year' },
  ] },
  { title: 'Payments', items: [
    { key: 'payments', label: 'Employee Payment Details', hint: 'Who is paid how much, and how, for a run' },
  ] },
];
/** Where the dashboard's "View details" lands. */
export const OPEN_REPORT_KEY = 'sowaka.payrollReports.open';

const STATUS: Record<string, string> = { draft: 'Draft', pending_approval: 'Awaiting approval', approved: 'Approved', paid: 'Paid' };
const money = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const rupees = (paise: number) => Math.round(paise) / 100;
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const thisMonth = () => new Date().toISOString().slice(0, 7);
const fyOf = (p: string) => { const [y, m] = p.split('-').map(Number); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };
const fyStart = (fy: string) => `${fy.slice(0, 4)}-04`;
const prevMonth = (p: string) => { const [y, m] = p.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };

async function exportXlsx(filename: string, title: string[], header: string[], rows: (string | number)[][], footer?: (string | number)[]) {
  // The spreadsheet library is large; it is fetched the first time someone exports.
  const XLSX = await import('xlsx');
  const aoa: (string | number)[][] = [...title.map((t) => [t]), [], header, ...rows, ...(footer ? [footer] : [])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map((h) => ({ wch: Math.max(12, Math.min(32, h.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, filename.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function PayrollReports() {
  const { flash } = useStore();
  const [active, setActive] = useState<ReportKey>(() => {
    try { const k = localStorage.getItem(OPEN_REPORT_KEY) as ReportKey | null; if (k) { localStorage.removeItem(OPEN_REPORT_KEY); return k; } } catch { /* storage blocked */ }
    return 'summary';
  });
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [period, setPeriod] = useState(prevMonth(thisMonth()));
  const [from, setFrom] = useState(fyStart(fyOf(thisMonth())));
  const [to, setTo] = useState(thisMonth());
  const [fy, setFy] = useState(fyOf(thisMonth()));
  const [runs, setRuns] = useState<PayrollRunDTO[]>([]);
  const [runId, setRunId] = useState('');
  // Paired with the report it belongs to: switching reports never draws one report with another's data.
  const [loaded, setLoaded] = useState<{ kind: ReportKey; data: unknown } | null>(null);
  const data = loaded?.kind === active ? loaded.data : null;
  const [loading, setLoading] = useState(true);
  // A failed report says so, with Retry, rather than "Nothing to show".
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Payment details needs the run list first: until then it is loading, not "No payroll runs yet".
  const [runsState, setRunsState] = useState<LoadState>('loading');

  useEffect(() => {
    setRunsState('loading');
    void listRuns()
      .then((rs) => { setRuns(rs); setRunsState('ready'); if (!runId && rs[0]) setRunId(rs[0].id); })
      .catch(() => { setRuns([]); setRunsState('error'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    if (active === 'payments' && runsState !== 'ready') return;
    let live = true;
    setLoading(true);
    setFailed(false);
    setLoaded(null);
    const load = (): Promise<unknown> => {
      switch (active) {
        case 'summary': return getPayrollSummary(from, to, includeDrafts);
        case 'register': return getSalaryRegister(period, includeDrafts);
        case 'liability': return getLiabilitySummary(from, to, includeDrafts);
        case 'pt': return getPtSummary(period, includeDrafts);
        case 'ptannual': return getPtAnnual(fy, includeDrafts);
        case 'payments': return runId ? getRunPaymentDetails(runId) : Promise.resolve(null);
      }
    };
    void load()
      .then((d) => { if (live) setLoaded({ kind: active, data: d }); })
      .catch((e) => { if (live) { setFailed(true); flash(e instanceof ApiError ? e.message : 'Could not load the report', 'error'); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, includeDrafts, period, from, to, fy, runId, attempt, runsState]);
  const reportState: LoadState = active === 'payments' && runsState !== 'ready' ? runsState
    : failed ? 'error' : loading || loaded?.kind !== active ? 'loading' : 'ready';

  const meta = GROUPS.flatMap((g) => g.items).find((i) => i.key === active)!;
  const fyOptions = useMemo(() => { const now = fyOf(thisMonth()); const s = Number(now.slice(0, 4)); return [now, `${s - 1}-${String(s % 100).padStart(2, '0')}`]; }, []);

  const filters: ReactNode = (() => {
    if (active === 'summary' || active === 'liability') return (
      <><label style={filterLabel}>From <input type="month" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} style={inputS} /></label>
        <label style={filterLabel}>To <input type="month" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} style={inputS} /></label></>
    );
    if (active === 'register' || active === 'pt') return <label style={filterLabel}>Month <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} style={inputS} /></label>;
    if (active === 'ptannual') return <label style={filterLabel}>Financial year <select value={fy} onChange={(e) => setFy(e.target.value)} style={inputS}>{fyOptions.map((f) => <option key={f} value={f}>FY {f}</option>)}</select></label>;
    return <label style={filterLabel}>Run <select value={runId} onChange={(e) => setRunId(e.target.value)} style={inputS}>{runs.map((r) => <option key={r.id} value={r.id}>{monthLabel(r.period)} · {STATUS[r.status] ?? r.status}</option>)}</select></label>;
  })();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
      <Card style={{ padding: '10px 0' }}>
        {GROUPS.map((g) => (
          <div key={g.title} style={{ padding: '6px 0' }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-4)', padding: '6px 18px' }}>{g.title}</div>
            {g.items.map((i) => (
              <button key={i.key} onClick={() => setActive(i.key)} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: active === i.key ? 'var(--accent-soft)' : 'none', color: active === i.key ? 'var(--accent-ink)' : 'var(--ink)', fontWeight: active === i.key ? 500 : 400, fontSize: 13.5, padding: '9px 18px', cursor: 'pointer', fontFamily: 'inherit' }}>{i.label}</button>
            ))}
          </div>
        ))}
      </Card>
      <div style={{ minWidth: 0 }}>
        <Card style={{ padding: '16px 20px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 16.5, fontWeight: 600 }}>{meta.label}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>{meta.hint}</div>
            </div>
            {filters}
            {active !== 'payments' && (
              <label style={{ ...filterLabel, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} /> Include draft runs
              </label>
            )}
            <button disabled={!data || loading} onClick={() => void exportReport(active, data)} style={exportBtn}>Export (Excel)</button>
          </div>
        </Card>
        <Card>
          {reportState !== 'ready' ? <ListPending state={reportState} errorText="The report could not be loaded." onRetry={() => setAttempt((n) => n + 1)} rows={6} cols={5} avatar={false} rowHeight={46} /> : !data ? <EmptyRow text={active === 'payments' ? 'No payroll runs yet.' : 'Nothing to show.'} /> : <ReportBody kind={active} data={data} />}
        </Card>
      </div>
    </div>
  );
}

function RunsNote({ runs }: { runs: { period: string; status: string }[] }) {
  if (runs.length === 0) return <div style={note}>No finished runs in this period. Tick “Include draft runs” to preview one.</div>;
  return <div style={note}>From {runs.map((r) => `${monthLabel(r.period)} (${STATUS[r.status] ?? r.status})`).join(', ')}.</div>;
}

function ReportBody({ kind, data }: { kind: ReportKey; data: unknown }) {
  if (kind === 'summary') {
    const d = data as PayrollSummaryReport;
    return (
      <div>
        <RunsNote runs={d.runs} />
        <table style={table}>
          <thead><tr><th style={th}>Pay components</th><th style={{ ...th, textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {d.sections.filter((s) => s.rows.length).map((s) => (
              <SectionRows key={s.title} title={s.title} rows={s.rows} totalLabel={s.totalLabel} totalPaise={s.totalPaise} />
            ))}
            <tr><td style={{ ...td, ...grand }}>Net Pay</td><td style={{ ...num, ...grand }}>{money(d.netPayPaise)}</td></tr>
            <tr><td style={{ ...td, color: 'var(--ink-3)' }}>Cost to company (gross + reimbursements + employer contributions)</td><td style={{ ...num, color: 'var(--ink-3)' }}>{money(d.costToCompanyPaise)}</td></tr>
          </tbody>
        </table>
        {d.balancesPaise !== 0 && <div style={{ ...note, color: 'var(--bad)' }}>Gross + reimbursements − deductions differs from net pay by {money(d.balancesPaise)}: a payslip does not add up.</div>}
      </div>
    );
  }
  if (kind === 'register') {
    const d = data as SalaryRegisterReport;
    if (!d.rows.length) return <EmptyRow text={`No run for ${monthLabel(d.period)}${d.run ? '' : ' (tick “Include draft runs” to see a draft)'}.`} />;
    const c = d.columns;
    const tot = (f: (r: SalaryRegisterReport['rows'][number]) => number) => d.rows.reduce((t, r) => t + f(r), 0);
    return (
      <div style={{ overflowX: 'auto' }}>
        <div style={note}>{monthLabel(d.period)} · {STATUS[d.run?.status ?? ''] ?? ''} · {d.rows.length} people</div>
        <table style={{ ...table, minWidth: 1100 }}>
          <thead><tr>
            <th style={th}>Employee</th>
            {c.earnings.map((x) => <th key={x.code} style={{ ...th, textAlign: 'right' }}>{x.name}</th>)}
            <th style={{ ...th, textAlign: 'right' }}>Gross Pay</th>
            {c.deductions.map((x) => <th key={x.key} style={{ ...th, textAlign: 'right' }}>{x.name}</th>)}
            <th style={{ ...th, textAlign: 'right' }}>Income Tax</th>
            <th style={{ ...th, textAlign: 'right' }}>Reimbursements</th>
            <th style={{ ...th, textAlign: 'right' }}>Net Pay</th>
          </tr></thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.employeeId + r.name}>
                <td style={td}><strong>{r.employeeId}</strong> {r.name}</td>
                {c.earnings.map((x) => <td key={x.code} style={num}>{money(r.earnings[x.code] ?? 0)}</td>)}
                <td style={{ ...num, fontWeight: 500 }}>{money(r.grossPaise)}</td>
                {c.deductions.map((x) => <td key={x.key} style={num}>{money(r.deductions[x.key] ?? 0)}</td>)}
                <td style={num}>{money(r.incomeTaxPaise)}</td>
                <td style={num}>{money(r.reimbursementsPaise)}</td>
                <td style={{ ...num, fontWeight: 500 }}>{money(r.netPayPaise)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, ...grand }}>Total</td>
              {c.earnings.map((x) => <td key={x.code} style={{ ...num, ...grand }}>{money(tot((r) => r.earnings[x.code] ?? 0))}</td>)}
              <td style={{ ...num, ...grand }}>{money(tot((r) => r.grossPaise))}</td>
              {c.deductions.map((x) => <td key={x.key} style={{ ...num, ...grand }}>{money(tot((r) => r.deductions[x.key] ?? 0))}</td>)}
              <td style={{ ...num, ...grand }}>{money(tot((r) => r.incomeTaxPaise))}</td>
              <td style={{ ...num, ...grand }}>{money(tot((r) => r.reimbursementsPaise))}</td>
              <td style={{ ...num, ...grand }}>{money(tot((r) => r.netPayPaise))}</td>
            </tr>
          </tbody>
        </table>
        <div style={note}>The Excel export has every column: bank, days, the income tax split (tax, surcharge, cess), employer contributions.</div>
      </div>
    );
  }
  if (kind === 'liability') {
    const d = data as LiabilityReport;
    return (
      <div>
        <RunsNote runs={d.runs} />
        <table style={table}>
          <thead><tr><th style={th}>Liability</th><th style={{ ...th, textAlign: 'right' }}>Employee contribution</th><th style={{ ...th, textAlign: 'right' }}>Employer contribution</th><th style={{ ...th, textAlign: 'right' }}>Total</th></tr></thead>
          <tbody>
            {d.rows.map((r) => <tr key={r.key}><td style={td}>{r.name}</td><td style={num}>{money(r.employeePaise)}</td><td style={num}>{money(r.employerPaise)}</td><td style={{ ...num, fontWeight: 500 }}>{money(r.totalPaise)}</td></tr>)}
            <tr><td style={{ ...td, ...grand }}>Total</td><td style={{ ...num, ...grand }}>{money(d.rows.reduce((t, r) => t + r.employeePaise, 0))}</td><td style={{ ...num, ...grand }}>{money(d.rows.reduce((t, r) => t + r.employerPaise, 0))}</td><td style={{ ...num, ...grand }}>{money(d.totalPaise)}</td></tr>
          </tbody>
        </table>
      </div>
    );
  }
  if (kind === 'pt') {
    const d = data as PtSummaryReport;
    if (!d.rows.length) return <EmptyRow text={`No PT deducted in ${monthLabel(d.period)}.`} />;
    return (
      <table style={table}>
        <thead><tr><th style={th}>Employee number</th><th style={th}>Employee name</th><th style={th}>Work location</th><th style={th}>Status</th><th style={th}>Type</th><th style={{ ...th, textAlign: 'right' }}>PT amount</th></tr></thead>
        <tbody>
          {d.rows.map((r) => <tr key={r.employeeId + r.name}><td style={td}>{r.employeeId}</td><td style={td}>{r.name}</td><td style={td}>{r.workLocation}</td><td style={td}>{r.status}</td><td style={td}>{r.employeeType.replace('_', '-')}</td><td style={num}>{money(r.ptPaise)}</td></tr>)}
          <tr><td style={{ ...td, ...grand }} colSpan={5}>Total</td><td style={{ ...num, ...grand }}>{money(d.totalPaise)}</td></tr>
        </tbody>
      </table>
    );
  }
  if (kind === 'ptannual') {
    const d = data as PtAnnualReport;
    if (!d.rows.length) return <EmptyRow text={`No PT deductions in FY ${d.fy}.`} />;
    return (
      <table style={table}>
        <thead><tr><th style={th}>Period end</th><th style={th}>Run</th><th style={{ ...th, textAlign: 'right' }}>No. of employees</th><th style={{ ...th, textAlign: 'right' }}>PT amount</th></tr></thead>
        <tbody>
          {d.rows.map((r) => <tr key={r.period}><td style={td}>{r.periodEnd.split('-').reverse().join('/')}</td><td style={td}>{STATUS[r.status] ?? r.status}</td><td style={num}>{r.employees}</td><td style={num}>{money(r.ptPaise)}</td></tr>)}
          <tr><td style={{ ...td, ...grand }} colSpan={3}>Total</td><td style={{ ...num, ...grand }}>{money(d.totalPaise)}</td></tr>
        </tbody>
      </table>
    );
  }
  const d = data as PaymentDetailsReport;
  return (
    <table style={table}>
      <thead><tr><th style={th}>Employee no</th><th style={th}>Employee name</th><th style={th}>Payment mode</th><th style={th}>Bank</th><th style={th}>Account number</th><th style={th}>IFSC</th><th style={{ ...th, textAlign: 'right' }}>Net pay</th></tr></thead>
      <tbody>
        {d.rows.map((r) => <tr key={r.employeeId + r.name}><td style={td}>{r.employeeId}</td><td style={td}>{r.name}</td><td style={{ ...td, color: r.paymentMode === 'Not set' ? 'var(--bad)' : undefined }}>{r.paymentMode}</td><td style={td}>{r.bankName}</td><td style={td}>{r.accountNumber}</td><td style={td}>{r.ifsc}</td><td style={num}>{money(r.netPayPaise)}</td></tr>)}
        <tr><td style={{ ...td, ...grand }} colSpan={6}>Total</td><td style={{ ...num, ...grand }}>{money(d.rows.reduce((t, r) => t + r.netPayPaise, 0))}</td></tr>
      </tbody>
    </table>
  );
}

function SectionRows({ title, rows, totalLabel, totalPaise }: { title: string; rows: { name: string; paise: number }[]; totalLabel: string; totalPaise: number }) {
  return (
    <>
      <tr><td style={{ ...td, fontWeight: 600, background: 'var(--surface-2)' }} colSpan={2}>{title}</td></tr>
      {rows.map((r) => <tr key={r.name}><td style={{ ...td, paddingLeft: 34 }}>{r.name}</td><td style={num}>{money(r.paise)}</td></tr>)}
      <tr><td style={{ ...td, fontWeight: 500, textAlign: 'right' }}>{totalLabel}</td><td style={{ ...num, fontWeight: 500 }}>{money(totalPaise)}</td></tr>
    </>
  );
}

export function exportReport(kind: ReportKey, data: unknown): Promise<void> {
  if (kind === 'summary') {
    const d = data as PayrollSummaryReport;
    const rows: (string | number)[][] = [];
    for (const s of d.sections.filter((x) => x.rows.length)) {
      rows.push([s.title, '', '']);
      s.rows.forEach((r) => rows.push([r.name, '', rupees(r.paise)]));
      rows.push(['', s.totalLabel, rupees(s.totalPaise)]);
    }
    rows.push(['', 'Net Pay', rupees(d.netPayPaise)]);
    return exportXlsx('Payroll Summary', ['Payroll Summary', `From ${d.from} to ${d.to}`], ['Pay Components', '', 'Amount'], rows);
  } else if (kind === 'register') {
    const d = data as SalaryRegisterReport;
    const c = d.columns;
    const header = ['Employee Number', 'Employee Name', 'Department', 'Designation', 'Work Location', 'Date of Joining', 'Payment Mode', 'Bank Name', 'Account Number', 'IFSC', 'CTC (per annum)', 'Base Days', 'Loss Of Pay', 'Paid Days',
      ...c.earnings.map((x) => x.name), 'Gross Pay', ...c.reimbursements.map((x) => x.name), 'Total Reimbursements',
      ...c.deductions.map((x) => x.name), 'Tax on Income', 'Surcharge', 'Cess', 'Total Income Tax', 'Total Deductions',
      ...c.employer.map((x) => `${x.name} (Employer)`), 'Total Employer Contributions', 'Net Pay'];
    const rows = d.rows.map((r) => [r.employeeId, r.name, r.department, r.designation, r.workLocation, r.joiningDate, r.paymentMode, r.bankName, r.accountNumber, r.ifsc, rupees(r.annualCtcPaise), r.baseDays, r.lopDays, r.paidDays,
      ...c.earnings.map((x) => rupees(r.earnings[x.code] ?? 0)), rupees(r.grossPaise), ...c.reimbursements.map((x) => rupees(r.reimbursements[x.code] ?? 0)), rupees(r.reimbursementsPaise),
      ...c.deductions.map((x) => rupees(r.deductions[x.key] ?? 0)), rupees(r.taxOnIncomePaise), rupees(r.surchargePaise), rupees(r.cessPaise), rupees(r.incomeTaxPaise), rupees(r.totalDeductionsPaise),
      ...c.employer.map((x) => rupees(r.employer[x.key] ?? 0)), rupees(r.employerTotalPaise), rupees(r.netPayPaise)]);
    return exportXlsx(`Salary Register - ${d.period}`, ['Salary Register - Monthly', monthLabel(d.period)], header, rows);
  } else if (kind === 'liability') {
    const d = data as LiabilityReport;
    return exportXlsx('Payroll Liability Summary', ['Payroll Liability Summary', `From ${d.from} to ${d.to}`], ['Liability Name', 'Employee Contribution', 'Employer Contribution', 'Total Contribution'],
      d.rows.map((r) => [r.name, rupees(r.employeePaise), rupees(r.employerPaise), rupees(r.totalPaise)]));
  } else if (kind === 'pt') {
    const d = data as PtSummaryReport;
    return exportXlsx(`Professional Tax Summary - ${d.period}`, ['Professional Tax Summary', monthLabel(d.period)], ['Employee Number', 'Employee Name', 'Work Location', 'Employee Status', 'Employee Type', 'PT Amount'],
      d.rows.map((r) => [r.employeeId, r.name, r.workLocation, r.status, r.employeeType, rupees(r.ptPaise)]));
  } else if (kind === 'ptannual') {
    const d = data as PtAnnualReport;
    return exportXlsx(`PT Annual Return ${d.fy}`, ['PT Annual Return Statement', `FY ${d.fy}`], ['Period End', 'No. of Employees', 'PT Amount'], d.rows.map((r) => [r.periodEnd, r.employees, rupees(r.ptPaise)]));
  } else {
    const d = data as PaymentDetailsReport;
    return exportXlsx(`Payrun_Employee_Payment_Details ${d.period}`, ['Employee Payment Details', monthLabel(d.period)], ['Employee No', 'Employee Name', 'Payment Mode', 'Bank Name', 'Account Number', 'IFSC', 'Net Pay'],
      d.rows.map((r) => [r.employeeId, r.name, r.paymentMode, r.bankName, r.accountNumber, r.ifsc, rupees(r.netPayPaise)]));
  }
}

const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: CSSProperties = { textAlign: 'left', fontSize: 12, textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontWeight: 400, padding: '11px 16px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '9px 16px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle' };
const num: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const grand: CSSProperties = { fontWeight: 600, borderTop: '2px solid var(--line)', background: 'var(--surface-2)' };
const note: CSSProperties = { padding: '10px 16px', fontSize: 12.5, color: 'var(--ink-3)' };
const filterLabel: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-3)', fontWeight: 400 };
const inputS: CSSProperties = { padding: '7px 10px', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' };
const exportBtn: CSSProperties = { background: 'var(--accent-grad)', color: 'var(--on-accent)', border: 'none', padding: '9px 14px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' };
