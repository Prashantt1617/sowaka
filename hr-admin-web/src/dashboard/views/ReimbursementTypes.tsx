// Claims › Reimbursement Types — what an employee may claim against, and what
// each is capped at.
//
// These used to be four values baked into the app. HR owns the list now, and
// the cap is real: the app hides anything over it before submitting, and the
// server refuses it on save, so a stale app cannot slip a claim past the limit.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card, EmptyRow, ListPending, Spinner } from '../ui';
import { downloadCsv } from '../export';
import { IconClose, IconDownload, IconEdit, IconPlus, IconTrash, rowActionBtn } from './peopleTable';
import {
  createReimbursementType, deleteReimbursementType, getReimbursementTypes, updateReimbursementType,
  type ReimbursementTypeDTO,
} from '../../services/hrms';
import { listPayHeads, type PayHeadDTO } from '../../services/payroll';

const rupees = (value: number) =>
  value > 0 ? `₹${value.toLocaleString('en-IN')}` : 'No cap';

export function ReimbursementTypes() {
  const { flash } = useStore();
  const [types, setTypes] = useState<ReimbursementTypeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  // The first load failed: say so, with Retry, rather than "No reimbursement types yet".
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<ReimbursementTypeDTO | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = () =>
    getReimbursementTypes()
      .then((t) => { setTypes(t); setFailed(false); })
      .catch((error: Error) => { setFailed(true); flash(error.message); })
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
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {loading ? <Spinner /> : failed && types.length === 0 ? '' : `${types.length} type${types.length === 1 ? '' : 's'}`}
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
                <Td>
                  <strong style={{ color: 'var(--accent-ink)' }}>{t.name}</strong>
                  {t.payHeadCode && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Bills for the {t.payHeadCode.toLowerCase().replace(/_/g, ' ')} component · tax-free, not paid again</div>}
                </Td>
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
                      style={{ ...rowActionBtn, color: 'var(--bad)', borderColor: 'var(--bad-line)' }}
                      title="Delete"
                      onClick={() => void remove(t)}
                    ><IconTrash /></button>
                  </div>
                </Td>
              </tr>
            ))}
            {(loading || (failed && types.length === 0)) && (
              <tr><td colSpan={6} style={{ padding: 0 }}><ListPending state={loading ? 'loading' : 'error'} onRetry={() => { setLoading(true); void reload(); }} rows={4} cols={6} avatar={false} rowHeight={52} /></td></tr>
            )}
            {!loading && !failed && types.length === 0 && (
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
  const [billsFor, setBillsFor] = useState(initial?.payHeadCode ?? '');
  // Salary reimbursement components (Fuel, Internet…) a type's claims can be the bills for.
  const [components, setComponents] = useState<PayHeadDTO[] | null>(null);
  useEffect(() => {
    void listPayHeads().then((heads) => setComponents(heads.filter((h) => h.category === 'reimbursement'))).catch(() => setComponents([]));
  }, []);
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
        payHeadCode: billsFor || null,
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
          <div style={{ fontSize: 16.5, fontWeight: 600 }}>
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
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)', maxWidth: 260 }}>
              <span style={{ padding: '9px 12px', color: 'var(--ink-3)', borderRight: '1px solid var(--line)', fontSize: 13.5 }}>₹</span>
              <input
                type="number" min="0" step="100" value={maxLimit}
                onChange={(e) => setMaxLimit(e.target.value)}
                style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 14, width: '100%', color: 'var(--ink)', background: 'transparent' }}
              />
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 6 }}>
              {Number(maxLimit) > 0
                ? `A claim over ₹${Number(maxLimit).toLocaleString('en-IN')} will be refused.`
                : 'Zero means no cap — any amount is allowed.'}
            </div>
          </Field>
          <Field label="How far back can it be claimed?">
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)', maxWidth: 260 }}>
              <input
                type="number" min="0" max="365" step="1" value={backdateDays}
                onChange={(e) => setBackdateDays(e.target.value)}
                style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 14, width: '100%', color: 'var(--ink)', background: 'transparent' }}
              />
              <span style={{ padding: '9px 12px', color: 'var(--ink-3)', borderLeft: '1px solid var(--line)', fontSize: 13.5 }}>days back</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 6 }}>
              {Number(backdateDays) > 0
                ? `An expense older than ${backdateDays} days cannot be claimed. The app hides those dates.`
                : 'Zero means today only — no past dates can be claimed.'}
            </div>
          </Field>
          {(components?.length ?? 0) > 0 && (
            <Field label="Bills for a salary component">
              <select value={billsFor} onChange={(e) => setBillsFor(e.target.value)} style={{ ...inputStyle, maxWidth: 360 }}>
                <option value="">None: an expense claim, paid on the next run</option>
                {components!.map((h) => <option key={h.code} value={h.code}>{h.name}</option>)}
              </select>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 6 }}>
                {billsFor
                  ? 'This component is already paid with salary every month and taxed until bills come in. An approved claim of this type is not paid again: it makes that much of the component tax-free, and the income tax drops from the next payroll run.'
                  : 'The approved amount is paid on the next payroll run.'}
              </div>
            </Field>
          )}
          <label style={checkRow}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Available in the app
          </label>
          {error && <div style={errorTag}>{error}</div>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 22px', borderTop: '1px solid var(--line)' }}>
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
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--ink-2)' }}>
        {label}{required && <span style={{ color: 'var(--bad)' }}> *</span>}
      </label>
      {children}
    </div>
  );
}
function Th({ children, right, width }: { children: ReactNode; right?: boolean; width?: number }) {
  return <th style={{ textAlign: right ? 'right' : 'left', width, fontSize: 12, textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontWeight: 400, padding: '11px 16px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>{children}</th>;
}
function Td({ children, muted, right, mono }: { children: ReactNode; muted?: boolean; right?: boolean; mono?: boolean }) {
  return <td style={{ padding: '13px 16px', textAlign: right ? 'right' : 'left', borderBottom: '1px solid var(--line)', color: muted ? 'var(--ink-3)' : 'var(--ink)', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' };
const note: CSSProperties = { fontSize: 12.5, color: 'var(--ink-2)', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, lineHeight: 1.55 };
const onPill: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: 'var(--ok)', background: 'var(--ok-bg)', border: '1px solid var(--ok-line)', borderRadius: 'var(--r-lg)', padding: '3px 10px' };
const offPill: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: 'var(--ink-4)', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', padding: '3px 10px' };
const errorTag: CSSProperties = { fontSize: 12.5, color: 'var(--bad)', background: 'var(--bad-bg)', border: '1px solid var(--bad-line)', borderRadius: 10, padding: '10px 13px', marginBottom: 6 };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 400, color: 'var(--ink)', cursor: 'pointer', marginBottom: 10 };
const ghostBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--line)', padding: '9px 15px', borderRadius: 999, fontSize: 14, fontWeight: 500, cursor: 'pointer' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent-grad)', color: 'var(--on-accent)', border: 'none', padding: '9px 16px', borderRadius: 999, fontSize: 14, fontWeight: 500, cursor: 'pointer' };
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(20,16,12,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 24 };
const modalCard: CSSProperties = { width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', background: 'var(--surface)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)' };
const iconBtn: CSSProperties = { marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: 4 };
