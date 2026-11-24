// Add user (24 Nov, HR): one form first, the same details the offer letter takes: name, personal email,
// phone, onboarding template, role, team, reporting manager, place, joining date, CTC, probation, notice,
// type and responsibilities. Continue then goes by the joining date:
// - already passed (or today): the Add employee wizard, its Basic details filled in from here (with the
//   personal email). Someone who joined within the last month also gets onboarding on the app and lands
//   in the employee lifecycle (the server starts their journey when the account is made);
// - still to come: two ways on. Send offer letter opens Documents › Offer letter with these details, to
//   send from the app; Confirm makes them confirmed on the onboarding board straight away (an offer
//   accepted outside the app), with or without emailing them the joining portal sign-in.
import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { ApiError } from '../../../services/http';
import { NON_WORKING_DAY, confirmOffer, listTemplates } from '../../../services/lifecycle';
import type { OfferFields, TemplateListItem } from '../../../services/lifecycle';
import { Field, Modal, Pick } from './shared';
import { OFFER_FIELD_LABEL, areaStyle, errText, firstName, inputStyle, longDay, todayKey } from './format';
import { useOfferChoices } from './hooks';
import { blankOfferFields, cleanOfferFields, validateOffer } from './offerValues';
import { FieldGrid, missingInput } from './DocumentParts';

type Errors = Partial<Record<keyof OfferFields | 'name' | 'email' | 'phone', string>>;

/** What the form took, for the wizard or the offer letter. */
export type NewUserDetails = {
  name: string; personalEmail: string; phone: string; templateId: string; fields: OfferFields;
};

