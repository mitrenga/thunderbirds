#!/usr/bin/env python3
"""Reference pohybu: průchody hlavní smyčkou originálu se skriptovanými klávesami.

    ./tools/tracephysics.py [--scenario NAME] [--passes N]

Originál se v simulátoru dovede (skript `tracecadence.GAME`) do hry: první
místnost stojí a hlavní smyčka je poprvé na `$E299`. Tenhle stav je
`build/ref/physics/start.bin` + `start.regs`. Z něj se pro každý scénář
(`SCENARIOS`) pouští originál **instrukci po instrukci** (svision SkoolKit
CSimulator) s přerušeními IM 2 jako na 48K Spectru (snímek 69 888 T,
přerušení aktivní 32 T, obsluha `$A398` s DI ho občas přetáhne a další
přerušení propadne) a zapisuje se **průchod po průchodu** (od `$E299` do
dalšího `$E299`):

- **klávesy**: každé volání ROM `KEY-SCAN` (`$028E`) a co vrátilo v DE —
  originál čte klávesnici jednou za průchod (`$F2D6`), a jen když plavidlo
  stojí; scénář drží klávesu po celé průchody
- **přerušení**: pro každé přijaté přerušení **počet sdílených přístupů**
  (`EVENTS`), které hlavní program do té chvíle v průchodu udělal. Sdílený
  přístup je instrukce, která čte nebo píše stav společný s obsluhou
  přerušení — SEED (generátor `$F8BC` čte na `$F8BD` a píše na `$F8CC`, šum
  `$A50F` v obsluze píše dolní bajt), příznaky zvuků (`$6544`–`$6553`,
  obsluha je čte a nuluje) a příznak sekundy `$5CFC` (obsluha ho nastavuje,
  `$E6BF`/`$F709` čte a nuluje). Převod spouští obsluhu přesně mezi týmiž
  přístupy, takže pořadí změn sdíleného stavu je stejné jako v originálu
- **T-stavy** průchodu a každé obsluhy přerušení v něm (kadence,
  `tools/measurecadence.mjs`)
- **pokrytí**: které instrukce hlavní program (mimo obsluhu přerušení)
  provedl — `tools/physicscoverage.py` z toho říká, co nula rozdílů
  pokrývá
- **paměť**: co se v RAM `$4000`–`$FFFF` za průchod změnilo (adresa,
  hodnota) — `tools/matchphysics.mjs` z toho skládá stav originálu po každém
  průchodu

Výstup `build/ref/physics/<scénář>.json`. Scénář skončí po `--passes`
průchodech, nebo když se hra vrátí na titulku (konec hry).
"""
import argparse, base64, json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tblib as L                                                # noqa: E402
import tracerooms as TR                                          # noqa: E402
from skoolkit.csimulator import CSimulator                       # noqa: E402

LOOP = 0xE299           # ★ začátek průchodu hlavní smyčkou
BACK = 0xE269           # ★ návrat ze vstupu do první místnosti
KEY_SCAN = 0x028E       # ROM KEY-SCAN
# ★ kde hra opouští hlavní smyčku: konec hry (GAME OVER, návrat na titulku),
# start mise (místnost 0: výběr vybavení, M4), mise dokončená (WELL DONE)
# a došlé palivo (text OUT OF FUEL z ROM, M4)
ENDS = {0xE66A: 'gameOver', 0xD67E: 'base', 0xE590: 'missionComplete', 0xE70A: 'outOfFuel'}
FRAME = 69888           # T-stavů na snímek 48K
STEPS_MAX = 20_000_000  # instrukcí na průchod, než se scénář prohlásí za zaseknutý
INT_ACTIVE = 32         # jak dlouho je signál přerušení aktivní

# ★ instrukce hlavního programu, které sdílí stav s obsluhou přerušení
# (sources/docs/physics.md); mimo obsluhu se počítají
EVENTS = {
    0xF8BD: 'rand read SEED', 0xF8CC: 'rand write SEED',
    0xE3CC: '$6544', 0xE3E8: '$6544', 0xE61C: '$6544', 0xE706: '$6544',
    0xEAFF: '$6544', 0xEB23: '$6544', 0xD672: '$6544', 0xCB1F: '$6544',
    0xE5B7: '$6547', 0xE74A: '$6551', 0xE75A: '$6550',
    0xE901: '$6553', 0xE917: '$6553', 0xEA30: '$6553', 0xEA58: '$6553',
    0xEB42: '$654E',
    0xE6BF: 'read $5CFC', 0xF709: 'read $5CFC', 0xF70F: 'write $5CFC',
}

