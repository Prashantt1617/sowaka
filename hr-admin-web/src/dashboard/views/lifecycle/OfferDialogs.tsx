// The offer, from the board: New offer (the candidate and the terms), the
// offer letter made from the company's offer letter template and uploaded as
// a PDF, then the email that sends it with the portal link. Revise offer runs
// the same three steps as the next version. Also Finalise and Mark joined.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../store';
import { canSeePay } from '../../access';
import {
  createOffer, finaliseOffer, getMergeValues, getSalaryBreakup, listLetterTemplates, listTemplates, markJoined, sendOffer, updateOffer, uploadOfferPdf,
} from '../../../services/lifecycle';
import type { JourneyView, LetterTemplateDTO, OfferFields, OfferView, SalaryBreakup, TemplateListItem } from '../../../services/lifecycle';
import { BlobPreview, Field, Modal, Pick, Switch } from './shared';
import { addDays, areaStyle, errText, firstName, inputStyle, longDay, rupees, todayKey } from './format';
import { annexureHtml, emailDraft, fieldLabel, LETTER_CSS, LETTER_TITLE, letterFileName, letterInner, letterPdf, missingFields, takesAnnexure } from './letterDoc';
import { Spinner } from '../../ui';
import { useCompanyName, useOfferChoices } from './hooks';

type Step = 'details' | 'letter' | 'email';
const STEPS: [Step, string][] = [['details', 'Offer details'], ['letter', 'Offer letter'], ['email', 'Email']];

const blankFields = (): OfferFields => ({
  designation: '', department: '', location: '', ctc: 0, tj: addDays(todayKey(), 21), managerUserId: '',
  probationMonths: 6, noticeDays: 30, validTill: addDays(todayKey(), 7), responsibilities: '', employeeType: 'full_time',
});

/** The offer's terms: role, team, place, pay, dates, probation and notice. */
function OfferFieldsForm({ value, onChange, showPay, errors }: { value: OfferFields; onChange: (v: OfferFields) => void; showPay: boolean; errors: Partial<Record<keyof OfferFields, string>> }) {
  const { emps } = useStore();
  const choices = useOfferChoices();
  const set = <K extends keyof OfferFields>(k: K, v: OfferFields[K]) => onChange({ ...value, [k]: v });
  const managers = useMemo(() => emps.filter((e) => !e.exit?.left).sort((a, b) => a.name.localeCompare(b.name)), [emps]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
      <Field label="Designation" required error={errors.designation}>
        <input value={value.designation} onChange={(e) => set('designation', e.target.value)} list="lf-designations" placeholder="e.g. Product Designer" style={inputStyle} />
      </Field>
      <Field label="Department">
        <input value={value.department ?? ''} onChange={(e) => set('department', e.target.value)} list="lf-departments" placeholder="e.g. Design" style={inputStyle} />
      </Field>
      <Field label="Work location">
        <input value={value.location ?? ''} onChange={(e) => set('location', e.target.value)} list="lf-locations" placeholder="e.g. Main Campus, New Delhi" style={inputStyle} />
      </Field>
      <Field label="Reporting manager">
        <Pick value={value.managerUserId ?? ''} onChange={(v) => set('managerUserId', v)}>
          <option value="">Not decided yet</option>
          {managers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role ? ` · ${m.role}` : ''}</option>)}
        </Pick>
      </Field>
      <Field label="Joining date" required error={errors.tj}>
        <input type="date" value={value.tj} min={todayKey()} onChange={(e) => set('tj', e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Offer valid till" required error={errors.validTill}>
        <input type="date" value={value.validTill} min={todayKey()} onChange={(e) => set('validTill', e.target.value)} style={inputStyle} />
      </Field>
      {showPay && (
        <Field label="Yearly CTC (₹)" required error={errors.ctc} hint={value.ctc > 0 ? rupees(value.ctc) : 'Never shown to the manager'}>
          <input type="number" min={0} step={1000} value={value.ctc || ''} onChange={(e) => set('ctc', Number(e.target.value) || 0)} placeholder="e.g. 1400000" style={inputStyle} />
        </Field>
      )}
      <Field label="Employment type">
        <Pick value={value.employeeType ?? 'full_time'} onChange={(v) => set('employeeType', v as OfferFields['employeeType'])}>
          <option value="full_time">Full-time</option>
          <option value="intern">Intern</option>
          <option value="contract">Contract</option>
        </Pick>
      </Field>
      <Field label="Probation">
        <Pick value={String(value.probationMonths)} onChange={(v) => set('probationMonths', Number(v))}>
          <option value="6">6 months</option>
          <option value="3">3 months</option>
        </Pick>
      </Field>
      <Field label="Notice period (days)" error={errors.noticeDays}>
        <input type="number" min={0} value={value.noticeDays} onChange={(e) => set('noticeDays', Number(e.target.value) || 0)} style={inputStyle} />
      </Field>
      <Field label="Responsibilities" wide hint="Optional. Shows on the offer the candidate reads.">
        <textarea value={value.responsibilities ?? ''} onChange={(e) => set('responsibilities', e.target.value)} style={{ ...areaStyle, minHeight: 70 }} />
      </Field>
      <datalist id="lf-designations">{choices.designations.map((d) => <option key={d} value={d} />)}</datalist>
      <datalist id="lf-departments">{choices.departments.map((d) => <option key={d} value={d} />)}</datalist>
      <datalist id="lf-locations">{choices.locations.map((d) => <option key={d} value={d} />)}</datalist>
    </div>
  );
}

