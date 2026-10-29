import fs from 'node:fs';
import { defineConfig } from 'vite';

// The engine's version (written by scripts/build-sim.sh) goes into the addresses of its files.
function simVersion(): string {
  try {
    return JSON.parse(fs.readFileSync('public/sim/version.json', 'utf8')).hash ?? 'dev';
  } catch {
    return 'dev';
  }
}

// Relative base so the same build works on GitHub Pages (/BeatTheSimForever/) and locally.
export default defineConfig({
  base: './',
  define: { __SIM_VERSION__: JSON.stringify(simVersion()) },
  worker: { format: 'iife' },
});
