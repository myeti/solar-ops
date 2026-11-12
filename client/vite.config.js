import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const clientDir = fileURLToPath(new URL('.', import.meta.url));
const apiTarget = process.env.SOLAROPS_API_URL || 'http://127.0.0.1:4100';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * Vite configuration of the SolarOps UI.
 * In development, API and webhook calls are proxied to the Express server.
 * The Host header is kept as is (no changeOrigin) so the server CSRF
 * Origin check sees matching origins. The version of package.json is
 * built in (import.meta.env.SOLAROPS_VERSION).
 */
export default defineConfig({
  root: clientDir,
  plugins: [vue()],
  define: {
    'import.meta.env.SOLAROPS_VERSION': JSON.stringify(version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget },
      '/hooks': { target: apiTarget },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
});
