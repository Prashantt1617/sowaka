// Setup › Employee lifecycle › Document templates: the wording of every
// letter (offer, appointment, NDA, confirmation, extension, relieving), one
// default per kind. A body is HTML with {{merge.fields}} that Documents fills
// from the offer, the journey and the employee record.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { ListPending, StatusTabs } from '../../ui';
import { createLetterTemplate, isNotAvailable, listLetterTemplates, updateLetterTemplate } from '../../../services/lifecycle';
import type { LetterKind, LetterTemplateDTO } from '../../../services/lifecycle';
import { Field, NotSwitchedOn } from './shared';
import { LETTER_TEMPLATE_OPEN_KEY, errText, inputStyle, readHandoff, shortDay } from './format';
import { KIND_LABEL, LETTER_KINDS, LETTER_TITLE, fieldLabel, letterInner, placeholders, sanitizeHtml } from './letterDoc';
import { LetterPreview } from './OfferDialogs';
import { useCompanyName } from './hooks';
import '../people.css';

/** The fields each letter usually needs (H3's table); the seeded templates add their own. */
const COMMON: Record<LetterKind, string[]> = {
  offer: ['name', 'firstName', 'designation', 'department', 'manager', 'location', 'joining', 'ctc', 'probation', 'notice', 'valid'],
  appointment: ['name', 'firstName', 'empId', 'designation', 'department', 'manager', 'location', 'joining', 'offerDate', 'ctc', 'probation'],
  nda: ['name', 'firstName', 'designation', 'joining'],
  confirmation: ['name', 'firstName', 'empId', 'designation', 'department', 'manager', 'confirm'],
  extension: ['name', 'firstName', 'empId', 'designation', 'extendMonths', 'probationEndsOn'],
  relieving: ['name', 'empId', 'designation', 'joining', 'lastDay'],
};
const SAMPLE: Record<string, string> = {
  name: 'Kabir Mehta', firstName: 'Kabir', empId: 'EMP-318', designation: 'Product Designer', department: 'Design', manager: 'Neha R.',
  location: 'Main Campus, New Delhi', joining: 'Mon 1 Dec 2026', ctc: '₹14,00,000', probation: '6 months', notice: '60 days', valid: 'Fri 28 Nov 2026',
  offerDate: 'Thu 13 Nov 2026', confirm: 'Tue 1 Jun 2027', lastDay: 'Fri 30 Jan 2027', extendMonths: '2 months', probationEndsOn: 'Sun 1 Aug 2027',
};

