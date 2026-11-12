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
import { decryptField, encryptField, fieldKeyConfigured, maskTail } from './fieldCrypto';
import { ObjectId } from 'mongodb';
import { investmentProofs, salaryStructures, taxDeclarations, users } from '../config/db';
import { InvestmentProof, InvestmentProofStatus } from '../models/employeePayroll.model';
import { TaxDeclarationRow } from '../models/tds.model';
import {
  DECLARATION_ITEM_KEYS, DECLARATION_ITEMS, DeclarationFlags, DeclarationItemKey, DeclarationItems, DeclarationSectionKey, declarationSections,
  toTaxDeclarations,
} from '../shared/payroll/declaration';
import { TaxDeclarations, TaxRegime } from '../shared/payroll/tds';
import {
  EmployeePayrollError, NOT_CONFIGURED, askHr, dayLabel, dayOf, deadlinesOf, declarationDueOn, meOf, parseFyParam, payrollViewerOrg, proofsDueOn,
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
  if (!old?.limits || !configs.has('new')) {
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
  const locked = dueOn !== null && dayOf(now) > dueOn;
  const sections = declarationSections({
    regime,
    items: itemsOf(row),
    flags,
    limits,
    epfYearPaise: epfYear,
  });
  // What the person declared themselves (payroll's PF is not theirs to declare).
  const declaredItems = sections.flatMap((s) => s.items).filter((i) => !i.readOnly && i.amountPaise > 0);
  return {
    fy,
    regime,
    chosen: Boolean(row),
    status: (row ? row.status ?? 'saved' : 'not_started') as 'not_started' | 'saved' | 'submitted',
    // HR has not set the declaration due date: shown, not open to change (dueOn null).
    notConfigured: dueOn === null,
    missing: dueOn === null ? ['declarationDue'] : [],
    locked,
    dueOn,
    proofsDueOn: proofsDueOn(fy, deadlines),
    submittedAt: row?.submittedAt ? row.submittedAt.toISOString() : null,
    // Past the due date: when it closed, what was declared, and where the rest can
    // still go (HR can reopen it; the tax return takes what was missed).
    closed: locked
      ? {
        closedOn: dueOn,
        itemsDeclared: declaredItems.length,
        declaredPaise: sections.reduce((t, s) => t + s.declaredPaise, 0) - sections[0].items.filter((i) => i.readOnly).reduce((t, i) => t + i.amountPaise, 0),
        countedPaise: regime === 'old' ? sections.reduce((t, s) => t + s.countedPaise, 0) : 0,
        lastPayPeriod: fyLastPeriod(fy),
        itrDueOn: itrDueOn(fy),
      }
      : null,
    metro: Boolean(flags.metro),
    selfSenior: Boolean(flags.selfSenior),
    parentsSenior: Boolean(flags.parentsSenior),
    sections,
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
  if (dueOn === null) throw NOT_CONFIGURED(['declarationDue'], askHr('HR has not set the declaration due date yet, so declarations can\'t be saved'));
  if (dayOf(now) > dueOn) {
    throw new EmployeePayrollError(409, `Declarations for FY ${fy} closed on ${dayLabel(dueOn)}, so your declaration can't be changed now. To change it, ask HR.`, { reason: 'declaration_closed', dueOn });
  }
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
  // New items (or a new regime) may have no proof yet: the proof state follows the items, not the last upload.
  await syncProofState(org, userId, fy);
  return declarationView(org, userId, fy, now);
}

// —— proofs ——

type StoredProof = InvestmentProof & { _id: ObjectId };


/** A stored landlord PAN as text: decrypted when the key is here, else masked from its last four. */
function readPan(stored: string, last4: string | undefined): string {
  try {
    return decryptField(stored);
  } catch {
    return maskTail(last4 ?? stored.slice(-4)) ?? '';
  }
}

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
    // Their own proof: the full PAN they typed.
    landlordPan: p.landlordPan ? readPan(p.landlordPan, p.landlordPanLast4) : null,
  };
}

/** The items a declaration needs proofs for: old regime, declared above zero. */
function provable(row: TaxDeclarationRow | null): { key: DeclarationItemKey; label: string; section: DeclarationSectionKey; declaredPaise: number }[] {
  if (row?.regime !== 'old') return [];
  const items = itemsOf(row);
  return DECLARATION_ITEMS.filter((d) => (items[d.key] ?? 0) > 0).map((d) => ({ key: d.key, label: d.label, section: d.section, declaredPaise: items[d.key]! }));
}

/**
 * How the proofs page names things. The declaration's labels are prompts
 * for an input ("Rent a month"); a proof row names what is proved, and its
 * amount line says the rest.
 */
