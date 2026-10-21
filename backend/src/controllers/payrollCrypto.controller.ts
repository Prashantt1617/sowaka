import { NextFunction, Request, Response } from 'express';
import {
  cryptoStatus,
  grantDataKey,
  myEmployeeKey,
  PayrollCryptoError,
  recoverAccess,
  registerEmployeeKey,
  registerMyKey,
  rotateDataKey,
  setupOrgCrypto,
} from '../services/payrollCrypto.service';
import {
  calcContext,
  listSealedDeclarations,
  listSealedStructures,
  mySealedPayslips,
  runInputs,
  saveSealedRun,
  saveSealedStructure,
} from '../services/sealedPayroll.service';

function uid(req: Request): string {
  if (!req.auth?.userId) throw new PayrollCryptoError(401, 'Authentication required');
  return req.auth.userId;
}
const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;
const wrap = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, ...(await fn(req) as object) });
  } catch (error) {
    next(error);
  }
};

export const cryptoStatusHandler = wrap(async (req) => ({ crypto: await cryptoStatus(uid(req)) }));
export const registerKeyHandler = wrap(async (req) => ({ crypto: await registerMyKey(uid(req), body(req).key) }));
export const setupHandler = wrap(async (req) => ({ crypto: await setupOrgCrypto(uid(req), body(req)) }));
export const recoverHandler = wrap(async (req) => ({ crypto: await recoverAccess(uid(req), body(req)) }));
export const grantHandler = wrap(async (req) => ({ crypto: await grantDataKey(uid(req), body(req).grants) }));
export const rotateHandler = wrap(async (req) => ({ crypto: await rotateDataKey(uid(req), body(req)) }));
export const contextHandler = wrap(async (req) => ({ context: await calcContext(uid(req), req.query.period ? String(req.query.period) : undefined) }));
export const sealedStructuresHandler = wrap(async (req) => ({ structures: await listSealedStructures(uid(req)) }));
export const saveSealedStructureHandler = wrap(async (req) => ({ structure: await saveSealedStructure(uid(req), String(req.params.userId ?? ''), body(req)) }));
export const runInputsHandler = wrap(async (req) => ({ inputs: await runInputs(uid(req), String(req.query.period ?? '')) }));
export const saveSealedRunHandler = wrap(async (req) => saveSealedRun(uid(req), body(req)));
export const sealedDeclarationsHandler = wrap(async (req) => ({ declarations: await listSealedDeclarations(uid(req)) }));

// An employee's own key and sealed payslips (the app).
export const myPayslipKeyHandler = wrap(async (req) => ({ key: await myEmployeeKey(uid(req)) }));
export const registerMyPayslipKeyHandler = wrap(async (req) => ({ key: await registerEmployeeKey(uid(req), body(req).key) }));
export const mySealedPayslipsHandler = wrap(async (req) => mySealedPayslips(uid(req)));
