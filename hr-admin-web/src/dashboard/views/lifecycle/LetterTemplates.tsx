// Setup › Employee lifecycle › Document templates: the wording of every
// letter (offer, appointment, NDA, confirmation, extension, relieving), one
// default per kind. A body is HTML with {{merge.fields}} that Documents fills
// from the offer, the journey and the employee record.
import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { ListPending, StatusTabs } from '../../ui';
import { createLetterTemplate, isNotAvailable, listLetterTemplates, updateLetterTemplate } from '../../../services/lifecycle';
import type { LetterKind, LetterTemplateDTO } from '../../../services/lifecycle';
import { Field, NotSwitchedOn } from './shared';
import { LETTER_TEMPLATE_OPEN_KEY, areaStyle, errText, inputStyle, readHandoff, shortDay } from './format';
import { KIND_LABEL, LETTER_KINDS, LETTER_TITLE, fieldLabel, letterInner, placeholders } from './letterDoc';
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

function TemplateEditor({ kind, template, fields, company, onBack, onSaved }: { kind: LetterKind; template: LetterTemplateDTO | null; fields: string[]; company: string; onBack: () => void; onSaved: (t: LetterTemplateDTO) => void }) {
  const [name, setName] = useState(template?.name ?? '');
  const [body, setBody] = useState(template?.body ?? '<p>Dear {{firstName}},</p>\n<p></p>\n<p>Warm regards,<br>HR</p>');
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [area, setArea] = useState<HTMLTextAreaElement | null>(null);
  const dirty = !template || name !== template.name || body !== template.body || isDefault !== template.isDefault;
  const used = placeholders(body);
  const insert = (key: string) => {
    const tag = `{{${key}}}`;
    if (!area) { setBody((b) => b + tag); return; }
    const { selectionStart: a, selectionEnd: b } = area;
    const next = body.slice(0, a) + tag + body.slice(b);
    setBody(next);
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(a + tag.length, a + tag.length); });
  };
  const save = async () => {
    if (!name.trim()) { setError('Give the template a name'); return; }
    if (!body.trim()) { setError('Write the letter'); return; }
    setBusy(true); setError('');
    try {
      const input = { kind, name: name.trim(), body, isDefault };
      const t = template ? await updateLetterTemplate(template.id, input) : await createLetterTemplate(input);
      onSaved(t);
    } catch (e) { setError(errText(e, 'Could not save the template')); setBusy(false); }
  };
  const sample = Object.fromEntries(fields.map((f) => [f, SAMPLE[f] ?? fieldLabel(f)]));
  return (
    <div className="pd-form">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button type="button" className="pd-btn ghost sm" style={{ marginLeft: -12 }} onClick={() => { if (!dirty || window.confirm('Leave without saving your changes?')) onBack(); }}>← All templates</button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{KIND_LABEL[kind]} · {template ? template.name : 'new template'}</h2>
        <button type="button" className="pd-btn primary" style={{ marginLeft: 'auto' }} onClick={() => void save()} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save template'}</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section className="pd-card" style={{ flex: '1 1 420px', minWidth: 0, display: 'grid', gap: 12 }}>
          <Field label="Template name" required error={error && !name.trim() ? error : undefined}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${company} ${KIND_LABEL[kind].toLowerCase()}`} style={inputStyle} />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 500, cursor: 'pointer' }}>
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} disabled={template?.isDefault} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
            The default {KIND_LABEL[kind].toLowerCase()}
          </label>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 6 }}>Insert a field</div>
            <div className="pd-chips">
              {fields.map((f) => <button key={f} type="button" className={`pd-chip sm${used.includes(f) ? ' on' : ''}`} onClick={() => insert(f)} title={`{{${f}}}`}>{fieldLabel(f)}</button>)}
            </div>
          </div>
          <Field label="Letter" hint="HTML. A field is written {{name}}; the letterhead, reference and date are added above it.">
            <textarea ref={setArea} value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} style={{ ...areaStyle, minHeight: 360, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 }} />
          </Field>
          {error && name.trim() && <div role="alert" style={{ color: 'var(--bad)' }}>{error}</div>}
        </section>
        <section className="pd-card" style={{ flex: '1 1 420px', minWidth: 0 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Preview · with sample details</h3>
          <LetterPreview html={letterInner(body, sample, { company, title: LETTER_TITLE[kind], refNo: 'REF/2026/001' }, 'preview')} caption={false} />
        </section>
      </div>
    </div>
  );
}

const defaultPill = { display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: '#fff', background: 'var(--p-blue)', borderRadius: 99, padding: '3px 10px' } as const;
