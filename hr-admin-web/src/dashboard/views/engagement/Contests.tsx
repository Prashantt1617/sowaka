// Dashboard › Engagement › Contests: Caption this, Best photo and Most likely.
// The list of the company's contests (running, then ended), what really
// happened in the one picked, and the composer to start a new one.
import { useEffect, useState } from 'react';
import { getContests, type ContestListDTO, type ContestSummaryDTO } from '../../../services/engagement-contests';
import { ApiError } from '../../../services/http';
import { useStore } from '../../store';
import { Card, EmptyRow, ListPending, LoadingFigure, PageActions, SummaryCard, type LoadState } from '../../ui';
import { IconPlus } from '../../icons';
import * as L from '../look';
import '../look.css';
import { ContestComposer, FORMATS } from './contests/ContestComposer';
import { ContestDetail } from './contests/ContestDetail';
import { clearRequestedContest, requestedContest } from './contests/handoff';
import { CONTEST_LABEL, ENGAGEMENT_CSS, fmtDay, timeLeft } from './contests/format';

type Mode = 'list' | 'new';

function ContestRow({ c, on, onPick }: { c: ContestSummaryDTO; on: boolean; onPick: () => void }) {
  const icon = FORMATS.find((f) => f.type === c.type)?.icon;
  const ml = c.type === 'most_likely';
  return (
    <button type="button" className="en-row" aria-pressed={on} onClick={onPick}>
      {icon && <img src={icon} alt="" width={32} height={32} style={{ borderRadius: 9, objectFit: 'cover', flex: '0 0 auto' }} />}
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</b>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {CONTEST_LABEL[c.type]} · {c.status === 'live' ? timeLeft(c.closesAt) : `ended ${fmtDay(c.closesAt)}`}
        </span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.15 }}>
        <b style={{ fontSize: 16, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{ml ? c.votes : c.entries}</b>
        <small style={{ fontSize: 11, color: 'var(--ink-3)' }}>{ml ? 'tags' : 'entries'}</small>
      </span>
    </button>
  );
}

export function Contests() {
  const { flash } = useStore();
  const [data, setData] = useState<ContestListDTO | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [mode, setMode] = useState<Mode>('list');
  const [sel, setSel] = useState<string | null>(() => requestedContest());

  const load = async (pick?: 'newest') => {
    try {
      const d = await getContests();
      setData(d);
      setState('ready');
      if (pick === 'newest' && d.contests[0]) setSel(d.contests[0].id);
    } catch (e) {
      setState((s) => (s === 'ready' ? s : 'error'));
      flash(e instanceof ApiError ? e.message : 'Could not load contests', 'error');
    }
  };
  useEffect(() => {
    clearRequestedContest();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = data?.contests ?? [];
  const live = all.filter((c) => c.status === 'live').sort((a, b) => (a.closesAt ?? '9').localeCompare(b.closesAt ?? '9'));
  const ended = all.filter((c) => c.status === 'closed').sort((a, b) => (b.closesAt ?? '').localeCompare(a.closesAt ?? ''));
  // The one picked, else the first running, else the latest ended.
  const current = all.find((c) => c.id === sel) ?? live[0] ?? ended[0] ?? null;

  return (
    <div style={{ animation: 'fade .3s ease both', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <style>{ENGAGEMENT_CSS}</style>
      <PageActions>
        {mode === 'list' && (
          <button type="button" style={L.btnPrimary} onClick={() => setMode('new')}>
            <IconPlus /> Start a new contest
          </button>
        )}
      </PageActions>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={L.seg} role="tablist" aria-label="Section">
          <button type="button" role="tab" aria-selected={mode === 'list'} style={L.segBtn(mode === 'list')} onClick={() => setMode('list')}>
            Contests <span style={L.segCount}><LoadingFigure state={state} w={14} h={10}>{all.length}</LoadingFigure></span>
          </button>
          <button type="button" role="tab" aria-selected={mode === 'new'} style={L.segBtn(mode === 'new')} onClick={() => setMode('new')}>
            Start a new contest
          </button>
        </div>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Caption this, Best photo and Most likely. See how each one is going, or start a new one.</span>
      </div>

      {mode === 'new' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          <ContestComposer
            onPublished={async () => {
              await load('newest');
              setMode('list');
            }}
          />
          <div style={{ ...L.note, flex: '1 1 260px', maxWidth: 420 }}>
            Type on the card: this is what employees see in the feed. Pick how many points each vote is worth and when it
            closes, then Go live. It appears in everyone’s Connect feed straight away.
          </div>
        </div>
      ) : (
        <>
          <div className="en-tiles">
            <SummaryCard label="Running now" value={<LoadingFigure state={state}>{live.length}</LoadingFigure>} />
            <SummaryCard label="Ended" value={<LoadingFigure state={state}>{ended.length}</LoadingFigure>} />
            <SummaryCard label="Took part" value={<LoadingFigure state={state}>{data?.last30.people ?? 0}</LoadingFigure>} sub="Contests started in the last 30 days" />
            <SummaryCard label="Votes and tags" value={<LoadingFigure state={state}>{data?.last30.votes ?? 0}</LoadingFigure>} sub="Contests started in the last 30 days" />
          </div>
          <div className="en-grid">
            <Card padded>
              <div style={{ ...L.cardTitle, marginBottom: 8 }}>Contests</div>
              {state !== 'ready' && <ListPending state={state} onRetry={() => { setState('loading'); void load(); }} rows={4} cols={1} rowHeight={56} />}
              {state === 'ready' && all.length === 0 && <EmptyRow text="No contests yet. Start one from the button above." />}
              {([['Running now', live], ['Ended', ended]] as const).map(([label, list]) =>
                list.length ? (
                  <div key={label}>
                    <div style={{ ...L.eyebrow, color: 'var(--ink-3)', margin: '12px 0 6px' }}>{label}</div>
                    {list.map((c) => <ContestRow key={c.id} c={c} on={current?.id === c.id} onPick={() => setSel(c.id)} />)}
                  </div>
                ) : null,
              )}
            </Card>
            <Card padded>
              {current ? (
                <ContestDetail
                  key={current.id}
                  summary={current}
                  onDeleted={() => {
                    setSel(null);
                    void load();
                  }}
                />
              ) : state === 'ready' ? (
                <EmptyRow text="Pick a contest on the left, or start a new one." />
              ) : (
                <ListPending state={state} rows={5} cols={2} />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
