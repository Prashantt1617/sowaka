// The pre-boarding profile's other tabs, as the Employee profile has them (Calendar and Requests
// mean nothing before joining): Performance, Salary details, Org chart, Activity and Exit, each
// filled from what the onboarding board already knows about the candidate (GET …/journeys/:id,
// the joiner panel's own call) and their pre-boarding profile. Drawn with the Employee profile's
// section cards, rows and org-chart nodes; Activity is the joiner panel's own Journey.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../store';
import { LoadError, Pill, SkeletonLines } from '../../ui';
import { getSalaryBreakup, offerStatusAction } from '../../../services/lifecycle';
import type { JourneyDetail, PreboardingProfile, SalaryBreakup, TaskView } from '../../../services/lifecycle';
import { Connector, GhostNode, Grid, OrgNode, Row, Section } from '../profileParts';
import { showDate } from '../profileWords';
import { PdChart, PdClose, PdStar, PdTarget, PdWallet } from '../pdIcons';
import { CloseOfferBox, NoteDialog } from './shared';
import { closeActionOf, dayOf, errText, longDay, OWNER_LABEL, rupees, shortDay } from './format';
import { JourneySteps } from './JourneySteps';
import { candidateStatus } from './preboardingLinks';
import '../people.css';

/** The journey detail as the page holds it: loading, loaded, failed, or not this viewer's to read (no onboarding tab). */
export type JourneyLoad = { state: 'loading' } | { state: 'ready'; data: JourneyDetail } | { state: 'error'; text: string; retry: () => void } | { state: 'none' };

const muted = { fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, padding: '6px 0' } as const;
const NO_BOARD = 'This comes from the onboarding board, which your access does not open.';

/** What a tab shows while the journey loads, when it failed, or when this viewer cannot read it. */
function JourneyPending({ load }: { load: Exclude<JourneyLoad, { state: 'ready' }> }) {
  if (load.state === 'loading') return <SkeletonLines lines={4} />;
  if (load.state === 'error') return <LoadError compact text={load.text} onRetry={load.retry} />;
  return <div style={muted}>{NO_BOARD}</div>;
}

// —— Performance ————————————————————————————————————————————————————————

