#!/usr/bin/env node
/**
 * LOAD TAPE: co remake zahraje a zapíše, proti kazetě.
 *
 *   ./tools/matchtape.mjs
 *
 * - `data/tape.json` nese bloky tak, jak jdou po pásce (`tools/mktape.py`);
 *   kontroluje se, že jsou **bajt po bajtu** z kazety: hlavička a BASIC
 *   celé, turbo blok jeho prvních `length` bajtů (`tblib.turbo_block()['raw']`
 *   vypíše `tools/tblib.py` přes `python3`)
 * - obrázek, který `app/tapeLoadingModel.js` během nahrávání zapíše do
 *   videopaměti — každý bajt z události `tapeByte` prohnaný jeho
 *   `TapeLoadingModel.mirror` (★ `RR L` upravené LD-BYTES) — je **přesně
 *   loading screen** z `data/loading.json`: 6912 kontrol
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

async function main() {
  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { TapeLoadingModel } = await import(
    url.pathToFileURL(path.join(ROOT, 'app/tapeLoadingModel.js')).href);
  const tape = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tape.json'), 'utf8'));
  const loading = Buffer.from(JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data/loading.json'), 'utf8')).videoRAM, 'base64');
  const raw = JSON.parse(execFileSync('python3', ['-c',
    'import sys, json; sys.path.insert(0, "' + HERE + '"); import tblib as L; '
    + 'print(json.dumps([bytes(b["raw"]).hex() for b in L.tzx_blocks()]))'], {maxBuffer: 1 << 26}));

  let checks = 0, diffs = 0;
  tape.blocks.forEach((block, i) => {
    const mine = Buffer.from(block.bytes, 'hex');
    const real = Buffer.from(raw[i], 'hex').subarray(0, mine.length);
    let d = 0;
    for (let k = 0; k < mine.length; k++) { checks++; if (mine[k] !== real[k]) { d++; } }
    diffs += d;
    console.log(`blok ${block.block} ${block.kind.padEnd(5)} ${String(mine.length).padStart(5)} B `
                + `z ${block.length} proti kazetě: ${d} rozdílů`);
  });

  const turbo = tape.blocks.find((b) => b.pictureBytes);
  const bytes = Buffer.from(turbo.bytes, 'hex');
  const [from, to] = turbo.pictureBytes;
  let d = 0;
  for (let at = 0; at <= to-from; at++) {
    checks++;
    if (TapeLoadingModel.mirror(bytes[from+at]) !== loading[at]) { d++; }
  }
  diffs += d;
  console.log(`obrázek z událostí tapeByte přes mirror : data/loading.json  ${to-from+1} kontrol, ${d} rozdílů`);
  console.log(`celkem ${checks} kontrol, **${diffs} rozdílů**`);
  process.exit(diffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
