// The pieces Documents' two workbenches share (H3, H3b, H3c): the Details
// card's head and source note, the letter preview card, the "Email this letter"
// card under the details, the full email panel, and the letters made before.
import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../../store';
import { DrawerShell, CloseButton } from '../../drawers/shell';
import { PageActions, Spinner } from '../../ui';
import { IconDownload, IconInfo } from '../../icons';
import { uploadLetterAttachment } from '../../../services/lifecycle';
import type { AttachmentKind, LetterAttachment, LetterEmail, LetterKind, LetterView } from '../../../services/lifecycle';
import { Field, Switch } from './shared';
import { areaStyle, errText, inputStyle, shortDay } from './format';
import { KIND_LABEL, LETTER_CSS, emailDraft, letterFileName } from './letterDoc';

export type Person = { key: string; journeyId?: string; userId?: string; name: string; sub: string; managerUserId?: string; email?: string };
export type MailOut = { to: string; cc?: string[]; subject: string; body: string; withPortalLink?: boolean; attachments?: LetterAttachment[] };

/** The company's mark as an absolute URL, so html2pdf can draw it in the PDF too. */
export const logoSrc = (logo?: string) => {
  if (!logo) return undefined;
  try { return new URL(logo, window.location.origin).href; } catch { return undefined; }
};

/** A field the letter needs that is still empty: a soft red edge, as the design's missing field. */
export const missingInput: CSSProperties = { border: '1px solid var(--bad-line)', background: 'var(--surface-2)' };
export const NEEDED = 'Needed for this letter';
/** Merge fields the system fills on its own (company, date, reference, signatory): shown as a field only while empty. */
export const AUTO_KEYS = new Set(['companyName', 'company', 'companyAddress', 'letterDate', 'date', 'refNo', 'hrName', 'signatory', 'firstName', 'ctcWords', 'offerDate']);

const MailIcon = ({ size = 15, stroke = 'currentColor' }: { size?: number; stroke?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 5h18v14H3zM3 7l9 6 9-6" /></svg>
);

/** Save draft, Draft email and Generate PDF, in the page head beside the title. */
export function DocActions({ onSave, saving, canSave, onMail, canMail, onGenerate, generating, generated, missing, disabled }: {
  onSave?: () => void; saving: boolean; canSave: boolean; onMail: () => void; canMail: boolean;
  onGenerate: () => void; generating: boolean; generated: boolean; missing: number; disabled: boolean;
}) {
  return (
    <PageActions>
      {onSave && <button type="button" className="pd-btn" onClick={onSave} disabled={disabled || !canSave}>{saving ? 'Saving…' : 'Save draft'}</button>}
      <button type="button" className="pd-btn" onClick={onMail} disabled={!canMail}><MailIcon />Draft email</button>
      <button type="button" className="pd-btn primary" onClick={onGenerate} disabled={disabled || missing > 0 || generated} aria-disabled={missing > 0}
        title={missing ? 'Fill the missing details first' : undefined}><IconDownload stroke="currentColor" />{generating ? 'Generating…' : generated ? 'PDF generated' : 'Generate PDF'}</button>
    </PageActions>
  );
}

/** "Details" and how many fields the letter still needs. */
export function DetailsHead({ missing, ready }: { missing: number; ready: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, flex: 1 }}>Details</h2>
      {ready && <span style={{ fontSize: 12, fontWeight: 500, color: missing ? 'var(--bad)' : 'var(--ok)' }}>{missing ? `${missing} field${missing === 1 ? '' : 's'} missing` : 'All details filled'}</span>}
    </div>
  );
}

/** Where the details come from, in the info box under the picker. */
export function SourceNote({ children }: { children: ReactNode }) {
  return <div className="pd-note" style={{ padding: '10px 12px', fontSize: 12.5 }}><IconInfo size={15} stroke="var(--accent-ink)" /><span>{children}</span></div>;
}

