import { NextFunction, Request, Response } from 'express';
import { EmployeePaymentError, getPaymentDetails, setPaymentDetails } from '../services/employeePayment.service';

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new EmployeePaymentError(401, 'Authentication required');
  return req.auth.userId;
}

export async function getPaymentDetailsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, details: await getPaymentDetails(requireUserId(req), String(req.params.userId ?? '')) });
  } catch (error) {
    next(error);
  }
}

export async function setPaymentDetailsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.status(200).json({ success: true, details: await setPaymentDetails(requireUserId(req), String(req.params.userId ?? ''), body) });
  } catch (error) {
    next(error);
  }
}
