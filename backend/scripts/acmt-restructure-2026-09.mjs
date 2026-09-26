// One-off, 2026-09-26: ACMT loses its four synthetic leaders, gets a
// department-based org tree four levels deep, takes salaries from the payroll
// sheet by machine number, and drops the seeded August run so HR can create
// the real one.
//
//   node backend/scripts/acmt-restructure-2026-09.mjs
//
// Reads MONGODB_URI from backend/.env. Safe to re-run: every step is an
// upsert, a delete of what is already gone, or a set to the same value.
import { MongoClient } from '../../node_modules/mongodb/lib/index.js';
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const client = new MongoClient(env.match(/^MONGODB_URI=(.+)$/m)[1].trim(), { compressors: ['zlib'] });
await client.connect();
const db = client.db('sowaka');
const now = new Date();
const users = db.collection('users');

const all = await users.find({ org: 'acmt' }).toArray();
const byId = new Map(all.map((u) => [u.employeeId, u]));
const byName = new Map(all.map((u) => [u.name, u]));
const U = (name) => { const u = byName.get(name); if (!u) throw new Error(`no ACMT user named ${name}`); return u; };
const resolve = (key) => (key.includes('#') ? byId.get(key.split('#')[1]) : U(key));

// ---- 1. the four go, and everything that hangs off them
const gone = ['Brijesh', 'Brijmohan', 'Durgesh', 'Dinesh'].filter((n) => byName.has(n)).map((n) => U(n).userId);
for (const col of ['shift_assignments', 'salary_structures', 'payslips', 'kpi_assignments', 'leaves', 'overtime_requests', 'reimbursement_claims', 'attendance_records']) {
  const r = await db.collection(col).deleteMany({ userId: { $in: gone } });
  if (r.deletedCount) console.log(`  ${col}: removed ${r.deletedCount}`);
}
await db.collection('shift_templates').updateMany({ org: 'acmt' }, { $pull: { assignedUserIds: { $in: gone } } });
console.log('users removed:', (await users.deleteMany({ userId: { $in: gone } })).deletedCount);

// ---- 2. the tree: department based, four levels
//   L1 Demo Admin → L2 department heads → L3 team leads → L4 everyone else
const tree = {
  'Demo Admin': {
    Pankaj: { Haider: ['Tanya', 'Fida', 'Avnish'], Naveen: ['Shivani Mishra', 'Abhi'] },
    Sunny: { Preeti: ['Richa', 'Payal', 'Bhanupriya', 'Renuka'], 'Sakshi#277': ['Sharmistha', 'Priya', 'Anjali', 'Ananya'] },
    Vishant: { Abhay: ['Yash', 'Vinita'] },
    Sandeep: { Vandana: [], 'Anshika Gautam': [], Soni: [], Vishal: [], Akanksha: [], Nandini: [] },
  },
};
const managerOf = new Map();
const walk = (node, managerKey) => {
  for (const [key, children] of Object.entries(node)) {
    if (managerKey) managerOf.set(resolve(key).userId, resolve(managerKey).userId);
    if (Array.isArray(children)) for (const leaf of children) managerOf.set(resolve(leaf).userId, resolve(key).userId);
    else walk(children, key);
  }
};
walk(tree, null);
// The corporate staff: whoever already sits under one of the four leads stays
// there; the rest are spread evenly across them.
const leads = ['Vandana', 'Anshika Gautam', 'Soni', 'Vishal'].map((n) => U(n).userId);
const placed = new Set([...managerOf.keys(), U('Demo Admin').userId]);
const corporate = all.filter((u) => !gone.includes(u.userId) && !placed.has(u.userId) && u.name !== 'Sandeep');
const counts = new Map(leads.map((l) => [l, 0]));
for (const u of corporate) {
  const lead = leads.includes(u.managerUserId) ? u.managerUserId : [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
  managerOf.set(u.userId, lead);
  counts.set(lead, counts.get(lead) + 1);
}
const hasReports = new Set(managerOf.values());
await users.updateOne({ userId: U('Demo Admin').userId }, { $unset: { managerUserId: '' }, $set: { role: 'manager', updatedAt: now } });
for (const [userId, managerUserId] of managerOf) {
  await users.updateOne({ userId }, { $set: { managerUserId, role: hasReports.has(userId) ? 'manager' : 'employee', updatedAt: now } });
}
const nameOf = (id) => all.find((u) => u.userId === id)?.name;
console.log('re-parented:', managerOf.size, '| managers:', hasReports.size, '| corporate teams:', [...counts].map(([l, n]) => `${nameOf(l)}=${n}`).join(', '));

// ---- 3. salaries from the payroll sheet, matched by machine number
const sheet = JSON.parse(readFileSync(`${here}acmt-salaries-2026-09.json`, 'utf8'));
let set = 0; const unmatched = [];
for (const row of sheet) {
  const u = byId.get(row.machine);
  if (!u || gone.includes(u.userId)) { unmatched.push(`${row.machine} ${row.name}`); continue; }
  await db.collection('salary_structures').updateOne(
    { org: 'acmt', userId: u.userId },
    { $set: { salaryTemplateCode: 'STANDARD', annualCtcPaise: Math.round(row.monthly * 12 * 100), status: 'active', updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  set += 1;
}
const inSheet = new Set(sheet.map((r) => byId.get(r.machine)?.userId).filter(Boolean));
const offPayroll = await db.collection('salary_structures').updateMany({ org: 'acmt', userId: { $nin: [...inSheet] } }, { $set: { status: 'draft', updatedAt: now } });
console.log('salaries set:', set, '| sheet rows with no user:', unmatched.length ? unmatched : 'none', '| taken off payroll (no sheet row):', offPayroll.modifiedCount);

// ---- 4. the seeded August run goes; HR creates the real one
for (const run of await db.collection('payroll_runs').find({ org: 'acmt' }).toArray()) {
  await db.collection('payslips').deleteMany({ org: 'acmt', runId: run._id.toHexString() });
}
console.log('payroll runs removed:', (await db.collection('payroll_runs').deleteMany({ org: 'acmt' })).deletedCount);

await client.close();
