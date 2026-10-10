// People › Accesses — who can use the dashboard and which tabs each person
// sees. Only a dashboard admin opens this page. An admin sees every tab;
// everyone else sees the tabs ticked for them, and the server refuses the
// APIs behind the rest. Roles are starting points for the tick list.
// The Support desk is not a tab: it is a role per person (head or staff) set
// here, never implied by Admin or by every tab.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { useAuth } from '../auth/AuthContext';
import { refreshMe } from '../../services/auth';
import { ApiError } from '../../services/http';
import { getAllEmployees, listDashboardAccesses, setDashboardAccess } from '../../services/hrms';
import type { DashboardAccessDTO, EmployeeDTO } from '../../services/hrms';
import type { SupportRole } from '../../services/support';
import { Avatar, Card } from '../ui';
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
      <div style={tabBar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ ...tabBtn, color: active ? '#0571A6' : '#717171', borderBottomColor: active ? '#0571A6' : 'transparent', fontWeight: active ? 800 : 600 }}>
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
  head: { bg: '#E7F4FB', fg: '#0571A6', label: 'Support head' },
  staff: { bg: '#EEF0E6', fg: '#5E6B3E', label: 'Support staff' },
};

function SupportRolePill({ role }: { role?: SupportRole | null }) {
  if (!role) return <span style={{ fontSize: 14, color: '#9197A2' }}>—</span>;
  const t = SUPPORT_TONE[role];
  return <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>{t.label}</span>;
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

  const load = () => listDashboardAccesses().then((r) => setRows(r.users)).catch((e) => flash(e instanceof ApiError ? e.message : 'Could not load accesses', 'error'));
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
        <div style={{ background: '#FBF4E8', border: '1px solid #F0DFC0', color: '#8A5F1F', borderRadius: 12, padding: '11px 15px', fontSize: 14, fontWeight: 600, marginBottom: 14, lineHeight: 1.45 }}>
          There’s support staff but no Support head. New support tickets will wait unassigned until someone is made Support head.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: '#717171' }}>{rows ? `${rows.length} ${rows.length === 1 ? 'person has' : 'people have'} access to this dashboard` : 'Loading…'}</div>
        <button style={{ ...primaryBtn, marginLeft: 'auto' }} onClick={() => setPicking(true)}><IconPlus size={15} /> Give access</button>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: USER_COLS, gap: 12, padding: '13px 20px', borderBottom: '1px solid #F0F0F2', fontSize: 12, fontWeight: 700, letterSpacing: '.03em', color: '#717171', textTransform: 'uppercase' }}>
          <div>User details</div>
          <div>Tabs</div>
          <div>Support desk</div>
          <div>Status</div>
          <div />
        </div>
        {(rows ?? []).map((u) => (
          <div key={u.userId} onClick={() => open(u)} style={{ display: 'grid', gridTemplateColumns: USER_COLS, gap: 12, padding: '13px 20px', borderBottom: '1px solid #F0F0F2', alignItems: 'center', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <Avatar name={u.name} size={38} font={14} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0571A6' }}>{u.name}{u.userId === me?.id && <span style={{ color: '#9197A2', fontWeight: 600 }}> · you</span>}</div>
                <div style={{ fontSize: 14, color: '#717171' }}>{u.email}</div>
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: u.admin ? '#0571A6' : '#484848' }}>{accessSummary(u)}</div>
            <div><SupportRolePill role={u.supportRole} /></div>
            <div><span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.04em', color: u.active ? '#4F7A52' : '#9197A2' }}>{u.active ? 'ACTIVE' : 'INACTIVE'}</span></div>
            <span style={{ ...rowMenuBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>›</span>
          </div>
        ))}
      </Card>

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
      <div onClick={() => setEditing(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.35)' }} />
      <div className="scry" style={{ position: 'relative', width: 'min(560px, 100%)', height: '100%', background: '#fff', overflowY: 'auto', padding: '22px 24px 28px', boxShadow: '-12px 0 40px rgba(34,34,34,.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar name={editing.person.name} size={42} font={15} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 19, fontWeight: 800 }}>{editing.person.name}</div>
            <div style={{ fontSize: 14, color: '#717171' }}>{editing.person.email}</div>
          </div>
          <button onClick={() => setEditing(null)} style={{ ...ghostBtn, padding: '7px 12px' }}>Close</button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#717171', margin: '22px 0 8px' }}>START FROM A ROLE</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ROLES.map((r) => <button key={r.name} type="button" onClick={() => applyRole(r)} style={chip}>{r.name}</button>)}
        </div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '20px 0 6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={editing.admin} onChange={(e) => setEditing({ ...editing, admin: e.target.checked })} style={{ marginTop: 3 }} />
          <span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Admin</span>
            <span style={{ display: 'block', fontSize: 13, color: '#717171' }}>Everything, and can change who sees what on this page.</span>
          </span>
        </label>

        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#717171', margin: '18px 0 4px' }}>SUPPORT DESK</div>
        <div style={{ fontSize: 13, color: '#717171', marginBottom: 8 }}>A role of its own: Admin and every tab don’t include it.</div>
        <div role="radiogroup" aria-label="Support desk role" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {SUPPORT_CHOICES.map((c) => {
            const on = editing.supportRole === c.value;
            return (
              <button key={c.label} type="button" role="radio" aria-checked={on} onClick={() => setEditing({ ...editing, supportRole: c.value })}
                style={{ border: `1.5px solid ${on ? '#0571A6' : '#EBEBEB'}`, background: on ? '#F3F8FB' : '#fff', color: on ? '#0571A6' : '#484848', borderRadius: 11, padding: '9px 8px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                {c.label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 13, color: '#717171', marginTop: 7, lineHeight: 1.45 }}>{SUPPORT_CHOICES.find((c) => c.value === editing.supportRole)?.hint}</div>

        {!editing.admin && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#717171', margin: '18px 0 4px' }}>WHAT THEY CAN OPEN · {UNITS.filter((u) => hasUnit(editing.tabs, u)).length} of {UNITS.length}</div>
            {UNITS.map((u) => (
              <label key={u.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderTop: '1px solid #F0F0F2', cursor: 'pointer' }}>
                <input type="checkbox" checked={hasUnit(editing.tabs, u)} onChange={() => toggle(u)} style={{ marginTop: 3 }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: '#222222' }}>{u.title}</span>
                  <span style={{ display: 'block', fontSize: 13, color: '#717171' }}>{u.hint}</span>
                </span>
              </label>
            ))}
          </>
        )}

        {self && !editing.admin && <div style={{ fontSize: 13, color: '#A8475F', marginTop: 12 }}>This is your own access. Without Admin you won't be able to come back to this page.</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 22, alignItems: 'center' }}>
          {!editing.isNew && (
            confirmRemove
              ? <button type="button" disabled={saving} onClick={() => onSave(false)} style={{ ...ghostBtn, color: '#A8475F', borderColor: '#A8475F' }}>Click again to remove</button>
              : <button type="button" onClick={() => setConfirmRemove(true)} style={{ ...ghostBtn, color: '#A8475F', borderColor: '#EBD9DE' }}>Remove access</button>
          )}
          <button type="button" disabled={saving} onClick={() => onSave(true)} style={{ ...primaryBtn, marginLeft: 'auto' }}>{saving ? 'Saving…' : editing.isNew ? 'Give access' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function PickPerson({ exclude, onClose, onPick }: { exclude: Set<string>; onClose: () => void; onPick: (p: EmployeeDTO) => void }) {
  const [people, setPeople] = useState<EmployeeDTO[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { getAllEmployees().then(setPeople).catch(() => setPeople([])); }, []);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (people ?? [])
      .filter((p) => !exclude.has(p.userId))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.email ?? '').toLowerCase().includes(needle) || (p.employeeId ?? '').toLowerCase().includes(needle))
      .slice(0, 40);
  }, [people, q, exclude]);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.35)' }} />
      <div style={{ position: 'relative', width: 'min(520px, 92vw)', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(34,34,34,.25)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #F0F0F2' }}>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>Give dashboard access</div>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or employee ID" style={{ width: '100%', padding: '10px 12px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 15, fontFamily: 'inherit' }} />
        </div>
        <div className="scry" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {people === null && <div style={{ padding: 18, color: '#717171' }}>Loading…</div>}
          {people !== null && shown.length === 0 && <div style={{ padding: 18, color: '#717171' }}>Nobody matches.</div>}
          {shown.map((p) => (
            <button key={p.userId} type="button" onClick={() => onPick(p)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 18px', border: 'none', borderBottom: '1px solid #F7F7F9', background: '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <Avatar name={p.name} size={32} font={12} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: '#222222' }}>{p.name}</span>
                <span style={{ display: 'block', fontSize: 13, color: '#717171' }}>{[p.employeeId, p.designation, p.email].filter(Boolean).join(' · ')}</span>
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
      <div style={{ fontSize: 14, color: '#717171', marginBottom: 16 }}>Starting points for a person's tabs. Pick one in the access editor, then add or remove tabs for that person.</div>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: ROLE_COLS, gap: 12, padding: '13px 20px', borderBottom: '1px solid #F0F0F2', fontSize: 12, fontWeight: 700, letterSpacing: '.03em', color: '#717171', textTransform: 'uppercase' }}>
          <div>Role name</div>
          <div>Tabs</div>
        </div>
        {ROLES.map((r) => (
          <div key={r.name} style={{ display: 'grid', gridTemplateColumns: ROLE_COLS, gap: 12, padding: '15px 20px', borderBottom: '1px solid #F0F0F2', alignItems: 'start' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0571A6' }}>{r.name}</div>
            <div>
              <div style={{ fontSize: 14, color: '#484848', lineHeight: 1.5 }}>{r.desc}</div>
              {!r.admin && <div style={{ fontSize: 13, color: '#9197A2', marginTop: 4 }}>{UNITS.filter((u) => hasUnit(r.tabs, u)).map((u) => u.title).join(' · ')}</div>}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

const tabBar: CSSProperties = { display: 'flex', gap: 4, borderBottom: '1px solid #EBEBEB', marginBottom: 20 };
const tabBtn: CSSProperties = { background: 'none', border: 'none', borderBottom: '2.5px solid transparent', padding: '0 4px 11px', marginRight: 22, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 15px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const chip: CSSProperties = { background: '#F3F8FB', color: '#0571A6', border: '1px solid #D7E9F3', borderRadius: 999, padding: '6px 12px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const rowMenuBtn: CSSProperties = { width: 32, height: 32, borderRadius: 9, color: '#9197A2', fontSize: 18, fontWeight: 700 };
