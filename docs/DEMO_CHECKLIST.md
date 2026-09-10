# Hackathon Live Demo Checklist (Judge-Eyes)

This checklist ensures the demo runs flawlessly, even in the event of venue Wi-Fi failure.

## 1. Pre-Flight (15 Mins Before Pitch)
- [ ] Ensure local server is running via `npm run start` (production build).
- [ ] Open `http://localhost:3000` in Chrome Incognito (to prevent caching issues).
- [ ] Ensure Windows scaling is at 100% and browser zoom is at 100%.
- [ ] Keep DevTools closed unless explicitly needed for a question.
- [ ] Disconnect from Wi-Fi temporarily to verify the offline terrain fallback engages successfully.

## 2. The Pitch Flow
- **Intro (30s):** Present the NTRO problem statement (SIH26161) and the high-stakes reality of dam failures.
- **Visual Hook (30s):** Open the command center. Show the Dark Basemap and 3D terrain.
- **The Engine (1m):** Initiate the Tehri Dam scenario. Explain the Cellular Automata (Gravity-Flow) Web Worker crunching numbers entirely in the browser at 60 FPS without external servers.
- **Analytics (1m):** Point to the live `ImpactPanel`. Show how the Inundated Area, Population at Risk, and Indicative Loss numbers tick up dynamically as the flood front hits specific GeoJSON infrastructure. Point out the live alert feed.
- **Comparison/Adaptation (1m):** Click "Save as Baseline". Adjust breach width/depth to simulate a worse scenario. Run again and show the SPH-style particle visualization overlay.
- **Ground Truth / NRT (30s):** Explain how satellite SAR data validates models. Toggle "Satellite" basemap. Click "Fetch NRT Mask (GEE Stub)" to show the blue observed inundation overlay.
- **Conclusion (30s):** Reiterate the offline-first resilience, speed, and real-world applicability for disaster management agencies.

## 3. Anticipated Judge Questions
- **"Is this full Navier-Stokes CFD?"**
  - *Response:* "No. For a real-time web dashboard, we implemented a highly optimized 2D Cellular Automata gravity-flow model running in a dedicated Web Worker. Full CFD takes hours/days; our goal is immediate tactical awareness. Our `SolverAdapter` interface is designed to accept output from high-fidelity solvers like Delft3D or SPH in the future."
- **"Where do you get the data?"**
  - *Response:* "DEMs from SRTM/ALOS, infrastructure from OSM (filtered). In a production environment, this would hook directly into Bhuvan or internal NTRO datasets."
- **"Why not use an existing tool like HEC-RAS?"**
  - *Response:* "HEC-RAS is a desktop engineering tool. CASCADE is a browser-based Command Center designed for crisis responders and decision-makers requiring zero installation, immediate results, and offline resilience."
