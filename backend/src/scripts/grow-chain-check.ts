/**
 * Scratch-database check that a person's Grow (their sent reviews) reaches
 * everyone above them in the reporting line, at any depth, and nobody else:
 *
 *   MONGODB_DB=grow_chain_scratch npm run grow-chain:check
 *
 * Asha heads Bala, who heads Chetan; Dev reports to Asha too, beside Bala;
 * Esha is in another branch. Bala reviews Chetan in two cycles (one twice,
 * after a change), plus a draft. Drops and recreates its own database and
 * refuses any other.
 */
import { closeDb, connectDb, feedbackRecords, getDb, users } from '../config/db';
import { getPersonProfile } from '../services/profile.service';

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}

const ORG = 'grow-scratch';
const person = (userId: string, name: string, managerUserId?: string) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', managerUserId,
});
const review = (managerUserId: string, period: string, overallScore: number, status: 'sent' | 'saved', sentAt?: Date) => ({
  managerUserId, employeeUserId: 'chetan', period, status, overallScore, extra: `${period} summary`,
  parameters: [{ name: 'Ownership', score: overallScore, note: `${period} note` }],
  createdAt: new Date(), updatedAt: new Date(), ...(sentAt ? { sentAt } : {}),
});

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'grow_chain_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany([
    person('asha', 'Asha'),
    person('bala', 'Bala', 'asha'),
    person('chetan', 'Chetan', 'bala'),
    person('dev', 'Dev', 'asha'),
    person('esha', 'Esha'),
  ] as never[]);
  await feedbackRecords().insertMany([
    review('bala', '2026-09', 3.6, 'sent', new Date('2026-09-28')),
    review('asha', '2026-10', 3.9, 'sent', new Date('2026-10-20')),
    review('bala', '2026-10', 4.2, 'sent', new Date('2026-10-28')),
    review('bala', '2026-11', 2.0, 'saved'),
  ] as never[]);

  type Profile = Awaited<ReturnType<typeof getPersonProfile>> & { history?: { period: string; overallScore: number; parameters: { note: string }[] }[] };
  const two = (await getPersonProfile('asha', 'chetan')) as Profile;
  check('two levels up: in the line, with the reviews', two.inViewerChain && two.history?.length === 2, two.history);
  check('one per cycle, the latest sent; drafts left out', JSON.stringify(two.history?.map((h) => [h.period, h.overallScore])) === JSON.stringify([['2026-09', 3.6], ['2026-10', 4.2]]), two.history);
  check('with the comments', two.history?.[1]?.parameters[0]?.note === '2026-10 note', two.history?.[1]);
  check('named for who wrote it', (two.history?.[1] as { managerName?: string } | undefined)?.managerName === 'Bala', two.history?.[1]);
  const direct = (await getPersonProfile('bala', 'chetan')) as Profile;
  check('the direct manager too', direct.reportsToViewer && direct.history?.length === 2, direct.history);
  const peerOfManager = (await getPersonProfile('dev', 'chetan')) as Profile;
  check("a colleague beside their manager: no reviews", !peerOfManager.inViewerChain && peerOfManager.history === undefined, peerOfManager.history);
  const elsewhere = (await getPersonProfile('esha', 'chetan')) as Profile;
  check('someone in another branch: no reviews', elsewhere.history === undefined, elsewhere.history);
  const upward = (await getPersonProfile('chetan', 'asha')) as Profile;
  check('never upward: a report does not read their manager\'s reviews', upward.history === undefined, upward.history);
  const self = (await getPersonProfile('chetan', 'chetan')) as Profile;
  check('not on one\'s own colleague view (Grow has its own)', self.history === undefined, self.history);

  await db.dropDatabase();
  await closeDb();
  console.log(failed === 0 ? '\nall grow-chain checks passed' : `\n${failed} check(s) failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