function validate(f: OfferFields, needPay: boolean): Partial<Record<keyof OfferFields, string>> {
  const e: Partial<Record<keyof OfferFields, string>> = {};
  if (!f.designation.trim()) e.designation = 'Needed for the offer';
  if (needPay && !(f.ctc > 0)) e.ctc = 'Enter the yearly CTC';
  if (!f.tj) e.tj = 'Pick the joining date';
  if (!f.validTill) e.validTill = 'Pick a date';
  else if (f.tj && f.validTill > f.tj) e.validTill = 'The offer should close before the joining day';
  if (f.noticeDays < 0) e.noticeDays = 'Days, 0 or more';
  return e;
}

function Steps({ step }: { step: Step }) {
  const at = STEPS.findIndex(([k]) => k === step);
  return (
    <div className="pd-steps" aria-label="Steps">
      {STEPS.map(([k, label], i) => (
        <span key={k} className={`pd-step${i === at ? ' on' : i < at ? ' done' : ''}`} style={{ cursor: 'default', height: 36 }} aria-current={i === at ? 'step' : undefined}>
          <i>{i < at ? '✓' : i + 1}</i>{label}
        </span>
      ))}
    </div>
  );
}

/**
 * New offer, Revise offer, or Send / Resend an offer already made. `start`
 * picks the first step: a draft without its letter starts at the letter, a
 * resend goes straight to the email.
 */
