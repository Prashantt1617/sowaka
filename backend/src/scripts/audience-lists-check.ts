/**
 * Checks who may see a Connect post — custom lists above all — and the rules
 * a list must keep.
 *
 * No database: the rules live in `services/audience-list-rules.ts`, which is
 * pure. The feed's query is checked against the same rule a single read uses,
 * by running it over every kind of post and viewer with a small evaluator of
 * the few operators it uses, so the two can never disagree.
 *
 * Run with `npx tsx src/scripts/audience-lists-check.ts`.
 */
import { AUDIENCE_LIST_MEMBERS_MAX, AUDIENCE_LIST_NAME_MAX } from '../models/audience-list.model';
import type { ConnectAudience } from '../models/connect.model';
import {
  PRIVATE_AUDIENCE_LABEL,
  audienceAllows,
  audienceView,
  checkListName,
  checkMemberIds,
  colleagueFilter,
  feedAudienceFilter,
  isListAudience,
  listAudience,
  listNameKey,
  realtimeUserIds,
  taggableWithin,
  type AudienceViewer,
} from '../services/audience-list-rules';

let failures = 0;

function check(label: string, passed: boolean, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

// ------------------------------------------------------------- the people

const author: AudienceViewer = { userId: 'u-author', managerUserId: 'u-boss', department: '3D' };
const member: AudienceViewer = { userId: 'u-member', managerUserId: 'u-boss', department: '3D' };
const outsider: AudienceViewer = { userId: 'u-outsider', managerUserId: 'u-other-boss', department: 'Sales' };
const boss: AudienceViewer = { userId: 'u-boss', department: 'Leadership' };
const noDepartment: AudienceViewer = { userId: 'u-nodept' };

const list = { id: 'list-1', name: '3D Gurugram crew' };
const listPost = listAudience(list, 'sowaka', author.userId, [member.userId, 'u-third']);

console.log('\nWho sees a list post');
check('a member sees it', audienceAllows(listPost, member));
check('the author sees it, though not a member of their own list', audienceAllows(listPost, author));
check('a non-member does not', !audienceAllows(listPost, outsider));
check("the author's manager does not, being on neither side", !audienceAllows(listPost, boss));
check('someone without a department does not', !audienceAllows(listPost, noDepartment));
check('it is a list post', isListAudience(listPost));
check(
  'the author is on it once, whatever the list says',
  listAudience(list, 'sowaka', author.userId, [author.userId, member.userId]).userIds?.filter((id) => id === author.userId).length === 1,
);

console.log('\nThe members are a snapshot');
const members = [member.userId, 'u-third'];
const snapshot = listAudience(list, 'sowaka', author.userId, members);
// The list is edited afterwards: someone added, someone removed, renamed.
members.push(outsider.userId);
members.splice(0, 1);
list.name = 'Renamed later';
check('adding someone to the list later does not let them see it', !audienceAllows(snapshot, outsider));
check('removing someone from the list later does not hide it from them', audienceAllows(snapshot, member));
check('renaming the list later does not rename the post', snapshot.listName === '3D Gurugram crew');
check('deleting the list later leaves the post as it was', audienceAllows(snapshot, member) && !audienceAllows(snapshot, outsider));

console.log('\nA list marker on its own fails closed');
const idOnly: ConnectAudience = { label: 'Private', org: 'sowaka', listId: 'list-1' };
check('a list id without its people shows nobody', !audienceAllows(idOnly, member) && !audienceAllows(idOnly, author));
const peopleOnly: ConnectAudience = { label: 'Public', org: 'sowaka', userIds: [member.userId] };
check('people without a list id are still a list', isListAudience(peopleOnly) && !audienceAllows(peopleOnly, outsider));
const storedNulls = { label: 'Public', listId: null, userIds: null } as unknown as ConnectAudience;
check('stored nulls are not a list', !isListAudience(storedNulls) && audienceAllows(storedNulls, outsider));

console.log('\nCompany, Team and department posts are as they were');
const publicPost: ConnectAudience = { label: 'Public', org: 'sowaka' };
const teamPost: ConnectAudience = { label: 'Team', org: 'sowaka', teamId: 'u-boss' };
const deptPost: ConnectAudience = { label: 'Team', org: 'sowaka', department: '3D' };
check('everyone sees a company post', [author, member, outsider, boss, noDepartment].every((v) => audienceAllows(publicPost, v)));
check('the team and its head see a Team post', audienceAllows(teamPost, member) && audienceAllows(teamPost, boss));
check('another team does not', !audienceAllows(teamPost, outsider));
check('a department post reaches its department', audienceAllows(deptPost, member) && !audienceAllows(deptPost, outsider));
check('a department post does not reach someone with no department', !audienceAllows(deptPost, noDepartment));

console.log('\nWhat a post says about its audience');
const authorView = audienceView(listPost, author.userId, author.userId);
const memberView = audienceView(listPost, member.userId, author.userId);
check("the author sees the list's name", authorView.label === '3D Gurugram crew' && authorView.listId === 'list-1');
check('the author is not handed the member ids', authorView.userIds === undefined);
check('a member sees "Private"', memberView.label === PRIVATE_AUDIENCE_LABEL);
check(
  "a member never sees the list's name, id or people",
  memberView.listName === undefined && memberView.listId === undefined && memberView.userIds === undefined,
  JSON.stringify(memberView),
);
check(
  'nothing in what a member is sent carries the name',
  !JSON.stringify(memberView).includes('Gurugram'),
);
check('an author-less post shows "Private" to everyone', audienceView(listPost, member.userId, undefined).label === PRIVATE_AUDIENCE_LABEL);
const publicView = audienceView({ label: 'Public', org: 'sowaka', listId: null as unknown as undefined }, member.userId, author.userId);
check('a company post keeps its label and drops stray list nulls', publicView.label === 'Public' && !('listId' in publicView));

console.log('\nRealtime and tags');
check('a list post is announced to its people only', JSON.stringify(realtimeUserIds(listPost)?.sort()) === JSON.stringify([author.userId, member.userId, 'u-third'].sort()));
check('a company post goes to its room', realtimeUserIds(publicPost) === null);
check(
  'tagging someone off the list drops them',
  JSON.stringify(taggableWithin(listPost, [member.userId, outsider.userId])) === JSON.stringify([member.userId]),
);
check('tags on a company post are untouched', taggableWithin(publicPost, [outsider.userId]).length === 1);

// ------------------------------------------------- the feed's query agrees

/**
 * Just enough of MongoDB's matcher for the feed's audience clause: `$or`,
 * `$in`, equality against a scalar or `null`, and equality against an
 * array field (which matches when the array holds the value).
 */
function get(doc: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), doc);
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return (condition as Record<string, unknown>[]).some((branch) => matches(doc, branch));
    const value = get(doc, key);
    if (condition && typeof condition === 'object' && '$in' in (condition as object)) {
      const options = (condition as { $in: unknown[] }).$in;
      return Array.isArray(value) ? value.some((item) => options.includes(item)) : options.includes(value);
    }
    if (condition === null) return value === undefined || value === null || (Array.isArray(value) && value.includes(null));
    return Array.isArray(value) ? value.includes(condition) : value === condition;
  });
}

