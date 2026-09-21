import { randomUUID } from 'node:crypto';
import { relayEvents, relayItems, relayTeams, users } from '../config/db';
import {
  RELAY_DEFAULT_CONFIG,
  RELAY_KIND_RULES,
  RelayEvent,
  RelayItem,
  RelayItemKind,
  RelayTeam,
  RelayTeamMember,
} from '../models/relay.model';
import { itemsForTeam, nearestClash } from './relay-pool';
import { forgetRelayCache } from './relay-runtime.service';
import { User } from '../models/user.model';
import {
  findHeaderIndex,
  meaningfulRows,
  normalizeHeader,
  parseSpreadsheet,
  SpreadsheetError,
} from '../utils/spreadsheet';

export class RelayError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export type IssueSeverity = 'error' | 'warning';

export interface ImportIssue {
  severity: IssueSeverity;
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
  /** False when anything would make the event unplayable, not merely untidy. */
  canCommit: boolean;
}

export interface ItemPreview {
  summary: {
    rowsRead: number;
    items: number;
    rounds: number;
    teams: number;
    perRound: { round: number; size: number; clash: number }[];
  };
  issues: ImportIssue[];
  canCommit: boolean;
}

const PERSON_HEADERS = ['email', 'employeeid', 'employee', 'emailid', 'employeecode', 'userid'];
const TEAM_HEADERS = ['team', 'teamid', 'teamkey', 'teamno', 'teamnumber', 'group'];
const ROLE_HEADERS = ['role', 'position', 'type'];

const LEADER_WORDS = ['leader', 'lead', 'tl', 'captain', 'teamleader'];
const MEMBER_WORDS = ['member', 'player', 'participant', ''];

async function adminOrg(userId: string) {
  const admin = await users().findOne({ userId });
  if (!admin) throw new RelayError(404, 'Admin user not found');
  return admin.org ?? admin.email.split('@').at(1) ?? 'default';
}

async function eventFor(adminUserId: string, eventId: string) {
  const org = await adminOrg(adminUserId);
  const event = await relayEvents().findOne({ id: eventId, org });
  if (!event) throw new RelayError(404, 'Relay event not found');
  return { org, event };
}

function read(fileName: string, bytes: Buffer): string[][] {
  try {
    // Never coerce serial dates here: an employee code or team number in the
    // same numeric range would silently turn into a date.
    return meaningfulRows(parseSpreadsheet(fileName, bytes));
  } catch (error) {
    if (error instanceof SpreadsheetError) throw new RelayError(error.statusCode, error.message);
    throw error;
  }
}

export async function createEvent(adminUserId: string, name: string) {
  const org = await adminOrg(adminUserId);
  const now = new Date();
  const event: RelayEvent = {
    id: randomUUID(),
    org,
    name: name.trim().slice(0, 120) || 'Launch event',
    status: 'draft',
    config: { ...RELAY_DEFAULT_CONFIG },
    currentRound: 0,
    createdBy: adminUserId,
    createdAt: now,
    updatedAt: now,
  };
  await relayEvents().insertOne(event);
  return event;
}

export async function listEvents(adminUserId: string) {
  const org = await adminOrg(adminUserId);
  const events = await relayEvents().find({ org }).sort({ updatedAt: -1 }).toArray();
  return Promise.all(
    events.map(async (event) => ({
      ...event,
      teamCount: await relayTeams().countDocuments({ eventId: event.id }),
      itemCount: await relayItems().countDocuments({ eventId: event.id }),
    })),
  );
}

export async function updateEventConfig(
  adminUserId: string,
  eventId: string,
  patch: Partial<RelayEvent['config']> & { name?: string; lobbyOpensAt?: string },
) {
  const { org, event } = await eventFor(adminUserId, eventId);
  if (event.status === 'live') throw new RelayError(409, 'Cannot change a live event');
  const config = { ...event.config };
  for (const key of Object.keys(config) as (keyof RelayEvent['config'])[]) {
    const value = patch[key];
    if (value === undefined) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new RelayError(400, `${key} must be a positive number`);
    }
    config[key] = numeric;
  }
  if (config.matchThreshold > 1) throw new RelayError(400, 'matchThreshold must be between 0 and 1');
  const update: Partial<RelayEvent> = { config, updatedAt: new Date() };
  if (patch.name !== undefined) update.name = patch.name.trim().slice(0, 120);
  if (patch.lobbyOpensAt !== undefined) {
    const at = new Date(patch.lobbyOpensAt);
    if (Number.isNaN(at.getTime())) throw new RelayError(400, 'Lobby time is invalid');
    update.lobbyOpensAt = at;
    update.status = 'scheduled';
  }
  await relayEvents().updateOne({ id: eventId, org }, { $set: update });
  return { ...event, ...update };
}

