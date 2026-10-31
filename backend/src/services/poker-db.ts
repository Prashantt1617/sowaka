import type { Collection } from 'mongodb';
import { getDb } from '../config/db';
import type { PokerEvent, PokerHandRecord, PokerPick, PokerResult } from '../models/poker.model';
import { logger } from '../utils/logger';

/**
 * Speed Poker's lasting records: the events the host sets up, every player's
 * result at every table (the day's board), the spectators' picks, and every
 * hand dealt (for a disputed result). Live tables and the queue sit in Redis
 * (`poker-store.ts`).
 */

export const pokerEvents = (): Collection<PokerEvent> => getDb().collection<PokerEvent>('poker_events');
export const pokerResults = (): Collection<PokerResult> => getDb().collection<PokerResult>('poker_results');
export const pokerPicks = (): Collection<PokerPick> => getDb().collection<PokerPick>('poker_picks');
export const pokerHands = (): Collection<PokerHandRecord> => getDb().collection<PokerHandRecord>('poker_hands');

let indexed: Promise<void> | null = null;

/** Made once per process, on first use. */
export function ensurePokerIndexes(): Promise<void> {
  indexed ??= (async () => {
    await pokerEvents().createIndex({ id: 1 }, { unique: true });
    await pokerEvents().createIndex({ org: 1, status: 1, createdAt: -1 });
    await pokerResults().createIndex({ eventId: 1, tableId: 1, userId: 1 }, { unique: true });
    await pokerResults().createIndex({ eventId: 1, round: 1, userId: 1 });
    await pokerPicks().createIndex({ id: 1 }, { unique: true });
    await pokerPicks().createIndex({ eventId: 1, userId: 1, stage: 1 });
    await pokerPicks().createIndex({ eventId: 1, stage: 1, table: 1 });
    await pokerHands().createIndex({ tableId: 1, no: 1 }, { unique: true });
    await pokerHands().createIndex({ eventId: 1, at: -1 });
    // Hands are for disputes on the day and just after.
    await pokerHands().createIndex({ at: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
  })().catch((error) => {
    logger.error('Poker indexes failed', {}, error);
    indexed = null;
  });
  return indexed;
}
