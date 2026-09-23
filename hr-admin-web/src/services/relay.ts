import { api, apiUpload } from './http';

export interface RelayConfig {
  rounds: number;
  questionsPerRound: number;
  hintsPerQuestion: number;
  hintIntervalSeconds: number;
  questionSeconds: number;
  breakSeconds: number;
  pointsPerCorrect: number;
  matchThreshold: number;
  presenceWindowSeconds: number;
  leadGraceSeconds: number;
}

export interface RelayEvent {
  id: string;
  name: string;
  status: 'draft' | 'scheduled' | 'live' | 'finished';
  config: RelayConfig;
  lobbyOpensAt?: string;
  teamCount: number;
  itemCount: number;
  updatedAt: string;
}

export interface ImportIssue {
  severity: 'error' | 'warning';
  message: string;
  row?: number;
}

export interface RosterTeamPreview {
  teamKey: string;
  name: string;
  leader: string | null;
  members: { name: string; email: string; isLeader: boolean }[];
}

export interface RosterPreview {
  summary: { rowsRead: number; teams: number; players: number };
  teams: RosterTeamPreview[];
  issues: ImportIssue[];
  canCommit: boolean;
}

export interface ItemPreview {
  summary: {
    rowsRead: number;
    items: number;
    rounds: number;
    teams: number;
    /** `clash` is how many teams apart the nearest pair sharing an item sits. */
    perRound: { round: number; size: number; clash: number }[];
  };
  issues: ImportIssue[];
  canCommit: boolean;
}

export interface PublishInput {
  title: string;
  subtitle: string;
  /** Local datetime from the form, sent as ISO. */
  startsAt: string;
  /** What each correct answer pays — HR's number, never a default. */
  pointsPerCorrect: string;
}

export interface PublishResult {
  postId: string;
  startsAt: string;
  rounds: { round: number; category: string }[];
  teams: number;
  instructionsVideoKey: string;
  pointsPerCorrect: number;
}

export interface RelayTeam {
  id: string;
  teamKey: string;
  name: string;
  index: number;
  members: { userId: string; name: string; email: string; isLeader: boolean }[];
  plan: { round: number; items: { kind: string; answer: string }[] }[];
}

/**
 * Schedules the game and announces it on Connect in one call.
 *
 * Multipart because the instructions video goes with it; the rest of the form
 * rides along as JSON so the server reads one object rather than loose fields.
 */
export function publishRelayGame(eventId: string, input: PublishInput, video: File | null) {
  const form = new FormData();
  form.append(
    'body',
    JSON.stringify({
      ...input,
      startsAt: new Date(input.startsAt).toISOString(),
      pointsPerCorrect: Number(input.pointsPerCorrect),
    }),
  );
  if (video) form.append('video', video);
  return apiUpload<PublishResult>(`/admin/relay/events/${eventId}/publish`, form);
}

export function listRelayEvents() {
  return api<{ events: RelayEvent[] }>('/admin/relay/events').then((data) => data.events);
}

export function createRelayEvent(name: string) {
  return api<{ event: RelayEvent }>('/admin/relay/events', {
    method: 'POST',
    body: { name },
  }).then((data) => data.event);
}

export function updateRelayEvent(eventId: string, patch: Partial<RelayConfig> & { name?: string; lobbyOpensAt?: string }) {
  return api<{ event: RelayEvent }>(`/admin/relay/events/${eventId}`, {
    method: 'PUT',
    body: patch,
  }).then((data) => data.event);
}

export function listRelayTeams(eventId: string) {
  return api<{ teams: RelayTeam[] }>(`/admin/relay/events/${eventId}/teams`).then(
    (data) => data.teams,
  );
}

function withFile(file: File) {
  const form = new FormData();
  form.append('file', file);
  return form;
}

/** Reads the sheet and reports what would happen. Writes nothing. */
export function previewRoster(eventId: string, file: File) {
  return apiUpload<RosterPreview>(`/admin/relay/events/${eventId}/roster/preview`, withFile(file));
}

export function commitRoster(eventId: string, file: File) {
  return apiUpload<{ teams: number; players: number; warnings: ImportIssue[] }>(
    `/admin/relay/events/${eventId}/roster`,
    withFile(file),
  );
}

/** The shared pool every team draws from, not one set per team. */
export function previewItems(eventId: string, file: File) {
  return apiUpload<ItemPreview>(`/admin/relay/events/${eventId}/questions/preview`, withFile(file));
}

export function commitItems(eventId: string, file: File) {
  return apiUpload<ItemPreview['summary']>(
    `/admin/relay/events/${eventId}/questions`,
    withFile(file),
  );
}
