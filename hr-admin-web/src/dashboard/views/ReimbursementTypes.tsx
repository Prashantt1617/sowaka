// Claims › Reimbursement Types — what an employee may claim against, and what
// each is capped at.
//
// These used to be four values baked into the app. HR owns the list now, and
// the cap is real: the app hides anything over it before submitting, and the
// server refuses it on save, so a stale app cannot slip a claim past the limit.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card, EmptyRow, ListPending, PageActions, Pill, Spinner } from '../ui';
import { btn, btnClass, fieldLabel, hint, iconBtn as roundBtn, inp, textareaStyle } from '../ds';
import { IconInfo } from '../icons';
import { downloadCsv } from '../export';
import { IconClose, IconDownload, IconEdit, IconPlus, IconTrash } from './peopleTable';
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

      <PageActions>
        <button className={btnClass()} style={btn()} onClick={download} disabled={types.length === 0}>
          <IconDownload /> Download
        </button>
        <button className={btnClass('primary')} style={btn('primary')} onClick={() => setAdding(true)}>
          <IconPlus size={15} stroke="currentColor" /> Add reimbursement type
        </button>
      </PageActions>

      <div style={note}>
        <span style={{ display: 'inline-flex', marginTop: 2, flexShrink: 0 }}><IconInfo size={15} stroke="var(--accent)" /></span>
        <div style={{ flex: 1 }}>
          An employee picks one of these when raising a claim. A type that is switched off stays on
          old claims but disappears from the app's list, which is how to retire one people have
          already used.
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          {loading ? <Spinner /> : failed && types.length === 0 ? '' : `${types.length} type${types.length === 1 ? '' : 's'}`}
        </div>
      </div>

      <Card padded>
        <table style={tableStyle}>
          <thead className="ds-thead">
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
            {types.map((t, i) => (
              <tr key={t.id} className="dc-row">
                <Td last={i === types.length - 1}>
                  <strong style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{t.name}</strong>
                  {t.payHeadCode && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>Bills for the {t.payHeadCode.toLowerCase().replace(/_/g, ' ')} component · tax-free, not paid again</div>}
                </Td>
                <Td muted last={i === types.length - 1}>{t.description || '—'}</Td>
                <Td right mono last={i === types.length - 1}>{rupees(t.maxLimit)}</Td>
                <Td right mono last={i === types.length - 1}>{t.backdateDays === 0 ? 'Today only' : `${t.backdateDays} days`}</Td>
                <Td last={i === types.length - 1}>
                  <Pill label={t.active ? 'Active' : 'Off'} tone={t.active ? onPill : offPill} />
                </Td>
                <Td right last={i === types.length - 1}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button className="ds-icon-btn" style={roundBtn(34)} title="Edit" onClick={() => setEditing(t)}><IconEdit /></button>
                    <button
                      className="ds-icon-btn"
                      style={{ ...roundBtn(34), color: 'var(--bad)' }}
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
      <div className="scry" style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>
            {initial ? 'Edit reimbursement type' : 'New reimbursement type'}
          </div>
          <button onClick={onClose} className="ds-icon-btn" style={roundBtn(42)} aria-label="Close"><IconClose size={18} stroke="currentColor" /></button>
        </div>

        <div style={{ padding: 20, flex: 1, overflowY: 'auto' }}>
          <Field label="Name" required>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Travel" className="ds-inp" style={inputStyle} autoFocus />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this covers, so people pick the right one"
              rows={3}
              className="ds-inp"
              style={textareaStyle}
            />
          </Field>
          <Field label="Maximum limit per claim">
            <div className="ds-inp" style={unitBox}>
              <span style={{ padding: '0 12px', color: 'var(--ink-3)', borderRight: '1px solid var(--line)', fontSize: 13, alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>₹</span>
              <input
                type="number" min="0" step="100" value={maxLimit}
                onChange={(e) => setMaxLimit(e.target.value)}
                style={unitInput}
              />
            </div>
            <div style={{ ...hint, marginTop: 6 }}>
              {Number(maxLimit) > 0
                ? `A claim over ₹${Number(maxLimit).toLocaleString('en-IN')} will be refused.`
                : 'Zero means no cap — any amount is allowed.'}
            </div>
          </Field>
          <Field label="How far back can it be claimed?">
            <div className="ds-inp" style={unitBox}>
              <input
                type="number" min="0" max="365" step="1" value={backdateDays}
                onChange={(e) => setBackdateDays(e.target.value)}
                style={unitInput}
              />
              <span style={{ padding: '0 12px', color: 'var(--ink-3)', borderLeft: '1px solid var(--line)', fontSize: 13, alignSelf: 'stretch', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>days back</span>
            </div>
            <div style={{ ...hint, marginTop: 6 }}>
              {Number(backdateDays) > 0
                ? `An expense older than ${backdateDays} days cannot be claimed. The app hides those dates.`
                : 'Zero means today only — no past dates can be claimed.'}
            </div>
          </Field>
          {(components?.length ?? 0) > 0 && (
            <Field label="Bills for a salary component">
              <select value={billsFor} onChange={(e) => setBillsFor(e.target.value)} className="ds-inp" style={inputStyle}>
                <option value="">None: an expense claim, paid on the next run</option>
                {components!.map((h) => <option key={h.code} value={h.code}>{h.name}</option>)}
              </select>
              <div style={{ ...hint, marginTop: 6 }}>
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

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '16px 20px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
          <button onClick={onClose} className={btnClass()} style={btn()}>Cancel</button>
          <button onClick={() => void save()} disabled={saving} className={btnClass('primary')} style={btn('primary')}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ ...fieldLabel, display: 'block', marginBottom: 6 }}>
        {label}{required && <span style={{ color: 'var(--bad)', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}
function Th({ children, right, width }: { children: ReactNode; right?: boolean; width?: number }) {
  return <th style={{ textAlign: right ? 'right' : 'left', width, fontSize: 12, lineHeight: '18px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontWeight: 400, padding: '10px 12px', background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>{children}</th>;
}
function Td({ children, muted, right, mono, last }: { children: ReactNode; muted?: boolean; right?: boolean; mono?: boolean; last?: boolean }) {
  return <td style={{ padding: '10px 12px', textAlign: right ? 'right' : 'left', borderBottom: last ? 'none' : '1px solid var(--line)', color: muted ? 'var(--ink-3)' : 'var(--ink)', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

// The prototype's table: a grey header strip with rounded ends inside a padded card.
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13.5, lineHeight: 1.5 };
const inputStyle: CSSProperties = { ...inp };
const unitBox: CSSProperties = { ...inp, display: 'flex', alignItems: 'center', padding: 0, overflow: 'hidden', maxWidth: 260 };
const unitInput: CSSProperties = { border: 'none', outline: 'none', padding: '0 12px', height: '100%', fontSize: 13, width: '100%', color: 'var(--ink)', background: 'transparent' };
const note: CSSProperties = { display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 13, color: 'var(--ink-2)', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', marginBottom: 20, lineHeight: 1.5 };
const onPill = { bg: 'var(--p-green)', fg: 'var(--on-accent)' };
const offPill = { bg: 'var(--mute-bg)', fg: 'var(--ink-2)' };
const errorTag: CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--bad)', background: 'var(--bad-bg)', borderRadius: 14, padding: '10px 14px', marginBottom: 6 };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer', marginBottom: 10, accentColor: 'var(--accent)' };
// A side sheet from the right, as the prototype opens its forms.
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', justifyContent: 'flex-end', zIndex: 60, animation: 'ovl .2s ease both' };
const modalCard: CSSProperties = { width: 440, maxWidth: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: '24px 0 0 24px', boxShadow: 'var(--shadow-drawer)', animation: 'drwIn .25s ease both' }
