// Flood simulation worker. Owns one engine runtime (the grid solver on the GPU when WebGPU is
// available, otherwise on the CPU; or the SPH solver) and computes as fast as it can, in slices,
// so pause/stop messages are handled between slices. Results go back by structured cloning;
// no transfer lists are used anywhere (the UI must never hold a detached buffer).

import { createRuntime } from './runtime.ts';
import type { Runtime } from './runtime.ts';
import type { EngineId, WorkerInbound, WorkerOutbound } from './types.ts';

let runtime: Runtime | null = null;
let running = false;
let engine: EngineId = 'swe';

const post = (msg: WorkerOutbound) => (self as unknown as Worker).postMessage(msg);

// Yield between slices through a MessageChannel: chained setTimeout(0) calls are clamped to
// 4 ms, which idled the solver about a tenth of the time. Pause and stop messages still get
// through between slices.
const channel = new MessageChannel();
channel.port1.onmessage = () => void loop();
const next = () => channel.port2.postMessage(null);

async function loop(): Promise<void> {
  if (!running || !runtime) return;
  try {
    const done = await runtime.runSlice(40);
    if (done) {
      running = false;
      return;
    }
  } catch (err) {
    running = false;
    post({ type: 'error', engine, message: err instanceof Error ? err.message : String(err) });
    return;
  }
  next();
}

self.onmessage = (event: MessageEvent<WorkerInbound>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      engine = msg.config.engine;
      running = false;
      createRuntime(msg.config, post)
        .then((rt) => {
          runtime = rt;
          post({ type: 'ready', engine, info: rt.info() });
        })
        .catch((err) => post({ type: 'error', engine: msg.config.engine, message: err instanceof Error ? err.message : String(err) }));
      break;
    case 'start':
      if (runtime && !running) {
        running = true;
        void loop();
      }
      break;
    case 'pause':
      running = false;
      break;
    case 'stop':
      running = false;
      runtime?.dispose?.();
      runtime = null;
      break;
  }
};
