# Team workflow

- **`main` is the product.** Every push to `main` is built and deployed by Vercel to
  https://cascading.vercel.app, and teammates pull it onto their own machines. Keep commits small,
  and push only what you have run and built (`npm run build` builds the splash too).
- **Before a commit**: `npx tsc --noEmit -p .`, `npx eslint src`, and `npm run verify` whenever
  solver code changes. `docs/HANDOFF.md` §0 has the rules that are not negotiable.
- **No hardcoding scenarios**: read coordinates and figures from the scenario configuration and the
  stores, never from a component.

## Where things live

- **Interface**: `src/components/panels/`, `src/components/ui/`, `src/app/`, and the splash in
  `frontend/`.
- **Map and solvers**: `src/components/map/`, `src/simulation/`.
- **Data**: `public/data/`, `public/scenarios/`, `scripts/`.
- **Shared logic**: `src/store/`, `src/lib/`.
