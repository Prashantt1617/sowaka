import { NextFunction, Request, Response } from 'express';
import {
  getCurrentAuthUser,
  getTeammates,
  requestLoginOtp,
  revokeSession,
  verifyLoginOtp,
} from '../services/auth.service';

export async function requestOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const email = String(req.body.email ?? '');
    await requestLoginOtp(email);
    res.status(200).json({
      success: true,
      message: 'If the email is valid, a sign-in code has been sent.',
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    await revokeSession(req.auth?.token ?? '');
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function currentUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await getCurrentAuthUser(req.auth?.userId ?? '');
    res.status(200).json({ success: true, user });
  } catch (error) {
    next(error);
  }
}

export async function teammates(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getTeammates(req.auth?.userId ?? '');
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function verifyOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const email = String(req.body.email ?? '');
    const otp = String(req.body.otp ?? '');
    const result = await verifyLoginOtp(email, otp);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}
