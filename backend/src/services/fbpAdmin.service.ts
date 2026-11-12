/**
 * The dashboard's FBP pages (Payroll › FBP requests, Payroll › FBP splits).
 *
 * FBP is part of salary: each month the FBP heads (Fuel, Internet…) are paid
 * with the salary at the person's split. A bill the person uploads is not
 * paid again; once HR approves it, that much of the head is tax-free. So FBP
 * bills are not reimbursement requests, and they live on their own page,
 * though they are still stored as claims of a reimbursement type HR linked to
 * the head (ReimbursementType.payHeadCode, read by billCategories). Nothing is
 * moved or copied: the reimbursement lists leave these claims out
 * (notFbpBillFilter), and this page reads only them.
 *
 * Decisions go through the reimbursement decision service
 * (adminDecideReimbursement), so a decided bill notifies, audits and reads in
 * the app exactly as before; a rejection's reason is the claim's
 * `managerNote`, which the app's FBP page shows.
 */
import { ObjectId } from 'mongodb';
import { flexibleSplits, reimbursementClaims, reimbursementTypes, salaryStructures, salaryTemplates, users } from '../config/db';
import { FlexibleSplit } from '../models/employeePayroll.model';
import { ReimbursementClaim } from '../models/reimbursement.model';
import { User } from '../models/user.model';
import { applyOverrides, resolveTemplateComponents } from '../shared/payroll/resolve';
import {
  billsDueOn, deadlinesFrom, EmployeePayrollError, fbpBillsDueDayFrom, istPeriodOf, parseFyParam, payrollEmployeeOf,
  splitClosesOnFor, splitDueFrom, splitStepFrom,
} from './employeePayroll.common';
import { amountIn, monthsOf, monthStatus } from './employeePayroll.fbp';
import { flexibleComponentsOf, splitFor } from './employeePayroll.split';
import { adminDecideReimbursement, ReimbursementError } from './reimbursement.service';
import { billCategories } from './reimbursementBills.service';
import { presignReceiptDownload } from './s3-receipt.service';
import { hasPayrollAccess } from './payrollAccess.service';
import { requestViewer } from '../middleware/request-viewer';
import { resolveProfilePhoto } from './s3-connect-media.service';
import { catalogWithStandard } from './standardComponents.service';

type Claim = ReimbursementClaim & { _id: ObjectId };
export type FbpRequestStatus = 'pending' | 'approved' | 'rejected';

const ACTIVE = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] }, hiddenFromDirectory: { $ne: true } } as const;
const PERSON = { _id: 0, userId: 1, name: 1, employeeId: 1, department: 1, designation: 1, profilePhotoKey: 1, profilePhotoUrl: 1, joiningDate: 1 } as const;

const statusOf = (claim: Pick<ReimbursementClaim, 'status'>): FbpRequestStatus =>
  claim.status === 'pending' ? 'pending' : claim.status === 'declined' ? 'rejected' : 'approved';

const fyBounds = (fy: string) => ({
  $gte: new Date(`${fy.slice(0, 4)}-04-01T00:00:00.000Z`),
  $lte: new Date(`${Number(fy.slice(0, 4)) + 1}-03-31T23:59:59.999Z`),
});

/** The pay heads by code, for a head's name as the payslip prints it. */
async function headNamesOf(org: string): Promise<Map<string, string>> {
  const catalog = (await catalogWithStandard(org)).all;
  return new Map(catalog.map((h) => [h.code, h.payslipName?.trim() || h.name]));
}

/**
 * The viewer's company, for someone with payroll access (Payroll Runs or
 * Salary details: the FBP pages come with it) or given the FBP page itself.
 */
