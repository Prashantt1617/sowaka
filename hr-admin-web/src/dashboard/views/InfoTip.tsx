// A small (i) that shows a one-line explanation on hover, focus or tap. The
// note is drawn on the page body and kept inside the window, so a dialog's
// scrolling area or a table's edge never clips it.
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconInfo } from '../icons';

const WIDTH = 280;
const GAP = 8;

export function InfoTip({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) { setAt(null); return; }
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const h = tip.current?.offsetHeight ?? 90;
      const above = r.top - GAP - h > 8;
      const left = Math.min(Math.max(8, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8);
      setAt({ left, top: above ? r.top - GAP - h : r.bottom + GAP, above });
    };
    place();
    // Measured once drawn, so the note sits exactly above (or below) the icon.
    const again = requestAnimationFrame(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(again); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);

  return (
    <span style={{ display: 'inline-flex', verticalAlign: 'middle' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button ref={btn} type="button" aria-label={`What is ${label}?`} aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }} onBlur={() => setOpen(false)}
        style={{ width: 18, height: 18, border: 'none', background: 'transparent', padding: 0, display: 'grid', placeItems: 'center', cursor: 'help', borderRadius: '50%', color: 'var(--accent-ink)' }}>
        <IconInfo size={16} stroke="currentColor" />
      </button>
      {open && createPortal(
        <span ref={tip} role="tooltip" style={{
          position: 'fixed', left: at?.left ?? -9999, top: at?.top ?? -9999, width: WIDTH, zIndex: 200, visibility: at ? 'visible' : 'hidden',
          background: 'var(--sel)', color: 'var(--on-sel)', fontSize: 12.5, fontWeight: 400, lineHeight: 1.5, letterSpacing: 0, borderRadius: 10, padding: '10px 12px',
          boxShadow: 'var(--shadow-lg)', textAlign: 'left', whiteSpace: 'normal', pointerEvents: 'none',
        }}>
          <strong style={{ display: 'block', marginBottom: 2, fontWeight: 600 }}>{label}</strong>{text}
        </span>,
        document.body,
      )}
    </span>
  );
}
