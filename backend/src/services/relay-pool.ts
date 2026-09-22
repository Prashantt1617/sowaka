import { RelayItem } from '../models/relay.model';

/**
 * Which items a team plays in a round, and in what order.
 *
 * Teams share one pool per round and enter it at different offsets. With 44
 * teams taking four questions each, a round needs 176 slots from a pool of a
 * few dozen, so items are necessarily reused — the goal is not uniqueness but
 * separation: two teams should never be on the same item at the same moment,
 * because answers get called out loud across a room.
 *
 * Stride is the questions-per-round count, so consecutive teams start a whole
 * round's worth apart. Two teams land on the same item at the same position
 * only when their indexes differ by a multiple of `pool.length / gcd`, which
 * for a 27-item pool puts the nearest clash 27 teams away — far enough apart
 * in seating to be out of earshot.
 */
export function itemsForTeam(pool: RelayItem[], teamIndex: number, perRound: number): RelayItem[] {
  if (pool.length === 0) return [];
  const start = teamIndex * perRound;
  return Array.from({ length: perRound }, (_, position) => pool[(start + position) % pool.length]);
}

/**
 * The closest pair of teams that ever share an item at the same position.
 *
 * Reported at import so nobody discovers the spacing is tight on the day; if
 * this comes back small, the pool is too small for the number of teams.
 */
export function nearestClash(poolSize: number, teams: number, perRound: number): number {
  if (poolSize === 0 || teams < 2) return Infinity;
  for (let gap = 1; gap < teams; gap += 1) {
    if ((gap * perRound) % poolSize === 0) return gap;
  }
  return Infinity;
}
