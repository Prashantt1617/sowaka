// Claims › Reimbursement Types — what an employee may claim against, and what
// each is capped at.
//
// These used to be four values baked into the app. HR owns the list now, and
// the cap is real: the app hides anything over it before submitting, and the
// server refuses it on save, so a stale app cannot slip a claim past the limit.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card, EmptyRow } from '../ui';
import { downloadCsv } from '../export';
import { IconClose, IconDownload, IconEdit, IconPlus, IconTrash, rowActionBtn } from './peopleTable';
import {
  createReimbursementType, deleteReimbursementType, getReimbursementTypes, updateReimbursementType,
  type ReimbursementTypeDTO,
} from '../../services/hrms';

const rupees = (value: number) =>
  value > 0 ? `₹${value.toLocaleString('en-IN')}` : 'No cap';

export function ReimbursementTypes() {
  const { flash } = useStore();
  const [types, setTypes] = useState<ReimbursementTypeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ReimbursementTypeDTO | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = () =>
    getReimbursementTypes()
      .then(setTypes)
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (type: ReimbursementTypeDTO) => {
    if (!window.confirm(`Delete "${type.name}"?`)) return;
    try {
      await deleteReimbursementType(type.id);
      await reload();
      flash(`${type.name} removed`);
    } catch (error) {
      flash((error as Error).message);
    }
  };

  const download = () => downloadCsv('reimbursement-types', [
    { header: 'Type', value: (t: ReimbursementTypeDTO) => t.name },
    { header: 'Description', value: (t: ReimbursementTypeDTO) => t.description },
    { header: 'Max limit (₹)', value: (t: ReimbursementTypeDTO) => (t.maxLimit > 0 ? t.maxLimit : 'No cap') },
    { header: 'Can be backdated (days)', value: (t: ReimbursementTypeDTO) => t.backdateDays },
    { header: 'Status', value: (t: ReimbursementTypeDTO) => (t.active ? 'Active' : 'Off') },
  ], types);

  return (
    <div>
      {(adding || editing) && (
        <TypeModal
          initial={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={async (message) => { await reload(); flash(message); setAdding(false); setEditing(null); }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: '#717171' }}>
          {loading ? 'Loading…' : `${types.length} type${types.length === 1 ? '' : 's'}`}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
          <button style={ghostBtn} onClick={download} disabled={types.length === 0}>
            <IconDownload /> Download
          </button>
          <button style={primaryBtn} onClick={() => setAdding(true)}>
            <IconPlus size={15} /> Add reimbursement type
          </button>
        </div>
      </div>

      <div style={note}>
        An employee picks one of these when raising a claim. A type that is switched off stays on
        old claims but disappears from the app's list, which is how to retire one people have
        already used.
      </div>

      <Card>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>Type</Th>
              <Th>Description</Th>
              <Th right width={150}>Max limit</Th>
              <Th right width={150}>Backdating</Th>
              <Th width={110}>Status</Th>
              <Th right width={110}>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <Td><strong style={{ color: '#0571A6' }}>{t.name}</strong></Td>
                <Td muted>{t.description || '—'}</Td>
                <Td right mono>{rupees(t.maxLimit)}</Td>
                <Td right mono>{t.backdateDays === 0 ? 'Today only' : `${t.backdateDays} days`}</Td>
                <Td>
                  <span style={t.active ? onPill : offPill}>{t.active ? 'Active' : 'Off'}</span>
                </Td>
                <Td right>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button style={rowActionBtn} title="Edit" onClick={() => setEditing(t)}><IconEdit /></button>
                    <button
                      style={{ ...rowActionBtn, color: '#A8475F', borderColor: '#EBD9DE' }}
                      title="Delete"
                      onClick={() => void remove(t)}
                    ><IconTrash /></button>
                  </div>
                </Td>
              </tr>
            ))}
            {!loading && types.length === 0 && (
              <tr><td colSpan={6}><EmptyRow text="No reimbursement types yet — add one to let people claim." /></td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function TypeModal({ initial, onClose, onSaved }: {
  initial: ReimbursementTypeDTO | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [maxLimit, setMaxLimit] = useState(String(initial?.maxLimit ?? 0));
  const [backdateDays, setBackdateDays] = useState(String(initial?.backdateDays ?? 30));
  const [active, setActive] = useState(initial?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) { setError('Give the type a name'); return; }
    setSaving(true); setError('');
    try {
      const input = {
        name: name.trim(),
        description: description.trim(),
        maxLimit: Number(maxLimit) || 0,
        backdateDays: Number(backdateDays) || 0,
        active,
      };
      if (initial) await updateReimbursementType(initial.id, input);
      else await createReimbursementType(input);
      onSaved(`${input.name} saved`);
    } catch (e) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 22px 4px' }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>
            {initial ? 'Edit reimbursement type' : 'New reimbursement type'}
          </div>
          <button onClick={onClose} style={iconBtn}><IconClose size={18} /></button>
        </div>

        <div style={{ padding: '10px 22px 4px' }}>
          <Field label="Name" required>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Travel" style={inputStyle} autoFocus />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this covers, so people pick the right one"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>
          <Field label="Maximum limit per claim">
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden', background: '#fff', maxWidth: 260 }}>
              <span style={{ padding: '9px 12px', color: '#717171', borderRight: '1px solid #EBEBEB', fontSize: 15 }}>₹</span>
              <input
                type="number" min="0" step="100" value={maxLimit}
                onChange={(e) => setMaxLimit(e.target.value)}
                style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }}
              />
            </div>
            <div style={{ fontSize: 13, color: '#717171', marginTop: 6 }}>
              {Number(maxLimit) > 0
                ? `A claim over ₹${Number(maxLimit).toLocaleString('en-IN')} will be refused.`
                : 'Zero means no cap — any amount is allowed.'}
            </div>
          </Field>
          <Field label="How far back can it be claimed?">
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden', background: '#fff', maxWidth: 260 }}>
              <input
                type="number" min="0" max="365" step="1" value={backdateDays}
                onChange={(e) => setBackdateDays(e.target.value)}
                style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }}
              />
              <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 15 }}>days back</span>
            </div>
            <div style={{ fontSize: 13, color: '#717171', marginTop: 6 }}>
              {Number(backdateDays) > 0
                ? `An expense older than ${backdateDays} days cannot be claimed. The app hides those dates.`
                : 'Zero means today only — no past dates can be claimed.'}
            </div>
          </Field>
          <label style={checkRow}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Available in the app
          </label>
          {error && <div style={errorTag}>{error}</div>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 22px', borderTop: '1px solid #EBEBEB' }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => void save()} disabled={saving} style={{ ...primaryBtn, marginLeft: 'auto' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 6, color: '#484848' }}>
        {label}{required && <span style={{ color: '#C4382E' }}> *</span>}
      </label>
      {children}
    </div>
  );
}
function Th({ children, right, width }: { children: ReactNode; right?: boolean; width?: number }) {
  return <th style={{ textAlign: right ? 'right' : 'left', width, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 16px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, muted, right, mono }: { children: ReactNode; muted?: boolean; right?: boolean; mono?: boolean }) {
  return <td style={{ padding: '13px 16px', textAlign: right ? 'right' : 'left', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const note: CSSProperties = { fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '10px 14px', marginBottom: 14, lineHeight: 1.55 };
const onPill: CSSProperties = { fontSize: 12, fontWeight: 800, color: '#4F7A52', background: '#EAF3EA', border: '1px solid #D6E8D6', borderRadius: 20, padding: '3px 10px' };
const offPill: CSSProperties = { fontSize: 12, fontWeight: 800, color: '#9197A2', background: '#EDEDF0', borderRadius: 20, padding: '3px 10px' };
const errorTag: CSSProperties = { fontSize: 13.5, color: '#A32B2B', background: '#F7E4E4', border: '1px solid #E8C9C9', borderRadius: 10, padding: '10px 13px', marginBottom: 6 };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: '#333333', cursor: 'pointer', marginBottom: 10 };
const ghostBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(20,16,12,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 24 };
const modalCard: CSSProperties = { width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 18, boxShadow: '0 30px 70px rgba(60,40,24,.3)' };
const iconBtn: CSSProperties = { marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#9197A2', padding: 4 };
