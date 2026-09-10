// Human labels for cycle keys and cycle dates.
//
// Periods travel as `YYYY-MM` and cycle bounds as `YYYY-MM-DD` because those
// sort and compare correctly, but neither reads well on screen. Everything the
// dashboard shows goes through here so the wording is the same on every page.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const parsePeriod = (period: string): [number, number] | null => {
  const [y, m] = period.split('-').map(Number);
  return y && m >= 1 && m <= 12 ? [y, m] : null;
};

/** `2026-09` -> `September 2026`. */
export function periodLabel(period: string): string {
  const parts = parsePeriod(period);
  return parts ? `${MONTHS[parts[1] - 1]} ${parts[0]}` : period;
}

/** `2026-09` -> `Sep 2026`. */
export function periodShort(period: string): string {
  const parts = parsePeriod(period);
  return parts ? `${MONTHS[parts[1] - 1].slice(0, 3)} ${parts[0]}` : period;
}

/** `2026-09-10` -> `10 Sep 2026`. */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

/**
 * `10 Sep – 10 Oct 2026`, dropping the repeated year. The end is exclusive —
 * a cycle runs up to but not including that morning.
 */
export function cycleRange(start: string, end: string): string {
  const [ys, ms, ds] = start.slice(0, 10).split('-').map(Number);
  const [ye, me, de] = end.slice(0, 10).split('-').map(Number);
  if (!ys || !ye) return `${start} – ${end}`;
  const left = `${ds} ${MONTHS[ms - 1].slice(0, 3)}${ys === ye ? '' : ` ${ys}`}`;
  return `${left} – ${de} ${MONTHS[me - 1].slice(0, 3)} ${ye}`;
}

/**
 * The date bounds of a cycle key, given the org's start day.
 *
 * The server sends bounds for the live cycle only, so naming a future one —
 * "the change lands in 5 Oct – 5 Nov" — has to be derived here from the same
 * rule the server uses.
 */
export function cycleBounds(period: string, startDay: number): { start: string; end: string } {
  const [y, m] = period.split('-').map(Number);
  const day = Math.min(28, Math.max(1, Math.trunc(startDay) || 1));
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return {
    start: iso(new Date(Date.UTC(y, m - 1, day))),
    end: iso(new Date(Date.UTC(y, m, day))),
  };
}
