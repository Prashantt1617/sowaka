// H3 · Documents: pick a letter and a person. The details come from their
// offer, journey and record; fill anything missing on the left and check the
// letter on the right (filled values blue, missing orange). Generate PDF waits
// until nothing is missing, makes the PDF in the browser and uploads it; Draft
// email (H3c) opens the email with the PDF attached. The offer letter is the
// offer itself (OfferWorkbench): its form saves the offer as a draft, and New
// offer letter on the board opens it for a new joiner.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { canOpen, canSeePay } from '../../access';
import { useBrand } from '../../brand';
import { LoadError, SkeletonLines, StatusTabs } from '../../ui';
import {
  createLetter, getJoinerPicks, getJourney, getMergeValues, getSalaryBreakup, isNotAvailable, listLetterTemplates, listLetters, saveLetterDraft, sendLetter,
  uploadLetterPdf,
} from '../../../services/lifecycle';
import type { BoardTab, JoinerPick, LetterKind, LetterTemplateDTO, LetterView, SalaryBreakup } from '../../../services/lifecycle';
import { htmlToPdfBlob } from '../../pdf';
import { BlobPreview, FilePreview, Field, NotSwitchedOn, Pick } from './shared';
import { DOCS_OPEN_KEY, LETTER_TEMPLATE_OPEN_KEY, errText, firstName, inputStyle, readHandoff } from './format';
import {
  KIND_LABEL, LETTER_KINDS, LETTER_TITLE, annexureHtml, checklistHtml, fieldLabel, fillBody, filled, letterFileName, letterInner, letterPdf, missingFields, placeholders,
  simpleDocument, takesAnnexure, valueName, sanitizeHtml,
} from './letterDoc';
import { pushDocState, replaceDocState, useCompanyName, useFormStash, useMailStep } from './hooks';
import { AUTO_KEYS, DetailsHead, DocActions, downloadFile, showFirstMissing, logoSrc, EarlierLetters, EmailCard, FieldGrid, MailPanel, NEEDED, PreviewCard, missingInput } from './DocumentParts';
import type { MailOut, Person } from './DocumentParts';
import { OfferWorkbench, NEW_JOINER } from './OfferWorkbench';
import '../people.css';

const PAY_FIELD = /ctc|salary|pay/i;
const TABS_FOR: Record<LetterKind, BoardTab[]> = {
  offer: ['pre_boarding'], appointment: ['pre_boarding', 'first_week'], nda: ['pre_boarding', 'first_week'],
  confirmation: ['probation'], extension: ['probation'], relieving: [],
};

/** What another page asks Documents to open: a letter for a joiner, a new offer, or the offer's email. */
type Handoff = { kind?: LetterKind; journeyId?: string; userId?: string; newOffer?: boolean; mail?: boolean };

