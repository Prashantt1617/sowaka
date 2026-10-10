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
import { payrollRouter } from './payroll.routes';
import { payslipRouter } from './payslip.routes';
import { kpiRouter } from './kpi.routes';
import { relayRouter } from './relay.routes';
import { relayPlayerRouter } from './relay-player.routes';
import { talkRouter } from './talk.routes';
import { gardenRouter } from './garden.routes';
import { helpRouter } from './help.routes';
import { careRouter } from './care.routes';
import { profileRouter } from './profile.routes';
import { supportAdminRouter, supportRouter } from './support.routes';
import { gamesRouter, playRouter } from './game-catalog.routes';
import { policiesRouter } from './policy-document.routes';

export const router = Router();

router.use('/auth', authRouter);
router.use('/health', healthRouter);
router.use('/holidays', holidayRouter);
// Before `/admin`: the Support desk is gated by a Support role, not by a
// dashboard tab, and has its own auth chain.
router.use('/admin/support', supportAdminRouter);
router.use('/admin', adminRouter);
router.use('/leaves', leaveRouter);
router.use('/payslips', payslipRouter);
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
router.use('/admin/payroll', payrollRouter);
router.use('/admin/kpi', kpiRouter);
router.use('/admin/relay', relayRouter);
router.use('/relay', relayPlayerRouter);
router.use('/talk', talkRouter);
router.use('/garden', gardenRouter);
// The Games tab: which games a company has, their pages and their scores.
router.use('/games', gamesRouter);
router.use('/play', playRouter);
// Actions › View Policies: the company's own policy texts, when it has them.
router.use('/policies', policiesRouter);
router.use('/help', helpRouter);
router.use('/care', careRouter);
router.use('/profile', profileRouter);
router.use('/support', supportRouter);
