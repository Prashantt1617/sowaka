// Dashboard › Engagement › Contests and Engagement plan: the client calls and
// their shapes. Starting and deleting a contest stay on /connect/posts
// (publishCaptionChallenge / deleteEngagementPost in hrms.ts).
import { mediaUrl } from './api';
import { api } from './http';

export type ContestType = 'caption_challenge' | 'photo_story_challenge' | 'most_likely';

export type ContestSummaryDTO = {
  id: string;
  type: ContestType;
  /** The card's heading: the tag on Most likely, the name otherwise. */
  name: string;
  title: string;
  task: string;
  /** Older Most likely posts asked a question under the tag. */
  question: string;
  pointsPerVote: number;
  publishedAt: string;
  closesAt: string | null;
  status: 'live' | 'closed';
  audience: string;
  pinned: boolean;
  author: string;
  entries: number;
  entrants: number;
  votes: number;
  voters: number;
  participants: number;
  pointsGiven: number;
  /** Who is ahead (or won): an entry's author, or the most-tagged person. */
  leader: string;
};

export type ContestPersonDTO = { userId: string; name: string; department: string; location: string };

export type ContestDetailDTO = {
  contest: ContestSummaryDTO & { mediaUrl: string | null; audienceSize: number };
  /** Ranked by votes (not on Most likely). */
  entries: {
    id: string;
    by: ContestPersonDTO;
    text: string;
    photoUrl: string | null;
    votes: number;
    points: number;
    createdAt: string;
    mentions: string[];
  }[];
  voters: { voter: ContestPersonDTO; entryId: string; forName: string; forText: string }[];
  nominations: { by: ContestPersonDTO; tagged: ContestPersonDTO; at: string }[];
  tagged: { person: ContestPersonDTO; by: ContestPersonDTO[]; tags: number; points: number }[];
  notYet: ContestPersonDTO[];
  byDepartment: { group: string; audience: number; took: number }[];
  byLocation: { group: string; audience: number; took: number }[];
};

export type ContestListDTO = {
  contests: ContestSummaryDTO[];
  /** Contests started in the last 30 days: distinct people who entered, voted or nominated, and votes plus tags. */
  last30: { people: number; votes: number };
};

export function getContests(): Promise<ContestListDTO> {
  return api<ContestListDTO>('/admin/engagement/contests');
}

/**
 * One contest. Its pictures come back as `/media/...` paths on the API, which
 * only load from the API's own host: on the dashboard's host the same path is
 * answered with the page itself, and every entry showed as a broken image. So
 * they are made absolute here, once, for every view that draws them.
 */
export async function getContest(id: string): Promise<ContestDetailDTO> {
  const detail = await api<ContestDetailDTO>(`/admin/engagement/contests/${encodeURIComponent(id)}`);
  return {
    ...detail,
    contest: { ...detail.contest, mediaUrl: detail.contest.mediaUrl ? mediaUrl(detail.contest.mediaUrl) : null },
    entries: detail.entries.map((e) => ({ ...e, photoUrl: e.photoUrl ? mediaUrl(e.photoUrl) : null })),
  };
}

// ---- Engagement plan ----

export type PlanKind = 'contest' | 'poll' | 'tournament' | 'game';
export type PlanState = 'done' | 'running' | 'planned';

export type PlanEntryDTO = {
  key: string;
  kind: PlanKind;
  source: string;
  title: string;
  at: string;
  end: string | null;
  state: PlanState;
  stats: [string, string][];
  top: { name: string; value: string }[];
  open: { view: 'contests'; id: string } | { view: 'games' } | null;
  planItemId?: string;
  note?: string;
};

export type PlanDTO = { yearFrom: string; yearTo: string; entries: PlanEntryDTO[] };

export function getPlan(): Promise<PlanDTO> {
  return api<PlanDTO>('/admin/engagement/plan');
}

export type PlanItemInput = { date: string; time: string; kind: PlanKind; title: string; note: string };

export function addPlanItem(input: PlanItemInput) {
  return api<{ item: unknown }>('/admin/engagement/plan/items', { method: 'POST', body: input });
}

export function updatePlanItem(id: string, input: PlanItemInput) {
  return api<{ item: unknown }>(`/admin/engagement/plan/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
}

export function deletePlanItem(id: string) {
  return api<void>(`/admin/engagement/plan/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