# klávesy hry (`$5D0B`: LEFT 5, RIGHT 8, UP 7, DOWN 6, FIRE A)
MOVES = ['5', '8', '7', '6']


class Random:
    """Náhodná hra: klávesa pohybu (občas FIRE, občas nic) po náhodný počet průchodů."""

    def __init__(self, seed, hold=(1, 30), fire=0.06, idle=0.1):
        self.rnd, self.hold, self.fire, self.idle = random.Random(seed), hold, fire, idle
        self.left, self.key_ = 0, None

    def key(self, memory):
        if self.left == 0:
            x = self.rnd.random()
            self.key_ = 'A' if x < self.fire else None if x < self.fire + self.idle \
                else self.rnd.choice(MOVES)
            self.left = 1 if self.key_ == 'A' else self.rnd.randint(*self.hold)
        self.left -= 1
        return self.key_


class Explore:
    """Průzkumník: drží směr, dokud se plavidlo hýbe; na znaku, kde stojí,
    si občas vybere směr k nejméně navštívenému sousednímu políčku, a když se
    zasekne, vybere jiný; občas FIRE. Stav čte z paměti originálu (plavidlo
    `$656D`, jeho C, B, místnost) — do originálu jdou pořád jen klávesy."""

    STEP = {'5': (1, 0), '8': (-1, 0), '7': (0, 1), '6': (0, -1)}   # C roste doleva, B nahoru

    def __init__(self, seed, fire=0.002, stuck=3, wander=0.15):
        self.rnd, self.fire, self.stuck, self.wander = random.Random(seed), fire, stuck, wander
        self.dir, self.last, self.still = self.rnd.choice(MOVES), None, 0
        self.visits = {}

    def key(self, memory):
        ix = memory[0x656D] | (memory[0x656E] << 8)
        room, c, b = memory[0x6561], memory[ix], memory[ix + 1]
        idle = not (memory[0x6562] or memory[0x656B] or memory[0x656F] or memory[0xE778])
        where = (ix, room, c, b, memory[ix + 2], memory[ix + 3])
        if not idle:
            self.still = 0
        elif where == self.last:
            self.still += 1
        else:
            self.still = 0
            self.visits[(room, c, b)] = self.visits.get((room, c, b), 0) + 1
        self.last = where
        if self.rnd.random() < self.fire:
            return 'A'
        if idle and (self.still > self.stuck or self.rnd.random() < self.wander):
            def score(k):
                dc, db = self.STEP[k]
                return self.visits.get((room, c + dc, b + db), 0) + self.rnd.random() \
                    + (50 if self.still > self.stuck and k == self.dir else 0)
            self.dir = min(MOVES, key=score)
            self.still = 0
        return self.dir


class Idle:
    def key(self, memory):
        return None


def free_spots(room):
    """Volná místa pro TB2 (4 × 2) a TB1 (3 × 1) ve stínové mapě místnosti
    (`build/ref/rooms/roomNN.map` z `tools/tracerooms.py`, bez plavidel):
    C, B levého horního rohu (C = 33 − sloupec, B = 24 − řádek)."""
    path = os.path.join(L.ROOT, 'build', 'ref', 'rooms', 'room%02d.map' % room)
    shadow = open(path, 'rb').read()
    taken = set()

    def fits(col, row, w, h):
        return all(shadow[(row + y) * 32 + col + x] == 0x20 and (col + x, row + y) not in taken
                   for y in range(h) for x in range(w))
    spots = []
    for w, h in ((4, 2), (3, 1)):
        for row in range(1, 19 - h + 1):
            for col in range(1, 31 - w + 1):
                if fits(col, row, w, h):
                    break
            else:
                continue
            break
        else:
            return None
        taken.update((col + x, row + y) for y in range(h) for x in range(w))
        spots.append((33 - col, 24 - row))
    return spots


def teleport(room):
    """Obě plavidla do místnosti `room` na volná místa, vstup přes `$E24F`."""
    spots = free_spots(room)
    if spots is None:
        return None
    (c2, b2), (c1, b1) = spots
    pokes = []
    for ix, c, b in ((0x5CCC, c1, b1), (0x5CDC, c2, b2)):
        pokes += [(ix, c), (ix + 1, b), (ix + 0x0A, c), (ix + 0x0B, b), (ix + 0x0E, room), (ix + 0x0F, 0)]
    return {'room': room, 'pokes': pokes}


