// Small screen parts of the last four profile sections (Figma "App · Profile ·" Bank account and PF,
// Education and experience, ID documents, Photo): the privacy note, the photo's tips, the month field.
import { useEffect, useState, type ReactNode } from 'react';
import { G2Tick } from './icons/g2-tick';
import { G2Cross } from './icons/g2-cross';
import { G2Lock } from './icons/g2-lock';

/** "Only HR can see your ID documents…": the lock note on the canvas colour. */
export function G2PrivacyNote({ children }: { children: ReactNode }) {
  return <p className="fig-note g2-note"><G2Lock /><span>{children}</span></p>;
}

/** One line of "For a photo that works". */
export function G2PhotoTip({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className="g2-tip"><span className="g2-tip__mark">{ok ? <G2Tick /> : <G2Cross />}</span><span>{children}</span></span>;
}

/** A month typed as "MM / YYYY" (the design's placeholder); kept as YYYY-MM, as the month input did. */
export function G2MonthInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const show = (v: string) => (/^\d{4}-\d{2}$/.test(v) ? `${v.slice(5)} / ${v.slice(0, 4)}` : v);
  const [text, setText] = useState(show(value));
  useEffect(() => { setText((t) => (toStored(t) === value ? t : show(value))); }, [value]);
  return (
    <input id={id} className="fig-input" inputMode="numeric" placeholder="MM / YYYY" maxLength={9} value={text}
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
