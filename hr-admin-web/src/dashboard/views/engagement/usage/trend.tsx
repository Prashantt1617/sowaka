// App usage over time, and when in the day and week people open the app.
// Both come from the server's daily app activity log, which only starts on
// the day it shipped: days before are drawn hatched as "not tracked", unless
// they were filled in from app activity (punches, requests, posts, games…),
// which the chart draws like any other day. "When" uses tracked days only.
import { useState } from 'react';
import { getUsageTrend } from '../../../../services/engagement-usage';
import type { UsageWhenDTO } from '../../../../services/engagement-usage';
import type { LoadState } from '../../../ui';
import { useLoad } from '../../../useLoad';
import { DateRange, LoadError, SkeletonLines, StatusTabs } from '../../../ui';
import * as L from '../../look';
import { Card, Columns, GroupLegend, Kpis } from './parts';
import { GROUPS, GROUP_COLOR, GROUP_SHORT, addDays, istToday, plural, rangeLabel, sd, sdw } from './format';

const HOUR = (h: number) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The "when" answer, loaded by the page alongside the summary rather than after it. */
export type WhenLoad = { data: UsageWhenDTO | null | undefined; state: LoadState; retry: () => void };

/** "When people open the app": hours of the day and weekdays, for the dates and filters picked. */
export function WhenPanel({ from, to, load }: { from: string; to: string; load: WhenLoad }) {
  const { data, state, retry } = load;
  return (
    <div className="ua-panel">
      <div className="ua-card-h" style={{ marginBottom: 6 }}>
        <div>
          <h3 style={{ fontSize: 14 }}>When people open the app</h3>
          <small>
            People with the app open in each hour, and on each weekday, added up across {rangeLabel(from, to)}
            {data?.trackingSince && data.trackingSince > from ? ` · tracked since ${sd(data.trackingSince)}` : ''}
          </small>
        </div>
      </div>
      {state === 'loading' && <SkeletonLines lines={4} />}
      {state === 'error' && <LoadError compact onRetry={retry} />}
      {data && (data.trackedDays === 0 ? (
        <p className="ua-muted" style={{ margin: 0, fontSize: 13 }}>
          {data.trackingSince ? `Not tracked for these dates: app opens are counted from ${sd(data.trackingSince)}.` : 'App opens are not tracked yet.'}
        </p>
      ) : (
        <div className="ua-when">
          <div>
            <Columns
              height={150}
              cols={data.hours.map((n, h) => ({ key: String(h), label: h % 3 === 0 ? HOUR(h) : '', parts: [{ v: n, color: 'var(--accent)' }], tip: `${HOUR(h)}–${HOUR((h + 1) % 24)}: ${n}` }))}
            />
          </div>
          <div>
            <Columns
              height={150}
              cols={data.weekdays.map((n, i) => ({ key: WEEK[i], label: WEEK[i], parts: [{ v: n, color: 'var(--accent)' }], tip: `${WEEK[i]}: ${plural(n, 'person-day', 'person-days')}` }))}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

type Gran = 'date' | 'week' | 'month';
const QUICK: Record<'date' | 'week', [string, number][]> = {
  date: [['Last 7 days', -6], ['Last 30 days', -29], ['Last 90 days', -89]],
  week: [['Last 4 weeks', -27], ['Last 12 weeks', -83], ['Last 26 weeks', -181]],
};

/** 6. Usage over time: active people per day, week or month, split by attendance group. */
export function TrendTab({ dept, loc }: { dept: string; loc: string }) {
  const today = istToday();
  const [gran, setGran] = useState<Gran>('date');
  const [split, setSplit] = useState(true);
  const [ranges, setRanges] = useState<Record<'date' | 'week', [string, string]>>({
    date: [addDays(today, -29), today],
    week: [addDays(today, -83), today],
  });
  const R = gran === 'month' ? null : ranges[gran];
  const from = R ? R[0] : '';
  const to = R ? R[1] : today;
  const { data, state, retry } = useLoad(() => getUsageTrend(gran, from || today, to, dept, loc), [gran, from, to, dept, loc]);
  const setR = (a: string, b: string) => {
    if (gran === 'month' || !a || !b || a > b || b > today) return;
    setRanges((r) => ({ ...r, [gran]: [a, b] }));
  };
  const unit = gran === 'date' ? 'day' : gran === 'week' ? 'week' : 'month';
  const anyEst = Boolean(data?.buckets.some((b) => b.estimated));
  const anyOff = Boolean(data?.buckets.some((b) => b.untracked && (!data.trackingSince || b.to < data.trackingSince)));
  const tracked = data?.buckets.filter((b) => !b.untracked) ?? [];
  const totals = tracked.map((b) => b.app + b.bio + b.present);
  const first = totals[0] ?? 0;
  const last = totals[totals.length - 1] ?? 0;
  const change = first ? Math.round(((last - first) / first) * 100) : null;
  const avg = totals.length ? Math.round(totals.reduce((s, n) => s + n, 0) / totals.length) : 0;
  const label = (a: string) => {
    if (gran === 'month') return new Date(`${a}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
    return gran === 'date' ? String(Number(a.slice(8))) : sd(a);
  };
  return (
    <Card title="App usage over time" note={`People who opened the app each ${unit}${split ? ', by attendance group' : ''}`}>
      <div className="ua-bar">
        <StatusTabs options={['date', 'week', 'month']} active={gran} onSelect={setGran} labels={{ date: 'Date-wise', week: 'Week-wise', month: 'Month-wise' }} />
        <span className="sp" />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Split by group
        </label>
      </div>
      {R ? (
        <div className="ua-bar" style={{ marginTop: 12 }}>
          <DateRange from={R[0]} to={R[1]} onFrom={(v) => setR(v, R[1])} onTo={(v) => setR(R[0], v)} />
          {QUICK[gran as 'date' | 'week'].map(([l, n]) => {
            const on = R[0] === addDays(today, n) && R[1] === today;
            return <button key={l} type="button" style={L.chip(on)} onClick={() => setR(addDays(today, n), today)}>{l}</button>;
          })}
        </div>
      ) : <p className="ua-muted" style={{ margin: '10px 0 0', fontSize: 12.5 }}>Month on month, last 7 months. This month is so far.</p>}
      <div style={{ marginTop: 14 }}>
        {state === 'loading' && <SkeletonLines lines={6} />}
        {state === 'error' && <LoadError onRetry={retry} />}
        {data && (
          <>
            <Kpis items={[
              [`First ${unit}`, tracked.length ? first : '—', tracked[0] ? sd(tracked[0].from) : 'Not tracked'],
              ['Latest', tracked.length ? last : '—', tracked.length ? sd(tracked[tracked.length - 1].from) : 'Not tracked'],
              ['Change', change == null ? '—' : `${change > 0 ? '+' : ''}${change}%`, 'first to latest tracked'],
              ['Average', tracked.length ? avg : '—', `per ${unit}`],
            ]} />
            <Columns
              cols={data.buckets.map((b) => {
                const total = b.app + b.bio + b.present;
                const when = b.from === b.to ? sdw(b.from) : rangeLabel(b.from, b.to);
                const tip = b.untracked
                  ? `${when}: not tracked`
                  : `${when}: ${total}${split ? ` (${GROUPS.map((g) => `${GROUP_SHORT[g]} ${b[g]}`).join(', ')})` : ''}${b.partial ? ' · tracked part of it' : ''}`;
                return {
                  key: b.from,
                  label: label(b.from),
                  off: b.untracked,
                  part: b.partial,
                  tip,
                  parts: split ? GROUPS.map((g) => ({ v: b[g], color: GROUP_COLOR[g] })) : [{ v: total, color: 'var(--accent)' }],
                };
              })}
            />
            {split && <GroupLegend counts={data.groups} />}
            <p className="ua-note">
              {anyEst ? '' : data.trackingSince ? `App opens are tracked from ${sd(data.trackingSince)}. ` : 'App opens are not tracked yet: they start counting from the first time someone opens the app.'}
              {data.trackingSince && anyOff && `Hatched ${unit}s are not tracked (not zero). `}
              {data.trackingSince && `A person counts once per ${unit}.`}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
