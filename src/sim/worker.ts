// Runs the engine on another core so the page never stutters while it calculates. It serves both the reference
// sim (many fights at once) and the live fight the player drives, one request at a time.
/// <reference lib="webworker" />
import { liveApi, type LiveEngine } from './live';
import { runJob, type RaidSimJson } from './run';
import type { WorkerRequest } from './protocol';

declare const Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };
type Engine = LiveEngine & { raidSimJson: RaidSimJson; statsJson: (json: string) => string };

let ready: Promise<Engine> | null = null;
// simBase: the site's address; the engine's files are under sim/ there.
function load(simBase: string): Promise<Engine> {
  const simUrl = (file: string) => new URL(`sim/${file}?v=${__SIM_VERSION__}`, simBase).href;
  importScripts(simUrl('wasm_exec.js'));
  const g = self as unknown as Engine & { wasmready?: () => void };
  const started = new Promise<void>((resolve) => (g.wasmready = resolve));
  const go = new Go();
  return WebAssembly.instantiateStreaming(fetch(simUrl('lib.wasm')), go.importObject)
    .then(({ instance }) => { void go.run(instance); return started; })
    .then(() => g);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, simBase } = e.data;
  try {
    ready ??= load(simBase);
    const engine = await ready;
    const live = liveApi(engine);
    const r = e.data;
    let result: unknown;
    switch (r.type) {
      case 'load': result = true; break;
      case 'sim': result = runJob(engine.raidSimJson, r.job); break;
      case 'stats': {
        const out = JSON.parse(engine.statsJson(JSON.stringify({ request: r.request }))) as { stats?: number[]; error?: string };
        if (out.error) throw new Error(out.error);
        result = out.stats;
        break;
      }
      case 'liveStart': result = live.start(r.request, r.seed, r.countdown); break;
      case 'liveAdvance': result = live.advance(r.to, r.target); break;
      case 'liveCast': result = live.cast(r.index, r.target); break;
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
