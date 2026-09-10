// One-time GPU probe: can this browser run the 3D map, and can it afford multisampling?
// On integrated GPUs, MSAA alone costs ~40% of a 3D frame (measured on Intel UHD: 46 → 74 fps
// panning); discrete and Apple-silicon GPUs keep it for smoother edges.

export interface GpuInfo {
  webgl2: boolean;
  renderer: string;
  tier: 'high' | 'standard';
}

let cached: GpuInfo | null = null;

export function detectGpu(): GpuInfo {
  if (cached) return cached;
  if (typeof document === 'undefined') return { webgl2: true, renderer: '', tier: 'standard' };
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return (cached = { webgl2: false, renderer: '', tier: 'standard' });
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const software = /SwiftShader|llvmpipe|Basic Render|Software/i.test(renderer);
    const high = !software && /NVIDIA|GeForce|RTX|Quadro|Radeon RX|Radeon Pro|Apple M\d|Apple GPU/i.test(renderer);
    return (cached = { webgl2: true, renderer, tier: high ? 'high' : 'standard' });
  } catch {
    return (cached = { webgl2: false, renderer: '', tier: 'standard' });
  }
}
