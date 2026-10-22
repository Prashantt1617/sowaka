// People › Accesses — who can use the dashboard and which tabs each person
// sees. Only a dashboard admin opens this page. An admin sees every tab;
// everyone else sees the tabs ticked for them, and the server refuses the
// APIs behind the rest. Roles are starting points for the tick list.
// The Support desk is not a tab: it is a role per person (head or staff) set
// here, never implied by Admin or by every tab.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import './people.css';
import { useAuth } from '../auth/AuthContext';
import { refreshMe } from '../../services/auth';
import { ApiError } from '../../services/http';
import { getAllEmployees, listDashboardAccesses, setDashboardAccess } from '../../services/hrms';
import type { DashboardAccessDTO, EmployeeDTO } from '../../services/hrms';
import type { SupportRole } from '../../services/support';
import { ListPending, Spinner } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { IconPlus } from '../icons';
import { OVERVIEW_ITEM, SECTIONS } from '../Chrome';
import { SALARY_DETAILS } from '../access';
import type { AccessKey } from '../access';

type SubTab = 'users' | 'roles';
const TABS: { key: SubTab; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'roles', label: 'Roles' },
];

// What can be given: a whole sidebar section at a time, not its sub-tabs.
// Overview, organisation settings and an employee's salary details are each
// their own. Accesses itself is not in the list: it comes with being an admin.
type Unit = { key: string; title: string; tabs: AccessKey[]; hint: string };
const titleCase = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();
// A section left with no tabs (Support: its desk is a role) is not a unit,
// or it would read as given to everyone.
const SECTION_UNITS: Unit[] = SECTIONS.flatMap((s) => {
  const items = s.items.filter((i) => i.key !== 'usersroles' && i.key !== 'support');
  if (items.length === 0) return [];
  return [{ key: s.title, title: titleCase(s.title), tabs: items.map((i) => i.key), hint: items.map((i) => i.label).join(' · ') }];
});
const UNITS: Unit[] = [
  { key: 'overview', title: OVERVIEW_ITEM.label, tabs: ['overview'], hint: 'Pending requests at a glance' },
  { key: 'organisation', title: 'Organisation settings', tabs: ['organisation'], hint: 'Company details, branding and app tabs' },
  ...SECTION_UNITS.flatMap((u) => u.key === 'PEOPLE'
    ? [u, { key: SALARY_DETAILS, title: 'Salary details', tabs: [SALARY_DETAILS] as AccessKey[], hint: "Salary details tab and payslips on an employee's profile" }]
    : [u]),
];
const ALL_TABS: AccessKey[] = UNITS.flatMap((u) => u.tabs);
const unitByTitle = (title: string) => UNITS.find((u) => u.title === title)!;
const tabsOf = (...titles: string[]): AccessKey[] => titles.flatMap((t) => unitByTitle(t).tabs);
const hasUnit = (tabs: Set<AccessKey> | AccessKey[], u: Unit) => u.tabs.every((t) => (Array.isArray(tabs) ? tabs.includes(t) : tabs.has(t)));

// —— Roles: presets for the tick list ————————————————————————————————————
type Role = { name: string; admin?: boolean; tabs: AccessKey[]; desc: string };
const ROLES: Role[] = [
  { name: 'Admin', admin: true, tabs: ALL_TABS, desc: 'Everything, and People › Accesses: decides who sees what.' },
  { name: 'Operations Manager', tabs: ALL_TABS.filter((t) => t !== 'organisation'), desc: 'Everything except organisation settings and accesses.' },
  { name: 'Time Reviewer', tabs: tabsOf('Overview', 'Requests', 'Reports'), desc: 'Leave, overtime, attendance corrections, OOL check-ins and the attendance report. No pay.' },
  { name: 'Money Reviewer', tabs: tabsOf('Overview', 'Payroll', 'Claims', 'Salary details'), desc: 'Payroll, claims and what each employee earns. No leave or attendance.' },
];

export function Accesses() {
  const [tab, setTab] = useState<SubTab>('users');
  return (
    <div>
      <div className="pd-seg" style={{ marginBottom: 20 }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} className={active ? 'on' : undefined}>
              {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </div>
  );
}

// —— Support desk role ——————————————————————————————————————————————————
const SUPPORT_CHOICES: { value: SupportRole | null; label: string; hint: string }[] = [
  { value: null, label: 'None', hint: 'No Support desk.' },
  { value: 'staff', label: 'Support staff', hint: 'Sees only the tickets the Support head assigns to them. Replies, resolves, sends back.' },
  { value: 'head', label: 'Support head', hint: 'Sees every ticket, assigns or keeps them, replies and resolves.' },
];
const SUPPORT_TONE: Record<SupportRole, { bg: string; fg: string; label: string }> = {
  head: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)', label: 'Support head' },
  staff: { bg: 'var(--t-olive)', fg: 'var(--t-olive-i)', label: 'Support staff' },
};

