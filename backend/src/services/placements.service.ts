/**
 * Placements: a placement agency's clients (the companies hiring), customers
 * (the candidates) and placements, for a company with `features.placements`.
 * The app adds them from the Actions tab and moves a placement along; the HR
 * dashboard lists, edits, deletes and exports them. The contract, with
 * examples, is docs/placements-api.md.
 *
 * Every read and write is scoped to the caller's company: another company's
 * record reads as not found, and cannot be referred to.
 */
import { randomUUID } from 'node:crypto';
import type { Document, Filter } from 'mongodb';
import { companies, placementClients, placementCustomers, placements, users } from '../config/db';
import type { Company } from '../models/company.model';
import {
  PLACEMENT_STATUSES,
  type Placement,
  type PlacementClient,
  type PlacementCustomer,
  type PlacementStatus,
  type PlacementStatusChange,
} from '../models/placement.model';

export class PlacementsError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PlacementsError';
  }
}

/** Who is asking: their company, and whether they are a dashboard admin there. */
export interface PlacementsCaller {
  userId: string;
  org: string;
  admin: boolean;
}

// ---------------------------------------------------------------- the switch

/** Whether a company has Placements. Absent is off. */
export function placementsFeatureOf(company: Pick<Company, 'features'> | null | undefined): boolean {
  return company?.features?.placements === true;
}

// Every Placements call asks; the cluster is a round trip away and the answer
// changes only when Sowaka edits the company, so it is kept for half a minute.
const FEATURE_TTL_MS = 30_000;
const featureCache = new Map<string, { at: number; on: boolean }>();

export async function placementsOn(org: string | undefined): Promise<boolean> {
  if (!org) return false;
  const kept = featureCache.get(org);
  if (kept && Date.now() - kept.at < FEATURE_TTL_MS) return kept.on;
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, features: 1 } });
  const on = placementsFeatureOf(company);
  featureCache.set(org, { at: Date.now(), on });
  return on;
}

/** For checks that switch the feature and look again at once. */
export function forgetPlacementsFeature(): void {
  featureCache.clear();
}

export async function requirePlacementsOn(org: string | undefined): Promise<void> {
  if (!(await placementsOn(org))) throw new PlacementsError(403, 'Placements is not switched on for your company');
}

// ---------------------------------------------------------------- validation

type Body = Record<string, unknown>;

const MAX_NAME = 120;
const MAX_SHORT = 80;
const MAX_NOTES = 2000;
const MAX_EMAIL = 254;
const MAX_SKILLS = 30;
const MAX_SKILL = 40;
const MAX_RUPEES = 1_000_000_000;
const MAX_YEARS = 60;
const APP_LIMIT = 200;
const ADMIN_LIMIT = 2000;

const bad = (message: string) => new PlacementsError(400, message);

function has(body: Body, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

function text(value: unknown, field: string, max: number, required = false): string {
  if (value === null || value === undefined) {
    if (required) throw bad(`${field} is required`);
    return '';
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw bad(`${field} must be text`);
  const trimmed = String(value).trim();
  if (required && !trimmed) throw bad(`${field} is required`);
  if (trimmed.length > max) throw bad(`${field} cannot be longer than ${max} characters`);
  return trimmed;
}

function phone(value: unknown, required = false): string {
  const v = text(value, 'phone', 32, required);
  if (!v) return '';
  const digits = v.replace(/\D/g, '').length;
  if (!/^\+?[\d\s\-()]+$/.test(v) || digits < 7 || digits > 15) throw bad('phone must be a phone number of 7 to 15 digits');
  return v.replace(/\s+/g, ' ');
}

function email(value: unknown): string {
  const v = text(value, 'email', MAX_EMAIL).toLowerCase();
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw bad('email must be an email address');
  return v;
}

function amount(value: unknown, field: string, max: number, decimals: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n)) throw bad(`${field} must be a number`);
  if (n < 0) throw bad(`${field} cannot be negative`);
  if (n > max) throw bad(`${field} cannot be more than ${max.toLocaleString('en-IN')}`);
  const scale = 10 ** decimals;
  return Math.round(n * scale) / scale;
}

