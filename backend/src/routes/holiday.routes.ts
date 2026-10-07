import { Router } from 'express';
import {
  createHoliday,
  listHolidays,
  removeHoliday,
  uploadHolidays,
} from '../controllers/holiday.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess, requireDashboardTabs } from '../middleware/admin.middleware';
import { uploadHolidayFile } from '../middleware/holiday-upload.middleware';

export const holidayRouter = Router();

holidayRouter.use(requireAuth);
holidayRouter.get('/', listHolidays);
holidayRouter.post('/', requireDashboardAccess, requireDashboardTabs, createHoliday);
holidayRouter.post('/upload', requireDashboardAccess, requireDashboardTabs, uploadHolidayFile, uploadHolidays);
holidayRouter.delete('/:holidayId', requireDashboardAccess, requireDashboardTabs, removeHoliday);
