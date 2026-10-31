import type { NextFunction, Request, Response } from 'express';
import { myPayslip, myPayslipCalendar, myPayslipHtml, myPayslips } from '../services/payrollRun.service';

function callerId(req: Request): string {
  return String(req.auth?.userId ?? '');
}

/** The signed-in person's payslips, newest first (3 unless `limit` asks for up to 24). */
export async function myPayslipsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    res.json({ success: true, ...(await myPayslips(callerId(req), limit)) });
  } catch (error) { next(error); }
}

/** One of their slips, as the list shows it. */
export async function myPayslipHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await myPayslip(callerId(req), String(req.params.payslipId ?? ''))) });
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
