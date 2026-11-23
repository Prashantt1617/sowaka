/**
 * The refused face bursts of the last 7 days (face_refused_bursts), written
 * out to look at and scored again with the detector as it is now:
 *
 *   npm run face:refused-crops -- --out /path/to/folder [--org sowaka] [--user <userId>]
 *
 * Each burst becomes a folder (<time>-<userId>-<verdict>) of its crops as
 * JPEGs, and one line is printed per burst: the phone's median, the server's
 * at the time, and the median scored now. Read-only on the database.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb, connectDb, faceRefusedBursts } from '../config/db';
import { scoreBurst } from '../services/face-spoof.service';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const out = arg('out');
  if (!out) throw new Error('Pass --out <folder>');
  await connectDb();
  const filter: Record<string, string> = {};
  if (arg('org')) filter.org = arg('org')!;
  if (arg('user')) filter.userId = arg('user')!;
  const rows = await faceRefusedBursts().find(filter).sort({ at: -1 }).toArray();
  console.log(`${rows.length} refused bursts`);
  for (const row of rows) {
    const crops = row.crops.map((c) => Buffer.from((c as unknown as { buffer?: Uint8Array }).buffer ?? c));
    const dir = join(out, `${row.at.toISOString().replace(/[:.]/g, '-')}-${row.userId}-${row.verdict}`);
    mkdirSync(dir, { recursive: true });
    crops.forEach((crop, i) => writeFileSync(join(dir, `crop${i}.jpg`), crop));
    const now = await scoreBurst(crops);
    console.log(
      [row.at.toISOString(), row.org, row.userId, row.verdict, `phone ${row.spoofPhone ?? '-'}`, `server then ${row.spoofServer ?? '-'}`,
        `now ${now.median?.toFixed(3) ?? '-'}`, `${crops.length} crops`].join('  '),
    );
  }
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
