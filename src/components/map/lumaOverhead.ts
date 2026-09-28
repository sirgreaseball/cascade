// Work luma.gl 9.4 repeats for nothing, removed at the one place the map's device is created.
//
// Both were found in traces of the map on a GTX 1650 laptop while a flood played, and both are
// bookkeeping rather than drawing: the answers never change, luma.gl just asks again.
//
// 1. Uniform blocks, on every draw call. Before each draw luma.gl looks up every uniform block of the
//    program by name and binds it to its binding point again (`WEBGLRenderPipeline._applyBindings`).
//    Both answers are fixed while the program stays linked: the index belongs to the linked program,
//    and luma.gl hands out binding points in the same order every time. With about seven blocks a
//    layer and fifty-odd draws a map redraw, that was some 350 lookups and 350 bindings a redraw —
//    40,000 of each a second at 144 Hz, every binding also a command the browser's GPU process
//    executes — and 7–8 % of the main thread's time. They are now kept on the context, the way
//    luma.gl already caches the rest of WebGL's state: an index is looked up once per program and
//    name, and a binding reaches WebGL only when it changes. Relinking a program forgets it.
//
// 2. A debug description of every texture's sampler. Creating a texture logs its sampler settings at
//    log level 2 (`WEBGLTexture._setSamplerParameters`), and the description is built before the log
//    level is checked: each parameter's name is found by walking every property of the WebGL context,
//    twice. With logging off the string is thrown away, after costing a few milliseconds per terrain
//    tile — three quarters of the time spent creating its texture. The description is now empty;
//    nothing else reads it.

import type { Device } from '@luma.gl/core';

const PATCHED = Symbol('cascade.lumaOverhead');

export function trimLumaOverhead(device: Device): void {
  const tagged = device as Device & { [PATCHED]?: true; gl?: WebGL2RenderingContext; getGLKeys?: unknown };
  if (tagged[PATCHED]) return;
  tagged[PATCHED] = true;
  if (typeof tagged.getGLKeys === 'function') tagged.getGLKeys = () => ({});
  if (tagged.gl) cacheUniformBlocks(tagged.gl);
}

function cacheUniformBlocks(gl: WebGL2RenderingContext): void {
  const indices = new WeakMap<WebGLProgram, Map<string, number>>();
  const bindings = new WeakMap<WebGLProgram, number[]>();
  const getUniformBlockIndex = gl.getUniformBlockIndex.bind(gl);
  const uniformBlockBinding = gl.uniformBlockBinding.bind(gl);
  const linkProgram = gl.linkProgram.bind(gl);

  gl.getUniformBlockIndex = (program: WebGLProgram, name: string): number => {
    let known = indices.get(program);
    if (!known) indices.set(program, (known = new Map()));
    let index = known.get(name);
    if (index === undefined) {
      index = getUniformBlockIndex(program, name);
      known.set(name, index);
    }
    return index;
  };

  gl.uniformBlockBinding = (program: WebGLProgram, index: number, binding: number): void => {
    let bound = bindings.get(program);
    if (!bound) bindings.set(program, (bound = []));
    if (bound[index] === binding) return;
    bound[index] = binding;
    uniformBlockBinding(program, index, binding);
  };

  gl.linkProgram = (program: WebGLProgram): void => {
    indices.delete(program);
    bindings.delete(program);
    linkProgram(program);
  };
}
