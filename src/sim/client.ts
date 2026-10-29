import type { LiveCast, LiveStart, LiveStep } from './live';
import type { Payload, WorkerRequest } from './protocol';
import type { AplRotation, FightSpec, SimJob, SimProfile, SimSummary } from './types';
import { buildLiveRequest } from './request';

// The page's side of the engine: one worker, requests answered in order.
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

export const siteBase = new URL(import.meta.env.BASE_URL, document.baseURI).href;

/** The address of one of the engine's files (public/sim/), with its version. */
export const simFile = (path: string) => new URL(`sim/${path}?v=${__SIM_VERSION__}`, siteBase).href;

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

/** The character's stats with gear, talents, buffs and consumables, in the order of the sim's Stat list. */
export const computeStats = (profile: SimProfile) =>
  send<number[]>('stats', { request: buildLiveRequest(profile, 1, { kind: 'time', seconds: 60 }) } satisfies Payload<'stats'>);

export const live = {
  start: (profile: SimProfile, targets: number, fight: FightSpec, countdown: number, rotation?: AplRotation, seed = 0) =>
    send<LiveStart>('liveStart', { request: buildLiveRequest(profile, targets, fight, rotation), seed, countdown } satisfies Payload<'liveStart'>),
  advance: (to: number, target = 0) => send<LiveStep>('liveAdvance', { to, target } satisfies Payload<'liveAdvance'>),
  cast: (index: number, target: number) => send<LiveCast>('liveCast', { index, target } satisfies Payload<'liveCast'>),
};

/** A class's talent trees as the sim knows them (public/sim/talents/<class>.json), e.g. "priest". */
export interface TalentTree { name: string; talents: Array<{ name: string; icon?: string; maxPoints: number; row: number; col: number }> }
export async function loadTalentTrees(simClass: string): Promise<TalentTree[]> {
  const res = await fetch(simFile(`talents/${simClass}.json`));
  if (!res.ok) throw new Error(`No talents for ${simClass}`);
  return res.json();
}

/** The sim's ranked profiles for a class, by race. */
export async function loadProfiles(classKey: string): Promise<Record<string, SimProfile>> {
  const res = await fetch(simFile(`presets/${classKey}.json`));
  if (!res.ok) throw new Error(`No sim profiles for ${classKey}`);
  return res.json();
}
