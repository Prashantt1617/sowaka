import type { NextFunction, Request, Response } from 'express';
import {
  SupportError,
  assignTicket,
  createTicket,
  getMyTicket,
  getStaffTicket,
  listAssignees,
  listMyTickets,
  listStaffTickets,
  listTopics,
  postEmployeeMessage,
  postStaffMessage,
  requireSupportRole,
  resolveTicket,
  sendBackTicket,
  supportMe,
  type SupportUpload,
} from '../services/support.service';

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

function actor(req: Request) {
  const user = req.auth?.user;
  if (!user) throw new SupportError(401, 'Authentication required');
  return user;
}

function files(req: Request): SupportUpload[] {
  return ((req.files ?? []) as Express.Multer.File[]).map((file) => ({
    originalName: file.originalname,
    contentType: file.mimetype,
    size: file.size,
    bytes: file.buffer,
  }));
}

const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;
const id = (req: Request) => String(req.params.id ?? '');

// App: the employee
export const topicsHandler = handle(() => listTopics());
export const myTicketsHandler = handle((req) => listMyTickets(actor(req)));
export const createTicketHandler = handle((req) => createTicket(actor(req), body(req), files(req)), 201);
export const myTicketHandler = handle((req) => getMyTicket(actor(req), id(req)));
export const employeeMessageHandler = handle((req) => postEmployeeMessage(actor(req), id(req), body(req), files(req)), 201);

// Dashboard: Support heads and staff
export const supportMeHandler = handle((req) => supportMe(actor(req)));
export function requireSupportRoleMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    requireSupportRole(actor(req));
    next();
  } catch (error) {
    next(error);
  }
}
export const staffTicketsHandler = handle((req) => listStaffTickets(actor(req), req.query.view));
export const staffTicketHandler = handle((req) => getStaffTicket(actor(req), id(req)));
export const staffMessageHandler = handle((req) => postStaffMessage(actor(req), id(req), body(req), files(req)), 201);
export const assignHandler = handle((req) => assignTicket(actor(req), id(req), body(req)));
export const sendBackHandler = handle((req) => sendBackTicket(actor(req), id(req), body(req)));
export const resolveHandler = handle((req) => resolveTicket(actor(req), id(req)));
export const assigneesHandler = handle((req) => listAssignees(actor(req)));
