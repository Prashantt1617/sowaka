// One contest, opened from the Contests list: the card as employees see it,
// its numbers and leaderboard, who took part (and who voted for or tagged
// whom), taking part by department and location, and Delete.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { deleteEngagementPost } from '../../../../services/hrms';
import { getContest, type ContestDetailDTO, type ContestPersonDTO, type ContestSummaryDTO } from '../../../../services/engagement-contests';
import { ApiError } from '../../../../services/http';
import { downloadCsv } from '../../../export';
import { useStore } from '../../../store';
import { Avatar, LoadError, SearchInput, SelectBox, SkeletonLines, StatusTabs } from '../../../ui';
import { LookTable, Td, Th } from '../../lookUi';
import * as L from '../../look';
import { ContestCard } from './ContestCard';
import { CONTEST_LABEL, fmtWhen, pct } from './format';
import { BarRow } from './shared';

type Tab = 'took' | 'voted' | 'tags' | 'not';

function Who({ p }: { p: ContestPersonDTO }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <Avatar name={p.name} size={30} font={12} />
      <span style={{ minWidth: 0 }}>
        <span style={{ ...L.cellName, display: 'block' }}>{p.name}</span>
        <span style={{ ...L.cellSub, display: 'block' }}>{[p.department, p.location].filter(Boolean).join(' · ') || '—'}</span>
      </span>
    </span>
  );
}

function Kpi({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{label}</span>
      <b style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</b>
      {sub && <small style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</small>}
    </div>
  );
}