/** The two details columns (one on a narrow screen). */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="lf-doc-fields">{children}</div>;
}

/** The preview: the letter on a white page, inside a grey card with the template's name and Edit template. */
export function PreviewCard({ templateName, onEdit, html, loading }: { templateName?: string; onEdit?: () => void; html: string; loading: boolean }) {
  return (
    <section className="pd-card" style={{ padding: 16, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 4px', minHeight: 24 }}>
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)', minWidth: 0 }}>Preview · <b style={{ fontWeight: 500, color: 'var(--ink)' }}>{templateName ?? '…'}</b></span>
        {onEdit && <button type="button" onClick={onEdit} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontSize: 12.5, color: 'var(--accent-ink)', cursor: 'pointer' }}>Edit template</button>}
      </div>
      {loading ? (
        <div style={{ background: '#fff', borderRadius: 6, minHeight: 420, display: 'grid', placeItems: 'center' }}><Spinner label="Filling in the letter…" /></div>
      ) : (
        <>
          <style>{LETTER_CSS}</style>
          <div role="document" aria-label="Letter preview" className="lf-doc-page" dangerouslySetInnerHTML={{ __html: html }} />
        </>
      )}
      <span style={{ fontSize: 12, color: 'var(--ink-3)', padding: '0 4px' }}>Highlighted text comes from the details on the left. Orange means it is still missing.</span>
    </section>
  );
}

