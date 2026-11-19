// Web · Employee profile (18 Nov design, "Web · 7 Employee profile" and the seven
// "Web · Profile ·" screens): the progress, the seven sections, and each section's
// form with the step header. Personal, contact, bank, education and IDs save to
// /portal/profile; the emergency contact and PF to About you; each section shows the
// template's documents that belong to it (upload, see HR's note, replace). What is
// typed is kept on this device until it is saved, so a half-filled form survives.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { portal } from '../api/portal';
import type { CandidateDocumentView, ProfileSectionKey, ProfileView } from '../api/types';
import { A1Icon, A1Loading, Breadcrumb, StepHeader } from '../components/A1';
import { fmtBytes, fmtWeekday } from '../lib/format';
import { useMe } from '../session';
import { WebPage } from './A1Shell';
import { G4StepBody, isG4Step } from '../components/fig/G4ProfileSteps';

const ORDER: ProfileSectionKey[] = ['personal', 'contact', 'emergency', 'bank', 'education', 'ids', 'photo'];
const TITLE: Record<ProfileSectionKey, string> = {
  personal: 'Personal details', contact: 'Contact and address', emergency: 'Emergency contact', bank: 'Bank account and PF',
  education: 'Education and experience', ids: 'ID documents', photo: 'Photo',
};
const LIST_TITLE: Record<ProfileSectionKey, string> = { ...TITLE, ids: 'ID documents (Aadhaar, PAN)' };
const HINT: Record<ProfileSectionKey, string> = {
  personal: 'About 2 min', contact: 'About 2 min', emergency: 'About 2 min', bank: 'About 3 min', education: 'About 4 min', ids: 'Aadhaar and PAN', photo: 'For your ID card',
};
const INTRO: Record<ProfileSectionKey, string> = {
  personal: 'Fill these in exactly as they appear on your ID, so your letters and payslips match.',
  contact: 'HR uses these to reach you and to post anything you need before you join.',
  emergency: 'Who should we call if something happens to you at work? Pick someone who usually answers their phone.',
  bank: 'Your salary is paid into this account, so it must be in your own name.',
  education: 'Your highest qualification and your last job are enough. You can add more if you like.',
  ids: 'HR checks these once to verify who you are. Upload clear photos with all four corners showing.',
  photo: 'This goes on your ID card and your profile, so your team can recognise you on your first day.',
};
const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
const RELATIONS = ['Parent', 'Partner', 'Sibling', 'Friend'];

