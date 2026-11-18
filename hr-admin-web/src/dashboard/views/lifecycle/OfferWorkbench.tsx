// H3 · Documents › Offer letter: the offer itself, as the design draws it. The
// form (the offer's terms, two columns) beside the live letter; Save draft
// saves the offer (a new joiner becomes a draft on the board; a sent offer gets
// a new draft version), Generate PDF saves first and attaches the letter to the
// offer, and the email (the card under the details, or the full panel) sends it
// with the portal link. This replaces the New offer letter dialog: its checks,
// the joining-date rules and the onboarding template choice are all here.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { LoadError, SkeletonLines } from '../../ui';
import { ApiError } from '../../../services/http';
import { getOrganisationProfile } from '../../../services/hrms';
import {
  NON_WORKING_DAY, createLetter, createOffer, getJourney, getMergeValues, getSalaryBreakup, listLetterTemplates, listLetters, listTemplates,
  saveLetterDraft, sendOffer, updateOffer, uploadOfferPdf,
} from '../../../services/lifecycle';
import type { JourneyDetail, LetterTemplateDTO, LetterView, OfferFields, SalaryBreakup, TemplateListItem } from '../../../services/lifecycle';
import { htmlToPdfBlob } from '../../pdf';
import { BlobPreview, FilePreview, Field, Pick } from './shared';
import { OFFER_FIELD_LABEL, areaStyle, errText, firstName, inputStyle, longDay, shortDay, todayKey } from './format';
import {
  LETTER_TITLE, annexureHtml, checklistHtml, fieldLabel, filled, letterFileName, letterInner, letterPdf, missingFields, placeholders, simpleDocument, takesAnnexure,
} from './letterDoc';
import { useOfferChoices } from './hooks';
import { OFFER_VALUE_FIELD, blankOfferFields, cleanOfferFields, formatDay, offerFormValues, validateOffer } from './offerValues';
import type { OfferFormKey } from './offerValues';
import { AUTO_KEYS, DetailsHead, DocActions, EarlierLetters, EmailCard, FieldGrid, MailPanel, NEEDED, PreviewCard, SourceNote, logoSrc, missingInput } from './DocumentParts';
import type { MailOut, Person } from './DocumentParts';

/** The Joiner picker's "New joiner": a new offer, saved as a draft on the board. */
export const NEW_JOINER = 'new';

/** A journey whose offer can still change (the server's PRE_JOIN). */
const OPEN = new Set(['draft', 'offer_sent', 'accepted', 'finalised', 'active', 'docs_approved']);

type Errors = Partial<Record<OfferFormKey | 'email', string>>;
type Retry = (tj: string) => void;

