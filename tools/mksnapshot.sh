#!/bin/sh
# Z kazety udělá snapshot a obraz RAM ve chvíli, kdy zavaděč skočí do hry
# ($E105, sources/docs/tape_layout.md): po nahrání celého turbo bloku a po
# dešifrování kódu, těsně před první instrukcí hry. Potřebuje
# sources/tape/Thunderbirds (Firebird).tzx (mimo git, viz sources/tape/README.md)
# a SkoolKit ve svision (R-008).
#
# Simulované nahrání v tap2sna.py doopravdy provede BASIC, oba šifrované
# zavaděče i upravenou kopii LD-BYTES na $FF00, pulz po pulzu. Je to tedy
# nezávislá kontrola toho, co z kazety skládá tools/tblib.py bez pulzů —
# porovná je tools/matchimage.py.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SK=$(cd "$ROOT/tools" && python3 -c 'import tblib; print(tblib.SKOOLKIT)')
TAPE="$ROOT/sources/tape/Thunderbirds (Firebird).tzx"
mkdir -p "$ROOT/build"
[ -f "$TAPE" ] || { echo "chybi $TAPE - viz sources/tape/README.md"; exit 1; }
PYTHONPATH="$SK" python3 "$SK/skoolkit-10.1.data/scripts/tap2sna.py" \
    -c finish-tape=1 --start 0xE105 "$TAPE" "$ROOT/build/thunderbirds.z80" \
    | grep -v '^\[' || true
# a totéž zastavené na RANDOMIZE USR do VARS ($5D72): obrazovka po BASICu,
# ze které si vrstva 1 počítá klíč
PYTHONPATH="$SK" python3 "$SK/skoolkit-10.1.data/scripts/tap2sna.py" \
    --start 0x5D72 "$TAPE" "$ROOT/build/atvars.z80" | grep -v '^\[' || true
PYTHONPATH="$SK" python3 - "$ROOT" <<'PY'
import sys
from skoolkit.snapshot import Snapshot
root = sys.argv[1]
for name in ('thunderbirds', 'atvars'):
    snap = Snapshot.get(root + '/build/%s.z80' % name)
    ram = bytes(snap.ram(-1))
    open(root + '/build/%s.bin' % name, 'wb').write(ram)
    print('build/%s.bin: RAM $4000-$FFFF, %d B' % (name, len(ram)))
PY
