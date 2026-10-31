/**
 * Seeds the national statutory rows (`payroll_statutory_configs`) for FY
 * 2025-26 and 2026-27 with exactly the figures the code carried before they
 * moved to the database (payroll-config-seed-data.ts), so seeding changes no
 * result. Only adds a year that has no row; never changes one (HR edits them
 * on the dashboard). Dry run unless --apply.
 *
 *   npx tsx src/scripts/payroll-statutory-seed.ts                  # dry run, both years
 *   npx tsx src/scripts/payroll-statutory-seed.ts --fy 2026-27     # dry run, one year
 *   npx tsx src/scripts/payroll-statutory-seed.ts --apply [--fy 2026-27]
 *
 * Prints the cluster host and database it would write to: check them before
 * adding --apply.
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { STATUTORY_SEED } from './payroll-config-seed-data';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  return eq?.slice(name.length + 1);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const fy = argValue('--fy');
  const rows = fy ? STATUTORY_SEED.filter((r) => r.fy === fy) : STATUTORY_SEED;
  if (fy && rows.length === 0) throw new Error(`No seed for FY ${fy}; seeds exist for ${STATUTORY_SEED.map((r) => r.fy).join(', ')}`);
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  const host = (() => {
    try {
      return new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'http://')).host;
    } catch {
      return '(unparsed host)';
    }
  })();
  console.log(`Target: ${host} / ${process.env.MONGODB_DB ?? '(default db)'}${apply ? '' : ' (dry run)'}`);
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB).collection('payroll_statutory_configs');
    for (const row of rows) {
      const exists = await col.findOne({ fy: row.fy }, { projection: { _id: 1, status: 1 } });
      if (exists) {
        console.log(`FY ${row.fy}: already there (${exists.status}), left as is`);
        continue;
      }
      const now = new Date();
      if (apply) await col.insertOne({ ...structuredClone(row), createdAt: now, updatedAt: now, updatedByUserId: null });
      console.log(`FY ${row.fy}: ${apply ? 'added' : 'would add'} (${row.status}; PF ${row.epf.employeeRate}/${row.epf.employerRate}, ceilings ${row.epf.wageCeilings.map((c) => `${c.from} ₹${c.ceilingPaise / 100}`).join(', ')}; ESI to ₹${row.esi.grossCeilingPaise / 100}; ${row.states.length} states)`);
    }
    if (apply) await col.createIndex({ fy: 1 }, { unique: true });
    if (!apply) console.log('Dry run: nothing written. Add --apply to write.');
  } finally {
    await client.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
