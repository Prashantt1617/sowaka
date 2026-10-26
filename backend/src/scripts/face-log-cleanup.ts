/**
 * Deletes the Face ID check log older than FACE_LOG_RETENTION_MONTHS (12 by
 * default), and liveness sessions older than a day. Counts only, unless run
 * with --apply. Not on any scheduler: run it by hand until the retention is
 * decided, e.g.
 * npm run face-log:cleanup            (what would go)
 * npm run face-log:cleanup -- --apply (delete it)
 */
import { connectDb, getDb } from '../config/db';
import { env } from '../config/env';
import { pruneFaceLog } from '../services/face-id.service';

(async () => {
  const apply = process.argv.includes('--apply');
  await connectDb();
  const result = await pruneFaceLog({ apply });
  console.log(
    `${getDb().databaseName}: ${result.checks} check(s) from before ${result.before} (${env.face.logRetentionMonths} months) ` +
      `and ${result.sessions} liveness session(s) ${result.deleted ? 'deleted' : 'would be deleted; run with --apply'}`,
  );
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