# ★ místnosti, kterými se vstupuje přes $E24F (bez půdorysu 0 a bez těch, které
# ani originál nedokreslí – sources/docs/maze.md)
TELEPORT = [n for n in range(1, 98) if n not in (44, 55, 62, 69, 71, 73, 78, 81, 89, 94)]

SCENARIOS = {
    'idle': lambda: Idle(),
    'walk1': lambda: Random(1),
    'walk2': lambda: Random(2, hold=(1, 60), fire=0.03),
    'walk3': lambda: Random(3, hold=(1, 12), fire=0.12),
    'walk4': lambda: Random(4, hold=(5, 80), fire=0.04, idle=0.05),
    'explore1': lambda: Explore(1),
    'explore2': lambda: Explore(2, fire=0.004),
    'explore3': lambda: Explore(3, stuck=30),
    'explore4': lambda: Explore(4, fire=0.001, stuck=6),
    'explore5': lambda: Explore(5),
    'explore6': lambda: Explore(6, fire=0.003, stuck=20),
    # ★ dlouhé hry: místnosti s nepřáteli, palivo, čas
    'long1': lambda: Explore(7, fire=0.003),
    'long2': lambda: Random(8, hold=(1, 40), fire=0.02),
}
for _n in TELEPORT:
    SCENARIOS['room%02d' % _n] = (lambda n: lambda: Explore(100 + n, fire=0.004))(_n)
SETUP = {'room%02d' % n: (lambda n: lambda: teleport(n))(n) for n in TELEPORT}


def lamp(room):
    """Jako `teleport`, a k tomu lampa z vybavení (`$667A` bit 0, start mise
    ji dává za náklad — M4): v tmavé místnosti svítí kolem plavidla (`$FE07`)."""
    setup = teleport(room)
    setup['pokes'].append((0x667A, 0x01))
    return setup


# ★ tmavé místnosti (+6 AND +7 ≠ 0, půdorys < 30)
DARK = [8, 20, 21, 28, 40, 43, 53, 59, 67, 74, 79]
for _n in DARK:
    SCENARIOS['lamp%02d' % _n] = (lambda n: lambda: Explore(200 + n, fire=0.004))(_n)
    SETUP['lamp%02d' % _n] = (lambda n: lambda: lamp(n))(_n)


class Ports:
    """Klávesnice 48K po půlřádcích; Kempston ($1F) není připojený → $FF."""

    def __init__(self):
        self.rows = [0] * 8

    def press(self, key):
        self.rows = [0] * 8
        if key:
            row, bit = TR.P.KEYS[key]
            self.rows[TR.P.ROWS[row]] |= 1 << bit

    def read_port(self, registers, port):
        if port & 1 == 0:
            value = 0xFF
            high = port >> 8
            for i in range(8):
                if not high & (1 << i):
                    value &= ~self.rows[i] & 0xFF
            return value
        return 0xFF

    def write_port(self, registers, port, value, *rest):
        pass


def start_state():
    """Paměť a registry na prvním $E299 hry (a uloží je)."""
    out = os.path.join(L.ROOT, 'build', 'ref', 'physics')
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, 'start.bin')
    if os.path.exists(path) and os.path.exists(path[:-4] + '.regs'):
        return bytearray(open(path, 'rb').read()), json.load(open(path[:-4] + '.regs'))
    run = TR.Run()
    run.to(BACK)
    run.to(LOOP)
    mem, regs = bytearray(run.sim.memory), list(run.r)
    open(path, 'wb').write(mem)
    json.dump(regs, open(path[:-4] + '.regs', 'w'))
    return mem, regs


def changed(old, new):
    """(adresa, hodnota) všeho, co se v $4000-$FFFF změnilo; po blocích, ať je to rychlé."""
    out = bytearray()
    for a in range(0x4000, 0x10000, 256):
        if old[a:a + 256] != new[a:a + 256]:
            for i in range(a, a + 256):
                if old[i] != new[i]:
                    out += bytes((i >> 8, i & 0xFF, new[i]))
    return base64.b64encode(bytes(out)).decode('ascii')


