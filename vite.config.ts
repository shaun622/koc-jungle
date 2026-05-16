/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Generate a service worker that precaches the app shell + assets and
      // serves them on subsequent loads. Refreshes itself when a new build
      // ships; UpdatePrompt component nudges the operator to reload.
      registerType: 'prompt',
      injectRegister: false, // we register manually in main.tsx
      // Use the existing public/manifest.webmanifest; don't generate another.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Single-page-app fallback for navigation requests (HashRouter, so
        // every entry point is the index.html anyway).
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      includeAssets: [
        'favicon-16.png',
        'favicon-32.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
        'icons/apple-touch-icon.png',
        'manifest.webmanifest',
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts',
  },
});
