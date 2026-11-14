// A small (i) that shows a one-line explanation on hover, focus or tap.
import { useState } from 'react';

export function InfoTip({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={`What is ${label}?`} aria-expanded={open} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }} onBlur={() => setOpen(false)}
        style={{ width: 17, height: 17, borderRadius: '50%', border: '1.5px solid var(--accent-ink)', color: 'var(--accent-ink)', background: 'transparent', fontSize: 10.5, fontWeight: 700, lineHeight: 1, display: 'grid', placeItems: 'center', cursor: 'help', padding: 0, fontFamily: 'inherit' }}>
        i
      </button>
      {open && (
        <span role="tooltip" style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', width: 280, zIndex: 80, background: 'var(--ink)', color: 'var(--on-sel)', fontSize: 12.5, fontWeight: 400, lineHeight: 1.5, borderRadius: 10, padding: '10px 12px', boxShadow: 'var(--shadow-lg)', textAlign: 'left', whiteSpace: 'normal' }}>
          <strong style={{ display: 'block', marginBottom: 2, fontWeight: 600 }}>{label}</strong>{text}
        </span>
      )}
    </span>
  );
}
