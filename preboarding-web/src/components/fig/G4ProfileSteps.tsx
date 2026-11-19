// G4 · the employee profile's steps 4–7 as in Figma ("Web · Profile · Bank account and PF",
// "· Education and experience", "· ID documents", "· Photo"; 4967:94913–95192): the intro line
// with its 3D icon, the groups and their fields, the template's documents inside the group
// they belong to, and the photo block. The step header, footer and the upload tile are shared
// pieces (G1/G2); A1Profile's SectionForm keeps the saving and the drafts.
import { useEffect, useState, type ReactNode } from 'react';
import { portal } from '../../api/portal';
import type { CandidateDocumentView, ProfileView } from '../../api/types';
import { FigField, FigIntro } from './FigUi';
import type { Fig3DName } from './icons';
import { G4Camera } from './icons/g4-Camera';
import { G4Gallery } from './icons/g4-Gallery';
import { G4Lock } from './icons/g4-Lock';
import { G4Person } from './icons/g4-Person';
import { G4Plus } from './icons/g4-Plus';
import { G4SelectChevron } from './icons/g4-SelectChevron';
import { G4TipCheck } from './icons/g4-TipCheck';
import { G4TipCross } from './icons/g4-TipCross';
import '../../styles/fig.css';
import '../../styles/fig-g4.css';

export type G4StepKey = 'bank' | 'education' | 'ids' | 'photo';
export const isG4Step = (k: string): k is G4StepKey => k === 'bank' || k === 'education' || k === 'ids' || k === 'photo';

const INTRO: Record<G4StepKey, { icon: Fig3DName; text: string }> = {
  bank: { icon: 'bank', text: 'Your salary is paid into this account, so it must be in your own name.' },
  education: { icon: 'write', text: 'Your highest qualification and your last job are enough. You can add more if you like.' },
  ids: { icon: 'document-approved', text: 'HR checks these once to verify who you are. Upload clear photos with all four corners showing.' },
  photo: { icon: 'id-card', text: 'This goes on your ID card and your profile, so your team can recognise you on your first day.' },
};

type Values = Record<string, unknown>;
type Job = Record<string, string>;

/** A titled white card ("Bank account", "Provident fund (PF)"). */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="g4-group">
      <h2 className="fig-subtitle">{title}</h2>
      <div className="fig-card g4-card">{children}</div>
    </section>
  );
}

/** Two or more answers as buttons (Yes / No). The last one stretches when `wide`. */
function Choice({ label, options, value, onPick, wide }: { label: string; options: string[]; value: unknown; onPick: (o: string) => void; wide?: boolean }) {
  return (
    <div className="fig-field" role="radiogroup" aria-label={label}>
      <span className="fig-field__label">{label}</span>
      <div className="g4-choice">
        {options.map((o, n) => <button key={o} type="button" role="radio" aria-checked={value === o} className={wide && n === options.length - 1 ? 'is-wide' : undefined} onClick={() => onPick(o)}>{o}</button>)}
      </div>
    </div>
  );
}

/** A native select drawn as the design's "Choose" field (radius 16, 18 px chevron). */
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (s: string) => void }) {
  return (
    <FigField label={label}>
      <span className="g4-select">
        <select className="fig-input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <G4SelectChevron />
      </span>
    </FigField>
  );
}

