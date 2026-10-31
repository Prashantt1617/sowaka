/**
 * The investment declaration and its proofs (app › Payroll › Investment
 * declaration / Investment proofs), and HR's review of the proofs.
 *
 * The declaration lives in `tax_declarations` (one row per person per FY),
 * the same row the TDS engine and HR's tax-declaration page read: the app
 * stores the items in `items` and keeps `declarations` (the section totals
 * the engine reads) in step with them. Proofs live in `investment_proofs`,
 * one per declared item.
 */
import { ObjectId } from 'mongodb';
import { investmentProofs, salaryStructures, taxDeclarations, users } from '../config/db';
import { InvestmentProof, InvestmentProofStatus } from '../models/employeePayroll.model';
import { TaxDeclarationRow } from '../models/tds.model';
import {
  DECLARATION_ITEM_KEYS, DECLARATION_ITEMS, DeclarationFlags, DeclarationItemKey, DeclarationItems, declarationSections,
  toTaxDeclarations,
} from '../shared/payroll/declaration';
import { TaxDeclarations, TaxRegime } from '../shared/payroll/tds';
import {
  EmployeePayrollError, NOT_CONFIGURED, dayOf, deadlinesOf, declarationDueOn, meOf, parseFyParam, payrollViewerOrg, proofsDueOn,
} from './employeePayroll.common';
import { deleteReimbursementReceipt, hasReceiptStorage, presignReceiptDownload, uploadInvestmentProof } from './s3-receipt.service';
import { computeStructureFor } from './salaryStructure.service';
import { statutorySettingsFor } from './statutorySettings.service';
import { tdsConfigsFor } from './tds.service';

const MAX_AMOUNT_PAISE = 100_000_000_00; // ₹10 crore: past anything a declaration holds
const ITEM_BY_KEY = new Map(DECLARATION_ITEMS.map((d) => [d.key, d]));

// —— proof storage (S3), swappable so the checks never reach the bucket ——

export interface ProofStorage {
  available(): boolean;
  upload(org: string, userId: string, file: { originalName: string; contentType: string; size: number; bytes: Buffer }): Promise<{ objectKey: string }>;
  remove(objectKey: string): Promise<void>;
  url(objectKey: string, fileName: string): Promise<string>;
}

const s3Storage: ProofStorage = {
  available: hasReceiptStorage,
  upload: (org, userId, file) => uploadInvestmentProof(org, userId, file),
  remove: deleteReimbursementReceipt,
  url: presignReceiptDownload,
};
let storage: ProofStorage = s3Storage;
export function setProofStorageForTests(next: ProofStorage | null) {
  storage = next ?? s3Storage;
}

// —— the declaration ——

/** The items as the app stores them; an HR-entered row (section totals only) read back as items. */
function itemsOf(row: TaxDeclarationRow | null): DeclarationItems {
  if (!row) return {};
  if (row.items) return row.items;
  const d = row.declarations ?? {};
  const out: DeclarationItems = {};
  if (d.sec80C) out.other80C = d.sec80C;
  if (d.sec80CCD1B) out.nps = d.sec80CCD1B;
  if (d.sec80DSelf) out.healthSelf = d.sec80DSelf;
  if (d.sec80DParents) out.healthParents = d.sec80DParents;
  if (d.rentPaidPaise) out.rentMonthly = Math.round(d.rentPaidPaise / 12);
  if (d.homeLoanInterest) out.homeLoanInterest = d.homeLoanInterest;
  return out;
}

const flagsOf = (row: TaxDeclarationRow | null): DeclarationFlags => ({
  metro: Boolean(row?.declarations?.metro),
  selfSenior: Boolean(row?.declarations?.selfSenior),
  parentsSenior: Boolean(row?.declarations?.parentsSenior),
});

/** The year's employee PF from the person's structure (a normal month × 12), for 80C. */
async function epfYearOf(org: string, userId: string): Promise<number> {
  const structure = await salaryStructures().findOne({ org, userId });
  if (!structure?.salaryTemplateCode) return 0;
  try {
    const { computed } = await computeStructureFor(org, userId, structure);
    return computed.statutory.epf.employeePaise * 12;
  } catch {
    return 0; // a template that no longer resolves: no PF shown, the rest still works
  }
}