async function fbpViewerOrg(viewerUserId: string, tab: 'fbprequests' | 'fbpsplits', what: string): Promise<string> {
  const viewer = requestViewer(viewerUserId)
    ?? (await users().findOne({ userId: viewerUserId }, { projection: { _id: 0, org: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1 } }));
  if (!viewer?.org) throw new EmployeePayrollError(403, 'No organisation on this account');
  const given = viewer.dashboardAccess === true && Array.isArray(viewer.dashboardTabs) && viewer.dashboardTabs.includes(tab);
  if (!hasPayrollAccess(viewer) && !given) throw new EmployeePayrollError(403, `Only people with payroll access can ${what}`);
  return viewer.org;
}

// —— FBP requests ——

async function requestRow(claim: Claim, person: Partial<User> | undefined, categories: Map<string, string>, headNames: Map<string, string>, typeNames: Map<string, string>) {
  const code = categories.get(claim.category) ?? '';
  return {
    id: claim._id.toHexString(),
    userId: claim.userId,
    employee: {
      name: person?.name ?? 'Former employee',
      employeeId: person?.employeeId ?? null,
      department: person?.department ?? person?.designation ?? null,
      photoUrl: person ? await resolveProfilePhoto(person as User).catch(() => undefined) : undefined,
    },
    headCode: code,
    headName: headNames.get(code) ?? code,
    billType: typeNames.get(claim.category) ?? claim.category,
    // A bill is dated in the month it is for (its last day, or the day it was sent for the current month).
    period: claim.expenseDate.toISOString().slice(0, 7),
    amountPaise: Math.round((claim.amount ?? 0) * 100),
    uploadedAt: claim.createdAt.toISOString(),
    fileName: claim.receiptName ?? null,
    hasFile: Boolean(claim.receiptObjectKey),
    fileUrl: claim.receiptObjectKey
      ? await presignReceiptDownload(claim.receiptObjectKey, claim.receiptName ?? 'bill').catch(() => undefined)
      : undefined,
    fileType: claim.receiptContentType ?? null,
    note: claim.note ?? null,
    status: statusOf(claim),
    // HR's reason on a rejection: what the app's FBP page shows.
    reason: claim.status === 'declined' ? claim.managerNote?.trim() || null : null,
    decidedAt: claim.decidedAt ? claim.decidedAt.toISOString() : null,
  };
}

export type FbpRequestRow = Awaited<ReturnType<typeof requestRow>>;

/** Every FBP bill of a FY (?fy=2026-27, default this FY), newest first, with counts per status. */
export async function fbpRequestsForAdmin(adminUserId: string, fyRaw: unknown, now = new Date()) {
  const org = await fbpViewerOrg(adminUserId, 'fbprequests', 'see FBP bills');
  const fy = parseFyParam(fyRaw, now);
  const [categories, headNames, types, people] = await Promise.all([
    billCategories(org),
    headNamesOf(org),
    reimbursementTypes().find({ org, payHeadCode: { $exists: true, $ne: '' } } as never, { projection: { _id: 0, name: 1 } }).toArray(),
    users().find({ org, hiddenFromDirectory: { $ne: true } } as never, { projection: PERSON }).toArray(),
  ]);
  const typeNames = new Map(types.map((t) => [t.name.toLowerCase(), t.name]));
  const empty = { fy, requests: [] as FbpRequestRow[], counts: { pending: 0, approved: 0, rejected: 0 }, pendingOtherYears: 0 };
  if (categories.size === 0 || people.length === 0) return empty;
  const byId = new Map(people.map((p) => [p.userId, p]));
  const base = { userId: { $in: [...byId.keys()] }, category: { $in: [...categories.keys()] } };
  const [claims, pendingAll] = await Promise.all([
    reimbursementClaims().find({ ...base, expenseDate: fyBounds(fy) }).sort({ createdAt: -1 }).toArray() as Promise<Claim[]>,
    reimbursementClaims().countDocuments({ ...base, status: 'pending' }),
  ]);
  const requests = await Promise.all(claims.map((c) => requestRow(c, byId.get(c.userId), categories, headNames, typeNames)));
  const count = (s: FbpRequestStatus) => requests.filter((r) => r.status === s).length;
  const counts = { pending: count('pending'), approved: count('approved'), rejected: count('rejected') };
  // Pending bills dated in another FY (a late March bill): said, so none waits unseen.
  return { fy, requests, counts, pendingOtherYears: pendingAll - counts.pending };
}

