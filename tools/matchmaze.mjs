#!/usr/bin/env node
/**
 * Místnosti, jak je nakreslí remake, proti tomu, jak je nakreslí originál.
 *
 *   ./tools/matchmaze.mjs [--room N] [--verbose]
 *
 * Reference dělá `tools/tracerooms.py`: v simulátoru ze stavu hry v bludišti
 * zavolá vstup do místnosti originálu `$C991` pro každé číslo, vždy ze stejné
 * paměti a se stejným SEED. Tady se totéž udělá **skutečným kódem, který jde
 * do prohlížeče** — `app/roomRenderer.js` nad `data/maze.json` a
 * `data/global.json` — ze stejné obrazovky (panel) a se stejným SEED,
 * a porovná se po místnostech:
 *
 * - **obrazovka** — všech 6912 bajtů videopaměti
 * - **stínová mapa** `$5EF6` — 800 kódů a 800 atributů, proti nimž hra
 *   testuje plavidla
 * - **SEED po** — kolik a jak generátor kreslení spotřebovalo
 * - **proměnné** `$5C00`–`$6B54` (bez stínové mapy) a popisy místností —
 *   záznamy bloků, nepřátel, plavidel, posunuté sprity, okno, čítače
 *
 * Místnost s půdorysem 0 originál přeskočí na další číslo (`$CB24`) a cestou
 * uloží bloky (`$C95A`); i to se porovná.
 *
 * Běžné místnosti (půdorys 1–29) i zvláštní (30–34, `$D3A9`, vlákna pavouků
 * přes ROM DRAW-LINE — svision `ZXRomDraw`).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const REF = path.join(ROOT, 'build/ref/rooms');

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--room') ? Number(args[args.indexOf('--room')+1]) : null;
  const verbose = args.includes('--verbose');
  if (!fs.existsSync(path.join(REF, 'rooms.json'))) {
    console.error('chybí build/ref/rooms – spusť ./tools/tracerooms.py');
    process.exit(2);
  }
  globalThis.atob = globalThis.atob || ((data) => Buffer.from(data, 'base64').toString('binary'));
  // classic scripts, as the worker loads them (importScripts)
  const loadClassicScript = createRequire(import.meta.url)(path.join(ROOT, 'app/svision/tools/classicScript.cjs'));
  globalThis.ZXRomDraw = loadClassicScript(path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxRomDraw.js'));
  const RoomRenderer = loadClassicScript(path.join(ROOT, 'app/roomRenderer.js'));
  const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
  const renderer = new RoomRenderer(load('maze'), load('global'));
  const info = JSON.parse(fs.readFileSync(path.join(REF, 'rooms.json'), 'utf8'));
  const base = fs.readFileSync(path.join(REF, 'base.bin'));

  let checks = 0, diffs = 0, rooms = 0;
  const skipped = [], romRooms = [];
  const diff = (a, b, from, to, offset = 0) => {
    let d = 0, first = -1;
    for (let i = from; i < to; i++) {
      checks++;
      if (a[i] !== b[i-offset]) { d++; if (first < 0) { first = i; } }
    }
    return {d, first};
  };
  for (const key of Object.keys(info.rooms).map(Number).sort((a, b) => a-b)) {
    const ref = info.rooms[key];
    if (only !== null && key !== only) { continue; }
    const drawnLayout = info.rooms[ref.drawn] ? info.rooms[ref.drawn].layout : ref.layout;
    if (ref.returned === false) {
      skipped.push(`${key} (nevrátila se)`);
      continue;
    }
    renderer.reset();
    renderer.setSeed(info.seed);
    const video = {bytes: renderer.screen()};
    video.bytes.set(base.subarray(0x4000, 0x5B00));
    try {
      if (!renderer.enterRoom(key)) {
        skipped.push(String(key));
        continue;
      }
    } catch (error) {
      if (error.message.includes('poškozený')) {
        romRooms.push(key);
      } else {
        skipped.push(`${key} (${error.message})`);
      }
      continue;
    }
    if (renderer.readsRom) {
      // ★ only after a layout-0 room has saved the blocks of the room before
      // into a list that is not its own: the next room prints blocks off the
      // screen and $F898 reads its line table out of the ROM. The ROM is not
      // in the remake's data; these rooms cannot be reached in the game
      romRooms.push(key);
      continue;
    }
    rooms++;
    const after = fs.readFileSync(path.join(REF, `room${String(key).padStart(2, '0')}.bin`));
    const screen = diff(video.bytes, after, 0, 6912);
    const mem = renderer.mem;
    const shadow = diff(mem, after, 0x5EF6, 0x5EF6+1600, 0x4000);
    const vars1 = diff(mem, after, 0x5C00, 0x5EF6, 0x4000);
    const vars2 = diff(mem, after, 0x5EF6+1600, 0x6B55, 0x4000);
    const roomsTable = diff(mem, after, 0x7F9A, 0x8487, 0x4000);
    checks++;
    const seedOk = renderer.seed() === ref.seedAfter;
    const d = screen.d + shadow.d + vars1.d + vars2.d + roomsTable.d + (seedOk ? 0 : 1);
    diffs += d;
    if (d || verbose) {
      const where = (r) => r.first >= 0 ? ` (první $${r.first.toString(16).toUpperCase()})` : '';
      console.log(`místnost ${String(key).padStart(2)} půdorys ${String(ref.layout).padStart(2)}: `
        + `obrazovka ${screen.d}${where(screen)}, stín ${shadow.d}${where(shadow)}, `
        + `proměnné ${vars1.d+vars2.d}${where(vars1.d ? vars1 : vars2)}, popisy ${roomsTable.d}, `
        + `SEED ${seedOk ? 'ok' : '$'+renderer.seed().toString(16)+' ≠ $'+ref.seedAfter.toString(16)}`);
    }
  }
  console.log(`${rooms} místností, ${checks} kontrol, **${diffs} rozdílů**`);
  if (romRooms.length) { console.log(`poškozený stav po místnosti s půdorysem 0 – čte kód nebo ROM, které nejsou v datech (ve hře nedosažitelné): ${romRooms.join(', ')}`); }
  if (skipped.length) { console.log(`nepokryté: ${skipped.join(', ')}`); }
  process.exit(diffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
