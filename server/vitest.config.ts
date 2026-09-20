import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    setupFiles: ['./src/__tests__/setup.ts'],
    fileParallelism: false,
  },
});
