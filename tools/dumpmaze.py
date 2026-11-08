#!/usr/bin/env python3
"""Tabulky bludiště z programu a stav mise: `data/maze.json`, `data/global.json`.

    ./tools/dumpmaze.py

★ Popsané v `sources/docs/maze.md`. Engine originálu je znakový: místnost se
tiskne vlastními rutinami do videopaměti a souběžně do stínové mapy, sprity
si skládá posunuté do sad znaků v RAM. `app/roomRenderer.js` ho převádí
rutinu po rutině nad **týmiž adresami**, takže se data neukládají
přeformátovaná, ale jako **pojmenované úseky paměti originálu** (adresa,
bajty) — přesně ty, které kreslení čte.

`maze.json` — konstanty programu (`tblib.code_image()`):

| úsek | adresy | co to je |
|---|---|---|
| `layouts` | `$6FD8`–`$78E7` | 29 půdorysů po 80 B: 20 řádků × 4 B, bit 7 vlevo, 1 = zeď |
| `objects` | `$8F83`–`$9133` | předměty k půdorysům 1–29: seznamy záznamů C, B, výška a šířka (nibble), první znak; konec `$FF` |
| `special` | `$9134`–`$9E63` | zvláštní místnosti: tři záložní sady znaků pro `$D201`, sada `CHARS = $93DC`, proudy pro `$CF9E` |
| `specialLists` | `$DEC3`–`$DF8A` | předměty a pavouci zvláštních místností (`$D3C3`, záznamy po 18 B) |
| `specialColours30/31/33` | `$D258`, `$D46C`, `$D582` | barvy zvláštních místností podle `+9` popisu |
| `shapes` | `$8490`–`$85EF` | tvary bloků 8 × 8 bitů, typ × 8 |
| `enemyStarts` | `$DEB9`–`$DEC2` | výchozí polohy nepřátel (C, B) |
| `glyphs1` | `$8ABB`–`$8F82` | sada znaků `CHARS = $89BB`, znaky 32–184 |
| `glyphs2` | `$79D1`–`$7F99` | sada znaků `CHARS = $79C9`, znaky 1–185 (`E`, `F`, dvojtečka panelu 1–3, číslice od 10) |
| `panel` | `$F82B`–`$F861` | panel: barvy ukazatele paliva a proud popisků (`$F634`) |

`global.json` — stav mise na **prvním vstupu do místnosti** (`$C991`,
`A = 49`, `tools/tracerooms.py`), `entry` (první místnost, kroky plamenů
loga do návratu `$E269`) a úseky paměti: proměnné `$5C00`–`$6B54` (systémové proměnné ROM
i hry, plavidla `$5CCC`/`$5CDC`, seznamy bloků místností `$667B`, okno
ořezu `$6536`), popisy místností `$7F9A`–`$8486`, které hra během mise
mění, a tabulka řádků `$FF02`–`$FFFF` (staví ji `$F862` při startu). ? Až M4 přečte inicializaci mise (`TAKE OFF`), nahradí ho stav
spočítaný z kódu.
"""
import base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tblib as L                                                # noqa: E402