/** /profile · how far along, and the seven sections. */
export function A1Profile() {
  const [view, setView] = useState<ProfileView>();
  const [error, setError] = useState('');
  useEffect(() => { portal.profile().then(setView, (e: Error) => setError(e.message)); }, []);
  const next = view?.sections.find((s) => !s.done)?.key;
  const pct = view && view.total ? Math.round((view.done / view.total) * 100) : 0;
  return (
    <WebPage>
      <Breadcrumb title="Employee profile" />
      {!view && !error ? <A1Loading /> : (
        <div className="a1-body">
          <p className="a1-intro">Fill in your employee profile before you join, so HR can set up your payroll, ID card and accounts.</p>
          {error && <p className="a1-error" role="alert">{error}</p>}
          {view && (
            <>
              <div className="a1-card a1-card--pad">
                <div className="a1-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}><span className="a1-big">{pct}%</span><span className="a1-small" style={{ color: 'var(--a1-ink-2)' }}>{view.done} of {view.total} sections done</span></div>
                <span className="a1-progress"><i style={{ width: `${pct}%` }} /></span>
                {view.finishBy && <span className="a1-small">Finish by {fmtWeekday(view.finishBy)} so your payroll and ID card are ready on your first day.</span>}
              </div>
              <ul className="a1-list">
                {view.sections.map((s) => {
                  const isNext = s.key === next;
                  return (
                    <li key={s.key} className={isNext ? 'a1-navrow--next' : undefined}>
                      <Link to={`/profile/${s.key}`} className="a1-navrow">
                        <span className={`a1-tick${s.done ? ' a1-tick--done' : isNext ? ' a1-tick--next' : ''}`}>{s.done && <A1Icon name="check" size={14} width={3} />}</span>
                        <span className="a1-stack">
                          <span className="a1-strong">{LIST_TITLE[s.key]}</span>
                          <span className="a1-small" style={s.done ? { color: 'var(--a1-green)' } : isNext ? { color: 'var(--a1-brand)', fontWeight: 600 } : undefined}>{s.done ? 'Done' : isNext ? `Up next · ${HINT[s.key].toLowerCase()}` : HINT[s.key]}</span>
                        </span>
                        <A1Icon name="chevron" size={20} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <span className="a1-small" style={{ textAlign: 'center' }}>Your answers are kept as you go, so you can stop and come back.</span>
            </>
          )}
        </div>
      )}
    </WebPage>
  );
}

type Values = Record<string, unknown>;
const draftKey = (k: ProfileSectionKey) => `sowaka.portal.profile.${k}`;
function readDraft(k: ProfileSectionKey): Values | null { try { const raw = localStorage.getItem(draftKey(k)); return raw ? (JSON.parse(raw) as Values) : null; } catch { return null; } }
function writeDraft(k: ProfileSectionKey, v: Values | null) { try { if (v) localStorage.setItem(draftKey(k), JSON.stringify(v)); else localStorage.removeItem(draftKey(k)); } catch { /* not kept */ } }

/** The saved answers of a section, as the form's values (secrets come back empty: only their last four are known). */
function savedValues(k: ProfileSectionKey, v: ProfileView): Values {
  const p = v.profile;
  switch (k) {
    case 'personal': return { fullName: p.personal?.fullName ?? v.candidateName ?? '', preferredName: p.personal?.preferredName ?? '', dob: p.personal?.dob ?? '', gender: p.personal?.gender ?? '', maritalStatus: p.personal?.maritalStatus ?? '', nationality: p.personal?.nationality ?? 'Indian' };
    case 'contact': return { mobile: p.contact?.mobile ?? v.phone ?? '', current: p.contact?.current ?? { line: '', city: '', state: '', pin: '' }, permanentSame: p.contact?.permanentSame ?? true, permanent: p.contact?.permanent ?? { line: '', city: '', state: '', pin: '' } };
    case 'emergency': return { name: v.emergencyContact?.name ?? '', relation: v.emergencyContact?.relation ?? '', phone: v.emergencyContact?.phone ?? '' };
    case 'bank': return { holderName: p.bank?.holderName ?? v.candidateName ?? '', accountNumber: '', accountNumberAgain: '', ifsc: p.bank?.ifsc ?? '', bankName: p.bank?.bankName ?? '', hasUan: v.pf ? (v.pf.firstJob ? 'No' : 'Yes') : '', uan: v.pf?.uan ?? '' };
    case 'education': return { qualification: p.education?.qualification ?? '', institution: p.education?.institution ?? '', year: p.education?.year ?? '', worked: p.experience ? (p.experience.firstJob ? 'No' : 'Yes') : 'Yes', jobs: p.experience?.jobs?.length ? p.experience.jobs : [{ company: '', role: '', from: '', to: '' }] };
    case 'ids': return { aadhaar: '', pan: '' };
    default: return {};
  }
}

/** /profile/:section · one section's form, the step header and Save and continue. */
export function A1ProfileSection() {
  const { section = '' } = useParams();
  const key = ORDER.includes(section as ProfileSectionKey) ? (section as ProfileSectionKey) : null;
  if (!key) return <Navigate to="/profile" replace />;
  return <SectionForm key={key} k={key} />;
}

function SectionForm({ k }: { k: ProfileSectionKey }) {
  const { reload } = useMe();
  const navigate = useNavigate();
  const [view, setView] = useState<ProfileView>();
  const [docs, setDocs] = useState<CandidateDocumentView[]>([]);
  const [v, setV] = useState<Values>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const typed = useRef(false);
  useEffect(() => {
    portal.profile().then((pv) => { setView(pv); setV({ ...savedValues(k, pv), ...(readDraft(k) ?? {}) }); }, (e: Error) => setError(e.message));
    portal.documents().then((r) => setDocs(r.documents), () => undefined);
  }, [k]);
  // What is typed stays on this device until it is saved.
  useEffect(() => { if (typed.current) writeDraft(k, v); }, [k, v]);
  const set = (patch: Values) => { typed.current = true; setV((cur) => ({ ...cur, ...patch })); };

  const i = ORDER.indexOf(k);
  const sec = view?.sections.find((s) => s.key === k);
  const myDocs = useMemo(() => docs.filter((d) => sec?.documentIds.includes(d.id)), [docs, sec]);
  const segs = ORDER.map((key, n) => (n === i ? 'on' : view?.sections.find((s) => s.key === key)?.done ? 'done' : 'todo') as 'done' | 'on' | 'todo');
  const last = i === ORDER.length - 1;
  const goNext = () => navigate(last ? '/profile' : `/profile/${ORDER[i + 1]}`);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (k === 'emergency') await portal.saveAbout({ emergencyContact: { name: String(v.name ?? ''), relation: v.relation as never, phone: String(v.phone ?? '') } });
      else if (k === 'bank') {
        if (!v.hasUan) throw new Error('Choose whether you have a UAN from a previous job');
        await portal.saveProfile('bank', v);
        await portal.saveAbout({ pf: v.hasUan === 'No' ? { firstJob: true } : { firstJob: false, uan: String(v.uan ?? '') } });
      } else if (k === 'education') await portal.saveProfile('education', { ...v, firstJob: v.worked === 'No' });
      else if (k !== 'photo') await portal.saveProfile(k, v);
      writeDraft(k, null);
      typed.current = false;
      void reload();
      goNext();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const later = () => navigate('/profile');

  const body: ReactNode = !view ? null : (() => {
    const T = (name: string, label: string, opts: { ph?: string; help?: string; type?: string; inputMode?: 'numeric' | 'tel' | 'email' | 'text'; readOnly?: boolean; value?: string; onChange?: (s: string) => void; max?: number } = {}) => (
      <label className="a1-field">{label}
        <input className="a1-input" type={opts.type ?? 'text'} inputMode={opts.inputMode} placeholder={opts.ph} readOnly={opts.readOnly} maxLength={opts.max}
          value={opts.value ?? String(v[name] ?? '')} onChange={(e) => (opts.onChange ? opts.onChange(e.target.value) : set({ [name]: e.target.value }))} />
        {opts.help && <span className="a1-help">{opts.help}</span>}
      </label>
    );
    const S = (name: string, label: string, options: string[], opts: { value?: string; onChange?: (s: string) => void } = {}) => (
      <label className="a1-field">{label}
        <select className="a1-input" value={opts.value ?? String(v[name] ?? '')} onChange={(e) => (opts.onChange ? opts.onChange(e.target.value) : set({ [name]: e.target.value }))}>
          <option value="">Choose</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
    const G = (name: string, label: string, options: string[]) => (
      <div className="a1-field" role="radiogroup" aria-label={label}>{label}
        <div className="a1-seg">{options.map((o) => <button key={o} type="button" role="radio" aria-checked={v[name] === o} onClick={() => set({ [name]: o })}>{o}</button>)}</div>
      </div>
    );
    const addr = (name: 'current' | 'permanent', title: string) => {
      const a = (v[name] ?? { line: '', city: '', state: '', pin: '' }) as Record<string, string>;
      const put = (patch: Record<string, string>) => set({ [name]: { ...a, ...patch } });
      return (
        <Group title={title}>
          {T(`${name}.line`, 'House, building and street', { value: a.line, onChange: (s) => put({ line: s }) })}
          {T(`${name}.city`, 'City', { value: a.city, onChange: (s) => put({ city: s }) })}
          {S(`${name}.state`, 'State', STATES, { value: a.state, onChange: (s) => put({ state: s }) })}
          {T(`${name}.pin`, 'PIN code', { ph: '6 digits', inputMode: 'numeric', max: 6, value: a.pin, onChange: (s) => put({ pin: s.replace(/\D/g, '') }) })}
        </Group>
      );
    };
    switch (k) {
      case 'personal': return (
        <Group>
          {T('fullName', 'Full name', { help: 'As on your Aadhaar or PAN card' })}
          {T('preferredName', 'Preferred name (optional)')}
          {T('dob', 'Date of birth', { type: 'date' })}
          {G('gender', 'Gender', view.options.genders)}
          {S('maritalStatus', 'Marital status', view.options.marital)}
          {T('nationality', 'Nationality')}
        </Group>
      );
      case 'contact': return (
        <>
          <Group title="Contact">
            {T('email', 'Personal email', { readOnly: true, value: view.personalEmail ?? '', help: 'From your offer. Write to HR if it needs to change.' })}
            {T('mobile', 'Mobile number', { ph: '+91', inputMode: 'tel' })}
          </Group>
          {addr('current', 'Current address')}
          <Group title="Permanent address">
            <button type="button" role="checkbox" aria-checked={v.permanentSame !== false} className="a1-check" onClick={() => set({ permanentSame: v.permanentSame === false })}>
              <span className="a1-check__box"><A1Icon name="check" size={14} width={3} /></span>Same as my current address
            </button>
          </Group>
          {v.permanentSame === false && addr('permanent', 'Permanent address, if different')}
        </>
      );
      case 'emergency': return (
        <Group title="Contact 1">
          {T('name', 'Full name', { ph: 'e.g. Anil Menon' })}
          {S('relation', 'Relationship', RELATIONS)}
          {T('phone', 'Mobile number', { ph: '+91', inputMode: 'tel', help: 'Someone else’s number, not your own' })}
        </Group>
      );
      // bank, education, ids and photo: G4StepBody (components/fig/G4ProfileSteps.tsx)
      default: return null;
    }
  })();

  const done = Boolean(sec?.done);
  return (
    <WebPage footer={false}>
      <StepHeader title={TITLE[k]} step={`Step ${i + 1} of ${ORDER.length}`} segs={segs} />
      {!view && !error ? <A1Loading /> : view && isG4Step(k) ? (
        // Steps 4–7 as in Figma (G4).
        <G4StepBody k={k} view={view} v={v} set={set} docs={myDocs} done={done} error={error}
          renderDoc={(d) => <DocUpload key={d.id} doc={d} onChange={setDocs} />} onPhotoSaved={(pv) => { setView(pv); void reload(); }} />
      ) : (
        <div className="a1-body" style={{ gap: 24 }}>
          {done && <div className="a1-info a1-info--green"><A1Icon name="tick-circle" size={18} width={2.2} /><span>You’ve finished this section. You can still change anything before you join.</span></div>}
          <p className="a1-intro">{INTRO[k]}</p>
          <div className="a1-form">{body}</div>
          {myDocs.length > 0 && (
            <Group title={k === 'ids' ? 'Upload your ID documents' : 'Documents'}>
              {myDocs.map((d) => <DocUpload key={d.id} doc={d} onChange={setDocs} />)}
            </Group>
          )}
          {error && <p className="a1-error" role="alert">{error}</p>}
        </div>
      )}
      <div className="a1-foot">
        {k === 'photo'
          ? <button type="button" className="a1-btn a1-btn--primary" onClick={() => navigate('/profile')}>Finish profile</button>
          : <button type="button" className="a1-btn a1-btn--primary" disabled={busy || !view} onClick={() => void save()}>{busy ? 'Saving…' : 'Save and continue'}</button>}
        <button type="button" className="a1-btn a1-btn--ghost" onClick={later}>Save and finish later</button>
      </div>
    </WebPage>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="a1-group">
      {title && <h2 className="a1-h2">{title}</h2>}
      <div className="a1-card">{children}</div>
    </section>
  );
}

const DOC_STATE: Record<string, string> = { in_review: 'Uploaded · HR will check it', approved: 'Approved by HR', sent_back: 'Sent back by HR', todo: '' };

/** One of the template's documents: upload it, see what HR said, replace it. */
function DocUpload({ doc, onChange }: { doc: CandidateDocumentView; onChange: (d: CandidateDocumentView[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try { onChange((await portal.uploadDocument(doc.id, Array.from(files))).documents); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const locked = doc.status === 'approved';
  return (
    <div className="a1-field">{doc.label}{!doc.required && ' (optional)'}
      {doc.status === 'sent_back' && doc.hrNote && <span className="a1-info a1-info--amber" style={{ fontWeight: 400 }}><A1Icon name="info" size={16} /><span>{doc.hrNote}</span></span>}
      {doc.files.map((f) => (
        <span key={f.id} className="a1-file">
          <span className={`a1-tick${doc.status === 'approved' || doc.status === 'in_review' ? ' a1-tick--done' : ''}`}>{(doc.status === 'approved' || doc.status === 'in_review') && <A1Icon name="check" size={14} width={3} />}</span>
          <span className="a1-stack"><span className="a1-strong" style={{ color: 'var(--a1-ink)', overflowWrap: 'anywhere' }}>{f.name}</span><span className="a1-help">{[fmtBytes(f.size), DOC_STATE[doc.status]].filter(Boolean).join(' · ')}</span></span>
        </span>
      ))}
      {!locked && (
        <label className="a1-upload">
          <input type="file" accept="image/jpeg,image/png,application/pdf" multiple onChange={(e) => { void send(e.target.files); e.target.value = ''; }} disabled={busy} aria-label={`Upload ${doc.label}`} />
          <span className="a1-upload__icon"><A1Icon name="upload" /></span>
          <span className="a1-stack"><span className="a1-strong" style={{ color: 'var(--a1-brand)' }}>{busy ? 'Uploading…' : doc.files.length ? (doc.status === 'sent_back' ? 'Upload it again' : 'Add another file') : (doc.title ?? `Upload ${doc.label.toLowerCase().startsWith('id') ? 'your ID' : 'the file'}`)}</span><span className="a1-help">JPG, PNG or PDF, up to 10 MB</span></span>
        </label>
      )}
      {doc.hint && <span className="a1-help">{doc.hint}</span>}
      {error && <p className="a1-error" role="alert">{error}</p>}
    </div>
  );
}
