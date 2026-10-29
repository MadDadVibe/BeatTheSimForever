import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __SIM_VERSION__: JSON.stringify('test') },
  test: { testTimeout: 60000, include: ['tests/**/*.test.ts'] },
});
