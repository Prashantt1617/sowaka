import type { NextFunction, Request, Response } from 'express';
import { myPayslipCalendar, myPayslipHtml, myPayslips } from '../services/payrollRun.service';

function callerId(req: Request): string {
  return String(req.auth?.userId ?? '');
}

/** The signed-in person's last few payslips, newest first. */
export async function myPayslipsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await myPayslips(callerId(req))) });
  } catch (error) { next(error); }
}

/** One of their slips as the printable document. */
export async function myPayslipHtmlHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, html: await myPayslipHtml(callerId(req), String(req.params.payslipId ?? '')) });
  } catch (error) { next(error); }
}

/** The graded month behind one of their slips — why there was a loss of pay. */
export async function myPayslipCalendarHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, calendar: await myPayslipCalendar(callerId(req), String(req.params.payslipId ?? '')) });
  } catch (error) { next(error); }
}
