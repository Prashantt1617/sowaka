// The final settlement as a self-contained HTML document, laid out like the
// payslip: who it is for, what is paid, what is taken, and the amount. Saved
// as a PDF from the browser (Settlement_CS342.pdf), with a short letter on a
// second page for HR to send with it.
import type { ExitDTO, SettlementDTO } from '../services/hrms';
import { brandOf } from './brand';
import { downloadHtmlAsPdf } from './pdf';
import { rupeesInWords } from './payslip';

const esc = (value: string) => value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch));
const money = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const longDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

type Company = { name: string; address: string; org?: string };

export function settlementHtml(exit: ExitDTO, s: SettlementDTO, company: Company): string {
  const logo = brandOf(company.org)?.icon;
  const logoSrc = logo ? new URL(logo, window.location.origin).href : '';
  const earnings = s.lines.filter((l) => l.side === 'earning' && l.amountPaise !== 0);
  const deductions = s.lines.filter((l) => l.side === 'deduction' && l.amountPaise !== 0);
  const row = (l: SettlementDTO['lines'][number]) =>
    `<tr><td class="nm">${esc(l.label)}${l.note || l.changedReason ? `<span>${esc([l.note, l.changedReason ? `Changed: ${l.changedReason}` : ''].filter(Boolean).join(' · '))}</span>` : ''}</td><td class="r b">${money(l.amountPaise)}</td></tr>`;
  const pay = s.payablePaise >= 0;
  const first = exit.name.trim().split(/\s+/)[0];
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Settlement_${esc(exit.employeeId || exit.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; font-family: "Noto Sans", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #222; background: #fff; font-size: 13px; }
  .page { max-width: 800px; margin: 0 auto; }
  .head { display: flex; align-items: center; gap: 14px; padding-bottom: 14px; border-bottom: 2px dotted #D9D9D9; }
  .logo { width: 78px; height: 78px; object-fit: contain; border-radius: 4px; }
  .co { flex: 1; } .co b { display: block; font-size: 20px; } .co span { color: #555; font-size: 12.5px; }
  .for { text-align: right; color: #555; font-size: 12.5px; } .for b { display: block; color: #222; font-size: 15px; margin-top: 4px; }
  .sum { display: flex; justify-content: space-between; gap: 24px; padding: 18px 0 14px; border-bottom: 2px dotted #D9D9D9; margin-bottom: 14px; }
  .label { font-size: 11.5px; font-weight: 700; color: #444; letter-spacing: .02em; margin-bottom: 10px; }
  .kv { display: grid; grid-template-columns: 150px 14px 1fr; padding: 4px 0; } .kv span:first-child { color: #555; }
  .netbox { width: 280px; border: 1px solid #E3E3E3; border-radius: 8px; overflow: hidden; align-self: flex-start; }
  .netbox .top { background: ${pay ? '#F2FBF4' : '#FDF3F2'}; padding: 16px 18px 14px; border-left: 4px solid ${pay ? '#3BA55C' : '#D9534F'}; margin: 10px 0 10px 10px; }
  .netbox .amt { font-size: 22px; font-weight: 700; } .netbox .cap { color: #555; margin-top: 2px; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #E3E3E3; border-radius: 8px; margin-top: 12px; }
  th { text-align: left; font-size: 11.5px; font-weight: 700; color: #444; padding: 10px 12px 8px; border-bottom: 1px dashed #D9D9D9; }
  td { padding: 9px 12px; vertical-align: top; } td.r, th.r { text-align: right; white-space: nowrap; }
  td.b { font-weight: 600; } td.nm span { display: block; color: #666; font-size: 11.5px; margin-top: 2px; }
  tr.tot td { background: #F7F7F7; font-weight: 700; }
  .payable { margin-top: 16px; display: flex; border: 1px solid #E3E3E3; border-radius: 8px; overflow: hidden; }
  .payable .l { flex: 1; padding: 12px 14px; } .payable .l b { display: block; font-size: 12.5px; } .payable .l span { color: #555; font-size: 12px; }
  .payable .amt { background: ${pay ? '#F2FBF4' : '#FDF3F2'}; padding: 0 18px; display: flex; align-items: center; font-size: 15px; font-weight: 700; }
  .words { text-align: right; color: #555; margin-top: 14px; padding-bottom: 14px; border-bottom: 1px solid #D9D9D9; } .words b { color: #222; font-weight: 500; }
  .foot { text-align: center; color: #888; font-size: 11.5px; margin-top: 14px; }
  .letter { page-break-before: always; padding-top: 8px; line-height: 1.7; font-size: 13.5px; } .letter p { margin: 0 0 14px; }
  @media print { body { padding: 0; } @page { margin: 12mm; } }
</style></head><body><div class="page">
  <div class="head">
    ${logoSrc ? `<img class="logo" src="${esc(logoSrc)}" alt="">` : ''}
    <div class="co"><b>${esc(company.name)}</b>${company.address ? `<span>${esc(company.address)}</span>` : ''}</div>
    <div class="for">Full and Final Settlement<b>${esc(longDay(exit.lastWorkingDay))}</b></div>
  </div>
  <div class="sum">
    <div>
      <div class="label">EMPLOYEE SUMMARY</div>
      <div class="kv"><span>Employee Name</span><span>:</span><span>${esc(exit.name)}</span></div>
      <div class="kv"><span>Designation</span><span>:</span><span>${esc(exit.designation || '—')}</span></div>
      <div class="kv"><span>Employee ID</span><span>:</span><span>${esc(exit.employeeId || '—')}</span></div>
      <div class="kv"><span>Date of Joining</span><span>:</span><span>${esc(dmy(exit.joiningDate))}</span></div>
      <div class="kv"><span>Last Working Day</span><span>:</span><span>${esc(dmy(exit.lastWorkingDay))}</span></div>
      <div class="kv"><span>Reason</span><span>:</span><span>${esc(exit.kindLabel)}</span></div>
    </div>
    <div class="netbox"><div class="top"><div class="amt">${money(Math.abs(s.payablePaise))}</div><div class="cap">${pay ? 'Net Settlement Payable' : 'To Be Recovered'}</div></div></div>
  </div>
  <table>
    <thead><tr><th>EARNINGS</th><th class="r">AMOUNT</th></tr></thead>
    <tbody>${earnings.map(row).join('') || '<tr><td class="nm">None</td><td class="r b">₹0.00</td></tr>'}<tr class="tot"><td>Total Earnings</td><td class="r">${money(s.earningsPaise)}</td></tr></tbody>
  </table>
  <table>
    <thead><tr><th>DEDUCTIONS</th><th class="r">AMOUNT</th></tr></thead>
    <tbody>${deductions.map(row).join('') || '<tr><td class="nm">None</td><td class="r b">₹0.00</td></tr>'}<tr class="tot"><td>Total Deductions</td><td class="r">${money(s.deductionsPaise)}</td></tr></tbody>
  </table>
  <div class="payable"><div class="l"><b>${pay ? 'NET SETTLEMENT PAYABLE' : 'AMOUNT TO BE RECOVERED'}</b><span>Total Earnings - Total Deductions</span></div><div class="amt">${money(Math.abs(s.payablePaise))}</div></div>
  <div class="words">Amount In Words : <b>${esc(rupeesInWords(Math.abs(s.payablePaise)).replace('Indian Rupees', 'Indian Rupee'))}</b></div>
  <div class="foot">-- This is a system-generated document. --</div>

  <div class="letter">
    <p>${esc(longDay(s.approvedAt ?? today))}</p>
    <p>Dear ${esc(first)},</p>
    <p>This is to confirm that your employment with ${esc(company.name)} ended on ${esc(longDay(exit.lastWorkingDay))}, your last working day.</p>
    <p>Your full and final settlement is enclosed. It covers your salary up to your last working day and every other amount due to you, less the deductions listed. ${pay
      ? `The net amount of ${money(s.payablePaise)} (${esc(rupeesInWords(s.payablePaise))}) is being paid to your bank account on record.`
      : `After the deductions listed, ${money(-s.payablePaise)} (${esc(rupeesInWords(-s.payablePaise))}) remains due from you to the company.`}</p>
    <p>Your Form 16 for this financial year will be sent after the year ends. For any document or question, write to HR.</p>
    <p>We thank you for your work with us and wish you the very best.</p>
    <p style="margin-top:28px">For ${esc(company.name)}<br><br><br>Authorised signatory</p>
  </div>
</div></body></html>`;
}

/** Settlement_CS342.pdf */
export function downloadSettlementPdf(exit: ExitDTO, s: SettlementDTO, company: Company): Promise<void> {
  return downloadHtmlAsPdf(settlementHtml(exit, s, company), `Settlement_${exit.employeeId || exit.name.replace(/\s+/g, '_')}.pdf`);
}
