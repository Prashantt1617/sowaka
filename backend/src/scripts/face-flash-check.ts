/**
 * The server's light check on made-up faces, with no database: a face that
 * takes each colour passes, a screen that only brightens does not, and the
 * readings are the YCbCr means the phone would report. Run:
 *
 *   npm run face:flash-check
 */
import sharp from 'sharp';
import { env } from '../config/env';
import { faceLightOf, flashAnswered } from '../services/face-id.service';

async function solid(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).jpeg({ quality: 95 }).toBuffer();
}

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed += 1;
}

async function main() {
  const skin = await solid(170, 130, 110);
  const before = await faceLightOf(skin);
  check('baseline reads as skin', before.luma > 120 && before.luma < 150 && before.cr > 128 && before.cb < 128, `L${before.luma.toFixed(1)} Cb${before.cb.toFixed(1)} Cr${before.cr.toFixed(1)}`);

  const redLit = await faceLightOf(await solid(190, 132, 112));
  const blueLit = await faceLightOf(await solid(172, 132, 134));
  const greenLit = await faceLightOf(await solid(168, 150, 108));
  const screenLit = await faceLightOf(await solid(178, 138, 118));
  const same = await faceLightOf(skin);

  check('red taken: Cr up, brighter', flashAnswered('red', before, redLit), `dCr ${(redLit.cr - before.cr).toFixed(1)} dL ${(redLit.luma - before.luma).toFixed(1)}`);
  check('blue taken: Cb up, brighter', flashAnswered('blue', before, blueLit), `dCb ${(blueLit.cb - before.cb).toFixed(1)}`);
  check('green taken: both down, brighter', flashAnswered('green', before, greenLit), `dCb ${(greenLit.cb - before.cb).toFixed(1)} dCr ${(greenLit.cr - before.cr).toFixed(1)}`);
  check('a screen only brightens: red refused', !flashAnswered('red', before, screenLit), `dCr ${(screenLit.cr - before.cr).toFixed(1)}`);
  check('a screen only brightens: blue refused', !flashAnswered('blue', before, screenLit));
  check('the same frame again: nothing changed, refused', !flashAnswered('red', before, same));
  check('red under a blue challenge is refused', !flashAnswered('blue', before, redLit));
  check('thresholds from env', env.face.flashChroma > 0 && env.face.flashBrighten >= 0, `chroma ${env.face.flashChroma} brighten ${env.face.flashBrighten}`);

  console.log(failed === 0 ? '\nAll light-check cases pass.' : `\n${failed} case(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