/** The review card's empty state, and the plan for the first months when their template has one (probation tasks by month, goals HR set). */
export function PerformanceTab({ load }: { load: JourneyLoad }) {
  const d = load.state === 'ready' ? load.data : null;
  const months = new Map<number, { goals: string[]; tasks: TaskView[] }>();
  const at = (n: number) => { if (!months.has(n)) months.set(n, { goals: [], tasks: [] }); return months.get(n)!; };
  for (const m of d?.probation.months ?? []) for (const g of m.goals) if (g.text.trim()) at(m.monthNo).goals.push(g.text.trim());
  for (const t of d?.tasks ?? []) if (t.phase === 'probation' && t.status !== 'cancelled' && t.month) at(t.month).tasks.push(t);
  const plan = [...months.entries()].sort(([a], [b]) => a - b);
  const probation = d ? (d.journey.probation?.months ?? d.offer?.fields.probationMonths) : undefined;
  return (
    <div className="pd-psecs">
      <div className="pd-psecs">
        <Section title="Performance (PMS)" icon={<PdStar />}>
          <div style={muted}>KPIs and reviews start after they join.</div>
        </Section>
        <Section title="Review history" icon={<PdChart />}>
          <div style={muted}>No earlier reviews yet.</div>
        </Section>
      </div>
      <div className="pd-psecs">
        <Section title="KPIs" icon={<PdTarget />}>
          {load.state !== 'ready' && load.state !== 'none' ? <JourneyPending load={load} /> : plan.length === 0 ? (
            <div style={muted}>KPIs and reviews start after they join.{probation ? ` Probation is ${probation} month${probation === 1 ? '' : 's'}.` : ''}</div>
          ) : (
            <div style={{ display: 'grid', gap: 14, paddingTop: 6 }}>
              <div className="pd-subnote">The plan for their first months, from their onboarding template{probation ? ` · probation of ${probation} month${probation === 1 ? '' : 's'}` : ''}. KPIs are set once they join.</div>
              {plan.map(([n, m]) => (
                <div key={n} style={{ display: 'grid', gap: 6 }}>
                  <span className="pd-eyebrow" style={{ color: 'var(--ink-3)' }}>Month {n}</span>
                  {m.goals.map((g, i) => (
                    <div key={`g${i}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 14 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{g}</span>
                      <span className="pd-subnote">Goal</span>
                    </div>
                  ))}
                  {m.tasks.map((t) => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 14 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{t.title}</span>
                      <span className="pd-subnote">{t.ownerName ? `${OWNER_LABEL[t.ownerRole] ?? t.ownerRole} · ${t.ownerName}` : OWNER_LABEL[t.ownerRole] ?? t.ownerRole}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

// —— Salary details —————————————————————————————————————————————————————

const TYPE_WORD: Record<string, string> = { full_time: 'Full-time', intern: 'Intern', contract: 'Contract' };
const OFFER_STATUS: Record<string, string> = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', replaced: 'Replaced', declined: 'Declined', expired: 'Expired', withdrawn: 'Withdrawn' };
const GROUP_WORD: Record<string, string> = { earning: 'Earnings', reimbursement: 'Reimbursements', benefit: 'Benefits', employer: 'Employer contributions' };

/**
 * The offer's pay as HR set it, read-only, and its split by a salary template (the offer letter's annexure).
 * `children` follow it (the page's Bank account and PF card), whatever the offer's state.
 */
export function SalaryTab({ load, journeyId, seesPay, children }: { load: JourneyLoad; journeyId: string; seesPay: boolean; children?: ReactNode }) {
  const offer = load.state === 'ready' ? load.data.offer : null;
  const ctc = offer?.fields.ctc;
  const [breakup, setBreakup] = useState<SalaryBreakup | 'loading' | 'error' | null>(null);
  useEffect(() => {
    if (!seesPay || !ctc) { setBreakup(null); return undefined; }
    let live = true;
    setBreakup('loading');
    getSalaryBreakup(journeyId).then((b) => { if (live) setBreakup(b); }, () => { if (live) setBreakup('error'); });
    return () => { live = false; };
  }, [journeyId, ctc, seesPay]);

  const note = <div className="pd-note" style={{ marginBottom: 10 }}>Payroll starts after they join. This is the offer as HR set it; their salary structure is made on joining.</div>;
  if (load.state !== 'ready') return <div className="pd-psecs"><Section title="Offered pay" icon={<PdWallet />}>{note}<JourneyPending load={load} /></Section>{children}</div>;
  if (!offer) return <div className="pd-psecs"><Section title="Offered pay" icon={<PdWallet />}>{note}<div style={muted}>No offer yet.</div></Section>{children}</div>;
  const f = offer.fields;
  const pay = (n: number | undefined) => (!seesPay ? 'Hidden · needs payroll access' : n ? rupees(n) : '—');
  const sentAt = offer.sentAt ?? [...offer.versions].reverse().find((v) => v.sentAt)?.sentAt;
  const acceptedAt = offer.acceptedAt ?? [...offer.versions].reverse().find((v) => v.acceptedAt)?.acceptedAt;
  const b = breakup && typeof breakup === 'object' ? breakup : null;
  return (
    <div className="pd-psecs">
      <Section title="Offered pay" icon={<PdWallet />}>
        {note}
        <Grid>
          <Row label="Annual CTC" value={pay(ctc)} strong />
          <Row label="Monthly CTC" value={pay(ctc ? ctc / 12 : undefined)} />
          <Row label="Employee type" value={f.employeeType ? TYPE_WORD[f.employeeType] ?? f.employeeType : '—'} />
          <Row label="Date of joining" value={f.tj ? showDate(f.tj) : '—'} />
          <Row label="Probation" value={f.probationMonths ? `${f.probationMonths} month${f.probationMonths === 1 ? '' : 's'}` : '—'} />
          <Row label="Notice period" value={f.noticeDays ? `${f.noticeDays} days` : '—'} />
          <Row label="Offer" value={`Version ${offer.version} · ${OFFER_STATUS[String(offer.status)] ?? String(offer.status)}`} />
          <Row label="Reference" value={offer.refNo || '—'} />
          <Row label="Sent on" value={sentAt ? longDay(sentAt) : '—'} />
          <Row label="Accepted on" value={acceptedAt ? longDay(acceptedAt) : '—'} />
        </Grid>
      </Section>
      {seesPay && ctc ? (
        <Section title="Salary breakup" icon={<PdWallet />}>
          {breakup === 'loading' ? <SkeletonLines lines={4} />
            : breakup === 'error' ? <div style={muted}>The breakup could not be worked out.</div>
            : !b?.breakup ? <div style={muted}>{b?.reason ?? 'No breakup yet.'}</div>
            : (
              <>
                <div className="pd-subnote" style={{ marginBottom: 8 }}>Worked out with the {b.breakup.templateName} salary template, as the offer letter’s annexure shows it. Gross {rupees(b.breakup.grossMonthly)} a month.</div>
                <div className="pd-tbl-wrap">
                  <table className="pd-t">
                    <thead><tr><th style={{ textAlign: 'left' }}>Component</th><th style={{ textAlign: 'left' }}>Type</th><th style={{ textAlign: 'right' }}>Monthly</th><th style={{ textAlign: 'right' }}>Annual</th></tr></thead>
                    <tbody>
                      {b.breakup.lines.map((l, i) => (
                        <tr key={`${l.name}-${i}`}>
                          <td>{l.name}</td>
                          <td style={{ color: 'var(--ink-3)' }}>{GROUP_WORD[l.group] ?? l.group}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupees(l.monthly)}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupees(l.annual)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td><b>Total CTC</b></td><td />
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b>{rupees(b.breakup.ctcMonthly)}</b></td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b>{rupees(b.breakup.ctcAnnual)}</b></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}
        </Section>
      ) : null}
      {children}
    </div>
  );
}

// —— Org chart ——————————————————————————————————————————————————————————

/** Their place once they join: the reporting manager above them, from Basic details (the offer's manager). */
export function OrgChartTab({ profile, load }: { profile: PreboardingProfile; load: JourneyLoad }) {
  const s = useStore();
  const journey = load.state === 'ready' ? load.data.journey : null;
  const offer = load.state === 'ready' ? load.data.offer : null;
  const managerId = profile.basic?.reportingManager?.userId ?? journey?.managerUserId ?? offer?.fields.managerUserId;
  const managerName = profile.basic?.reportingManager?.name ?? journey?.managerName ?? offer?.fields.managerName ?? '';
  const manager = managerId ? s.emps.find((e) => e.id === managerId) : undefined;
  const team = manager ? s.emps.filter((e) => e.managerId === manager.id).length : 0;
  const department = profile.basic?.department ?? profile.candidate.department;
  const designation = profile.basic?.designation ?? profile.candidate.designation;
  const tj = profile.basic?.tj ?? profile.candidate.tj;
  const me = { name: profile.candidate.name, role: designation || 'Role not set' };
  return (
    <div>
      <section className="pd-card">
        <div className="pd-card-h" style={{ marginBottom: 20 }}>
          <div>
            <h3>Org chart</h3>
            <small>
              Reporting line once they join{department ? ` · ${department}` : ''}{manager ? ` · joins a team of ${team} under ${manager.name}` : ''}
            </small>
          </div>
          {manager && (
            <button type="button" onClick={() => { s.setOrgChartFocus(manager.id); s.setView('orgchart'); }} className="pd-sec-act" style={{ color: 'var(--accent-ink)', fontSize: 13 }}>
              Open in org chart ↗
            </button>
          )}
        </div>
        <div style={{ padding: '0 0 6px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {manager ? <OrgNode emp={manager} caption="Reporting manager" onOpen={(e) => s.openProfile(e.id)} />
            : managerName ? <GhostNode name={managerName} caption="Reporting manager" /> : null}
          {managerName && <Connector />}
          <OrgNode emp={me} caption={tj ? `Joining ${shortDay(tj)}` : 'Pre-boarding'} highlight />
          {!managerName && <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400, marginTop: 14 }}>{load.state === 'loading' ? 'Loading their reporting line…' : 'No reporting manager on the offer yet'}</div>}
        </div>
      </section>
    </div>
  );
}

// —— Activity ———————————————————————————————————————————————————————————

/**
 * The joiner panel's Journey, exactly as the panel draws it (the same eight steps, rows and contents: the
 * candidate's own tasks only), without the link to this profile page.
 */
export function ActivityTab({ load, onChanged }: { load: JourneyLoad; onChanged: () => void }) {
  const [busy, setBusy] = useState('');
  return (
    <div className="pd-psecs">
      <section className="pd-card" style={{ padding: 20 }}>
        {load.state === 'ready'
          ? <JourneySteps data={load.data} busy={busy} setBusy={setBusy} onChanged={onChanged} variant="profile" />
          : <JourneyPending load={load} />}
      </section>
    </div>
  );
}

// —— Exit: not joining ——————————————————————————————————————————————————

const CLOSED = new Set(['declined', 'expired', 'not_joining']);

/** Before joining, an exit is "Not joining": the joiner panel's own close (declined / not joining) and Reopen. */
export function NotJoiningTab({ profile, load, first, onChanged }: { profile: PreboardingProfile; load: JourneyLoad; first: string; onChanged: () => void }) {
  const { flash } = useStore();
  const [asking, setAsking] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [busy, setBusy] = useState(false);
  const journey = load.state === 'ready' ? load.data.journey : null;
  useEffect(() => { setAsking(false); }, [profile.journeyId]);
  if (load.state !== 'ready') return <div className="pd-psecs"><Section title="Not joining" icon={<PdClose />}><JourneyPending load={load} /></Section></div>;
  const status = String(journey!.status);
  const action = closeActionOf(status);
  const confirm = async (note?: string) => {
    if (!action) return false;
    setBusy(true);
    try {
      await offerStatusAction(profile.journeyId, action, note);
      flash(action === 'decline' ? `${first}’s offer is closed as declined` : `${first} is marked not joining`);
      setAsking(false);
      onChanged();
      return true;
    } catch (e) {
      flash(errText(e), 'error');
      return false;
    } finally { setBusy(false); }
  };
  return (
    <div className="pd-psecs">
      <Section title="Not joining" icon={<PdClose />} action={<Pill label={candidateStatus(status)} tone={CLOSED.has(status) ? { bg: 'var(--bad-bg)', fg: 'var(--bad)' } : { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' }} fontSize={11} padding="2px 9px" />}>
        {CLOSED.has(status) ? (
          <>
            <Grid>
              <Row label="Status" value={candidateStatus(status)} strong />
              <Row label="Closed on" value={journey!.closedAt ? showDate(dayOf(journey!.closedAt)) : '—'} />
              <Row label="What they said" value={journey!.closedReason || '—'} />
            </Grid>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="pd-btn" onClick={() => setReopening(true)}>Reopen</button>
            </div>
          </>
        ) : action ? (
          asking
            ? <CloseOfferBox first={first} action={action} busy={busy} onKeep={() => setAsking(false)} onConfirm={confirm} />
            : (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={muted}>
                  {action === 'decline'
                    ? `${first} has not replied to the offer yet. If they said no, close the offer here.`
                    : `${first} accepted the offer. If they will not join after all, close their onboarding here; Reopen brings it back.`}
                </div>
                <div><button type="button" className="pd-btn" style={{ color: 'var(--bad)' }} onClick={() => setAsking(true)}>{action === 'decline' ? 'Mark declined' : 'Not joining'}</button></div>
              </div>
            )
        ) : (
          <div style={muted}>{status === 'draft' ? 'The offer has not been sent yet, so there is nothing to close.' : `${first} has joined. An exit is recorded on their employee profile.`}</div>
        )}
      </Section>
      {reopening && (
        <NoteDialog title={`Reopen ${first}’s journey`} sub="The offer opens again where it was. Revise it if the terms change."
          placeholder="Why it is reopened (optional)" confirm="Reopen" tone="primary"
          onClose={() => setReopening(false)}
          onConfirm={async (note) => { await offerStatusAction(profile.journeyId, 'reopen', note || undefined); setReopening(false); flash('Saved'); onChanged(); }} />
      )}
    </div>
  );
}
