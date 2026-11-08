#!/usr/bin/env python3
"""Loading screen z kazety proti `.scr` a proti obrazovce simulátoru.

    ./tools/mksnapshot.sh && ./tools/matchloading.py

★ Kazeta nemá samostatný blok SCREEN$: obrázek je prvních 6912 B turbo
bloku (bity zrcadlově), které vrstva 2 zavaděče nahraje na `$4000`
(`sources/docs/tape_layout.md`). Kontroluje se:

1. `tblib.loading_screen()` proti `sources/media/screens/loading_screen.scr`
   (bajty)
2. proti videopaměti simulátoru na vstupu do hry `$E105` (bajty) — po
   nahrání celé pásky a po obou dešifrováních je obrázek pořád ten z pásky
3. proti obrazovce simulátoru **po pixelech** v obou fázích FLASH

4. proti `data/loading.json` (bajty), který obrázek nese do prohlížeče
5. obrazovka po BASICu, jak ji `app/tapeLoadingModel.js` kreslí z
   `data/loading.json` `basic` (`*LOADING*` ROM fontem, atributy, `POKE`),
   proti `tblib.basic_screen()` — a ta je proti ROM doložená v
   `matchimage.py`
"""
import base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tblib as L   # noqa: E402
sys.path.insert(0, os.path.join(L.ROOT, 'app', 'svision', 'tools', 'retro'))
from scr2png import scr_to_rgb   # noqa: E402


def compare(name, a, b):
    d = [i for i in range(len(a)) if a[i] != b[i]]
    print('%-46s %6d kontrol, %d rozdilu' % (name, len(a), len(d)))
    return len(a), len(d)


def main():
    scr_path = os.path.join(L.ROOT, 'sources', 'media', 'screens', 'loading_screen.scr')
    sim_path = os.path.join(L.ROOT, 'build', 'thunderbirds.bin')
    if not os.path.isfile(sim_path):
        sys.exit('chybi build/thunderbirds.bin - spust tools/mksnapshot.sh')
    tape = L.loading_screen()
    scr = open(scr_path, 'rb').read()
    sim = open(sim_path, 'rb').read()[:6912]
    total = [0, 0]
    data = json.load(open(os.path.join(L.ROOT, 'data', 'loading.json')))
    js = base64.b64decode(data['videoRAM'])
    basic = bytearray(0x1C00)
    for a in range(0x1800 + 22 * 32, 0x1B00):
        basic[a] = 0x07
    b = data['basic']
    for c in b['cells']:
        for line in range(8):
            basic[L.screen_address(b['row'], c['col'], line) - 0x4000] = c['glyph'][line]
        basic[0x1800 + b['row'] * 32 + c['col']] = c['attr']
    basic[b['poke']['address'] - 0x4000] = b['poke']['value']
    for name, a, b in (
            ('kazeta : loading_screen.scr (bajty)', tape, scr),
            ('kazeta : videopamet simulatoru (bajty)', tape, sim),
            ('kazeta : data/loading.json (bajty)', tape, js),
            ('obrazovka po BASICu: loading.json : tblib', bytes(basic), L.basic_screen())):
        n, d = compare(name, a, b)
        total[0] += n
        total[1] += d
    for phase in (0, 1):
        # tri barevné složky jsou ve stejném bodu spolu; porovnává se celý bod
        a = [bytes(r) for r in scr_to_rgb(tape, phase)]
        b = [bytes(r) for r in scr_to_rgb(sim, phase)]
        pa = [a[y][x * 3:x * 3 + 3] for y in range(192) for x in range(256)]
        pb = [b[y][x * 3:x * 3 + 3] for y in range(192) for x in range(256)]
        n, d = compare('kazeta : obrazovka simulatoru, FLASH %d (body)' % phase, pa, pb)
        total[0] += n
        total[1] += d
    print('\nCELKEM: %d kontrol, %d rozdilu' % tuple(total))
    return 1 if total[1] else 0


if __name__ == '__main__':
    sys.exit(main())
