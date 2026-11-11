// Add or change a date HR has put in the engagement plan. It is a note in the
// dashboard's own plan only: nothing is posted, sent or started from here.
import { useEffect, useState } from 'react';
import { addPlanItem, updatePlanItem, type PlanItemInput, type PlanKind } from '../../../../services/engagement-contests';
import { KIND_LABEL } from './kinds';
import { ApiError } from '../../../../services/http';
import { useStore } from '../../../store';
import * as L from '../../look';

export function PlanItemModal({
  initial,
  id,
  onClose,
  onSaved,
}: {
  initial: PlanItemInput;
  /** Set when changing a date already in the plan. */
  id?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { flash } = useStore();
  const [f, setF] = useState<PlanItemInput>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!f.title.trim()) return setErr('Give it a name');
    if (!f.date) return setErr('Pick a date');
    setErr('');
    setBusy(true);
    try {
      if (id) await updatePlanItem(id, f);
      else await addPlanItem(f);
      flash(id ? 'Plan updated' : 'Added to the plan');
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof PlanItemInput>(k: K, v: PlanItemInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const isFriday = f.date && new Date(`${f.date}T00:00:00Z`).getUTCDay() === 5;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 14px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div role="dialog" aria-modal="true" aria-label={id ? 'Change planned date' : 'Create a plan'} style={{ ...L.modalSheet, maxWidth: 460 }}>
        <div style={L.modalHeadBar}>
          <span style={L.modalTitle}>{id ? 'Change planned date' : 'Create a plan'}</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...L.btnGhost, color: 'var(--ink-2)', fontSize: 18 }}>×</button>
        </div>
        <div style={{ ...L.modalBody, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <div>
            <span style={L.label}>What it is</span>
            <div style={L.seg}>
              {(Object.keys(KIND_LABEL) as PlanKind[]).map((k) => (
                <button key={k} type="button" style={L.segBtn(f.kind === k)} onClick={() => set('kind', k)}>{KIND_LABEL[k]}</button>
              ))}
            </div>
          </div>
          <label>
            <span style={L.label}>Name</span>
            <input style={L.input} maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Odd One Out tournament" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
            <label>
              <span style={L.label}>Date</span>
              <input style={L.input} type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
            </label>
            <label>
              <span style={L.label}>Time (optional)</span>
              <input style={L.input} type="time" value={f.time} onChange={(e) => set('time', e.target.value)} />
            </label>
          </div>
          {f.date && !isFriday && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: -6 }}>Not a Friday. The plan’s rhythm puts activities on Fridays.</div>}
          <label>
            <span style={L.label}>Note (optional)</span>
            <textarea style={L.textarea} maxLength={500} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Who it is for, what to set up" />
          </label>
          <div style={{ ...L.note, fontSize: 12.5 }}>
            This only marks the date in your plan. Nothing goes to employees: start the contest or game from its own page when the day comes.
          </div>
          {err && <div role="alert" style={{ color: 'var(--bad)', fontSize: 13 }}>{err}</div>}
        </div>
        <div style={L.modalFootBar}>
          <button type="button" style={L.btnSmPrimary} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : id ? 'Save' : 'Add to plan'}</button>
          <button type="button" style={L.btnSm} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
