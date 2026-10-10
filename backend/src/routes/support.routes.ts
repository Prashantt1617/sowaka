import { Router } from 'express';
import {
  assignHandler,
  assigneesHandler,
  createTicketHandler,
  employeeMessageHandler,
  myTicketHandler,
  myTicketsHandler,
  requireSupportRoleMiddleware,
  resolveHandler,
  sendBackHandler,
  staffMessageHandler,
  staffTicketHandler,
  staffTicketsHandler,
  supportMeHandler,
  topicsHandler,
} from '../controllers/support.controller';
import { requireDashboardAccess } from '../middleware/admin.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { uploadSupportFiles } from '../middleware/support-upload.middleware';

/** App: an employee's own Support desk tickets. Mounted at `/support`. */
export const supportRouter = Router();
supportRouter.use(requireAuth);
supportRouter.get('/topics', topicsHandler);
supportRouter.get('/tickets', myTicketsHandler);
supportRouter.post('/tickets', uploadSupportFiles, createTicketHandler);
supportRouter.get('/tickets/:id', myTicketHandler);
supportRouter.post('/tickets/:id/messages', uploadSupportFiles, employeeMessageHandler);

/**
 * Dashboard: the Support desk. Mounted at `/admin/support`. Dashboard access
 * plus a Support role (head or staff); `me` answers without a role so the
 * dashboard can decide whether to draw the tab. Not a tab key: the role is the
 * gate, and the service checks it again on every ticket.
 */
export const supportAdminRouter = Router();
supportAdminRouter.use(requireAuth, requireDashboardAccess);
supportAdminRouter.get('/me', supportMeHandler);
supportAdminRouter.use(requireSupportRoleMiddleware);
supportAdminRouter.get('/tickets', staffTicketsHandler);
supportAdminRouter.get('/assignees', assigneesHandler);
supportAdminRouter.get('/tickets/:id', staffTicketHandler);
supportAdminRouter.post('/tickets/:id/messages', uploadSupportFiles, staffMessageHandler);
supportAdminRouter.post('/tickets/:id/assign', assignHandler);
supportAdminRouter.post('/tickets/:id/send-back', sendBackHandler);
supportAdminRouter.post('/tickets/:id/resolve', resolveHandler);
