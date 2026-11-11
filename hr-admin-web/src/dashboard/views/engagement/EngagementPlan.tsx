// Dashboard › Engagement › Engagement plan: one list of dates — what ran (with
// who took part and who came top), what is running, and what is coming up —
// a month at a time, with the year's mix beside it. HR can put their own
// dates in the plan; those are notes for the dashboard and reach nobody.
import { useEffect, useMemo, useState } from 'react';
import { deletePlanItem, getPlan, type PlanDTO, type PlanEntryDTO, type PlanItemInput, type PlanKind } from '../../../services/engagement-contests';
import { ApiError } from '../../../services/http';
import { useStore } from '../../store';
import { Card, EmptyRow, LoadError, PageActions, SkeletonLines, StatusTabs } from '../../ui';
import { IconPlus } from '../../icons';
import * as L from '../look';
import '../look.css';
import { requestContest } from './contests/handoff';
import { dayParts, ENGAGEMENT_CSS, fmtDay, fmtWhen, istDay } from './contests/format';
import { KIND_LABEL, nextFriday } from './plan/kinds';
import { PlanItemModal } from './plan/PlanItemModal';

const KIND_COLOR: Record<PlanKind, string> = {
  contest: 'var(--p-purple)',
  tournament: 'var(--p-orange)',
  game: 'var(--p-blue)',
  poll: 'var(--p-green)',
};
const KINDS: PlanKind[] = ['contest', 'tournament', 'game', 'poll'];

/** The monthly rhythm the plan aims for: a target, not something measured. */
const RHYTHM = { contest: 2, games: 3 };

type View = 'month' | 'up' | 'done';
type Editing = { id?: string; initial: PlanItemInput } | null;

const monthOf = (iso: string) => istDay(iso).slice(0, 7);
/** HH:MM of a moment in India time. */
const istTime = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(11, 16);
function addMonths(m: string, n: number) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const monthName = (m: string, long = true) =>
  new Date(`${m}-15T00:00:00Z`).toLocaleDateString('en-GB', { month: long ? 'long' : 'short', year: long ? 'numeric' : undefined, timeZone: 'UTC' });

function DateBlock({ iso, color, dashed }: { iso: string; color: string; dashed?: boolean }) {
  const p = dayParts(iso);
  return (
    <div
      style={{
        width: '100%', borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0', lineHeight: 1.1,
        background: dashed ? 'none' : `color-mix(in srgb, ${color} 12%, var(--surface))`,
        border: dashed ? `1.5px dashed color-mix(in srgb, ${color} 45%, var(--line))` : '1px solid transparent',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{p.weekday}</span>
      <b style={{ fontSize: 22, fontWeight: 600, color: `color-mix(in srgb, ${color} 70%, var(--ink))` }}>{p.day}</b>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{p.month}</span>
    </div>
  );
}

function stateLabel(e: PlanEntryDTO) {
  if (e.state === 'running') return e.end ? `running until ${fmtDay(e.end)}` : 'running';
  if (e.state === 'planned') return e.planItemId ? 'planned by HR' : 'scheduled';
  return 'done';
}

function PlanRow({ e, onOpen, onEdit, onDelete }: { e: PlanEntryDTO; onOpen: (e: PlanEntryDTO) => void; onEdit: (e: PlanEntryDTO) => void; onDelete: (e: PlanEntryDTO) => void }) {
  const color = KIND_COLOR[e.kind];
  // A date HR saved without a time sits at midnight India time: no time to show.
  const time = e.planItemId && istTime(e.at) === '00:00' ? '' : fmtWhen(e.at).split(', ')[1];
  return (
    <div className="en-pr">
      <DateBlock iso={e.at} color={color} dashed={e.state === 'planned'} />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color }}>
          {KIND_LABEL[e.kind]} · {e.source} · {stateLabel(e)}
        </span>
        <b style={{ fontSize: 15, fontWeight: 500, overflowWrap: 'anywhere' }}>{e.title}</b>
        {time && <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{time}</span>}
        {e.note && <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{e.note}</span>}
        {e.stats.length > 0 && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6, fontSize: 12.5, color: 'var(--ink-3)' }}>
            {e.stats.map(([v, l]) => (
              <span key={l}><b style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{v}</b> {l}</span>
            ))}
          </div>
        )}
        {e.top.length > 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 4 }}>
            <span style={{ color: 'var(--ink-3)' }}>{e.kind === 'poll' ? 'Leading answers: ' : e.state === 'done' ? 'Top: ' : 'Leading: '}</span>
            {e.top.map((t, i) => (
              <span key={`${t.name}-${i}`}>{i > 0 && ', '}<b style={{ fontWeight: 500, color: 'var(--ink)' }}>{t.name}</b> ({t.value})</span>
            ))}
          </div>
        )}
      </div>
      <div className="en-pa" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
        {e.open && <button type="button" style={L.btnSm} onClick={() => onOpen(e)}>{e.state === 'done' ? 'Details' : 'Open'}</button>}
        {e.planItemId && (
          <>
            <button type="button" style={L.btnSm} onClick={() => onEdit(e)}>Edit</button>
            <button type="button" style={L.btnDanger} onClick={() => onDelete(e)}>Delete</button>
          </>
        )}
      </div>
    </div>
  );
}

