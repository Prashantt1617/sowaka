import type { NextFunction, Request, Response } from 'express';
import { publishRelayGame } from '../services/relay-publish.service';
import {
  commitItems,
  commitRoster,
  createEvent,
  listEvents,
  listTeams,
  previewItems,
  previewRoster,
  RelayError,
  updateEventConfig,
} from '../services/relay-import.service';

function callerId(req: Request): string {
  return String(req.auth?.userId ?? '');
}

function eventId(req: Request): string {
  return String(req.params.eventId ?? '');
}

function uploaded(req: Request): { fileName: string; bytes: Buffer } {
  const file = req.file;
  if (!file) throw new RelayError(400, 'No file was uploaded');
  return { fileName: file.originalname, bytes: file.buffer };
}

export async function listRelayEventsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ events: await listEvents(callerId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function createRelayEventHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const event = await createEvent(callerId(req), String(req.body?.name ?? ''));
    res.status(201).json({ event });
  } catch (error) {
    next(error);
  }
}

export async function updateRelayEventHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const event = await updateEventConfig(callerId(req), eventId(req), req.body ?? {});
    res.json({ event });
  } catch (error) {
    next(error);
  }
}

export async function listRelayTeamsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ teams: await listTeams(callerId(req), eventId(req)) });
  } catch (error) {
    next(error);
  }
}

/** Reads the sheet and reports what would happen, without writing anything. */
export async function previewRosterHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { fileName, bytes } = uploaded(req);
    res.json(await previewRoster(callerId(req), eventId(req), fileName, bytes));
  } catch (error) {
    next(error);
  }
}

export async function commitRosterHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { fileName, bytes } = uploaded(req);
    res.json(await commitRoster(callerId(req), eventId(req), fileName, bytes));
  } catch (error) {
    next(error);
  }
}

/** Schedules the game and announces it, in one call. */
export async function publishRelayGameHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const video = req.file
      ? {
          originalName: req.file.originalname,
          contentType: req.file.mimetype,
          size: req.file.size,
          bytes: req.file.buffer,
        }
      : undefined;
    const body = typeof req.body?.body === 'string' ? JSON.parse(req.body.body) : (req.body ?? {});
    res.json(await publishRelayGame(callerId(req), eventId(req), body, video));
  } catch (error) {
    next(error);
  }
}

export async function previewItemsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { fileName, bytes } = uploaded(req);
    res.json(await previewItems(callerId(req), eventId(req), fileName, bytes));
  } catch (error) {
    next(error);
  }
}

export async function commitItemsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { fileName, bytes } = uploaded(req);
    res.json(await commitItems(callerId(req), eventId(req), fileName, bytes));
  } catch (error) {
    next(error);
  }
}
