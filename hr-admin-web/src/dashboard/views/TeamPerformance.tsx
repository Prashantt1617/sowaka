// Performance › Performance Reviews for a manager on the dashboard (team scope, 24 Nov 2026, HR: "no need
// for the managers tab here; I should be able to assign KPIs from here to all my reports, even edit them
// whenever I want, that is people in my subtree, and fill in for direct ones").
//
// One list: everyone in the manager's subtree (the server sends nobody else). Each person has Assign KPIs /
// Edit KPIs, picking only from the parameters and templates HR set up (the same assignment modal as the
// profile). Direct reports also have Write review / Edit review, through the app's own endpoints
// (GET /manager/workspace, PUT /manager/feedback/:userId), which accept direct reports only.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/http';
import { useStore } from '../store';
import { useAuth } from '../auth/AuthContext';
import { Card, SearchInput } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { getKpiAssignment, listKpiParameters, listKpiTemplates } from '../../services/kpi';
import type { KpiAssignmentDTO, KpiParameterDTO, KpiTemplateDTO } from '../../services/kpi';
import { KpiAssignModal } from './KpiAssign';
import { ReviewForm, STATUS_LABEL, type WorkspaceMember } from './TeamReviews';
import { periodLabel } from '../period';
import { ghostBtn, panelCard, smallBtn } from './kpiLook';

type Workspace = { period: string; team: WorkspaceMember[] };

export function TeamPerformance() {
  const { emps, flash } = useStore();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const [ws, setWs] = useState<Workspace | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [params, setParams] = useState<KpiParameterDTO[]>([]);
  const [templates, setTemplates] = useState<TemplateList>([]);
  const [kpis, setKpis] = useState<Record<string, KpiAssignmentDTO | null | undefined>>({});
  const [assigning, setAssigning] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<WorkspaceMember | null>(null);
  const [q, setQ] = useState('');

  const loadWorkspace = useCallback(() => {
    setErr(null);
    api<Workspace>('/manager/workspace').then(setWs).catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not load your team'));
  }, []);
  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);
  useEffect(() => {
    listKpiParameters().then(setParams).catch(() => setParams([]));
    listKpiTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  // Everyone below the manager (the server's list is their subtree), not themselves.
  const team = useMemo(() => emps.filter((e) => e.id !== me).sort((a, b) => Number(b.managerId === me) - Number(a.managerId === me) || a.name.localeCompare(b.name)), [emps, me]);
  const period = ws?.period;

  const loadKpi = useCallback((userId: string) => {
    if (!period) return;
    getKpiAssignment(userId, period).then((a) => setKpis((k) => ({ ...k, [userId]: a }))).catch(() => setKpis((k) => ({ ...k, [userId]: null })));
  }, [period]);
  useEffect(() => { if (period) team.forEach((e) => loadKpi(e.id)); }, [period, team, loadKpi]);

  const byId = useMemo(() => new Map((ws?.team ?? []).map((m) => [m.userId, m])), [ws]);
  const shown = team.filter((e) => !q || [e.name, e.role, e.team, e.manager].join(' ').toLowerCase().includes(q.toLowerCase()));
  const direct = team.filter((e) => e.managerId === me);
  const sent = direct.filter((e) => byId.get(e.id)?.feedbackStatus === 'sent').length;
  const who = assigning ? team.find((e) => e.id === assigning) : undefined;

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {period ? `${periodLabel(period)} cycle · ` : ''}{team.length} people in your team · reviews sent {sent} of {direct.length} direct reports
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Search your team" />
      </div>
      {err && <div style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 10 }}>{err} <button type="button" style={ghostBtn} onClick={loadWorkspace}>Retry</button></div>}
      <Card style={{ ...panelCard, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', color: 'var(--ink-3)', textAlign: 'left' }}>
                <th style={th}>Employee</th><th style={th}>Reports to</th><th style={th}>KPIs this cycle</th><th style={th}>Review</th><th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const isDirect = e.managerId === me;
                const a = kpis[e.id];
                const m = byId.get(e.id);
                const status = m?.feedbackStatus ?? 'pending';
                return (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PersonAvatar userId={e.id} name={e.name} src={e.photoUrl || undefined} size={30} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>{e.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{[e.role, e.team].filter(Boolean).join(' · ')}</div>
                        </div>
                      </div>
                    </td>
                    <td style={td}>{isDirect ? 'You' : e.manager || '—'}</td>
                    <td style={td}>{a === undefined ? <span style={{ color: 'var(--ink-4)' }}>…</span> : a?.parameters?.length ? `${a.parameters.length} parameter${a.parameters.length === 1 ? '' : 's'}` : <span style={{ color: 'var(--warn)' }}>Not set</span>}</td>
                    <td style={td}>{isDirect ? <span style={{ color: status === 'sent' ? 'var(--ok)' : 'var(--ink-3)' }}>{STATUS_LABEL[status] ?? status}{status === 'sent' && m?.score ? ` · ${Number(m.score).toFixed(1)}` : ''}</span> : <span style={{ color: 'var(--ink-4)' }}>By {e.manager || 'their manager'}</span>}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" style={smallBtn} disabled={!period} onClick={() => setAssigning(e.id)}>{a?.parameters?.length ? 'Edit KPIs' : 'Assign KPIs'}</button>
                      {isDirect && (
                        <button type="button" style={{ ...smallBtn, marginLeft: 8 }} disabled={!m || !m.parameters?.length}
                          title={m && !m.parameters?.length ? 'Assign KPIs first: the review scores them' : undefined}
                          onClick={() => m && setReviewing(m)}>
                          {status === 'pending' ? 'Write review' : 'Edit review'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td style={{ ...td, color: 'var(--ink-3)' }} colSpan={5}>{team.length ? 'Nobody matches.' : 'Nobody is in your team yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>You can set KPIs for anyone in your team, from the parameters and templates HR set up. Reviews are written by each person's own manager.</div>
      {who && period && (
        <KpiAssignModal userId={who.id} userName={who.name} userDesignation={who.role} period={period}
          params={params} templates={templates} existing={kpis[who.id] ?? null}
          onClose={() => setAssigning(null)}
          onSaved={() => { flash(`KPIs saved for ${who.name}`); setAssigning(null); loadKpi(who.id); loadWorkspace(); }} />
      )}
      {reviewing && period && (
        <ReviewForm member={reviewing} period={period} onClose={() => setReviewing(null)}
          onSaved={(wasSent) => { flash(wasSent ? `Review sent to ${reviewing.name}` : `Draft saved for ${reviewing.name}`); setReviewing(null); loadWorkspace(); }} />
      )}
    </div>
  );
}

type TemplateList = KpiTemplateDTO[];
const th: React.CSSProperties = { padding: '10px 14px', fontWeight: 500, fontSize: 12 };
const td: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' };
