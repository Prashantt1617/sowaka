/**
 * Clears the inline `author.photoUrl` snapshot from Connect posts.
 *
 * `viewPost` resolves the author's live photo on every read, so the snapshot is
 * redundant — it only duplicated a base64 image into every post that author
 * wrote. Backs up first; idempotent.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const uri = (process.env.MONGODB_URI || fs.readFileSync('.env', 'utf8').match(/MONGODB_URI=(.*)/)?.[1] || '').trim();
const APPLY = process.argv.includes('--apply');

async function main() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const posts = client.db('sowaka').collection('connect_posts');

  const affected = await posts.find({ 'author.photoUrl': { $regex: '^data:' } }).toArray();
  const bytes = affected.reduce((sum, p) => sum + ((p.author as any)?.photoUrl?.length ?? 0), 0);
  console.log(`posts with inline author photos: ${affected.length}`);
  console.log(`would free ~${(bytes / 1024 / 1024).toFixed(2)}MB`);

  if (!APPLY) {
    console.log('DRY RUN — pass --apply to write');
    await client.close();
    return;
  }

  const backupPath = `author-photo-backup-${Date.now()}.json`;
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      affected.map((p) => ({ id: p.id, photoUrl: (p.author as any).photoUrl })),
      null,
      2,
    ),
  );
  console.log(`backed up to ${backupPath}`);

  const result = await posts.updateMany(
    { 'author.photoUrl': { $regex: '^data:' } },
    { $unset: { 'author.photoUrl': '' } },
  );
  console.log(`cleared on ${result.modifiedCount} posts`);

  const stats: any = await client.db('sowaka').command({ collStats: 'connect_posts' });
  console.log(`connect_posts now: avgObjSize=${(stats.avgObjSize / 1024).toFixed(1)}KB total=${(stats.size / 1024 / 1024).toFixed(2)}MB`);

  await client.close();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
