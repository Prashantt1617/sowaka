import { Router } from 'express';
import {
  commitItemsHandler,
  commitRosterHandler,
  createRelayEventHandler,
  listRelayEventsHandler,
  listRelayTeamsHandler,
  previewItemsHandler,
  previewRosterHandler,
  updateRelayEventHandler,
} from '../controllers/relay.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess } from '../middleware/admin.middleware';
import { uploadRelayFile } from '../middleware/relay-upload.middleware';

export const relayRouter = Router();

// Setting up the game decides what 220 people spend twenty minutes doing, so
// the whole module is HR-only.
relayRouter.use(requireAuth, requireDashboardAccess);

relayRouter.get('/events', listRelayEventsHandler);
relayRouter.post('/events', createRelayEventHandler);
relayRouter.put('/events/:eventId', updateRelayEventHandler);
relayRouter.get('/events/:eventId/teams', listRelayTeamsHandler);

// Preview reads the sheet and reports; commit re-validates and only then writes.
// Both take the file, so a stale preview can never be committed.
relayRouter.post('/events/:eventId/roster/preview', uploadRelayFile, previewRosterHandler);
relayRouter.post('/events/:eventId/roster', uploadRelayFile, commitRosterHandler);
relayRouter.post('/events/:eventId/questions/preview', uploadRelayFile, previewItemsHandler);
relayRouter.post('/events/:eventId/questions', uploadRelayFile, commitItemsHandler);
