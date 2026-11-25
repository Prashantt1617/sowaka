// Performance › Performance Reviews for a manager on the dashboard (team scope, 24 Nov 2026, HR: "no need
// for the managers tab here; I should be able to assign KPIs from here to all my reports, even edit them
// whenever I want, that is people in my subtree, and fill in for direct ones").
//
// One list: everyone in the manager's subtree (the server sends nobody else). Each person has Assign KPIs /
// Edit KPIs, picking only from the parameters and templates HR set up (the same assignment modal as the
// profile). Direct reports also have Write review / Edit review, through the app's own endpoints
// (GET /manager/workspace, PUT /manager/feedback/:userId), which accept direct reports only.
//
// Past cycles and each person's review history (25 Nov 2026, HR: "the managers dashboard lacks it; I should be
// able to see past reviews like this too"): the same cycle picker and history card as HR's page, from the review
// records the dashboard already loads, which the server limits to the manager's subtree.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/http';
import { useStore } from '../store';
import { useAuth } from '../auth/AuthContext';
import { Card, SearchInput } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { getKpiAssignment, listKpiParameters, listKpiTemplates } from '../../services/kpi';
import type { KpiAssignmentDTO, KpiParameterDTO, KpiTemplateDTO } from '../../services/kpi';
import { KpiAssignModal } from './KpiAssign';
import { STATUS_LABEL, type WorkspaceMember } from './TeamReviews';
import { ReviewPage } from './ReviewPage';
import { periodLabel, previousPeriod } from '../period';
import { adaptFeedbackList } from '../adapters';
import { ReviewCard } from './Feedback';
import { ghostBtn, panelCard, smallBtn } from './kpiLook';

type Workspace = { period: string; team: WorkspaceMember[] };

