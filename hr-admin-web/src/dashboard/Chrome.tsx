// Sidebar, topbar and toast — the persistent shell around the views.
import { useState } from 'react';
import { SOWAKA_MARK, SOWAKA_WORDMARK, useBrand } from './brand';
import { useAuth } from './auth/AuthContext';
import type { ReactNode } from 'react';
import type { View } from './theme';
import { prefetchView } from './viewChunks';
import { TITLES } from './theme';
import { IconCheck, IconLogout, navIcon } from './icons';
import { useStore } from './store';
import type { StoreList } from './store';
import { PersonAvatar } from './PersonAvatar';
import { ORG_DISPLAY_NAME, PLATFORM_NAME } from './org';
import { canOpen } from './access';
import { useSupportBadge } from './supportBadge';
import { useFbpBadge } from './fbpBadge';
import type { ThemeMode } from './themeMode';
import { applyThemeMode, readThemeMode } from './themeMode';
import { SuwiOrb } from './suwi/SuwiPanel';
import { useSuwiNotices } from './suwi/SuwiNoticed';
import { PAGE_ACTIONS_ID } from './ds';
import { BULK_VIEWS, SETUP_VIEWS } from './setupGroups';

/** `hidden`: not shown in the sidebar, but still part of its section's access (Accesses grants it). */
export type NavItem = { key: View; label: string; hidden?: boolean };

export const OVERVIEW_ITEM: NavItem = { key: 'overview', label: 'Overview' };
// Every settings page, by area (setupGroups.ts); those pages are hidden in their own sections.
export const SETUP_ITEM: NavItem = { key: 'setup', label: 'Setup' };
// Every bulk assignment (setupGroups.ts), likewise hidden in their own sections.
export const BULK_ITEM: NavItem = { key: 'bulkassign', label: 'Bulk assign' };
// In the redesign's order: who is in or off and every punch first, then the
// requests that change them. OOL check-ins stays reachable (granted with Time
// office) but off the sidebar: the Punch log shows those punches.
const REQUESTS: NavItem[] = [
  { key: 'companycalendar', label: 'Company calendar' },
  { key: 'punchlog', label: 'Punch log' },
  { key: 'attendance', label: 'Attendance corrections' },
  { key: 'leave', label: 'Leave requests' },
  { key: 'overtime', label: 'Overtime' },
  { key: 'oolcheckins', label: 'OOL check-ins', hidden: true },
];
// Support is its own section, like Claims: a desk of conversations handled by
// the people given a Support role, not one more approval queue.
const SUPPORT: NavItem[] = [
  { key: 'support', label: 'Tickets' },
];
const PEOPLE: NavItem[] = [
  { key: 'departments', label: 'Departments', hidden: true },
  { key: 'designations', label: 'Designations', hidden: true },
  { key: 'employees', label: 'Employees' },
  { key: 'employeeimport', label: 'Import' },
  { key: 'peopletasks', label: 'Tasks' },
  { key: 'orgchart', label: 'Org chart' },
  { key: 'usersroles', label: 'Accesses' },
];
const PERFORMANCE: NavItem[] = [
  { key: 'kpi', label: 'KPI Parameters', hidden: true },
  { key: 'kpitemplates', label: 'Templates', hidden: true },
  { key: 'kpibulk', label: 'Bulk Assign', hidden: true },
  { key: 'feedback', label: 'Performance Reviews' },
  { key: 'cycle', label: 'Cycle', hidden: true },
];
const SHIFTS: NavItem[] = [
  { key: 'holidaybank', label: 'Holiday Bank', hidden: true },
  { key: 'shifttypes', label: 'Templates', hidden: true },
  { key: 'shiftbulk', label: 'Bulk Assign', hidden: true },
  { key: 'offices', label: 'Offices', hidden: true },
  // Hidden from the Shifts menu for now (still granted with Shifts / its own tab).
  { key: 'faceid', label: 'Face check', hidden: true },
];
const PAYROLL: NavItem[] = [
  { key: 'payrolldash', label: 'Payroll Dashboard' },
  { key: 'payschedule', label: 'Pay schedule', hidden: true },
  { key: 'taxdetails', label: 'Tax details', hidden: true },
  { key: 'payheads', label: 'Salary Components', hidden: true },
  { key: 'statutorycomponents', label: 'Statutory & tax', hidden: true },
  { key: 'payrollconfig', label: 'Statutory & tax settings', hidden: true },
  { key: 'templates', label: 'Salary Templates', hidden: true },
  { key: 'paiddays', label: 'Paid Days Templates', hidden: true },
  { key: 'payruns', label: 'Payroll Runs' },
  { key: 'payrollreports', label: 'Payroll Reports' },
  { key: 'payrollbulk', label: 'Bulk Assign', hidden: true },
];
// What employees upload for tax: FBP bills and splits, and investment proofs. Its own
// section in the sidebar, but given with Payroll Runs or Salary details (access.ts).
const TAX_UPLOADS: NavItem[] = [
  { key: 'fbprequests', label: 'FBP requests' },
  { key: 'fbpsplits', label: 'FBP splits' },
  { key: 'investmentproofs', label: 'Investment proofs' },
];