export function OfferWorkbench({ person, people, onPerson, pay, company, logo, hrName, managerEmail, canEditTemplates, onEditTemplate, flash, openMail, onCreated }: {
  person: Person | null; people: Person[]; onPerson: (key: string) => void;
  pay: boolean; company: string; logo?: string; hrName: string;
  managerEmail: (id?: string) => { name: string; email: string } | undefined;
  canEditTemplates: boolean;
  onEditTemplate: (id: string) => void;
  flash: (m: string, tone?: 'ok' | 'error') => void;
  /** Open the full email once the letter is ready (Send offer from the joiner panel). */
  openMail: boolean;
  /** A new joiner's offer was saved: their journey. */
  onCreated: (journeyId: string) => void;
}) {
  const { emps } = useStore();
  const choices = useOfferChoices();
  const [journeyId, setJourneyId] = useState(person?.journeyId ?? '');
  const idRef = useRef(journeyId);
  const [detail, setDetail] = useState<JourneyDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // Bumped after every save: the server's values, the offer, the letters and the breakup again.
  const [rev, setRev] = useState(0);
  const inited = useRef(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [fields, setFields] = useState<OfferFields>(blankOfferFields);
  const [saved, setSaved] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [address, setAddress] = useState('');

  const [letterTemplates, setLetterTemplates] = useState<LetterTemplateDTO[] | null>(null);
  const [letterId, setLetterId] = useState('');
  const [base, setBase] = useState<Record<string, string> | null>(null);
  const [serverMissing, setServerMissing] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [breakup, setBreakup] = useState<SalaryBreakup | null>(null);
  const [breakupTemplate, setBreakupTemplate] = useState('');
  const [earlier, setEarlier] = useState<LetterView[]>([]);

  const [pdf, setPdf] = useState<{ blob: Blob; key: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [mailOpen, setMailOpen] = useState(false);
  const [mailOpened, setMailOpened] = useState(false);
  const [preview, setPreview] = useState<{ blob?: Blob; fileId?: string; name: string } | null>(null);
  // The server refused the joining date (a week-off or holiday): what it said, and what to send again.
  const [nonWorking, setNonWorking] = useState<{ tj: string; text: string; retry: Retry } | null>(null);
  const [allowedTj, setAllowedTj] = useState('');

  const isNew = !journeyId;

  // The joiner, their offer and their documents (for the joining checklist).
  useEffect(() => {
    if (!journeyId) return;
    let live = true;
    getJourney(journeyId).then((d) => {
      if (!live) return;
      setDetail(d);
      setLoadError('');
      if (inited.current) return;
      inited.current = true;
      setName(d.journey.candidate?.name ?? person?.name ?? '');
      setEmail(d.journey.candidate?.personalEmail ?? '');
      setPhone(d.journey.candidate?.phone ?? '');
      if (d.offer) {
        // The view adds the manager's name; the offer itself keeps only their id.
        const f: OfferFields & { managerName?: string } = { ...blankOfferFields(), ...d.offer.fields };
        delete f.managerName;
        setFields(f);
        setSaved(JSON.stringify(cleanOfferFields(f)));
      }
    }).catch((e) => { if (live) setLoadError(errText(e, 'Could not load the offer')); });
    return () => { live = false; };
    // person is only the first name to show while loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyId, attempt, rev]);

  // A new joiner: the onboarding templates (the default's probation) and the notice a resignation gets.
  useEffect(() => {
    if (!isNew || !pay) return;
    listTemplates('onboarding').then((t) => {
      const active = t.filter((x) => x.active);
      setTemplates(active);
      const def = active.find((x) => x.isDefault) ?? active[0];
      if (def) {
        setTemplateId(def.id);
        if (def.settings.probationMonths) setFields((f) => ({ ...f, probationMonths: def.settings.probationMonths! }));
      }
    }).catch(() => setTemplates([]));
    listTemplates('offboarding').then((t) => {
      const days = t.find((x) => x.isDefault)?.settings.noticeDays;
      if (typeof days === 'number') setFields((f) => ({ ...f, noticeDays: days }));
    }).catch(() => undefined);
    // The letterhead's address before the offer is saved (the server's merge values carry it after).
    getOrganisationProfile().then((p) => setAddress([p.addressLine1, p.addressLine2, p.city, p.state, p.pincode].map((x) => x?.trim()).filter(Boolean).join(', '))).catch(() => undefined);
    // Only for the new joiner this workbench started as.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pay) return;
    let live = true;
    listLetterTemplates('offer').then((t) => { if (!live) return; setLetterTemplates(t); setLetterId((id) => id || ((t.find((x) => x.isDefault) ?? t[0])?.id ?? '')); })
      .catch((e) => { if (live) { setLetterTemplates([]); setLoadError(errText(e, 'Could not load the offer letter template')); } });
    return () => { live = false; };
  }, [pay, attempt]);

  // The server's values for the saved offer (ref no., address, the dates as it words them).
  useEffect(() => {
    if (!journeyId || !pay) return;
    let live = true;
    getMergeValues({ kind: 'offer', journeyId })
      .then((m) => { if (live) { setBase(m.values); setServerMissing(m.missing); } })
      .catch((e) => { if (live) { setBase((b) => b ?? {}); setLoadError(errText(e, 'Could not fill in the details')); } });
    listLetters({ journeyId }).then((l) => { if (live) setEarlier(l); }).catch(() => undefined);
    return () => { live = false; };
  }, [journeyId, pay, rev, attempt]);

  const template = letterTemplates?.find((t) => t.id === letterId);
  const withAnnex = Boolean(template && takesAnnexure('offer', template.body));
  // Annexure A: the saved CTC split by the company's salary template.
  useEffect(() => {
    if (!journeyId || !pay || !withAnnex) { setBreakup(null); return; }
    let live = true;
    getSalaryBreakup(journeyId, breakupTemplate || undefined)
      .then((b) => { if (live) setBreakup(b); })
      .catch((e) => { if (live) setBreakup({ templates: [], breakup: null, reason: errText(e, 'The salary breakup could not be worked out') }); });
    return () => { live = false; };
  }, [journeyId, pay, withAnnex, breakupTemplate, rev]);

  const offer = detail?.offer ?? null;
  const journey = detail?.journey;
  const closed = Boolean(journey && !OPEN.has(String(journey.status)));
  const sentVersion = offer && offer.status !== 'draft';
  const clean = cleanOfferFields(fields);
  const dirty = isNew || JSON.stringify(clean) !== saved;
  const manager = managerEmail(fields.managerUserId);
  const formValues = offerFormValues(fields, { name, managerName: manager?.name });
  const today = formatDay(todayKey());
  const localBase = { companyName: company, companyAddress: address, letterDate: today, offerDate: today, hrName, refNo: '' };
  const baseValues = isNew ? localBase : base;
  const values: Record<string, string> = { ...(baseValues ?? {}), ...formValues, ...edits };
  const missing = template ? missingFields(template.body, values, serverMissing) : [];
  const formMissing = new Set(missing.map((k) => OFFER_VALUE_FIELD[k]).filter(Boolean));
  // Fields the template needs that the offer does not carry (and the system did not fill): typed here, for the letter only.
  const extraKeys = [...new Set([...(template ? placeholders(template.body) : []), ...serverMissing])]
    .filter((k) => !OFFER_VALUE_FIELD[k] && (!AUTO_KEYS.has(k) || !filled(baseValues ?? {}, k)));
  const annex = withAnnex && breakup?.breakup ? annexureHtml(breakup.breakup, name) : '';
  const valuesKey = JSON.stringify([letterId, values, annex]);
  const first = firstName(name) || person?.name.split(' ')[0] || '';
  const head = { company: values.companyName || company, address: values.companyAddress, refNo: offer?.refNo || values.refNo, title: LETTER_TITLE.offer, date: values.letterDate || undefined, logo: logoSrc(logo) };
  const fileName = letterFileName('offer', name);
  // The PDF on the offer is this letter while nothing changed since it was made.
  const serverPdf = Boolean(offer?.pdfFileId) && !dirty && Object.keys(edits).length === 0;
  const pdfReady = Boolean(pdf && pdf.key === valuesKey) || serverPdf;
  const ready = Boolean(template && (isNew || (base && detail)));
  const to = journey?.candidate?.personalEmail || email.trim();
  const savedDraft = earlier.find((l) => l.kind === 'offer' && l.email && !l.email.sentAt && l.email.savedAt) ?? null;

  // Send offer from the joiner panel opens the email once the letter is there.
  useEffect(() => {
    if (openMail && !mailOpened && ready) { setMailOpen(true); setMailOpened(true); }
  }, [openMail, mailOpened, ready]);

  const set = <K extends keyof OfferFields>(k: K, v: OfferFields[K]) => {
    setFields((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  /** Saves the offer when anything changed (a new joiner's is created); its journey, or null when it was not saved. */
  const persist = async (opts: { allowTj?: string; retry: Retry }): Promise<string | null> => {
    const e: Errors = validateOffer(fields, true);
    if (!idRef.current) {
      if (!name.trim()) e.name = 'Enter their name';
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = 'Enter their personal email';
    }
    setErrors(e);
    if (Object.keys(e).length) { flash('Check the details marked in red', 'error'); return null; }
    if (idRef.current && !dirty) return idRef.current;
    const allow = Boolean(fields.tj) && (opts.allowTj ?? allowedTj) === fields.tj;
    setNonWorking(null);
    try {
      let id = idRef.current;
      if (!id) {
        const r = await createOffer({
          candidate: { name: name.trim(), personalEmail: email.trim(), phone: phone.trim() || undefined }, fields: clean,
          templateId: templateId || undefined,
        }, { allowNonWorkingDay: allow });
        id = r.journeyId;
        idRef.current = id;
        inited.current = true;
        setJourneyId(id);
        onCreated(id);
      } else {
        await updateOffer(id, clean, { allowNonWorkingDay: allow });
      }
      setSaved(JSON.stringify(clean));
      setRev((n) => n + 1);
      return id;
    } catch (err) {
      if (err instanceof ApiError && err.code === NON_WORKING_DAY) {
        setNonWorking({ tj: fields.tj, text: err.message, retry: opts.retry });
        return null;
      }
      throw err;
    }
  };

  const saveDraft = async (allowTj?: string) => {
    setBusy('draft');
    try {
      const wasNew = !idRef.current;
      const id = await persist({ allowTj, retry: (tj) => void saveDraft(tj) });
      if (id) flash(wasNew ? `Draft saved. ${first || 'They'} ${first ? 'is' : 'are'} on the board` : sentVersion ? 'Saved as a new version. Send it when you are ready' : 'Draft saved');
    } catch (e) { flash(errText(e, 'Could not save the offer'), 'error'); } finally { setBusy(''); }
  };

  /** Saves the offer if it changed, makes the PDF from the server's values and attaches it to the offer. */
  const generate = async (opts: { allowTj?: string; retry?: Retry } = {}): Promise<boolean> => {
    if (!template) return false;
    if (pdfReady) return true;
    setBusy('pdf');
    try {
      const id = await persist({ allowTj: opts.allowTj, retry: opts.retry ?? ((tj) => void generate({ allowTj: tj })) });
      if (!id) return false;
      const m = await getMergeValues({ kind: 'offer', journeyId: id });
      const v = { ...m.values, ...formValues, ...edits };
      const still = missingFields(template.body, v, m.missing);
      if (still.length) { flash(`Fill ${still.map(fieldLabel).join(', ')} first`, 'error'); return false; }
      let ann = annex;
      if (withAnnex && pay) {
        const b = await getSalaryBreakup(id, breakupTemplate || undefined).catch(() => null);
        ann = b?.breakup ? annexureHtml(b.breakup, name) : '';
      }
      const blob = await letterPdf(template.body, v, { ...head, company: v.companyName || company, address: v.companyAddress, refNo: v.refNo || head.refNo }, fileName, ann);
      await uploadOfferPdf(id, blob, fileName);
      setPdf({ blob, key: JSON.stringify([letterId, v, ann]) });
      setRev((n) => n + 1);
      flash('Offer letter generated');
      return true;
    } catch (e) { flash(errText(e, 'Could not make the PDF'), 'error'); return false; } finally { setBusy(''); }
  };

  /** Sends the offer (saved and its PDF made first): from the email card and from the full email panel. */
  const sendMail = async (mail: MailOut, allowTj?: string): Promise<boolean> => {
    if (!(await generate({ allowTj, retry: (tj) => void sendMail(mail, tj) }))) return false;
    setBusy('send');
    try {
      await sendOffer(idRef.current, { subject: mail.subject, body: mail.body, cc: mail.cc, withPortalLink: mail.withPortalLink, attachments: mail.attachments });
      flash(`Offer sent to ${first || mail.to}`);
      setRev((n) => n + 1);
      return true;
    } catch (e) { flash(errText(e, 'Could not send the offer'), 'error'); return false; } finally { setBusy(''); }
  };

  /** The email panel's Save draft: the offer is saved, and the email kept on its offer letter until it is sent. */
  const saveEmailDraft = async (mail: MailOut, allowTj?: string) => {
    if (!template) return;
    setBusy('draft');
    try {
      const id = await persist({ allowTj, retry: (tj) => void saveEmailDraft(mail, tj) });
      if (!id) return;
      const row = savedDraft ?? await createLetter({ kind: 'offer', journeyId: id, templateId: letterId, values });
      await saveLetterDraft(row.id, { to: mail.to, cc: mail.cc, subject: mail.subject, body: mail.body, withPortalLink: mail.withPortalLink, attachments: mail.attachments });
      flash('Email draft saved');
      setRev((n) => n + 1);
    } catch (e) { flash(errText(e, 'Could not save the draft'), 'error'); } finally { setBusy(''); }
  };

  /** The suggested extras (H3c): Annexure A on its own and the joining checklist, on the letterhead. */
  const makeExtra = async (which: 'salary_breakup' | 'joining_checklist'): Promise<{ blob: Blob; name: string } | null> => {
    const docHead = { ...head, title: which === 'salary_breakup' ? 'Annexure A · Salary breakup' : 'Joining checklist' };
    if (which === 'salary_breakup') {
      if (!breakup?.breakup) return null;
      const n = `Salary breakup (Annexure A) – ${name}.pdf`.replace(/[/\\:*?"<>|]/g, '');
      return { blob: await htmlToPdfBlob(simpleDocument(docHead, annexureHtml(breakup.breakup, name)), n), name: n };
    }
    const n = `Joining checklist – ${name}.pdf`.replace(/[/\\:*?"<>|]/g, '');
    const docs = (detail?.documents ?? []).map((x) => ({ label: x.label, required: x.required }));
    return { blob: await htmlToPdfBlob(simpleDocument(docHead, checklistHtml(name, docs, journey?.day1Pass?.bring ?? [], values.joiningDate)), n), name: n };
  };

  if (!pay) {
    return (
      <section className="pd-card">
        <div className="pd-note">Only people with payroll access make and change offers: the offer letter states the CTC. The other letters are in the tabs above.</div>
      </section>
    );
  }
  if (!person) return <section className="pd-card"><SkeletonLines lines={6} /></section>;
  if (letterTemplates && letterTemplates.length === 0) {
    return (
      <section className="pd-card">
        {loadError ? <LoadError text={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : <div className="pd-empty">There is no offer letter template yet. Add one in Setup › Employee lifecycle › Document templates.</div>}
      </section>
    );
  }

  const lock = closed || Boolean(busy);
  const err = (k: OfferFormKey) => errors[k] ?? (formMissing.has(k) ? NEEDED : undefined);
  const style = (k: OfferFormKey) => ({ ...inputStyle, ...(err(k) ? missingInput : null) });
  const managers = emps.filter((e) => !e.exit?.left).sort((a, b) => a.name.localeCompare(b.name));
  const probationChoices = [...new Set([6, 3, fields.probationMonths].filter((n) => n > 0))].sort((a, b) => b - a);
  const source = isNew
    ? `A new offer. The offer, the portal link and their login go to their personal email; Save draft adds ${first || 'them'} to the board as a draft.`
    : closed ? `${first || 'Their'}’s offer is closed, so it can no longer change.`
      : sentVersion && offer
        ? `Version ${offer.version} went to ${first || 'them'}${offer.sentAt ? ` on ${shortDay(offer.sentAt)}` : ''}${offer.acceptedAt ? ' and was accepted' : ''}. Saving a change makes version ${offer.version + 1}: they see what changed and accept again${offer.finalisedAt ? ', and you finalise again' : ''}.`
        : `Filled from the offer HR created for ${first || 'them'}${offer && offer.version > 1 ? ` (version ${offer.version}, not sent yet)` : ''}. Edit here; Save draft keeps it.`;

  return (
    <>
      <DocActions onSave={() => void saveDraft()} saving={busy === 'draft'} canSave={dirty && !closed}
        onMail={() => setMailOpen(true)} canMail={Boolean(template) && !closed}
        onGenerate={() => void generate()} generating={busy === 'pdf'} generated={pdfReady} missing={missing.length} disabled={lock || !ready} />

      <div className="lf-doc-grid">
        <section className="pd-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <DetailsHead missing={missing.length} ready={ready} />
          <Field label="Joiner">
            <Pick value={person.key} onChange={onPerson} ariaLabel="Joiner">
              {people.map((p) => <option key={p.key} value={p.key}>{p.key === NEW_JOINER ? '+ New joiner' : `${p.name}${p.sub ? ` · ${p.sub}` : ''}`}</option>)}
            </Pick>
          </Field>
          <SourceNote>{source}</SourceNote>
          {loadError && <LoadError compact text={loadError} onRetry={() => setAttempt((n) => n + 1)} />}
          {!isNew && !detail ? <SkeletonLines lines={8} /> : (
            <FieldGrid>
              <Field label="Full name" required={isNew} error={err('name')}>
                <input value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }} readOnly={!isNew}
                  placeholder="e.g. Kabir Mehta" style={{ ...style('name'), ...(isNew ? null : { color: 'var(--ink-2)' }) }} autoFocus={isNew} />
              </Field>
              {isNew && <>
                <Field label="Personal email" required error={errors.email}>
                  <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors((x) => ({ ...x, email: undefined })); }} placeholder="name@example.com" style={{ ...inputStyle, ...(errors.email ? missingInput : null) }} />
                </Field>
                <Field label="Phone">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91" style={inputStyle} />
                </Field>
                <Field label="Onboarding template">
                  <Pick value={templateId} ariaLabel="Onboarding template" onChange={(id) => {
                    setTemplateId(id);
                    const months = templates.find((x) => x.id === id)?.settings.probationMonths;
                    if (months) set('probationMonths', months);
                  }}>
                    {templates.length === 0 && <option value="">The default</option>}
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
                  </Pick>
                </Field>
              </>}
              <Field label={OFFER_FIELD_LABEL.designation} required error={err('designation')}>
                <input value={fields.designation} onChange={(e) => set('designation', e.target.value)} list="lf-designations" placeholder="e.g. Product Designer" disabled={closed} style={style('designation')} />
              </Field>
              <Field label={OFFER_FIELD_LABEL.department} error={err('department')}>
                <input value={fields.department ?? ''} onChange={(e) => set('department', e.target.value)} list="lf-departments" placeholder="e.g. Design" disabled={closed} style={style('department')} />
              </Field>
              <Field label={OFFER_FIELD_LABEL.managerUserId} error={err('managerUserId')}>
                <Pick value={fields.managerUserId ?? ''} onChange={(v) => set('managerUserId', v)} disabled={closed} ariaLabel={OFFER_FIELD_LABEL.managerUserId}>
                  <option value="">Not decided yet</option>
                  {managers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role ? ` · ${m.role}` : ''}</option>)}
                </Pick>
              </Field>
              <Field label={OFFER_FIELD_LABEL.location} error={err('location')}>
                <input value={fields.location ?? ''} onChange={(e) => set('location', e.target.value)} list="lf-locations" placeholder="e.g. Main Campus, New Delhi" disabled={closed} style={style('location')} />
              </Field>
              <Field label={OFFER_FIELD_LABEL.tj} required error={err('tj')}
                hint={allowedTj && allowedTj === fields.tj ? 'A week-off or holiday, kept as you chose' : undefined}>
                <input type="date" value={fields.tj} min={todayKey()} onChange={(e) => set('tj', e.target.value)} disabled={closed} style={style('tj')} />
              </Field>
              {nonWorking && nonWorking.tj === fields.tj && (
                <div role="alert" style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 12, background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', color: 'var(--warn)', fontSize: 12.5, lineHeight: 1.5 }}>
                  <span style={{ flex: '1 1 220px', minWidth: 0 }}>{nonWorking.text || `${longDay(nonWorking.tj)} is a week-off or a holiday.`}</span>
                  <button type="button" className="pd-btn sm" disabled={Boolean(busy)} onClick={() => {
                    const { tj, retry } = nonWorking;
                    setAllowedTj(tj);
                    setNonWorking(null);
                    retry(tj);
                  }}>Use this date anyway</button>
                </div>
              )}
              <Field label={`${OFFER_FIELD_LABEL.ctc} (₹)`} required error={err('ctc')}>
                <input type="number" min={0} step={1000} value={fields.ctc || ''} onChange={(e) => set('ctc', Number(e.target.value) || 0)} placeholder="e.g. 1400000" disabled={closed} style={style('ctc')} />
              </Field>
              <Field label={OFFER_FIELD_LABEL.probationMonths} error={err('probationMonths')}>
                <Pick value={String(fields.probationMonths)} onChange={(v) => set('probationMonths', Number(v))} disabled={closed} ariaLabel={OFFER_FIELD_LABEL.probationMonths}>
                  {probationChoices.map((n) => <option key={n} value={String(n)}>{n} month{n === 1 ? '' : 's'}</option>)}
                </Pick>
              </Field>
              <Field label={`${OFFER_FIELD_LABEL.noticeDays} (days)`} error={err('noticeDays')}>
                <input type="number" min={0} value={fields.noticeDays} onChange={(e) => set('noticeDays', Number(e.target.value) || 0)} disabled={closed} style={style('noticeDays')} />
              </Field>
              <Field label={OFFER_FIELD_LABEL.validTill} required error={err('validTill')}>
                <input type="date" value={fields.validTill} min={todayKey()} onChange={(e) => set('validTill', e.target.value)} disabled={closed} style={style('validTill')} />
              </Field>
              <Field label={OFFER_FIELD_LABEL.employeeType}>
                <Pick value={fields.employeeType ?? 'full_time'} onChange={(v) => set('employeeType', v as OfferFields['employeeType'])} disabled={closed} ariaLabel={OFFER_FIELD_LABEL.employeeType}>
                  <option value="full_time">Full-time</option>
                  <option value="intern">Intern</option>
                  <option value="contract">Contract</option>
                </Pick>
              </Field>
              {letterTemplates && letterTemplates.length > 1 && (
                <Field label="Letter template">
                  <Pick value={letterId} onChange={(v) => { setLetterId(v); setPdf(null); }} ariaLabel="Letter template">
                    {letterTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
                  </Pick>
                </Field>
              )}
              <Field label={OFFER_FIELD_LABEL.responsibilities} wide error={err('responsibilities')} hint="Optional. Shows on the offer the candidate reads.">
                <textarea value={fields.responsibilities ?? ''} onChange={(e) => set('responsibilities', e.target.value)} disabled={closed} style={{ ...areaStyle, minHeight: 64 }} />
              </Field>
              {extraKeys.map((k) => {
                const miss = !filled(values, k);
                return (
                  <Field key={k} label={fieldLabel(k)} error={miss ? NEEDED : undefined} hint="For this letter only">
                    <input value={values[k] ?? ''} onChange={(e) => { setEdits((x) => ({ ...x, [k]: e.target.value })); }} style={{ ...inputStyle, ...(miss ? missingInput : null) }} />
                  </Field>
                );
              })}
              {withAnnex && (
                <Field label="Annexure A · salary breakup" wide hint={breakup?.breakup ? `Added as the letter’s last page, from the ${breakup.breakup.templateName} salary structure.` : isNew ? 'Worked out from the CTC once the offer is saved.' : undefined}>
                  {isNew ? null : !breakup ? <SkeletonLines lines={1} />
                    : breakup.templates.length > 1 ? (
                      <Pick value={breakup.templateCode ?? ''} onChange={setBreakupTemplate}>
                        {breakup.templates.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                      </Pick>
                    ) : breakup.breakup ? <input value={breakup.breakup.templateName} readOnly style={{ ...inputStyle, color: 'var(--ink-2)' }} /> : null}
                  {breakup && !breakup.breakup && <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 4 }}>{breakup.reason ?? 'The salary breakup could not be worked out'}. The letter goes without Annexure A.</div>}
                </Field>
              )}
              <datalist id="lf-designations">{choices.designations.map((d) => <option key={d} value={d} />)}</datalist>
              <datalist id="lf-departments">{choices.departments.map((d) => <option key={d} value={d} />)}</datalist>
              <datalist id="lf-locations">{choices.locations.map((d) => <option key={d} value={d} />)}</datalist>
            </FieldGrid>
          )}
          {template && !closed && (isNew || detail) && (
            <EmailCard kind="offer" first={first} to={to} toFixed values={values} company={company} hrName={hrName} manager={manager}
              draft={savedDraft?.email} missing={missing.length} busy={busy} onSend={(mail) => sendMail(mail)} onOpen={() => setMailOpen(true)} />
          )}
          <EarlierLetters earlier={earlier} first={first} name={name} onView={(fileId, n) => setPreview({ fileId, name: n })} />
        </section>

        <PreviewCard templateName={template?.name} loading={!ready}
          onEdit={template && canEditTemplates ? () => onEditTemplate(template.id) : undefined}
          html={template ? letterInner(template.body, values, head, 'preview', annex) : ''} />
      </div>

      {mailOpen && template && (
        <MailPanel kind="offer" values={values} name={name} to={to} manager={manager} company={company} hrName={hrName}
          missing={missing.length} pdfReady={pdfReady} fileName={fileName} busy={busy} draft={savedDraft?.email}
          annexInLetter={Boolean(annex)} journeyId={journeyId || undefined}
          canBreakup={Boolean(breakup?.breakup)} canChecklist={Boolean(journeyId)}
          makeExtra={makeExtra}
          onPreview={() => {
            if (pdf && pdf.key === valuesKey) setPreview({ blob: pdf.blob, name: fileName });
            else if (offer?.pdfFileId) setPreview({ fileId: offer.pdfFileId, name: fileName });
          }}
          onSaveDraft={(mail) => void saveEmailDraft(mail)}
          onClose={() => setMailOpen(false)}
          onSend={async (mail) => { if (await sendMail(mail)) setMailOpen(false); }} />
      )}
      {preview?.blob && <BlobPreview blob={preview.blob} name={preview.name} onClose={() => setPreview(null)} />}
      {preview?.fileId && <FilePreview fileId={preview.fileId} name={preview.name} onClose={() => setPreview(null)} />}
    </>
  );
}
