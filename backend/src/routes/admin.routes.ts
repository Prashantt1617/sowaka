import { Router } from 'express';
import {
  decideLeave,
  decideOvertime,
  decideReimbursement,
  getCompanySettingsHandler,
  createEmployee,
  listEmployees,
  listFeedback,
  listLeaves,
  listOvertime,
  listReimbursements,
  updateCompanySettingsHandler,
  updateOvertimeEligibility,
} from '../controllers/admin.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess } from '../middleware/admin.middleware';
import { adminCreateGame, adminDeleteGame, adminListGames, adminPublishGame, adminUpdateGame } from '../controllers/game.controller';

// HR dashboard surface: org-wide reads + request overrides. Every route requires
// an authenticated user (requireAuth) who additionally has dashboardAccess.
export const adminRouter = Router();
adminRouter.use(requireAuth, requireDashboardAccess);

// Org-wide lists (rule 5)
adminRouter.get('/leaves', listLeaves);
adminRouter.get('/overtime', listOvertime);
adminRouter.get('/reimbursements', listReimbursements);
adminRouter.get('/feedback', listFeedback);
adminRouter.get('/employees', listEmployees);
adminRouter.post('/employees', createEmployee);
// Per-employee overtime eligibility (HR-controlled)
adminRouter.patch('/employees/:userId/overtime-eligibility', updateOvertimeEligibility);
adminRouter.get('/games', adminListGames);
adminRouter.post('/games', adminCreateGame);
adminRouter.patch('/games/:gameId', adminUpdateGame);
adminRouter.delete('/games/:gameId', adminDeleteGame);
adminRouter.post('/games/:gameId/publish', adminPublishGame);

// Company settings: week-off days + per-team overtime toggle
adminRouter.get('/company/settings', getCompanySettingsHandler);
adminRouter.patch('/company/settings', updateCompanySettingsHandler);

// Overrides / dashboard-only decisions (rules 3, 6, 7, 8)
adminRouter.patch('/leaves/:leaveId/decision', decideLeave);
adminRouter.patch('/overtime/:overtimeId/decision', decideOvertime);
adminRouter.patch('/reimbursements/:claimId/decision', decideReimbursement);
