/**
 * One-time seed of a company's app payroll deadlines (Company.payrollEmployee)
 * with the values the app used before HR could set them: split cutoff the
 * 15th, declarations due 30 Nov, proofs 31 Jan, bills 31 Mar. Only fields HR
 * has not set are written; the app switch (appEnabled) is never touched. HR
 * then sees them on the dashboard and changes them there.
 *
 * Dry run by default (prints what it would write); --apply writes.
 *   npm run payroll:employee-settings-seed -- --org sowaka
 *   npm run payroll:employee-settings-seed -- --org sowaka --apply
 *
 * It writes to whatever database MONGODB_URI / MONGODB_DB point at: check
 * that before --apply. Never run it against production without a yes.
 */
import { connectDb, getDb } from '../config/db';
import { seedEmployeePayrollSettings } from '../services/employeePayroll.settings';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const org = arg('--org');
  if (!org || org.startsWith('--')) throw new Error('usage: payroll-employee-settings-seed --org <org> [--apply]');
  const apply = process.argv.includes('--apply');
  await connectDb();
  console.log(`database: ${getDb().databaseName}${apply ? '' : ' (dry run: nothing is written; add --apply to write)'}`);
  const result = await seedEmployeePayrollSettings(org, apply);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
