import { ObjectId } from 'mongodb';
import { payHeads, salaryStructures, salaryTemplates, users } from '../config/db';
import { requestViewer } from '../middleware/request-viewer';
import { standardNotAdded } from '../shared/payroll/standard-components';
import {
  CalculationBasis,
  CalculationMode,
  PayHead,
  PayHeadCategory,
  PayHeadComponentType,
  PercentageBase,
  StatutoryConsideration,
} from '../models/payHead.model';

const CATEGORIES = new Set<PayHeadCategory>(['earning', 'deduction', 'benefit', 'reimbursement']);
const COMPONENT_TYPES = new Set<PayHeadComponentType>([
  'basic',
  'hra',
  'conveyance',
  'meal_card',
  'lta',
  'fixed_allowance',
  'special_allowance',
  'medical',
  'telephone',
  'child_education',
  'statutory_bonus',
  'salary_advance',
  'notice_pay',
  'hold_amount',
  'vpf',
  'gratuity',
  'food_coupons',
  'other',
]);
const MODES = new Set<CalculationMode>(['flat_amount', 'percentage', 'flat_per_month']);
const PERCENT_BASES = new Set<PercentageBase>(['ctc', 'basic', 'component']);
// The ceiling is ₹25,000; the old value name is still accepted and renamed.
const CONDITIONS = new Set(['always', 'if_pf_wage_below_ceiling', 'if_pf_wage_below_15000']);

// ₹1,000,000,000 expressed in paise — a generous ceiling that still catches
// obviously-wrong inputs (e.g. rupees entered where paise were expected).
const MAX_AMOUNT_PAISE = 100_000_000_000;

export class PayHeadError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PayHeadError';
  }
}

export interface PayHeadInput {
  name: string;
  code: string;
  category: string;
  componentType: string;
  calculation: unknown;
  considerForEpf?: unknown;
  considerForEsi?: unknown;
  considerForPt?: unknown;
  considerForLwf?: unknown;
  fbp?: unknown;
  recurrence?: unknown;
  prorate?: unknown;
  arrears?: unknown;
  maxClaimablePaise?: unknown;
  unclaimedHandling?: unknown;
  payslipName?: unknown;
  taxable?: unknown;
  partOfStructure?: unknown;
  showInPayslip?: unknown;
  active?: unknown;
}

/**
 * Settings an earning type pins regardless of what the form sends. The
 * dashboard shows these ticked and locked; the server applies them too so a
 * stray client can't store a Basic that skips PF or an HRA kept off the payslip.
 *
 * - Basic: always in the structure, taxable, pro-rated, in the PF wage
 *   (always, no ₹25,000 condition), in the ESI wage and on the payslip.
 * - HRA and Food Coupon (meal card): always in the structure, taxable and on
 *   the payslip; the rest stays the admin's choice.
 */
export const FIXED_EARNING_SETTINGS: Partial<
  Record<
    PayHeadComponentType,
    Partial<Pick<PayHead, 'partOfStructure' | 'taxable' | 'prorate' | 'considerForEpf' | 'considerForEsi' | 'showInPayslip' | 'fbp' | 'recurrence'>>
  >
> = {
  basic: {
    partOfStructure: true,
    taxable: true,
    prorate: true,
    considerForEpf: { consider: true, condition: 'always' },
    considerForEsi: { consider: true },
    showInPayslip: true,
    fbp: false,
    recurrence: 'recurring',
  },
  hra: {
    partOfStructure: true,
    taxable: true,
    showInPayslip: true,
    recurrence: 'recurring',
  },
  // Food Coupon (meal card): the same three; FBP stays forced by the form.
  meal_card: {
    partOfStructure: true,
    taxable: true,
    showInPayslip: true,
    recurrence: 'recurring',
  },
};

/**
 * How each fixed earning may be calculated, mirroring the form's two radio
 * options: a flat monthly amount, or a percentage of one base.
 */
const ALLOWED_PERCENT_BASE: Partial<Record<PayHeadComponentType, PercentageBase>> = {
  basic: 'ctc',
  hra: 'basic',
};

/** Earning types an org may hold only one of. */
const SINGLETON_TYPES = new Set<PayHeadComponentType>(['basic', 'hra']);

