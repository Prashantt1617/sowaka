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
 * inside the picture, sent as a 160 px square JPEG; the model reads it at
 * 80 × 80, bilinear, as BGR values 0–255, channels first; its output index 1
 * is "real".
 */

export const SPOOF_SIDE = 80;
export const CROP_SIDE = 160;

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

/** The model's input from one crop: 80 × 80, bilinear, BGR 0–255, channels first. */
export async function spoofInput(crop: Buffer): Promise<Float32Array> {
  const raw = await sharp(crop, { failOn: 'none' })
    .rotate()
    .resize(SPOOF_SIDE, SPOOF_SIDE, { fit: 'fill', kernel: 'linear' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const n = SPOOF_SIDE * SPOOF_SIDE;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i] = raw[i * 3 + 2]; // B
    input[n + i] = raw[i * 3 + 1]; // G
    input[2 * n + i] = raw[i * 3]; // R
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
