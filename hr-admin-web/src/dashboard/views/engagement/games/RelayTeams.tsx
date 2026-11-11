// Hint Relay › Teams: the team roster for a relay event, through the
// existing /admin/relay endpoints. Only the teams: the questions are
// Sowaka's, and publishing (which needs them, and posts to the feed) is not
// done from here.
import { useEffect, useRef, useState } from 'react';
import {
  commitRoster,
  createRelayEvent,
  listRelayEvents,
  listRelayTeams,
  previewRoster,
  type ImportIssue,
  type RelayEvent,
  type RelayTeam,
  type RosterPreview,
} from '../../../../services/relay';
import { ApiError } from '../../../../services/http';
import { useStore } from '../../../store';
import { EmptyRow, ListPending, SelectBox, type LoadState } from '../../../ui';
import * as L from '../../look';
import { cardStyle } from './Analytics';

const STATUS: Record<RelayEvent['status'], [string, L.Tone]> = {
  draft: ['Being set up', 'mute'],
  scheduled: ['Scheduled', 'info'],
  live: ['Playing now', 'ok'],
  finished: ['Finished', 'mute'],
};

export function RelayTeams() {
  const { flash } = useStore();
  const [events, setEvents] = useState<RelayEvent[]>([]);
  const [eventId, setEventId] = useState('');
  const [state, setState] = useState<LoadState>('loading');
  const [teams, setTeams] = useState<RelayTeam[] | null>(null);
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const file = useRef<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const event = events.find((e) => e.id === eventId) ?? null;

  const load = async (pick?: string) => {
    try {
      const list = await listRelayEvents();
      setEvents(list);
      setEventId((cur) => pick || cur || list[0]?.id || '');
      setState('ready');
    } catch (error) {
      setState((s) => (s === 'ready' ? s : 'error'));
      flash(error instanceof ApiError ? error.message : 'Could not load relay events');
    }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    setPreview(null);
    file.current = null;
    if (!eventId) return;
    setTeams(null);
    listRelayTeams(eventId).then(setTeams).catch(() => setTeams([]));
  }, [eventId]);

  const create = async () => {
    const name = (naming ?? '').trim();
    if (!name) return;
    setBusy(true);
    try {
      const made = await createRelayEvent(name);
      setNaming(null);
      await load(made.id);
      flash('Event created');
    } catch (error) {
      flash(error instanceof ApiError ? error.message : 'Could not create the event');
    } finally {
      setBusy(false);
    }
  };

  const choose = async (f: File | null) => {
    file.current = f;
    setPreview(null);
    if (!f || !eventId) return;
    setBusy(true);
    try {
      setPreview(await previewRoster(eventId, f));
    } catch (error) {
      flash(error instanceof ApiError ? error.message : 'Could not read that file');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const commit = async () => {
    const f = file.current;
    if (!f || !eventId || !preview?.canCommit) return;
    // A new roster replaces the event's teams.
    if ((event?.teamCount ?? 0) > 0 && !window.confirm(`This replaces the ${event!.teamCount} teams already on “${event!.name}”. Carry on?`)) return;
    setBusy(true);
    try {
      const result = await commitRoster(eventId, f);
      flash(`Imported ${result.teams} teams, ${result.players} players`);
      setPreview(null);
      file.current = null;
      await load();
      setTeams(await listRelayTeams(eventId));
    } catch (error) {
      flash(error instanceof ApiError ? error.message : 'Could not import that file');
    } finally {
      setBusy(false);
    }
  };

  const errors = preview?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = preview?.issues.filter((i) => i.severity === 'warning') ?? [];
  const locked = event?.status === 'live';

  return (
    <section style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={L.cardTitle}>Teams</div>
          <div style={L.cardNote}>Make the teams for a Hint Relay event from a roster file. Questions are set up by Sowaka.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {events.length > 0 && (
            <SelectBox value={eventId} onChange={setEventId}>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </SelectBox>
          )}
          {naming === null && (
            <button type="button" className="lk-btn" style={L.btnSm} onClick={() => setNaming('')}>New event</button>
          )}
        </div>
      </div>

      {naming !== null && (
        <div style={{ ...L.note, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ flex: 1, minWidth: 220 }}>
            <span style={L.label}>Event name</span>
            <input className="lk-in" style={L.input} autoFocus maxLength={120} value={naming} placeholder="Team Relay" onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-end' }}>
            <button type="button" className="lk-btn" style={L.btnSm} onClick={() => setNaming(null)}>Cancel</button>
            <button type="button" className="lk-btn-p" style={L.btnSmPrimary} disabled={busy || !naming.trim()} onClick={() => void create()}>Create event</button>
          </div>
        </div>
      )}

      {state !== 'ready' ? (
        <ListPending state={state} onRetry={() => { setState('loading'); void load(); }} rows={3} avatar={false} />
      ) : !event ? (
        <EmptyRow text="No relay event yet. Create one to make its teams." />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <span style={L.pill(STATUS[event.status][1])}><span style={L.pillDot} />{STATUS[event.status][0]}</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
              {event.teamCount} team{event.teamCount === 1 ? '' : 's'} · {event.config.rounds} rounds
            </span>
          </div>

          <div style={{ border: '1px solid var(--line)', borderRadius: 16, padding: 16, marginBottom: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Team roster</div>
            <p style={{ margin: '0 0 12px', color: locked ? 'var(--bad)' : 'var(--ink-3)', fontSize: 12.5 }}>
              {locked
                ? 'The game is being played; teams can’t change until it ends.'
                : 'A CSV or Excel file with three columns: employeeId (e.g. CS1, any case), team, and role (Leader or Member). Each team is named after its leader.'}
            </p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="lk-btn" style={{ ...L.btnSm, cursor: locked || busy ? 'not-allowed' : 'pointer', opacity: locked || busy ? 0.6 : 1 }}>
                Choose file
                <input ref={input} type="file" accept=".csv,.xlsx" disabled={locked || busy} style={{ display: 'none' }} onChange={(e) => void choose(e.target.files?.[0] ?? null)} />
              </label>
              {preview && (
                <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                  {file.current?.name} · {preview.summary.rowsRead} rows · {preview.summary.teams} teams · {preview.summary.players} players
                </span>
              )}
            </div>
            {errors.length > 0 && <Issues tone="bad" heading={`${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} to fix before importing`} issues={errors} />}
            {warnings.length > 0 && <Issues tone="warn" heading={`${warnings.length} worth checking`} issues={warnings} />}
            {preview && preview.teams.length > 0 && (
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {preview.teams.map((t) => (
                  <TeamRow key={t.teamKey} name={t.name} captain={t.members.find((m) => m.isLeader)?.name ?? t.leader ?? null} members={t.members.filter((m) => !m.isLeader).map((m) => m.name)} />
                ))}
              </div>
            )}
            {preview && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" className="lk-btn-p" style={L.btnSmPrimary} disabled={busy || !preview.canCommit} onClick={() => void commit()}>
                  {busy ? 'Importing…' : `Import ${preview.summary.teams} teams`}
                </button>
                <button type="button" className="lk-btn" style={L.btnSm} disabled={busy} onClick={() => { setPreview(null); file.current = null; }}>Discard</button>
              </div>
            )}
          </div>

          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>Teams on this event</div>
          {teams === null ? (
            <ListPending state="loading" rows={3} avatar={false} />
          ) : teams.length === 0 ? (
            <EmptyRow text="No teams yet. Import a roster above." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {[...teams].sort((a, b) => a.index - b.index).map((t) => (
                <TeamRow key={t.id} name={t.name} captain={t.members.find((m) => m.isLeader)?.name ?? null} members={t.members.filter((m) => !m.isLeader).map((m) => m.name)} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TeamRow({ name, captain, members }: { name: string; captain: string | null; members: string[] }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={L.cellName}>{name}</div>
        <div style={L.cellSub}>
          {captain ? <><b style={{ fontWeight: 500, color: 'var(--ink-2)' }}>Captain: {captain}</b>{members.length ? ' · ' : ''}</> : null}
          {members.join(', ')}
        </div>
      </div>
      <span style={L.tag}>{members.length + (captain ? 1 : 0)} players</span>
    </div>
  );
}

function Issues({ tone, heading, issues }: { tone: 'bad' | 'warn'; heading: string; issues: ImportIssue[] }) {
  return (
    <div style={{ background: `var(--${tone}-bg)`, borderRadius: 14, padding: '12px 14px', marginTop: 12 }}>
      <div style={{ color: `var(--${tone})`, fontWeight: 500, fontSize: 12.5, marginBottom: 6 }}>{heading}</div>
      <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink)', fontSize: 12.5 }}>
        {issues.slice(0, 50).map((issue, i) => (
          <li key={i} style={{ marginBottom: 3 }}>
            {issue.row ? <strong>Row {issue.row}: </strong> : null}
            {issue.message}
          </li>
        ))}
        {issues.length > 50 && <li>…and {issues.length - 50} more</li>}
      </ul>
    </div>
  );
}