/** Pending FBP bills in the company, every FY: the sidebar's count. */
export async function fbpPendingCount(adminUserId: string): Promise<number> {
  const org = await fbpViewerOrg(adminUserId, 'fbprequests', 'see FBP bills');
  const categories = await billCategories(org);
  if (categories.size === 0) return 0;
  const ids = (await users().find({ org, hiddenFromDirectory: { $ne: true } } as never, { projection: { _id: 0, userId: 1 } }).toArray()).map((u) => u.userId);
  return reimbursementClaims().countDocuments({ userId: { $in: ids }, status: 'pending', category: { $in: [...categories.keys()] } });
}

/**
 * Approve, or reject with a reason, one FBP bill. Only a bill of this company
 * (a claim of a type linked to an FBP head) is decided here; the decision is
 * the reimbursement service's, so it notifies and records as any claim.
 */
export async function decideFbpRequest(adminUserId: string, billId: string, input: { decision?: unknown; reason?: unknown }) {
  const org = await fbpViewerOrg(adminUserId, 'fbprequests', 'decide FBP bills');
  if (!ObjectId.isValid(billId)) throw new EmployeePayrollError(400, 'Invalid bill');
  const decision = String(input.decision ?? '').trim().toLowerCase();
  if (decision !== 'approve' && decision !== 'reject') throw new EmployeePayrollError(400, 'decision is approve or reject');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (decision === 'reject' && !reason) throw new EmployeePayrollError(400, 'Say why the bill is rejected: the employee sees it in the app');
  if (reason.length > 500) throw new EmployeePayrollError(400, 'The reason is too long (500 characters at most)');

  const [claim, categories] = await Promise.all([
    reimbursementClaims().findOne({ _id: new ObjectId(billId) }) as Promise<Claim | null>,
    billCategories(org),
  ]);
  const owner = claim ? await users().findOne({ userId: claim.userId }, { projection: { ...PERSON, org: 1 } }) : null;
  if (!claim || owner?.org !== org || !categories.has(claim.category)) throw new EmployeePayrollError(404, 'FBP bill not found');
  try {
    await adminDecideReimbursement(adminUserId, billId, decision === 'approve' ? 'approved' : 'declined', reason || undefined);
  } catch (error) {
    if (error instanceof ReimbursementError) throw new EmployeePayrollError(error.statusCode, error.message.replace(/Reimbursement claim/g, 'FBP bill').replace(/reimbursement claim/g, 'FBP bill'));
    throw error;
  }
  const after = (await reimbursementClaims().findOne({ _id: claim._id })) as Claim;
  const [headNames, types] = await Promise.all([
    headNamesOf(org),
    reimbursementTypes().find({ org, payHeadCode: { $exists: true, $ne: '' } } as never, { projection: { _id: 0, name: 1 } }).toArray(),
  ]);
  return requestRow(after, owner ?? undefined, categories, headNames, new Map(types.map((t) => [t.name.toLowerCase(), t.name])));
}

// —— FBP splits ——

/**
 * Every employee on a salary template with FBP heads, for a FY: the pool,
 * each head's amount in force (the split's, else the structure's), what is
 * not assigned, when the split was declared and changed, the bills
 * acknowledgement, and per head the bills approved against the months due.
 * Read only. With it, what is not set up that FBP needs (`setup`).
 */
