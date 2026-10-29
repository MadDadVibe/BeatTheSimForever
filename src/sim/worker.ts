// Runs the sim on another core so the game never stutters while it calculates.
/// <reference lib="webworker" />
import { runJob, type RaidSimJson } from './run';
import type { SimJob } from './types';

declare const Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };

let ready: Promise<RaidSimJson> | null = null;
// simBase: the site's address; the sim's files are under sim/ there.
function load(simBase: string): Promise<RaidSimJson> {
  const simUrl = (file: string) => new URL('sim/' + file, simBase).href;
  importScripts(simUrl('wasm_exec.js'));
  const g = self as unknown as { wasmready?: () => void; raidSimJson: RaidSimJson };
  const started = new Promise<void>((resolve) => (g.wasmready = resolve));
  const go = new Go();
  return WebAssembly.instantiateStreaming(fetch(simUrl('lib.wasm')), go.importObject)
    .then(({ instance }) => { void go.run(instance); return started; })
    .then(() => g.raidSimJson);
}

self.onmessage = async (e: MessageEvent<{ id: number; simBase: string; job: SimJob }>) => {
  const { id, simBase, job } = e.data;
  try {
    ready ??= load(simBase);
    const raidSimJson = await ready;
    self.postMessage({ id, summary: runJob(raidSimJson, job) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