export async function listPayHeads(adminUserId: string) {
  const org = await requireAdminOrg(adminUserId);
  const docs = await payHeads().find({ org }).sort({ category: 1, name: 1 }).toArray();
  return docs.map(toView);
}

/** The standard components this org hasn't added: shown next to its own, saved on first use. */
export async function listStandardComponents(adminUserId: string) {
  const org = await requireAdminOrg(adminUserId);
  const own = await payHeads().find({ org }, { projection: { code: 1, componentType: 1 } }).toArray();
  return standardNotAdded(own);
}

export async function getPayHead(adminUserId: string, idInput: string) {
  const org = await requireAdminOrg(adminUserId);
  const doc = await findOwned(org, idInput);
  return toView(doc);
}

export async function createPayHead(adminUserId: string, input: PayHeadInput) {
  const org = await requireAdminOrg(adminUserId);
  const existing = await payHeads().find({ org }).toArray();
  const draft = normalizeInput(input, existing, null);

  const now = new Date();
  const doc: PayHead = { ...draft, org, createdAt: now, updatedAt: now };
  try {
    const result = await payHeads().insertOne(doc);
    return toView({ ...doc, _id: result.insertedId });
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new PayHeadError(409, `A pay head with code "${doc.code}" already exists`);
    }
    throw error;
  }
}

