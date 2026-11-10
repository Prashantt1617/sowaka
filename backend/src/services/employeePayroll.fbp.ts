/**
 * FBP (app › Payroll › FBP): the flexible benefit plan as the person lives
 * it month by month. The month's split as a summary, each flexible head's
 * bills from April to this month with where each stands with HR, the upload
 * (or re-upload) of a month's bill, and whether the split can still change
 * this financial year.
 *
 * Nothing new is stored. The heads and their amounts are the flexible split's
 * (employeePayroll.split.ts: flexibleComponentsOf, splitFor, splitWindow); a
 * bill is a reimbursement claim of a type HR linked to the head
 * (ReimbursementType.payHeadCode, read by billCategories), dated in the month
 * it is for. HR approves or rejects it on the dashboard's reimbursement page
 * as any claim (adminDecideReimbursement); the note HR writes on a rejection
 * is the reason the app shows.
 *
 * Every date and rule is HR's: the bills due date and the split cutoff day
 * (Company.payrollEmployee), the pool (the salary template), the bill types.
 * One not set comes back as not set up (`missing`), never a default.
 *
 * "Locked for this FY": the split's own window rule. A change made now
 * applies from the window's month; when that month is already in the next
 * FY (the cutoff for March has passed, or a run has locked every month left
 * in this FY) no change can reach this FY's pay, and the split is locked
 * until the FY ends.
 */
import { ObjectId } from 'mongodb';
import { flexibleSplits, reimbursementClaims, reimbursementTypes, salaryStructures, salaryTemplates, users } from '../config/db';
import { FlexibleSplit } from '../models/employeePayroll.model';
import { ReimbursementClaim } from '../models/reimbursement.model';
import { applyOverrides, resolveTemplateComponents } from '../shared/payroll/resolve';
import { fyOf } from '../shared/payroll/tds';
import {
  EmployeePayrollError, NOT_CONFIGURED, askHr, billsDueOn, dayLabel, dayOf, deadlinesOf, istPeriodOf, lastDayOf, meOf, nextPeriod,
} from './employeePayroll.common';
import { FlexibleComponent, flexibleComponentsOf, splitFor, splitWindow } from './employeePayroll.split';
import { emitRequestsChanged } from './connect-realtime.service';
import { billCategories } from './reimbursementBills.service';
import { hasReceiptStorage, presignReceiptDownload, uploadReimbursementReceipt } from './s3-receipt.service';
import { catalogWithStandard } from './standardComponents.service';

// —— bill storage (S3), swappable so the checks never reach the bucket ——


/** Today in India, as the pay months are kept (a bill sent at 2 am on the 1st is that month's). */
const istDayOf = (now: Date) => new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
export interface FbpBillStorage {
  available(): boolean;
  upload(userId: string, file: { originalName: string; contentType: string; size: number; bytes: Buffer }): Promise<{ objectKey: string }>;
  url(objectKey: string, fileName: string): Promise<string>;
}

const s3Storage: FbpBillStorage = {
  available: hasReceiptStorage,
  // The same bucket and key prefix as any reimbursement receipt: the dashboard opens it as one.
  upload: (userId, file) => uploadReimbursementReceipt(userId, file),
  url: presignReceiptDownload,
};
let storage: FbpBillStorage = s3Storage;
export function setFbpBillStorageForTests(next: FbpBillStorage | null) {
  storage = next ?? s3Storage;
}

// —— what a month's bill is ——

export type FbpBillStatus = 'approved' | 'in_review' | 'rejected' | 'not_uploaded';

type Claim = ReimbursementClaim & { _id: ObjectId };

export interface FbpMonth {
  period: string;
  /** The head's amount that month: the split in force, else the salary structure's. */
  amountPaise: number;
  status: FbpBillStatus;
  /** The bill that decides the status; null when nothing was sent. */
  bill: {
    id: string;
    amountPaise: number;
    fileName: string | null;
    uploadedAt: string;
    decidedAt: string | null;
    /** HR's note when rejecting it. */
    reason: string | null;
  } | null;
  /** A bill can be sent for this month now: none in review or approved, and bills still open. */
  canUpload: boolean;
}