export function LifecycleDocuments() {
  const { user, emps, setView, flash } = useStore();
  const pay = canSeePay(user);
  const company = useCompanyName();
  const logo = useBrand().icon;
  const [handoff] = useState<Handoff | null>(() => {
    try {
      const raw = readHandoff(DOCS_OPEN_KEY);
      return raw ? (JSON.parse(raw) as Handoff) : null;
    } catch { return null; }
  });
  const [kind, setKind] = useState<LetterKind>(handoff?.newOffer ? 'offer' : handoff?.kind && LETTER_KINDS.includes(handoff.kind) ? handoff.kind : 'offer');
  const [cards, setCards] = useState<Record<BoardTab, JoinerPick[]> | null>(null);
  const [off, setOff] = useState(false);
  const startKey = handoff?.newOffer ? NEW_JOINER : handoff?.journeyId ? `j:${handoff.journeyId}` : handoff?.userId ? `u:${handoff.userId}` : '';
  const [personKey, setPersonKey] = useState(startKey);
  // The workbench is made again when HR picks someone else, not when a new offer gets its journey.
  const [benchKey, setBenchKey] = useState(startKey);
  const pick = useCallback((key: string) => { setPersonKey(key); setBenchKey(key); }, []);
  // Back and Forward walk through the letter tabs and joiners HR chose here (each choice is a history step).
  const chooseKind = (k: LetterKind) => { if (k === kind) return; pushDocState({ kind: k, personKey }); setKind(k); };
  const choosePerson = useCallback((key: string) => { pushDocState({ kind, personKey: key }); pick(key); }, [kind, pick]);
  useEffect(() => { replaceDocState({ kind, personKey }); }, [kind, personKey]);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const st = (e.state as { docs?: { kind?: LetterKind; personKey?: string } } | null)?.docs;
      if (!st?.kind) return;
      setKind(st.kind);
      if (st.personKey !== undefined) pick(st.personKey);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [pick]);

  // Everyone on the onboarding board, for the joiner letters. One light call (who and where on the board), not the three full boards.
  const loadPicks = useCallback(() => getJoinerPicks()
    .then((joiners) => {
      const byTab: Record<BoardTab, JoinerPick[]> = { pre_boarding: [], first_week: [], probation: [] };
      for (const j of joiners) byTab[j.tab]?.push(j);
      setCards(byTab);
    })
    .catch((e) => { if (isNotAvailable(e)) setOff(true); else setCards((c) => c ?? { pre_boarding: [], first_week: [], probation: [] }); }), []);
  useEffect(() => { void loadPicks(); }, [loadPicks]);

  const people: Person[] = useMemo(() => {
    if (kind === 'relieving') {
      return emps.slice().sort((a, b) => Number(Boolean(b.exit)) - Number(Boolean(a.exit)) || a.name.localeCompare(b.name))
        .map((e) => ({ key: `u:${e.id}`, userId: e.id, name: e.name, sub: [e.role, e.exit ? (e.exit.left ? 'left' : 'on notice') : ''].filter(Boolean).join(' · '), managerUserId: e.managerId, email: e.email }));
    }
    if (!cards) return [];
    const joiners = TABS_FOR[kind].flatMap((tab) => cards[tab]).map((c) => ({ key: `j:${c.journeyId}`, journeyId: c.journeyId, name: c.name, sub: [c.designation, c.dayLabel].filter(Boolean).join(' · ') }));
    // The offer letter also starts an offer: a new joiner, last in the list.
    return kind === 'offer' && pay ? [...joiners, { key: NEW_JOINER, name: 'New joiner', sub: '' }] : joiners;
  }, [kind, cards, emps, pay]);
  const person = people.find((p) => p.key === personKey) ?? null;

  // A person who does not fit the new letter is cleared; the first one is picked when there is none.
  useEffect(() => {
    if (!people.length) return;
    if (!people.some((p) => p.key === personKey)) pick(people[0].key);
  }, [people, personKey, pick]);

  if (off) return <NotSwitchedOn />;

  const canEditTemplates = canOpen(user, 'lifecycle_letter_templates');
  const onEditTemplate = (id: string) => { try { sessionStorage.setItem(LETTER_TEMPLATE_OPEN_KEY, id); } catch { /* opens the list */ } setView('lifecycle_letter_templates'); };
  const managerEmail = (id?: string) => emps.find((e) => e.id === id);

  return (
    <div className="pd-form" style={{ animation: 'fade .3s ease both' }}>
      <div style={{ marginBottom: 20 }} role="tablist" aria-label="Document">
        <StatusTabs<LetterKind> options={LETTER_KINDS} active={kind} onSelect={chooseKind} labels={KIND_LABEL} />
      </div>
      {!cards && kind !== 'relieving' ? (
        <section className="pd-card"><SkeletonLines lines={6} /></section>
      ) : kind === 'offer' ? (
        <OfferWorkbench key={`offer|${benchKey}`} person={person} people={people} onPerson={choosePerson}
          pay={pay} company={company} logo={logo} hrName={user?.name ?? 'HR'} managerEmail={managerEmail}
          canEditTemplates={canEditTemplates} onEditTemplate={onEditTemplate} flash={flash}
          openMail={Boolean(handoff?.mail) && benchKey === startKey}
          onCreated={(journeyId) => { void loadPicks().then(() => setPersonKey(`j:${journeyId}`)); }} />
      ) : (
        <LetterWorkbench key={`${kind}|${benchKey}`} kind={kind} person={person} people={people} onPerson={choosePerson}
          pay={pay} company={company} logo={logo} hrName={user?.name ?? 'HR'} managerEmail={managerEmail}
          canEditTemplates={canEditTemplates} onEditTemplate={onEditTemplate} flash={flash} />
      )}
    </div>
  );
}

