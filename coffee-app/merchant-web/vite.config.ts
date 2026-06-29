// filepath: coffee-app/merchant-web/vite.config.ts
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: intercept /api and /uploads during `npm run dev` so the browser
// never makes a cross-origin request. In production, the built bundle uses
// VITE_API_BASE / VITE_UPLOADS_BASE from .env.production (or build env vars).
const DEV_API_TARGET = 'https://rpi.tomlinfree.dpdns.org';

export default defineConfig(({ mode }) => {
  // Load .env.[mode] for ALL modes so the same vars are available in dev and build.
  // Vite's default behavior only exposes vars prefixed with VITE_ to the client.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: DEV_API_TARGET,
          changeOrigin: true
        },
        '/uploads': {
          target: DEV_API_TARGET,
          changeOrigin: true
        }
      }
    },
    build: {
      // Inline these env vars into the bundle so they're available at runtime
      // (Vite already inlines VITE_* by default, but being explicit helps).
      // No special config needed; just reference import.meta.env.VITE_API_BASE
      // in the source.
    }
  };
});
