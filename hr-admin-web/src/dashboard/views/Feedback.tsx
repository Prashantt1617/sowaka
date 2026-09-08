// Performance › Performance Reviews — how the cycle is going, org-wide.
//
// Three layers, narrowing as you go: the org's completion, then each manager's,
// then the individual reviews behind a manager's number. Denominators come from
// the reporting line rather than from feedback records, so a manager who has
// reviewed nobody still appears as 0/5 — that manager is the reason this page
// exists.
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import type { Pill as PillT } from '../theme';
import type { FbCycle, FbEmp, Feedback as FeedbackRow } from '../seed';
import { downloadCsv } from '../export';
import { adaptFeedbackList } from '../adapters';
import { periodLabel, periodShort } from '../period';
import { Avatar, Card, Pill, SearchInput, SelectBox, SummaryCard } from '../ui';
import { IconDownload } from '../icons';
import { Modal, Tabs, Td, Th } from './kpiUi';
import { ghostBtn, panelCard, panelTitle, smallBtn } from './kpiStyles';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type StatusFilter = 'all' | 'none' | 'sent';

const PAGE_SIZE = 10;
type Section = 'managers' | 'employees';

/** Sentinel for the overall rating, which is not a parameter name. */
const OVERALL = '__overall__';

/**
 * The selected metric for one employee, or null when there is nothing to show.
 *
 * Only submitted reviews carry scores here, so anyone without one reads as
 * absent rather than as a low result.
 */
function scoreOf(emp: FbEmp, metric: string): number | null {
  if (metric === OVERALL) {
    return emp.status === 'sent' && emp.overall > 0 ? emp.overall : null;
  }
  const p = emp.params.find((x) => x.name === metric);
  return p && p.score > 0 ? p.score : null;
}

function barColor(score: number): string {
  if (score >= 4) return '#4F7A52';
  if (score >= 2.5) return '#0571A6';
  return '#A8475F';
}

const pageBtn = (off: boolean): CSSProperties => ({
  ...smallBtn,
  color: off ? '#9197A2' : '#484848',
  background: off ? '#F7F7F9' : '#fff',
  cursor: off ? 'not-allowed' : 'pointer',
});

const metricSelect: CSSProperties = {
  border: '1px solid #EBEBEB', borderRadius: 8, padding: '4px 7px', background: '#fff',
  fontSize: 12, fontWeight: 700, fontFamily: 'inherit', color: '#484848',
  textTransform: 'none', letterSpacing: 0, cursor: 'pointer', maxWidth: 160,
};

const TONE: Record<FbEmp['status'], PillT & { label: string }> = {
  sent: { label: 'Reviewed', bg: '#E4EDE0', fg: '#4F7A52' },
  none: { label: 'Not started', bg: '#F4DEE2', fg: '#A8475F' },
};

