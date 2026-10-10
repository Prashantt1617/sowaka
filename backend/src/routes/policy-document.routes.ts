import { Router } from 'express';
import { policiesHandler } from '../controllers/policy-document.controller';
import { requireAuth } from '../middleware/auth.middleware';

/**
 * Actions › View Policies, from the app: the person's company's policies, as
 * Sowaka wrote them with `src/scripts/policies.ts`. An empty list means the
 * company has none of its own yet, and the app writes them from its rules.
 */
export const policiesRouter = Router();
policiesRouter.use(requireAuth);
policiesRouter.get('/', policiesHandler);
