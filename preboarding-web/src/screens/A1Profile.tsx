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
const FIRST_JOB = 'No, this is my first job';
const firstJobOf = (v: Values) => String(v.worked ?? 'Yes').startsWith('No');
/** 'YYYY-MM' as the form shows it, "MM / YYYY". */
const monthText = (key?: string) => (key && /^\d{4}-\d{2}$/.test(key) ? `${key.slice(5)} / ${key.slice(0, 4)}` : key ?? '');
/** What was typed ("03 / 2021", "3/2021", "2021-03") as 'YYYY-MM' for the server; anything else goes as typed, for the server to explain. */
function monthKey(text?: string): string {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const a = /^(\d{1,2})\s*[/\-.\s]\s*(\d{4})$/.exec(t); if (a) return `${a[2]}-${a[1].padStart(2, '0')}`;
  const b = /^(\d{4})-(\d{2})$/.exec(t); if (b) return t;
  return t;
}
/** Where a template document sits in its section: under the field it belongs to. */
function slotOf(d: CandidateDocumentView): 'aadhaar' | 'pan' | 'ids' | 'work' | 'degree' | 'address' | 'bank' | 'photo' {
  const t = `${d.docKey} ${d.label}`.toLowerCase();
  const aadhaar = /aadha?ar/.test(t); const pan = /\bpan\b/.test(t);
  if (/photo|picture|selfie/.test(t)) return 'photo';
  if (/cheque|check|passbook|bank/.test(t)) return 'bank';
  if (/address/.test(t)) return 'address';
  if (/payslip|pay slip|relieving|experience|employ/.test(t)) return 'work';
  if (/educat|degree|certificate|marksheet/.test(t)) return 'degree';
  if (aadhaar && !pan) return 'aadhaar';
  if (pan && !aadhaar) return 'pan';
  return 'ids';
}
const draftKey = (k: ProfileSectionKey) => `sowaka.portal.profile.${k}`;
function readDraft(k: ProfileSectionKey): Values | null { try { const raw = localStorage.getItem(draftKey(k)); return raw ? (JSON.parse(raw) as Values) : null; } catch { return null; } }
function writeDraft(k: ProfileSectionKey, v: Values | null) { try { if (v) localStorage.setItem(draftKey(k), JSON.stringify(v)); else localStorage.removeItem(draftKey(k)); } catch { /* not kept */ } }

