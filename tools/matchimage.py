#!/usr/bin/env python3
"""Obraz paměti z kazety (tblib.py) proti paměti simulátoru.

    ./tools/mksnapshot.sh && ./tools/matchimage.py

Dvě cesty od téže kazety k téže paměti, které se nesmí rozejít:

- **tblib.memory_image()**: bajty bere rovnou z TZX (zrcadlově, jak je skládá
  upravená LD-BYTES), obrazovku po BASICu skládá sám (`basic_screen`) a ROM
  ani pulzy nepouští. Na CPU SkoolKitu běží jen kód zavaděče (vrstvy 1–3)
- **build/thunderbirds.bin** (tools/mksnapshot.sh): simulované nahrání
  `tap2sna.py` pulz po pulzu přes ROM, BASIC i upravenou LD-BYTES, zastavené
  na vstupu do hry (`$E105`)

Kontroluje se:

1. obrazovka po BASICu (`$4000`–`$5BFF`, 7168 B): `basic_screen()` proti
   paměti simulátoru zastavené na `RANDOMIZE USR` (build/atvars.bin) — z ní si
   vrstva 1 počítá klíč
2. celá RAM `$4000`–`$FFFF` ve chvíli vstupu do hry, kromě **volného zásobníku
   pod SP** (`STACK_FREE` B): tam nechává pulzová LD-BYTES návratové adresy
   svých vnořených CALL (`$FF77`, `$FF90`) a zbytky z hledání pilotu — nejsou
   to data z kazety a hra je přepíše prvním PUSH. Vypíšou se, ne zamlčí
3. registry na vstupu: PC, SP, IX, IY, I, IM, IFF1

Výsledek: počet kontrol a počet rozdílů. Milník chce nulu.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tblib as L   # noqa: E402

STACK_FREE = 16     # kolik bajtů pod SP na vstupu se nekontroluje


def main():
    sys.path.insert(0, L.SKOOLKIT)
    from skoolkit.snapshot import Snapshot
    from skoolkit.simutils import PC, SP, IXh, IXl, IYh, IYl, I, IM, IFF

    build = os.path.join(L.ROOT, 'build')
    for f in ('thunderbirds.z80', 'atvars.z80'):
        if not os.path.isfile(os.path.join(build, f)):
            sys.exit('chybi build/%s - spust tools/mksnapshot.sh' % f)
    checks = diffs = 0

    # 1. obrazovka po BASICu
    atvars = Snapshot.get(os.path.join(build, 'atvars.z80'))
    real = bytes(atvars.ram(-1))[0:0x1C00]
    mine = L.basic_screen()
    d = [i for i in range(0x1C00) if real[i] != mine[i]]
    checks += 0x1C00
    diffs += len(d)
    print('obrazovka po BASICu  $4000-$5BFF: %5d kontrol, %d rozdilu, klic $%04X'
          % (0x1C00, len(d), L.loader_key(mine)))
    for i in d[:10]:
        print('  $%04X: tblib $%02X, simulator $%02X' % (0x4000 + i, mine[i], real[i]))

    # 2. RAM na vstupu do hry
    snap = Snapshot.get(os.path.join(build, 'thunderbirds.z80'))
    sim = bytes(snap.ram(-1))
    mem, regs, tape = L.memory_image()
    sp = snap.sp
    free = set(range(sp - STACK_FREE, sp))
    n = d = 0
    skipped = []
    for a in range(0x4000, 0x10000):
        if a in free:
            if mem[a] != sim[a - 0x4000]:
                skipped.append(a)
            continue
        n += 1
        if mem[a] != sim[a - 0x4000]:
            d += 1
            if d <= 10:
                print('  $%04X: tblib $%02X, simulator $%02X' % (a, mem[a], sim[a - 0x4000]))
    checks += n
    diffs += d
    print('RAM na vstupu do hry $4000-$FFFF: %5d kontrol, %d rozdilu' % (n, d))
    print('  volny zasobnik pod SP $%04X-$%04X nekontrolovan, lisi se %d B: %s'
          % (sp - STACK_FREE, sp - 1, len(skipped),
             ' '.join('%04X' % a for a in skipped)))
    print('  z proudu precteno %d z %d B, parita H = %d'
          % (tape.pos, len(L.turbo_stream()), tape.h))

    # 3. registry
    pairs = {
        'PC': (regs[PC], snap.pc),
        'SP': (regs[SP], snap.sp),
        'IX': ((regs[IXh] << 8) | regs[IXl], snap.ix),
        'IY': ((regs[IYh] << 8) | regs[IYl], snap.iy),
        'I': (regs[I], snap.i),
        'IM': (regs[IM], snap.im),
        'IFF1': (regs[IFF], snap.iff1),
    }
    bad = [k for k, (a, b) in pairs.items() if a != b]
    checks += len(pairs)
    diffs += len(bad)
    print('registry na vstupu: %d kontrol, %d rozdilu  (%s)' % (
        len(pairs), len(bad),
        ', '.join('%s=$%04X' % (k, b) for k, (a, b) in pairs.items())))
    for k in bad:
        print('  %s: tblib $%04X, simulator $%04X' % (k, pairs[k][0], pairs[k][1]))

    print('\nCELKEM: %d kontrol, %d rozdilu' % (checks, diffs))
    return 1 if diffs else 0


if __name__ == '__main__':
    sys.exit(main())