export function Feedback() {
  const s = useStore();
  const [section, setSection] = useState<Section>('managers');
  const [status, setStatus] = useState<StatusFilter>('all');
  // Which score the table's Score column shows and sorts on: the overall
  // rating, or any single parameter people are scored against this cycle.
  const [metric, setMetric] = useState<string>(OVERALL);
  const [desc, setDesc] = useState(true);
  const [page, setPage] = useState(1);

  // Any cycle can be viewed, not just the live one: every feedback record is
  // already in the store, so a past cycle is a re-derive rather than a fetch.
  const [period, setPeriod] = useState(s.cycle.period);
  const view = useMemo(
    () => adaptFeedbackList(s.fbRaw, s.empRaw, period),
    [s.fbRaw, s.empRaw, period],
  );

  // Cycles that actually have reviews, plus the live one so it is always
  // selectable even before anybody has been reviewed in it.
  const periods = useMemo(
    () => [...new Set([s.cycle.period, ...s.fbRaw.map((r) => r.period)])].sort().reverse(),
    [s.fbRaw, s.cycle.period],
  );

  const mgrs = view.fbMgrs;
  const totDone = mgrs.reduce((a, m) => a + m.done, 0);
  const totExp = mgrs.reduce((a, m) => a + m.total, 0);


  const focused = s.fbMgrFilter ? mgrs.find((m) => m.id === s.fbMgrFilter) : undefined;
  const open = s.fbEmpId ? view.fbEmps.find((e) => e.userId === s.fbEmpId) : undefined;

  const q = s.fbEmpSearch.trim().toLowerCase();
  const scoped = view.fbEmps.filter((e) => (focused ? e.managerId === focused.id : true));

  // Every parameter anyone is scored on this cycle, so the picker offers only
  // metrics that actually exist rather than the whole catalogue.
  const metrics = [
    OVERALL,
    ...[...new Set(scoped.flatMap((e) => e.params.map((p) => p.name)))].sort(),
  ];
  // A parameter can disappear when the manager filter narrows the set.
  const activeMetric = metrics.includes(metric) ? metric : OVERALL;

  const people = scoped
    .filter((e) => status === 'all' || e.status === status)
    .filter((e) =>
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.designation.toLowerCase().includes(q) ||
      e.team.toLowerCase().includes(q) ||
      e.managerName.toLowerCase().includes(q),
    )
    .slice()
    .sort((a, b) => {
      const sa = scoreOf(a, activeMetric);
      const sb = scoreOf(b, activeMetric);
      // Unscored rows sit at the bottom either way — they are a gap in the
      // data, not a low result, and shouldn't top an ascending sort.
      if (sa === null && sb === null) return a.name.localeCompare(b.name);
      if (sa === null) return 1;
      if (sb === null) return -1;
      return (desc ? sb - sa : sa - sb) || a.name.localeCompare(b.name);
    });

  const pageCount = Math.max(1, Math.ceil(people.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const pageRows = people.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const resetPage = () => setPage(1);

  const exportRows = () =>
    downloadCsv<FeedbackRow>(
      'feedback',
      [
        { header: 'Employee', value: (r) => r.name },
        { header: 'Team', value: (r) => r.team },
        { header: 'Parameter', value: (r) => r.parameter },
        { header: 'Rating', value: (r) => r.rating.toFixed(1) },
        { header: 'Rating description', value: (r) => r.ratingDesc },
        { header: 'Note', value: (r) => r.note },
        { header: 'Manager', value: (r) => r.manager },
        { header: 'Date', value: (r) => r.date },
      ],
      view.fbs,
    );

  return (
    <div>
      {open && (
        <ReviewCard
          emp={open}
          period={period}
          livePeriod={s.cycle.period}
          onClose={() => s.setFbEmpId(null)}
        />
      )}

      {/* —— Cycle summary ———————————————————————————————————————————— */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <select
          value={period}
          onChange={(e) => { setPeriod(e.target.value); s.setFbMgrFilter(null); s.setFbEmpId(null); resetPage(); }}
          title="Review cycle"
          style={{ border: '1px solid #EBEBEB', borderRadius: 11, padding: '9px 12px', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', background: '#fff', color: '#222222', cursor: 'pointer' }}
        >
          {periods.map((p) => (
            <option key={p} value={p}>
              {periodLabel(p)}{p === s.cycle.period ? ' — current' : ''}
            </option>
          ))}
        </select>
        <Tabs<Section>
          value={section}
          onChange={setSection}
          tabs={[
            { key: 'managers', label: 'Managers', count: mgrs.length },
            { key: 'employees', label: 'Employees', count: view.fbEmps.length },
          ]}
        />
        <button
          onClick={exportRows}
          disabled={view.fbs.length === 0}
          style={{ ...smallBtn, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, opacity: view.fbs.length ? 1 : 0.5 }}
        >
          <IconDownload /> Export
        </button>
      </div>

      <div style={{ maxWidth: 260, marginBottom: 16 }}>
        <SummaryCard label="Reviews submitted" value={`${totDone} / ${totExp}`} />
      </div>

      {/* —— Per-manager completion ——————————————————————————————————— */}
      {section === 'managers' && (
      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
          <thead>
            <tr>
              <Th>Manager</Th>
              <Th width="22%">Team</Th>
              <Th width={90}>Reports</Th>
              <Th width={100}>Reviewed</Th>
              <Th width="20%">Progress</Th>
              <Th width={120}>Status</Th>
              <Th width={90} right>{' '}</Th>
            </tr>
          </thead>
          <tbody>
            {mgrs.map((m) => {
              const complete = m.done >= m.total;
              const st: PillT & { label: string } = complete
                ? { label: 'Complete', bg: '#E4EDE0', fg: '#4F7A52' }
                : m.done > 0
                  ? { label: 'In progress', bg: '#F6E9D5', fg: '#9A6B25' }
                  : { label: 'Not started', bg: '#F4DEE2', fg: '#A8475F' };
              const mpct = m.total ? Math.round((m.done / m.total) * 100) : 0;
              const active = s.fbMgrFilter === m.id;
              return (
                <tr
                  key={m.id}
                  className="phm-row"
                  onClick={() => { s.setFbMgrFilter(m.id); setSection('employees'); }}
                  style={{ cursor: 'pointer', background: active ? '#F4FAFD' : undefined }}
                >
                  <Td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <Avatar name={m.name} size={32} font={12} />
                      <span style={{ fontWeight: 700, color: '#0571A6' }}>{m.name}</span>
                    </span>
                  </Td>
                  <Td muted>
                    <span style={{ fontSize: 14.5, color: '#717171' }}>{m.scope}</span>
                  </Td>
                  <Td muted>{m.total}</Td>
                  <Td>
                    <span style={{ fontWeight: 700, color: complete ? '#4F7A52' : '#222222' }}>{m.done}</span>
                  </Td>
                  <Td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{ flex: 1, height: 7, borderRadius: 20, background: '#F0F0F2', overflow: 'hidden', display: 'flex', minWidth: 60 }}>
                        <span style={{ width: `${mpct}%`, background: '#0571A6' }} />
                      </span>
                      <span style={{ fontSize: 13.5, color: '#717171', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{mpct}%</span>
                    </span>
                  </Td>
                  <Td><Pill label={st.label} tone={st} /></Td>
                  <Td right>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0571A6' }}>View team →</span>
                  </Td>
                </tr>
              );
            })}
            {mgrs.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '26px 14px', textAlign: 'center', color: '#717171', fontSize: 15 }}>
                  Nobody has direct reports yet, so there is nothing to review.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      )}

      {/* —— The people behind those numbers ——————————————————————————— */}
      {section === 'employees' && (
      <>
      {/* One filter row: manager, status and search read as the same control
          set, rather than a drill-down chip sitting apart from the filters. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12, flexWrap: 'wrap' }}>
        <SelectBox
          value={s.fbMgrFilter ?? 'all'}
          onChange={(v) => { s.setFbMgrFilter(v === 'all' ? null : v); resetPage(); }}
        >
          <option value="all">All managers</option>
          {mgrs.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </SelectBox>

        <SelectBox value={status} onChange={(v) => { setStatus(v as StatusFilter); resetPage(); }}>
          <option value="all">All statuses · {scoped.length}</option>
          <option value="none">Not started · {scoped.filter((e) => e.status === 'none').length}</option>
          <option value="sent">Reviewed · {scoped.filter((e) => e.status === 'sent').length}</option>
        </SelectBox>

        <SearchInput
          value={s.fbEmpSearch}
          onChange={(v) => { s.setFbEmpSearch(v); resetPage(); }}
          placeholder="Search name, role or manager…"
          width={280}
        />

        {(focused || status !== 'all' || s.fbEmpSearch) && (
          <button
            onClick={() => { s.setFbMgrFilter(null); setStatus('all'); s.setFbEmpSearch(''); resetPage(); }}
            style={{ ...smallBtn, padding: '7px 12px' }}
          >
            Clear filters
          </button>
        )}

        <div style={{ marginLeft: 'auto', fontSize: 15, color: '#717171', fontWeight: 600 }}>
          {people.length} of {view.fbEmps.length} people
        </div>
      </div>

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th width="16%">Role</Th>
              <Th width="13%">Team</Th>
              <Th width="14%">Manager</Th>
              <Th width={130}>Status</Th>
              <Th width={230}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                  <select
                    value={activeMetric}
                    onChange={(e) => { setMetric(e.target.value); resetPage(); }}
                    onClick={(e) => e.stopPropagation()}
                    title="Score shown and sorted on"
                    style={metricSelect}
                  >
                    {metrics.map((m) => (
                      <option key={m} value={m}>{m === OVERALL ? 'Overall score' : m}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => { setDesc((d) => !d); resetPage(); }}
                    title={desc ? 'Highest first' : 'Lowest first'}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#0571A6', fontSize: 13, fontWeight: 800, padding: '2px 4px' }}
                  >
                    {desc ? '↓' : '↑'}
                  </button>
                </span>
              </Th>
              <Th width={110}>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((e) => {
              const tone = TONE[e.status];
              const score = scoreOf(e, activeMetric);
              return (
                <tr key={e.userId} className="phm-row" onClick={() => s.setFbEmpId(e.userId)} style={{ cursor: 'pointer' }}>
                  <Td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <Avatar name={e.name} size={34} font={13} />
                      <span style={{ fontWeight: 700, color: '#0571A6' }}>{e.name}</span>
                    </span>
                  </Td>
                  <Td muted>{e.designation}</Td>
                  <Td muted>{e.team}</Td>
                  <Td muted>{e.managerName}</Td>
                  <Td>
                    <Pill label={tone.label} tone={tone} />
                  </Td>
                  <Td right>
                    {score === null ? (
                      <span style={{ color: '#C7CBD2', fontWeight: 700 }}>—</span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, justifyContent: 'flex-end' }}>
                        <span style={{ width: 54, height: 6, borderRadius: 20, background: '#F0F0F2', overflow: 'hidden' }}>
                          <span style={{ display: 'block', width: `${(score / 5) * 100}%`, height: '100%', background: barColor(score) }} />
                        </span>
                        <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 26, textAlign: 'right' }}>
                          {score.toFixed(1)}
                        </span>
                      </span>
                    )}
                  </Td>
                  <Td muted>
                    <span style={{ fontSize: 14.5, color: '#717171' }}>{e.date || '—'}</span>
                  </Td>
                </tr>
              );
            })}
            {people.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '26px 14px', textAlign: 'center', color: '#717171', fontSize: 15 }}>
                  {q ? 'Nobody matches that search.' : 'Nobody in this view.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {people.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <div style={{ fontSize: 14, color: '#717171', fontWeight: 600 }}>
            Showing {(curPage - 1) * PAGE_SIZE + 1}–{Math.min(people.length, curPage * PAGE_SIZE)} of {people.length}
          </div>
          {pageCount > 1 && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setPage(curPage - 1)} disabled={curPage === 1} style={pageBtn(curPage === 1)}>
                ← Prev
              </button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{
                    minWidth: 32, height: 32, borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    border: `1px solid ${p === curPage ? '#0571A6' : '#EBEBEB'}`,
                    background: p === curPage ? '#0571A6' : '#fff',
                    color: p === curPage ? '#fff' : '#484848',
                  }}
                >
                  {p}
                </button>
              ))}
              <button onClick={() => setPage(curPage + 1)} disabled={curPage === pageCount} style={pageBtn(curPage === pageCount)}>
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {activeMetric !== OVERALL && (
        <div style={{ fontSize: 13, color: '#9197A2', marginTop: 10, lineHeight: 1.5 }}>
          Showing the <strong style={{ color: '#717171' }}>{activeMetric}</strong> score. People
          not scored on it — because it is not in their assigned set, or their review is not in
          yet — show a dash and sort last.
        </div>
      )}

      </>
      )}
    </div>
  );
}

/**
 * One employee's reviews, with a cycle strip to move between them.
 *
 * The current cycle sits alongside the earlier ones, so an unstarted review
 * reads as part of the same sequence rather than a separate state. Bars
 * are drawn against a fixed 0-5 scale, not the range of the data, so 4.1 / 4.2
 * / 4.3 reads as three similar cycles instead of a steep climb.
 */
function ReviewCard({ emp, period: viewedPeriod, livePeriod, onClose }: {
  emp: FbEmp;
  /** The cycle being viewed, which may be a past one. */
  period: string;
  /** The org's live cycle — only this one is labelled NOW. */
  livePeriod: string;
  onClose: () => void;
}) {

  // Oldest first, so the strip reads left to right through time.
  // Sorted by period, not "history then the one being viewed" — the viewed
  // cycle is not necessarily the latest, so appending it would put August
  // after September whenever a past cycle is selected.
  const cycles: (FbCycle & { current: boolean })[] = [
    ...emp.history.map((h) => ({ ...h, current: false })),
    {
      period: viewedPeriod,
      overall: emp.status === 'sent' ? emp.overall : 0,
      date: emp.date,
      params: emp.params,
      extra: emp.extra,
      current: true,
    },
  ].sort((a, b) => a.period.localeCompare(b.period));

  const [period, setPeriod] = useState(viewedPeriod);
  const shown = cycles.find((c) => c.period === period) ?? cycles[cycles.length - 1];
  const isCurrent = shown.current;
  const tone = isCurrent ? TONE[emp.status] : TONE.sent;

  return (
    <Modal
      title={emp.name}
      subtitle={`${emp.designation} · ${emp.team} · reviewed by ${emp.managerName}`}
      onClose={onClose}
      width={900}
      footer={
        <>
          <span style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pill label={isCurrent ? tone.label : 'Reviewed'} tone={tone} fontSize={13} padding="5px 13px" />
            <span style={{ fontSize: 14, color: '#717171', fontWeight: 600 }}>
              {periodShort(shown.period)}
              {shown.date ? ` · ${shown.date}` : ''}
            </span>
          </span>
          <button onClick={onClose} style={ghostBtn}>Close</button>
        </>
      }
    >
      {/* ââ Cycle strip âââââââââââââââââââââââââââââââââââââââââââââââ */}
      <div style={{ ...panelCard, marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.03em', color: '#717171', marginBottom: 12 }}>
          REVIEW HISTORY
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
          {cycles.map((c) => {
            const on = c.period === shown.period;
            const unscored = c.overall <= 0;
            return (
              <button
                key={c.period}
                onClick={() => setPeriod(c.period)}
                title={`${c.period}${unscored ? '' : ` · ${c.overall.toFixed(1)}`}`}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit',
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 800, color: on ? '#0571A6' : '#484848', fontVariantNumeric: 'tabular-nums' }}>
                  {unscored ? '—' : c.overall.toFixed(1)}
                </span>
                <span
                  style={{
                    width: '100%',
                    height: Math.max(5, (c.overall / 5) * 52),
                    borderRadius: 5,
                    background: unscored ? '#F0F0F2' : on ? '#0571A6' : '#BFD8E8',
                    transition: 'background .12s',
                  }}
                />
                <span style={{ fontSize: 12, fontWeight: on ? 800 : 600, color: on ? '#222222' : '#9197A2' }}>
                  {monthLabel(c.period)}
                  {c.period === livePeriod && (
                    <span style={{ display: 'block', fontSize: 10.5, color: '#9197A2', fontWeight: 700 }}>NOW</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {emp.history.length === 0 && (
          <div style={{ fontSize: 13, color: '#9197A2', marginTop: 11, lineHeight: 1.5 }}>
            No earlier reviews â this is their first cycle with one.
          </div>
        )}
      </div>

      {/* ââ The selected cycle âââââââââââââââââââââââââââââââââââââââââ */}
      {isCurrent && emp.status === 'none' ? (
        <div style={{ ...panelCard, textAlign: 'center', color: '#717171', fontSize: 15, lineHeight: 1.6, padding: '30px 20px' }}>
          {emp.managerName === '—'
            ? 'Nobody manages this employee yet, so no review is due.'
            : `${emp.managerName} has not started this review for the current cycle.`}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 18, alignItems: 'start' }}>
          <div style={panelCard}>
            <div style={panelTitle}>Overall</div>
            <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                  <span style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px' }}>
                    {shown.overall > 0 ? shown.overall.toFixed(1) : '—'}
                  </span>
                  <span style={{ fontSize: 15, color: '#717171', fontWeight: 700 }}>/ 5.0</span>
                </div>
                <div style={{ fontSize: 13.5, color: '#717171', marginTop: 6, lineHeight: 1.5 }}>
                  Averaged across {shown.params.length} parameter{shown.params.length === 1 ? '' : 's'}.
                </div>
                <Delta cycles={cycles} period={shown.period} />
            </>

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #EBEBEB' }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.03em', color: '#717171', marginBottom: 7 }}>
                MANAGER SUMMARY
              </div>
              <div style={{ fontSize: 14, color: '#484848', lineHeight: 1.6 }}>
                {shown.extra || 'No summary provided.'}
              </div>
            </div>
          </div>

          <div style={panelCard}>
            <div style={panelTitle}>Parameters</div>
            {shown.params.length === 0 ? (
              <div style={{ fontSize: 15, color: '#717171' }}>No parameters were scored on this review.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
                <thead>
                  <tr>
                    <Th>Parameter</Th>
                    <Th width={80} right>Score</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.params.map((p, i) => (
                    <tr key={`${p.name}-${i}`}>
                      <Td top>
                        <div style={{ fontWeight: 700 }}>{p.name}</div>
                        {p.subtitle && (
                          <div style={{ fontSize: 13.5, color: '#717171', marginTop: 2, lineHeight: 1.45 }}>{p.subtitle}</div>
                        )}
                        {p.note && (
                          <div style={{ fontSize: 14, color: '#484848', marginTop: 7, lineHeight: 1.55, borderLeft: '2px solid #EBEBEB', paddingLeft: 10 }}>
                            {p.note}
                          </div>
                        )}
                      </Td>
                      <Td top right>
                        <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: p.score > 0 ? '#222222' : '#C7CBD2' }}>
                          {p.score > 0 ? p.score.toFixed(1) : '—'}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Movement against the cycle immediately before the one being shown. */
function Delta({ cycles, period }: { cycles: (FbCycle & { current: boolean })[]; period: string }) {
  const i = cycles.findIndex((c) => c.period === period);
  const now = cycles[i];
  const prev = cycles[i - 1];
  if (!prev || !now || now.overall <= 0 || prev.overall <= 0) return null;
  const delta = now.overall - prev.overall;
  if (delta === 0) {
    return (
      <div style={{ fontSize: 13, color: '#717171', fontWeight: 700, marginTop: 9 }}>
        Level with {monthLabel(prev.period)}
      </div>
    );
  }
  return (
    <div style={{ fontSize: 13, color: delta > 0 ? '#4F7A52' : '#A8475F', fontWeight: 700, marginTop: 9 }}>
      {delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)} vs {monthLabel(prev.period)}
    </div>
  );
}

/** "2026-08" -> "Aug". */
function monthLabel(period: string): string {
  const m = Number(period.slice(5, 7));
  return MONTHS[m - 1]?.slice(0, 3) ?? period;
}
