# tools/

Nástroje remaku. Platí pro ně `../../STANDARDS.md` a metodika
`dump*` → `trace*` → `match*` z `../../METHODOLOGY.md`:

- **`dump*` / `mk*`** vytáhnou z originálu data a uloží je do `../data/`
- **`trace*`** nahrají z běžícího originálu záznam, proti kterému se měří
- **`match*`** porovnají remake s originálem a **vypíšou počet kontrol
  a počet rozdílů**. Milník je hotový, když je rozdílů nula.

Python nástroje potřebují **SkoolKit** vendorovaný ve svision (R-008), přes
symlink `app/svision` (`tblib.SKOOLKIT`). Node nástroje (`*.mjs`, od M1)
pracují se **skutečným kódem z `../app/`** — moduly přes
`app/svision/tools/nodeEnv.mjs`, klasické skripty workeru (`roomRenderer.js`,
`thunderbirdsLogic.js`, svision `zxRomDraw.js`) přes
`app/svision/tools/classicScript.cjs`.

## Kazeta a obraz paměti

| nástroj | co dělá |
|---|---|
| `tblib.py` | **jediné místo, kde je napsané, co je na kazetě** a jak se z ní skládá obraz paměti: TZX (`$10`, `$11`, `$32`), `basic_screen()` (obrazovka po BASICu bez ROM), `turbo_stream()` (bity zrcadlově), `memory_image()` (kód zavaděče na CPU SkoolKitu, čtení pásky v Pythonu), `loading_screen()`, `code_image()`, `disassemble()` |
| `tapinfo.py` | rozbor kazety; `--basic` BASIC se skutečnými binárními čísly, `--records` záznamy turbo bloku, `--loader` disassembly všech vrstev zavaděče po dešifrování. Výstup je v `../sources/docs/tape_layout.md` |
| `mksnapshot.sh` | kazeta → `build/thunderbirds.z80` + `.bin` (tap2sna pulz po pulzu až na vstup `$E105`) a `build/atvars.z80` + `.bin` (zastaveno na `USR` do VARS) |
| `matchimage.py` | ★ **56 311 kontrol, 0 rozdílů** — obrazovka po BASICu, RAM na vstupu do hry a registry z `tblib.py` proti simulátoru |

## Obrazovka a LOAD TAPE

| nástroj | co dělá |
|---|---|
| `mkscreen.py` | → `data/screen.json` (titulka z programu, herní obrazovka z běhu), `data/loading.json` a reference `build/ref/title.scr` (simulátor za `CALL $C1EF`), `build/ref/game.scr` |
| `matchscreen.mjs` | ★ **16 632 kontrol, 0 rozdílů** — titulka, titulka pod oknem menu a herní obrazovka složené `app/screenComposer.js` proti videopaměti originálu |
| `matchloading.py` | ★ **126 208 kontrol, 0 rozdílů** — loading screen z kazety proti `.scr`, simulátoru (bajty, body v obou fázích FLASH), `data/loading.json`; obrazovka po BASICu z `loading.json` proti `tblib.basic_screen()` |
| `mktape.py` | kazeta → `data/tape.json` (tři bloky, časování, bajty jak jdou po pásce, turbo blok zkrácený na první díl) |
| `traceloading.py` | (z Booty) simulované nahrání snímek po snímku: co je vidět, ROM fontem, i neviditelné texty. Odtud `Program: T'BIRDS`, `*LOADING*`, obrázek s atributy ≈ 48 s |
| `matchtape.mjs` | ★ **14 457 kontrol, 0 rozdílů** — bloky `tape.json` proti kazetě a obrázek z událostí `tapeByte` přes `TapeLoadingModel.mirror` proti `loading.json` |
| `playtrace.py` | (z Booty) spustí hru ze snapshotu, skriptované klávesy `od:do:klávesa`, snímky `.png` + `.scr`, mapa pokrytí `--map`, RAM `--dump`. Nese R ze snapshotu (ochrana, `disasm_notes.md` §2) |

## Worker a náhoda

