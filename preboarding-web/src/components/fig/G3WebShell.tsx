// Web-only chrome (G3, the "Web · …" frames): what the browser portal draws around G1's screens and
// the app WebView does not. Every piece hides itself under <html data-host="app"> (fig-g3.css):
// - G3WebHeader: 56 px header, 32 px logo tile, company 14/20 semi, signed-in email 11/16 (Web · 3–8);
//   without `email` it is the sign-in header (Web · 2). On the web it replaces FigHomeHeader.
// - G3WebFooter: "Your company's pre-boarding is powered by SOWAKA" (Sign out sits in the header).
//   On the web it replaces FigPowered.
// - G3Crumb: "‹ All sections" + the 22/28 title (Web · 5–8), the web's section header.
// - G3SectionHead: the web crumb on the web, G1's FigBackHeader in the app, from one call.
// - G3WebTop / G3WebBottom: the header and footer for a signed-in page (read the session).
// Behaviour is the A1 web shell's (A1Shell.WebPage, A1.WebFooter).
import { type ComponentProps } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { portal } from '../../api/portal';
import type { Company } from '../../api/types';
import { useMe } from '../../session';
import { FigBackHeader, FigLogo } from './FigShell';
import { G3BackSmall } from './icons/g3-icons';
import '../../styles/fig-g3.css';

export function G3WebHeader({ company, email, onSignOut }: { company?: Company; email?: string; onSignOut?: () => void }) {
  return (
    <header className="g3-web g3-head">
      <FigLogo company={company} className="g3-head__logo" />
      <span className="g3-head__text">
        <span className="g3-head__name">{company?.name ?? 'Joining portal'}</span>
        {email && <span className="g3-head__email">{email}</span>}
      </span>
      {onSignOut && <button type="button" className="g3-head__out" onClick={onSignOut}>Sign out</button>}
    </header>
  );
}

/** "Your company's pre-boarding is powered by SOWAKA". The Help · Privacy · Write to HR links went (23 Nov); Sign out is in the header. */
export function G3WebFooter() {
  return (
    <footer className="g3-web g3-foot">
      <span className="g3-foot__powered">Your company’s pre-boarding is powered by <b>SOWAKA</b></span>
    </footer>
  );
}

/** `white` = About the company's white strip (Web · 8: 76 px, 4 px top). */
export function G3Crumb({ title, to = '/', white }: { title: string; to?: string; white?: boolean }) {
  return (
    <nav aria-label="Breadcrumb" className={`g3-web g3-crumb${white ? ' g3-crumb--white' : ''}`}>
      <Link to={to} className="g3-crumb__back"><G3BackSmall />All sections</Link>
      <h1 className="g3-crumb__title" tabIndex={-1}>{title}</h1>
    </nav>
  );
}

/** A section's header: the crumb on the web, FigBackHeader (tinted back, 18/24 title) in the app. */
export function G3SectionHead({ white, ...app }: ComponentProps<typeof FigBackHeader> & { white?: boolean }) {
  return (
    <>
      <G3Crumb title={app.title} to={app.back} white={white} />
      <div className="g3-app-only">
        <FigBackHeader {...app} />
      </div>
    </>
  );
}

/** The signed-in web header (company, personal email). */
export function G3WebTop() {
  const { me } = useMe();
  const navigate = useNavigate();
  return <G3WebHeader company={me.company} email={me.personalEmail} onSignOut={() => { portal.signOut(); navigate('/sign-in', { replace: true }); }} />;
}

/** The signed-in web footer (Ask HR with Sign out). */
export function G3WebBottom() {
  return <G3WebFooter />;
}
