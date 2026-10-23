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
import { gamesRouter, playRouter, squadWebRouter } from './game-catalog.routes';
import { cupRouter } from './cup.routes';
import { policiesRouter } from './policy-document.routes';
import { appPagesRouter } from './app-page.routes';
import { appUpdateRouter } from './app-update.routes';
import { suwiRouter } from '../suwi/routes';
import { suwiPeopleRouter } from '../suwi/routes.people';
import { suwiNoticesRouter } from '../suwi/routes.notices';

export const router = Router();

router.use('/auth', authRouter);
// Suwi, the HR assistant: dashboard users only; each tool checks the asker's tabs.
router.use('/suwi', suwiRouter);
router.use('/suwi', suwiPeopleRouter);
router.use('/suwi', suwiNoticesRouter);
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
// Secret Squad opened in a phone browser (signs in by email code itself).
router.use('/squad', squadWebRouter);
// The Diwali Cup's page and its API, signed in by ticket (see cup.service).
router.use('/cup', cupRouter);
// Pages the app shows inside a tab (the Games home), when on for the company.
router.use('/app-pages', appPagesRouter);
// Whether the app must, or may, update: set per company by Sowaka.
router.use('/app', appUpdateRouter);
// Actions › View Policies: the company's own policy texts, when it has them.
router.use('/policies', policiesRouter);
router.use('/help', helpRouter);
router.use('/care', careRouter);
router.use('/profile', profileRouter);
router.use('/support', supportRouter);
