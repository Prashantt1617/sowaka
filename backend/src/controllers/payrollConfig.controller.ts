import { NextFunction, Request, Response } from 'express';
import {
  copyStatutoryConfig,
  copyTdsConfig,
  getStatutoryConfig,
  getTdsConfig,
  listStatutoryConfigs,
  listTdsConfigs,
  PayrollConfigError,
  putStatutoryConfig,
  putTdsConfig,
} from '../services/payrollConfig.service';

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new PayrollConfigError(401, 'Authentication required');
  return req.auth.userId;
}

const hasFy = (req: Request) => req.query.fy !== undefined && req.query.fy !== '';

/** GET /admin/payroll/statutory-config[?fy=2026-27] */
export async function getStatutoryConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const viewer = requireUserId(req);
    const body = hasFy(req) ? await getStatutoryConfig(viewer, req.query.fy) : await listStatutoryConfigs(viewer);
    res.status(200).json({ success: true, ...body });
  } catch (error) {
    next(error);
  }
}

/** PUT /admin/payroll/statutory-config?fy=2026-27 */
export async function putStatutoryConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = await putStatutoryConfig(requireUserId(req), req.query.fy, req.body ?? {});
    res.status(200).json({ success: true, ...body });
  } catch (error) {
    next(error);
  }
}

/** POST /admin/payroll/statutory-config?fy=2027-28&copyFrom=2026-27 */
export async function copyStatutoryConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = await copyStatutoryConfig(requireUserId(req), req.query.fy, req.query.copyFrom);
    res.status(200).json({ success: true, ...body });
  } catch (error) {
    next(error);
  }
}

/** GET /admin/payroll/tds-config[?fy=2026-27] */
export async function getTdsConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const viewer = requireUserId(req);
    const body = hasFy(req) ? await getTdsConfig(viewer, req.query.fy) : await listTdsConfigs(viewer);
    res.status(200).json({ success: true, ...body });
  } catch (error) {
    next(error);
  }
}

/** PUT /admin/payroll/tds-config?fy=2026-27&regime=new */
export async function putTdsConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = await putTdsConfig(requireUserId(req), req.query.fy, req.query.regime, req.body ?? {});
    res.status(200).json({ success: true, ...body });
  } catch (error) {
    next(error);
  }
}

/** POST /admin/payroll/tds-config?fy=2027-28&copyFrom=2026-27 */
export async function copyTdsConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = await copyTdsConfig(requireUserId(req), req.query.fy, req.query.copyFrom);
    res.status(200).json({ success: true, ...body });
  } catch (error) {
    next(error);
  }
}