// Claims sits below Payroll: the claims people raise and what can be claimed,
// together, so money questions are one section to give someone.
const CLAIMS: NavItem[] = [
  { key: 'reimbursements', label: 'Reimbursement requests' },
  { key: 'reimbursementtypes', label: 'Reimbursement Types', hidden: true },
];
// Engagement: how people use the app, the feed (reported posts included, so
// moderation sits where the posts are), the plan, contests and games. Tournament
// TV and relay teams live inside a game's page.
const ENGAGEMENT: NavItem[] = [
  { key: 'appusage', label: 'App usage' },
  { key: 'feed', label: 'Feed' },
  { key: 'engagementplan', label: 'Engagement plan' },
  { key: 'contests', label: 'Contests' },
  { key: 'games', label: 'Games' },
];
// Placements: a placement agency's own work, so it comes first; only a
// company with the feature sees it (see access.ts).
const PLACEMENTS: NavItem[] = [
  { key: 'placements', label: 'Placements' },
  { key: 'placementclients', label: 'Clients' },
  { key: 'placementcustomers', label: 'Candidates' },
];
export const SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'PLACEMENTS', items: PLACEMENTS },
  { title: 'TIME OFFICE', items: REQUESTS },
  { title: 'SUPPORT', items: SUPPORT },
  { title: 'PEOPLE', items: PEOPLE },
  { title: 'SHIFTS', items: SHIFTS },
  { title: 'PERFORMANCE', items: PERFORMANCE },
  { title: 'PAYROLL', items: PAYROLL },
  { title: 'TAX UPLOADS', items: TAX_UPLOADS },
  { title: 'CLAIMS', items: CLAIMS },
  { title: 'ENGAGEMENT', items: ENGAGEMENT },
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
  // Setup stays lit on the settings pages it leads to.
  const active = view === item.key || (item.key === 'setup' && SETUP_VIEWS.includes(view)) || (item.key === 'bulkassign' && BULK_VIEWS.includes(view));
  const soon = SOON[item.key];
  return (
    <button
      onClick={() => setView(item.key)}
      onMouseEnter={() => prefetchView(item.key)}
      onFocus={() => prefetchView(item.key)}
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
  const { leaves, ots, rbs, corrs, fbMgrs, listState } = useStore();
  const sections = SECTIONS.map((s) => ({ ...s, items: s.items.filter((item) => !item.hidden && canOpen(user, item.key)) })).filter((s) => s.items.length > 0);
  // A cancellation request on an approved leave waits on HR's decision too.
  const leavesPending = leaves.filter((l) => l.status === 'Pending' || l.cancelRequest?.status === 'Pending').length;
  const otPending = ots.filter((o) => o.status === 'Pending').length;
  const claims = rbs.filter((r) => r.status === 'Pending').length;
  const corrPending = corrs.filter((c) => c.status === 'Pending').length;
  const reviewsPending = fbMgrs.reduce((s, m) => s + (m.total - m.done), 0);
  // New tickets plus unread for a Support head; their own unread for staff.
  const supportCount = useSupportBadge(canOpen(user, 'support') ? user?.supportRole : null);
  // FBP bills waiting for HR: counted under FBP requests, not under reimbursements.
  const fbpPending = useFbpBadge(canOpen(user, 'fbprequests'));
  // What Suwi noticed: requests waiting past the limit turn the Requests counts red (Claims already are).
  const overdue = useSuwiNotices().notices.some((n) => n.key === 'requests_overdue');

  // A count waits for its list: no "0" before the requests have arrived.
  const LIST_FOR: Partial<Record<View, StoreList>> = { leave: 'leaves', overtime: 'overtime', attendance: 'corrections', feedback: 'feedback', reimbursements: 'claims' };
  const badgeFor = (key: View): ReactNode => {
    const list = LIST_FOR[key];
    if (list && listState(list) !== 'ready') return null;
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
      case 'fbprequests':
        return fbpPending === null ? null : <CountBadge value={fbpPending} danger={fbpPending > 0} />;
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
      {/* Company display name + logo — top-left. Organisation details is opened from Setup. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: 'calc(100% - 24px)',
          margin: '12px 12px 8px',
          padding: '10px 12px',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r)',
          textAlign: 'left',
          background: 'var(--surface)',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            // Their app icon fills the tile; Sowaka's mark sits on the brand blue.
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            overflow: 'hidden',
            border: brand.icon ? '1px solid var(--line)' : undefined,
          }}
        >
          <img src={brand.icon ?? SOWAKA_MARK} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 17, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              // A long name on two lines, a size down, rather than cut off.
              ...(brand.wordmark?.twoLines ? { fontSize: 14.5, lineHeight: 1.2, whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const } : null),
              // Their own weight, case and colour when they have one.
              fontWeight: brand.wordmark?.weight ?? 700,
              letterSpacing: brand.wordmark?.letterSpacing ?? '-.01em',
              textTransform: brand.wordmark?.lowercase ? 'lowercase' : undefined,
              color: brand.wordmark?.color ? `color-mix(in srgb, ${brand.wordmark.color} var(--av-fg), var(--ink))` : 'var(--ink)',
            }}
          >
            {brand.wordmark?.text ?? companyName}
          </div>
        </div>
      </div>

      <div className="scry" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '0 12px 16px' }}>
        {canOpen(user, SETUP_ITEM.key) && <NavButton item={SETUP_ITEM} />}
        {canOpen(user, BULK_ITEM.key) && <NavButton item={BULK_ITEM} />}
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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: '16px 20px', borderTop: '1px solid var(--line)' }}>
        <img src={SOWAKA_WORDMARK} alt={PLATFORM_NAME} style={{ height: 30, width: 'auto', display: 'block' }} />
        <div style={{ fontSize: 11.5, fontWeight: 400, lineHeight: 1.5, color: 'var(--ink-3)' }}>HRMS platform</div>
      </div>
    </aside>
  );
}

const svgProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: ReactNode }[] = [
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

/**
 * Light / Dark in the top bar. With nothing picked the dashboard follows the
 * device, and the switch lights whichever of the two that is.
 */
function ThemeSwitch() {
  const [mode, setMode] = useState<ThemeMode>(readThemeMode);
  const shown = mode === 'system' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;
  return (
    <div role="radiogroup" aria-label="Theme" style={{ display: 'flex', alignItems: 'center', gap: 2, height: 42, padding: 4, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface-2)', flexShrink: 0 }}>
      {THEME_OPTIONS.map((o) => {
        const on = shown === o.mode;
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
  const { view, setView, user, signOut, suwiOpen, setSuwiOpen } = useStore();
  const [title, fixedMeta] = TITLES[view];
  // A company with Suwi turned off sees no Ask Suwi button (Settings › Suwi can turn it on).
  const suwiOff = useSuwiNotices().enabled === false;
  // The overview's line is today's date, in India time like the rest of the dashboard.
  const meta = view === 'overview'
    ? `${new Date().toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Kolkata' })}, ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}`
    : fixedMeta;
  const displayName = user?.name ?? 'HR Admin';
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
        <div style={{ flex: 1 }} />
        {!suwiOff && (
          <button type="button" onClick={() => setSuwiOpen(!suwiOpen)} aria-expanded={suwiOpen} title="Ask Suwi, your HR assistant" className="ds-suwi-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 14px 0 8px', borderRadius: 999, border: '1px solid color-mix(in srgb, var(--suwi) 30%, var(--line))', background: 'linear-gradient(120deg, var(--surface), var(--suwi-soft))', color: 'var(--suwi-ink)', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <SuwiOrb size={22} />Ask Suwi
          </button>
        )}
        <ThemeSwitch />

        {/* Logged-in HR — top-right. */}
        <div className="ds-me" style={{ display: 'flex', alignItems: 'center', gap: 10, height: 42, padding: '0 14px 0 4px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', flexShrink: 0 }}>
          <PersonAvatar name={displayName} userId={user?.id} size={32} font={12} tone={{ bg: 'var(--t-butter)', fg: 'var(--t-butter-i)' }} />
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
            {meta && <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--hi)', boxShadow: '0 0 0 3px var(--hi-soft)', flexShrink: 0 }} />}
            {meta}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* A page opened from Setup or Bulk assign has its way back beside the title. */}
            {((SETUP_VIEWS.includes(view) && canOpen(user, 'setup')) || (BULK_VIEWS.includes(view) && canOpen(user, 'bulkassign'))) && (
              <button type="button" onClick={() => setView(BULK_VIEWS.includes(view) ? 'bulkassign' : 'setup')} aria-label={BULK_VIEWS.includes(view) ? 'Back to Bulk assign' : 'Back to Setup'} title={BULK_VIEWS.includes(view) ? 'Back to Bulk assign' : 'Back to Setup'}
                style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 6-6 6 6 6" /></svg>
              </button>
            )}
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.2, margin: '4px 0' }}>{title}</h1>
          </div>
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
