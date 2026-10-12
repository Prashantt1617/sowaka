/**
 * A company's Support desk ticket types, managed from here: no app release, no
 * deploy. The same list a Support head or a dashboard admin edits on the
 * dashboard (Support › Tickets › Ticket types); see
 * `services/support-topics.service.ts` for where it lives and
 * `mergeSupportTopics` in `services/support-rules.ts` for how an edit lands.
 *
 * Run from backend/:
 *
 *   node --env-file=.env --import tsx src/scripts/support-topics.ts list --org sowaka
 *   # The whole list, in order. A name the list already has keeps its key; so
 *   # does "key=New name", which is how to rename. Anything else is a new type.
 *   node --env-file=.env --import tsx src/scripts/support-topics.ts set --org sowaka \
 *     --labels "Workplace,Manager,Payroll,leaves=Time off,IT & laptops,Other"
 *   # Back to the eight defaults (the company's own list is deleted):
 *   node --env-file=.env --import tsx src/scripts/support-topics.ts reset --org sowaka
 *
 * A type left out is removed: the app stops offering it, and tickets already
 * raised under it keep their type. The running server sees a change from here
 * within a minute (it holds each company's list for that long).
 */
import { userInfo } from 'node:os';
import { companies, connectDb, supportTickets } from '../config/db';
import type { SupportTopicOption } from '../models/support.model';
import { topicLabelOf } from '../services/support-rules';
import { resetSupportTopics, saveSupportTopics, storedSupportTopics, supportTopicsOf } from '../services/support-topics.service';

/** `set --org sowaka --labels "A,B"` -> command and flags. */
function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected "${argv[i]}": give everything as --flag value`);
    const [name, inline] = argv[i].slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) flags[name] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[name] = argv[++i];
    else flags[name] = 'true';
  }
  return flags;
}

async function requireCompany(org: string | undefined): Promise<string> {
  if (!org || org === 'true') throw new Error('Which company? Give --org with its id, such as --org sowaka');
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, id: 1 } });
  if (!company) throw new Error(`No company "${org}"`);
  return org;
}

/** "leaves=Time off" keeps the key `leaves`; anything else is a name alone. */
function entriesOf(labels: string | undefined): { key?: string; label: string }[] {
  if (!labels || labels === 'true') throw new Error('Give the whole list: --labels "Workplace,Manager,Other"');
  return labels.split(',').map((part) => {
    const match = /^\s*([a-z0-9-]+)\s*=(.*)$/.exec(part);
    return match ? { key: match[1], label: match[2] } : { label: part };
  });
}

function print(topics: SupportTopicOption[]) {
  topics.forEach((topic, i) => console.log(`  ${String(i + 1).padStart(2)}. ${topic.label.padEnd(42)} ${topic.key}`));
}

async function list(org: string) {
  const [stored, topics, onTickets] = await Promise.all([
    storedSupportTopics(org),
    supportTopicsOf(org),
    supportTickets()
      .aggregate<{ _id: string; count: number; label?: string }>([
        { $match: { org } },
        { $group: { _id: '$topic', count: { $sum: 1 }, label: { $last: '$topicLabel' } } },
      ])
      .toArray(),
  ]);
  console.log(stored
    ? `${org}: its own list, changed ${stored.updatedAt.toISOString()} by ${stored.updatedByUserId}`
    : `${org}: the defaults (no list of its own)`);
  print(topics);
  const offered = new Set(topics.map((topic) => topic.key));
  const older = onTickets.filter((row) => !offered.has(row._id));
  if (older.length) {
    console.log('No longer offered, still on tickets:');
    for (const row of older) {
      const label = topicLabelOf({ topic: row._id, topicLabel: row.label ?? undefined });
      console.log(`      ${label.padEnd(42)} ${row._id} (${row.count} ticket${row.count === 1 ? '' : 's'})`);
    }
  }
}

async function set(org: string, flags: Record<string, string>) {
  const before = await supportTopicsOf(org);
  const by = flags.by && flags.by !== 'true' ? flags.by : userInfo().username;
  const edit = await saveSupportTopics(org, entriesOf(flags.labels), `cli:${by}`);
  if (!edit.ok) throw new Error(edit.message);
  console.log(`${org}: saved.`);
  print(edit.topics);
  const kept = new Set(edit.topics.map((topic) => topic.key));
  const removed = before.filter((topic) => !kept.has(topic.key));
  if (removed.length) {
    console.log(`Removed: ${removed.map((topic) => topic.label).join(', ')} (tickets already raised keep their type)`);
  }
  console.log('The app offers this within a minute.');
}

async function reset(org: string) {
  const had = await resetSupportTopics(org);
  console.log(had ? `${org}: back to the defaults.` : `${org} already had the defaults.`);
  print(await supportTopicsOf(org));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log(
      'Usage: support-topics.ts list --org <org>\n' +
        '       support-topics.ts set --org <org> --labels "A,B,key=New name,C" [--by <name>]\n' +
        '       support-topics.ts reset --org <org>',
    );
    return;
  }
  const flags = parseArgs(rest);
  await connectDb();
  const org = await requireCompany(flags.org);
  switch (command) {
    case 'list':
      return list(org);
    case 'set':
      return set(org, flags);
    case 'reset':
      return reset(org);
    default:
      throw new Error(`Unknown command "${command}"`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
