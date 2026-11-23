// Week 1's HR setup (23 Nov): the three things HR puts a joiner on once they have joined (a KPI
// template, a salary template, a shift template), each with what they are on now and an Assign /
// Change that does it in place through the same APIs the template pages use:
//   KPI     POST /admin/kpi/assignments { userId, period, templateId }  (the profile's Assign KPIs; the cycle in progress)
//   Salary  POST /admin/payroll/salary-templates/:code/people { people: [{ userId, annualCtcPaise, effectiveFrom }] }
//   Shift   POST /admin/shifts/:id/assign { userIds }  (Shift templates › Edit employees; the move starts tomorrow)
// Each action is gated by the tabs those pages need (the server checks the same).
import { useState } from 'react';
import { assignKpis } from '../../../services/kpi';
import { assignShift } from '../../../services/hrms';
import { rupeesToPaise } from '../../../services/payroll';
import { assignTemplatePeople } from '../../../services/salaryTemplatePeople';
import { periodLabel } from '../../period';
import { Field, Modal, Pick } from './shared';
import { errText, inputStyle, rupees, todayKey } from './format';
import { SETUP_KINDS } from './week1SetupData';
import type { SetupKind, Week1Setup } from './week1SetupData';

const TITLE: Record<SetupKind, string> = { kpi: 'Assign a KPI template', salary: 'Assign a salary template', shift: 'Assign a shift template' };
const NOUN: Record<SetupKind, string> = { kpi: 'KPI template', salary: 'Salary template', shift: 'Shift template' };

