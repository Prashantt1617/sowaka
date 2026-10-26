import { Router } from 'express';
import {
  adminClientsHandler,
  adminCustomersHandler,
  adminDeleteClientHandler,
  adminDeleteCustomerHandler,
  adminDeletePlacementHandler,
  adminPlacementsHandler,
  adminRestoreCustomerHandler,
  adminUpdateClientHandler,
  adminUpdateCustomerHandler,
  adminUpdatePlacementHandler,
  clientHandler,
  clientsHandler,
  createClientHandler,
  createCustomerHandler,
  createPlacementHandler,
  customerHandler,
  customersHandler,
  deleteClientHandler,
  placementsHandler,
  removeCustomerHandler,
  requirePlacementsMiddleware,
  summaryHandler,
  updateClientHandler,
  updateCustomerHandler,
  updatePlacementHandler,
} from '../controllers/placements.controller';
import { requireDashboardAccess, requireDashboardTabs } from '../middleware/admin.middleware';
import { requireAuth } from '../middleware/auth.middleware';

/**
 * App: Actions › Placements. Mounted at `/placements`. Anyone signed in at a
 * company that has Placements; every other company gets 403. See
 * docs/placements-api.md.
 */
export const placementsRouter = Router();
placementsRouter.use(requireAuth, requirePlacementsMiddleware);
placementsRouter.get('/summary', summaryHandler);
placementsRouter.get('/clients', clientsHandler);
placementsRouter.post('/clients', createClientHandler);
placementsRouter.get('/clients/:id', clientHandler);
placementsRouter.patch('/clients/:id', updateClientHandler);
placementsRouter.delete('/clients/:id', deleteClientHandler);
placementsRouter.get('/customers', customersHandler);
placementsRouter.post('/customers', createCustomerHandler);
placementsRouter.get('/customers/:id', customerHandler);
placementsRouter.patch('/customers/:id', updateCustomerHandler);
placementsRouter.post('/customers/:id/remove', removeCustomerHandler);
placementsRouter.get('/', placementsHandler);
placementsRouter.post('/', createPlacementHandler);
placementsRouter.patch('/:id', updatePlacementHandler);

/**
 * Dashboard: the Placements section. Mounted at `/admin/placements`, behind
 * the `placements` tab as well as the company's switch.
 */
export const placementsAdminRouter = Router();
placementsAdminRouter.use(requireAuth, requireDashboardAccess, requireDashboardTabs, requirePlacementsMiddleware);
placementsAdminRouter.get('/summary', summaryHandler);
placementsAdminRouter.get('/clients', adminClientsHandler);
placementsAdminRouter.post('/clients', createClientHandler);
placementsAdminRouter.patch('/clients/:id', adminUpdateClientHandler);
placementsAdminRouter.delete('/clients/:id', adminDeleteClientHandler);
placementsAdminRouter.get('/customers', adminCustomersHandler);
placementsAdminRouter.post('/customers', createCustomerHandler);
placementsAdminRouter.patch('/customers/:id', adminUpdateCustomerHandler);
placementsAdminRouter.post('/customers/:id/restore', adminRestoreCustomerHandler);
placementsAdminRouter.delete('/customers/:id', adminDeleteCustomerHandler);
placementsAdminRouter.get('/', adminPlacementsHandler);
placementsAdminRouter.post('/', createPlacementHandler);
placementsAdminRouter.patch('/:id', adminUpdatePlacementHandler);
placementsAdminRouter.delete('/:id', adminDeletePlacementHandler);
