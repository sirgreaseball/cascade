// Solver speed on this machine: the grid solver alone (SPH off), offered the graphics card or held
// to the processor, read from the Model tab's device readout.
// usage: node gpubench.cjs <playwrightDir> <url> [runs=gpu,cpu]
//
//   gpu      offered the graphics card, paced as it is by default: while a run plays on screen the
//            GPU solver pauses after each submission so the map keeps its frame rate, so this is
//            the wall time a user waits, not what the card can do
//   gpufast  offered the graphics card with "Compute as fast as possible" on: no pauses
//   cpu      held to the processor, which is never paced
//
// Runs go in the order given, in one page: `gpu,cpu,gpufast,gpu,cpu,gpufast` is two interleaved
// rounds.
//
// The switch only *offers* the graphics card. Since the solvers are raced over the opening slice
// (57418b2), asking for the GPU and getting it are different things, so every run here reports the
// backend that actually ran and says so when it is not the one that was asked for. A timing printed
// against the wrong backend is worse than no timing at all.
const [, , pwDir, url, runsArg = 'gpu,cpu'] = process.argv;
const RUNS = runsArg.split(',');
if (!RUNS.every((m) => ['gpu', 'gpufast', 'cpu'].includes(m))) throw new Error(`runs must be gpu, gpufast or cpu: ${runsArg}`);
const { chromium } = require(pwDir);
const readout = (page) =>
  page.evaluate(() => {
    const title = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === 'This device');
    let el = title;
    while (el && !(el.innerText || '').includes('Copy performance report')) el = el.parentElement;
    return el ? el.innerText.split('\n').filter((l) => /Grid solver|Graphics card|Processor|run|Frames/.test(l)).join(' | ') : 'readout not found';
  });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.getByRole('button', { name: 'Run simulation' }).first().waitFor({ timeout: 240000 });
  await page.waitForTimeout(8000);
  await page.getByRole('radio', { name: 'Model', exact: true }).first().click();
  await page.waitForTimeout(800);
  // "Finished in" appears before the run state clears, and the settings switches stay disabled
  // until it does — so wait for the switch itself rather than for the text, or for a fixed pause.
  const enabled = (name) => page.locator(`[role=switch][aria-label="${name}"]:not([disabled])`).first();
  const GPU_SWITCH = 'Let the grid solver try the graphics card';
  const FAST_SWITCH = 'Compute as fast as possible';
  // Switches are set to a state, never toggled blind: this script used to click "SPH solver"
  // assuming it started on, and once SPH became off by default the click turned it on, so every
  // "grid solver alone" timing ran SPH alongside.
  const set = async (name, want) => {
    await enabled(name).waitFor({ timeout: 600000 });
    if (((await enabled(name).getAttribute('aria-checked')) === 'true') !== want) await enabled(name).click();
    await page.waitForTimeout(400);
    if (((await enabled(name).getAttribute('aria-checked')) === 'true') !== want) throw new Error(`could not set "${name}" to ${want}`);
  };
  await set('SPH solver', false);
  const run = async (mode, button) => {
    const asked = mode === 'cpu' ? 'CPU' : 'GPU';
    await set(GPU_SWITCH, asked === 'GPU');
    // The pacing switch is only shown while the graphics card is offered.
    if (asked === 'GPU') await set(FAST_SWITCH, mode === 'gpufast');
    const t0 = Date.now();
    await page.getByRole('button', { name: button }).first().click();
    await page.getByText(/Finished in/).first().waitFor({ timeout: 1500000 });
    const wall = ((Date.now() - t0) / 1000).toFixed(1);
    await page.waitForTimeout(1500);
    await page.getByText('This device', { exact: true }).first().scrollIntoViewIfNeeded();
    const line = await readout(page);
    // The readout joins its fields with " | ", so the solver's value is the field after the label.
    const field = /Grid solver \| ([^|]*)/.exec(line)?.[1] ?? '';
    // Anchored: the reason that follows also contains "graphics card" ("...the graphics card the
    // browser gave it..."), so a substring test reads a processor run as a GPU one.
    const ran = /^\s*Graphics card/i.test(field) ? 'GPU' : /^\s*Processor/i.test(field) ? 'CPU' : 'unknown';
    console.log(`${mode}: asked for ${asked}, ran on ${ran}: finished after ${wall} s of wall time`);
    if (ran !== asked) console.log(`   ** ${wall} s is the ${ran}, not the ${asked} — do not file it as a ${asked} timing **`);
    console.log('   ' + line);
  };
  for (const [i, mode] of RUNS.entries()) await run(mode, i === 0 ? 'Run simulation' : 'Run again with the current settings');
  console.log('console errors: ' + errors.length);
  for (const e of errors.slice(0, 6)) console.log('   ' + e);
  await browser.close();
})().catch((e) => { console.error('BENCH FAILED', e.message); process.exit(1); });