/** A month's status from its bills: one approved wins, then one in review, then the latest rejected. */
export function monthStatus(claims: Claim[]): { status: FbpBillStatus; claim: Claim | null } {
  const latest = (status: ReimbursementClaim['status'][]) =>
    claims.filter((c) => status.includes(c.status)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const approved = latest(['approved', 'paid']);
  if (approved) return { status: 'approved', claim: approved };
  const pending = latest(['pending']);
  if (pending) return { status: 'in_review', claim: pending };
  const declined = latest(['declined']);
  if (declined) return { status: 'rejected', claim: declined };
  return { status: 'not_uploaded', claim: null };
}

const billView = (c: Claim): NonNullable<FbpMonth['bill']> => ({
  id: c._id.toHexString(),
  amountPaise: Math.round((c.amount ?? 0) * 100),
  fileName: c.receiptName ?? null,
  uploadedAt: c.createdAt.toISOString(),
  decidedAt: c.decidedAt ? c.decidedAt.toISOString() : null,
  reason: c.status === 'declined' ? c.managerNote?.trim() || null : null,
});

/** The head's amount in a month: the split in force then (a head it leaves out is 0), else the structure's own. */
const amountIn = (component: FlexibleComponent, splits: FlexibleSplit[], period: string) => {
  const split = splitFor(splits, period);
  return split ? split.amounts[component.code] ?? 0 : component.basePaise;
};

/** The months of `fy` from April (or the month pay started, if later) to `through`. */
function monthsOf(fy: string, through: string, startedOn: Date | null): string[] {
  let period = `${fy.slice(0, 4)}-04`;
  const started = startedOn ? istPeriodOf(startedOn) : null;
  if (started && started > period) period = started;
  const last = `${Number(fy.slice(0, 4)) + 1}-03`;
  const end = through < last ? through : last;
  const out: string[] = [];
  while (period <= end) {
    out.push(period);
    period = nextPeriod(period);
  }
  return out;
}

const monthName = (period: string, style: 'long' | 'short' = 'long') =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: style, year: 'numeric', timeZone: 'UTC' });

// —— the person's FBP ——

interface Fbp {
  org: string;
  userId: string;
  fy: string;
  period: string;
  components: FlexibleComponent[];
  poolPaise: number | null;
  splits: FlexibleSplit[];
  months: string[];
  /** Head code → the claim categories its bills are filed under (lowercased type names). */
  categoriesOf: Map<string, string[]>;
  /** Head code → the active bill type a new bill is filed under. */
  uploadTypeOf: Map<string, { name: string; maxLimit: number }>;
  claims: Claim[];
  billsDue: string | null;
  window: Awaited<ReturnType<typeof splitWindow>>;
}