export async function fbpSplitsForAdmin(adminUserId: string, fyRaw: unknown, now = new Date()) {
  const org = await fbpViewerOrg(adminUserId, 'fbpsplits', 'see flexible splits');
  const fy = parseFyParam(fyRaw, now);
  const fyFirst = `${fy.slice(0, 4)}-04`;
  const fyLast = `${Number(fy.slice(0, 4)) + 1}-03`;
  const thisMonth = istPeriodOf(now);
  // The month "now" means for this FY: this month, the FY's last for a past FY, none for a future one.
  const asOf = thisMonth < fyFirst ? null : thisMonth > fyLast ? fyLast : thisMonth;

  const [structures, templates, catalog, people, splitRows, categories, types, settings] = await Promise.all([
    salaryStructures().find({ org, status: 'active' }, { projection: { _id: 0 } }).toArray(),
    salaryTemplates().find({ org }).toArray(),
    catalogWithStandard(org).then((c) => c.all),
    users().find({ org, ...ACTIVE } as never, { projection: PERSON }).toArray(),
    flexibleSplits().find({ org, fy }, { projection: { _id: 0 } }).toArray(),
    billCategories(org),
    reimbursementTypes().find({ org, payHeadCode: { $exists: true, $ne: '' } } as never).sort({ name: 1 }).toArray(),
    payrollEmployeeOf(org),
  ]);
  const byCode = new Map(catalog.map((h) => [h.code, h]));
  const templateByCode = new Map(templates.map((t) => [t.code, t]));
  const personById = new Map(people.map((p) => [p.userId, p]));
  const splitsOf = new Map<string, FlexibleSplit[]>();
  for (const s of splitRows) splitsOf.set(s.userId, [...(splitsOf.get(s.userId) ?? []), s]);
  // The active bill type of each head (bills go up as it); an inactive one takes no new bills.
  const billTypeOf = new Map<string, string>();
  for (const t of types) if (t.active && !billTypeOf.has(t.payHeadCode!)) billTypeOf.set(t.payHeadCode!, t.name);
  const categoriesOf = new Map<string, Set<string>>();
  for (const [category, code] of categories) categoriesOf.set(code, new Set([...(categoriesOf.get(code) ?? []), category]));

  const claims = categories.size === 0
    ? []
    : ((await reimbursementClaims()
      .find({ userId: { $in: structures.map((s) => s.userId) }, category: { $in: [...categories.keys()] }, expenseDate: fyBounds(fy) }, { projection: { userId: 1, category: 1, status: 1, expenseDate: 1, createdAt: 1 } })
      .toArray()) as Claim[]);
  const claimsOf = new Map<string, Claim[]>();
  for (const c of claims) claimsOf.set(c.userId, [...(claimsOf.get(c.userId) ?? []), c]);

  const rows = [];
  for (const structure of structures) {
    const person = personById.get(structure.userId);
    const template = structure.salaryTemplateCode ? templateByCode.get(structure.salaryTemplateCode) : undefined;
    if (!person || !template) continue;
    const resolved = resolveTemplateComponents(applyOverrides(template.components, structure.overrides, byCode), byCode);
    const components = flexibleComponentsOf(resolved, structure, template.balancingComponentCode);
    if (components.length === 0) continue;
    const splits = (splitsOf.get(structure.userId) ?? []).sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
    const inForce = asOf ? splitFor(splits, asOf) : undefined;
    const startedOn = structure.effectiveFrom ?? person.joiningDate ?? null;
    const months = asOf ? monthsOf(fy, asOf, startedOn ? new Date(startedOn) : null) : [];
    const own = claimsOf.get(structure.userId) ?? [];
    const heads = components.map((c) => {
      const cats = categoriesOf.get(c.code) ?? new Set<string>();
      const mine = own.filter((cl) => cats.has(cl.category));
      let due = 0;
      let approved = 0;
      let inReview = 0;
      let rejected = 0;
      for (const period of months) {
        if (amountIn(c, splits, period) <= 0) continue;
        due += 1;
        const { status } = monthStatus(mine.filter((cl) => cl.expenseDate.toISOString().slice(0, 7) === period));
        if (status === 'approved') approved += 1;
        else if (status === 'in_review') inReview += 1;
        else if (status === 'rejected') rejected += 1;
      }
      return {
        code: c.code,
        name: c.name,
        limitPaise: c.limitPaise,
        amountPaise: asOf ? amountIn(c, splits, asOf) : c.basePaise,
        billType: billTypeOf.get(c.code) ?? null,
        bills: { due, approved, inReview, rejected, missing: due - approved - inReview - rejected },
      };
    });
    const pool = typeof template.flexiblePoolPaise === 'number' ? template.flexiblePoolPaise : null;
    const assigned = heads.reduce((t, h) => t + h.amountPaise, 0);
    const first = splits[0];
    const last = splits[splits.length - 1];
    rows.push({
      userId: structure.userId,
      name: person.name,
      employeeId: person.employeeId ?? null,
      department: person.department ?? null,
      designation: person.designation ?? null,
      template: { code: template.code, name: template.name },
      poolPaise: pool,
      assignedPaise: assigned,
      unassignedPaise: pool === null ? null : Math.max(0, pool - assigned),
      heads,
      // Null while they have not declared a split this FY: the structure's amounts are paid.
      declared: first
        ? {
          firstAt: first.submittedAt.toISOString(),
          // The latest change, when there was one after the first.
          changedAt: splits.length > 1 ? last.submittedAt.toISOString() : null,
          versions: splits.length,
          effectiveFrom: (inForce ?? last).effectiveFrom,
          billsAcknowledgedAt: (inForce ?? last).billsAcknowledgedAt ? new Date((inForce ?? last).billsAcknowledgedAt!).toISOString() : (inForce ?? last).submittedAt.toISOString(),
        }
        : null,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  // —— what FBP needs that is not set up ——
  const templateNotes: { code: string; name: string; heads: { code: string; name: string; limitPaise: number }[]; poolPaise: number | null }[] = [];
  const headsInUse = new Map<string, string>();
  for (const t of templates.filter((x) => x.active !== false)) {
    const resolved = resolveTemplateComponents(t.components, byCode);
    const heads = flexibleComponentsOf(resolved, { componentValues: {} }, t.balancingComponentCode);
    if (heads.length === 0) continue;
    for (const h of heads) headsInUse.set(h.code, h.name);
    templateNotes.push({ code: t.code, name: t.name, heads: heads.map((h) => ({ code: h.code, name: h.name, limitPaise: h.limitPaise })), poolPaise: typeof t.flexiblePoolPaise === 'number' ? t.flexiblePoolPaise : null });
  }
  const deadlines = deadlinesFrom(settings);
  return {
    fy,
    asOf,
    rows,
    departments: [...new Set(rows.map((r) => r.department).filter((d): d is string => Boolean(d)))].sort(),
    setup: {
      // Bills can't be uploaded for these: no active bill type is linked to them.
      headsWithoutBillType: [...headsInUse].filter(([code]) => !billTypeOf.has(code)).map(([code, name]) => ({ code, name })),
      // The split can't be made on these: the template has no flexible pool.
      templatesWithoutPool: templateNotes.filter((t) => t.poolPaise === null).map((t) => ({ code: t.code, name: t.name })),
      templates: templateNotes,
      billTypes: types.map((t) => ({ name: t.name, headCode: t.payHeadCode!, headName: byCode.get(t.payHeadCode!)?.payslipName?.trim() || byCode.get(t.payHeadCode!)?.name || t.payHeadCode!, active: t.active })),
      rules: {
        splitStepPaise: splitStepFrom(settings),
        splitCutoffDay: deadlines.splitCutoffDay,
        splitClosesOn: splitClosesOnFor(fy, splitDueFrom(settings)),
        fbpBillsDueDay: fbpBillsDueDayFrom(settings),
        billsDueOn: billsDueOn(fy, deadlines),
      },
    },
  };
}