def record(name, passes):
    mem0, regs0 = start_state()
    sim = CSimulator(bytearray(mem0), {}, None, {'fast_djnz': False, 'fast_ldir': False})
    r = sim.registers
    for i, v in enumerate(regs0):
        r[i] = v
    ports = Ports()
    sim.set_tracer(ports)
    memory = sim.memory
    player = SCENARIOS[name]()
    step = sim.run
    accept = sim.accept_interrupt
    events_at = EVENTS

    t = r[25]
    next_int = ((t + FRAME - INT_ACTIVE) // FRAME) * FRAME
    in_isr = False
    isr_sp = isr_pc = isr_t0 = 0
    scan_ret = None
    prev = bytes(memory)
    out = []
    current = None
    events = 0
    steps = 0
    seen = bytearray(0x10000)           # adresy instrukcí, které hlavní program provedl
    setup = SETUP[name]() if name in SETUP else None
    if setup:
        # ★ jako JP $E24F z hlavní smyčky: A = místnost, SP nahoře
        for a, v in setup['pokes']:
            memory[a] = v
        r[0], r[24], r[12] = setup['room'], 0xE24F, 0x5BFC
        current = {'key': None, 'scan': [], 'ints': [], 'isrT': [], 't': r[25], 'setup': setup}
    min_sp = r[12]
    ended = 'passes'
    pc = r[24]
    while True:
        if not in_isr:
            if pc == LOOP:
                if current is not None:
                    now = bytes(memory)
                    current['events'] = events
                    current['t'] = r[25] - current['t']
                    current['mem'] = changed(prev, now)
                    prev = now
                    out.append(current)
                    if len(out) >= passes:
                        break
                key = player.key(memory)
                steps = 0
                ports.press(key)
                current = {'key': key, 'scan': [], 'ints': [], 'isrT': [], 't': r[25]}
                events = 0
            elif pc in events_at:
                events += 1
            elif pc == KEY_SCAN:
                sp = r[12]
                scan_ret = memory[sp] | (memory[sp + 1] << 8)
            elif pc == scan_ret:
                current['scan'].append(r[4] * 256 + r[5])      # D, E
                scan_ret = None
            elif pc in ENDS:
                ended = ENDS[pc]
                break
        elif pc == isr_pc and r[12] == isr_sp:
            in_isr = False
            current['isrT'].append(r[25] - isr_t0)
            continue
        if not in_isr:
            seen[pc] = 1
        steps += 1
        if steps > STEPS_MAX:
            # ★ the original runs on without coming back to $E299 (an enemy
            # boxed in for good keeps trying directions, $F558)
            ended = 'stuck at $%04X' % pc
            break
        step()
        pc = r[24]
        t = r[25]
        if r[12] < min_sp:
            min_sp = r[12]
        if t >= next_int:
            if t < next_int + INT_ACTIVE:
                if r[26] and not in_isr:
                    sp = r[12]
                    if accept(r, memory, pc):
                        in_isr, isr_sp, isr_pc, isr_t0 = True, sp, pc, t
                        current['ints'].append(events)
                        pc = r[24]
                        next_int += FRAME
            else:
                next_int += FRAME
    if current is not None and ended != 'passes':
        current['events'] = events
        current['t'] = r[25] - current['t']
        current['mem'] = changed(prev, bytes(memory))
        current['end'] = ended
        out.append(current)
    data = {'scenario': name, 'passes': out, 'ended': ended, 'minSP': min_sp,
            'coverage': base64.b64encode(bytes(seen)).decode('ascii'),
            'events': {('%04X' % k): v for k, v in sorted(EVENTS.items())}}
    path = os.path.join(L.ROOT, 'build', 'ref', 'physics', name + '.json')
    json.dump(data, open(path, 'w'))
    ints = sum(len(p['ints']) for p in out)
    tt = sum(p['t'] for p in out)
    print('%-6s %5d průchodů, %6d přerušení, %.3f snímku/průchod, min SP $%04X, %s → %s'
          % (name, len(out), ints, tt / FRAME / max(1, len(out)), min_sp, ended, path))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--scenario', action='append', choices=sorted(SCENARIOS))
    ap.add_argument('--passes', type=int, default=None,
                    help='průchodů na scénář (výchozí 1500, long* 20000)')
    args = ap.parse_args()
    for name in args.scenario or sorted(SCENARIOS):
        record(name, args.passes or (20000 if name.startswith('long') else 1500))


if __name__ == '__main__':
    main()
