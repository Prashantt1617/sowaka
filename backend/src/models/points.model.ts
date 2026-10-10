/**
 * Where a change to someone's engagement points came from.
 *
 * The three Connect challenges pay a point value per vote an entry draws (Most
 * Likely also pays the person who was named); Hint Relay pays for a game; a
 * game challenge (one colleague against another in a catalog game) pays the
 * winner, and a little for taking part.
 */
export type PointSource =
  | 'caption_challenge'
  | 'photo_story_challenge'
  | 'most_likely'
  | 'hint_relay'
  | 'game_challenge';

/**
 * What happened. Kept separate from the source so a month's activity can say
 * "11 votes received" rather than only a total.
 */
export type PointReason =
  /** Someone voted for this person's entry. */
  | 'vote_received'
  /** A vote for their entry was taken back, or moved to another entry. */
  | 'vote_withdrawn'
  /** They were named in a Most Likely challenge. */
  | 'tagged'
  /** Their entry was deleted, and what it had earned went with it. */
  | 'entry_removed'
  /** The challenge itself was deleted before it closed. */
  | 'challenge_deleted'
  /** Points from a game. */
  | 'game';

/**
 * One change to one person's `User.points`, recorded as it happens.
 *
 * The balance on the user record is still the truth; this is its history,
 * kept from the day the ledger was added. Nothing was backfilled, so a
 * balance earned before then has no rows behind it.
 */
export interface PointEvent {
  id: string;
  userId: string;
  org: string;
  /** Signed: what this event did to the balance. */
  delta: number;
  source: PointSource;
  reason: PointReason;
  /** The post or game it came from, so a month's events group by challenge. */
  refId?: string;
  /** A line of detail from the source, e.g. "5 rounds completed". */
  note?: string;
  /** For a source that covers many games: which one, by catalog key, and its name then. */
  gameKey?: string;
  title?: string;
  createdAt: Date;
}
