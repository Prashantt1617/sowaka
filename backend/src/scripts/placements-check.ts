/**
 * Scratch-database check of Placements through its HTTP routes: the company
 * switch (another company gets 403 until it is on, and the profile says so),
 * the dashboard tab, company scoping, validation, a client, a customer and a
 * placement created and moved along with its history, who may change it, the
 * list's names read in one query, the delete guard, the summary and the
 * dashboard's filters. It drops and recreates its own database, refuses any
 * other, and drops it again at the end. Run with
 *   MONGODB_DB=placements_scratch npm run placements:check
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Collection } from 'mongodb';
import { app } from '../app';
import { authSessions, closeDb, companies, connectDb, getDb, placements, users } from '../config/db';
import { env } from '../config/env';
import { hashSessionToken } from '../services/auth.service';
import { forgetPlacementsFeature } from '../services/placements.service';

const DB_NAME = 'placements_scratch';
const PORT = Number(process.env.PORT ?? 4093);

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}

// ---------------------------------------------------------------- queries
// Every query the server sends to a Placements collection while `counting`,
// so the list can be shown to read its names in the one aggregate.
const queries: string[] = [];
let counting = false;
for (const method of ['find', 'findOne', 'aggregate', 'countDocuments', 'findOneAndUpdate', 'updateOne'] as const) {
  const proto = Collection.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const original = proto[method];
  proto[method] = function (this: Collection, ...args: unknown[]) {
    if (counting && this.collectionName.startsWith('placement')) queries.push(`${this.collectionName}.${method}`);
    return original.apply(this, args);
  };
}

// ---------------------------------------------------------------- people
const AGENCY = 'hrorgsol';
const OTHER = 'sowaka';
const tokens: Record<string, string> = {};
const person = (userId: string, org: string, extra: Record<string, unknown> = {}) => ({
  userId, name: userId.replace(/^\w/, (c) => c.toUpperCase()), email: `${userId}@${org}.test`, org, lifecycleStatus: 'active', ...extra,
});

// Replies are read loosely: each check names the fields it looks at.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Reply = { status: number; body: Json };
async function call(who: string, method: string, path: string, body?: unknown): Promise<Reply> {
  const res = await fetch(`http://localhost:${PORT}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens[who]}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

(async () => {
  let server: Server | undefined;
  try {
    if (env.mongoDbName !== DB_NAME) throw new Error(`refusing to run against ${env.mongoDbName}: use MONGODB_DB=${DB_NAME}`);
    await connectDb();
    const db = getDb();
    if (db.databaseName !== DB_NAME) throw new Error(`refusing to run against ${db.databaseName}`);
    await db.dropDatabase();
    await connectDb();

    await companies().insertMany([
      { id: AGENCY, name: "HR Organization's Solutions", features: { placements: true } },
      { id: OTHER, name: 'Sowaka' },
    ] as never[]);
    await users().insertMany([
      person('hema', AGENCY, { dashboardAccess: true, dashboardAdmin: true }),
      person('ravi', AGENCY),
      person('sita', AGENCY),
      person('lena', AGENCY, { dashboardAccess: true, dashboardTabs: ['leave'] }),
      person('pia', AGENCY, { dashboardAccess: true, dashboardTabs: ['placements'] }),
      person('omar', OTHER, { dashboardAccess: true, dashboardAdmin: true }),
    ] as never[]);
    const now = new Date();
    for (const userId of ['hema', 'ravi', 'sita', 'lena', 'pia', 'omar']) {
      tokens[userId] = `tok-${randomUUID()}`;
      await authSessions().insertOne({ tokenHash: hashSessionToken(tokens[userId]), userId, createdAt: now, expiresAt: new Date(Date.now() + 3_600_000) });
    }
    server = app.listen(PORT);
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));

    // ------------------------------------------------------------ the switch
    console.log('the switch');
    const meAgency = await call('ravi', 'GET', '/auth/me');
    const meOther = await call('omar', 'GET', '/auth/me');
    check('the profile says Placements is on for the agency', meAgency.body.user?.features?.placements === true, meAgency.body.user?.features);
    check('and off for another company', meOther.body.user?.features?.placements === false, meOther.body.user?.features);
    for (const [method, path] of [['GET', '/placements/summary'], ['GET', '/placements/clients'], ['POST', '/placements/clients'], ['GET', '/placements'], ['PATCH', '/placements/x'], ['GET', '/admin/placements'], ['GET', '/admin/placements/clients'], ['DELETE', '/admin/placements/clients/x']]) {
      const r = await call('omar', method, path, method === 'GET' || method === 'DELETE' ? undefined : { name: 'X' });
      check(`another company: ${method} ${path} is 403`, r.status === 403, r);
    }
    const refused = await call('omar', 'GET', '/placements/summary');
    check('with a message saying why', /not switched on/.test(String(refused.body.message)), refused.body);
    check('the agency gets in', (await call('ravi', 'GET', '/placements/summary')).status === 200);

    console.log('the dashboard tab');
    check('an employee without dashboard access: 403 on the dashboard routes', (await call('ravi', 'GET', '/admin/placements')).status === 403);
    check('HR limited to other tabs: 403', (await call('lena', 'GET', '/admin/placements/clients')).status === 403);
    check('HR given the placements tab: in', (await call('pia', 'GET', '/admin/placements/clients')).status === 200);
    check('a dashboard admin: in', (await call('hema', 'GET', '/admin/placements')).status === 200);

    // ------------------------------------------------------------ validation
    console.log('validation');
    const refuse = async (label: string, path: string, body: unknown, pattern: RegExp) => {
      const r = await call('ravi', 'POST', path, body);
      check(label, r.status === 400 && pattern.test(String(r.body.message)), r);
    };
    await refuse('a client needs a name', '/placements/clients', { name: '   ' }, /name is required/);
    await refuse('a long name is refused', '/placements/clients', { name: 'x'.repeat(121) }, /name cannot be longer than 120/);
    await refuse('a bad email', '/placements/clients', { name: 'A', email: 'meera@' }, /email must be an email/);
    await refuse('a bad phone', '/placements/clients', { name: 'A', phone: '12ab' }, /phone must be a phone number/);
    await refuse('too few digits', '/placements/clients', { name: 'A', phone: '12345' }, /phone/);
    await refuse('long notes', '/placements/clients', { name: 'A', notes: 'n'.repeat(2001) }, /notes cannot be longer than 2000/);
    await refuse('a customer needs a phone', '/placements/customers', { name: 'Arjun' }, /phone is required/);
    await refuse('negative experience', '/placements/customers', { name: 'Arjun', phone: '9876543210', experienceYears: -1 }, /experienceYears cannot be negative/);
    await refuse('experience not a number', '/placements/customers', { name: 'Arjun', phone: '9876543210', experienceYears: 'four' }, /experienceYears must be a number/);
    await refuse('skills not a list', '/placements/customers', { name: 'Arjun', phone: '9876543210', skills: { a: 1 } }, /skills must be a list/);

    const client = await call('ravi', 'POST', '/placements/clients', {
      name: '  Northwind Logistics ', contactName: 'Meera Rao', phone: '+91 98450  12345', email: 'Meera@Northwind.IN', industry: 'Logistics', city: 'Bengaluru',
    });
    check('a client is created (201)', client.status === 201 && typeof client.body.client?.id === 'string', client);
    const c = client.body.client ?? {};
    check('its fields are trimmed, the email lower-case', c.name === 'Northwind Logistics' && c.email === 'meera@northwind.in' && c.phone === '+91 98450 12345', c);
    check('unset text fields are empty strings, and it is the caller\'s', c.notes === '' && c.createdByUserId === 'ravi' && !('org' in c), c);
    const client2 = (await call('hema', 'POST', '/placements/clients', { name: 'Contoso Retail', city: 'Pune' })).body.client;

    const customer = await call('ravi', 'POST', '/placements/customers', {
      name: 'Arjun Mehta', phone: '9876543210', email: 'arjun@gmail.com', currentRole: 'Shift supervisor', experienceYears: '4.56', skills: 'Inventory, SAP, sap , ', city: 'Mysuru',
    });
    const u = customer.body.customer ?? {};
    check('a customer is created (201)', customer.status === 201 && typeof u.id === 'string', customer);
    check('experience kept to one decimal, skills split and deduplicated', u.experienceYears === 4.6 && JSON.stringify(u.skills) === '["Inventory","SAP"]', u);
    const customer2 = (await call('sita', 'POST', '/placements/customers', { name: 'Divya Nair', phone: '9123456789', skills: ['Excel'] })).body.customer;

    await refuse('a placement needs a position', '/placements', { customerId: u.id, clientId: c.id }, /position is required/);
    await refuse('a placement needs a customer', '/placements', { clientId: c.id, position: 'Supervisor' }, /customerId is required/);
    await refuse('an unknown client', '/placements', { customerId: u.id, clientId: 'nope', position: 'Supervisor' }, /clientId does not match/);
    await refuse('a status not in the list', '/placements', { customerId: u.id, clientId: c.id, position: 'Supervisor', status: 'hired' }, /status must be one of/);
    await refuse('a day that does not exist', '/placements', { customerId: u.id, clientId: c.id, position: 'Supervisor', interviewDate: '2026-02-30' }, /interviewDate must be a date/);
    await refuse('a negative fee', '/placements', { customerId: u.id, clientId: c.id, position: 'Supervisor', feeRupees: -5 }, /feeRupees cannot be negative/);
    await refuse('a CTC that is not a number', '/placements', { customerId: u.id, clientId: c.id, position: 'Supervisor', ctcRupees: 'lots' }, /ctcRupees must be a number/);

    // ------------------------------------------------------------ a placement
    console.log('a placement');
    const created = await call('ravi', 'POST', '/placements', {
      customerId: u.id, clientId: c.id, position: 'Warehouse supervisor', interviewDate: '2026-10-29', ctcRupees: 420000, feeRupees: '35000.555',
    });
    const p = created.body.placement ?? {};
    check('created (201), shortlisted by default', created.status === 201 && p.status === 'shortlisted', created);
    check('it carries the names', p.clientName === 'Northwind Logistics' && p.customerName === 'Arjun Mehta', p);
    check('amounts kept to two decimals, the day as given', p.feeRupees === 35000.56 && p.ctcRupees === 420000 && p.interviewDate === '2026-10-29' && p.joiningDate === null, p);
    check('its history starts with its first status', p.history?.length === 1 && p.history[0].status === 'shortlisted' && p.history[0].byUserId === 'ravi', p.history);

    const moved = await call('ravi', 'PATCH', `/placements/${p.id}`, { status: 'interviewing', notes: 'Second round' });
    check('its creator moves it along', moved.status === 200 && moved.body.placement?.status === 'interviewing' && moved.body.placement?.notes === 'Second round', moved);
    check('the change is in the history', moved.body.placement?.history?.length === 2 && moved.body.placement.history[1].status === 'interviewing', moved.body.placement?.history);
    const again = await call('ravi', 'PATCH', `/placements/${p.id}`, { status: 'interviewing', interviewDate: null });
    check('the same status again adds nothing; null clears a day', again.body.placement?.history?.length === 2 && again.body.placement?.interviewDate === null, again.body.placement);
    const stored = await placements().findOne({ id: p.id });
    check('and the record says the same', stored?.history.length === 2 && stored?.status === 'interviewing' && stored?.interviewDate === null, stored);
    check('the app cannot move it to another client', (await call('ravi', 'PATCH', `/placements/${p.id}`, { clientId: client2.id })).body.placement?.clientId === c.id);
    const notMine = await call('sita', 'PATCH', `/placements/${p.id}`, { status: 'dropped' });
    check('a colleague who did not add it: 403', notMine.status === 403, notMine);
    const byHr = await call('hema', 'PATCH', `/placements/${p.id}`, { status: 'offered' });
    check('HR (a dashboard admin) may, from the app too', byHr.status === 200 && byHr.body.placement?.history?.[2]?.byUserId === 'hema', byHr);
    check('a bad edit is refused', (await call('ravi', 'PATCH', `/placements/${p.id}`, { ctcRupees: -1 })).status === 400);
    check('an unknown placement: 404', (await call('ravi', 'PATCH', '/placements/nope', { status: 'joined' })).status === 404);

    const p2 = (await call('sita', 'POST', '/placements', { customerId: customer2.id, clientId: c.id, position: 'Billing clerk', status: 'joined', joiningDate: '2026-11-01' })).body.placement;
    const p3 = (await call('sita', 'POST', '/placements', { customerId: customer2.id, clientId: client2.id, position: 'Store manager' })).body.placement;
    check('a placement may start at another status', p2?.status === 'joined' && p2?.history?.[0]?.status === 'joined', p2);

    // ------------------------------------------------------------ lists
    console.log('lists');
    const mine = await call('sita', 'GET', '/placements?mine=1');
    check('mine=1: only theirs, newest first', mine.body.placements?.map((x: { id: string }) => x.id).join() === [p3.id, p2.id].join(), mine.body.placements?.map((x: { id: string }) => x.id));
    const joined = await call('ravi', 'GET', '/placements?status=joined');
    check('status=: only that status', joined.body.placements?.length === 1 && joined.body.placements[0].id === p2.id, joined.body);
    check('a status not in the list is refused', (await call('ravi', 'GET', '/placements?status=hired')).status === 400);

    // More rows, so one query a row would show.
    for (let i = 0; i < 6; i += 1) {
      await call('ravi', 'POST', '/placements', { customerId: u.id, clientId: client2.id, position: `Picker ${i}` });
    }
    queries.length = 0;
    counting = true;
    const all = await call('ravi', 'GET', '/placements');
    counting = false;
    check('every row has both names', all.body.placements?.length === 9 && all.body.placements.every((x: { clientName: string; customerName: string }) => x.clientName && x.customerName), all.body.placements?.length);
    check('nine rows and their names in one query', queries.length === 1 && queries[0] === 'placements.aggregate', queries);

    const clients = await call('ravi', 'GET', '/placements/clients?q=north');
    check('clients: q matches the name, any case', clients.body.clients?.length === 1 && clients.body.clients[0].id === c.id, clients.body);
    const customers = await call('ravi', 'GET', '/placements/customers?q=91234');
    check('customers: q matches the phone too', customers.body.customers?.length === 1 && customers.body.customers[0].id === customer2.id, customers.body);
    check('a search is taken literally, not as a pattern', (await call('ravi', 'GET', '/placements/clients?q=.*')).body.clients?.length === 0);

    const summary = (await call('ravi', 'GET', '/placements/summary')).body;
    check('summary: the counts', summary.clients === 2 && summary.customers === 2 && summary.placements?.total === 9, summary);
    check('summary: by status, every status present', JSON.stringify(summary.placements?.byStatus) === JSON.stringify({ shortlisted: 7, interviewing: 0, offered: 1, joined: 1, dropped: 0 }), summary.placements);

    // ------------------------------------------------------------ scoping
    console.log('company scoping');
    await companies().updateOne({ id: OTHER }, { $set: { features: { placements: true } } });
    forgetPlacementsFeature();
    const otherSummary = await call('omar', 'GET', '/placements/summary');
    check('switched on, the other company gets in', otherSummary.status === 200, otherSummary);
    check('and sees none of the agency\'s records', otherSummary.body.clients === 0 && otherSummary.body.placements?.total === 0, otherSummary.body);
    check('not in its lists either', (await call('omar', 'GET', '/placements')).body.placements?.length === 0
      && (await call('omar', 'GET', '/admin/placements/clients')).body.clients?.length === 0);
    const theirCustomer = (await call('omar', 'POST', '/placements/customers', { name: 'Kiran', phone: '9000000001' })).body.customer;
    const crossed = await call('omar', 'POST', '/placements', { customerId: theirCustomer.id, clientId: c.id, position: 'Driver' });
    check('cannot place someone at the agency\'s client', crossed.status === 400 && /clientId does not match/.test(crossed.body.message), crossed);
    check('cannot change the agency\'s placement (404)', (await call('omar', 'PATCH', `/placements/${p.id}`, { status: 'dropped' })).status === 404);
    check('or its client from the dashboard (404)', (await call('omar', 'PATCH', `/admin/placements/clients/${c.id}`, { name: 'Mine' })).status === 404
      && (await call('omar', 'DELETE', `/admin/placements/customers/${u.id}`)).status === 404);
    await companies().updateOne({ id: OTHER }, { $unset: { features: '' } });
    forgetPlacementsFeature();
    check('switched off again: 403', (await call('omar', 'GET', '/placements')).status === 403);

    // ------------------------------------------------------------ dashboard
    console.log('dashboard lists and filters');
    // Two older rows, to filter on dates.
    await placements().updateOne({ id: p.id }, { $set: { createdAt: new Date('2026-09-10T06:00:00Z') } });
    await placements().updateOne({ id: p2.id }, { $set: { createdAt: new Date('2026-09-20T20:00:00Z') } });
    const admin = (path: string) => call('hema', 'GET', `/admin/placements${path}`);
    const ids = (r: Reply, key = 'placements') => (r.body[key] ?? []).map((x: { id: string }) => x.id).sort().join();
    const byStatus = await admin('?status=offered');
    check('status', ids(byStatus) === p.id, byStatus.body);
    check('status=all is every status', (await admin('?status=all')).body.placements?.length === 9);
    check('client', (await admin(`?clientId=${c.id}`)).body.placements?.length === 2);
    check('customer', (await admin(`?customerId=${customer2.id}`)).body.placements?.length === 2);
    check('created by', ids(await admin('?createdBy=sita')) === [p2.id, p3.id].sort().join());
    check('date range, India days, both ends included', ids(await admin('?from=2026-09-10&to=2026-09-21')) === [p.id, p2.id].sort().join(),
      (await admin('?from=2026-09-10&to=2026-09-21')).body.placements?.map((x: { position: string }) => x.position));
    // 20:00 UTC on 20 Sep is 01:30 on 21 Sep in India.
    check('a day ends at India midnight', ids(await admin('?from=2026-09-01&to=2026-09-20')) === p.id);
    check('a range the wrong way round is refused', (await admin('?from=2026-09-21&to=2026-09-10')).status === 400);
    check('q: the client\'s name', (await admin('?q=contoso')).body.placements?.length === 7);
    check('q: the customer\'s name', ids(await admin('?q=divya')) === [p2.id, p3.id].sort().join());
    check('q: the position', ids(await admin('?q=billing')) === p2.id);
    check('filters together', ids(await admin(`?q=picker&createdBy=ravi&clientId=${client2.id}&status=shortlisted`)).split(',').length === 6);
    const row = (await admin(`?clientId=${c.id}&status=offered`)).body.placements?.[0];
    check('rows name who added them', row?.createdByName === 'Ravi' && row?.clientName === 'Northwind Logistics', row);

    const adminClients = await admin('/clients');
    const north = adminClients.body.clients?.find((x: { id: string }) => x.id === c.id);
    check('clients: how many placements use each, and who added it', north?.placements === 2 && north?.createdByName === 'Ravi', north);
    check('clients: created by', ids(await admin('/clients?createdBy=hema'), 'clients') === client2.id);
    check('clients: q matches the city', ids(await admin('/clients?q=pune'), 'clients') === client2.id);
    check('customers: q matches a skill', ids(await admin('/customers?q=excel'), 'customers') === customer2.id);
    check('customers: a date range with nothing in it', (await admin('/customers?from=2020-01-01&to=2020-01-31')).body.customers?.length === 0);

    console.log('dashboard edits and the delete guard');
    const renamed = await call('pia', 'PATCH', `/admin/placements/clients/${c.id}`, { name: 'Northwind Logistics Pvt Ltd', phone: '' });
    check('HR edits a client; "" clears a field', renamed.status === 200 && renamed.body.client?.name === 'Northwind Logistics Pvt Ltd' && renamed.body.client?.phone === '', renamed);
    check('but not to no name', (await call('pia', 'PATCH', `/admin/placements/clients/${c.id}`, { name: '' })).status === 400);
    check('the new name shows on its placements', (await call('ravi', 'GET', '/placements')).body.placements?.find((x: { id: string }) => x.id === p.id)?.clientName === 'Northwind Logistics Pvt Ltd');
    const editedCustomer = await call('pia', 'PATCH', `/admin/placements/customers/${u.id}`, { skills: ['Forklift'], experienceYears: null });
    check('HR edits a customer', editedCustomer.body.customer?.skills?.join() === 'Forklift' && editedCustomer.body.customer?.experienceYears === null, editedCustomer);
    const relinked = await call('pia', 'PATCH', `/admin/placements/${p2.id}`, { clientId: client2.id, position: 'Cashier', feeRupees: 12000 });
    check('the dashboard may move a placement to another client', relinked.body.placement?.clientId === client2.id && relinked.body.placement?.clientName === 'Contoso Retail'
      && relinked.body.placement?.position === 'Cashier' && relinked.body.placement?.history?.length === 1, relinked.body);
    check('but not to a client that is not there', (await call('pia', 'PATCH', `/admin/placements/${p2.id}`, { clientId: 'nope' })).status === 400);

    const usedClient = await call('pia', 'DELETE', `/admin/placements/clients/${c.id}`);
    check('a client on a placement cannot be deleted (409)', usedClient.status === 409 && /on 1 placement:/.test(usedClient.body.message), usedClient);
    check('nor a customer', (await call('pia', 'DELETE', `/admin/placements/customers/${customer2.id}`)).status === 409);
    check('a placement can', (await call('pia', 'DELETE', `/admin/placements/${p.id}`)).status === 200);
    check('then its client can', (await call('pia', 'DELETE', `/admin/placements/clients/${c.id}`)).status === 200);
    check('and is gone', (await call('pia', 'DELETE', `/admin/placements/clients/${c.id}`)).status === 404);
    const lone = (await call('pia', 'POST', '/admin/placements/customers', { name: 'Unplaced', phone: '9000000002' })).body.customer;
    check('a customer on no placement can be deleted', (await call('pia', 'DELETE', `/admin/placements/customers/${lone.id}`)).status === 200);

    // ------------------------------------------------------------ the app's pages
    console.log('a client with its roles and onboarding fee');
    await refuse('a role needs a title', '/placements/clients', { name: 'A', designations: [{ budgetRupees: 1 }] }, /designations\[0\]\.title is required/);
    await refuse('a budget is per month or year', '/placements/clients', { name: 'A', designations: [{ title: 'X', budgetPeriod: 'week' }] }, /budgetPeriod must be month or year/);
    await refuse('fee received is true or false', '/placements/clients', { name: 'A', feePaid: 'yes' }, /feePaid must be true or false/);
    const marwarReply = await call('ravi', 'POST', '/placements/clients', {
      name: 'Marwar Retail Pvt Ltd', city: 'Ratanada, Jodhpur',
      designations: [
        { title: 'Store manager', budgetRupees: 35000, budgetPeriod: 'month', description: 'Run daily store operations' },
        { title: 'Sales executive', budgetRupees: '18000' },
      ],
    });
    const marwar = marwarReply.body.client ?? {};
    check('a client is created with its roles', marwarReply.status === 201 && marwar.designations?.length === 2, marwarReply);
    check('each role has an id, and a budget is per month unless said', marwar.designations?.every((d: Json) => typeof d.id === 'string') && marwar.designations?.[1]?.budgetPeriod === 'month' && marwar.designations?.[1]?.budgetRupees === 18000, marwar.designations);
    check('the onboarding fee is 2,500 unless said, not yet received', marwar.feeRupees === 2500 && marwar.feePaid === false && marwar.feePaidAt === null && marwar.feeReference === '', marwar);
    check('someone else cannot edit it from the app (403)', (await call('sita', 'PATCH', `/placements/clients/${marwar.id}`, { name: 'X' })).status === 403);
    const keptRole = marwar.designations?.[0];
    const paid = await call('ravi', 'PATCH', `/placements/clients/${marwar.id}`, {
      feePaid: true, feeReference: 'UPI 4411',
      designations: [{ ...keptRole, budgetRupees: 36000 }, { title: 'Cashier', budgetPeriod: 'year', budgetRupees: 240000 }],
    });
    const pc = paid.body.client ?? {};
    check('its creator marks the fee received, with the reference and when', paid.status === 200 && pc.feePaid === true && pc.feeReference === 'UPI 4411' && Boolean(pc.feePaidAt), pc);
    check('an edited role keeps its id; a removed one goes; a new one gets one', pc.designations?.[0]?.id === keptRole?.id && pc.designations?.[0]?.budgetRupees === 36000 && pc.designations?.length === 2 && pc.designations?.[1]?.id !== keptRole?.id, pc.designations);
    check('HR can edit it from the app too', (await call('hema', 'PATCH', `/placements/clients/${marwar.id}`, { city: 'Ratanada, Jodhpur 342001' })).status === 200);
    const unpaid = (await call('ravi', 'PATCH', `/placements/clients/${marwar.id}`, { feePaid: false })).body.client;
    check('marking it not received clears when', unpaid?.feePaid === false && unpaid?.feePaidAt === null, unpaid);
    await call('ravi', 'PATCH', `/placements/clients/${marwar.id}`, { feePaid: true });
    const myClients = (await call('ravi', 'GET', '/placements/clients?mine=1')).body.clients ?? [];
    const allClients = (await call('ravi', 'GET', '/placements/clients')).body.clients ?? [];
    check('mine=1: only the clients they added', myClients.some((x: Json) => x.id === marwar.id) && !myClients.some((x: Json) => x.id === client2.id), myClients.map((x: Json) => x.name));
    check('without it, the company\'s (for the client picker)', allClients.some((x: Json) => x.id === client2.id), allClients.map((x: Json) => x.name));
    check('a search finds a client by its location', ((await call('ravi', 'GET', '/placements/clients?q=ratanada')).body.clients ?? []).length === 1);

    console.log('a candidate page');
    const arjunReply = await call('ravi', 'POST', '/placements/customers', {
      name: 'Arjun Bhati', phone: '9876500001', address: '12 Shastri Nagar, Jodhpur 342003', currentRole: 'Sales executive', experienceYears: 2, notes: 'Field sales, Hindi and Marwari',
    });
    const arjun = arjunReply.body.customer ?? {};
    check('a candidate keeps their address', arjunReply.status === 201 && arjun.address === '12 Shastri Nagar, Jodhpur 342003' && arjun.removedAt === null, arjun);
    const placed = (await call('ravi', 'POST', '/placements', { customerId: arjun.id, clientId: marwar.id, position: 'Sales executive', status: 'interviewing', interviewDate: '2026-10-28' })).body.placement;
    const page = await call('ravi', 'GET', `/placements/customers/${arjun.id}`);
    check('their page has them, their placements and those clients\' roles', page.status === 200 && page.body.customer?.id === arjun.id && page.body.placements?.[0]?.id === placed?.id && page.body.clients?.[0]?.designations?.length === 2, page.body);
    check('and where they stand: in process', page.body.customer?.stage === 'in_process', page.body.customer);
    const sana = (await call('ravi', 'POST', '/placements/customers', { name: 'Sana Khan', phone: '9876500002', experienceYears: 0 })).body.customer;
    const listed = (await call('ravi', 'GET', '/placements/customers')).body.customers ?? [];
    const stageOf = (id: string) => listed.find((x: Json) => x.id === id)?.stage;
    check('the list says where each stands', stageOf(arjun.id) === 'in_process' && stageOf(customer2.id) === 'joined' && stageOf(sana.id) === 'not_placed', listed.map((x: Json) => [x.name, x.stage]));
    const myCustomers = (await call('ravi', 'GET', '/placements/customers?mine=1')).body.customers ?? [];
    check('mine=1: only the candidates they added', myCustomers.some((x: Json) => x.id === arjun.id) && !myCustomers.some((x: Json) => x.id === customer2.id), myCustomers.map((x: Json) => x.name));
    const clientPage = await call('sita', 'GET', `/placements/clients/${marwar.id}`);
    check('a client\'s page has the candidates placed there', clientPage.status === 200 && clientPage.body.client?.id === marwar.id && clientPage.body.placements?.[0]?.customerName === 'Arjun Bhati', clientPage.body);
    check('another company cannot open it (403)', (await call('omar', 'GET', `/placements/clients/${marwar.id}`)).status === 403);
    check('an unknown client is 404', (await call('ravi', 'GET', '/placements/clients/nope')).status === 404);
    check('someone else cannot edit a candidate from the app (403)', (await call('sita', 'PATCH', `/placements/customers/${arjun.id}`, { address: 'X' })).status === 403);
    const edited = (await call('ravi', 'PATCH', `/placements/customers/${arjun.id}`, { address: '14 Shastri Nagar', experienceYears: 2.5 })).body.customer;
    check('its creator can', edited?.address === '14 Shastri Nagar' && edited?.experienceYears === 2.5, edited);

    console.log('removing a candidate');
    const noReason = await call('ravi', 'POST', `/placements/customers/${u.id}/remove`, {});
    check('a removal needs a reason', noReason.status === 400 && /reason is required/.test(noReason.body.message), noReason);
    check('only by whoever added them, or HR (403)', (await call('sita', 'POST', `/placements/customers/${u.id}/remove`, { reason: 'Duplicate entry' })).status === 403);
    const joinedOne = await call('sita', 'POST', `/placements/customers/${customer2.id}/remove`, { reason: 'Not interested' });
    check('not one who has joined somewhere (409)', joinedOne.status === 409 && /Joined placement/.test(joinedOne.body.message), joinedOne);
    check('their creator removes them', (await call('ravi', 'POST', `/placements/customers/${u.id}/remove`, { reason: 'Duplicate entry' })).status === 200);
    check('they are off the app\'s list', !((await call('ravi', 'GET', '/placements/customers')).body.customers ?? []).some((x: Json) => x.id === u.id));
    check('their page is not found', (await call('ravi', 'GET', `/placements/customers/${u.id}`)).status === 404);
    check('and they cannot be put forward', (await call('ravi', 'POST', '/placements', { customerId: u.id, clientId: marwar.id, position: 'Cashier' })).status === 400);
    check('nor removed twice', (await call('ravi', 'POST', `/placements/customers/${u.id}/remove`, { reason: 'Other' })).status === 404);
    const frozen = ((await admin(`?customerId=${u.id}`)).body.placements ?? [])[0];
    if (frozen) {
      const moved = await call('ravi', 'PATCH', `/placements/${frozen.id}`, { status: 'joined' });
      check('their open placements cannot be moved on from the app (409)', moved.status === 409 && /removed/.test(moved.body.message), moved);
    }
    check('nor are they counted on the summary', (await call('ravi', 'GET', '/placements/summary')).body.customers === ((await call('ravi', 'GET', '/placements/customers')).body.customers ?? []).length);
    const removedRow = ((await admin('/customers')).body.customers ?? []).find((x: Json) => x.id === u.id);
    check('HR still sees them, with why and who', Boolean(removedRow?.removedAt) && removedRow?.removedReason === 'Duplicate entry' && removedRow?.removedByUserId === 'ravi', removedRow);
    check('removed=only lists just the removed', ids(await admin('/customers?removed=only'), 'customers') === u.id);
    check('removed=exclude leaves them out', !((await admin('/customers?removed=exclude')).body.customers ?? []).some((x: Json) => x.id === u.id));
    const restored = await call('pia', 'POST', `/admin/placements/customers/${u.id}/restore`);
    check('HR restores them', restored.status === 200 && restored.body.customer?.removedAt === null && restored.body.customer?.removedReason === '', restored.body);
    check('and they are back on the list', ((await call('ravi', 'GET', '/placements/customers')).body.customers ?? []).some((x: Json) => x.id === u.id));
    check('an employee cannot restore (403)', (await call('ravi', 'POST', `/admin/placements/customers/${u.id}/restore`)).status === 403);

    console.log('removing a client from the app');
    check('not someone else\'s (403)', (await call('sita', 'DELETE', `/placements/clients/${marwar.id}`)).status === 403);
    check('not one with placements (409)', (await call('ravi', 'DELETE', `/placements/clients/${marwar.id}`)).status === 409);
    const spare = (await call('ravi', 'POST', '/placements/clients', { name: 'Spare Co' })).body.client;
    check('its creator removes one with none', (await call('ravi', 'DELETE', `/placements/clients/${spare.id}`)).status === 200);
  } catch (error) {
    console.error('\ncheck crashed:', error);
    failed += 1;
  } finally {
    server?.close();
    try {
      if (getDb().databaseName === DB_NAME) await getDb().dropDatabase();
    } catch {
      /* never connected */
    }
    await closeDb();
    console.log(failed === 0 ? '\nall placements checks passed' : `\n${failed} FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  }
})();
