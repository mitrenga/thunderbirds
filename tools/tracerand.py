#!/usr/bin/env python3
"""Pustí generátory náhody originálu v simulátoru Z80 a vypíše, co dávají.

    ./tools/tracerand.py [--fn rand|noise] [--count N] [--seed 0xABCD] [--out FILE]

Bere **skutečný kód z kazety** (`tools/tblib.py` `memory_image()`, RAM na
vstupu do hry), nastaví stav `SEED` (`$5C76`) a volá pořád dokola
instrukci po instrukci (SkoolKit `Simulator`):

- `rand`: `$F451` (→ `JP $F8BC`), generátor (`disasm_notes.md` §5)
- `noise`: `$A50F`, míchání dolního bajtu `SEED` ve zvuku „šum“

Výstup je binární: za každé volání tři bajty – `A` (vrácené číslo) a nový
stav `SEED` (nižší, vyšší bajt). Pro `tools/matchrand.mjs`.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tblib as L                                                # noqa: E402
sys.path.insert(0, L.SKOOLKIT)

from skoolkit.simulator import Simulator                         # noqa: E402

ENTRIES = {'rand': 0xF451, 'noise': 0xA50F}   # ★ disasm_notes.md §5
STATE = 0x5C76          # ★ SEED, nižší bajt na $5C76
RETURN = 0x0000         # kam se vrací RET: adresa, na kterou kód nikdy neskočí
A, PC, SP = 0, 24, 12   # indexy registrů SkoolKitu


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--fn', choices=sorted(ENTRIES), default='rand')
    ap.add_argument('--count', type=int, default=65536)
    ap.add_argument('--seed', type=lambda v: int(v, 0), default=0)
    ap.add_argument('--out', default='-')
    ap.add_argument('--sweep', action='store_true',
                    help='pro každý dolní bajt 0–255 znovu od semínka (hi z --seed), --count volání')
    args = ap.parse_args()

    memory = bytearray(L.memory_image()[0])
    sim = Simulator(memory)
    out = bytearray()
    seeds = ([(args.seed & 0xFF00) | low for low in range(256)] if args.sweep
             else [args.seed])
    for seed in seeds:
        memory[STATE] = seed & 0xFF
        memory[STATE + 1] = (seed >> 8) & 0xFF
        for _ in range(args.count):
            sim.registers[SP] = 0xFF40
            memory[0xFF40] = RETURN & 0xFF
            memory[0xFF41] = RETURN >> 8
            sim.run(ENTRIES[args.fn], RETURN)
            out += bytes([sim.registers[A], memory[STATE], memory[STATE + 1]])
    if args.out == '-':
        sys.stdout.buffer.write(out)
    else:
        open(args.out, 'wb').write(out)


if __name__ == '__main__':
    main()