export function EngagementPlan() {
  const { flash, setView } = useStore();
  const [plan, setPlan] = useState<PlanDTO | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setV] = useState<View>('month');
  const [month, setMonth] = useState(() => istDay(Date.now()).slice(0, 7));
  const [editing, setEditing] = useState<Editing>(null);

  const load = async () => {
    setFailed(false);
    try {
      setPlan(await getPlan());
    } catch (e) {
      setFailed(true);
      flash(e instanceof ApiError ? e.message : 'Could not load the plan', 'error');
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const thisMonth = istDay(Date.now()).slice(0, 7);
  const entries = useMemo(() => plan?.entries ?? [], [plan]);
  const yearFrom = plan ? monthOf(plan.yearFrom) : thisMonth;
  const yearLast = addMonths(yearFrom, 11);

  const open = (e: PlanEntryDTO) => {
    if (!e.open) return;
    if (e.open.view === 'contests') requestContest(e.open.id);
    setView(e.open.view);
  };
  const edit = (e: PlanEntryDTO) => {
    if (!e.planItemId) return;
    const hhmm = istTime(e.at);
    setEditing({ id: e.planItemId, initial: { date: istDay(e.at), time: hhmm === '00:00' ? '' : hhmm, kind: e.kind, title: e.title, note: e.note ?? '' } });
  };
  const remove = async (e: PlanEntryDTO) => {
    if (!e.planItemId || !window.confirm(`Take “${e.title}” on ${fmtDay(e.at)} out of the plan?`)) return;
    try {
      await deletePlanItem(e.planItemId);
      flash('Taken out of the plan');
      void load();
    } catch (err) {
      flash(err instanceof ApiError ? err.message : 'Could not delete', 'error');
    }
  };

  // The month's dates: what started in it, plus anything still running from before when it is this month.
  const monthRows = useMemo(
    () =>
      entries
        .filter((e) => monthOf(e.at) === month || (month === thisMonth && e.state === 'running' && monthOf(e.at) < month))
        .sort((a, b) => a.at.localeCompare(b.at)),
    [entries, month, thisMonth],
  );
  const upcoming = entries.filter((e) => e.state !== 'done').sort((a, b) => a.at.localeCompare(b.at));
  const done = entries.filter((e) => e.state === 'done').sort((a, b) => b.at.localeCompare(a.at));

  const inMonth = (m: string, kinds: PlanKind[]) => entries.filter((e) => monthOf(e.at) === m && kinds.includes(e.kind)).length;
  const nContest = inMonth(month, ['contest']);
  const nGames = inMonth(month, ['tournament', 'game']);

  // The year's mix: everything dated in this financial year, done and planned.
  const yearEntries = entries.filter((e) => monthOf(e.at) >= yearFrom && monthOf(e.at) <= yearLast);
  const mix = KINDS.map((k) => ({ k, n: yearEntries.filter((e) => e.kind === k).length, done: yearEntries.filter((e) => e.kind === k && e.state === 'done').length }));
  const months = Array.from({ length: 12 }, (_, i) => addMonths(yearFrom, i));
  const perMonth = months.map((m) => ({ m, by: KINDS.map((k) => inMonth(m, [k])) }));
  const maxMonth = Math.max(1, ...perMonth.map((p) => p.by.reduce((s, v) => s + v, 0)));

  const d90 = Date.now() - 90 * 86_400_000;
  const recent = done.filter((e) => new Date(e.at).getTime() >= d90);

  const rowList = (list: PlanEntryDTO[], empty: string) =>
    list.length ? list.map((e) => <PlanRow key={e.key} e={e} onOpen={open} onEdit={edit} onDelete={(x) => void remove(x)} />) : <EmptyRow text={empty} />;

  return (
    <div style={{ animation: 'fade .3s ease both', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <style>{ENGAGEMENT_CSS}</style>
      <PageActions>
        <button type="button" style={L.btnPrimary} onClick={() => setEditing({ initial: { date: nextFriday(), time: '', kind: 'contest', title: '', note: '' } })}>
          <IconPlus /> Create a plan
        </button>
      </PageActions>
      <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
        What’s coming up and what’s already done, keeping a healthy mix of contests, tournaments and games across the year.
      </div>

      {failed && !plan ? (
        <Card><LoadError onRetry={() => void load()} /></Card>
      ) : (
        <div className="en-plan">
          <Card padded>
            <div style={{ marginBottom: 14 }}>
              <StatusTabs
                options={['month', 'up', 'done'] as View[]}
                active={view}
                onSelect={setV}
                labels={{ month: 'Month', up: 'Coming up', done: 'Done' }}
                counts={plan ? { up: upcoming.length, done: done.length } : undefined}
              />
            </div>
            {!plan ? (
              <SkeletonLines lines={8} />
            ) : view === 'month' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
                  <button type="button" aria-label="Previous month" style={L.btnSm} disabled={month <= yearFrom} onClick={() => setMonth(addMonths(month, -1))}>‹</button>
                  <h2 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-.02em', margin: '0 4px', minWidth: 180, textAlign: 'center' }}>{monthName(month)}</h2>
                  <button type="button" aria-label="Next month" style={L.btnSm} disabled={month >= yearLast} onClick={() => setMonth(addMonths(month, 1))}>›</button>
                  {month !== thisMonth && <button type="button" style={L.btnGhost} onClick={() => setMonth(thisMonth)}>This month</button>}
                  <span style={{ flex: 1 }} />
                  <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {([[nContest, RHYTHM.contest, 'Contests'], [nGames, RHYTHM.games, 'Tournaments & games']] as const).map(([v, t, l]) => (
                      <span key={l} style={{ fontSize: 12.5, borderRadius: 99, padding: '4px 10px', border: '1px solid var(--line)', background: v >= t ? 'var(--ok-bg)' : 'var(--surface-2)', color: v >= t ? 'var(--ok)' : 'var(--ink-2)' }}>
                        <b style={{ fontVariantNumeric: 'tabular-nums' }}>{v}/{t}</b> {l}
                      </span>
                    ))}
                  </span>
                </div>
                {rowList(monthRows, 'Nothing in this month. Create a plan for one of its Fridays.')}
              </>
            ) : view === 'up' ? (
              rowList(upcoming, 'Nothing running or coming up. Create a plan to add a date.')
            ) : (
              <>
                <div className="en-kpis" style={{ marginBottom: 8 }}>
                  {[[recent.length, 'done in the last 90 days'] as const, ...KINDS.map((k) => [recent.filter((e) => e.kind === k).length, `${KIND_LABEL[k]}s`] as const)].map(([v, l]) => (
                    <div key={l} style={{ background: 'var(--surface-2)', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column' }}>
                      <b style={{ fontSize: 22, fontWeight: 500 }}>{v}</b>
                      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{l}</span>
                    </div>
                  ))}
                </div>
                {rowList(done, 'Nothing has run this year yet.')}
              </>
            )}
          </Card>

          <aside style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Card padded>
              <div style={L.cardTitle}>Mix this year</div>
              <div style={{ ...L.cardNote, marginBottom: 12 }}>{plan ? `${monthName(yearFrom, false)} – ${monthName(yearLast, false)}` : ''} · done and planned</div>
              {!plan ? (
                <SkeletonLines lines={3} />
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 3, height: 26, borderRadius: 8, overflow: 'hidden', background: 'var(--surface-2)' }}>
                    {mix.filter((m) => m.n > 0).map((m) => (
                      <i key={m.k} title={`${KIND_LABEL[m.k]} ${m.n}`} style={{ flex: m.n, background: KIND_COLOR[m.k], minWidth: 2 }} />
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
                    {mix.map((m) => (
                      <div key={m.k} style={{ display: 'flex', flexDirection: 'column', fontSize: 12.5 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                          <i style={{ width: 8, height: 8, borderRadius: '50%', background: KIND_COLOR[m.k] }} />
                          {KIND_LABEL[m.k]}s
                        </span>
                        <b style={{ fontSize: 20, fontWeight: 500 }}>{m.n}</b>
                        <small style={{ color: 'var(--ink-3)' }}>{yearEntries.length ? `${Math.round((m.n / yearEntries.length) * 100)}%` : '—'} · {m.done} done</small>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>

            <Card padded>
              <div style={L.cardTitle}>Month by month</div>
              <div style={{ ...L.cardNote, marginBottom: 12 }}>How many of each, done and planned</div>
              {!plan ? (
                <SkeletonLines lines={4} />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 4, alignItems: 'end', height: 120 }}>
                  {perMonth.map((p) => (
                    <button
                      key={p.m}
                      type="button"
                      title={`${monthName(p.m)}: ${p.by.map((v, i) => `${v} ${KIND_LABEL[KINDS[i]].toLowerCase()}`).join(', ')}`}
                      onClick={() => { setMonth(p.m); setV('month'); }}
                      style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch', height: '100%', padding: 0, border: 'none', background: 'none', cursor: 'pointer', gap: 4 }}
                    >
                      <span style={{ display: 'flex', flexDirection: 'column-reverse', gap: 1, height: `${(p.by.reduce((s, v) => s + v, 0) / maxMonth) * 88}px`, borderRadius: 4, overflow: 'hidden', outline: p.m === month && view === 'month' ? '2px solid var(--sel)' : 'none' }}>
                        {p.by.map((v, i) => (v > 0 ? <i key={i} style={{ flex: v, background: KIND_COLOR[KINDS[i]] }} /> : null))}
                      </span>
                      <span style={{ fontSize: 10, color: p.m === thisMonth ? 'var(--ink)' : 'var(--ink-3)', fontWeight: p.m === thisMonth ? 600 : 400, textAlign: 'center' }}>{monthName(p.m, false).slice(0, 1)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ ...L.note, marginTop: 14, fontSize: 12.5 }}>
                The plan’s target each month: {RHYTHM.contest} contests and {RHYTHM.games} tournaments or games, all on Fridays.
              </div>
            </Card>
          </aside>
        </div>
      )}

      {editing && (
        <PlanItemModal
          id={editing.id}
          initial={editing.initial}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