const PROOF_SECTION_LABELS: Record<DeclarationSectionKey, string> = {
  '80C': '80C',
  '80CCD1B': 'NPS (80CCD 1B)',
  '80D': '80D',
  HRA: 'Rent (HRA)',
  '24B': 'Home loan',
};
/** The closed state's "What counted" table names items short. */
const COUNTED_LABELS: Record<DeclarationItemKey, string> = {
  ppf: 'PPF',
  elss: 'ELSS',
  lifeInsurance: 'Life insurance',
  other80C: 'Other 80C',
  nps: 'NPS',
  healthSelf: 'Health insurance',
  healthParents: 'Health insurance, parents',
  rentMonthly: 'Rent (HRA)',
  homeLoanInterest: 'Home loan interest',
};
const PROOF_LABELS: Partial<Record<DeclarationItemKey, string>> = {
  nps: 'NPS · your own contribution',
  healthSelf: 'Health insurance · self and family',
  healthParents: 'Health insurance · parents',
  rentMonthly: 'Rent',
};
/** What to upload for each item: the document HR checks it against. */
const PROOF_DOCUMENTS: Record<DeclarationItemKey, string> = {
  ppf: 'PPF passbook or statement',
  elss: 'ELSS statement from the fund',
  lifeInsurance: 'Premium receipt from the insurer',
  other80C: 'Receipt or certificate for the payment',
  nps: 'NPS contribution statement',
  healthSelf: 'Premium receipt from the insurer',
  healthParents: 'Premium receipt from the insurer',
  rentMonthly: 'Rent receipts or the rent agreement',
  homeLoanInterest: 'Interest certificate from the bank',
};

/**
 * The FY's income tax return due date for a salaried person: 31 July after
 * the FY ends (Income-tax Act s.139(1)). It is the law's date, the same for
 * every company, so it is derived from the FY rather than set by HR.
 */
export const itrDueOn = (fy: string) => `${Number(fy.slice(0, 4)) + 1}-07-31`;
/** The FY's last pay month ("2027-03"): the last payroll a late proof can still reach. */
const fyLastPeriod = (fy: string) => `${Number(fy.slice(0, 4)) + 1}-03`;

