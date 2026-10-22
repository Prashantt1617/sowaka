// Draft a policy: Suwi writes the sections in plain words, this tool lays them
// out the way the app shows policies (## headings, - bullets), checks the
// company's existing documents for overlaps, and names the Sowaka settings the
// policy would need. Publishing is a prepared action: Confirm writes the
// document the way scripts/policies.ts does, and Undo takes it down again.
import { companies, policyDocuments, reimbursementTypes, shiftTemplates } from '../../config/db';
import { POLICY_KEY_PATTERN, PolicyDocument } from '../../models/policy-document.model';
import { cleanPolicyBody, cleanPolicySummary, cleanPolicyTitle, policiesFor } from '../../services/policy-document.service';
import { getOrgShiftPolicy, mergeTemplatePolicy, shiftPolicyViewOf } from '../../services/shift.service';
import { defineTools, num, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'policy';
const list = (v: unknown, max = 20) => (Array.isArray(v) ? v.map((x) => str(x, 400)).filter(Boolean).slice(0, max) : []);
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{5,}/g) ?? []);

/** The document as the app lays it out: a heading per section, bullets for rules. */
export function layoutPolicy(i: Record<string, unknown>): string {
  const section = (h: string, body: string | string[]) => {
    const text = Array.isArray(body) ? body.map((b) => `- ${b}`).join('\n') : body;
    return text.trim() ? `## ${h}\n${text.trim()}` : '';
  };
  return [
    section('Purpose', str(i.purpose, 1500)),
    section('Who it covers', str(i.covers, 800)),
    section('Rules', list(i.rules)),
    section('How to request', list(i.howToRequest)),
    section('Exceptions', list(i.exceptions).length ? list(i.exceptions) : str(i.exceptions, 800)),
    section('From when', str(i.fromWhen, 200)),
  ].filter(Boolean).join('\n\n');
}

/** Leave types and reimbursement types the company already has, to map the policy's words to settings. */
async function existingSettings(ctx: SuwiContext) {
  const orgPolicy = await getOrgShiftPolicy(ctx.org);
  const templates = await shiftTemplates().find({ org: ctx.org, deletedAt: { $exists: false } } as never).toArray();
  const leaveTypes = new Map<string, string[]>();
  for (const t of templates) {
    for (const lt of shiftPolicyViewOf(mergeTemplatePolicy(orgPolicy, t)).leaveTypes ?? []) leaveTypes.set(lt.name, [...(leaveTypes.get(lt.name) ?? []), t.name]);
  }
  const claimTypes = (await reimbursementTypes().find({ org: ctx.org, active: true }).project<{ name: string; maxLimit: number }>({ name: 1, maxLimit: 1 }).toArray()).map((t) => `${t.name}${t.maxLimit ? ` (cap ₹${t.maxLimit.toLocaleString('en-IN')})` : ''}`);
  return { leaveTypes, claimTypes, templates: templates.map((t) => t.name) };
}

