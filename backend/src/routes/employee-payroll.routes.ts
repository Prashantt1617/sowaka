import { Router } from 'express';
import {
  fbpBillFileHandler, getFbpHandler, getFbpHeadHandler, uploadFbpBillHandler,
} from '../controllers/employeePayroll.controller';
import {
  earningsHandler, getDeclarationHandler, getProofsHandler, myEpfHandler, setMyEpfBalanceHandler, getSplitHandler, missingPunchesHandler, payrollHomeHandler, proofFileHandler,
  requirePayrollApp, reviewSplitHandler, salarySummaryHandler, saveDeclarationHandler, saveSplitHandler, taxSummaryHandler, uploadProofHandler,
} from '../controllers/employeePayroll.controller';
import { myForm16FileHandler, myForm16Handler } from '../controllers/form16.controller';
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
employeePayrollRouter.get('/me/earnings', earningsHandler);
// EPF: PF put in through payroll, a balance typed in from the EPFO passbook, this month's split, their own UAN.
employeePayrollRouter.get('/me/epf', myEpfHandler);
employeePayrollRouter.put('/me/epf/balance', setMyEpfBalanceHandler);
employeePayrollRouter.get('/split', getSplitHandler);
employeePayrollRouter.post('/split/review', reviewSplitHandler);
employeePayrollRouter.put('/split', saveSplitHandler);
employeePayrollRouter.get('/tax-declaration', getDeclarationHandler);
employeePayrollRouter.put('/tax-declaration', saveDeclarationHandler);
employeePayrollRouter.get('/me/tax', taxSummaryHandler);
employeePayrollRouter.get('/investment-proofs', getProofsHandler);
employeePayrollRouter.post('/investment-proofs/:item', uploadInvestmentProofFile, uploadProofHandler);
employeePayrollRouter.get('/investment-proofs/:item/file', proofFileHandler);
// FBP: the month's split, each head's bills this FY, and a month's bill
// (multipart: the file as `proof`, PDF/JPEG/PNG up to 5 MB, and `period`, `amountPaise`).
employeePayrollRouter.get('/me/fbp', getFbpHandler);
employeePayrollRouter.get('/me/fbp/bills/:billId/file', fbpBillFileHandler);
employeePayrollRouter.get('/me/fbp/:code', getFbpHeadHandler);
employeePayrollRouter.post('/me/fbp/:code/bills', uploadInvestmentProofFile, uploadFbpBillHandler);
// Downloads › Form 16: the person's years, and a short-lived link to one file.
employeePayrollRouter.get('/form16', myForm16Handler);
employeePayrollRouter.get('/form16/:documentId/file', myForm16FileHandler);