export function AddUserDialog({ pay, canAddEmployee, canOffer, onClose, onDone, onJoined, onOffer }: {
  /** Payroll access: the CTC, and so the offer and the confirm. */
  pay: boolean;
  /** Access to People › Employees: the wizard, for a joining date that has passed. */
  canAddEmployee: boolean;
  /** Access to Documents › Offer letter. */
  canOffer: boolean;
  onClose: () => void;
  /** Confirmed on the onboarding board: their journey. */
  onDone: (journeyId: string) => void;
  /** The joining date has passed: on to the Add employee wizard. */
  onJoined: (d: NewUserDetails) => void;
  /** Still to join: on to the offer letter. */
  onOffer: (d: NewUserDetails) => void;
}) {
  const { emps, flash } = useStore();
  const choices = useOfferChoices();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [fields, setFields] = useState<OfferFields>(() => ({ ...blankOfferFields(), validTill: todayKey() }));
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [templateId, setTemplateId] = useState('');
  // On by default (24 Nov, HR): a confirmed joiner can do nothing until they know the portal exists.
  const [emailPortal, setEmailPortal] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Continue with a joining date still to come: Send offer letter or Confirm.
  const [ahead, setAhead] = useState(false);
  // The server refused the joining date (a week-off or holiday): what it said; `allowedTj` once HR keeps it.
  const [nonWorking, setNonWorking] = useState<{ tj: string; text: string } | null>(null);
  const [allowedTj, setAllowedTj] = useState('');

  // The onboarding templates (the default's probation) and the notice a resignation gets, as the offer form does.
  useEffect(() => {
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
  }, []);

  const set = <K extends keyof OfferFields>(k: K, v: OfferFields[K]) => {
    setFields((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const details = (): NewUserDetails => ({ name: name.trim(), personalEmail: email.trim(), phone: phone.trim(), templateId, fields });
  const joined = Boolean(fields.tj) && fields.tj <= todayKey();

  // Continue: who they are is always needed; a joiner still to come also needs the offer's details.
  const next = () => {
    const e: Errors = {};
    if (!name.trim()) e.name = 'Enter their name';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = 'Enter their personal email';
    if (phone.trim() && !/^\+?[\d\s-]{8,20}$/.test(phone.trim())) e.phone = 'Check the number';
    if (!fields.designation.trim()) e.designation = 'Enter their designation';
    if (!fields.tj) e.tj = 'Pick the joining date';
    if (fields.tj && !joined) {
      const offer: Errors = validateOffer(fields, pay);
      delete offer.validTill;
      for (const [k, v] of Object.entries(offer)) if (!e[k as keyof Errors]) e[k as keyof Errors] = v;
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setError('');
    if (joined) {
      if (!canAddEmployee) { setError('Adding someone who has already joined needs access to People › Employees.'); return; }
      onJoined(details());
    } else setAhead(true);
  };

  const confirm = async (allowTj?: string) => {
    const allow = Boolean(fields.tj) && (allowTj ?? allowedTj) === fields.tj;
    setBusy(true); setError(''); setNonWorking(null);
    try {
      const r = await confirmOffer({
        candidate: { name: name.trim(), personalEmail: email.trim(), phone: phone.trim() || undefined },
        fields: { ...cleanOfferFields(fields), validTill: todayKey() }, templateId: templateId || undefined, emailPortal,
      }, { allowNonWorkingDay: allow });
      flash(`${firstName(name)} is confirmed and on the onboarding board${emailPortal ? '. Their joining portal sign-in is on its way' : ''}`);
      onDone(r.journeyId);
    } catch (err) {
      if (err instanceof ApiError && err.code === NON_WORKING_DAY) setNonWorking({ tj: fields.tj, text: err.message });
      else setError(errText(err, 'Could not confirm them'));
      setBusy(false);
    }
  };

  const style = (k: keyof Errors) => ({ ...inputStyle, ...(errors[k] ? missingInput : null) });
  const managers = emps.filter((m) => !m.exit?.left).sort((a, b) => a.name.localeCompare(b.name));
  const probationChoices = [...new Set([6, 3, fields.probationMonths].filter((n) => n > 0))].sort((a, b) => b - a);
  const payNote = 'Needs payroll access: the offer states the CTC';

  if (ahead) {
    const who = firstName(name);
    const offerOff = !pay ? payNote : !canOffer ? 'Needs access to Employee lifecycle › Documents' : '';
    return (
      <Modal title={`${who || 'They'} join${who ? 's' : ''} on ${longDay(fields.tj)}`} width={560} onClose={onClose} busy={busy}
        sub="The joining date is still to come. Send the offer letter from the app, or confirm them now if they accepted an offer already."
        footer={<button type="button" className="pd-btn" onClick={() => { setAhead(false); setError(''); setNonWorking(null); }} disabled={busy}>← Back</button>}>
        <div className="au-opts" role="list">
          <button type="button" role="listitem" className="au-opt" disabled={Boolean(offerOff) || busy} title={offerOff || undefined}
            onClick={() => onOffer(details())}>
            <span className="au-ic" aria-hidden><DocIcon /></span>
            <span className="au-tx">
              <b>Send offer letter</b>
              <span>{offerOff || 'Opens the offer letter with these details filled in. Check it, then send it from the app.'}</span>
            </span>
            <Chevron />
          </button>
          <div role="listitem" className="au-opt" style={{ cursor: 'default', alignItems: 'flex-start' }}>
            <span className="au-ic" aria-hidden><TickIcon /></span>
            <span className="au-tx" style={{ gap: 8 }}>
              <b>Confirm</b>
              <span>They accepted an offer outside the app. They go on the onboarding board as confirmed; no offer letter is sent.</span>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={emailPortal} onChange={(e) => setEmailPortal(e.target.checked)} style={{ marginTop: 3 }} disabled={busy} />
                <span style={{ color: 'var(--ink-2)', fontSize: 13 }}>Send them an email with the joining portal sign-in</span>
              </label>
              {nonWorking && nonWorking.tj === fields.tj && (
                <span role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 10, background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', color: 'var(--warn)', fontSize: 12.5 }}>
                  <span style={{ flex: '1 1 200px', color: 'var(--warn)' }}>{nonWorking.text || `${longDay(nonWorking.tj)} is a week-off or a holiday.`}</span>
                  <button type="button" className="pd-btn sm" disabled={busy} onClick={() => { const { tj } = nonWorking; setAllowedTj(tj); void confirm(tj); }}>Use this date anyway</button>
                </span>
              )}
              <span style={{ display: 'flex' }}>
                <button type="button" className="pd-btn primary sm" onClick={() => void confirm()} disabled={busy || !pay} title={!pay ? payNote : undefined}>
                  {busy ? 'Confirming…' : 'Confirm user'}
                </button>
              </span>
            </span>
          </div>
        </div>
        {error && <div role="alert" style={{ color: 'var(--bad)', fontSize: 13, marginTop: 10 }}>{error}</div>}
      </Modal>
    );
  }

  return (
    <Modal title="Add user" width={720} onClose={onClose} busy={busy}
      sub="Their details once. A joining date that has passed adds them as an employee; a date still to come sends the offer letter or confirms them."
      footer={<>
        <button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="pd-btn primary" onClick={next} disabled={busy}>Continue</button>
      </>}>
      <FieldGrid>
        <Field label="Full name" required error={errors.name}>
          <input value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }} placeholder="e.g. Kabir Mehta" style={style('name')} autoFocus />
        </Field>
        <Field label="Personal email" required error={errors.email} hint="Their joining portal and onboarding use this email">
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors((x) => ({ ...x, email: undefined })); }} placeholder="name@example.com" style={style('email')} />
        </Field>
        <Field label="Phone" error={errors.phone}>
          <input value={phone} onChange={(e) => { setPhone(e.target.value); if (errors.phone) setErrors((x) => ({ ...x, phone: undefined })); }} placeholder="+91" style={style('phone')} />
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
        <Field label={OFFER_FIELD_LABEL.designation} required error={errors.designation}>
          <input value={fields.designation} onChange={(e) => set('designation', e.target.value)} list="cj-designations" placeholder="e.g. Product Designer" style={style('designation')} />
        </Field>
        <Field label={OFFER_FIELD_LABEL.department} error={errors.department}>
          <input value={fields.department ?? ''} onChange={(e) => set('department', e.target.value)} list="cj-departments" placeholder="e.g. Design" style={style('department')} />
        </Field>
        <Field label={OFFER_FIELD_LABEL.managerUserId} required={!joined} error={errors.managerUserId}>
          <Pick value={fields.managerUserId ?? ''} onChange={(v) => set('managerUserId', v)} ariaLabel={OFFER_FIELD_LABEL.managerUserId}>
            <option value="">Choose</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role ? ` · ${m.role}` : ''}</option>)}
          </Pick>
        </Field>
        <Field label={OFFER_FIELD_LABEL.location} error={errors.location}>
          <input value={fields.location ?? ''} onChange={(e) => set('location', e.target.value)} list="cj-locations" placeholder="e.g. Main Campus, New Delhi" style={style('location')} />
        </Field>
        <Field label={OFFER_FIELD_LABEL.tj} required error={errors.tj}
          hint={!fields.tj ? undefined
            : joined ? 'Already joined: next you add them as an employee'
            : allowedTj && allowedTj === fields.tj ? 'A week-off or holiday, kept as you chose' : 'Still to join: next you send the offer letter or confirm them'}>
          <input type="date" value={fields.tj} onChange={(e) => set('tj', e.target.value)} style={style('tj')} />
        </Field>
        {pay && (
          <Field label={`${OFFER_FIELD_LABEL.ctc} (₹)`} required={!joined} error={errors.ctc}>
            <input type="number" min={0} step={1000} value={fields.ctc || ''} onChange={(e) => set('ctc', Number(e.target.value) || 0)} placeholder="e.g. 1400000" style={style('ctc')} />
          </Field>
        )}
        <Field label={OFFER_FIELD_LABEL.probationMonths}>
          <Pick value={String(fields.probationMonths)} onChange={(v) => set('probationMonths', Number(v))} ariaLabel={OFFER_FIELD_LABEL.probationMonths}>
            {probationChoices.map((n) => <option key={n} value={String(n)}>{n} month{n === 1 ? '' : 's'}</option>)}
          </Pick>
        </Field>
        <Field label={`${OFFER_FIELD_LABEL.noticeDays} (days)`} error={errors.noticeDays}>
          <input type="number" min={0} value={fields.noticeDays} onChange={(e) => set('noticeDays', Number(e.target.value) || 0)} style={style('noticeDays')} />
        </Field>
        <Field label={OFFER_FIELD_LABEL.employeeType}>
          <Pick value={fields.employeeType ?? 'full_time'} onChange={(v) => set('employeeType', v as OfferFields['employeeType'])} ariaLabel={OFFER_FIELD_LABEL.employeeType}>
            <option value="full_time">Full-time</option>
            <option value="intern">Intern</option>
            <option value="contract">Contract</option>
          </Pick>
        </Field>
        <Field label={OFFER_FIELD_LABEL.responsibilities} wide hint="Optional">
          <textarea value={fields.responsibilities ?? ''} onChange={(e) => set('responsibilities', e.target.value)} style={{ ...areaStyle, minHeight: 64 }} />
        </Field>
        <datalist id="cj-designations">{choices.designations.map((d) => <option key={d} value={d} />)}</datalist>
        <datalist id="cj-departments">{choices.departments.map((d) => <option key={d} value={d} />)}</datalist>
        <datalist id="cj-locations">{choices.locations.map((d) => <option key={d} value={d} />)}</datalist>
      </FieldGrid>
      {error && <div role="alert" style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</div>}
    </Modal>
  );
}

const ICON = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function DocIcon() { return <svg {...ICON}><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" /><path d="M14 3v5h5M8.5 13h7M8.5 17h4.5" /></svg>; }
function TickIcon() { return <svg {...ICON}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.7 2.7L16.5 9.5" /></svg>; }
function Chevron() { return <svg className="au-go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>; }