function LetterWorkbench({ kind, person, people, onPerson, pay, company, logo, hrName, managerEmail, flash }: {
  kind: Exclude<LetterKind, 'offer'>; person: Person | null; people: Person[]; onPerson: (key: string) => void;
  pay: boolean; company: string; logo?: string; hrName: string;
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
  // This document's own words (Edit document): never written back to the template.
  const [bodyEdit, setBodyEdit] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [letter, setLetter] = useState<LetterView | null>(null);
  const [savedKey, setSavedKey] = useState('');
  const [pdf, setPdf] = useState<{ blob: Blob; key: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [mailOpen, showMail, closeMail] = useMailStep();
  const [preview, setPreview] = useState<{ blob?: Blob; fileId?: string; name: string } | null>(null);
  const [earlier, setEarlier] = useState<LetterView[]>([]);
  const [candidate, setCandidate] = useState<{ email?: string; managerUserId?: string; docs?: Array<{ label: string; required: boolean }>; bring?: string[]; tj?: string }>({});
  const [breakup, setBreakup] = useState<SalaryBreakup | null>(null);
  const [breakupTemplate, setBreakupTemplate] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    listLetterTemplates(kind).then((t) => { if (!live) return; setTemplates(t); setTemplateId((t.find((x) => x.isDefault) ?? t[0])?.id ?? ''); })
      .catch((e) => { if (live) { setTemplates([]); setError(errText(e, 'Could not load the letter templates')); } });
    return () => { live = false; };
  }, [kind, attempt]);

  const journeyId = person?.journeyId;
  // What HR typed stays until it is saved, generated or sent, also across leaving the page.
  const dropStash = useFormStash(`lf-docs:${kind}:${person?.key ?? ''}`, Boolean(base), { edits, bodyEdit }, (k) => { setEdits(k.edits ?? {}); setBodyEdit(k.bodyEdit ?? null); });
  const userId = person?.userId;
  useEffect(() => {
    if (!journeyId && !userId) return;
    let live = true;
    setBase(null);
    getMergeValues({ kind, journeyId, userId })
      .then((m) => { if (live) { setBase(m.values); setServerMissing(m.missing); } })
      .catch((e) => { if (live) { setBase({}); setError(errText(e, 'Could not fill in the details')); } });
    listLetters({ journeyId, userId }).then((l) => { if (live) setEarlier(l); }).catch(() => undefined);
    if (journeyId) {
      getJourney(journeyId).then((d) => {
        if (live) setCandidate({
          email: d.journey.candidate?.personalEmail, managerUserId: d.journey.managerUserId, tj: d.journey.tj,
          docs: d.documents.map((x) => ({ label: x.label, required: x.required })), bring: d.journey.day1Pass?.bring ?? [],
        });
      }).catch(() => undefined);
    }
    return () => { live = false; };
  }, [kind, journeyId, userId, attempt]);

  // Annexure A (appointment; the offer's is in OfferWorkbench): the CTC split by the company's salary template. Pay only.
  const wantsBreakup = pay && kind === 'appointment' && Boolean(journeyId);
  useEffect(() => {
    if (!wantsBreakup || !journeyId) { setBreakup(null); return; }
    let live = true;
    getSalaryBreakup(journeyId, breakupTemplate || undefined)
      .then((b) => { if (live) setBreakup(b); })
      .catch((e) => { if (live) setBreakup({ templates: [], breakup: null, reason: errText(e, 'The salary breakup could not be worked out') }); });
    return () => { live = false; };
  }, [wantsBreakup, journeyId, breakupTemplate, attempt]);

  const template = templates?.find((t) => t.id === templateId);
  const values = useMemo(() => ({ ...(base ?? {}), ...edits }), [base, edits]);
  const keys = useMemo(() => {
    const list = template ? placeholders(template.body) : [];
    for (const k of serverMissing) if (!list.includes(k)) list.push(k);
    // What the system fills (company, date, reference) stays off the form unless it came empty.
    return list.filter((k) => !AUTO_KEYS.has(k) || !filled(base ?? {}, k));
  }, [template, serverMissing, base]);
  const docBody = bodyEdit ?? template?.body ?? '';
  const missing = template ? missingFields(docBody, values, serverMissing) : [];
  // Missing details show only once HR presses Generate PDF or Send, never on first look.
  const [tried, setTried] = useState(false);
  const needsFilling = () => {
    if (!missing.length) return false;
    setTried(true); showFirstMissing();
    flash(`Fill ${missing.length === 1 ? 'the missing detail' : `the ${missing.length} missing details`} first`, 'error');
    return true;
  };
  const name = valueName(values) || person?.name || '';
  const withAnnex = Boolean(template && takesAnnexure(kind, template.body));
  const annex = withAnnex && breakup?.breakup ? annexureHtml(breakup.breakup, name) : '';
  const valuesKey = JSON.stringify([templateId, values, annex, bodyEdit]);
  const first = firstName(name);
  const head = { company: values.companyName || company, address: values.companyAddress, refNo: letter?.refNo || values.refNo, title: LETTER_TITLE[kind], date: values.letterDate || undefined, logo: logoSrc(logo) };
  const fileName = letterFileName(kind, name);
  const pdfReady = Boolean(pdf && pdf.key === valuesKey);
  // What the preview shows: pay figures masked for someone without payroll access.
  const shown = pay ? values : Object.fromEntries(Object.entries(values).map(([k, v]) => [k, PAY_FIELD.test(k) && v ? '••••••' : v]));

  // The latest email draft saved for this letter kind and person (H3c's Save draft), not sent yet.
  const savedDraft = earlier.find((l) => l.kind === kind && l.email && !l.email.sentAt && l.email.savedAt) ?? null;

  /** The letter row for these exact values (a new one if anything changed since the last save); a saved email draft moves with it. */
  const ensureLetter = async (): Promise<LetterView> => {
    if (letter && savedKey === valuesKey) return letter;
    const l = await createLetter({ kind, journeyId: person?.journeyId, userId: person?.userId, templateId, values });
    if (savedDraft?.email && savedDraft.id !== l.id) {
      const e = savedDraft.email;
      await saveLetterDraft(l.id, { to: e.to, cc: e.cc, subject: e.subject, body: e.body, withPortalLink: e.withPortalLink, attachments: e.attachments }).catch(() => undefined);
    }
    setLetter(l); setSavedKey(valuesKey);
    return l;
  };
  const reloadEarlier = () => listLetters({ journeyId: person?.journeyId, userId: person?.userId }).then(setEarlier).catch(() => undefined);
  const saveDraft = async () => {
    if (!template || !person) return;
    setBusy('draft');
    try { const l = await ensureLetter(); dropStash(); flash(`Draft saved${l.refNo ? ` · ${l.refNo}` : ''}`); void reloadEarlier(); } catch (e) { flash(errText(e, 'Could not save the draft'), 'error'); } finally { setBusy(''); }
  };
  /** Save draft in the email panel: the letter's values and the email (to, cc, subject, body, link, extras) are kept. */
  const saveEmailDraft = async (mail: MailOut) => {
    if (!template || !person) return;
    setBusy('draft');
    try {
      const l = await ensureLetter();
      await saveLetterDraft(l.id, { to: mail.to, cc: mail.cc, subject: mail.subject, body: mail.body, withPortalLink: mail.withPortalLink, attachments: mail.attachments });
      flash('Email draft saved');
      void reloadEarlier();
    } catch (e) { flash(errText(e, 'Could not save the draft'), 'error'); } finally { setBusy(''); }
  };
  /** The suggested extras (H3c): Annexure A on its own and the joining checklist are made here, like the letter. */
  const makeExtra = async (which: 'salary_breakup' | 'joining_checklist'): Promise<{ blob: Blob; name: string } | null> => {
    const docHead = { ...head, title: which === 'salary_breakup' ? 'Annexure A · Salary breakup' : 'Joining checklist' };
    if (which === 'salary_breakup') {
      if (!breakup?.breakup) return null;
      const fileName = `Salary breakup (Annexure A) – ${name}.pdf`.replace(/[/\\:*?"<>|]/g, '');
      return { blob: await htmlToPdfBlob(simpleDocument(docHead, annexureHtml(breakup.breakup, name)), fileName), name: fileName };
    }
    const fileName = `Joining checklist – ${name}.pdf`.replace(/[/\\:*?"<>|]/g, '');
    return { blob: await htmlToPdfBlob(simpleDocument(docHead, checklistHtml(name, candidate.docs ?? [], candidate.bring ?? [], values.joiningDate)), fileName), name: fileName };
  };
  /** Makes the PDF and uploads it to the letter. */
  const generate = async (): Promise<boolean> => {
    if (!template || !person || missing.length) return false;
    if (pdfReady) return true;
    setBusy('pdf');
    try {
      const l = await ensureLetter();
      const blob = await letterPdf(docBody, values, { ...head, refNo: l.refNo || head.refNo }, fileName, annex);
      const up = await uploadLetterPdf(l.id, blob, fileName);
      setLetter(up); setPdf({ blob, key: valuesKey });
      downloadFile(blob, fileName);
      flash(`${KIND_LABEL[kind]} generated`);
      dropStash();
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
  /** Sends the letter (the PDF is made first): from the email card and from the full email panel. */
  const sendMail = async (mail: MailOut): Promise<boolean> => {
    if (!(await generate())) return false;
    setBusy('send');
    try {
      const l = await ensureLetter();
      const sent = await sendLetter(l.id, { to: mail.to, cc: mail.cc, subject: mail.subject, body: mail.body, withPortalLink: mail.withPortalLink, attachments: mail.attachments });
      setLetter(sent);
      flash(`${KIND_LABEL[kind]} sent to ${first || mail.to}`);
      dropStash();
      void reloadEarlier();
      return true;
    } catch (e) { flash(errText(e, 'Could not send the email'), 'error'); return false; } finally { setBusy(''); }
  };

  return (
    <>
      <DocActions onSave={() => void saveDraft()} saving={busy === 'draft'} canSave={Boolean(template && base)}
        onMail={() => showMail()} canMail={Boolean(template && base)}
        onGenerate={() => { if (needsFilling()) return; void generate(); }} generating={busy === 'pdf'} generated={pdfReady} missing={missing.length} disabled={Boolean(busy) || !template || !base} />

      <div className="lf-doc-grid">
        <section className="pd-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <DetailsHead missing={missing.length} ready={Boolean(base && template) && tried} />
          <Field label={kind === 'relieving' ? 'Employee' : 'Joiner'}>
            <Pick value={person.key} onChange={onPerson} ariaLabel={kind === 'relieving' ? 'Employee' : 'Joiner'}>
              {people.map((p) => <option key={p.key} value={p.key}>{p.name}{p.sub ? ` · ${p.sub}` : ''}</option>)}
            </Pick>
          </Field>
          {error && <LoadError compact text={error} onRetry={() => setAttempt((n) => n + 1)} />}
          {!base || !templates ? <SkeletonLines lines={6} /> : (
            <FieldGrid>
              {templates.length > 1 && (
                <Field label="Template" wide>
                  <Pick value={templateId} onChange={setTemplateId} ariaLabel="Template">
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
                  </Pick>
                </Field>
              )}
              {keys.map((k) => {
                const isPay = PAY_FIELD.test(k);
                const miss = tried && !filled(values, k);
                if (isPay && !pay) {
                  return <Field key={k} label={fieldLabel(k)} error={miss ? `${NEEDED}. Someone with payroll access fills it.` : undefined}><input value={miss ? '' : 'Hidden · needs payroll access'} readOnly style={{ ...inputStyle, color: 'var(--ink-3)' }} /></Field>;
                }
                return (
                  <Field key={k} label={fieldLabel(k)} error={miss ? NEEDED : undefined}>
                    <input value={values[k] ?? ''} onChange={(e) => setEdits((x) => ({ ...x, [k]: e.target.value }))}
                      placeholder={k.toLowerCase().includes('valid') ? 'e.g. Fri 5 Dec 2026' : k.toLowerCase().includes('last') ? 'e.g. Fri 30 Jan 2027' : undefined}
                      style={{ ...inputStyle, ...(miss ? missingInput : null) }} />
                  </Field>
                );
              })}
              {withAnnex && pay && (
                <Field label="Annexure A · salary breakup" wide hint={breakup?.breakup ? `Added as the letter’s last page, from the ${breakup.breakup.templateName} salary structure.` : undefined}>
                  {!breakup ? <SkeletonLines lines={1} />
                    : breakup.templates.length > 1 ? (
                      <Pick value={breakup.templateCode ?? ''} onChange={setBreakupTemplate}>
                        {breakup.templates.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                      </Pick>
                    ) : breakup.breakup ? <input value={breakup.breakup.templateName} readOnly style={{ ...inputStyle, color: 'var(--ink-2)' }} /> : null}
                  {breakup && !breakup.breakup && <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 4 }}>{breakup.reason ?? 'The salary breakup could not be worked out'}. The letter goes without Annexure A.</div>}
                </Field>
              )}
            </FieldGrid>
          )}
          {template && base && (
            <EmailCard kind={kind} first={first} to={to} values={values} company={company} hrName={hrName} manager={manager}
              draft={savedDraft?.email} missing={missing.length} busy={busy} onSend={sendMail} onOpen={() => showMail()} />
          )}
          <EarlierLetters earlier={earlier} first={first} name={name} onView={(fileId, n) => setPreview({ fileId, name: n })} />
        </section>

        <PreviewCard templateName={template?.name} loading={!template || !base}
          html={template ? letterInner(docBody, shown, head, 'preview', annex) : ''}
          edit={template ? { html: fillBody(docBody, values, 'pdf'), edited: bodyEdit !== null, onSave: (h) => setBodyEdit(sanitizeHtml(h)), onReset: () => setBodyEdit(null) } : undefined} />
      </div>

      {mailOpen && template && base && (
        <MailPanel kind={kind} values={values} name={name} to={to} manager={manager} company={company} hrName={hrName}
          missing={missing.length} pdfReady={pdfReady} fileName={fileName} busy={busy} draft={savedDraft?.email}
          annexInLetter={Boolean(annex)} journeyId={person.journeyId}
          canBreakup={pay && Boolean(breakup?.breakup) && kind === 'appointment'}
          canChecklist={false}
          makeExtra={makeExtra}
          onPreview={() => pdf && setPreview({ blob: pdf.blob, name: fileName })}
          onSaveDraft={(mail) => void saveEmailDraft(mail)}
          onClose={() => closeMail()}
          onSend={async (mail) => { if (await sendMail(mail)) closeMail(); }} />
      )}
      {preview?.blob && <BlobPreview blob={preview.blob} name={preview.name} onClose={() => setPreview(null)} />}
      {preview?.fileId && <FilePreview fileId={preview.fileId} name={preview.name} onClose={() => setPreview(null)} />}
    </>
  );
}

