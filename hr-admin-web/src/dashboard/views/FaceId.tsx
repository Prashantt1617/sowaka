// Shifts › Face ID — the company's switches, who has set it up, and the checks
// that failed.
//
// Both switches start off, so it can be rolled out a company at a time: first
// ask everyone to set it up, then, once most have, check faces at punch-in.
// The enrolment photos and face templates are never shown here — only who has
// one, and the outcome and score of each check. A reset deletes the face, and
// the person is asked to set it up again in the app.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { STAT } from '../theme';
import { Card, DateRange, EmptyRow, ListPending, LoadingFigure, Pill, SearchInput, StatusTabs, SummaryCard, Th } from '../ui';
import { useLoad } from '../useLoad';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, cardNote, cardTitle, cellName, cellSub, TH, toolbar, TR } from '../ds';
import {
  getFaceChecks, getFaceIdOverview, resetFaceId, updateFaceIdSettings,
  type FaceCheckDTO, type FaceIdPersonDTO, type FaceIdSettingsDTO,
} from '../../services/hrms';

const PEOPLE_COLS = '1.8fr 1fr 1fr 1.2fr .8fr .9fr';
const CHECK_COLS = '1.6fr 1.1fr 1.8fr .7fr 1fr 1.3fr';

const todayIso = () => new Date().toISOString().slice(0, 10);
const weekAgoIso = () => new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
    : '—';

const SET_UP = { bg: 'var(--ok-bg)', fg: 'var(--ok)' };
const NOT_SET_UP = STAT.Pending;

