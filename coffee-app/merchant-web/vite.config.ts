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
      // Vite 7 默认不允许 localhost 以外的 host 访问 dev server,
      // 加上 rpi.tomlinfree.dpdns.org 后才可以通过该域名访问 (LAN 真机调试)
      // 还可以加 'true' 一次性放行所有 host (仅限开发环境)
      allowedHosts: ['rpi.tomlinfree.dpdns.org', 'localhost', '127.0.0.1'],
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