| nástroj | co dělá |
|---|---|
| `runworker.mjs` | ★ **31 kontrol, 0 chyb** — celý protokol `app/gameWorker.js` bez prohlížeče (`importScripts` z `app/`, data z `data/`): obrazovka po `init` = originál, průchody, ovládání hýbe plavidlem, semínko, hodiny s podstrčeným časem (R-046) |
| `tracerand.py` | `$F451`/`$F8BC` a `$A50F` v simulátoru Z80 na kódu z kazety; `--sweep` pro všech 256 dolních bajtů |
| `matchrand.mjs` | ★ **393 216 kontrol, 0 rozdílů** — `rand` hry (`app/roomRenderer.js`) celá perioda a `noiseStep` (`app/thunderbirdsLogic.js`) 256 × 256 proti Z80 |

## Bludiště (M2)

| nástroj | co dělá |
|---|---|
| `tracerooms.py` | běh originálu k **prvnímu vstupu do místnosti** (`$C991`, místnost 49): `build/ref/rooms/base.bin`; z něj `$C991` pro každou z 97 místností (obrazovka, stínová mapa, RAM, SEED); obraz po návratu do `$E269` (`build/ref/game.scr`) a kroky plamenů loga |
| `dumpmaze.py` | → `data/maze.json` (úseky paměti programu, které čte znakový engine) a `data/global.json` (stav mise) |
| `matchmaze.mjs` | ★ **89 místností, 1 076 811 kontrol, 0 rozdílů** — `app/roomRenderer.js` proti `$C991`: obrazovka, stín, SEED, proměnné, popisy; `--room N`, `--verbose` |

## Pohyb, přerušení, kadence (M3)

| nástroj | co dělá |
|---|---|
| `tracephysics.py` | originál instrukci po instrukci (CSimulator) s přerušeními 48K od prvního `$E299` hry (`build/ref/physics/start.bin`): **průchod po průchodu** klávesy (`KEY-SCAN`), po kolika sdílených přístupech přišlo které přerušení a jak dlouho jeho obsluha běžela, T-stavy, změny paměti, pokrytí. Scénáře: `idle`, `walk*` (náhodné klávesy), `explore*` (průzkumník), `long*` (do došlého paliva), `roomNN` (obě plavidla do místnosti přes `$E24F`), `lampNN` (tmavé místnosti s lampou); `--scenario`, `--passes`. ≈ 15 min všechny |
| `matchphysics.mjs` | ★ **111 scénářů, 162 051 průchodů, 2 019 167 917 kontrol, 0 rozdílů** — `app/thunderbirdsLogic.js` začne z dat a přehraje záznamy; po každém průchodu obrazovka a celý stav z `data/global.json`; `--scenario`, `--verbose` |
| `physicscoverage.py` | které instrukce hlavní smyčky a vstupu do místnosti záznamy proběhly (70 % / 68 %) a které souvislé úseky ne |
| `measurecadence.mjs` | práce průchodu (`WORK_T`), model délky obsluhy přerušení (`ISR_*`), a hodiny workeru nasimulované na záznamech proti originálu (−5,0 % snímků, −3,8 % přerušení) |

## Měření a disassembly

| nástroj | co dělá |
|---|---|
| `tracecadence.py` | kde přerušení zastihne program (PC na každém snímku, histogram); `--passes N` délka průchodu hlavní smyčkou `$E299` v T-stavech. Výchozí skript `GAME` vede titulkou až do bludiště. Výsledek v `../sources/docs/disasm_notes.md` §4 |
| `mkasm.py` | `tblib.code_image()` → `../sources/asm/thunderbirds.skool` podle ručně udržovaného `.ctl`; první `.ctl` z mapy pokrytí (`--ctl-from-map`) |

## Co přibude

| milník | nástroje |
|---|---|
| M4–M6 | `matchrules.mjs`, `matchentities.mjs`, `tracesound.py`, `matchsound.mjs` |

? `playtrace.py` a čtení TZX jsou téměř shodné s Booty — kandidát do
`svision/tools/retro/` (R-008), až je bude chtít třetí projekt.
