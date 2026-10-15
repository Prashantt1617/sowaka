/** The app-update rules, without a database: `npx tsx src/scripts/app-update-check.ts`. */
import { isOlder, parseVersion, updateFor } from '../services/app-update';

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}

check('1.3.7 is older than 1.3.8', isOlder('1.3.7', '1.3.8'));
check('1.3.7+40 is older than 1.3.8', isOlder('1.3.7+40', '1.3.8'));
check('1.3.8+40 meets 1.3.8', !isOlder('1.3.8+40', '1.3.8'));
check('1.3.10 is newer than 1.3.9 (numbers, not text)', !isOlder('1.3.10', '1.3.9'));
check('1.4.0 meets 1.3.9', !isOlder('1.4.0', '1.3.9'));
check('2.0 meets 1.9.9', !isOlder('2.0', '1.9.9'));
check('a named build: 1.3.8+40 is older than 1.3.8+41', isOlder('1.3.8+40', '1.3.8+41'));
check('a named build: 1.3.8+41 meets 1.3.8+41', !isOlder('1.3.8+41', '1.3.8+41'));
check('no version from the app counts as old', isOlder('', '1.3.8'));
check('a rule that is not a version blocks nobody', !isOlder('1.0.0', 'soon'));
check('parse "1.3.8+41"', JSON.stringify(parseVersion('1.3.8+41')) === '{"parts":[1,3,8],"build":41}');

const rule = { force: { ios: '1.3.8', android: '1.3.8' }, optional: { ios: '1.3.9', android: '1.3.9' } };
check('force wins over optional', updateFor(rule, 'ios', '1.3.7').mode === 'force');
check('optional when past force but before latest', updateFor(rule, 'android', '1.3.8').mode === 'optional');
check('nothing when up to date', updateFor(rule, 'android', '1.3.9+50').mode === 'none');
check('nothing with no rule', updateFor(undefined, 'ios', '1.0.0').mode === 'none');
check('iOS opens the App Store', updateFor(rule, 'ios', '1.3.7').storeUrl === 'https://apps.apple.com/app/id6791144997');
check('Android opens the Play Store', updateFor(rule, 'android', '1.3.7').storeUrl === 'https://play.google.com/store/apps/details?id=com.sowaka.connect');
check('a rule for one store leaves the other alone', updateFor({ force: { android: '1.3.8' } }, 'ios', '1.3.7').mode === 'none');

console.log(failed ? `\n${failed} failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
