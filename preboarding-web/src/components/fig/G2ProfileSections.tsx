// Figma "App · Profile ·" Bank account and PF (4967:93357), Education and experience (4967:93433),
// ID documents (4967:93530) and Photo (4967:93612): the step header with segments, the intro with its
// 3D icon, the section's cards (the template's documents sit in the card they belong to) and the
// Save and continue / Save and finish later footer. Saving, drafts and uploads are A1Profile's, unchanged.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { portal } from '../../api/portal';
import type { CandidateDocumentView, ProfileSectionKey, ProfileView } from '../../api/types';
import { useMe } from '../../session';
import { INTRO, ORDER, TITLE, readDraft, savedValues, writeDraft } from '../../screens/A1Profile';
import { FigBackHeader, FigLoading, FigPage, isAppHost } from './FigShell';
import { G3WebTop } from './G3WebShell';
import { FigField, FigIntro } from './FigUi';
import { FigCheckCircle, FigCheckSmall, type Fig3DName } from './icons';
import '../../styles/fig-g1.css';
import { G2Steps, type G2Seg } from './G2Steps';
import { G2DocUpload } from './G2Upload';
import { G2MonthInput, G2PhotoTip, G2PrivacyNote } from './G2Profile';
import { G2SelectChevron } from './icons/g2-select-chevron';
import { G2Plus } from './icons/g2-plus';
import { G2Person } from './icons/g2-person';
import { G2Camera } from './icons/g2-camera';
import { G2Gallery } from './icons/g2-gallery';
import '../../styles/fig-g2.css';

// All seven sections: personal, contact and emergency (G1's frames 4967:93155, 93226, 93303) were added to G2's shell.
export const G2_SECTIONS: ProfileSectionKey[] = ['personal', 'contact', 'emergency', 'bank', 'education', 'ids'];
const RELATIONS = ['Parent', 'Partner', 'Sibling', 'Friend'];
const ICON: Partial<Record<ProfileSectionKey, Fig3DName>> = { personal: 'user', emergency: 'phone', bank: 'bank', education: 'write', ids: 'document-approved', photo: 'id-card' };
/** Which card of the section a template document belongs in (by its name); others go in the last card. */
const DOC_CARD: Partial<Record<ProfileSectionKey, Array<[string, RegExp]>>> = {
  bank: [['bank', /.*/]],
  contact: [['contact', /.*/]],
  education: [['education', /degree|certificate|education|marksheet|diploma/i], ['work', /.*/]],
  ids: [['aadhaar', /aadhaar|aadhar|id proof/i], ['pan', /.*/]],
};
/** The last job's papers: asked only of someone who has worked before. */
const JOB_PAPERS = /reliev|offer letter|payslip|experience/i;

type Values = Record<string, unknown>;

