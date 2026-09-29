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

/** One of the ten topics on Help home. Text Sowaka can change without an app release. */
export interface CareTopic {
  id: string;
  name: string;
  intro: string;
  /** The title of the short reading. */
  article: string;
  /** The question the reading and Write start from. */
  question: string;
  /** The reflection tool's name and instructions. */
  tool: string;
  toolBody: string;
}

export interface CareCatalog {
  version: number;
  topics: CareTopic[];
  /** '<stretch>/<step number from 1>' → video url, or null until provided. */
  moveVideos: Record<string, string | null>;
  listen: { meditations: CareTrack[]; affirmations: CareTrack[] };
  sleep: { rest: CareTrack[]; stories: CareTrack[]; sounds: CareTrack[] };
  /** Prompts for Write, in the order they are offered. */
  prompts: string[];
  /** Topic id → the short video on its Understand section. */
  topicVideos: Record<string, string | null>;
}

/** How long an entry lives before it is mailed and cleared, at most. */
export const JOURNAL_KEEP_DAYS = 7;
