import { resolve } from 'node:path';
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(base, defineConfig({
  mode: 'tournament-test',
  envDir: resolve(__dirname, 'tests/runtime/tournament-v1/env'),
  server: { host: '127.0.0.1', port: 4186, strictPort: true },
  preview: { host: '127.0.0.1', port: 4187, strictPort: true },
  build: {
    outDir: resolve(__dirname, '../../outputs/tournament-local-runtime/frontend'),
    emptyOutDir: true,
  },
}));