/** A calendar day, 'YYYY-MM-DD', that exists. */
function day(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  const v = typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!date || date.toISOString().slice(0, 10) !== v) throw bad(`${field} must be a date, YYYY-MM-DD`);
  return v;
}

function skillList(value: unknown): string[] {
  if (value === null || value === undefined || value === '') return [];
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!items) throw bad('skills must be a list of skills');
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') throw bad('skills must be a list of skills');
    const skill = item.trim().replace(/\s+/g, ' ');
    if (!skill) continue;
    if (skill.length > MAX_SKILL) throw bad(`Each skill can be up to ${MAX_SKILL} characters`);
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push(skill);
  }
  if (skills.length > MAX_SKILLS) throw bad(`Up to ${MAX_SKILLS} skills`);
  return skills;
}

function status(value: unknown): PlacementStatus {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!PLACEMENT_STATUSES.includes(v as PlacementStatus)) throw bad(`status must be one of ${PLACEMENT_STATUSES.join(', ')}`);
  return v as PlacementStatus;
}

function idOf(value: unknown, field: string): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) throw bad(`${field} is required`);
  if (v.length > 64) throw bad(`${field} is not a valid id`);
  return v;
}

/**
 * The fields of `parsers` the body carries, parsed. On a create (`partial`
 * false) every field is parsed, so a missing required one is refused and the
 * rest get their empty value; on an edit only those sent.
 */
function fields<T extends Record<string, unknown>>(
  body: Body,
  partial: boolean,
  parsers: { [K in keyof T]: (value: unknown) => T[K] },
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(parsers) as (keyof T & string)[]) {
    if (partial && !has(body, key)) continue;
    out[key] = parsers[key](body[key]);
  }
  return out;
}

type ClientFields = Pick<PlacementClient, 'name' | 'contactName' | 'phone' | 'email' | 'industry' | 'city' | 'notes'>;
const CLIENT_FIELDS: { [K in keyof ClientFields]: (value: unknown) => ClientFields[K] } = {
  name: (v) => text(v, 'name', MAX_NAME, true),
  contactName: (v) => text(v, 'contactName', MAX_NAME),
  phone: (v) => phone(v),
  email,
  industry: (v) => text(v, 'industry', MAX_SHORT),
  city: (v) => text(v, 'city', MAX_SHORT),
  notes: (v) => text(v, 'notes', MAX_NOTES),
};

type CustomerFields = Pick<PlacementCustomer, 'name' | 'phone' | 'email' | 'currentRole' | 'experienceYears' | 'skills' | 'city' | 'notes'>;
const CUSTOMER_FIELDS: { [K in keyof CustomerFields]: (value: unknown) => CustomerFields[K] } = {
  name: (v) => text(v, 'name', MAX_NAME, true),
  phone: (v) => phone(v, true),
  email,
  currentRole: (v) => text(v, 'currentRole', MAX_NAME),
  experienceYears: (v) => amount(v, 'experienceYears', MAX_YEARS, 1),
  skills: skillList,
  city: (v) => text(v, 'city', MAX_SHORT),
  notes: (v) => text(v, 'notes', MAX_NOTES),
};

/** What the app may change on a placement. */
type PlacementEdit = Pick<Placement, 'status' | 'interviewDate' | 'joiningDate' | 'ctcRupees' | 'feeRupees' | 'notes'>;
const PLACEMENT_EDIT_FIELDS: { [K in keyof PlacementEdit]: (value: unknown) => PlacementEdit[K] } = {
  status,
  interviewDate: (v) => day(v, 'interviewDate'),
  joiningDate: (v) => day(v, 'joiningDate'),
  ctcRupees: (v) => amount(v, 'ctcRupees', MAX_RUPEES, 2),
  feeRupees: (v) => amount(v, 'feeRupees', MAX_RUPEES, 2),
  notes: (v) => text(v, 'notes', MAX_NOTES),
};
/** And what the dashboard may change besides. */
type PlacementLinks = Pick<Placement, 'customerId' | 'clientId' | 'position'>;
const PLACEMENT_LINK_FIELDS: { [K in keyof PlacementLinks]: (value: unknown) => PlacementLinks[K] } = {
  customerId: (v) => idOf(v, 'customerId'),
  clientId: (v) => idOf(v, 'clientId'),
  position: (v) => text(v, 'position', MAX_NAME, true),
};

