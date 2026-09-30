import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          // Real LibreOffice engine, headless (no windows). Needs vendor/libreoffice or SIMPAPER_ENGINE_DIR.
          name: 'engine',
          include: ['tests/engine/**/*.test.ts'],
          environment: 'node',
          testTimeout: 240_000,
          hookTimeout: 240_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