function SupportRolePill({ role }: { role?: SupportRole | null }) {
  if (!role) return <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>—</span>;
  const t = SUPPORT_TONE[role];
  return <span style={{ display: 'inline-flex', fontSize: 11.5, fontWeight: 400, lineHeight: 1.5, padding: '3px 9px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line-2)', color: t.fg, whiteSpace: 'nowrap' }}>{t.label}</span>;
}

// —— Users ————————————————————————————————————————————————————————————
const USER_COLS = '2.2fr 2.2fr 1.1fr 0.8fr 44px';

function accessSummary(u: DashboardAccessDTO): string {
  if (u.admin) return 'Admin · everything';
  if (u.tabs === null) return 'Everything';
  const names = UNITS.filter((unit) => hasUnit(u.tabs as AccessKey[], unit)).map((unit) => unit.title);
  // Support desk is a role, not a tab: someone given only that has no tabs.
  if (names.length === 0 && u.supportRole) return 'Support desk only';
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}

type Editing = { person: { userId: string; name: string; email: string }; admin: boolean; tabs: Set<AccessKey>; supportRole: SupportRole | null; isNew: boolean };

function UsersTab() {
  const { flash } = useStore();
  const { user: me, setUser } = useAuth();
  const [rows, setRows] = useState<DashboardAccessDTO[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  // The first load failed: the list says so, with Retry, rather than loading forever.
  const [failed, setFailed] = useState(false);

  const load = () => listDashboardAccesses().then((r) => { setRows(r.users); setFailed(false); }).catch((e) => { setFailed(true); flash(e instanceof ApiError ? e.message : 'Could not load accesses', 'error'); });
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (u: DashboardAccessDTO) =>
    setEditing({ person: u, admin: u.admin, tabs: new Set<AccessKey>(u.tabs === null ? ALL_TABS : (u.tabs as AccessKey[])), supportRole: u.supportRole ?? null, isNew: false });

  const save = async (access: boolean) => {
    if (!editing) return;
    // Only whole sections are given: a half-ticked one left from before is dropped.
    const given = UNITS.filter((u) => hasUnit(editing.tabs, u)).flatMap((u) => u.tabs);
    // A Support role alone is enough: someone can work tickets and open nothing else.
    if (access && !editing.admin && given.length === 0 && !editing.supportRole) { flash('Tick at least one, or give a Support role, or remove their access'); return; }
    setSaving(true);
    try {
      const everything = ALL_TABS.every((t) => given.includes(t));
      await setDashboardAccess(editing.person.userId, access
        ? { access: true, admin: editing.admin, tabs: editing.admin || everything ? null : given, supportRole: editing.supportRole }
        : { access: false });
      flash(access ? `${editing.person.name}'s access saved` : `${editing.person.name} no longer has dashboard access`);
      setEditing(null);
      await load();
      // Changing your own access shows at once.
      if (editing.person.userId === me?.id) setUser(await refreshMe());
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Staff can't assign: without a head, new tickets wait with nobody to hand them out.
  const noHead = rows !== null && rows.some((r) => r.supportRole === 'staff') && !rows.some((r) => r.supportRole === 'head');

  return (
    <div>
      {noHead && (
        <div className="pd-note" style={{ marginBottom: 20, background: 'var(--warn-bg)', borderColor: 'transparent', color: 'var(--warn)' }}>
          There’s support staff but no Support head. New support tickets will wait unassigned until someone is made Support head.
        </div>
      )}
      <div className="pd-head" style={{ alignItems: 'center' }}>
        <p className="pd-lead">{rows ? `${rows.length} ${rows.length === 1 ? 'person has' : 'people have'} access to this dashboard` : failed ? '' : <Spinner />}</p>
        <button className="pd-btn primary" onClick={() => setPicking(true)}><IconPlus size={15} /> Give access</button>
      </div>

      <section className="pd-card">
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>Users</h3>
        <div style={{ display: 'grid', background: 'var(--surface-2)', borderRadius: 12, gridTemplateColumns: USER_COLS, gap: 12, padding: '10px 12px', fontSize: 12, lineHeight: 1.5, fontWeight: 400, letterSpacing: 0, color: 'var(--ink-3)', textTransform: 'none' }}>
          <div>User details</div>
          <div>Tabs</div>
          <div>Support desk</div>
          <div>Status</div>
          <div />
        </div>
        {!rows && <ListPending state={failed ? 'error' : 'loading'} onRetry={() => { setFailed(false); void load(); }} cols={4} />}
        {(rows ?? []).map((u, i, all) => (
          <div key={u.userId} onClick={() => open(u)} className="pd-row-hover" style={{ display: 'grid', gridTemplateColumns: USER_COLS, gap: 12, padding: '10px 12px', borderBottom: i === all.length - 1 ? 'none' : '1px solid var(--line)', alignItems: 'center', cursor: 'pointer' }}>
            <div className="pd-who" style={{ minWidth: 0 }}>
              <PersonAvatar name={u.name} userId={u.userId} size={38} font={14} />
              <div className="txt">
                <b>{u.name}{u.userId === me?.id && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · you</span>}</b>
                <span className="sub">{u.email}</span>
              </div>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 400, color: 'var(--ink)' }}>{accessSummary(u)}</div>
            <div><SupportRolePill role={u.supportRole} /></div>
            <div><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, padding: '3px 10px', borderRadius: 99, background: u.active ? 'var(--p-green)' : 'var(--mute-bg)', color: u.active ? '#fff' : 'var(--ink-2)' }}><span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.85 }} />{u.active ? 'ACTIVE' : 'INACTIVE'}</span></div>
            <span className="pd-icon-btn" aria-hidden>›</span>
          </div>
        ))}
      </section>

      {picking && (
        <PickPerson
          exclude={new Set((rows ?? []).map((r) => r.userId))}
          onClose={() => setPicking(false)}
          onPick={(p) => { setPicking(false); setEditing({ person: { userId: p.userId, name: p.name, email: p.email ?? '' }, admin: false, tabs: new Set<AccessKey>(), supportRole: null, isNew: true }); }}
        />
      )}
      {editing && <EditAccess editing={editing} setEditing={setEditing} saving={saving} onSave={save} self={editing.person.userId === me?.id} />}
    </div>
  );
}

