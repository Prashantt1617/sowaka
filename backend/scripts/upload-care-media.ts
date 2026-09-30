// Uploads Sowaka's Care media (Move clips, Listen tracks, Breathe backgrounds)
// through the same pipeline a Connect post uses, and prints the keys the
// catalogue needs. Run once per batch of files; re-running uploads again.
//
//   npx tsx backend/scripts/upload-care-media.ts <folder-with-move> <folder-with-listen> <folder-with-sound>
//
// Output: a JSON map of "<group>/<clean name>" -> "/media/<objectKey>", which
// is pasted into src/content/care-catalog.json.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { connectDb, users } from '../src/config/db';
import { uploadConnectMedia } from '../src/services/s3-connect-media.service';

const CONTENT_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

function cleanName(file: string): string {
  return file
    .replace(extname(file), '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  const [moveDir, listenDir, soundDir] = process.argv.slice(2);
  if (!moveDir || !listenDir || !soundDir) throw new Error('usage: upload-care-media.ts <move dir> <listen dir> <sound dir>');
  await connectDb();
  // Uploads are recorded against a Sowaka counsellor; the key itself is random.
  const owner = await users().findOne({ email: 'tanvi@getsowaka.com' });
  if (!owner) throw new Error('no owner user');

  const out: Record<string, string> = {};
  for (const [group, dir] of [['move', moveDir], ['listen', listenDir], ['sound', soundDir]] as const) {
    for (const file of readdirSync(dir).sort()) {
      const ext = extname(file).toLowerCase();
      const contentType = CONTENT_TYPES[ext];
      if (!contentType || file.startsWith('.')) continue;
      const path = join(dir, file);
      const bytes = readFileSync(path);
      const media = await uploadConnectMedia(owner.userId, { originalName: file, contentType, size: statSync(path).size, bytes });
      const name = `${group}/${cleanName(file)}`;
      // The media route takes the key as one path segment, so its slashes are encoded.
      out[name] = `/media/${encodeURIComponent(media.objectKey)}`;
      console.error(`${name}  ${(bytes.length / 1024 / 1024).toFixed(1)} MB -> ${media.objectKey}`);
    }
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
