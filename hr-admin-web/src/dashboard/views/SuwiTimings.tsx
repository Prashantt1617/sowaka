// Suwi › Response times: every question Suwi answered in this company, how long it took, and where the
// time went (each model step, each lookup). Dashboard admins only; reads GET /suwi/timings.
import { Fragment, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Card, LoadError, SkeletonRows } from '../ui';
import { getSuwiTimings, type SuwiTimingRow } from '../../services/suwi';

const PATHS: { key: string; label: string; hint: string }[] = [
  { key: '', label: 'All', hint: '' },
  { key: 'instant', label: 'Instant', hint: 'From kept data, no AI' },
  { key: 'cache', label: 'Asked again', hint: 'The same question on unchanged data' },
  { key: 'prepared', label: 'Prepared', hint: 'Made ahead in the background' },
  { key: 'planner', label: 'Planner', hint: 'Known question: lookups + one short write' },
  { key: 'router', label: 'Two steps', hint: 'Small model picks lookups, one writer answers' },
  { key: 'model', label: 'Full loop', hint: 'Changes, files and sheets' },
];
const LABEL: Record<string, string> = Object.fromEntries(PATHS.filter((p) => p.key).map((p) => [p.key, p.label]));

const secs = (ms: number | null | undefined) => (ms === null || ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
function tone(ms: number | null): string {
  if (ms === null) return 'var(--muted)';
  if (ms < 1000) return 'var(--good, #1f9d55)';
  if (ms < 3000) return 'var(--warn, #b7791f)';
  return 'var(--bad, #c53030)';
}

const th: CSSProperties = { textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--muted)', padding: '10px 12px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const td: CSSProperties = { fontSize: 13, padding: '10px 12px', borderBottom: '1px solid var(--line)', verticalAlign: 'top' };
const chip = (on: boolean): CSSProperties => ({ height: 30, padding: '0 12px', borderRadius: 999, border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: on ? 'var(--ink)' : 'var(--surface)', color: on ? 'var(--surface)' : 'var(--ink)', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer' });

export function SuwiTimings() {
  const [rows, setRows] = useState<SuwiTimingRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [path, setPath] = useState('');
  const [slowOnly, setSlowOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);

  const query = (before?: string) => ({ before, path, slowMs: slowOnly ? 3000 : undefined, q: search.trim() || undefined, limit: 50 });
  const load = () => {
    setFailed(false); setRows(null);
    getSuwiTimings(query()).then((r) => { setRows(r.timings); setNext(r.next); }).catch(() => setFailed(true));
  };
  useEffect(load, [path, slowOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  const more = async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try { const r = await getSuwiTimings(query(next)); setRows((x) => [...(x ?? []), ...r.timings]); setNext(r.next); } catch { /* keep what is shown */ } finally { setLoadingMore(false); }
  };
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const timed = (rows ?? []).filter((r) => r.totalMs !== null);
  const sorted = [...timed].map((r) => r.totalMs as number).sort((a, b) => a - b);
  const p50 = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const p90 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] : null;
  const firsts = timed.map((r) => r.firstTextMs).filter((x): x is number => x !== null).sort((a, b) => a - b);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[['Questions shown', String(rows?.length ?? '—')], ['Typical answer', secs(p50)], ['Slowest 10% from', secs(p90)], ['First words, typical', secs(firsts.length ? firsts[Math.floor(firsts.length / 2)] : null)]].map(([k, v]) => (
          <Card key={k} padded><div style={{ fontSize: 12, color: 'var(--muted)' }}>{k}</div><div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{v}</div></Card>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {PATHS.map((p) => <button key={p.key || 'all'} type="button" title={p.hint} style={chip(path === p.key)} onClick={() => setPath(p.key)}>{p.label}</button>)}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginLeft: 8 }}>
          <input type="checkbox" checked={slowOnly} onChange={(e) => setSlowOnly(e.target.checked)} /> Slower than 3 s
        </label>
        <form onSubmit={(e) => { e.preventDefault(); load(); }} style={{ marginLeft: 'auto' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions" aria-label="Search questions"
            style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, minWidth: 220 }} />
        </form>
      </div>

      <Card>
        {failed ? <LoadError onRetry={load} /> : rows === null ? <SkeletonRows rows={8} cols={6} avatar={false} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['When', 'Who', 'Question', 'How', 'Total', 'First words', 'Slowest step'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td style={{ ...td, color: 'var(--muted)' }} colSpan={7}>No questions match.</td></tr>}
                {rows.map((r) => {
                  const key = `${r.at}|${r.userId}`;
                  const steps = [...(r.rounds ?? []).map((x) => ({ what: `${x.step === 'router' ? 'Picking lookups' : x.step === 'writer' ? 'Writing' : 'AI round'}${x.model ? ` · ${x.model}` : ''}`, ms: x.ms })), ...r.tools.map((t) => ({ what: `Lookup · ${t.label || t.name}`, ms: t.ms }))];
                  const slowest = steps.sort((a, b) => b.ms - a.ms)[0];
                  return (
                    <Fragment key={key}>
                      <tr onClick={() => toggle(key)} style={{ cursor: 'pointer' }}>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                        <td style={td}>{r.user ?? '—'}{r.page ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.page}</div> : null}</td>
                        <td style={{ ...td, maxWidth: 360 }}>{r.question}{r.status && r.status !== 'answered' ? <span style={{ color: 'var(--bad, #c53030)' }}> · {r.status}</span> : null}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.path ? LABEL[r.path] ?? r.path : 'Before timings'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600, color: tone(r.totalMs) }}>{secs(r.totalMs)}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{secs(r.firstTextMs)}</td>
                        <td style={{ ...td, fontSize: 12 }}>{slowest ? `${slowest.what} · ${secs(slowest.ms)}` : '—'}</td>
                      </tr>
                      {open.has(key) && (
                        <tr><td colSpan={7} style={{ ...td, background: 'var(--canvas, var(--surface))' }}>
                          <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                            {(r.rounds ?? []).map((x, i) => <div key={`r${i}`}>{x.step === 'router' ? 'Picking lookups' : x.step === 'writer' ? 'Writing' : `AI round ${i + 1}`}{x.model ? ` (${x.model})` : ''}: <b>{secs(x.ms)}</b> · {x.input.toLocaleString('en-IN')} tokens in, {x.output.toLocaleString('en-IN')} out</div>)}
                            {r.tools.map((t, i) => <div key={`t${i}`}>Lookup {t.label || t.name}: <b>{secs(t.ms)}</b>{t.timedOut ? ' · not loaded in time' : !t.ok ? ' · failed' : t.memo ? ' · reused' : ''}</div>)}
                            {r.tokens ? <div>Tokens: {r.tokens.input.toLocaleString('en-IN')} in ({(r.tokens.cacheRead ?? 0).toLocaleString('en-IN')} from cache), {r.tokens.output.toLocaleString('en-IN')} out{r.costUsd ? ` · $${r.costUsd.toFixed(4)}` : ''}</div> : null}
                            {!r.rounds?.length && !r.tools.length ? <div style={{ color: 'var(--muted)' }}>No model or lookups: answered from kept data.</div> : null}
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {next && <div style={{ padding: 12, textAlign: 'center' }}><button type="button" style={chip(false)} onClick={more} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show more'}</button></div>}
          </div>
        )}
      </Card>
    </div>
  );
}
