#!/usr/bin/env node
/**
 * Porovná obrazovky, které remake složí, s videopamětí originálu.
 *
 *   ./tools/matchscreen.mjs [--verbose]
 *
 * Staví je **skutečným kódem, který jde do prohlížeče** —
 * `app/screenComposer.js` nad `data/screen.json`, herní obrazovku nakrmenou
 * snímkem z `app/gameWorker.js` — a porovnává je bajt po bajtu se snímky
 * videopaměti originálu, které uložil `tools/mkscreen.py`:
 *
 * 1. **titulka** — všech 6912 bajtů proti `build/ref/title.scr`: obrazovka
 *    simulátoru zastaveného hned za `CALL $C1EF` (`$C18F`). ★ Titulka remaku
 *    je složená z programu (obrázek `$A673`, 130 čísel generátoru `$F8BC`
 *    od `SEED = $0000`, prázdný pás běžícího textu), takže nula tady říká,
 *    že je to **první snímek titulky originálu** a že generátor i semínko
 *    sedí i v kreslení
 * 2. **titulka pod menu** — menu remaku je okno přes titulku
 *    (`composeMenu`); všechno **mimo okno** se musí shodovat s titulkou
 *    originálu, uvnitř okna se nekontroluje (je to remake)
 * 3. **herní obrazovka** — všech 6912 bajtů proti `build/ref/game.scr`:
 *    obraz originálu, když stojí první místnost (návrat do `$E269`,
 *    `tools/tracerooms.py`). ★ Od M2 ji remake **skládá z dat programu**:
 *    start mise jako `$D9E9` (panel, životy, plameny loga) a první místnost
 *    převodem `$C991` (`app/roomRenderer.js`, `data/maze.json`,
 *    `data/global.json`) — nula tedy říká, že remake nakreslí obrazovku
 *    originálu sám, ne že ji umí zkopírovat. Od M3 ji kreslí worker
 *    (`app/gameWorker.js` → `ThunderbirdsLogic.begin()`) a pošle ji v prvním
 *    snímku; tady se bere právě ten
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const REF_TITLE = path.join(ROOT, 'build/ref/title.scr');
const REF_GAME = path.join(ROOT, 'build/ref/game.scr');

function workerFrame(load) {
  let frame = null;
  const sandbox = {
    console, setTimeout: () => 0, clearTimeout: () => {},
    atob: (data) => Buffer.from(data, 'base64').toString('binary'),
    postMessage: (message) => { if (!frame) { frame = message; } },
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (...files) => {
    for (const file of files) {
      const name = file.split('?')[0];
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', name), 'utf8'), context, {filename: name});
    }
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8'),
                  context, {filename: 'gameWorker.js'});
  // no seed: the original's own first mission (data/global.json)
  sandbox.onmessage({data: {id: 'init', initData: {headless: true, maze: load('maze'), global: load('global')}}});
  return frame;
}

function offsetOf(y, col) {
  const third = y >> 6, charRow = (y >> 3) & 7, pix = y & 7;
  return (third << 11) | (pix << 8) | (charRow << 5) | col;
}

/**
 * Porovná buňky dvou obrazů; `skip(row, col)` vynechá buňku.
 */
function compare(bytes, reference, skip) {
  const out = {bitmap: 0, attrs: 0, bitmapChecks: 0, attrChecks: 0, perRow: []};
  for (let row = 0; row < 24; row++) {
    let rowDiffs = 0;
    for (let col = 0; col < 32; col++) {
      if (skip && skip(row, col)) { continue; }
      for (let line = 0; line < 8; line++) {
        const at = offsetOf(row*8 + line, col);
        out.bitmapChecks++;
        if (bytes[at] !== reference[at]) { out.bitmap++; rowDiffs++; }
      }
      const at = 6144 + row*32 + col;
      out.attrChecks++;
      if (bytes[at] !== reference[at]) { out.attrs++; rowDiffs++; }
    }
    out.perRow.push(rowDiffs);
  }
  return out;
}

function report(name, result, verbose) {
  if (verbose) {
    result.perRow.forEach((diffs, row) => {
      console.log(`  řádek ${String(row).padStart(2)}: ${diffs} rozdílů`);
    });
  }
  const checks = result.bitmapChecks + result.attrChecks;
  const diffs = result.bitmap + result.attrs;
  console.log(`${name.padEnd(22)} bitmapa ${String(result.bitmapChecks).padStart(4)} / ${result.bitmap}, `
              + `atributy ${String(result.attrChecks).padStart(3)} / ${result.attrs}  → ${checks} kontrol, ${diffs} rozdílů`);
  return {checks, diffs};
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  for (const ref of [REF_TITLE, REF_GAME]) {
    if (!fs.existsSync(ref)) {
      console.error(`chybí ${ref} – spusť ./tools/mksnapshot.sh, ./tools/mkscreen.py a ./tools/tracerooms.py`);
      process.exit(2);
    }
  }
  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { ScreenComposer } = await import(
    url.pathToFileURL(path.join(ROOT, 'app/screenComposer.js')).href);
  const { ScreenLayout } = await import(
    url.pathToFileURL(path.join(ROOT, 'app/screenLayout.js')).href);
  const { ZXVideoRAM } = await import(
    url.pathToFileURL(path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxVideoRAM.js')).href);

  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/screen.json'), 'utf8'));
  const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
  const render = new ScreenComposer(scene);
  const refTitle = fs.readFileSync(REF_TITLE), refGame = fs.readFileSync(REF_GAME);

  const title = new ZXVideoRAM();
  render.composeTitle(title);
  const menu = new ZXVideoRAM();
  render.composeMenu(menu);
  const w = ScreenLayout.MENU_WINDOW;
  const inWindow = (row, col) => row >= w.row && row < w.row+w.rows && col >= w.col && col < w.col+w.cols;
  const game = new ZXVideoRAM();
  render.composeInto(game, workerFrame(load));

  const a = report('titulka', compare(title.bytes, refTitle), verbose);
  const b = report('titulka pod oknem menu', compare(menu.bytes, refTitle, inWindow), verbose);
  const c = report('herní obrazovka', compare(game.bytes, refGame), verbose);
  const checks = a.checks + b.checks + c.checks, diffs = a.diffs + b.diffs + c.diffs;
  console.log(`celkem ${checks} kontrol, **${diffs} rozdílů**`);
  process.exit(diffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
