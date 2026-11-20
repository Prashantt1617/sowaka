import { policyAcknowledgements, policyDocuments } from '../config/db';
import {
  POLICY_BODY_MAX_BYTES,
  POLICY_CHANGE_NOTE_MAX,
  POLICY_KEY_PATTERN,
  POLICY_SUMMARY_MAX,
  POLICY_TITLE_MAX,
} from '../models/policy-document.model';
import type { PolicyDocument } from '../models/policy-document.model';
import { User } from '../models/user.model';

export class PolicyDocumentError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PolicyDocumentError';
  }
}

/** Who is asking: the signed-in person, as the auth middleware read them. */
export type PolicyViewer = Pick<User, 'userId' | 'org'>;

/** What the app is told about a policy. */
export interface PublicPolicy {
  key: string;
  title: string;
  summary: string;
  body: string;
  order: number;
  updatedAt: string;
  /** The text's version (1 up); what an acknowledgement is of. */
  version: number;
  /** When the text last changed. */
  textUpdatedAt: string;
  /** False: read only, nothing to acknowledge. */
  ackRequired: boolean;
  /** What changed in this version; empty for the first. */
  changeNote: string;
  /** About 200 words a minute, at least 1. */
  readMinutes: number;
  /** The viewer's acknowledgement, of whichever version they read. */
  acknowledgedAt?: string;
  acknowledgedVersion?: number;
}

const versionOf = (row: Pick<PolicyDocument, 'version'>) => (typeof row.version === 'number' && row.version >= 1 ? Math.floor(row.version) : 1);
const readMinutesOf = (body: string) => Math.max(1, Math.ceil(body.split(/\s+/).filter(Boolean).length / 200));

function isoOf(value: Date | string | undefined): string {
  const at = value instanceof Date ? value : new Date(value ?? 0);
  return Number.isNaN(at.getTime()) ? new Date(0).toISOString() : at.toISOString();
}

/**
 * The viewer's company's policies, active ones only, in order. Empty for a
 * company that has none, which the app reads as "write them yourself, as
 * before".
 */
export async function policiesFor(viewer: PolicyViewer): Promise<PublicPolicy[]> {
  if (!viewer.org) return [];
  const [rows, acks] = await Promise.all([
    policyDocuments()
      .find({ org: viewer.org, active: true }, { projection: { _id: 0, org: 0, active: 0, createdAt: 0, updatedBy: 0 } })
      .sort({ order: 1, title: 1 })
      .toArray(),
    viewer.userId
      ? policyAcknowledgements().find({ org: viewer.org, userId: viewer.userId }, { projection: { _id: 0, key: 1, version: 1, at: 1 } }).toArray()
      : Promise.resolve([]),
  ]);
  const ackOf = new Map(acks.map((a) => [a.key, a]));
  return rows
    .filter((row) => typeof row.body === 'string' && row.body.trim() !== '' && !!row.title)
    .map((row) => {
      const ack = ackOf.get(row.key);
      return {
        key: row.key,
        title: row.title,
        summary: row.summary ?? '',
        body: row.body,
        order: row.order ?? 0,
        updatedAt: isoOf(row.updatedAt),
        version: versionOf(row),
        textUpdatedAt: isoOf(row.textUpdatedAt ?? row.updatedAt),
        ackRequired: row.ackRequired !== false,
        changeNote: versionOf(row) > 1 ? row.changeNote ?? '' : '',
        readMinutes: readMinutesOf(row.body),
        ...(ack ? { acknowledgedAt: isoOf(ack.at), acknowledgedVersion: ack.version } : {}),
      };
    });
}

/** Whether every policy the viewer must acknowledge is acknowledged at its current version. */
export function allPoliciesAcknowledged(policies: PublicPolicy[]): boolean {
  return policies.every((p) => !p.ackRequired || p.acknowledgedVersion === p.version);
}

/**
 * The viewer acknowledges one policy at the version they read. A version
 * that is no longer current is refused (409), so nobody acknowledges a text
 * that has since changed; acknowledging again is a no-op that keeps the
 * first date.
 */
