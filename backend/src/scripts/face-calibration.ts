/**
 * What the face check actually measures on real phones, from the log, so its
 * lines are set from numbers rather than guessed:
 *
 *   npm run face:calibrate -- [--days 14] [--org sowaka]
 *
 * Reads face_verifications (the server's screen-detector medians, the phone's,
 * and the burst's micro-motion) and face_phone_logs (every try, pass or fail)
 * and prints, per outcome, how the detector scored on the server and on the
 * phone, how much the face moved over the burst, where tries ran out of time
 * and what the quality gate asked for. Ends with the lines the numbers
 * suggest. Read-only.
 */
import { closeDb, connectDb, facePhoneLogs, faceVerifications } from '../config/db';
import { env } from '../config/env';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[at];
}

function line(label: string, values: number[], digits = 2): string {
  const f = (v: number | null) => (v === null ? '-' : v.toFixed(digits));
  return `${label.padEnd(34)} n=${String(values.length).padStart(4)}  p5=${f(percentile(values, 5))}  p50=${f(percentile(values, 50))}  p95=${f(percentile(values, 95))}`;
}

const numbers = (values: unknown[]): number[] => values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

/** A number after a tag in a phone report: "med0.91", "motion1.8", "rigid0.30". */
function tagged(text: string, tag: string): number[] {
  return [...text.matchAll(new RegExp(`\\b${tag}(\\d+(?:\\.\\d+)?)\\b`, 'g'))].map((m) => Number(m[1]));
}

async function main() {
  const days = Math.max(1, Number(arg('days', '14')) || 14);
  const org = arg('org', '');
  const since = new Date(Date.now() - days * 24 * 3600_000);
  await connectDb();
  const orgFilter = org ? { org } : {};

  const checks = await faceVerifications()
    .find({ ...orgFilter, kind: { $in: ['enrol', 'verify'] }, at: { $gte: since } }, { projection: { _id: 0, reason: 1, passed: 1, liveness: 1, similarity: 1 } })
    .toArray();
  const tries = await facePhoneLogs().find({ ...orgFilter, at: { $gte: since } }, { projection: { _id: 0, summary: 1 } }).toArray();

  console.log(`Face check calibration — last ${days} days${org ? `, org ${org}` : ''}: ${checks.length} server checks, ${tries.length} phone tries`);
  console.log(`Current lines: accept ${env.face.spoofAccept}, uncertain below that down to ${env.face.spoofUncertainLow}, matchThreshold ${env.face.matchThreshold}`);
  console.log('');

  // ---- server checks by outcome
  const groups: Record<string, typeof checks> = {};
  for (const check of checks) {
    const key = check.passed ? 'matched' : (check.reason as string);
    (groups[key] ??= []).push(check);
  }
  console.log('Server checks by outcome:');
  for (const [key, rows] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
    const judged = rows.filter((r) => r.liveness?.mode === 'server_spoof');
    console.log(`  ${key}: ${rows.length} (detector-judged ${judged.length})`);
    console.log('    ' + line('detector median, server', numbers(judged.map((r) => r.liveness?.spoofServer))));
    console.log('    ' + line('detector median, phone', numbers(judged.map((r) => r.liveness?.spoofPhone))));
    console.log('    ' + line('detector, each crop (server)', numbers(judged.flatMap((r) => r.liveness?.spoofScores ?? []))));
    console.log('    ' + line('micro-motion mean, px', numbers(judged.map((r) => r.liveness?.motionMean)), 1));
    console.log('    ' + line('micro-motion non-rigid, px', numbers(judged.map((r) => r.liveness?.motionRigid)), 1));
    const similarity = numbers(rows.map((r) => r.similarity));
    if (similarity.length) console.log('    ' + line('similarity', similarity, 1));
  }
  console.log('');

  // ---- phone tries
  const has = (word: string) => tries.filter((t) => new RegExp(`\\b${word}\\b`).test(t.summary));
  const captured = has('captured');
  const timeouts = has('timeout');
  const refused = has('refused');
  const gate: Record<string, number> = {};
  for (const t of tries) {
    for (const m of t.summary.matchAll(/\bgate (oneFace|closer|dark|bright|angle|still)\b/g)) gate[m[1]] = (gate[m[1]] ?? 0) + 1;
  }
  const seconds = tries.flatMap((t) => tagged(t.summary, 'took'));
  console.log('Phone tries:');
  console.log(`  captured ${captured.length}, ran out of time ${timeouts.length}, refused on the phone as a photo or screen ${refused.length}`);
  console.log(`  quality gate asked for: ${JSON.stringify(gate)}`);
  console.log('    ' + line('seconds to capture', seconds, 1));
  console.log('    ' + line('phone median, captured', captured.flatMap((t) => tagged(t.summary, 'med'))));
  console.log('    ' + line('phone median, refused', refused.flatMap((t) => tagged(t.summary, 'med'))));
  console.log('    ' + line('motion mean, captured', captured.flatMap((t) => tagged(t.summary, 'motion')), 1));
  console.log('    ' + line('motion mean, refused', refused.flatMap((t) => tagged(t.summary, 'motion')), 1));
  console.log('');

  // ---- suggestions
  const matched = numbers((groups.matched ?? []).map((r) => r.liveness?.spoofServer));
  const spoofed = numbers((groups.spoof ?? []).map((r) => r.liveness?.spoofServer));
  const p1 = percentile(matched, 1);
  const p99 = percentile(spoofed, 99);
  console.log('Suggested lines (keep the accept line under the real faces, the low line over the screens):');
  console.log(`  FACE_SPOOF_ACCEPT:        ${p1 === null ? 'no matched data yet' : `at most ${Math.min(0.9, Math.max(0.3, p1 - 0.05)).toFixed(2)} (p1 of matched = ${p1.toFixed(2)})`}`);
  console.log(`  FACE_SPOOF_UNCERTAIN_LOW: ${p99 === null ? 'no refused screens yet' : `at least ${Math.min(0.6, p99 + 0.05).toFixed(2)} (p99 of refused = ${p99.toFixed(2)})`}`);
  console.log('  Many "uncertain" checks from real people means the accept line is too high for their light.');
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
