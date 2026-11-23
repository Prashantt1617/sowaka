/**
 * Moves one company's running onboarding journeys that were made before the Final designs onto the
 * template's design (engine.adoptTemplateDesign): the design's joiner tasks and accesses appear in the
 * app, and open tasks the template switched off are cancelled. Done tasks stay. Dry run by default.
 *
 *   npm run lifecycle:adopt-design -- --org sowaka            what would change
 *   npm run lifecycle:adopt-design -- --org sowaka --apply    change it
 */
import { closeDb, connectDb, journeys } from '../config/db';
import { adoptTemplateDesign } from '../services/lifecycle/engine';
import { forgetLifecycleReads } from '../services/lifecycle/readCache';

async function main() {
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--org');
  const org = i > 0 ? process.argv[i + 1] : undefined;
  if (!org) throw new Error('--org <company id> is required');
  await connectDb();
  const running = await journeys().find({ org, kind: 'onboarding', closedAt: { $exists: false } }, { projection: { _id: 0, id: 1, templateSnapshot: 1 } }).toArray();
  // Already on the design: its own copy holds the joiner task rows.
  const old = running.filter((j) => !(j.templateSnapshot?.tasks ?? []).some((t) => t.design?.section === 'task'));
  console.log(`${org}: ${running.length} running, ${old.length} made before the Final designs`);
  for (const j of old) {
    const r = await adoptTemplateDesign(j.id, { dry: !apply });
    console.log(`  ${j.id.slice(0, 8)} ${apply ? 'added' : 'would add'} ${r.added.length}, ${apply ? 'cancelled' : 'would cancel'} ${r.cancelled.length}${r.cancelled.length ? ` (${r.cancelled.join(' · ')})` : ''}`);
  }
  if (apply) forgetLifecycleReads(org);
  console.log(apply ? 'Done.' : 'Dry run: nothing changed. Run with --apply to change it.');
  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