/**
 * The FY's tax rules, from `tds_configs` only: the old regime's caps are
 * read there and nowhere else. A FY with no old-regime row has no rules set
 * up, and the declaration says so rather than guess the figures.
 */
async function taxRulesFor(fy: string) {
  const configs = await tdsConfigsFor(fy);
  const old = configs.get('old');
  if (!old?.limits) {
    throw new EmployeePayrollError(409, `The income tax rules for FY ${fy} are not set up yet. Ask HR.`, { reason: 'tax_rules_not_set_up', fy });
  }
  return { configs, limits: old.limits };
}

async function declarationView(org: string, userId: string, fy: string, now: Date) {
  const [row, { configs, limits }, settings, deadlines, epfYear] = await Promise.all([
    taxDeclarations().findOne({ org, userId, fy }, { projection: { _id: 0 } }),
    taxRulesFor(fy),
    statutorySettingsFor(org),
    deadlinesOf(org),
    epfYearOf(org, userId),
  ]);
  const regime: TaxRegime = row?.regime ?? settings.tds?.defaultRegime ?? 'new';
  const flags = flagsOf(row);
  const dueOn = declarationDueOn(fy, deadlines);
  return {
    fy,
    regime,
    chosen: Boolean(row),
    status: (row ? row.status ?? 'saved' : 'not_started') as 'not_started' | 'saved' | 'submitted',
    // HR has not set the declaration due date: shown, not open to change (dueOn null).
    notConfigured: dueOn === null,
    missing: dueOn === null ? ['declarationDue'] : [],
    locked: dueOn !== null && dayOf(now) > dueOn,
    dueOn,
    proofsDueOn: proofsDueOn(fy, deadlines),
    submittedAt: row?.submittedAt ? row.submittedAt.toISOString() : null,
    metro: Boolean(flags.metro),
    selfSenior: Boolean(flags.selfSenior),
    parentsSenior: Boolean(flags.parentsSenior),
    sections: declarationSections({
      regime,
      items: itemsOf(row),
      flags,
      limits,
      epfYearPaise: epfYear,
    }),
    regimes: [...configs.values()].map((c) => ({ regime: c.regime, configStatus: c.status })),
  };
}

export async function myDeclaration(userId: string, fyRaw: unknown, now = new Date()) {
  const { org } = await meOf(userId);
  return declarationView(org, userId, parseFyParam(fyRaw, now), now);
}

export async function saveMyDeclaration(userId: string, fyRaw: unknown, body: Record<string, unknown>, now = new Date()) {
  const { org } = await meOf(userId);
  const fy = parseFyParam(fyRaw, now);
  const [deadlines] = await Promise.all([deadlinesOf(org), taxRulesFor(fy)]);
  const dueOn = declarationDueOn(fy, deadlines);
  if (dueOn === null) throw NOT_CONFIGURED(['declarationDue'], 'HR has not set the declaration due date yet');
  if (dayOf(now) > dueOn) throw new EmployeePayrollError(409, `Declarations for FY ${fy} closed on ${dueOn}. Ask HR to change it.`);
  const regime = body.regime === 'old' || body.regime === 'new' ? body.regime : undefined;
  if (!regime) throw new EmployeePayrollError(400, 'Choose the new or the old regime');

  const row = await taxDeclarations().findOne({ org, userId, fy });
  const items: DeclarationItems = { ...itemsOf(row) };
  const raw = body.items ?? {};
  if (typeof raw !== 'object' || Array.isArray(raw) || raw === null) throw new EmployeePayrollError(400, 'items must be an object of item to paise');
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (key === 'epf') throw new EmployeePayrollError(400, 'Provident fund comes from payroll and cannot be declared');
    if (!DECLARATION_ITEM_KEYS.has(key)) throw new EmployeePayrollError(400, `${key} is not something you can declare`);
    const k = key as DeclarationItemKey;
    if (v === null || v === undefined || v === '' || v === 0) {
      delete items[k];
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > MAX_AMOUNT_PAISE) throw new EmployeePayrollError(400, `The amount for ${ITEM_BY_KEY.get(k)!.label} must be a whole, non-negative number of paise`);
    items[k] = n;
  }
  const previous = flagsOf(row);
  const flag = (name: keyof DeclarationFlags) => (body[name] === undefined ? previous[name] : Boolean(body[name]));
  const flags: DeclarationFlags = { metro: flag('metro'), selfSenior: flag('selfSenior'), parentsSenior: flag('parentsSenior') };
  const declarations: TaxDeclarations = toTaxDeclarations(items, flags, row?.declarations);
  const submit = body.submit === true;
  const status = submit || row?.status === 'submitted' ? 'submitted' : 'saved';

  await taxDeclarations().updateOne(
    { org, userId, fy },
    {
      $set: {
        org, userId, fy, regime, items, declarations, status,
        ...(submit ? { submittedAt: now } : {}),
        proofs: row?.proofs ?? 'none',
        updatedAt: now,
        updatedByUserId: userId,
      },
    },
    { upsert: true },
  );
  return declarationView(org, userId, fy, now);
}