function EditAccess({ editing, setEditing, saving, onSave, self }: { editing: Editing; setEditing: (e: Editing | null) => void; saving: boolean; onSave: (access: boolean) => void; self: boolean }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const toggle = (u: Unit) => {
    const tabs = new Set(editing.tabs);
    const on = !hasUnit(tabs, u);
    for (const k of u.tabs) { if (on) tabs.add(k); else tabs.delete(k); }
    setEditing({ ...editing, tabs });
  };
  const applyRole = (r: Role) => setEditing({ ...editing, admin: r.admin === true, tabs: new Set(r.tabs) });
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={() => setEditing(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(20, 16, 50, 0.38)' }} />
      <div className="scry" style={{ position: 'relative', width: 'min(560px, 100%)', height: '100%', background: 'var(--surface)', display: 'flex', flexDirection: 'column', borderRadius: '24px 0 0 24px', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <PersonAvatar name={editing.person.name} userId={editing.person.userId} size={42} font={15} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{editing.person.name}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{editing.person.email}</div>
          </div>
          <button onClick={() => setEditing(null)} className="pd-btn sm">Close</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        <div className="pd-eyebrow" style={{ margin: '0 0 8px' }}>START FROM A ROLE</div>
        <div className="pd-chips">
          {ROLES.map((r) => <button key={r.name} type="button" onClick={() => applyRole(r)} className="pd-chip sm">{r.name}</button>)}
        </div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '20px 0 6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={editing.admin} onChange={(e) => setEditing({ ...editing, admin: e.target.checked })} style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--accent)' }} />
          <span>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Admin</span>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)' }}>Everything, and can change who sees what on this page.</span>
          </span>
        </label>

        <div className="pd-eyebrow" style={{ margin: '20px 0 4px' }}>SUPPORT DESK</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 8 }}>A role of its own: Admin and every tab don’t include it.</div>
        <div role="radiogroup" aria-label="Support desk role" className="pd-seg" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {SUPPORT_CHOICES.map((c) => {
            const on = editing.supportRole === c.value;
            return (
              <button key={c.label} type="button" role="radio" aria-checked={on} onClick={() => setEditing({ ...editing, supportRole: c.value })} className={on ? 'on' : undefined} style={{ justifyContent: 'center' }}>
                {c.label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.45 }}>{SUPPORT_CHOICES.find((c) => c.value === editing.supportRole)?.hint}</div>

        {!editing.admin && (
          <>
            <div className="pd-eyebrow" style={{ margin: '20px 0 4px' }}>WHAT THEY CAN OPEN · {UNITS.filter((u) => hasUnit(editing.tabs, u)).length} of {UNITS.length}</div>
            {UNITS.map((u, i) => (
              <label key={u.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--line)', cursor: 'pointer' }}>
                <input type="checkbox" checked={hasUnit(editing.tabs, u)} onChange={() => toggle(u)} style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--accent)' }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{u.title}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)' }}>{u.hint}</span>
                </span>
              </label>
            ))}
          </>
        )}

        {self && !editing.admin && <div style={{ fontSize: 12.5, color: 'var(--bad)', marginTop: 12 }}>This is your own access. Without Admin you won't be able to come back to this page.</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '16px 20px', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
          {!editing.isNew && (
            confirmRemove
              ? <button type="button" disabled={saving} onClick={() => onSave(false)} className="pd-btn" style={{ color: 'var(--bad)', borderColor: 'var(--bad)' }}>Click again to remove</button>
              : <button type="button" onClick={() => setConfirmRemove(true)} className="pd-btn" style={{ color: 'var(--bad)' }}>Remove access</button>
          )}
          <button type="button" disabled={saving} onClick={() => onSave(true)} className="pd-btn primary" style={{ marginLeft: 'auto' }}>{saving ? 'Saving…' : editing.isNew ? 'Give access' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function PickPerson({ exclude, onClose, onPick }: { exclude: Set<string>; onClose: () => void; onPick: (p: EmployeeDTO) => void }) {
  const [people, setPeople] = useState<EmployeeDTO[] | null>(null);
  const [q, setQ] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { getAllEmployees().then(setPeople).catch(() => setFailed(true)); }, [attempt]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (people ?? [])
      .filter((p) => !exclude.has(p.userId))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.email ?? '').toLowerCase().includes(needle) || (p.employeeId ?? '').toLowerCase().includes(needle))
      .slice(0, 40);
  }, [people, q, exclude]);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(20, 16, 50, 0.38)' }} />
      <div style={{ position: 'relative', width: 'min(520px, 92vw)', background: 'var(--surface)', borderRadius: 22, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Give dashboard access</div>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or employee ID" className="pd-inp" style={{ width: '100%', height: 40, borderRadius: 999 }} />
        </div>
        <div className="scry" style={{ maxHeight: '50vh', overflowY: 'auto', padding: '6px 8px' }}>
          {people === null && <ListPending state={failed ? 'error' : 'loading'} errorText="People could not be loaded." onRetry={() => { setFailed(false); setAttempt((n) => n + 1); }} rows={5} cols={1} rowHeight={53} />}
          {people !== null && shown.length === 0 && <div style={{ padding: 18, color: 'var(--ink-3)', fontSize: 13 }}>Nobody matches.</div>}
          {shown.map((p) => (
            <button key={p.userId} type="button" onClick={() => onPick(p)} className="pd-row-hover" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '8px 12px', border: 'none', borderRadius: 12, background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <PersonAvatar name={p.name} userId={p.userId} size={32} font={12} />
              <span className="pd-who" style={{ display: 'block', minWidth: 0 }}>
                <b>{p.name}</b>
                <span className="sub">{[p.employeeId, p.designation, p.email].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// —— Roles ————————————————————————————————————————————————————————————
const ROLE_COLS = '1.1fr 2.6fr';

function RolesTab() {
  return (
    <div>
      <p className="pd-lead" style={{ margin: '0 0 20px', padding: '0 4px' }}>Starting points for a person's tabs. Pick one in the access editor, then add or remove tabs for that person.</p>
      <section className="pd-card">
        <div style={{ display: 'grid', background: 'var(--surface-2)', borderRadius: 12, gridTemplateColumns: ROLE_COLS, gap: 12, padding: '10px 12px', fontSize: 12, lineHeight: 1.5, fontWeight: 400, letterSpacing: 0, color: 'var(--ink-3)', textTransform: 'none' }}>
          <div>Role name</div>
          <div>Tabs</div>
        </div>
        {ROLES.map((r, i) => (
          <div key={r.name} style={{ display: 'grid', gridTemplateColumns: ROLE_COLS, gap: 12, padding: '12px', borderBottom: i === ROLES.length - 1 ? 'none' : '1px solid var(--line)', alignItems: 'start' }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{r.name}</div>
            <div>
              <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5 }}>{r.desc}</div>
              {!r.admin && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>{UNITS.filter((u) => hasUnit(r.tabs, u)).map((u) => u.title).join(' · ')}</div>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