export async function acknowledgePolicy(viewer: PolicyViewer, key: string, input: { version?: unknown; device?: string }): Promise<{ policy: PublicPolicy; policies: PublicPolicy[] }> {
  if (!viewer.org || !viewer.userId) throw new PolicyDocumentError(401, 'Authentication required');
  const row = await policyDocuments().findOne({ org: viewer.org, key, active: true }, { projection: { _id: 0, version: 1, ackRequired: 1 } });
  if (!row) throw new PolicyDocumentError(404, 'That policy is not there any more');
  const current = versionOf(row);
  const version = input.version === undefined ? current : Number(input.version);
  if (!Number.isInteger(version) || version < 1) throw new PolicyDocumentError(400, 'version must be a whole number');
  if (version !== current) throw new PolicyDocumentError(409, 'This policy has been updated. Read the new version, then acknowledge it.');
  const existing = await policyAcknowledgements().findOne({ org: viewer.org, userId: viewer.userId, key }, { projection: { _id: 0, version: 1 } });
  if (existing?.version !== current) {
    const device = typeof input.device === 'string' && input.device.trim() ? input.device.trim().slice(0, 200) : undefined;
    await policyAcknowledgements().updateOne(
      { org: viewer.org, userId: viewer.userId, key },
      { $set: { version: current, at: new Date(), ...(device ? { device } : {}) } },
      { upsert: true },
    );
  }
  const policies = await policiesFor(viewer);
  const policy = policies.find((p) => p.key === key);
  if (!policy) throw new PolicyDocumentError(404, 'That policy is not there any more');
  return { policy, policies };
}

/**
 * A policy's text as it is stored: line endings made plain, a byte-order mark
 * and trailing spaces dropped, and checked to be text rather than markup. The
 * app never reads HTML, so a tag would only ever show up as written.
 */
export function cleanPolicyBody(raw: string): string {
  const body = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    // Tabs and the odd control character a word processor leaves behind.
    .replace(/\t/g, '    ')
    .split('')
    .filter((ch) => ch === '\n' || ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!body) throw new PolicyDocumentError(400, 'The policy text is empty');
  if (Buffer.byteLength(body) > POLICY_BODY_MAX_BYTES) {
    throw new PolicyDocumentError(400, `The policy text is over ${POLICY_BODY_MAX_BYTES / 1024} KB`);
  }
  const tag = /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/i.exec(body);
  if (tag) {
    throw new PolicyDocumentError(
      400,
      `The policy text is plain text; HTML is not allowed (found ${tag[0]}). ` +
        'Use a blank line between paragraphs, "- " for bullets and "## " for headings.',
    );
  }
  return body;
}

export function cleanPolicyTitle(raw: string): string {
  const title = raw.replace(/\s+/g, ' ').trim();
  if (!title) throw new PolicyDocumentError(400, 'A policy needs a title');
  if (title.length > POLICY_TITLE_MAX) {
    throw new PolicyDocumentError(400, `The title is longer than ${POLICY_TITLE_MAX} characters`);
  }
  return title;
}

export function cleanPolicySummary(raw: string): string {
  const summary = raw.replace(/\s+/g, ' ').trim();
  if (summary.length > POLICY_SUMMARY_MAX) {
    throw new PolicyDocumentError(400, `The summary is longer than ${POLICY_SUMMARY_MAX} characters`);
  }
  return summary;
}

// ─── The dashboard's Setup › Policies page ──────────────────────────────────

/** A policy as the dashboard edits it: the app's fields, plus whether it shows and when it changed. */
export interface AdminPolicy extends PublicPolicy {
  active: boolean;
  updatedBy: string;
}

export interface PolicyInput {
  title?: unknown;
  summary?: unknown;
  body?: unknown;
  active?: unknown;
  ackRequired?: unknown;
  changeNote?: unknown;
}

const policyKeyOf = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'policy';

function adminView(row: PolicyDocument): AdminPolicy {
  return {
    key: row.key,
    title: row.title,
    summary: row.summary ?? '',
    body: row.body,
    order: row.order ?? 0,
    active: row.active !== false,
    updatedAt: isoOf(row.updatedAt),
    updatedBy: row.updatedBy ?? '',
    version: versionOf(row),
    textUpdatedAt: isoOf(row.textUpdatedAt ?? row.updatedAt),
    ackRequired: row.ackRequired !== false,
    changeNote: row.changeNote ?? '',
    readMinutes: readMinutesOf(row.body),
  };
}

function cleanChangeNote(value: unknown): string {
  const note = text(value, 'What changed').replace(/\s+/g, ' ').trim();
  if (note.length > POLICY_CHANGE_NOTE_MAX) throw new PolicyDocumentError(400, `Say what changed in ${POLICY_CHANGE_NOTE_MAX} characters or fewer`);
  return note;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new PolicyDocumentError(400, `${field} must be text`);
  return value;
}

/** Every policy of the company, shown or not, in the app's order. */
export async function adminPolicies(org: string): Promise<AdminPolicy[]> {
  const rows = await policyDocuments().find({ org }, { projection: { _id: 0 } }).sort({ order: 1, title: 1 }).toArray();
  return rows.map(adminView);
}

