// Employee profile (Figma "App · 6 Employee profile" and the seven "App · Profile ·" screens):
// the progress and the seven sections here; each section's form is G2SectionForm. Personal, contact, bank, education and IDs save to
// /portal/profile; the emergency contact and PF to About you; each section shows the
// template's documents that belong to it (upload, see HR's note, replace). What is
// typed is kept on this device until it is saved, so a half-filled form survives.
import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { portal } from '../api/portal';
import type { ProfileSectionKey, ProfileView } from '../api/types';
import { FigLoading, FigPage } from '../components/fig/FigShell';
import { G3SectionHead, G3WebBottom, G3WebTop } from '../components/fig/G3WebShell';
import { FigIntro, FigProgress, FigRow } from '../components/fig/FigUi';
import { FigCheckSmall, FigIcon3D, type Fig3DName } from '../components/fig/icons';
import { fmtWeekday } from '../lib/format';
import '../styles/fig-g1.css';
import { G2_SECTIONS, G2SectionForm } from '../components/fig/G2ProfileSections';

export const ORDER: ProfileSectionKey[] = ['personal', 'contact', 'emergency', 'bank', 'education', 'ids', 'photo'];
export const TITLE: Record<ProfileSectionKey, string> = {
  personal: 'Personal details', contact: 'Contact and address', emergency: 'Emergency contact', bank: 'Bank account and PF',
  education: 'Education and experience', ids: 'ID documents', photo: 'Photo',
};
const LIST_TITLE: Record<ProfileSectionKey, string> = { ...TITLE, ids: 'ID documents (Aadhaar, PAN)' };
const HINT: Record<ProfileSectionKey, string> = {
  personal: 'About 2 min', contact: 'About 2 min', emergency: 'About 2 min', bank: 'About 3 min', education: 'About 4 min', ids: 'Aadhaar and PAN', photo: 'For your ID card',
};
export const INTRO: Record<ProfileSectionKey, string> = {
  personal: 'Fill these in exactly as they appear on your ID, so your letters and payslips match.',
  contact: 'HR uses these to reach you and to post anything you need before you join.',
  emergency: 'Who should we call if something happens to you at work? Pick someone who usually answers their phone.',
  bank: 'Your salary is paid into this account, so it must be in your own name.',
  education: 'Your highest qualification and your last job are enough. You can add more if you like.',
  ids: 'HR checks these once to verify who you are. Upload clear photos with all four corners showing.',
  photo: 'This goes on your ID card and your profile, so your team can recognise you on your first day.',
};
const SECTION_3D: Record<ProfileSectionKey, Fig3DName> = { personal: 'user', contact: 'user', emergency: 'phone', bank: 'bank', education: 'write', ids: 'document-approved', photo: 'id-card' };

/** /profile · how far along, and the seven sections (Figma "App · 6 Employee profile", 4967:92891). */
export function A1Profile() {
  const [view, setView] = useState<ProfileView>();
  const [error, setError] = useState('');
  useEffect(() => { portal.profile().then(setView, (e: Error) => setError(e.message)); }, []);
  const next = view?.sections.find((s) => !s.done)?.key;
  const pct = view && view.total ? Math.round((view.done / view.total) * 100) : 0;
  // ID documents: "Upload 2 files" (its template documents), as the design shows.
  const hint = (s: ProfileView['sections'][number]) => (s.key === 'ids' && s.documentIds.length ? `Upload ${s.documentIds.length} file${s.documentIds.length === 1 ? '' : 's'}` : HINT[s.key]);
  return (
    <FigPage>
      <G3WebTop />
      <G3SectionHead title="Employee profile" />
      <main id="main" className="fig-main">
        {!view && !error ? <FigLoading /> : (
          <div className="fig-body-col" style={{ paddingBottom: 12 }}>
            <FigIntro icon="user">Fill in your employee profile before you join, so HR can set up your payroll, ID card and accounts.</FigIntro>
            {error && <p className="fig-field__error" role="alert">{error}</p>}
            {view && (
              <>
                <div className="fig-pct">
                  <div className="fig-pct__top"><b>{pct}%</b><span className="fig-label fig-t2">{view.done} of {view.total} sections done</span></div>
                  <FigProgress value={pct} label="Employee profile done" />
                  {view.finishBy && <span className="fig-label fig-t3" style={{ paddingRight: 20 }}>Finish by {fmtWeekday(view.finishBy)} so your payroll and ID card are ready on your first day.</span>}
                </div>
                <ul className="fig-list">
                  {view.sections.map((s) => {
                    const isNext = s.key === next;
                    return (
                      <li key={s.key}>
                        <FigRow to={`/profile/${s.key}`} className={isNext ? 'fig-row--next' : ''}
                          lead={s.done
                            ? <span className="fig-done"><FigCheckSmall /></span>
                            : <span className={`fig-sec-icon${isNext ? ' fig-sec-icon--next' : ''}`}><FigIcon3D name={SECTION_3D[s.key]} size={20} /></span>}
                          title={LIST_TITLE[s.key]}
                          sub={s.done ? 'Done' : isNext ? `Up next · ${hint(s).toLowerCase()}` : hint(s)}
                          subClass={s.done ? 'fig-success' : isNext ? 'fig-label-strong fig-brand' : 'fig-t3'} />
                      </li>
                    );
                  })}
                </ul>
                <p className="fig-profile-foot">Your answers save as you go, so you can stop and come back.</p>
              </>
            )}
          </div>
        )}
      </main>
      <G3WebBottom />
    </FigPage>
  );
}

type Values = Record<string, unknown>;
const draftKey = (k: ProfileSectionKey) => `sowaka.portal.profile.${k}`;
export function readDraft(k: ProfileSectionKey): Values | null { try { const raw = localStorage.getItem(draftKey(k)); return raw ? (JSON.parse(raw) as Values) : null; } catch { return null; } }
export function writeDraft(k: ProfileSectionKey, v: Values | null) { try { if (v) localStorage.setItem(draftKey(k), JSON.stringify(v)); else localStorage.removeItem(draftKey(k)); } catch { /* not kept */ } }

/** The saved answers of a section, as the form's values (secrets come back empty: only their last four are known). */
export function savedValues(k: ProfileSectionKey, v: ProfileView): Values {
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

/** /profile/:section · one section's form (Figma "App · Profile ·" screens): G2's section shell serves all seven. */
export function A1ProfileSection() {
  const { section = '' } = useParams();
  const key = ORDER.includes(section as ProfileSectionKey) ? (section as ProfileSectionKey) : null;
  if (!key || !G2_SECTIONS.includes(key)) return <Navigate to="/profile" replace />;
  return <G2SectionForm key={key} k={key} />;
}
