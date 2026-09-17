import { Router } from 'express';
import {
  createLeave,
  listManagerLeaves,
  leaveBalance,
  listMyLeaves,
  updateLeaveDecision,
} from '../controllers/leave.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { uploadLeaveDocument } from '../middleware/leave-upload.middleware';

export const leaveRouter = Router();

leaveRouter.use(requireAuth);
// Multipart so a leave can carry a supporting document; the file is optional
// and a plain JSON body still works.
leaveRouter.post('/', uploadLeaveDocument, createLeave);
leaveRouter.get('/mine', listMyLeaves);
leaveRouter.get('/balance', leaveBalance);
leaveRouter.get('/inbox', listManagerLeaves);
leaveRouter.patch('/:leaveId/decision', updateLeaveDecision);