async function proofsView(org: string, userId: string, fy: string, now: Date) {
  const [row, rows, deadlines, settings] = await Promise.all([
    taxDeclarations().findOne({ org, userId, fy }),
    investmentProofs().find({ org, userId, fy }).toArray() as Promise<StoredProof[]>,
    deadlinesOf(org),
    statutorySettingsFor(org),
  ]);
  const regime: TaxRegime = row?.regime ?? settings.tds?.defaultRegime ?? 'new';
  const byItem = new Map(rows.map((r) => [r.item, r]));
  const startYear = Number(fy.slice(0, 4));
  const items = provable(row).map((d) => {
    const p = byItem.get(d.key);
    const monthly = d.key === 'rentMonthly';
    return {
      item: d.key,
      label: PROOF_LABELS[d.key] ?? d.label,
      section: d.section,
      declaredPaise: d.declaredPaise,
      // Rent is declared a month at a time for the whole FY: "₹15,000 a month · Apr to Mar".
      perMonth: monthly,
      months: monthly ? { from: `${startYear}-04`, to: `${startYear + 1}-03` } : null,
      // The FY's amount: what a proof's "amount on proof" is set against (rent: twelve months).
      yearPaise: monthly ? d.declaredPaise * 12 : d.declaredPaise,
      document: PROOF_DOCUMENTS[d.key],
      status: (p?.status ?? 'not_uploaded') as InvestmentProofStatus | 'not_uploaded',
      proof: p ? proofView(p) : null,
    };
  });
  const count = (s: string) => items.filter((i) => i.status === s).length;
  const dueOn = proofsDueOn(fy, deadlines);
  const locked = dueOn !== null && dayOf(now) > dueOn;
  // Sent and standing (in review or approved), against never sent or sent back.
  const submitted = count('uploaded') + count('approved');
  const sections = (Object.keys(PROOF_SECTION_LABELS) as DeclarationSectionKey[])
    .map((key) => ({ key, label: PROOF_SECTION_LABELS[key], items: items.filter((i) => i.section === key) }))
    .filter((s) => s.items.length > 0);
  // "What counted" once closed: a sent proof counts up to the amount on it, capped at
  // the FY's declared amount; an item never sent (or sent back) counts nothing.
  const countedRows = items.map((i) => {
    const sent = i.status === 'uploaded' || i.status === 'approved';
    const provedPaise = sent ? Math.min(i.yearPaise, i.proof?.amountPaise ?? 0) : 0;
    return { item: i.item, label: COUNTED_LABELS[i.item], provedPaise, notProvedPaise: i.yearPaise - provedPaise };
  });
  const sum = (pick: (r: (typeof countedRows)[number]) => number) => countedRows.reduce((t, r) => t + pick(r), 0);
  return {
    fy,
    regime,
    required: items.length > 0,
    dueOn,
    // HR has not set the proofs due date: no uploads until they do (dueOn null).
    notConfigured: dueOn === null,
    missing: dueOn === null ? ['proofsDue'] : [],
    locked,
    // Past the due date: when it closed, what is left, and where the rest can still go.
    closed: locked
      ? {
        closedOn: dueOn,
        submitted,
        notSubmitted: items.length - submitted,
        total: items.length,
        lastPayPeriod: fyLastPeriod(fy),
        itrDueOn: itrDueOn(fy),
        counted: {
          rows: countedRows,
          provedPaise: sum((r) => r.provedPaise),
          notProvedPaise: sum((r) => r.notProvedPaise),
          // The year's employee PF from payroll: it counts under 80C with no proof.
          pfPaise: items.length > 0 ? await epfYearOf(org, userId) : 0,
        },
      }
      : null,
    itrDueOn: itrDueOn(fy),
    summary: {
      total: items.length,
      notUploaded: count('not_uploaded'),
      uploaded: count('uploaded'),
      approved: count('approved'),
      rejected: count('rejected'),
      submitted,
      notSubmitted: items.length - submitted,
      allSent: items.length > 0 && count('not_uploaded') + count('rejected') === 0,
      allApproved: items.length > 0 && count('approved') === items.length,
    },
    // The same items, grouped by section in the declaration's order.
    sections,
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
  input: { amountPaise?: unknown; landlordPan?: unknown; file?: { originalname: string; mimetype: string; size: number; buffer: Buffer } },
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
  if (dueOn === null) throw NOT_CONFIGURED(['proofsDue'], askHr('HR has not set the proofs due date yet, so proofs can\'t be uploaded'));
  if (dayOf(now) > dueOn) {
    throw new EmployeePayrollError(409, `Investment proofs for FY ${fy} closed on ${dayLabel(dueOn)}, so proofs can't be uploaded now. To send one late, ask HR.`, { reason: 'proofs_closed', dueOn });
  }
  const existing = (await investmentProofs().findOne({ org, userId, fy, item })) as StoredProof | null;
  if (existing?.status === 'approved') {
    throw new EmployeePayrollError(409, 'This proof is already approved, so it can\'t be replaced. If it needs to change, ask HR.', { reason: 'proof_approved' });
  }
  const amount = Number(input.amountPaise);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT_PAISE) throw new EmployeePayrollError(400, 'Enter the amount on the proof, in paise');
  const file = input.file;
  if (!file) throw new EmployeePayrollError(400, 'Attach the proof: a PDF, JPEG or PNG');
  // Rent's proof may carry the landlord's PAN; nothing else takes one.
  const panRaw = typeof input.landlordPan === 'string' ? input.landlordPan.replace(/\s+/g, '').toUpperCase() : '';
  if (panRaw && item !== 'rentMonthly') throw new EmployeePayrollError(400, 'Only rent takes a landlord PAN');
  if (panRaw && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panRaw)) throw new EmployeePayrollError(400, 'A PAN is 10 characters, like ABCDE1234F');
  if (!storage.available()) throw new EmployeePayrollError(503, 'File uploads are not set up on this server');

  const stored = await storage.upload(org, userId, { originalName: file.originalname, contentType: file.mimetype, size: file.size, bytes: file.buffer });
  const fileName = (file.originalname || 'proof').normalize('NFC').slice(-120);
  const write = {
    $set: {
      org, userId, fy, item, status: 'uploaded' as const, amountPaise: amount, objectKey: stored.objectKey, fileName, contentType: file.mimetype, size: file.size, uploadedAt: now,
      ...(panRaw ? { ...(fieldKeyConfigured() ? { landlordPan: encryptField(panRaw) } : {}), landlordPanLast4: panRaw.slice(-4) } : {}),
    },
    $unset: (panRaw
      ? { decidedAt: '', decidedByUserId: '', reason: '' }
      : { decidedAt: '', decidedByUserId: '', reason: '', landlordPan: '', landlordPanLast4: '' }) as Partial<Record<keyof InvestmentProof, ''>>,
  };
  // HR may have approved it since it was read: an approved proof is never written over.
  const replaced = existing
    ? await investmentProofs().updateOne({ _id: existing._id, status: { $ne: 'approved' } }, write)
    : await investmentProofs().updateOne({ org, userId, fy, item }, write, { upsert: true });
  if (existing && replaced.matchedCount === 0) {
    await storage.remove(stored.objectKey).catch(() => undefined);
    throw new EmployeePayrollError(409, 'This proof was approved just now, so it can\'t be replaced. If it needs to change, ask HR.', { reason: 'proof_approved' });
  }
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
      document: def ? PROOF_DOCUMENTS[def.key] : null,
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
      // HR's list: masked; a third party's PAN is not sent out in bulk.
      landlordPan: r.landlordPanLast4 || r.landlordPan ? maskTail(r.landlordPanLast4 ?? readPan(r.landlordPan!, undefined)) ?? null : null,
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
  // The dashboard sends `reason`; `note` is read the same, for a caller that names it so.
  const said = body.reason ?? body.note;
  const reason = typeof said === 'string' ? said.trim() : '';
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
