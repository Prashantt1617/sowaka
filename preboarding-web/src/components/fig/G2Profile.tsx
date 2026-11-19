// Screen parts of the last four profile sections (Figma "App · Profile ·" Bank account and PF,
// Education and experience, ID documents, Photo; nodes 4967:93357 … 4967:93612): the intro with
// its 3D icon, the month field, the privacy note and the photo's tips. The step header, fields,
// upload tiles and footer stay the shared ones (G1).
import { useEffect, useState, type ReactNode } from 'react';
import type { ProfileSectionKey } from '../../api/types';
import { G2Tick } from './icons/g2-tick';
import { G2Cross } from './icons/g2-cross';
import { G2Lock } from './icons/g2-lock';
import bank3d from './icons/g2-3d-bank.png';
import write3d from './icons/g2-3d-write.png';
import docApproved3d from './icons/g2-3d-docapproved.png';
import idCard3d from './icons/g2-3d-idcard.png';

/** The 3D icon beside each section's intro (Icon/3D/bank, write, document-approved, id-card). */
export const G2_INTRO_ICON: Partial<Record<ProfileSectionKey, string>> = { bank: bank3d, education: write3d, ids: docApproved3d, photo: idCard3d };

export function G2Intro({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="g2-intro">
      <img src={icon} alt="" width={32} height={32} />
      <p>{children}</p>
    </div>
  );
}

/** "Only HR can see your ID documents…": the lock note on the canvas colour. */
export function G2PrivacyNote({ children }: { children: ReactNode }) {
  return <div className="g2-note"><G2Lock /><span>{children}</span></div>;
}

/** One line of "For a photo that works". */
export function G2PhotoTip({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className="g2-tip"><span className="g2-tip__mark">{ok ? <G2Tick /> : <G2Cross />}</span>{children}</span>;
}

/** A month typed as "MM / YYYY" (the design's placeholder); kept as YYYY-MM, as the month input did. */
export function G2MonthInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const show = (v: string) => (/^\d{4}-\d{2}$/.test(v) ? `${v.slice(5)} / ${v.slice(0, 4)}` : v);
  const [text, setText] = useState(show(value));
  useEffect(() => { setText((t) => (toStored(t) === value ? t : show(value))); }, [value]);
  return (
    <input className="a1-input" inputMode="numeric" placeholder="MM / YYYY" aria-label={label} maxLength={9} value={text}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
        const t = digits.length > 2 ? `${digits.slice(0, 2)} / ${digits.slice(2)}` : digits;
        setText(t);
        onChange(toStored(t));
      }} />
  );
}
function toStored(t: string): string {
  const m = /^(\d{2}) \/ (\d{4})$/.exec(t);
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[2]}-${m[1]}` : '';
}
