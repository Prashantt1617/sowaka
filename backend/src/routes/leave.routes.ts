import { Router } from 'express';
import {
  cancelMyLeave,
  createLeave,
  listManagerLeaves,
  leaveBalance,
  listMyLeaves,
  updateLeaveCancellationDecision,
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
// The employee's own leave, taken back; a note for the manager is optional.
// A pending one is withdrawn at once; an approved one becomes a cancellation request.
leaveRouter.post('/:leaveId/cancel', cancelMyLeave);
// The manager's answer to that request: { decision: 'approved' | 'declined', note? }.
leaveRouter.patch('/:leaveId/cancellation', updateLeaveCancellationDecision);