// —— proofs ——

type StoredProof = InvestmentProof & { _id: ObjectId };

function proofView(p: StoredProof) {
  return {
    id: p._id.toHexString(),
    fileName: p.fileName,
    contentType: p.contentType,
    size: p.size,
    amountPaise: p.amountPaise,
    uploadedAt: p.uploadedAt.toISOString(),
    decidedAt: p.decidedAt ? p.decidedAt.toISOString() : null,
    reason: p.status === 'rejected' ? p.reason ?? null : null,
  };
}

/** The items a declaration needs proofs for: old regime, declared above zero. */
function provable(row: TaxDeclarationRow | null): { key: DeclarationItemKey; label: string; section: string; declaredPaise: number }[] {
  if (row?.regime !== 'old') return [];
  const items = itemsOf(row);
  return DECLARATION_ITEMS.filter((d) => (items[d.key] ?? 0) > 0).map((d) => ({ key: d.key, label: d.label, section: d.section, declaredPaise: items[d.key]! }));
}

async function proofsView(org: string, userId: string, fy: string, now: Date) {
  const [row, rows, deadlines, settings] = await Promise.all([
    taxDeclarations().findOne({ org, userId, fy }),
    investmentProofs().find({ org, userId, fy }).toArray() as Promise<StoredProof[]>,
    deadlinesOf(org),
    statutorySettingsFor(org),
  ]);
  const regime: TaxRegime = row?.regime ?? settings.tds?.defaultRegime ?? 'new';
  const byItem = new Map(rows.map((r) => [r.item, r]));
  const items = provable(row).map((d) => {
    const p = byItem.get(d.key);
    return { item: d.key, label: d.label, section: d.section, declaredPaise: d.declaredPaise, status: (p?.status ?? 'not_uploaded') as InvestmentProofStatus | 'not_uploaded', proof: p ? proofView(p) : null };
  });
  const count = (s: string) => items.filter((i) => i.status === s).length;
  const dueOn = proofsDueOn(fy, deadlines);
  return {
    fy,
    regime,
    required: items.length > 0,
    dueOn,
    // HR has not set the proofs due date: no uploads until they do (dueOn null).
    notConfigured: dueOn === null,
    missing: dueOn === null ? ['proofsDue'] : [],
    locked: dueOn !== null && dayOf(now) > dueOn,
    summary: {
      total: items.length,
      notUploaded: count('not_uploaded'),
      uploaded: count('uploaded'),
      approved: count('approved'),
      rejected: count('rejected'),
      allSent: items.length > 0 && count('not_uploaded') + count('rejected') === 0,
      allApproved: items.length > 0 && count('approved') === items.length,
    },
    items,
  };
}

export async function myProofs(userId: string, fyRaw: unknown, now = new Date()) {
  const { org } = await meOf(userId);
  return proofsView(org, userId, parseFyParam(fyRaw, now), now);
}

