import { useEffect, useRef, useState } from 'react';
import {
  commitItems,
  publishRelayGame,
  PublishResult,
  commitRoster,
  createRelayEvent,
  ImportIssue,
  listRelayEvents,
  listRelayTeams,
  previewItems,
  previewRoster,
  ItemPreview,
  RelayEvent,
  RelayTeam,
  RosterPreview,
} from '../../services/relay';
import { ApiError } from '../../services/http';
import { useStore } from '../store';
import { Card, EmptyRow, Pill } from '../ui';

const button = (bg: string, color = '#fff') => ({
  border: 'none',
  background: bg,
  color,
  borderRadius: 9,
  padding: '9px 14px',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
});
const ghost = {
  ...button('#fff', '#222'),
  border: '1px solid #E7E7EA',
};
const label = { fontSize: 12, color: '#717171', fontWeight: 600 } as const;
const field = {
  width: '100%',
  border: '1px solid #E7E7EA',
  borderRadius: 10,
  padding: '9px 11px',
  font: 'inherit',
  boxSizing: 'border-box' as const,
};

type Kind = 'roster' | 'questions';

export function RelayGame() {
  const { flash } = useStore();
  const [events, setEvents] = useState<RelayEvent[]>([]);
  const [eventId, setEventId] = useState<string>('');
  const [teams, setTeams] = useState<RelayTeam[]>([]);
  const [rosterPreview, setRosterPreview] = useState<RosterPreview | null>(null);
  const [itemPreview, setItemPreview] = useState<ItemPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const files = useRef<Record<Kind, File | null>>({ roster: null, questions: null });
  const [publishForm, setPublishForm] = useState({ title: '', subtitle: '', startsAt: '' });
  const [video, setVideo] = useState<File | null>(null);
  const [published, setPublished] = useState<PublishResult | null>(null);

  const event = events.find((item) => item.id === eventId) ?? null;

  const load = async () => {
    try {
      const list = await listRelayEvents();
      setEvents(list);
      setEventId((current) => current || list[0]?.id || '');
    } catch (error) {
      flash(error instanceof ApiError ? error.message : 'Could not load relay events');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!eventId) return;
    listRelayTeams(eventId)
      .then(setTeams)
      .catch(() => setTeams([]));
  }, [eventId, rosterPreview, itemPreview]);

  const addEvent = async () => {
    const name = window.prompt('Name this event', 'Launch event');
    if (!name) return;
    try {
      const created = await createRelayEvent(name);
      await load();
      setEventId(created.id);
      flash('Event created');
    } catch (error) {
      flash(error instanceof ApiError ? error.message : 'Could not create the event');
    }
  };

  const choose = (kind: Kind) => async (file: File | null) => {
    files.current[kind] = file;
    if (!file || !eventId) return;
    setBusy(true);
    try {
      if (kind === 'roster') setRosterPreview(await previewRoster(eventId, file));
      else setItemPreview(await previewItems(eventId, file));
    } catch (error) {
      flash(error instanceof ApiError ? error.message : 'Could not read that file');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!eventId) return;
    setBusy(true);
    try {
      const result = await publishRelayGame(eventId, publishForm, video);
      setPublished(result);
      flash(`Published — ${result.teams} teams, ${result.rounds.length} rounds`);
      await load();
    } catch (error) {
      flash(error instanceof ApiError ? error.message : 'Could not publish the game');
    } finally {
      setBusy(false);
    }
  };

  const commit = (kind: Kind) => async () => {
    const file = files.current[kind];
    if (!file || !eventId) return;
    setBusy(true);
    try {
      if (kind === 'roster') {
        const result = await commitRoster(eventId, file);
        flash(`Imported ${result.teams} teams, ${result.players} players`);
        setRosterPreview(null);
        setItemPreview(null);
      } else {
        const result = await commitItems(eventId, file);
        flash(`Imported ${result.items} items across ${result.rounds} rounds`);
        setItemPreview(null);
      }
      files.current[kind] = null;
      await load();
    } catch (error) {
      flash(error instanceof ApiError ? error.message : 'Could not import that file');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 18,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Relay game</h2>
          <p style={{ margin: '4px 0 0', color: '#717171', fontSize: 14 }}>
            Teams and questions are imported before the event. Nothing can be fixed once 220 people
            are playing, so every problem has to be cleared here.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {events.length > 0 && (
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              style={{ ...ghost, fontWeight: 600 }}
            >
              {events.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
          <button style={button('#0571A6')} onClick={addEvent}>
            New event
          </button>
        </div>
      </div>

      {!event ? (
        <Card>
          <EmptyRow text="No relay event yet — create one to import teams into." />
        </Card>
      ) : (
        <>
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              <Stat label="Status" value={event.status} />
              <Stat label="Teams" value={String(event.teamCount)} />
              <Stat label="Item pool" value={String(event.itemCount)} />
              <Stat
                label="Expected questions"
                value={String(event.config.rounds * event.config.questionsPerRound)}
                hint="per team"
              />
              <Stat label="Rounds" value={String(event.config.rounds)} />
              <Stat label="Hints" value={String(event.config.hintsPerQuestion)} hint="per question" />
            </div>
          </Card>

          <ImportPanel
            title="1 · Team roster"
            hint="Three columns: employeeId (e.g. CS1 — case does not matter), team, and role (Leader or Member). Team names are generated from the leader."
            accept=".csv,.xlsx"
            busy={busy}
            onFile={choose('roster')}
            onCommit={commit('roster')}
            canCommit={rosterPreview?.canCommit ?? false}
            commitLabel={`Import ${rosterPreview?.summary.teams ?? 0} teams`}
            issues={rosterPreview?.issues ?? []}
            summary={
              rosterPreview && (
                <>
                  {rosterPreview.summary.rowsRead} rows · {rosterPreview.summary.teams} teams ·{' '}
                  {rosterPreview.summary.players} players
                </>
              )
            }
          >
            {rosterPreview && rosterPreview.teams.length > 0 && (
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {rosterPreview.teams.map((team) => (
                  <div
                    key={team.teamKey}
                    style={{
                      border: '1px solid #EBEBEB',
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 14 }}>{team.name}</strong>
                      <div style={{ color: '#717171', fontSize: 13 }}>
                        {team.members.map((member) => member.name).join(', ')}
                      </div>
                    </div>
                    <Pill label={`${team.members.length} players`} tone={{ bg: '#F7F7F9', fg: '#717171' }} />
                  </div>
                ))}
              </div>
            )}
          </ImportPanel>

          <ImportPanel
            title="2 · Questions"
            hint="One row per item: round, kind (movie, lyric, word, number, odd), prompt, accepted answers (separate with | ), and piece1…piece5. Teams share the pool and enter it at different offsets."
            accept=".csv,.xlsx"
            busy={busy}
            disabled={event.teamCount === 0}
            disabledNote="Import the team roster first."
            onFile={choose('questions')}
            onCommit={commit('questions')}
            canCommit={itemPreview?.canCommit ?? false}
            commitLabel={`Import ${itemPreview?.summary.items ?? 0} items`}
            issues={itemPreview?.issues ?? []}
            summary={
              itemPreview && (
                <>
                  {itemPreview.summary.rowsRead} rows · {itemPreview.summary.items} items ·{' '}
                  {itemPreview.summary.rounds} rounds
                </>
              )
            }
          />

          {itemPreview && itemPreview.summary.perRound.some((r) => r.size > 0) && (
            <Card style={{ marginBottom: 14 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Pool per round</h3>
              <div style={{ display: 'grid', gap: 6 }}>
                {itemPreview.summary.perRound
                  .filter((round) => round.size > 0)
                  .map((round) => (
                    <div
                      key={round.round}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        border: '1px solid #EBEBEB',
                        borderRadius: 10,
                        gap: 12,
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600 }}>Round {round.round}</span>
                      <span style={{ color: '#717171', fontSize: 13 }}>{round.size} items</span>
                      <Pill
                        label={
                          Number.isFinite(round.clash)
                            ? `teams ${round.clash} apart share one`
                            : 'no repeats'
                        }
                        tone={
                          !Number.isFinite(round.clash) || round.clash >= 8
                            ? { bg: '#E4EDE0', fg: '#4F7A52' }
                            : { bg: '#F6E9D5', fg: '#9A6B25' }
                        }
                      />
                    </div>
                  ))}
              </div>
            </Card>
          )}

          {event.teamCount > 0 && event.itemCount > 0 && (
            <Card style={{ marginBottom: 14 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>3 · Publish to Connect</h3>
              <p style={{ margin: '0 0 12px', color: '#717171', fontSize: 13 }}>
                This schedules the game and announces it together. The countdown on the post and
                the moment the game starts itself are the same time — players see the instructions
                video first, then the lobby, and play begins on its own.
              </p>
              <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
                <label style={label}>
                  Title
                  <input
                    style={{ ...field, marginTop: 4 }}
                    value={publishForm.title}
                    placeholder="Team Relay"
                    onChange={(e) => setPublishForm({ ...publishForm, title: e.target.value })}
                  />
                </label>
                <label style={label}>
                  Subtitle
                  <input
                    style={{ ...field, marginTop: 4 }}
                    value={publishForm.subtitle}
                    placeholder="Five rounds. Your team holds the clues."
                    onChange={(e) => setPublishForm({ ...publishForm, subtitle: e.target.value })}
                  />
                </label>
                <label style={label}>
                  Starts at
                  <input
                    type="datetime-local"
                    style={{ ...field, marginTop: 4 }}
                    value={publishForm.startsAt}
                    onChange={(e) => setPublishForm({ ...publishForm, startsAt: e.target.value })}
                  />
                </label>
                <label style={label}>
                  Instructions video
                  <input
                    type="file"
                    accept="video/*"
                    style={{ marginTop: 6, fontSize: 13, display: 'block' }}
                    onChange={(e) => setVideo(e.target.files?.[0] ?? null)}
                  />
                </label>
                <div style={{ fontSize: 12, color: '#9A9AA1' }}>
                  {event.config.rounds} rounds and {event.teamCount} teams, taken from what was
                  imported — the post describes the game rather than configuring it.
                </div>
                <button
                  style={{ ...button('#2F8F5B'), width: 'fit-content' }}
                  disabled={busy || !publishForm.startsAt}
                  onClick={publish}
                >
                  {busy ? 'Publishing…' : 'Publish and schedule'}
                </button>
                {published && (
                  <div
                    style={{
                      background: '#E4EDE0',
                      color: '#3B5E3F',
                      borderRadius: 10,
                      padding: '10px 12px',
                      fontSize: 13,
                    }}
                  >
                    Live on Connect. Starts {new Date(published.startsAt).toLocaleString()} ·{' '}
                    {published.rounds.map((r) => `R${r.round} ${r.category}`).join(' · ')}
                  </div>
                )}
              </div>
            </Card>
          )}

          {teams.length > 0 && (
            <Card style={{ marginTop: 14 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Imported teams</h3>
              <div style={{ display: 'grid', gap: 6 }}>
                {teams.map((team) => (
                  <div
                    key={team.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      border: '1px solid #EBEBEB',
                      borderRadius: 10,
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{team.name}</span>
                    <span style={{ color: '#717171', fontSize: 13 }}>
                      {team.members.length} players
                    </span>
                    <Pill
                      label={`starts at slot ${team.index * 4 + 1}`}
                      tone={{ bg: '#F7F7F9', fg: '#717171' }}
                    />
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label: text, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div style={label}>{text}</div>
      <div style={{ fontSize: 20, fontWeight: 700, textTransform: 'capitalize' }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: '#9A9AA1' }}>{hint}</div>}
    </div>
  );
}

function ImportPanel({
  title,
  hint,
  accept,
  busy,
  disabled,
  disabledNote,
  onFile,
  onCommit,
  canCommit,
  commitLabel,
  issues,
  summary,
  children,
}: {
  title: string;
  hint: string;
  accept: string;
  busy: boolean;
  disabled?: boolean;
  disabledNote?: string;
  onFile: (file: File | null) => void;
  onCommit: () => void;
  canCommit: boolean;
  commitLabel: string;
  issues: ImportIssue[];
  summary: React.ReactNode;
  children?: React.ReactNode;
}) {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return (
    <Card style={{ marginBottom: 14, opacity: disabled ? 0.55 : 1 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{title}</h3>
      <p style={{ margin: '0 0 12px', color: '#717171', fontSize: 13 }}>
        {disabled ? (disabledNote ?? hint) : hint}
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="file"
          accept={accept}
          disabled={disabled || busy}
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          style={{ fontSize: 13 }}
        />
        {summary && <span style={{ fontSize: 13, color: '#717171' }}>{summary}</span>}
      </div>

      {errors.length > 0 && (
        <IssueList
          tone="#B23B3B"
          background="#F8EAEA"
          heading={`${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} to fix before importing`}
          issues={errors}
        />
      )}
      {warnings.length > 0 && (
        <IssueList
          tone="#B07B22"
          background="#F6ECDA"
          heading={`${warnings.length} worth checking`}
          issues={warnings}
        />
      )}

      {children}

      {canCommit && (
        <button style={{ ...button('#2F8F5B'), marginTop: 12 }} disabled={busy} onClick={onCommit}>
          {commitLabel}
        </button>
      )}
    </Card>
  );
}

function IssueList({
  tone,
  background,
  heading,
  issues,
}: {
  tone: string;
  background: string;
  heading: string;
  issues: ImportIssue[];
}) {
  return (
    <div style={{ background, borderRadius: 10, padding: '10px 12px', marginTop: 12 }}>
      <div style={{ color: tone, fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{heading}</div>
      <ul style={{ margin: 0, paddingLeft: 18, color: '#222', fontSize: 13 }}>
        {issues.slice(0, 50).map((issue, index) => (
          <li key={index} style={{ marginBottom: 3 }}>
            {issue.row ? <strong>Row {issue.row}: </strong> : null}
            {issue.message}
          </li>
        ))}
        {issues.length > 50 && <li>…and {issues.length - 50} more</li>}
      </ul>
    </div>
  );
}
