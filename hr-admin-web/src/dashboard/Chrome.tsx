// Sidebar, topbar and toast — the persistent shell around the views.
import { useState } from 'react';
import { useBrand } from './brand';
import { useAuth } from './auth/AuthContext';
import type { ReactNode } from 'react';
import type { View } from './theme';
import { TITLES } from './theme';
import { IconBell, IconCheck, IconLogout, IconSearch, Logo, navIcon } from './icons';
import { useStore } from './store';
import { ORG_DISPLAY_NAME, PLATFORM_NAME } from './org';
import { canOpen } from './access';
import { useSupportBadge } from './supportBadge';
import type { ThemeMode } from './themeMode';
import { applyThemeMode, readThemeMode } from './themeMode';
import { SuwiOrb } from './suwi/SuwiPanel';
import { useSuwiNotices } from './suwi/SuwiNoticed';
import { PAGE_ACTIONS_ID } from './ds';

export type NavItem = { key: View; label: string };

export const OVERVIEW_ITEM: NavItem = { key: 'overview', label: 'Overview' };
const REQUESTS: NavItem[] = [
  { key: 'leave', label: 'Leave requests' },
  { key: 'overtime', label: 'Overtime' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'oolcheckins', label: 'OOL check-ins' },
];
// Support is its own section, like Claims: a desk of conversations handled by
// the people given a Support role, not one more approval queue.
const SUPPORT: NavItem[] = [
  { key: 'support', label: 'Tickets' },
];
const PEOPLE: NavItem[] = [
  { key: 'departments', label: 'Departments' },
  { key: 'designations', label: 'Designations' },
  { key: 'employees', label: 'Employees' },
  { key: 'employeeimport', label: 'Import' },
  { key: 'peopletasks', label: 'Tasks' },
  { key: 'orgchart', label: 'Org chart' },
  { key: 'usersroles', label: 'Accesses' },
];
const PERFORMANCE: NavItem[] = [
  { key: 'kpi', label: 'KPI Parameters' },
  { key: 'kpitemplates', label: 'Templates' },
  { key: 'kpibulk', label: 'Bulk Assign' },
  { key: 'feedback', label: 'Performance Reviews' },
  { key: 'cycle', label: 'Cycle' },
];
const SHIFTS: NavItem[] = [
  { key: 'holidaybank', label: 'Holiday Bank' },
  { key: 'shifttypes', label: 'Templates' },
  { key: 'shiftbulk', label: 'Bulk Assign' },
  { key: 'offices', label: 'Offices' },
];
// Reports sits above Payroll: it is what HR reads before a pay cycle is run,
// and the attendance behind it is what the cycle is built from.
const REPORTS: NavItem[] = [
  { key: 'attendancereport', label: 'Attendance' },
];
const PAYROLL: NavItem[] = [
  { key: 'payrolldash', label: 'Payroll Dashboard' },
  { key: 'payschedule', label: 'Pay schedule' },
  { key: 'taxdetails', label: 'Tax details' },
  { key: 'payheads', label: 'Salary Components' },
  { key: 'statutorycomponents', label: 'Statutory Components' },
  { key: 'templates', label: 'Salary Templates' },
  { key: 'paiddays', label: 'Paid Days Templates' },
  { key: 'payruns', label: 'Payroll Runs' },
  { key: 'payrollreports', label: 'Payroll Reports' },
];

// Claims sits below Payroll: the claims people raise and what can be claimed,
// together, so money questions are one section to give someone.
const CLAIMS: NavItem[] = [
  { key: 'reimbursements', label: 'Reimbursement requests' },
  { key: 'reimbursementtypes', label: 'Reimbursement Types' },
];
// Connect's own section: moderation is not an HR request queue like leave, and
// filing it under one would bury it.
const CONNECT: NavItem[] = [
  { key: 'engagementposts', label: 'Engagement posts' },
  { key: 'relaygame', label: 'Relay game' },
  { key: 'contentreports', label: 'Moderate feed' },
];
export const SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'REQUESTS', items: REQUESTS },
  { title: 'SUPPORT', items: SUPPORT },
  { title: 'PEOPLE', items: PEOPLE },
  { title: 'SHIFTS', items: SHIFTS },
  { title: 'PERFORMANCE', items: PERFORMANCE },
  { title: 'REPORTS', items: REPORTS },
  { title: 'PAYROLL', items: PAYROLL },
  { title: 'CLAIMS', items: CLAIMS },
  { title: 'CONNECT', items: CONNECT },
  { title: 'SUWI', items: [{ key: 'suwi', label: 'Settings & activity' }] },
];
const SOON: Partial<Record<View, boolean>> = {};

