/**
 * Scratch-database check of a poll's option media — a photo or a video each:
 *
 *   npm run poll-media:check
 *
 * Pictures go on as before (`imageObjectKey`, read back as `imageUrl`). A
 * video arrives in the same `pollOptionImages` upload field and is stored as
 * `videoObjectKey`, read back as `videoUrl` with `mediaKind: 'video'` and no
 * `imageUrl` (app builds from before video would draw that as a broken
 * picture). An edit that sends no files — every app build's edit — keeps
 * each option's picture or video. The dashboard's feed card carries the
 * video too. Storage is stood in for (no S3 here): the upload is replaced in
 * the module so nothing is written anywhere but this scratch database.
 */
import Module from 'node:module';
import { closeDb, connectDb, connectPosts, getDb, users } from '../config/db';
import type * as Storage from '../services/s3-connect-media.service';

// Every upload lands nowhere: a key under the Connect prefix, as S3 would
// give. Swapped in as the storage module loads, before the services that use
// it do (its exports cannot be reassigned once loaded).
let n = 0;
const stored: string[] = [];
const fakeUpload: typeof Storage.uploadConnectMedia = async (userId, file) => {
  const objectKey = `connect/posts/${userId}/${++n}-${file.originalName}`;
  stored.push(objectKey);
  return { objectKey, contentType: file.contentType, size: file.size };
};
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const load = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
  const loaded = load.call(this, request, ...rest);
  return request.endsWith('/s3-connect-media.service')
    ? { ...(loaded as typeof Storage), uploadConnectMedia: fakeUpload }
    : loaded;
};
/* eslint-disable @typescript-eslint/no-require-imports */
const { createConnectPost, getConnectPost, updateConnectPost } =
  require('../services/connect.service') as typeof import('../services/connect.service');
const { feedPage } = require('../services/engagement-feed.service') as typeof import('../services/engagement-feed.service');
/* eslint-enable @typescript-eslint/no-require-imports */

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}

const ORG = 'poll-media-scratch';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)]);

