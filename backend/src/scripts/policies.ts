/**
 * Each company's policies, as the app shows them under Actions › View
 * Policies, managed from here: no app release, no deploy.
 *
 * A policy is one document in `policy_documents`, per company and key. Its
 * text lives in a file under `backend/policies/`, named `<org>-<key>.txt`:
 * edit the file, run `upsert`, and the app shows the new text the next time
 * someone opens Policies. Nothing else writes these documents.
 *
 * A company with no documents keeps the policies the app writes for itself
 * from its shift rules. Its first document replaces all of those: from then
 * on the app lists that company's documents and nothing else.
 *
 * The text is plain, with three things the app draws for itself:
 *   a blank line          starts a new paragraph (each is its own card)
 *   "- " at a line start  a bullet
 *   "## " at a line start a section heading
 * Anything else shows exactly as written. No HTML.
 *
 * Run from backend/:
 *
 *   # Add a policy, or change it (only what is given changes):
 *   node --env-file=.env --import tsx src/scripts/policies.ts upsert sowaka leave \
 *     --title "Leave" --file policies/sowaka-leave.txt --order 10
 *   # Just the text, after editing the file:
 *   node --env-file=.env --import tsx src/scripts/policies.ts upsert sowaka leave --file policies/sowaka-leave.txt
 *   # A line under the name in the list ("none" takes it off):
 *   node --env-file=.env --import tsx src/scripts/policies.ts upsert sowaka leave --summary "Types, balances and how to apply"
 *   # Hide it from the app without deleting it, and bring it back:
 *   node --env-file=.env --import tsx src/scripts/policies.ts upsert sowaka leave --active false
 *   node --env-file=.env --import tsx src/scripts/policies.ts upsert sowaka leave --active true
 *
 *   node --env-file=.env --import tsx src/scripts/policies.ts list            # every company
 *   node --env-file=.env --import tsx src/scripts/policies.ts list sowaka
 *   # The text as the app has it now, into a file (or - for the screen):
 *   node --env-file=.env --import tsx src/scripts/policies.ts export sowaka leave policies/sowaka-leave.txt
 *   node --env-file=.env --import tsx src/scripts/policies.ts remove sowaka leave
 *
 * Upsert options: --title "..." --file <path> --order N --summary "..." | none
 * --active true|false --by "<name>" (who is recorded as having written it;
 * defaults to this machine's user). A new policy needs --title and --file.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, resolve } from 'node:path';
import { companies, connectDb, policyDocuments } from '../config/db';
import { POLICY_KEY_PATTERN, PolicyDocument } from '../models/policy-document.model';
import { cleanPolicyBody, cleanPolicySummary, cleanPolicyTitle } from '../services/policy-document.service';

/** `upsert sowaka leave --title "Leave" --active false` -> positionals and flags. */
function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) flags[name] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[name] = argv[++i];
    else flags[name] = 'true';
  }
  return { positional, flags };
}

function bool(value: string, flag: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`--${flag} must be true or false`);
}

function requireKey(key: string | undefined): string {
  if (!key || !POLICY_KEY_PATTERN.test(key)) {
    throw new Error(`The key must be lowercase letters, digits and dashes, such as leave or claims (got "${key ?? ''}")`);
  }
  return key;
}

async function requireCompany(org: string | undefined): Promise<string> {
  if (!org) throw new Error('Which company? Give its id, such as sowaka');
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, id: 1 } });
  if (!company) throw new Error(`No company "${org}"`);
  return org;
}