interface RosterRow {
  row: number;
  person: string;
  teamKey: string;
  role: string;
}

function rosterRows(table: string[][]): RosterRow[] {
  if (table.length === 0) return [];
  const headers = table[0].map(normalizeHeader);
  const personIndex = findHeaderIndex(headers, PERSON_HEADERS);
  const teamIndex = findHeaderIndex(headers, TEAM_HEADERS);
  const roleIndex = findHeaderIndex(headers, ROLE_HEADERS);
  const hasHeader = personIndex >= 0 || teamIndex >= 0;
  const resolved = {
    person: personIndex >= 0 ? personIndex : 0,
    team: teamIndex >= 0 ? teamIndex : 1,
    role: roleIndex >= 0 ? roleIndex : 2,
  };
  const start = hasHeader ? 1 : 0;
  return table.slice(start).map((row, index) => ({
    row: index + start + 1,
    person: (row[resolved.person] ?? '').trim(),
    teamKey: (row[resolved.team] ?? '').trim(),
    role: (row[resolved.role] ?? '').trim(),
  }));
}

function classifyRole(role: string): 'leader' | 'member' | 'unknown' {
  const normalized = normalizeHeader(role);
  if (LEADER_WORDS.includes(normalized)) return 'leader';
  if (MEMBER_WORDS.includes(normalized)) return 'member';
  return 'unknown';
}

/**
 * Leaderboard names come from the leader's first name, which collides often
 * enough across 44 teams to be worth resolving up front.
 */
function assignTeamNames(leaders: { teamKey: string; user: User }[]) {
  const names = new Map<string, string>();
  const firstNameCounts = new Map<string, number>();
  for (const { user } of leaders) {
    const first = user.name.trim().split(/\s+/)[0] ?? user.name;
    firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1);
  }
  const usedNames = new Set<string>();
  for (const { teamKey, user } of leaders) {
    const parts = user.name.trim().split(/\s+/);
    const first = parts[0] ?? user.name;
    let label = first;
    if ((firstNameCounts.get(first) ?? 0) > 1) {
      const initial = parts[1]?.[0];
      label = initial ? `${first} ${initial.toUpperCase()}` : user.name;
    }
    let name = `${label} TEAM`;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${label} TEAM ${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);
    names.set(teamKey, name);
  }
  return names;
}

async function resolveRoster(org: string, rows: RosterRow[]) {
  const issues: ImportIssue[] = [];
  const identifiers = rows.map((row) => row.person.trim()).filter(Boolean);
  const lowered = identifiers.map((value) => value.toLowerCase());
  // Employee IDs are written by hand into a spreadsheet, so "cs1" has to find
  // CS1. Both cases go to the query and matching is done on a folded key.
  const idVariants = [
    ...new Set(identifiers.flatMap((value) => [value, value.toUpperCase(), value.toLowerCase()])),
  ];
  const found = await users()
    .find({
      org,
      $or: [
        { email: { $in: lowered } },
        { employeeId: { $in: idVariants } },
        { userId: { $in: identifiers } },
      ],
    })
    .toArray();

  const byEmail = new Map(found.map((user) => [user.email.toLowerCase(), user]));
  const byEmployeeId = new Map(
    found
      .filter((user) => user.employeeId)
      .map((user) => [(user.employeeId as string).trim().toUpperCase(), user]),
  );
  const byUserId = new Map(found.map((user) => [user.userId, user]));

  const seenUsers = new Map<string, number>();
  const teams = new Map<string, { leaders: User[]; members: User[] }>();

  for (const row of rows) {
    if (!row.person && !row.teamKey) continue;
    if (!row.person) {
      issues.push({ severity: 'error', row: row.row, message: 'No employee in this row' });
      continue;
    }
    if (!row.teamKey) {
      issues.push({
        severity: 'error',
        row: row.row,
        message: `"${row.person}" has no team`,
      });
      continue;
    }
    const person = row.person.trim();
    const user =
      byEmployeeId.get(person.toUpperCase()) ??
      byEmail.get(person.toLowerCase()) ??
      byUserId.get(person);
    if (!user) {
      issues.push({
        severity: 'error',
        row: row.row,
        message: `No employee account matches "${row.person}"`,
      });
      continue;
    }
    const previousRow = seenUsers.get(user.userId);
    if (previousRow !== undefined) {
      issues.push({
        severity: 'error',
        row: row.row,
        message: `${user.name} is listed twice (also row ${previousRow})`,
      });
      continue;
    }
    seenUsers.set(user.userId, row.row);

    const role = classifyRole(row.role);
    if (role === 'unknown') {
      issues.push({
        severity: 'error',
        row: row.row,
        message: `"${row.role}" is not a role — use Leader or Member`,
      });
      continue;
    }
    const team = teams.get(row.teamKey) ?? { leaders: [], members: [] };
    if (role === 'leader') team.leaders.push(user);
    else team.members.push(user);
    teams.set(row.teamKey, team);
  }

  return { issues, teams };
}

