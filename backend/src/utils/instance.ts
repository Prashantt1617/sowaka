import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Who this process is, for the life of the process: the id `/health` shows, the
 * holder written on the background-jobs lease (leader.ts), and the sender on the
 * cache bus (cache-bus.ts), so a process ignores its own messages.
 *
 * Blue/green runs two copies side by side during a deploy (docs/deploy/bluegreen.md):
 * `APP_COLOR` says which one this is, and the deploy writes the commit it built
 * into `BUILD` beside `server.js`.
 */
export const instanceId = randomUUID().slice(0, 8);
export const startedAt = Date.now();
export const appColor = process.env.APP_COLOR || null;

let build: string | null | undefined;
/** The commit this build was made from (`dist-<color>/BUILD`), or null when it was not written. */
export function buildId(): string | null {
  if (build !== undefined) return build;
  try { build = readFileSync(path.resolve(__dirname, '../BUILD'), 'utf8').trim().slice(0, 40) || null; }
  catch { build = null; }
  return build;
}
