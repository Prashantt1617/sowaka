// People › Designations — a table of the org's job titles.
// NOTE: frontend-capture phase — renders from local mock data, no API calls.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { IconPlus, IconClose, IconDownload, IconEdit, IconTrash, rowActionBtn } from './peopleTable';

type Designation = {
  name: string;
  employees: number;
  contractors: number;
};

// —— Mock data for capture ————————————————————————————————————————————
const DESIGNATIONS: Designation[] = [
  { name: 'Software Engineer', employees: 14, contractors: 2 },
  { name: 'Senior Software Engineer', employees: 9, contractors: 1 },
  { name: 'Engineering Manager', employees: 4, contractors: 0 },
  { name: 'Product Designer', employees: 5, contractors: 1 },
  { name: 'Product Manager', employees: 4, contractors: 0 },
  { name: 'Account Executive', employees: 8, contractors: 3 },
  { name: 'Sales Development Rep', employees: 4, contractors: 2 },
  { name: 'Customer Success Manager', employees: 6, contractors: 1 },
  { name: 'People Operations', employees: 3, contractors: 1 },
  { name: 'Finance Analyst', employees: 4, contractors: 0 },
];

export function Designations() {
  const { flash } = useStore();
  const [editing, setEditing] = useState<{ name: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const totalEmp = DESIGNATIONS.reduce((s, d) => s + d.employees, 0);
  const totalCon = DESIGNATIONS.reduce((s, d) => s + d.contractors, 0);

  return (
    <div>
      {adding && <DesignationModal onClose={() => setAdding(false)} />}
      {editing && <DesignationModal initialName={editing.name} onClose={() => setEditing(null)} />}

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: '#717171' }}>{DESIGNATIONS.length} designations</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
          <button style={ghostBtn}><IconDownload /> Download</button>
          <button style={primaryBtn} onClick={() => setAdding(true)}><IconPlus size={15} /> Add designation</button>
        </div>
      </div>

      <Card>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>Designation name</Th>
              <Th right>Total employees</Th>
              <Th right>Total contractors</Th>
              <Th right>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {DESIGNATIONS.map((d) => (
              <tr key={d.name}>
                <Td><strong style={{ color: '#0571A6' }}>{d.name}</strong></Td>
                <Td right mono>{d.employees}</Td>
                <Td right mono>{d.contractors}</Td>
                <Td right>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button style={rowActionBtn} title="Edit" onClick={() => setEditing({ name: d.name })}><IconEdit /></button>
                    <button style={{ ...rowActionBtn, color: '#A8475F', borderColor: '#EBD9DE' }} title="Delete" onClick={() => flash(`Designation “${d.name}” removed`)}><IconTrash /></button>
                  </div>
                </Td>
              </tr>
            ))}
            <tr>
              <Td><strong>Total</strong></Td>
              <Td right mono><strong>{totalEmp}</strong></Td>
              <Td right mono><strong>{totalCon}</strong></Td>
              <Td right muted>—</Td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function DesignationModal({ initialName, onClose }: { initialName?: string; onClose: () => void }) {
  const { flash } = useStore();
  const [name, setName] = useState(initialName ?? '');
  const [touched, setTouched] = useState(false);
  const editing = initialName !== undefined;
  const missing = !name.trim();

  const submit = () => {
    setTouched(true);
    if (missing) return;
    flash(editing ? `Designation “${name.trim()}” updated` : `Designation “${name.trim()}” added`);
    onClose();
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{editing ? 'Edit designation' : 'Add designation'}</div>
          <button onClick={onClose} style={iconBtn}><IconClose size={16} /></button>
        </div>
        <div style={{ fontSize: 14, color: '#717171', marginBottom: 18 }}>Designation name is required.</div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' }}>
            Designation name<span style={{ color: '#C4382E', marginLeft: 3 }}>*</span>
          </label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Software Engineer" style={inputStyle} />
          {touched && missing && <div style={{ fontSize: 14, color: '#A8475F', marginTop: 4, fontWeight: 600 }}>This field is required</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 22 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={submit} style={primaryBtn}>{editing ? 'Save changes' : 'Add designation'}</button>
        </div>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 16px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, muted, right, mono }: { children: ReactNode; muted?: boolean; right?: boolean; mono?: boolean }) {
  return <td style={{ padding: '12px 16px', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222', textAlign: right ? 'right' : 'left', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const overlay: CSSProperties = { position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(34,34,34,.38)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 };
const modalCard: CSSProperties = { width: 440, maxWidth: '100%', background: '#F7F7F9', border: '1px solid #EBEBEB', borderRadius: 16, padding: '20px 22px', boxShadow: '0 24px 60px rgba(34,34,34,.28)' };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const iconBtn: CSSProperties = { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#717171' };
