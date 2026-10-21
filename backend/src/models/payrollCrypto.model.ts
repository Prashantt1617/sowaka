/**
 * End-to-end encryption state for an org's payroll (see shared/payroll/crypto.ts
 * and docs/PAYROLL_ENCRYPTION.md). The server keeps only public keys, keys
 * sealed under something it never sees (a passphrase, a private key, the
 * recovery key) and ciphertext.
 */
import type { Sealed, UserKeyRecord } from '../shared/payroll/crypto';

export interface PayrollCryptoOrg {
  kind: 'org';
  org: string;
  /** 'encrypted': amounts are stored and computed only sealed. */
  mode: 'encrypted';
  keyVersion: number;
  /** The data key wrapped with the recovery key shown once at setup. */
  recovery: { wrapped: string; iv: string; keyVersion: number };
  /** A rotation in progress: the next key's recovery wrap, until every record has moved. */
  pendingRecovery?: { wrapped: string; iv: string; keyVersion: number };
  /** Someone with a grant lost payroll access: rotate the data key. */
  rotationRequired?: boolean;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayrollCryptoUserKey extends UserKeyRecord {
  kind: 'user_key';
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

export type PayrollCryptoDoc = PayrollCryptoOrg | PayrollCryptoUserKey | PayrollCryptoGrant;

/** A sealed salary structure / payslip / run carries this. */
export type SealedBlob = Sealed;
