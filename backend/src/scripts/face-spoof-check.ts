/**
 * The server's screen detector run for real, the way a face check runs it:
 *
 *   SPOOF_SAMPLES=/path/to/samples npm run face:spoof-check
 *
 * Loads MiniFASNet V2 through LiteRT.js, then for each Silent-Face sample
 * picture (one real face, one printed photo, one tablet) makes the crop the
 * phone sends (the face box scaled 2.7, held inside the picture, as a 96 px
 * square JPEG at quality 80) and scores it. The real face must pass, both
 * spoofs must be refused, and the 96 px crop must score as the 160 px one
 * older builds sent. The two crops in fixtures/ (160 px, quality 90: a real
 * face and a printed one) are scored at 160 and shrunk to what is sent now,
 * the same check without the folder. Otherwise it checks that the detector
 * loads and that the verdict lines sit where they should. Exits non-zero on
 * a failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { env } from '../config/env';
import { CROP_QUALITY, CROP_SIDE, median, realProbability, scoreBurst, spoofDetectorReady, spoofVerdict } from '../services/face-spoof.service';

/** The face box in each picture once upright (480 × 640), forehead to chin, ear to ear. */
const FACES: Record<string, { box: [number, number, number, number]; expect: 'pass' | 'spoof' }> = {
  'image_T1.jpg': { box: [105, 105, 195, 240], expect: 'pass' },
  'image_F1.jpg': { box: [205, 140, 220, 250], expect: 'spoof' },
  'image_F2.jpg': { box: [150, 215, 210, 270], expect: 'spoof' },
};

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
}

/**
 * The phone's crop (spoofCropBox in face_spoof_check.dart): the box scaled
 * 2.7 about its centre, the scale held down so it fits, shifted (not shrunk)
 * back inside the picture.
 */
function cropBox(box: [number, number, number, number], width: number, height: number) {
  const [x, y, w, h] = box;
  const scale = Math.min(2.7, (height - 1) / h, (width - 1) / w);
  const cw = w * scale;
  const ch = h * scale;
  let left = Math.max(0, x + w / 2 - cw / 2);
  let top = Math.max(0, y + h / 2 - ch / 2);
  if (left + cw > width - 1) left = width - 1 - cw;
  if (top + ch > height - 1) top = height - 1 - ch;
  return { left: Math.round(left), top: Math.round(top), width: Math.round(cw), height: Math.round(ch) };
}

async function main() {
  check(await spoofDetectorReady(), 'detector loads');
  check(spoofVerdict(0.95) === 'pass', `0.95 passes (accept ${env.face.spoofAccept})`);
  check(spoofVerdict((env.face.spoofAccept + env.face.spoofUncertainLow) / 2) === 'uncertain', 'between the lines is uncertain');
  check(spoofVerdict(0.01) === 'spoof', `0.01 is refused (low ${env.face.spoofUncertainLow})`);
  check(median([0.9, 0.1, 0.8]) === 0.8 && Math.abs(median([0.2, 0.4])! - 0.3) < 1e-9 && median([]) === null, 'median');
  check((await realProbability(Buffer.from('not an image'))) === null, 'an unreadable crop scores nothing');

  // What is sent now against what older builds sent: the model reads both at
  // 80 px, so shrinking the crop to 96 px at quality 80 moves its score by
  // little, and never across a verdict line.
  const sent = (crop: Buffer) => sharp(crop).resize(CROP_SIDE, CROP_SIDE, { fit: 'fill', kernel: 'linear' }).jpeg({ quality: CROP_QUALITY }).toBuffer();
  const compare = async (label: string, old: Buffer) => {
    const small = await sent(old);
    const [before, after] = [await realProbability(old), await realProbability(small)];
    const ok = before !== null && after !== null && Math.abs(before - after) < 0.05 && spoofVerdict(before) === spoofVerdict(after);
    check(ok, `${label}: ${CROP_SIDE} px q${CROP_QUALITY} scores ${after?.toFixed(4)} against ${before?.toFixed(4)} at 160 px q90 (${small.length} B against ${old.length} B)`);
  };
  for (const name of ['face-crop-real.jpg', 'face-crop-print.jpg']) {
    await compare(`fixture ${name}`, readFileSync(join(__dirname, 'fixtures', name)));
  }

  const folder = process.env.SPOOF_SAMPLES;
  if (!folder || !Object.keys(FACES).every((name) => existsSync(join(folder, name)))) {
    console.log('skipped the sample pictures: set SPOOF_SAMPLES to the folder with the Silent-Face samples');
  } else {
    for (const [name, face] of Object.entries(FACES)) {
      const upright = await sharp(readFileSync(join(folder, name))).rotate().toBuffer({ resolveWithObject: true });
      const region = cropBox(face.box, upright.info.width, upright.info.height);
      const old = await sharp(upright.data).extract(region).resize(160, 160, { fit: 'fill', kernel: 'linear' }).jpeg({ quality: 90 }).toBuffer();
      await compare(name, old);
      const crop = await sharp(upright.data).extract(region).resize(CROP_SIDE, CROP_SIDE, { fit: 'fill', kernel: 'linear' }).jpeg({ quality: CROP_QUALITY }).toBuffer();
      const started = Date.now();
      const burst = await scoreBurst(Array.from({ length: 8 }, () => crop));
      const ms = Date.now() - started;
      const verdict = burst.median === null ? 'none' : spoofVerdict(burst.median);
      check(verdict === face.expect, `${name}: median ${burst.median?.toFixed(4)} → ${verdict} (expected ${face.expect}), 8 crops in ${ms} ms`);
    }
  }
  console.log(failures ? `${failures} failed` : 'All screen detector checks passed.');
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
