#!/usr/bin/env python3
"""Disassembly Thunderbirds: obraz paměti → SkoolKit `.ctl` → `.skool`.

    ./tools/mkasm.py                 # sources/asm/thunderbirds.skool z .ctl
    ./tools/mkasm.py --ctl-from-map sources/asm/coverage.map [--force]

Vstupem je **jen** `tblib.code_image()` – RAM `$4000`–`$FFFF` ve chvíli
vstupu do hry (`$E105`) složená z kazety, i s dešifrovaným kódem; nikdy surový
turbo blok (`ZADANI.md` §1, `sources/docs/tape_layout.md`). Disassembly
začíná na `$5C00`: od tam leží hra (systémové proměnné ROM, které hra
používá, i vlastní data, nahrála páska jako záznam `$5C00`–`$9BFF`).

`sources/asm/thunderbirds.ctl` je ručně udržovaný podklad (STANDARDS.md:
disassembly se commituje). První podobu vyrobí `--ctl-from-map` ze SkoolKit
`sna2ctl.py` a mapy pokrytí z `playtrace.py --map`; co je ručně, se do
souboru dopisuje a **znovu se negeneruje** (bez `--force` to nástroj odmítne).
`thunderbirds.skool` se z `.ctl` dělá vždycky znovu.
"""
import argparse, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tblib as L   # noqa: E402

ORG = 0x5C00
ASM = os.path.join(L.ROOT, 'sources', 'asm')
CTL = os.path.join(ASM, 'thunderbirds.ctl')
SKOOL = os.path.join(ASM, 'thunderbirds.skool')
BIN = os.path.join(L.ROOT, 'build', 'thunderbirds_code.bin')
SCRIPTS = os.path.join(L.SKOOLKIT, 'skoolkit-10.1.data', 'scripts')

# ★ doložené rutiny (sources/docs/disasm_notes.md); doplňují se ručně do .ctl
NAMES = {
    0xE105: ('ENTRY', 'Vstup do hry z druhého dešifrovače (§1)'),
    0xE299: ('MAINLOOP', 'Hlavní smyčka hry, JP $E299 na $E353 (§4)'),
    0xE4D9: ('SPEED_DELAY', 'Zpoždění (5 - ($5D64)) × $F44E s BC=$78 (§4)'),
    0xF8B6: ('DELAY', 'DEC BC až do nuly; vstup $F44E (§4)'),
    0xF8BC: ('RAND', 'Generátor náhody, stav SEED $5C76; vstup $F451 (§5)'),
    0xA398: ('ISR_GAME', 'Obsluha přerušení IM 2 ve hře (§2)'),
    0xC642: ('ISR_TITLE', 'Obsluha přerušení na titulce: běžící text (§2)'),
    0xA50F: ('NOISE_SEED', 'Šum: SEED_lo = 5×SEED_lo + 1 (§5)'),
    0xC173: ('TITLE', 'Titulka: smyčka $C19B (§3)'),
}


def run(script, *args, out=None):
    env = dict(os.environ, PYTHONPATH=L.SKOOLKIT)
    res = subprocess.run([sys.executable, os.path.join(SCRIPTS, script), *args],
                         env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                         check=True)
    if out:
        open(out, 'wb').write(res.stdout)
    return res.stdout


def ctl_from_map(path, force):
    if os.path.exists(CTL) and not force:
        raise SystemExit('%s uz existuje a je rucne udrzovany – --force ho prepise' % CTL)
    raw = run('sna2ctl.py', '-h', '-o', '0x%04X' % ORG, '-m', path, BIN).decode()
    head = ['; Thunderbirds (Firebird 1985) – disassembly RAM $5C00-$FFFF na vstupu do hry',
            '; (tools/tblib.py code_image). Prvni podoba z mapy pokryti',
            '; (tools/mkasm.py --ctl-from-map), dal rucne.']
    out = []
    for l in raw.splitlines():
        if not l.strip():
            continue
        p = l.split()
        if len(p) >= 2 and len(p[0]) == 1 and p[1].startswith('$'):
            a = int(p[1][1:], 16)
            if a in NAMES:
                name, text = NAMES[a]
                out.append('@ $%04X label=%s' % (a, name))
                l = '%s $%04X %s' % (p[0], a, text)
        out.append(l)
    open(CTL, 'w').write('\n'.join(head + out) + '\n')
    print('zapsano %s (%d radku)' % (CTL, len(head + out)))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ctl-from-map', metavar='MAP')
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    os.makedirs(os.path.dirname(BIN), exist_ok=True)
    os.makedirs(ASM, exist_ok=True)
    # 64K obraz, aby sna2skool znal adresy (soubor .bin se čte od -o)
    open(BIN, 'wb').write(L.code_image()[ORG - 0x4000:])
    if args.ctl_from_map:
        ctl_from_map(args.ctl_from_map, args.force)
    run('sna2skool.py', '-H', '-o', '0x%04X' % ORG, '-c', CTL, BIN, out=SKOOL)
    n = sum(1 for _ in open(SKOOL))
    print('zapsano %s (%d radku)' % (SKOOL, n))


if __name__ == '__main__':
    main()