/** The saved answers of a section, as the form's values (secrets come back empty: only their last four are known). */
function savedValues(k: ProfileSectionKey, v: ProfileView): Values {
  const p = v.profile;
  switch (k) {
    case 'personal': return { fullName: p.personal?.fullName ?? v.candidateName ?? '', preferredName: p.personal?.preferredName ?? '', dob: p.personal?.dob ?? '', gender: p.personal?.gender ?? '', maritalStatus: p.personal?.maritalStatus ?? '', nationality: p.personal?.nationality ?? 'Indian' };
    case 'contact': return { mobile: p.contact?.mobile ?? v.phone ?? '', current: p.contact?.current ?? { line: '', city: '', state: '', pin: '' }, permanentSame: p.contact?.permanentSame ?? true, permanent: p.contact?.permanent ?? { line: '', city: '', state: '', pin: '' } };
    case 'emergency': {
      const c = v.emergencyContact; const c2 = v.emergencyContact2;
      return { name: c?.name ?? '', relation: c?.relation ?? '', phone: c?.phone ?? '', altPhone: c?.altPhone ?? '', c2: c2 ? { name: c2.name, relation: c2.relation, phone: c2.phone, altPhone: c2.altPhone ?? '' } : null };
    }
    case 'bank': return { holderName: p.bank?.holderName ?? v.candidateName ?? '', accountNumber: '', accountNumberAgain: '', ifsc: p.bank?.ifsc ?? '', hasUan: v.pf ? (v.pf.firstJob ? 'No' : 'Yes') : '', uan: v.pf?.uan ?? '' };
    case 'education': return {
      qualification: p.education?.qualification ?? '', institution: p.education?.institution ?? '', year: p.education?.year ?? '',
      worked: p.experience?.firstJob ? FIRST_JOB : 'Yes',
      jobs: p.experience?.jobs?.length ? p.experience.jobs.map((j) => ({ ...j, from: monthText(j.from), to: monthText(j.to) })) : [{ company: '', role: '', from: '', to: '' }],
    };
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
  // Each document goes under its own field; the slots a section's form draws are listed here, and anything else falls to the end.
  const SLOTS: Record<ProfileSectionKey, string[]> = { personal: [], contact: ['address'], emergency: [], bank: ['bank'], education: ['degree', 'work'], ids: ['aadhaar', 'pan', 'ids'], photo: [] };
  const docsIn = (slot: string) => {
    const list = myDocs.filter((d) => slotOf(d) === slot);
    return list.length ? list.map((d) => <DocUpload key={d.id} doc={d} onChange={setDocs} />) : null;
  };
  const leftover = myDocs.filter((d) => !SLOTS[k].includes(slotOf(d)) && !(k === 'education' && firstJobOf(v) && slotOf(d) === 'work'));
  const segs = ORDER.map((key, n) => (n === i ? 'on' : view?.sections.find((s) => s.key === key)?.done ? 'done' : 'todo') as 'done' | 'on' | 'todo');
  const last = i === ORDER.length - 1;
  const goNext = () => navigate(last ? '/profile' : `/profile/${ORDER[i + 1]}`);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (k === 'emergency') {
        const c2 = v.c2 as Values | null;
        await portal.saveAbout({
          emergencyContact: { name: v.name, relation: v.relation, phone: v.phone, altPhone: v.altPhone },
          ...(c2 ? { emergencyContact2: c2 } : view?.emergencyContact2 ? { emergencyContact2: null } : {}),
        });
      } else if (k === 'bank') {
        if (!v.hasUan) throw new Error('Choose whether you have a UAN from a previous job');
        await portal.saveProfile('bank', v);
        const uan = String(v.uan ?? '').replace(/\s/g, '');
        await portal.saveAbout({ pf: v.hasUan === 'No' ? { firstJob: true } : uan ? { firstJob: false, uan } : { firstJob: false } });
      } else if (k === 'education') {
        const jobs = ((v.jobs as Array<Record<string, string>>) ?? []).map((j) => ({ ...j, from: monthKey(j.from), to: monthKey(j.to) }));
        await portal.saveProfile('education', { ...v, jobs, firstJob: firstJobOf(v) });
      }
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
    const addr = (name: 'current' | 'permanent', title: string, extra?: ReactNode) => {
      const a = (v[name] ?? { line: '', city: '', state: '', pin: '' }) as Record<string, string>;
      const put = (patch: Record<string, string>) => set({ [name]: { ...a, ...patch } });
      return (
        <Group title={title}>
          {T(`${name}.line`, 'House, building and street', { value: a.line, onChange: (s) => put({ line: s }) })}
          {T(`${name}.city`, 'City', { value: a.city, onChange: (s) => put({ city: s }) })}
          {S(`${name}.state`, 'State', STATES, { value: a.state, onChange: (s) => put({ state: s }) })}
          {T(`${name}.pin`, 'PIN code', { ph: '6 digits', inputMode: 'numeric', max: 6, value: a.pin, onChange: (s) => put({ pin: s.replace(/\D/g, '') }) })}
          {extra}
        </Group>
      );
    };
    const addrWithDocs = addr('current', 'Current address', docsIn('address'));
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
          {addrWithDocs}
          <Group title="Permanent address">
            <button type="button" role="checkbox" aria-checked={v.permanentSame !== false} className="a1-check" onClick={() => set({ permanentSame: v.permanentSame === false })}>
              <span className="a1-check__box"><A1Icon name="check" size={14} width={3} /></span>Same as my current address
            </button>
          </Group>
          {v.permanentSame === false && addr('permanent', 'Permanent address, if different')}
        </>
      );
      case 'emergency': {
        const c2 = v.c2 as Record<string, string> | null;
        const put2 = (patch: Record<string, string>) => set({ c2: { ...(c2 ?? { name: '', relation: '', phone: '', altPhone: '' }), ...patch } });
        return (
          <>
            <Group title="Contact 1">
              {T('name', 'Full name', { ph: 'e.g. Anil Menon' })}
              {S('relation', 'Relationship', RELATIONS)}
              {T('phone', 'Mobile number', { ph: '+91', inputMode: 'tel', help: 'Someone else’s number, not your own' })}
              {T('altPhone', 'Another number (optional)', { ph: '+91', inputMode: 'tel' })}
            </Group>
            {c2 ? (
              <Group title="Contact 2">
                {T('c2.name', 'Full name', { ph: 'e.g. Leela Menon', value: c2.name, onChange: (x) => put2({ name: x }) })}
                {S('c2.relation', 'Relationship', RELATIONS, { value: c2.relation, onChange: (x) => put2({ relation: x }) })}
                {T('c2.phone', 'Mobile number', { ph: '+91', inputMode: 'tel', value: c2.phone, onChange: (x) => put2({ phone: x }) })}
                {T('c2.altPhone', 'Another number (optional)', { ph: '+91', inputMode: 'tel', value: c2.altPhone ?? '', onChange: (x) => put2({ altPhone: x }) })}
                <button type="button" className="a1-link" style={{ alignSelf: 'flex-start', minHeight: 40 }} onClick={() => set({ c2: null })}>Remove this contact</button>
              </Group>
            ) : (
              <div className="a1-card"><button type="button" className="a1-link" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 40 }} onClick={() => put2({})}><A1Icon name="plus" size={18} width={2} />Add another contact</button></div>
            )}
          </>
        );
      }
      case 'bank': {
        const kept = view.profile.bank?.accountLast4;
        return (
          <>
            <Group title="Bank account">
              {T('holderName', 'Account holder name', { ph: 'As on your bank account' })}
              {T('accountNumber', 'Account number', { ph: kept ? `Saved: •••• ${kept}. Type it again to change it` : 'Enter your account number', inputMode: 'numeric' })}
              {T('accountNumberAgain', 'Re-enter account number', { ph: 'Type it again to check', inputMode: 'numeric' })}
              {T('ifsc', 'IFSC code', { ph: 'e.g. HDFC0001234', help: 'Printed on your cheque book and passbook', onChange: (s) => set({ ifsc: s.toUpperCase() }), max: 11 })}
              {docsIn('bank')}
            </Group>
            <Group title="Provident fund (PF)">
              {G('hasUan', 'Do you have a UAN from a previous job?', ['Yes', 'No'])}
              {T('uan', 'UAN (optional)', { ph: '12-digit number', inputMode: 'numeric', max: 14, help: 'If this is your first job, choose No and HR will create one for you.' })}
            </Group>
          </>
        );
      }
      case 'education': {
        const jobs = (v.jobs as Array<Record<string, string>>) ?? [];
        const putJob = (n: number, patch: Record<string, string>) => set({ jobs: jobs.map((j, m) => (m === n ? { ...j, ...patch } : j)) });
        return (
          <>
            <Group title="Education">
              {S('qualification', 'Highest qualification', view.options.qualifications)}
              {T('institution', 'College or university', { ph: 'e.g. Savitribai Phule Pune University' })}
              {T('year', 'Year of passing', { ph: 'e.g. 2020', inputMode: 'numeric', max: 4 })}
              {docsIn('degree')}
            </Group>
            <Group title="Work experience">
              {G('worked', 'Have you worked before?', ['Yes', FIRST_JOB])}
              {!firstJobOf(v) && jobs.map((j, n) => (
                <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: n ? 12 : 0, borderTop: n ? '1px solid var(--a1-line)' : 0 }}>
                  {T(`job${n}.company`, n ? `Company ${n + 1}` : 'Last company', { ph: 'Company name', value: j.company, onChange: (s) => putJob(n, { company: s }) })}
                  {T(`job${n}.role`, 'Your role', { ph: 'e.g. Admissions counsellor', value: j.role, onChange: (s) => putJob(n, { role: s }) })}
                  {T(`job${n}.from`, 'From', { ph: 'MM / YYYY', inputMode: 'numeric', value: j.from, onChange: (s) => putJob(n, { from: s }), max: 9 })}
                  {T(`job${n}.to`, 'To', { ph: 'MM / YYYY', inputMode: 'numeric', value: j.to ?? '', onChange: (s) => putJob(n, { to: s }), max: 9, help: n === 0 ? 'Leave it empty if you still work there.' : undefined })}
                  {n > 0 && <button type="button" className="a1-link" style={{ alignSelf: 'flex-start' }} onClick={() => set({ jobs: jobs.filter((_, m) => m !== n) })}>Remove this job</button>}
                </div>
              ))}
              {!firstJobOf(v) && docsIn('work')}
              {!firstJobOf(v) && jobs.length < 5 && <button type="button" className="a1-link" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 40 }} onClick={() => set({ jobs: [...jobs, { company: '', role: '', from: '', to: '' }] })}><A1Icon name="plus" size={18} width={2} />Add another job</button>}
            </Group>
          </>
        );
      }
      case 'ids': {
        const ids = view.profile.ids;
        return (
          <>
            <Group title="Aadhaar card">
              {T('aadhaar', 'Aadhaar number', { ph: ids?.aadhaarLast4 ? `Saved: •••• ${ids.aadhaarLast4}` : '12-digit number', inputMode: 'numeric', max: 14 })}
              {docsIn('aadhaar')}
              {docsIn('ids')}
            </Group>
            <Group title="PAN card">
              {T('pan', 'PAN', { ph: ids?.panLast4 ? `Saved: ••••••${ids.panLast4}` : 'e.g. ABCDE1234F', onChange: (s) => set({ pan: s.toUpperCase() }), max: 10 })}
              {docsIn('pan')}
            </Group>
          </>
        );
      }
      default: return <PhotoBlock view={view} onSaved={(pv) => { setView(pv); void reload(); }} />;
    }
  })();

  const done = Boolean(sec?.done);
  return (
    <WebPage footer={false}>
      <StepHeader title={TITLE[k]} step={`Step ${i + 1} of ${ORDER.length}`} segs={segs} />
      {!view && !error ? <A1Loading /> : (
        <div className="a1-body" style={{ gap: 24 }}>
          {done && <div className="a1-info a1-info--green"><A1Icon name="tick-circle" size={18} width={2.2} /><span>You’ve finished this section. You can still change anything before you join.</span></div>}
          <p className="a1-intro">{INTRO[k]}</p>
          <div className="a1-form">{body}</div>
          {leftover.length > 0 && (
            <Group title="Documents">
              {leftover.map((d) => <DocUpload key={d.id} doc={d} onChange={setDocs} />)}
            </Group>
          )}
          {k === 'ids' && <div className="a1-info"><A1Icon name="lock" size={16} /><span>Only HR can see your ID documents. They’re never shown to your manager or team.</span></div>}
          {k === 'bank' && <div className="a1-info"><A1Icon name="lock" size={16} /><span>Your account number is stored encrypted. Only HR and payroll can see it.</span></div>}
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
    <div className="a1-field">{doc.title ?? doc.label}{!doc.required && ' (optional)'}
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
          <span className="a1-stack"><span className="a1-strong" style={{ color: 'var(--a1-brand)' }}>{busy ? 'Uploading…' : doc.files.length ? (doc.status === 'sent_back' ? 'Upload it again' : 'Add another file') : `Upload ${doc.label.toLowerCase().startsWith('id') ? 'your ID' : 'the file'}`}</span><span className="a1-help">JPG, PNG or PDF, up to 10 MB</span></span>
        </label>
      )}
      {doc.hint && <span className="a1-help">{doc.hint}</span>}
      {error && <p className="a1-error" role="alert">{error}</p>}
    </div>
  );
}