/** A small done tick, or an empty ring. */
function Tick({ done }: { done: boolean }) {
  return (
    <span aria-hidden style={{ width: 18, height: 18, borderRadius: '50%', flex: 'none', border: `2px solid ${done ? 'var(--ok-solid)' : 'var(--line-2)'}`, background: done ? 'var(--ok-solid)' : 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {done && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}
    </span>
  );
}

/** The three HR setup rows: what they are on now, a tick once on one, and Assign / Change. */
export function HrSetupRows({ setup, joined, busy, onAssign }: { setup: Week1Setup; joined: boolean; busy: boolean; onAssign: (kind: SetupKind) => void }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {SETUP_KINDS.map((kind) => {
        const r = setup.rows[kind];
        const done = joined && r.status === 'ready' && r.assigned;
        const line = !joined ? 'After they join'
          : r.status === 'loading' ? 'Loading…'
            : r.status === 'error' ? r.error ?? 'Could not load'
              : r.status === 'no_access' ? 'Needs payroll access'
                : r.now ?? 'Not assigned';
        const action = joined && r.status === 'ready' && r.canAssign;
        const why = joined && r.status === 'ready' && !r.canAssign
          ? kind === 'salary' ? 'Needs access to Salary templates' : kind === 'kpi' ? 'Needs access to KPI templates' : 'Needs access to Shift templates'
          : '';
        return (
          <div key={kind} data-setup={kind} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12 }}>
            <Tick done={done} />
            <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
              <b style={{ fontSize: 13, fontWeight: 500 }}>{TITLE[kind]}</b>
              <span style={{ fontSize: 12, color: r.status === 'error' && joined ? 'var(--bad)' : done ? 'var(--ink-2)' : 'var(--ink-3)', overflowWrap: 'anywhere' }}>
                {line}{joined && r.status === 'ready' && r.detail ? <span style={{ color: 'var(--ink-3)' }}> · {r.detail}</span> : null}
              </span>
            </span>
            {action && (
              <button type="button" className={`pd-btn sm${r.assigned ? '' : ' primary'}`} style={{ flex: 'none' }} disabled={busy || r.options.length === 0}
                title={r.options.length === 0 ? `No ${NOUN[kind].toLowerCase()}s yet` : undefined} onClick={() => onAssign(kind)}>
                {r.assigned ? 'Change' : 'Assign'}
              </button>
            )}
            {why && <span style={{ fontSize: 11.5, color: 'var(--ink-3)', flex: 'none' }}>{why}</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The picker: one of that kind's templates (salary also asks the annual CTC, prefilled from the
 * offer, and the day it applies from, the joining date by default), then assigns this person.
 */
export function AssignSetupDialog({ kind, setup, userId, name, offerCtc, tj, onClose, onDone }: {
  kind: SetupKind; setup: Week1Setup; userId: string; name: string;
  /** The offer's annual CTC in rupees (absent without payroll access). */
  offerCtc?: number;
  tj?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const r = setup.rows[kind];
  const [pick, setPick] = useState(r.currentId && r.options.some((o) => o.id === r.currentId) ? r.currentId : r.options[0]?.id ?? '');
  const existingCtc = setup.salary && setup.salary.annualCtcPaise > 0 ? setup.salary.annualCtcPaise / 100 : undefined;
  const [ctc, setCtc] = useState(() => { const v = offerCtc && offerCtc > 0 ? offerCtc : existingCtc; return v ? String(Math.round(v)) : ''; });
  const [from, setFrom] = useState(tj || todayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = r.options.find((o) => o.id === pick);
  const same = r.assigned && pick === r.currentId && kind === 'shift';

  const save = async () => {
    if (!pick) { setError(`Pick a ${NOUN[kind].toLowerCase()}`); return; }
    setBusy(true); setError('');
    try {
      if (kind === 'kpi') {
        if (!setup.cycle) throw new Error('The KPI cycle has not loaded yet');
        await assignKpis({ userId, period: setup.cycle.period, templateId: pick });
      } else if (kind === 'shift') {
        await assignShift(pick, [userId]);
      } else {
        const paise = rupeesToPaise(ctc);
        if (!Number.isInteger(paise) || paise <= 0) throw new Error('Enter the annual CTC');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('Pick the day it applies from');
        const res = await assignTemplatePeople(pick, [{ userId, annualCtcPaise: paise, effectiveFrom: from }]);
        const mine = res.results.find((x) => x.userId === userId);
        if (mine && !mine.ok) throw new Error(mine.message || 'Could not put them on this template');
      }
      await setup.reload(kind);
      onDone(`${name} is on ${chosen?.name ?? 'the template'}`);
    } catch (e) {
      setError(errText(e, 'Could not assign'));
      setBusy(false);
    }
  };

  const sub = kind === 'kpi'
    ? setup.cycle ? `Goes live in ${periodLabel(setup.cycle.period)}, the cycle in progress: their manager scores against it from now. It replaces any set they have for that cycle.` : undefined
    : kind === 'shift' ? 'The move starts tomorrow; today stays on the shift they follow now.'
      : 'Gives them a salary on this template, with the annual CTC and the day it applies from. Someone on another template moves here.';
  return (
    <Modal title={`${TITLE[kind]} · ${name}`} sub={sub} onClose={onClose} busy={busy} width={480}
      footer={<>
        <button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="pd-btn primary" onClick={() => void save()} disabled={busy || !pick || same}>{busy ? 'Saving…' : 'Assign'}</button>
      </>}>
      <div style={{ display: 'grid', gap: 12 }}>
        {r.options.length === 0 ? (
          <div className="pd-note">No {NOUN[kind].toLowerCase()}s yet. Make one on the {NOUN[kind]}s page first.</div>
        ) : (
          <Field label={NOUN[kind]} error={kind !== 'salary' ? error : undefined}>
            <Pick value={pick} onChange={setPick} ariaLabel={NOUN[kind]}>
              {r.options.map((o) => <option key={o.id} value={o.id}>{o.name}{o.note ? ` (${o.note})` : ''}{o.id === r.currentId && r.assigned ? ' · now' : ''}</option>)}
            </Pick>
          </Field>
        )}
        {kind === 'salary' && (
          <>
            <Field label="Annual CTC (₹)" required hint={offerCtc && offerCtc > 0 ? `From the offer: ${rupees(offerCtc)} a year` : undefined}>
              <input type="number" min={1} step={1} inputMode="numeric" value={ctc} onChange={(e) => setCtc(e.target.value)} style={inputStyle} aria-label="Annual CTC in rupees" />
            </Field>
            <Field label="Applies from" required hint={tj && from === tj ? 'Their joining date' : undefined} error={error}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
