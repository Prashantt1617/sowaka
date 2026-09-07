import { NextFunction, Request, Response } from 'express';
import {
  createPayHead,
  deletePayHead,
  getPayHead,
  listPayHeads,
  PayHeadError,
  PayHeadInput,
  updatePayHead,
} from '../services/payHead.service';

export async function listPayHeadsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, payHeads: await listPayHeads(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function getPayHeadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const payHead = await getPayHead(requireUserId(req), String(req.params.payHeadId ?? ''));
    res.status(200).json({ success: true, payHead });
  } catch (error) {
    next(error);
  }
}

export async function createPayHeadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const payHead = await createPayHead(requireUserId(req), toInput(req.body));
    res.status(201).json({ success: true, payHead });
  } catch (error) {
    next(error);
  }
}

export async function updatePayHeadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const payHead = await updatePayHead(
      requireUserId(req),
      String(req.params.payHeadId ?? ''),
      toInput(req.body),
    );
    res.status(200).json({ success: true, payHead });
  } catch (error) {
    next(error);
  }
}

export async function deletePayHeadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await deletePayHead(requireUserId(req), String(req.params.payHeadId ?? ''));
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

function toInput(body: unknown): PayHeadInput {
  const source = (body ?? {}) as Record<string, unknown>;
  return {
    name: String(source.name ?? ''),
    code: String(source.code ?? ''),
    category: String(source.category ?? ''),
    componentType: String(source.componentType ?? ''),
    calculation: source.calculation,
    considerForEpf: source.considerForEpf,
    considerForEsi: source.considerForEsi,
    considerForPt: source.considerForPt,
    considerForLwf: source.considerForLwf,
    fbp: source.fbp,
    recurrence: source.recurrence,
    prorate: source.prorate,
    arrears: source.arrears,
    maxClaimablePaise: source.maxClaimablePaise,
    active: source.active,
  };
}

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new PayHeadError(401, 'Authentication required');
  return req.auth.userId;
}
