/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under /<repo>/.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    environment: 'node',
  },
});
