# Architecture Overview

This project is built for the SIH26161 Hackathon. The primary goal is a fast, stable, and visually impressive demonstration of dam break inundation without over-engineering.

## 1. Core Principles
- **Scenario-Driven**: All location-specific data (coordinates, dem paths, presets) are stored in JSON configs (`public/scenarios/`). No hardcoded Tehri values in the UI components.
- **Web Worker Simulation**: The cellular automata flood propagation logic runs in a dedicated TypeScript Web Worker (`simulation/floodWorker.ts`) to avoid blocking the main UI thread.
- **Preloaded Geospatial Analytics**: OpenStreetMap infrastructure (hospitals, villages, routes) are preloaded as lightweight GeoJSON. Turf.js computes intersections with the simulated flood front periodically, not every frame, to maintain 30+ FPS.

## 2. Tech Stack
- **Frontend**: Next.js (App Router), React, Tailwind CSS, Framer Motion
- **State Management**: Zustand
- **Map & 3D**: MapLibre GL JS + Deck.gl (`GridCellLayer` / `BitmapLayer`)
- **Simulation**: Custom TS Cellular Automata (TypedArrays)
- **Analytics**: Turf.js

## 3. Simulation Approach
We are **not** using Navier-Stokes. We use a simplified grid-based water transfer algorithm:
1. Water is injected at the breach point.
2. For each cell, we compute `surface level = terrain elevation + water depth`.
3. Water flows to lower-elevation neighboring cells over discrete time steps based on a gravity gradient and friction.
4. Output consists of `waterDepth` and `arrivalTime` TypedArrays passed via zero-copy Transferable Objects to the main thread.
