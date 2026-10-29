import type { LiveCast, LiveStart, LiveStep } from './live';
import type { Payload, WorkerRequest } from './protocol';
import type { FightSpec, SimJob, SimProfile, SimSummary } from './types';
import { buildLiveRequest } from './request';

// The page's side of the engine: one worker, requests answered in order.
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

export const siteBase = new URL(import.meta.env.BASE_URL, document.baseURI).href;

function send<T>(type: WorkerRequest['type'], payload: object): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result);
    };
  }
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ id, simBase: siteBase, type, ...payload });
  });
}

/** Loads the engine ahead of time (it is a large download). */
export const loadEngine = () => send<boolean>('load', {});

export const runSim = (job: SimJob) => send<SimSummary>('sim', { job } satisfies Payload<'sim'>);

export const live = {
  start: (profile: SimProfile, targets: number, fight: FightSpec, countdown: number, seed = 0) =>
    send<LiveStart>('liveStart', { request: buildLiveRequest(profile, targets, fight), seed, countdown } satisfies Payload<'liveStart'>),
  advance: (to: number) => send<LiveStep>('liveAdvance', { to } satisfies Payload<'liveAdvance'>),
  cast: (index: number, target: number) => send<LiveCast>('liveCast', { index, target } satisfies Payload<'liveCast'>),
};

/** The sim's ranked profiles for a class, by race. */
export async function loadProfiles(classKey: string): Promise<Record<string, SimProfile>> {
  const res = await fetch(new URL(`sim/presets/${classKey}.json`, siteBase));
  if (!res.ok) throw new Error(`No sim profiles for ${classKey}`);
  return res.json();
}
