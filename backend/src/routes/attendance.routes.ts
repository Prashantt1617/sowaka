import { Router } from 'express';
import {
  createRegularization, listInbox, listMine, listTeamMemberAttendance, punch, punchLocations, updateDecision,
} from '../controllers/attendance.controller';
import { requireAuth } from '../middleware/auth.middleware';

export const attendanceRouter = Router();
attendanceRouter.use(requireAuth);
attendanceRouter.get('/mine', listMine);
attendanceRouter.get('/team/:employeeUserId', listTeamMemberAttendance);
attendanceRouter.post('/punch', punch);
attendanceRouter.get('/punch-locations', punchLocations);
attendanceRouter.post('/regularizations', createRegularization);
attendanceRouter.get('/regularizations/inbox', listInbox);
attendanceRouter.patch('/regularizations/:id/decision', updateDecision);
