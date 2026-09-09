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
import {
  createShiftHandler,
  assignShiftHandler,
  deleteShiftHandler,
  getShiftPolicyHandler,
  shiftAudienceHandler,
  unassignShiftHandler,
  listShiftsHandler,
  saveShiftPolicyHandler,
  updateShiftHandler,
} from '../controllers/shift.controller';
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

// Shifts › Policies — the org-wide setup. The half-day and full-day hour
// thresholds and the late / early-out grace live here, and the app grades every
// attendance day against them. Each tab PATCHes only the fields it owns.
adminRouter.get('/shift-policy', getShiftPolicyHandler);
adminRouter.patch('/shift-policy', saveShiftPolicyHandler);

// Shift templates — the working window a shift opens and closes on, and the
// vehicle a policy gets assigned to people by.
adminRouter.get('/shifts', listShiftsHandler);
adminRouter.post('/shifts', createShiftHandler);
adminRouter.patch('/shifts/:shiftId', updateShiftHandler);
adminRouter.delete('/shifts/:shiftId', deleteShiftHandler);
// Bulk assignment: resolve a rule set to people, then move the chosen ones onto
// the template. Everyone not on a template follows the org policy.
adminRouter.post('/shifts/audience', shiftAudienceHandler);
adminRouter.post('/shifts/:shiftId/assign', assignShiftHandler);
adminRouter.post('/shifts/:shiftId/unassign', unassignShiftHandler);

// Company settings: week-off days + per-team overtime toggle
adminRouter.get('/company/settings', getCompanySettingsHandler);
adminRouter.patch('/company/settings', updateCompanySettingsHandler);

// Overrides / dashboard-only decisions (rules 3, 6, 7, 8)
adminRouter.patch('/leaves/:leaveId/decision', decideLeave);
adminRouter.patch('/overtime/:overtimeId/decision', decideOvertime);
adminRouter.patch('/reimbursements/:claimId/decision', decideReimbursement);