console.log("\nThe feed's query matches the read rule, post by post");
// Posts as stored: the driver writes an absent teamId as null.
const stored: Array<[string, ConnectAudience]> = [
  ['company', { label: 'Public', org: 'sowaka', teamId: null as unknown as undefined }],
  ['team', teamPost],
  ['department', deptPost],
  ['list', listPost],
  ['list id only', idOnly],
  ['people only', peopleOnly],
];
const viewers: Array<[string, AudienceViewer]> = [
  ['author', author], ['member', member], ['outsider', outsider], ['boss', boss], ['no department', noDepartment],
];
let disagreements = 0;
for (const [postName, audience] of stored) {
  for (const [viewerName, viewer] of viewers) {
    const queried = matches({ audience }, feedAudienceFilter(viewer));
    const read = audienceAllows(audience, viewer);
    if (queried !== read) {
      disagreements += 1;
      check(`${postName} post, ${viewerName}`, false, `query ${queried}, read ${read}`);
    }
  }
}
check(`all ${stored.length * viewers.length} post and viewer pairs agree`, disagreements === 0);
check(
  'a viewer with no department is not shown Team posts by a null match',
  !matches({ audience: teamPost }, feedAudienceFilter(noDepartment)),
);

// ------------------------------------------------------------ list rules

console.log('\nA list name');
const trimmed = checkListName('  3D   Gurugram crew ');
check('is trimmed, inner spaces collapsed', trimmed.ok && trimmed.value.name === '3D Gurugram crew');
check('compares case-insensitively', listNameKey('3d  CREW') === listNameKey('3D crew'));
check('cannot be empty', !checkListName('   ').ok && !checkListName(undefined).ok && !checkListName(42).ok);
check(`may be ${AUDIENCE_LIST_NAME_MAX} characters`, checkListName('a'.repeat(AUDIENCE_LIST_NAME_MAX)).ok);
check(`may not be ${AUDIENCE_LIST_NAME_MAX + 1}`, !checkListName('a'.repeat(AUDIENCE_LIST_NAME_MAX + 1)).ok);
check('counts an emoji as one character', checkListName('🎉'.repeat(AUDIENCE_LIST_NAME_MAX)).ok);

console.log("\nA list's members");
const ids = checkMemberIds(['u-1', 'u-1', ' u-2 ', 'u-owner', '', 7, null], 'u-owner');
check('are deduped and trimmed, junk dropped', ids.ok && JSON.stringify(ids.value) === JSON.stringify(['u-1', 'u-2']));
check('never include the owner', ids.ok && !ids.value.includes('u-owner'));
check('cannot be nobody', !checkMemberIds([], 'u-owner').ok && !checkMemberIds(['u-owner'], 'u-owner').ok);
check('must be a list', !checkMemberIds('u-1', 'u-owner').ok);
const many = Array.from({ length: AUDIENCE_LIST_MEMBERS_MAX }, (_, i) => `u-${i}`);
check(`may be ${AUDIENCE_LIST_MEMBERS_MAX} people`, checkMemberIds(many, 'u-owner').ok);
check(`may not be ${AUDIENCE_LIST_MEMBERS_MAX + 1}`, !checkMemberIds([...many, 'u-extra'], 'u-owner').ok);

console.log('\nThe directory');
const filter = colleagueFilter('sowaka') as { lifecycleStatus: { $nin: string[] }; isCounsellor: unknown; $or: unknown[] };
check('leaves out anyone who has left', filter.lifecycleStatus.$nin.includes('offboarded') && filter.lifecycleStatus.$nin.includes('terminated'));
check('leaves out counsellors', JSON.stringify(filter.isCounsellor) === JSON.stringify({ $ne: true }));
check('is one company', JSON.stringify(filter.$or[0]) === JSON.stringify({ org: 'sowaka' }));
check(
  'escapes the org in the email fallback',
  JSON.stringify(colleagueFilter('a.b')).includes('@a\\\\.b$'),
);

console.log(failures === 0 ? '\nAll audience list checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
