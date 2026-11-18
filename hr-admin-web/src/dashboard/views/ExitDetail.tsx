// People › Exits › a person: their exit from start to settled, on one page.
// The summary, who their team reports to next, the clearance list HR ticks,
// the exit interview, and the final settlement: every line with how it was
// worked out, a line HR can change with a reason, then approve and mark paid.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Avatar, LoadError, Pill, SkeletonForm, Th } from '../ui';
import { TH, TR, cellName, cellSub, note as noteBox } from '../ds';
import { IconDownload } from '../icons';
import { inr } from '../../services/payroll';
import { closeExitCase, getExitDetail, saveExitInterview, setExitClearance, settlementAction } from '../../services/hrms';
import type { ExitDetailDTO, ExitDTO, ExitInterview, ExitInterviewReason, SettlementDTO, SettlementLine } from '../../services/hrms';
import { downloadSettlementPdf } from '../settlementDoc';
import { longDay } from './ExitDialog';
import { useAuth } from '../auth/AuthContext';
import { canOpen, SALARY_DETAILS } from '../access';
import './people.css';

const STAGE = {
  notice: { label: 'On notice', tone: { bg: 'var(--warn-bg)', fg: 'var(--warn)' } },
  settlement_due: { label: 'Settlement due', tone: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' } },
  left: { label: 'Left · settled', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
} as const;
const STATUS = {
  draft: { label: 'Draft', tone: { bg: 'var(--warn-bg)', fg: 'var(--warn)' } },
  approved: { label: 'Approved', tone: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' } },
  paid: { label: 'Paid', tone: { bg: 'var(--ok-bg)', fg: 'var(--ok)' } },
} as const;
const REASONS: [ExitInterviewReason, string][] = [['pay', 'Pay'], ['growth', 'Growth'], ['manager', 'Manager'], ['work_life', 'Work-life balance'], ['relocation', 'Relocation'], ['studies', 'Studies'], ['the_work', 'The work itself'], ['personal', 'Personal'], ['other', 'Other']];
const COME_BACK: [NonNullable<ExitInterview['comeBack']>, string][] = [['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']];

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const dayOf = (iso: string) => longDay(iso.slice(0, 10));
const dayAfter = (key: string) => new Date(Date.parse(`${key}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** `embedded`: on the profile's Exit tab, under the profile's own header (no back bar, no summary card). */
export function ExitDetail({ userId, onBack, embedded }: { userId: string; onBack?: () => void; embedded?: boolean }) {
  const s = useStore();
  const [data, setData] = useState<ExitDetailDTO | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    getExitDetail(userId).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load this exit'); });
    return () => { live = false; };
  }, [userId, attempt]);

  /** Run a change, show what the server now has, and say so. */
  const run = async (what: string, work: () => Promise<ExitDetailDTO>, done?: string) => {
    setBusy(what);
    try {
      setData(await work());
      if (done) s.flash(done);
      return true;
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not save', 'error');
      return false;
    } finally {
      setBusy('');
    }
  };

  const top = embedded ? null : (
    <div className="pd-prof-top">
      <button onClick={() => onBack?.()} className="pd-btn ghost sm" style={{ marginLeft: -12 }}>← Back to exits</button>
      <button type="button" onClick={() => s.openProfile(userId, 'exit')} className="pd-btn sm">Open profile</button>
    </div>
  );
  if (error) return <div>{top}<section className="pd-card"><LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} /></section></div>;
  if (!data) return <div>{top}<section className="pd-card"><SkeletonForm fields={8} /></section></div>;

  const { exit, settlement } = data;
  const name = firstName(exit.name);
  const stage = exit.caseOpen ? { label: 'Case open', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } } : STAGE[exit.stage];
  const given = exit.noticeFrom ? daysBetween(exit.noticeFrom, exit.lastWorkingDay) : null;
  const short = exit.noticeDays != null && given != null ? Math.max(0, exit.noticeDays - given) : null;
  // What the notice came to, in the words that fit how they left.
  const noticeText = exit.noticeDays == null ? '—'
    : exit.kind === 'terminated' ? `${exit.noticeDays} days${exit.rules.noticePay === 'none' ? '' : ', paid instead of worked'}`
    : exit.kind === 'absconded' ? `${exit.noticeDays} days, not served`
    : given == null ? `${exit.noticeDays} days`
    : short ? `${given} of ${exit.noticeDays} days, ${short} short` : `${exit.noticeDays} days, all given`;
  const done = exit.clearance.filter((c) => c.done).length;

  return (
    <div style={embedded ? undefined : { animation: 'fade .3s ease both' }}>
      {top}

      {!embedded && <section className="pd-card pd-phead">
        <div className="ph-id">
          <Avatar name={exit.name} size={52} font={21} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pn">
              <h1>{exit.name}</h1>
              <Pill label={stage.label} tone={stage.tone} />
            </div>
            <span className="sub">{[exit.designation, exit.department, exit.employeeId].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div className="pd-facts">
          <Fact label="Why they are leaving" value={exit.kindLabel} />
          <Fact label={exit.kind === 'absconded' ? 'Last seen' : exit.kind === 'terminated' ? 'Told on' : 'Told HR on'} value={exit.noticeFrom ? longDay(exit.noticeFrom) : '—'} />
          <Fact label="Last day at work" value={longDay(exit.lastWorkingDay)} />
          <Fact label="Notice" value={noticeText} />
          <Fact label="App" value={exit.accessEndedAt ? `Off since ${dayOf(exit.accessEndedAt)}` : `Turns off ${longDay(dayAfter(exit.lastWorkingDay))}`} />
          <Fact label="Salary" value={exit.rules.holdPay ? 'Held for the final settlement' : 'Paid with each monthly run'} />
        </div>
        {exit.note && <div style={{ marginTop: 14, fontSize: 13, color: 'var(--ink-2)' }}><span style={{ color: 'var(--ink-3)' }}>Note · </span>{exit.note}</div>}
      </section>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, marginBottom: 20 }}>
        <section className="pd-card">
          <div className="pd-card-h"><h3>Clearance</h3><small>{done} of {exit.clearance.length} done</small></div>
          <div style={{ display: 'grid' }}>
            {exit.clearance.map((c, i) => (
              <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: i ? '1px solid var(--line)' : 'none', cursor: busy ? 'default' : 'pointer' }}>
                <input type="checkbox" id={`clear-${c.key}`} checked={c.done} disabled={!!busy || settlement?.status === 'paid'} onChange={(e) => void run(`clear-${c.key}`, () => setExitClearance(userId, c.key, e.target.checked))}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, color: 'var(--ink)' }}>{c.label}</span>
                  {c.done && c.doneAt && <span style={{ ...cellSub, display: 'block', marginTop: 2 }}>{[c.doneByName, dayOf(c.doneAt)].filter(Boolean).join(' · ')}</span>}
                </span>
              </label>
            ))}
          </div>
          <div style={{ ...cellSub, marginTop: 10 }}>The settlement can be approved once everything is ticked, or with a reason if not.</div>
        </section>

        <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
          {exit.team && (
            <section className="pd-card">
              <div className="pd-card-h"><h3>Their team</h3><small>{exit.team.movedAt ? 'Moved' : 'Moves the day after'}</small></div>
              <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5 }}>
                {exit.team.movedAt
                  ? <>Reports to <strong style={{ fontWeight: 600 }}>{exit.team.newManagerName || 'the new manager'}</strong> since {dayOf(exit.team.movedAt)}.</>
                  : <>{exit.team.size} {exit.team.size === 1 ? 'person reports' : 'people report'} to {name} until {longDay(exit.lastWorkingDay)}, then to <strong style={{ fontWeight: 600 }}>{exit.team.newManagerName || 'the new manager'}</strong> from {longDay(dayAfter(exit.lastWorkingDay))}.</>}
              </div>
              {!exit.team.movedAt && <div style={{ ...cellSub, marginTop: 6 }}>{exit.team.toldAt ? `The team and ${firstName(exit.team.newManagerName || 'the new manager')} were told on ${dayOf(exit.team.toldAt)}.` : 'The team and the new manager are told a few days before (Exit settings).'}</div>}
            </section>
          )}
          <InterviewCard exit={exit} busy={busy === 'interview'} onSave={(body) => run('interview', () => saveExitInterview(userId, body), 'Exit interview saved')} />
        </div>
      </div>

      <section className="pd-card">
        <div className="pd-card-h">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <h3>Final settlement</h3>
            {settlement && <Pill label={STATUS[settlement.status].label} tone={STATUS[settlement.status].tone} />}
          </span>
          {settlement && !settlement.notSetUp && (
            <button type="button" id="settle-download" onClick={() => void downloadSettlementPdf(exit, settlement, data.company).catch((e) => s.flash(e instanceof Error ? e.message : 'Could not make the PDF', 'error'))} className="pd-btn sm">
              <IconDownload stroke="currentColor" /> Statement and letter
            </button>
          )}
        </div>
        {!settlement && exit.stage === 'notice' && (
          <div style={noteBox}>
            The settlement starts on its own on {longDay(dayAfter(exit.lastWorkingDay))}, the day after {name}’s last day. It adds up every held month, unused leave, gratuity and the notice lines, less PF and the year’s remaining tax.
          </div>
        )}
        {!settlement && exit.caseOpen && (
          <div style={{ ...noteBox, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 240 }}>{name} stopped coming, so nothing is settled until you close the case (letters sent, no reply by the date you gave). Closing it starts the settlement.</span>
            <button type="button" id="settle-close-case" disabled={!!busy} onClick={() => void run('case', () => closeExitCase(userId), 'Case closed. The settlement has started.')} className="pd-btn primary">{busy === 'case' ? 'Closing…' : 'Close the case'}</button>
          </div>
        )}
        {settlement && <Statement exit={exit} settlement={settlement} busy={busy} run={run} userId={userId} />}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div className="pd-fact"><span className="pd-eyebrow">{label}</span><b>{value}</b></div>;
}

// ———————————————————————————————————————————————— the statement

// The Amount column keeps room for a crore figure (each row is its own grid, so a fixed floor keeps them aligned).
// No space inside minmax(): fitCols (ds.ts) wraps every bare "Nfr" that follows a space.
const COLS_PLAIN = '1.4fr 2.2fr minmax(112px,0.9fr) 96px';
/** With a "From" column (the lifecycle's settlement page: Payroll, Leave, Rule, Offboarding, HR). */
const COLS_FROM = '1.3fr 1.9fr 0.8fr minmax(112px,0.9fr) 96px';
export type Run = (what: string, work: () => Promise<ExitDetailDTO>, done?: string) => Promise<boolean>;

/**
 * The statement's lines, totals and HR's actions. `sourceOf` adds a From column; `extra` sits
 * under the lines (the lifecycle page's Add a line). People › Exits passes neither.
 */
export function Statement({ exit, settlement, busy, run, userId, sourceOf, extra }: { exit: ExitDTO; settlement: SettlementDTO; busy: string; run: Run; userId: string; sourceOf?: (line: SettlementLine) => string; extra?: ReactNode }) {
  // No salary structure: nothing is worked out (no ₹0 lines, no total) and nothing can be approved.
  if (settlement.notSetUp) return <SettlementNotSetUp userId={userId} name={exit.name} message={settlement.notSetUp} />;
  return <StatementLines exit={exit} settlement={settlement} busy={busy} run={run} userId={userId} sourceOf={sourceOf} extra={extra} />;
}

/**
 * The settlement when payroll has nothing to work it out from (the server's `notSetUp`): what is
 * missing and where to set it up. The figures come from Payroll only, so nothing is filled in here.
 */
export function SettlementNotSetUp({ userId, name, message }: { userId: string; name: string; message: string }) {
  const s = useStore();
  const { user } = useAuth();
  const canSetUp = canOpen(user, SALARY_DETAILS);
  return (
    <div id="settle-not-set-up" role="status" style={{ ...noteBox, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ flex: 1, minWidth: 240 }}>
        <b style={{ display: 'block', color: 'var(--ink)', fontWeight: 600, marginBottom: 2 }}>Not set up</b>
        {message} {canSetUp ? `It is on ${firstName(name)}’s profile, under Salary.` : 'Someone with Payroll access sets it up on their profile, under Salary.'} The settlement is worked out again once it is there.
      </span>
      {canSetUp && <button type="button" id="settle-set-up" className="pd-btn primary" onClick={() => s.openProfile(userId, 'salary')}>Set up salary details</button>}
    </div>
  );
}

function StatementLines({ exit, settlement, busy, run, userId, sourceOf, extra }: { exit: ExitDTO; settlement: SettlementDTO; busy: string; run: Run; userId: string; sourceOf?: (line: SettlementLine) => string; extra?: ReactNode }) {
  const COLS = sourceOf ? COLS_FROM : COLS_PLAIN;
  const [editing, setEditing] = useState('');
  const [reason, setReason] = useState('');
  const draft = settlement.status === 'draft';
  const earnings = settlement.lines.filter((l) => l.side === 'earning');
  const deductions = settlement.lines.filter((l) => l.side === 'deduction');
  const pay = settlement.payablePaise >= 0;
  const name = firstName(exit.name);
  const open = exit.clearance.filter((c) => !c.done);
  const tax = settlement.tax;

  const group = (title: string, lines: SettlementLine[], total: number) => (
    <>
      <div style={{ ...eyebrowRow }}>{title}</div>
      {lines.length === 0 && <div style={{ ...TR(COLS), color: 'var(--ink-3)' }}>Nothing here.</div>}
      {lines.map((l) => (
        <LineRow key={l.key} line={l} cols={COLS} source={sourceOf?.(l)} draft={draft} busy={!!busy} editing={editing === l.key} onEdit={() => setEditing(editing === l.key ? '' : l.key)}
          onSave={async (amountPaise, why) => { if (await run(`line-${l.key}`, () => settlementAction(userId, 'line', { key: l.key, amountPaise, reason: why }), amountPaise == null ? 'Line put back' : 'Line changed')) setEditing(''); }} />
      ))}
      <div style={{ ...TR(COLS), fontWeight: 600, background: 'var(--surface-2)', borderRadius: 10, borderBottom: 'none', marginTop: 4 }}>
        <div>Total {title.toLowerCase()}</div><div />{sourceOf && <div />}<div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{inr(total)}</div><div />
      </div>
    </>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 620 }}>
          <div style={TH(COLS)}><Th>LINE</Th><Th>HOW IT IS WORKED OUT</Th>{sourceOf && <Th>FROM</Th>}<Th align="right">AMOUNT</Th><span /></div>
          {group('Earnings', earnings, settlement.earningsPaise)}
          {group('Deductions', deductions, settlement.deductionsPaise)}
        </div>
      </div>
      {extra}

      <div id="settle-total" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '14px 16px', borderRadius: 14, background: pay ? 'var(--ok-bg)' : 'var(--bad-bg)' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{pay ? `Pay ${name}` : `Recover from ${name}`}</div>
          <div style={{ ...cellSub, marginTop: 2 }}>{pay ? 'Earnings less deductions, in one transfer' : 'Deductions are more than the earnings'}</div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.02em', color: pay ? 'var(--ok)' : 'var(--bad)' }}>{inr(Math.abs(settlement.payablePaise))}</div>
      </div>

      {tax && (
        <div style={{ ...noteBox, display: 'block' }}>
          <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>How the tax was worked out · {tax.fy}{tax.regime ? ` · ${tax.regime} regime` : ''}</div>
          {tax.engine
            ? <>Salary already paid this year {inr(tax.paidTaxablePaise)} + taxed in this settlement {inr(tax.settlementTaxablePaise + tax.excessExemptPaise)} gives a taxable income of {inr(tax.taxableIncomePaise ?? 0)} after the standard deduction and anything declared. Tax for the year {inr(tax.annualTaxPaise ?? 0)}, less {inr(tax.alreadyDeductedPaise)} already taken, leaves <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{inr(tax.duePaise)}</strong>.{tax.refundViaReturnPaise ? ` ${inr(tax.refundViaReturnPaise)} was taken too much; it shows on their Form 16 and comes back in their tax return.` : ''} Leave encashment and gratuity are tax-free within the legal limits; a notice recovery does not lower taxable salary.</>
            : <>This company types each month’s tax by hand. Salary already paid this year {inr(tax.paidTaxablePaise)}, taxed in this settlement {inr(tax.settlementTaxablePaise + tax.excessExemptPaise)}, tax already taken {inr(tax.alreadyDeductedPaise)}. Set the Income tax line to what the year still needs (tax for the year on what they actually earned, less tax already taken, never below zero).</>}
        </div>
      )}

      {draft && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {open.length > 0 && (
            <input id="settle-override" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Clearance has ${open.length} open. To approve anyway, say why`} className="pd-inp" style={{ flex: 1, minWidth: 280 }} />
          )}
          <button type="button" id="settle-approve" disabled={!!busy || (open.length > 0 && !reason.trim())} onClick={() => void run('approve', () => settlementAction(userId, 'approve', open.length ? { clearanceOverrideReason: reason.trim() } : {}), 'Settlement approved')} className="pd-btn primary">
            {busy === 'approve' ? 'Approving…' : 'Approve settlement'}
          </button>
          {open.length === 0 && <span style={cellSub}>Approving freezes the lines. You can reopen it until it is paid.</span>}
        </div>
      )}
      {settlement.status === 'approved' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" id="settle-paid" disabled={!!busy} onClick={() => void run('paid', () => settlementAction(userId, 'paid'), 'Settlement marked as paid')} className="pd-btn primary">{busy === 'paid' ? 'Saving…' : 'Mark as paid'}</button>
          <button type="button" id="settle-reopen" disabled={!!busy} onClick={() => void run('reopen', () => settlementAction(userId, 'reopen'), 'Settlement reopened')} className="pd-btn">Reopen</button>
          <span style={cellSub}>Approved{settlement.approvedByName ? ` by ${settlement.approvedByName}` : ''}{settlement.approvedAt ? ` on ${dayOf(settlement.approvedAt)}` : ''}.{settlement.clearanceOverrideReason ? ` Clearance was open: ${settlement.clearanceOverrideReason}` : ''}</span>
        </div>
      )}
      {settlement.status === 'paid' && (
        <div style={cellSub}>Paid{settlement.paidAt ? ` on ${dayOf(settlement.paidAt)}` : ''}{settlement.paidByName ? ` · marked by ${settlement.paidByName}` : ''}. Approved{settlement.approvedByName ? ` by ${settlement.approvedByName}` : ''}.</div>
      )}
    </div>
  );
}