/** How the app will lay the text out, counted the way it reads it. */
function outline(body: string): string {
  let headings = 0;
  let cards = 0;
  let bullets = 0;
  let inCard = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) {
      inCard = false;
    } else if (line.startsWith('## ')) {
      headings++;
      inCard = false;
    } else {
      if (!inCard) cards++;
      inCard = true;
      if (line.startsWith('- ')) bullets++;
    }
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(headings, 'heading')}, ${plural(cards, 'card')}, ${plural(bullets, 'bullet')}`;
}

function describe(doc: PolicyDocument): string {
  const kb = (Buffer.byteLength(doc.body) / 1024).toFixed(1);
  const by = doc.updatedBy ? ` by ${doc.updatedBy}` : '';
  return (
    `  ${String(doc.order).padStart(4)}  ${doc.key.padEnd(14)} ${doc.active ? 'active  ' : 'INACTIVE'}  "${doc.title}"` +
    `${doc.summary ? ` — ${doc.summary}` : ''}\n` +
    `        ${kb} KB: ${outline(doc.body)}; updated ${doc.updatedAt.toISOString()}${by}`
  );
}

async function upsert(positional: string[], flags: Record<string, string>) {
  const org = await requireCompany(positional[0]);
  const key = requireKey(positional[1]);
  const existing = await policyDocuments().findOne({ org, key });
  const set: Partial<PolicyDocument> = {};
  const unset: Record<string, ''> = {};

  if (flags.title !== undefined) set.title = cleanPolicyTitle(flags.title);
  if (flags.file !== undefined) {
    if (flags.file === 'true') throw new Error('--file needs a path, such as policies/sowaka-leave.txt');
    let raw: string;
    try {
      raw = readFileSync(resolve(flags.file), 'utf8');
    } catch {
      throw new Error(`Cannot read ${flags.file} (run this from backend/, or give the full path)`);
    }
    set.body = cleanPolicyBody(raw);
  }
  if (flags.summary !== undefined) {
    const summary = flags.summary === 'none' ? '' : cleanPolicySummary(flags.summary);
    if (summary) set.summary = summary;
    else if (existing?.summary !== undefined) unset.summary = '';
  }
  if (flags.order !== undefined) {
    const order = Number(flags.order);
    if (!Number.isFinite(order)) throw new Error('--order must be a number');
    set.order = order;
  }
  if (flags.active !== undefined) set.active = bool(flags.active, 'active');

  if (!existing) {
    if (!set.title) throw new Error('A new policy needs --title, such as --title "Leave"');
    if (!set.body) throw new Error(`A new policy needs --file, such as --file policies/${org}-${key}.txt`);
  }

  // Only what actually differs is written, so updatedAt means the text changed.
  const changed = (Object.keys(set) as (keyof PolicyDocument)[]).filter(
    (field) => !existing || existing[field] !== set[field],
  );
  const removed = Object.keys(unset);
  if (existing && changed.length === 0 && removed.length === 0) {
    console.log(`No change: ${org}/${key} already says that.`);
    console.log(describe(existing));
    return;
  }

  const othersBefore = await policyDocuments().countDocuments({ org, active: true, key: { $ne: key } });
  const now = new Date();
  const onInsert: Partial<PolicyDocument> = { org, key, createdAt: now };
  if (set.active === undefined) onInsert.active = true;
  if (set.order === undefined) {
    const last = await policyDocuments().find({ org }, { projection: { order: 1 } }).sort({ order: -1 }).limit(1).next();
    onInsert.order = (last?.order ?? 0) + 10;
  }
  const updatedBy = (flags.by && flags.by !== 'true' ? flags.by : userInfo().username).trim().slice(0, 80);
  await policyDocuments().updateOne(
    { org, key },
    {
      $set: { ...Object.fromEntries(changed.map((field) => [field, set[field]])), updatedAt: now, updatedBy },
      ...(existing ? {} : { $setOnInsert: onInsert }),
      ...(removed.length ? { $unset: unset } : {}),
    },
    { upsert: true },
  );
  const fields = [...changed, ...removed.map((field) => `-${field}`)];
  console.log(`${existing ? 'Updated' : 'Added'} ${org}/${key} (${fields.join(', ')}).`);
  const doc = await policyDocuments().findOne({ org, key });
  if (doc) console.log(describe(doc));
  if (!existing && othersBefore === 0 && doc?.active) {
    console.log(
      `\nThis is ${org}'s first policy. From now on the app lists ${org}'s own policies only, ` +
        'not the ones it wrote from the shift rules; add every policy it should show.',
    );
  }
  console.log('The app shows it the next time someone opens Policies.');
}

async function list(org: string | undefined) {
  const filter = org ? { org } : {};
  const docs = await policyDocuments().find(filter).sort({ org: 1, order: 1, title: 1 }).toArray();
  let current = '';
  for (const doc of docs) {
    if (doc.org !== current) {
      current = doc.org;
      console.log(`\n${current}:`);
    }
    console.log(describe(doc));
  }
  const withDocs = new Set(docs.filter((doc) => doc.active).map((doc) => doc.org));
  const rows = await companies()
    .find(org ? { id: org } : {}, { projection: { _id: 0, id: 1 } })
    .sort({ id: 1 })
    .toArray();
  const without = rows.map((row) => row.id).filter((id) => !withDocs.has(id));
  if (without.length) {
    console.log(`\nNo policies of their own (the app writes them from the shift rules): ${without.join(', ')}`);
  }
}

async function exportBody(org: string | undefined, key: string | undefined, out: string | undefined) {
  if (!org || !key || !out) throw new Error('Usage: export <org> <key> <file>   (- prints it)');
  const doc = await policyDocuments().findOne({ org, key: requireKey(key) });
  if (!doc) throw new Error(`${org} has no policy "${key}"`);
  if (out === '-') {
    process.stdout.write(`${doc.body}\n`);
    return;
  }
  const path = resolve(out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${doc.body}\n`);
  console.log(`Wrote ${org}/${key} ("${doc.title}", updated ${doc.updatedAt.toISOString()}) to ${out}`);
}

async function remove(org: string | undefined, key: string | undefined) {
  if (!org || !key) throw new Error('Usage: remove <org> <key>');
  const doc = await policyDocuments().findOneAndDelete({ org, key: requireKey(key) });
  if (!doc) throw new Error(`${org} has no policy "${key}"`);
  console.log(`Removed ${org}/${key} ("${doc.title}").`);
  const left = await policyDocuments().countDocuments({ org, active: true });
  if (left === 0) {
    console.log(`${org} has no policies of its own now: the app goes back to writing them from the shift rules.`);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || command === 'help' || command === '--help') {
    console.log(
      'Usage: policies.ts upsert <org> <key> [--title "..."] [--file <path>] [--order N] [--summary "..."|none] [--active true|false]\n' +
        '       policies.ts list [org] | export <org> <key> <file> | remove <org> <key>',
    );
    return;
  }
  await connectDb();
  switch (command) {
    case 'upsert':
      return upsert(positional, flags);
    case 'list':
      return list(positional[0]);
    case 'export':
      return exportBody(positional[0], positional[1], positional[2]);
    case 'remove':
      return remove(positional[0], positional[1]);
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
