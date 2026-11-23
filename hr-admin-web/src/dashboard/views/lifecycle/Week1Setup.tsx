// Week 1's HR setup (23 Nov): the three things HR puts a joiner on (a KPI template, a salary template,
// a shift template), each with what they are on now and an Assign / Change that does it in place through
// the same APIs the template pages use:
//   KPI     POST /admin/kpi/assignments { userId, period, templateId }  (the profile's Assign KPIs; the cycle in progress)
//   Salary  POST /admin/payroll/salary-templates/:code/people { people: [{ userId, annualCtcPaise, effectiveFrom }] }
//   Shift   POST /admin/shifts/:id/assign { userIds }  (Shift templates › Edit employees; the move starts tomorrow)
// Any time (24 Nov): before they have an account (not joined, no app access) the same picker saves the choice on the
// journey (PUT /admin/lifecycle/journeys/:id/pending-setup) and the row says "Applies when they join"; the server
// applies it through those same assigns when the account is made (Generate app access, or Mark joined). One it could
// not apply stays, and the row says "Couldn't apply: <reason>" until HR assigns it directly.
// Each action is gated by the tabs those pages need (the server checks the same).
import { useEffect, useState } from 'react';
import { assignKpis } from '../../../services/kpi';
import { assignShift } from '../../../services/hrms';
import { savePendingSetup } from '../../../services/lifecycle';
import type { PendingSetup } from '../../../services/lifecycle';
import { rupeesToPaise } from '../../../services/payroll';
import { assignTemplatePeople, dayLabel } from '../../../services/salaryTemplatePeople';
import { periodLabel } from '../../period';
import { Field, Modal, Pick } from './shared';
import { errText, inputStyle, rupees, todayKey } from './format';
import { SETUP_KINDS, pendingIdOf } from './week1SetupData';
import type { SetupKind, Week1Setup } from './week1SetupData';

const TITLE: Record<SetupKind, string> = { kpi: 'Assign a KPI template', salary: 'Assign a salary template', shift: 'Assign a shift template' };
const NOUN: Record<SetupKind, string> = { kpi: 'KPI template', salary: 'Salary template', shift: 'Shift template' };
const NEEDS: Record<SetupKind, string> = { kpi: 'Needs access to KPI templates', salary: 'Needs access to Salary templates', shift: 'Needs access to Shift templates' };