export function FaceId() {
  const { flash } = useStore();
  const [tab, setTab] = useState<'people' | 'checks'>('people');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [from, setFrom] = useState(weekAgoIso());
  const [to, setTo] = useState(todayIso());

  const overview = useLoad(() => getFaceIdOverview(), []);
  const f = from || weekAgoIso();
  const t = to || todayIso();
  const checks = useLoad(() => (tab === 'checks' ? getFaceChecks(f, t) : Promise.resolve([] as FaceCheckDTO[])), [tab, f, t]);
  useEffect(() => {
    const error = overview.error ?? checks.error;
    if (error instanceof Error) flash(error.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview.error, checks.error]);

  const data = overview.data;
  const people = useMemo(() => data?.people ?? [], [data]);
  const q = search.trim().toLowerCase();
  const shownPeople = useMemo(
    () => people.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.employeeId ?? '').toLowerCase().includes(q)),
    [people, q],
  );
  const shownChecks = useMemo(
    () => (checks.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || (c.employeeId ?? '').toLowerCase().includes(q)),
    [checks.data, q],
  );
  const failed30 = people.reduce((sum, p) => sum + p.failedLast30Days, 0);

  const save = async (input: Partial<FaceIdSettingsDTO>) => {
    setSaving(true);
    try {
      await updateFaceIdSettings(input);
      overview.retry();
      flash('Face ID settings saved');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Could not save Face ID settings');
    } finally {
      setSaving(false);
    }
  };

  const reset = async (person: FaceIdPersonDTO) => {
    if (!window.confirm(`Reset ${person.name}'s Face ID? Their face is deleted, and the app asks them to set it up again.`)) return;
    setResetting(person.userId);
    try {
      await resetFaceId(person.userId);
      overview.retry();
      flash(`${person.name}'s Face ID was reset`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Could not reset Face ID');
    } finally {
      setResetting(null);
    }
  };

  const raw = data?.rawSettings;
  const st = overview.state;

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        <SummaryCard label="Set up Face ID" value={<LoadingFigure state={st}>{`${data?.enrolledCount ?? 0} of ${people.length}`}</LoadingFigure>} />
        <SummaryCard label="Failed checks · 30 days" value={<LoadingFigure state={st}>{failed30}</LoadingFigure>} color="var(--warn)" />
        <SummaryCard label="Match needed" value={<LoadingFigure state={st}>{`${data?.matchThreshold ?? 95}%`}</LoadingFigure>} />
        <SummaryCard label="Live-person check" value={<LoadingFigure state={st}>{data?.liveness === 'aws' ? 'AWS Liveness' : 'In the app'}</LoadingFigure>} />
      </div>

      <Card padded style={{ marginBottom: 20 }}>
        <h3 style={cardTitle}>Face ID</h3>
        <p style={{ ...cardNote, margin: '4px 0 16px' }}>
          Confirms it is really the employee punching. Turn on setup first; check faces at punches once most people have set it up, and force the app update for the company at the same time: older apps cannot punch while faces are checked.
        </p>
        <SettingRow
          title="Ask everyone to set up Face ID"
          note="Everyone at the company is asked once in the app, whatever their attendance source."
          on={raw?.setupRequired === true || raw?.checkAtPunch === true}
          locked={raw?.checkAtPunch === true}
          disabled={saving || st !== 'ready'}
          onToggle={() => void save({ setupRequired: !(raw?.setupRequired === true) })}
        />
        <SettingRow
          title="Check faces at punch-in and punch-out"
          note="Geotag and in-app punches, both ways; biometric devices and Auto Punch are not checked. A selfie must match before the location check. After three failed tries the punch goes to the manager as a request."
          on={raw?.checkAtPunch === true}
          disabled={saving || st !== 'ready'}
          onToggle={() => void save({ checkAtPunch: !(raw?.checkAtPunch === true) })}
        />
      </Card>

      <Card padded>
        <div style={toolbar}>
          <StatusTabs
            options={['people', 'checks']}
            active={tab}
            onSelect={setTab}
            labels={{ people: 'People', checks: 'Failed checks' }}
          />
        </div>
        <div style={toolbar}>
          <div style={{ flex: 1, minWidth: 262, display: 'flex' }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search employee…" width="100%" />
          </div>
          {tab === 'checks' && <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />}
        </div>

        {tab === 'people' ? (
          <>
            <div style={TH(PEOPLE_COLS)}>
              <Th>EMPLOYEE</Th>
              <Th>FACE ID</Th>
              <Th>SET UP ON</Th>
              <Th>LAST CHECK</Th>
              <Th>FAILED · 30D</Th>
              <Th align="right">ACTION</Th>
            </div>
            {shownPeople.map((p, i) => (
              <div key={p.userId} style={TR(PEOPLE_COLS, i === shownPeople.length - 1)}>
                <Person name={p.name} userId={p.userId} sub={[p.employeeId, p.department].filter(Boolean).join(' · ')} />
                <div><Pill label={p.enrolled ? 'Set up' : 'Not set up'} tone={p.enrolled ? SET_UP : NOT_SET_UP} /></div>
                <div style={{ fontWeight: 400 }}>{when(p.enrolledAt)}</div>
                <div style={{ fontWeight: 400 }}>
                  {when(p.lastCheckAt)}
                  {p.lastCheckPassed != null && <div style={cellSub}>{p.lastCheckPassed ? 'Passed' : 'Failed'}</div>}
                </div>
                <div style={{ fontWeight: 400, color: p.failedLast30Days > 0 ? 'var(--warn)' : undefined }}>{p.failedLast30Days}</div>
                <div style={{ textAlign: 'right' }}>
                  {p.enrolled && (
                    <button
                      className={btnClass('ghost')}
                      style={btn('ghost', 'sm')}
                      disabled={resetting === p.userId}
                      onClick={() => void reset(p)}
                    >
                      {resetting === p.userId ? 'Resetting…' : 'Reset'}
                    </button>
                  )}
                </div>
              </div>
            ))}
            <ListPending state={st} onRetry={overview.retry} cols={6} />
            {st === 'ready' && shownPeople.length === 0 && <EmptyRow text="No employees match." />}
          </>
        ) : (
          <>
            <div style={TH(CHECK_COLS)}>
              <Th>EMPLOYEE</Th>
              <Th>WHEN</Th>
              <Th>REASON</Th>
              <Th>MATCH</Th>
              <Th>LIVE CHECK</Th>
              <Th>MATCHED</Th>
            </div>
            {shownChecks.map((c, i) => (
              <div key={`${c.userId}-${c.at}-${i}`} style={TR(CHECK_COLS, i === shownChecks.length - 1)}>
                <Person name={c.name} userId={c.userId} sub={[c.employeeId, c.kind === 'enrol' ? 'Setup' : 'Punch'].filter(Boolean).join(' · ')} />
                <div style={{ fontWeight: 400 }}>{when(c.at)}</div>
                <div style={{ fontWeight: 400, minWidth: 0 }} title={c.message}>{c.message}</div>
                <div style={{ fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>{c.similarity == null ? '—' : `${c.similarity.toFixed(1)}%`}</div>
                <div style={{ fontWeight: 400 }}>
                  {c.liveness === 'aws'
                    ? `AWS ${c.livenessConfidence == null ? '' : `${c.livenessConfidence.toFixed(0)}%`}`
                    : c.liveness === 'device'
                      ? c.deviceCheckPassed ? 'App prompt done' : 'App prompt not done'
                      : '—'}
                </div>
                <div>
                  {c.matchedName ? <Pill label={c.matchedName} tone={STAT.Declined} /> : <span style={cellSub}>—</span>}
                </div>
              </div>
            ))}
            <ListPending state={checks.state} onRetry={checks.retry} cols={6} />
            {checks.state === 'ready' && shownChecks.length === 0 && <EmptyRow text="No failed checks in this range." />}
          </>
        )}
      </Card>
    </div>
  );
}

function Person({ name, userId, sub }: { name: string; userId: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <PersonAvatar name={name} userId={userId} />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
    </div>
  );
}

function SettingRow({ title, note, on, locked, disabled, onToggle }: {
  title: string;
  note: string;
  on: boolean;
  /** On because another switch implies it. */
  locked?: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderTop: '1px solid var(--line)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{title}</div>
        <div style={cardNote}>{locked ? 'On while faces are checked at punches.' : note}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        disabled={disabled || locked}
        onClick={onToggle}
        style={{
          width: 40, height: 22, borderRadius: 99, border: 'none', padding: 2, cursor: disabled || locked ? 'default' : 'pointer',
          background: on ? 'var(--accent)' : 'var(--line)', opacity: disabled || locked ? 0.6 : 1, transition: 'background .15s',
          display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start',
        }}
      >
        <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
      </button>
    </div>
  );
}
