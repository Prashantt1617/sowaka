// Company setup from Suwi: the Organisation profile (names, address, contact and sender emails; Setup ›
// Organisation profile) and the company's tax details (PAN, TAN, TDS circle, AO code, deductor; Payroll ›
// Tax details). Reads and changes go through the services those pages save with
// (company-settings.service updateOrganisationProfile, orgSetup.service updateOrgSetup), as the HR person.
// Each change is a card listing every field's old and new value; Undo puts the old values back.
import { tabsForRequest } from '../../models/dashboard-tabs';
import { hasAllDashboardTabs } from '../../middleware/admin.middleware';
import { getOrganisationProfile, updateOrganisationProfile } from '../../services/company-settings.service';
import { getOrgSetup, updateOrgSetup } from '../../services/orgSetup.service';
import type { StatutoryRegistration } from '../../models/company.model';
import { defineTools, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { isDate, niceDate } from './team';

const PROFILE: Record<string, string> = {
  registeredName: 'Registered name', displayName: 'Display name', country: 'Country', industry: 'Industry', incorporatedOn: 'Date of incorporation',
  addressLine1: 'Address line 1', addressLine2: 'Address line 2', city: 'City', state: 'State', pincode: 'PIN code', addressCountry: 'Address country',
  primaryContactEmail: 'Primary contact email', senderName: 'Sender name', senderEmail: 'Sender email', replyToEmail: 'Reply-to email',
};
const EMAILS = new Set(['primaryContactEmail', 'senderEmail', 'replyToEmail']);
const TAX: Record<string, string> = {
  pan: 'Company PAN', tan: 'TAN', tdsCircle: 'TDS circle / ward', aoCode: 'AO code', taxPaymentFrequency: 'TDS payment frequency',
  deductorType: 'Deductor type', deductorName: 'Deductor name', deductorDesignation: 'Deductor designation',
};
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
const shown = (v: string) => v || '(empty)';

function mayRead(ctx: SuwiContext, path: string) {
  if (hasAllDashboardTabs(ctx.user)) return true;
  const need = tabsForRequest('GET', path);
  return need === null || need.some((t) => (ctx.user.dashboardTabs ?? []).includes(t));
}

/** Tax details flat, as HR names them. */
function taxFlat(r: StatutoryRegistration): Record<string, string> {
  return {
    pan: r.pan ?? '', tan: r.tan ?? '', tdsCircle: r.tdsCircle ?? '', aoCode: r.aoCode ?? '', taxPaymentFrequency: r.taxPaymentFrequency ?? '',
    deductorType: r.deductor?.type ?? '', deductorName: r.deductor?.name ?? '', deductorDesignation: r.deductor?.designation ?? '',
  };
}
/** Back to the shape updateOrgSetup takes (it replaces the whole registration). */
function taxBody(f: Record<string, string>): Record<string, unknown> {
  const deductor = { type: f.deductorType || undefined, name: f.deductorName || undefined, designation: f.deductorDesignation || undefined };
  return {
    pan: f.pan || undefined, tan: f.tan || undefined, tdsCircle: f.tdsCircle || undefined, aoCode: f.aoCode || undefined,
    taxPaymentFrequency: f.taxPaymentFrequency || undefined, ...(Object.values(deductor).some(Boolean) ? { deductor } : {}),
  };
}

/** The changes asked for, checked like the page checks them, as [field, old, new]. */
function changesOf(input: unknown, now: Record<string, string>, labels: Record<string, string>, check: (k: string, v: string) => string): [string, string, string][] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Give changes as { field: new value } (an empty string clears a field)');
  const out: [string, string, string][] = [];
  for (const [k, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!(k in labels)) throw new Error(`Unknown field "${k}". Fields: ${Object.keys(labels).join(', ')}`);
    const v = check(k, str(raw, 254));
    if (v !== (now[k] ?? '')) out.push([k, now[k] ?? '', v]);
  }
  return out;
}

