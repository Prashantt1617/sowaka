import { ObjectId } from 'mongodb';
import { env } from '../config/env';
import { reimbursementClaims, users } from '../config/db';
import { ReimbursementClaim, ReimbursementStatus } from '../models/reimbursement.model';
import { User } from '../models/user.model';
import {
  deleteReimbursementReceipt,
  presignReceiptDownload,
  uploadReimbursementReceipt,
} from './s3-receipt.service';
import { orgUsers } from './admin-scope';
import { resolveTypeForClaim } from './reimbursement-type.service';

const decisions = new Set<ReimbursementStatus>(['approved', 'declined', 'paid']);

export async function createReimbursementClaim(
  userId: string,
  input: {
    expenseDate: string;
    amount: unknown;
    category: string;
    receiptName?: string;
    receipt?: {
      originalName: string;
      contentType: string;
      size: number;
      bytes: Buffer;
    };
    note?: string;
  },
) {
  const employee = await requireEmployeeWithManager(userId);
  const expenseDate = parseDateOnly(input.expenseDate);
  if (expenseDate > startOfUtcDay(new Date())) {
    throw new ReimbursementError(400, 'Expense date cannot be in the future');
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    throw new ReimbursementError(400, 'Amount must be greater than zero');
  }
  // The type must be one this org actually offers, and the claim must fit
  // under its cap. Checked here as well as in the app, because the app's copy
  // of the list is fetched once and can be stale by the time someone submits.
  const type = await resolveTypeForClaim(employee.org, input.category);
  if (!type) throw new ReimbursementError(400, 'Expense category is invalid');
  const daysBack = Math.round(
    (startOfUtcDay(new Date()).getTime() - expenseDate.getTime()) / 86_400_000,
  );
  if (daysBack > type.backdateDays) {
    throw new ReimbursementError(
      400,
      type.backdateDays === 0
        ? `${type.name} can only be claimed for today`
        : `${type.name} can be claimed up to ${type.backdateDays} days back`,
    );
  }
  if (type.maxLimit > 0 && amount > type.maxLimit) {
    throw new ReimbursementError(
      400,
      `${type.name} claims are capped at ₹${type.maxLimit.toLocaleString('en-IN')}`,
    );
  }
  const category = type.name.toLowerCase();
  const receiptName = input.receipt?.originalName.trim() ?? input.receiptName?.trim();
  const note = input.note?.trim();
  if (receiptName && receiptName.length > 255)
    throw new ReimbursementError(400, 'Receipt name is too long');
  if (note && note.length > 500) throw new ReimbursementError(400, 'Note is too long');

  let uploadedReceipt: { objectKey: string; contentType: string; size: number } | undefined;
  if (input.receipt) {
    try {
      uploadedReceipt = await uploadReimbursementReceipt(userId, input.receipt);
    } catch {
      throw new ReimbursementError(503, 'Receipt storage is unavailable');
    }
  }

  const now = new Date();
  const claim: ReimbursementClaim = {
    userId,
    managerUserId: employee.managerUserId!,
    expenseDate,
    amount: Math.round(amount * 100) / 100,
    category,
    receiptName,
    receiptObjectKey: uploadedReceipt?.objectKey,
    receiptContentType: uploadedReceipt?.contentType,
    receiptSize: uploadedReceipt?.size,
    note,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  try {
    const result = await reimbursementClaims().insertOne(claim);
    return toView({ ...claim, _id: result.insertedId }, employee);
  } catch (error) {
    if (uploadedReceipt) {
      await deleteReimbursementReceipt(uploadedReceipt.objectKey).catch(() => undefined);
    }
    throw error;
  }
}

export async function getMyReimbursementClaims(userId: string) {
  const employee = await users().findOne({ userId });
  if (!employee) throw new ReimbursementError(404, 'Employee not found');
  const claims = await reimbursementClaims().find({ userId }).sort({ createdAt: -1 }).toArray();
  return claims.map((claim) => toView(claim, employee));
}

export async function getManagerReimbursementInbox(managerUserId: string) {
  const claims = await reimbursementClaims()
    .find({ managerUserId })
    .sort({ status: -1, createdAt: -1 })
    .toArray();
  const employeeIds = [...new Set(claims.map((claim) => claim.userId))];
  const employees = await users()
    .find({ userId: { $in: employeeIds } })
    .toArray();
  const employeeById = new Map(employees.map((employee) => [employee.userId, employee]));
  return claims.flatMap((claim) => {
    const employee = employeeById.get(claim.userId);
    return employee ? [toView(claim, employee)] : [];
  });
}

/** Org-wide list of every reimbursement claim, for the HR dashboard. */
export async function listAllReimbursementsForAdmin(adminUserId: string) {
  const employees = await orgUsers(adminUserId);
  if (employees.length === 0) return [];
  const employeeById = new Map(employees.map((e) => [e.userId, e]));
  const claims = await reimbursementClaims()
    .find({ userId: { $in: employees.map((e) => e.userId) } })
    .sort({ status: -1, createdAt: -1 })
    .toArray();
  return claims.flatMap((claim) => {
    const employee = employeeById.get(claim.userId);
    return employee ? [toView(claim, employee)] : [];
  });
}

/**
 * Reimbursements are decided ONLY from the HR dashboard (rule 3). A dashboard
 * user decides any pending claim (decidedByRole 'admin'); they cannot decide
 * their own claim (rule 8).
 */
export async function adminDecideReimbursement(
  adminUserId: string,
  claimIdInput: string,
  decisionInput: string,
  managerNote?: string,
) {
  if (!ObjectId.isValid(claimIdInput)) throw new ReimbursementError(400, 'Invalid claim ID');
  const decision = decisionInput.trim().toLowerCase() as ReimbursementStatus;
  if (!decisions.has(decision)) {
    throw new ReimbursementError(400, 'Decision must be approved, declined, or paid');
  }
  const note = managerNote?.trim();
  if (note && note.length > 500) throw new ReimbursementError(400, 'Override note is too long');
  const claimId = new ObjectId(claimIdInput);
  const claim = await reimbursementClaims().findOne({ _id: claimId });
  if (!claim) throw new ReimbursementError(404, 'Reimbursement claim not found');
  if (claim.userId === adminUserId) {
    throw new ReimbursementError(403, 'You cannot decide your own reimbursement claim');
  }
  if (claim.status !== 'pending' && !(claim.status === 'approved' && decision === 'paid')) {
    throw new ReimbursementError(409, 'Reimbursement claim has already been decided');
  }
  const employee = await users().findOne({ userId: claim.userId });
  if (!employee) throw new ReimbursementError(409, 'Claim has an invalid employee');
  const now = new Date();
  const updated = await reimbursementClaims().findOneAndUpdate(
    { _id: claimId, status: claim.status },
    {
      $set: {
        status: decision,
        decidedByUserId: adminUserId,
        decidedByRole: 'admin',
        decidedAt: now,
        updatedAt: now,
        ...(note ? { managerNote: note } : {}),
        ...(decision === 'paid' ? { paidAt: now } : {}),
      },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw new ReimbursementError(409, 'Reimbursement claim has already been decided');
  return toView(updated, employee);
}

/// Presigned URL so the owner, the claim's manager, or a dashboard user can view the bill.
export async function getReceiptDownloadUrl(
  requesterUserId: string,
  claimIdInput: string,
  isDashboardUser = false,
) {
  if (!ObjectId.isValid(claimIdInput)) throw new ReimbursementError(400, 'Invalid claim ID');
  const claim = await reimbursementClaims().findOne({ _id: new ObjectId(claimIdInput) });
  if (!claim) throw new ReimbursementError(404, 'Reimbursement claim not found');
  if (!isDashboardUser && requesterUserId !== claim.userId && requesterUserId !== claim.managerUserId) {
    throw new ReimbursementError(403, 'You are not allowed to view this receipt');
  }
  if (!claim.receiptObjectKey) throw new ReimbursementError(404, 'This claim has no receipt');
  const receiptName = claim.receiptName ?? 'receipt';
  const url = await presignReceiptDownload(claim.receiptObjectKey, receiptName);
  return { url, receiptName, expiresIn: env.s3.presignTtl };
}

function toView(claim: ReimbursementClaim & { _id: ObjectId }, employee: User) {
  return {
    id: claim._id.toHexString(),
    userId: claim.userId,
    employee: {
      name: employee.name,
      department: employee.department ?? employee.designation ?? 'Team',
    },
    expenseDate: claim.expenseDate.toISOString().slice(0, 10),
    amount: claim.amount,
    category: claim.category,
    receiptName: claim.receiptName,
    hasReceipt: Boolean(claim.receiptObjectKey),
    note: claim.note,
    managerNote: claim.managerNote,
    status: claim.status,
    createdAt: claim.createdAt.toISOString(),
    decidedAt: claim.decidedAt?.toISOString(),
    paidAt: claim.paidAt?.toISOString(),
    decidedByRole: claim.decidedByRole,
  };
}

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ReimbursementError(400, 'expenseDate must use YYYY-MM-DD format');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ReimbursementError(400, 'expenseDate is not a valid date');
  }
  return date;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function requireEmployeeWithManager(userId: string) {
  const employee = await users().findOne({ userId });
  if (!employee) throw new ReimbursementError(404, 'Employee not found');
  if (!employee.managerUserId) {
    throw new ReimbursementError(409, 'A manager must be assigned before submitting a claim');
  }
  const manager = await users().findOne({ userId: employee.managerUserId });
  if (!manager || ['offboarded', 'terminated'].includes(manager.lifecycleStatus)) {
    throw new ReimbursementError(409, 'The assigned manager is not active');
  }
  return employee;
}

export class ReimbursementError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
