import { NextFunction, Request, Response } from 'express';
import { SalaryStructureError } from '../services/salaryStructure.service';
import { assignPeopleToTemplate, peopleWithoutSalary } from '../services/salaryTemplatePeople.service';

/** GET /admin/payroll/people-without-salary?period=YYYY-MM — who a run for the period leaves out. */
export async function peopleWithoutSalaryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const period = typeof req.query.period === 'string' ? req.query.period : undefined;
    res.status(200).json({ success: true, ...(await peopleWithoutSalary(requireUserId(req), period)) });
  } catch (error) {
    next(error);
  }
}

/** POST /admin/payroll/salary-templates/:code/people — { people: [{ userId, annualCtcPaise, effectiveFrom }] }. */
export async function assignTemplatePeopleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, ...(await assignPeopleToTemplate(requireUserId(req), String(req.params.code ?? ''), req.body)) });
  } catch (error) {
    next(error);
  }
}

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new SalaryStructureError(401, 'Authentication required');
  return req.auth.userId;
}
