#!/usr/bin/env python3
"""Snímky obrazovky **během** nahrávání kazety – co ROM a zavaděč opravdu ukážou.

    ./tools/traceloading.py [--out build/loading] [--fast]

Pustí totéž simulované nahrání jako `tools/mksnapshot.sh` (SkoolKit
`tap2sna.py`, ROM 48K, BASIC i turbo blok) a v každém
snímku ULA se podívá na videopaměť. Kdykoli se obraz změní, uloží ho
(`.scr` + `.png`) a vypíše, **co je na něm napsané ROM fontem** – každá
znaková buňka se porovná bajt po bajtu se znaky ROM na `$3D00` a v obou
barevných polaritách. Vedle textu vypíše barvu borderu a atribut buněk
s textem, takže je vidět i to, co je **napsané, ale neviditelné** (inkoust
= papír).

Na tohle se ptá `MILNIKY.md` M1: nápisy, které LOAD TAPE v remaku ukazuje
(`Program: T'BIRDS`, `*LOADING*`), se neopisují od sourozenců, ale **ověří se
snímky z nahrávání**. `app/tapeLoadingModel.js` cituje výstup tohohle
nástroje.

Bez `--fast` se nahrává rychlostí pásky (fast-load=0), aby se obraz
zachytil i uprostřed bloků; trvá to déle.
"""
import argparse, hashlib, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tblib as B                                                # noqa: E402
RETRO = B.RETRO
sys.path.insert(0, B.SKOOLKIT)
sys.path.insert(0, RETRO)

from scr2png import scr_to_rgb, write_png                        # noqa: E402
from skoolkit import tap2sna, ROM48, read_bin_file               # noqa: E402

ROM = read_bin_file(ROM48, 16384)
FONT = {bytes(ROM[0x3D00 + 8 * i:0x3D08 + 8 * i]): chr(32 + i) for i in range(96)}
FONT[bytes(ROM[0x3D60:0x3D68])] = '©'                       # $7F = ©


def offset(row, line, col):
    return ((row >> 3) << 11) | (line << 8) | ((row & 7) << 5) | col


def cell(scr, row, col):
    return bytes(scr[offset(row, line, col)] for line in range(8))


def read_text(scr):
    """[(řádek, sloupec, text, atribut)] – souvislé úseky znaků ROM fontu."""
    out = []
    for row in range(24):
        line, start, attrs = '', None, set()
        for col in range(33):
            ch = None
            if col < 32:
                c = cell(scr, row, col)
                ch = FONT.get(c) or FONT.get(bytes(255 - b for b in c))
                if ch == ' ' and not line:
                    ch = None
            if ch is not None:
                if start is None:
                    start = col
                line += ch
                attrs.add(scr[6144 + row * 32 + col])
            elif line:
                text = line.rstrip()
                if text:
                    out.append((row, start, text, sorted(attrs)))
                line, start, attrs = '', None, set()
    return out


class Recorder:
    def __init__(self, out_dir):
        self.out_dir = out_dir
        self.last = None
        self.shots = []

    @staticmethod
    def colour(border):
        """Barva borderu na konci snímku. SkoolKit předává buď číslo, nebo
        seznam změn `(T-stav, hodnota portu $FE)` během snímku."""
        if isinstance(border, list):
            return border[-1][1] & 7 if border else None
        return border

    def draw(self, scr, frame, border=None, *rest):
        digest = hashlib.sha1(bytes(scr)).digest()
        if digest != self.last:
            self.last = digest
            scr = bytes(scr)
            path = os.path.join(self.out_dir, 'load%05d' % frame)
            open(path + '.scr', 'wb').write(scr)
            write_png(path + '.png', scr_to_rgb(scr), 256, 2)
            self.shots.append((frame, self.colour(border), scr))
        return True


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=os.path.join(B.ROOT, 'build', 'loading'))
    ap.add_argument('--fast', action='store_true',
                    help='fast-load=1: bloky se nahrají naráz, snímky jen mezi nimi')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    recorder = Recorder(args.out)

    class Screen:
        def draw(self, scr, frame, border=None, *rest):
            return recorder.draw(scr, frame, border)

    tap2sna.get_screen = lambda *a, **k: Screen()
    snap = os.path.join(args.out, 'thunderbirds_loaded.z80')
    argv = ['--screen', '--start', '0xE105', '-c', 'finish-tape=1',
            '-c', 'fast-load=%d' % (1 if args.fast else 0), B.TAPE, snap]
    tap2sna.main(argv)

    # jen snímky, kde se změnil text nebo border: změny bajt po bajtu
    # uprostřed bloku SCREEN$ jsou tisíce a text se v nich nemění
    previous = None
    for frame, border, scr in recorder.shots:
        text = read_text(scr)
        key = (border, tuple((r, c, t) for r, c, t, a in text))
        if key == previous:
            continue
        previous = key
        print('snímek %5d  (%.2f s)  border %s' % (frame, frame / 50.08, border))
        for row, col, t, attrs in text:
            visible = all((a & 7) != ((a >> 3) & 7) for a in attrs)
            print('    řádek %2d sloupec %2d  %-32s atribut %s%s'
                  % (row, col, repr(t), ' '.join('$%02X' % a for a in attrs),
                     '' if visible else '  ← inkoust = papír, NEVIDITELNÉ'))
    print('%d snímků s jiným obrazem v %s' % (len(recorder.shots), args.out))


if __name__ == '__main__':
    main()
