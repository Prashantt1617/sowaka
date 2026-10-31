import type { NextFunction, Request, Response } from 'express';
import { myMissingPunches, myPayrollHome } from '../services/employeePayroll.home';
import { mySplit, reviewSplit, saveSplit } from '../services/employeePayroll.split';
import {
  decideProofForHr, listProofsForHr, myDeclaration, myProofFile, myProofs, proofFileForHr, saveMyDeclaration, uploadMyProof,
} from '../services/employeePayroll.declaration';

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

// —— the signed-in employee's own payroll ——
export const payrollHomeHandler = handle(async (req) => myPayrollHome(callerId(req), req.query.period));
export const missingPunchesHandler = handle(async (req) => myMissingPunches(callerId(req), req.query.period));
export const getSplitHandler = handle(async (req) => ({ split: await mySplit(callerId(req)) }));
export const reviewSplitHandler = handle(async (req) => ({ review: await reviewSplit(callerId(req), body(req)) }));
export const saveSplitHandler = handle(async (req) => ({ split: await saveSplit(callerId(req), body(req)) }));
export const getDeclarationHandler = handle(async (req) => ({ declaration: await myDeclaration(callerId(req), req.query.fy) }));
export const saveDeclarationHandler = handle(async (req) => ({ declaration: await saveMyDeclaration(callerId(req), req.query.fy, body(req)) }));
export const getProofsHandler = handle(async (req) => ({ proofs: await myProofs(callerId(req), req.query.fy) }));
export const uploadProofHandler = handle(async (req) => ({
  item: await uploadMyProof(callerId(req), String(req.params.item ?? ''), req.query.fy, { amountPaise: body(req).amountPaise, file: req.file }),
}));
export const proofFileHandler = handle(async (req) => ({ url: await myProofFile(callerId(req), String(req.params.item ?? ''), req.query.fy) }));

// —— HR ——
export const hrListProofsHandler = handle(async (req) =>
  listProofsForHr(callerId(req), { fy: req.query.fy, status: req.query.status, userId: req.query.userId }));
export const hrProofFileHandler = handle(async (req) => ({ url: await proofFileForHr(callerId(req), String(req.params.proofId ?? '')) }));
export const hrDecideProofHandler = handle(async (req) => ({ proof: await decideProofForHr(callerId(req), String(req.params.proofId ?? ''), body(req)) }));
