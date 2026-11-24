/**
 * Scratch-database check of the "Start a tour" post (Dashboard › Engagement ›
 * Feed › Post the app tour):
 *
 *   npm run app-tour-post:check
 *
 * Posted with the defaults it is an `app_tour` post from the company to
 * everyone, with the title, caption and button label HR asked for and a
 * `text` older app builds show instead of the card. A second while one is
 * in the feed is refused unless HR replaces it, which takes the old one down
 * and leaves one. A picture is stored like any feed picture; a video is
 * refused. The app reads it, likes it and comments on it like any post, the
 * app itself cannot post one, and the dashboard's card carries the caption
 * and the button. Storage is stood in for (no S3 here).
 */
import Module from 'node:module';
import { closeDb, companies, connectDb, connectPosts, getDb, users } from '../config/db';
import type * as Storage from '../services/s3-connect-media.service';

let n = 0;
const fakeUpload: typeof Storage.uploadConnectMedia = async (userId, file) => ({
  objectKey: `connect/posts/${userId}/${++n}-${file.originalName}`,
  contentType: file.contentType,
  size: file.size,
});
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const load = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
  const loaded = load.call(this, request, ...rest);
  return request.endsWith('/s3-connect-media.service')
    ? { ...(loaded as typeof Storage), uploadConnectMedia: fakeUpload }
    : loaded;
};
/* eslint-disable @typescript-eslint/no-require-imports */
const { addConnectComment, createConnectPost, getConnectFeed, getConnectPost, toggleConnectReaction } =
  require('../services/connect.service') as typeof import('../services/connect.service');
const { APP_TOUR_DEFAULTS, APP_TOUR_UPDATE_LINE, currentAppTourPost, publishAppTourPost } =
  require('../services/app-tour-post.service') as typeof import('../services/app-tour-post.service');
const { feedPage } = require('../services/engagement-feed.service') as typeof import('../services/engagement-feed.service');
/* eslint-enable @typescript-eslint/no-require-imports */

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}
async function refused(run: () => Promise<unknown>): Promise<number | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { statusCode?: number }).statusCode ?? -1;
  }
}

const ORG = 'app-tour-scratch';
const HR = { userId: 'hr', org: ORG, email: 'hr@app-tour.test', name: 'HR' };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'app_tour_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();

  await companies().insertOne({ id: ORG, name: 'Tour Co' } as never);
  await users().insertMany([
    { userId: 'asha', name: 'Asha', email: 'asha@app-tour.test', org: ORG, lifecycleStatus: 'active' },
    { userId: 'hr', name: 'HR', email: 'hr@app-tour.test', org: ORG, lifecycleStatus: 'active', dashboardAccess: true },
  ] as never[]);

  // 1. Nothing in the feed yet.
  const before = await currentAppTourPost(HR);
  check('nothing live at first', before.current === null, before);
  check('defaults offered', before.defaults.actionLabel === 'Get tour' && before.defaults.title === 'Take the Sowaka tour', before.defaults);

  // 2. Posted with the defaults.
  const first = await publishAppTourPost(HR, {});
  const row = await connectPosts().findOne({ id: first.id });
  check('stored as app_tour', row?.type === 'app_tour', row?.type);
  check('from the company, nobody to tap', row?.author.name === 'Tour Co' && row?.author.userId === '', row?.author);
  check('to everyone', row?.audience.label === 'Public' && !row?.audience.teamId && !row?.audience.userIds, row?.audience);
  check('tag is App tour', row?.tag === 'App tour', row?.tag);
  check(
    'default words',
    row?.body.title === APP_TOUR_DEFAULTS.title && row?.body.caption === APP_TOUR_DEFAULTS.caption && row?.body.actionLabel === 'Get tour',
    row?.body,
  );
  check(
    'older builds: text carries title, caption and the update line',
    row?.body.text === `${APP_TOUR_DEFAULTS.title}\n\n${APP_TOUR_DEFAULTS.caption}\n\n${APP_TOUR_UPDATE_LINE}`,
    row?.body.text,
  );
  check('no picture', row?.body.mediaKind === 'none' && !row?.body.mediaObjectKey, row?.body);
  const live = await currentAppTourPost(HR);
  check('now live', live.current?.id === first.id, live.current);

  // 3. A second without replacing: refused, nothing written.
  check('second without replace: 409', (await refused(() => publishAppTourPost(HR, { title: 'Again' }))) === 409);
  check('still one', (await connectPosts().countDocuments({ org: ORG, type: 'app_tour' })) === 1);

  // 4. A video is refused.
  const mp4 = { originalName: 'clip.mp4', contentType: 'video/mp4', size: 10, bytes: Buffer.alloc(10) };
  check('video refused: 400', (await refused(() => publishAppTourPost(HR, { replace: true }, mp4))) === 400);
  check('old one kept after a refusal', Boolean(await connectPosts().findOne({ id: first.id })));

  // 5. Replaced, with a picture and HR's own words (from a form: strings).
  const image = { originalName: 'tour.png', contentType: 'image/png', size: PNG.length, bytes: PNG };
  const second = await publishAppTourPost(
    HR,
    { title: '  Find your way  ', caption: 'A minute, start to finish.', actionLabel: 'Show me', replace: 'true' },
    image,
  );
  const row2 = await connectPosts().findOne({ id: second.id });
  check('replace: old one gone', !(await connectPosts().findOne({ id: first.id })) && second.replaced.includes(first.id), second);
  check('replace: one left', (await connectPosts().countDocuments({ org: ORG, type: 'app_tour' })) === 1);
  check('words trimmed and kept', row2?.body.title === 'Find your way' && row2?.body.actionLabel === 'Show me', row2?.body);
  check('picture stored as feed media', row2?.body.mediaKind === 'image' && String(row2?.body.mediaObjectKey).endsWith('tour.png'), row2?.body);

  // 6. The app reads it like any post, likes it and comments on it.
  const view = (await getConnectPost('asha', second.id)) as unknown as { type: string; body: Record<string, unknown> };
  check('app read: type app_tour', view.type === 'app_tour', view.type);
  check('app read: picture signed', typeof view.body.mediaUrl === 'string' && String(view.body.mediaUrl).length > 0, view.body);
  const feed = await getConnectFeed('asha');
  check('in asha\'s feed', feed.posts.some((p) => p.id === second.id));
  const liked = (await toggleConnectReaction('asha', second.id)) as unknown as { liked: boolean; likeCount: number };
  check('likes work', liked.liked === true && liked.likeCount === 1, liked);
  const commented = (await addConnectComment('asha', second.id, 'Nice tour')) as unknown as { commentCount: number };
  check('comments work', commented.commentCount === 1, commented);

  // 7. The app cannot post one itself.
  check('app cannot post app_tour: 400', (await refused(() => createConnectPost('hr', { type: 'app_tour', body: {} }))) === 400);

  // 8. The dashboard's card.
  const page = (await feedPage(HR, {})) as { posts: { id: string; type: string; auto: boolean; body: Record<string, unknown> }[] };
  const card = page.posts.find((p) => p.id === second.id);
  check('dashboard card: caption as its text', card?.body.text === 'A minute, start to finish.', card?.body.text);
  check('dashboard card: button label', (card?.body.tour as { actionLabel?: string } | undefined)?.actionLabel === 'Show me', card?.body.tour);
  check('dashboard card: picture', Array.isArray(card?.body.media) && (card?.body.media as unknown[]).length === 1, card?.body.media);
  check('dashboard card: not auto-posted', card?.auto === false, card?.auto);

  await db.dropDatabase();
  await closeDb();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(async (error) => {
  console.error(error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