type Option = {
  id: string;
  label: string;
  imageUrl?: string;
  videoUrl?: string;
  mediaKind?: string;
  imageObjectKey?: string;
  videoObjectKey?: string;
  videoContentType?: string;
};

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'poll_media_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();

  await users().insertMany([
    { userId: 'asha', name: 'Asha', email: 'asha@poll-media.test', org: ORG, lifecycleStatus: 'active' },
    { userId: 'hr', name: 'HR', email: 'hr@poll-media.test', org: ORG, lifecycleStatus: 'active', dashboardAccess: true },
  ] as never[]);

  const file = (originalName: string, contentType: string, bytes: Buffer) => ({
    originalName,
    contentType,
    size: bytes.length,
    bytes,
  });

  // 1. An image poll, as 1.3.9 sends it: unchanged.
  const picture = (await createConnectPost('asha', {
    type: 'survey',
    body: { title: 'Lunch?', options: ['Pizza', 'Dosa'] },
    pollOptionImages: [file('dosa.png', 'image/png', PNG)],
    pollOptionImageIndexes: [1],
  })) as unknown as { id: string; body: { options: Option[] } };
  const pictureRow = await connectPosts().findOne({ id: picture.id });
  const pictureStored = (pictureRow?.body.options ?? []) as Option[];
  check('image poll: picture stored as imageObjectKey', Boolean(pictureStored[1]?.imageObjectKey), pictureStored);
  check('image poll: no video fields', !pictureStored.some((o) => o.videoObjectKey), pictureStored);
  check('image poll: imageUrl is a /media path', picture.body.options[1].imageUrl?.startsWith('/media/') === true, picture.body.options[1]);
  check('image poll: no videoUrl or mediaKind', picture.body.options.every((o) => !o.videoUrl && !o.mediaKind), picture.body.options);
  check('image poll: first option has no picture', !picture.body.options[0].imageUrl, picture.body.options[0]);

  // 2. A video poll, a video and a picture side by side, through the same field.
  const video = (await createConnectPost('asha', {
    type: 'survey',
    body: { title: 'Best move?', options: ['Moonwalk', 'Robot', 'Floss'] },
    pollOptionImages: [file('moon.mp4', 'video/mp4', MP4), file('robot.png', 'image/png', PNG), file('floss.mov', 'video/quicktime', MP4)],
    pollOptionImageIndexes: [0, 1, 2],
  })) as unknown as { id: string; body: { options: Option[] } };
  const videoRow = await connectPosts().findOne({ id: video.id });
  const videoStored = (videoRow?.body.options ?? []) as Option[];
  check('video poll: video stored as videoObjectKey with its type', videoStored[0]?.videoObjectKey?.endsWith('moon.mp4') === true && videoStored[0]?.videoContentType === 'video/mp4', videoStored[0]);
  check('video poll: a video is never imageObjectKey', !videoStored[0]?.imageObjectKey && !videoStored[2]?.imageObjectKey, videoStored);
  check('video poll: quicktime kept as its type', videoStored[2]?.videoContentType === 'video/quicktime', videoStored[2]);
  check('video poll: the picture beside it as before', Boolean(videoStored[1]?.imageObjectKey) && !videoStored[1]?.videoObjectKey, videoStored[1]);
  const [moon, robot, floss] = video.body.options;
  check('video poll view: videoUrl /media path, mediaKind video', moon.videoUrl?.startsWith('/media/') === true && moon.mediaKind === 'video', moon);
  check('video poll view: no imageUrl for a video (old builds)', !moon.imageUrl && !floss.imageUrl, [moon, floss]);
  check('video poll view: picture option unchanged', robot.imageUrl?.startsWith('/media/') === true && !robot.videoUrl && !robot.mediaKind, robot);

  // 3. Read again, as anyone in the audience.
  const read = (await getConnectPost('hr', video.id)) as unknown as { body: { options: Option[] } };
  check('read back: video still a video', read.body.options[0].videoUrl === moon.videoUrl && !read.body.options[0].imageUrl, read.body.options[0]);

  // 4. Edited with no files, as every app build edits: media kept.
  const uploadsBefore = stored.length;
  const edited = (await updateConnectPost('asha', video.id, {
    type: 'survey',
    body: { title: 'Best move ever?', options: ['Moonwalk', 'Robot', 'Floss'] },
  })) as unknown as { body: { title: string; options: Option[] } };
  check('edit: nothing uploaded', stored.length === uploadsBefore, stored.length);
  check('edit: title changed', edited.body.title === 'Best move ever?', edited.body.title);
  check('edit: video kept', edited.body.options[0].videoUrl === moon.videoUrl && edited.body.options[0].mediaKind === 'video', edited.body.options[0]);
  check('edit: picture kept', edited.body.options[1].imageUrl === robot.imageUrl, edited.body.options[1]);
  check('edit: quicktime video kept', edited.body.options[2].videoUrl === floss.videoUrl, edited.body.options[2]);
  const editedRow = await connectPosts().findOne({ id: video.id });
  check('edit: stored type kept', ((editedRow?.body.options ?? []) as Option[])[2]?.videoContentType === 'video/quicktime', editedRow?.body.options);

  // 5. The dashboard's feed card carries the video.
  const page = (await feedPage({ userId: 'hr', org: ORG, email: 'hr@poll-media.test', name: 'HR' }, {})) as {
    posts: { id: string; body: { options?: Option[] } }[];
  };
  const card = page.posts.find((p) => p.id === video.id);
  check('dashboard card: video option has videoUrl', card?.body.options?.[0]?.videoUrl?.startsWith('/media/') === true, card?.body.options);
  check('dashboard card: video option has no imageUrl', !card?.body.options?.[0]?.imageUrl, card?.body.options?.[0]);
  check('dashboard card: picture option keeps imageUrl', card?.body.options?.[1]?.imageUrl?.startsWith('/media/') === true, card?.body.options?.[1]);

  await db.dropDatabase();
  await closeDb();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(async (error) => {
  console.error(error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
