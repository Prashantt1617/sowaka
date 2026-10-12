/**
 * A company's ticket types for the Support desk: what the app's "Type of
 * request" sheet lists, and what the dashboard files tickets under.
 *
 * One document per org in `support_topics`, written by a Support head or a
 * dashboard admin (`PUT /support/topics`) or by `scripts/support-topics.ts`.
 * An org without one has the defaults. How an edit lands — stable keys, the
 * Manager key, the limits — is `mergeSupportTopics` in `support-rules.ts`.
 */
import { supportTickets, supportTopics } from '../config/db';
import type { SupportTopicList, SupportTopicOption } from '../models/support.model';
import { effectiveSupportTopics, mergeSupportTopics, type TopicEdit } from './support-rules';

// Read on every ticket raised and every list a desk opens, and changed a few
// times a year. A write here drops the org at once; a write from the script
// (another process) shows here within the minute.
const cache = new Map<string, { expires: number; value: SupportTopicOption[] }>();
const TTL_MS = 60_000;

const copy = (topics: readonly SupportTopicOption[]) => topics.map(({ key, label }) => ({ key, label }));

/** Drop an org's cached list, so the next read sees a change at once. */
export function forgetSupportTopics(org: string): void {
  cache.delete(org);
}

/** The org's own document, or null while it has the defaults. */
export async function storedSupportTopics(org: string): Promise<SupportTopicList | null> {
  return supportTopics().findOne({ org }, { projection: { _id: 0 } });
}

/** The org's ticket types, in order: its own list, or the defaults. */
export async function supportTopicsOf(org: string): Promise<SupportTopicOption[]> {
  const hit = cache.get(org);
  if (hit && hit.expires > Date.now()) return copy(hit.value);
  const value = effectiveSupportTopics(await storedSupportTopics(org));
  cache.set(org, { expires: Date.now() + TTL_MS, value });
  return copy(value);
}

/**
 * Saves an edited list (the whole list, in order, each `{ key?, label }`) and
 * answers with it as saved, or with why it was refused.
 */
export async function saveSupportTopics(org: string, input: unknown, byUserId: string): Promise<TopicEdit> {
  // Read past the cache: an edit is made against the list as it stands.
  forgetSupportTopics(org);
  const [current, ticketKeys] = await Promise.all([
    supportTopicsOf(org),
    supportTickets().distinct('topic', { org }) as Promise<string[]>,
  ]);
  const edit = mergeSupportTopics(input, current, ticketKeys);
  if (!edit.ok) return edit;
  const doc: SupportTopicList = { org, topics: edit.topics, updatedAt: new Date(), updatedByUserId: byUserId };
  await supportTopics().replaceOne({ org }, doc, { upsert: true });
  forgetSupportTopics(org);
  return edit;
}

/** Back to the defaults: the org's own list is deleted. True if it had one. */
export async function resetSupportTopics(org: string): Promise<boolean> {
  const { deletedCount } = await supportTopics().deleteOne({ org });
  forgetSupportTopics(org);
  return deletedCount > 0;
}
