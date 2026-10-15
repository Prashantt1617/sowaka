/**
 * Which app versions a company must, or is asked to, update from — no app
 * release, no deploy. The app asks at launch and whenever it comes back to
 * the front. Writing here is a production change: the database is shared.
 *
 *   # Everyone at cde below 1.3.8 sees the update screen and cannot leave it:
 *   node --env-file=.env --import tsx src/scripts/app-update.ts force cde 1.3.8
 *   # Only on one store (say the App Store build is still in review):
 *   node --env-file=.env --import tsx src/scripts/app-update.ts force cde 1.3.8 --platform android
 *
 *   # The closable one, shown once per version:
 *   node --env-file=.env --import tsx src/scripts/app-update.ts optional sowaka,convrse 1.3.8
 *
 *   # Take a rule off (force, optional, or both when neither is named):
 *   node --env-file=.env --import tsx src/scripts/app-update.ts clear cde force
 *   node --env-file=.env --import tsx src/scripts/app-update.ts clear cde
 *
 *   node --env-file=.env --import tsx src/scripts/app-update.ts list
 *
 * A version is "1.3.8", met by any 1.3.8 build, or "1.3.8+41" for a build.
 * Only apps from the release that carries this check can show the screens.
 */
import { userInfo } from 'node:os';
import { companies, connectDb } from '../config/db';
import { parsePlatform, parseVersion } from '../services/app-update';

const [command, orgArg, third, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const args = [third, ...rest];
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function orgsFrom(arg: string | undefined): Promise<string[]> {
  const orgs = String(arg ?? '').split(',').map((org) => org.trim()).filter(Boolean);
  if (!orgs.length) fail('Name the company id, or several separated by commas (e.g. cde or sowaka,convrse).');
  for (const org of orgs) {
    if (!(await companies().findOne({ id: org }, { projection: { id: 1 } }))) fail(`No company "${org}".`);
  }
  return orgs;
}

(async () => {
  await connectDb();
  if (command === 'list' || !command) {
    const rows = await companies().find({}, { projection: { _id: 0, id: 1, name: 1, appUpdate: 1 } }).toArray();
    for (const row of rows) {
      const rule = row.appUpdate;
      const show = (which?: { ios?: string; android?: string }) =>
        which ? `ios ${which.ios ?? '—'}, android ${which.android ?? '—'}` : '—';
      console.log(`${row.id.padEnd(12)} force: ${show(rule?.force).padEnd(28)} optional: ${show(rule?.optional)}`);
    }
    process.exit(0);
  }

  const orgs = await orgsFrom(orgArg);
  const by = userInfo().username;
  if (command === 'force' || command === 'optional') {
    if (!parseVersion(third)) fail(`"${third ?? ''}" is not a version (e.g. 1.3.8 or 1.3.8+41).`);
    const platformArg = flag('platform');
    const platform = platformArg === undefined ? null : parsePlatform(platformArg);
    if (platformArg !== undefined && !platform) fail('--platform is ios or android.');
    const platforms = platform ? [platform] : (['ios', 'android'] as const);
    const set: Record<string, unknown> = { 'appUpdate.updatedAt': new Date(), 'appUpdate.updatedBy': by };
    for (const p of platforms) set[`appUpdate.${command}.${p}`] = third;
    await companies().updateMany({ id: { $in: orgs } }, { $set: set });
    console.log(`${command} ${third} on ${platforms.join(' and ')} for ${orgs.join(', ')}`);
  } else if (command === 'clear') {
    const which = third === 'force' || third === 'optional' ? [third] : ['force', 'optional'];
    const unset: Record<string, ''> = {};
    for (const w of which) unset[`appUpdate.${w}`] = '';
    await companies().updateMany({ id: { $in: orgs } }, { $unset: unset, $set: { 'appUpdate.updatedAt': new Date(), 'appUpdate.updatedBy': by } });
    console.log(`cleared ${which.join(' and ')} for ${orgs.join(', ')}`);
  } else {
    fail(`Unknown command "${command}". Use force, optional, clear or list.`);
  }
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
