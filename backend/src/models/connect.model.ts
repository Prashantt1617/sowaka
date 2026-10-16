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
  | 'most_likely'
  | 'secret_squad';

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
  /**
   * Set on a post sent to one of the author's custom lists: the list it went
   * to. Only ever shown to the author (see `audienceView`).
   */
  listId?: string;
  /** The list's name as it was at publish, for the author's own label. */
  listName?: string;
  /**
   * Who may see a list post: the list's members at the moment it was
   * published, plus the author. A snapshot — editing or deleting the list
   * afterwards does not move it. Present on list posts only.
   */
  userIds?: string[];
}

export interface ConnectComment {
  id: string;
  userId: string;
  name: string;
  text: string;
  createdAt: Date;
  parentId?: string;
  likedBy: string[];
  /** People tagged in it with "@", as picked from the directory. */
  mentions?: { userId: string; name: string }[];
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
  /**
   * Pinned to the top of the feed until this moment, then back in its own
   * place by `publishedAt`. Set straight in the database (see
   * `src/scripts/pin-post.ts`); nothing in the app or dashboard writes it.
   */
  pinnedUntil?: Date | null;
  /**
   * On a birthday or work-anniversary card: when the person it celebrates
   * last opened their wishes, by their user id. Wishes after it are the "new"
   * ones their card counts. Never sent to the app as it is.
   */
  wishesSeenAt?: Record<string, Date>;
  createdAt: Date;
  updatedAt: Date;
}
