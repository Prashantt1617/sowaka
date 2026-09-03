import { Router } from 'express';
import { currentUser, logout, requestOtp, teammates, verifyOtp } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';

export const authRouter = Router();

authRouter.post('/request-otp', requestOtp);
authRouter.post('/verify-otp', verifyOtp);
authRouter.get('/me', requireAuth, currentUser);
authRouter.get('/teammates', requireAuth, teammates);
authRouter.post('/logout', requireAuth, logout);
