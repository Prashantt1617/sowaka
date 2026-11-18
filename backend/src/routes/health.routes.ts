import { Router } from 'express';
import { getHealth, getReady } from '../controllers/health.controller';

export const healthRouter = Router();

healthRouter.get('/', getHealth);
// For the blue/green deploy: true only once the database, Redis and the boot warm-up are ready.
healthRouter.get('/ready', (req, res, next) => { getReady(req, res).catch(next); });
