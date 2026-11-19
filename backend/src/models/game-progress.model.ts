/**
 * How far one person has got in a levelled web game (Meow), kept on the
 * server so a new phone, a reinstall or a cleared WebView does not send them
 * back to level 1. One row per person per company per game; `level` is the
 * next level they will play and only ever goes up (see game-progress.service).
 */
export interface GameProgress {
  org: string;
  userId: string;
  /** The catalog key: 'meowdoku', 'meow-test'. */
  gameKey: string;
  level: number;
  updatedAt: Date;
}
