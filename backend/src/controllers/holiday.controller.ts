import { NextFunction, Request, Response } from 'express';
import {
  bulkUploadCompanyHolidays,
  createCompanyHoliday,
  deleteCompanyHoliday,
  HolidayError,
  listCompanyHolidays,
} from '../services/holiday.service';

export async function listHolidays(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({
      success: true,
      holidays: await listCompanyHolidays(requireUserId(req), {
        state: req.query.state == null ? undefined : String(req.query.state),
      }),
    });
  } catch (error) {
    handleHolidayError(error, res, next);
  }
}

export async function createHoliday(req: Request, res: Response, next: NextFunction) {
  try {
    const holiday = await createCompanyHoliday(requireUserId(req), {
      date: String(req.body.date ?? ''),
      name: String(req.body.name ?? ''),
      state: String(req.body.state ?? ''),
      type: req.body.type == null ? undefined : String(req.body.type),
      org: req.body.org == null ? undefined : String(req.body.org),
    });
    res.status(201).json({ success: true, holiday });
  } catch (error) {
    handleHolidayError(error, res, next);
  }
}

export async function removeHoliday(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteCompanyHoliday(requireUserId(req), String(req.params.holidayId ?? ''));
    res.status(204).send();
  } catch (error) {
    handleHolidayError(error, res, next);
  }
}

export async function uploadHolidays(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new HolidayError(400, 'Holiday upload file is required');
    const result = await bulkUploadCompanyHolidays(requireUserId(req), {
      state: String(req.body.state ?? ''),
      org: req.body.org == null ? undefined : String(req.body.org),
      fileName: req.file.originalname,
      bytes: req.file.buffer,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    handleHolidayError(error, res, next);
  }
}

function requireUserId(req: Request): string {
  if (!req.auth?.userId) {
    throw new HolidayError(401, 'Authentication required');
  }
  return req.auth.userId;
}

function handleHolidayError(error: unknown, res: Response, next: NextFunction) {
  void res;
  next(error);
}