export function OfferWizard({ mode, journey, offer, start, onClose, onDone }: {
  mode: 'new' | 'revise' | 'send';
  journey?: JourneyView;
  offer?: OfferView | null;
  start?: Step;
  onClose: () => void;
  /** After the offer is saved or sent: the journey to open. */
  onDone: (journeyId: string, sent: boolean) => void;
}) {
  const { user, emps, flash } = useStore();
  const company = useCompanyName();
  const pay = canSeePay(user);
  const [step, setStep] = useState<Step>(start ?? (mode === 'send' ? (offer?.pdfFileId ? 'email' : 'letter') : 'details'));
  const [journeyId, setJourneyId] = useState(journey?.id ?? '');
  const [name, setName] = useState(journey?.candidate?.name ?? '');
  const [email, setEmail] = useState(journey?.candidate?.personalEmail ?? '');
  const [phone, setPhone] = useState(journey?.candidate?.phone ?? '');
  const [fields, setFields] = useState<OfferFields>(() => {
    if (!offer) return blankFields();
    // The view adds the manager's name; the offer itself keeps only their id.
    const f: OfferFields & { managerName?: string } = { ...blankFields(), ...offer.fields };
    delete f.managerName;
    return f;
  });
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof OfferFields | 'name' | 'email', string>>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Letter step.
  const [letterTemplates, setLetterTemplates] = useState<LetterTemplateDTO[] | null>(null);
  const [letterId, setLetterId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [serverMissing, setServerMissing] = useState<string[]>([]);
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [uploaded, setUploaded] = useState(Boolean(offer?.pdfFileId) && mode === 'send');
  const [previewing, setPreviewing] = useState(false);
  const [breakup, setBreakup] = useState<SalaryBreakup | null>(null);

  // Email step.
  const manager = emps.find((e) => e.id === (fields.managerUserId || journey?.managerUserId));
  const [ccManager, setCcManager] = useState(true);
  const [ccOther, setCcOther] = useState('');
  const [withLink, setWithLink] = useState(true);
  const draft = emailDraft('offer', { ...values, name, designation: fields.designation, validTill: values.validTill || values.valid || longDay(fields.validTill) }, { company, hrName: user?.name ?? 'HR', withLink: true });
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (mode !== 'new') return;
    listTemplates('onboarding').then((t) => {
      const active = t.filter((x) => x.active);
      setTemplates(active);
      const def = active.find((x) => x.isDefault) ?? active[0];
      if (def) {
        setTemplateId(def.id);
        if (def.settings.probationMonths) setFields((f) => ({ ...f, probationMonths: def.settings.probationMonths! }));
      }
    }).catch(() => setTemplates([]));
  }, [mode]);

  // The offer letter template and the values from the offer, once there is an offer.
  useEffect(() => {
    if (step !== 'letter' || !journeyId) return;
    let live = true;
    setError('');
    Promise.all([listLetterTemplates('offer'), getMergeValues({ kind: 'offer', journeyId })])
      .then(([t, m]) => {
        if (!live) return;
        setLetterTemplates(t);
        setLetterId((id) => id || (t.find((x) => x.isDefault) ?? t[0])?.id || '');
        setValues(m.values);
        setServerMissing(m.missing);
      })
      .catch((e) => { if (live) { setLetterTemplates([]); setError(errText(e, 'Could not load the offer letter template')); } });
    return () => { live = false; };
  }, [step, journeyId]);

  useEffect(() => {
    if (step === 'email' && !subject && !body) { setSubject(draft.subject); setBody(draft.body); }
    // The draft is written once, when the email step first opens; HR's edits stay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Annexure A: the salary breakup the offer letter promises, from the company's salary template (pay only).
  useEffect(() => {
    if (step !== 'letter' || !journeyId || !pay) return;
    let live = true;
    getSalaryBreakup(journeyId).then((b) => { if (live) setBreakup(b); }).catch(() => { if (live) setBreakup(null); });
    return () => { live = false; };
  }, [step, journeyId, pay]);

  const template = letterTemplates?.find((t) => t.id === letterId);
  const missing = template ? missingFields(template.body, values, serverMissing) : [];
  const head = { company: values.companyName || company, address: values.companyAddress, refNo: values.refNo, title: LETTER_TITLE.offer };
  const withAnnex = Boolean(template && takesAnnexure('offer', template.body));
  const annex = withAnnex && breakup?.breakup ? annexureHtml(breakup.breakup, name) : '';

  const saveDetails = async () => {
    const e: typeof errors = validate(fields, pay);
    if (mode === 'new') {
      if (!name.trim()) e.name = 'Enter their name';
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = 'Enter their personal email';
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy('details'); setError('');
    try {
      const clean: OfferFields = { ...fields, managerUserId: fields.managerUserId || undefined, department: fields.department?.trim() || undefined, location: fields.location?.trim() || undefined, responsibilities: fields.responsibilities?.trim() || undefined, designation: fields.designation.trim() };
      if (mode === 'new' && !journeyId) {
        const r = await createOffer({ candidate: { name: name.trim(), personalEmail: email.trim(), phone: phone.trim() || undefined }, fields: clean, templateId: templateId || undefined });
        setJourneyId(r.journeyId);
      } else if (journeyId) {
        await updateOffer(journeyId, clean);
        setUploaded(false); setPdf(null);
      }
      setStep('letter');
    } catch (err) { setError(errText(err, 'Could not save the offer')); } finally { setBusy(''); }
  };

  const makePdf = async () => {
    if (!template || missing.length) return;
    setBusy('pdf'); setError('');
    try {
      const fileName = letterFileName('offer', name);
      const blob = await letterPdf(template.body, values, head, fileName, annex);
      await uploadOfferPdf(journeyId, blob, fileName);
      setPdf(blob); setUploaded(true);
      flash('Offer letter made and attached');
    } catch (err) { setError(errText(err, 'Could not make the PDF')); } finally { setBusy(''); }
  };

  const send = async () => {
    if (!subject.trim() || !body.trim()) { setError('Write a subject and a message'); return; }
    setBusy('send'); setError('');
    try {
      const cc = [ccManager && manager?.email ? manager.email : '', ...ccOther.split(/[,\s]+/)].map((x) => x.trim()).filter(Boolean);
      await sendOffer(journeyId, { subject: subject.trim(), body, cc: cc.length ? cc : undefined, withPortalLink: withLink });
      flash(`Offer sent to ${firstName(name)}`);
      onDone(journeyId, true);
    } catch (err) { setError(errText(err, 'Could not send the offer')); setBusy(''); }
  };

  const title = mode === 'new' ? 'New offer letter' : mode === 'revise' ? `Revise ${firstName(name)}’s offer` : `Send ${firstName(name)}’s offer`;
  const sub = mode === 'revise' && offer
    ? `Version ${offer.version + (offer.status === 'draft' ? 0 : 1)}. ${offer.status === 'draft' ? 'Not sent yet, so this edits it in place.' : 'They see what changed and accept again; if you had finalised, you finalise again.'}`
    : mode === 'new' ? 'The candidate reads and accepts it on their portal, from the link in the email.' : undefined;

  let footer: ReactNode;
  if (step === 'details') {
    footer = <>
      <button type="button" className="pd-btn" onClick={onClose} disabled={Boolean(busy)}>Cancel</button>
      <button type="button" className="pd-btn primary" onClick={() => void saveDetails()} disabled={Boolean(busy) || (!pay && mode !== 'send')}>{busy ? 'Saving…' : 'Next: offer letter'}</button>
    </>;
  } else if (step === 'letter') {
    footer = <>
      <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--ink-3)' }}>{journeyId ? 'Saved as a draft. Close any time and send it later from the board.' : ''}</span>
      {mode !== 'send' && <button type="button" className="pd-btn" onClick={() => setStep('details')} disabled={Boolean(busy)}>Back</button>}
      {!uploaded
        ? <button type="button" className="pd-btn primary" onClick={() => void makePdf()} disabled={Boolean(busy) || !template || missing.length > 0}>{busy === 'pdf' ? 'Making the PDF…' : 'Make the PDF'}</button>
        : <button type="button" className="pd-btn primary" onClick={() => setStep('email')}>Next: email</button>}
    </>;
  } else {
    footer = <>
      {!(mode === 'send' && start === 'email') && <button type="button" className="pd-btn" onClick={() => setStep('letter')} disabled={Boolean(busy)}>Back</button>}
      <button type="button" className="pd-btn primary" onClick={() => void send()} disabled={Boolean(busy) || !uploaded}>{busy === 'send' ? 'Sending…' : 'Send email'}</button>
    </>;
  }

  return (
    <Modal title={title} sub={sub} onClose={() => { if (journeyId && !busy) onDone(journeyId, false); else onClose(); }} busy={Boolean(busy)} width={step === 'letter' ? 940 : 720} footer={footer}>
      <Steps step={step} />
      {error && <div role="alert" style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</div>}

      {step === 'details' && <>
        {mode === 'new' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
            <Field label="Candidate’s full name" required error={errors.name}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kabir Mehta" style={inputStyle} autoFocus />
            </Field>
            <Field label="Personal email" required error={errors.email} hint="The offer, the portal link and their login go here">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" style={inputStyle} />
            </Field>
            <Field label="Phone">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91" style={inputStyle} />
            </Field>
            <Field label="Onboarding template" hint="The tasks they get, from the offer to confirmation">
              <Pick value={templateId} onChange={setTemplateId}>
                {templates.length === 0 && <option value="">The default</option>}
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
              </Pick>
            </Field>
          </div>
        )}
        {!pay && <div className="pd-note">Only people with payroll access can set the yearly CTC, so they make and change offers.</div>}
        <OfferFieldsForm value={fields} onChange={setFields} showPay={pay} errors={errors} />
      </>}

      {step === 'letter' && (
        letterTemplates === null ? <div style={{ padding: 30, textAlign: 'center' }}><Spinner label="Filling in the offer letter…" /></div>
          : letterTemplates.length === 0 ? <div className="pd-note">There is no offer letter template yet. Add one in Setup › Employee lifecycle › Document templates, then come back to this draft from the board.</div>
            : (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
                <div style={{ display: 'grid', gap: 12 }}>
                  <Field label="Template">
                    <Pick value={letterId} onChange={(v) => { setLetterId(v); setUploaded(false); setPdf(null); }}>
                      {letterTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
                    </Pick>
                  </Field>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: missing.length ? 'var(--bad)' : 'var(--ok)' }}>
                    {missing.length ? `${missing.length} field${missing.length === 1 ? '' : 's'} missing` : 'All details filled'}
                  </div>
                  {missing.map((k) => (
                    <Field key={k} label={fieldLabel(k)} hint="Needed for this letter">
                      <input value={values[k] ?? ''} onChange={(e) => { setValues((v) => ({ ...v, [k]: e.target.value })); setUploaded(false); }} style={{ ...inputStyle, borderColor: '#E7B9A6', background: 'color-mix(in srgb, #FFF8F5 70%, var(--surface))' }} />
                    </Field>
                  ))}
                  {uploaded && pdf && <button type="button" className="pd-btn" onClick={() => setPreviewing(true)}>Preview the PDF</button>}
                  {uploaded && <div style={{ fontSize: 12.5, color: 'var(--ok)' }}>The PDF is attached to the offer.</div>}
                  {withAnnex && breakup && (
                    <div style={{ fontSize: 12, color: breakup.breakup ? 'var(--ink-3)' : 'var(--warn)' }}>
                      {breakup.breakup ? `Annexure A (salary breakup, ${breakup.breakup.templateName}) is the letter’s last page.` : `${breakup.reason ?? 'The salary breakup could not be worked out'}. The letter goes without Annexure A.`}
                    </div>
                  )}
                </div>
                <LetterPreview html={template ? letterInner(template.body, values, head, 'preview', annex) : ''} />
              </div>
            )
      )}

      {step === 'email' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            <div><span style={{ color: 'var(--ink-3)' }}>To </span>{name}{email ? ` · ${email}` : ''}</div>
            {manager && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Switch on={ccManager} onChange={setCcManager} label={`Copy ${manager.name}`} />
                <span>Cc {manager.name} (manager){manager.email ? ` · ${manager.email}` : ''}</span>
              </label>
            )}
          </div>
          <Field label="Also copy" hint="Optional. Emails, separated by commas">
            <input value={ccOther} onChange={(e) => setCcOther(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Subject" required>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Email body" required hint={withLink ? 'A “View and accept your offer” button with their personal link is added under your message.' : undefined}>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ ...areaStyle, minHeight: 220 }} />
          </Field>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13 }}>
            <Switch on={withLink} onChange={setWithLink} label="Add the portal link" />
            <span><b style={{ display: 'block', fontWeight: 500 }}>Add the portal link</b><span style={{ fontSize: 12, color: 'var(--ink-3)' }}>A “View and accept your offer” button in the email</span></span>
          </label>
          {!withLink && <div className="pd-note" style={{ color: 'var(--warn)' }}>Without the link they can’t read and accept the offer online. Send it again with the link if they ask.</div>}
          <div className="pd-li" style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '10px 12px' }}>
            <span className="pd-li-i" aria-hidden>PDF</span>
            <span className="grow"><b>{letterFileName('offer', name)}</b><span className="s">{uploaded ? 'Generated from the offer details' : 'Not generated yet'}</span></span>
            {pdf && <button type="button" className="pd-btn sm" onClick={() => setPreviewing(true)}>Preview</button>}
          </div>
        </div>
      )}
      {previewing && pdf && <BlobPreview blob={pdf} name={letterFileName('offer', name)} onClose={() => setPreviewing(false)} />}
    </Modal>
  );
}

