# Team Workflow

We are a 6-person team building the NTRO Dam Break Inundation Simulation. To avoid merge conflicts and broken demos, follow these strict rules.

## Git Branching Strategy

- **`main`**: The sacred branch. **Stable demo ONLY.** Nobody pushes directly to main. Only the Team Lead merges to `main` before a demo or pitch.
- **`dev`**: The active integration branch. All feature branches branch off of `dev` and merge back into `dev`.
- **`feature/*`**: Individual task branches. (e.g., `feature/ui-dashboard`, `feature/flood-worker`).
- **`fix/*`**: Bug fixes.

## Rules for Merging

1. **Pull frequently**: Always pull from `dev` before starting work to avoid massive rebase conflicts.
2. **Small PRs**: Merge often. Don't wait 2 days to submit a PR with 50 changed files.
3. **No hardcoding**: Do not hardcode Tehri-specific coordinates in components. Use the `scenarioStore` and config files.
4. **Mock Mode**: Use `NEXT_PUBLIC_USE_MOCK_DATA=true` if real data is missing, so you aren't blocked.

## Folder Ownership Guidelines
To prevent stepping on toes:
- **UI/UX Team**: Focuses on `components/panels/`, `components/ui/`, `app/`
- **Map/Engine Team**: Focuses on `components/map/`, `simulation/`
- **Data/GIS Team**: Focuses on `public/data/`, `public/scenarios/`, `scripts/`
- **Integration/Lead**: Focuses on `store/`, `lib/`, overall architecture.
