// Dashboard › Engagement › App usage: how many people are on the app, how far
// they have set it up, and what they do in it, as the prototype draws it.
//
// One request brings everyone with yes/no answers for the dates picked; the
// department and location filters and every count are worked out here, so
// switching tabs or filters is instant. "When people open the app" and the
// usage over time ask the server on their own. Opening the app is only known
// from the day tracking began; dates before it read "not tracked".
import { useMemo, useState } from 'react';
import { getUsageSummary, remindPeople } from '../../../services/engagement-usage';
import { ApiError } from '../../../services/http';
import { useLoad } from '../../useLoad';
import { useStore } from '../../store';
import { DateRange, LoadError, SelectBox, SkeletonCards, SkeletonPage, StatusTabs, SummaryCard } from '../../ui';
import { Modal } from '../kpiUi';
import * as L from '../look';
import { addDays, istToday, pct, plural, rangeLabel, sd } from './usage/format';
import type { Person } from './usage/parts';
import { FunnelTab, StatusTab, UseTab } from './usage/tabs';
import type { TabCtx } from './usage/tabs';
import { TrendTab } from './usage/trend';

type Tab = 'funnel' | 'trend' | 'status' | 'use';
const TABS: Tab[] = ['funnel', 'use', 'status', 'trend'];
const TAB_LABEL: Record<Tab, string> = {
  funnel: 'Funnel', trend: 'Over time', status: 'Active & inactive', use: 'What they use',
};
const QUICK: [string, number][] = [['Last 7 days', -6], ['Last 30 days', -29], ['Last 3 months', -89]];

