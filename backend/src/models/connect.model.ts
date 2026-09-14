export type ConnectPostType =
  | 'leadership'
  | 'hr_announcement'
  | 'new_post'
  | 'birthday'
  | 'anniversary'
  | 'kudos'
  | 'award'
  | 'survey'
  | 'event'
  | 'live_game'
  | 'new_joinee'
  | 'recommendation'
  | 'photo_challenge';

export interface ConnectAuthor {
  userId?: string;
  name: string;
  initials: string;
  designation: string;
  avatarColor: string;
  photoUrl?: string;
}

export interface ConnectAudience {
  label: string;
  org?: string;
  /**
   * Reporting group a "Team" post is scoped to, identified by the manager who
   * heads it: the manager themselves plus everyone who reports to them — the
   * same people the app's Team tab lists. Absent on company-wide posts.
   */
  teamId?: string;
  /**
   * @deprecated Team posts used to be scoped by department. Still read so
   * existing posts stay visible, but no longer written.
   */
  department?: string;
}

export interface ConnectComment {
  id: string;
  userId: string;
  name: string;
  text: string;
  createdAt: Date;
  parentId?: string;
  likedBy: string[];
}

/**
 * One person's entry in a photo challenge. Entries and votes live beside the
 * post rather than inside `body`, the way poll votes already do — editing the
 * brief then cannot rewrite who submitted what or how the voting stands.
 */
export interface ChallengeEntry {
  id: string;
  userId: string;
  name: string;
  initials: string;
  caption: string;
  photoObjectKey: string;
  createdAt: Date;
}

export interface ConnectPost {
  id: string;
  /** Stable idempotency key for lifecycle-generated posts. */
  systemKey?: string;
  org: string;
  type: ConnectPostType;
  tag: string;
  tagIcon: string;
  tagColor: string;
  tagTint: string;
  author: ConnectAuthor;
  audience: ConnectAudience;
  body: Record<string, unknown>;
  likedBy: string[];
  comments: ConnectComment[];
  actionBy?: Record<string, string>;
  pollVotes?: Record<string, string>;
  challengeEntries?: ChallengeEntry[];
  /** Voter userId -> entry id. One vote each, changeable. */
  challengeVotes?: Record<string, string>;
  publishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
