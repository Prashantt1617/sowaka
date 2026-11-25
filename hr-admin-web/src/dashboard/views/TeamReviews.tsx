// Performance › Performance Reviews for a manager on the dashboard (team scope):
// their DIRECT reports for the current cycle, each with Write / Edit review, posted
// to the same endpoints the app's manager review screen uses
// (GET /manager/workspace for the assigned parameters, PUT /manager/feedback/:userId).
// Everyone else in their subtree is view-only in the list below this section.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/http';
import { useStore } from '../store';
import { Card } from '../ui';
import { Modal } from './kpiUi';
import { periodLabel } from '../period';
import { ghostBtn, panelCard, panelTitle, smallBtn } from './kpiLook';

/** The server's floor for a comment on a sent review (FEEDBACK_NOTE_MIN). */
const NOTE_MIN = 75;

type Param = { parameterId: string; name: string; subtitle?: string; weight?: number; score: number; note: string };
export type WorkspaceMember = Member;
type Member = {
  userId: string;
  name: string;
  designation?: string;
  department?: string;
  reportsToViewer?: boolean;
  isSelf?: boolean;
  isManager?: boolean;
  feedbackStatus: 'pending' | 'saved' | 'sent' | string;
  score?: number;
  parameters: Param[];
  /** Last cycle, still open to the viewer's review (direct reports only; null elsewhere). */
  previousCycle?: { period: string; feedbackStatus: 'pending' | 'saved' | 'sent' | string; score: number; parameters: Param[]; extra: string } | null;
};
type Workspace = { period: string; team: Member[] };

export const STATUS_LABEL: Record<string, string> = { pending: 'Not started', saved: 'Draft', sent: 'Sent' };

export function TeamReviews() {
  const { flash } = useStore();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);

  const load = useCallback(() => {
    setErr(null);
    api<Workspace>('/manager/workspace')
      .then(setWs)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not load your team'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const direct = (ws?.team ?? []).filter((m) => m.reportsToViewer && !m.isSelf && !m.isManager);

  return (
    <Card style={{ ...panelCard, marginBottom: 16 }}>
      <div style={panelTitle}>Your team's reviews{ws ? ` · ${periodLabel(ws.period)}` : ''}</div>
      {err && <div style={{ color: 'var(--bad)', fontSize: 13, padding: '8px 0' }}>{err} <button type="button" style={ghostBtn} onClick={load}>Retry</button></div>}
      {!ws && !err && <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: '8px 0' }}>Loading your team…</div>}
      {ws && direct.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: '8px 0' }}>Nobody reports directly to you.</div>}
      {ws && direct.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {direct.map((m) => (
            <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{m.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{m.designation || m.department || ''}</div>
              </div>
              <span style={{ fontSize: 12, color: m.feedbackStatus === 'sent' ? 'var(--good)' : 'var(--ink-3)' }}>
                {STATUS_LABEL[m.feedbackStatus] ?? m.feedbackStatus}
                {m.feedbackStatus === 'sent' && m.score ? ` · ${Number(m.score).toFixed(1)}` : ''}
              </span>
              <button type="button" style={smallBtn} onClick={() => setEditing(m)} disabled={!m.parameters?.length} title={m.parameters?.length ? undefined : 'HR has not assigned KPI parameters to this person for this cycle'}>
                {m.feedbackStatus === 'pending' ? 'Write review' : 'Edit review'}
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>Reviews are written for direct reports only. Others in your team are view-only below.</div>
      {editing && ws && (
        <ReviewForm
          member={editing}
          period={ws.period}
          onClose={() => setEditing(null)}
          onSaved={(sent) => { flash(sent ? `Review sent to ${editing.name}` : `Draft saved for ${editing.name}`); setEditing(null); load(); }}
        />
      )}
    </Card>
  );
}

export function ReviewForm({ member, period, onClose, onSaved }: { member: Member; period: string; onClose: () => void; onSaved: (sent: boolean) => void }) {
  const [params, setParams] = useState<Param[]>(() => member.parameters.map((p) => ({ ...p, note: p.note ?? '', score: p.score ?? 0 })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const alreadySent = member.feedbackStatus === 'sent';
  const set = (i: number, patch: Partial<Param>) => setParams((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const sendReady = params.every((p) => p.score > 0 && p.note.trim().length >= NOTE_MIN);

  const save = async (status: 'saved' | 'sent') => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/manager/feedback/${encodeURIComponent(member.userId)}`, {
        method: 'PUT',
        body: { status, period, parameters: params.map((p) => ({ parameterId: p.parameterId, score: p.score, note: p.note })) },
      });
      onSaved(status === 'sent');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the review');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Review: ${member.name}`}
      subtitle={`${periodLabel(period)} · score each parameter 1 to 5; a sent review needs at least ${NOTE_MIN} characters in every comment`}
      onClose={onClose}
      width={720}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', width: '100%' }}>
          {err && <span style={{ color: 'var(--bad)', fontSize: 13, marginRight: 'auto' }}>{err}</span>}
          <button type="button" style={ghostBtn} onClick={onClose} disabled={busy}>Cancel</button>
          {!alreadySent && <button type="button" style={ghostBtn} onClick={() => void save('saved')} disabled={busy}>Save draft</button>}
          <button type="button" style={smallBtn} onClick={() => void save('sent')} disabled={busy || !sendReady}>{alreadySent ? 'Update review' : 'Send review'}</button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {params.map((p, i) => (
          <div key={p.parameterId}>
            <div style={{ fontWeight: 600 }}>{p.name}{p.weight ? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · weight {p.weight}</span> : null}</div>
            {p.subtitle && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{p.subtitle}</div>}
            <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => set(i, { score: n })} aria-pressed={p.score === n}
                  style={{ ...ghostBtn, minWidth: 36, ...(p.score === n ? { background: 'var(--hi)', color: '#fff', borderColor: 'var(--hi)' } : {}) }}>
                  {n}
                </button>
              ))}
            </div>
            <textarea value={p.note} onChange={(e) => set(i, { note: e.target.value })} rows={3} maxLength={1000}
              placeholder="Why this score?" style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13, padding: 8, borderRadius: 8, border: '1px solid var(--line-2)', background: 'transparent', color: 'inherit' }} />
            <div style={{ fontSize: 11, color: p.note.trim().length >= NOTE_MIN ? 'var(--ink-3)' : 'var(--bad)' }}>{p.note.trim().length} / {NOTE_MIN}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
