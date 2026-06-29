// filepath: coffee-app/merchant-web/src/api/config.ts
// Single source of truth for the API base URL.
//
// In dev mode (`npm run dev`), Vite's proxy intercepts `/api` and `/uploads`
// from the `vite.config.ts` proxy config, so we keep the default `/api` and
// the browser never sees a cross-origin request.
//
// In production (after `npm run build`), the dist has no proxy — so we need
// an absolute URL. Build with the env var:
//
//   VITE_API_BASE=https://rpi.tomlinfree.dpdns.org/api npm run build
//
// Or create a `.env.production` file with the same variable (Vite loads it
// automatically when running `build`).

const DEFAULT_DEV_API_BASE = '/api';

export const API_BASE: string =
  (import.meta as any).env?.VITE_API_BASE || DEFAULT_DEV_API_BASE;

export const UPLOADS_BASE: string =
  (import.meta as any).env?.VITE_UPLOADS_BASE ||
  // If API_BASE ends with /api, assume uploads are served from the same origin
  API_BASE.replace(/\/api\/?$/, '');

/**
 * Resolve a possibly-relative image URL to an absolute URL the browser can fetch.
 *  - "http://..." or "data:..." → returned as-is
 *  - "/uploads/foo.png"        → "<UPLOADS_BASE>/uploads/foo.png"  (or origin only if /uploads)
 *  - null/empty                 → null
 */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  return UPLOADS_BASE + (url.startsWith('/') ? url : '/' + url);
}