export async function updatePayHead(adminUserId: string, idInput: string, input: PayHeadInput) {
  const org = await requireAdminOrg(adminUserId);
  const current = await findOwned(org, idInput);
  const others = (await payHeads().find({ org }).toArray()).filter(
    (head) => !head._id.equals(current._id),
  );
  // The code is how templates and salaries refer to the component: it never changes.
  const draft = normalizeInput({ ...input, code: current.code }, others, current);

  const updated = await payHeads().findOneAndUpdate(
    { _id: current._id },
    { $set: { ...draft, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new PayHeadError(404, 'Pay head not found');
  return toView(updated);
}

export async function deletePayHead(adminUserId: string, idInput: string) {
  const org = await requireAdminOrg(adminUserId);
  const current = await findOwned(org, idInput);
  const label = current.payslipName ?? current.name;
  // A template that lists this component would quietly lose it on the next
  // run (resolution skips codes no longer in the catalog), so block instead.
  const usedBy = await salaryTemplates()
    .find({ org, 'components.payHeadCode': current.code })
    .project<{ name: string }>({ _id: 0, name: 1 })
    .toArray();
  if (usedBy.length > 0) {
    throw new PayHeadError(
      409,
      `${label} is used in ${usedBy.length === 1 ? 'the salary template' : 'the salary templates'} ${usedBy
        .map((t) => `"${t.name}"`)
        .join(', ')}. Remove it from ${usedBy.length === 1 ? 'that template' : 'those templates'} first.`,
    );
  }
  // A person's own added component, or a per-person amount, refers to it too.
  const people = await salaryStructures().countDocuments({
    org,
    $or: [{ 'overrides.add.payHeadCode': current.code }, { [`componentValues.${current.code}`]: { $exists: true } }],
  });
  if (people > 0) {
    throw new PayHeadError(409, `${label} is on ${people} ${people === 1 ? "person's" : "people's"} salary. Remove it from ${people === 1 ? 'that salary' : 'those salaries'} first.`);
  }
  // Any other component whose percentage references this one would be left
  // dangling — block the delete rather than silently break a calculation.
  // "% of Basic" components depend on Basic the same way.
  const dependents = (await payHeads().find({ org }).toArray()).filter(
    (head) =>
      !head._id.equals(current._id) &&
      head.calculation.mode === 'percentage' &&
      ((head.calculation.base === 'component' && head.calculation.baseComponentCode === current.code) ||
        (head.calculation.base === 'basic' && current.componentType === 'basic')),
  );
  if (dependents.length > 0) {
    throw new PayHeadError(
      409,
      `${label} can't be deleted: ${dependents
        .map((head) => head.payslipName ?? head.name)
        .join(', ')} ${dependents.length === 1 ? 'is' : 'are'} worked out from it.`,
    );
  }
  await payHeads().deleteOne({ _id: current._id });
  return { id: current._id.toHexString(), deleted: true };
}

// ————————————————————————————————————————————————————————————————
// Validation + normalization
// ————————————————————————————————————————————————————————————————

type StoredPayHead = PayHead & { _id: ObjectId };

/**
 * Validate raw input into a persistable PayHead (minus org/timestamps), checking
 * it against the org's other pay heads (`siblings`) for uniqueness, reference
 * resolution, and — the PHM-2 requirement — the absence of circular percentage
 * dependencies. `current` is the record being edited, or null on create.
 */
function normalizeInput(
  input: PayHeadInput,
  siblings: StoredPayHead[],
  current: StoredPayHead | null,
): Omit<PayHead, 'org' | 'createdAt' | 'updatedAt'> {
  const name = requireString(input.name, 'name', 100);
  const code = normalizeCode(input.code);
  const category = requireEnum(input.category, CATEGORIES, 'category') as PayHeadCategory;
  const componentType = requireEnum(
    input.componentType,
    COMPONENT_TYPES,
    'componentType',
  ) as PayHeadComponentType;
  const active = input.active === undefined ? true : Boolean(input.active);

  // At most one Basic per org, so `% of Basic` resolves unambiguously; likewise
  // one HRA, so the HRA exemption has a single component to look at.
  if (SINGLETON_TYPES.has(componentType)) {
    const other = siblings.find((head) => head.componentType === componentType);
    if (other) {
      const label = componentType === 'basic' ? 'A Basic' : 'A House Rent Allowance';
      throw new PayHeadError(409, `${label} component already exists (${other.code})`);
    }
  }

  const calculation = normalizeCalculation(input.calculation, code, siblings);
  const allowedBase = category === 'earning' ? ALLOWED_PERCENT_BASE[componentType] : undefined;
  if (allowedBase) {
    const ok =
      calculation.mode === 'flat_per_month' ||
      (calculation.mode === 'percentage' && calculation.base === allowedBase);
    if (!ok) {
      throw new PayHeadError(
        400,
        `This earning is a flat monthly amount or a percentage of ${allowedBase === 'ctc' ? 'CTC' : 'Basic'}`,
      );
    }
  }
  const fixed = category === 'earning' ? FIXED_EARNING_SETTINGS[componentType] ?? {} : {};

  const draft: Omit<PayHead, 'org' | 'createdAt' | 'updatedAt'> = {
    name,
    code,
    category,
    componentType,
    calculation,
    considerForEpf: normalizeConsideration(input.considerForEpf, 'considerForEpf'),
    considerForEsi: normalizeConsideration(input.considerForEsi, 'considerForEsi'),
    considerForPt: input.considerForPt === undefined ? undefined : Boolean(input.considerForPt),
    considerForLwf: input.considerForLwf === undefined ? undefined : Boolean(input.considerForLwf),
    fbp: input.fbp === undefined ? undefined : Boolean(input.fbp),
    recurrence: normalizeRecurrence(input.recurrence),
    prorate: input.prorate === undefined ? undefined : Boolean(input.prorate),
    arrears: input.arrears === undefined ? undefined : Boolean(input.arrears),
    maxClaimablePaise: normalizeMaxClaimable(input.maxClaimablePaise, category),
    unclaimedHandling:
      category === 'reimbursement' && (input.unclaimedHandling === 'carry_forward' || input.unclaimedHandling === 'encash_monthly')
        ? input.unclaimedHandling
        : undefined,
    payslipName: optionalString(input.payslipName, 'payslipName', 100),
    taxable: input.taxable === undefined ? undefined : Boolean(input.taxable),
    partOfStructure: input.partOfStructure === undefined ? undefined : Boolean(input.partOfStructure),
    showInPayslip: input.showInPayslip === undefined ? undefined : Boolean(input.showInPayslip),
    active,
    ...fixed,
  };

  // Build the post-write graph and reject circular percentage references.
  assertAcyclic(mergeGraph(siblings, { ...draft, _id: current?._id ?? new ObjectId() }));
  return draft;
}

function normalizeCalculation(
  raw: unknown,
  selfCode: string,
  siblings: StoredPayHead[],
): CalculationBasis {
  if (!isRecord(raw)) throw new PayHeadError(400, 'calculation is required');
  const mode = requireEnum(raw.mode, MODES, 'calculation.mode') as CalculationMode;

  if (mode === 'flat_per_month') {
    return { mode, amountPaise: requireAmountPaise(raw.amountPaise, 'calculation.amountPaise') };
  }

  if (mode === 'flat_amount') {
    // Value is set per employee on the Salary Structure — no org-wide amount here.
    // An amount may still be supplied as a default (e.g. seeded structures).
    if (raw.amountPaise === undefined) return { mode };
    return { mode, amountPaise: requireAmountPaise(raw.amountPaise, 'calculation.amountPaise') };
  }

  // mode === 'percentage'
  const percent = requirePercent(raw.percent);
  const base = requireEnum(raw.base, PERCENT_BASES, 'calculation.base') as PercentageBase;

  if (base === 'ctc') return { mode, percent, base };

  if (base === 'basic') {
    const basic = siblings.find((head) => head.componentType === 'basic');
    if (!basic) {
      throw new PayHeadError(
        400,
        'calculation.base "basic" requires a Basic component to exist first',
      );
    }
    return { mode, percent, base };
  }

  // base === 'component'
  const baseComponentCode = normalizeCode(raw.baseComponentCode, 'calculation.baseComponentCode');
  if (baseComponentCode === selfCode) {
    throw new PayHeadError(400, 'A component cannot be a percentage of itself');
  }
  if (!siblings.some((head) => head.code === baseComponentCode)) {
    throw new PayHeadError(400, `calculation.baseComponentCode "${baseComponentCode}" does not exist`);
  }
  return { mode, percent, base, baseComponentCode };
}

/**
 * Detects a circular dependency among percentage-of-component references
 * (PRD §5.3: "That reference has to resolve without circular dependencies").
 * Exported as a pure function so the rule can be exercised in isolation.
 *
 * Edges: a `percentage` component points at whatever it is a percentage of —
 * an explicit `baseComponentCode`, or the Basic component when `base` is
 * `basic`. `ctc` is a root input and adds no edge.
 */
export function assertAcyclic(graph: Array<Pick<PayHead, 'code' | 'componentType' | 'calculation'>>): void {
  const byCode = new Map(graph.map((head) => [head.code, head]));
  const basicCode = graph.find((head) => head.componentType === 'basic')?.code;

  const edgesFrom = (code: string): string | undefined => {
    const head = byCode.get(code);
    if (!head || head.calculation.mode !== 'percentage') return undefined;
    if (head.calculation.base === 'component') return head.calculation.baseComponentCode;
    if (head.calculation.base === 'basic') return basicCode;
    return undefined;
  };

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  const visit = (start: string): void => {
    const stack: string[] = [start];
    const path: string[] = [];
    while (stack.length > 0) {
      const code = stack[stack.length - 1];
      const state = color.get(code) ?? WHITE;
      if (state === WHITE) {
        color.set(code, GREY);
        path.push(code);
        const next = edgesFrom(code);
        if (next && next !== code) {
          const nextState = color.get(next) ?? WHITE;
          if (nextState === GREY) {
            const cycleStart = path.indexOf(next);
            const cycle = [...path.slice(cycleStart), next].join(' → ');
            throw new PayHeadError(400, `Circular calculation dependency: ${cycle}`);
          }
          if (nextState === WHITE) stack.push(next);
        }
      } else {
        if (state === GREY) {
          color.set(code, BLACK);
          if (path[path.length - 1] === code) path.pop();
        }
        stack.pop();
      }
    }
  };

  for (const head of graph) {
    if ((color.get(head.code) ?? WHITE) === WHITE) visit(head.code);
  }
}

function mergeGraph(
  siblings: StoredPayHead[],
  candidate: Omit<PayHead, 'org' | 'createdAt' | 'updatedAt'> & { _id: ObjectId },
): Array<Pick<PayHead, 'code' | 'componentType' | 'calculation'>> {
  const merged = siblings
    .filter((head) => head.code !== candidate.code)
    .map((head) => ({
      code: head.code,
      componentType: head.componentType,
      calculation: head.calculation,
    }));
  merged.push({
    code: candidate.code,
    componentType: candidate.componentType,
    calculation: candidate.calculation,
  });
  return merged;
}

function normalizeConsideration(raw: unknown, field: string): StatutoryConsideration | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'boolean') return { consider: raw };
  if (!isRecord(raw)) throw new PayHeadError(400, `${field} must be a boolean or an object`);
  const consider = Boolean(raw.consider);
  const condition = raw.condition;
  if (condition !== undefined && !CONDITIONS.has(String(condition))) {
    throw new PayHeadError(400, `${field}.condition is invalid`);
  }
  return {
    consider,
    ...(consider && condition !== undefined
      ? {
          condition: (condition === 'if_pf_wage_below_15000'
            ? 'if_pf_wage_below_ceiling'
            : condition) as StatutoryConsideration['condition'],
        }
      : {}),
  };
}

function normalizeRecurrence(raw: unknown): PayHead['recurrence'] {
  if (raw === undefined) return undefined;
  if (raw !== 'recurring' && raw !== 'one_time') {
    throw new PayHeadError(400, 'recurrence must be "recurring" or "one_time"');
  }
  return raw;
}

function normalizeMaxClaimable(raw: unknown, category: PayHeadCategory): number | undefined {
  if (raw === undefined) return undefined;
  if (category !== 'reimbursement') {
    throw new PayHeadError(400, 'maxClaimablePaise applies only to reimbursement components');
  }
  return requireAmountPaise(raw, 'maxClaimablePaise');
}

// ————————————————————————————————————————————————————————————————
// Primitive validators + helpers
// ————————————————————————————————————————————————————————————————

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PayHeadError(400, `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new PayHeadError(400, `${field} is too long`);
  return trimmed;
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new PayHeadError(400, `${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new PayHeadError(400, `${field} is too long`);
  return trimmed || undefined;
}

function normalizeCode(value: unknown, field = 'code'): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PayHeadError(400, `${field} is required`);
  }
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9_]{1,40}$/.test(code)) {
    throw new PayHeadError(400, `${field} must be 1-40 chars of A-Z, 0-9, or underscore`);
  }
  return code;
}

