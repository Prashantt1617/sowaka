// Payroll › Investment proofs: the proofs employees upload on the app for the
// items of their investment declaration (old regime: PPF, ELSS, rent, home
// loan…). HR opens the file, then approves it or sends it back with a reason
// the employee reads on the app. When every proof of a person is approved
// their declaration's proofs become "verified".
//
// The server lists the proofs that exist (uploaded, approved, rejected); an
// item the employee declared but has not uploaded yet has no row here.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { decideInvestmentProof, investmentProofFileUrl, listInvestmentProofs } from '../../services/payroll';
import type { InvestmentProofDTO, InvestmentProofStatus } from '../../services/payroll';
import { useLoad } from '../useLoad';
import { Card, EmptyRow, ListPending, Pill, SearchInput, SelectBox, StatusTabs, SummaryCard, Th } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { STAT } from '../theme';
import type { Pill as PillTone } from '../theme';
import { btn, btnClass, cellName, cellSub, eyebrow, hint, iconBtn, TH, textareaStyle, toolbar, TR } from '../ds';
import { IconCheck, IconFile, IconX } from '../icons';

const COLS = '1.6fr 1.5fr 0.9fr 0.9fr 1.3fr 0.9fr 1.1fr 1.1fr';

type Filter = 'all' | InvestmentProofStatus;
const LABEL: Record<InvestmentProofStatus, string> = { uploaded: 'Uploaded', approved: 'Approved', rejected: 'Rejected' };
const TONE: Record<InvestmentProofStatus, PillTone> = { uploaded: STAT.Pending, approved: STAT.Approved, rejected: STAT.Declined };

/** "2026-27" for a day in April 2026 to March 2027. */
function fyOf(d: Date): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
function previousFy(fy: string): string {
  const start = Number(fy.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
const money = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function InvestmentProofs() {
  const { flash } = useStore();
  const thisFy = fyOf(new Date());
  const [fy, setFy] = useState(thisFy);
  const [filter, setFilter] = useState<Filter>('uploaded');
  const [search, setSearch] = useState('');
  const [deciding, setDeciding] = useState<{ proof: InvestmentProofDTO; decision: 'approved' | 'rejected' } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  // Every proof of the year at once: the counts per status come from the same list.
  const list = useLoad(() => listInvestmentProofs({ fy }), [fy]);
  const proofs = useMemo(() => list.data?.proofs ?? [], [list.data]);
  useEffect(() => {
    if (list.state === 'error') flash(list.error instanceof ApiError ? list.error.message : 'Could not load the investment proofs', 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.state]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: proofs.length, uploaded: 0, approved: 0, rejected: 0 };
    for (const p of proofs) c[p.status] += 1;
    return c;
  }, [proofs]);
  const q = search.trim().toLowerCase();
  const rows = proofs.filter((p) =>
    (filter === 'all' || p.status === filter)
    && (!q || p.employeeName.toLowerCase().includes(q) || (p.employeeId ?? '').toLowerCase().includes(q)));
  const people = new Set(proofs.filter((p) => p.status === 'uploaded').map((p) => p.userId)).size;
  const fyOptions = [thisFy, previousFy(thisFy), previousFy(previousFy(thisFy))];

  const openFile = async (p: InvestmentProofDTO) => {
    // Opened first, so the browser treats it as the click's own window and does not block it.
    const tab = window.open('', '_blank');
    setOpening(p.id);
    try {
      const url = await investmentProofFileUrl(p.id);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch (e) {
      tab?.close();
      flash(e instanceof ApiError ? e.message : 'Could not open the file', 'error');
    } finally {
      setOpening(null);
    }
  };

  const decided = (proof: InvestmentProofDTO) => {
    list.setData((d) => ({ fy: d?.fy ?? fy, proofs: (d?.proofs ?? []).map((x) => (x.id === proof.id ? proof : x)) }));
    setDeciding(null);
    flash(proof.status === 'approved' ? `${proof.label} approved for ${proof.employeeName}` : `${proof.label} sent back to ${proof.employeeName}`);
  };

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        <SummaryCard label="To review" value={list.state === 'ready' ? counts.uploaded : '—'} sub={list.state === 'ready' ? `${people} ${people === 1 ? 'person' : 'people'}` : undefined} onClick={() => setFilter('uploaded')} active={filter === 'uploaded'} />
        <SummaryCard label="Approved" value={list.state === 'ready' ? counts.approved : '—'} onClick={() => setFilter('approved')} active={filter === 'approved'} />
        <SummaryCard label="Rejected" value={list.state === 'ready' ? counts.rejected : '—'} sub="Waiting for the employee to upload again" onClick={() => setFilter('rejected')} active={filter === 'rejected'} />
        <SummaryCard label="All proofs" value={list.state === 'ready' ? counts.all : '—'} sub={`FY ${fy}`} onClick={() => setFilter('all')} active={filter === 'all'} />
      </div>

      <Card padded>
        <div style={toolbar}>
          <StatusTabs<Filter>
            options={['uploaded', 'approved', 'rejected', 'all']}
            active={filter}
            onSelect={setFilter}
            labels={{ uploaded: 'Uploaded', approved: 'Approved', rejected: 'Rejected', all: 'All' }}
            counts={list.state === 'ready' ? counts : undefined}
          />
        </div>
        <div style={toolbar}>
          <div style={{ flex: 1, minWidth: 262, display: 'flex' }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search by employee name or ID…" width="100%" />
          </div>
          <SelectBox value={fy} onChange={setFy}>
            {fyOptions.map((f) => <option key={f} value={f}>FY {f}</option>)}
          </SelectBox>
        </div>

        <div style={TH(COLS)}>
          <Th>EMPLOYEE</Th>
          <Th>ITEM</Th>
          <Th align="right">DECLARED</Th>
          <Th align="right">ON PROOF</Th>
          <Th>FILE</Th>
          <Th>UPLOADED</Th>
          <Th>STATUS</Th>
          <Th align="right">ACTION</Th>
        </div>
        {list.state === 'ready' && rows.map((p, i) => {
          const differs = p.amountPaise !== p.declaredPaise;
          return (
            <div key={p.id} className="dc-row" style={TR(COLS, i === rows.length - 1)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <PersonAvatar name={p.employeeName} userId={p.userId} />
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.employeeName}</div>
                  <div style={cellSub}>{p.employeeId || '—'}</div>
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.label}>{p.label}</div>
                <div style={cellSub}>Section {p.section}</div>
              </div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(p.declaredPaise)}</div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                {money(p.amountPaise)}
                {differs && <div style={{ ...cellSub, color: p.amountPaise < p.declaredPaise ? 'var(--warn)' : 'var(--ink-3)' }}>{p.amountPaise < p.declaredPaise ? 'Less than declared' : 'More than declared'}</div>}
              </div>
              <button onClick={() => void openFile(p)} disabled={opening === p.id} title="Open the file" style={fileLink}>
                <span style={{ display: 'inline-flex', flexShrink: 0 }}><IconFile size={15} /></span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opening === p.id ? 'Opening…' : p.fileName}</span>
                  <span style={cellSub}>{sizeLabel(p.size)}</span>
                </span>
              </button>
              <div>{dateLabel(p.uploadedAt)}</div>
              <div style={{ minWidth: 0 }}>
                <Pill label={LABEL[p.status]} tone={TONE[p.status]} />
                {p.status === 'rejected' && p.reason && <div style={{ ...cellSub, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.reason}>{p.reason}</div>}
                {p.status !== 'uploaded' && p.decidedAt && <div style={{ ...cellSub, marginTop: 2 }}>{dateLabel(p.decidedAt)}</div>}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }}>
                {p.status === 'uploaded' ? (
                  <>
                    <button onClick={() => setDeciding({ proof: p, decision: 'rejected' })} title="Reject" className={btnClass('no')} style={btn('no', 'sm')}><IconX /></button>
                    <button onClick={() => setDeciding({ proof: p, decision: 'approved' })} title="Approve" className={btnClass('ok')} style={btn('ok', 'sm')}><IconCheck /></button>
                  </>
                ) : (
                  <button onClick={() => void openFile(p)} title="Open the file" className="ds-icon-btn" style={iconBtn(34)}><IconFile /></button>
                )}
              </div>
            </div>
          );
        })}
        <ListPending state={list.state} onRetry={list.retry} cols={6} />
        {list.state === 'ready' && rows.length === 0 && (
          <EmptyRow text={proofs.length === 0 ? `No proofs uploaded for FY ${fy} yet.` : filter === 'uploaded' && !q ? 'Nothing waiting for review.' : 'No proofs match your filters.'} />
        )}
        <div style={{ ...hint, marginTop: 12 }}>
          Employees on the old regime upload a proof for each item they declare, until the proofs deadline. Items declared but not uploaded yet are not listed.
        </div>
      </Card>

      {deciding && <DecisionModal proof={deciding.proof} decision={deciding.decision} onCancel={() => setDeciding(null)} onDone={decided} />}
    </div>
  );
}

