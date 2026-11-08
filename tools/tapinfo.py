#!/usr/bin/env python3
"""Rozebere kazetu (TZX) blok po bloku a vypíše, co na ní je.

    ./tools/tapinfo.py [--basic] [--records] [--loader]

Výstup téhle věci je zapsaný v `sources/docs/tape_layout.md`.

- `--basic` vypíše zavaděč v BASICu **i se skutečnými binárními hodnotami
  čísel**: text ukazuje jiná čísla, než jaká ZX BASIC opravdu počítá
  (`PAPER 7` je `PAPER 0`, `POKE 23613,0` je `POKE 20107,255`)
- `--records` vypíše záznamy turbo bloku tak, jak je čte obsluha na `$5B00`
  (pozice v proudu, adresa, délka)
- `--loader` vypíše disassembly všech vrstev zavaděče **po dešifrování**:
  vrstvu 1 ve VARS, upravenou LD-BYTES na `$FF00`, každou podobu obsluhy na
  `$5B00` a druhý dešifrovač

Basic lister je opsaný z `booty/tools/tapinfo.py`; ? patří do
`svision/tools/retro/` (R-008), až ho bude chtít třetí projekt.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tblib as L   # noqa: E402

# tokeny ZX BASICu od $A5 výš
TOKENS = ('RND INKEY$ PI FN POINT SCREEN$ ATTR AT TAB VAL$ CODE VAL LEN SIN COS TAN '
          'ASN ACS ATN LN EXP INT SQR SGN ABS PEEK IN USR STR$ CHR$ NOT BIN OR AND '
          '<= >= <> LINE THEN TO STEP DEF-FN CAT FORMAT MOVE ERASE OPEN# CLOSE# MERGE '
          'VERIFY BEEP CIRCLE INK PAPER FLASH BRIGHT INVERSE OVER OUT LPRINT LLIST '
          'STOP READ DATA RESTORE NEW BORDER CONTINUE DIM REM FOR GO-TO GO-SUB INPUT '
          'LOAD LIST LET PAUSE NEXT POKE PRINT PLOT RUN SAVE RANDOMIZE IF CLS DRAW '
          'CLEAR RETURN COPY').split()


def number(b):
    """Pětibajtové číslo ZX BASICu (jen celá čísla v krátkém tvaru)."""
    if b[0] == 0:
        v = b[2] | (b[3] << 8)
        return -((v ^ 0xFFFF) + 1) if b[1] == 0xFF else v
    return '<float %s>' % b.hex()


def basic_listing(data):
    """Řádky programu; za každým číslem v `{}` jeho binární hodnota, liší-li se."""
    out, i = [], 0
    while i + 4 <= len(data):
        line = (data[i] << 8) | data[i + 1]
        ln = data[i + 2] | (data[i + 3] << 8)
        i += 4
        body, i = data[i:i + ln], i + ln
        text, j, digits = [], 0, ''
        while j < len(body):
            c = body[j]
            if c == 0x0E:          # binární podoba čísla
                v = number(body[j + 1:j + 6])
                if digits and str(v) != digits:
                    text.append('{=%s}' % v)
                digits = ''
                j += 6
                continue
            if c == 0x0D:
                break
            if chr(c) in '0123456789.' and c < 127:
                digits += chr(c)
            else:
                digits = ''
            if c >= 0xA5:
                text.append(' %s ' % TOKENS[c - 0xA5].replace('-', ' '))
            elif c == 0x10:
                text.append('<INK %d>' % body[j + 1]); j += 1
            elif c == 0x11:
                text.append('<PAPER %d>' % body[j + 1]); j += 1
            elif c == 0x12:
                text.append('<FLASH %d>' % body[j + 1]); j += 1
            elif c == 0x13:
                text.append('<BRIGHT %d>' % body[j + 1]); j += 1
            elif 32 <= c < 127:
                text.append(chr(c))
            else:
                text.append('[%02X]' % c)
            j += 1
        out.append('%5d %s' % (line, ''.join(text)))
        if line >= 0x4000:          # za řádkem nad 16383 už BASIC nic nečte
            break
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--basic', action='store_true', help='vypsat i zavaděč v BASICu')
    ap.add_argument('--records', action='store_true', help='záznamy turbo bloku')
    ap.add_argument('--loader', action='store_true', help='disassembly vrstev zavaděče')
    ap.add_argument('tape', nargs='?', default=L.TAPE)
    args = ap.parse_args()

    info = L.tzx_archive_info(args.tape)
    blocks = L.tzx_all_blocks(args.tape)
    print('%s: TZX %d.%d, %d bloků'
          % (os.path.basename(args.tape), *L.tzx_version(args.tape), len(blocks)))
    for n, b in enumerate(blocks, 1):
        if b['id'] == 0x32:
            print('  %d. ID $32 archivní info: %s' % (
                n, '; '.join('%s=%s' % kv for kv in b['info'].items())))
            continue
        kind = 'hlavička' if b['flag'] == 0 else 'data    '
        line = '  %d. ID $%02X %s %5d B  flag $%02X  součet XOR %s  pauza %4d ms' % (
            n, b['id'], kind, len(b['data']), b['flag'],
            'OK' if b['ok'] else 'nesedí', b['pause'])
        hdr = b['header']
        if hdr:
            line += "   %-8s '%s'  %5d B" % (hdr['typeName'], hdr['name'], hdr['length'])
            if hdr['type'] == 0:
                line += '  (autostart %d, program %d B, VARS $%04X)' % (
                    hdr['param1'], hdr['param2'], L.PROG + hdr['param2'])
        t = b['timing']
        if t:
            line += ('\n       TURBO pilot %d×%d T, sync %d/%d T, bit 0 = %d T, bit 1 = %d T,'
                     ' poslední bajt %d bitů' % (t['pilotPulses'], t['pilot'], t['sync1'],
                                                 t['sync2'], t['zero'], t['one'], t['lastBits']))
        print(line)

    if args.basic:
        print('\nzavaděč v BASICu (VARS = $%04X, za programem %d B strojového kódu):'
              % (L.vars_address(args.tape), len(L.basic_vars(args.tape))))
        for l in basic_listing(L.basic_program(args.tape)):
            print('  ' + l)

    reads = []
    snaps = {}

    def trace(pos, ix, de, pc, mem):
        reads.append((pos, ix, de, pc))
        if pc == L.LOADER:
            snaps['vars'] = bytes(mem)
        # každá podoba obsluhy na $5B00, když se z ní čte délka záznamu
        page = bytes(mem[L.HANDLER:L.HANDLER + 0x30])
        if de == 0 and page not in snaps.setdefault('handlers', []):
            snaps['handlers'].append(page)

    mem, regs, tape = L.memory_image(args.tape, trace)
    stream = L.turbo_stream(args.tape)
    print('\nturbo blok: %d B s flagem, přečteno %d B, parita H = %d, zbývá %d B, vstup $%04X'
          % (len(stream), tape.pos, tape.h, len(stream) - tape.pos, L.ENTRY))

    if args.records:
        print('\nzáznamy (pozice = bajt proudu, flag je 0, kde začínají data):')
        for pos, ix, de, pc in reads:
            if de:
                print('  @%5d  $%04X–$%04X  %5d B%s' % (
                    pos + 1 if pc == L.LOADER else pos, ix, (ix + de - 1) & 0xFFFF, de,
                    '   (vrstva 2, LD-BYTES z $FF00)' if pc == L.LOADER else ''))

    if args.loader:
        va = L.vars_address(args.tape)
        vmem = snaps['vars']
        print('\nvrstva 1 ve VARS po dešifrování (klíč $%04X):'
              % L.loader_key(L.basic_screen()))
        for l in L.disassemble(vmem, va, va + 0x80):
            print('  ' + l)
        print('\nupravená LD-BYTES na $FF00:')
        for l in L.disassemble(vmem, 0xFF00, 0xFFAF):
            print('  ' + l)
        for n, page in enumerate(snaps['handlers'], 1):
            m = bytearray(65536)
            m[L.HANDLER:L.HANDLER + len(page)] = page
            print('\nobsluha na $5B00, podoba %d:' % n)
            for l in L.disassemble(m, L.HANDLER, L.HANDLER + 0x25):
                print('  ' + l)
        # poslední záznam na $5B00 je druhý dešifrovač: v paměti ho po sobě
        # sám smaže (LDIR $C9), takže se bere z proudu
        pos, ix, de, pc = [x for x in reads if x[2] and x[1] == L.HANDLER][-1]
        m = bytearray(65536)
        m[L.HANDLER:L.HANDLER + de] = stream[pos:pos + de]
        print('\ndruhý dešifrovač (poslední záznam, %d B na $5B00, z proudu @%d):' % (de, pos))
        for l in L.disassemble(m, L.HANDLER, L.HANDLER + de):
            print('  ' + l)


if __name__ == '__main__':
    main()
