import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * Identifies this process for the life of the process.
 *
 * Polling the endpoint and counting distinct ids is how you find out whether
 * one server is answering or several — which decides whether live game state
 * can be held in memory, and whether sockets need a shared backplane.
 */
const instanceId = randomUUID().slice(0, 8);
const startedAt = Date.now();

export const getHealth = (_request: Request, response: Response) => {
  response.status(200).json({
    status: 'ok',
    service: 'hrms-manager-feedback-api',
    instance: instanceId,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
};
