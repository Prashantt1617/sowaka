import { NextFunction, Request, Response } from 'express';
import {
  assignManager,
  getDirectReports,
  getReportingLine,
  removeManager,
} from '../services/reporting.service';

export async function setEmployeeManager(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await assignManager(
      req.auth!.userId,
      String(req.params.employeeUserId ?? ''),
      String(req.body.managerUserId ?? ''),
    );
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    handleReportingError(error, res, next);
  }
}

export async function clearEmployeeManager(req: Request, res: Response, next: NextFunction) {
  try {
    const employee = await removeManager(req.auth!.userId, String(req.params.employeeUserId ?? ''));
    res.status(200).json({ success: true, employee, manager: null });
  } catch (error) {
    handleReportingError(error, res, next);
  }
}

export async function getEmployeeManager(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getReportingLine(req.auth!.userId, String(req.params.employeeUserId ?? ''));
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    handleReportingError(error, res, next);
  }
}

export async function listManagerEmployees(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getDirectReports(req.auth!.userId, String(req.params.managerUserId ?? ''));
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    handleReportingError(error, res, next);
  }
}

function handleReportingError(error: unknown, res: Response, next: NextFunction) {
  void res;
  next(error);
}