function CountBadge({ value, danger }: { value: number; danger?: boolean }) {
  return (
    <span
      style={{
        marginLeft: 'auto',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: '16.5px',
        minWidth: 20,
        textAlign: 'center',
        fontVariantNumeric: 'tabular-nums',
        background: danger ? 'var(--bad-solid)' : 'var(--hi)',
        color: '#fff',
        borderRadius: 99,
        padding: '1px 7px',
      }}
    >
      {value}
    </span>
  );
}

function SoonBadge() {
  return (
    <span
      style={{
        marginLeft: 'auto',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '.4px',
        color: 'var(--ink-3)',
        border: '1px solid var(--line-2)',
        borderRadius: 999,
        padding: '1px 7px',
      }}
    >
      SOON
    </span>
  );
}

function NavButton({ item, badge, sub }: { item: NavItem; badge?: ReactNode; sub?: boolean }) {
  const { view, setView } = useStore();
  const active = view === item.key;
  const soon = SOON[item.key];
  return (
    <button
      onClick={() => setView(item.key)}
      className={active ? 'ds-nav-item on' : 'ds-nav-item'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        minHeight: sub ? 38 : 40,
        padding: '9px 12px',
        border: 'none',
        borderRadius: 12,
        cursor: 'pointer',
        fontSize: 13.5,
        lineHeight: 1.5,
        textAlign: 'left',
        transition: 'background .15s, color .15s',
        background: active ? 'var(--sel)' : 'transparent',
        color: active ? 'var(--on-sel)' : soon ? 'var(--ink-4)' : 'var(--ink-2)',
        fontWeight: active ? 500 : 400,
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>{navIcon[item.key]}</span>
      <span style={{ minWidth: 0, flex: 1 }}>{item.label}</span>
      {badge}
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        marginLeft: 'auto',
        transition: 'transform .18s ease',
        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function NavSection({
  title,
  items,
  badgeFor,
}: {
  title: string;
  items: NavItem[];
  badgeFor: (key: View) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="ds-nav-group"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          background: 'none',
          border: 'none',
          borderRadius: 10,
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.5,
          color: 'var(--ink-3)',
          padding: open ? '10px 12px 6px' : '10px 12px 8px',
          justifyContent: 'space-between',
          textAlign: 'left',
        }}
      >
        {/* Sentence case on screen, like the rest of the design; the title itself is unchanged. */}
        <span style={{ textTransform: 'capitalize' }}>{title.toLowerCase()}</span>
        <Chevron open={open} />
      </button>
      {open && items.map((item) => <NavButton key={item.key} item={item} badge={badgeFor(item.key)} sub />)}
    </div>
  );
}

export function Sidebar() {
  const brand = useBrand();
  const { user } = useAuth();
  // The company's real name, not a constant baked in at build time.
  const companyName = brand.name ?? user?.company ?? ORG_DISPLAY_NAME;
  const { leaves, ots, rbs, corrs, fbMgrs, view, setView } = useStore();
  const orgActive = view === 'organisation';
  // Only the tabs People › Accesses gives this person.
  const orgOpen = canOpen(user, 'organisation');
  const sections = SECTIONS.map((s) => ({ ...s, items: s.items.filter((item) => canOpen(user, item.key)) })).filter((s) => s.items.length > 0);
  const leavesPending = leaves.filter((l) => l.status === 'Pending').length;
  const otPending = ots.filter((o) => o.status === 'Pending').length;
  const claims = rbs.filter((r) => r.status === 'Pending').length;
  const corrPending = corrs.filter((c) => c.status === 'Pending').length;
  const reviewsPending = fbMgrs.reduce((s, m) => s + (m.total - m.done), 0);
  // New tickets plus unread for a Support head; their own unread for staff.
  const supportCount = useSupportBadge(canOpen(user, 'support') ? user?.supportRole : null);
  // What Suwi noticed: requests waiting past the limit turn the Requests counts red (Claims already are).
  const overdue = useSuwiNotices().notices.some((n) => n.key === 'requests_overdue');

  const badgeFor = (key: View): ReactNode => {
    switch (key) {
      case 'leave':
        return <CountBadge value={leavesPending} danger={overdue && leavesPending > 0} />;
      case 'overtime':
        return <CountBadge value={otPending} danger={overdue && otPending > 0} />;
      case 'attendance':
        return <CountBadge value={corrPending} danger={overdue && corrPending > 0} />;
      case 'feedback':
        return <CountBadge value={reviewsPending} />;
      case 'reimbursements':
        return <CountBadge value={claims} danger />;
      case 'support':
        return <CountBadge value={supportCount} danger={supportCount > 0} />;
      default:
        return SOON[key] ? <SoonBadge /> : null;
    }
  };

  return (
    <aside
      className="ds-glass"
      style={{
        width: 268,
        flexShrink: 0,
        height: '100%',
        borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-bar)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Company display name + logo — top-left. Clicking opens Organisation details. */}
      <button
        onClick={() => { if (orgOpen) setView('organisation'); }}
        title={orgOpen ? 'Organisation details' : undefined}
        className="ds-brand"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: 'calc(100% - 24px)',
          margin: '12px 12px 8px',
          padding: '10px 12px',
          border: orgActive ? '1px solid transparent' : '1px solid var(--line)',
          borderRadius: 'var(--r)',
          cursor: orgOpen ? 'pointer' : 'default',
          textAlign: 'left',
          background: orgActive ? 'var(--accent-soft)' : 'var(--surface)',
          transition: 'background .15s, border-color .15s',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            // Their app icon fills the tile; Sowaka's mark sits on the brand blue.
            background: brand.icon ? 'var(--surface)' : 'var(--brand)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            overflow: 'hidden',
            border: brand.icon ? '1px solid var(--line)' : undefined,
          }}
        >
          {brand.icon ? <img src={brand.icon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Logo />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 17, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              // Their own weight, case and colour when they have one.
              fontWeight: brand.wordmark?.weight ?? 700,
              letterSpacing: brand.wordmark?.letterSpacing ?? '-.01em',
              textTransform: brand.wordmark?.lowercase ? 'lowercase' : undefined,
              color: orgActive ? 'var(--accent-ink)' : (brand.wordmark?.color ? `color-mix(in srgb, ${brand.wordmark.color} var(--av-fg), var(--ink))` : 'var(--ink)'),
            }}
          >
            {brand.wordmark?.text ?? companyName}
          </div>
        </div>
        {orgOpen && (
          <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={orgActive ? 'var(--accent-ink)' : 'var(--ink-3)'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="m9 6 6 6-6 6" />
          </svg>
        )}
      </button>

      <div className="scry" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '0 12px 16px' }}>
        {canOpen(user, OVERVIEW_ITEM.key) && <NavButton item={OVERVIEW_ITEM} badge={badgeFor(OVERVIEW_ITEM.key)} />}
        {sections.map((section) => (
          <NavSection
            key={section.title}
            title={section.title}
            items={section.items}
            badgeFor={badgeFor}
          />
        ))}
      </div>

      {/* Platform mark — bottom-left. The HRMS this workspace runs on. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderTop: '1px solid var(--line)' }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: 'var(--t-lilac)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Logo stroke="var(--t-lilac-i)" size={15} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.5 }}>{PLATFORM_NAME}</div>
          <div style={{ fontSize: 11.5, fontWeight: 400, lineHeight: 1.5, color: 'var(--ink-3)' }}>HRMS platform</div>
        </div>
      </div>
    </aside>
  );
}

const svgProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: ReactNode }[] = [
  {
    mode: 'system',
    label: 'Match system',
    icon: (
      <svg {...svgProps}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    ),
  },
  {
    mode: 'light',
    label: 'Light',
    icon: (
      <svg {...svgProps}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    mode: 'dark',
    label: 'Dark',
    icon: (
      <svg {...svgProps}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    ),
  },
];

/** System / Light / Dark — a small segmented control in the top bar. */
function ThemeSwitch() {
  const [mode, setMode] = useState<ThemeMode>(readThemeMode);
  return (
    <div role="radiogroup" aria-label="Theme" style={{ display: 'flex', alignItems: 'center', gap: 2, height: 42, padding: 4, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface-2)', flexShrink: 0 }}>
      {THEME_OPTIONS.map((o) => {
        const on = mode === o.mode;
        return (
          <button
            key={o.mode}
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={o.label}
            onClick={() => {
              setMode(o.mode);
              applyThemeMode(o.mode);
            }}
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: on ? 'var(--sel)' : 'transparent',
              color: on ? 'var(--on-sel)' : 'var(--ink-3)',
            }}
          >
            {o.icon}
          </button>
        );
      })}
    </div>
  );
}