/** The letter as it will print: a white page, highlighted fields. */
export function LetterPreview({ html, caption = true }: { html: string; caption?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <style>{LETTER_CSS}</style>
      <div style={{ background: '#fff', color: '#222', borderRadius: 6, border: '1px solid var(--line)', boxShadow: 'var(--shadow)', padding: '28px 30px', maxHeight: '62vh', overflowY: 'auto', colorScheme: 'light', overflowWrap: 'anywhere' }}
        dangerouslySetInnerHTML={{ __html: html }} />
      {caption && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8 }}>Highlighted text comes from the details on the left. Orange means it is still missing.</div>}
    </div>
  );
}

/** Finalise: HR accepts from their end; the portal login is made and emailed. */
export function FinaliseDialog({ journey, onClose, onDone }: { journey: JourneyView; onClose: () => void; onDone: () => void }) {
  const { flash } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = journey.candidate?.name ?? 'the candidate';
  const go = async () => {
    setBusy(true); setError('');
    try {
      await finaliseOffer(journey.id);
      flash(`Finalised. ${firstName(name)}’s login is on its way`);
      onDone();
    } catch (e) { setError(errText(e, 'Could not finalise')); setBusy(false); }
  };
  return (
    <Modal title={`Finalise ${firstName(name)}’s offer`} onClose={onClose} busy={busy} width={480}
      footer={<><button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="pd-btn primary" onClick={() => void go()} disabled={busy}>{busy ? 'Finalising…' : 'Finalise and send login'}</button></>}>
      <p style={{ margin: 0 }}>{name} accepted the offer. Finalising creates their portal account and emails the login and a password to <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{journey.candidate?.personalEmail ?? 'their personal email'}</b>.</p>
      <p style={{ margin: 0 }}>{journey.managerName ? `${journey.managerName} gets` : 'Their manager gets'} the set-up to-do in the app: people to meet, a welcome note and a buddy.</p>
      {error && <div role="alert" style={{ color: 'var(--bad)' }}>{error}</div>}
    </Modal>
  );
}

