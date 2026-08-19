// People › Departments — a table of the org's departments.
// NOTE: frontend-capture phase — renders from local mock data, no API calls.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { IconPlus, IconClose, IconDownload, IconEdit, IconTrash, rowActionBtn } from './peopleTable';

type Department = {
  name: string;
  description: string;
  code: string;
  employees: number;
  contractors: number;
};

// —— Mock data for capture ————————————————————————————————————————————
const DEPARTMENTS: Department[] = [
  { name: 'Engineering', description: 'Product & platform development', code: 'ENG', employees: 28, contractors: 4 },
  { name: 'Design', description: 'Product & brand design', code: 'DSGN', employees: 5, contractors: 1 },
  { name: 'Sales', description: 'Revenue and field sales', code: 'SAL', employees: 12, contractors: 3 },
  { name: 'Marketing', description: 'Brand, growth & content', code: 'MKT', employees: 7, contractors: 2 },
  { name: 'Customer Success', description: 'Onboarding & customer support', code: 'CS', employees: 8, contractors: 2 },
  { name: 'Finance', description: 'Accounting, payroll & compliance', code: 'FIN', employees: 6, contractors: 0 },
  { name: 'Human Resources', description: 'People operations & culture', code: 'HR', employees: 5, contractors: 1 },
];

export function Departments() {
  const { flash } = useStore();
  const totalEmp = DEPARTMENTS.reduce((s, d) => s + d.employees, 0);
  const totalCon = DEPARTMENTS.reduce((s, d) => s + d.contractors, 0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);

  return (
    <div>
      {adding && <DepartmentModal onClose={() => setAdding(false)} />}
      {editing && <DepartmentModal initial={editing} onClose={() => setEditing(null)} />}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: '#717171' }}>{DEPARTMENTS.length} departments</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
          <button style={ghostBtn}><IconDownload /> Download</button>
          <button style={primaryBtn} onClick={() => setAdding(true)}><IconPlus size={15} /> Add department</button>
        </div>
      </div>

      <Card>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>Department name</Th>
              <Th>Description</Th>
              <Th>Department code</Th>
              <Th right>Total employees</Th>
              <Th right>Total contractors</Th>
              <Th right>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {DEPARTMENTS.map((d) => (
              <tr key={d.code}>
                <Td><strong style={{ color: '#0571A6' }}>{d.name}</strong></Td>
                <Td muted>{d.description}</Td>
                <Td muted><code>{d.code}</code></Td>
                <Td right mono>{d.employees}</Td>
                <Td right mono>{d.contractors}</Td>
                <Td right>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button style={rowActionBtn} title="Edit" onClick={() => setEditing(d)}><IconEdit /></button>
                    <button style={{ ...rowActionBtn, color: '#A8475F', borderColor: '#EBD9DE' }} title="Delete" onClick={() => flash(`Department “${d.name}” removed`)}><IconTrash /></button>
                  </div>
                </Td>
              </tr>
            ))}
            <tr>
              <Td><strong>Total</strong></Td>
              <Td muted>—</Td>
              <Td muted>—</Td>
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

function DepartmentModal({ initial, onClose }: { initial?: Department; onClose: () => void }) {
  const { flash } = useStore();
  const editing = initial !== undefined;
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [touched, setTouched] = useState(false);

  const missing = { name: !name.trim(), description: !description.trim(), code: !code.trim() };
  const invalid = missing.name || missing.description || missing.code;

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    flash(editing ? `Department “${name.trim()}” updated` : `Department “${name.trim()}” added`);
    onClose();
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{editing ? 'Edit department' : 'Add department'}</div>
          <button onClick={onClose} style={iconBtn}><IconClose size={16} /></button>
        </div>
        <div style={{ fontSize: 14, color: '#717171', marginBottom: 18 }}>All fields are required.</div>

        <ModalField label="Department name" required error={touched && missing.name}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering" style={inputStyle} />
        </ModalField>
        <ModalField label="Description" required error={touched && missing.description}>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Product & platform development" style={inputStyle} />
        </ModalField>
        <ModalField label="Department code" required error={touched && missing.code} hint="A short unique reference, e.g. ENG">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. ENG" style={inputStyle} />
        </ModalField>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 22 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={submit} style={primaryBtn}>{editing ? 'Save changes' : 'Add department'}</button>
        </div>
      </div>
    </div>
  );
}

function ModalField({ label, required, error, hint, children }: { label: string; required?: boolean; error?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' }}>
        {label}{required && <span style={{ color: '#C4382E', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {error ? (
        <div style={{ fontSize: 14, color: '#A8475F', marginTop: 4, fontWeight: 600 }}>This field is required</div>
      ) : hint ? (
        <div style={{ fontSize: 12, color: '#717171', marginTop: 4 }}>{hint}</div>
      ) : null}
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
