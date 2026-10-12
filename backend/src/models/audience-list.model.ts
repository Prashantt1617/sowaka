/**
 * A custom audience list: a saved shortcut of people one person can send a
 * Connect post to, like a Snapchat group. Private to its owner — nobody else
 * ever reads it, and a post sent to it carries a copy of its members (see
 * `ConnectAudience.userIds`), so editing or deleting the list later changes
 * nothing about posts already published.
 */
export interface AudienceList {
  id: string;
  org: string;
  ownerUserId: string;
  /** As the owner typed it, trimmed: 1–40 characters. */
  name: string;
  /**
   * The name folded for comparison — lower case, inner spaces collapsed — so
   * "3D crew" and "3d  Crew" are the same name. Unique per owner.
   */
  nameKey: string;
  /** 1–500 people from the owner's company, never the owner. */
  memberUserIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export const AUDIENCE_LIST_NAME_MAX = 40;
export const AUDIENCE_LIST_MEMBERS_MAX = 500;
/** How many lists one person may keep. */
export const AUDIENCE_LISTS_PER_OWNER_MAX = 50;
