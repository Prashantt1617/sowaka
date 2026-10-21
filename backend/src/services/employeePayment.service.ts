/**
 * An employee's bank account, PAN and UAN. Stored encrypted field by field;
 * shown in full only to people with payroll access (hasPayrollAccess), and
 * masked to the last four characters to anyone else who can open the profile.
 */
import { employeePaymentDetails, users } from '../config/db';
import { EmployeePaymentDetails } from '../models/employeePayment.model';
import { decryptField, encryptField, fieldKeyConfigured, FieldCryptoError, maskTail } from './fieldCrypto';
import { hasPayrollAccess } from './payrollAccess.service';

export class EmployeePaymentError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'EmployeePaymentError';
  }
}

export interface PaymentDetailsView {
  payMode?: string;
  bankName?: string;
  accountHolder?: string;
  accountType?: string;
  ifsc?: string;
  accountNumber?: string;
  pan?: string;
  uan?: string;
  /** False: the identifiers above are masked ("•••• 1234"). */
  unmasked: boolean;
  /** Whether this viewer may change them. */
  canEdit: boolean;
  updatedAt?: string;
}

async function context(viewerUserId: string, userId: string) {
  const viewer = await users().findOne({ userId: viewerUserId }, { projection: { _id: 0, org: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1 } });
  if (!viewer?.org) throw new EmployeePaymentError(403, 'No organisation on this account');
  const employee = await users().findOne({ userId }, { projection: { _id: 0, org: 1, name: 1 } });
  if (!employee || employee.org !== viewer.org) throw new EmployeePaymentError(404, 'Employee not found');
  return { org: viewer.org, payroll: hasPayrollAccess(viewer) };
}

function view(doc: EmployeePaymentDetails | null, payroll: boolean): PaymentDetailsView {
  const reveal = payroll && fieldKeyConfigured();
  const secret = (enc: string | undefined, last4: string | undefined) => {
    if (!enc) return undefined;
    if (!reveal) return maskTail(last4);
    try {
      return decryptField(enc);
    } catch {
      return maskTail(last4); // a key rotated without re-encrypting: never fail the profile
    }
  };
  return {
    payMode: doc?.payMode,
    bankName: doc?.bankName,
    accountHolder: doc?.accountHolder,
    accountType: doc?.accountType,
    ifsc: doc?.ifsc,
    accountNumber: secret(doc?.accountNumber, doc?.accountLast4),
    pan: secret(doc?.pan, doc?.panLast4),
    uan: secret(doc?.uan, doc?.uanLast4),
    unmasked: reveal,
    canEdit: payroll,
    updatedAt: doc?.updatedAt?.toISOString(),
  };
}

export async function getPaymentDetails(viewerUserId: string, userId: string): Promise<PaymentDetailsView> {
  const { org, payroll } = await context(viewerUserId, userId);
  return view(await employeePaymentDetails().findOne({ org, userId }), payroll);
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

/** Set any of the fields; an empty string clears one. Payroll access only. */
export async function setPaymentDetails(viewerUserId: string, userId: string, input: Record<string, unknown>): Promise<PaymentDetailsView> {
  const { org, payroll } = await context(viewerUserId, userId);
  if (!payroll) throw new EmployeePaymentError(403, 'Only people with payroll access can change bank, PAN or UAN details');
  if (!fieldKeyConfigured()) throw new EmployeePaymentError(503, new FieldCryptoError('PAYROLL_FIELD_KEY is not set').message);
  const set: Partial<EmployeePaymentDetails> = {};
  const unset: Record<string, ''> = {};
  const plain = (field: 'bankName' | 'accountHolder', max: number) => {
    const v = text(input[field], max);
    if (v === undefined) return;
    if (v) set[field] = v;
    else unset[field] = '';
  };
  plain('bankName', 80);
  plain('accountHolder', 120);
  if (input.payMode !== undefined) {
    if (!['bank_transfer', 'cheque', 'cash'].includes(String(input.payMode))) throw new EmployeePaymentError(400, 'payMode must be bank_transfer, cheque or cash');
    set.payMode = input.payMode as EmployeePaymentDetails['payMode'];
  }
  if (input.accountType !== undefined) {
    if (!['savings', 'current'].includes(String(input.accountType))) throw new EmployeePaymentError(400, 'accountType must be savings or current');
    set.accountType = input.accountType as EmployeePaymentDetails['accountType'];
  }
  const ifsc = text(input.ifsc, 11)?.toUpperCase();
  if (ifsc !== undefined) {
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new EmployeePaymentError(400, 'IFSC is 4 letters, a zero, then 6 letters or digits');
    if (ifsc) set.ifsc = ifsc;
    else unset.ifsc = '';
  }
  // A masked value sent back unchanged ("•••• 1234") leaves the stored one alone.
  const secret = (field: 'accountNumber' | 'pan' | 'uan', last4: 'accountLast4' | 'panLast4' | 'uanLast4', re: RegExp, message: string, upper = false) => {
    let v = text(input[field], 34);
    if (v === undefined || v.includes('•')) return;
    v = v.replace(/\s+/g, '');
    if (upper) v = v.toUpperCase();
    if (!v) {
      unset[field] = '';
      unset[last4] = '';
      return;
    }
    if (!re.test(v)) throw new EmployeePaymentError(400, message);
    set[field] = encryptField(v);
    set[last4] = v.slice(-4);
  };
  secret('accountNumber', 'accountLast4', /^\d{9,18}$/, 'Account number is 9 to 18 digits');
  secret('pan', 'panLast4', /^[A-Z]{5}\d{4}[A-Z]$/, 'PAN is 5 letters, 4 digits, a letter (e.g. ABCDE1234F)', true);
  secret('uan', 'uanLast4', /^\d{12}$/, 'UAN is 12 digits');
  await employeePaymentDetails().updateOne(
    { org, userId },
    { $set: { ...set, org, userId, updatedAt: new Date(), updatedByUserId: viewerUserId }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { upsert: true },
  );
  return getPaymentDetails(viewerUserId, userId);
}
