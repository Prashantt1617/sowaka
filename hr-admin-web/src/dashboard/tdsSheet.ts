// A payslip's TDS work sheet as a self-contained HTML document, laid out as
// Zoho Payroll's (sections 1 to 15), and saved as a PDF from the dashboard.
import { getTdsSheet, type TdsSheetDTO } from '../services/payroll';
import { brandOf } from './brand';
import { downloadHtmlAsPdf } from './pdf';

const esc = (value: string) => value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch));
/** ₹1,98,000.00, as Zoho prints amounts. */
const money = (paise: number) =>
  `${paise < 0 ? '-' : ''}₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Row = { label: string; actual?: number; projection?: number; total?: number; bold?: boolean; small?: string };

const tr = (r: Row) =>
  `<tr${r.bold ? ' class="b"' : ''}><td class="p">${r.label}${r.small ? `<div class="sm">${r.small}</div>` : ''}</td>` +
  `<td class="r">${r.actual !== undefined ? money(r.actual) : ''}</td>` +
  `<td class="r">${r.projection !== undefined ? money(r.projection) : ''}</td>` +
  `<td class="r">${r.total !== undefined ? money(r.total) : ''}</td></tr>`;

/** One numbered section: its own table so a page break never splits it. */
const section = (heading: string | null, rows: Row[], cls = '') =>
  `<table class="sec ${cls}">${COLS}<tbody>${heading ? `<tr class="h"><td class="p">${heading}</td><td></td><td></td><td></td></tr>` : ''}${rows.map(tr).join('')}</tbody></table>`;

const COLS = '<colgroup><col style="width:51%"><col style="width:16%"><col style="width:16%"><col style="width:17%"></colgroup>';

export function tdsSheetHtml(s: TdsSheetDTO): string {
  const logo = brandOf(s.company.org)?.icon;
  const logoSrc = logo ? new URL(logo, window.location.origin).href : '';
  const month = s.monthName;
  const old = s.regime === 'old';

  const slabRows = s.tax.slabRows
    .map((r, i) => {
      const from = i === 0 ? r.fromPaise : r.fromPaise + 100;
      const range = r.toPaise === null ? `For ${money(from)} and above` : `For ${money(from)} to ${money(r.toPaise)}`;
      return `<tr><td>${range}<div class="sm">(Tax: ${r.ratePercent}% of ${money(r.onPaise)})</div></td><td class="r">${money(r.taxPaise)}</td></tr>`;
    })
    .join('');
  const sec12 = `<table class="sec">${COLS}<tbody>
    <tr class="h"><td class="p">12) Tax Calculation
      <table class="slabs"><tr><th>Taxable Income Range</th><th class="r">Tax Amount</th></tr>${slabRows}</table></td><td></td><td></td><td></td></tr>
    ${tr({ label: 'Tax on total Income', total: s.tax.slabTaxPaise, bold: true })}
    ${tr({ label: 'Less : Rebate Under Section 156(a)', total: s.tax.rebatePaise, bold: true })}
    ${tr({ label: 'Less : Relief Under Section 156(b)', total: s.tax.marginalReliefPaise, bold: true })}
    <tr><td class="p note">Note: If taxable income is less than ${money(s.rebateRule.incomeLimitPaise)}, tax rebate of a maximum of ${money(s.rebateRule.maxRebatePaise)} is provided under Section 156.</td><td></td><td></td><td></td></tr>
  </tbody></table>`;

  const chapter = old
    ? s.chapterVIII.map((r) => `<tr><td class="p">${esc(r.name)}</td><td class="r">${money(r.qualifyingPaise)}</td><td class="r">${money(r.deductiblePaise)}</td><td></td></tr>`).join('')
    : `<tr class="b"><td class="p">Total (123+124) Deductible amount</td><td class="r">${money(0)}</td><td class="r">${money(0)}</td><td></td></tr>`;
  const sec10 = `<table class="sec">${COLS}<tbody>
    <tr class="h"><td class="p">10) Deductions under Chapter VIII</td><td class="r">Qualifying</td><td class="r">Deductible</td><td></td></tr>
    ${chapter}
    ${tr({ label: 'Total of Deductions under Chapter VIII', total: s.chapterVIIIPaise, bold: true })}
  </tbody></table>`;

  const body = [
    section('1) Gross Earnings', [
      ...s.earnings.map((e) => ({ label: esc(e.name), actual: e.actualPaise, projection: e.projectionPaise, total: e.totalPaise })),
      { label: 'Total Income', total: s.grossPaise, bold: true },
    ]),
    section('2) Allowance to the extent exempt under Section 11', [
      ...s.exemptions.map((e) => ({ label: esc(e.name), total: e.paise })),
      { label: 'Total of Allowance to the extent exempt under Section 11', total: s.exemptPaise, bold: true },
    ]),
    section(null, [{ label: '3) Total After Exemption (1-2)', total: s.afterExemptionPaise, bold: true }]),
    section('4) Taxable Income under Previous employment', [
      { label: 'i) Income After Exemptions', actual: s.previousEmployment.incomePaise },
      { label: 'ii) Less: Professional Tax', actual: s.previousEmployment.professionalTaxPaise },
      { label: 'Total taxable income under Previous employment', total: s.previousEmployment.incomePaise - s.previousEmployment.professionalTaxPaise, bold: true },
    ]),
    section(null, [{ label: '5) Gross Total (3+4)', total: s.grossTotalPaise, bold: true }]),
    section('6) Under Section 19', [
      { label: 'a) Entertainment allowance', actual: s.section19.entertainmentPaise },
      { label: 'b) Tax on employment', actual: s.section19.taxOnEmploymentPaise },
      { label: 'c) Standard Deduction', actual: s.section19.standardDeductionPaise },
      { label: 'Total Under Section 19', total: s.section19.totalPaise, bold: true },
    ]),
    section(null, [{ label: '7) Income Chargeable Under the Head Salaries (5-6)', total: s.chargeablePaise, bold: true }]),
    section('8) Any other income reported by the employee', [{ label: 'Total Income From Other Sources', total: s.otherIncomePaise, bold: true }]),
    section(null, [{ label: '9) Gross Total Income (7+8)', total: s.grossTotalIncomePaise, bold: true }]),
    sec10,
    section(null, [{ label: '11) Total Income (Round By 10 Rupees) (9-10)', total: s.totalIncomePaise, bold: true }]),
    sec12,
    section(null, [{ label: '13) Total Tax on Income', total: s.tax.taxAfterRebatePaise, bold: true }]),
    section(null, [
      { label: 'Surcharge Amount', total: s.tax.surchargePaise },
      { label: `Education Cess ${s.tax.cessPercent}% of ${money(s.tax.cessOnPaise)}`, total: s.tax.cessPaise },
      { label: 'Less: Relief Under Section 157', total: s.tax.relief157Paise },
    ]),
    section(null, [{ label: '14) Tax Payable including Education Cess minus of Relief Under Section 157', total: s.tax.annualTaxPaise, bold: true }]),
    section('15) Tax Deducted at Source', [
      { label: 'i) TDS till last month', actual: s.tds.tillLastMonthPaise },
      { label: `ii) TDS for ${month}`, actual: s.tds.thisMonthPaise },
      { label: 'iii) TDS by Previous Employer', actual: s.tds.previousEmployerPaise },
      { label: 'A) Total Tax Deducted at Source (i+ii+iii)', total: s.tds.totalPaise, bold: true },
      { label: 'Tax Payable / Refundable (14 - 15(A))', total: s.tds.payablePaise },
      ...(s.tds.monthsAfter > 0 ? [{ label: `TDS per month for the next ${s.tds.monthsAfter} month${s.tds.monthsAfter === 1 ? '' : 's'}`, total: s.tds.perMonthNextPaise }] : []),
    ]),
    section(null, [{ label: `TDS for ${month}`, total: s.tds.thisMonthPaise, bold: true }], 'last'),
  ].join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>TDS Work Sheet ${esc(s.employee.employeeId ?? '')} ${esc(month)} ${s.year}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; font-family: "Noto Sans", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #222; background: #fff; font-size: 12.5px; }
  .page { max-width: 800px; margin: 0 auto; }
  .head { display: flex; align-items: flex-start; gap: 14px; padding-bottom: 12px; border-bottom: 2px dotted #D9D9D9; }
  .co { flex: 1; } .co b { display: block; font-size: 20px; color: #333; } .co span { color: #555; font-size: 12.5px; font-weight: 600; }
  .logo { width: 84px; height: 84px; object-fit: contain; border-radius: 4px; }
  h1 { font-size: 20px; margin: 22px 0 18px; color: #333; } h1 small { font-size: 13px; color: #555; font-weight: 600; }
  .who { display: grid; grid-template-columns: 34% 20% 25% 21%; padding-bottom: 12px; border-bottom: 2px dotted #D9D9D9; }
  .who span { display: block; color: #333; font-size: 12.5px; margin-bottom: 4px; } .who b { font-size: 13px; }
  .intro { font-weight: 700; margin: 18px 0 8px; }
  table.sec { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1px solid #D5D5D5; border-top: none; page-break-inside: avoid; }
  table.sec.first { border-top: 1px solid #D5D5D5; }
  .sec td { padding: 5px 18px; vertical-align: top; border-left: 1px solid #D5D5D5; }
  .sec td:first-child { border-left: none; }
  .sec tr:first-child td { padding-top: 12px; } .sec tr:last-child td { padding-bottom: 12px; }
  .sec tr.h td.p, .sec tr.b td { font-weight: 700; }
  .sec td.r { text-align: right; white-space: nowrap; }
  .sec tr.h td.r { font-weight: 700; }
  .sec td.p { padding-left: 18px; } .sec tr:not(.h) td.p { padding-left: 18px; }
  .note { font-size: 11.5px; font-weight: 400; }
  .sm { font-size: 11px; color: #333; font-weight: 400; }
  table.slabs { width: 100%; border-collapse: collapse; margin: 10px 0 4px; font-weight: 400; }
  .slabs th, .slabs td { border: 1px solid #D5D5D5; padding: 6px 16px; text-align: left; font-weight: 400; vertical-align: middle; }
  .slabs .r { text-align: right; }
  .sec table.slabs th, .sec table.slabs td { font-weight: 400 !important; }
  .head-row { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1px solid #D5D5D5; background: #F2F2F2; }
  .head-row td { padding: 9px 18px; border-left: 1px solid #D5D5D5; } .head-row td:first-child { border-left: none; } .head-row td.r { text-align: right; }
  table.sec.last { background: #F2F2F2; }
  @media print { body { padding: 0; } @page { margin: 12mm; } }
</style></head><body><div class="page">
  <div class="head">
    <div class="co"><b>${esc(s.company.name)}</b>${s.company.address ? `<span>${esc(s.company.address)}</span>` : ''}</div>
    ${logoSrc ? `<img class="logo" src="${esc(logoSrc)}" alt="">` : ''}
  </div>
  <h1>TDS WORK SHEET <small>for the month of ${esc(month)} ${s.year}</small></h1>
  <div class="who">
    <div><span>EMPLOYEE NAME</span><b>${esc(s.employee.name)}${s.employee.employeeId ? `, ${esc(s.employee.employeeId)}` : ''}</b></div>
    <div><span>PAN</span><b>${esc(s.employee.pan ?? '—')}</b></div>
    <div><span>DESIGNATION</span><b>${esc(s.employee.designation ?? '—')}</b></div>
    <div><span>TAX REGIME</span><b>${s.regime === 'old' ? 'Old Regime' : 'New Regime'}</b></div>
  </div>
  <div class="intro">Details of salary paid and any other income and tax deducted</div>
  <table class="head-row">${COLS}<tr><td>Particulars</td><td class="r">Actual</td><td class="r">Projection</td><td class="r">Total</td></tr></table>
  ${body}
</div></body></html>`;
}

/** TDS_Worksheet_CS4_Sep_2026.pdf */
export async function downloadTdsSheetPdf(payslipId: string): Promise<void> {
  const sheet = await getTdsSheet(payslipId);
  const mon = sheet.monthName.slice(0, 3);
  const who = sheet.employee.employeeId ?? sheet.employee.name.replace(/\s+/g, '_');
  await downloadHtmlAsPdf(tdsSheetHtml(sheet), `TDS_Worksheet_${who}_${mon}_${sheet.year}.pdf`);
}