/** "Letters for Kabir": what was made for them before, with View. */
export function EarlierLetters({ earlier, first, name, onView }: { earlier: LetterView[]; first: string; name: string; onView: (fileId: string, fileName: string) => void }) {
  if (!earlier.length) return null;
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-2)', margin: '4px 0 6px' }}>Letters for {first}</div>
      <div className="pd-list">
        {earlier.map((l) => {
          const f = l.signedPdfFileId ?? l.pdfFileId;
          return (
            <div key={l.id} className="pd-li">
              <span className="grow"><b>{KIND_LABEL[l.kind]}{l.refNo ? ` · ${l.refNo}` : ''}</b><span className="s">{l.state}{l.signedAt ? ` ${shortDay(l.signedAt)}` : l.sentAt ? ` · sent ${shortDay(l.sentAt)}` : ''}</span></span>
              {f && <button type="button" className="pd-btn sm" onClick={() => onView(f, letterFileName(l.kind, name))}>View</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * H3's "Email this letter to …" card under the details: the recipient (their personal email,
 * editable), a short message and Send, through the same send as the full email panel. A saved
 * draft fills it; the card's head and Edit full email open the panel (subject, Cc, attachments).
 */
export function EmailCard({ kind, first, to: toStart, toFixed, values, company, hrName, manager, draft, missing, busy, onSend, onOpen }: {
  kind: LetterKind; first: string; to: string; values: Record<string, string>; company: string; hrName: string;
  /** The offer goes to the personal email on the offer (read-only here). */
  toFixed?: boolean;
  manager?: { name: string; email: string }; draft?: LetterEmail; missing: number; busy: string;
  onSend: (mail: MailOut) => Promise<boolean>; onOpen: () => void;
}) {
  const isOffer = kind === 'offer';
  const portalLink = isOffer || kind === 'appointment' || kind === 'nda';
  const withLink = draft?.withPortalLink ?? true;
  const start = emailDraft(kind, values, { company, hrName, withLink });
  // Untouched, they follow the details as they load and change; typed, they are HR's own.
  const [toTyped, setTo] = useState<string | null>(null);
  const [noteTyped, setNote] = useState<string | null>(null);
  const [error, setError] = useState('');
  const to = toFixed ? toStart : toTyped ?? (draft?.to || toStart);
  const note = noteTyped ?? (draft?.body || start.body);
  const cc = draft ? draft.cc : manager?.email ? [manager.email] : undefined;
  const ccName = !cc?.length ? '' : manager?.email && cc.some((x) => x.toLowerCase() === manager.email.toLowerCase()) ? manager.name : cc.join(', ');
  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(to.trim())) { setError(toFixed ? 'Add their personal email first' : 'Enter who it goes to'); return; }
    if (!note.trim()) { setError('Write a short message'); return; }
    setError('');
    const sent = await onSend({
      to: to.trim(), cc, subject: draft?.subject || start.subject, body: note,
      withPortalLink: portalLink ? withLink : undefined, attachments: draft?.attachments?.length ? draft.attachments : undefined,
    });
    if (sent) { setTo(null); setNote(null); }
  };
  return (
    <div style={{ border: '1px dashed var(--line-2)', borderRadius: 14, background: 'var(--surface-2)', padding: '12px 14px', display: 'grid', gap: 12 }}>
      <button type="button" onClick={onOpen} disabled={Boolean(busy)} aria-label={`Email this letter to ${first || 'them'}: open the full email`}
        style={{ border: 0, background: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', font: 'inherit', color: 'var(--ink)', cursor: 'pointer' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface)', display: 'grid', placeItems: 'center', flex: 'none' }}><MailIcon size={16} stroke="var(--accent-ink)" /></span>
        <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
          <b style={{ fontWeight: 500, fontSize: 13 }}>Email this letter to {first || 'them'}</b>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {draft?.savedAt ? `Your draft from ${shortDay(draft.savedAt)}. ` : ''}Opens a draft with the PDF attached{portalLink && withLink ? ' and the portal link' : ''}{ccName ? `; ${ccName} is copied` : ''}
          </span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
      </button>
      <Field label="To" hint={toFixed ? 'Their personal email from the offer.' : 'Their personal email. Change it if it should go elsewhere.'}>
        {toFixed ? <input value={to} readOnly aria-label="To" placeholder="Their personal email" style={{ ...inputStyle, color: 'var(--ink-2)' }} />
          : <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" aria-label="To" style={inputStyle} />}
      </Field>
      <Field label="Message"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} style={areaStyle} /></Field>
      {missing > 0 && <div style={{ fontSize: 12, color: 'var(--bad)' }}>Fill the missing details first: the PDF is made when you send.</div>}
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--bad)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="pd-btn sm" onClick={onOpen} disabled={Boolean(busy)}>Edit full email</button>
        <button type="button" className="pd-btn primary sm" onClick={() => void send()} disabled={Boolean(busy) || missing > 0}>
          {busy === 'send' ? 'Sending…' : busy === 'pdf' ? 'Generating…' : busy === 'draft' ? 'Saving…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
type Suggestion = { kind: AttachmentKind; title: string; sub: string };

export function MailPanel({ kind, values, name, to: toStart, manager, company, hrName, missing, pdfReady, fileName, busy, draft, annexInLetter, journeyId, canBreakup, canChecklist, makeExtra, onPreview, onSaveDraft, onClose, onSend }: {
  kind: LetterKind; values: Record<string, string>; name: string; to: string; manager?: { name: string; email: string };
  company: string; hrName: string; missing: number; pdfReady: boolean; fileName: string; busy: string;
  /** HR's saved draft of this email, if any (it opens instead of the template's words). */
  draft?: LetterEmail;
  annexInLetter: boolean; journeyId?: string; canBreakup: boolean; canChecklist: boolean;
  makeExtra: (which: 'salary_breakup' | 'joining_checklist') => Promise<{ blob: Blob; name: string } | null>;
  onPreview: () => void; onSaveDraft: (mail: MailOut) => void; onClose: () => void;
  onSend: (mail: MailOut) => Promise<void>;
}) {
  const { flash } = useStore();
  const isOffer = kind === 'offer';
  // The offer's link is how they accept: on by default, with a switch (6Zs H3c). Appointment / NDA: their portal, where they sign.
  const portalSwitch = isOffer || kind === 'appointment' || kind === 'nda';
  const [withLink, setWithLink] = useState(draft?.withPortalLink ?? true);
  const start = emailDraft(kind, values, { company, hrName, withLink });
  const [to, setTo] = useState(draft?.to || toStart);
  const [ccManager, setCcManager] = useState(draft ? Boolean(manager?.email && draft.cc?.includes(manager.email.toLowerCase())) : Boolean(manager?.email));
  const [subject, setSubject] = useState(draft?.subject || start.subject);
  const [body, setBody] = useState(draft?.body || start.body);
  const [edited, setEdited] = useState(Boolean(draft?.body));
  const [extras, setExtras] = useState<LetterAttachment[]>(draft?.attachments ?? []);
  const [adding, setAdding] = useState<AttachmentKind | ''>('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const flip = (v: boolean) => {
    setWithLink(v);
    if (!edited) setBody(emailDraft(kind, values, { company, hrName, withLink: v }).body);
  };
  const mail = (): MailOut => ({
    to: to.trim(), cc: ccManager && manager?.email ? [manager.email] : undefined, subject: subject.trim(), body,
    withPortalLink: portalSwitch ? withLink : undefined, attachments: extras.length ? extras : undefined,
  });
  const send = () => {
    if (!isOffer && !/^\S+@\S+\.\S+$/.test(to.trim())) { setError('Enter who it goes to'); return; }
    if (!subject.trim() || !body.trim()) { setError('Write a subject and a message'); return; }
    setError('');
    void onSend(mail());
  };
  const suggestions: Suggestion[] = [
    ...(canBreakup ? [{ kind: 'salary_breakup' as const, title: 'Salary breakup (Annexure A)', sub: annexInLetter ? '1 page · also the letter’s last page' : '1 page · from the offer' }] : []),
    ...(canChecklist ? [{ kind: 'joining_checklist' as const, title: 'Joining checklist', sub: '1 page · documents to keep ready' }] : []),
    ...(!isOffer ? [{ kind: 'policies' as const, title: 'Company policies', sub: 'The handbook · a PDF from your computer' }] : []),
  ].filter((x) => !extras.some((e) => e.kind === x.kind));
  const upload = async (blob: Blob, filename: string, k: AttachmentKind) => {
    const r = await uploadLetterAttachment(blob, filename, k, journeyId);
    setExtras((list) => [...list, r.attachment]);
  };
  const attach = async (sg: Suggestion) => {
    if (sg.kind === 'policies') { fileInput.current?.click(); return; }
    setAdding(sg.kind);
    try {
      const made = await makeExtra(sg.kind as 'salary_breakup' | 'joining_checklist');
      if (!made) { flash('That can’t be made yet', 'error'); return; }
      await upload(made.blob, made.name, sg.kind);
    } catch (e) { flash(errText(e, 'Could not attach it'), 'error'); } finally { setAdding(''); }
  };
  const chip = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 99, background: 'var(--surface-2)', border: '1px solid var(--line)', fontSize: 12.5, maxWidth: '100%', overflowWrap: 'anywhere' } as const;
  return (
    <DrawerShell width={460} onClose={onClose}>
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--line)' }}>
        <h2 style={{ margin: 0, flex: 1, fontSize: 16, fontWeight: 600 }}>New email</h2>
        <CloseButton onClose={onClose} />
      </div>
      <div className="pd-form" style={{ padding: 20, display: 'grid', gap: 12, fontSize: 13 }}>
        {draft?.savedAt && <div className="pd-note">Your draft from {shortDay(draft.savedAt)}.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'var(--ink-3)' }}>From</span><span><span style={chip}>HR · {hrName}</span></span>
          <span style={{ color: 'var(--ink-3)' }}>To</span>
          {isOffer ? <span><span style={chip}>{name}{toStart ? ` · ${toStart}` : ''}</span></span>
            : <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" aria-label="To" style={inputStyle} />}
          {manager?.email && <>
            <span style={{ color: 'var(--ink-3)' }}>Cc</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Switch on={ccManager} onChange={setCcManager} label={`Copy ${manager.name}`} /><span style={chip}>{manager.name} (manager)</span></label>
          </>}
        </div>
        {kind === 'relieving' && values.personalEmail && to.trim().toLowerCase() === values.personalEmail.toLowerCase() && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: -4 }}>Their personal email: the work email closes when they leave.</div>}
        <Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} /></Field>
        <Field label="Email body"><textarea value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} style={{ ...areaStyle, minHeight: 240 }} /></Field>
        {portalSwitch && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Switch on={withLink} onChange={flip} label="Add the portal link" />
            <span><b style={{ display: 'block', fontWeight: 500 }}>Add the portal link</b><span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{isOffer ? 'A “View and accept your offer” button in the email' : 'A button to open their joining portal, where they sign it'}</span></span>
          </label>
        )}
        {isOffer && !withLink && <div className="pd-note" style={{ color: 'var(--warn)' }}>Without the link they can’t read and accept the offer online. Send it again with the link if they ask.</div>}
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 6 }}>Attachments</div>
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="pd-li" style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '10px 12px' }}>
              <span className="pd-li-i" aria-hidden style={{ fontSize: 10, fontWeight: 600 }}>PDF</span>
              <span className="grow"><b style={{ overflowWrap: 'anywhere' }}>{fileName}</b><span className="s">{pdfReady ? `Generated from the details${annexInLetter ? ', with Annexure A' : ''}` : missing ? 'Not generated yet' : 'Generated when you send'}</span></span>
              {pdfReady && <button type="button" className="pd-btn sm" onClick={onPreview}>Preview</button>}
            </div>
            {extras.map((x) => (
              <div key={x.fileId} className="pd-li" style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '10px 12px' }}>
                <span className="pd-li-i" aria-hidden style={{ fontSize: 10, fontWeight: 600 }}>PDF</span>
                <span className="grow"><b style={{ overflowWrap: 'anywhere' }}>{x.name}</b><span className="s">Attached</span></span>
                <button type="button" className="pd-btn sm ghost" onClick={() => setExtras((list) => list.filter((e) => e.fileId !== x.fileId))}>Remove</button>
              </div>
            ))}
            {suggestions.map((sg) => (
              <div key={sg.kind} className="pd-li" style={{ border: '1px dashed var(--line-2)', borderRadius: 14, padding: '10px 12px' }}>
                <span className="grow"><b style={{ overflowWrap: 'anywhere' }}><span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>Suggested · </span>{sg.title}</b><span className="s">{sg.sub}</span></span>
                <button type="button" className="pd-btn sm" onClick={() => void attach(sg)} disabled={Boolean(adding) || Boolean(busy)}>{adding === sg.kind ? 'Attaching…' : 'Attach'}</button>
              </div>
            ))}
            <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setAdding('policies');
              upload(f, f.name, 'policies').catch((err) => flash(errText(err, 'Could not attach it'), 'error')).finally(() => setAdding(''));
            }} />
          </div>
        </div>
        {missing > 0 && <div className="pd-note" style={{ color: 'var(--bad)' }}>The letter can’t be attached yet: fill the missing details first.</div>}
        {error && <div role="alert" style={{ color: 'var(--bad)' }}>{error}</div>}
      </div>
      <div style={{ marginTop: 'auto', position: 'sticky', bottom: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)', padding: '14px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="pd-btn" onClick={() => onSaveDraft(mail())} disabled={Boolean(busy) || Boolean(adding)}>{busy === 'draft' ? 'Saving…' : 'Save draft'}</button>
        <button type="button" className="pd-btn primary" onClick={send} disabled={Boolean(busy) || Boolean(adding) || missing > 0}>{busy === 'send' ? 'Sending…' : busy === 'pdf' ? 'Generating…' : 'Send email'}</button>
      </div>
    </DrawerShell>
  );
}
