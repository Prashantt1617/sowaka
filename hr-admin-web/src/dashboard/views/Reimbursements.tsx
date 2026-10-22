import { useStore } from '../store';
import { STAT } from '../theme';
import type { ReqStatus } from '../theme';
import type { Reimb } from '../seed';
import { inDateRange } from '../adapters';
import { downloadCsv } from '../export';
import { Card, DateRange, EmptyRow, ListPending, LoadingFigure, PageActions, Pill, SearchInput, SelectBox, StatusTabs, SummaryCard, Th } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, cellName, cellSub, iconBtn, TH, toolbar, TR } from '../ds';
import { IconCheck, IconDownload, IconEye, IconFile, IconX } from '../icons';

const COLS = '1.5fr 1fr 1fr 1fr 1fr 1.5fr 1.2fr 1fr 1.1fr';

export function Reimbursements() {
  const s = useStore();
  const st = s.listState('claims');
  const ranged = s.rbs.filter((r) => inDateRange(r.refISO, s.rbFrom, s.rbTo));
  const rtot = ranged.reduce((a, r) => a + r.amountN, 0);
  const rpend = ranged.filter((r) => r.status === 'Pending').reduce((a, r) => a + r.amountN, 0);
  const summary = {
    count: ranged.length,
    pending: ranged.filter((r) => r.status === 'Pending').length,
    total: '₹' + rtot.toLocaleString('en-IN'),
    pendingAmt: '₹' + rpend.toLocaleString('en-IN'),
  };

  let rows = ranged.slice();
  const q = s.rbSearch.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  if (s.rbStatus !== 'all') rows = rows.filter((r) => r.status === s.rbStatus);
  if (s.rbType !== 'all') rows = rows.filter((r) => r.type === s.rbType);
  const rs = s.rbSort;
  if (rs === 'recent') rows.sort((a, b) => b.ord - a.ord);
  else if (rs === 'oldest') rows.sort((a, b) => a.ord - b.ord);
  else if (rs === 'amount') rows.sort((a, b) => b.amountN - a.amountN);
  else if (rs === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
  const exportRows = () =>
    downloadCsv<Reimb>(
      'reimbursements',
      [
        { header: 'Employee', value: (r) => r.name },
        { header: 'Team', value: (r) => r.team },
        { header: 'Type', value: (r) => r.type },
        { header: 'Amount', value: (r) => r.amountN },
        { header: 'Bill date', value: (r) => r.billDate },
        { header: 'Applied', value: (r) => r.applyDate },
        { header: 'Remark', value: (r) => r.eRemark },
        { header: 'Manager', value: (r) => r.manager },
        { header: 'Status', value: (r) => r.status },
        { header: 'Decided by', value: (r) => (r.byAdmin ? 'admin' : 'manager') },
        { header: 'Bill', value: (r) => r.bill },
      ],
      rows,
    );

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        <SummaryCard label="Total claims" value={<LoadingFigure state={st}>{summary.count}</LoadingFigure>} />
        <SummaryCard label="Awaiting review" value={<LoadingFigure state={st}>{summary.pending}</LoadingFigure>} color="var(--warn)" />
        <SummaryCard label="Pending value" value={<LoadingFigure state={st}>{summary.pendingAmt}</LoadingFigure>} color="var(--warn)" />
        <SummaryCard label="Total submitted" value={<LoadingFigure state={st}>{summary.total}</LoadingFigure>} />
      </div>

      <PageActions>
        <button onClick={exportRows} disabled={rows.length === 0} className={btnClass()} style={btn()}>
          <IconDownload stroke="currentColor" /> Export
        </button>
      </PageActions>

      <Card padded>
      <div style={toolbar}>
        <StatusTabs<ReqStatus | 'all'>
          options={['all', 'Pending', 'Approved', 'Declined']}
          active={s.rbStatus}
          onSelect={s.setRbStatus}
        />
      </div>
      <div style={toolbar}>
        <div style={{ flex: 1, minWidth: 262, display: 'flex' }}>
          <SearchInput value={s.rbSearch} onChange={s.setRbSearch} placeholder="Search by employee…" width="100%" />
        </div>
        <SelectBox value={s.rbType} onChange={s.setRbType}>
          <option value="all">All types</option>
          <option value="Travel">Travel</option>
          <option value="Meals">Meals</option>
          <option value="Software">Software</option>
          <option value="Hardware">Hardware</option>
          <option value="Internet">Internet</option>
          <option value="Training">Training</option>
        </SelectBox>
        <SelectBox value={s.rbSort} onChange={s.setRbSort}>
          <option value="recent">Most recent</option>
          <option value="oldest">Oldest first</option>
          <option value="amount">Highest amount</option>
          <option value="name">Name A–Z</option>
        </SelectBox>
        <DateRange from={s.rbFrom} to={s.rbTo} onFrom={s.setRbFrom} onTo={s.setRbTo} />
      </div>

        <div style={TH(COLS)}>
          <Th>EMPLOYEE</Th>
          <Th>TYPE</Th>
          <Th>AMOUNT</Th>
          <Th>BILL DATE</Th>
          <Th>APPLIED</Th>
          <Th>REMARK</Th>
          <Th>MANAGER</Th>
          <Th>STATUS</Th>
          <Th align="right">ACTION</Th>
        </div>
        {rows.map((r, i) => {
          const pending = r.status === 'Pending';
          return (
            <div
              key={r.id}
              className="dc-row"
              onClick={() => s.setRbDrawerId(r.id)}
              style={{ ...TR(COLS, i === rows.length - 1), position: 'relative', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <PersonAvatar name={r.name} userId={r.submitterId} />
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={cellSub}>{r.team}</div>
                </div>
              </div>
              <div style={{ fontWeight: 400 }}>{r.type}</div>
              <div style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{r.amount}</div>
              <div style={{ fontWeight: 400 }}>{r.billDate}</div>
              <div style={{ fontWeight: 400 }}>{r.applyDate}</div>
              <div style={{ fontWeight: 400, color: r.eRemark ? 'var(--ink)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>{r.eRemark || '—'}</div>
              <div style={{ fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.manager}</div>
              <div>
                <Pill label={r.byAdmin ? `${r.status} · by admin` : r.status} tone={STAT[r.status]} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }} onClick={(e) => e.stopPropagation()}>
                <button onClick={() => s.setRbBillId(r.id)} title="View bill" className="ds-icon-btn" style={iconBtn(34)}>
                  <IconFile />
                </button>
                {pending ? (
                  <>
                    <button onClick={() => s.rbAsk(r.id, 'decline')} title="Decline" className={btnClass('no')} style={btn('no', 'sm')}>
                      <IconX />
                    </button>
                    <button onClick={() => s.rbAsk(r.id, 'approve')} title="Approve" className={btnClass('ok')} style={btn('ok', 'sm')}>
                      <IconCheck />
                    </button>
                  </>
                ) : (
                  <button onClick={() => s.setRbDrawerId(r.id)} title="View details" className="ds-icon-btn" style={iconBtn(34)}>
                    <IconEye />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <ListPending state={st} onRetry={() => void s.reload()} cols={7} />
        {st === 'ready' && rows.length === 0 && <EmptyRow text="No claims match your filters." />}
      </Card>
    </div>
  );
}
