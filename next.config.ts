import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * The front page is the splash app in frontend/, which `npm run build` builds into public/splash.
 * When it is there, "/" serves it and the dashboard lives at "/dashboard"; when it is not (a dev
 * server started without building the splash), "/" keeps showing the dashboard.
 */
const splash = existsSync(path.join(process.cwd(), 'public', 'splash', 'index.html'));

const nextConfig: NextConfig = {
  // The dashboard is a full-bleed canvas; keep the dev-mode badge out of the product view.
  devIndicators: false,
  async rewrites() {
    // beforeFiles: checked before pages, so it takes "/" from app/page.tsx.
    return { beforeFiles: splash ? [{ source: '/', destination: '/splash/index.html' }] : [], afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
