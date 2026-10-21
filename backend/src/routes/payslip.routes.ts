import { Router } from 'express';
import { myPayslipCalendarHandler, myPayslipHtmlHandler, myPayslipsHandler } from '../controllers/payslip.controller';
import { myPayslipKeyHandler, mySealedPayslipsHandler, registerMyPayslipKeyHandler } from '../controllers/payrollCrypto.controller';
import { requireAuth } from '../middleware/auth.middleware';

// An employee's own payslips: what the app's "Manage payslips" reads.
export const payslipRouter = Router();
payslipRouter.use(requireAuth);
payslipRouter.get('/mine', myPayslipsHandler);
// End-to-end encrypted orgs: the payslips sealed to the employee's own key,
// and that key (its private half sealed under their passphrase). The app
// opens them; the server can't. See docs/PAYROLL_ENCRYPTION.md.
payslipRouter.get('/mine/sealed', mySealedPayslipsHandler);
payslipRouter.get('/key', myPayslipKeyHandler);
payslipRouter.put('/key', registerMyPayslipKeyHandler);
payslipRouter.get('/:payslipId/html', myPayslipHtmlHandler);
payslipRouter.get('/:payslipId/calendar', myPayslipCalendarHandler);
