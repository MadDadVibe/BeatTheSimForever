import type { SimJob, SimProfile, SimSummary } from './types';

// The page's side of the sim: one worker, jobs answered in turn.
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (s: SimSummary) => void; reject: (e: Error) => void }>();

const simBase = new URL(import.meta.env.BASE_URL, document.baseURI).href;

export function runSim(job: SimJob): Promise<SimSummary> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<{ id: number; summary?: SimSummary; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.summary) p.resolve(e.data.summary);
      else p.reject(new Error(e.data.error ?? 'Sim failed'));
    };
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, simBase, job });
  });
}

/** The sim's ranked profiles for a class, by race. */
export async function loadProfiles(classKey: string): Promise<Record<string, SimProfile>> {
  const res = await fetch(new URL(`sim/presets/${classKey}.json`, simBase));
  if (!res.ok) throw new Error(`No sim profiles for ${classKey}`);
  return res.json();
}
