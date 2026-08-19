import { Router } from 'express';
import { adminRouter } from './admin.routes';
import { authRouter } from './auth.routes';
import { healthRouter } from './health.routes';
import { holidayRouter } from './holiday.routes';
import { leaveRouter } from './leave.routes';
import { connectRouter } from './connect.routes';
import { reportingRouter } from './reporting.routes';
import { managerRouter } from './manager.routes';
import { overtimeRouter } from './overtime.routes';
import { reimbursementRouter } from './reimbursement.routes';
import { payrollRouter } from './payroll.routes';

export const router = Router();

router.use('/auth', authRouter);
router.use('/health', healthRouter);
router.use('/holidays', holidayRouter);
router.use('/admin', adminRouter);
router.use('/leaves', leaveRouter);
router.use('/connect', connectRouter);
router.use('/manager', managerRouter);
router.use('/overtime', overtimeRouter);
router.use('/reimbursements', reimbursementRouter);
router.use('/admin/reporting', reportingRouter);
router.use('/admin/payroll', payrollRouter);
