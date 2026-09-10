// Flood simulation worker. Owns one EngineRuntime and computes as fast as it can, in slices,
// so pause/stop messages are handled between slices. Results go back by structured cloning;
// no transfer lists are used anywhere (the UI must never hold a detached buffer).

import { EngineRuntime } from './runtime.ts';
import type { EngineId, WorkerInbound, WorkerOutbound } from './types.ts';

let runtime: EngineRuntime | null = null;
let running = false;
let engine: EngineId = 'swe';

const post = (msg: WorkerOutbound) => (self as unknown as Worker).postMessage(msg);

function loop(): void {
  if (!running || !runtime) return;
  try {
    const done = runtime.runSlice(40);
    if (done) {
      running = false;
      return;
    }
  } catch (err) {
    running = false;
    post({ type: 'error', engine, message: err instanceof Error ? err.message : String(err) });
    return;
  }
  setTimeout(loop, 0);
}

self.onmessage = (event: MessageEvent<WorkerInbound>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      try {
        engine = msg.config.engine;
        runtime = new EngineRuntime(msg.config, post);
        running = false;
        post({ type: 'ready', engine, info: runtime.info() });
      } catch (err) {
        post({ type: 'error', engine: msg.config.engine, message: err instanceof Error ? err.message : String(err) });
      }
      break;
    case 'start':
      if (runtime && !running) {
        running = true;
        loop();
      }
      break;
    case 'pause':
      running = false;
      break;
    case 'stop':
      running = false;
      runtime = null;
      break;
  }
};