export async function previewRoster(
  adminUserId: string,
  eventId: string,
  fileName: string,
  bytes: Buffer,
): Promise<RosterPreview> {
  const { org } = await eventFor(adminUserId, eventId);
  const table = read(fileName, bytes);
  const rows = rosterRows(table);
  const { issues, teams } = await resolveRoster(org, rows);

  const leaders: { teamKey: string; user: User }[] = [];
  for (const [teamKey, team] of teams) {
    if (team.leaders.length === 0) {
      issues.push({ severity: 'error', message: `Team "${teamKey}" has no leader` });
      continue;
    }
    if (team.leaders.length > 1) {
      issues.push({
        severity: 'error',
        message: `Team "${teamKey}" has ${team.leaders.length} leaders — it needs exactly one`,
      });
      continue;
    }
    leaders.push({ teamKey, user: team.leaders[0] });
  }

  const names = assignTeamNames(leaders);
  const previews: RosterTeamPreview[] = [];
  let players = 0;

  for (const [teamKey, team] of teams) {
    const leader = team.leaders[0];
    const size = team.leaders.length + team.members.length;
    players += size;
    if (size < 3) {
      issues.push({
        severity: 'warning',
        message: `Team "${teamKey}" has only ${size} ${size === 1 ? 'person' : 'people'} — hints will cycle back quickly`,
      });
    }
    if (size > 8) {
      issues.push({
        severity: 'warning',
        message: `Team "${teamKey}" has ${size} people — some may not receive a hint each question`,
      });
    }
    previews.push({
      teamKey,
      name: names.get(teamKey) ?? `Team ${teamKey}`,
      leader: leader?.name ?? null,
      members: [
        ...team.leaders.map((user) => ({ name: user.name, email: user.email, isLeader: true })),
        ...team.members.map((user) => ({ name: user.name, email: user.email, isLeader: false })),
      ],
    });
  }

  if (teams.size === 0) {
    issues.push({ severity: 'error', message: 'No teams found in this file' });
  }

  return {
    summary: { rowsRead: rows.length, teams: teams.size, players },
    teams: previews.sort((a, b) => a.name.localeCompare(b.name)),
    issues,
    canCommit: !issues.some((issue) => issue.severity === 'error'),
  };
}

