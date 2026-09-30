// Puts the Care catalogue file into the database, where the app and the web
// pages read it from. Run once on a new database; after that, edit the
// database document (id 'catalog' in care_content) and nothing needs a deploy.
//
//   npx tsx backend/scripts/seed-care-catalog.ts          # only when none is stored
//   npx tsx backend/scripts/seed-care-catalog.ts --force  # replace what is stored with the file
import { careContent, connectDb } from '../src/config/db';
import { catalogFromFile, storeCatalog } from '../src/services/care.service';

async function main() {
  await connectDb();
  const force = process.argv.includes('--force');
  const stored = await careContent().findOne({ id: 'catalog' }, { projection: { _id: 1 } });
  if (stored && !force) {
    console.log('a catalogue is already stored; pass --force to replace it with the file');
    process.exit(0);
  }
  const catalog = catalogFromFile();
  await storeCatalog(catalog);
  console.log(`${stored ? 'replaced' : 'stored'} the catalogue: ${catalog.topics.length} topics, ${(catalog.stretches ?? []).length} stretches, ${(catalog.moods ?? []).length} moods`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
