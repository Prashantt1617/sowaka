// H3 · Documents: pick a letter and a person. The details come from their
// offer, journey and record; fill anything missing on the left and check the
// letter on the right (filled values blue, missing orange). Generate PDF waits
// until nothing is missing, makes the PDF in the browser and uploads it; Draft
// email (H3c) opens the email with the PDF attached. The offer letter goes
// through the offer itself (its PDF and its email carry the portal link).
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { canOpen, canSeePay } from '../../access';
import { DrawerShell, CloseButton } from '../../drawers/shell';
import { LoadError, PageActions, SkeletonLines, Spinner, StatusTabs } from '../../ui';
import {
  createLetter, getBoard, getJourney, getMergeValues, isNotAvailable, listLetterTemplates, listLetters, sendLetter, sendOffer, uploadLetterPdf, uploadOfferPdf,
} from '../../../services/lifecycle';
import type { BoardCard, BoardTab, LetterKind, LetterTemplateDTO, LetterView } from '../../../services/lifecycle';
import { BlobPreview, FilePreview, Field, NotSwitchedOn, Pick, Switch } from './shared';
import { DOCS_OPEN_KEY, LETTER_TEMPLATE_OPEN_KEY, areaStyle, errText, firstName, inputStyle, readHandoff, shortDay } from './format';
import { KIND_LABEL, LETTER_KINDS, LETTER_TITLE, emailDraft, fieldLabel, filled, letterFileName, letterInner, letterPdf, missingFields, placeholders, valueName } from './letterDoc';
import { LetterPreview } from './OfferDialogs';
import { useCompanyName } from './hooks';
import '../people.css';

type Person = { key: string; journeyId?: string; userId?: string; name: string; sub: string; managerUserId?: string; email?: string };
const PAY_FIELD = /ctc|salary|pay/i;
const SOURCE: Record<LetterKind, (first: string) => string> = {
  offer: (f) => `Filled from the offer HR created for ${f}. Edit here or in the offer.`,
  appointment: (f) => `Filled from ${f}’s accepted offer and their record. Generated once all documents are approved.`,
  nda: (f) => `Filled from ${f}’s accepted offer and their record.`,
  confirmation: (f) => `Filled from ${f}’s record and the confirmation discussion.`,
  extension: (f) => `Filled from ${f}’s record and the confirmation discussion.`,
  relieving: (f) => `Filled from ${f}’s record. Add the last working day from their exit.`,
};
const TABS_FOR: Record<LetterKind, BoardTab[]> = {
  offer: ['pre_boarding'], appointment: ['pre_boarding', 'first_week'], nda: ['pre_boarding', 'first_week'],
  confirmation: ['probation'], extension: ['probation'], relieving: [],
};