export function LetterTemplates() {
  const { flash } = useStore();
  const company = useCompanyName();
  const [openId] = useState(() => readHandoff(LETTER_TEMPLATE_OPEN_KEY));
  const [all, setAll] = useState<LetterTemplateDTO[] | null>(null);
  const [error, setError] = useState('');
  const [off, setOff] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [kind, setKind] = useState<LetterKind>('offer');
  const [editing, setEditing] = useState<LetterTemplateDTO | 'new' | null>(null);

  useEffect(() => {
    let live = true;
    setError('');
    listLetterTemplates().then((t) => {
      if (!live) return;
      setAll(t);
      const open = openId ? t.find((x) => x.id === openId) : undefined;
      if (open) { setKind(open.kind); setEditing(open); }
    }).catch((e) => { if (!live) return; if (isNotAvailable(e)) setOff(true); else setError(errText(e, 'Could not load the document templates')); });
    return () => { live = false; };
  }, [attempt, openId]);

  if (off) return <NotSwitchedOn />;
  const rows = all?.filter((t) => t.kind === kind) ?? null;
  const counts = Object.fromEntries(LETTER_KINDS.map((k) => [k, all?.filter((t) => t.kind === k).length])) as Partial<Record<LetterKind, number>>;

  if (editing) {
    const fields = [...new Set([...COMMON[kind], ...(all ?? []).filter((t) => t.kind === kind).flatMap((t) => placeholders(t.body))])];
    return (
      <TemplateEditor key={editing === 'new' ? 'new' : editing.id} kind={kind} template={editing === 'new' ? null : editing} fields={fields} company={company}
        onBack={() => setEditing(null)}
        onSaved={(t) => { flash(`${t.name} saved`); setEditing(null); setAttempt((n) => n + 1); }} />
    );
  }

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div className="pd-head">
        <p className="pd-lead">The wording of every letter. Documents fills the highlighted fields from the offer and the employee record; the default for each letter is the one it starts with.</p>
        <button type="button" className="pd-btn primary" onClick={() => setEditing('new')} disabled={!all}>+ New template</button>
      </div>
      <div style={{ marginBottom: 16 }}>
        <StatusTabs<LetterKind> options={LETTER_KINDS} active={kind} onSelect={setKind} labels={KIND_LABEL} counts={counts} />
      </div>
      <section className="pd-card">
        <table className="pd-t">
          <thead><tr><th style={{ textAlign: 'left' }}>Template</th><th style={{ textAlign: 'left', width: 220 }}>Fields</th><th style={{ textAlign: 'left', width: 160 }}>Last changed</th></tr></thead>
          <tbody>
            {rows?.map((t) => (
              <tr key={t.id} className="pd-click" onClick={() => setEditing(t)}>
                <td><b style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{t.name}{t.isDefault && <span style={defaultPill}>Default</span>}</b></td>
                <td className="muted">{placeholders(t.body).length} fields</td>
                <td className="muted">{t.updatedAt ? shortDay(t.updatedAt) : '—'}</td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan={3} className="pd-empty">No {KIND_LABEL[kind].toLowerCase()} template yet. Create one; Documents and the offer use the default.</td></tr>}
            {!rows && <tr><td colSpan={3} style={{ padding: 0 }}><ListPending state={error ? 'error' : 'loading'} errorText={error} onRetry={() => setAttempt((n) => n + 1)} rows={3} cols={3} avatar={false} rowHeight={52} /></td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** A sample value for a field, by what it means (its label), so `candidateName` and `name` read the same. */
const SAMPLE_BY_LABEL: Record<string, string> = {
  'Full name': 'Kabir Mehta', 'First name': 'Kabir', 'Employee ID': 'EMP-318', Designation: 'Product Designer', Department: 'Design',
  'Reporting manager': 'Neha Rao', 'Work location': 'Main Campus, New Delhi', 'Joining date': 'Mon 1 Dec 2026', 'Yearly CTC': '₹14,00,000',
  'CTC in words': 'Fourteen lakh rupees', Probation: '6 months', 'Notice period': '60 days', 'Offer valid till': 'Fri 28 Nov 2026',
  'Offer accepted on': 'Thu 13 Nov 2026', 'Confirmed from': 'Tue 1 Jun 2027', 'Last working day': 'Fri 30 Jan 2027', 'Extended by': '2 months',
  'Probation now ends': 'Sun 1 Aug 2027', Responsibilities: 'Owning the design of the onboarding app.', 'Employment type': 'Full time',
  'Company address': '4th floor, Sector 44, Gurugram', 'Signed by': 'Ritu Arora', 'Letter date': 'Mon 23 Nov 2026', 'Ref no.': 'OL/2026/012',
};
const sampleOf = (key: string, company: string) => (fieldLabel(key) === 'Company name' ? company || 'Your company' : SAMPLE[key] ?? SAMPLE_BY_LABEL[fieldLabel(key)] ?? fieldLabel(key));

const FIELD_RE = /\{\{\s*([\w.]+)\s*\}\}/g;
const escText = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
/** A field as the editor shows it: a tag with its name that moves and deletes as one piece. */
const pillHtml = (key: string) => `<span class="lt-field" contenteditable="false" data-field="${escText(key)}">${escText(fieldLabel(key))}</span>`;
/** The saved letter (HTML with {{field}}) as the editor shows it. */
const toEditor = (body: string) => sanitizeHtml(body).replace(FIELD_RE, (_, k: string) => pillHtml(k.replace(/^merge\./, '')));
/** The editor's content back to the saved letter: each tag becomes {{field}} again. */
function fromEditor(box: HTMLElement): string {
  const copy = box.cloneNode(true) as HTMLElement;
  copy.querySelectorAll<HTMLElement>('span.lt-field[data-field]').forEach((el) => el.replaceWith(document.createTextNode(`{{${el.dataset.field}}}`)));
  return sanitizeHtml(copy.innerHTML).replace(/&nbsp;/g, ' ').trim();
}

const EDITOR_CSS = `
  .lt-editor { background: #fff; color: #141416; color-scheme: light; border: 1px solid var(--line); border-radius: 10px; padding: 22px 24px; min-height: 420px; max-height: 70vh; overflow-y: auto; outline: none; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
  .lt-editor:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
  .lt-editor p { margin: 0 0 12px; } .lt-editor ul, .lt-editor ol { margin: 0 0 12px; padding-left: 22px; }
  .lt-editor table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; } .lt-editor td, .lt-editor th { border: 1px solid #E9E9EC; padding: 7px 10px; text-align: left; }
  .lt-field { display: inline-block; background: #E5F2FF; color: #0B5CAD; border-radius: 6px; padding: 0 6px; font-weight: 600; font-size: .95em; line-height: 1.5; white-space: nowrap; cursor: default; user-select: all; }
  .lt-tool { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 8px; min-width: 34px; height: 32px; padding: 0 10px; font: inherit; font-size: 13px; cursor: pointer; }
  .lt-tool:hover { background: var(--surface-2); }
  .lt-add { border: 1px dashed var(--line); background: transparent; color: var(--accent-ink, var(--accent)); border-radius: 99px; padding: 5px 12px; font: inherit; font-size: 13px; cursor: pointer; }
  .lt-add:hover { border-style: solid; background: var(--surface-2); }
  .lt-add.on { border-style: solid; color: var(--ink-2); }
`;

function TemplateEditor({ kind, template, fields, company, onBack, onSaved }: { kind: LetterKind; template: LetterTemplateDTO | null; fields: string[]; company: string; onBack: () => void; onSaved: (t: LetterTemplateDTO) => void }) {
  const [name, setName] = useState(template?.name ?? '');
  const [body, setBody] = useState(template?.body ?? '<p>Dear {{firstName}},</p><p></p><p>Warm regards,<br>HR</p>');
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The letter is edited as it reads: filled once when it opens, then read
  // back on every change, so typing never moves the caret.
  const editor = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    const box = editor.current;
    if (!box) return;
    box.innerHTML = toEditor(body);
    const start = fromEditor(box);
    setBody(start);
    setOpened(start);
    // Filled once when the template opens; edits flow out through readBack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const readBack = () => { if (editor.current) setBody(fromEditor(editor.current)); };
  const dirty = !template || name !== template.name || (opened !== null && body !== opened) || isDefault !== template.isDefault;
  const used = placeholders(body);
  const usedLabels = new Set(used.map(fieldLabel));
  // One button per field (several names can mean the same field); the one this letter already uses wins.
  const choices = [...new Map([...used, ...fields].map((k) => [fieldLabel(k), k] as const).reverse()).entries()]
    .map(([label, key]) => ({ label, key: used.find((u) => fieldLabel(u) === label) ?? key }))
    .sort((x, y) => fields.findIndex((f) => fieldLabel(f) === x.label) - fields.findIndex((f) => fieldLabel(f) === y.label));

  /** The caret in the letter, or the end of it when the caret is elsewhere. */
  const caretInLetter = () => {
    const box = editor.current!;
    const sel = window.getSelection();
    const inside = !!sel && sel.rangeCount > 0 && box.contains(sel.getRangeAt(0).commonAncestorContainer);
    box.focus();
    if (!inside && sel) {
      const end = document.createRange();
      end.selectNodeContents(box.lastElementChild ?? box);
      end.collapse(false);
      sel.removeAllRanges();
      sel.addRange(end);
    }
  };
  const addField = (key: string) => {
    if (!editor.current) return;
    caretInLetter();
    if (!document.execCommand('insertHTML', false, `${pillHtml(key)}&nbsp;`)) {
      const range = window.getSelection()?.getRangeAt(0);
      if (range) {
        const holder = document.createElement('span');
        holder.innerHTML = pillHtml(key);
        range.deleteContents();
        range.insertNode(holder.firstChild!);
        range.collapse(false);
      }
    }
    readBack();
  };
  const format = (command: string) => { editor.current?.focus(); document.execCommand(command); readBack(); };
  // Pasted text comes in as plain text, so a letter copied from elsewhere does not bring its styling along.
  const paste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    readBack();
  };
  const save = async () => {
    if (!name.trim()) { setError('Give the template a name'); return; }
    if (!body.replace(/<[^>]+>/g, '').trim()) { setError('Write the letter'); return; }
    setBusy(true); setError('');
    try {
      const input = { kind, name: name.trim(), body, isDefault };
      const t = template ? await updateLetterTemplate(template.id, input) : await createLetterTemplate(input);
      onSaved(t);
    } catch (e) { setError(errText(e, 'Could not save the template')); setBusy(false); }
  };
  const sample = Object.fromEntries([...fields, ...used].map((f) => [f, sampleOf(f, company)]));
  const tools: Array<[string, string, string, React.CSSProperties?]> = [
    ['bold', 'B', 'Bold', { fontWeight: 700 }], ['italic', 'I', 'Italic', { fontStyle: 'italic' }], ['underline', 'U', 'Underline', { textDecoration: 'underline' }],
    ['insertUnorderedList', '• List', 'Bulleted list'], ['insertOrderedList', '1. List', 'Numbered list'],
  ];
  return (
    <div className="pd-form">
      <style>{EDITOR_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button type="button" className="pd-btn ghost sm" style={{ marginLeft: -12 }} onClick={() => { if (!dirty || window.confirm('Leave without saving your changes?')) onBack(); }}>← All templates</button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{KIND_LABEL[kind]} · {template ? template.name : 'new template'}</h2>
        <button type="button" className="pd-btn primary" style={{ marginLeft: 'auto' }} onClick={() => void save()} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save template'}</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section className="pd-card" style={{ flex: '1 1 460px', minWidth: 0, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <Field label="Template name" required error={error && !name.trim() ? error : undefined}>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${company} ${KIND_LABEL[kind].toLowerCase()}`} style={inputStyle} />
              </Field>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 500, cursor: 'pointer', paddingBottom: 10 }}>
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} disabled={template?.isDefault} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
              Use for every new {KIND_LABEL[kind].toLowerCase()}
            </label>
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>The letter</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 10 }}>Write it as it should read. The <span className="lt-field" style={{ fontSize: 12 }}>blue tags</span> are filled in for each person; the letterhead, title and date are added above it.</div>
            <div role="toolbar" aria-label="Formatting" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {tools.map(([cmd, text, label, style]) => (
                <button key={cmd} type="button" className="lt-tool" title={label} aria-label={label} style={style} onMouseDown={(e) => e.preventDefault()} onClick={() => format(cmd)}>{text}</button>
              ))}
            </div>
            <div ref={editor} role="textbox" aria-multiline="true" aria-label="The letter" contentEditable suppressContentEditableWarning className="lt-editor"
              onInput={readBack} onBlur={readBack} onPaste={paste} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>Add a field</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 8 }}>Click where it should go in the letter, then pick the detail. Ticked ones are already in the letter.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {choices.map(({ label, key }) => (
                <button key={label} type="button" className={`lt-add${usedLabels.has(label) ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => addField(key)}>
                  {usedLabels.has(label) ? '✓ ' : '+ '}{label}
                </button>
              ))}
            </div>
          </div>
          {error && name.trim() && <div role="alert" style={{ color: 'var(--bad)' }}>{error}</div>}
        </section>
        <section className="pd-card" style={{ flex: '1 1 420px', minWidth: 0, position: 'sticky', top: 16 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>How it reads</h3>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 12 }}>With sample details in place of the tags.</div>
          <LetterPreview html={letterInner(body, sample, { company, title: LETTER_TITLE[kind] }, 'preview')} caption={false} />
        </section>
      </div>
    </div>
  );
}

const defaultPill = { display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: '#fff', background: 'var(--p-blue)', borderRadius: 99, padding: '3px 10px' } as const;
