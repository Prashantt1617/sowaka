/**
 * A signing date that only moves in steps, so presigning the same object twice
 * in quick succession produces the *same* URL.
 *
 * Every read of a post re-presigns its media. With a signing date of "now",
 * each read handed the client a URL it had never seen, so liking or commenting
 * on a post made the app throw away a picture it already had and download it
 * again — the post visibly reloaded under the reader.
 *
 * The cost is that a URL issued late in a step expires early in proportion:
 * with a 300s TTL and a 120s step, real validity ranges from 180s to 300s
 * rather than always being 300s. Keep the step well under the TTL.
 */
const STEP_MS = 120_000;

export function stablePresignDate(now = Date.now()): Date {
  return new Date(Math.floor(now / STEP_MS) * STEP_MS);
}
