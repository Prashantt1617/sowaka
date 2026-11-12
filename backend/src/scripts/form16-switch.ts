/**
 * The Form 16 switch: whether the app shows Form 16 to a company's people
 * (Payroll › Downloads › Form 16, the Tax page's "Download Form 16"). It is
 * `companies.features.form16`, absent or false = hidden; there is no dashboard
 * control. HR can upload on Payroll Runs › Form 16 either way.
 *
 * Dry run by default: prints the current value and what it would set. Only
 * `--apply` writes, and the database may be the shared production one.
 *
 *   npm run form16:switch -- --list                       # every company's value
 *   npm run form16:switch -- --org convrse --on           # dry run
 *   npm run form16:switch -- --org convrse --on --apply   # turn it on
 *   npm run form16:switch -- --org convrse --off --apply  # hide it again
 *
 * `npm run form16:switch` runs the compiled dist/scripts/form16-switch.js
 * (`npm run build` first); from source: npx tsx src/scripts/form16-switch.ts …
 * The database is MONGODB_URI / MONGODB_DB from the environment (.env).
 */
import { closeDb, companies, connectDb } from '../config/db';
import { env } from '../config/env';

const args = process.argv.slice(2);
const has = (name: string) => args.includes(`--${name}`);
const valueOf = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const shown = (value: unknown) => (value === true ? 'on' : value === false ? 'off' : 'off (not set)');

function usage(message?: string): never {
  if (message) console.error(message);
  console.error('Usage: form16-switch --list | --org <company id> --on|--off [--apply]');
  process.exit(1);
}

async function main() {
  const known = new Set(['--list', '--org', '--on', '--off', '--apply']);
  const org = valueOf('org');
  for (const a of args) if (!known.has(a) && a !== org) usage(`Unknown argument "${a}".`);

  await connectDb();
  console.log(`database: ${env.mongoDbName}`);

  if (has('list')) {
    if (org || has('on') || has('off') || has('apply')) usage('--list takes nothing else.');
    const rows = await companies().find({}, { projection: { _id: 0, id: 1, name: 1, 'features.form16': 1 } }).sort({ id: 1 }).toArray();
    for (const row of rows) console.log(`${row.id.padEnd(16)} ${shown(row.features?.form16).padEnd(14)} ${row.name ?? ''}`);
    console.log(`${rows.length} companies; Form 16 shown in the app at ${rows.filter((r) => r.features?.form16 === true).length}`);
    return;
  }

  if (!org || org.startsWith('--')) usage('Name the company: --org <id> (see --list).');
  if (has('on') === has('off')) usage('Say --on or --off.');
  const next = has('on');
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, id: 1, name: 1, 'features.form16': 1 } });
  if (!company) usage(`No company "${org}" (see --list).`);

  const current = company.features?.form16;
  console.log(`company: ${company.id} (${company.name ?? ''})`);
  console.log(`features.form16 now: ${shown(current)}`);
  if (current === next) {
    console.log(`already ${shown(next)}: nothing to change`);
    return;
  }
  if (!has('apply')) {
    console.log(`would set features.form16 = ${next} (${next ? 'Form 16 shown in the app' : 'Form 16 hidden in the app'})`);
    console.log('dry run: nothing written. Add --apply to write it.');
    return;
  }
  await companies().updateOne({ id: org }, { $set: { 'features.form16': next } });
  const after = await companies().findOne({ id: org }, { projection: { _id: 0, 'features.form16': 1 } });
  console.log(`set features.form16 = ${next}; now: ${shown(after?.features?.form16)}`);
  console.log(next ? 'The app shows Form 16 from the next time it loads Payroll.' : 'The app hides Form 16 from the next time it loads Payroll.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
