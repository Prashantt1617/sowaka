// Payroll › FBP splits: for a FY, everyone on a salary template with FBP
// heads and how they split their flexible pool: each head's amount now, what
// is not assigned (paid as the balancing component, taxed in full), when
// they declared or changed it, and per head how many months' bills are
// approved against the months the head paid. Read only: a row opens the
// employee's salary tab. A note on top says what FBP needs that is not set
// up (a head no bill type is linked to, a template with no pool, the app's
// split and bill rules), with links to where each is set.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { OPEN_TAB_KEY } from '../setupGroups';
import { ApiError } from '../../services/http';
import { listFbpSplits } from '../../services/payroll';
import type { FbpSplitRowDTO, FbpSplitsDTO } from '../../services/payroll';
import { useLoad } from '../useLoad';
import { Card, EmptyRow, ListPending, SearchInput, SelectBox, StatusTabs, SummaryCard, Th } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { cellName, cellSub, hint, TH, toolbar, TR } from '../ds';
import { dateLabel, fyOfDate, money, monthLabel, previousFy } from './FbpRequests';

const COLS = '1.6fr 0.9fr 2.6fr 0.9fr 1.2fr 1fr';
type Filter = 'all' | 'declared' | 'not_declared';

function nextFy(fy: string): string {
  const start = Number(fy.slice(0, 4)) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function FbpSplits() {
  const s = useStore();
  const thisFy = fyOfDate(new Date());
  const [fy, setFy] = useState(thisFy);
  const [filter, setFilter] = useState<Filter>('all');
  const [dept, setDept] = useState('all');
  const [search, setSearch] = useState('');

  const list = useLoad(() => listFbpSplits(fy), [fy]);
  useEffect(() => {
    if (list.state === 'error') s.flash(list.error instanceof ApiError ? list.error.message : 'Could not load the FBP splits', 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.state]);
  const all = useMemo(() => list.data?.rows ?? [], [list.data]);
  const ready = list.state === 'ready';
  const counts = useMemo(() => ({
    all: all.length,
    declared: all.filter((r) => r.declared).length,
    not_declared: all.filter((r) => !r.declared).length,
  }), [all]);
  const q = search.trim().toLowerCase();
  const rows = all.filter((r) =>
    (filter === 'all' || (filter === 'declared' ? r.declared : !r.declared))
    && (dept === 'all' || r.department === dept)
    && (!q || r.name.toLowerCase().includes(q) || (r.employeeId ?? '').toLowerCase().includes(q)));
  const billsDue = all.reduce((t, r) => t + r.heads.reduce((u, h) => u + h.bills.due, 0), 0);
  const billsApproved = all.reduce((t, r) => t + r.heads.reduce((u, h) => u + h.bills.approved, 0), 0);
  const fyOptions = [nextFy(thisFy), thisFy, previousFy(thisFy), previousFy(previousFy(thisFy))];

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      {ready && list.data && <SetupNote data={list.data} go={s.setView} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        <SummaryCard label="On FBP" value={ready ? counts.all : '—'} sub={`FY ${fy}`} onClick={() => setFilter('all')} active={filter === 'all'} />
        <SummaryCard label="Declared" value={ready ? counts.declared : '—'} onClick={() => setFilter('declared')} active={filter === 'declared'} />
        <SummaryCard label="Not declared yet" value={ready ? counts.not_declared : '—'} sub="Paid the salary structure's amounts" onClick={() => setFilter('not_declared')} active={filter === 'not_declared'} color={counts.not_declared > 0 ? 'var(--warn)' : undefined} />
        <SummaryCard label="Bills approved" value={ready ? `${billsApproved} / ${billsDue}` : '—'} sub="Months approved of months paid, so far" />
      </div>

      <Card padded>
        <div style={toolbar}>
          <StatusTabs<Filter>
            options={['all', 'declared', 'not_declared']}
            active={filter}
            onSelect={setFilter}
            labels={{ all: 'All', declared: 'Declared', not_declared: 'Not declared yet' }}
            counts={ready ? counts : undefined}
          />
        </div>
        <div style={toolbar}>
          <div style={{ flex: 1, minWidth: 262, display: 'flex' }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search by employee name or ID…" width="100%" />
          </div>
          <SelectBox value={dept} onChange={setDept}>
            <option value="all">All departments</option>
            {(list.data?.departments ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
          </SelectBox>
          <SelectBox value={fy} onChange={setFy}>
            {fyOptions.map((f) => <option key={f} value={f}>FY {f}</option>)}
          </SelectBox>
        </div>

        <div style={TH(COLS)}>
          <Th>EMPLOYEE</Th>
          <Th align="right">POOL</Th>
          <Th>FBP HEADS · A MONTH · BILLS APPROVED</Th>
          <Th align="right">UNASSIGNED</Th>
          <Th>DECLARED</Th>
          <Th>BILLS NOTED</Th>
        </div>
        {ready && rows.map((r, i) => <SplitRow key={r.userId} row={r} last={i === rows.length - 1} open={() => s.openProfile(r.userId, 'salary')} />)}
        <ListPending state={list.state} onRetry={list.retry} cols={6} />
        {ready && rows.length === 0 && (
          <EmptyRow text={all.length === 0 ? 'Nobody is on a salary template with FBP heads.' : 'No one matches your filters.'} />
        )}
        <div style={{ ...hint, marginTop: 12 }}>
          {list.data?.asOf ? `Amounts are those in force in ${monthLabel(list.data.asOf)}. ` : 'This FY has not started: amounts are the salary structures\'. '}
          Bills count months from April (or when pay started) to {list.data?.asOf ? monthLabel(list.data.asOf) : 'now'} that the head paid something. Open someone to see every version of their split.
        </div>
      </Card>

    </div>
  );
}

function SplitRow({ row: r, last, open }: { row: FbpSplitRowDTO; last: boolean; open: () => void }) {
  return (
    <div className="dc-row" onClick={open} title="Open salary details" style={{ ...TR(COLS, last), cursor: 'pointer', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <PersonAvatar name={r.name} userId={r.userId} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
          <div style={cellSub}>{[r.employeeId, r.department].filter(Boolean).join(' · ') || '—'}</div>
          <div style={cellSub}>{r.template.name}</div>
        </div>
      </div>
      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.poolPaise === null ? <span style={{ color: 'var(--warn)' }}>Not set</span> : money(r.poolPaise)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {r.heads.map((h) => {
          const short = h.bills.due - h.bills.approved;
          return (
            <div key={h.code} style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${h.name} · limit ${money(h.limitPaise)} a month`}>{h.name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, minWidth: 70, textAlign: 'right' }}>{money(h.amountPaise)}</span>
              <span
                style={{ ...cellSub, minWidth: 92, textAlign: 'right', color: h.bills.due === 0 ? 'var(--ink-3)' : short > 0 ? 'var(--warn)' : 'var(--ok, var(--ink-2))' }}
                title={h.billType ? `${h.bills.approved} approved, ${h.bills.inReview} in review, ${h.bills.rejected} rejected, ${h.bills.missing} not uploaded` : 'No bill type is linked to this head: bills can\'t be uploaded'}
              >
                {h.billType ? `${h.bills.approved} / ${h.bills.due} bills` : 'No bill type'}
                {h.bills.inReview > 0 ? ` · ${h.bills.inReview} in review` : ''}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.unassignedPaise === null ? '—' : money(r.unassignedPaise)}</div>
      <div>
        {r.declared ? (
          <>
            <div>{dateLabel(r.declared.firstAt)}</div>
            <div style={cellSub}>{r.declared.changedAt ? `Changed ${dateLabel(r.declared.changedAt)}` : `From ${monthLabel(r.declared.effectiveFrom)}`}</div>
          </>
        ) : <span style={{ color: 'var(--warn)' }}>Not declared yet</span>}
      </div>
      <div>{r.declared ? dateLabel(r.declared.billsAcknowledgedAt) : '—'}</div>
    </div>
  );
}

function SetupNote({ data, go }: { data: FbpSplitsDTO; go: (v: 'payheads' | 'templates' | 'payrolldash') => void }) {
  const { headsWithoutBillType, templatesWithoutPool, rules } = data.setup;
  const rulesMissing = [
    rules.splitStepPaise === null ? 'the split step' : '',
    rules.splitCutoffDay === null ? 'the split cutoff day' : '',
    rules.splitClosesOn === null ? 'the date the split closes' : '',
    rules.fbpBillsDueDay === null ? 'the day each month\'s bills are due' : '',
    rules.billsDueOn === null ? 'the FY\'s bills deadline' : '',
  ].filter(Boolean);
  const notes: React.ReactNode[] = [];
  if (headsWithoutBillType.length) {
    notes.push(
      <span key="heads">
        No bill type is linked to {headsWithoutBillType.map((h) => h.name).join(', ')}, so bills can't be uploaded for {headsWithoutBillType.length === 1 ? 'it' : 'them'} and {headsWithoutBillType.length === 1 ? 'it stays' : 'they stay'} taxable.{' '}
        <LinkButton onClick={() => { try { sessionStorage.setItem(OPEN_TAB_KEY, 'fbpbills'); } catch { /* opens on Earnings */ } go('payheads'); }}>Add a bill type in Salary components</LinkButton>
      </span>,
    );
  }
  if (templatesWithoutPool.length) {
    notes.push(
      <span key="pool">
        {templatesWithoutPool.map((t) => t.name).join(', ')} {templatesWithoutPool.length === 1 ? 'has' : 'have'} FBP heads but no flexible pool, so nobody on {templatesWithoutPool.length === 1 ? 'it' : 'them'} can make a split.{' '}
        <LinkButton onClick={() => go('templates')}>Salary Templates</LinkButton>
      </span>,
    );
  }
  if (rulesMissing.length) {
    notes.push(
      <span key="rules">
        Not set for the app: {rulesMissing.join(', ')}.{' '}
        <LinkButton onClick={() => go('payrolldash')}>Payroll in the app</LinkButton>
      </span>,
    );
  }
  const ruleLine = [
    rules.splitClosesOn ? `splits close ${dateLabel(rules.splitClosesOn)}` : '',
    rules.fbpBillsDueDay ? `each month's bills due by the ${rules.fbpBillsDueDay}${ordinal(rules.fbpBillsDueDay)}` : '',
    rules.billsDueOn ? `the FY's bills by ${dateLabel(rules.billsDueOn)}` : '',
  ].filter(Boolean).join(' · ');
  return (
    <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 'var(--r)', border: `1px solid ${notes.length ? 'var(--warn)' : 'var(--line)'}`, background: notes.length ? 'var(--warn-bg, var(--surface))' : 'var(--surface)', fontSize: 13, lineHeight: 1.6 }}>
      {notes.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>{notes}</div>}
      <div style={{ color: 'var(--ink-2)' }}>
        {ruleLine ? `FY ${data.fy}: ${ruleLine}. ` : ''}
        FBP heads are set in <LinkButton onClick={() => go('payheads')}>Salary Components</LinkButton>, their monthly limits and the pool in{' '}
        <LinkButton onClick={() => go('templates')}>Salary Templates</LinkButton>, the split and bill dates in{' '}
        <LinkButton onClick={() => go('payrolldash')}>Payroll in the app</LinkButton>.
      </div>
    </div>
  );
}

const ordinal = (n: number) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-ink)', fontSize: 'inherit', fontFamily: 'inherit', textDecoration: 'underline' }}>
      {children}
    </button>
  );
}
