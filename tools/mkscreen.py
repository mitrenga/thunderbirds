#!/usr/bin/env python3
"""Obrazovky originálu pro remake: `data/screen.json`, `data/loading.json`
a referenční snímky pro `tools/matchscreen.mjs`.

    ./tools/mkscreen.py

★ **Titulka se neopisuje z běhu, skládá se z programu** tak, jak ji kreslí
`$C1EF` (`sources/docs/disasm_notes.md` §3): 6912 B obrázku z `$A673`
(`tblib.code_image()`), v prvních 4096 B se každý bajt `$37` nahradí číslem
z generátoru `$F8BC` (od `SEED = $0000`, jako na vstupu do hry, 130 volání)
a pás běžícího textu (řádek 22, sloupce 1–31, osm pixelových řádků) se
vyplní tím, co tam bylo uložené — při prvním kreslení nulami, protože
`$E11F` dolní třetinu bitmapy vynuluje. Reference `build/ref/title.scr` je
obrazovka simulátoru zastaveného hned za `CALL $C1EF` (`$C18F`).

Herní obrazovka se od M2 **nebere z běhu**: skládá ji `app/roomRenderer.js`
z dat programu (`data/maze.json`, `data/global.json`, `tools/dumpmaze.py`)
a referencí je obraz originálu, když stojí první místnost
(`build/ref/game.scr`, `tools/tracerooms.py`). Fotka z M1 zmizela.

`data/loading.json` je loading screen z kazety (`tblib.loading_screen()`).
"""
import base64, contextlib, io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tblib as L                                                # noqa: E402
import playtrace as P                                            # noqa: E402

TITLE_DATA = 0xA673     # ★ obrázek titulky v programu (LDIR na $C1F6)
TITLE_RAND_BYTES = 0x1000   # ★ v kolika bajtech se $37 nahrazuje (BC na $C204)
SPARKLE = 0x37          # ★ (CP $37 na $C208)
BAND = 0x50C1           # ★ $C21E / $C233: pás běžícího textu
BAND_COLS, BAND_LINES = 31, 8
TITLE_DRAWN = 0xC18F    # ★ návrat z CALL $C1EF
SEED0 = 0x0000          # ★ SEED na vstupu do $C1EF (změřeno, disasm_notes §5)



def rand_seq(seed):
    """★ $F8BC: B += C; C += $CD; B += $AB + CY; vrací B."""
    s = seed
    while True:
        c, b = s & 0xFF, s >> 8
        b = (b + c) & 0xFF
        t = c + 0xCD
        c = t & 0xFF
        b = (0xAB + b + (t > 0xFF)) & 0xFF
        s = (b << 8) | c
        yield b, s


def title_screen(code):
    """První snímek titulky z dat programu. Vrací (6912 B, počet volání, SEED po)."""
    scr = bytearray(code[TITLE_DATA - 0x4000:TITLE_DATA - 0x4000 + 6912])
    gen = rand_seq(SEED0)
    calls, seed = 0, SEED0
    for i in range(TITLE_RAND_BYTES):
        if scr[i] == SPARKLE:
            scr[i], seed = next(gen)
            calls += 1
    for line in range(BAND_LINES):
        a = BAND - 0x4000 + line * 256
        scr[a:a + BAND_COLS] = bytes(BAND_COLS)
    return bytes(scr), calls, seed


def simulator():
    snap = P.Snapshot.get(os.path.join(L.ROOT, 'build', 'thunderbirds.z80'))
    if snap is None:
        raise SystemExit('chybi build/thunderbirds.z80 – spust ./tools/mksnapshot.sh')
    sim = P.from_snapshot(P.CSimulator or P.Simulator, snap, {}, {'ay': [None] * 16},
                          {'fast_djnz': False, 'fast_ldir': False}, None)
    tr = P.Tracer(sim, snap.border, snap.out7ffd, snap.outfffd, list(snap.ay), snap.outfe, True)
    sim.set_tracer(tr)
    return snap, sim, tr


def b64(data):
    return base64.b64encode(bytes(data)).decode('ascii')


def main():
    ref_dir = os.path.join(L.ROOT, 'build', 'ref')
    data_dir = os.path.join(L.ROOT, 'data')
    os.makedirs(ref_dir, exist_ok=True)
    code = L.code_image()

    # titulka z programu a reference ze simulátoru
    title, calls, seed = title_screen(code)
    snap, sim, tr = simulator()
    with contextlib.redirect_stdout(io.StringIO()):
        tr.run(snap.pc, TITLE_DRAWN, 0, 0, True, lambda *a: True, None, None, None,
               '$', '04X', '04X')
    ref_title = bytes(sim.memory[0x4000:0x5B00])
    sim_seed = sim.memory[0x5C76] | (sim.memory[0x5C77] << 8)
    open(os.path.join(ref_dir, 'title.scr'), 'wb').write(ref_title)
    diff = sum(1 for a, b in zip(title, ref_title) if a != b)
    print('titulka: %d volání generátoru, SEED po $%04X (simulátor $%04X), '
          'od reference se liší v %d B' % (calls, seed, sim_seed, diff))

    screen = {
        'note': 'obrazovky originálu (tools/mkscreen.py), videopaměť $4000-$5AFF tak, '
                'jak ji drží stroj. title: první snímek titulky složený z programu '
                '($A673 + generátor $F8BC od SEED $0000, pás běžícího textu prázdný)',
        'title': {'videoRAM': b64(title), 'seedAfter': seed, 'randCalls': calls},
    }
    with open(os.path.join(data_dir, 'screen.json'), 'w') as f:
        json.dump(screen, f, indent=1)
        f.write('\n')
    rom = L.rom48()
    loading = {
        'note': 'loading screen z kazety: prvních 6912 B turbo bloku, bity zrcadlově '
                '(tools/tblib.py loading_screen), videopaměť $4000-$5AFF; basic: '
                'co na obrazovce nechá BASIC T\'BIRDS (tblib.basic_screen)',
        'name': 'LOADING SCREEN', 'width': 256, 'height': 192,
        'videoRAM': b64(L.loading_screen()),
        'basic': {
            'row': L.LOADING_ROW,
            'cells': [{'col': L.LOADING_COL + i, 'attr': attr,
                       'glyph': list(rom[0x3D00 + (ord(ch) - 32) * 8:0x3D08 + (ord(ch) - 32) * 8])}
                      for i, (ch, attr) in enumerate(L.LOADING_TEXT)],
            'poke': {'address': L.POKE[0], 'value': L.POKE[1]},
        },
    }
    with open(os.path.join(data_dir, 'loading.json'), 'w') as f:
        json.dump(loading, f, indent=1)
        f.write('\n')
    P.write_png(os.path.join(ref_dir, 'title.png'), P.scr_to_rgb(title), 256, 2)
    print('zapsano data/screen.json, data/loading.json, build/ref/title.{scr,png}')


if __name__ == '__main__':
    main()
