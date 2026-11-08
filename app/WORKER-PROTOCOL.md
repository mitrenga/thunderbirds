# Protokol mezi `gameModel.js` a `gameWorker.js`

Worker drží hru a tiká. Model do něj posílá jen vstupy a kreslí to, co
dostane zpátky (R-037: kreslí se na zprávu `frame`, smyčka modelu je
záloha).

## ★ Hra je paměť originálu

Worker načte (`importScripts`) svision `zxRomDraw.js`, `roomRenderer.js`
a `thunderbirdsLogic.js` a drží **64 K paměti stroje** — obrazovku na
`$4000`, proměnné, stínovou mapu, plavidla, bloky, nepřátele, i proměnné
uvnitř kódu — složenou z dat programu (`data/maze.json`, `data/global.json`,
posílá je model v `init`). Průchod hlavní smyčky a obsluha přerušení jsou
převod originálu rutina po rutině (`../sources/docs/physics.md`);
`../tools/matchphysics.mjs` ho porovnává se záznamy originálu po každém
průchodu, nula rozdílů.

## ★ Dvoje hodiny – a nejsou totéž

`../sources/docs/physics.md`, `../sources/docs/disasm_notes.md` §2, §4:

| hodiny | frekvence | co řídí v originálu |
|---|---|---|
| **přerušení ULA** | 50,08 Hz (69 888 T) | obsluha IM 2 `$A398`: plameny loga, vteřiny (`$5CFC`), zvuky (šum posouvá SEED). Běží s `DI` a **občas přesáhne snímek**, takže se přerušení ztratí |
| **průchod hlavní smyčky** `$E299` | **nečeká na snímek**: práce + zpoždění; 0,4–7 snímků | všechno ostatní – pohyb, bloky, nepřátelé, čas, palivo |

Worker tiká **rekurzivním `setTimeout` s akumulátorem** na frekvenci
přerušení (R-046, `setInterval` nikde). Na každém tiku spustí obsluhu
přerušení (`logic.interrupt()`) a pak tolik průchodů, kolik jich za uplynulý
čas vyjde: průchod stojí **zpoždění, která spálil** (`logic.waited`, přesně
jako originál) **plus práci** `WORK_T`; snímek dává `FRAME_T − ISR_T`
(průměrná délka obsluhy). Konstanty měří `../tools/measurecadence.mjs`.
? Obsluha padá mezi průchody, ne do nich, a žádné přerušení se neztratí
(`../ZADANI.md` §10).

## Model → worker

| zpráva | pole | význam |
|---|---|---|
| `init` | `initData: {headless, maze, global, seed, hiScore}` | start nové hry. `maze`, `global` = obsah `data/maze.json`, `data/global.json` (bez nich odpoví `error`). `seed` viz níž. `headless: true` tiká jen na vyžádání zprávou `tick` (pro `tools/runworker.mjs`). |
| `controls` | `left`, `right`, `up`, `down`, `fire` (boolean) | úplný stav ovládání; posílá se při každé změně a **celý**. |
| `pause` | – | zastaví hodiny. |
| `continue` | – | rozjede je; bez předchozí `pause` neudělá nic (dvoje hodiny naráz by tikaly dvakrát rychleji). |
| `tick` | – | jeden tik v režimu `headless`. |
| `reset` | – | zahodí stav a zastaví hodiny. |

★ **Ovládání originálu má pět kláves** (jeho okno YOUR KEYS): `LEFT`,
`RIGHT`, `UP`, `DOWN`, `FIRE`, výchozí `5`, `8`, `7`, `6`, `A`. Worker
z držených ovládacích prvků udělá to, co by vrátil ROM `KEY-SCAN`: kód
klávesy z `$5D0B`–`$5D0F` (DE = `$FF`kód), originál čte **jednu** klávesu —
z několika držených vyhrává FIRE, pak UP, DOWN, LEFT, RIGHT. ? Po každém
přepnutí plavidla worker FIRE **vteřinu (50 snímků) nebere**, aby držený
FIRE po přepnutí nepřepínal hned zpátky (`FIRE_LOCK_FRAMES`, odchylka
`../ZADANI.md` §10). `M` (hudba),
`K`/`J` (zpoždění), `P` (pauza), `S`/`L` (uložení hry) do workeru nechodí.

### ★ Náhoda

`Math.random()` v herní logice **nikdy** (`../../METHODOLOGY.md`). Generátor
je originálu, nad pamětí hry:

```
rand       ($F8BC, roomRenderer.js):   B ← B + C;  C ← C + $CD (přenos → CY);  B ← B + $AB + CY;  vrací B
noiseStep  ($A50F, thunderbirdsLogic): SEED_lo ← 5 × SEED_lo + 1;  vrací SEED_lo
```

`C` je bajt na `$5C76`, `B` na `$5C77` – systémová proměnná ROM `SEED`.
Generátor je týž jako v Booty (`$E349`). Kreslí z něj zdi každé místnosti,
rozhazuje věci a nepřátele, točí nepřátele a drolí zasažená plavidla; šum
(posun bloku, dopad, havárie) posouvá dolní bajt. **`seed` je stav SEED,
když se kreslí první místnost**: bez něj (null) ten z dat — první mise
originálu —, jinak co nechala minulá hra (`gameApp.gameSeed`). Kontrola:
`tools/matchrand.mjs` – **393 216 kontrol, 0 rozdílů** proti Z80 kódu
z kazety, a `tools/matchphysics.mjs` po každém průchodu.

## Worker → model

| zpráva | pole | význam |
|---|---|---|
| `frame` | `frame`, `pass`, `outcome`, `rand`, `room`, `panel`, `controls`, `sounds[]`, `screen` | jeden tik. Posílá se po každém tiku a jako odpověď na `init`. |
| `gameOver` | `score` | konec hry. |
| `error` | `message` | chybějící data, nebo část originálu, která ještě není převedená (hra tím končí). |

- `frame` — přerušení od startu; `pass` — průchody hlavní smyčky; `outcome`
  — jak skončil poslední průchod (`pass`, `restart` po ztrátě života, …)
- `screen` — **6912 bajtů videopaměti hry** (`Uint8Array`), tak jak ji
  originál nechá; model ji jen zobrazí (`screenComposer.composeInto`)
- `panel` — `{score, hiScore, lives}` z paměti (`$5CFF` pět číslic, `$5D05`,
  `$5CF4` − 1 postaviček); panel sám je v `screen`
- `rand` — SEED kvůli otisku pro regres a pro další hru
- `sounds` — jména zvuků, které obsluha přerušení a průchody spustily
  (`fuel`, `pickup`, `land`, `push`, `crash`, `sweep`, `tone`, `note`) — M6

★ **Hra končí** (`gameOver`) tam, kde originál opouští hlavní smyčku:
GAME OVER (`$E66A`), mise dokončená (`$E590`), základna — místnost 0, start
mise (`$D67E`) — a došlé palivo (`$E70A`). ? Co originál dělá dál (texty
z ROM, drolení, start mise), je M4.

## Stav

**M3: worker hraje originál** — pohyb obou Thunderbirdů, bloky, nepřátelé,
čas, palivo, životy. Pravidla a konec mise M4, zvuk M6. Hlídá to
`tools/runworker.mjs`, věrnost `tools/matchphysics.mjs`.
