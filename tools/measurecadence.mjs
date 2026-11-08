#!/usr/bin/env node
/**
 * Kolik T-stavů trvá průchod hlavní smyčkou originálu — a z čeho.
 *
 *   ./tools/measurecadence.mjs
 *
 * Záznamy `tools/tracephysics.py` (`build/ref/physics/*.json`) nesou pro
 * každý průchod jeho T-stavy v originálu (`t`, i s obsluhami přerušení, které
 * do něj padly) a délku každé té obsluhy (`isrT`). Tenhle nástroj je
 * přehraje přes `app/thunderbirdsLogic.js` jako `tools/matchphysics.mjs`
 * a ke každému průchodu vezme, kolik T-stavů remake spálil ve **zpožděních**
 * originálu (`logic.waited`: smyčky `$F8B6` — zpoždění průchodu `$F396`,
 * `(5 − nepřátel) × $78` z `$E4D9`, čekání při otočce, při stání, při
 * přepnutí plavidla, po smrti; přesně). Co zbude po odečtení obsluh, je
 * **práce** průchodu:
 *
 *     t = waited + práce + Σ isrT
 *
 * Pak spočítá:
 *
 * 1. **práci** průchodu `WORK_T` (průměr; `app/gameWorker.js`)
 * 2. **délku obsluhy přerušení** jako model z toho, co obsluha udělala
 *    (`logic.isrStats`: plameny, nota melodie, pulzy šumu a jejich délky) —
 *    metodou nejmenších čtverců proti změřeným `isrT`; konstanty patří do
 *    `ThunderbirdsLogic.ISR_*`, `logic.isrCost()`
 * 3. **hodiny workeru** nasimulované na týchž průchodech: tik = snímek, běží-li
 *    ještě obsluha, přerušení propadne (jako s DI v originálu), průchod stojí
 *    `waited + WORK_T` z času, který snímku zbude po obsluze — a kolik to dá
 *    snímků a přerušení proti originálu. Přerušení jsou hodiny hry (vteřiny,
 *    palivo), snímky reálný čas
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const REF = path.join(ROOT, 'build/ref/physics');
const require = createRequire(import.meta.url);
const loadClassicScript = require(path.join(ROOT, 'app/svision/tools/classicScript.cjs'));

globalThis.atob = globalThis.atob || ((data) => Buffer.from(data, 'base64').toString('binary'));
globalThis.ZXRomDraw = loadClassicScript(path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxRomDraw.js'));
globalThis.RoomRenderer = loadClassicScript(path.join(ROOT, 'app/roomRenderer.js'));
const ThunderbirdsLogic = loadClassicScript(path.join(ROOT, 'app/thunderbirdsLogic.js'));
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
const FRAME_T = 69888;

function solve(A, b) {
  const k = b.length;
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let r = i+1; r < k; r++) { if (Math.abs(A[r][i]) > Math.abs(A[p][i])) { p = r; } }
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    for (let r = 0; r < k; r++) {
      if (r !== i && A[i][i]) {
        const f = A[r][i]/A[i][i];
        for (let c = 0; c < k; c++) { A[r][c] -= f*A[i][c]; }
        b[r] -= f*b[i];
      }
    }
  }
  return b.map((v, i) => A[i][i] ? v/A[i][i] : 0);
}

function main() {
  const maze = load('maze'), global = load('global');
  const scenarios = [];
  const isrs = [];
  for (const file of fs.readdirSync(REF).filter((f) => f.endsWith('.json')).sort()) {
    const data = JSON.parse(fs.readFileSync(path.join(REF, file), 'utf8'));
    const logic = new ThunderbirdsLogic(maze, global);
    logic.begin();
    const interrupt = logic.interrupt.bind(logic);
    let costs = [];
    logic.interrupt = () => { interrupt(); costs.push(Object.assign({}, logic.isrStats, {model: logic.isrCost()})); };
    const run = {name: data.scenario, passes: [], isr: [], frames: 0, ints: 0};
    for (const p of data.passes) {
      if (p.end) { break; }
      costs = [];
      logic.isrQueue = p.ints;
      logic.scanQueue = p.scan.slice();
      if (p.setup) {
        for (const [a, v] of p.setup.pokes) { logic.mem[a] = v; }
        logic.jump(p.setup.room);
      } else {
        const outcome = logic.pass();
        const isr = p.isrT.reduce((sum, t) => sum+t, 0);
        if (outcome === 'pass') {
          run.passes.push({t: p.t, waited: logic.waited, work: p.t-logic.waited-isr});
        }
        run.frames += p.t/FRAME_T;
        run.ints += p.ints.length;
      }
      costs.forEach((c, i) => { c.t = p.isrT[i]; isrs.push(c); run.isr.push(c); });
    }
    scenarios.push(run);
  }
  const f = (t) => (t/FRAME_T).toFixed(3);
  // 1. the work of a pass
  const passes = scenarios.flatMap((r) => r.passes);
  const n = passes.length;
  const work = passes.reduce((sum, r) => sum+r.work, 0)/n;
  const sd = Math.sqrt(passes.reduce((sum, r) => sum+(r.work-work)**2, 0)/n);
  console.log(`${n} průchodů (${scenarios.length} scénářů), průměrně `
              + `${f(passes.reduce((sum, r) => sum+r.t, 0)/n)} snímku na průchod`);
  console.log(`práce průchodu WORK_T = ${Math.round(work)} T (${f(work)} snímku), `
              + `směrodatná odchylka ${Math.round(sd)} T`);
  // 2. the handler's length
  const feats = (r) => [1, r.flames, r.note, r.pulses, r.sum];
  const k = 5, A = Array.from({length: k}, () => Array(k).fill(0)), b = Array(k).fill(0);
  for (const r of isrs) {
    const x = feats(r);
    for (let i = 0; i < k; i++) { b[i] += x[i]*r.t; for (let j = 0; j < k; j++) { A[i][j] += x[i]*x[j]; } }
  }
  const w = solve(A, b);
  let e2 = 0, e2model = 0;
  for (const r of isrs) {
    const d = r.t-feats(r).reduce((sum, v, i) => sum+v*w[i], 0);
    e2 += d*d;
    e2model += (r.t-r.model)**2;
  }
  console.log(`obsluha přerušení (${isrs.length} obsluh): ISR_BASE ${Math.round(w[0])}, ISR_FLAMES ${Math.round(w[1])}, `
              + `ISR_NOTE ${Math.round(w[2])}, ISR_PULSE ${Math.round(w[3])}, ISR_PULSE_UNIT ${Math.round(w[4])} T; `
              + `chyba ${Math.round(Math.sqrt(e2/isrs.length))} T (konstanty v logice: ${Math.round(Math.sqrt(e2model/isrs.length))} T)`);
  // 3. the worker's clock on the same passes, with the logic's model
  let origFrames = 0, origInts = 0, frames = 0, ints = 0;
  for (const run of scenarios) {
    origFrames += run.frames;
    origInts += run.ints;
    let left = 0, passT = 0, isr = 0, done = 0;
    while (done < run.passes.length) {
      frames++;
      if (left <= 0) {
        ints++;
        left = isr < run.isr.length ? run.isr[isr++].model : ThunderbirdsLogic.ISR_BASE;
      }
      const used = Math.min(left, FRAME_T);
      left -= used;
      passT -= FRAME_T-used;
      while (passT <= 0 && done < run.passes.length) {
        passT += run.passes[done].waited+work;
        done++;
      }
    }
  }
  const pct = (a, b) => (100*(a-b)/b).toFixed(1)+' %';
  console.log(`originál: ${Math.round(origFrames)} snímků, ${origInts} přerušení `
              + `(ztratilo se ${Math.round(origFrames)-origInts}, ${(100*(origFrames-origInts)/origFrames).toFixed(1)} % snímků)`);
  console.log(`hodiny workeru: ${frames} snímků (${pct(frames, origFrames)}), ${ints} přerušení `
              + `(${pct(ints, origInts)})`);
}

main();