function bodyOf(input: unknown): Body {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Body) : {};
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A case-blind "contains" for a search box, or null for no search. */
function searchOf(q: unknown): RegExp | null {
  const v = typeof q === 'string' ? q.trim().slice(0, 100) : '';
  return v ? new RegExp(escapeRegex(v), 'i') : null;
}

/** `from`/`to` as calendar days in India time, both included, on `createdAt`. */
function createdBetween(from: unknown, to: unknown): Filter<Document> {
  const start = day(from, 'from');
  const end = day(to, 'to');
  if (start && end && start > end) throw bad('from must be on or before to');
  const range: { $gte?: Date; $lt?: Date } = {};
  if (start) range.$gte = new Date(`${start}T00:00:00+05:30`);
  if (end) range.$lt = new Date(new Date(`${end}T00:00:00+05:30`).getTime() + 86_400_000);
  return start || end ? { createdAt: range } : {};
}

/** The dashboard's common filters: who created it, and when. */
function adminFilters(query: Body): Filter<Document> {
  const createdBy = typeof query.createdBy === 'string' ? query.createdBy.trim() : '';
  return { ...(createdBy ? { createdByUserId: createdBy } : {}), ...createdBetween(query.from, query.to) };
}

// ---------------------------------------------------------------- views

export type ClientView = Omit<PlacementClient, 'org'>;
export type CustomerView = Omit<PlacementCustomer, 'org'>;
export type PlacementView = Omit<Placement, 'org'> & { clientName: string; customerName: string };
type CreatedBy = { createdByName: string };

