/**
 * The Cascade front page: a separate app (frontend/), served on its own address. Set
 * NEXT_PUBLIC_SPLASH_URL when deploying; the default is where `npm run dev` serves it locally.
 */
export const SPLASH_URL = process.env.NEXT_PUBLIC_SPLASH_URL || 'http://localhost:5173';
