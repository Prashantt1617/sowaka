import type { NextFunction, Request, Response } from 'express';
import { myMissingPunches, myPayrollHome } from '../services/employeePayroll.home';
import { myEarnings } from '../services/employeePayroll.earnings';
import { mySplit, reviewSplit, saveSplit, splitForHr } from '../services/employeePayroll.split';
import { employeeAppSettingsForHr, setEmployeeAppSettingsForHr } from '../services/employeePayroll.settings';
import { EmployeePayrollError, PAYROLL_APP_OFF, askHr, payrollAppEnabled } from '../services/employeePayroll.common';
import {
  decideProofForHr, listProofsForHr, myDeclaration, myProofFile, myProofs, proofFileForHr, saveMyDeclaration, uploadMyProof,
} from '../services/employeePayroll.declaration';

const callerId = (req: Request) => String(req.auth?.userId ?? '');
const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

type Handler = (req: Request) => Promise<Record<string, unknown>>;
const handle = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, ...(await fn(req)) });
  } catch (error) {
    next(error);
  }
};

/**
 * As handle, for the employee's own routes. A 409 from payroll's setup (the
 * FY's statutory or tax rows, the pay cycle, a salary template HR removed) is
 * nothing the employee can fix: it says so and to ask HR, as the app's and the
 * web's error lines show it.
 */
const mine = (fn: Handler) => handle(async (req) => {
  try {
    return await fn(req);
  } catch (error) {
    const e = error as { statusCode?: unknown; message?: unknown; details?: Record<string, unknown> };
    if (error instanceof EmployeePayrollError || e?.statusCode !== 409 || typeof e.message !== 'string') throw error;
    throw new EmployeePayrollError(409, askHr(e.message), { reason: 'payroll_not_configured', ...(e.details ?? {}) });
  }
});

// —— the signed-in employee's own payroll ——
export const payrollHomeHandler = mine(async (req) => myPayrollHome(callerId(req), req.query.period));
export const missingPunchesHandler = mine(async (req) => myMissingPunches(callerId(req), req.query.period));
export const getSplitHandler = mine(async (req) => ({ split: await mySplit(callerId(req)) }));
export const reviewSplitHandler = mine(async (req) => ({ review: await reviewSplit(callerId(req), body(req)) }));
export const saveSplitHandler = mine(async (req) => ({ split: await saveSplit(callerId(req), body(req)) }));
export const getDeclarationHandler = mine(async (req) => ({ declaration: await myDeclaration(callerId(req), req.query.fy) }));
export const saveDeclarationHandler = mine(async (req) => ({ declaration: await saveMyDeclaration(callerId(req), req.query.fy, body(req)) }));
export const getProofsHandler = mine(async (req) => ({ proofs: await myProofs(callerId(req), req.query.fy) }));
export const uploadProofHandler = mine(async (req) => ({
  item: await uploadMyProof(callerId(req), String(req.params.item ?? ''), req.query.fy, { amountPaise: body(req).amountPaise, file: req.file }),
}));
export const proofFileHandler = mine(async (req) => ({ url: await myProofFile(callerId(req), String(req.params.item ?? ''), req.query.fy) }));
export const earningsHandler = mine(async (req) => ({ earnings: await myEarnings(callerId(req), req.query.fy) }));

// —— HR ——
export const hrListProofsHandler = handle(async (req) =>
  listProofsForHr(callerId(req), { fy: req.query.fy, status: req.query.status, userId: req.query.userId }));
export const hrProofFileHandler = handle(async (req) => ({ url: await proofFileForHr(callerId(req), String(req.params.proofId ?? '')) }));
export const hrDecideProofHandler = handle(async (req) => ({ proof: await decideProofForHr(callerId(req), String(req.params.proofId ?? ''), body(req)) }));
export const hrSplitHandler = handle(async (req) => ({ split: await splitForHr(callerId(req), String(req.params.userId ?? ''), req.query.fy) }));
export const hrGetAppSettingsHandler = handle(async (req) => employeeAppSettingsForHr(callerId(req), req.query.fy));
export const hrSetAppSettingsHandler = handle(async (req) => setEmployeeAppSettingsForHr(callerId(req), req.query.fy, body(req)));

/**
 * The app's Payroll routes other than home answer only once HR has switched
 * Payroll on for the person's company: 403 with `details.reason:
 * "payroll_app_off"` until then. Someone with no company falls through to
 * the route, which says so (409).
 */
export async function requirePayrollApp(req: Request, _res: Response, next: NextFunction) {
  try {
    const org = req.auth?.user?.org;
    if (org && !(await payrollAppEnabled(org))) return next(PAYROLL_APP_OFF());
    next();
  } catch (error) {
    next(error);
  }
}
