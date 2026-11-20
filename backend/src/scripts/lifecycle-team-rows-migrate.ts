/**
 * One-off: the team side's tasks (Teams › Joiners: the buddy's, the head of department's and the
 * manager's extra ones) became rows of the onboarding templates. Adds the missing ones to every
 * existing onboarding template (new templates get them from the seed). By team key, so a second
 * run adds nothing and a row HR edited or switched off is left alone. Journeys keep their ticks
 * (journey.teamTasks, by the same keys).
 *
 * Dry run by default (lists what it would add); `--apply` writes. `--org <id>` for one company.
 *   node --env-file=.env --import tsx src/scripts/lifecycle-team-rows-migrate.ts [--apply] [--org <id>]
 */
import { closeDb, connectDb } from '../config/db';
import { addTeamRowsToTemplates } from '../services/lifecycle/templates';

(async () => {
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--org');
  const org = i > 0 ? process.argv[i + 1] : undefined;
  await connectDb();
  const changes = await addTeamRowsToTemplates({ apply, ...(org ? { org } : {}) });
  for (const c of changes) console.log(`${c.org} · ${c.name} (${c.templateId}): ${apply ? 'added' : 'would add'} ${c.added.length}: ${c.added.join(', ')}`);
  console.log(`${apply ? 'Updated' : 'Dry run: would update'} ${changes.length} template${changes.length === 1 ? '' : 's'}.${apply ? '' : ' Run with --apply to write.'}`);
  await closeDb();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
