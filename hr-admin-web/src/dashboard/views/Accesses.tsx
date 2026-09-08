// People › Accesses — who can use the dashboard (Users) and what each role can do
// (Roles). Two horizontal subtabs, matching the Zoho Users / Roles screens but in
// the app palette.
// NOTE: frontend-capture phase — renders from local mock data, no API calls.
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { Avatar, Card } from '../ui';
import { IconPlus } from '../icons';

type SubTab = 'users' | 'roles';
const TABS: { key: SubTab; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'roles', label: 'Roles' },
];

export function Accesses() {
  const [tab, setTab] = useState<SubTab>('users');
  return (
    <div>
      <div style={tabBar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ ...tabBtn, color: active ? '#0571A6' : '#717171', borderBottomColor: active ? '#0571A6' : 'transparent', fontWeight: active ? 800 : 600 }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </div>
  );
}

// —— Users ————————————————————————————————————————————————————————————
type UserRow = { name: string; email: string; role: string; status: 'Active' | 'Inactive' };
const USERS: UserRow[] = [
  { name: 'Anshul', email: 'anshul@convrse.ai', role: 'Operations Manager', status: 'Active' },
  { name: 'Convrse AI', email: 'hi@convrse.ai', role: 'Admin', status: 'Inactive' },
  { name: 'Diksha', email: 'diksha@convrse.ai', role: 'Admin', status: 'Active' },
  { name: 'Tanvi', email: 'tanvi@sowaka.co.in', role: 'Admin', status: 'Active' },
  { name: 'Rahul Sharma', email: 'rahul@convrse.ai', role: 'Time Reviewer', status: 'Active' },
  { name: 'Anjali Gupta', email: 'anjali@convrse.ai', role: 'Money Reviewer', status: 'Active' },
];
const USER_COLS = '2.4fr 1.4fr 1fr 44px';

function UsersTab() {
  const { flash } = useStore();
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: '#717171' }}>{USERS.length} users have access to this dashboard</div>
        <button style={{ ...primaryBtn, marginLeft: 'auto' }} onClick={() => flash('Invite user — coming soon')}><IconPlus size={15} /> Invite user</button>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: USER_COLS, gap: 12, padding: '13px 20px', borderBottom: '1px solid #F0F0F2', fontSize: 12, fontWeight: 700, letterSpacing: '.03em', color: '#717171', textTransform: 'uppercase' }}>
          <div>User details</div>
          <div>Role</div>
          <div>Status</div>
          <div />
        </div>
        {USERS.map((u) => (
          <div key={u.email} style={{ display: 'grid', gridTemplateColumns: USER_COLS, gap: 12, padding: '13px 20px', borderBottom: '1px solid #F0F0F2', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <Avatar name={u.name} size={38} font={14} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0571A6' }}>{u.name}</div>
                <div style={{ fontSize: 14, color: '#717171' }}>{u.email}</div>
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#484848' }}>{u.role}</div>
            <div>
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.04em', color: u.status === 'Active' ? '#4F7A52' : '#9197A2' }}>
                {u.status.toUpperCase()}
              </span>
            </div>
            <button title="More" style={rowMenuBtn} onClick={() => flash(`Manage ${u.name}`)}>⋯</button>
          </div>
        ))}
      </Card>
    </div>
  );
}

// —— Roles ————————————————————————————————————————————————————————————
type RoleRow = { name: string; system?: boolean; desc: string };
const ROLES: RoleRow[] = [
  {
    name: 'Admin',
    system: true,
    desc: 'Unrestricted access to every module and to organisation settings — can run payroll, edit statutory setup, and manage users, roles and accesses.',
  },
  {
    name: 'Operations Manager',
    system: true,
    desc: 'Access to all people and payroll modules except organisation settings and access management. Can add employees, run pay runs, and approve requests, but cannot change org identity or manage other users.',
  },
  {
    name: 'Time Reviewer',
    desc: 'Reviews and approves time-related requests only — leave, overtime and attendance. Cannot view salary, payroll or reimbursement data.',
  },
  {
    name: 'Money Reviewer',
    desc: 'Reviews and approves money-related items only — reimbursements and proof-of-investment declarations, plus payroll inputs. Cannot approve leave or time-off.',
  },
];
const ROLE_COLS = '1.2fr 2.4fr';

function RolesTab() {
  const { flash } = useStore();
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: '#717171' }}>{ROLES.length} roles define what users can see and do</div>
        <button style={{ ...primaryBtn, marginLeft: 'auto' }} onClick={() => flash('New role — coming soon')}><IconPlus size={15} /> New role</button>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: ROLE_COLS, gap: 12, padding: '13px 20px', borderBottom: '1px solid #F0F0F2', fontSize: 12, fontWeight: 700, letterSpacing: '.03em', color: '#717171', textTransform: 'uppercase' }}>
          <div>Role name</div>
          <div>Description</div>
        </div>
        {ROLES.map((r) => (
          <div key={r.name} style={{ display: 'grid', gridTemplateColumns: ROLE_COLS, gap: 12, padding: '15px 20px', borderBottom: '1px solid #F0F0F2', alignItems: 'start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#0571A6' }}>{r.name}</span>
              {r.system && <IconLock />}
            </div>
            <div style={{ fontSize: 14, color: '#484848', lineHeight: 1.5 }}>{r.desc}</div>
          </div>
        ))}
      </Card>
      <div style={{ fontSize: 12, color: '#717171', marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconLock /> System roles can&rsquo;t be deleted, but you can create your own roles with custom permissions.
      </div>
    </div>
  );
}

function IconLock() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9197A2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}

// —— styles ————————————————————————————————————————————————————————————
const tabBar: CSSProperties = { display: 'flex', gap: 4, borderBottom: '1px solid #EBEBEB', marginBottom: 22 };
const tabBtn: CSSProperties = { background: 'none', border: 'none', borderBottom: '2.5px solid transparent', padding: '0 4px 11px', marginRight: 20, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const rowMenuBtn: CSSProperties = { width: 32, height: 32, borderRadius: 8, border: '1px solid #EBEBEB', background: '#fff', color: '#717171', fontSize: 20, cursor: 'pointer', lineHeight: 1 };
