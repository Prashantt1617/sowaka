// Letters as HTML: a letter template's body (HTML with {{merge.fields}}) filled
// from the merge values, for the live preview (filled values blue, missing
// orange "[Field label]") and for the PDF the dashboard makes with html2pdf and
// uploads (CONTRACT decision 11: the server never renders HTML to PDF).
import type { LetterKind, SalaryBreakup } from '../../../services/lifecycle';
import { htmlToPdfBlob } from '../../pdf';
import { firstName, longDay, todayKey } from './format';

export const KIND_LABEL: Record<LetterKind, string> = {
  offer: 'Offer letter',
  appointment: 'Appointment letter',
  nda: 'NDA',
  confirmation: 'Confirmation letter',
  extension: 'Extension letter',
  relieving: 'Relieving letter',
};
export const LETTER_TITLE: Record<LetterKind, string> = {
  offer: 'Offer letter',
  appointment: 'Appointment letter',
  nda: 'Non-disclosure agreement',
  confirmation: 'Confirmation of employment',
  extension: 'Extension of probation',
  relieving: 'Relieving letter',
};
export const LETTER_KINDS: LetterKind[] = ['offer', 'appointment', 'nda', 'confirmation', 'extension', 'relieving'];

/** The words the Details list shows for each merge field the seeded templates use. */
const LABELS: Record<string, string> = {
  name: 'Full name', fullName: 'Full name', candidateName: 'Full name', firstName: 'First name',
  empId: 'Employee ID', employeeId: 'Employee ID',
  designation: 'Designation', department: 'Department',
  manager: 'Reporting manager', managerName: 'Reporting manager', reportingManager: 'Reporting manager',
  location: 'Work location', workLocation: 'Work location',
  joining: 'Joining date', joiningDate: 'Joining date', tj: 'Joining date',
  ctc: 'Yearly CTC', yearlyCtc: 'Yearly CTC', ctcWords: 'CTC in words',
  probation: 'Probation', probationMonths: 'Probation',
  notice: 'Notice period', noticeDays: 'Notice period', noticePeriod: 'Notice period',
  valid: 'Offer valid till', validTill: 'Offer valid till',
  offerDate: 'Offer accepted on', acceptedOn: 'Offer accepted on', offerAcceptedOn: 'Offer accepted on',
  confirm: 'Confirmed from', confirmedFrom: 'Confirmed from', confirmationDate: 'Confirmed from',
  lastDay: 'Last working day', lastWorkingDay: 'Last working day', tl: 'Last working day',
  extendMonths: 'Extended by', extendedBy: 'Extended by', probationEndsOn: 'Probation now ends',
  responsibilities: 'Responsibilities', employeeType: 'Employment type',
  companyName: 'Company name', companyAddress: 'Company address', company: 'Company name',
  hrName: 'Signed by', signatory: 'Signed by', date: 'Letter date', refNo: 'Ref no.',
};
/** "Reporting manager" for `manager`; "Notice days" for an unknown `noticeDays`. */
export function fieldLabel(key: string): string {
  const k = key.replace(/^merge\./, '');
  if (LABELS[k]) return LABELS[k];
  const words = k.replace(/[._]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const FIELD = /\{\{\s*([\w.]+)\s*\}\}/g;
const norm = (key: string) => key.replace(/^merge\./, '');
/** Every merge field a template body uses, in the order it first appears. */
export function placeholders(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(FIELD)) {
    const k = norm(m[1]);
    if (!seen.includes(k)) seen.push(k);
  }
  return seen;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

/** HR's template HTML with anything that could run taken out: scripts, frames, handlers, javascript: links. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, link, meta, base, form, input, button, textarea, select').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      if (n.startsWith('on') || ((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*javascript:/i.test(attr.value))) el.removeAttribute(attr.name);
    }
  });
  return doc.body.firstElementChild?.innerHTML ?? '';
}

/** Whether a value counts as filled in. */
export const filled = (values: Record<string, string>, key: string) => (values[key] ?? '').trim() !== '';

/**
 * The body with each field filled. `preview` writes the plain value and a blank
 * line for a missing one; `pdf` writes the plain value.
 */
export function fillBody(body: string, values: Record<string, string>, mode: 'preview' | 'pdf'): string {
  return sanitizeHtml(body).replace(FIELD, (_, raw: string) => {
    const key = norm(raw);
    const v = (values[key] ?? '').trim();
    if (mode === 'pdf') return esc(v);
    // The preview reads as the letter will: plain values, and a blank line where one is still missing.
    return v ? esc(v) : `<span class="lf-blank" title="${esc(fieldLabel(key))}">__________</span>`;
  });
}

/** The fields the letter needs that have no value yet (the template's fields plus anything the server says is missing). */
export function missingFields(body: string, values: Record<string, string>, serverMissing: string[] = []): string[] {
  const need = [...placeholders(body), ...serverMissing.map(norm)];
  return [...new Set(need)].filter((k) => !filled(values, k));
}

/** `logo`: the company's mark (an absolute URL, so the PDF can draw it); without one, its initials on a tile. */
export type Letterhead = { company: string; address?: string; refNo?: string; date?: string; title: string; logo?: string };

/** "ACMT" for "ACMT Group of Colleges", "ST" for "Sowaka Test": the tile beside the name when there is no logo. */
export function monogram(company: string): string {
  const words = company.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (/^[A-Z0-9]{2,5}$/.test(words[0])) return words[0];
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

/** The letterhead: the logo (or initials), the name and address; the reference and the date on the right. */
function letterheadHtml(head: Letterhead): string {
  const mark = head.logo ? `<img class="lf-logo" src="${esc(head.logo)}" alt="">` : `<span class="lf-mono">${esc(monogram(head.company))}</span>`;
  return `<div class="lf-head">
    <div class="lf-brand">${mark}<div class="lf-co"><b>${esc(head.company)}</b>${head.address ? `<span>${esc(head.address)}</span>` : ''}</div></div>
    <div class="lf-ref">${head.refNo ? `Ref ${esc(head.refNo)}<br>` : ''}${esc(head.date ?? longDay(todayKey()))}</div>
  </div>`;
}

/** The letter's own CSS: a white A4 page, letterhead with a 2px rule, the highlighted fields for the preview.
 *  Colours are the dashboard theme's light values (--ink, --ink-2, --ink-3, --line, --line-2, --surface-2,
 *  --t-sky, --t-peach), written out because the PDF is drawn without the dashboard's stylesheet. */
export const LETTER_CSS = `
  .lf-page { font-family: "Sora", "Noto Sans", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #141416; background: #fff; font-size: 13px; line-height: 1.65; }
  .lf-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid #E9E9EC; margin-bottom: 18px; }
  .lf-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .lf-logo { width: 36px; height: 36px; border-radius: 10px; object-fit: contain; flex: none; }
  .lf-mono { width: 36px; height: 36px; border-radius: 10px; background: #141416; color: #FFFFFF; font-size: 10px; font-weight: 700; letter-spacing: .02em; display: flex; align-items: center; justify-content: center; flex: none; }
  .lf-co { line-height: 1.35; min-width: 0; } .lf-co b { display: block; font-size: 13px; font-weight: 600; } .lf-co span { display: block; color: #8A8A93; font-size: 11.5px; }
  .lf-ref { text-align: right; color: #8A8A93; font-size: 11.5px; line-height: 1.5; white-space: nowrap; }
  .lf-title { font-size: 18px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 14px; }
  .lf-body p { margin: 0 0 12px; } .lf-body table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; } .lf-body td, .lf-body th { border: 1px solid #E9E9EC; padding: 7px 10px; text-align: left; }
  .lf-body img { max-width: 100%; }
  mark.lf-on { background: #E5F2FF; color: inherit; border-radius: 4px; padding: 0 2px; }
  mark.lf-miss { background: #FFEDE4; color: #C2562A; border-radius: 4px; padding: 0 2px; }
  .lf-blank { color: #9A9AA3; letter-spacing: 1px; }
  .lf-annex { margin-top: 28px; padding-top: 18px; border-top: 1px dashed #DADADF; page-break-before: always; break-before: page; }
  .lf-annex table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; } .lf-annex td, .lf-annex th { border: 1px solid #E9E9EC; padding: 7px 10px; text-align: left; }
  .lf-annex td.n, .lf-annex th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .lf-annex tr.t td { font-weight: 600; background: #F5F5F6; }
  .lf-annex p.s { color: #4E4E56; font-size: 11.5px; }
`;

/** The page inside (letterhead, title, filled body, then any annexure) as HTML, for the preview and the PDF. */
export function letterInner(body: string, values: Record<string, string>, head: Letterhead, mode: 'preview' | 'pdf', annex = ''): string {
  return `<div class="lf-page">
  ${letterheadHtml(head)}
  <h1 class="lf-title">${esc(head.title)}</h1>
  <div class="lf-body">${fillBody(body, values, mode)}</div>${annex}
</div>`;
}

/** A whole document, ready for html2pdf. */
export function letterDocument(body: string, values: Record<string, string>, head: Letterhead, annex = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(head.title)}</title><style>${LETTER_CSS} body { margin: 0; padding: 24px; background: #fff; }</style></head><body>${letterInner(body, values, head, 'pdf', annex)}</body></html>`;
}

export async function letterPdf(body: string, values: Record<string, string>, head: Letterhead, filename: string, annex = ''): Promise<Blob> {
  return htmlToPdfBlob(letterDocument(body, values, head, annex), filename);
}

// —— Annexure A and the other suggested extras (H3c) —————————————————————

/** Offer and appointment letters whose wording promises Annexure A get the salary breakup as their last page. */
export const takesAnnexure = (kind: LetterKind, body: string) => (kind === 'offer' || kind === 'appointment') && /annexure\s*a/i.test(body);

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** Annexure A: the CTC split by the company's salary template, as the payroll calculator works it out. */
export function annexureHtml(b: NonNullable<SalaryBreakup['breakup']>, name: string): string {
  const groups: Array<[string, typeof b.lines]> = [
    ['Earnings', b.lines.filter((l) => l.group === 'earning')],
    ['Reimbursements', b.lines.filter((l) => l.group === 'reimbursement')],
    ['Benefits and employer contributions', b.lines.filter((l) => l.group === 'benefit' || l.group === 'employer')],
  ];
  const rows = groups.filter(([, l]) => l.length).map(([title, l]) => `<tr><th colspan="3">${esc(title)}</th></tr>${l.map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${inr(x.monthly)}</td><td class="n">${inr(x.annual)}</td></tr>`).join('')}`).join('');
  return `<div class="lf-annex">
  <h2 class="lf-title">Annexure A · Salary breakup</h2>
  <p>${name ? `For ${esc(name)}. ` : ''}Yearly cost to company ${inr(b.ctcAnnual)}, a month ${inr(b.ctcMonthly)}.</p>
  <table><thead><tr><th>Component</th><th class="n">Monthly</th><th class="n">Yearly</th></tr></thead><tbody>${rows}
  <tr class="t"><td>Cost to company</td><td class="n">${inr(b.ctcMonthly)}</td><td class="n">${inr(b.ctcAnnual)}</td></tr></tbody></table>
  <p class="s">Gross pay a month ${inr(b.grossMonthly)}. Income tax and the statutory deductions that apply to you (Provident Fund, ESI, Professional Tax) come out of gross pay. Worked out on the ${esc(b.templateName)} salary structure.</p>
</div>`;
}

/** A one-page document (Annexure A on its own, the joining checklist) on the letterhead, ready for html2pdf. */
export function simpleDocument(head: Letterhead, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(head.title)}</title><style>${LETTER_CSS} body { margin: 0; padding: 24px; background: #fff; } .lf-annex { margin-top: 0; padding-top: 0; border-top: 0; page-break-before: auto; break-before: auto; }</style></head><body><div class="lf-page">
  ${letterheadHtml(head)}
  ${inner}
</div></body></html>`;
}

/** The joining checklist: the documents to keep ready and what to bring on Day 1. */
export function checklistHtml(name: string, docs: Array<{ label: string; required: boolean }>, bring: string[], joining?: string): string {
  const li = (t: string) => `<li style="margin:0 0 6px">☐ ${t}</li>`;
  return `<div class="lf-annex">
  <h2 class="lf-title">Joining checklist</h2>
  <p>${name ? `Hi ${esc(firstName(name))}, ` : ''}here is what to keep ready${joining ? ` before you join on ${esc(joining)}` : ''}. You upload the documents on your joining portal.</p>
  ${docs.length ? `<p><b>Documents</b></p><ul style="list-style:none;padding:0;margin:0 0 14px">${docs.map((d) => li(`${esc(d.label)}${d.required ? '' : ' <span style="color:#8A8A93">(optional)</span>'}`)).join('')}</ul>` : ''}
  ${bring.length ? `<p><b>On your first day, bring</b></p><ul style="list-style:none;padding:0;margin:0 0 14px">${bring.map((b) => li(esc(b))).join('')}</ul>` : ''}
  <p class="s">Questions? Reply to the email this came with.</p>
</div>`;
}

/** "Offer letter – Kabir Mehta.pdf". */
export const letterFileName = (kind: LetterKind, name: string) => `${KIND_LABEL[kind]} – ${name || 'letter'}.pdf`.replace(/[/\\:*?"<>|]/g, '');

const pick = (values: Record<string, string>, ...keys: string[]) => keys.map((k) => (values[k] ?? '').trim()).find(Boolean) ?? '';
export const valueName = (v: Record<string, string>) => pick(v, 'name', 'fullName', 'candidateName');

/** The email that carries a letter: subject and body as HR's drafts start (H3c). */
export function emailDraft(kind: LetterKind, values: Record<string, string>, opts: { company: string; hrName: string; withLink?: boolean }): { subject: string; body: string } {
  const first = pick(values, 'firstName') || firstName(valueName(values)) || 'there';
  const role = pick(values, 'designation');
  const sign = `Warm regards,\n${opts.hrName}\nHR, ${opts.company}`;
  switch (kind) {
    case 'offer': {
      const by = pick(values, 'valid', 'validTill');
      return {
        subject: `Your offer from ${opts.company}`,
        body: `Hi ${first},\n\nCongratulations! We are delighted to offer you the role of ${role || 'the role'} at ${opts.company}. Your offer letter is attached.\n\n${opts.withLink ? 'You can read it and accept it online using the button below. ' : ''}Please reply by ${by || 'the date in the letter'}. If you have any questions, just reply to this email.\n\n${sign}`,
      };
    }
    case 'appointment':
    case 'nda': {
      const by = pick(values, 'joining', 'joiningDate', 'tj');
      return {
        subject: kind === 'nda' ? 'Your non-disclosure agreement' : 'Your appointment letter',
        body: `Hi ${first},\n\nYour ${kind === 'nda' ? 'non-disclosure agreement' : 'appointment letter'} is attached. Please read it and sign it on your joining portal${by ? ` before ${by}` : ''}.\n\n${sign}`,
      };
    }
    case 'confirmation':
      return { subject: 'Your confirmation letter', body: `Hi ${first},\n\nCongratulations on completing your probation. Your confirmation letter is attached.\n\n${sign}` };
    case 'extension':
      return { subject: 'Your probation extension letter', body: `Hi ${first},\n\nYour letter about the extension of your probation is attached. Your manager will go through the next steps with you.\n\n${sign}` };
    case 'relieving':
      return { subject: 'Your relieving letter', body: `Hi ${first},\n\nYour relieving letter is attached. We wish you all the best.\n\n${sign}` };
  }
}
