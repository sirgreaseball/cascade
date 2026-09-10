# Project CASCADE
**Critical Asset & Scenario Computation for Dam Emergencies**

Project CASCADE is a real-time, browser-based "Dam Break Inundation Command Center" that simulates flood propagation downstream of a dam and shows impact on critical infrastructure such as roads, bridges, villages, hospitals, and evacuation routes.

Built for the **Smart India Hackathon (SIH26161)** under the National Technical Research Organisation (NTRO).

## Tech Stack
- Next.js 15+ (App Router)
- React 19
- Zustand (State Management)
- MapLibre GL JS + Deck.gl (3D Geospatial Engine)
- TailwindCSS + Framer Motion (UI Shell)
- TypeScript Web Workers (Simulation Engine)

## Getting Started

## Live Demo Venue Instructions

During the hackathon presentation, ensure the environment is pre-built to avoid network dependency risks.

```bash
# 1. Install precise dependencies (requires internet once)
npm ci

# 2. Build the production application
npm run build

# 3. Start the production server (runs on http://localhost:3000)
npm run start
```

## Running the Development Server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
