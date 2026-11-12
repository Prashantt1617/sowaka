/**
 * "Set up your payroll" on the app's Payroll home (`setup` on GET /payroll/home):
 * the five things a person does once so payroll can pay them right — bank
 * account, PAN, tax regime, flexible (FBP) split, PF account (UAN) — each done
 * or not, with the date it is needed by.
 *
 * Bank, PAN and UAN are read from the person's own payment details
 * (employee_payment_details, what HR keeps on the profile's Payment and tax
 * IDs) for presence only: no number, masked or not, leaves this module. The
 * regime is the FY declaration's `chosen` flag and due date; the FBP row is
 * whether they have a flexible split for the FY and the split window's close
 * date. Rows the person cannot act on are left out: bank when HR pays them by
 * cheque or cash, FBP without flexible heads or once the window has closed with
 * nothing split, the regime once the declaration is locked, UAN when PF does
 * not apply to them.
 */
import { employeePaymentDetails, salaryStructures } from '../config/db';
import { statutorySettingsFor } from './statutorySettings.service';

export type SetupKey = 'bank' | 'pan' | 'regime' | 'fbp' | 'uan';

export interface SetupItem {
  key: SetupKey;
  done: boolean;
  /** 'YYYY-MM-DD'; null when HR has not set the date it hangs on. */
  dueOn: string | null;
  /** Pay can't go out right without it (bank, PAN); the rest have a default. */
  required: boolean;
}

export interface PayrollSetup {
  items: SetupItem[];
  done: number;
  total: number;
  /** No payslip has been released to them yet. */
  beforeFirstPayroll: boolean;
}

/** What the home already read, so nothing is fetched twice. */
export interface SetupInputs {
  /** The FY declaration (null while the FY's tax rules are not set up). */
  declaration: { chosen: boolean; locked: boolean; dueOn: string | null } | null;
  /** The split page's state (null without a salary structure). */
  split: { available: boolean; notConfigured: boolean; window: { open: boolean; closesOn: string | null } } | null;
  /** Splits they have saved for the FY the window is in. */
  splitThisYear: number;
  /** The last day of the pay period being paid (payroll_periods); null while not set up. */
  payPeriodEnd: string | null;
  beforeFirstPayroll: boolean;
}

export async function payrollSetupFor(org: string, userId: string, inputs: SetupInputs): Promise<PayrollSetup> {
  const [payment, structure, statutory] = await Promise.all([
    employeePaymentDetails().findOne({ org, userId }, { projection: { _id: 0, payMode: 1, accountNumber: 1, accountLast4: 1, pan: 1, panLast4: 1, uan: 1, uanLast4: 1 } }),
    salaryStructures().findOne({ org, userId }, { projection: { _id: 0, salaryTemplateCode: 1, 'statutory.epf': 1, 'statutory.uan': 1 } }),
    statutorySettingsFor(org),
  ]);
  const has = (...values: (string | undefined)[]) => values.some((v) => typeof v === 'string' && v.length > 0);
  const items: SetupItem[] = [];
  const due = inputs.payPeriodEnd;

  // Paid by cheque or cash: no account needed.
  if (!payment?.payMode || payment.payMode === 'bank_transfer') {
    items.push({ key: 'bank', done: has(payment?.accountNumber, payment?.accountLast4), dueOn: due, required: true });
  }
  items.push({ key: 'pan', done: has(payment?.pan, payment?.panLast4), dueOn: due, required: true });

  const declaration = inputs.declaration;
  if (!declaration || declaration.chosen || !declaration.locked) {
    items.push({ key: 'regime', done: Boolean(declaration?.chosen), dueOn: declaration?.dueOn ?? null, required: false });
  }

  const split = inputs.split;
  if (split?.available && (inputs.splitThisYear > 0 || split.window.open || split.notConfigured)) {
    items.push({ key: 'fbp', done: inputs.splitThisYear > 0, dueOn: split.window.closesOn, required: false });
  }

  // PF as the EPF page decides it: a structure, PF on for the company, not switched off for them.
  const pfApplies = Boolean(structure?.salaryTemplateCode) && statutory.epf.enabled && structure?.statutory?.epf !== false;
  if (pfApplies) {
    items.push({ key: 'uan', done: has(payment?.uan, payment?.uanLast4, structure?.statutory?.uan), dueOn: due, required: false });
  }

  return {
    items,
    done: items.filter((i) => i.done).length,
    total: items.length,
    beforeFirstPayroll: inputs.beforeFirstPayroll,
  };
}
