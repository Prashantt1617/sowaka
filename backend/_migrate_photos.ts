/**
 * Moves inline base64 profile photos out of user documents (and out of Connect
 * post bodies) into the media collection, leaving only a key behind.
 *
 * Backs everything up to a local JSON file first. Idempotent.
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';

const uri = (process.env.MONGODB_URI || fs.readFileSync('.env', 'utf8').match(/MONGODB_URI=(.*)/)?.[1] || '').trim();
const APPLY = process.argv.includes('--apply');

function parseDataUri(value: string): { contentType: string; bytes: Buffer } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(value);
  if (!m) return null;
  return { contentType: m[1], bytes: Buffer.from(m[2], 'base64') };
}

async function main() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db('sowaka');
  const users = db.collection('users');
  const media = db.collection('connect_media');
  const posts = db.collection('connect_posts');

  const withPhotos = await users.find({ profilePhotoUrl: { $regex: '^data:' } }).toArray();
  const postsWithPhotos = await posts.find({ 'body.photoUrl': { $regex: '^data:' } }).toArray();

  console.log(`users with inline photos: ${withPhotos.length}`);
  console.log(`posts with inline photos: ${postsWithPhotos.length}`);

  if (!APPLY) {
    let bytes = 0;
    for (const u of withPhotos) bytes += (u.profilePhotoUrl as string).length;
    for (const p of postsWithPhotos) bytes += ((p.body as Record<string, unknown>).photoUrl as string).length;
    console.log(`\nwould free ~${(bytes / 1024 / 1024).toFixed(2)}MB`);
    console.log('DRY RUN — pass --apply to write');
    await client.close();
    return;
  }

  const backupPath = `photo-backup-${Date.now()}.json`;
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        users: withPhotos.map((u) => ({ userId: u.userId, profilePhotoUrl: u.profilePhotoUrl })),
        posts: postsWithPhotos.map((p) => ({ id: p.id, photoUrl: (p.body as Record<string, unknown>).photoUrl })),
      },
      null,
      2,
    ),
  );
  console.log(`\nbacked up to ${backupPath}`);

  for (const user of withPhotos) {
    const parsed = parseDataUri(user.profilePhotoUrl as string);
    if (!parsed) {
      console.log(`  ${user.userId}: unparseable, skipped`);
      continue;
    }
    const objectKey = `mongo/${randomUUID()}`;
    await media.insertOne({
      objectKey,
      contentType: parsed.contentType,
      size: parsed.bytes.length,
      bytes: parsed.bytes,
      createdAt: new Date(),
    });
    await users.updateOne(
      { userId: user.userId },
      { $set: { profilePhotoKey: objectKey }, $unset: { profilePhotoUrl: '' } },
    );
    console.log(`  ${user.userId}: ${(parsed.bytes.length / 1024).toFixed(0)}KB -> ${objectKey}`);
  }

  for (const post of postsWithPhotos) {
    const body = post.body as Record<string, unknown>;
    const parsed = parseDataUri(body.photoUrl as string);
    if (!parsed) continue;
    const objectKey = `mongo/${randomUUID()}`;
    await media.insertOne({
      objectKey,
      contentType: parsed.contentType,
      size: parsed.bytes.length,
      bytes: parsed.bytes,
      createdAt: new Date(),
    });
    await posts.updateOne(
      { id: post.id },
      { $set: { 'body.photoKey': objectKey }, $unset: { 'body.photoUrl': '' } },
    );
    console.log(`  post ${post.id}: ${(parsed.bytes.length / 1024).toFixed(0)}KB -> ${objectKey}`);
  }

  const after: any = await db.command({ collStats: 'users' });
  const afterPosts: any = await db.command({ collStats: 'connect_posts' });
  console.log(`\nusers avgObjSize now: ${(after.avgObjSize / 1024).toFixed(1)}KB`);
  console.log(`connect_posts avgObjSize now: ${(afterPosts.avgObjSize / 1024).toFixed(1)}KB`);

  await client.close();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
