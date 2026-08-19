// Sidebar, topbar and toast — the persistent shell around the views.
import type { ReactNode } from 'react';
import type { View } from './theme';
import { TITLES } from './theme';
import { IconBell, IconCheck, IconLogout, IconSearch, Logo, navIcon } from './icons';
import { useStore } from './store';

type NavItem = { key: View; label: string };

const PEOPLE_OPS: NavItem[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'leave', label: 'Leave requests' },
  { key: 'overtime', label: 'Overtime' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'reimbursements', label: 'Reimbursements' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'exit', label: 'Exit' },
];
const PEOPLE: NavItem[] = [
  { key: 'departments', label: 'Departments' },
  { key: 'designations', label: 'Designations' },
  { key: 'employees', label: 'Employees' },
  { key: 'orgchart', label: 'Org chart' },
  { key: 'usersroles', label: 'Accesses' },
];
const PAYROLL: NavItem[] = [
  { key: 'payschedule', label: 'Pay schedule' },
  { key: 'taxdetails', label: 'Tax details' },
  { key: 'payheads', label: 'Salary Components' },
  { key: 'templates', label: 'Salary Templates' },
  { key: 'statutorycomponents', label: 'Statutory Components' },
  { key: 'salary', label: 'Salary Structure' },
  { key: 'payruns', label: 'Payroll Runs' },
  { key: 'statutory', label: 'Statutory Rules' },
];
const ORGANISATION: NavItem[] = [
  { key: 'games', label: 'Games' },
  { key: 'settings', label: 'Settings' },
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
      {navIcon[item.key]}
      {item.label}
      {badge}
    </button>
  );
}

export function Sidebar() {
  const { leaves, ots, rbs, fbMgrs, user, signOut, view, setView } = useStore();
  const orgName = user?.company ?? 'Convrse Spaces';
  const orgActive = view === 'organisation';
  const displayName = user?.name ?? 'HR Admin';
  const roleLabel = user ? `${user.role[0].toUpperCase()}${user.role.slice(1)} · ${user.company}` : 'HR Admin';
  const userInitials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 8px 18px' }}>
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
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.3px', lineHeight: 1 }}>Sowaka</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#717171', marginTop: 3, letterSpacing: '.2px' }}>Convrse Spaces</div>
        </div>
      </div>

      {/* Current organisation — sits above everything, opens the Organisation profile. */}
      <button
        onClick={() => setView('organisation')}
        title="Organisation"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '9px 10px',
          marginBottom: 6,
          border: `1px solid ${orgActive ? '#EBEBEB' : '#EBEBEB'}`,
          borderRadius: 12,
          cursor: 'pointer',
          textAlign: 'left',
          background: orgActive ? '#E7F4FB' : '#fff',
          transition: 'background .15s, border-color .15s',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
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
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.6px', color: '#9197A2' }}>ORGANISATION</div>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.2px', color: orgActive ? '#0571A6' : '#222222', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{orgName}</div>
        </div>
        <span style={{ color: orgActive ? '#0571A6' : '#9197A2', fontSize: 20, fontWeight: 700 }}>›</span>
      </button>

      <div className="scry" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.7px', color: '#9197A2', padding: '8px 12px 6px' }}>PEOPLE OPS</div>
        {PEOPLE_OPS.map((item) => (
          <NavButton key={item.key} item={item} badge={badgeFor(item.key)} />
        ))}
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.7px', color: '#9197A2', padding: '16px 12px 6px' }}>PEOPLE</div>
        {PEOPLE.map((item) => (
          <NavButton key={item.key} item={item} badge={badgeFor(item.key)} />
        ))}
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.7px', color: '#9197A2', padding: '16px 12px 6px' }}>PAYROLL</div>
        {PAYROLL.map((item) => (
          <NavButton key={item.key} item={item} badge={badgeFor(item.key)} />
        ))}
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.7px', color: '#9197A2', padding: '16px 12px 6px' }}>ORGANISATION</div>
        {ORGANISATION.map((item) => (
          <NavButton key={item.key} item={item} badge={badgeFor(item.key)} />
        ))}
      </div>

      <button
        onClick={() => void signOut()}
        title="Sign out"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 10px', marginTop: 8, width: '100%', background: 'none', border: 'none', borderTop: '1px solid #EBEBEB', cursor: 'pointer', textAlign: 'left' }}
      >
        <div
          style={{
            width: 33,
            height: 33,
            borderRadius: '50%',
            background: '#7C7A52',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          {userInitials}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
          <div style={{ fontSize: 12, color: '#717171', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{roleLabel}</div>
        </div>
        <IconLogout />
      </button>
    </aside>
  );
}

export function Topbar() {
  const { view } = useStore();
  const [title, meta] = TITLES[view];
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