/** A small done tick, or an empty ring. */
function Tick({ done }: { done: boolean }) {
  return (
    <span aria-hidden style={{ width: 18, height: 18, borderRadius: '50%', flex: 'none', border: `2px solid ${done ? 'var(--ok-solid)' : 'var(--line-2)'}`, background: done ? 'var(--ok-solid)' : 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {done && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}
    </span>
  );
}

/** A pending salary choice's CTC and day (the CTC only for someone with pay access). */
const salaryLine = (p: NonNullable<PendingSetup['salary']>) =>
  [p.annualCtcPaise && p.annualCtcPaise > 0 ? `${rupees(p.annualCtcPaise / 100)} a year` : '', p.effectiveFrom ? `from ${dayLabel(p.effectiveFrom)}` : ''].filter(Boolean).join(' · ');

/**
 * The three HR setup rows: what they are on now (or, before an account, what HR chose for when they join), a tick
 * once on one (or chosen), and Assign / Change.
 */
export function HrSetupRows({ setup, hasAccount, pending, busy, onAssign }: {
  setup: Week1Setup;
  /** They have an account (joined, or app access given): assigning is direct. */
  hasAccount: boolean;
  pending?: PendingSetup;
  busy: boolean;
  onAssign: (kind: SetupKind) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {SETUP_KINDS.map((kind) => {
        const r = setup.rows[kind];
        const p = pending?.[kind];
        const failed = p?.error ? `Couldn’t apply${hasAccount ? ` ${p.name}` : ''}: ${p.error}` : '';
        let done: boolean;
        let line: string;
        let detail = '';
        let action: boolean;
        let label: string;
        if (!hasAccount) {
          // The choice is kept on the journey until their account is made.
          done = Boolean(p) && !failed;
          line = p ? (failed || p.name) : r.status === 'no_access' ? 'Needs payroll access' : 'Not chosen yet';
          detail = p && !failed ? [kind === 'salary' ? salaryLine(p as NonNullable<PendingSetup['salary']>) : '', 'Applies when they join'].filter(Boolean).join(' · ')
            : !p && r.status !== 'no_access' ? 'You can choose now; it applies when they join' : '';
          action = r.status !== 'no_access' && r.canAssign;
          label = p ? 'Change' : 'Assign';
        } else {
          done = r.status === 'ready' && r.assigned;
          line = r.status === 'loading' ? 'Loading…'
            : r.status === 'error' ? r.error ?? 'Could not load'
              : r.status === 'no_access' ? 'Needs payroll access'
                : r.now ?? 'Not assigned';
          detail = r.status === 'ready' && r.detail ? r.detail : '';
          action = r.status === 'ready' && r.canAssign;
          label = r.assigned ? 'Change' : 'Assign';
        }
        const why = !action && r.status !== 'no_access' && (hasAccount ? r.status === 'ready' : true) && !r.canAssign ? NEEDS[kind] : '';
        const noOptions = hasAccount && r.options.length === 0;
        const red = (hasAccount && r.status === 'error') || (!hasAccount && Boolean(failed));
        return (
          <div key={kind} data-setup={kind} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12 }}>
            <Tick done={done} />
            <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
              <b style={{ fontSize: 13, fontWeight: 500 }}>{TITLE[kind]}</b>
              <span style={{ fontSize: 12, color: red ? 'var(--bad)' : done ? 'var(--ink-2)' : 'var(--ink-3)', overflowWrap: 'anywhere' }}>
                {line}{detail ? <span style={{ color: 'var(--ink-3)' }}> · {detail}</span> : null}
              </span>
              {hasAccount && failed && <span style={{ fontSize: 12, color: 'var(--bad)', overflowWrap: 'anywhere' }}>{failed}</span>}
            </span>
            {action && (
              <button type="button" className={`pd-btn sm${label === 'Change' ? '' : ' primary'}`} style={{ flex: 'none' }} disabled={busy || noOptions}
                title={noOptions ? `No ${NOUN[kind].toLowerCase()}s yet` : undefined} onClick={() => onAssign(kind)}>
                {label}
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
 * The picker: one of that kind's templates (salary also asks the annual CTC, prefilled from the offer, and the
 * day it applies from, the joining date by default). With an account it assigns this person; before one it saves
 * the choice on the journey, applied when the account is made. `onDone(message, journeyChanged)`.
 */
export function AssignSetupDialog({ kind, setup, journeyId, userId, pending, name, offerCtc, tj, onClose, onDone }: {
  kind: SetupKind; setup: Week1Setup; journeyId: string;
  /** Their account (joined, or app access given); absent: the choice is kept for when they join. */
  userId?: string;
  pending?: PendingSetup;
  name: string;
  /** The offer's annual CTC in rupees (absent without payroll access). */
  offerCtc?: number;
  tj?: string;
  onClose: () => void;
  onDone: (message: string, journeyChanged: boolean) => void;
}) {
  const r = setup.rows[kind];
  const p = pending?.[kind];
  const pendingId = pendingIdOf(pending, kind);
  const pendingSalary = kind === 'salary' ? pending?.salary : undefined;
  const preferred = (options: { id: string }[]) => {
    const want = userId ? r.currentId : pendingId;
    return want && options.some((o) => o.id === want) ? want : options[0]?.id ?? '';
  };
  const [pick, setPick] = useState(() => preferred(r.options));
  const existingCtc = setup.salary && setup.salary.annualCtcPaise > 0 ? setup.salary.annualCtcPaise / 100 : undefined;
  const pendingCtc = pendingSalary?.annualCtcPaise && pendingSalary.annualCtcPaise > 0 ? pendingSalary.annualCtcPaise / 100 : undefined;
  const [ctc, setCtc] = useState(() => {
    const v = userId ? (offerCtc && offerCtc > 0 ? offerCtc : existingCtc) : pendingCtc ?? (offerCtc && offerCtc > 0 ? offerCtc : undefined);
    return v ? String(Math.round(v)) : '';
  });
  const [from, setFrom] = useState((!userId && pendingSalary?.effectiveFrom) || tj || todayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Before an account the templates load when the picker opens.
  const loading = r.status === 'idle' || r.status === 'loading';
  useEffect(() => {
    if (r.status === 'idle' || (!userId && r.status === 'error')) void setup.reload(kind);
    // Once: the picker loads its templates when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!pick && r.options.length) setPick(preferred(r.options));
    // Only when the options arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.options]);
  const chosen = r.options.find((o) => o.id === pick);
  const same = kind !== 'salary' && (userId ? r.assigned && pick === r.currentId : Boolean(p) && !p?.error && pick === pendingId);

  const save = async () => {
    if (!pick) { setError(`Pick a ${NOUN[kind].toLowerCase()}`); return; }
    setBusy(true); setError('');
    try {
      let paise = 0;
      if (kind === 'salary') {
        paise = rupeesToPaise(ctc);
        if (!Number.isInteger(paise) || paise <= 0) throw new Error('Enter the annual CTC');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('Pick the day it applies from');
      }
      if (!userId) {
        // No account yet: kept on the journey, applied when it is made.
        await savePendingSetup(journeyId, kind === 'kpi' ? { kpi: { templateId: pick } }
          : kind === 'shift' ? { shift: { templateId: pick } }
            : { salary: { templateCode: pick, annualCtcPaise: paise, effectiveFrom: from } });
        onDone(`${chosen?.name ?? 'The template'} applies when ${name} joins`, true);
        return;
      }
      if (kind === 'kpi') {
        if (!setup.cycle) throw new Error('The KPI cycle has not loaded yet');
        await assignKpis({ userId, period: setup.cycle.period, templateId: pick });
      } else if (kind === 'shift') {
        await assignShift(pick, [userId]);
      } else {
        const res = await assignTemplatePeople(pick, [{ userId, annualCtcPaise: paise, effectiveFrom: from }]);
        const mine = res.results.find((x) => x.userId === userId);
        if (mine && !mine.ok) throw new Error(mine.message || 'Could not put them on this template');
      }
      // A choice made before the account that could not be applied: done now, so it goes.
      if (p) await savePendingSetup(journeyId, { [kind]: null }).catch(() => undefined);
      await setup.reload(kind);
      onDone(`${name} is on ${chosen?.name ?? 'the template'}`, Boolean(p));
    } catch (e) {
      setError(errText(e, 'Could not assign'));
      setBusy(false);
    }
  };

  const sub = !userId
    ? kind === 'kpi' ? 'Saved now and applied when their account is made (app access or Mark joined): they go on it for the KPI cycle in progress then.'
      : kind === 'shift' ? 'Saved now and applied when their account is made (app access or Mark joined); the move starts the day after.'
        : 'Saved now and applied when their account is made (app access or Mark joined): a salary on this template, with this annual CTC, from this day.'
    : kind === 'kpi'
      ? setup.cycle ? `Goes live in ${periodLabel(setup.cycle.period)}, the cycle in progress: their manager scores against it from now. It replaces any set they have for that cycle.` : undefined
      : kind === 'shift' ? 'The move starts tomorrow; today stays on the shift they follow now.'
        : 'Gives them a salary on this template, with the annual CTC and the day it applies from. Someone on another template moves here.';
  return (
    <Modal title={`${TITLE[kind]} · ${name}`} sub={sub} onClose={onClose} busy={busy} width={480}
      footer={<>
        <button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="pd-btn primary" onClick={() => void save()} disabled={busy || loading || !pick || same}>{busy ? 'Saving…' : userId ? 'Assign' : 'Save'}</button>
      </>}>
      <div style={{ display: 'grid', gap: 12 }}>
        {loading ? (
          <div className="pd-note">Loading the {NOUN[kind].toLowerCase()}s…</div>
        ) : r.status === 'error' ? (
          <div className="pd-note" style={{ color: 'var(--bad)' }}>{r.error ?? 'Could not load'}</div>
        ) : r.options.length === 0 ? (
          <div className="pd-note">No {NOUN[kind].toLowerCase()}s yet. Make one on the {NOUN[kind]}s page first.</div>
        ) : (
          <Field label={NOUN[kind]} error={kind !== 'salary' ? error : undefined}>
            <Pick value={pick} onChange={setPick} ariaLabel={NOUN[kind]}>
              {r.options.map((o) => {
                const now = userId ? o.id === r.currentId && r.assigned : o.id === pendingId && Boolean(p);
                return <option key={o.id} value={o.id}>{o.name}{o.note ? ` (${o.note})` : ''}{now ? (userId ? ' · now' : ' · chosen') : ''}</option>;
              })}
            </Pick>
          </Field>
        )}
        {kind === 'salary' && !loading && r.status !== 'error' && (
          <>
            <Field label="Annual CTC (₹)" required hint={offerCtc && offerCtc > 0 ? `From the offer: ${rupees(offerCtc)} a year` : undefined}>
              <input type="number" min={1} step={1} inputMode="numeric" value={ctc} onChange={(e) => setCtc(e.target.value)} style={inputStyle} aria-label="Annual CTC in rupees" />
            </Field>
            <Field label="Applies from" required hint={tj && from === tj ? 'Their joining date' : undefined} error={error}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
            </Field>
          </>
        )}
        {kind !== 'salary' && error && (loading || r.status === 'error' || r.options.length === 0) && <div className="pd-note" style={{ color: 'var(--bad)' }}>{error}</div>}
      </div>
    </Modal>
  );
}
