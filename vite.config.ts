import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages (/BeatTheSimForever/) and locally.
export default defineConfig({
  base: './',
  worker: { format: 'iife' },
});
