#!/usr/bin/env node
/**
 * Projde celou smyčku workeru bez prohlížeče.
 *
 *   ./tools/runworker.mjs [--frames N] [--verbose]
 *
 * `app/gameWorker.js` se spustí v atrapě prostředí workeru (postMessage,
 * setTimeout, Date, `importScripts` čte soubory z `app/`) se skutečnými daty
 * (`data/maze.json`, `data/global.json`) a projde se celý protokol
 * z `app/WORKER-PROTOCOL.md`: `init`, `controls`, `tick`, `pause`,
 * `continue` a `reset`.
 *
 * Kontroluje se:
 *
 * - worker odpoví na `init` snímkem s obrazovkou (6912 bajtů) — ★ **tou,
 *   kterou má originál na prvním `$E299` hry** (`build/ref/physics/start.bin`,
 *   když je) — a s panelem: ★ **tři postavičky** (`$5CF4` − 1) a ★ **4000
 *   bodů**; bez dat odpoví zprávou `error`
 * - tik je jedno přerušení: počítadlo snímků o jeden; ★ **průchody hlavní
 *   smyčky** běží podle své ceny (zpoždění průchodu + práce), zhruba jeden na
 *   snímek
 * - ovládání: stav dorazí celý, všech pět kláves originálu (★ LEFT, RIGHT,
 *   UP, DOWN, FIRE), neznámá se zahodí; ★ držená klávesa hýbe plavidlem
 *   (obrazovka se liší od běhu bez kláves)
 * - semínko: bez semínka SEED z dat (první mise originálu); se semínkem jiná
 *   hra; dva běhy s týmž semínkem dají tentýž stav včetně obrazovky
 * - ★ **hodiny** (R-046): s podstrčeným časem worker za simulovanou vteřinu
 *   udělá 50 tiků (50,08 Hz), **nikdy nemá naplánovaný víc než jeden
 *   časovač**, `pause` je zastaví, `continue` bez `pause` nezaloží druhé,
 *   a po dlouhém výpadku (karta na pozadí) nedohání víc než čtyři tiky naráz
 * - `reset` zastaví a zahodí stav
 *
 * Že je hra průchod po průchodu originálem, dokládá `tools/matchphysics.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const TICK_MS = 1000*69888/3500000;
const DATA = {
  maze: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/maze.json'), 'utf8')),
  global: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/global.json'), 'utf8')),
};

/**
 * Worker v atrapě. Hodiny jsou podstrčené: `clock.now` je čas, který worker
 * vidí v `Date.now()`, a `advance(ms)` ho posouvá a spouští časovače, které
 * mezitím vypršely – tak, jak by to udělal prohlížeč.
 */
