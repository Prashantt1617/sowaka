import { Router } from 'express';
import {
  getDeclarationHandler, getProofsHandler, getSplitHandler, missingPunchesHandler, payrollHomeHandler, proofFileHandler,
  requirePayrollApp, reviewSplitHandler, salarySummaryHandler, saveDeclarationHandler, saveSplitHandler, uploadProofHandler,
} from '../controllers/employeePayroll.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { uploadInvestmentProofFile } from '../middleware/investment-proof-upload.middleware';

// The app's Payroll screens: the signed-in person's own pay only. No route
// takes a userId, so nobody can ask for someone else's. Contract:
// docs/payroll-employee-api.md.
export const employeePayrollRouter = Router();
employeePayrollRouter.use(requireAuth);
// Home always answers, with `appEnabled`; the rest only while HR has Payroll
// switched on for the company (403, details.reason "payroll_app_off", otherwise).
employeePayrollRouter.get('/home', payrollHomeHandler);
employeePayrollRouter.use(requirePayrollApp);
employeePayrollRouter.get('/missing-punches', missingPunchesHandler);
// One pay period's pay as a receipt, each line explained (default: the previous pay period).
employeePayrollRouter.get('/me/salary', salarySummaryHandler);
employeePayrollRouter.get('/split', getSplitHandler);
employeePayrollRouter.post('/split/review', reviewSplitHandler);
employeePayrollRouter.put('/split', saveSplitHandler);
employeePayrollRouter.get('/tax-declaration', getDeclarationHandler);
employeePayrollRouter.put('/tax-declaration', saveDeclarationHandler);
employeePayrollRouter.get('/investment-proofs', getProofsHandler);
employeePayrollRouter.post('/investment-proofs/:item', uploadInvestmentProofFile, uploadProofHandler);
employeePayrollRouter.get('/investment-proofs/:item/file', proofFileHandler);