export function G2SectionForm({ k }: { k: ProfileSectionKey }) {
  const { reload } = useMe();
  const navigate = useNavigate();
  const [view, setView] = useState<ProfileView>();
  const [docs, setDocs] = useState<CandidateDocumentView[]>([]);
  const [v, setV] = useState<Values>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const typed = useRef(false);
  useEffect(() => {
    // An approved (locked) section shows what was saved, never a draft typed on this device.
    portal.profile().then((pv) => { setView(pv); const isLocked = pv.sections.find((s) => s.key === k)?.locked === true; setV({ ...savedValues(k, pv), ...(isLocked ? {} : readDraft(k) ?? {}) }); }, (e: Error) => setError(e.message));
    portal.documents().then((r) => setDocs(r.documents), () => undefined);
  }, [k]);
  useEffect(() => { if (typed.current) writeDraft(k, v); }, [k, v]);
  const set = (patch: Values) => { typed.current = true; setV((cur) => ({ ...cur, ...patch })); };

  const i = ORDER.indexOf(k);
  const sec = view?.sections.find((s) => s.key === k);
  // Approved by HR: shown read-only, nothing to save.
  const locked = sec?.locked === true;
  const myDocs = useMemo(() => docs.filter((d) => sec?.documentIds.includes(d.id)), [docs, sec]);
  const segs: G2Seg[] = ORDER.map((key, n) => (n === i ? 'on' : view?.sections.find((s) => s.key === key)?.done ? 'done' : 'todo'));
  const last = i === ORDER.length - 1;
  const docsIn = (card: string) => {
    const rules = DOC_CARD[k] ?? [];
    return myDocs.filter((d) => rules.find(([, re]) => re.test(`${d.label} ${d.title ?? ''}`))?.[0] === card)
      .filter((d) => !(card === 'work' && v.worked === 'No' && JOB_PAPERS.test(`${d.docKey} ${d.label}`)))
      .map((d) => <G2DocUpload key={d.id} doc={d} onChange={setDocs} readOnly={locked} />);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (k === 'emergency') await portal.saveAbout({ emergencyContact: { name: String(v.name ?? ''), relation: v.relation as never, phone: String(v.phone ?? '') } });
      else if (k === 'personal' || k === 'contact') await portal.saveProfile(k, v);
      else if (k === 'bank') {
        if (!v.hasUan) throw new Error('Choose whether you have a UAN from a previous job');
        await portal.saveProfile('bank', v);
        await portal.saveAbout({ pf: v.hasUan === 'No' ? { firstJob: true } : { firstJob: false, uan: String(v.uan ?? '') } });
      } else if (k === 'education') await portal.saveProfile('education', { ...v, firstJob: v.worked === 'No' });
      else if (k === 'ids') await portal.saveProfile(k, v);
      writeDraft(k, null);
      typed.current = false;
      void reload();
      navigate(last ? '/profile' : `/profile/${ORDER[i + 1]}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const T = (name: string, label: string, o: { ph?: string; help?: string; inputMode?: 'numeric' | 'text' | 'tel'; max?: number; value?: string; onChange?: (s: string) => void; readOnly?: boolean } = {}) => (
    <FigField key={name} label={label} help={o.help} placeholder={o.ph} inputMode={o.inputMode} maxLength={o.max} readOnly={o.readOnly}
      value={o.value ?? String(v[name] ?? '')} onChange={(e) => (o.onChange ? o.onChange(e.target.value) : set({ [name]: e.target.value }))} />
  );
  const G = (name: string, label: string, options: Array<[string, string]>, wide?: boolean) => (
    <div className="fig-field" role="radiogroup" aria-label={label}>
      <span className="fig-field__label">{label}</span>
      <div className="g2-seg">{options.map(([val, text], n) => (
        <button key={val} type="button" role="radio" aria-checked={v[name] === val} className={wide && n === options.length - 1 ? 'g2-seg__wide' : undefined} onClick={() => set({ [name]: val })}>{text}</button>
      ))}</div>
    </div>
  );

  const addr = (name: 'current' | 'permanent', title: string) => {
    const a = (v[name] ?? { line: '', city: '', state: '', pin: '' }) as Record<string, string>;
    const put = (patch: Record<string, string>) => set({ [name]: { ...a, ...patch } });
    return (
      <Card title={title}>
        {T(`${name}.line`, 'House, building and street', { value: a.line, onChange: (s) => put({ line: s }) })}
        {T(`${name}.city`, 'City', { value: a.city, onChange: (s) => put({ city: s }) })}
        <SelectField label="State" value={a.state ?? ''} options={STATES} onChange={(s) => put({ state: s })} />
        {T(`${name}.pin`, 'PIN code', { ph: '6 digits', inputMode: 'numeric', max: 6, value: a.pin, onChange: (s) => put({ pin: s.replace(/\D/g, '') }) })}
      </Card>
    );
  };

  let body: ReactNode = null;
  if (view) {
    if (k === 'personal') {
      const nat = String(v.nationality ?? '');
      body = (
        <Card>
          {T('fullName', 'Full name', { help: 'As on your Aadhaar or PAN card' })}
          <DateField label="Date of birth" value={String(v.dob ?? '')} onChange={(s) => set({ dob: s })} />
          <div className="fig-field" role="radiogroup" aria-label="Gender">
            <span className="fig-field__label">Gender</span>
            <div className="g2-seg g1-seg--wrap">{view.options.genders.map((o) => (
              <button key={o} type="button" role="radio" aria-checked={v.gender === o} onClick={() => set({ gender: o })}>{o}</button>
            ))}</div>
          </div>
          <SelectField label="Marital status" value={String(v.maritalStatus ?? '')} options={view.options.marital} onChange={(s) => set({ maritalStatus: s })} />
          <SelectField label="Nationality" value={nat} options={NATIONALITIES.includes(nat) || !nat ? NATIONALITIES : [nat, ...NATIONALITIES]} onChange={(s) => set({ nationality: s })} />
        </Card>
      );
    } else if (k === 'contact') {
      body = (
        <>
          <Card title="Contact">
            {T('email', 'Personal email', { readOnly: true, value: view.personalEmail ?? '', help: 'From your offer. Write to HR if it needs to change.' })}
            {T('mobile', 'Mobile number', { ph: '+91', inputMode: 'tel' })}
          </Card>
          {addr('current', 'Current address')}
          <Card title="Permanent address">
            <button type="button" role="checkbox" aria-checked={v.permanentSame !== false} className="g1-check" onClick={() => set({ permanentSame: v.permanentSame === false })}>
              <span className="g1-check__box">{v.permanentSame !== false && <FigCheckSmall />}</span>Same as my current address
            </button>
          </Card>
          {v.permanentSame === false && addr('permanent', 'Permanent address, if different')}
          {docsIn('contact').length > 0 && <Card title="Address proof">{docsIn('contact')}</Card>}
        </>
      );
    } else if (k === 'emergency') {
      body = (
        <Card title="Contact 1">
          {T('name', 'Full name', { ph: 'e.g. Anil Menon' })}
          <SelectField label="Relationship" value={String(v.relation ?? '')} options={RELATIONS} onChange={(s) => set({ relation: s })} />
          {T('phone', 'Mobile number', { ph: '+91', inputMode: 'tel' })}
        </Card>
      );
    } else if (k === 'bank') {
      const kept = view.profile.bank?.accountLast4;
      body = (
        <>
          <Card title="Bank account">
            {T('holderName', 'Account holder name', { ph: 'As on your bank account' })}
            {T('accountNumber', 'Account number', { ph: kept ? `Saved: •••• ${kept}. Type it again to change it` : 'Enter your account number', inputMode: 'numeric' })}
            {T('accountNumberAgain', 'Re-enter account number', { ph: 'Type it again to check', inputMode: 'numeric' })}
            {T('ifsc', 'IFSC code', { ph: 'e.g. HDFC0001234', help: 'Printed on your cheque book and passbook', onChange: (s) => set({ ifsc: s.toUpperCase() }), max: 11 })}
            {docsIn('bank')}
          </Card>
          <Card title="Provident fund (PF)">
            {G('hasUan', 'Do you have a UAN from a previous job?', [['Yes', 'Yes'], ['No', 'No']])}
            {v.hasUan !== 'No' && T('uan', 'UAN (optional)', { ph: '12-digit number', inputMode: 'numeric', max: 12, help: 'If this is your first job, choose No and HR will create one for you.' })}
            {v.hasUan === 'No' && <span className="fig-field__help">HR will create one for you.</span>}
          </Card>
        </>
      );
    } else if (k === 'education') {
      const jobs = (v.jobs as Array<Record<string, string>>) ?? [];
      const putJob = (n: number, patch: Record<string, string>) => set({ jobs: jobs.map((j, m) => (m === n ? { ...j, ...patch } : j)) });
      body = (
        <>
          <Card title="Education">
            <SelectField label="Highest qualification" value={String(v.qualification ?? '')} options={view.options.qualifications} onChange={(s) => set({ qualification: s })} />
            {T('institution', 'College or university', { ph: 'e.g. Savitribai Phule Pune University' })}
            {T('year', 'Year of passing', { ph: 'e.g. 2020', inputMode: 'numeric', max: 4 })}
            {docsIn('education')}
          </Card>
          <Card title="Work experience">
            {G('worked', 'Have you worked before?', [['Yes', 'Yes'], ['No', 'No, this is my first job']])}
            {v.worked !== 'No' && jobs.map((j, n) => (
              <div key={n} className={n ? 'g2-job g2-job--more' : 'g2-job'}>
                {T(`job${n}.company`, n ? `Company ${n + 1}` : 'Last company', { ph: 'Company name', value: j.company, onChange: (s) => putJob(n, { company: s }) })}
                {T(`job${n}.role`, 'Your role', { ph: 'e.g. Admissions counsellor', value: j.role, onChange: (s) => putJob(n, { role: s }) })}
                <MonthField label="From" value={j.from ?? ''} onChange={(s) => putJob(n, { from: s })} />
                <MonthField label="To" value={j.to ?? ''} onChange={(s) => putJob(n, { to: s })} />
                {n > 0 && <button type="button" className="fig-link g2-linkbtn" onClick={() => set({ jobs: jobs.filter((_, m) => m !== n) })}>Remove this job</button>}
              </div>
            ))}
            {docsIn('work')}
            {v.worked !== 'No' && jobs.length < 5 && <button type="button" className="fig-link g2-addjob" onClick={() => set({ jobs: [...jobs, { company: '', role: '', from: '', to: '' }] })}><G2Plus />Add another job</button>}
          </Card>
        </>
      );
    } else if (k === 'ids') {
      const ids = view.profile.ids;
      body = (
        <>
          <Card title="Aadhaar card">
            {T('aadhaar', 'Aadhaar number', { ph: ids?.aadhaarLast4 ? `Saved: •••• ${ids.aadhaarLast4}` : '12-digit number', inputMode: 'numeric', max: 14 })}
            {docsIn('aadhaar')}
          </Card>
          <Card title="PAN card">
            {T('pan', 'PAN', { ph: ids?.panLast4 ? `Saved: ••••••${ids.panLast4}` : 'e.g. ABCDE1234F', onChange: (s) => set({ pan: s.toUpperCase() }), max: 10 })}
            {docsIn('pan')}
          </Card>
          <G2PrivacyNote>Only HR can see your ID documents. They’re never shown to your manager or team.</G2PrivacyNote>
        </>
      );
    } else if (k === 'photo') {
      body = <PhotoBlock view={view} onSaved={(pv) => { setView(pv); void reload(); }} />;
    }
  }

  const icon = ICON[k];
  return (
    <FigPage>
      <G3WebTop />
      <FigBackHeader title={TITLE[k]} back="/profile" backLabel="Back to employee profile" side={i === 0 || !isAppHost() ? <span className="fig-brand">Step {i + 1} of {ORDER.length}</span> : undefined} below={<G2Steps segs={segs} />} />
      <main id="main" className="g2-sec">
        {!view && !error ? <FigLoading /> : (
          <>
            {locked
              ? <p className="fig-note g2-done-note"><FigCheckCircle className="fig-success" /><span>Approved by HR. Write to HR if something needs to change.</span></p>
              : sec?.done && <p className="fig-note g2-done-note"><FigCheckCircle className="fig-success" /><span>You’ve finished this section. You can still change anything before you join.</span></p>}
            {icon ? <FigIntro icon={icon}>{INTRO[k]}</FigIntro> : <p className="fig-intro"><span>{INTRO[k]}</span></p>}
            {locked
              ? <fieldset disabled className="g2-locked" aria-label={`${TITLE[k]}, approved by HR`} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>{body}</fieldset>
              : body}
            {error && <p className="fig-field__error" role="alert">{error}</p>}
          </>
        )}
      </main>
      <div className="g2-foot">
        {locked
          ? <button type="button" className="fig-btn" onClick={() => navigate(last ? '/profile' : `/profile/${ORDER[i + 1]}`)}>{last ? 'Back to employee profile' : 'Next section'}</button>
          : k === 'photo'
            ? <button type="button" className="fig-btn" onClick={() => navigate('/profile')}>Finish profile</button>
            : <button type="button" className="fig-btn" disabled={busy || !view} onClick={() => void save()}>{busy ? 'Saving…' : last ? 'Save and finish' : 'Save and continue'}</button>}
        {!locked && <button type="button" className="fig-link g2-foot__later" onClick={() => navigate('/profile')}>Save and finish later</button>}
      </div>
    </FigPage>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="g2-group">
      {title && <h2 className="fig-subtitle">{title}</h2>}
      <div className="g2-card">{children}</div>
    </section>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (s: string) => void }) {
  const id = useId();
  return (
    <FigField label={label} id={id}>
      <span className="g2-select">
        <select id={id} className={`fig-input g2-select__input${value ? '' : ' g2-select__input--empty'}`} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <G2SelectChevron className="g2-select__chev" />
      </span>
    </FigField>
  );
}

function MonthField({ label, value, onChange }: { label: string; value: string; onChange: (s: string) => void }) {
  const id = useId();
  return <FigField label={label} id={id}><G2MonthInput id={id} value={value} onChange={onChange} /></FigField>;
}

/** The photo for the ID card: the preview, the tips, and Take a photo / From gallery. */
function PhotoBlock({ view, onSaved }: { view: ProfileView; onSaved: (v: ProfileView) => void }) {
  const [url, setUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = view.profile.photoFileId;
  useEffect(() => {
    if (!id) { setUrl(undefined); return undefined; }
    let live = true;
    let made: string | undefined;
    portal.file(id).then((buf) => { if (live) { made = URL.createObjectURL(new Blob([buf])); setUrl(made); } }, () => undefined);
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id]);
  const send = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setBusy(true);
    setError('');
    try { onSaved(await portal.uploadPhoto(f)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="g2-photo">
        <span className={`g2-photo__ring${url ? ' g2-photo__ring--set' : ''}`}>{url ? <img src={url} alt="Your photo" /> : <G2Person />}</span>
        <span className="fig-body fig-t2">{busy ? 'Uploading…' : url ? 'Your photo' : 'No photo yet'}</span>
      </div>
      <div className="g2-card g2-tips">
        <h2 className="fig-subtitle">For a photo that works</h2>
        <G2PhotoTip ok>Face the camera, with your whole face in view</G2PhotoTip>
        <G2PhotoTip ok>A plain, light background and good light</G2PhotoTip>
        <G2PhotoTip ok={false}>No sunglasses, caps or filters</G2PhotoTip>
      </div>
      <div className="g2-photo__btns">
        <label className="g2-photo__btn"><input type="file" accept="image/jpeg,image/png" capture="user" onChange={(e) => { void send(e.target.files); e.target.value = ''; }} disabled={busy} aria-label="Take a photo" /><G2Camera />Take a photo</label>
        <label className="g2-photo__btn"><input type="file" accept="image/jpeg,image/png" onChange={(e) => { void send(e.target.files); e.target.value = ''; }} disabled={busy} aria-label="Choose a photo from your gallery" /><G2Gallery />From gallery</label>
      </div>
      {error && <p className="fig-field__error" role="alert">{error}</p>}
    </>
  );
}

const NATIONALITIES = ['Indian', 'Other'];
const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

/**
 * Date of birth: typed as DD/MM/YYYY (the slashes come in as you type), or picked from the calendar
 * button; kept as YYYY-MM-DD. A visible text box, so it can be typed on a laptop and a phone alike
 * (the earlier invisible date input could only be picked, never typed).
 */
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (s: string) => void }) {
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const toText = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const [text, setText] = useState(() => toText(value));
  const [bad, setBad] = useState(false);
  // A date set from outside (a saved profile loading) shows in the box.
  useEffect(() => { const t = toText(value); if (t) setText(t); }, [value]);
  const today = new Date().toISOString().slice(0, 10);
  const type = (raw: string) => {
    const d = raw.replace(/\D/g, '').slice(0, 8);
    const shown = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join('/');
    setText(shown);
    if (!d) { setBad(false); onChange(''); return; }
    if (d.length < 8) { setBad(false); return; }
    const iso = `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
    const ok = !Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso && iso >= '1930-01-01' && iso <= today;
    setBad(!ok);
    if (ok) onChange(iso);
  };
  return (
    <FigField label={label} id={id}>
      <div className="fig-date" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input id={id} className="fig-input" style={{ flex: 1 }} type="text" inputMode="numeric" autoComplete="bday" placeholder="DD/MM/YYYY"
          value={text} onChange={(e) => type(e.target.value)} aria-invalid={bad || undefined} />
        <button type="button" className="fig-btn fig-btn--outline fig-btn--inline" aria-label="Pick from a calendar" style={{ flex: 'none', position: 'relative' }}
          onClick={() => { try { picker.current?.showPicker?.(); } catch { picker.current?.focus(); } }}>
          📅
          <input ref={picker} type="date" tabIndex={-1} aria-hidden="true" min="1930-01-01" max={today} value={value}
            onChange={(e) => { onChange(e.target.value); setText(toText(e.target.value)); setBad(false); }}
            style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', width: '100%', height: '100%' }} />
        </button>
      </div>
      {bad && <p className="fig-field__error" role="alert">Enter a real date as DD/MM/YYYY</p>}
    </FigField>
  );
}
