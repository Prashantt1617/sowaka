import { Router } from 'express';
import {
  managerWorkspace,
  saveManagerFeedback,
  saveRecognitionNomination,
  updateMyProfilePhoto,
} from '../controllers/manager.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { uploadProfilePhoto } from '../middleware/profile-photo-upload.middleware';

export const managerRouter = Router();
managerRouter.use(requireAuth);
managerRouter.get('/workspace', managerWorkspace);
managerRouter.patch('/photo', uploadProfilePhoto, updateMyProfilePhoto);
managerRouter.put('/feedback/:employeeUserId', saveManagerFeedback);
managerRouter.put('/recognition/:category', saveRecognitionNomination);

