import { Router } from 'express';
import {
  getDeclarationHandler, getProofsHandler, getSplitHandler, missingPunchesHandler, payrollHomeHandler, proofFileHandler,
  reviewSplitHandler, saveDeclarationHandler, saveSplitHandler, uploadProofHandler,
} from '../controllers/employeePayroll.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { uploadInvestmentProofFile } from '../middleware/investment-proof-upload.middleware';

// The app's Payroll screens: the signed-in person's own pay only. No route
// takes a userId, so nobody can ask for someone else's. Contract:
// docs/payroll-employee-api.md.
export const employeePayrollRouter = Router();
employeePayrollRouter.use(requireAuth);
employeePayrollRouter.get('/home', payrollHomeHandler);
employeePayrollRouter.get('/missing-punches', missingPunchesHandler);
employeePayrollRouter.get('/split', getSplitHandler);
employeePayrollRouter.post('/split/review', reviewSplitHandler);
employeePayrollRouter.put('/split', saveSplitHandler);
employeePayrollRouter.get('/tax-declaration', getDeclarationHandler);
employeePayrollRouter.put('/tax-declaration', saveDeclarationHandler);
employeePayrollRouter.get('/investment-proofs', getProofsHandler);
employeePayrollRouter.post('/investment-proofs/:item', uploadInvestmentProofFile, uploadProofHandler);
employeePayrollRouter.get('/investment-proofs/:item/file', proofFileHandler);
