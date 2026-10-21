/**
 * An employee's payout and tax identifiers. The account number, PAN and UAN
 * are stored encrypted (services/fieldCrypto.ts) with only their last four
 * characters in clear for the masked view. Bank name, IFSC and account type
 * are not secret and stay plain.
 */
export interface EmployeePaymentDetails {
  org: string;
  userId: string;
  payMode?: 'bank_transfer' | 'cheque' | 'cash';
  bankName?: string;
  accountHolder?: string;
  accountType?: 'savings' | 'current';
  ifsc?: string;
  /** Encrypted. */
  accountNumber?: string;
  accountLast4?: string;
  /** Encrypted. */
  pan?: string;
  panLast4?: string;
  /** Encrypted. */
  uan?: string;
  uanLast4?: string;
  updatedAt: Date;
  updatedByUserId: string;
}
