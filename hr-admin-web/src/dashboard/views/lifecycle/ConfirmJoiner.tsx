// Add user › Confirm new user: someone who already accepted an offer outside the app (no offer
// letter from Sowaka). The same details the offer letter takes (Documents › Offer letter's form,
// without its letter and email): name, personal email, phone, onboarding template, role, team,
// reporting manager, place, joining date, CTC, probation, notice, type and responsibilities. Saving
// makes the joiner confirmed (finalised) on the onboarding board, ready for the employee profile and
// the joining steps, and emails nobody unless HR ticks the joining portal sign-in.
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

export function ConfirmJoinerDialog({ onClose, onDone }: { onClose: () => void; onDone: (journeyId: string) => void }) {
  const { emps, flash } = useStore();
  const choices = useOfferChoices();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  // There is no reply to wait for: the offer was accepted already (the server keeps today as its valid-till).
  const [fields, setFields] = useState<OfferFields>(() => ({ ...blankOfferFields(), validTill: todayKey() }));
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [templateId, setTemplateId] = useState('');
  // On by default (24 Nov, HR): a confirmed joiner can do nothing until they know the portal exists.
  const [emailPortal, setEmailPortal] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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

  const save = async (allowTj?: string) => {
    const e: Errors = validateOffer(fields, true);
    delete e.validTill;
    if (fields.tj && fields.tj <= todayKey()) e.tj = 'Pick a day after today';
    if (!name.trim()) e.name = 'Enter their name';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = 'Enter their personal email';
    if (phone.trim() && !/^\+?[\d\s-]{8,20}$/.test(phone.trim())) e.phone = 'Check the number';
    setErrors(e);
    if (Object.keys(e).length) return;
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

  return (
    <Modal title="Confirm new user" width={720} onClose={onClose} busy={busy}
      sub="For someone who accepted an offer outside the app. They join the onboarding board as confirmed; no offer letter or email goes out."
      footer={<>
        <button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="pd-btn primary" onClick={() => void save()} disabled={busy}>{busy ? 'Confirming…' : 'Confirm user'}</button>
      </>}>
      <FieldGrid>
        <Field label="Full name" required error={errors.name}>
          <input value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }} placeholder="e.g. Kabir Mehta" style={style('name')} autoFocus />
        </Field>
        <Field label="Personal email" required error={errors.email} hint="Their joining portal signs in with this email">
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
        <Field label={OFFER_FIELD_LABEL.managerUserId} required error={errors.managerUserId}>
          <Pick value={fields.managerUserId ?? ''} onChange={(v) => set('managerUserId', v)} ariaLabel={OFFER_FIELD_LABEL.managerUserId}>
            <option value="">Choose</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role ? ` · ${m.role}` : ''}</option>)}
          </Pick>
        </Field>
        <Field label={OFFER_FIELD_LABEL.location} error={errors.location}>
          <input value={fields.location ?? ''} onChange={(e) => set('location', e.target.value)} list="cj-locations" placeholder="e.g. Main Campus, New Delhi" style={style('location')} />
        </Field>
        <Field label={OFFER_FIELD_LABEL.tj} required error={errors.tj}
          hint={allowedTj && allowedTj === fields.tj ? 'A week-off or holiday, kept as you chose' : undefined}>
          <input type="date" value={fields.tj} min={todayKey()} onChange={(e) => set('tj', e.target.value)} style={style('tj')} />
        </Field>
        <Field label={`${OFFER_FIELD_LABEL.ctc} (₹)`} required error={errors.ctc}>
          <input type="number" min={0} step={1000} value={fields.ctc || ''} onChange={(e) => set('ctc', Number(e.target.value) || 0)} placeholder="e.g. 1400000" style={style('ctc')} />
        </Field>
        {nonWorking && nonWorking.tj === fields.tj && (
          <div role="alert" style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 12, background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', color: 'var(--warn)', fontSize: 12.5, lineHeight: 1.5 }}>
            <span style={{ flex: '1 1 220px', minWidth: 0 }}>{nonWorking.text || `${longDay(nonWorking.tj)} is a week-off or a holiday.`}</span>
            <button type="button" className="pd-btn sm" disabled={busy} onClick={() => { const { tj } = nonWorking; setAllowedTj(tj); void save(tj); }}>Use this date anyway</button>
          </div>
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
        <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={emailPortal} onChange={(e) => setEmailPortal(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Email them the joining portal sign-in now<span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)' }}>Untick to email nothing for now. Their portal is ready either way: they sign in with a code sent to their personal email.</span></span>
        </label>
        <datalist id="cj-designations">{choices.designations.map((d) => <option key={d} value={d} />)}</datalist>
        <datalist id="cj-departments">{choices.departments.map((d) => <option key={d} value={d} />)}</datalist>
        <datalist id="cj-locations">{choices.locations.map((d) => <option key={d} value={d} />)}</datalist>
      </FieldGrid>
      {error && <div role="alert" style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</div>}
    </Modal>
  );
}
