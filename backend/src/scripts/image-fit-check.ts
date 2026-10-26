/**
 * Check of the upload resize: no database, no network. Pictures made here
 * in memory go through `fitImage` the way an avatar and a feed photo do.
 * Run with npm run image-fit:check
 */
import sharp from 'sharp';
import { AVATAR_EDGE, fitImage, POST_IMAGE_EDGE } from '../services/image-fit';

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

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
