/**
 * Gratitude Garden: one note is one flower or fruit on someone's tree.
 *
 * Every person in a company has a tree. A note is given by one person to
 * another (or to themselves), names a kind, and carries a few words. The
 * whole company reads it, on the receiver's tree and on the timeline. A
 * season is a calendar month; when it turns, the garden starts clean.
 */
export const FLOWER_KINDS = ['sunflower', 'hibiscus', 'tulip', 'blossom', 'daisy', 'lotus', 'rose'] as const;
export const FRUIT_KINDS = ['apple', 'orange', 'strawberry', 'grapes', 'mango', 'lemon'] as const;
export type GardenKind = (typeof FLOWER_KINDS)[number] | (typeof FRUIT_KINDS)[number];
export const GARDEN_KINDS: readonly GardenKind[] = [...FLOWER_KINDS, ...FRUIT_KINDS];

/** What each kind says. Fixed, shown wherever the sprite appears. */
export const KIND_MEANING: Record<GardenKind, { name: string; meaning: string; category: 'flower' | 'fruit' }> = {
  sunflower: { name: 'Sunflower', meaning: 'You bring warmth to the room', category: 'flower' },
  hibiscus: { name: 'Hibiscus', meaning: 'You showed up when it mattered', category: 'flower' },
  tulip: { name: 'Tulip', meaning: 'A simple, whole-hearted thank you', category: 'flower' },
  blossom: { name: 'Blossom', meaning: 'You made my day lighter', category: 'flower' },
  daisy: { name: 'Daisy', meaning: 'A kindness I noticed', category: 'flower' },
  lotus: { name: 'Lotus', meaning: 'Calm when things were not', category: 'flower' },
  rose: { name: 'Rose', meaning: 'Deep gratitude, no small thing', category: 'flower' },
  apple: { name: 'Apple', meaning: 'You helped me learn something', category: 'fruit' },
  orange: { name: 'Orange', meaning: 'You energised the whole team', category: 'fruit' },
  strawberry: { name: 'Strawberry', meaning: 'You made a hard week sweeter', category: 'fruit' },
  grapes: { name: 'Grapes', meaning: 'You brought people together', category: 'fruit' },
  mango: { name: 'Mango', meaning: 'You went the extra mile', category: 'fruit' },
  lemon: { name: 'Lemon', meaning: 'You kept us honest and fresh', category: 'fruit' },
};

export interface GardenNote {
  id: string;
  org: string;
  fromUserId: string;
  toUserId: string;
  kind: GardenKind;
  note: string;
  /** 'YYYY-MM' in India time; the garden clears when it changes. */
  season: string;
  createdAt: Date;
  /** Set when the receiver takes it off their tree. */
  removedAt?: Date;
}

/** How many a person may give in a day, in total. */
export const GARDEN_DAILY_LIMIT = 5;
/** Longest note, in characters. */
export const GARDEN_NOTE_MAX = 200;
