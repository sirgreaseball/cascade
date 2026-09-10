# CASCADE: Cinematic Command Center Front Door

An Awwwards-style, 60fps cinematic WebGL scrollytelling experience in the lineage of Lusion and Active Theory.

## Run / Build
1. Start Dev Server: `npm run dev`
2. Build for Prod: `npm run build`
3. Preview Prod: `npm run preview`

## Architecture & Performance Notes
- **Zero Allocations:** The `useFrame` loop in the `TerrainInundation.tsx` WebGL component statically updates shader uniforms via `.value` without allocating new objects, ensuring a rock-solid 60fps on mid-tier hardware.
- **Postprocessing:** Utilizes `@react-three/postprocessing` for Bloom, Vignette, Noise (grain), and Chromatic Aberration. Native antialiasing is disabled in the `<Canvas>` to ensure the postprocessing passes run performantly. 
- **GPU Particles:** The background of the Manifesto section uses a single `THREE.InstancedMesh` to render 2,000 drifting dust particles for massive performance gains over DOM nodes.
- **DPR Clamping:** Device Pixel Ratio is clamped to `[1, 1.75]` via the Canvas props to ensure high-DPI displays (like MacBooks) don't thermal throttle the GPU rendering 4K postprocessing passes.

## Customization

### How to swap the CTA Route
All magnetic CTA buttons currently route to `/command`.
To change this (e.g., to `http://localhost:3000`), edit the `href` attribute in:
1. `src/components/sections/Hero.tsx`
2. `src/components/sections/FinalCTA.tsx`

### How to swap the Accent Token
The site uses Amber (`#f59e0b`) as the primary accent color.
To change this globally, open `src/index.css` and modify the CSS variables:
```css
@theme {
  /* Change this hex code */
  --color-accent: #f59e0b; 
}
```