export function LifecycleDocuments() {
  const { user, emps, setView, flash } = useStore();
  const pay = canSeePay(user);
  const company = useCompanyName();
  const [handoff] = useState(() => {
    try {
      const raw = readHandoff(DOCS_OPEN_KEY);
      return raw ? (JSON.parse(raw) as { kind?: LetterKind; journeyId?: string; userId?: string }) : null;
    } catch { return null; }
  });
  const [kind, setKind] = useState<LetterKind>(handoff?.kind && LETTER_KINDS.includes(handoff.kind) ? handoff.kind : 'offer');
  const [cards, setCards] = useState<Record<BoardTab, BoardCard[]> | null>(null);
  const [off, setOff] = useState(false);
  const [personKey, setPersonKey] = useState(handoff?.journeyId ? `j:${handoff.journeyId}` : handoff?.userId ? `u:${handoff.userId}` : '');

  // Everyone on the onboarding board, for the joiner letters.
  useEffect(() => {
    let live = true;
    const tabs: BoardTab[] = ['pre_boarding', 'first_week', 'probation'];
    Promise.all(tabs.map((tab) => getBoard({ tab })))
      .then((boards) => { if (live) setCards(Object.fromEntries(boards.map((b, i) => [tabs[i], b.columns.flatMap((c) => c.cards)])) as Record<BoardTab, BoardCard[]>); })
      .catch((e) => { if (!live) return; if (isNotAvailable(e)) setOff(true); else setCards({ pre_boarding: [], first_week: [], probation: [] }); });
    return () => { live = false; };
  }, []);

  const people: Person[] = useMemo(() => {
    if (kind === 'relieving') {
      return emps.slice().sort((a, b) => Number(Boolean(b.exit)) - Number(Boolean(a.exit)) || a.name.localeCompare(b.name))
        .map((e) => ({ key: `u:${e.id}`, userId: e.id, name: e.name, sub: [e.role, e.exit ? (e.exit.left ? 'left' : 'on notice') : ''].filter(Boolean).join(' · '), managerUserId: e.managerId, email: e.email }));
    }
    if (!cards) return [];
    return TABS_FOR[kind].flatMap((tab) => cards[tab]).map((c) => ({ key: `j:${c.journeyId}`, journeyId: c.journeyId, name: c.name, sub: [c.designation, c.dayLabel].filter(Boolean).join(' · ') }));
  }, [kind, cards, emps]);
  const person = people.find((p) => p.key === personKey) ?? null;

  // A person who does not fit the new letter is cleared; the first one is picked when there is none.
  useEffect(() => {
    if (!people.length) return;
    if (!people.some((p) => p.key === personKey)) setPersonKey(people[0].key);
  }, [people, personKey]);

  if (off) return <NotSwitchedOn />;

  return (
    <div className="pd-form" style={{ animation: 'fade .3s ease both' }}>
      <div className="pd-head" style={{ marginBottom: 16 }}>
        <p className="pd-lead">Pick a document and a {kind === 'relieving' ? 'person' : 'joiner'}. Details come from their record; fill anything missing and check the letter on the right before you generate it.</p>
        {canOpen(user, 'lifecycle_letter_templates') && <button type="button" className="pd-btn ghost" onClick={() => setView('lifecycle_letter_templates')}>Document templates</button>}
      </div>
      <div style={{ marginBottom: 16 }}>
        <StatusTabs<LetterKind> options={LETTER_KINDS} active={kind} onSelect={setKind} labels={KIND_LABEL} />
      </div>
      {!cards && kind !== 'relieving' ? (
        <section className="pd-card"><SkeletonLines lines={6} /></section>
      ) : (
        <LetterWorkbench key={`${kind}|${person?.key ?? ''}`} kind={kind} person={person} people={people} onPerson={setPersonKey}
          pay={pay} company={company} hrName={user?.name ?? 'HR'}
          managerEmail={(id?: string) => emps.find((e) => e.id === id)}
          canEditTemplates={canOpen(user, 'lifecycle_letter_templates')}
          onEditTemplate={(id) => { try { sessionStorage.setItem(LETTER_TEMPLATE_OPEN_KEY, id); } catch { /* opens the list */ } setView('lifecycle_letter_templates'); }}
          flash={flash} />
      )}
    </div>
  );
}

