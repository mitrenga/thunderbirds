#!/usr/bin/env node
/**
 * Přehraje záznam originálu průchod po průchodu proti `app/thunderbirdsLogic.js`.
 *
 *   ./tools/matchphysics.mjs [--scenario NAME] [--verbose]
 *
 * Záznamy dělá `tools/tracephysics.py` (`build/ref/physics/`): stav
 * originálu na začátku hry (`start.bin`, první `$E299`) a pro každý průchod
 * hlavní smyčkou co vrátil `KEY-SCAN`, po kolika sdílených přístupech přišla
 * která přerušení a co se v paměti změnilo.
 *
 * Remake hru **začne z dat** (`data/maze.json`, `data/global.json`) tak,
 * jak ji začíná worker — `ThunderbirdsLogic.begin()`: panel, první místnost,
 * stav přerušení po startu TB2 — a nejdřív se porovná se `start.bin`. Pak
 * s týmiž klávesami a s přerušeními mezi týmiž přístupy udělá týž počet
 * průchodů **skutečným kódem, který jde do prohlížeče**. Po každém průchodu
 * se porovná:
 *
 * - **obrazovka** — všech 6912 bajtů
 * - **stav hry** — všechny úseky paměti z `data/global.json` (proměnné
 *   `$5C00`–`$6B54` se stínovou mapou, plavidly, bloky, nepřáteli a SEED,
 *   popisy místností, proměnné uvnitř kódu a samomodifikovaný kód)
 * - kolik sdílených přístupů průchod udělal a kolikrát četl klávesnici,
 *   a jak skončil (smrt, konec hry)
 *
 * Co originál za průchod změnil **mimo** porovnávané úseky a mimo zásobník,
 * se vypíše na konci (`nehlídané`) — stav, o kterém převod neví.
 *
 * U prvního rozdílu scénáře nástroj vypíše průchod, úsek, adresu a obě
 * hodnoty a jde na další scénář — další průchody by začínaly z jiné paměti.
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

const hex = (v, n = 4) => '$'+v.toString(16).toUpperCase().padStart(n, '0');
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
const STACK = [0x5B00, 0x5BFF];         // zásobník hry a obsluhy (min SP ze záznamu)

function regions(global) {
  const out = [[0x4000, 0x5B00, 'obrazovka']];
  for (const [name, r] of Object.entries(global.regions)) {
    out.push([r.address, r.address+r.length, name]);
  }
  return out.sort((a, b) => a[0]-b[0]);
}

function compare(mem, ref, list) {
  let checks = 0;
  for (const [lo, hi, name] of list) {
    for (let a = lo; a < hi; a++) {
      checks++;
      if (mem[a] !== ref[a]) {
        let count = 0;
        for (let b = lo; b < hi; b++) { if (mem[b] !== ref[b]) { count++; } }
        return {checks, diff: {name, address: a, mine: mem[a], theirs: ref[a], count}};
      }
    }
  }
  return {checks, diff: null};
}

function fresh(maze, global) {
  const logic = new ThunderbirdsLogic(maze, global);
  logic.begin();
  return logic;
}

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const only = args.includes('--scenario') ? args[args.indexOf('--scenario')+1] : null;
  if (!fs.existsSync(path.join(REF, 'start.bin'))) {
    console.error('chybí build/ref/physics – spusť ./tools/tracephysics.py');
    process.exit(2);
  }
  const maze = load('maze'), global = load('global');
  const list = regions(global);
  const watched = new Uint8Array(65536);
  for (const [lo, hi] of list) { watched.fill(1, lo, hi); }
  watched.fill(1, STACK[0], STACK[1]);
  const start = new Uint8Array(fs.readFileSync(path.join(REF, 'start.bin')));

  let checks = 0, diffs = 0, passes = 0;
  // 1. the start of the game, composed from the data
  const first = compare(fresh(maze, global).mem, start, list);
  checks += first.checks;
  if (first.diff) {
    const d = first.diff;
    console.log(`začátek hry: ${d.name} ${hex(d.address)} remake ${hex(d.mine, 2)}, originál ${hex(d.theirs, 2)}`
                + ` – v úseku ${d.count} rozdílů`);
    diffs++;
  } else {
    console.log(`začátek hry z dat = originál na prvním $E299 (${first.checks} kontrol)`);
  }

  // 2. the passes
  const unwatched = new Map();
  const files = fs.readdirSync(REF).filter((f) => f.endsWith('.json')).sort();
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(REF, file), 'utf8'));
    if (only && data.scenario !== only) { continue; }
    const logic = fresh(maze, global);
    const ref = start.slice();
    let done = 0, failed = null;
    for (let i = 0; i < data.passes.length; i++) {
      const p = data.passes[i];
      // a pass that hung in the original ends the scenario uncompared
      if (p.end && p.end.startsWith('stuck')) { break; }
      const raw = Buffer.from(p.mem, 'base64');
      for (let k = 0; k < raw.length; k += 3) {
        const a = (raw[k] << 8) | raw[k+1];
        ref[a] = raw[k+2];
        if (!watched[a]) { unwatched.set(a, (unwatched.get(a) || 0)+1); }
      }
      logic.isrQueue = p.ints;
      logic.scanQueue = p.scan.slice();
      let outcome;
      try {
        if (p.setup) {
          // ★ both craft put into a room, as tools/tracephysics.py did
          for (const [a, v] of p.setup.pokes) { logic.mem[a] = v; }
          outcome = logic.jump(p.setup.room);
        } else {
          outcome = logic.pass();
        }
      } catch (error) {
        failed = `průchod ${i}: ${error.message}`;
        if (verbose) { console.log(error.stack); }
        break;
      }
      checks += 3;
      // ★ where the game leaves the loop (game over, room 0, the mission done)
      // must be where the original left it
      const ending = ['gameOver', 'base', 'missionComplete', 'outOfFuel'];
      if (p.setup && outcome === 'restart') { outcome = 'pass'; }
      if (logic.events !== p.events || logic.scans !== p.scan.length
          || (p.end || ending.includes(outcome)) && outcome !== p.end) {
        failed = `průchod ${i}: sdílené přístupy ${logic.events} / ${p.events}, KEY-SCAN ${logic.scans} / `
          + `${p.scan.length}, konec ${outcome} / ${p.end || '-'}`;
        break;
      }
      const result = compare(logic.mem, ref, list);
      checks += result.checks;
      if (result.diff) {
        const d = result.diff;
        failed = `průchod ${i} (${outcome}, klávesa ${p.key || '-'}, přerušení ${JSON.stringify(p.ints)}): `
          + `${d.name} ${hex(d.address)} remake ${hex(d.mine, 2)}, originál ${hex(d.theirs, 2)} – v úseku ${d.count} rozdílů`;
        break;
      }
      done++;
      if (p.end) {
        // the original went on into code that is not the loop: compared up
        // to here, and the scenario is over
        break;
      }
    }
    passes += done;
    if (failed) { diffs++; }
    console.log(`${data.scenario.padEnd(6)} ${String(done).padStart(5)} / ${data.passes.length} průchodů`
                + (failed ? ` — ${failed}` : ', 0 rozdílů'));
  }
  if (unwatched.size) {
    const top = [...unwatched.entries()].sort((a, b) => a[0]-b[0]).slice(0, 40)
      .map(([a, n]) => `${hex(a)}×${n}`).join(' ');
    console.log(`nehlídané (originál mění, porovnání nevidí): ${unwatched.size} adres: ${top}`);
  }
  console.log(`${passes} průchodů, ${checks} kontrol, **${diffs} rozdílů**`);
  process.exit(diffs ? 1 : 0);
}

main();
