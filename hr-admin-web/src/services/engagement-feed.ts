// Engagement › Feed: the company's Connect feed as HR reads and moderates it.
// Reports reuse the Moderate feed endpoints (/admin/connect/reports).
import { api } from './http';

export type FeedAs = 'all' | 'company' | 'team' | 'list' | `person:${string}`;

export type FeedMedia = { url: string; video: boolean };
// An option shows a picture or, from the app's Media option, a video.
export type FeedPollOption = { id: string; label: string; votes: number; imageUrl?: string; videoUrl?: string };

export type FeedCardDTO = {
  id: string;
  type: string;
  tag: string;
  tagIcon: string;
  tagColor: string;
  tagTint: string;
  author: {
    userId: string;
    name: string;
    initials: string;
    designation: string;
    avatarColor: string;
    photoUrl?: string;
  };
  /** Posted by the system (birthdays, Sowaka Engagements), not a person. */
  auto: boolean;
  audience: { kind: 'company' | 'team' | 'list'; label: string };
  publishedAt: string;
  /** Set while the pin lasts. */
  pinnedUntil: string | null;
  /** Whether the app's feed leads with it now (only the newest few pins do). */
  leadingPin: boolean;
  likeCount: number;
  commentCount: number;
  body: {
    title: string;
    text: string;
    subtitle: string;
    label: string;
    severity: string;
    personName: string;
    personPhotoUrl?: string;
    years?: number;
    media: FeedMedia[];
    link?: { url: string; title: string; domain: string; imageUrl: string };
    options?: FeedPollOption[];
    totalVotes?: number;
    challenge?: { entries: number; votes: number; pointsPerVote: number; closesAt?: string; official: boolean };
    event?: { date: string; time: string; location: string; prize: string };
    game?: { name: string; actionLabel: string; accentColor: string; startsAt?: string; endsAt?: string; gameKey?: string };
  };
};

export type FeedSummaryDTO = {
  total: number;
  pinned: number;
  pinMax: number;
  reportsOpen: number;
  people: { userId: string; name: string; department: string }[];
};

export type FeedCommentDTO = {
  id: string;
  userId: string;
  name: string;
  photoUrl?: string;
  text: string;
  createdAt: string;
  parentId: string | null;
  likeCount: number;
  reportsOpen: number;
};

export type FeedPostDetailDTO = {
  post: FeedCardDTO;
  insights: { audienceSize: number; pushSent: number; reportsOpen: number; players: number | null };
  comments: FeedCommentDTO[];
};

const BASE = '/admin/engagement/feed';

export const getFeedSummary = () => api<FeedSummaryDTO>(`${BASE}/summary`);

export const getFeedPage = (as: FeedAs, cursor?: string | null) =>
  api<{ posts: FeedCardDTO[]; nextCursor: string | null }>(
    `${BASE}/posts?as=${encodeURIComponent(as)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );

export const getFeedPost = (postId: string) => api<FeedPostDetailDTO>(`${BASE}/posts/${encodeURIComponent(postId)}`);

export const pinFeedPost = (postId: string, until: string) =>
  api(`${BASE}/posts/${encodeURIComponent(postId)}/pin`, { method: 'PUT', body: { until } });

export const unpinFeedPost = (postId: string) =>
  api(`${BASE}/posts/${encodeURIComponent(postId)}/pin`, { method: 'DELETE' });

/** The app's own delete, as HR; every open report about the post closes with it. */
export const removeFeedPost = (postId: string) =>
  api(`${BASE}/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' });

/** Removes a comment and its replies; open reports on them close as actioned. */
export const removeFeedComment = (postId: string, commentId: string) =>
  api(`${BASE}/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
