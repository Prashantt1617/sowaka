/**
 * What the Face ID checks actually measure on real phones, from the log,
 * so their thresholds are set from numbers rather than guessed:
 *
 *   npm run face:calibrate -- [--days 14] [--org sowaka]
 *
 * Reads face_verifications (the server's own light-check measurements and
 * the phone's reports) and face_phone_logs (every try, pass or fail) and
 * prints, per outcome, how the screen detector scored, how far the chroma
 * moved under each colour, how sharp and how bright the faces were, where
 * tries ran out of time, and what the quality gate turned away. Ends with
 * the lines the numbers suggest. Read-only.
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

/** The screen detector's scores in a report: "s0.83" (a mean) or "s0.41/0.38/0.44" (each sample). */
function detectorScores(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\bs(\d\.\d\d(?:\/\d\.\d\d)*)\b/g)) out.push(...m[1].split('/').map(Number));
  for (const m of text.matchAll(/\bspoof ((?:\d\.\d\d ?)+)/g)) out.push(...m[1].trim().split(' ').map(Number));
  return out.filter((v) => Number.isFinite(v));
}

/** The chroma shift the colour asked for, per flash: "r-1.0/6.1" → 6.1 (Cr for red), "b6.7/-7.0" → 6.7 (Cb for blue), green → the mean fall of both. */
function colourShifts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\b([rgb])([-+]?\d+\.\d)\/([-+]?\d+\.\d)\b/g)) {
    const cb = Number(m[2]);
    const cr = Number(m[3]);
    out.push(m[1] === 'r' ? cr : m[1] === 'b' ? cb : -(cb + cr) / 2);
  }
  return out;
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

  console.log(`Face ID calibration — last ${days} days${org ? `, org ${org}` : ''}: ${checks.length} server checks, ${tries.length} phone tries`);
  console.log(`Current lines: detector veto ${0.15} (phone), flash chroma ${env.face.flashChroma}, brighten ${env.face.flashBrighten}, matchThreshold ${env.face.matchThreshold}`);
  console.log('');

  // ---- server checks by outcome
  const groups: Record<string, typeof checks> = {};
  for (const check of checks) {
    const key = check.passed ? 'matched' : (check.reason as string);
    (groups[key] ??= []).push(check);
  }
  console.log('Server checks by outcome:');
  for (const [key, rows] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
    const reports = rows.map((r) => `${r.liveness?.challenge ?? ''} ${r.liveness?.measured ?? ''}`);
    const detector = reports.flatMap(detectorScores);
    const serverShift = rows.map((r) => r.liveness?.measured ?? '').flatMap(colourShifts);
    const phoneShift = rows.map((r) => r.liveness?.challenge ?? '').flatMap(colourShifts);
    const judged = rows.filter((r) => r.liveness?.mode === 'server_flash');
    const flashFails = judged.filter((r) => r.liveness?.flashPassed === false).length;
    console.log(`  ${key}: ${rows.length} (server-judged ${judged.length}, flash refused ${flashFails})`);
    console.log('    ' + line('detector real-probability', detector));
    console.log('    ' + line('chroma shift, server-measured', serverShift, 1));
    console.log('    ' + line('chroma shift, phone-reported', phoneShift, 1));
    const similarity = rows.map((r) => r.similarity).filter((v): v is number => typeof v === 'number');
    if (similarity.length) console.log('    ' + line('similarity', similarity, 1));
  }
  console.log('');

  // ---- phone tries
  const captured = tries.filter((t) => t.summary.includes('captured'));
  const lapses = tries.filter((t) => /\blapse step\d/.test(t.summary));
  const lightFails = tries.filter((t) => /\blight-fail/.test(t.summary));
  const screens = tries.filter((t) => /\bscreen /.test(t.summary));
  const lapseStep: Record<string, number> = {};
  for (const t of lapses) {
    const step = t.summary.match(/\blapse step(\d)/)?.[1] ?? '?';
    lapseStep[step] = (lapseStep[step] ?? 0) + 1;
  }
  const quality: Record<string, number> = {};
  for (const t of tries) {
    for (const m of t.summary.matchAll(/\bquality (small|dark|bright|turned|blur=\d+(?= L\d+ \d+px(?: \||$)))/g)) {
      const kind = m[1].startsWith('blur') ? 'blur' : m[1];
      quality[kind] = (quality[kind] ?? 0) + 1;
    }
  }
  const blur = tries.flatMap((t) => [...t.summary.matchAll(/\bblur=(\d+)/g)].map((m) => Number(m[1])));
  const luma = tries.flatMap((t) => [...t.summary.matchAll(/\bL(\d+)\b/g)].map((m) => Number(m[1])));
  const facePx = tries.flatMap((t) => [...t.summary.matchAll(/\b(\d+)px\b/g)].map((m) => Number(m[1])));
  const promptSeconds = tries.flatMap((t) => [...t.summary.matchAll(/\b(\d+\.\d) prompts done/g)].map((m) => Number(m[1])));
  console.log('Phone tries:');
  console.log(`  selfie taken ${captured.length}, ran out of time ${lapses.length} (by step: ${JSON.stringify(lapseStep)}), light check failed ${lightFails.length}, screen suspected ${screens.length}`);
  console.log(`  quality gate turned away: ${JSON.stringify(quality)} (blur counts only tries under the floor)`);
  console.log('    ' + line('seconds to answer the prompts', promptSeconds, 1));
  console.log('    ' + line('blur (Laplacian variance)', blur, 0));
  console.log('    ' + line('face luma before the flash', luma, 0));
  console.log('    ' + line('face width, px', facePx, 0));
  console.log('    ' + line('detector, all tries', tries.flatMap((t) => detectorScores(t.summary))));
  console.log('    ' + line('detector, selfie taken', captured.flatMap((t) => detectorScores(t.summary))));
  console.log('    ' + line('detector, screen suspected', screens.flatMap((t) => detectorScores(t.summary))));
  console.log('    ' + line('chroma shift, light check failed', lightFails.flatMap((t) => colourShifts(t.summary)), 1));
  console.log('    ' + line('chroma shift, selfie taken', captured.flatMap((t) => colourShifts(t.summary)), 1));
  console.log('');

  // ---- suggestions
  const matchedDetector = (groups.matched ?? []).map((r) => r.liveness?.challenge ?? '').flatMap(detectorScores);
  const matchedShift = (groups.matched ?? []).map((r) => r.liveness?.measured ?? '').flatMap(colourShifts);
  const d1 = percentile(matchedDetector, 1);
  const s5 = percentile(matchedShift, 5);
  console.log('Suggested lines (from matched checks only; keep below them so no real face is refused):');
  console.log(`  detector veto: ${d1 === null ? 'no data yet' : `at most ${Math.min(0.5, d1).toFixed(2)} (p1 of matched = ${d1.toFixed(2)})`}`);
  console.log(`  flash chroma:  ${s5 === null ? 'no server-judged data yet' : `at most ${Math.max(0.5, s5 * 0.8).toFixed(1)} (p5 of matched = ${s5.toFixed(1)})`}`);
  console.log('  Compare against the chroma shifts of tries that failed the light check: the two should not overlap.');
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
