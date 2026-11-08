# data/

Datové soubory, které jdou do prohlížeče. **Každý z nich vyrábí nástroj
z `../tools/` z originálu** — žádný se needituje ručně a žádný neobsahuje
číslo, které by někdo odhadl.

| soubor | co v něm je | dělá ho | doloženo |
|---|---|---|---|
| `screen.json` | `title`: ★ první snímek titulky **složený z programu** (obrázek `$A673`, 130 čísel generátoru `$F8BC` od `SEED $0000`, prázdný pás běžícího textu) | `tools/mkscreen.py` | `tools/matchscreen.mjs` — **16 632 kontrol, 0 rozdílů** |
| `maze.json` | ★ **pojmenované úseky paměti programu**, které čte znakový engine: půdorysy, předměty, tvary bloků, polohy nepřátel, sady znaků `$89BB` a `$79C9`, zvláštní místnosti (proudy, záložní znaky, sada `$93DC`, seznamy, barvy), panel | `tools/dumpmaze.py` | `tools/matchmaze.mjs` — **89 místností, 1 076 811 / 0** |
| `global.json` | ★ **stav mise** na prvním vstupu do místnosti (`$C991`, místnost 49): proměnné `$5C00`–`$6B54`, popisy 97 místností, tabulka řádků `$FF02`; `entry` (první místnost, kroky plamenů loga) | `tools/tracerooms.py` + `tools/dumpmaze.py` | `tools/matchmaze.mjs`, `tools/matchscreen.mjs` |
| `loading.json` | loading screen z kazety (prvních 6912 B turbo bloku, bity zrcadlově) a `basic`: co na obrazovce nechá BASIC (`*LOADING*`, atributy, `POKE 20107,255`) | `tools/mkscreen.py` | `tools/matchloading.py` — **126 208 / 0** |
| `tape.json` | scénář pro LOAD TAPE: tři bloky kazety v jejím pořadí, časování (turbo: pilot 8179 × 2165 T, sync 714/714, bity 673/1346), bajty **jak jdou po pásce**; turbo blok jen první díl (7170 B: obrázek a buffer tiskárny), `pictureBytes`, `mirrored` | `tools/mktape.py` | `tools/matchtape.mjs` — **14 457 / 0** |

## ★ Nic tu není fotka

Titulku skládá algoritmus `$C1EF` z obrázku a generátoru, herní obrazovku
převod `$D9E9` a `$C991` (`app/roomRenderer.js`) z `maze.json`
a `global.json`. Data jsou úseky paměti originálu (adresa + bajty), protože
převod drží stav na týchž adresách (`sources/docs/maze.md`).

? `global.json` je stav ze simulátoru; až M4 přečte start mise, spočítá ho
z kódu.

## Co tu zatím není

`texts.json` (úvodní obrazovky, M4), `sounds.json` (M6). Server je posílá
jako `null` a aplikace to musí přežít (`../db/appData.php`).
