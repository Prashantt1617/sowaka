import { Router } from 'express';
import { myPayslipCalendarHandler, myPayslipHandler, myPayslipHtmlHandler, myPayslipsHandler } from '../controllers/payslip.controller';
import { requireAuth } from '../middleware/auth.middleware';

// An employee's own payslips: what the app's "Manage payslips" reads.
export const payslipRouter = Router();
payslipRouter.use(requireAuth);
payslipRouter.get('/mine', myPayslipsHandler);
payslipRouter.get('/:payslipId', myPayslipHandler);
payslipRouter.get('/:payslipId/html', myPayslipHtmlHandler);
payslipRouter.get('/:payslipId/calendar', myPayslipCalendarHandler);
