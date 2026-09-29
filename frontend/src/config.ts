// Where the "Enter command center" buttons go. In production the splash and the dashboard are one
// site (the splash is served at "/" by the Next.js app, which has the dashboard at "/dashboard"),
// so the link is relative. `npm run dev` here serves the splash on its own port, next to the
// dashboard's dev server on 3000. VITE_DASHBOARD_URL overrides either.
export const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL || (import.meta.env.DEV ? 'http://localhost:3000/dashboard' : '/dashboard');

export const REPO_URL = 'https://github.com/sirgreaseball/cascade';