CONST = [
    ('layouts', 0x6FD8, 0x78E8, '29 půdorysů po 80 B (20 × 4 B, bit 7 vlevo, 1 = zeď), $C9E8'),
    ('objects', 0x8F83, 0x9134, 'předměty k půdorysům 1–29: C, B, výška|šířka<<4, znak; $FF; $CA9A'),
    ('special', 0x9134, 0x9E64, 'zvláštní místnosti: záložní znaky pro $D201 ($9134, $9254, '
                                '$935C po 288 B), sada CHARS = $93DC, proudy $CF9E $9A5C–$9E63'),
    ('specialLists', 0xDEC3, 0xDF8B, 'předměty a pavouci zvláštních místností, záznamy po 18 B ($D3C3)'),
    ('specialColours30', 0xD258, 0xD264, 'barvy místnosti 30 podle +9 ($D264)'),
    ('specialColours31', 0xD46C, 0xD476, 'barvy místnosti 31 podle +9 ($D476)'),
    ('specialColours33', 0xD582, 0xD58E, 'barvy místnosti 33 podle +9 ($D58E)'),
    ('shapes', 0x8490, 0x85F0, 'tvary bloků 8 × 8 bitů, $8490 + 8 × typ; $CD7B'),
    ('enemyStarts', 0xDEB9, 0xDEC3, 'výchozí polohy nepřátel (C, B); $CD23'),
    ('glyphs1', 0x8ABB, 0x8F83, 'sada znaků CHARS = $89BB, znaky 32–184'),
    ('glyphs2', 0x79D1, 0x7F9A, 'sada znaků CHARS = $79C9, znaky 1–185 (E, F, dvojtečka 1–3, číslice od 10)'),
    ('panel', 0xF82B, 0xF862, 'panel: atributy ukazatele paliva (14 B, $F68A) a proud popisků ($F839, $F811)'),
    ('tune', 0x6B55, 0x6FD8, 'melodie hry: noty od $654A/$654C, druhý hlas o $241 dál ($A558)'),
    ('blocksStart', 0x85F1, 0x8ABC, 'seznamy bloků všech místností při startu mise ($E1E6: → $667B)'),
    ('cheatKeys', 0xF3D2, 0xF3D7, 'klávesy, se kterými jde zapnout podvod ($E5FD)'),
]
STATE = [
    ('vars', 0x5C00, 0x6B55, 'proměnné $5C00–$6B54 v bludišti (snímek 2990)'),
    ('rooms', 0x7F9A, 0x8487, '97 popisů místností po 13 B, $7F9A + 13 × (n − 1)'),
    ('lines', 0xFF02, 0x10000, 'tabulka řádků pro $F898 (od $FF04, staví ji $F862 '
                               'přes ROM CL-SET) a co za ní leží – $F898 čte $FF02 + 2B'),
    # ★ proměnné uvnitř kódu a samomodifikovaný kód (sources/docs/physics.md)
    ('printer', 0x5BFF, 0x5C00, '$5BFF: maska rychlosti pavouků ($FCC1), zvláštní místnosti ji píší'),
    ('sweep', 0xA3F7, 0xA3F9, 'stav zvuku $A3E6 (krok, délka)'),
    ('tuneCount', 0xA4E5, 0xA4E6, 'každé 4. přerušení nota ($A4E6)'),
    ('tuneLoops', 0xA527, 0xA528, 'kolikrát melodie začala znovu ($A54C)'),
    ('tuneNote', 0xA61D, 0xA61F, 'poslední nota obou hlasů ($A558)'),
    ('stack', 0xDFF0, 0xDFF2, 'SP při vstupu do místnosti ($C986)'),
    ('paper', 0xDFFB, 0xDFFC, 'papír zvláštní místnosti'),
    ('shove', 0xE773, 0xE779, 'posun bloku po pixelech: C, B, šířka, výška, směr, průchody ($EEFB)'),
    ('delay', 0xF396, 0xF398, 'zpoždění průchodu ($E299), K a J ho mění'),
    ('mask', 0xF3D8, 0xF424, 'maska hrany bloku ($EB5B, $EB74, $EB90, $EBC4)'),
    ('spriteShift', 0xFAF7, 0xFAF8, 'samomodifikovaný kód $FAA1: posun'),
    ('spriteOr', 0xFB04, 0xFB05, 'samomodifikovaný kód $FAA1: NOP / OR (HL)'),
    ('spriteStride', 0xFB11, 0xFB12, 'samomodifikovaný kód $FAA1: krok'),
    ('spriteWidth', 0xFB75, 0xFB76, 'samomodifikovaný kód $FB6D: šířka'),
    ('hitX', 0xFBFF, 0xFC00, 'samomodifikovaný kód $FBC9: mez x pro TB1'),
    ('hitY', 0xFC0C, 0xFC0D, 'samomodifikovaný kód $FBC9: mez y pro TB1'),
    ('hitX2', 0xFC24, 0xFC25, 'samomodifikovaný kód $FBC9: mez x pro TB2'),
    ('hitY2', 0xFC31, 0xFC32, 'samomodifikovaný kód $FBC9: mez y pro TB2'),
    ('specialCount', 0xFDBF, 0xFDC1, 'čítače pohybu věcí zvláštních místností ($FCB1)'),
    ('lightOp', 0xFE61, 0xFE62, 'samomodifikovaný kód $FE07: NOP / OR (HL) / XOR (HL)'),
]
# ★ stav, který na začátku hry (první $E299) nechalo přerušení za startu TB2
ISR = [0x6558, 0x5CFB, 0x5CFC, 0xA3F7, 0xA3F8, 0xA4E5, 0xA527, 0x654A, 0x654B,
       0xA61D, 0xA61E, 0x6549, 0x654E, 0x6550, 0x6551, 0x6552, 0x6553]


def region(mem, name, lo, hi, note):
    return {'address': lo, 'length': hi - lo, 'note': note,
            'bytes': base64.b64encode(bytes(mem[lo:hi])).decode('ascii')}


def main():
    code = L.memory_image()[0]
    base_path = os.path.join(L.ROOT, 'build', 'ref', 'rooms', 'base.bin')
    if not os.path.isfile(base_path):
        raise SystemExit('chybí build/ref/rooms/base.bin – spusť ./tools/tracerooms.py')
    base = open(base_path, 'rb').read()
    start_path = os.path.join(L.ROOT, 'build', 'ref', 'physics', 'start.bin')
    if not os.path.isfile(start_path):
        raise SystemExit('chybí build/ref/physics/start.bin – spusť ./tools/tracephysics.py')
    start = open(start_path, 'rb').read()
    for name, lo, hi, note in CONST:
        if code[lo:hi] != base[lo:hi]:
            raise SystemExit('%s se za běhu mění – není to konstanta' % name)
    maze = {'note': 'tabulky bludiště z programu (tools/dumpmaze.py), úseky paměti '
                    'originálu; popis v sources/docs/maze.md',
            'regions': {n: region(code, n, lo, hi, note) for n, lo, hi, note in CONST}}
    info = json.load(open(os.path.join(L.ROOT, 'build', 'ref', 'rooms', 'rooms.json')))
    glob = {'note': 'stav mise na prvním vstupu do místnosti ($C991, A = 49) ze '
                    'simulátoru (tools/tracerooms.py, tools/dumpmaze.py); ? M4 ho '
                    'spočítá z kódu startu mise',
            'entry': {'room': info['firstRoom'], 'logoSteps': info['flames'],
                      'note': 'první místnost a kolikrát běžely plameny loga ($F7ED) '
                              'mezi nakreslením panelu a návratem do $E269',
                      'isr': {'addresses': ISR,
                              'bytes': base64.b64encode(bytes(start[a] for a in ISR)).decode('ascii'),
                              'note': 'stav obsluhy přerušení na prvním $E299 hry '
                                      '(build/ref/physics/start.bin, tools/tracephysics.py)'}},
            'regions': {n: region(base, n, lo, hi, note) for n, lo, hi, note in STATE}}
    for name, data in (('maze', maze), ('global', glob)):
        path = os.path.join(L.ROOT, 'data', name + '.json')
        with open(path, 'w') as f:
            json.dump(data, f, indent=1)
            f.write('\n')
        print('%s: %s' % (path, ', '.join('%s %d B' % (k, v['length'])
                                          for k, v in data['regions'].items())))


if __name__ == '__main__':
    main()
