// Letters as HTML: a letter template's body (HTML with {{merge.fields}}) filled
// from the merge values, for the live preview (filled values blue, missing
// orange "[Field label]") and for the PDF the dashboard makes with html2pdf and
// uploads (CONTRACT decision 11: the server never renders HTML to PDF).
import type { LetterKind } from '../../../services/lifecycle';
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
  ctc: 'Yearly CTC', yearlyCtc: 'Yearly CTC',
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
 * The body with each field filled. `preview` marks filled values and shows a
 * missing one as "[Field label]"; `pdf` writes the plain value.
 */
export function fillBody(body: string, values: Record<string, string>, mode: 'preview' | 'pdf'): string {
  return sanitizeHtml(body).replace(FIELD, (_, raw: string) => {
    const key = norm(raw);
    const v = (values[key] ?? '').trim();
    if (mode === 'pdf') return esc(v);
    return v ? `<mark class="lf-on">${esc(v)}</mark>` : `<mark class="lf-miss">[${esc(fieldLabel(key))}]</mark>`;
  });
}

/** The fields the letter needs that have no value yet (the template's fields plus anything the server says is missing). */
export function missingFields(body: string, values: Record<string, string>, serverMissing: string[] = []): string[] {
  const need = [...placeholders(body), ...serverMissing.map(norm)];
  return [...new Set(need)].filter((k) => !filled(values, k));
}

export type Letterhead = { company: string; address?: string; refNo?: string; date?: string; title: string };

/** The letter's own CSS: a white A4 page, letterhead with a 2px rule, the highlighted fields for the preview. */
export const LETTER_CSS = `
  .lf-page { font-family: "Sora", "Noto Sans", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #222; background: #fff; font-size: 13px; line-height: 1.65; }
  .lf-head { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 2px solid #141416; margin-bottom: 18px; }
  .lf-co b { display: block; font-size: 17px; font-weight: 600; } .lf-co span { color: #555; font-size: 12px; }
  .lf-ref { text-align: right; color: #555; font-size: 12px; white-space: nowrap; }
  .lf-title { font-size: 15px; font-weight: 600; margin: 0 0 14px; }
  .lf-body p { margin: 0 0 12px; } .lf-body table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; } .lf-body td, .lf-body th { border: 1px solid #E3E3E3; padding: 7px 10px; text-align: left; }
  .lf-body img { max-width: 100%; }
  mark.lf-on { background: #E5F2FF; color: inherit; border-radius: 4px; padding: 0 2px; }
  mark.lf-miss { background: #FFEDE4; color: #C2562A; border-radius: 4px; padding: 0 2px; }
`;

/** The page inside (letterhead, title, filled body) as HTML, for the preview and the PDF. */
export function letterInner(body: string, values: Record<string, string>, head: Letterhead, mode: 'preview' | 'pdf'): string {
  return `<div class="lf-page">
  <div class="lf-head">
    <div class="lf-co"><b>${esc(head.company)}</b>${head.address ? `<span>${esc(head.address)}</span>` : ''}</div>
    <div class="lf-ref">${head.refNo ? `Ref ${esc(head.refNo)}<br>` : ''}${esc(head.date ?? longDay(todayKey()))}</div>
  </div>
  <h1 class="lf-title">${esc(head.title)}</h1>
  <div class="lf-body">${fillBody(body, values, mode)}</div>
</div>`;
}

/** A whole document, ready for html2pdf. */
export function letterDocument(body: string, values: Record<string, string>, head: Letterhead): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(head.title)}</title><style>${LETTER_CSS} body { margin: 0; padding: 24px; background: #fff; }</style></head><body>${letterInner(body, values, head, 'pdf')}</body></html>`;
}

export async function letterPdf(body: string, values: Record<string, string>, head: Letterhead, filename: string): Promise<Blob> {
  return htmlToPdfBlob(letterDocument(body, values, head), filename);
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
