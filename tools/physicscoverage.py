#!/usr/bin/env python3
"""Co z hlavní smyčky originálu záznamy pohybu proběhly — a co ne.

    ./tools/physicscoverage.py [--all]

`tools/tracephysics.py` ukládá ke každému scénáři mapu instrukcí, které
hlavní program (mimo obsluhu přerušení) provedl. Tenhle nástroj je sjednotí
a projde jimi kód hlavní smyčky a toho, co volá (`RANGES`), instrukci po
instrukci (disassembler SkoolKit nad obrazem paměti): kolik instrukcí
proběhlo a **které souvislé úseky ne** — s první instrukcí a návěštím
z `sources/asm/thunderbirds.ctl`, když ho má. Co neproběhlo, to
`tools/matchphysics.mjs` neověřil, ať v převodu je, nebo ne.

Úseky, o kterých se ví, že v M3 neběží (titulka, demo, start mise,
ukládání, texty z ROM), jsou v `KNOWN` a vypíšou se zvlášť; `--all` vypíše
i je.
"""
import argparse, base64, glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tblib as L                                                # noqa: E402

# ★ kód, který hlavní smyčka (`$E299`) a vstup do místnosti (`$C92D`) volají
RANGES = [(0xC92D, 0xD67E, 'vstup do místnosti a zvláštní místnosti'),
          (0xE24F, 0xE299, 'start místnosti ($E24F, $E269)'),
          (0xE299, 0xFE75, 'hlavní smyčka a její rutiny')]
# ★ úseky, které v M3 neběží — a proč
KNOWN = [
    (0xCAF8, 0xCB23, 'demo titulky ($5D11)'),
    (0xE3EC, 0xE448, 'ukládání a nahrávání pozice (S, L)'),
    (0xE448, 0xE4D9, 'texty GAME OVER, SAVE (data)'),
    (0xE4ED, 0xE55F, 'texty WELL DONE (data)'),
    (0xE590, 0xE5B2, 'mise dokončena: ROM texty, klávesa (M4)'),
    (0xE5D4, 0xE5FD, 'pauza P (remake má svou)'),
    (0xE66A, 0xE690, 'GAME OVER: ROM texty (M4)'),
    (0xE6A9, 0xE6BF, 'text OUT OF FUEL (data)'),
    (0xE70A, 0xE745, 'konec paliva: ROM text (M4)'),
    (0xE317, 0xE33E, 'číslo místnosti v podvodu (ROM $1A1B)'),
    (0xF339, 0xF35E, 'klávesy podvodu N, B, R'),
    (0xF398, 0xF3D2, 'podvod: další a předchozí místnost'),
    (0xF3D2, 0xF424, 'data: klávesy podvodu, maska'),
    (0xF424, 0xF47E, 'skoková tabulka (data)'),
    (0xF839, 0xF862, 'proud panelu (data)'),
    (0xF862, 0xF898, 'tabulka řádků při startu ($F862)'),
    (0xFDBF, 0xFDC1, 'čítače (data)'),
]


def labels():
    out = {}
    path = os.path.join(L.ROOT, 'sources', 'asm', 'thunderbirds.ctl')
    for line in open(path, encoding='utf-8'):
        m = re.match(r'@ \$([0-9A-F]{4}) label=(\S+)', line)
        if m:
            out[int(m.group(1), 16)] = m.group(2)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--all', action='store_true', help='vypsat i známé úseky')
    args = ap.parse_args()
    files = sorted(glob.glob(os.path.join(L.ROOT, 'build', 'ref', 'physics', '*.json')))
    if not files:
        raise SystemExit('chybí build/ref/physics – spusť ./tools/tracephysics.py')
    seen = bytearray(0x10000)
    for path in files:
        data = json.load(open(path))
        if 'coverage' not in data:
            continue
        cov = base64.b64decode(data['coverage'])
        for a in range(0x10000):
            if cov[a]:
                seen[a] = 1
    mem = bytearray(open(os.path.join(L.ROOT, 'build', 'ref', 'physics', 'start.bin'), 'rb').read())
    names = labels()
    known = lambda a: next((k for k in KNOWN if k[0] <= a < k[1]), None)
    total = covered = 0
    gaps = []
    for lo, hi, what in RANGES:
        n = c = 0
        gap = None
        for line in L.disassemble(mem, lo, hi):
            a = int(line[1:5], 16)
            n += 1
            if seen[a]:
                c += 1
                if gap:
                    gaps.append(gap)
                    gap = None
            elif known(a) and not args.all:
                if gap:
                    gaps.append(gap)
                    gap = None
            elif gap and gap['known'] == known(a):
                gap['end'] = a
                gap['count'] += 1
            else:
                if gap:
                    gaps.append(gap)
                gap = {'start': a, 'end': a, 'count': 1, 'first': line, 'known': known(a)}
        if gap:
            gaps.append(gap)
        print('%-40s %5d instrukcí, proběhlo %5d (%.1f %%)' % (what, n, c, 100.0 * c / n))
        total += n
        covered += c
    print('celkem %d instrukcí, proběhlo %d (%.1f %%), %d scénářů' % (total, covered, 100.0 * covered / total, len(files)))
    print('\nneproběhlo (bez známých úseků):' if not args.all else '\nneproběhlo:')
    for g in gaps:
        if g['count'] < 1:
            continue
        label = names.get(g['start'], '')
        note = (' – ' + g['known'][2]) if g['known'] else ''
        print('  $%04X-$%04X %4d instr.  %-14s %s%s' % (g['start'], g['end'], g['count'], label,
                                                         g['first'][22:].strip(), note))


if __name__ == '__main__':
    main()
