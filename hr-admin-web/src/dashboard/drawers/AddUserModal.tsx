import type { ReactNode } from 'react';
import { useStore } from '../store';
import { CloseButton } from './shell';

const fieldLabel = { fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 } as const;
const inputStyle = {
  width: '100%',
  border: '1px solid var(--line)',
  borderRadius: 12,
  padding: '11px 13px',
  fontSize: 14,
  outline: 'none',
  background: 'var(--surface)',
  color: 'var(--ink)',
} as const;
const selectStyle = {
  ...inputStyle,
  appearance: 'none' as const,
  WebkitAppearance: 'none' as const,
  fontWeight: 400,
  cursor: 'pointer',
};

function Field({ label, span, children }: { label: string; span?: boolean; children: ReactNode }) {
  return (
    <div style={span ? { gridColumn: '1 / -1' } : undefined}>
      <div style={fieldLabel}>{label}</div>
      {children}
    </div>
  );
}

export function AddUserModal() {
  const s = useStore();
  if (!s.addOpen) return null;
  const f = s.form;
  const close = () => s.setAddOpen(false);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={{ position: 'relative', width: 560, maxHeight: '92vh', overflowY: 'auto', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)', animation: 'pop .2s ease both' }}>
        <div style={{ padding: '22px 26px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.3px' }}>Add a user</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400, marginTop: 2 }}>Create a new employee profile</div>
          </div>
          <CloseButton onClose={close} />
        </div>

        <div style={{ padding: '22px 26px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Full name" span>
            <input value={f.name} onChange={(e) => s.setFormField('name', e.target.value)} placeholder="e.g. Priya Menon" style={inputStyle} />
          </Field>
          <Field label="Work email" span>
            <input type="email" value={f.email} onChange={(e) => s.setFormField('email', e.target.value)} placeholder="e.g. priya@company.com" style={inputStyle} />
          </Field>
          <Field label="Role">
            <input value={f.role} onChange={(e) => s.setFormField('role', e.target.value)} placeholder="e.g. Product Manager" style={inputStyle} />
          </Field>
          <Field label="Team">
            <select value={f.team} onChange={(e) => s.setFormField('team', e.target.value)} style={selectStyle}>
              <option>Design</option><option>Engineering</option><option>Sales</option><option>Marketing</option><option>Operations</option><option>Finance</option>
            </select>
          </Field>
          <Field label="Location">
            <select value={f.location} onChange={(e) => s.setFormField('location', e.target.value)} style={selectStyle}>
              <option>Bengaluru</option><option>Mumbai</option><option>Delhi</option><option>Remote</option>
            </select>
          </Field>
          <Field label="Employment type">
            <select value={f.empType} onChange={(e) => s.setFormField('empType', e.target.value)} style={selectStyle}>
              <option>Full-time</option><option>Contract</option><option>Intern</option>
            </select>
          </Field>
          <Field label="Reporting manager">
            <select value={f.manager} onChange={(e) => s.setFormField('manager', e.target.value)} style={selectStyle}>
              <option>Aanya Verma</option><option>Imran Qureshi</option>
            </select>
          </Field>
          <Field label="Date of birth">
            <input type="date" value={f.dob} onChange={(e) => s.setFormField('dob', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Joining date">
            <input type="date" value={f.joining} onChange={(e) => s.setFormField('joining', e.target.value)} style={inputStyle} />
          </Field>
        </div>

        <div style={{ padding: '0 26px 22px', display: 'flex', gap: 11, justifyContent: 'flex-end' }}>
          <button onClick={close} style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', borderRadius: 999, padding: '11px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
          <button onClick={s.saveUser} style={{ border: 'none', background: 'var(--accent-grad)', color: '#fff', borderRadius: 999, padding: '11px 22px', fontSize: 14, fontWeight: 500, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,136,255,.26)' }}>Add user</button>
        </div>
      </div>
    </div>
  );
}
