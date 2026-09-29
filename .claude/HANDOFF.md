# Start here

Cascade is a browser-only dam-break inundation dashboard for Smart India Hackathon problem
**SIH26161** (National Technical Research Organisation). Next.js 16 + React 19 + deck.gl 9.4 over
MapLibre, with 2D shallow-water and SPH solvers that run on the machine in front of you.

**[`docs/HANDOFF.md`](../docs/HANDOFF.md) is the canonical engineering handoff** — what the project
is, where every file lives, the task plan and its status, measured performance figures, how to
verify, and the gotchas. Read it before changing anything.

This file deliberately holds only the things you must know *before your first action*:

1. **Git identity.** Commits are authored `sirgreaseball <dhruuvvsonar@gmail.com>` — two u's, two
   v's. No `Co-Authored-By` trailers, no AI attribution of any kind. The machine's global identity
   may belong to someone else; check `git config user.email` before the first commit.
2. **Small commits, pushed to `main` straight away.** The owner pulls on several machines and must
   always get a working app. Never push something you have not run.
3. **The gate before any commit:** `npm run verify` (whenever solver code changes),
   `npx tsc --noEmit -p .`, `npx eslint <files you touched>` — all clean. Performance is measured on
   the production build (`npm run build && npx next start`), never the dev server, and never on one
   run. See `docs/HANDOFF.md` §6 for the browser benchmark scripts.
4. **Two invariants that have broken the app before.** Arrays cross the Web Worker boundary by
   structured cloning only — never a transfer list. Both the worker and the main-thread fallback get
   their solver from the single `createRuntime` factory in `src/simulation/runtime.ts`; new solver
   parameters go into `EngineConfig`, never a second argument list.
5. **`frontend/` is the splash page** at `/` of the live site (https://trycascade.vercel.app), a
   separate Vite app built in by `npm run build`; the simulator is at `/dashboard`. Every push to
   `main` deploys, so never push what does not build.

## Why this file is short

It used to be a second status report, duplicated verbatim at `docs/HANDOFF_CLAUDE.md`. Both were
written in `a8bfb64` listing the satellite basemap, 3D terrain and 3D floodwater as broken, and
`91c1588` — the very next commit — fixed all three. They then sat there for eleven days telling
every new session that a working app was broken. Status belongs in `docs/HANDOFF.md`, in one place,
next to the commit hashes that justify it. Keep this file to rules that do not change.