export async function uploadMyProof(
  userId: string,
  itemRaw: string,
  fyRaw: unknown,
  input: { amountPaise?: unknown; file?: { originalname: string; mimetype: string; size: number; buffer: Buffer } },
  now = new Date(),
) {
  const { org } = await meOf(userId);
  const fy = parseFyParam(fyRaw, now);
  if (itemRaw === 'epf') throw new EmployeePayrollError(400, 'Provident fund comes from payroll and needs no proof');
  if (!DECLARATION_ITEM_KEYS.has(itemRaw)) throw new EmployeePayrollError(400, `${itemRaw} is not something you can declare`);
  const item = itemRaw as DeclarationItemKey;
  const row = await taxDeclarations().findOne({ org, userId, fy });
  if (row?.regime !== 'old') throw new EmployeePayrollError(400, 'Not needed on the new regime');
  if (!provable(row).some((d) => d.key === item)) throw new EmployeePayrollError(400, `Declare an amount for ${ITEM_BY_KEY.get(item)!.label} first`);
  const dueOn = proofsDueOn(fy, await deadlinesOf(org));
  if (dueOn === null) throw NOT_CONFIGURED(['proofsDue'], 'HR has not set the proofs due date yet');
  if (dayOf(now) > dueOn) throw new EmployeePayrollError(409, `Proofs for FY ${fy} closed on ${dueOn}`);
  const existing = (await investmentProofs().findOne({ org, userId, fy, item })) as StoredProof | null;
  if (existing?.status === 'approved') throw new EmployeePayrollError(409, 'This proof is already approved');
  const amount = Number(input.amountPaise);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT_PAISE) throw new EmployeePayrollError(400, 'Enter the amount on the proof, in paise');
  const file = input.file;
  if (!file) throw new EmployeePayrollError(400, 'Attach the proof: a PDF, JPEG or PNG');
  if (!storage.available()) throw new EmployeePayrollError(503, 'File uploads are not set up on this server');

  const stored = await storage.upload(org, userId, { originalName: file.originalname, contentType: file.mimetype, size: file.size, bytes: file.buffer });
  const fileName = (file.originalname || 'proof').normalize('NFC').slice(-120);
  await investmentProofs().updateOne(
    { org, userId, fy, item },
    {
      $set: { org, userId, fy, item, status: 'uploaded', amountPaise: amount, objectKey: stored.objectKey, fileName, contentType: file.mimetype, size: file.size, uploadedAt: now },
      $unset: { decidedAt: '', decidedByUserId: '', reason: '' },
    },
    { upsert: true },
  );
  // The file it replaces is no longer anyone's: best effort, a failure leaves an orphan, not an error.
  if (existing?.objectKey && existing.objectKey !== stored.objectKey) await storage.remove(existing.objectKey).catch(() => undefined);
  await syncProofState(org, userId, fy);
  const view = await proofsView(org, userId, fy, now);
  return view.items.find((i) => i.item === item)!;
}

export async function myProofFile(userId: string, itemRaw: string, fyRaw: unknown, now = new Date()) {
  const { org } = await meOf(userId);
  const fy = parseFyParam(fyRaw, now);
  const p = await investmentProofs().findOne({ org, userId, fy, item: itemRaw as DeclarationItemKey });
  if (!p) throw new EmployeePayrollError(404, 'Nothing uploaded for this item');
  return storage.url(p.objectKey, p.fileName);
}

/** The declaration's proof state, for HR's tax pages: verified once every declared item's proof is approved. */
async function syncProofState(org: string, userId: string, fy: string) {
  const row = await taxDeclarations().findOne({ org, userId, fy });
  if (!row) return;
  const needed = provable(row).map((d) => d.key);
  const rows = await investmentProofs().find({ org, userId, fy }, { projection: { item: 1, status: 1 } }).toArray();
  const status = new Map(rows.map((r) => [r.item, r.status]));
  const proofs: TaxDeclarationRow['proofs'] =
    needed.length > 0 && needed.every((k) => status.get(k) === 'approved') ? 'verified'
      : needed.some((k) => status.get(k) === 'uploaded' || status.get(k) === 'approved') ? 'submitted'
        : 'none';
  if (proofs !== row.proofs) await taxDeclarations().updateOne({ org, userId, fy }, { $set: { proofs } });
}

// —— HR ——

const payrollViewer = (viewerUserId: string) => payrollViewerOrg(viewerUserId, 'review investment proofs');

