import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// The production build goes into the dashboard's public folder, and the Next.js app serves it at
// "/" (see next.config.ts): one site, with the splash at "/" and the dashboard at "/dashboard".
// Its files therefore live under /splash/, which is where the built page looks for them.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/splash/' : '/',
  build: {
    outDir: '../public/splash',
    emptyOutDir: true,
  },
}))
