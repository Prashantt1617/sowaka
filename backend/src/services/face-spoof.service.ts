import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * The screen detector, run on the server: MiniFASNet V2 (Silent-Face-Anti-
 * Spoofing, Apache-2.0), the same 1.85 MB TFLite model the app carries, run
 * in Node through LiteRT.js's WebAssembly build. It answers how likely a face
 * crop shows a real face rather than a photo or a screen.
 *
 * The phone sends, with each selfie, its burst of face crops; this scores
 * each, takes the median, and the face check accepts above
 * FACE_SPOOF_ACCEPT, refuses as a screen below FACE_SPOOF_UNCERTAIN_LOW, and
 * asks for another look in between. The phone's own scores are only logged.
 *
 * The pre-processing is shared with the app (`face_spoof_check.dart`, keep
 * the two in step: the 0–1 against 0–255 bug of October came from them
 * drifting): the crop is the face box scaled 2.7 about its centre, held
 * inside the picture, sent as a 96 px square JPEG at quality 80 (builds
 * before November sent 160 px at 90; the model's own 80 px read makes the
 * two score alike, `npm run face:spoof-check` measures it); the model reads
 * it at 80 × 80, bilinear, as BGR values 0–255, channels first; its output
 * index 1 is "real". Any crop size is read: there is no lower bound here.
 * From 1.4.3 (89) the app sends the 160 px quality-90 crops it scored itself,
 * so the two read the same bytes the same way ([spoofInput]).
 */

export const SPOOF_SIDE = 80;
/** The crop builds before 1.4.3 (89) send: [CROP_SIDE] px square, JPEG quality [CROP_QUALITY] (newer ones send the 160 px, quality 90 crop the phone read). */
export const CROP_SIDE = 96;
export const CROP_QUALITY = 80;

type LiteRtModule = {
  loadLiteRt: (path: string) => Promise<unknown>;
  loadAndCompile: (model: Uint8Array, options: { accelerator: 'wasm' }) => Promise<CompiledModel>;
  Tensor: new (data: Float32Array, shape: number[]) => LiteTensor;
};
type LiteTensor = { delete(): void; moveTo(where: 'wasm'): Promise<LiteTensor>; toTypedArray(): Float32Array };
type CompiledModel = { run(input: LiteTensor): Promise<LiteTensor[]> };

let loading: Promise<{ lib: LiteRtModule; model: CompiledModel } | null> | null = null;
/** Runs are one at a time: the WebAssembly runtime is single-threaded. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * LiteRT.js loads its runtime by adding a script tag, as a browser page
 * would. Here the same Emscripten script is evaluated in this process, with
 * the names it looks for (`importScripts`, `require`, `__dirname`) supplied.
 */
async function load(): Promise<{ lib: LiteRtModule; model: CompiledModel } | null> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<LiteRtModule>;
    const lib = await dynamicImport('@litertjs/core');
    const wasmDir = join(dirname(require.resolve('@litertjs/core/package.json')), 'wasm') + '/';
    const g = globalThis as Record<string, unknown>;
    g.self ??= globalThis;
    g.require ??= require;
    g.__dirname ??= wasmDir.slice(0, -1);
    g.__filename ??= join(wasmDir, 'litert_wasm_internal.js');
    g.importScripts = (url: string) => {
      const path = String(url).startsWith('file://') ? new URL(String(url)) : String(url);
      vm.runInThisContext(readFileSync(path, 'utf8'), { filename: String(url) });
    };
    g.Module = { locateFile: (file: string) => wasmDir + file };
    // It also looks for a WebGPU device, which Node does not have, and says
    // so on the console; the CPU (WebAssembly) path is the one used here.
    const quiet = <T>(run: () => Promise<T>) => async () => {
      const [error, warn] = [console.error, console.warn];
      const keep = (log: (...a: unknown[]) => void) => (...args: unknown[]) => {
        if (!args.some((arg) => String(arg).includes('WebGPU'))) log(...args);
      };
      console.error = keep(error);
      console.warn = keep(warn);
      try {
        return await run();
      } finally {
        console.error = error;
        console.warn = warn;
      }
    };
    await quiet(() => lib.loadLiteRt('file://' + wasmDir))();
    const modelPath = resolve(__dirname, '../../models/silentface.tflite');
    const model = await quiet(() => lib.loadAndCompile(new Uint8Array(readFileSync(modelPath)), { accelerator: 'wasm' }))();
    logger.info('Face screen detector ready', { model: 'MiniFASNetV2' });
    return { lib, model };
  } catch (error) {
    logger.error('Face screen detector failed to load', {}, error);
    loading = null;
    return null;
  }
}

