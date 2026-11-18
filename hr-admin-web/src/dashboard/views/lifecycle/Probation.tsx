// Probation in the joiner panel: each month's goals, the two check-ins and the
// manager's review; and, in the final month, the confirmation decision
// (confirm, extend or not confirm, with salary, KPI template, designation and
// reporting), after which the confirmation or extension letter comes from
// Documents.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { canSeePay } from '../../access';
import { listKpiTemplates } from '../../../services/kpi';
import type { KpiTemplateDTO } from '../../../services/kpi';
import { recordDecision } from '../../../services/lifecycle';
import type { ConfirmationDecision, JourneyView, ProbationMonthDTO } from '../../../services/lifecycle';
import { Field, Modal, Pick } from './shared';
import { errText, firstName, inputStyle, longDay, sectionLabel } from './format';
import { useOfferChoices } from './hooks';

function Stars({ n }: { n?: number }) {
  if (!n) return null;
  return <span aria-label={`${n} of 5`} style={{ color: 'var(--p-yellow-ink)', fontSize: 12, marginLeft: 6 }}>{'★'.repeat(n)}{'☆'.repeat(Math.max(0, 5 - n))}</span>;
}

/** One block per probation month: goals, both check-ins, the review. */
export function ProbationMonths({ months, total }: { months: ProbationMonthDTO[]; total: number }) {
  if (!months.length) return <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>The first month opens on the joining day. Goals, check-ins and reviews show here as the manager and the joiner fill them in.</div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {months.slice().sort((a, b) => a.monthNo - b.monthNo).map((m) => (
        <div key={m.id} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 13.5, fontWeight: 600 }}>Month {m.monthNo}{m.monthNo === total ? ' · final month' : ''}</b>
            {m.lockedAt && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>Goals locked {longDay(m.lockedAt)}</span>}
          </div>
          <div>
            <div style={sectionLabel}>Goals</div>
            {m.goals.length ? <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>{m.goals.map((g, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{g.text}</li>)}</ul>
              : <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Not set yet</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={sectionLabel}>Joiner’s check-in</div>
              <div style={{ fontSize: 13, color: m.checkinEmployee ? 'var(--ink)' : 'var(--ink-3)', overflowWrap: 'anywhere' }}>{m.checkinEmployee ? <>{m.checkinEmployee.text}<Stars n={m.checkinEmployee.rating} /></> : 'Not yet'}</div>
            </div>
            <div>
              <div style={sectionLabel}>Manager’s check-in</div>
              <div style={{ fontSize: 13, color: m.checkinManager ? 'var(--ink)' : 'var(--ink-3)', overflowWrap: 'anywhere' }}>{m.checkinManager ? <>{m.checkinManager.text}<Stars n={m.checkinManager.rating} /></> : 'Not yet'}</div>
            </div>
          </div>
          {m.review && (
            <div>
              <div style={sectionLabel}>Review</div>
              <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{m.review.text}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** The confirmation discussion's outcome, recorded by HR in the final month. */
export function DecisionDialog({ journey, onClose, onDone }: { journey: JourneyView; onClose: () => void; onDone: (d: ConfirmationDecision) => void }) {
  const { user, emps, flash } = useStore();
  const pay = canSeePay(user);
  const choices = useOfferChoices();
  const name = journey.candidate?.name ?? 'They';
  const [outcome, setOutcome] = useState<ConfirmationDecision['outcome']>('confirm');
  const [extendMonths, setExtendMonths] = useState(2);
  const [salary, setSalary] = useState('');
  const [kpi, setKpi] = useState('');
  const [designation, setDesignation] = useState(journey.designation ?? '');
  const [reporting, setReporting] = useState(journey.managerUserId ?? '');
  const [kpis, setKpis] = useState<KpiTemplateDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { listKpiTemplates().then(setKpis).catch(() => setKpis([])); }, []);
  const people = useMemo(() => emps.filter((e) => !e.exit?.left && e.id !== journey.userId).sort((a, b) => a.name.localeCompare(b.name)), [emps, journey.userId]);

  const go = async () => {
    const n = Number(salary.replace(/[^\d.]/g, ''));
    if (pay && salary && !(n > 0)) { setError('Enter the yearly CTC in rupees, or leave it empty'); return; }
    setBusy(true); setError('');
    try {
      const d = await recordDecision(journey.id, {
        outcome,
        extendMonths: outcome === 'extend' ? extendMonths : undefined,
        salary: outcome === 'confirm' && pay && n > 0 ? n : undefined,
        kpiTemplateId: outcome === 'confirm' && kpi ? kpi : undefined,
        designation: outcome === 'confirm' && designation.trim() && designation.trim() !== journey.designation ? designation.trim() : undefined,
        reportingToUserId: outcome === 'confirm' && reporting && reporting !== journey.managerUserId ? reporting : undefined,
      });
      flash(outcome === 'confirm' ? `${firstName(name)} is confirmed. Make the confirmation letter next` : outcome === 'extend' ? `Probation extended by ${extendMonths} month${extendMonths === 1 ? '' : 's'}` : 'Decision recorded');
      onDone(d);
    } catch (e) { setError(errText(e, 'Could not record the decision')); setBusy(false); }
  };

  const OPTIONS: [ConfirmationDecision['outcome'], string, string][] = [
    ['confirm', 'Confirm', 'They complete probation. Salary, KPIs, designation and reporting can change from here.'],
    ['extend', 'Extend probation', 'Another review cycle starts for the months you pick, with monthly goals and check-ins.'],
    ['not_confirm', 'Do not confirm', 'Probation ends without confirmation. Record the exit from their profile.'],
  ];
  return (
    <Modal title={`Confirmation decision · ${name}`} sub="From the confirmation discussion with their manager" onClose={onClose} busy={busy} width={600}
      footer={<><button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="pd-btn primary" onClick={() => void go()} disabled={busy}>{busy ? 'Saving…' : 'Record decision'}</button></>}>
      <div role="radiogroup" aria-label="Decision" style={{ display: 'grid', gap: 8 }}>
        {OPTIONS.map(([k, title, body]) => {
          const on = outcome === k;
          return (
            <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setOutcome(k)}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 16, border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--accent-soft)' : 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3 }}>{body}</div>
            </button>
          );
        })}
      </div>
      {outcome === 'extend' && (
        <Field label="Extend by">
          <Pick value={String(extendMonths)} onChange={(v) => setExtendMonths(Number(v))}>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} month{n === 1 ? '' : 's'}</option>)}
          </Pick>
        </Field>
      )}
      {outcome === 'confirm' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {pay && (
            <Field label="Yearly CTC after confirmation (₹)" hint="Optional. HR only; never shown to the manager.">
              <input inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="Unchanged" style={inputStyle} />
            </Field>
          )}
          <Field label="KPI template" hint="Optional">
            <Pick value={kpi} onChange={setKpi}>
              <option value="">Unchanged</option>
              {kpis.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Pick>
          </Field>
          <Field label="Designation">
            <input value={designation} onChange={(e) => setDesignation(e.target.value)} list="lf-decision-designations" style={inputStyle} />
            <datalist id="lf-decision-designations">{choices.designations.map((d) => <option key={d} value={d} />)}</datalist>
          </Field>
          <Field label="Reports to">
            <Pick value={reporting} onChange={setReporting}>
              <option value="">Unchanged</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Pick>
          </Field>
        </div>
      )}
      {error && <div role="alert" style={{ color: 'var(--bad)' }}>{error}</div>}
    </Modal>
  );
}
