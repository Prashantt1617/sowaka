import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Company, HrContact } from '../api/types';
import { Icon } from './Icon';
import { AskHrSheet, IconButton } from './ui';
import { fmtWeekday, initials } from '../lib/format';
import { mailto } from '../lib/links';

const LAST_CLIENT = 'sowaka.portal.client';
const CLIENT_EVENT = 'portal:client';

/**
 * The offer link, the signed-in home and a mail's `?c=` link remember the client,
 * so sign-in / forgot / reset can show its logo and HR. (Kept in memory too, for
 * browsers that block storage.)
 */
let memoryClient: { company?: Company; hr?: HrContact } = {};
export function rememberClient(company: Company, hr?: HrContact) {
  const prev = lastClient();
  const next = { company, hr: hr ?? (prev.company?.name === company.name ? prev.hr : undefined) };
  memoryClient = next;
  try {
    localStorage.setItem(LAST_CLIENT, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new CustomEvent(CLIENT_EVENT));
}

/** lastClient(), kept current when a `?c=` link resolves after the page has drawn. */
export function useLastClient(): { company?: Company; hr?: HrContact } {
  const [client, setClient] = useState(lastClient);
  useEffect(() => {
    const on = () => setClient(lastClient());
    window.addEventListener(CLIENT_EVENT, on);
    return () => window.removeEventListener(CLIENT_EVENT, on);
  }, []);
  return client;
}

export function lastClient(): { company?: Company; hr?: HrContact } {
  try {
    const raw = localStorage.getItem(LAST_CLIENT);
    return raw ? (JSON.parse(raw) as { company?: Company; hr?: HrContact }) : memoryClient;
  } catch {
    return memoryClient;
  }
}

export function ClientLogo({ company, tone = 'light' }: { company?: Company; tone?: 'light' | 'dark' }) {
  const [broken, setBroken] = useState(false);
  if (company?.logoUrl && !broken) {
    return <img className="client-logo__img" src={company.logoUrl} alt={company.name} onError={() => setBroken(true)} />;
  }
  return (
    <span className={`client-logo client-logo--${tone}`}>
      <span className="client-logo__mark" aria-hidden="true">
        {company ? initials(company.name).slice(0, 2) || '•' : '•'}
      </span>
      <span className="client-logo__name">{company?.name ?? 'Joining portal'}</span>
    </span>
  );
}

export interface Bell {
  items: Array<{ title: string; sub?: string; to: string }>;
}

export interface HeaderProps {
  company?: Company;
  hr?: HrContact;
  tone?: 'light' | 'dark';
  back?: string | (() => void);
  close?: string;
  help?: boolean;
  bell?: Bell;
  /** Signed-in joiner chip on wide screens. */
  joiner?: { name: string; tj: string };
  /** Keep back/close on wide screens (mobile-only layouts centred on desktop). */
  navOnWide?: boolean;
  /** Signed in: Sign out in the joiner menu (web) and the Help sheet (phone). */
  onSignOut?: () => void;
}

/** PortalHeader (60 px, mobile) / PortalWebHeader (72 px, ≥ 960 px). One component. */
export function Header({ company, hr, tone = 'light', back, close, help, bell, joiner, navOnWide, onSignOut }: HeaderProps) {
  const navigate = useNavigate();
  const [askOpen, setAskOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const off = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', off);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', off); };
  }, [menuOpen]);
  const navCls = navOnWide ? '' : 'narrow-only';
  // 6Zs §12 #20: the header's Email HR / help carry no subject (P3 and the home tiles do).
  return (
    <header className={`portal-header portal-header--${tone}`}>
      <div className="portal-header__inner">
        <div className="portal-header__left">
          {back &&
            (typeof back === 'string' ? (
              <IconButton icon="back" label="Back" to={back} className={navCls} />
            ) : (
              <IconButton icon="back" label="Back" onClick={back} className={navCls} />
            ))}
          <Link to={joiner ? '/' : '#'} className="portal-header__logo" aria-label={company ? `${company.name} home` : 'Home'} onClick={(e) => !joiner && e.preventDefault()}>
            <ClientLogo company={company} tone={tone} />
          </Link>
        </div>
        <div className="portal-header__right">
          {hr && (
            <a className="header-link wide-only" href={mailto(hr.email)}>
              Email HR
            </a>
          )}
          {help && hr && <IconButton icon="help" label="Help" onClick={() => setAskOpen(true)} className="narrow-only" />}
          {bell && <BellButton bell={bell} />}
          {joiner && !onSignOut && (
            <span className="joiner-chip wide-only">
              <span className="avatar" aria-hidden="true">
                {initials(joiner.name)}
              </span>
              <span className="joiner-chip__text">
                <span className="body-strong">{joiner.name}</span>
                <span className="label">Joining {fmtWeekday(joiner.tj)}</span>
              </span>
            </span>
          )}
          {joiner && onSignOut && (
            <div className="joiner-menu wide-only" ref={menuRef}>
              <button type="button" className="joiner-chip joiner-chip--button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                <span className="avatar" aria-hidden="true">
                  {initials(joiner.name)}
                </span>
                <span className="joiner-chip__text">
                  <span className="body-strong">{joiner.name}</span>
                  <span className="label">Joining {fmtWeekday(joiner.tj)}</span>
                </span>
                <Icon name="chevron-down" size={16} />
              </button>
              {menuOpen && (
                <div className="joiner-menu__list" role="menu">
                  <button type="button" role="menuitem" className="joiner-menu__item" onClick={() => { setMenuOpen(false); onSignOut(); }}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
          {close && <IconButton icon="close" label="Close" onClick={() => navigate(close)} className={navCls} />}
        </div>
      </div>
      {hr && <AskHrSheet open={askOpen} onClose={() => setAskOpen(false)} name={hr.name} email={hr.email} onSignOut={onSignOut ? () => { setAskOpen(false); onSignOut(); } : undefined} />}
    </header>
  );
}

function BellButton({ bell }: { bell: Bell }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const count = bell.items.length;
  return (
    <div className="bell" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={count ? `Notifications, ${count} new` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" />
        {count > 0 && <span className="bell__dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="bell__panel" role="region" aria-label="Notifications">
          {count === 0 ? (
            <p className="label bell__empty">You’re all caught up.</p>
          ) : (
            <ul>
              {bell.items.map((it) => (
                <li key={it.title}>
                  <Link to={it.to} onClick={() => setOpen(false)}>
                    <span className="body-strong">{it.title}</span>
                    {it.sub && <span className="label">{it.sub}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function Footer({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <footer className={`portal-footer portal-footer--${tone}`}>
      Powered by <strong>SOWAKA</strong>
    </footer>
  );
}

/**
 * Page frame: header, content, footer. `layout` narrow = the mobile layout centred
 * at max 430 px on desktop (CONTRACT decision 8); wide = the W layouts (max 1160 px).
 */
export function Page({
  header,
  layout = 'narrow',
  tone = 'light',
  bg,
  children,
  className,
  footer = true,
}: {
  header: HeaderProps;
  layout?: 'narrow' | 'wide';
  tone?: 'light' | 'dark';
  bg?: 'surface' | 'white' | 'brand' | 'tint' | 'dark';
  children: ReactNode;
  className?: string;
  footer?: boolean;
}) {
  return (
    <div className={`page page--${layout} page--bg-${bg ?? 'surface'} ${className ?? ''}`}>
      <Header {...header} tone={header.tone ?? tone} navOnWide={header.navOnWide ?? layout === 'narrow'} />
      <main id="main" className="page__main" tabIndex={-1}>
        {children}
      </main>
      {footer && <Footer tone={tone} />}
    </div>
  );
}