function startWorker(onMessage) {
  const clock = {now: 1000000, timers: [], nextId: 1, maxPending: 0};
  const sandbox = {
    console,
    atob: (data) => Buffer.from(data, 'base64').toString('binary'),
    Date: {now: () => clock.now},
    setTimeout: (fn, ms) => {
      const id = clock.nextId++;
      clock.timers.push({id, fn, at: clock.now+Math.max(0, ms)});
      clock.maxPending = Math.max(clock.maxPending, clock.timers.length);
      return id;
    },
    clearTimeout: (id) => { clock.timers = clock.timers.filter((t) => t.id !== id); },
    postMessage: onMessage,
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  // importScripts() jako ve workeru: cesty vůči app/, query se zahodí
  sandbox.importScripts = (...files) => {
    for (const file of files) {
      const name = file.split('?')[0];
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', name), 'utf8'), context, {filename: name});
    }
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8'), context,
                  {filename: 'gameWorker.js'});
  return {
    send(message) { sandbox.onmessage({data: message}); },
    advance(ms, step = 1) {
      const end = clock.now+ms;
      while (clock.now < end) {
        clock.now = Math.min(end, clock.now+step);
        const due = clock.timers.filter((t) => t.at <= clock.now);
        clock.timers = clock.timers.filter((t) => t.at > clock.now);
        due.forEach((t) => t.fn());
      }
    },
    clock,
    context,
  };
}

let checks = 0, failures = 0;
function check(condition, label) {
  checks++;
  if (!condition) {
    failures++;
    console.log('  CHYBA: '+label);
  }
}

function run(initData, frames, verbose, controls) {
  const messages = [];
  const worker = startWorker((message) => {
    messages.push(message);
    if (verbose) { console.log(JSON.stringify(message).slice(0, 200)); }
  });
  worker.send({id: 'init', initData: Object.assign({headless: true}, DATA, initData)});
  if (controls) { worker.send(Object.assign({id: 'controls'}, controls)); }
  for (let step = 0; step < frames; step++) {
    worker.send({id: 'tick'});
  }
  return {worker, messages};
}

const lastScreen = (msgs) => {
  for (let i = msgs.length-1; i >= 0; i--) { if (msgs[i].screen) { return msgs[i].screen; } }
  return null;
};
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

function main() {
  const args = process.argv.slice(2);
  const frames = args.includes('--frames')
    ? parseInt(args[args.indexOf('--frames')+1], 10) : 100;
  const verbose = args.includes('--verbose');

  // --- bez dat: chyba, ne prázdná hra
  const empty = [];
  startWorker((message) => empty.push(message)).send({id: 'init', initData: {headless: true}});
  check(empty.length === 1 && empty[0].id === 'error', 'init bez data/maze.json a global.json odpoví zprávou error');

  // --- init a snímek
  const {worker, messages} = run({}, frames, verbose);
  const first = messages[0];
  check(first && first.id === 'frame', 'init odpovědělo snímkem');
  check(first && first.frame === 0 && first.pass === 0, 'snímek po init má frame 0 a pass 0');
  check(first && first.screen && first.screen.length === 6912, 'snímek po init nese obrazovku, 6912 bajtů');
  check(first && first.panel.lives === 3, 'tři postavičky na panelu ($5CF4 − 1)');
  check(first && first.panel.score === 4000, '4000 bodů na startu bez nákladu (pravidla nákladu)');
  check(first && first.controls !== undefined, 'snímek nese stav ovládání');
  const startBin = path.join(ROOT, 'build/ref/physics/start.bin');
  if (fs.existsSync(startBin)) {
    const ref = fs.readFileSync(startBin).subarray(0x4000, 0x5B00);
    check(first && same(Array.from(first.screen), Array.from(ref)),
          'obrazovka po init = originál na prvním $E299 hry');
    const seed = fs.readFileSync(startBin)[0x5C76] | (fs.readFileSync(startBin)[0x5C77] << 8);
    check(first && first.rand === seed, `bez semínka SEED z dat, jako originál ($${seed.toString(16)})`);
  }

  // --- tik: snímek o jeden, průchody podle své ceny
  const last = messages[messages.length-1];
  check(messages.length === frames+1, `${frames} tiků = ${frames} snímků (+1 za init), je ${messages.length}`);
  check(last.frame === frames, `počítadlo snímků je ${frames} (je ${last.frame})`);
  check(last.pass > frames/3 && last.pass < frames*3, `průchody běží, zhruba jeden na snímek (${last.pass} za ${frames})`);

  // --- ovládání: pět kláves originálu, celé, neznámá se zahodí; plavidlo jede
  worker.send({id: 'controls', left: true, up: true, fire: true, jump: true});
  worker.send({id: 'tick'});
  const controls = messages[messages.length-1].controls;
  check(controls.left && controls.up && controls.fire && !controls.right && !controls.down,
        'stav ovládání dorazil celý, i FIRE');
  check(!('jump' in controls), 'neznámá klávesa (skok originál nemá) se zahodila');
  check(Object.keys(controls).sort().join() === 'down,fire,left,right,up',
        'ovládání má právě pět kláves originálu');
  const idle = run({}, 150).messages;
  const moved = run({}, 150, false, {left: true}).messages;
  check(!same(Array.from(lastScreen(idle)), Array.from(lastScreen(moved))),
        'držená LEFT hýbe plavidlem: obrazovka se liší od běhu bez kláves');

  // --- přepnutí plavidla: držený FIRE nejvýš jednou za vteřinu (ZADANI §10)
  const held = run({}, 200, false, {fire: true}).messages.filter((m) => m.id === 'frame');
  const switches = [];
  for (let i = 1; i < held.length; i++) {
    if (held[i].craft !== held[i-1].craft) { switches.push(held[i].frame); }
  }
  check(switches.length >= 2, `držený FIRE přepíná (${switches.length}× za 200 snímků)`);
  check(switches.every((f, i) => i === 0 || f-switches[i-1] >= 50),
        `mezi přepnutími aspoň 50 snímků (${switches.join(', ')})`);

  // --- semínko
  const a = run({seed: 0xABCD}, 60).messages;
  const b = run({seed: 0xABCD}, 60).messages;
  const state = (msgs) => JSON.stringify(Object.assign({}, msgs[msgs.length-1], {screen: Array.from(lastScreen(msgs))}));
  check(state(a) === state(b), 'tentýž seed dá tentýž stav i obrazovku');
  check(!same(Array.from(a[0].screen), Array.from(first.screen)), 'jiné semínko, jiná první místnost (zdi z generátoru)');

  // --- reset v headless režimu zastaví tikání
  const before = messages.length;
  worker.send({id: 'reset'});
  worker.send({id: 'tick'});
  check(messages.length === before, 'reset zastaví headless tikání');

  // --- hodiny (R-046)
  const live = [];
  const clocked = startWorker((message) => live.push(message));
  clocked.send({id: 'init', initData: Object.assign({headless: false}, DATA)});
  clocked.advance(1000);
  const ticks = live.length-1;
  check(ticks === 50, `za vteřinu 50 tiků při 50,08 Hz (je ${ticks})`);
  clocked.advance(10000);
  const tenSeconds = live.length-1-ticks;
  check(Math.abs(tenSeconds-Math.round(10000/TICK_MS)) <= 1,
        `za deset vteřin ${Math.round(10000/TICK_MS)} tiků (je ${tenSeconds})`);
  check(clocked.clock.maxPending === 1, `nikdy víc než jeden naplánovaný časovač (bylo ${clocked.clock.maxPending})`);

  clocked.send({id: 'pause'});
  const paused = live.length;
  clocked.advance(1000);
  check(live.length === paused, 'pause zastaví hodiny');
  check(clocked.clock.timers.length === 0, 'po pause nezůstal naplánovaný časovač');

  clocked.send({id: 'continue'});
  clocked.send({id: 'continue'});
  check(clocked.clock.timers.length === 1, 'continue dvakrát nezaloží dvoje hodiny');
  const resumed = live.length;
  clocked.advance(1000);
  check(Math.abs(live.length-resumed-50) <= 1, `po continue zase 50 tiků za vteřinu (je ${live.length-resumed})`);

  // karta v pozadí: prohlížeč časovač zdrží o deset vteřin
  const stalled = live.length;
  const timer = clocked.clock.timers[0];
  timer.at = clocked.clock.now+10000;
  clocked.advance(10000+TICK_MS, 1);
  check(live.length-stalled <= 5, `po výpadku nejvýš čtyři tiky naráz, ne stovky (je ${live.length-stalled})`);

  clocked.send({id: 'reset'});
  check(clocked.clock.timers.length === 0, 'reset zastaví hodiny');
  const afterReset = live.length;
  clocked.advance(1000);
  check(live.length === afterReset, 'po reset už nic netiká');

  console.log(`${checks} kontrol, **${failures} chyb**`);
  process.exit(failures ? 1 : 0);
}

main();
