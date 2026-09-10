import { NextFunction, Request, Response } from 'express';
import {
  createRun,
  decideRun,
  getRun,
  listRuns,
  markRunPaid,
  PayrollRunError,
  recallRun,
  recomputeRun,
  submitRun,
} from '../services/payrollRun.service';

export async function listRunsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, runs: await listRuns(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function getRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getRun(requireUserId(req), String(req.params.runId ?? ''));
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function createRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await createRun(requireUserId(req), {
      period: String(body.period ?? ''),
      lopDays: body.lopDays as Record<string, number> | undefined,
      overtimePaise: body.overtimePaise as Record<string, number> | undefined,
    });
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function recomputeRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const run = await recomputeRun(requireUserId(req), String(req.params.runId ?? ''), {
      lopDays: body.lopDays as Record<string, number> | undefined,
      overtimePaise: body.overtimePaise as Record<string, number> | undefined,
    });
    res.status(200).json({ success: true, run });
  } catch (error) {
    next(error);
  }
}

export async function submitRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await submitRun(requireUserId(req), String(req.params.runId ?? ''));
    res.status(200).json({ success: true, run });
  } catch (error) {
    next(error);
  }
}

export async function decideRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const run = await decideRun(
      requireUserId(req),
      String(req.params.runId ?? ''),
      String(body.decision ?? ''),
      body.note == null ? undefined : String(body.note),
    );
    res.status(200).json({ success: true, run });
  } catch (error) {
    next(error);
  }
}

export async function recallRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await recallRun(requireUserId(req), String(req.params.runId ?? ''));
    res.status(200).json({ success: true, run });
  } catch (error) {
    next(error);
  }
}

export async function markRunPaidHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await markRunPaid(requireUserId(req), String(req.params.runId ?? ''));
    res.status(200).json({ success: true, run });
  } catch (error) {
    next(error);
  }
}

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new PayrollRunError(401, 'Authentication required');
  return req.auth.userId;
}
