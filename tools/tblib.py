#!/usr/bin/env python3
"""Společné čtení kazety a obrazu paměti Thunderbirds.

Jedno místo, kde je napsané, co je na kazetě, jak se z ní skládá obraz paměti
a kde v něm co leží. Nástroje `dump*`, `trace*` a `match*` to berou odsud,
aby se ta znalost nemusela opakovat (a rozcházet).

Zavaděč a skládání obrazu paměti popisuje `sources/docs/tape_layout.md`.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAPE = os.path.join(ROOT, 'sources', 'tape', 'Thunderbirds (Firebird).tzx')


def _skoolkit():
    """SkoolKit vendorovaný ve svision (R-008), přes symlink `app/svision`."""
    for base in (os.path.join(ROOT, 'app', 'svision'),
                 os.path.join(ROOT, '..', 'svision')):
        p = os.path.join(base, 'sources', 'skoolkit')
        if os.path.isdir(p):
            return os.path.normpath(p)
    raise FileNotFoundError('SkoolKit ve svision/sources/skoolkit neni '
                            '(stahne ho svision/tools/retro/fetchsources.py)')


SKOOLKIT = _skoolkit()
# the shared offline tools of svision (scr2png, pngread …)
RETRO = os.path.normpath(os.path.join(SKOOLKIT, '..', '..', 'tools', 'retro'))

# --- kazeta -----------------------------------------------------------------

TYPES = {0: 'Program', 1: 'Number array', 2: 'Character array', 3: 'Bytes'}

# texty archivního bloku $32 podle specifikace TZX
ARCHIVE_INFO = {0x00: 'title', 0x01: 'publisher', 0x02: 'author', 0x03: 'year',
                0x04: 'language', 0x05: 'type', 0x06: 'price',
                0x07: 'loader', 0x08: 'origin', 0xFF: 'comment'}


def tzx_version(path=TAPE):
    """Verze obalu TZX jako (major, minor)."""
    raw = open(path, 'rb').read(10)
    if raw[:8] != b'ZXTape!\x1a':
        raise ValueError('%s neni TZX' % path)
    return raw[8], raw[9]


def tzx_archive_info(path=TAPE):
    """Archivní info (blok $32) jako slovník {klíč: text}."""
    for b in tzx_all_blocks(path):
        if b['id'] == 0x32:
            return b['info']
    return {}


def tzx_all_blocks(path=TAPE):
    """TZX → seznam **všech** bloků, i těch bez dat (archivní info)."""
    raw = open(path, 'rb').read()
    if raw[:8] != b'ZXTape!\x1a':
        raise ValueError('%s neni TZX' % path)
    out, i = [], 10
    while i < len(raw):
        bid = raw[i]
        offset = i
        i += 1
        if bid == 0x32:
            length = raw[i] | (raw[i + 1] << 8)
            body = raw[i + 2:i + 2 + length]
            info, k = {}, 1
            for _ in range(body[0]):
                tid, n = body[k], body[k + 1]
                info[ARCHIVE_INFO.get(tid, '%02X' % tid)] = body[k + 2:k + 2 + n].decode('latin1')
                k += 2 + n
            out.append({'id': bid, 'offset': offset, 'info': info})
            i += 2 + length
            continue
        timing = None
        if bid == 0x10:
            pause = raw[i] | (raw[i + 1] << 8)
            length = raw[i + 2] | (raw[i + 3] << 8)
            i += 4
        elif bid == 0x11:
            h = raw[i:i + 18]
            w = lambda k: h[k] | (h[k + 1] << 8)   # noqa: E731
            timing = {'pilot': w(0), 'sync1': w(2), 'sync2': w(4), 'zero': w(6),
                      'one': w(8), 'pilotPulses': w(10), 'lastBits': h[12]}
            pause = w(13)
            length = h[15] | (h[16] << 8) | (h[17] << 16)
            i += 18
        else:
            # schválně spadne: blok, který se tiše přeskočí, je ztracený blok
            raise NotImplementedError('blok ID $%02X na offsetu %d' % (bid, offset))
        blk = raw[i:i + length]
        i += length
        acc = 0
        for b in blk[:-1]:
            acc ^= b
        flag, body = blk[0], blk[1:-1]
        header = None
        if bid == 0x10 and flag == 0 and len(body) == 17:
            header = {
                'type': body[0],
                'typeName': TYPES.get(body[0], str(body[0])),
                'name': body[1:11].decode('latin1'),
                'length': body[11] | (body[12] << 8),
                'param1': body[13] | (body[14] << 8),
                'param2': body[15] | (body[16] << 8),
            }
        out.append({'id': bid, 'offset': offset, 'flag': flag, 'data': body,
                    'raw': blk, 'checksum': blk[-1], 'ok': acc == blk[-1],
                    'header': header, 'pause': pause, 'timing': timing})
    return out


def tzx_blocks(path=TAPE):
    """Jen bloky s daty ($10, $11), v pořadí na kazetě."""
    return [b for b in tzx_all_blocks(path) if b['id'] in (0x10, 0x11)]


def basic_header(path=TAPE):
    """Hlavička programu `T'BIRDS`."""
    return tzx_blocks(path)[0]['header']


def basic_block(path=TAPE):
    """Program `T'BIRDS` i s proměnnými, tak jak ho ROM nahraje na PROG."""
    blocks = tzx_blocks(path)
    assert blocks[0]['header'] and blocks[0]['header']['type'] == 0, blocks[0]
    return blocks[1]['data']


def turbo_block(path=TAPE):
    """Jediný turbo blok: (flag, data bez flagu a součtu, celé bajty z pásky)."""
    t = [b for b in tzx_blocks(path) if b['id'] == 0x11]
    assert len(t) == 1, len(t)
    return t[0]


# --- BASIC ------------------------------------------------------------------

PROG = 23755            # začátek programu v BASICu (bez mikrodrivu)


def basic_program(path=TAPE):
    """Jen program (bez proměnných): délka je param2 hlavičky."""
    return basic_block(path)[:basic_header(path)['param2']]


def basic_vars(path=TAPE):
    """Oblast proměnných za programem; začíná na VARS = PROG + param2."""
    return basic_block(path)[basic_header(path)['param2']:]


def vars_address(path=TAPE):
    return PROG + basic_header(path)['param2']


def peek(mem, addr, n=1):
    return mem[addr - 0x4000:addr - 0x4000 + n]


def word(mem, addr):
    b = peek(mem, addr, 2)
    return b[0] | (b[1] << 8)


# --- turbo blok a obraz paměti ------------------------------------------------
#
# ★ Zavaděč (sources/docs/tape_layout.md) má tři vrstvy:
#
# 1. kód ve VARS se sám dešifruje. Klíč je součet slov `$4000`–`$5BFF`, tedy
#    obrazovky, jak ji nechal BASIC (`CLS`, `*LOADING*` na řádku 21,
#    `POKE 20107,255`). Pak zkopíruje ROM `LD-BYTES` na `$FF00` a upraví ji:
#    časování na 3/4 a **bity od nejnižšího** (`RR L` místo `RL L`), takže
#    skutečný bajt je zrcadlový obraz bajtu, jak ho zapisuje TZX
# 2. upravená rutina nahraje $1C00 B na `$4000` (obrazovka + buffer tiskárny)
#    a vrátí se na `$5B00`, kde je teď obsluha záznamů: dvě slova z pásky
#    (délka, adresa), adresa ≠ 0 → nahrát, adresa = 0 → skok na „délku".
#    Záznamy přepisují i obsluhu samotnou (`$5B1C`) a nakonec celou stránku
#    `$5B00` druhým dešifrovačem
# 3. ten dešifruje `$6B55`–`$FF06` (klíč: ROM + obrazovka od `$5AFF` dolů
#    a IY) a skočí na `ENTRY`
#
# memory_image() **nepouští pásku pulz po pulzu** a nepouští ani ROM: obrazovku
# po BASICu skládá sama (basic_screen), bajty bere přímo z TZX a čtení
# upravenou LD-BYTES dělá sama (_Tape). Kód zavaděče (vrstvy 1–3) nechá běžet
# na CPU SkoolKitu, protože se během nahrávání sám dešifruje a přepisuje.
# Nezávislou kontrolou je simulované nahrání pulz po pulzu přes ROM
# (tools/mksnapshot.sh) — tools/matchimage.py.

LOADER = 0xFF00         # kam vrstva 1 kopíruje upravenou LD-BYTES (vstup)
FIRST_ADDR = 0x4000     # vrstva 2: kam jde začátek proudu
FIRST_LEN = 0x1C00      # obrazovka + buffer tiskárny
HANDLER = 0x5B00        # obsluha záznamů (a pak druhý dešifrovač)
READ = 0xFF70           # vstup do upravené LD-BYTES, kterým čte obsluha
ENTRY = 0xE105          # kam druhý dešifrovač skočí: první instrukce hry

ATTR_UPPER = 0x00       # ★ `PAPER 7{0}`: binárně nula (podvržené číslo)
ATTR_LOWER = 0x07       # ★ řádky 22–23 po `BORDER 0`: BORDCR
LOADING_ROW, LOADING_COL = 21, 11   # ★ `AT 12{21},11`
LOADING_TEXT = [('*', 0x09)] + [(c, 0x0F) for c in 'LOADING'] + [('*', 0x09)]
POKE = (0x4E8B, 0xFF)   # ★ `POKE 23613{20107},0{255}` — bajt v bitmapě

REVERSE = bytes(int('{:08b}'.format(b)[::-1], 2) for b in range(256))


def turbo_stream(path=TAPE):
    """Bajty turbo bloku tak, jak je složí upravená LD-BYTES (bity zrcadlově),
    i s flagem na začátku."""
    return bytes(REVERSE[b] for b in turbo_block(path)['raw'])


def loading_screen(path=TAPE):
    """★ 6912 B obrázku: začátek prvních $1C00 B turbo bloku, které vrstva 2
    nahraje na `$4000`. Samostatný blok SCREEN$ kazeta nemá."""
    return turbo_stream(path)[1:1 + 6912]


def rom48():
    return open(os.path.join(SKOOLKIT, 'skoolkit', 'resources', '48.rom'), 'rb').read()


def screen_address(row, col, line):
    return 0x4000 | ((row & 0x18) << 8) | (line << 8) | ((row & 7) << 5) | col


def basic_screen(rom=None):
    """★ `$4000`–`$5BFF` ve chvíli `RANDOMIZE USR`, složené z BASICu
    `T'BIRDS` bez ROM: `BORDER 0: INK 0: PAPER 0: CLS`, `*LOADING*` ROM fontem
    na řádku 21 od sloupce 11 (hvězdičky `PAPER 1: INK 1`, text `INK 7`),
    `POKE 20107,255`; buffer tiskárny nulový. Shoda s ROM: matchimage.py."""
    rom = rom or rom48()
    m = bytearray(0x1C00)
    for a in range(0x1800, 0x1B00):
        m[a] = ATTR_UPPER
    for a in range(0x1800 + 22 * 32, 0x1B00):
        m[a] = ATTR_LOWER
    for i, (ch, attr) in enumerate(LOADING_TEXT):
        col = LOADING_COL + i
        glyph = 0x3D00 + (ord(ch) - 32) * 8
        for line in range(8):
            m[screen_address(LOADING_ROW, col, line) - 0x4000] = rom[glyph + line]
        m[0x1800 + LOADING_ROW * 32 + col] = attr
    m[POKE[0] - 0x4000] = POKE[1]
    return bytes(m)


def loader_key(screen):
    """★ Klíč vrstvy 1: součet 16bitových slov (vyšší bajt první)
    `$4000`–`$5BFF`, jak ho počítá `$5D84`."""
    h = 0
    for i in range(0, len(screen), 2):
        h = (h + ((screen[i] << 8) | screen[i + 1])) & 0xFFFF
    return h


class _Tape:
    """Čtení bajtů upravenou LD-BYTES: H je průběžná XOR parita."""

    def __init__(self, stream):
        self.stream, self.pos, self.h = stream, 0, 0

    def byte(self):
        if self.pos >= len(self.stream):
            raise EOFError('turbo blok dosel')
        b = self.stream[self.pos]
        self.pos += 1
        self.h ^= b
        return b

    def load(self, mem, ix, de):
        """★ Smyčka `$FF53`–`$FF87`: přečte bajt, a dokud DE ≠ 0, uloží ho na
        IX, IX += 1, DE −= 1 a čte další. Poslední přečtený bajt se neuloží
        a zůstane v L (u slov záznamu je DE = 0, takže se čte jediný)."""
        b = self.byte()
        while de:
            if ix >= 0x4000:
                mem[ix] = b
            ix = (ix + 1) & 0xFFFF
            de -= 1
            b = self.byte()
        return b, ix


def memory_image(path=TAPE, trace=None):
    """64K paměti ve chvíli, kdy zavaděč skočí na `ENTRY`, složené z kazety
    bez pulzů a bez ROM. Vrací (bytes 64K, registry SkoolKitu, _Tape).
    `trace(pozice v proudu, IX, DE, PC, paměť)` se zavolá při každém čtení
    (PC je `LOADER` nebo `READ`)."""
    import sys
    if SKOOLKIT not in sys.path:
        sys.path.insert(0, SKOOLKIT)
    from skoolkit.simulator import Simulator
    from skoolkit.simutils import A, F, H, L, B, C, D, E, IXh, IXl, SP, PC

    rom = rom48()
    tape = _Tape(turbo_stream(path))
    mem = bytearray(65536)
    mem[0:0x4000] = rom
    mem[0x4000:0x5C00] = basic_screen(rom)
    va = vars_address(path)
    prog = basic_block(path)
    mem[PROG:PROG + len(prog)] = prog

    # RANDOMIZE USR: ROM skočí přes RET s BC = adresa a pod zásobníkem
    # zůstane slovo s tou adresou — vrstva 1 si ho bere `DEC SP / DEC SP /
    # POP BC`. Zásobník je ? kdekoli pod RAMTOP; vrstva 1 si ho stejně přenastaví.
    sp = 0x5CF0
    mem[sp - 2], mem[sp - 1] = va & 0xFF, va >> 8
    sim = Simulator(mem, {'SP': sp})
    r = sim.registers
    r[B], r[C] = va >> 8, va & 0xFF
    r[PC] = pc = va
    steps = 0
    while pc != ENTRY:
        if pc in (LOADER, READ):
            ix = (r[IXh] << 8) | r[IXl]
            de = (r[D] << 8) | r[E]
            if trace:
                trace(tape.pos, ix, de, pc, mem)
            sp = r[SP]
            if pc == LOADER:
                # ★ `$FF08 LD HL,$5B00 / PUSH HL`: návrat jde na obsluhu
                sp = (sp - 2) & 0xFFFF
                mem[sp], mem[sp + 1] = HANDLER & 0xFF, HANDLER >> 8
                flag = tape.byte()
                assert flag == r[A] == 0xFF, (flag, r[A])
            last, ix = tape.load(mem, ix, de)
            r[IXh], r[IXl] = ix >> 8, ix & 0xFF
            r[D] = r[E] = 0
            r[L], r[H] = last, tape.h
            # ★ $FF89: LD A,H / CP $01 / RET — CY = parita sedí (H = 0)
            r[A] = tape.h
            r[F] = 0x01 if tape.h == 0 else 0x00
            r[PC] = mem[sp] | (mem[(sp + 1) & 0xFFFF] << 8)
            r[SP] = (sp + 2) & 0xFFFF
        else:
            sim.run()
        pc = r[PC]
        steps += 1
        if steps > 50_000_000:
            raise RuntimeError('zavadec se nedostal na $%04X' % ENTRY)
    return bytes(mem), r, tape


def code_image(path=TAPE):
    """RAM $4000–$FFFF ve chvíli vstupu do hry."""
    return memory_image(path)[0][0x4000:]


# --- disassembly ------------------------------------------------------------

def disassemble(mem, start, end):
    """Řádky `ADDR  bajty  instrukce` z 64K obrazu `mem` (SkoolKit)."""
    import sys
    import types
    if SKOOLKIT not in sys.path:
        sys.path.insert(0, SKOOLKIT)
    from skoolkit.disassembler import Disassembler

    class Instr:
        def __init__(self, address, operation, data):
            self.address, self.operation, self.bytes = address, operation, data
            self.variant = 0

    cfg = types.SimpleNamespace(asm_hex=True, asm_lower=False, defb_size=8,
                                defm_size=66, defw_size=1, handle_rst=False,
                                imaker=Instr, opcodes='', wrap=False)
    out = []
    for i in Disassembler(list(mem), cfg).disassemble(start, end, 'h'):
        out.append('$%04X  %-12s %s' % (i.address, bytes(i.bytes).hex(), i.operation))
    return out
