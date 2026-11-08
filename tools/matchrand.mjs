#!/usr/bin/env node
/**
 * Porovná generátory náhody hry s generátory originálu.
 *
 *   ./tools/matchrand.mjs [--seed 0xABCD]
 *
 * ★ Originál má generátor `$F8BC` se stavem v ROM `SEED` (`$5C76`) a navíc
 * `$A50F`, který ve zvuku „šum“ míchá dolní bajt (`sources/docs/
 * disasm_notes.md` §5). Hra je má přenesené instrukci po instrukci nad
 * svou pamětí — `rand` v `app/roomRenderer.js` a `noiseStep`
 * v `app/thunderbirdsLogic.js`, tytéž funkce, které běží ve workeru. Tenhle
 * nástroj to dokládá:
 *
 * - `tools/tracerand.py` pustí **skutečný kód z kazety** v simulátoru Z80
 * - `rand`: 65 536 volání (celá perioda) od semínka, po každém
 *   vrácené číslo i nový stav — 3 × 65 536 kontrol
 * - `noiseStep`: od semínka `$xx00` pro všech 256 hodnot dolního bajtu po
 *   jednom volání (sekvence `noise` od každého z 256 stavů), číslo i stav —
 *   3 × 256 × 256 kontrol
 *
 * Bez `--seed` se začíná od `$0000`, tedy od stavu na vstupu do hry.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const COUNT = 65536;

const loadClassicScript = createRequire(import.meta.url)(path.join(ROOT, 'app/svision/tools/classicScript.cjs'));
globalThis.atob = globalThis.atob || ((data) => Buffer.from(data, 'base64').toString('binary'));
globalThis.ZXRomDraw = loadClassicScript(path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxRomDraw.js'));
globalThis.RoomRenderer = loadClassicScript(path.join(ROOT, 'app/roomRenderer.js'));
const ThunderbirdsLogic = loadClassicScript(path.join(ROOT, 'app/thunderbirdsLogic.js'));
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));

/** the game's logic over the program's data, SEED set */
function game(seed) {
  const logic = new ThunderbirdsLogic(load('maze'), load('global'));
  logic.setSeed(seed);
  return logic;
}

function trace(fn, count, seed, sweep) {
  const out = execFileSync(path.join(HERE, 'tracerand.py'),
                           ['--fn', fn, '--count', String(count), '--seed', '0x'+seed.toString(16)]
                           .concat(sweep ? ['--sweep'] : []),
                           {maxBuffer: 16*1024*1024});
  const want = 3*count*(sweep ? 256 : 1);
  if (out.length !== want) {
    console.error(`tracerand.py vrátil ${out.length} B místo ${want}`);
    process.exit(2);
  }
  return out;
}

function compare(logic, call, z80, count, label, counter) {
  for (let i = 0; i < count; i++) {
    const value = call(logic);
    const state = logic.seed();
    const expect = [z80[3*i], z80[3*i+1], z80[3*i+2]];
    const got = [value, state & 0xFF, state >> 8];
    for (let k = 0; k < 3; k++) {
      counter.checks++;
      if (got[k] !== expect[k]) {
        counter.diffs++;
        if (counter.first === null) {
          counter.first = `${label}, volání ${i+1}: hra ${got.map((v) => v.toString(16))}, `
                          + `Z80 ${expect.map((v) => v.toString(16))}`;
        }
      }
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const seed = args.includes('--seed') ? Number(args[args.indexOf('--seed')+1]) & 0xFFFF : 0;
  const hex = (v) => '$'+v.toString(16).toUpperCase().padStart(4, '0');

  // 1. $F8BC, celá perioda
  const logic = game(seed);
  const rand = {checks: 0, diffs: 0, first: null};
  const seen = new Uint8Array(65536);
  const z80 = trace('rand', COUNT, seed);
  for (let i = 0; i < COUNT; i++) {
    compare(logic, (l) => l.rand(), z80.subarray(3*i, 3*i+3), 1, `$F8BC`, rand);
    seen[logic.seed()] = 1;
  }
  const states = seen.reduce((sum, v) => sum+v, 0);
  console.log(`$F8BC od ${hex(seed)}, ${COUNT} volání: ${rand.checks} kontrol, ${rand.diffs} rozdílů, `
              + `různých stavů ${states} z 65536`);
  if (states !== 65536) { rand.diffs++; }

  // 2. $A50F, 256 sekvencí po 256 voláních
  const noise = {checks: 0, diffs: 0, first: null};
  const sweep = trace('noise', 256, seed, true);
  for (let low = 0; low < 256; low++) {
    const s = (seed & 0xFF00) | low;
    compare(game(s), (l) => l.noiseStep(), sweep.subarray(768*low, 768*(low+1)), 256, `$A50F od ${hex(s)}`, noise);
  }
  console.log(`$A50F, 256 × 256 volání: ${noise.checks} kontrol, ${noise.diffs} rozdílů`);

  for (const c of [rand, noise]) { if (c.first) { console.log('  první rozdíl: '+c.first); } }
  const checks = rand.checks+noise.checks, diffs = rand.diffs+noise.diffs;
  console.log(`\nCELKEM: ${checks} kontrol, ${diffs} rozdílů`);
  process.exit(diffs ? 1 : 0);
}

main();