/** Which Sowaka settings the text would need, as plain suggestions naming the other agents' actions. */
export async function settingsNeeded(ctx: SuwiContext, text: string): Promise<{ setting: string; status: string; where: string }[]> {
  const t = text.toLowerCase();
  const out: { setting: string; status: string; where: string }[] = [];
  const have = await existingSettings(ctx);
  const named = new Set<string>();
  for (const m of t.matchAll(/\b([a-z]+(?: [a-z]+)?) leave\b/g)) {
    const name = m[1].replace(/^(a|an|the|of|on|for|any|paid|unpaid|days?|their|this|that|and|or|to|take|takes|apply|applies) /, '').trim();
    if (!name || ['a', 'an', 'the', 'of', 'on', 'for', 'any', 'days', 'day', 'their', 'this', 'and', 'or', 'to', 'take', 'apply', 'such', 'all', 'no', 'more', 'annual', 'approved', 'pending'].includes(name)) continue;
    named.add(`${name} leave`);
  }
  for (const n of named) {
    const hit = [...have.leaveTypes.keys()].find((k) => k.toLowerCase() === n || k.toLowerCase().startsWith(n.split(' ')[0]));
    out.push(hit
      ? { setting: `Leave type "${hit}"`, status: `Exists on ${have.leaveTypes.get(hit)!.join(', ')}; check its entitlement matches the policy.`, where: 'Shifts › Templates (an attendance action can change it)' }
      : { setting: `Leave type "${n.replace(/\b\w/g, (c) => c.toUpperCase())}"`, status: 'Not on any shift template yet; the app cannot take requests for it until it is.', where: 'Shifts › Templates › leave types (ask Suwi to prepare adding a leave type)' });
  }
  if (/\b(grace|late mark|half[- ]day|working hours|shift timing|punch|clock[- ]in|weekly off)\b/.test(t)) out.push({ setting: 'Shift rule (timings, grace, half day, weekly offs)', status: `Set per template: ${have.templates.join(', ') || 'none yet'}.`, where: 'Shifts › Templates (ask Suwi to prepare a shift rule change)' });
  if (/\b(reimburs|claim|expense|bill|receipt|allowance)/.test(t)) out.push({ setting: 'Reimbursement type with its cap', status: have.claimTypes.length ? `Existing types: ${have.claimTypes.join(', ')}.` : 'No reimbursement types yet.', where: 'Claims › Reimbursement Types (ask Suwi to prepare a reimbursement type)' });
  if (/\b(approv|manager|hr decides|sign[- ]off)/.test(t)) out.push({ setting: 'Approval rule (manager or HR decides)', status: 'Set per shift template for leave and corrections; reimbursements are always decided on the dashboard.', where: 'Shifts › Templates › approvals' });
  if (/\b(holiday)/.test(t)) out.push({ setting: 'Holidays', status: 'The policy names holidays; the dates themselves live in the Holiday Bank.', where: 'Shifts › Holiday Bank' });
  return out;
}

/** Existing documents that talk about the same things, with the lines that carry numbers (where contradictions hide). */
async function overlaps(ctx: SuwiContext, key: string, title: string, body: string) {
  const mine = words(`${title} ${body}`);
  const docs = await policiesFor({ userId: ctx.userId, org: ctx.org });
  return docs.flatMap((d) => {
    const theirs = words(`${d.title} ${d.body}`);
    const shared = [...mine].filter((w) => theirs.has(w));
    if (d.key !== key && shared.length < 4) return [];
    const numbered = d.body.split('\n').filter((l) => /\d/.test(l) && [...words(l)].some((w) => mine.has(w))).map((l) => l.trim()).slice(0, 6);
    return [{ key: d.key, title: d.title, sameKey: d.key === key, sharedTopics: shared.slice(0, 8), linesWithNumbers: numbered }];
  });
}

