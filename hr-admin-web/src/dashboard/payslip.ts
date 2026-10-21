// A payslip as a self-contained HTML document: the same markup previews in
// the dashboard and prints (or saves as PDF) from the browser.
//
// Earnings are shown at the full monthly rate and loss of pay is a deduction
// line, so what the attendance rules cost is on the slip rather than folded
// silently into a smaller earned figure.
import { type PayslipDTO } from '../services/payroll';
import { brandOf } from './brand';
import { downloadHtmlAsPdf } from './pdf';

const esc = (value: string) => value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch));

const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

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

type PayslipCompany = { name: string; address: string; org?: string };

/** ₹62,053.00, as Zoho prints amounts. */
const money = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** 30/09/2026 */
const dmy = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
/** Zoho's names for the statutory lines. */
const DEDUCTION_NAMES: Record<string, string> = { epf: 'EPF Contribution', esi: 'Employee State Insurance', pt: 'Professional Tax', lwf: 'Labour Welfare Fund', income_tax: 'Income Tax', food_coupon: 'Food Coupon Deduction' };

/** The payslip, laid out as Zoho Payroll's: summary, net pay box, earnings and deductions with YTD. */
export function payslipHtml(slip: PayslipDTO, company: PayslipCompany): string {
  const ytd = slip.ytd;
  const logo = brandOf(company.org)?.icon;
  const logoSrc = logo ? new URL(logo, window.location.origin).href : '';
  const earnings = slip.earnings.filter((e) => !e.hidden && e.paidPaise !== 0).map((e) => ({ name: e.name, amount: e.paidPaise, ytd: ytd?.earnings[e.code] }));
  if (slip.inputs.overtimePaise > 0) earnings.push({ name: 'Overtime', amount: slip.inputs.overtimePaise, ytd: undefined });
  const deductions = slip.deductions.filter((d) => !d.hidden && d.amountPaise !== 0).map((d) => ({ name: DEDUCTION_NAMES[d.key] ?? d.name, amount: d.amountPaise, ytd: ytd?.deductions[d.key] }));
  const gross = slip.grossPaise;
  const totalDeductions = slip.employeeDeductionsPaise;
  const reimbLines = [
    ...(slip.reimbursementLines ?? []).filter((r) => !r.hidden && r.amountPaise > 0).map((r) => ({ name: r.name, amount: r.amountPaise })),
  ];
  const structureReimb = reimbLines.reduce((t, r) => t + r.amount, 0);
  if (slip.reimbursementsPaise - structureReimb > 0) reimbLines.push({ name: 'Business Expense Reimbursements', amount: slip.reimbursementsPaise - structureReimb });
  const net = slip.netPayablePaise;
  const rows = Math.max(earnings.length, deductions.length);
  const cell = (x?: { name: string; amount: number; ytd?: number }) =>
    x ? `<td class="nm">${esc(x.name)}</td><td class="r b">${money(x.amount)}</td><td class="r y">${x.ytd !== undefined ? money(x.ytd) : ''}</td>` : '<td></td><td></td><td></td>';
  const body = Array.from({ length: rows }, (_, i) => `<tr>${cell(earnings[i])}<td class="gap"></td>${cell(deductions[i])}</tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip_${esc(slip.employeeId ?? slip.employeeName)}_${esc(monthLabel(slip.period))}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; font-family: "Noto Sans", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #222; background: #fff; font-size: 13px; }
  .page { max-width: 800px; margin: 0 auto; }
  .head { display: flex; align-items: center; gap: 14px; padding-bottom: 14px; border-bottom: 2px dotted #D9D9D9; }
  .logo { width: 78px; height: 78px; object-fit: contain; border-radius: 4px; }
  .co { flex: 1; } .co b { display: block; font-size: 20px; } .co span { color: #555; font-size: 12.5px; }
  .for { text-align: right; color: #555; font-size: 12.5px; } .for b { display: block; color: #222; font-size: 15px; margin-top: 4px; }
  .sum { display: flex; justify-content: space-between; gap: 24px; padding: 18px 0 14px; border-bottom: 2px dotted #D9D9D9; }
  .label { font-size: 11.5px; font-weight: 700; color: #444; letter-spacing: .02em; margin-bottom: 10px; }
  .kv { display: grid; grid-template-columns: 150px 14px 1fr; padding: 4px 0; } .kv span:first-child { color: #555; }
  .netbox { width: 280px; border: 1px solid #E3E3E3; border-radius: 8px; overflow: hidden; }
  .netbox .top { background: #F2FBF4; padding: 16px 18px 12px; border-left: 4px solid #3BA55C; margin: 10px 0 0 10px; }
  .netbox .amt { font-size: 22px; font-weight: 700; } .netbox .cap { color: #555; margin-top: 2px; }
  .netbox .days { padding: 10px 18px 14px; border-top: 1px dashed #E3E3E3; margin-top: 8px; }
  .netbox .kv { grid-template-columns: 90px 14px 1fr; }
  .bank { padding: 14px 4px; display: grid; grid-template-columns: 150px 14px 1fr; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #E3E3E3; border-radius: 8px; }
  th { text-align: left; font-size: 11.5px; font-weight: 700; color: #444; padding: 10px 12px 8px; border-bottom: 1px dashed #D9D9D9; }
  td { padding: 9px 12px; vertical-align: top; } td.r, th.r { text-align: right; white-space: nowrap; }
  td.b { font-weight: 600; } td.y { color: #444; } td.gap, th.gap { width: 10px; padding: 0; }
  tr.tot td { background: #F7F7F7; font-weight: 700; }
  .rtab { margin-top: 12px; }
  .payable { margin-top: 16px; display: flex; border: 1px solid #E3E3E3; border-radius: 8px; overflow: hidden; }
  .payable .l { flex: 1; padding: 12px 14px; } .payable .l b { display: block; font-size: 12.5px; } .payable .l span { color: #555; font-size: 12px; }
  .payable .amt { background: #F2FBF4; padding: 0 18px; display: flex; align-items: center; font-size: 15px; font-weight: 700; }
  .words { text-align: right; color: #555; margin-top: 14px; padding-bottom: 14px; border-bottom: 1px solid #D9D9D9; } .words b { color: #222; font-weight: 500; }
  .foot { text-align: center; color: #888; font-size: 11.5px; margin-top: 14px; }
  @media print { body { padding: 0; } @page { margin: 12mm; } }
</style></head><body><div class="page">
  <div class="head">
    ${logoSrc ? `<img class="logo" src="${esc(logoSrc)}" alt="">` : ''}
    <div class="co"><b>${esc(company.name)}</b>${company.address ? `<span>${esc(company.address)}</span>` : ''}</div>
    <div class="for">Payslip For the Month<b>${esc(monthLabel(slip.period))}</b></div>
  </div>
  <div class="sum">
    <div>
      <div class="label">EMPLOYEE SUMMARY</div>
      <div class="kv"><span>Employee Name</span><span>:</span><span>${esc(slip.employeeName)}</span></div>
      <div class="kv"><span>Designation</span><span>:</span><span>${esc(slip.designation ?? '—')}</span></div>
      <div class="kv"><span>Employee ID</span><span>:</span><span>${esc(slip.employeeId ?? '—')}</span></div>
      <div class="kv"><span>Date of Joining</span><span>:</span><span>${esc(dmy(slip.joiningDate))}</span></div>
      <div class="kv"><span>Pay Period</span><span>:</span><span>${esc(monthLabel(slip.period))}</span></div>
      <div class="kv"><span>Pay Date</span><span>:</span><span>${esc(dmy(lastDayOf(slip.period)))}</span></div>
    </div>
    <div class="netbox">
      <div class="top"><div class="amt">${money(net)}</div><div class="cap">Total Net Pay</div></div>
      <div class="days">
        <div class="kv"><span>Paid Days</span><span>:</span><span>${slip.inputs.payableDays}</span></div>
        <div class="kv"><span>LOP Days</span><span>:</span><span>${slip.inputs.lopDays}</span></div>
      </div>
    </div>
  </div>
  ${slip.bankAccountNo ? `<div class="bank"><span style="color:#555">Bank Account No</span><span>:</span><span>${esc(slip.bankAccountNo)}</span></div>` : '<div style="height:14px"></div>'}
  <table>
    <thead><tr><th>EARNINGS</th><th class="r">AMOUNT</th><th class="r">YTD</th><th class="gap"></th><th>DEDUCTIONS</th><th class="r">AMOUNT</th><th class="r">YTD</th></tr></thead>
    <tbody>${body}
      <tr class="tot"><td>Gross Earnings</td><td class="r">${money(gross)}</td><td></td><td class="gap"></td><td>Total Deductions</td><td class="r">${money(totalDeductions)}</td><td></td></tr>
    </tbody>
  </table>
  ${reimbLines.length ? `<table class="rtab"><thead><tr><th>REIMBURSEMENTS</th><th class="r">AMOUNT</th></tr></thead><tbody>${reimbLines.map((r) => `<tr><td class="nm">${esc(r.name)}</td><td class="r b">${money(r.amount)}</td></tr>`).join('')}<tr class="tot"><td>Total Reimbursements</td><td class="r">${money(slip.reimbursementsPaise)}</td></tr></tbody></table>` : ''}
  <div class="payable"><div class="l"><b>TOTAL NET PAYABLE</b><span>Gross Earnings - Total Deductions${slip.reimbursementsPaise > 0 ? ' + Total Reimbursements' : ''}</span></div><div class="amt">${money(net)}</div></div>
  <div class="words">Amount In Words : <b>${esc(rupeesInWords(net).replace('Indian Rupees', 'Indian Rupee'))}</b></div>
  <div class="foot">-- This is a system-generated document. --</div>
</div></body></html>`;
}

/** Opens the slip in a new tab ready to print or save as PDF. */
export function printPayslip(slip: PayslipDTO, company: PayslipCompany): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.open();
  win.document.write(payslipHtml(slip, company));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

/** Payslip_CS4_Sep_2026.pdf, as Zoho names it. */
export function downloadPayslipPdf(slip: PayslipDTO, company: PayslipCompany): Promise<void> {
  const [y, m] = slip.period.split('-').map(Number);
  const mon = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return downloadHtmlAsPdf(payslipHtml(slip, company), `Payslip_${slip.employeeId ?? slip.employeeName.replace(/\s+/g, '_')}_${mon}_${y}.pdf`);
}
