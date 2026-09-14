import { Router } from 'express';
import {
  managerWorkspace,
  myShiftPolicy,
  myFeedbackSnapshot as feedbackSnapshot,
  saveManagerFeedback,
  saveRecognitionNomination,
  updateMyProfilePhoto,
} from '../controllers/manager.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { uploadProfilePhoto } from '../middleware/profile-photo-upload.middleware';

export const managerRouter = Router();
managerRouter.use(requireAuth);
managerRouter.get('/workspace', managerWorkspace);
// Just the shift policy for the signed-in employee. The app re-reads this
// while it runs, so an HR change to shifts, leave types, overtime or
// corrections lands without a restart.
managerRouter.get('/shift-policy', myShiftPolicy);
// Feedback moves while the app is open — a review stays editable until the
// cycle closes — so the app re-reads this rather than trusting sign-in.
managerRouter.get('/feedback-snapshot', feedbackSnapshot);
managerRouter.patch('/photo', uploadProfilePhoto, updateMyProfilePhoto);
managerRouter.put('/feedback/:employeeUserId', saveManagerFeedback);
managerRouter.put('/recognition/:category', saveRecognitionNomination);

