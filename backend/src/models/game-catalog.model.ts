import type { ChallengeRewardRules } from './game-challenge.model';

/**
 * One game the app's Games tab can show, kept in the database so a game is
 * added, changed or switched off without an app release or a deploy.
 *
 * Which of these a company gets is `Company.enabledGames`. A web game carries
 * its whole page in `html` (one self-contained file); the app fetches it with
 * the person's session and loads it into its own screen. A native game is
 * built into the app and the entry only describes it; the app opens it by key.
 *
 * Written by Sowaka with `src/scripts/game-catalog.ts`, not from any
 * company's dashboard. The hosted games HR registers in the dashboard are a
 * different thing: the per-org `games` collection, published to Connect.
 */
export interface GameCatalogEntry {
  /** Stable id, lowercase with dashes: 'odd-one-out'. The app and scores key on it. */
  key: string;
  name: string;
  /** One line under the name on the card. */
  tagline?: string;
  description?: string;
  /** How to play, shown from the game's screen. */
  instructions?: string;
  kind: 'web' | 'native';
  /** '#RRGGBB'; the card's "Play now". */
  accentColor?: string;
  /** '#RRGGBB'; the page's own background, which the game's screen wears around it. */
  backgroundColor?: string;
  /** Cards are shown in ascending order. */
  order: number;
  /** False hides the game everywhere without taking it off any company's list. */
  active: boolean;
  /**
   * The card's picture: an https URL, a `data:image/...` URI, or for a native
   * game a picture bundled with the app (`assets/...`).
   */
  thumbnail?: string;
  /** Present when the game keeps a leaderboard. */
  scoring?: GameScoring;
  /**
   * What a colleague challenge in this game pays in engagement points. Any
   * field left out takes its default; see DEFAULT_CHALLENGE_REWARDS in
   * `services/game-challenge-rules.ts`. Set with the catalog script's
   * `--challenge-rewards`.
   */
  challengeRewards?: Partial<ChallengeRewardRules>;
  /** A web game's page, one self-contained HTML file. */
  html?: string;
  /** A web game hosted elsewhere, opened instead of `html`. https only. */
  hostedUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GameScoring {
  /** False for a game won on the lowest number, such as a time. */
  higherIsBetter: boolean;
  /** What a score counts: 'points', 'seconds'. */
  label: string;
  /** A score above this is refused as impossible. */
  max?: number;
}

/**
 * What a company that has never been given a list gets, provided it shows the
 * Games tab: the one game the tab has always had. A company without the tab
 * gets nothing until it is given a list on purpose.
 */
export const DEFAULT_ENABLED_GAMES = ['gratitude-garden'];

/** Catalog scores share `game_scores` with the hosted games, under this prefix. */
export const catalogScoreId = (key: string) => `catalog:${key}`;

export const GAME_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
