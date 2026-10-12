/**
 * Checks the app pages' rules: which keys are served, the version an upload
 * gets, a rollback's swap, and which companies get a page.
 *
 * No database: the rules live in `services/app-page-rules.ts`, which is pure.
 * Run with `npx tsx src/scripts/app-pages-check.ts`.
 */
import type { AppPage } from '../models/app-page.model';
import {
  enabledOrgsAfter,
  isAppPageKey,
  nextVersion,
  pageIsOnFor,
  rolledBack,
  withUpload,
} from '../services/app-page-rules';

let failures = 0;

function check(label: string, passed: boolean, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const now = new Date('2026-10-12T10:00:00.000Z');

console.log('keys');
check('games-home is served', isAppPageKey('games-home'));
check('anything else is not', !isAppPageKey('games') && !isAppPageKey('../games-home') && !isAppPageKey('') && !isAppPageKey(undefined));

console.log('uploads');
const first = withUpload(null, 'games-home', '<html>v1</html>', now, 'kritik');
check('the first upload is version 1, with nothing kept', first.version === 1 && first.previous === null);
check('and is on for nobody', first.enabledOrgs.length === 0);
const enabled: AppPage = { ...first, enabledOrgs: ['sowaka'] };
const second = withUpload(enabled, 'games-home', '<html>v2</html>', now, 'kritik');
check('the next is version 2', second.version === 2, String(second.version));
check('keeping version 1 as the previous', second.previous?.version === 1 && second.previous.html === '<html>v1</html>');
check('and the companies it was on for', second.enabledOrgs.join(',') === 'sowaka');
check('only one version back is kept', withUpload(second, 'games-home', '<html>v3</html>', now, 'k').previous?.version === 2);

console.log('rollback');
const back = rolledBack(second, now, 'kritik');
check('puts the previous version back on top', back?.version === 1 && back.html === '<html>v1</html>');
check('and keeps the one it replaced, so a second rollback undoes it', back?.previous?.version === 2 && back.previous.html === '<html>v2</html>');
const again = back && rolledBack(back, now, 'kritik');
check('rolling back twice is where it started', again?.version === 2 && again.html === '<html>v2</html>' && again.previous?.version === 1);
check('nothing to go back to is refused', rolledBack(first, now, 'kritik') === null);
check('the companies stay as they were', back?.enabledOrgs.join(',') === 'sowaka');
check('an upload after a rollback never reuses a version', back !== null && nextVersion(back) === 3, String(back && nextVersion(back)));
check('nor does one on a fresh key', nextVersion(null) === 1);

console.log('who gets it');
check('a company on the list does', pageIsOnFor(enabled, 'sowaka'));
check('one not on it does not', !pageIsOnFor(enabled, 'convrse'));
check('nobody without an org', !pageIsOnFor(enabled, undefined));
check('nobody when there is no page', !pageIsOnFor(null, 'sowaka'));
check('nobody when the page is empty', !pageIsOnFor({ ...enabled, html: '' }, 'sowaka'));
check('enable adds once', enabledOrgsAfter(['sowaka'], 'sowaka', true).join(',') === 'sowaka');
check('enable adds a new one', enabledOrgsAfter(['sowaka'], 'convrse', true).join(',') === 'sowaka,convrse');
check('disable takes it off', enabledOrgsAfter(['sowaka', 'convrse'], 'sowaka', false).join(',') === 'convrse');
check('disable of one not on is harmless', enabledOrgsAfter(undefined, 'sowaka', false).length === 0);

console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exit(failures ? 1 : 0);