function clientView(c: PlacementClient): ClientView {
  return {
    id: c.id,
    name: c.name,
    contactName: c.contactName ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    industry: c.industry ?? '',
    city: c.city ?? '',
    notes: c.notes ?? '',
    createdByUserId: c.createdByUserId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function customerView(c: PlacementCustomer): CustomerView {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone ?? '',
    email: c.email ?? '',
    currentRole: c.currentRole ?? '',
    experienceYears: c.experienceYears ?? null,
    skills: Array.isArray(c.skills) ? c.skills : [],
    city: c.city ?? '',
    notes: c.notes ?? '',
    createdByUserId: c.createdByUserId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function placementView(p: Placement, names: { clientName: string; customerName: string }): PlacementView {
  return {
    id: p.id,
    customerId: p.customerId,
    clientId: p.clientId,
    position: p.position,
    status: p.status,
    interviewDate: p.interviewDate ?? null,
    joiningDate: p.joiningDate ?? null,
    ctcRupees: p.ctcRupees ?? null,
    feeRupees: p.feeRupees ?? null,
    notes: p.notes ?? '',
    createdByUserId: p.createdByUserId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    history: Array.isArray(p.history) ? p.history : [],
    clientName: names.clientName,
    customerName: names.customerName,
  };
}

/** The creator's name, read in the same query as the rows. */
function creatorLookup(org: string): Document {
  return {
    $lookup: {
      from: users().collectionName,
      localField: 'createdByUserId',
      foreignField: 'userId',
      pipeline: [{ $match: { org } }, { $limit: 1 }, { $project: { _id: 0, name: 1 } }],
      as: 'creator',
    },
  };
}

/** How many placements use each row, read in the same query. */
function usedLookup(org: string, foreignField: 'clientId' | 'customerId'): Document {
  return {
    $lookup: {
      from: placements().collectionName,
      localField: 'id',
      foreignField,
      pipeline: [{ $match: { org } }, { $count: 'n' }],
      as: 'used',
    },
  };
}

type Joined = { creator?: { name?: string }[]; used?: { n: number }[] };
const creatorName = (row: Joined) => row.creator?.[0]?.name ?? '';
const usedCount = (row: Joined) => row.used?.[0]?.n ?? 0;

/**
 * Placements with their client's and customer's names (and, for the
 * dashboard, the creator's), in one aggregate rather than a lookup a row.
 */
async function placementRows(
  org: string,
  match: Filter<Document>,
  options: { q?: RegExp | null; limit: number; withCreator?: boolean },
): Promise<(PlacementView & Partial<CreatedBy>)[]> {
  const nameOf = (from: string, as: string, localField: string): Document => ({
    $lookup: {
      from,
      localField,
      foreignField: 'id',
      pipeline: [{ $match: { org } }, { $limit: 1 }, { $project: { _id: 0, name: 1 } }],
      as,
    },
  });
  const lookups = [
    nameOf(placementClients().collectionName, 'client', 'clientId'),
    nameOf(placementCustomers().collectionName, 'customer', 'customerId'),
  ];
  const pipeline: Document[] = [{ $match: { ...match, org } }, { $sort: { createdAt: -1, id: 1 } }];
  if (options.q) {
    // The search reads the joined names, so the join comes first.
    pipeline.push(...lookups, {
      $match: { $or: [{ position: options.q }, { 'client.name': options.q }, { 'customer.name': options.q }] },
    }, { $limit: options.limit });
  } else {
    pipeline.push({ $limit: options.limit }, ...lookups);
  }
  if (options.withCreator) pipeline.push(creatorLookup(org));
  const rows = await placements()
    .aggregate<Placement & { client: { name: string }[]; customer: { name: string }[] } & Joined>(pipeline)
    .toArray();
  return rows.map((row) => {
    const view = placementView(row, {
      clientName: row.client[0]?.name ?? '',
      customerName: row.customer[0]?.name ?? '',
    });
    return options.withCreator ? { ...view, createdByName: creatorName(row) } : view;
  });
}

// ---------------------------------------------------------------- summary

export async function placementsSummary(caller: PlacementsCaller) {
  const { org } = caller;
  const [clientCount, customerCount, byStatusRows] = await Promise.all([
    placementClients().countDocuments({ org }),
    placementCustomers().countDocuments({ org }),
    placements()
      .aggregate<{ _id: PlacementStatus; n: number }>([{ $match: { org } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
      .toArray(),
  ]);
  const byStatus = Object.fromEntries(PLACEMENT_STATUSES.map((s) => [s, 0])) as Record<PlacementStatus, number>;
  for (const row of byStatusRows) if (row._id in byStatus) byStatus[row._id] = row.n;
  const total = byStatusRows.reduce((sum, row) => sum + row.n, 0);
  return { clients: clientCount, customers: customerCount, placements: { total, byStatus } };
}

// ---------------------------------------------------------------- clients

export async function listClients(caller: PlacementsCaller, query: Body) {
  const q = searchOf(query.q);
  const rows = await placementClients()
    .find({ org: caller.org, ...(q ? { name: q } : {}) }, { projection: { _id: 0 } })
    .sort({ createdAt: -1, id: 1 })
    .limit(APP_LIMIT)
    .toArray();
  return rows.map(clientView);
}

export async function listClientsForAdmin(caller: PlacementsCaller, query: Body) {
  const q = searchOf(query.q);
  const { org } = caller;
  const rows = await placementClients()
    .aggregate<PlacementClient & Joined>([
      { $match: { org, ...adminFilters(query), ...(q ? { $or: [{ name: q }, { contactName: q }, { city: q }] } : {}) } },
      { $sort: { createdAt: -1, id: 1 } },
      { $limit: ADMIN_LIMIT },
      creatorLookup(org),
      usedLookup(org, 'clientId'),
    ])
    .toArray();
  return rows.map((row) => ({ ...clientView(row), createdByName: creatorName(row), placements: usedCount(row) }));
}

export async function createClient(caller: PlacementsCaller, input: unknown) {
  const parsed = fields<ClientFields>(bodyOf(input), false, CLIENT_FIELDS) as ClientFields;
  const now = new Date();
  const client: PlacementClient = { id: randomUUID(), org: caller.org, ...parsed, createdByUserId: caller.userId, createdAt: now, updatedAt: now };
  await placementClients().insertOne({ ...client });
  return clientView(client);
}

export async function updateClient(caller: PlacementsCaller, id: string, input: unknown) {
  const changes = fields<ClientFields>(bodyOf(input), true, CLIENT_FIELDS);
  const updated = await placementClients().findOneAndUpdate(
    { org: caller.org, id },
    { $set: { ...changes, updatedAt: new Date() } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!updated) throw new PlacementsError(404, 'Client not found');
  return clientView(updated);
}

export async function deleteClient(caller: PlacementsCaller, id: string) {
  const client = await placementClients().findOne({ org: caller.org, id }, { projection: { _id: 0, name: 1 } });
  if (!client) throw new PlacementsError(404, 'Client not found');
  const used = await placements().countDocuments({ org: caller.org, clientId: id });
  if (used > 0) {
    throw new PlacementsError(409, `${client.name} is on ${used} placement${used === 1 ? '' : 's'}: delete or move those first`);
  }
  await placementClients().deleteOne({ org: caller.org, id });
}

// ---------------------------------------------------------------- customers

export async function listCustomers(caller: PlacementsCaller, query: Body) {
  const q = searchOf(query.q);
  const rows = await placementCustomers()
    .find({ org: caller.org, ...(q ? { $or: [{ name: q }, { phone: q }] } : {}) }, { projection: { _id: 0 } })
    .sort({ createdAt: -1, id: 1 })
    .limit(APP_LIMIT)
    .toArray();
  return rows.map(customerView);
}

export async function listCustomersForAdmin(caller: PlacementsCaller, query: Body) {
  const q = searchOf(query.q);
  const { org } = caller;
  const search = q ? { $or: [{ name: q }, { phone: q }, { email: q }, { currentRole: q }, { city: q }, { skills: q }] } : {};
  const rows = await placementCustomers()
    .aggregate<PlacementCustomer & Joined>([
      { $match: { org, ...adminFilters(query), ...search } },
      { $sort: { createdAt: -1, id: 1 } },
      { $limit: ADMIN_LIMIT },
      creatorLookup(org),
      usedLookup(org, 'customerId'),
    ])
    .toArray();
  return rows.map((row) => ({ ...customerView(row), createdByName: creatorName(row), placements: usedCount(row) }));
}

export async function createCustomer(caller: PlacementsCaller, input: unknown) {
  const parsed = fields<CustomerFields>(bodyOf(input), false, CUSTOMER_FIELDS) as CustomerFields;
  const now = new Date();
  const customer: PlacementCustomer = { id: randomUUID(), org: caller.org, ...parsed, createdByUserId: caller.userId, createdAt: now, updatedAt: now };
  await placementCustomers().insertOne({ ...customer });
  return customerView(customer);
}

export async function updateCustomer(caller: PlacementsCaller, id: string, input: unknown) {
  const changes = fields<CustomerFields>(bodyOf(input), true, CUSTOMER_FIELDS);
  const updated = await placementCustomers().findOneAndUpdate(
    { org: caller.org, id },
    { $set: { ...changes, updatedAt: new Date() } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!updated) throw new PlacementsError(404, 'Customer not found');
  return customerView(updated);
}

export async function deleteCustomer(caller: PlacementsCaller, id: string) {
  const customer = await placementCustomers().findOne({ org: caller.org, id }, { projection: { _id: 0, name: 1 } });
  if (!customer) throw new PlacementsError(404, 'Customer not found');
  const used = await placements().countDocuments({ org: caller.org, customerId: id });
  if (used > 0) {
    throw new PlacementsError(409, `${customer.name} is on ${used} placement${used === 1 ? '' : 's'}: delete or move those first`);
  }
  await placementCustomers().deleteOne({ org: caller.org, id });
}

// ---------------------------------------------------------------- placements

export async function listPlacements(caller: PlacementsCaller, query: Body) {
  const match: Filter<Document> = {};
  if (query.mine === '1' || query.mine === 'true') match.createdByUserId = caller.userId;
  if (typeof query.status === 'string' && query.status.trim()) match.status = status(query.status);
  return placementRows(caller.org, match, { limit: APP_LIMIT });
}

export async function listPlacementsForAdmin(caller: PlacementsCaller, query: Body) {
  const match: Filter<Document> = { ...adminFilters(query) };
  if (typeof query.status === 'string' && query.status.trim() && query.status !== 'all') match.status = status(query.status);
  if (typeof query.clientId === 'string' && query.clientId.trim()) match.clientId = query.clientId.trim();
  if (typeof query.customerId === 'string' && query.customerId.trim()) match.customerId = query.customerId.trim();
  return placementRows(caller.org, match, { q: searchOf(query.q), limit: ADMIN_LIMIT, withCreator: true });
}

/** The client and the customer a placement names, of this company; their names for the view. */
async function linkedNames(org: string, clientId: string, customerId: string) {
  const [client, customer] = await Promise.all([
    placementClients().findOne({ org, id: clientId }, { projection: { _id: 0, name: 1 } }),
    placementCustomers().findOne({ org, id: customerId }, { projection: { _id: 0, name: 1 } }),
  ]);
  if (!customer) throw bad('customerId does not match a customer of your company');
  if (!client) throw bad('clientId does not match a client of your company');
  return { clientName: client.name, customerName: customer.name };
}

export async function createPlacement(caller: PlacementsCaller, input: unknown) {
  const body = bodyOf(input);
  const links = fields<PlacementLinks>(body, false, PLACEMENT_LINK_FIELDS) as PlacementLinks;
  const edit = fields<PlacementEdit>({ status: 'shortlisted', ...body }, false, PLACEMENT_EDIT_FIELDS) as PlacementEdit;
  const names = await linkedNames(caller.org, links.clientId, links.customerId);
  const now = new Date();
  const placement: Placement = {
    id: randomUUID(),
    org: caller.org,
    ...links,
    ...edit,
    createdByUserId: caller.userId,
    createdAt: now,
    updatedAt: now,
    history: [{ status: edit.status, at: now, byUserId: caller.userId }],
  };
  await placements().insertOne({ ...placement });
  return placementView(placement, names);
}

/**
 * Edits a placement. From the app (`dashboard` false) only its creator or a
 * dashboard admin may, and only the fields the app edits; the dashboard may
 * also move it to another client, customer or position. A new status is
 * added to its history.
 */
export async function updatePlacement(caller: PlacementsCaller, id: string, input: unknown, dashboard = false) {
  const body = bodyOf(input);
  const [current] = await placementRows(caller.org, { id }, { limit: 1, withCreator: dashboard });
  if (!current) throw new PlacementsError(404, 'Placement not found');
  if (!dashboard && current.createdByUserId !== caller.userId && !caller.admin) {
    throw new PlacementsError(403, 'Only the person who added this placement, or HR, can change it');
  }
  const changes: Partial<PlacementEdit & PlacementLinks> = fields<PlacementEdit>(body, true, PLACEMENT_EDIT_FIELDS);
  let names = { clientName: current.clientName, customerName: current.customerName };
  if (dashboard) {
    const links = fields<PlacementLinks>(body, true, PLACEMENT_LINK_FIELDS);
    if (links.clientId !== undefined || links.customerId !== undefined) {
      names = await linkedNames(caller.org, links.clientId ?? current.clientId, links.customerId ?? current.customerId);
    }
    Object.assign(changes, links);
  }
  const now = new Date();
  const change: PlacementStatusChange | null =
    changes.status !== undefined && changes.status !== current.status ? { status: changes.status, at: now, byUserId: caller.userId } : null;
  await placements().updateOne(
    { org: caller.org, id },
    change ? { $set: { ...changes, updatedAt: now }, $push: { history: change } } : { $set: { ...changes, updatedAt: now } },
  );
  return {
    ...current,
    ...changes,
    ...names,
    updatedAt: now,
    history: change ? [...current.history, change] : current.history,
  };
}

export async function deletePlacement(caller: PlacementsCaller, id: string) {
  const { deletedCount } = await placements().deleteOne({ org: caller.org, id });
  if (deletedCount === 0) throw new PlacementsError(404, 'Placement not found');
}