/** Mark joined: on the joining day, the employee record and the work email the app signs in with. */
export function MarkJoinedDialog({ journey, onClose, onDone }: { journey: JourneyView; onClose: () => void; onDone: (userId: string) => void }) {
  const { flash } = useStore();
  const [workEmail, setWorkEmail] = useState(journey.candidate?.workEmail ?? '');
  const [employeeId, setEmployeeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = journey.candidate?.name ?? 'They';
  const early = journey.tj ? journey.tj > todayKey() : false;
  const go = async () => {
    if (!/^\S+@\S+\.\S+$/.test(workEmail.trim())) { setError('Enter the work email'); return; }
    setBusy(true); setError('');
    try {
      const r = await markJoined(journey.id, { workEmail: workEmail.trim(), employeeId: employeeId.trim() || undefined });
      flash(`${firstName(name)} has joined. Their app signs in with ${workEmail.trim()}`);
      onDone(r.userId);
    } catch (e) { setError(errText(e, 'Could not mark them joined')); setBusy(false); }
  };
  return (
    <Modal title={`Mark ${firstName(name)} joined`} sub={journey.tj ? `Joining day ${longDay(journey.tj)}` : undefined} onClose={onClose} busy={busy} width={480}
      footer={<><button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="pd-btn primary" onClick={() => void go()} disabled={busy || early}>{busy ? 'Saving…' : 'Mark joined'}</button></>}>
      {early && <div className="pd-note">This opens on the joining day. If they are joining on another day, approve a new joining date first.</div>}
      <p style={{ margin: 0 }}>This adds them to the directory with the details from their accepted offer. The portal then shows the work email, and the app signs in with it and a one-time code.</p>
      <Field label="Work email" required>
        <input type="email" value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} placeholder="name@company.com" style={inputStyle} autoFocus />
      </Field>
      <Field label="Employee ID" hint="Optional. Leave empty to add it later from their profile.">
        <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} style={inputStyle} />
      </Field>
      {error && <div role="alert" style={{ color: 'var(--bad)' }}>{error}</div>}
    </Modal>
  );
}
