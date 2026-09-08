// Sidebar, topbar and toast — the persistent shell around the views.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { View } from './theme';
import { TITLES } from './theme';
import { IconBell, IconCheck, IconLogout, IconSearch, Logo, navIcon } from './icons';
import { useStore } from './store';
import { ORG_DISPLAY_NAME, PLATFORM_NAME } from './org';

type NavItem = { key: View; label: string };

const OVERVIEW_ITEM: NavItem = { key: 'overview', label: 'Overview' };
const REQUESTS: NavItem[] = [
  { key: 'leave', label: 'Leave requests' },
  { key: 'overtime', label: 'Overtime' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'reimbursements', label: 'Reimbursements' },
];
const PEOPLE: NavItem[] = [
  { key: 'departments', label: 'Departments' },
  { key: 'designations', label: 'Designations' },
  { key: 'employees', label: 'Employees' },
  { key: 'orgchart', label: 'Org chart' },
  { key: 'usersroles', label: 'Accesses' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'exit', label: 'Exit' },
];
const PERFORMANCE: NavItem[] = [
  { key: 'kpi', label: 'KPI Parameters' },
  { key: 'kpitemplates', label: 'Templates' },
  { key: 'kpibulk', label: 'Bulk Assign' },
  { key: 'feedback', label: 'Performance Reviews' },
];
const SHIFTS: NavItem[] = [
  { key: 'policies', label: 'Policies' },
  { key: 'holidaybank', label: 'Holiday Bank' },
  { key: 'shifttypes', label: 'Templates' },
];
const PAYROLL: NavItem[] = [
  { key: 'payschedule', label: 'Pay schedule' },
  { key: 'taxdetails', label: 'Tax details' },
  { key: 'payheads', label: 'Salary Components' },
  { key: 'statutorycomponents', label: 'Statutory Components' },
  { key: 'templates', label: 'Salary Templates' },
  { key: 'payruns', label: 'Payroll Runs' },
];
// Company-wide rules: week-offs, per-team overtime and the review cycle.
// Top-level rather than in a section: sections start collapsed, which would
// hide a group holding a single item.
const SETTINGS_ITEM: NavItem = { key: 'settings', label: 'Settings' };

const SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'REQUESTS', items: REQUESTS },
  { title: 'PEOPLE', items: PEOPLE },
  { title: 'SHIFTS', items: SHIFTS },
  { title: 'PERFORMANCE', items: PERFORMANCE },
  { title: 'PAYROLL', items: PAYROLL },
];
const SOON: Partial<Record<View, boolean>> = { attendance: true, onboarding: true, exit: true };

function CountBadge({ value, danger }: { value: number; danger?: boolean }) {
  return (
    <span
      style={{
        marginLeft: 'auto',
        fontSize: 12,
        fontWeight: 700,
        background: danger ? '#C4382E' : '#F7F7F9',
        color: danger ? '#fff' : '#9A6B25',
        borderRadius: 20,
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
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '.4px',
        color: '#9197A2',
        border: '1px solid #EBEBEB',
        borderRadius: 20,
        padding: '1px 7px',
      }}
    >
      SOON
    </span>
  );
}

function NavButton({ item, badge }: { item: NavItem; badge?: ReactNode }) {
  const { view, setView } = useStore();
  const active = view === item.key;
  const soon = SOON[item.key];
  return (
    <button
      onClick={() => setView(item.key)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        width: '100%',
        padding: '9px 12px',
        border: 'none',
        borderRadius: 11,
        cursor: 'pointer',
        fontSize: 16,
        textAlign: 'left',
        transition: 'background .15s',
        background: active ? '#E7F4FB' : 'transparent',
        color: active ? '#0571A6' : soon ? '#9197A2' : '#484848',
        fontWeight: active ? 700 : 600,
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>{navIcon[item.key]}</span>
      <span style={{ minWidth: 0, flex: 1 }}>{item.label}</span>
      {badge}
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
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
  first,
}: {
  title: string;
  items: NavItem[];
  badgeFor: (key: View) => ReactNode;
  first?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '.7px',
          color: '#9197A2',
          padding: first ? '8px 12px 6px' : '16px 12px 6px',
          textAlign: 'left',
        }}
      >
        <span>{title}</span>
        <Chevron open={open} />
      </button>
      {open && items.map((item) => <NavButton key={item.key} item={item} badge={badgeFor(item.key)} />)}
    </div>
  );
}

