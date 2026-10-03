/**
 * Care: what a person writes, and the catalogue of media behind the
 * activities.
 *
 * Writing is kept for a week. Every Sunday night, India time, the week's
 * entries are emailed to the person and removed here; the Write screen says
 * so. Nothing about an entry is ever shown to anyone but its author.
 */
export interface JournalEntry {
  id: string;
  userId: string;
  org: string;
  text: string;
  /** The prompt the entry started from, when it started from one. */
  prompt?: string;
  /** 'general', 'topic:<id>' or 'tool:<id>': where in the app it was written. */
  context: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One playable thing on a Listen or Sleep shelf. */
export interface CareTrack {
  id: string;
  title: string;
  /** '5 min · Guided meditation' */
  meta: string;
  /** Where the file is. Null until Sowaka provides it; the app says so. */
  url: string | null;
}

/**
 * A topic on Help home. `kind` decides the page the app draws: one of the
 * bespoke pages (grief, balance, parents, couples) with its own `content`,
 * or the generic reading, question and tool. Adding a topic to the catalogue
 * is enough for it to appear.
 */
export interface CareTopic {
  id: string;
  name: string;
  intro: string;
  kind?: 'grief' | 'balance' | 'parents' | 'couples' | 'generic';
  /** The title of the short reading (generic). */
  article?: string;
  /** The question the reading and Write start from (generic). */
  question?: string;
  /** The reflection tool's name and instructions (generic). */
  tool?: string;
  toolBody?: string;
  /** The bespoke page's copy and lists; shape depends on `kind`. */
  content?: Record<string, unknown>;
}

/** The person's kept writing: a letter, a story, a life area, a love letter. */
export interface CareWriting {
  id: string;
  userId: string;
  org: string;
  /** 'balance:work', 'letter:<uuid>', 'story:main', 'loveletter:main', 'mother:main', 'couples:done:<date>'. */
  key: string;
  fields: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One clip of a stretch, and the steps (counted from 1) it shows. A clip may
 * cover several steps; they then advance evenly over its length. A step no
 * clip covers is shown as words, with its countdown when it is a hold.
 */
export interface MoveClip {
  url: string;
  steps: number[];
}

export interface CareCatalog {
  version: number;
  /**
   * Where Move, Breathe, Listen and Sleep live on the web. When set, the app
   * opens these pages instead of its own screens, so content changes need
   * no release. Empty keeps the app's screens.
   */
  webBase: string;
  topics: CareTopic[];
  /** Move's stretches and Breathe's moods as text; the app draws them. */
  stretches?: unknown[];
  moods?: unknown[];
  /** Stretch key → its clips in order: eyes, neck, shoulders, spine, wrists, legs. */
  moveClips: Record<string, MoveClip[]>;
  /** Mood key → the sound that plays quietly behind the breath, or null. */
  breatheSounds: Record<string, string | null>;
  listen: { meditations: CareTrack[]; affirmations: CareTrack[] };
  sleep: { rest: CareTrack[]; stories: CareTrack[]; sounds: CareTrack[] };
  /** Prompts for Write, in the order they are offered. */
  prompts: string[];
  /** Topic id → the short video on its Understand section. */
  topicVideos: Record<string, string | null>;
}

/** How long an entry lives before it is mailed and cleared, at most. */
export const JOURNAL_KEEP_DAYS = 7;

/** The quizzes for two on Time for two of you. */
export type PairQuizKind = 'love' | 'attachment';

/**
 * A quiz for two: a person's answers, and their partner's, who answers on a
 * private link with no account. Seen only by the two of them; never by the
 * company. One per person per kind.
 */
export interface PairQuiz {
  id: string;
  userId: string;
  org: string;
  kind: PairQuizKind;
  /** The partner's link; unguessable, and it lapses. */
  code: string;
  /** Love: twenty letters, W, Q, A, T or G. Attachment: ten digits, 1 to 5. */
  mine?: { answers: string; at: Date };
  partner?: { name: string; answers: string; at: Date };
  linkExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