async function fbpOf(userId: string, now: Date): Promise<Fbp> {
  const { org, user } = await meOf(userId);
  const structure = await salaryStructures().findOne({ org, userId }, { projection: { _id: 0 } });
  if (!structure?.salaryTemplateCode) throw new EmployeePayrollError(404, 'No salary structure has been set up for you yet');
  const [template, catalog] = await Promise.all([
    salaryTemplates().findOne({ org, code: structure.salaryTemplateCode }),
    catalogWithStandard(org).then((c) => c.all),
  ]);
  if (!template) throw new EmployeePayrollError(404, 'No salary structure has been set up for you yet');
  const byCode = new Map(catalog.map((h) => [h.code, h]));
  const resolved = resolveTemplateComponents(applyOverrides(template.components, structure.overrides, byCode), byCode);
  const components = flexibleComponentsOf(resolved, structure, template.balancingComponentCode);

  const period = istPeriodOf(now);
  const { fy } = fyOf(period);
  const [splits, categories, types, window, deadlines] = await Promise.all([
    flexibleSplits().find({ org, userId }, { projection: { _id: 0 } }).toArray(),
    billCategories(org),
    reimbursementTypes().find({ org, active: true, payHeadCode: { $exists: true, $ne: '' } } as never).sort({ name: 1 }).toArray(),
    splitWindow(org, now),
    deadlinesOf(org),
  ]);
  const categoriesOf = new Map<string, string[]>();
  for (const [category, code] of categories) categoriesOf.set(code, [...(categoriesOf.get(code) ?? []), category]);
  const uploadTypeOf = new Map<string, { name: string; maxLimit: number }>();
  for (const t of types) if (!uploadTypeOf.has(t.payHeadCode!)) uploadTypeOf.set(t.payHeadCode!, { name: t.name, maxLimit: t.maxLimit ?? 0 });

  const startedOn = structure.effectiveFrom ?? user.joiningDate ?? null;
  const months = monthsOf(fy, period, startedOn ? new Date(startedOn) : null);
  const claims = categories.size === 0 || months.length === 0
    ? []
    : ((await reimbursementClaims()
      .find({
        userId,
        category: { $in: [...categories.keys()] },
        expenseDate: { $gte: new Date(`${months[0]}-01T00:00:00Z`), $lte: new Date(`${lastDayOf(months[months.length - 1])}T23:59:59.999Z`) },
      })
      .toArray()) as Claim[]);
  return {
    org, userId, fy, period, components,
    poolPaise: typeof template.flexiblePoolPaise === 'number' ? template.flexiblePoolPaise : null,
    splits, months, categoriesOf, uploadTypeOf, claims,
    billsDue: billsDueOn(fy, deadlines),
    window,
  };
}

/** Why bills for a head can't be sent now; null when they can. */
function uploadBlock(f: Fbp, code: string, now: Date): { reason: string; message: string; missing?: string[] } | null {
  if (f.billsDue === null) return { reason: 'payroll_not_configured', missing: ['billsDue'], message: askHr('HR has not set the date FBP bills are due, so bills can\'t be uploaded yet') };
  if (!f.uploadTypeOf.has(code)) {
    return { reason: 'payroll_not_configured', missing: ['billType'], message: askHr('HR has not set up bills for this head yet, so they can\'t be uploaded') };
  }
  if (istDayOf(now) > f.billsDue) {
    return { reason: 'bills_closed', message: `FBP bills for FY ${f.fy} closed on ${dayLabel(f.billsDue)}. To send one late, ask HR.` };
  }
  return null;
}

function monthsFor(f: Fbp, component: FlexibleComponent, now: Date): FbpMonth[] {
  const categories = new Set(f.categoriesOf.get(component.code) ?? []);
  const open = uploadBlock(f, component.code, now) === null;
  return f.months
    .map((period) => {
      const amountPaise = amountIn(component, f.splits, period);
      const { status, claim } = monthStatus(
        f.claims.filter((c) => categories.has(c.category) && c.expenseDate.toISOString().slice(0, 7) === period),
      );
      return {
        period,
        amountPaise,
        status,
        bill: claim ? billView(claim) : null,
        canUpload: open && (status === 'not_uploaded' || status === 'rejected'),
      };
    })
    // A month the head pays nothing needs no bill.
    .filter((m) => m.amountPaise > 0 || m.bill !== null);
}

const countOf = (months: FbpMonth[], status: FbpBillStatus) => months.filter((m) => m.status === status).length;

/**
 * Whether the split can still change this FY. `locked` only on the window's
 * own rule; `notConfigured` while HR has not set the split cutoff day.
 */
function lockOf(f: Fbp) {
  const w = f.window;
  if (w.effectiveFrom === null) {
    return { locked: false, notConfigured: true, missing: ['splitCutoffDay'], reason: 'payroll_not_configured', effectiveFrom: null, closesOn: null };
  }
  const locked = fyOf(w.effectiveFrom).fy !== f.fy;
  return {
    locked,
    notConfigured: false,
    missing: [] as string[],
    reason: locked ? 'fy_closed' : null,
    // While open: the month a change made now starts from, and the last day to make it for that month.
    effectiveFrom: locked ? null : w.effectiveFrom,
    closesOn: locked ? null : w.closesOn,
  };
}