defineTools(
  {
    name: 'draft_policy',
    area: 'people',
    label: (i) => `Drafted "${str(i.title, 60) || 'a policy'}"`,
    description: 'Lay out a policy document from sections you write in plain words (purpose, who it covers, rules, how to request, exceptions, from when). Returns the document as the app will show it, the company\'s existing policies that overlap it (check these for contradictions and tell HR), and the Sowaka settings it would need. Show HR the draft; when they are happy, use prepare_publish_policy.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' }, summary: { type: 'string', description: 'One line under the title' },
        purpose: { type: 'string' }, covers: { type: 'string', description: 'Who it applies to' },
        rules: { type: 'array', items: { type: 'string' } }, howToRequest: { type: 'array', items: { type: 'string' } },
        exceptions: { type: 'array', items: { type: 'string' } }, fromWhen: { type: 'string', description: 'e.g. "1 November 2026"' },
      },
      required: ['title', 'purpose', 'covers', 'rules'],
    },
    api: { method: 'GET', path: '/admin/employees' },
    async run(ctx, i) {
      const title = cleanPolicyTitle(str(i.title, 80));
      const key = slug(title);
      const body = cleanPolicyBody(layoutPolicy(i));
      const summary = cleanPolicySummary(str(i.summary, 200));
      const [existing, settings] = await Promise.all([overlaps(ctx, key, title, body), settingsNeeded(ctx, `${title}\n${body}`)]);
      return {
        data: { draft: { key, title, summary, body }, existingPolicies: existing, settingsNeeded: settings, note: 'Compare the draft with existingPolicies for contradictions (different numbers for the same thing) and say so plainly. The settings are suggestions: name them, do not change them here.' },
        links: [],
      };
    },
  },
  {
    name: 'prepare_publish_policy',
    area: 'people',
    acts: true,
    label: (i) => `Prepared: publish "${str(i.title, 60)}"`,
    description: 'Prepare publishing a policy document so employees see it in the app under Actions › View Policies. Changes nothing until HR confirms; Undo takes it down (or restores the earlier version). Pass the exact text from draft_policy, edited as HR asked.',
    input_schema: { type: 'object', properties: { key: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, body: { type: 'string' }, order: { type: 'number' } }, required: ['title', 'body'] },
    api: { method: 'POST', path: '/admin/company/settings' },
    async run(ctx, i) {
      const title = cleanPolicyTitle(str(i.title, 80));
      const key = str(i.key, 64) || slug(title);
      if (!POLICY_KEY_PATTERN.test(key)) throw new Error('The key must be lowercase letters, digits and dashes');
      const body = cleanPolicyBody(str(i.body, 70_000));
      const summary = cleanPolicySummary(str(i.summary, 200));
      const company = await companies().findOne({ id: ctx.org }, { projection: { _id: 0, name: 1 } });
      const existing = await policyDocuments().findOne({ org: ctx.org, key });
      const count = await policyDocuments().countDocuments({ org: ctx.org });
      const order = num(i.order, existing?.order ?? (count + 1) * 10, 0, 9999);
      const headings = (body.match(/^## .*$/gm) ?? []).map((h) => h.slice(3)).join(', ');
      const proposalId = await propose(ctx, {
        kind: 'publish_policy', area: 'people', title: `Publish "${title}"`,
        summary: `${existing ? `Replaces the current "${existing.title}"` : 'A new policy'} in the app for everyone at ${company?.name ?? ctx.org}. Sections: ${headings || 'none'}.`,
        lines: [
          { text: 'Employees see it under Actions › View Policies in the app the next time they open it.', why: 'Policy documents are read live from the server; no app release or deploy is needed.' },
          ...(count === 0 ? [{ text: 'This is the company\'s first document, so it replaces the policies the app wrote for itself from your shift rules.', why: 'A company with no documents gets automatic leave, attendance, overtime and claims policies. From the first published document on, the app lists only your documents.', tone: 'warn' as const }] : []),
          ...(existing ? [{ text: `The earlier "${existing.title}" (last changed ${existing.updatedAt.toISOString().slice(0, 10)}) is replaced; Undo brings it back.` }] : [{ text: 'Undo removes the document again.' }]),
          { text: 'The settings the policy relies on (leave types, shift rules, claim types, approvals) are not changed by this.', tone: 'info' },
        ],
        undoable: true,
        payload: { key, title, summary, body, order, byUserId: ctx.userId, byName: ctx.user.name, before: existing ? { title: existing.title, summary: existing.summary ?? '', body: existing.body, order: existing.order, active: existing.active, createdAt: existing.createdAt, updatedBy: existing.updatedBy } : null },
      });
      return { data: { prepared: true, key, title, replaces: existing?.title ?? null, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId };
    },
  },
);

type Before = Pick<PolicyDocument, 'title' | 'summary' | 'body' | 'order' | 'active' | 'createdAt' | 'updatedBy'> | null;

defineExecutor('publish_policy', {
  async run(p) {
    const { key, title, summary, body, order, byName, before } = p.payload as { key: string; title: string; summary: string; body: string; order: number; byName: string; before: Before };
    const now = new Date();
    // The same write scripts/policies.ts makes, as "via Suwi" by this HR person.
    await policyDocuments().updateOne(
      { org: p.org, key },
      { $set: { title, summary, body, order, active: true, updatedAt: now, updatedBy: `${byName} via Suwi` }, $setOnInsert: { org: p.org, key, createdAt: now } },
      { upsert: true },
    );
    return { message: `"${title}" is live in the app${before ? ` (replaced "${before.title}")` : ''}.`, undo: { hadBefore: Boolean(before) } };
  },
  async undo(p) {
    const { key, before } = p.payload as { key: string; before: Before };
    if (before) {
      await policyDocuments().updateOne({ org: p.org, key }, { $set: { ...before, createdAt: new Date(before.createdAt), updatedAt: new Date() } });
      return `"${before.title}" is back as it was.`;
    }
    await policyDocuments().deleteOne({ org: p.org, key });
    return 'The document is taken down from the app.';
  },
});
