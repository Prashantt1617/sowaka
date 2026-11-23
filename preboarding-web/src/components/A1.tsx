// The A1 portal's frame (the 18 Nov design: the app's four-tile home, on the web):
// a 430 px mobile column, the home header (company, help, bell) or a section header
// (back and a title), the inline icons the design draws, and the logo tile.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Company, HrContact } from '../api/types';
import { initials } from '../lib/format';

const P = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
export type A1IconName = 'doc' | 'calendar' | 'person' | 'building' | 'help' | 'bell' | 'back' | 'chevron' | 'check' | 'eye' | 'download' | 'info'
  | 'clock' | 'pin' | 'badge' | 'mail' | 'upload' | 'plus' | 'camera' | 'image' | 'lock' | 'play' | 'close' | 'team' | 'x' | 'tick-circle' | 'send';

/** The design's stroke icons. */
export function A1Icon({ name, size = 20, width = 1.8 }: { name: A1IconName; size?: number; width?: number }) {
  const d: Record<A1IconName, ReactNode> = {
    doc: <path d="M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
    building: <path d="M4 21V5l8-2v18M12 8l8 2v11M2 21h20M8 8h.01M8 12h.01M8 16h.01M16 13h.01M16 17h.01" />,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01" /></>,
    bell: <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />,
    back: <path d="M15 6l-6 6 6 6" />,
    chevron: <path d="M9 6l6 6-6 6" />,
    check: <path d="M5 12l5 5L20 7" />,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
    download: <path d="M12 4v12M6 11l6 6 6-6M5 20h14" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    pin: <><path d="M12 21s-7-6-7-11a7 7 0 1 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
    badge: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 7h6M9 17h6" /><circle cx="12" cy="12" r="2" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
    upload: <path d="M12 16V4M6 9l6-5 6 5M5 20h14" />,
    plus: <path d="M12 5v14M5 12h14" />,
    camera: <><path d="M4 8h3l2-3h6l2 3h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>,
    lock: <path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" />,
    play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    team: <path d="M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20c0-2.6-1.6-4.4-4-5.1" />,
    'tick-circle': <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>,
    send: <path d="M3 11l18-8-8 18-2-8z" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={width} aria-hidden="true" {...P}>{d[name]}</svg>;
}

/** The company's logo, else its initials on the brand colour. */
export function A1Logo({ company, className = 'a1-bar__logo' }: { company?: Company; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={className} aria-hidden="true">
      {company?.logoUrl && !broken ? <img src={company.logoUrl} alt="" onError={() => setBroken(true)} /> : (company ? initials(company.name).slice(0, 2) : '•')}
    </span>
  );
}

/** The mobile column every A1 screen sits in. */
export function A1Frame({ children, white }: { children: ReactNode; white?: boolean }) {
  return (
    <div className="a1">
      <div className={`a1-col${white ? ' a1-col--white' : ''}`}>{children}</div>
    </div>
  );
}

/** The mobile-web header (the design's WebHeader): the company, and the signed-in email under it. */
export function WebHeader({ company, email }: { company?: Company; email?: string }) {
  return (
    <header className="a1-web-head">
      <A1Logo company={company} className="a1-web-head__logo" />
      <span className="a1-stack">
        <span className="a1-strong">{company?.name ?? 'Joining portal'}</span>
        {email && <span className="a1-web-head__email">{email}</span>}
      </span>
    </header>
  );
}

/** "‹ All sections" and the section's title, under the header. */
export function Breadcrumb({ title, to = '/', label = 'All sections' }: { title: string; to?: string; label?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="a1-crumb">
      <Link to={to} className="a1-crumb__back"><A1Icon name="back" size={18} width={2} />{label}</Link>
      <h1 className="a1-crumb__title" tabIndex={-1}>{title}</h1>
    </nav>
  );
}

/** A profile section's own header: back to the profile, its title and step, and the seven segments. */
export function StepHeader({ title, step, segs, back = '/profile' }: { title: string; step: string; segs: Array<'done' | 'on' | 'todo'>; back?: string }) {
  return (
    <div className="a1-stephead">
      <div className="a1-stephead__row">
        <Link to={back} className="a1-icon-btn a1-icon-btn--ink" style={{ marginLeft: 0 }} aria-label="Back to employee profile"><A1Icon name="back" size={22} width={2} /></Link>
        <h1 className="a1-bar__title" style={{ margin: 0 }} tabIndex={-1}>{title}</h1>
        <span className="a1-bar__side">{step}</span>
      </div>
      <div className="a1-steps" role="progressbar" aria-label="Employee profile progress" aria-valuemin={0} aria-valuemax={segs.length} aria-valuenow={segs.filter((x) => x === 'done').length}>
        {segs.map((g, i) => <span key={i} className={g === 'done' ? 'is-done' : g === 'on' ? 'is-on' : ''} />)}
      </div>
    </div>
  );
}

/** The mobile-web footer: Sign out and powered by SOWAKA (Help · Privacy · Write to HR went, 23 Nov). */
export function WebFooter({ onSignOut }: { hr?: HrContact; onSignOut?: () => void; subject?: string }) {
  return (
    <footer className="a1-web-foot">
      {onSignOut && <span className="a1-web-foot__links"><button type="button" onClick={onSignOut}>Sign out</button></span>}
      <span className="a1-powered" style={{ padding: 0 }}>Your company’s pre-boarding is powered by <b>SOWAKA</b></span>
    </footer>
  );
}

export function A1Powered() {
  return <span className="a1-powered">Your company’s pre-boarding is powered by <b>SOWAKA</b></span>;
}

export function A1Loading() {
  return <div className="a1-body" aria-busy="true"><p className="a1-intro">Loading…</p></div>;
}
