/**
 * Seeds the national TDS config rows (tds_configs) for the years in
 * TDS_SEED, marked "to_confirm". Only adds a year/regime that has no row;
 * never changes one. Dry run unless --apply. Writes no org's data: the rows
 * do nothing until an org switches TDS on in Statutory Components.
 *
 *   npx tsx src/scripts/payroll-tds-seed.ts          # dry run
 *   npx tsx src/scripts/payroll-tds-seed.ts --apply
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { TDS_SEED } from '../shared/payroll/tds';

async function main() {
  const apply = process.argv.includes('--apply');
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB).collection('tds_configs');
    for (const row of TDS_SEED) {
      const exists = await col.findOne({ fy: row.fy, regime: row.regime }, { projection: { _id: 1, status: 1 } });
      if (exists) {
        console.log(`${row.fy} ${row.regime}: already there (${exists.status}), left as is`);
        continue;
      }
      if (apply) await col.insertOne({ ...row, createdAt: new Date(), updatedAt: new Date() });
      console.log(`${row.fy} ${row.regime}: ${apply ? 'added' : 'would add'} (${row.status})`);
    }
    if (!apply) console.log('Dry run: nothing written. Add --apply to write.');
  } finally {
    await client.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
