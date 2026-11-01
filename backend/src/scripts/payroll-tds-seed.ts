/**
 * Seeds the national TDS config rows (tds_configs) for the years in
 * TDS_SEED (payroll-config-seed-data.ts). Only adds a year/regime that has no
 * row; never changes one, except to add the HRA exemption rule (`hra`) to a
 * row saved before that field existed, with the figures the code used (50% /
 * 40% of Basic, rent over 10% of Basic). Dry run unless --apply. Writes no
 * org's data: the rows do nothing until an org switches TDS on in Statutory
 * Components.
 *
 *   npx tsx src/scripts/payroll-tds-seed.ts          # dry run
 *   npx tsx src/scripts/payroll-tds-seed.ts --apply
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { TDS_SEED } from './payroll-config-seed-data';

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
    // Rows from before the HRA rule moved out of code: give them the rule the code applied.
    const hra = TDS_SEED.find((r) => r.hra)!.hra!;
    const missing = await col.find({ hra: { $exists: false } }, { projection: { _id: 1, fy: 1, regime: 1 } }).toArray();
    for (const r of missing) {
      if (apply) await col.updateOne({ _id: r._id, hra: { $exists: false } }, { $set: { hra } });
      console.log(`${r.fy} ${r.regime}: ${apply ? 'added' : 'would add'} the HRA exemption rule (${hra.metroPercentOfBasic}% / ${hra.nonMetroPercentOfBasic}% of Basic, rent over ${hra.rentOverPercentOfBasic}%)`);
    }
    if (!apply) console.log('Dry run: nothing written. Add --apply to write.');
  } finally {
    await client.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
