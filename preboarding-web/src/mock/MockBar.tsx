import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { OFFER_TOKENS, SCENARIOS } from './handler';

/** Dev-only (VITE_MOCK=1): jump between every portal state. Hidden with ?clean=1 (screenshots). */
export default function MockBar() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  if (new URLSearchParams(location.search).has('clean')) return null;
  return (
    <div className="mockbar">
      <button type="button" className="mockbar__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Mock
      </button>
      {open && (
        <nav className="mockbar__panel" aria-label="Mock states">
          <p className="eyebrow">Home states</p>
          {SCENARIOS.map((s) => (
            <a key={s} href={`${import.meta.env.BASE_URL}?mock=${s}`}>
              {s}
            </a>
          ))}
          <p className="eyebrow">Offer links</p>
          {OFFER_TOKENS.map((t) => (
            <a key={t} href={`${import.meta.env.BASE_URL}o/${t}`}>
              /o/{t}
            </a>
          ))}
          <p className="eyebrow">Screens</p>
          {['/documents', '/about', '/meet', '/letters', '/pass', '/date-request', '/offer', '/sign-in', '/forgot', '/reset/demo'].map((p) => (
            <Link key={p} to={p} onClick={() => setOpen(false)}>
              {p}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