function LetterWorkbench({ kind, person, people, onPerson, pay, company, hrName, managerEmail, canEditTemplates, onEditTemplate, flash }: {
  kind: LetterKind; person: Person | null; people: Person[]; onPerson: (key: string) => void;
  pay: boolean; company: string; hrName: string;
  managerEmail: (id?: string) => { name: string; email: string } | undefined;
  canEditTemplates: boolean;
  onEditTemplate: (id: string) => void;
  flash: (m: string, tone?: 'ok' | 'error') => void;
}) {
  const [templates, setTemplates] = useState<LetterTemplateDTO[] | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [base, setBase] = useState<Record<string, string> | null>(null);
  const [serverMissing, setServerMissing] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [letter, setLetter] = useState<LetterView | null>(null);
  const [savedKey, setSavedKey] = useState('');
  const [pdf, setPdf] = useState<{ blob: Blob; key: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [mailOpen, setMailOpen] = useState(false);
  const [preview, setPreview] = useState<{ blob?: Blob; fileId?: string; name: string } | null>(null);
  const [earlier, setEarlier] = useState<LetterView[]>([]);
  const [candidate, setCandidate] = useState<{ email?: string; managerUserId?: string }>({});

  useEffect(() => {
    let live = true;
    setError('');
    listLetterTemplates(kind).then((t) => { if (!live) return; setTemplates(t); setTemplateId((t.find((x) => x.isDefault) ?? t[0])?.id ?? ''); })
      .catch((e) => { if (live) { setTemplates([]); setError(errText(e, 'Could not load the letter templates')); } });
    return () => { live = false; };
  }, [kind, attempt]);

  const journeyId = person?.journeyId;
  const userId = person?.userId;
  useEffect(() => {
    if (!journeyId && !userId) return;
    let live = true;
    setBase(null);
    getMergeValues({ kind, journeyId, userId })
      .then((m) => { if (live) { setBase(m.values); setServerMissing(m.missing); } })
      .catch((e) => { if (live) { setBase({}); setError(errText(e, 'Could not fill in the details')); } });
    listLetters({ journeyId, userId }).then((l) => { if (live) setEarlier(l); }).catch(() => undefined);
    if (journeyId) getJourney(journeyId).then((d) => { if (live) setCandidate({ email: d.journey.candidate?.personalEmail, managerUserId: d.journey.managerUserId }); }).catch(() => undefined);
    return () => { live = false; };
  }, [kind, journeyId, userId, attempt]);

  const template = templates?.find((t) => t.id === templateId);
  const values = useMemo(() => ({ ...(base ?? {}), ...edits }), [base, edits]);
  const keys = useMemo(() => {
    const list = template ? placeholders(template.body) : [];
    for (const k of serverMissing) if (!list.includes(k)) list.push(k);
    return list;
  }, [template, serverMissing]);
  const missing = template ? missingFields(template.body, values, serverMissing) : [];
  const valuesKey = JSON.stringify([templateId, values]);
  const name = valueName(values) || person?.name || '';
  const first = firstName(name);
  const head = { company: values.companyName || company, address: values.companyAddress, refNo: letter?.refNo || values.refNo, title: LETTER_TITLE[kind] };
  const fileName = letterFileName(kind, name);
  const pdfReady = Boolean(pdf && pdf.key === valuesKey);
  // What the preview shows: pay figures masked for someone without payroll access.
  const shown = pay ? values : Object.fromEntries(Object.entries(values).map(([k, v]) => [k, PAY_FIELD.test(k) && v ? '••••••' : v]));
  const isOffer = kind === 'offer';

  /** The letter row for these exact values (a new one if anything changed since the last save). */
  const ensureLetter = async (): Promise<LetterView> => {
    if (letter && savedKey === valuesKey) return letter;
    const l = await createLetter({ kind, journeyId: person?.journeyId, userId: person?.userId, templateId, values });
    setLetter(l); setSavedKey(valuesKey);
    return l;
  };
  const saveDraft = async () => {
    if (!template || !person) return;
    setBusy('draft');
    try { const l = await ensureLetter(); flash(`Draft saved${l.refNo ? ` · ${l.refNo}` : ''}`); } catch (e) { flash(errText(e, 'Could not save the draft'), 'error'); } finally { setBusy(''); }
  };
  /** Makes the PDF and uploads it (to the offer, or to the letter). */
  const generate = async (): Promise<boolean> => {
    if (!template || !person || missing.length) return false;
    if (pdfReady) return true;
    setBusy('pdf');
    try {
      if (isOffer) {
        const blob = await letterPdf(template.body, values, head, fileName);
        await uploadOfferPdf(person.journeyId!, blob, fileName);
        setPdf({ blob, key: valuesKey });
      } else {
        const l = await ensureLetter();
        const blob = await letterPdf(template.body, values, { ...head, refNo: l.refNo || head.refNo }, fileName);
        const up = await uploadLetterPdf(l.id, blob, fileName);
        setLetter(up); setPdf({ blob, key: valuesKey });
      }
      flash(`${KIND_LABEL[kind]} generated`);
      return true;
    } catch (e) { flash(errText(e, 'Could not make the PDF'), 'error'); return false; } finally { setBusy(''); }
  };

  if (!person) {
    return <section className="pd-card"><div className="pd-empty">{kind === 'relieving' ? 'Nobody to write to yet.' : 'Nobody on the board for this letter yet. Joiners show here once their offer is made.'}</div></section>;
  }
  if (templates && templates.length === 0) {
    return (
      <section className="pd-card">
        {error ? <LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} /> : <div className="pd-empty">There is no {KIND_LABEL[kind].toLowerCase()} template yet. Add one in Setup › Employee lifecycle › Document templates.</div>}
      </section>
    );
  }

  const managerId = person.managerUserId ?? candidate.managerUserId;
  const manager = managerEmail(managerId);
  const to = candidate.email || values.personalEmail || values.email || person.email || '';

  return (
    <>
      <PageActions>
        {!isOffer && <button type="button" className="pd-btn" onClick={() => void saveDraft()} disabled={Boolean(busy) || !template || !base}>{busy === 'draft' ? 'Saving…' : 'Save draft'}</button>}
        <button type="button" className="pd-btn" onClick={() => setMailOpen(true)} disabled={!template || !base}>Draft email</button>
        <button type="button" className="pd-btn primary" onClick={() => void generate()} disabled={Boolean(busy) || !template || !base || missing.length > 0} aria-disabled={missing.length > 0}
          title={missing.length ? 'Fill the missing details first' : undefined}>{busy === 'pdf' ? 'Generating…' : pdfReady ? 'PDF generated' : 'Generate PDF'}</button>
      </PageActions>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section className="pd-card" style={{ flex: '1 1 320px', maxWidth: 420, minWidth: 0, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, flex: 1 }}>Details</h2>
            {base && template && <span style={{ fontSize: 12.5, fontWeight: 500, color: missing.length ? 'var(--bad)' : 'var(--ok)' }}>{missing.length ? `${missing.length} field${missing.length === 1 ? '' : 's'} missing` : 'All details filled'}</span>}
          </div>
          <Field label={kind === 'relieving' ? 'Employee' : 'Joiner'}>
            <Pick value={person.key} onChange={onPerson}>
              {people.map((p) => <option key={p.key} value={p.key}>{p.name}{p.sub ? ` · ${p.sub}` : ''}</option>)}
            </Pick>
          </Field>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{SOURCE[kind](first || 'them')}</div>
          {templates && templates.length > 1 && (
            <Field label="Template">
              <Pick value={templateId} onChange={setTemplateId}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
              </Pick>
            </Field>
          )}
          {error && <LoadError compact text={error} onRetry={() => setAttempt((n) => n + 1)} />}
          {!base || !templates ? <SkeletonLines lines={6} /> : keys.map((k) => {
            const isPay = PAY_FIELD.test(k);
            const miss = !filled(values, k);
            if (isPay && !pay) {
              return <Field key={k} label={fieldLabel(k)} hint={miss ? 'Needed for this letter. Someone with payroll access fills it.' : undefined}><input value={miss ? '' : 'Hidden · needs payroll access'} readOnly style={{ ...inputStyle, color: 'var(--ink-3)' }} /></Field>;
            }
            return (
              <Field key={k} label={fieldLabel(k)} hint={miss ? 'Needed for this letter' : undefined}>
                <input value={values[k] ?? ''} onChange={(e) => setEdits((x) => ({ ...x, [k]: e.target.value }))}
                  placeholder={k.toLowerCase().includes('valid') ? 'e.g. Fri 5 Dec 2026' : k.toLowerCase().includes('last') ? 'e.g. Fri 30 Jan 2027' : undefined}
                  style={{ ...inputStyle, ...(miss ? { borderColor: '#E7B9A6', background: 'color-mix(in srgb, #FFF8F5 70%, var(--surface))' } : null) }} />
              </Field>
            );
          })}
          <button type="button" onClick={() => setMailOpen(true)} disabled={!template || !base}
            style={{ textAlign: 'left', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', background: 'var(--surface)', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
            <b style={{ display: 'block', fontSize: 13.5, fontWeight: 500 }}>Email this letter to {first || 'them'}</b>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Opens a draft with the PDF attached{isOffer || kind === 'appointment' || kind === 'nda' ? ' and the portal link' : ''}</span>
          </button>
          {earlier.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-2)', margin: '4px 0 6px' }}>Letters for {first}</div>
              <div className="pd-list">
                {earlier.map((l) => {
                  const f = l.signedPdfFileId ?? l.pdfFileId;
                  return (
                    <div key={l.id} className="pd-li">
                      <span className="grow"><b>{KIND_LABEL[l.kind]}{l.refNo ? ` · ${l.refNo}` : ''}</b><span className="s">{l.state}{l.signedAt ? ` ${shortDay(l.signedAt)}` : l.sentAt ? ` · sent ${shortDay(l.sentAt)}` : ''}</span></span>
                      {f && <button type="button" className="pd-btn sm" onClick={() => setPreview({ fileId: f, name: letterFileName(l.kind, name) })}>View</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="pd-card" style={{ flex: '2 1 480px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, flex: 1, minWidth: 0 }}>Preview · <span style={{ fontWeight: 500 }}>{template?.name ?? '…'}</span></h2>
            {template && canEditTemplates && <button type="button" className="pd-btn ghost sm" onClick={() => onEditTemplate(template.id)}>Edit template</button>}
          </div>
          {!template || !base ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner label="Filling in the letter…" /></div>
            : <LetterPreview html={letterInner(template.body, shown, head, 'preview')} />}
        </section>
      </div>

      {mailOpen && template && base && (
        <MailPanel kind={kind} values={values} name={name} to={to} manager={manager} company={company} hrName={hrName}
          missing={missing.length} pdfReady={pdfReady} fileName={fileName} busy={busy}
          onPreview={() => pdf && setPreview({ blob: pdf.blob, name: fileName })}
          onSaveDraft={isOffer ? undefined : () => void saveDraft()}
          onClose={() => setMailOpen(false)}
          onSend={async (mail) => {
            if (!(await generate())) return;
            setBusy('send');
            try {
              if (isOffer) await sendOffer(person.journeyId!, { subject: mail.subject, body: mail.body, cc: mail.cc });
              else {
                const l = await ensureLetter();
                const sent = await sendLetter(l.id, { to: mail.to, cc: mail.cc, subject: mail.subject, body: mail.body, withPortalLink: mail.withPortalLink });
                setLetter(sent);
              }
              flash(`${KIND_LABEL[kind]} sent to ${first || mail.to}`);
              setMailOpen(false);
              listLetters({ journeyId: person.journeyId, userId: person.userId }).then(setEarlier).catch(() => undefined);
            } catch (e) { flash(errText(e, 'Could not send the email'), 'error'); } finally { setBusy(''); }
          }} />
      )}
      {preview?.blob && <BlobPreview blob={preview.blob} name={preview.name} onClose={() => setPreview(null)} />}
      {preview?.fileId && <FilePreview fileId={preview.fileId} name={preview.name} onClose={() => setPreview(null)} />}
    </>
  );
}

function MailPanel({ kind, values, name, to: toStart, manager, company, hrName, missing, pdfReady, fileName, busy, onPreview, onSaveDraft, onClose, onSend }: {
  kind: LetterKind; values: Record<string, string>; name: string; to: string; manager?: { name: string; email: string };
  company: string; hrName: string; missing: number; pdfReady: boolean; fileName: string; busy: string;
  onPreview: () => void; onSaveDraft?: () => void; onClose: () => void;
  onSend: (mail: { to: string; cc?: string[]; subject: string; body: string; withPortalLink?: boolean }) => Promise<void>;
}) {
  const isOffer = kind === 'offer';
  const portalSwitch = kind === 'appointment' || kind === 'nda';
  const [withLink, setWithLink] = useState(true);
  const start = emailDraft(kind, values, { company, hrName, withLink: isOffer || withLink });
  const [to, setTo] = useState(toStart);
  const [ccManager, setCcManager] = useState(Boolean(manager?.email));
  const [subject, setSubject] = useState(start.subject);
  const [body, setBody] = useState(start.body);
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState('');
  const flip = (v: boolean) => {
    setWithLink(v);
    if (!edited) setBody(emailDraft(kind, values, { company, hrName, withLink: v }).body);
  };
  const send = () => {
    if (!isOffer && !/^\S+@\S+\.\S+$/.test(to.trim())) { setError('Enter who it goes to'); return; }
    if (!subject.trim() || !body.trim()) { setError('Write a subject and a message'); return; }
    setError('');
    void onSend({ to: to.trim(), cc: ccManager && manager?.email ? [manager.email] : undefined, subject: subject.trim(), body, withPortalLink: portalSwitch ? withLink : undefined });
  };
  const chip = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 99, background: 'var(--surface-2)', border: '1px solid var(--line)', fontSize: 12.5, maxWidth: '100%', overflowWrap: 'anywhere' } as const;
  return (
    <DrawerShell width={460} onClose={onClose}>
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--line)' }}>
        <h2 style={{ margin: 0, flex: 1, fontSize: 16, fontWeight: 600 }}>New email</h2>
        <CloseButton onClose={onClose} />
      </div>
      <div className="pd-form" style={{ padding: 20, display: 'grid', gap: 12, fontSize: 13 }}>
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
        <Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} /></Field>
        <Field label="Email body"><textarea value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} style={{ ...areaStyle, minHeight: 240 }} /></Field>
        {isOffer && <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>A “View and accept your offer” button with their personal portal link goes under your message.</div>}
        {portalSwitch && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Switch on={withLink} onChange={flip} label="Add the portal link" />
            <span><b style={{ display: 'block', fontWeight: 500 }}>Add the portal link</b><span style={{ fontSize: 12, color: 'var(--ink-3)' }}>A button to open their joining portal, where they sign it</span></span>
          </label>
        )}
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 6 }}>Attachments</div>
          <div className="pd-li" style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '10px 12px' }}>
            <span className="pd-li-i" aria-hidden style={{ fontSize: 10, fontWeight: 600 }}>PDF</span>
            <span className="grow"><b style={{ overflowWrap: 'anywhere' }}>{fileName}</b><span className="s">{pdfReady ? 'Generated from the details' : missing ? 'Not generated yet' : 'Generated when you send'}</span></span>
            {pdfReady && <button type="button" className="pd-btn sm" onClick={onPreview}>Preview</button>}
          </div>
        </div>
        {missing > 0 && <div className="pd-note" style={{ color: 'var(--bad)' }}>The letter can’t be attached yet: fill the missing details first.</div>}
        {error && <div role="alert" style={{ color: 'var(--bad)' }}>{error}</div>}
      </div>
      <div style={{ marginTop: 'auto', position: 'sticky', bottom: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)', padding: '14px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {onSaveDraft && <button type="button" className="pd-btn" onClick={onSaveDraft} disabled={Boolean(busy)}>Save draft</button>}
        <button type="button" className="pd-btn primary" onClick={send} disabled={Boolean(busy) || missing > 0}>{busy === 'send' ? 'Sending…' : busy === 'pdf' ? 'Generating…' : 'Send email'}</button>
      </div>
    </DrawerShell>
  );
}
