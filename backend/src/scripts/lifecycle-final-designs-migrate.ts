/**
 * Onboarding · Final designs: moves older onboarding templates to the design rows
 * (services/lifecycle/designMigrate.ts, docs/lifecycle/FINAL-DESIGNS.md §7). Non-destructive: rows
 * the designs replace are switched off, never deleted; a template that has design rows is skipped.
 *
 * Dry run by default (prints what it would change); `--apply` writes. `--org <id>` for one company.
 * Never against a real database without the user's yes.
 *   npm run lifecycle:final-designs-migrate -- [--org <id>] [--apply]
 */
import { closeDb, connectDb } from '../config/db';
import { forgetLifecycleReads } from '../services/lifecycle/readCache';
import { migrateTemplatesToFinalDesigns } from '../services/lifecycle/designMigrate';

(async () => {
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--org');
  const org = i > 0 ? process.argv[i + 1] : undefined;
  await connectDb();
  const changes = await migrateTemplatesToFinalDesigns({ apply, ...(org ? { org } : {}) });
  for (const c of changes) {
    console.log(`\n${c.org} · ${c.name} (${c.templateId})`);
    console.log(`  ${apply ? 'added' : 'would add'} ${c.added.length}: ${c.added.join(' · ')}`);
    console.log(`  ${apply ? 'switched off' : 'would switch off'} ${c.switchedOff.length}: ${c.switchedOff.join(' · ') || '—'}`);
    console.log(`  HR's own rows kept as they are: ${c.keptCustom.join(' · ') || '—'}`);
    console.log(`  Sign your joining documents on Day 1: ${c.signOnDay1 ? 'yes (the portal row becomes the Day-1 task)' : 'no sign row'}`);
  }
  console.log(`\n${apply ? 'Updated' : 'Dry run: would update'} ${changes.length} template${changes.length === 1 ? '' : 's'}.${apply ? '' : ' Run with --apply to write.'}`);
  if (apply) forgetLifecycleReads(org ?? null);
  await closeDb();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
