import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { reportClientErrors } from '../controllers/client-log.controller';

export const clientLogRouter = Router();
clientLogRouter.use(requireAuth);
clientLogRouter.post('/', reportClientErrors);
