THUNDERBIRDS
=====================
The 1985 Firebird game, reborn for modern web browsers.

## About
Originally published in 1985 by Firebird Software for the ZX Spectrum, based
on the television series. This will be a faithful remake based on the
original ZX Spectrum version — not an emulator and not a binary copy.

**Status: M3 — the game plays** (2026-10-07). The tape and its
four-layer, twice-encrypted loader are taken apart; the menu sits over the
original's own title picture, composed out of the program; LOAD TAPE plays
the real tape blocks. The original's character engine, its main loop and its
interrupt are ported routine by routine and run in the worker: both
Thunderbirds fly, push and lift blocks, blocks fall, rooms change, enemies
and spiders move, time and fuel run out — and 162 051 passes recorded from
the original replay against the remake with zero differences, screen and
state after every pass. The mission's start and end screens are milestone
M4, the sound M6.

- **LOAD TAPE**: the real tape blocks, loaded byte by byte

- 256×192 + border, integer scaling, `ZXPlatform` + `ZXLayout`
- keyboard, gamepad, touch

## Requirements
- PHP 8.1+
- nginx
- MySQL / MariaDB
- Node.js + terser, for building the bundle (`npm i -g terser`)
- es-check, for the ES2018 gate in `svtool verify` (`npm i -g es-check`)
- Python 3, only for the tools that extract and verify the data of the original

## Running it
Serve the project directory with nginx and PHP (`config/nginx.conf`), copy
`config/config.php.sample` to `config/config.php` with your database
credentials and create the database with `config/createDB.sql`. Without a
bundle in `js/` the application is served straight from `app/`; the bundle
is built with `svtool build bundle`.

The original tape image is copyrighted and is **not** part of this repository —
it is needed only to regenerate the game data, see `sources/README.md`.

## License
See the [LICENSE](LICENSE) file.
