/**
 * End-to-end encryption state for an org's payroll (see shared/payroll/crypto.ts
 * and docs/PAYROLL_ENCRYPTION.md). The server keeps only public keys, keys
 * sealed under something it never sees (a passphrase, a private key, the
 * recovery key) and ciphertext.
 */
import type { OrgRecovery, Sealed, UserKeyRecord } from '../shared/payroll/crypto';

export interface PayrollCryptoOrg {
  kind: 'org';
  org: string;
  /** 'encrypted': amounts are stored and computed only sealed. */
  mode: 'encrypted';
  keyVersion: number;
  /** The recovery keypair (private half under the recovery key) and the data key wrapped to it. */
  recovery: OrgRecovery;
  /** A rotation in progress: the next key's recovery wrap, until every record has moved. */
  pendingRecovery?: OrgRecovery;
  /** Someone with a grant lost payroll access: rotate the data key before anything new is sealed. */
  rotationRequired?: boolean;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A payroll user's keypair, the private half sealed under their passphrase. */
export interface PayrollCryptoUserKey extends UserKeyRecord {
  kind: 'user_key';
  org: string;
  userId: string;
  createdAt: Date;
}

/** An employee's own keypair, for reading their payslips (the app makes it). */
export interface PayrollCryptoEmployeeKey extends UserKeyRecord {
  kind: 'employee_key';
  org: string;
  userId: string;
  createdAt: Date;
}

export interface PayrollCryptoGrant {
  kind: 'grant';
  org: string;
  userId: string;
  keyVersion: number;
  /** The data key wrapped to this user's public key. */
  wrappedDataKey: string;
  grantedByUserId: string;
  createdAt: Date;
}

export type PayrollCryptoDoc = PayrollCryptoOrg | PayrollCryptoUserKey | PayrollCryptoEmployeeKey | PayrollCryptoGrant;

/** A sealed salary structure / payslip / run carries this. */
export type SealedBlob = Sealed;
