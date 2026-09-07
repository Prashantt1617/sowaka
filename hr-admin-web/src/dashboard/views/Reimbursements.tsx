import { useStore } from '../store';
import { STAT } from '../theme';
import type { ReqStatus } from '../theme';
import type { Reimb } from '../seed';
import { inDateRange } from '../adapters';
import { downloadCsv } from '../export';
import { Avatar, Card, DateRange, EmptyRow, Pill, SearchInput, SelectBox, StatusTabs, SummaryCard } from '../ui';
import { IconCheck, IconDownload, IconEye, IconFile, IconX } from '../icons';

const COLS = '1.5fr 1fr 1fr 1fr 1fr 1.5fr 1.2fr 1fr 1.1fr';

export function Reimbursements() {
  const s = useStore();
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <SummaryCard label="Total claims" value={summary.count} />
        <SummaryCard label="Awaiting review" value={summary.pending} color="#9A6B25" />
        <SummaryCard label="Pending value" value={summary.pendingAmt} color="#9A6B25" />
        <SummaryCard label="Total submitted" value={summary.total} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14, flexWrap: 'wrap' }}>
        <SearchInput value={s.rbSearch} onChange={s.setRbSearch} placeholder="Search by employee…" width={240} />
        <StatusTabs<ReqStatus | 'all'>
          options={['all', 'Pending', 'Approved', 'Declined']}
          active={s.rbStatus}
          onSelect={s.setRbStatus}
        />
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
        <button
          onClick={exportRows}
          disabled={rows.length === 0}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, background: '#222222', border: 'none', color: '#fff', borderRadius: 11, padding: '9px 15px', fontSize: 14, fontWeight: 700, cursor: rows.length ? 'pointer' : 'not-allowed', opacity: rows.length ? 1 : 0.5 }}
        >
          <IconDownload /> Export
        </button>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 22px', borderBottom: '1px solid #F0F0F2', fontSize: 12, fontWeight: 700, letterSpacing: '.5px', color: '#717171' }}>
          <div>EMPLOYEE</div>
          <div>TYPE</div>
          <div>AMOUNT</div>
          <div>BILL DATE</div>
          <div>APPLIED</div>
          <div>REMARK</div>
          <div>MANAGER</div>
          <div>STATUS</div>
          <div style={{ textAlign: 'right' }}>ACTION</div>
        </div>
        {rows.map((r) => {
          const pending = r.status === 'Pending';
          return (
            <div
              key={r.id}
              className="dc-row"
              onClick={() => s.setRbDrawerId(r.id)}
              style={{ position: 'relative', display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 22px', borderBottom: '1px solid #F0F0F2', alignItems: 'center', cursor: 'pointer', transition: 'background .12s' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <Avatar name={r.name} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ fontSize: 14, color: '#717171', fontWeight: 500 }}>{r.team}</div>
                </div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>{r.type}</div>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.2px' }}>{r.amount}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>{r.billDate}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>{r.applyDate}</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: r.eRemark ? '#484848' : '#9197A2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>{r.eRemark || '—'}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#484848', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.manager}</div>
              <div>
                <Pill label={r.byAdmin ? `${r.status} · by admin` : r.status} tone={STAT[r.status]} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }} onClick={(e) => e.stopPropagation()}>
                <button onClick={() => s.setRbBillId(r.id)} title="View bill" style={{ width: 33, height: 33, borderRadius: 9, border: '1px solid #EBEBEB', background: '#F7F7F9', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconFile />
                </button>
                {pending ? (
                  <>
                    <button onClick={() => s.rbAsk(r.id, 'decline')} title="Decline" style={{ width: 33, height: 33, borderRadius: 9, border: '1px solid #EBD9DE', background: '#FBF1F3', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <IconX />
                    </button>
                    <button onClick={() => s.rbAsk(r.id, 'approve')} title="Approve" style={{ width: 33, height: 33, borderRadius: 9, border: '1px solid #D7E2D2', background: '#EDF3E9', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <IconCheck />
                    </button>
                  </>
                ) : (
                  <button onClick={() => s.setRbDrawerId(r.id)} title="View details" style={{ width: 33, height: 33, borderRadius: 9, border: '1px solid #EBEBEB', background: '#F7F7F9', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconEye />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <EmptyRow text="No claims match your filters." />}
      </Card>
    </div>
  );
}