export function Topbar() {
  const { view, user, signOut, suwiOpen, setSuwiOpen } = useStore();
  const [title, meta] = TITLES[view];
  const displayName = user?.name ?? 'HR Admin';
  const userInitials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  const iconBtn = {
    position: 'relative' as const,
    width: 42,
    height: 42,
    borderRadius: 999,
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--ink-2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  };
  return (
    <>
      <header
        className="ds-glass"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          borderRadius: 999,
          boxShadow: 'var(--shadow-bar)',
          padding: '8px 10px 8px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div className="ds-field" style={{ display: 'flex', alignItems: 'center', flex: 1, maxWidth: 460, minWidth: 0, height: 40, background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 999, padding: '0 12px', gap: 6, color: 'var(--ink-3)' }}>
          <IconSearch size={15} stroke="var(--ink-3)" />
          <input placeholder="Search people, requests…" className="ds-top-search" style={{ border: 'none', outline: 'none', background: 'none', fontSize: 13, width: '100%', height: '100%', padding: '1px 2px', color: 'var(--ink)' }} />
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setSuwiOpen(!suwiOpen)} aria-expanded={suwiOpen} title="Ask Suwi, your HR assistant" className="ds-suwi-btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 14px 0 8px', borderRadius: 999, border: '1px solid color-mix(in srgb, var(--hi) 30%, var(--line))', background: 'linear-gradient(120deg, var(--surface), var(--sky-soft))', color: 'var(--hi)', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
          <SuwiOrb size={22} />Ask Suwi
        </button>
        <ThemeSwitch />
        <button className="ds-icon-btn" style={iconBtn}>
          <IconBell stroke="currentColor" />
          <span style={{ position: 'absolute', top: 9, right: 10, width: 8, height: 8, background: '#E5533D', borderRadius: '50%', border: '2px solid var(--surface)' }} />
        </button>

        {/* Logged-in HR — top-right. */}
        <div className="ds-me" style={{ display: 'flex', alignItems: 'center', gap: 10, height: 42, padding: '0 14px 0 4px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', flexShrink: 0 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--t-butter)',
              color: 'var(--t-butter-i)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            {userInitials}
          </div>
          <div style={{ minWidth: 0, lineHeight: 1.15, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap' }}>{displayName}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400 }}>HR</div>
          </div>
        </div>
        <button
          onClick={() => void signOut()}
          title="Sign out"
          className="ds-icon-btn"
          style={iconBtn}
        >
          <IconLogout size={18} stroke="currentColor" />
        </button>
      </header>

      {/* Page head: the section line above the page's title. */}
      <div style={{ padding: '28px 4px 0', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 500, lineHeight: '18px', color: 'var(--hi)', letterSpacing: '.02em' }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--hi)', boxShadow: '0 0 0 3px var(--hi-soft)', flexShrink: 0 }} />
            {meta}
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.2, margin: '4px 0' }}>{title}</h1>
        </div>
        {/* A view's own buttons land here (ui.tsx PageActions). */}
        <div id={PAGE_ACTIONS_ID} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} />
      </div>
    </>
  );
}

export function Toast() {
  const { toast, toastTone } = useStore();
  if (!toast) return null;
  const failed = toastTone === 'error';
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 90,
        background: 'var(--ink)',
        color: 'var(--surface)',
        borderRadius: 14,
        padding: '12px 18px',
        fontSize: 13.5,
        fontWeight: 600,
        lineHeight: 1.5,
        boxShadow: 'var(--shadow-lg)',
        maxWidth: 'calc(100% - 32px)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        animation: 'tst .24s ease both',
      }}
    >
      {failed ? (
        <span aria-hidden style={{ width: 18, height: 18, borderRadius: 99, background: 'var(--p-red)', color: 'var(--on-accent)', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>!</span>
      ) : (
        <IconCheck size={17} stroke="var(--p-green)" />
      )}
      {toast}
    </div>
  );
}