function LineRow({ line, cols, source, draft, busy, editing, onEdit, onSave }: { line: SettlementLine; cols: string; source?: string; draft: boolean; busy: boolean; editing: boolean; onEdit: () => void; onSave: (amountPaise: number | null, reason: string) => Promise<void> }) {
  const changed = line.changedReason !== undefined;
  // "HR decides" notice pay: worked out, and paid only once HR chooses to.
  const undecided = line.key === 'notice_pay' && !changed && line.amountPaise === 0 && line.computedPaise > 0;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (!editing) return;
    setAmount(String(Math.round((undecided ? line.computedPaise : line.amountPaise) / 100)));
    setReason(line.changedReason ?? (undecided ? 'HR chose to pay notice' : ''));
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const minus = line.side === 'deduction' ? '− ' : '';
  return (
    <>
      <div id={`line-${line.key}`} style={TR(cols, editing)}>
        <div style={{ ...cellName, fontSize: 13.5 }}>{line.label}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45, minWidth: 0 }}>
          {line.note}
          {changed && <div style={{ color: 'var(--warn)', marginTop: 2 }}>Changed{line.changedByName ? ` by ${line.changedByName}` : ''}: {line.changedReason}</div>}
        </div>
        {source !== undefined && <div><span style={{ display: 'inline-flex', fontSize: 11.5, padding: '2px 8px', borderRadius: 99, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{source}</span></div>}
        <div style={{ textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>
          {minus}{inr(line.amountPaise)}
          {changed && line.computedPaise !== line.amountPaise && <div style={{ ...cellSub, textDecoration: 'line-through' }}>{inr(line.computedPaise)}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          {draft && <button type="button" id={`edit-${line.key}`} disabled={busy} onClick={onEdit} className="pd-btn ghost sm" style={{ padding: '0 8px' }}>{editing ? 'Close' : undecided ? 'Pay it' : 'Change'}</button>}
        </div>
      </div>
      {editing && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', padding: '4px 12px 14px', borderBottom: '1px solid var(--line)' }}>
          <label className="pd-label" style={{ width: 150 }}>
            <span>Amount (₹)</span>
            <input id={`amount-${line.key}`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))} className="pd-inp" style={{ height: 38 }} />
          </label>
          <label className="pd-label" style={{ flex: 1, minWidth: 220 }}>
            <span>Why (shows on the statement)</span>
            <input id={`reason-${line.key}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Waived: released early by the manager" className="pd-inp" style={{ height: 38 }} />
          </label>
          <button type="button" id={`save-${line.key}`} disabled={busy || amount === '' || !reason.trim()} onClick={() => void onSave(Number(amount) * 100, reason.trim())} className="pd-btn primary" style={{ height: 38 }}>Save</button>
          {changed && <button type="button" disabled={busy} onClick={() => void onSave(null, '')} className="pd-btn" style={{ height: 38 }}>Put back {inr(line.computedPaise)}</button>}
        </div>
      )}
    </>
  );
}

const eyebrowRow: CSSProperties = { padding: '14px 12px 6px', fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--hi)' };

// ———————————————————————————————————————————————— the exit interview

function InterviewCard({ exit, busy, onSave }: { exit: ExitDTO; busy: boolean; onSave: (body: Partial<ExitInterview>) => Promise<boolean> }) {
  const iv = exit.interview;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<ExitInterview>>({});
  const start = () => { setForm(iv ? { reason: iv.reason, workRating: iv.workRating, managerRating: iv.managerRating, comeBack: iv.comeBack, change: iv.change } : {}); setEditing(true); };
  const label = (pairs: [string, string][], v?: string) => pairs.find(([k]) => k === v)?.[1] ?? '—';
  return (
    <section className="pd-card">
      <div className="pd-card-h">
        <h3>Exit interview</h3>
        {!editing && <button type="button" id="interview-edit" onClick={start} className="pd-btn ghost sm" style={{ padding: '0 8px' }}>{iv ? 'Change' : 'Fill in'}</button>}
      </div>
      {!editing && !iv && <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>Not filled in yet. {firstName(exit.name)} is asked in the app 5 days before the last day; you can also fill it in after a conversation. Only HR sees the answers.</div>}
      {!editing && iv && (
        <div style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
          <Answer q="Main reason" a={label(REASONS, iv.reason)} />
          <Answer q="Working here" a={iv.workRating ? `${iv.workRating} of 5` : '—'} />
          <Answer q="Their manager" a={iv.managerRating ? `${iv.managerRating} of 5` : '—'} />
          <Answer q="Would come back" a={label(COME_BACK, iv.comeBack)} />
          {iv.change && <Answer q="What to change" a={iv.change} />}
          <div style={{ ...cellSub, marginTop: 2 }}>{iv.filledBy === 'hr' ? `Filled in by ${iv.filledByName || 'HR'}` : 'Answered in the app'} · {dayOf(iv.filledAt)} · only HR sees this</div>
        </div>
      )}
      {editing && (
        <div style={{ display: 'grid', gap: 14 }}>
          <label className="pd-label">
            <span>Main reason for leaving</span>
            <span className="pd-pick">
              <select id="iv-reason" value={form.reason ?? ''} onChange={(e) => setForm({ ...form, reason: (e.target.value || undefined) as ExitInterviewReason | undefined })} className="pd-inp">
                <option value="">Pick one</option>
                {REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </span>
          </label>
          <Scale id="iv-work" label="How was working here?" value={form.workRating} onChange={(v) => setForm({ ...form, workRating: v })} />
          <Scale id="iv-manager" label="How was their manager?" value={form.managerRating} onChange={(v) => setForm({ ...form, managerRating: v })} />
          <div className="pd-label">
            <span>Would they come back?</span>
            <div style={{ display: 'flex', gap: 6 }}>{COME_BACK.map(([k, l]) => <button key={k} type="button" id={`iv-back-${k}`} aria-pressed={form.comeBack === k} onClick={() => setForm({ ...form, comeBack: form.comeBack === k ? undefined : k })} style={chip(form.comeBack === k)}>{l}</button>)}</div>
          </div>
          <label className="pd-label">
            <span>Anything we should change?</span>
            <textarea id="iv-change" rows={2} value={form.change ?? ''} onChange={(e) => setForm({ ...form, change: e.target.value })} className="pd-inp" style={{ minHeight: 60, resize: 'vertical' }} />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setEditing(false)} className="pd-btn">Cancel</button>
            <button type="button" id="iv-save" disabled={busy} onClick={() => void onSave(form).then((ok) => { if (ok) setEditing(false); })} className="pd-btn primary">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function Answer({ q, a }: { q: string; a: string }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12 }}><span style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{q}</span><span style={{ color: 'var(--ink)' }}>{a}</span></div>;
}
function Scale({ id, label, value, onChange }: { id: string; label: string; value?: number; onChange: (v: number | undefined) => void }) {
  return (
    <div className="pd-label">
      <span>{label}</span>
      <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={value === n} id={`${id}-${n}`} onClick={() => onChange(value === n ? undefined : n)} style={{ ...chip(value === n), width: 38, padding: 0 }}>{n}</button>)}
      </div>
    </div>
  );
}
const chip = (on: boolean): CSSProperties => ({
  height: 34, padding: '0 14px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
  border: `1px solid ${on ? 'var(--sel)' : 'var(--line-2)'}`, background: on ? 'var(--sel)' : 'var(--surface)', color: on ? 'var(--on-sel)' : 'var(--ink)',
});
