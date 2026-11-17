/**
 * The home tiles from the real state (no browser): every view, and the two
 * cases a click-through found wrong ("Letter signed" with nothing signed;
 * "Day-1 pass · Ready on <a past date>" once the pass was open).
 *
 *   npm run check        (runs with the repo's tsx; no server, no browser)
 */
import type { PathKey, PathState, PortalHome } from '../src/api/types';
import { addDays, today } from '../src/lib/format';
import { homeTiles } from '../src/lib/tiles';

let passed = 0;
let failed = 0;
function ok(label: string, condition: unknown, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}

const KEYS: PathKey[] = ['offer', 'docs', 'about', 'meet', 'letter', 'pass'];
function home(view: PortalHome['view'], states: PathState[], tj = addDays(today(), 12)): PortalHome {
  return {
    status: 'active', view, candidateName: 'Kabir Mehta', company: { name: 'Lumen Labs' }, tj, daysToGo: 12,
    plant: { stage: 0, water: 0, leaves: 0, droop: false },
    path: KEYS.map((key, i) => ({ key, label: key, state: states[i] })),
    tasks: [], batch: { count: 0, names: [] }, hrContact: { name: 'Priya S.', email: 'people@lumenlabs.example' },
  };
}
const titles = (me: PortalHome, meet?: number) => homeTiles(me, meet).map((t) => `${t.title} · ${t.sub}`);

console.log('Home tiles');
ok('tasks open: the two to-dos (About you, Meet the team)', JSON.stringify(titles(home('tasks_open', ['done', 'current', 'todo', 'todo', 'locked', 'locked']), 4)) === JSON.stringify(['About you · 2 quick steps', 'Meet the team · 4 short videos']));
const passDay = addDays(addDays(today(), 12), -7);
ok('tasks open, both done: the Day-1 pass (opens later) and Ask HR', JSON.stringify(titles(home('tasks_open', ['done', 'current', 'done', 'done', 'locked', 'locked']))) === JSON.stringify([`Day-1 pass · Ready on ${passDay.slice(8).replace(/^0/, '')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(passDay.slice(5, 7)) - 1]}`, 'Ask HR · Send an email']), titles(home('tasks_open', ['done', 'current', 'done', 'done', 'locked', 'locked'])));
ok('offer updated: Meet the team, then Ask HR (3Rb 7b)', JSON.stringify(titles(home('offer_updated', ['current', 'done', 'done', 'todo', 'locked', 'locked']), 4)) === JSON.stringify(['Meet the team · 4 short videos', 'Ask HR · Send an email']));
ok('letter ready: Day-1 pass "Ready on" while it is shut, then Ask HR (P11)', titles(home('letter_ready', ['done', 'done', 'done', 'done', 'current', 'locked']))[0].startsWith('Day-1 pass · Ready on') && titles(home('letter_ready', ['done', 'done', 'done', 'done', 'current', 'locked']))[1] === 'Ask HR · Send an email');
const letterReadyPassOpen = titles(home('letter_ready', ['done', 'done', 'done', 'done', 'current', 'todo'], addDays(today(), 4)));
ok('letter ready with the pass already open: "Day-1 pass · Open now", never a past "Ready on"', letterReadyPassOpen[0] === 'Day-1 pass · Open now', letterReadyPassOpen);
ok('pass unlocked, letters signed: "Letters signed", then Ask HR (P13)', JSON.stringify(titles(home('pass_unlocked', ['done', 'done', 'done', 'done', 'done', 'current']))) === JSON.stringify(['Letters signed · Saved in your documents', 'Ask HR · Send an email']));
const passNothingSigned = titles(home('pass_unlocked', ['done', 'done', 'done', 'done', 'current', 'current']));
ok('pass unlocked with nothing signed: no "Letter signed" tile; signing is the to-do', !passNothingSigned.some((t) => t.startsWith('Letters signed')) && passNothingSigned[0] === 'Sign your letters · Appointment letter and NDA', passNothingSigned);
const passLettersPending = titles(home('pass_unlocked', ['done', 'current', 'todo', 'done', 'locked', 'current']));
ok('pass unlocked, letters not ready, About you open: About you first, then Ask HR', JSON.stringify(passLettersPending) === JSON.stringify(['About you · 2 quick steps', 'Ask HR · Send an email']), passLettersPending);
const day1Signing = home('tasks_open', ['done', 'done', 'done', 'done', 'locked', 'locked']);
day1Signing.path = day1Signing.path.filter((p) => p.key !== 'letter');
ok('no letter step (letters signed on Day 1): no letter tile, the pass and Ask HR', JSON.stringify(titles(day1Signing).map((t) => t.split(' · ')[0])) === JSON.stringify(['Day-1 pass', 'Ask HR']), titles(day1Signing));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
