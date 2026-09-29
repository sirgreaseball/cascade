/**
 * The Cascade front page: the splash app (frontend/), built into public/splash and served at "/"
 * by this same site (next.config.ts). NEXT_PUBLIC_SPLASH_URL points elsewhere if it is ever
 * hosted separately.
 */
export const SPLASH_URL = process.env.NEXT_PUBLIC_SPLASH_URL || '/';