export async function commitRoster(
  adminUserId: string,
  eventId: string,
  fileName: string,
  bytes: Buffer,
) {
  const { org, event } = await eventFor(adminUserId, eventId);
  if (event.status === 'live') throw new RelayError(409, 'Cannot change teams while the event is live');
  const preview = await previewRoster(adminUserId, eventId, fileName, bytes);
  if (!preview.canCommit) {
    throw new RelayError(400, 'Fix the errors in the file before importing');
  }

  const table = read(fileName, bytes);
  const { teams } = await resolveRoster(org, rosterRows(table));
  const now = new Date();

  // Items belong to the event, not to a team, so a new roster re-slices the
  // same pool rather than invalidating it.
  await relayTeams().deleteMany({ eventId });

  const documents: RelayTeam[] = [];
  for (const [index, preview_] of preview.teams.entries()) {
    const team = teams.get(preview_.teamKey);
    if (!team) continue;
    const leader = team.leaders[0];
    const members: RelayTeamMember[] = [
      { userId: leader.userId, name: leader.name, email: leader.email, isLeader: true },
      ...team.members.map((user) => ({
        userId: user.userId,
        name: user.name,
        email: user.email,
        isLeader: false,
      })),
    ];
    documents.push({
      id: randomUUID(),
      eventId,
      org,
      index,
      teamKey: preview_.teamKey,
      name: preview_.name,
      leaderUserId: leader.userId,
      members,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (documents.length > 0) await relayTeams().insertMany(documents);
  forgetRelayCache(eventId);
  await relayEvents().updateOne({ id: eventId, org }, { $set: { updatedAt: now } });

  return {
    teams: documents.length,
    players: documents.reduce((total, team) => total + team.members.length, 0),
    warnings: preview.issues.filter((issue) => issue.severity === 'warning'),
  };
}

const ROUND_HEADERS = ['round', 'roundno', 'roundnumber'];
const KIND_HEADERS = ['kind', 'type', 'roundtype', 'format'];
const PROMPT_HEADERS = ['prompt', 'questiontext', 'title', 'question', 'text'];
const ANSWER_HEADERS = ['answer', 'answers', 'acceptedanswers', 'correctanswer'];

/** How close two teams may be before sharing an item is a problem in a room. */
const MIN_CLASH_DISTANCE = 8;

const KIND_ALIASES: Record<string, RelayItemKind> = {
  movie: 'movie',
  movieclues: 'movie',
  clues: 'movie',
  lyric: 'lyric',
  lyrics: 'lyric',
  filllyric: 'lyric',
  word: 'word',
  unscramble: 'word',
  letters: 'word',
  number: 'number',
  numberchain: 'number',
  calculator: 'number',
  maths: 'number',
  odd: 'odd',
  oddoneout: 'odd',
};

const PIECE_LABELS: Record<RelayItemKind, (index: number) => string> = {
  movie: (i) => `Clue ${i + 1}`,
  lyric: (i) => `Part ${i + 1}`,
  word: (i) => `Letter ${i + 1}`,
  number: (i) => (i === 0 ? 'Start with' : `Step ${i}`),
  odd: (i) => `Word ${i + 1}`,
};

interface ItemRow {
  row: number;
  round: string;
  kind: string;
  prompt: string;
  answers: string;
  pieces: string[];
}

function itemRows(table: string[][], piecesPerItem: number): ItemRow[] {
  if (table.length === 0) return [];
  const headers = table[0].map(normalizeHeader);
  const roundIndex = findHeaderIndex(headers, ROUND_HEADERS);
  const kindIndex = findHeaderIndex(headers, KIND_HEADERS);
  const promptIndex = findHeaderIndex(headers, PROMPT_HEADERS);
  const answerIndex = findHeaderIndex(headers, ANSWER_HEADERS);
  // `hint` and `clue` still read, so a movie sheet written the old way imports.
  const pieceIndexes = Array.from({ length: piecesPerItem }, (_, i) =>
    findHeaderIndex(headers, [`piece${i + 1}`, `hint${i + 1}`, `clue${i + 1}`, `part${i + 1}`]),
  );
  if (roundIndex < 0 || kindIndex < 0) return [];

  return table.slice(1).map((row, index) => ({
    row: index + 2,
    round: (row[roundIndex] ?? '').trim(),
    kind: (row[kindIndex] ?? '').trim(),
    prompt: promptIndex >= 0 ? (row[promptIndex] ?? '').trim() : '',
    answers: answerIndex >= 0 ? (row[answerIndex] ?? '').trim() : '',
    pieces: pieceIndexes.map((i) => (i >= 0 ? (row[i] ?? '').trim() : '')),
  }));
}

function splitAnswers(value: string): string[] {
  return value
    .split(/[|;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function buildItems(adminUserId: string, eventId: string, fileName: string, bytes: Buffer) {
  const { org, event } = await eventFor(adminUserId, eventId);
  const { config } = event;
  const teamCount = await relayTeams().countDocuments({ eventId });
  const table = read(fileName, bytes);
  const rows = itemRows(table, config.hintsPerQuestion);
  const issues: ImportIssue[] = [];
  const documents: RelayItem[] = [];
  const now = new Date();

  if (rows.length === 0) {
    issues.push({
      severity: 'error',
      message:
        'No item rows found — the sheet needs a header row with round, kind, prompt, answer and piece1…piece5 columns',
    });
  }

  for (const row of rows) {
    if (!row.round && !row.kind && !row.prompt) continue;
    const round = Number(row.round);
    if (!Number.isInteger(round) || round < 1 || round > config.rounds) {
      issues.push({
        severity: 'error',
        row: row.row,
        message: `Round "${row.round}" is outside 1–${config.rounds}`,
      });
      continue;
    }
    const kind = KIND_ALIASES[normalizeHeader(row.kind)];
    if (!kind) {
      issues.push({
        severity: 'error',
        row: row.row,
        message: `"${row.kind}" is not a round type — use movie, lyric, word, number or odd`,
      });
      continue;
    }
    const answers = splitAnswers(row.answers);
    if (answers.length === 0) {
      issues.push({ severity: 'error', row: row.row, message: 'No accepted answer given' });
      continue;
    }
    const texts = row.pieces.filter(Boolean);
    if (texts.length < 2) {
      issues.push({
        severity: 'error',
        row: row.row,
        message: `Only ${texts.length} piece${texts.length === 1 ? '' : 's'} — there is nothing to split across a team`,
      });
      continue;
    }
    if (kind === 'movie' && texts.length !== config.hintsPerQuestion) {
      issues.push({
        severity: 'error',
        row: row.row,
        message: `A movie needs ${config.hintsPerQuestion} clues, not ${texts.length}`,
      });
      continue;
    }
    const rules = RELAY_KIND_RULES[kind];
    documents.push({
      id: randomUUID(),
      eventId,
      org,
      round,
      kind,
      reveal: rules.reveal,
      matching: rules.matching,
      prompt: row.prompt.slice(0, 500),
      acceptedAnswers: answers.map((answer) => answer.slice(0, 200)),
      pieces: texts.map((text, index) => ({
        label: PIECE_LABELS[kind](index),
        text: text.slice(0, 500),
      })),
      createdAt: now,
      updatedAt: now,
    });
  }

  // Every round needs a pool big enough that teams within earshot are never on
  // the same item at once. Too small is not a style problem — it is two
  // neighbouring teams hearing each other's answer.
  const perRound: { round: number; size: number; clash: number }[] = [];
  for (let round = 1; round <= config.rounds; round += 1) {
    const size = documents.filter((item) => item.round === round).length;
    const clash = nearestClash(size, teamCount, config.questionsPerRound);
    perRound.push({ round, size, clash });
    if (size < config.questionsPerRound) {
      issues.push({
        severity: 'error',
        message: `Round ${round} has ${size} items — a round needs at least ${config.questionsPerRound}`,
      });
      continue;
    }
    const mixed = new Set(documents.filter((i) => i.round === round).map((i) => i.kind));
    if (mixed.size > 1) {
      issues.push({
        severity: 'warning',
        message: `Round ${round} mixes ${[...mixed].join(', ')} — teams in the same round will be playing different kinds of puzzle`,
      });
    }
    if (teamCount > 0 && clash < MIN_CLASH_DISTANCE) {
      issues.push({
        severity: 'warning',
        message: `Round ${round} has only ${size} items for ${teamCount} teams, so teams ${clash} apart land on the same one at the same moment — add items or seat them apart`,
      });
    }
  }

  return {
    org,
    documents,
    issues,
    summary: {
      rowsRead: rows.length,
      items: documents.length,
      rounds: perRound.filter((entry: { size: number }) => entry.size > 0).length,
      perRound,
      teams: teamCount,
    },
  };
}

export async function previewItems(
  adminUserId: string,
  eventId: string,
  fileName: string,
  bytes: Buffer,
): Promise<ItemPreview> {
  const { issues, summary } = await buildItems(adminUserId, eventId, fileName, bytes);
  return { summary, issues, canCommit: !issues.some((issue) => issue.severity === 'error') };
}

export async function commitItems(
  adminUserId: string,
  eventId: string,
  fileName: string,
  bytes: Buffer,
) {
  const { event } = await eventFor(adminUserId, eventId);
  if (event.status === 'live') {
    throw new RelayError(409, 'Cannot change questions while the event is live');
  }
  const { documents, issues, summary } = await buildItems(adminUserId, eventId, fileName, bytes);
  if (issues.some((issue) => issue.severity === 'error')) {
    throw new RelayError(400, 'Fix the errors in the file before importing');
  }
  await relayItems().deleteMany({ eventId });
  if (documents.length > 0) await relayItems().insertMany(documents);
  forgetRelayCache(eventId);
  await relayEvents().updateOne({ id: eventId }, { $set: { updatedAt: new Date() } });
  return summary;
}

export async function listTeams(adminUserId: string, eventId: string) {
  const { event } = await eventFor(adminUserId, eventId);
  const teams = await relayTeams().find({ eventId: event.id }).sort({ index: 1 }).toArray();
  const pool = await relayItems().find({ eventId: event.id }).toArray();
  const byRound = new Map<number, RelayItem[]>();
  for (const item of pool) {
    byRound.set(item.round, [...(byRound.get(item.round) ?? []), item]);
  }

  return teams.map((team) => ({
    id: team.id,
    teamKey: team.teamKey,
    name: team.name,
    index: team.index,
    leaderUserId: team.leaderUserId,
    members: team.members,
    // What this team would actually play, so the slicing can be eyeballed
    // before the day rather than trusted.
    plan: Array.from(byRound.keys())
      .sort((a, b) => a - b)
      .map((round) => ({
        round,
        items: itemsForTeam(byRound.get(round) ?? [], team.index, event.config.questionsPerRound).map(
          (item) => ({ kind: item.kind, answer: item.acceptedAnswers[0] }),
        ),
      })),
  }));
}
