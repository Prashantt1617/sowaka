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
import { notificationRouter } from './notification.routes';
import { attendanceRouter } from './attendance.routes';
import { mediaRouter } from './media.routes';

export const router = Router();

router.use('/auth', authRouter);
router.use('/health', healthRouter);
router.use('/holidays', holidayRouter);
router.use('/admin', adminRouter);
router.use('/leaves', leaveRouter);
// Mounted before the authenticated Connect router: image requests can't carry
// a bearer token, so media is served by unguessable key instead.
router.use('/media', mediaRouter);
router.use('/connect', connectRouter);
router.use('/manager', managerRouter);
router.use('/overtime', overtimeRouter);
router.use('/reimbursements', reimbursementRouter);
router.use('/notifications', notificationRouter);
router.use('/attendance', attendanceRouter);
router.use('/admin/reporting', reportingRouter);
