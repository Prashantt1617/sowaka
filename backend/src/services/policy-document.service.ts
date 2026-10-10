import { policyDocuments } from '../config/db';
import {
  POLICY_BODY_MAX_BYTES,
  POLICY_SUMMARY_MAX,
  POLICY_TITLE_MAX,
} from '../models/policy-document.model';
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
}

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
  const rows = await policyDocuments()
    .find({ org: viewer.org, active: true }, { projection: { _id: 0, org: 0, active: 0, createdAt: 0, updatedBy: 0 } })
    .sort({ order: 1, title: 1 })
    .toArray();
  return rows
    .filter((row) => typeof row.body === 'string' && row.body.trim() !== '' && !!row.title)
    .map((row) => ({
      key: row.key,
      title: row.title,
      summary: row.summary ?? '',
      body: row.body,
      order: row.order ?? 0,
      updatedAt: isoOf(row.updatedAt),
    }));
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
