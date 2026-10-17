/**
 * Checks the Secret Squad word bank and office plans in
 * `services/secret-squad-packs.ts`:
 *  - every category has a unique name, 2+ words, traps that are its own words;
 *  - no word twice anywhere in the bank (ignoring case, spaces and
 *    punctuation), so a word is used once per round whatever plays together;
 *  - every plan names only real categories, none twice in one round, and
 *    none in two rounds of the same plan;
 *  - each plan round has enough categories for its head count, and each
 *    category has enough words for the biggest squad that round can deal
 *    (the engine's own squad sizes for the plan's head count, and for
 *    ±15% of it).
 *
 * No database. Run with `npx tsx src/scripts/secret-squad-packs-check.ts`.
 */
import { SQUAD, squadSizes } from '../services/secret-squad-engine';
import { SQUAD_BANK, SQUAD_PLANS, categoryNamed } from '../services/secret-squad-packs';

const failures: string[] = [];
const warnings: string[] = [];
const fail = (message: string) => failures.push(message);

/** The key two words clash on: letters and digits only, lowercased. */
const keyOf = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, '');

const names = new Set<string>();
const seen = new Map<string, string>(); // word key -> "Category / Word"
let words = 0;
for (const entry of SQUAD_BANK) {
  const name = keyOf(entry.category);
  if (!name) fail('a category has no name');
  else if (names.has(name)) fail(`category "${entry.category}" is listed twice`);
  names.add(name);
  if (entry.words.length < SQUAD.minSquadSize) fail(`${entry.category}: ${entry.words.length} words`);
  if (entry.words.length > SQUAD.maxSquadSize) warnings.push(`${entry.category}: ${entry.words.length} words, only the first ${SQUAD.maxSquadSize} can be dealt`);
  for (const trap of entry.traps) if (!entry.words.includes(trap)) fail(`${entry.category}: trap "${trap}" is not one of its words`);
  for (const word of entry.words) {
    words += 1;
    if (word !== word.trim() || /\s{2,}/.test(word) || !word) fail(`${entry.category}: "${word}" has stray spaces`);
    const key = keyOf(word);
    if (!key) {
      fail(`${entry.category}: "${word}" has no letters`);
      continue;
    }
    const first = seen.get(key);
    if (first) fail(`"${word}" in ${entry.category} clashes with ${first}`);
    else seen.set(key, `${entry.category} / ${word}`);
  }
}
console.log(`${SQUAD_BANK.length} categories, ${words} words, all different`);

for (const plan of SQUAD_PLANS) {
  const inPlan = new Map<string, number>();
  plan.rounds.forEach((round, r) => {
    const where = `${plan.name} round ${r + 1}`;
    const inRound = new Set<string>();
    for (const name of round.categories) {
      const entry = categoryNamed(name);
      if (!entry) fail(`${where}: "${name}" is not a category in the bank`);
      if (inRound.has(keyOf(name))) fail(`${where}: "${name}" twice`);
      inRound.add(keyOf(name));
      if (inPlan.has(keyOf(name))) fail(`${where}: "${name}" is also in round ${inPlan.get(keyOf(name))! + 1}`);
      inPlan.set(keyOf(name), r);
    }
    if (round.squadSize < SQUAD.minSquadSize || round.squadSize > SQUAD.maxSquadSize) fail(`${where}: squad size ${round.squadSize}`);
    // The squads the engine would deal for the plan's head count, and a little either side.
    for (const people of [plan.people, Math.round(plan.people * 0.85), Math.round(plan.people * 1.15)]) {
      const sizes = squadSizes(people, round.squadSize);
      const needed = sizes.length;
      const label = `${where} with ${people} people (${needed} squads of ${Math.min(...sizes)}–${Math.max(...sizes)})`;
      if (round.categories.length < needed) {
        const note = `${label}: plan lists ${round.categories.length} categories, ${needed - round.categories.length} come from the rest of the bank`;
        if (people === plan.people) fail(note);
        else warnings.push(note);
      }
      // Biggest squads take the categories in list order: each must have the words.
      const order = [...sizes].sort((a, b) => b - a);
      round.categories.slice(0, needed).forEach((name, i) => {
        const entry = categoryNamed(name);
        if (entry && entry.words.length < order[i]) fail(`${label}: ${name} has ${entry.words.length} words, a squad of ${order[i]} needs ${order[i]}`);
      });
      if (people === plan.people) {
        const most = Math.max(...round.categories.map((name) => categoryNamed(name)?.words.length ?? 0));
        if (Math.max(...sizes) > most) fail(`${label}: no category has ${Math.max(...sizes)} words`);
      }
    }
  });
  const sizes = plan.rounds.map((round) => squadSizes(plan.people, round.squadSize));
  console.log(`${plan.name.padEnd(8)} ~${plan.people} people: ${plan.rounds.map((round, r) => `R${r + 1} ${sizes[r].length}×${Math.min(...sizes[r])}–${Math.max(...sizes[r])} from ${round.categories.length}`).join(', ')}`);
}

if (warnings.length) {
  console.log(`\n${warnings.length} note(s):`);
  for (const w of warnings) console.log(`  - ${w}`);
}
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nAll word bank and plan checks passed.');
