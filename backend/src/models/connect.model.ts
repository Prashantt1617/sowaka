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
  | 'recommendation';

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
  publishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