/** The photo for the ID card: a preview, the tips, and Take a photo / From gallery. */
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
  const tip = (ok: boolean, text: string) => (
    <span className="a1-row" style={{ fontSize: 14, lineHeight: '20px' }}>
      <span className="a1-tick" style={{ border: 0, background: ok ? 'var(--a1-green-bg)' : 'var(--a1-red-bg)', color: ok ? 'var(--a1-green)' : 'var(--a1-red)' }}><A1Icon name={ok ? 'check' : 'x'} size={14} width={2.6} /></span>{text}
    </span>
  );
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <span className={`a1-photo${url ? ' a1-photo--set' : ''}`}>{url ? <img src={url} alt="Your photo" /> : <A1Icon name="person" size={64} width={1.4} />}</span>
        <span className="a1-intro">{busy ? 'Uploading…' : url ? 'Your photo' : 'No photo yet'}</span>
      </div>
      <div className="a1-card">
        <span className="a1-h2">For a photo that works</span>
        {tip(true, 'Face the camera, with your whole face in view')}
        {tip(true, 'A plain, light background and good light')}
        {tip(false, 'No sunglasses, caps or filters')}
      </div>
      <div className="a1-btns">
        <label className="a1-btn" style={{ position: 'relative', height: 48, fontSize: 15 }}><input type="file" accept="image/jpeg,image/png" capture="user" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} onChange={(e) => { void send(e.target.files); e.target.value = ''; }} disabled={busy} aria-label="Take a photo" /><A1Icon name="camera" />Take a photo</label>
        <label className="a1-btn" style={{ position: 'relative', height: 48, fontSize: 15 }}><input type="file" accept="image/jpeg,image/png" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} onChange={(e) => { void send(e.target.files); e.target.value = ''; }} disabled={busy} aria-label="Choose a photo from your gallery" /><A1Icon name="image" />From gallery</label>
      </div>
      {error && <p className="a1-error" role="alert">{error}</p>}
    </>
  );
}
