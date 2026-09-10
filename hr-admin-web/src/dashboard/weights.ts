// Splitting 100% across a parameter set.
//
// Weights are whole percentage points that must total 100, which is what keeps
// the overall score on the same 0-5 scale as each parameter: 50%x5 + 30%x5 +
// 20%x5 = 5. The server enforces the same rule; these mirror it so the form can
// say what is wrong before saving.

export const WEIGHT_TOTAL = 100;

/** Even split with the remainder spread one point at a time, so it totals 100. */
export function evenWeights(ids: string[]): Record<string, number> {
  const base = Math.floor(WEIGHT_TOTAL / ids.length);
  let remainder = WEIGHT_TOTAL - base * ids.length;
  const out: Record<string, number> = {};
  for (const id of ids) {
    out[id] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  return out;
}

export const weightTotal = (ids: string[], weights: Record<string, number>): number =>
  ids.reduce((sum, id) => sum + (Number(weights[id]) || 0), 0);

/** The reason the set is not saveable, or empty when it is. */
export function weightError(ids: string[], weights: Record<string, number>): string {
  if (ids.length === 0) return 'Pick at least one parameter.';
  if (ids.some((id) => !Number.isInteger(weights[id]) || weights[id] < 1)) {
    return 'Every parameter needs a whole-number weight of at least 1%.';
  }
  const total = weightTotal(ids, weights);
  if (total !== WEIGHT_TOTAL) {
    return `Weights total ${total}% — they must add up to ${WEIGHT_TOTAL}%.`;
  }
  return '';
}