/** A new policy, last in the list. Its key comes from the name ("Leave" is `leave`, which the app's Leave screen links to). */
export async function createPolicy(org: string, input: PolicyInput, by: string): Promise<AdminPolicy> {
  const title = cleanPolicyTitle(text(input.title ?? '', 'The name'));
  const body = cleanPolicyBody(text(input.body ?? '', 'The points'));
  const summary = cleanPolicySummary(text(input.summary ?? '', 'The line under the name'));
  const rows = await policyDocuments().find({ org }, { projection: { _id: 0, key: 1, title: 1, order: 1 } }).toArray();
  if (rows.some((r) => r.title.trim().toLowerCase() === title.toLowerCase())) {
    throw new PolicyDocumentError(409, `There is already a policy called "${title}"`);
  }
  const base = policyKeyOf(title);
  const taken = new Set(rows.map((r) => r.key));
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  if (!POLICY_KEY_PATTERN.test(key)) throw new PolicyDocumentError(400, 'Give the policy a name with letters or digits');
  const now = new Date();
  const doc: PolicyDocument = {
    org, key, title, summary, body,
    order: Math.max(0, ...rows.map((r) => r.order ?? 0)) + 10,
    active: input.active === undefined ? true : input.active === true,
    createdAt: now, updatedAt: now, updatedBy: by,
    version: 1, textUpdatedAt: now,
    ...(input.ackRequired === false ? { ackRequired: false } : {}),
  };
  await policyDocuments().insertOne(doc);
  return adminView(doc);
}

/** Changes what is given: the name, the line under it, the points, or whether the app shows it. */
export async function updatePolicy(org: string, key: string, input: PolicyInput, by: string): Promise<AdminPolicy> {
  const existing = await policyDocuments().findOne({ org, key }, { projection: { _id: 0 } });
  if (!existing) throw new PolicyDocumentError(404, 'That policy is not there any more');
  const set: Partial<PolicyDocument> = { updatedAt: new Date(), updatedBy: by };
  if (input.title !== undefined) {
    const title = cleanPolicyTitle(text(input.title, 'The name'));
    const others = await policyDocuments().find({ org, key: { $ne: key } }, { projection: { _id: 0, title: 1 } }).toArray();
    const clash = others.some((r) => r.title.trim().toLowerCase() === title.toLowerCase());
    if (clash) throw new PolicyDocumentError(409, `There is already a policy called "${title}"`);
    set.title = title;
  }
  if (input.summary !== undefined) set.summary = cleanPolicySummary(text(input.summary, 'The line under the name'));
  if (input.body !== undefined) {
    const body = cleanPolicyBody(text(input.body, 'The points'));
    if (body !== existing.body) {
      // A new text is a new version: everyone sees it as Updated and acknowledges it again.
      set.body = body;
      set.version = versionOf(existing) + 1;
      set.textUpdatedAt = set.updatedAt;
      set.changeNote = input.changeNote === undefined ? '' : cleanChangeNote(input.changeNote);
    }
  }
  if (input.changeNote !== undefined && set.changeNote === undefined) set.changeNote = cleanChangeNote(input.changeNote);
  if (input.ackRequired !== undefined) {
    if (typeof input.ackRequired !== 'boolean') throw new PolicyDocumentError(400, 'Needs acknowledging must be true or false');
    set.ackRequired = input.ackRequired;
  }
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') throw new PolicyDocumentError(400, 'Shown in the app must be true or false');
    set.active = input.active;
  }
  await policyDocuments().updateOne({ org, key }, { $set: set });
  return adminView({ ...existing, ...set });
}

/** The app's order, top first: every key of the company, once. */
export async function reorderPolicies(org: string, keysInput: unknown, by: string): Promise<AdminPolicy[]> {
  if (!Array.isArray(keysInput) || keysInput.some((k) => typeof k !== 'string')) throw new PolicyDocumentError(400, 'Send the policies in their new order');
  const keys = keysInput as string[];
  const current = new Set((await policyDocuments().find({ org }, { projection: { _id: 0, key: 1 } }).toArray()).map((r) => r.key));
  if (keys.length !== current.size || new Set(keys).size !== keys.length || keys.some((k) => !current.has(k))) {
    throw new PolicyDocumentError(409, 'The list changed meanwhile. Reload the page and try again.');
  }
  const now = new Date();
  await policyDocuments().bulkWrite(keys.map((key, i) => ({
    updateOne: { filter: { org, key }, update: { $set: { order: (i + 1) * 10, updatedAt: now, updatedBy: by } } },
  })));
  return adminPolicies(org);
}

export async function deletePolicy(org: string, key: string): Promise<void> {
  const out = await policyDocuments().deleteOne({ org, key });
  if (out.deletedCount === 0) throw new PolicyDocumentError(404, 'That policy is not there any more');
}
