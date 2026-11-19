// The Figma portal's frame (G1, shared): the 393 px phone column, the company header (home), the
// section header (tinted back button + title), and the powered-by line. Styles: styles/fig.css.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Company } from '../../api/types';
import { initials } from '../../lib/format';
import { FigBack } from './icons';
import '../../styles/fig.css';

/** Inside the app's WebView (the /app entry sets <html data-host="app">): the App frames; else the Web frames. */
export const isAppHost = () => typeof document !== 'undefined' && document.documentElement.dataset.host === 'app';

/** The phone column every Figma screen sits in. `surface` = white page (sign in); default canvas grey. */
export function FigPage({ children, surface }: { children: ReactNode; surface?: boolean }) {
  return (
    <div className="fig">
      <div className={`fig-page${surface ? ' fig-page--surface' : ''}`}>{children}</div>
    </div>
  );
}

/** The company's logo, else its initials (2) on the brand colour. */
export function FigLogo({ company, className = 'fig-head__logo' }: { company?: Company; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={className} aria-hidden="true">
      {company?.logoUrl && !broken ? <img src={company.logoUrl} alt="" onError={() => setBroken(true)} /> : company ? initials(company.name).slice(0, 2) : '•'}
    </span>
  );
}

/** Header · company (App · 3 Home): logo tile and the company name. */
export function FigHomeHeader({ company, children }: { company?: Company; children?: ReactNode }) {
  return (
    <header className="fig-head fig-head--brand">
      <FigLogo company={company} />
      <span className="fig-head__name">{company?.name ?? 'Joining portal'}</span>
      {children}
    </header>
  );
}

/**
 * Header · section (App · 4 Offer letter and on): the 40 px tinted back button and the title.
 * `flat` drops the bottom border (About the company); `side` sits on the right (e.g. "Step 3 of 7");
 * `below` renders under the row inside the same white header (e.g. the profile step segments).
 */
export function FigBackHeader({ title, back = '/', backLabel = 'Back to all sections', onBack, side, flat, below }: {
  title: string; back?: string; backLabel?: string; onBack?: () => void; side?: ReactNode; flat?: boolean; below?: ReactNode;
}) {
  const btn = onBack
    ? <button type="button" className="fig-head__back" aria-label={backLabel} onClick={onBack}><FigBack /></button>
    : <Link to={back} className="fig-head__back" aria-label={backLabel}><FigBack /></Link>;
  const row = (
    <>
      {btn}
      <h1 className="fig-head__title" tabIndex={-1}>{title}</h1>
      {side && <span className="fig-head__side">{side}</span>}
    </>
  );
  if (!below) return <header className={`fig-head fig-head--back${flat ? ' fig-head--flat' : ''}`}>{row}</header>;
  return (
    <header className={`fig-headwrap${flat ? ' fig-head--flat' : ''}`}>
      <div className="fig-head fig-head--back fig-head--flat" style={{ position: 'static' }}>{row}</div>
      {below}
    </header>
  );
}

/** "Your company's app is powered by SOWAKA" (home foot). */
export function FigPowered() {
  return <p className="fig-powered">Your company’s app is powered by <b>SOWAKA</b></p>;
}

export function FigLoading() {
  return <p className="fig-loading" aria-busy="true">Loading…</p>;
}
