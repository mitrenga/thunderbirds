#!/usr/bin/env python3
"""Kde přerušení zastihne program: PC a SP na každém snímku.

    ./tools/tracecadence.py [--from N] [--frames N] [--script "..."]

Hra Thunderbirds je řízená přerušením IM 2 (obsluha `$A398`,
`sources/docs/disasm_notes.md`). Tenhle nástroj pustí hru se skriptem kláves
jako `playtrace.py` a od snímku `--from` vypíše na každém snímku adresu, kde
běžel hlavní program, když přišlo přerušení — a histogram adres. Podle něj
se pozná, jestli hlavní program na snímek čeká (`HALT`, smyčka nad čítačem),
nebo běží volně.
"""
import argparse, collections, contextlib, io, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import playtrace as P   # noqa: E402

# výchozí skript: titulka → FIRE (A) → pravidla nákladu → SPACE → výběr
# vybavení → 7× DOWN (6) na TAKE OFF → FIRE (A); hra běží od ≈ snímku 2300
GAME = ('1000:1010:A,1300:1310:SPACE,' +
        ','.join('%d:%d:6' % (1500 + i * 60, 1510 + i * 60) for i in range(7)) +
        ',2000:2010:A')


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--from', dest='start', type=int, default=2600)
    ap.add_argument('--frames', type=int, default=3100)
    ap.add_argument('--script', default=GAME)
    ap.add_argument('--list', action='store_true', help='vypsat PC na každém snímku')
    ap.add_argument('--passes', type=int, default=0,
                    help='po --frames změřit N průchodů hlavní smyčkou (T-stavy)')
    ap.add_argument('--loop', default='0xE299', help='začátek hlavní smyčky')
    args = ap.parse_args()

    snapshot = P.Snapshot.get(os.path.join(HERE, '..', 'build', 'thunderbirds.z80'))
    cls = P.CSimulator or P.Simulator
    sim = P.from_snapshot(cls, snapshot, {}, {'ay': [None] * 16},
                          {'fast_djnz': False, 'fast_ldir': False}, None)
    tracer = P.Tracer(sim, snapshot.border, snapshot.out7ffd, snapshot.outfffd,
                      list(snapshot.ay), snapshot.outfe, True)
    sim.set_tracer(tracer)
    script = P.parse_script(args.script)
    samples = []

    def draw(scr, frame, border, keyboard):
        for i in range(8):
            keyboard[i] = 0
        for a, b, key in script:
            if a <= frame < b:
                row, bit = P.KEYS[key]
                keyboard[P.ROWS[row]] |= 1 << bit
        if frame >= args.start:
            r = sim.registers
            pc, sp = r[24], r[12]
            if pc == 0xFEFE:
                # přerušení už je přijaté: přerušené místo je návratová
                # adresa na vrcholu zásobníku
                m = sim.memory
                pc, sp = m[sp] | (m[(sp + 1) & 0xFFFF] << 8), (sp + 2) & 0xFFFF
            samples.append((frame, pc, sp))
        return frame < args.frames

    with contextlib.redirect_stdout(io.StringIO()):
        tracer.run(snapshot.pc, -1, 0, 0, True, draw, None, None, None, '$', '04X', '04X')
    if args.passes:
        loop = int(args.loop, 0)
        frame_t = 69888
        args.frames = 10 ** 9
        r = sim.registers
        with contextlib.redirect_stdout(io.StringIO()):
            tracer.run(r[24], loop, 0, 0, True, draw, None, None, None, '$', '04X', '04X')
        times = [r[25]]
        for _ in range(args.passes):
            with contextlib.redirect_stdout(io.StringIO()):   # „Stopped at …"
                tracer.run(r[24], loop, 0, 0, True, draw, None, None, None, '$', '04X', '04X')
            times.append(r[25])
        d = [b - a for a, b in zip(times, times[1:])]
        print('%d průchodů $%04X: min %d T, max %d T, průměr %.0f T = %.3f snímku'
              % (len(d), loop, min(d), max(d), sum(d) / len(d), sum(d) / len(d) / frame_t))
        print('  rychlost ($5D64) = %d, zpoždění $E4D9 = %d × CALL $F44E s BC = $78'
              % (sim.memory[0x5D64], 5 - sim.memory[0x5D64]))
        c = collections.Counter(round(x / frame_t, 2) for x in d)
        print('  rozložení (snímky): ' + ', '.join('%.2f×%d' % kv for kv in sorted(c.items())))
        return
    hist = collections.Counter(pc for _, pc, _ in samples)
    if args.list:
        for f, pc, sp in samples:
            print('%5d  PC $%04X  SP $%04X' % (f, pc, sp))
    print('%d snímků od %d, PC při přerušení:' % (len(samples), args.start))
    for pc, n in hist.most_common(20):
        print('  $%04X  %5d×' % (pc, n))


if __name__ == '__main__':
    main()