export function TeamPerformance({ onExit }: { onExit?: () => void } = {}) {
  const { emps, flash, fbRaw, empRaw } = useStore();
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
  // Everyone below them in the reporting line, at any depth (a manager's list is this already; HR's is the
  // whole company, so the subtree is walked from them).
  const team = useMemo(() => {
    const below = new Set<string>();
    const queue = [me];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of emps) if (e.managerId === id && e.id !== me && !below.has(e.id)) { below.add(e.id); queue.push(e.id); }
    }
    return emps.filter((e) => below.has(e.id)).sort((a, b) => Number(b.managerId === me) - Number(a.managerId === me) || a.name.localeCompare(b.name));
  }, [emps, me]);
  const period = ws?.period;
  // The cycle on screen: the live one unless a past one is picked. Past cycles are read-only here.
  const [viewPeriod, setViewPeriod] = useState<string | null>(null);
  const shownPeriod = viewPeriod ?? period;
  const isPast = Boolean(period && shownPeriod && shownPeriod !== period);
  const periods = useMemo(
    () => (period ? [...new Set([period, previousPeriod(period), ...fbRaw.map((r) => r.period)])].sort().reverse() : []),
    [period, fbRaw],
  );
  const fbView = useMemo(() => (shownPeriod ? adaptFeedbackList(fbRaw, empRaw, shownPeriod) : null), [fbRaw, empRaw, shownPeriod]);
  const fbBy = useMemo(() => new Map((fbView?.fbEmps ?? []).map((e) => [e.userId, e])), [fbView]);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const historyEmp = historyOf ? fbBy.get(historyOf) : undefined;

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

  // Writing a review is a page of its own: one tab per parameter, dictation and Refine with Suwi.
  if (reviewing && period) {
    return (
      <ReviewPage member={reviewing} period={period} onBack={() => setReviewing(null)}
        onSaved={(wasSent) => { flash(wasSent ? `Review sent to ${reviewing.name}` : `Draft saved for ${reviewing.name}`); setReviewing(null); loadWorkspace(); }} />
    );
  }

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      {onExit && <button type="button" style={{ ...ghostBtn, marginBottom: 10 }} onClick={onExit}>← All reviews</button>}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {periods.length > 0 && (
            <select value={shownPeriod ?? ''} title="Review cycle" aria-label="Review cycle"
              onChange={(ev) => { setViewPeriod(ev.target.value === period ? null : ev.target.value); setHistoryOf(null); }}
              style={{ border: '1px solid var(--line-2)', borderRadius: 999, height: 36, padding: '0 12px', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer' }}>
              {periods.map((p) => <option key={p} value={p}>{periodLabel(p)}{p === period ? ' — current' : ''}</option>)}
            </select>
          )}
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {isPast
              ? `${team.length} people in your team · ${team.filter((e) => fbBy.get(e.id)?.status === 'sent').length} reviewed in ${periodLabel(shownPeriod!)}`
              : `${team.length} people in your team · reviews sent ${sent} of ${direct.length} direct reports`}
          </div>
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Search your team" />
      </div>
      {err && <div style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 10 }}>{err} <button type="button" style={ghostBtn} onClick={loadWorkspace}>Retry</button></div>}
      <Card style={{ ...panelCard, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', color: 'var(--ink-3)', textAlign: 'left' }}>
                <th style={th}>Employee</th><th style={th}>Reports to</th><th style={th}>{isPast ? 'Scored on' : 'KPIs this cycle'}</th><th style={th}>Review</th><th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const isDirect = e.managerId === me;
                const a = kpis[e.id];
                const m = byId.get(e.id);
                const status = m?.feedbackStatus ?? 'pending';
                const fb = fbBy.get(e.id);
                const hasHistory = Boolean(fb && (fb.status === 'sent' || fb.history.length > 0));
                if (isPast) {
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
                      <td style={td}>{fb?.status === 'sent' && fb.params.length ? `${fb.params.length} parameter${fb.params.length === 1 ? '' : 's'}` : <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
                      <td style={td}>{fb?.status === 'sent' ? <span style={{ color: 'var(--ok)' }}>Reviewed · {fb.overall.toFixed(1)}{fb.managerName ? <span style={{ color: 'var(--ink-3)' }}> by {fb.managerName}</span> : null}</span> : <span style={{ color: 'var(--ink-4)' }}>Not reviewed</span>}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button type="button" style={smallBtn} disabled={!hasHistory} onClick={() => setHistoryOf(e.id)}>View review</button>
                      </td>
                    </tr>
                  );
                }
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
                      {hasHistory && <button type="button" style={{ ...ghostBtn, marginRight: 8 }} onClick={() => setHistoryOf(e.id)}>History</button>}
                      <button type="button" style={smallBtn} disabled={!period} onClick={() => setAssigning(e.id)}>{a?.parameters?.length ? 'Edit KPIs' : 'Assign KPIs'}</button>
                      {isDirect && (m?.parameters?.length && a?.parameters?.length ? (
                        <button type="button" style={{ ...smallBtn, marginLeft: 8 }} onClick={() => setReviewing(m)}>
                          {status === 'pending' ? 'Write review' : 'Edit review'}
                        </button>
                      ) : (
                        // No KPIs yet: the review has nothing to score, so it stays locked until they are assigned.
                        <button type="button" disabled aria-disabled title="Assign KPIs first: the review scores them"
                          style={{ ...smallBtn, marginLeft: 8, opacity: 0.55, cursor: 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                          Write review
                        </button>
                      ))}
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
      {historyEmp && shownPeriod && period && (
        <ReviewCard emp={historyEmp} period={shownPeriod} livePeriod={period} onClose={() => setHistoryOf(null)} />
      )}
      {who && period && (
        <KpiAssignModal userId={who.id} userName={who.name} userDesignation={who.role} period={period}
          params={params} templates={templates} existing={kpis[who.id] ?? null}
          onClose={() => setAssigning(null)}
          onSaved={() => { flash(`KPIs saved for ${who.name}`); setAssigning(null); loadKpi(who.id); loadWorkspace(); }} />
      )}
    </div>
  );
}

type TemplateList = KpiTemplateDTO[];
const th: React.CSSProperties = { padding: '10px 14px', fontWeight: 500, fontSize: 12 };
const td: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' };
