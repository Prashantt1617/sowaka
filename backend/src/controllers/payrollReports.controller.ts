import { NextFunction, Request, Response } from 'express';
import { liabilitySummary, paymentDetails, payrollDashboard, payrollSummary, ptAnnualReturn, ptSummary, salaryRegister } from '../services/payrollReports.service';
import { PayrollRunError } from '../services/payrollRun.service';

function userIdOf(req: Request): string {
  if (!req.auth?.userId) throw new PayrollRunError(401, 'Authentication required');
  return req.auth.userId;
}
const drafts = (req: Request) => ({ includeDrafts: req.query.includeDrafts === 'true' });

const handle = (fn: (req: Request) => Promise<object>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, report: await fn(req) });
  } catch (error) {
    next(error);
  }
};

export const payrollDashboardHandler = handle((req) => payrollDashboard(userIdOf(req), req.query.range, drafts(req)));
export const payrollSummaryHandler = handle((req) => payrollSummary(userIdOf(req), req.query.from, req.query.to, drafts(req)));
export const salaryRegisterHandler = handle((req) => salaryRegister(userIdOf(req), req.query.period, drafts(req)));
export const liabilitySummaryHandler = handle((req) => liabilitySummary(userIdOf(req), req.query.from, req.query.to, drafts(req)));
export const ptSummaryHandler = handle((req) => ptSummary(userIdOf(req), req.query.period, drafts(req)));
export const ptAnnualReturnHandler = handle((req) => ptAnnualReturn(userIdOf(req), req.query.fy, drafts(req)));
export const paymentDetailsHandler = handle((req) => paymentDetails(userIdOf(req), String(req.params.runId ?? '')));
