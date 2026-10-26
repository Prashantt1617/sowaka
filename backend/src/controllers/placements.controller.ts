import type { NextFunction, Request, Response } from 'express';
import {
  PlacementsError,
  createClient,
  createCustomer,
  createPlacement,
  deleteClient,
  deleteCustomer,
  deletePlacement,
  listClients,
  listClientsForAdmin,
  listCustomers,
  listCustomersForAdmin,
  listPlacements,
  listPlacementsForAdmin,
  placementsSummary,
  requirePlacementsOn,
  updateClient,
  updateCustomer,
  updatePlacement,
  type PlacementsCaller,
} from '../services/placements.service';

type Handler = (req: Request) => Promise<Record<string, unknown>> | Record<string, unknown>;

/** Every handler answers `{ success: true, ...result }`, errors go to the error middleware. */
function handle(fn: Handler, status = 200) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json({ success: true, ...(await fn(req)) });
    } catch (error) {
      next(error);
    }
  };
}

function caller(req: Request): PlacementsCaller {
  const user = req.auth?.user;
  if (!user) throw new PlacementsError(401, 'Authentication required');
  if (!user.org) throw new PlacementsError(409, 'Your account is not attached to a company');
  return { userId: user.userId, org: user.org, admin: user.dashboardAdmin === true };
}

/** After `requireAuth`: every Placements route, app or dashboard, needs the company to have it. */
export async function requirePlacementsMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    await requirePlacementsOn(caller(req).org);
    next();
  } catch (error) {
    next(error);
  }
}

const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: Request) => req.query as Record<string, unknown>;
const id = (req: Request) => String(req.params.id ?? '');

// Both
export const summaryHandler = handle((req) => placementsSummary(caller(req)));
export const createClientHandler = handle(async (req) => ({ client: await createClient(caller(req), body(req)) }), 201);
export const createCustomerHandler = handle(async (req) => ({ customer: await createCustomer(caller(req), body(req)) }), 201);
export const createPlacementHandler = handle(async (req) => ({ placement: await createPlacement(caller(req), body(req)) }), 201);

// App
export const clientsHandler = handle(async (req) => ({ clients: await listClients(caller(req), query(req)) }));
export const customersHandler = handle(async (req) => ({ customers: await listCustomers(caller(req), query(req)) }));
export const placementsHandler = handle(async (req) => ({ placements: await listPlacements(caller(req), query(req)) }));
export const updatePlacementHandler = handle(async (req) => ({ placement: await updatePlacement(caller(req), id(req), body(req)) }));

// Dashboard
export const adminClientsHandler = handle(async (req) => ({ clients: await listClientsForAdmin(caller(req), query(req)) }));
export const adminUpdateClientHandler = handle(async (req) => ({ client: await updateClient(caller(req), id(req), body(req)) }));
export const adminDeleteClientHandler = handle(async (req) => {
  await deleteClient(caller(req), id(req));
  return {};
});
export const adminCustomersHandler = handle(async (req) => ({ customers: await listCustomersForAdmin(caller(req), query(req)) }));
export const adminUpdateCustomerHandler = handle(async (req) => ({ customer: await updateCustomer(caller(req), id(req), body(req)) }));
export const adminDeleteCustomerHandler = handle(async (req) => {
  await deleteCustomer(caller(req), id(req));
  return {};
});
export const adminPlacementsHandler = handle(async (req) => ({ placements: await listPlacementsForAdmin(caller(req), query(req)) }));
export const adminUpdatePlacementHandler = handle(async (req) => ({ placement: await updatePlacement(caller(req), id(req), body(req), true) }));
export const adminDeletePlacementHandler = handle(async (req) => {
  await deletePlacement(caller(req), id(req));
  return {};
});
