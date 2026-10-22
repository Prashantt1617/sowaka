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
import { Card, EmptyRow, LoadError, Pill, SkeletonPage, SummaryCard } from '../ui';
import type { LoadState } from '../ui';
import './look.css';

const button = (bg: string, color = 'var(--on-accent)') => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 40,
  border: '1px solid transparent',
  background: bg === 'var(--accent)' ? 'var(--accent-grad)' : bg,
  boxShadow: bg === 'var(--accent)' ? '0 8px 18px -10px var(--accent)' : undefined,
  color: bg === 'var(--accent)' ? '#fff' : color,
  borderRadius: 999,
  padding: '0 16px',
  fontSize: 13,
  fontWeight: 500,
  fontFamily: 'inherit',
  cursor: 'pointer',
});
const panel = {
  background: 'var(--surface)',
  border: '1px solid transparent',
  borderRadius: 'var(--r-lg)',
  padding: 20,
  marginBottom: 20, boxShadow: 'var(--shadow)',
};
/** A step is a number, not a heading that starts with one. */
const stepBadge = (muted: boolean) => ({
  width: 24,
  height: 24,
  borderRadius: 8,
  background: muted ? 'var(--surface-2)' : 'var(--accent-soft)',
  color: muted ? 'var(--ink-3)' : 'var(--hi)',
  fontSize: 10.5,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
});
const ghost = {
  ...button('var(--surface)', 'var(--ink)'),
  border: '1px solid var(--line-2)',
};
const field = {
  width: '100%',
  minHeight: 42,
  border: '1px solid var(--line-2)',
  borderRadius: 12,
  padding: '10px 12px',
  font: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
  background: 'var(--surface)',
  color: 'var(--ink)',
  boxSizing: 'border-box' as const,
};
const fieldLabel = {
  display: 'block',
  fontSize: 11.5,
  fontWeight: 400,
  color: 'var(--ink-2)',
  marginBottom: 6,
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
  const [publishForm, setPublishForm] = useState({
    title: '',
    subtitle: '',
    startsAt: '',
    pointsPerCorrect: '40',
  });
  const [video, setVideo] = useState<File | null>(null);
  const [published, setPublished] = useState<PublishResult | null>(null);

  const event = events.find((item) => item.id === eventId) ?? null;

  // Until the events have loaded once: a skeleton, then Retry if it failed.
  const [state, setState] = useState<LoadState>('loading');
  const load = async () => {
    try {
      const list = await listRelayEvents();
      setEvents(list);
      setEventId((current) => current || list[0]?.id || '');
      setState('ready');
    } catch (error) {
      setState((st) => (st === 'ready' ? st : 'error'));
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
          justifyContent: 'flex-end',
          alignItems: 'center',
          marginBottom: 20,
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {events.length > 0 && (
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            style={{ ...ghost, fontWeight: 400, minWidth: 200 }}
          >
            {events.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <button style={button('var(--accent)')} onClick={addEvent}>
          New event
        </button>
      </div>

      {state !== 'ready' ? (
        state === 'error'
          ? <Card><LoadError onRetry={() => { setState('loading'); void load(); }} /></Card>
          : <SkeletonPage cards={4} rows={3} cols={2} avatar={false} />
      ) : !event ? (
        <Card>
          <EmptyRow text="No relay event yet — create one to import teams into." />
        </Card>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 16,
              marginBottom: 20,
            }}
          >
            <SummaryCard label="Status" value={event.status} />
            <SummaryCard label="Teams" value={String(event.teamCount)} />
            <SummaryCard label="Item pool" value={String(event.itemCount)} />
            <SummaryCard
              label="Rounds"
              value={String(event.config.rounds)}
              color={event.itemCount > 0 ? 'var(--ok-solid)' : 'var(--ink-3)'}
            />
          </div>

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
                      border: '1px solid var(--line)',
                      borderRadius: 14,
                      padding: '10px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 14, fontWeight: 500 }}>{team.name}</strong>
                      <div style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>
                        {team.members.map((member) => member.name).join(', ')}
                      </div>
                    </div>
                    <Pill label={`${team.members.length} players`} tone={{ bg: 'var(--surface-2)', fg: 'var(--ink-3)' }} />
                  </div>
                ))}
              </div>
            )}
          </ImportPanel>

          <ImportPanel
            title="2 · Questions"
            hint="One row per item: round, kind (movie, word, number, odd, guess who), prompt, accepted answers (separate with | ), and piece1…piece5. Teams share the pool and enter it at different offsets."
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
            <Card style={{ marginBottom: 20, padding: 20 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>Pool per round</h3>
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
                        border: '1px solid var(--line)',
                        borderRadius: 14,
                        gap: 12,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 400 }}>Round {round.round}</span>
                      <span style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{round.size} items</span>
                      <Pill
                        label={
                          Number.isFinite(round.clash)
                            ? `teams ${round.clash} apart share one`
                            : 'no repeats'
                        }
                        tone={
                          !Number.isFinite(round.clash) || round.clash >= 8
                            ? { bg: 'var(--ok-bg)', fg: 'var(--ok)' }
                            : { bg: 'var(--warn-bg)', fg: 'var(--warn)' }
                        }
                      />
                    </div>
                  ))}
              </div>
            </Card>
          )}

          {(() => {
            // Shown even before it can be used: a step nobody can see is a step
            // nobody knows they still have to do.
            const missingRoster = event.teamCount === 0;
            const missingItems = event.itemCount === 0;
            const notReady = missingRoster || missingItems;
            return (
            <div style={panel}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}>
                <span style={stepBadge(notReady)}>3</span>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', color: notReady ? 'var(--ink-3)' : 'var(--ink)' }}>
                  Publish to Connect
                </h3>
              </div>
              {notReady && (
                <p style={{ margin: '0 0 8px', color: 'var(--bad)', fontSize: 12.5 }}>
                  {missingRoster && missingItems
                    ? 'Import the team roster and the questions first.'
                    : missingRoster
                      ? 'Import the team roster first.'
                      : 'Import the questions first.'}
                </p>
              )}
              <p style={{ margin: '0 0 12px', color: 'var(--ink-3)', fontSize: 12.5 }}>
                This schedules the game and announces it together. The countdown on the post and
                the moment the game starts itself are the same time — players see the instructions
                video first, then the lobby, and play begins on its own.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <label style={fieldLabel}>
                  Title
                  <input
                    style={{ ...field, marginTop: 4 }}
                    value={publishForm.title}
                    placeholder="Team Relay"
                    onChange={(e) => setPublishForm({ ...publishForm, title: e.target.value })}
                  />
                </label>
                <label style={fieldLabel}>
                  Subtitle
                  <input
                    style={{ ...field, marginTop: 4 }}
                    value={publishForm.subtitle}
                    placeholder="Five rounds. Your team holds the clues."
                    onChange={(e) => setPublishForm({ ...publishForm, subtitle: e.target.value })}
                  />
                </label>
                <label style={fieldLabel}>
                  Starts at
                  <input
                    type="datetime-local"
                    style={{ ...field, marginTop: 4 }}
                    value={publishForm.startsAt}
                    onChange={(e) => setPublishForm({ ...publishForm, startsAt: e.target.value })}
                  />
                </label>
                <label style={fieldLabel}>
                  Points per correct answer
                  <input
                    type="number"
                    min={1}
                    style={{ ...field, marginTop: 4 }}
                    value={publishForm.pointsPerCorrect}
                    onChange={(e) => setPublishForm({ ...publishForm, pointsPerCorrect: e.target.value })}
                  />
                </label>
                <label style={fieldLabel}>
                  Instructions video
                  <div style={{ marginTop: 6 }}>
                    <label style={{ ...ghost, display: 'inline-flex', gap: 8, cursor: 'pointer' }}>
                      {video ? video.name : 'Choose a video'}
                      <input
                        type="file"
                        accept="video/*"
                        style={{ display: 'none' }}
                        onChange={(e) => setVideo(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                </label>
                <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--ink-3)' }}>
                  {event.config.rounds} rounds and {event.teamCount} teams, taken from what was
                  imported — the post describes the game rather than configuring it.
                </div>
                <button
                  style={{ ...button('var(--ok-solid)'), width: 'fit-content', gridColumn: '1 / -1' }}
                  disabled={
                    busy ||
                    notReady ||
                    !publishForm.startsAt ||
                    !publishForm.pointsPerCorrect
                  }
                  onClick={publish}
                >
                  {busy ? 'Publishing…' : 'Publish and schedule'}
                </button>
                {published && (
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      background: 'var(--ok-bg)',
                      color: 'var(--ok)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      fontSize: 12.5,
                    }}
                  >
                    Live on Connect. Starts {new Date(published.startsAt).toLocaleString()} ·{' '}
                    {published.rounds.map((r) => `R${r.round} ${r.category}`).join(' · ')}
                  </div>
                )}
              </div>
            </div>
            );
          })()}

          {teams.length > 0 && (
            <Card style={{ marginTop: 20, padding: 20 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>Imported teams</h3>
              <div style={{ display: 'grid', gap: 6 }}>
                {teams.map((team) => (
                  <div
                    key={team.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      border: '1px solid var(--line)',
                      borderRadius: 14,
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 400 }}>{team.name}</span>
                    <span style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>
                      {team.members.length} players
                    </span>
                    <Pill
                      label={`starts at slot ${team.index * 4 + 1}`}
                      tone={{ bg: 'var(--surface-2)', fg: 'var(--ink-3)' }}
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

  const [step, ...rest] = title.split('·');
  return (
    <div style={panel}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}>
        <span style={stepBadge(disabled === true)}>{step.trim()}</span>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', color: disabled === true ? 'var(--ink-3)' : 'var(--ink)' }}>
          {rest.join('·').trim()}
        </h3>
      </div>
      <p style={{ margin: '0 0 12px', color: disabled ? 'var(--bad)' : 'var(--ink-3)', fontSize: 12.5 }}>
        {disabled ? (disabledNote ?? hint) : hint}
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label
          style={{
            ...ghost,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            cursor: disabled || busy ? 'not-allowed' : 'pointer',
            opacity: disabled || busy ? 0.6 : 1,
          }}
        >
          Choose file
          <input
            type="file"
            accept={accept}
            disabled={disabled || busy}
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            style={{ display: 'none' }}
          />
        </label>
        {summary && <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{summary}</span>}
      </div>

      {errors.length > 0 && (
        <IssueList
          tone="var(--bad)"
          background="var(--bad-bg)"
          heading={`${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} to fix before importing`}
          issues={errors}
        />
      )}
      {warnings.length > 0 && (
        <IssueList
          tone="var(--warn)"
          background="var(--warn-bg)"
          heading={`${warnings.length} worth checking`}
          issues={warnings}
        />
      )}

      {children}

      {canCommit && (
        <button style={{ ...button('var(--ok-solid)'), marginTop: 12 }} disabled={busy} onClick={onCommit}>
          {commitLabel}
        </button>
      )}
    </div>
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
    <div style={{ background, borderRadius: 14, padding: '12px 14px', marginTop: 12 }}>
      <div style={{ color: tone, fontWeight: 500, fontSize: 12.5, marginBottom: 6 }}>{heading}</div>
      <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink)', fontSize: 12.5 }}>
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