export function Sidebar() {
  const { leaves, ots, rbs, fbMgrs, view, setView } = useStore();
  const orgActive = view === 'organisation';
  const leavesPending = leaves.filter((l) => l.status === 'Pending').length;
  const otPending = ots.filter((o) => o.status === 'Pending').length;
  const claims = rbs.filter((r) => r.status === 'Pending').length;
  const reviewsPending = fbMgrs.reduce((s, m) => s + (m.total - m.done), 0);

  const badgeFor = (key: View): ReactNode => {
    switch (key) {
      case 'leave':
        return <CountBadge value={leavesPending} />;
      case 'overtime':
        return <CountBadge value={otPending} />;
      case 'feedback':
        return <CountBadge value={reviewsPending} />;
      case 'reimbursements':
        return <CountBadge value={claims} danger />;
      default:
        return SOON[key] ? <SoonBadge /> : null;
    }
  };

  return (
    <aside
      style={{
        width: 244,
        flexShrink: 0,
        background: '#F7F7F9',
        borderRight: '1px solid #EBEBEB',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 14px 14px',
      }}
    >
      {/* Company display name + logo — top-left. Clicking opens Organisation details. */}
      <button
        onClick={() => setView('organisation')}
        title="Organisation details"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '9px 10px',
          marginBottom: 10,
          border: '1px solid #EBEBEB',
          borderRadius: 12,
          cursor: 'pointer',
          textAlign: 'left',
          background: orgActive ? '#E7F4FB' : '#fff',
          transition: 'background .15s, border-color .15s',
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: '#0571A6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 2px 6px rgba(5,113,166,.28)',
          }}
        >
          <Logo />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.2px', lineHeight: 1.05, color: orgActive ? '#0571A6' : '#222222', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ORG_DISPLAY_NAME}</div>
        </div>
        <span style={{ color: orgActive ? '#0571A6' : '#9197A2', fontSize: 20, fontWeight: 700 }}>›</span>
      </button>

      <div className="scry" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4 }}>
        <NavButton item={OVERVIEW_ITEM} badge={badgeFor(OVERVIEW_ITEM.key)} />
        {SECTIONS.map((section, i) => (
          <NavSection
            key={section.title}
            title={section.title}
            items={section.items}
            badgeFor={badgeFor}
            first={i === 0}
          />
        ))}
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #F0F0F2' }}>
          <NavButton item={SETTINGS_ITEM} badge={badgeFor(SETTINGS_ITEM.key)} />
        </div>
      </div>

      {/* Platform mark — bottom-left. The HRMS this workspace runs on. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 10px 4px', marginTop: 8, borderTop: '1px solid #EBEBEB' }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: '#0571A6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 2px 6px rgba(5,113,166,.28)',
          }}
        >
          <Logo />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-.2px', lineHeight: 1 }}>{PLATFORM_NAME}</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#9197A2', marginTop: 2, letterSpacing: '.2px' }}>HRMS platform</div>
        </div>
      </div>
    </aside>
  );
}

export function Topbar() {
  const { view, user, signOut } = useStore();
  const [title, meta] = TITLES[view];
  const displayName = user?.name ?? 'HR Admin';
  const userInitials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        background: 'rgba(247,247,249,.82)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid #EBEBEB',
        padding: '15px 34px',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#717171', letterSpacing: '.2px' }}>{meta}</div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.4px', marginTop: 1 }}>{title}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #EBEBEB', borderRadius: 11, padding: '8px 13px', gap: 9, width: 248 }}>
        <IconSearch />
        <input placeholder="Search people, requests…" style={{ border: 'none', outline: 'none', background: 'none', fontSize: 16, width: '100%', color: '#222222' }} />
      </div>
      <button
        style={{
          position: 'relative',
          width: 40,
          height: 40,
          borderRadius: 11,
          border: '1px solid #EBEBEB',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <IconBell />
        <span style={{ position: 'absolute', top: 9, right: 10, width: 7, height: 7, background: '#0571A6', borderRadius: '50%', border: '1.5px solid #fff' }} />
      </button>

      {/* Logged-in HR — top-right. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 4 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: '#7C7A52',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 15,
            flexShrink: 0,
          }}
        >
          {userInitials}
        </div>
        <div style={{ minWidth: 0, lineHeight: 1.15 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap' }}>{displayName}</div>
          <div style={{ fontSize: 12, color: '#717171', fontWeight: 600 }}>HR</div>
        </div>
        <button
          onClick={() => void signOut()}
          title="Sign out"
          style={{ width: 38, height: 38, borderRadius: 11, border: '1px solid #EBEBEB', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginLeft: 2 }}
        >
          <IconLogout />
        </button>
      </div>
    </header>
  );
}

export function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 26,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 90,
        background: '#222222',
        color: '#fff',
        borderRadius: 13,
        padding: '13px 20px',
        fontSize: 16,
        fontWeight: 600,
        boxShadow: '0 12px 30px rgba(34,34,34,.32)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        animation: 'tst .24s ease both',
      }}
    >
      <IconCheck size={17} stroke="#7FBF82" />
      {toast}
    </div>
  );
}
