/**
 * Check of the upload resize: no database, no network. Pictures made here
 * in memory go through `fitImage` and `imageCopies` the way an avatar and a
 * feed photo do, and `/media`'s choice of copy is checked without S3.
 * Run with npm run image-fit:check
 */
import sharp from 'sharp';
import {
  AVATAR_EDGE,
  copyKey,
  copyOrder,
  fitImage,
  imageCopies,
  POST_IMAGE_EDGE,
  requestedWidth,
} from '../services/image-fit';
import { mediaCacheControl, mediaCandidates, rememberMissingCopy } from '../services/media-lookup';

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}

async function picture(width: number, height: number, format: 'jpeg' | 'png', alpha = false) {
  // Noise, so the encoder cannot make a tiny file of a flat colour.
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc(width * height * channels);
  let seed = 1;
  for (let i = 0; i < raw.length; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    raw[i] = seed >> 23;
  }
  const image = sharp(raw, { raw: { width, height, channels } });
  const bytes = await (format === 'jpeg' ? image.jpeg({ quality: 95 }) : image.png()).toBuffer();
  return { originalName: `IMG_0001.${format === 'jpeg' ? 'JPG' : 'png'}`, contentType: `image/${format}`, size: bytes.length, bytes };
}

(async () => {
  const photo = await picture(4000, 3000, 'jpeg');
  const post = await fitImage(photo, POST_IMAGE_EDGE);
  const postMeta = await sharp(post.bytes).metadata();
  check('a camera photo is cut to 1600 on its long edge', postMeta.width === 1600 && postMeta.height === 1200, [postMeta.width, postMeta.height]);
  check('and is smaller than it came', post.size < photo.size, [post.size, photo.size]);
  check('a JPEG, named .jpg', post.contentType === 'image/jpeg' && post.originalName === 'IMG_0001.jpg', [post.contentType, post.originalName]);

  const crop = await picture(1080, 1080, 'png');
  const avatar = await fitImage(crop, AVATAR_EDGE);
  const avatarMeta = await sharp(avatar.bytes).metadata();
  check('an opaque PNG avatar becomes a 256 px JPEG', avatarMeta.width === 256 && avatar.contentType === 'image/jpeg', [avatarMeta.width, avatar.contentType]);

  const clear = await picture(1200, 600, 'png', true);
  const sticker = await fitImage(clear, AVATAR_EDGE);
  const stickerMeta = await sharp(sticker.bytes).metadata();
  check('a see-through picture stays a PNG', sticker.contentType === 'image/png' && stickerMeta.hasAlpha === true && stickerMeta.width === 256, [sticker.contentType, stickerMeta.width]);

  const small = await picture(300, 200, 'jpeg');
  const kept = await fitImage(small, POST_IMAGE_EDGE);
  check('a small picture is never enlarged', (await sharp(kept.bytes).metadata()).width === 300);

  const video = { originalName: 'clip.mp4', contentType: 'video/mp4', size: 4, bytes: Buffer.from([0, 0, 0, 0]) };
  check('a video is left as it came', (await fitImage(video, POST_IMAGE_EDGE)) === video);
  const broken = { originalName: 'x.jpg', contentType: 'image/jpeg', size: 4, bytes: Buffer.from([0xff, 0xd8, 0xff, 0]) };
  check('a picture that will not decode is kept, not refused', (await fitImage(broken, POST_IMAGE_EDGE)) === broken);

  // Copies stored beside the original.
  const copies = await imageCopies(photo, 'post');
  const copyWidths = await Promise.all(copies.map(async (copy) => (await sharp(copy.bytes).metadata()).width));
  check('a feed photo gets copies at 256, 720, 1080 and 1600', JSON.stringify(copyWidths) === '[256,720,1080,1600]', copyWidths);
  check('each copy is labelled with its width', copies.every((copy, i) => copy.width === copyWidths[i]), copies.map((c) => c.width));
  check('every copy is smaller than the original', copies.every((copy) => copy.size < photo.size));
  check('and the original is untouched', photo.size === photo.bytes.length && (await sharp(photo.bytes).metadata()).width === 4000);
  const avatarCopies = await imageCopies(crop, 'avatar');
  check('an avatar gets one 256 px copy', avatarCopies.length === 1 && avatarCopies[0].width === 256, avatarCopies.map((c) => c.width));
  const smallCopies = await imageCopies(small, 'post');
  const smallWidths = await Promise.all(smallCopies.map(async (copy) => (await sharp(copy.bytes).metadata()).width));
  check(
    'a 300 px photo gets a 256 copy and one full-size copy, not the same file four times',
    JSON.stringify(smallCopies.map((c) => c.width)) === '[256,720]' && JSON.stringify(smallWidths) === '[256,300]',
    [smallCopies.map((c) => c.width), smallWidths],
  );
  check('a full-size copy is still only kept if smaller', smallCopies.every((copy) => copy.size < small.size));
  check('a 300 px photo asked for at 1080 finds its 720 copy before its 256 one', copyOrder(1080).indexOf(720) < copyOrder(1080).indexOf(256));
  check('a video gets no copies', (await imageCopies(video, 'post')).length === 0);
  check('a broken picture gets no copies, and no error', (await imageCopies(broken, 'post')).length === 0);
  check('a copy is kept beside its original', copyKey('connect/u/2026/10/a-IMG.jpg', 720) === 'connect/u/2026/10/a-IMG.jpg@w720');

  // What `/media` serves.
  check('?w=300 asks for 300', requestedWidth({ w: '300' }) === 300);
  check('?original=1 asks for the original', requestedWidth({ w: '300', original: '1' }) === 'original');
  check('a nonsense width asks for nothing', requestedWidth({ w: 'big' }) === undefined && requestedWidth({ w: '-5' }) === undefined);
  check('300 wide: 720, then larger, then smaller', JSON.stringify(copyOrder(300)) === '[720,1080,1600,256]', copyOrder(300));
  check('80 wide: the 256 copy first', copyOrder(80)[0] === 256);
  check('no width: the largest first', JSON.stringify(copyOrder(undefined)) === '[1600,1080,720,256]', copyOrder(undefined));
  check('wider than every copy: the largest first', copyOrder(4000)[0] === 1600);

  const key = 'connect/u/2026/10/b-IMG.jpg';
  const now = 1_000_000;
  const first = mediaCandidates(key, 700, now);
  check('candidates end at the original', first[first.length - 1].key === key && !first[first.length - 1].copy);
  check('and start at the copy asked for', first[0].key === `${key}@w720` && first[0].copy);
  check('the original alone when asked for it', mediaCandidates(key, 'original', now).length === 1);
  check('a video is read as it is, never looked for in copies', mediaCandidates('connect/u/2026/10/c-clip.mov', 256, now).length === 1);
  rememberMissingCopy(`${key}@w720`, now);
  check('a copy found missing is not looked for again', mediaCandidates(key, 700, now + 1000)[0].key === `${key}@w1080`);
  check('but is after ten minutes', mediaCandidates(key, 700, now + 11 * 60_000)[0].key === `${key}@w720`);

  const year = 'private, max-age=31536000, immutable';
  check('a copy is kept a year, privately', mediaCacheControl({ key: `${key}@w720`, copy: true }, 700, key) === year);
  check('an original asked for is kept a year', mediaCacheControl({ key, copy: false }, 'original', key) === year);
  check('an original standing in for a missing copy is kept a week', mediaCacheControl({ key, copy: false }, 700, key) === 'private, max-age=604800');
  check('a video is kept a year', mediaCacheControl({ key: 'connect/c.mp4', copy: false }, undefined, 'connect/c.mp4') === year);

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