async function hrViews(org: string, rows: StoredProof[]) {
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const [people, declarations] = await Promise.all([
    users().find({ org, userId: { $in: userIds } }, { projection: { _id: 0, userId: 1, name: 1, employeeId: 1 } }).toArray(),
    taxDeclarations().find({ org, userId: { $in: userIds } }, { projection: { _id: 0, userId: 1, fy: 1, items: 1, declarations: 1, regime: 1 } }).toArray(),
  ]);
  const person = new Map(people.map((p) => [p.userId, p]));
  const declared = new Map(declarations.map((d) => [`${d.userId}|${d.fy}`, itemsOf(d as TaxDeclarationRow)]));
  return rows.map((r) => {
    const def = ITEM_BY_KEY.get(r.item);
    return {
      id: r._id.toHexString(),
      userId: r.userId,
      employeeName: person.get(r.userId)?.name ?? null,
      employeeId: person.get(r.userId)?.employeeId ?? null,
      fy: r.fy,
      item: r.item,
      label: def?.label ?? r.item,
      section: def?.section ?? null,
      declaredPaise: declared.get(`${r.userId}|${r.fy}`)?.[r.item] ?? 0,
      amountPaise: r.amountPaise,
      status: r.status,
      fileName: r.fileName,
      contentType: r.contentType,
      size: r.size,
      uploadedAt: r.uploadedAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decidedByUserId: r.decidedByUserId ?? null,
      reason: r.reason ?? null,
    };
  });
}

export async function listProofsForHr(viewerUserId: string, query: { fy?: unknown; status?: unknown; userId?: unknown }, now = new Date()) {
  const org = await payrollViewer(viewerUserId);
  const fy = parseFyParam(query.fy, now);
  const filter: Record<string, unknown> = { org, fy };
  if (query.status !== undefined && query.status !== '') {
    if (!['uploaded', 'approved', 'rejected'].includes(String(query.status))) throw new EmployeePayrollError(400, 'status is uploaded, approved or rejected');
    filter.status = String(query.status);
  }
  if (query.userId) filter.userId = String(query.userId);
  const rows = (await investmentProofs().find(filter).sort({ uploadedAt: 1 }).limit(2000).toArray()) as StoredProof[];
  return { fy, proofs: await hrViews(org, rows) };
}

async function hrProof(org: string, proofId: string): Promise<StoredProof> {
  if (!ObjectId.isValid(proofId)) throw new EmployeePayrollError(404, 'Proof not found');
  const p = (await investmentProofs().findOne({ _id: new ObjectId(proofId), org })) as StoredProof | null;
  if (!p) throw new EmployeePayrollError(404, 'Proof not found');
  return p;
}

export async function proofFileForHr(viewerUserId: string, proofId: string) {
  const org = await payrollViewer(viewerUserId);
  const p = await hrProof(org, proofId);
  return storage.url(p.objectKey, p.fileName);
}

export async function decideProofForHr(viewerUserId: string, proofId: string, body: Record<string, unknown>, now = new Date()) {
  const org = await payrollViewer(viewerUserId);
  const decision = body.decision;
  if (decision !== 'approved' && decision !== 'rejected') throw new EmployeePayrollError(400, 'decision is approved or rejected');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (decision === 'rejected' && (reason.length < 3 || reason.length > 500)) throw new EmployeePayrollError(400, 'Say why the proof is rejected (3 to 500 characters)');
  const p = await hrProof(org, proofId);
  // Only what the employee sent last can be decided: a decided or replaced proof is not this one any more.
  const updated = (await investmentProofs().findOneAndUpdate(
    { _id: p._id, org, status: 'uploaded', objectKey: p.objectKey },
    {
      $set: { status: decision, decidedAt: now, decidedByUserId: viewerUserId, ...(decision === 'rejected' ? { reason } : {}) },
      ...(decision === 'approved' ? { $unset: { reason: '' } } : {}),
    },
    { returnDocument: 'after' },
  )) as StoredProof | null;
  if (!updated) throw new EmployeePayrollError(409, p.status === 'uploaded' ? 'The proof was replaced; open it again' : `This proof is already ${p.status}`);
  await syncProofState(org, p.userId, p.fy);
  return (await hrViews(org, [updated]))[0];
}
