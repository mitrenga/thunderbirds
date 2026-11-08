#!/usr/bin/env python3
"""Reference místností z běžícího originálu: obrazovka, stínová mapa, SEED.

    ./tools/tracerooms.py [--seed 0xCB68] [--rooms 1-97]

Hra se v simulátoru dovede (skript `tracecadence.GAME`) až k **prvnímu vstupu
do místnosti** — `$C991` s `A = 49` po startu Thunderbirdu 2, snímek ≈ 2522.
Tenhle stav je `base.bin` + `base.regs`; z něj dělá `tools/dumpmaze.py`
`data/global.json`.

1. **Místnosti**: z tohoto stavu se pro každou místnost `n` zavolá vstup do
   místnosti originálu `$C991` s `A = n` (`sources/docs/maze.md`), vždy ze
   stejné kopie paměti a registrů a se stejným SEED (výchozí = SEED, jaký
   měla hra na vstupu). Přerušení jsou zakázaná, takže SEED mění jen kreslení
   samo. Výstup `room%02d.scr` (videopaměť po návratu), `room%02d.map`
   (stínová mapa `$5EF6`, 800 kódů + 800 atributů), `room%02d.bin` (RAM
   `$4000`–`$FFFF`)
2. **Herní obrazovka** `game.scr`: tentýž běh pokračuje **se vším, co dělá
   originál** (přerušení, plameny loga `$F7ED`), až se vstup do první
   místnosti vrátí do `$E269` (návrat z `CALL $C936`): to je obrazovka, kterou
   skládá `app/screenComposer.js` (reference pro `tools/matchscreen.mjs`).
   `rooms.json` nese i počet běhů plamenů mezi nakreslením panelu (`$F634`)
   a návratem

Místnosti s půdorysem 0 originál přeskočí na další číslo (`$CB24`); to se
zapíše také. Místnost, která se nevrátí, je v `rooms.json` `returned: false`.
"""
import argparse, contextlib, io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tblib as L                                                # noqa: E402
import playtrace as P                                            # noqa: E402
import tracecadence as T                                         # noqa: E402
from skoolkit.simulator import Simulator                         # noqa: E402

ENTER = 0xC991          # ★ vstup do místnosti, A = číslo
ROOMS = 0x7F9A          # ★ 13 B na místnost
SEED = 0x5C76
SHADOW = 0x5EF6         # ★ stínová mapa 25 × 32 znaků, +$320 atributy
PANEL = 0xF634          # ★ kreslení panelu při startu mise
FLAMES = 0xF7ED         # ★ plameny loga, každé 4. přerušení
BACK = 0xE269           # ★ návrat z CALL $C936: mise začala, první místnost stojí


class Run:
    """Originál v simulátoru se skriptem kláves, zastavovaný na adresách."""

    def __init__(self):
        snap = P.Snapshot.get(os.path.join(L.ROOT, 'build', 'thunderbirds.z80'))
        self.sim = P.from_snapshot(P.CSimulator or P.Simulator, snap, {}, {'ay': [None] * 16},
                                   {'fast_djnz': False, 'fast_ldir': False}, None)
        self.tr = P.Tracer(self.sim, snap.border, snap.out7ffd, snap.outfffd,
                           list(snap.ay), snap.outfe, True)
        self.sim.set_tracer(self.tr)
        self.script = P.parse_script(T.GAME)
        self.r = self.sim.registers
        self.r[24] = snap.pc

    def draw(self, scr, frame, border, kb):
        for i in range(8):
            kb[i] = 0
        for a, b, k in self.script:
            if a <= frame < b:
                row, bit = P.KEYS[k]
                kb[P.ROWS[row]] |= 1 << bit
        return True

    def to(self, address):
        with contextlib.redirect_stdout(io.StringIO()):
            self.tr.run(self.r[24], address, 0, 0, True, self.draw, None, None, None,
                        '$', '04X', '04X')
        return self.r[25]


def references():
    """(paměť a registry na prvním $C991, obraz na $E269, plameny, T-stavy)."""
    run = Run()
    t_panel = run.to(PANEL)
    run.to(ENTER)
    mem0, regs0 = bytes(run.sim.memory), list(run.r)
    t_back = run.to(BACK)
    game = bytes(run.sim.memory[0x4000:0x5B00])
    count = Run()
    count.to(PANEL)
    flames = 0
    while count.to(FLAMES) < t_back:
        flames += 1
    return mem0, regs0, game, flames, t_panel, t_back


def enter_room(mem0, regs0, room, seed):
    """Zavolá $C991 s A = room; vrací (paměť, počet instrukcí)."""
    mem = bytearray(mem0)
    mem[SEED], mem[SEED + 1] = seed & 0xFF, seed >> 8
    sim = Simulator(mem, {})
    r = sim.registers
    for i, v in enumerate(regs0):
        r[i] = v
    sp = 0x5BF0
    mem[sp], mem[sp + 1] = 0, 0          # návrat na $0000 = konec
    r[12], r[0], r[24], r[26] = sp, room, ENTER, 0
    steps = 0
    while r[24] != 0:
        sim.run()
        steps += 1
        if steps > 5_000_000:
            return None, steps
    return bytes(mem), steps


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--seed', type=lambda v: int(v, 0), default=None)
    ap.add_argument('--rooms', default='1-97')
    args = ap.parse_args()
    lo, hi = (int(x) for x in args.rooms.split('-'))
    out = os.path.join(L.ROOT, 'build', 'ref', 'rooms')
    os.makedirs(out, exist_ok=True)
    mem0, regs0, game, flames, t_panel, t_back = references()
    open(os.path.join(out, 'base.bin'), 'wb').write(mem0)
    open(os.path.join(out, 'base.regs'), 'w').write(json.dumps(regs0))
    open(os.path.join(L.ROOT, 'build', 'ref', 'game.scr'), 'wb').write(game)
    seed0 = mem0[SEED] | (mem0[SEED + 1] << 8)
    seed = seed0 if args.seed is None else args.seed
    info = {'seed': seed, 'seedAtEntry': seed0, 'firstRoom': regs0[0],
            'flames': flames, 'tPanel': t_panel, 'tBack': t_back, 'rooms': {}}
    print('první vstup: místnost %d, SEED $%04X; plameny mezi panelem a $E269: %d'
          % (regs0[0], seed0, flames))
    for n in range(lo, hi + 1):
        mem, steps = enter_room(mem0, regs0, n, seed)
        d = mem0[ROOMS + 13 * (n - 1):ROOMS + 13 * n]
        if mem is None:
            # ★ půdorys 0: $CB24 → $C95A přejde na další místnost; 55 skončí
            # v ROM čekání na klávesu – kreslení místnosti to není
            info['rooms'][n] = {'layout': d[5], 'returned': False}
            print('místnost %2d: půdorys %2d, $C991 se nevrátila' % (n, d[5]))
            continue
        open(os.path.join(out, 'room%02d.scr' % n), 'wb').write(mem[0x4000:0x5B00])
        open(os.path.join(out, 'room%02d.map' % n), 'wb').write(mem[SHADOW:SHADOW + 1600])
        open(os.path.join(out, 'room%02d.bin' % n), 'wb').write(mem[0x4000:])
        info['rooms'][n] = {'layout': d[5], 'drawn': mem[0x6561],
                            'seedAfter': mem[SEED] | (mem[SEED + 1] << 8), 'steps': steps}
    json.dump(info, open(os.path.join(out, 'rooms.json'), 'w'), indent=1)
    print('%d místností do %s' % (len(info['rooms']), out))


if __name__ == '__main__':
    main()
