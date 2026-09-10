import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The dashboard is a full-bleed canvas; keep the dev-mode badge out of the product view.
  devIndicators: false,
};

export default nextConfig;
