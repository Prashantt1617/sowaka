// Attaches an instructions video to a relay event: uploads the file through the
// same pipeline a Connect post uses, then stores its key on the event so the
// How-to-play screen can play it.
//   npx tsx backend/scripts/attach-relay-video.ts <eventId> <file>
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { connectDb, relayEvents } from '../src/config/db';
import { uploadConnectMedia } from '../src/services/s3-connect-media.service';

async function main() {
  const [eventId, file] = process.argv.slice(2);
  if (!eventId || !file) throw new Error('usage: attach-relay-video.ts <eventId> <file>');
  await connectDb();
  const event = await relayEvents().findOne({ id: eventId });
  if (!event) throw new Error(`no relay event ${eventId}`);
  const bytes = readFileSync(file);
  const media = await uploadConnectMedia(event.createdBy, {
    originalName: basename(file),
    contentType: 'video/mp4',
    size: bytes.length,
    bytes,
  });
  await relayEvents().updateOne(
    { id: eventId },
    { $set: { instructionsVideoUrl: media.objectKey, updatedAt: new Date() } },
  );
  console.log(`${event.name}: instructions video set (${(bytes.length / 1024).toFixed(0)} KB) -> ${media.objectKey}`);
  process.exit(0);
}
main().catch((error) => { console.error(error); process.exit(1); });