defineTools(
  {
    name: 'company_details',
    area: 'settings',
    label: () => 'The company\'s details',
    description: 'The company\'s own details: Organisation profile (registered and display name, industry, date of incorporation, registered address, primary contact email, the sender name/email and reply-to email that Sowaka\'s emails go out with) and, for people who can open Payroll › Tax details, the tax details (company PAN, TAN, TDS circle/ward, AO code, TDS payment frequency, deductor). Use for "what is our TAN?", "which email do our mails go from?". To change any of them use prepare_company_details_change or prepare_tax_details_change.',
    input_schema: { type: 'object', properties: {} },
    api: { method: 'GET', path: '/admin/company/profile' },
    async run(ctx) {
      const p = await getOrganisationProfile(ctx.userId) as unknown as Record<string, string>;
      const profile = Object.fromEntries(Object.keys(PROFILE).map((k) => [PROFILE[k], p[k] || null]));
      const tax = mayRead(ctx, '/admin/payroll/org-setup') ? Object.fromEntries(Object.entries(taxFlat((await getOrgSetup(ctx.userId)).statutoryRegistration)).map(([k, v]) => [TAX[k], v || null])) : undefined;
      return {
        data: { companyName: p.companyName, profile, ...(tax ? { taxDetails: tax } : { taxDetails: 'Not shown: needs the Tax details tab' }), note: 'null means the field is empty on the page.' },
        links: [{ label: 'Open Organisation profile', view: 'organisation' }, ...(tax ? [{ label: 'Open Tax details', view: 'taxdetails' }] : [])],
      };
    },
  },
  {
    name: 'prepare_company_details_change',
    area: 'settings',
    acts: true,
    label: () => 'Prepared: change the Organisation profile',
    description: `Prepare changing the company's Organisation profile, e.g. "our sender email is hr@acme.in", "update the registered address". changes is { field: new value } with fields ${Object.entries(PROFILE).map(([k, l]) => `${k} (${l})`).join(', ')}; an empty string clears a field; incorporatedOn is YYYY-MM-DD. Not for PAN, TAN, TDS circle or AO code (prepare_tax_details_change). Changes nothing until HR confirms; Undo restores the old values.`,
    input_schema: { type: 'object', properties: { changes: { type: 'object', description: '{ field: new value }' } }, required: ['changes'] },
    api: { method: 'PUT', path: '/admin/company/profile' },
    async run(ctx, i) {
      const p = await getOrganisationProfile(ctx.userId) as unknown as Record<string, string>;
      const changes = changesOf(i.changes, p, PROFILE, (k, v) => {
        if (EMAILS.has(k)) { v = v.toLowerCase(); if (v && !/^\S+@\S+\.\S+$/.test(v)) throw new Error(`${PROFILE[k]}: "${v}" is not a valid email`); }
        if (k === 'incorporatedOn' && v && !isDate(v)) throw new Error('incorporatedOn must be YYYY-MM-DD');
        return v.slice(0, 200);
      });
      if (!changes.length) return { data: { nothingToDo: true, note: 'The profile already says that.' } };
      const title = changes.length === 1 ? `Change the ${PROFILE[changes[0][0]].toLowerCase()}` : `Change ${changes.length} Organisation profile details`;
      const fmt = (k: string, v: string) => (k === 'incorporatedOn' && v ? niceDate(v) : shown(v));
      const proposalId = await propose(ctx, {
        kind: 'company_profile', area: 'settings', title,
        summary: changes.map(([k, a, b]) => `${PROFILE[k]}: ${fmt(k, a)} → ${fmt(k, b)}`).join('; '),
        lines: [
          ...changes.map(([k, a, b]) => ({ text: `${PROFILE[k]}: ${fmt(k, a)} → ${fmt(k, b)}.` })),
          ...(changes.some(([k]) => k === 'senderEmail' || k === 'senderName' || k === 'replyToEmail') ? [{ text: 'Emails Sowaka sends for the company (offer letters, payslips, notifications) use the new sender details from now; the sender address must be one your mail set-up allows, or those emails may not arrive.', tone: 'warn' as const }] : []),
          { text: 'Undo puts the old values back.', tone: 'info' },
        ],
        effectiveFrom: ctx.today, undoable: true,
        payload: { byUserId: ctx.userId, set: Object.fromEntries(changes.map(([k, , b]) => [k, b])), before: Object.fromEntries(changes.map(([k, a]) => [k, a])) },
      });
      return { data: { prepared: true, title, changes: changes.map(([k, a, b]) => ({ field: PROFILE[k], from: a || null, to: b || null })), note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open Organisation profile', view: 'organisation' }] };
    },
  },
  {
    name: 'prepare_tax_details_change',
    area: 'payroll',
    acts: true,
    label: () => 'Prepared: change the company\'s tax details',
    description: `Prepare changing the company's tax details (Payroll › Tax details), e.g. "Add our TDS circle as Ward 72(1) Delhi". changes is { field: new value } with fields ${Object.entries(TAX).map(([k, l]) => `${k} (${l})`).join(', ')}; PAN like ABCDE1234F, TAN like ABCD12345E, taxPaymentFrequency monthly or quarterly; an empty string clears a field. Fields not named stay as they are. Changes nothing until HR confirms; Undo restores the old values.`,
    input_schema: { type: 'object', properties: { changes: { type: 'object', description: '{ field: new value }' } }, required: ['changes'] },
    api: { method: 'PUT', path: '/admin/payroll/org-setup' },
    async run(ctx, i) {
      const now = taxFlat((await getOrgSetup(ctx.userId)).statutoryRegistration);
      const changes = changesOf(i.changes, now, TAX, (k, v) => {
        if (k === 'pan' || k === 'tan') { v = v.replace(/\s/g, '').toUpperCase(); if (v && !(k === 'pan' ? PAN_RE : TAN_RE).test(v)) throw new Error(k === 'pan' ? 'PAN must look like ABCDE1234F' : 'TAN must look like ABCD12345E'); }
        if (k === 'taxPaymentFrequency') { v = v.toLowerCase(); if (v && v !== 'monthly' && v !== 'quarterly') throw new Error('taxPaymentFrequency is monthly or quarterly'); }
        if (v.length > 120) throw new Error(`${TAX[k]} is too long`);
        return v;
      });
      if (!changes.length) return { data: { nothingToDo: true, note: 'The tax details already say that.' } };
      const title = changes.length === 1 ? `${changes[0][1] ? 'Change' : 'Add'} the ${TAX[changes[0][0]]}` : `Change ${changes.length} tax details`;
      const proposalId = await propose(ctx, {
        kind: 'tax_details', area: 'payroll', title,
        summary: changes.map(([k, a, b]) => `${TAX[k]}: ${shown(a)} → ${shown(b)}`).join('; '),
        lines: [
          ...changes.map(([k, a, b]) => ({ text: `${TAX[k]}: ${shown(a)} → ${shown(b)}.` })),
          { text: 'Used on Form 16, Form 24Q and TDS challans from now; documents already issued are not changed.', tone: 'info' },
          { text: 'Undo puts the old values back.', tone: 'info' },
        ],
        effectiveFrom: ctx.today, undoable: true,
        payload: { byUserId: ctx.userId, set: Object.fromEntries(changes.map(([k, , b]) => [k, b])), before: Object.fromEntries(changes.map(([k, a]) => [k, a])) },
      });
      return { data: { prepared: true, title, changes: changes.map(([k, a, b]) => ({ field: TAX[k], from: a || null, to: b || null })), note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open Tax details', view: 'taxdetails' }] };
    },
  },
);

defineExecutor('company_profile', {
  async run(p) {
    const { byUserId, set } = p.payload as { byUserId: string; set: Record<string, string> };
    await updateOrganisationProfile(byUserId, set);
    return { message: `Organisation profile saved: ${Object.keys(set).map((k) => PROFILE[k]).join(', ')}.` };
  },
  async undo(p) {
    const { byUserId, before } = p.payload as { byUserId: string; before: Record<string, string> };
    await updateOrganisationProfile(byUserId, before);
    return `Organisation profile put back: ${Object.keys(before).map((k) => PROFILE[k]).join(', ')}.`;
  },
});

/** Only the fields this card changes, onto what the page holds at that moment (it saves the whole registration). */
async function saveTax(byUserId: string, fields: Record<string, string>) {
  const cur = taxFlat((await getOrgSetup(byUserId)).statutoryRegistration);
  await updateOrgSetup(byUserId, { statutoryRegistration: taxBody({ ...cur, ...fields }) });
}

defineExecutor('tax_details', {
  async run(p) {
    const { byUserId, set } = p.payload as { byUserId: string; set: Record<string, string> };
    await saveTax(byUserId, set);
    return { message: `Tax details saved: ${Object.keys(set).map((k) => TAX[k]).join(', ')}.` };
  },
  async undo(p) {
    const { byUserId, before } = p.payload as { byUserId: string; before: Record<string, string> };
    await saveTax(byUserId, before);
    return `Tax details put back: ${Object.keys(before).map((k) => TAX[k]).join(', ')}.`;
  },
});