function DecisionModal({ proof, decision, onCancel, onDone }: {
  proof: InvestmentProofDTO;
  decision: 'approved' | 'rejected';
  onCancel: () => void;
  onDone: (p: InvestmentProofDTO) => void;
}) {
  const { flash } = useStore();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const approve = decision === 'approved';
  const trimmed = reason.trim();
  const valid = approve || (trimmed.length >= 3 && trimmed.length <= 500);
  const confirm = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      onDone(await decideInvestmentProof(proof.id, decision, approve ? undefined : trimmed));
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the decision', 'error');
      setSaving(false);
    }
  };
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 85, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onCancel} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div role="dialog" aria-modal="true" style={{ position: 'relative', width: 'min(520px, calc(100% - 32px))', background: 'var(--surface)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-drawer)', animation: 'pop .2s ease both', padding: 20 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, background: approve ? 'var(--ok-bg)' : 'var(--bad-bg)' }}>
          {approve ? <IconCheck /> : <IconX />}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>{approve ? 'Approve this proof?' : 'Reject this proof?'}</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.55 }}>
          {proof.employeeName} · {proof.label} (section {proof.section}) · {money(proof.amountPaise)} on the proof, {money(proof.declaredPaise)} declared.
          {approve ? ' The employee sees it as approved on the app.' : ' The employee sees your reason on the app and can upload it again.'}
        </div>
        {!approve && (
          <>
            <div style={{ ...eyebrow, marginTop: 16, marginBottom: 8 }}>REASON — THE EMPLOYEE READS THIS</div>
            <textarea
              autoFocus
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. This certificate is for FY 2025–26. Upload the one for this year."
              className="ds-inp"
              style={{ ...textareaStyle, resize: 'none' }}
            />
            <div style={{ ...hint, marginTop: 6 }}>{trimmed.length < 3 ? 'Required: at least 3 characters.' : `${trimmed.length} / 500`}</div>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className={btnClass()} style={btn()}>Cancel</button>
          <button onClick={() => void confirm()} disabled={!valid || saving} className={btnClass(approve ? 'primary' : 'danger')} style={{ ...btn(approve ? 'primary' : 'danger'), opacity: !valid || saving ? 0.55 : 1, cursor: !valid || saving ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : approve ? 'Approve' : 'Reject'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const fileLink = {
  display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--accent-ink)', fontSize: 13, fontFamily: 'inherit', textAlign: 'left' as const,
};
