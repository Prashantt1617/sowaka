import type { NextFunction, Request, Response } from 'express';
import {
  bulkUploadForm16ForHr, deleteForm16ForHr, form16FileForHr, form16ForHr, myForm16, myForm16File, uploadForm16ForHr,
} from '../services/form16.service';

const callerId = (req: Request) => String(req.auth?.userId ?? '');
const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

type Handler = (req: Request) => Promise<Record<string, unknown>>;
const handle = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, ...(await fn(req)) });
  } catch (error) {
    next(error);
  }
};

// —— the signed-in employee's own (GET /payroll/form16…) ——
export const myForm16Handler = handle(async (req) => ({ form16: await myForm16(callerId(req)) }));
export const myForm16FileHandler = handle(async (req) => myForm16File(callerId(req), String(req.params.documentId ?? '')));

// —— HR (/admin/payroll/form16…) ——
export const hrForm16Handler = handle(async (req) => form16ForHr(callerId(req), req.query.fy));
export const hrUploadForm16Handler = handle(async (req) => ({
  document: await uploadForm16ForHr(callerId(req), String(req.params.userId ?? ''), {
    fy: req.query.fy ?? body(req).fy,
    part: req.query.part ?? body(req).part,
    file: req.file,
  }),
}));
export const hrBulkUploadForm16Handler = handle(async (req) =>
  bulkUploadForm16ForHr(callerId(req), {
    fy: req.query.fy ?? body(req).fy,
    part: req.query.part ?? body(req).part,
    files: Array.isArray(req.files) ? req.files : [],
  }));
export const hrForm16FileHandler = handle(async (req) => form16FileForHr(callerId(req), String(req.params.documentId ?? '')));
export const hrDeleteForm16Handler = handle(async (req) => deleteForm16ForHr(callerId(req), String(req.params.documentId ?? '')));
