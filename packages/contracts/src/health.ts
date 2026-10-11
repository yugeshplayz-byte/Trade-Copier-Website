import { z } from 'zod';
import { APP_ENVS, BROKER_MODES } from './environment.ts';

/**
 * Health document published by the execution worker on its loopback-only health
 * endpoint. The web app treats it as external input and validates it.
 */
export const workerHealthSchema = z
  .object({
    service: z.literal('execution-worker'),
    schemaVersion: z.literal(1),
    appEnv: z.enum(APP_ENVS),
    brokerMode: z.enum(BROKER_MODES),
    startedAt: z.iso.datetime(),
    lastHeartbeatAt: z.iso.datetime(),
    heartbeatIntervalMs: z.number().int().positive(),
    orderDispatch: z.object({
      enabled: z.literal(false),
      reason: z.string().min(1).max(500),
    }),
  })
  .strict();

export type WorkerHealth = z.infer<typeof workerHealthSchema>;