/** Whether the detector can run here (loads it on first ask). */
export async function spoofDetectorReady(): Promise<boolean> {
  loading ??= load();
  return (await loading) !== null;
}

/**
 * The model's input from one crop: 80 × 80, bilinear, BGR 0–255, channels
 * first, sampled exactly as the phone's `image` package samples it
 * (`copyResize(…, interpolation: linear)`): the source point for output
 * pixel x is x × (source width / 80), no half-pixel shift, the four pixels
 * about it blended, each channel cut to a whole 0–255. Until 23 Nov this
 * used sharp's own linear shrink, which smooths over the pixels it drops: on
 * a real face it took off the fine skin texture the model reads as "real",
 * and real faces the phone scored 0.7–0.99 came back here at 0.14–0.40.
 */
export async function spoofInput(crop: Buffer): Promise<Float32Array> {
  const { data, info } = await sharp(crop, { failOn: 'none' })
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return phoneSample(data, info.width, info.height, info.channels);
}

/** [spoofInput]'s sampling on decoded RGB(A) pixels: what `copyResize` linear gives on the phone. */
export function phoneSample(data: Uint8Array, width: number, height: number, channels: number, side = SPOOF_SIDE): Float32Array {
  const n = side * side;
  const input = new Float32Array(3 * n);
  const dx = width / side;
  const dy = height / side;
  const at = (x: number, y: number, c: number) => data[(y * width + x) * channels + c];
  for (let y = 0; y < side; y++) {
    const fy = y * dy;
    const y0 = Math.floor(fy);
    const y1 = y0 + 1 >= height ? y0 : y0 + 1;
    const ay = fy - y0;
    for (let x = 0; x < side; x++) {
      const fx = x * dx;
      const x0 = Math.floor(fx);
      const x1 = x0 + 1 >= width ? x0 : x0 + 1;
      const ax = fx - x0;
      const i = y * side + x;
      // Planes B, G, R from channels 2, 1, 0.
      for (let plane = 0; plane < 3; plane++) {
        const c = 2 - plane;
        const icc = at(x0, y0, c);
        const inc = at(x1, y0, c);
        const icn = at(x0, y1, c);
        const inn = at(x1, y1, c);
        const v = icc + ax * (inc - icc + ay * (icc + inn - icn - inc)) + ay * (icn - icc);
        input[plane * n + i] = Math.trunc(Math.min(255, Math.max(0, v)));
      }
    }
  }
  return input;
}

/** "Real" from the model's three outputs: index 1, softmaxed when they are logits. */
export function realFrom(scores: number[]): number {
  const sum = scores.reduce((a, b) => a + b, 0);
  if (scores.every((s) => s >= 0 && s <= 1) && Math.abs(sum - 1) < 0.02) return scores[1];
  const top = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - top));
  return exps[1] / exps.reduce((a, b) => a + b, 0);
}

/** How likely one face crop shows a real face, 0–1; null if the detector or the crop cannot be read. */
export async function realProbability(crop: Buffer): Promise<number | null> {
  loading ??= load();
  const ready = await loading;
  if (!ready) return null;
  let input: Float32Array;
  try {
    input = await spoofInput(crop);
  } catch {
    return null;
  }
  const run = queue.then(async () => {
    const tensor = new ready.lib.Tensor(input, [1, 3, SPOOF_SIDE, SPOOF_SIDE]);
    try {
      const out = await ready.model.run(tensor);
      const result = await out[0].moveTo('wasm');
      const scores = Array.from(result.toTypedArray());
      result.delete();
      return realFrom(scores);
    } finally {
      tensor.delete();
    }
  });
  queue = run.catch(() => undefined);
  try {
    return await run;
  } catch (error) {
    logger.error('Face screen detector run failed', {}, error);
    return null;
  }
}

export const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export type SpoofVerdict = 'pass' | 'uncertain' | 'spoof';

/** The burst's median against the server's lines. */
export function spoofVerdict(medianScore: number): SpoofVerdict {
  if (medianScore >= env.face.spoofAccept) return 'pass';
  if (medianScore < env.face.spoofUncertainLow) return 'spoof';
  return 'uncertain';
}

/** Scores a burst of crops: each one, and the median. */
export async function scoreBurst(crops: Buffer[]): Promise<{ scores: number[]; median: number | null }> {
  const scores: number[] = [];
  for (const crop of crops) {
    const s = await realProbability(crop);
    if (s !== null) scores.push(s);
  }
  return { scores, median: median(scores) };
}
