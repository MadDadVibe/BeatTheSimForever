import type { SimJob } from './types';

// The messages the page sends to the engine's worker. Each is answered with {id, result} or {id, error}.
export type WorkerRequest = { id: number; simBase: string } & (
  | { type: 'load' }
  | { type: 'sim'; job: SimJob }
  | { type: 'liveStart'; request: Record<string, unknown>; seed: number; countdown: number }
  | { type: 'liveAdvance'; to: number }
  | { type: 'liveCast'; index: number; target: number }
);

type Payload<T extends WorkerRequest['type']> = Omit<Extract<WorkerRequest, { type: T }>, 'id' | 'simBase' | 'type'>;
export type { Payload };