export function G4StepBody({ k, view, v, set, docs, renderDoc, done, onPhotoSaved, error }: {
  k: G4StepKey; view: ProfileView; v: Values; set: (patch: Values) => void; docs: CandidateDocumentView[];
  renderDoc: (d: CandidateDocumentView) => ReactNode; done: boolean; onPhotoSaved: (v: ProfileView) => void; error?: string;
}) {
  const s = (name: string) => String(v[name] ?? '');
  const T = (name: string, label: string, o: { ph?: string; help?: string; inputMode?: 'numeric' | 'text'; max?: number; type?: string; value?: string; onChange?: (x: string) => void } = {}) => (
    <FigField label={label} placeholder={o.ph} help={o.help} inputMode={o.inputMode} maxLength={o.max} type={o.type ?? 'text'}
      value={o.value ?? s(name)} onChange={(e) => (o.onChange ? o.onChange(e.target.value) : set({ [name]: e.target.value }))} />
  );
  const intro = INTRO[k];

  let body: ReactNode = null;
  if (k === 'bank') {
    const kept = view.profile.bank?.accountLast4;
    body = (
      <>
        <Group title="Bank account">
          {T('holderName', 'Account holder name', { ph: 'As on your bank account' })}
          {T('accountNumber', 'Account number', { ph: kept ? `Saved: •••• ${kept}. Type it again to change it` : 'Enter your account number', inputMode: 'numeric' })}
          {T('accountNumberAgain', 'Re-enter account number', { ph: 'Type it again to check', inputMode: 'numeric' })}
          {T('ifsc', 'IFSC code', { ph: 'e.g. HDFC0001234', help: 'Printed on your cheque book and passbook', onChange: (x) => set({ ifsc: x.toUpperCase() }), max: 11 })}
          {docs.map(renderDoc)}
        </Group>
        <Group title="Provident fund (PF)">
          <Choice label="Do you have a UAN from a previous job?" options={['Yes', 'No']} value={v.hasUan} onPick={(o) => set({ hasUan: o })} />
          {T('uan', 'UAN (optional)', { ph: '12-digit number', inputMode: 'numeric', max: 12, help: 'If this is your first job, choose No and HR will create one for you.' })}
        </Group>
      </>
    );
  } else if (k === 'education') {
    const jobs = (v.jobs as Job[] | undefined) ?? [];
    const putJob = (n: number, patch: Job) => set({ jobs: jobs.map((j, m) => (m === n ? { ...j, ...patch } : j)) });
    const work = (d: CandidateDocumentView) => /payslip|relieving|experience|salary|employ/i.test(`${d.docKey ?? ''} ${d.label}`);
    body = (
      <>
        <Group title="Education">
          <Select label="Highest qualification" value={s('qualification')} options={view.options.qualifications} onChange={(x) => set({ qualification: x })} />
          {T('institution', 'College or university', { ph: 'e.g. Savitribai Phule Pune University' })}
          {T('year', 'Year of passing', { ph: 'e.g. 2020', inputMode: 'numeric', max: 4 })}
          {docs.filter((d) => !work(d)).map(renderDoc)}
        </Group>
        <Group title="Work experience">
          <Choice label="Have you worked before?" options={['Yes', 'No, this is my first job']} value={v.worked === 'No' ? 'No, this is my first job' : v.worked} wide
            onPick={(o) => set({ worked: o === 'Yes' ? 'Yes' : 'No' })} />
          {v.worked !== 'No' && jobs.map((j, n) => (
            <div key={n} className={`g4-job${n ? ' g4-job--more' : ''}`}>
              {T(`job${n}.company`, n ? `Company ${n + 1}` : 'Last company', { ph: 'Company name', value: j.company, onChange: (x) => putJob(n, { company: x }) })}
              {T(`job${n}.role`, 'Your role', { ph: 'e.g. Admissions counsellor', value: j.role, onChange: (x) => putJob(n, { role: x }) })}
              {T(`job${n}.from`, 'From', { type: 'month', ph: 'MM / YYYY', value: j.from, onChange: (x) => putJob(n, { from: x }) })}
              {T(`job${n}.to`, 'To', { type: 'month', ph: 'MM / YYYY', value: j.to ?? '', onChange: (x) => putJob(n, { to: x }) })}
              {n > 0 && <button type="button" className="g4-textbtn" onClick={() => set({ jobs: jobs.filter((_, m) => m !== n) })}>Remove this job</button>}
            </div>
          ))}
          {v.worked !== 'No' && docs.filter(work).map(renderDoc)}
          {v.worked !== 'No' && jobs.length < 5 && <button type="button" className="g4-textbtn g4-textbtn--add" onClick={() => set({ jobs: [...jobs, { company: '', role: '', from: '', to: '' }] })}><G4Plus />Add another job</button>}
        </Group>
      </>
    );
  } else if (k === 'ids') {
    const ids = view.profile.ids;
    const pan = (d: CandidateDocumentView) => /pan/i.test(`${d.docKey ?? ''} ${d.label}`) && !/aadhaar/i.test(`${d.docKey ?? ''} ${d.label}`);
    body = (
      <>
        <Group title="Aadhaar card">
          {T('aadhaar', 'Aadhaar number', { ph: ids?.aadhaarLast4 ? `Saved: •••• ${ids.aadhaarLast4}` : '12-digit number', inputMode: 'numeric', max: 14 })}
          {docs.filter((d) => !pan(d)).map(renderDoc)}
        </Group>
        <Group title="PAN card">
          {T('pan', 'PAN', { ph: ids?.panLast4 ? `Saved: ••••••${ids.panLast4}` : 'e.g. ABCDE1234F', onChange: (x) => set({ pan: x.toUpperCase() }), max: 10 })}
          {docs.filter(pan).map(renderDoc)}
        </Group>
        <p className="fig-note"><G4Lock /><span>Only HR can see your ID documents. They’re never shown to your manager or team.</span></p>
      </>
    );
  } else {
    body = <PhotoBlock view={view} onSaved={onPhotoSaved} />;
  }

  return (
    <div className="fig g4-step">
      {done && <div className="a1-info a1-info--green"><span>You’ve finished this section. You can still change anything before you join.</span></div>}
      <FigIntro icon={intro.icon}>{intro.text}</FigIntro>
      {body}
      {k === 'bank' && <p className="fig-note"><G4Lock /><span>Your account number is stored encrypted. Only HR and payroll can see it.</span></p>}
      {error && <p className="fig-field__error" role="alert">{error}</p>}
    </div>
  );
}

/** The photo for the ID card: the round preview, the tips, and Take a photo / From gallery. */
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
    <span className="g4-tip"><span className={`g4-tip__mark${ok ? '' : ' g4-tip__mark--no'}`}>{ok ? <G4TipCheck /> : <G4TipCross />}</span>{text}</span>
  );
  const pick = (label: string, icon: ReactNode, text: string, camera?: boolean) => (
    <label className="g4-photo-btn">
      <input type="file" accept="image/jpeg,image/png" capture={camera ? 'user' : undefined} disabled={busy} aria-label={label} onChange={(e) => { void send(e.target.files); e.target.value = ''; }} />
      {icon}{text}
    </label>
  );
  return (
    <>
      <div className="g4-photo">
        <span className={`g4-photo__ring${url ? ' g4-photo__ring--set' : ''}`}>{url ? <img src={url} alt="Your photo" /> : <G4Person />}</span>
        <span className="g4-photo__caption">{busy ? 'Uploading…' : url ? 'Your photo' : 'No photo yet'}</span>
      </div>
      <div className="g4-tips">
        <h2 className="g4-tips__h">For a photo that works</h2>
        {tip(true, 'Face the camera, with your whole face in view')}
        {tip(true, 'A plain, light background and good light')}
        {tip(false, 'No sunglasses, caps or filters')}
      </div>
      <div className="g4-photo-btns">
        {pick('Take a photo', <G4Camera />, 'Take a photo', true)}
        {pick('Choose a photo from your gallery', <G4Gallery />, 'From gallery')}
      </div>
      {error && <p className="fig-field__error" role="alert">{error}</p>}
    </>
  );
}
