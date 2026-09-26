// One-off: a birthday, a work anniversary and a new-joinee card for ACMT's
// feed, through the same generators the daily job and the HR workflow use.
//   npx tsx backend/scripts/acmt-lifecycle-posts-2026-09.ts
import { connectDb, users } from '../src/config/db';
import { generateDailyLifecyclePosts, generateNewJoineePost } from '../src/services/connect.service';

async function main() {
  await connectDb();
  const today = new Date();
  const birthday = new Date(Date.UTC(1996, today.getUTCMonth(), today.getUTCDate()));
  const anniversary = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));
  await users().updateOne({ org: 'acmt', name: 'Tanya' }, { $set: { birthday } });
  await users().updateOne({ org: 'acmt', name: 'Naveen' }, { $set: { joiningDate: anniversary } });
  await generateDailyLifecyclePosts();
  const joinee = await users().findOne({ org: 'acmt', name: 'Ananya' });
  const manager = joinee?.managerUserId ? await users().findOne({ userId: joinee.managerUserId }) : null;
  if (joinee) await generateNewJoineePost(joinee, manager ?? undefined);
  console.log('lifecycle posts: birthday=Tanya · anniversary=Naveen (1 year today) · new joinee=Ananya');
  process.exit(0);
}
main().catch((error) => { console.error(error); process.exit(1); });