/** The FBP page: the month's split, each head's bills this FY, what is left to send, and the lock. */
export async function myFbp(userId: string, now = new Date()) {
  const f = await fbpOf(userId, now);
  const lock = lockOf(f);
  const base = { fy: f.fy, period: f.period, billsDueOn: f.billsDue, lock };
  if (f.components.length === 0) {
    return { available: false, ...base, poolPaise: f.poolPaise, assignedPaise: 0, unassignedPaise: null, declared: null, heads: [], summary: { toUpload: 0, toReupload: 0, inReview: 0, approved: 0 }, missing: [] };
  }
  const heads = f.components.map((c) => {
    const months = monthsFor(f, c, now);
    const toUpload = countOf(months, 'not_uploaded');
    const rejected = countOf(months, 'rejected');
    return {
      code: c.code,
      name: c.name,
      amountPaise: amountIn(c, f.splits, f.period),
      limitPaise: c.limitPaise,
      months: months.length,
      approved: countOf(months, 'approved'),
      inReview: countOf(months, 'in_review'),
      rejected,
      toUpload,
      /** Bills to send: not uploaded or rejected (the red count). */
      needsAction: toUpload + rejected,
      billsSetUp: f.uploadTypeOf.has(c.code),
    };
  });
  const assigned = heads.reduce((sum, h) => sum + h.amountPaise, 0);
  const current = splitFor(f.splits, f.period);
  return {
    available: true,
    ...base,
    // Null while the salary template has no flexiblePoolPaise (HR sets it): the page says so.
    poolPaise: f.poolPaise,
    assignedPaise: assigned,
    unassignedPaise: f.poolPaise === null ? null : Math.max(0, f.poolPaise - assigned),
    // The split this month's amounts come from; null while none was submitted (the structure's amounts apply).
    declared: current ? { effectiveFrom: current.effectiveFrom, submittedAt: current.submittedAt.toISOString() } : null,
    heads,
    summary: {
      toUpload: heads.reduce((s, h) => s + h.toUpload, 0),
      toReupload: heads.reduce((s, h) => s + h.rejected, 0),
      inReview: heads.reduce((s, h) => s + h.inReview, 0),
      approved: heads.reduce((s, h) => s + h.approved, 0),
    },
    missing: [
      ...(f.poolPaise === null ? ['flexiblePoolPaise'] : []),
      ...(f.billsDue === null ? ['billsDue'] : []),
      ...lock.missing,
    ],
  };
}

function componentOf(f: Fbp, codeRaw: string): FlexibleComponent {
  const code = codeRaw.trim().toUpperCase();
  const component = f.components.find((c) => c.code === code);
  if (!component) throw new EmployeePayrollError(404, 'That is not one of your FBP heads');
  return component;
}

function headView(f: Fbp, component: FlexibleComponent, now: Date) {
  const block = uploadBlock(f, component.code, now);
  return {
    code: component.code,
    name: component.name,
    fy: f.fy,
    period: f.period,
    amountPaise: amountIn(component, f.splits, f.period),
    limitPaise: component.limitPaise,
    billsDueOn: f.billsDue,
    // The bill type new bills are filed under, as HR named it.
    billType: f.uploadTypeOf.get(component.code)?.name ?? null,
    // Why bills can't be sent now (not set up, or closed); null while they can.
    uploadsBlocked: block ? { reason: block.reason, message: block.message, missing: block.missing ?? [] } : null,
    months: monthsFor(f, component, now),
  };
}

/** One head's page: every month of this FY so far and its bill. */
export async function myFbpHead(userId: string, codeRaw: string, now = new Date()) {
  const f = await fbpOf(userId, now);
  return headView(f, componentOf(f, codeRaw), now);
}

const MAX_BILL_PAISE = 10_000_000_00; // ₹1 crore: past any month's bill

/**
 * Upload (or, after a rejection, re-upload) the bill for one month of a head:
 * a reimbursement claim of the head's bill type, dated in that month (its
 * last day, or today for this month), in review until HR decides it.
 */
