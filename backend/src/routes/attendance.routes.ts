import { Router } from 'express';
import { createRegularization, listInbox, listMine, punch, updateDecision } from '../controllers/attendance.controller';
import { requireAuth } from '../middleware/auth.middleware';

export const attendanceRouter = Router();
attendanceRouter.use(requireAuth);
attendanceRouter.get('/mine', listMine);
attendanceRouter.post('/punch', punch);
attendanceRouter.post('/regularizations', createRegularization);
attendanceRouter.get('/regularizations/inbox', listInbox);
attendanceRouter.patch('/regularizations/:id/decision', updateDecision);
