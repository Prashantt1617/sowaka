import type { Request, Response } from 'express';
import { appColor, buildId, instanceId, startedAt } from '../utils/instance';
import { isLeader } from '../services/leader';
import { isDraining, readiness } from '../services/readiness';

/**
 * Identifies this process for the life of the process.
 *
 * Polling the endpoint and counting distinct ids is how you find out whether
 * one server is answering or several — which decides whether live game state
 * can be held in memory, and whether sockets need a shared backplane. During
 * a blue/green deploy `port` and `color` say which copy answered, `leader`
 * whether it runs the background jobs, and `build` which commit it runs.
 */
export const getHealth = (_request: Request, response: Response) => {
  response.status(200).json({
    status: 'ok',
    service: 'hrms-manager-feedback-api',
    instance: instanceId,
    port: Number(process.env.PORT ?? 4000),
    color: appColor,
    build: buildId(),
    leader: isLeader(),
    draining: isDraining(),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
};

/** 200 once this process may take traffic (readiness.ts), 503 until then and once it is shutting down. */
export const getReady = async (_request: Request, response: Response) => {
  const state = await readiness();
  response.status(state.ready ? 200 : 503).json({ ...state, instance: instanceId, port: Number(process.env.PORT ?? 4000), color: appColor, build: buildId(), leader: isLeader() });
};
