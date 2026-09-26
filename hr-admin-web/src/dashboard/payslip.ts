// A payslip as a self-contained HTML document: the same markup previews in
// the dashboard and prints (or saves as PDF) from the browser.
//
// Earnings are shown at the full monthly rate and loss of pay is a deduction
// line, so what the attendance rules cost is on the slip rather than folded
// silently into a smaller earned figure.
import { inr, type PayslipDTO } from '../services/payroll';

const esc = (value: string) => value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch));

const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const dateLabel = (iso?: string) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

const lastDayOf = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
}
function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}
/** Indian grouping: crores, lakhs, thousands. */
export function rupeesInWords(paise: number): string {
  let n = Math.round(paise / 100);
  if (n === 0) return 'Indian Rupees Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000); n %= 10_000_000;
  const lakh = Math.floor(n / 100_000); n %= 100_000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return `Indian Rupees ${parts.join(' ')} Only`;
}

export function payslipHtml(slip: PayslipDTO, company: { name: string; address: string }): string {
  const fullEarnings = slip.earnings.reduce((t, e) => t + e.fullPaise, 0);
  const paidEarnings = slip.earnings.reduce((t, e) => t + e.paidPaise, 0);
  const lopPaise = fullEarnings - paidEarnings;
  const lines = slip.inputs.attendanceDeductions ?? [];
  const lopDetail = lines.filter((l) => l.days > 0).map((l) => `${l.label} ${l.count} → ${l.days}d`).join(' · ');
  const deductions: { name: string; sub?: string; paise: number }[] = [];
  const covered = slip.inputs.paidLeaveDaysApplied ?? 0;
  if (slip.inputs.lopDays > 0) {
    const sub = [lopDetail, covered > 0 ? `${covered} day${covered === 1 ? '' : 's'} covered by paid leave` : ''].filter(Boolean).join(' · ');
    deductions.push({ name: `Loss of pay · ${slip.inputs.lopDays} day${slip.inputs.lopDays === 1 ? '' : 's'}`, sub: sub || undefined, paise: lopPaise });
  }
  for (const d of slip.deductions) deductions.push({ name: d.name, paise: d.amountPaise });
  const totalDeductions = deductions.reduce((t, d) => t + d.paise, 0);
  const grossFull = fullEarnings + slip.inputs.overtimePaise;
  const net = slip.netPayablePaise;

  const earningRows = slip.earnings.map((e) => `
    <tr><td><div class="n">${esc(e.name)}</div>${e.fullPaise !== e.paidPaise ? `<div class="s">Monthly rate: ${inr(e.fullPaise)}</div>` : ''}</td><td class="r">${inr(e.fullPaise)}</td></tr>`).join('');
  const otRow = slip.inputs.overtimePaise > 0 ? `<tr><td><div class="n">Overtime</div></td><td class="r">${inr(slip.inputs.overtimePaise)}</td></tr>` : '';
  const deductionRows = deductions.length === 0
    ? '<tr><td><div class="n">No deductions</div></td><td class="r">—</td></tr>'
    : deductions.map((d) => `<tr><td><div class="n">${esc(d.name)}</div>${d.sub ? `<div class="s">${esc(d.sub)}</div>` : ''}</td><td class="r">${inr(d.paise)}</td></tr>`).join('');
  const reimb = slip.reimbursementsPaise > 0 ? `<tr><td><div class="n">Reimbursements</div></td><td class="r">${inr(slip.reimbursementsPaise)}</td></tr>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip · ${esc(slip.employeeName)} · ${esc(monthLabel(slip.period))}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #222; background: #fff; }
  .slip { max-width: 880px; margin: 0 auto; border: 1px solid #E5E7EB; border-radius: 14px; padding: 36px 40px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 22px; border-bottom: 1px solid #E5E7EB; }
  .co { font-size: 26px; font-weight: 600; }
  .addr { color: #6B7280; margin-top: 4px; font-size: 15px; }
  .for { text-align: right; color: #6B7280; font-size: 15px; }
  .for b { display: block; color: #222; font-size: 22px; font-weight: 500; margin-top: 4px; }
  .summary { display: grid; grid-template-columns: 1fr 380px; gap: 32px; padding: 26px 0; }
  .label { font-size: 12px; letter-spacing: .08em; color: #6B7280; text-transform: uppercase; margin-bottom: 10px; }
  .kv { display: flex; justify-content: space-between; padding: 7px 0; font-size: 15px; }
  .kv span:first-child { color: #6B7280; }
  .net { border: 1px solid #D1FAE5; border-radius: 12px; overflow: hidden; }
  .net .top { background: #ECFDF5; padding: 22px 24px; }
  .net .amt { font-size: 32px; font-weight: 600; }
  .net .cap { color: #047857; margin-top: 4px; font-size: 15px; }
  .net .days { padding: 12px 24px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; padding-top: 18px; border-top: 1px dashed #E5E7EB; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 12px; letter-spacing: .08em; color: #6B7280; text-transform: uppercase; font-weight: 500; padding: 8px 0 10px; border-bottom: 1px dashed #E5E7EB; }
  td { padding: 12px 0; vertical-align: top; font-size: 15px; }
  td.r, th.r { text-align: right; white-space: nowrap; }
  .n { font-weight: 500; } .s { color: #6B7280; font-size: 13px; margin-top: 2px; }
  .tot { background: #F5F5F7; font-weight: 500; } .tot td { padding: 12px 14px; }
  .payable { margin-top: 24px; background: #ECFDF5; border: 1px solid #D1FAE5; border-radius: 12px; padding: 20px 26px; display: flex; justify-content: space-between; align-items: center; }
  .payable .t { font-size: 17px; font-weight: 500; } .payable .sub { color: #6B7280; font-size: 14px; margin-top: 4px; } .payable .amt { font-size: 28px; font-weight: 600; }
  .words { text-align: right; color: #6B7280; margin-top: 18px; font-size: 14px; } .words b { color: #222; font-weight: 500; }
  .foot { text-align: center; color: #9CA3AF; font-size: 13px; margin-top: 26px; padding-top: 18px; border-top: 1px solid #E5E7EB; }
  @media print { body { padding: 0; } .slip { border: none; border-radius: 0; padding: 24px; } @page { margin: 12mm; } }
</style></head><body><div class="slip">
  <div class="head">
    <div><div class="co">${esc(company.name)}</div>${company.address ? `<div class="addr">${esc(company.address)}</div>` : ''}</div>
    <div class="for">Payslip for the month<b>${esc(monthLabel(slip.period))}</b></div>
  </div>
  <div class="summary">
    <div>
      <div class="label">Employee summary</div>
      <div class="kv"><span>Employee name</span><span>${esc(slip.employeeName)}</span></div>
      <div class="kv"><span>Employee ID</span><span>${esc(slip.employeeId ?? '—')}</span></div>
      <div class="kv"><span>Designation</span><span>${esc(slip.designation ?? '—')}</span></div>
      ${slip.department ? `<div class="kv"><span>Department</span><span>${esc(slip.department)}</span></div>` : ''}
      <div class="kv"><span>Date of joining</span><span>${esc(dateLabel(slip.joiningDate))}</span></div>
      <div class="kv"><span>Pay date</span><span>${esc(dateLabel(lastDayOf(slip.period)))}</span></div>
    </div>
    <div class="net">
      <div class="top"><div class="amt">${inr(net)}</div><div class="cap">Total net pay</div></div>
      <div class="days">
        <div class="kv"><span>Paid days</span><span>${slip.inputs.payableDays}</span></div>
        <div class="kv"><span>Loss of pay days</span><span>${slip.inputs.lopDays}</span></div>
        ${covered > 0 ? `<div class="kv"><span>Covered by paid leave</span><span>${covered}</span></div>` : ''}
      </div>
    </div>
  </div>
  <div class="cols">
    <table><thead><tr><th>Earnings</th><th class="r">Amount</th></tr></thead><tbody>${earningRows}${otRow}${reimb}
      <tr class="tot"><td>Gross earnings</td><td class="r">${inr(grossFull + slip.reimbursementsPaise)}</td></tr></tbody></table>
    <table><thead><tr><th>Deductions</th><th class="r">Amount</th></tr></thead><tbody>${deductionRows}
      <tr class="tot"><td>Total deductions</td><td class="r">${inr(totalDeductions)}</td></tr></tbody></table>
  </div>
  <div class="payable"><div><div class="t">Total net payable</div><div class="sub">Gross ${inr(grossFull + slip.reimbursementsPaise)} − deductions ${inr(totalDeductions)}</div></div><div class="amt">${inr(net)}</div></div>
  <div class="words">Amount in words: <b>${esc(rupeesInWords(net))}</b></div>
  <div class="foot">This is a system generated document and does not require a signature.</div>
</div></body></html>`;
}

/** Opens the slip in a new tab ready to print or save as PDF. */
export function printPayslip(slip: PayslipDTO, company: { name: string; address: string }): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.open();
  win.document.write(payslipHtml(slip, company));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}