export function ContestDetail({ summary, onDeleted }: { summary: ContestSummaryDTO; onDeleted: () => void }) {
  const { flash } = useStore();
  const [detail, setDetail] = useState<ContestDetailDTO | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('took');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setFailed(false);
    try {
      setDetail(await getContest(summary.id));
    } catch (e) {
      setFailed(true);
      flash(e instanceof ApiError ? e.message : 'Could not load the contest', 'error');
    }
  };
  useEffect(() => {
    setDetail(null);
    setTab('took');
    setQ('');
    setDept('all');
    setMore(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.id]);

  const ml = summary.type === 'most_likely';
  const closed = summary.status === 'closed';

  const remove = async () => {
    const n = summary.entries;
    const what = ml ? (n === 1 ? 'nomination' : 'nominations') : n === 1 ? 'entry' : 'entries';
    // The server takes points back only from a contest that is still running.
    const warning = !n
      ? 'Delete this contest? It comes out of everyone’s feed.'
      : closed
        ? `Delete this contest? It comes out of everyone’s feed with its ${n} ${what}. It has closed, so the points people earned stay with them.`
        : `Delete this contest? ${n} ${what} and the points they earned go with it.`;
    if (!window.confirm(warning)) return;
    setBusy(true);
    try {
      await deleteEngagementPost(summary.id);
      flash('Contest deleted');
      onDeleted();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not delete', 'error');
    } finally {
      setBusy(false);
    }
  };

  const depts = useMemo(() => {
    if (!detail) return [];
    const all = [...detail.entries.map((e) => e.by), ...detail.voters.map((v) => v.voter), ...detail.nominations.map((x) => x.by), ...detail.tagged.map((t) => t.person), ...detail.notYet];
    return [...new Set(all.map((p) => p.department).filter(Boolean))].sort();
  }, [detail]);

  const header = (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 18 }}>
      <div style={{ minWidth: 0, flex: '1 1 320px' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={L.pill(closed ? 'mute' : 'ok')}><span style={L.pillDot} />{closed ? 'Ended' : 'Running'}</span>
          <span style={L.tag}>{CONTEST_LABEL[summary.type]}</span>
          {summary.pinned && <span style={L.pill('warn')}>Pinned</span>}
        </div>
        <div style={{ ...L.cardTitle, fontSize: 19, marginTop: 8, overflowWrap: 'anywhere' }}>{summary.name}</div>
        <div style={{ ...L.cardNote, fontSize: 12.5, marginTop: 2 }}>
          Started {fmtWhen(summary.publishedAt)} · {summary.closesAt ? `${closed ? 'closed' : 'closes'} ${fmtWhen(summary.closesAt)}` : 'no closing time'} · {summary.pointsPerVote} pts per vote · {summary.audience}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {detail && <button type="button" style={L.btnSm} onClick={() => exportCsv(detail)}>Export</button>}
        <button type="button" style={L.btnDanger} disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete'}</button>
      </div>
    </div>
  );

  if (failed) return <>{header}<LoadError onRetry={() => void load()} /></>;
  if (!detail) return <>{header}<SkeletonLines lines={8} /></>;

  const c = detail.contest;
  const aud = c.audienceSize;
  const fl = (p: ContestPersonDTO) => (dept === 'all' || p.department === dept) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));

  const tabs: Tab[] = ml ? ['took', 'tags', 'not'] : ['took', 'voted', 'not'];
  const labels: Partial<Record<Tab, string>> = ml
    ? { took: 'Nominated', tags: 'Tagged', not: 'Not yet' }
    : { took: 'Entered', voted: 'Voted', not: 'Not yet' };
  const counts: Partial<Record<Tab, number>> = ml
    ? { took: detail.nominations.length, tags: detail.tagged.length, not: detail.notYet.length }
    : { took: detail.entries.length, voted: detail.voters.length, not: detail.notYet.length };

  let head: string[] = [];
  let rows: ReactNode[] = [];
  if (tab === 'took' && !ml) {
    head = ['Person', 'Entry', 'Votes', 'Added'];
    rows = detail.entries.filter((e) => fl(e.by)).map((e) => (
      <tr key={e.id} className="lk-row">
        <Td><Who p={e.by} /></Td>
        <Td>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {e.photoUrl && <img src={e.photoUrl} alt="" width={44} height={44} style={{ borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />}
            <span>{e.text ? `“${e.text}”` : <span style={{ color: 'var(--ink-3)' }}>Photo only</span>}{e.mentions.length > 0 && <span style={{ ...L.cellSub, display: 'block' }}>Tags {e.mentions.join(', ')}</span>}</span>
          </span>
        </Td>
        <Td right>{e.votes}</Td>
        <Td muted>{fmtWhen(e.createdAt)}</Td>
      </tr>
    ));
  } else if (tab === 'took' && ml) {
    head = ['Person', 'Nominated', 'When'];
    rows = detail.nominations.filter((x) => fl(x.by)).map((x, i) => (
      <tr key={`${x.by.userId}-${i}`} className="lk-row">
        <Td><Who p={x.by} /></Td>
        <Td><span style={L.cellName}>{x.tagged.name}</span></Td>
        <Td muted>{fmtWhen(x.at)}</Td>
      </tr>
    ));
  } else if (tab === 'voted') {
    head = ['Voter', 'Voted for'];
    rows = detail.voters.filter((v) => fl(v.voter)).map((v) => (
      <tr key={v.voter.userId} className="lk-row">
        <Td><Who p={v.voter} /></Td>
        <Td><span style={L.cellName}>{v.forName || '—'}</span>{v.forText && <span style={{ ...L.cellSub, display: 'block' }}>“{v.forText.slice(0, 60)}{v.forText.length > 60 ? '…' : ''}”</span>}</Td>
      </tr>
    ));
  } else if (tab === 'tags') {
    head = ['Person', 'Tagged by', 'Tags'];
    rows = detail.tagged.filter((t) => fl(t.person)).map((t) => (
      <tr key={t.person.userId} className="lk-row">
        <Td><Who p={t.person} /></Td>
        <Td muted>{t.by.map((b) => b.name.split(' ')[0]).join(', ')}</Td>
        <Td right>{t.tags}</Td>
      </tr>
    ));
  } else {
    head = ['Person', 'Department', 'Location'];
    rows = detail.notYet.filter(fl).map((p) => (
      <tr key={p.userId} className="lk-row">
        <Td><Who p={p} /></Td>
        <Td muted>{p.department || '—'}</Td>
        <Td muted>{p.location || '—'}</Td>
      </tr>
    ));
  }
  const shown = more ? rows : rows.slice(0, 10);

  const took = ml ? c.voters : c.entrants;
  const leaderboard = ml
    ? detail.tagged.slice(0, 5).map((t, i) => ({ key: t.person.userId, rank: i + 1, name: t.person.name, line: t.person.name, sub: `${t.person.department || '—'} · tagged by ${t.by.slice(0, 3).map((b) => b.name.split(' ')[0]).join(', ')}${t.by.length > 3 ? ` +${t.by.length - 3}` : ''}`, n: `${t.tags} ${t.tags === 1 ? 'tag' : 'tags'}` }))
    : detail.entries.slice(0, 5).map((e, i) => ({ key: e.id, rank: i + 1, name: e.by.name, line: e.text ? `“${e.text}”` : `${e.by.name}’s photo`, sub: `${e.by.name}${e.by.department ? ` · ${e.by.department}` : ''}`, n: `${e.votes} ${e.votes === 1 ? 'vote' : 'votes'}` }));

  return (
    <>
      {header}
      <div className="en-dg">
        <div>
          <div style={{ ...L.eyebrow, color: 'var(--ink-3)', marginBottom: 8 }}>As employees see it</div>
          <ContestCard detail={detail} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <div className="en-kpis">
            <Kpi label="Audience" value={aud} sub={c.audience} />
            <Kpi label={ml ? 'Nominated' : 'Entered'} value={took} sub={`${pct(took, aud)} of audience`} />
            <Kpi label={ml ? 'Tags given' : 'Votes'} value={c.votes} sub={ml ? undefined : `${c.voters} ${c.voters === 1 ? 'voter' : 'voters'}`} />
            <Kpi label="Points given" value={c.pointsGiven} sub={`${c.pointsPerVote} per ${ml ? 'tag' : 'vote'}`} />
            <Kpi label={ml ? 'Not nominated yet' : 'Not taken part'} value={detail.notYet.length} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span style={{ ...L.cardTitle, fontSize: 15 }}>{ml ? 'Most tagged' : 'Leaderboard'}</span>
              <span style={L.cardNote}>{closed ? 'Final' : 'So far'}</span>
            </div>
            {leaderboard.length === 0 ? (
              <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>{ml ? 'No nominations yet.' : 'No entries yet.'}</div>
            ) : (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {leaderboard.map((r) => (
                  <li key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, background: r.rank === 1 ? 'var(--p-yellow)' : 'var(--surface-2)', color: r.rank === 1 ? 'var(--p-yellow-ink)' : 'var(--ink-2)', flex: '0 0 auto' }}>{r.rank}</span>
                    <Avatar name={r.name} size={30} font={12} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ ...L.cellName, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.line}</span>
                      <span style={{ ...L.cellSub, display: 'block' }}>{r.sub}</span>
                    </span>
                    <b style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.n}</b>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>

      <div className="en-two" style={{ marginTop: 22 }}>
        {(['byDepartment', 'byLocation'] as const).map((k) => (
          <div key={k}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span style={{ ...L.cardTitle, fontSize: 15 }}>Taking part by {k === 'byDepartment' ? 'department' : 'location'}</span>
              <span style={L.cardNote}>Entered, voted or nominated, of the audience there</span>
            </div>
            {detail[k].length === 0 ? (
              <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Nobody in the audience.</div>
            ) : (
              detail[k].slice(0, 8).map((g) => <BarRow key={g.group} label={g.group} value={g.took} total={g.audience} />)
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <span style={{ ...L.cardTitle, fontSize: 15 }}>People</span>
          <span style={L.cardNote}>Names are shown to HR admins</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <StatusTabs options={tabs} active={tab} labels={labels} counts={counts} onSelect={(t) => { setTab(t); setMore(false); }} />
          <SelectBox value={dept} onChange={setDept}>
            <option value="all">All departments</option>
            {depts.map((d) => <option key={d} value={d}>{d}</option>)}
          </SelectBox>
          <SearchInput value={q} onChange={setQ} placeholder="Search a name" width={220} />
        </div>
        {rows.length === 0 ? (
          <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: '8px 0' }}>Nobody here{q || dept !== 'all' ? ' with these filters' : ' yet'}.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <LookTable>
                <thead><tr>{head.map((h, i) => <Th key={h} right={(h === 'Votes' || h === 'Tags') && i > 0}>{h}</Th>)}</tr></thead>
                <tbody>{shown}</tbody>
              </LookTable>
            </div>
            {rows.length > 10 && (
              <button type="button" style={{ ...L.btnGhost, marginTop: 10 }} onClick={() => setMore((m) => !m)}>
                {more ? 'Show fewer' : `Show all ${rows.length}`}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

function exportCsv(d: ContestDetailDTO) {
  const c = d.contest;
  const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'contest';
  type Row = { name: string; dept: string; loc: string; role: string; what: string; n: string };
  const rows: Row[] =
    c.type === 'most_likely'
      ? [
          ...d.nominations.map((x) => ({ name: x.by.name, dept: x.by.department, loc: x.by.location, role: 'Nominated', what: x.tagged.name, n: '' })),
          ...d.notYet.map((p) => ({ name: p.name, dept: p.department, loc: p.location, role: 'Not yet', what: '', n: '' })),
        ]
      : [
          ...d.entries.map((e) => ({ name: e.by.name, dept: e.by.department, loc: e.by.location, role: 'Entered', what: e.text, n: String(e.votes) })),
          ...d.voters.map((v) => ({ name: v.voter.name, dept: v.voter.department, loc: v.voter.location, role: 'Voted', what: `${v.forName}: ${v.forText}`, n: '' })),
          ...d.notYet.map((p) => ({ name: p.name, dept: p.department, loc: p.location, role: 'Not yet', what: '', n: '' })),
        ];
  downloadCsv(`${slug}.csv`, [
    { header: 'Person', value: (r: Row) => r.name },
    { header: 'Department', value: (r: Row) => r.dept },
    { header: 'Location', value: (r: Row) => r.loc },
    { header: 'Took part', value: (r: Row) => r.role },
    { header: c.type === 'most_likely' ? 'Nominated' : 'Entry or voted for', value: (r: Row) => r.what },
    { header: 'Votes received', value: (r: Row) => r.n },
  ], rows);
}
