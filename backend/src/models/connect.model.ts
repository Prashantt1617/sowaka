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
  | 'relay_game'
  | 'new_joinee'
  | 'recommendation'
  | 'caption_challenge'
  | 'photo_story_challenge'
  | 'most_likely';

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

export interface ConnectCaptionEntry {
  id: string;
  userId: string;
  name: string;
  initials: string;
  text: string;
  /**
   * Set on a photo-story challenge, where the entry is a picture plus the
   * story behind it. Absent on a caption challenge, which is words only.
   */
  photoObjectKey?: string;
  /**
   * Set on a Most Likely entry: the colleague this person tagged. Here the
   * entry *is* the vote — the tag is what counts, and the points go to whoever
   * was named rather than to whoever named them.
   */
  taggedUserId?: string;
  taggedName?: string;
  taggedInitials?: string;
  taggedDesignation?: string;
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
  /**
   * Caption challenge entries. One per person, enforced on write — a caption
   * cannot be edited once it is up, because it may already have been voted
   * on and rewriting it underneath those votes would misrepresent what people
   * voted for. Changing your mind means deleting and posting again, which
   * gives up the votes along with the caption.
   */
  captionEntries?: ConnectCaptionEntry[];
  /** One vote each, viewer id -> entry id. Voting again moves the vote. */
  captionVotes?: Record<string, string>;
  publishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
