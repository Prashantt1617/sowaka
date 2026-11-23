// The Confirmed step's confirmation letter: "Generate confirmation letter" makes it in the browser
// from the company's confirmation letter template (as Documents does: merge values from the server,
// the letter row, html2pdf, the PDF uploaded), stamped "Confirmed on <decision date>", then the server
// sends it to the employee's work email and keeps it as the journey's confirmation letter. Once sent:
// where and when, View, Download and Resend.
import { useBrand } from '../../brand';
import {
  createLetter, fetchLifecycleFile, getMergeValues, listLetterTemplates, sendConfirmationLetter, uploadLetterPdf,
} from '../../../services/lifecycle';
import type { ConfirmationDecision, LetterView } from '../../../services/lifecycle';
import { downloadFile, logoSrc } from './DocumentParts';
import { errText, longDay } from './format';
import { useCompanyName } from './hooks';
import { LETTER_TITLE, fieldLabel, letterFileName, letterPdf, missingFields, withConfirmedStamp } from './letterDoc';

/** The sent confirmation letter: the decision's own, else the newest one sent. */
function sentConfirmationLetter(letters: LetterView[], decision?: ConfirmationDecision): LetterView | undefined {
  const own = decision?.letterId ? letters.find((l) => l.id === decision.letterId && l.kind === 'confirmation' && l.sentAt) : undefined;
  return own ?? [...letters].filter((l) => l.kind === 'confirmation' && l.sentAt).sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))[0];
}

export function ConfirmationLetter({ journeyId, name, letters, decision, busy, setBusy, flash, onChanged, onView }: {
  journeyId: string; name: string; letters: LetterView[]; decision?: ConfirmationDecision;
  busy: string; setBusy: (key: string) => void; flash: (m: string, tone?: 'ok' | 'error') => void; onChanged: () => void;
  onView: (fileId: string, name: string) => void;
}) {
  const company = useCompanyName();
  const logo = useBrand().icon;
  const sent = sentConfirmationLetter(letters, decision);
  const fileName = letterFileName('confirmation', name);

  /** Makes the letter from the default confirmation template, uploads its PDF, and sends it to the work email. */
  const generate = async () => {
    setBusy('confirmation');
    try {
      const templates = await listLetterTemplates('confirmation');
      const template = templates.find((t) => t.isDefault) ?? templates[0];
      if (!template) throw new Error('There is no confirmation letter template yet. Add one in Setup › Employee lifecycle › Document templates.');
      const { values, missing: serverMissing } = await getMergeValues({ kind: 'confirmation', journeyId });
      const body = withConfirmedStamp(template.body);
      const missing = missingFields(body, values, serverMissing);
      if (missing.length) throw new Error(`The letter is missing ${missing.map(fieldLabel).join(', ')}. Fill ${missing.length === 1 ? 'it' : 'them'} in on the employee’s profile, or make the letter in Documents.`);
      const letter = await createLetter({ kind: 'confirmation', journeyId, templateId: template.id, values });
      const head = { company: values.companyName || company, address: values.companyAddress, refNo: letter.refNo, title: LETTER_TITLE.confirmation, date: values.letterDate || undefined, logo: logoSrc(logo) };
      const blob = await letterPdf(body, values, head, fileName);
      await uploadLetterPdf(letter.id, blob, fileName);
      const r = await sendConfirmationLetter(letter.id);
      flash(`Confirmation letter sent to ${r.sentTo}`);
      onChanged();
    } catch (e) { flash(errText(e, 'Could not make the confirmation letter'), 'error'); } finally { setBusy(''); }
  };
  const resend = async () => {
    if (!sent) return;
    setBusy('confirmation');
    try { const r = await sendConfirmationLetter(sent.id); flash(`Confirmation letter sent again to ${r.sentTo}`); onChanged(); } catch (e) { flash(errText(e, 'Could not send the letter'), 'error'); } finally { setBusy(''); }
  };
  const download = async () => {
    if (!sent?.pdfFileId) return;
    setBusy('confirmation-pdf');
    try { downloadFile(await fetchLifecycleFile(sent.pdfFileId), fileName); } catch (e) { flash(errText(e, 'Could not download the letter'), 'error'); } finally { setBusy(''); }
  };

  if (!sent) {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>Makes the confirmation letter from your template, stamped with the confirmation date{decision?.decidedAt ? ` (${longDay(decision.decidedAt)})` : ''}, and emails it to their work email.</div>
        <span><button type="button" className="pd-btn sm primary" disabled={Boolean(busy)} onClick={() => void generate()}>{busy === 'confirmation' ? 'Making the letter…' : 'Generate confirmation letter'}</button></span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12, flexWrap: 'wrap' }}>
      <span aria-hidden style={{ width: 32, height: 40, borderRadius: 8, background: 'var(--ok-bg)', color: 'var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 600, flex: 'none' }}>PDF</span>
      <span style={{ flex: 1, minWidth: 160, display: 'grid', gap: 2 }}>
        <b style={{ fontSize: 12.5, fontWeight: 500 }}>Confirmation letter{sent.refNo ? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {sent.refNo}</span> : null}</b>
        <span style={{ fontSize: 11.5, color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>Sent{sent.sentTo ? ` to ${sent.sentTo}` : ''} on {longDay(sent.sentAt)}</span>
      </span>
      <span style={{ display: 'flex', gap: 6 }}>
        {sent.pdfFileId && <button type="button" className="pd-btn sm" onClick={() => onView(sent.pdfFileId!, fileName)}>View</button>}
        {sent.pdfFileId && <button type="button" className="pd-btn sm" disabled={busy === 'confirmation-pdf'} onClick={() => void download()}>Download</button>}
        <button type="button" className="pd-btn sm ghost" disabled={Boolean(busy)} onClick={() => void resend()}>{busy === 'confirmation' ? 'Sending…' : 'Resend'}</button>
      </span>
    </div>
  );
}