export async function uploadMyFbpBill(
  userId: string,
  codeRaw: string,
  input: { period?: unknown; amountPaise?: unknown; file?: { originalname: string; mimetype: string; size: number; buffer: Buffer } },
  now = new Date(),
) {
  const f = await fbpOf(userId, now);
  const component = componentOf(f, codeRaw);
  const period = typeof input.period === 'string' ? input.period.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new EmployeePayrollError(400, 'period is the month the bill is for, like 2026-10');
  if (period > f.period) throw new EmployeePayrollError(400, 'That month has not started yet');
  if (!f.months.includes(period)) throw new EmployeePayrollError(400, `Bills here are for FY ${f.fy}, from ${monthName(f.months[0] ?? f.period)} to ${monthName(f.period)}`);
  if (amountIn(component, f.splits, period) <= 0) throw new EmployeePayrollError(400, `${component.name} pays nothing in ${monthName(period)}, so it needs no bill`);
  const block = uploadBlock(f, component.code, now);
  if (block) {
    if (block.missing) throw NOT_CONFIGURED(block.missing, block.message);
    throw new EmployeePayrollError(409, block.message, { reason: block.reason, dueOn: f.billsDue });
  }
  const month = monthsFor(f, component, now).find((m) => m.period === period);
  if (month?.status === 'approved') throw new EmployeePayrollError(409, `The ${monthName(period)} bill is already approved. If it needs to change, ask HR.`, { reason: 'bill_approved' });
  if (month?.status === 'in_review') throw new EmployeePayrollError(409, `The ${monthName(period)} bill is already in review`, { reason: 'bill_in_review' });

  const amount = Number(input.amountPaise);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_BILL_PAISE) throw new EmployeePayrollError(400, 'Enter the amount on the bill, in paise');
  if (amount % 100 !== 0) throw new EmployeePayrollError(400, 'Enter the amount on the bill in whole rupees');
  const type = f.uploadTypeOf.get(component.code)!;
  if (type.maxLimit > 0 && amount > type.maxLimit * 100) {
    throw new EmployeePayrollError(400, `${type.name} bills are capped at ₹${type.maxLimit.toLocaleString('en-IN')}`);
  }
  const file = input.file;
  if (!file) throw new EmployeePayrollError(400, 'Attach the bill: a photo or PDF');
  if (!storage.available()) throw new EmployeePayrollError(503, 'File uploads are not set up on this server');

  const stored = await storage.upload(userId, { originalName: file.originalname, contentType: file.mimetype, size: file.size, bytes: file.buffer });
  const today = istDayOf(now);
  const expenseDay = lastDayOf(period) < today ? lastDayOf(period) : today;
  const employee = await users().findOne({ userId }, { projection: { _id: 0, managerUserId: 1 } });
  const claim: ReimbursementClaim = {
    userId,
    // Bills are decided on the dashboard by HR; the manager is kept as on any claim.
    managerUserId: employee?.managerUserId ?? '',
    expenseDate: new Date(`${expenseDay}T00:00:00.000Z`),
    amount: amount / 100,
    category: type.name.toLowerCase(),
    receiptName: (file.originalname || 'bill').normalize('NFC').slice(-120),
    receiptObjectKey: stored.objectKey,
    receiptContentType: file.mimetype,
    receiptSize: file.size,
    note: `FBP bill for ${monthName(period)}`,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await reimbursementClaims().insertOne(claim);
  emitRequestsChanged([claim.userId, claim.managerUserId], 'reimbursement_submitted');
  const after = await fbpOf(userId, now);
  return headView(after, componentOf(after, component.code), now);
}

/** A short-lived link to a bill the person sent. */
export async function myFbpBillFile(userId: string, billId: string) {
  if (!ObjectId.isValid(billId)) throw new EmployeePayrollError(400, 'Invalid bill');
  const claim = await reimbursementClaims().findOne({ _id: new ObjectId(billId), userId });
  if (!claim?.receiptObjectKey) throw new EmployeePayrollError(404, 'Bill not found');
  return storage.url(claim.receiptObjectKey, claim.receiptName ?? 'bill');
}
