// Loads the built sim (public/sim/) in Node for tests. Returns null when it has not been built (npm run sim).
import fs from 'node:fs';
import path from 'node:path';
import type { RaidSimJson } from '../src/sim/run';
import type { SimProfile } from '../src/sim/types';

const SIM_DIR = path.resolve(__dirname, '../public/sim');
let loaded: Promise<RaidSimJson> | null = null;

export const simBuilt = fs.existsSync(path.join(SIM_DIR, 'lib.wasm'));

export function loadSim(): Promise<RaidSimJson> {
  loaded ??= (async () => {
    await import(path.join(SIM_DIR, 'wasm_exec.js'));
    const g = globalThis as unknown as { Go: new () => { importObject: WebAssembly.Imports; run(i: WebAssembly.Instance): void }; wasmready?: () => void; raidSimJson: RaidSimJson };
    const started = new Promise<void>((r) => (g.wasmready = r));
    const go = new g.Go();
    const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(SIM_DIR, 'lib.wasm')), go.importObject);
    go.run(instance);
    await started;
    return g.raidSimJson;
  })();
  return loaded;
}

export function profiles(classKey: string): Record<string, SimProfile> {
  return JSON.parse(fs.readFileSync(path.join(SIM_DIR, 'presets', classKey + '.json'), 'utf8'));
}