export function AppUsage() {
  const { flash } = useStore();
  const today = istToday();
  const [tab, setTab] = useState<Tab>('funnel');
  const [range, setRange] = useState<[string, string]>([addDays(today, -29), today]);
  const [dept, setDept] = useState('All');
  const [loc, setLoc] = useState('All');
  const [open, setOpen] = useState('');
  const [confirm, setConfirm] = useState<Person[] | null>(null);
  const [sending, setSending] = useState(false);
  const [from, to] = range;
  const { data, state, retry } = useLoad(() => getUsageSummary(from, to), [from, to]);

  const people = useMemo(
    () => (data?.people ?? []).filter((p) => (dept === 'All' || p.dept === dept) && (loc === 'All' || p.loc === loc)),
    [data, dept, loc],
  );
  const names = useMemo(() => new Map((data?.people ?? []).map((p) => [p.id, p.name])), [data]);
  const nameOf = (id: string) => names.get(id) ?? '—';

  const pick = (a: string, b: string) => {
    if (!a || !b || a > b || b > today) return;
    setRange([a, b]);
    setOpen('');
  };
  const pickTab = (t: Tab) => {
    setTab(t);
    setOpen('');
  };

  const tracking = data?.trackingSince ?? null;
  const untracked = !tracking || to < tracking;
  const opened = people.filter((p) => p.opened).length;
  const logged = people.filter((p) => p.loggedIn).length;
  const profile = people.filter((p) => p.loggedIn && p.photo && p.interests && (p.group !== 'app' || p.face)).length;

  const send = async () => {
    if (!confirm) return;
    setSending(true);
    try {
      const r = await remindPeople(confirm.map((p) => p.id));
      flash(r.sent
        ? `Reminder sent to ${plural(r.sent, 'person', 'people')}${r.skipped ? ` · ${r.skipped} skipped (reminded this week, or not signed in)` : ''}`
        : 'Nobody to remind: everyone here was reminded this week or has not signed in');
      setConfirm(null);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'The reminder could not be sent. Try again.', 'error');
    } finally {
      setSending(false);
    }
  };

  const ctx: TabCtx | null = data
    ? { summary: data, people, dept, loc, nameOf, open, toggle: (id) => setOpen((o) => (o === id ? '' : id)), untracked, onRemind: setConfirm }
    : null;

  return (
    <div className="ua">
      <div className="ua-tiles">
        {data ? (
          <>
            <SummaryCard label={`Opened the app · ${rangeLabel(from, to)}`} value={untracked ? '—' : pct(opened, people.length)} sub={untracked ? 'Not tracked for these dates' : plural(opened, 'person', 'people')} />
            <SummaryCard label="Have logged in" value={pct(logged, people.length)} sub={`${logged} of ${people.length}`} />
            <SummaryCard label="Finished their profile" value={pct(profile, people.length)} sub={`${profile} · photo, interests${people.some((p) => p.group === 'app') ? ', face check' : ''}`} />
            <SummaryCard label={`Not active · ${rangeLabel(from, to)}`} value={untracked ? '—' : people.length - opened} sub={untracked ? 'Not tracked for these dates' : 'didn’t open the app'} />
          </>
        ) : state === 'error' ? null : <SkeletonCards count={4} style={{ gridColumn: '1 / -1' }} />}
      </div>

      <div className="ua-bar">
        <StatusTabs options={TABS} active={tab} onSelect={pickTab} labels={TAB_LABEL} />
        <span className="sp" />
        <SelectBox value={dept} onChange={(v) => { setDept(v); setOpen(''); }}>
          <option value="All">All departments</option>
          {(data?.departments ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
        </SelectBox>
        <SelectBox value={loc} onChange={(v) => { setLoc(v); setOpen(''); }}>
          <option value="All">All locations</option>
          {(data?.locations ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
        </SelectBox>
      </div>

      {tab !== 'funnel' && tab !== 'trend' && (
        <div className="ua-rng">
          <DateRange from={from} to={to} onFrom={(v) => pick(v, to)} onTo={(v) => pick(from, v)} />
          {QUICK.map(([label, n]) => {
            const on = from === addDays(today, n) && to === today;
            return <button key={label} type="button" style={L.chip(on)} onClick={() => pick(addDays(today, n), today)}>{label}</button>;
          })}
          {data && (
            <span className="ua-track">
              {tracking
                ? (from < tracking ? `App opens tracked since ${sd(tracking)}; earlier days are not counted` : `App opens tracked since ${sd(tracking)}`)
                : 'App opens are not tracked yet'}
            </span>
          )}
        </div>
      )}

      {tab === 'trend' ? (
        <TrendTab dept={dept} loc={loc} />
      ) : state === 'error' ? (
        <div className="ua-card"><LoadError onRetry={retry} /></div>
      ) : !ctx ? (
        <SkeletonPage rows={6} cols={3} />
      ) : !people.length ? (
        <div className="ua-card"><p className="ua-muted" style={{ margin: 0, textAlign: 'center', padding: 24 }}>{data?.people.length ? 'Nobody matches these filters.' : 'Nobody is on the employee list yet.'}</p></div>
      ) : tab === 'funnel' ? <FunnelTab c={ctx} />
            : tab === 'status' ? <StatusTab c={ctx} />
              : <UseTab c={ctx} />}

      {confirm && (
        <Modal
          title="Remind with a push"
          width={480}
          onClose={() => !sending && setConfirm(null)}
          footer={(
            <>
              <span style={{ flex: 1 }} />
              <button type="button" className="lk-btn" style={L.btn} onClick={() => setConfirm(null)} disabled={sending}>Cancel</button>
              <button type="button" className="lk-btn-p" style={{ ...L.btnPrimary, opacity: sending ? 0.6 : 1 }} onClick={() => void send()} disabled={sending}>
                {sending ? 'Sending…' : `Send to ${plural(confirm.length, 'person', 'people')}`}
              </button>
            </>
          )}
        >
          <p style={{ margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.55 }}>
            <b>{plural(confirm.length, 'person', 'people')}</b> get one push notification on their phone, and it waits in their app inbox:
          </p>
          <div style={{ ...L.note, marginBottom: 12 }}>
            <div><b>Your team is on Sowaka</b><br />See what’s new from your colleagues: posts, games and contests.</div>
          </div>
          <p className="ua-muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
            Tapping it opens the app on the feed. Anyone reminded in the last 7 days is skipped, so nobody gets it twice in a week.
          </p>
        </Modal>
      )}
    </div>
  );
}