function requireEnum(value: unknown, allowed: Set<string>, field: string): string {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!allowed.has(candidate)) {
    throw new PayHeadError(400, `${field} must be one of: ${[...allowed].join(', ')}`);
  }
  return candidate;
}

function requireAmountPaise(value: unknown, field: string): number {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT_PAISE) {
    throw new PayHeadError(400, `${field} must be a non-negative integer amount in paise`);
  }
  return amount;
}

function requirePercent(value: unknown): number {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new PayHeadError(400, 'calculation.percent must be between 0 and 100');
  }
  return Math.round(percent * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDuplicateKey(error: unknown): boolean {
  return isRecord(error) && (error as { code?: number }).code === 11000;
}

async function findOwned(org: string, idInput: string): Promise<StoredPayHead> {
  if (!ObjectId.isValid(idInput)) throw new PayHeadError(400, 'Invalid pay head ID');
  const doc = await payHeads().findOne({ _id: new ObjectId(idInput), org });
  if (!doc) throw new PayHeadError(404, 'Pay head not found');
  return doc;
}

async function requireAdminOrg(adminUserId: string): Promise<string> {
  const admin = requestViewer(adminUserId) ?? (await users().findOne({ userId: adminUserId }));
  if (!admin) throw new PayHeadError(404, 'User not found');
  if (!admin.org) throw new PayHeadError(409, 'User is not attached to a company');
  return admin.org;
}

function toView(doc: StoredPayHead) {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    code: doc.code,
    category: doc.category,
    componentType: doc.componentType,
    calculation: doc.calculation,
    considerForEpf: doc.considerForEpf,
    considerForEsi: doc.considerForEsi,
    considerForPt: doc.considerForPt,
    considerForLwf: doc.considerForLwf,
    fbp: doc.fbp,
    recurrence: doc.recurrence,
    prorate: doc.prorate,
    arrears: doc.arrears,
    maxClaimablePaise: doc.maxClaimablePaise,
    unclaimedHandling: doc.unclaimedHandling,
    payslipName: doc.payslipName,
    taxable: doc.taxable,
    partOfStructure: doc.partOfStructure,
    showInPayslip: doc.showInPayslip,
    active: doc.active,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
