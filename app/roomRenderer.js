// classic script (importScripts): no import, no export — R-001, R-048.
// Needs ZXRomDraw (svision zxRomDraw.js) loaded before it.
// begin code

/**
 * The room engine of Thunderbirds: entering a room — `$C991` — the way the
 * original does it, routine for routine (sources/docs/maze.md).
 *
 * ★ The original is a **character engine**. A room is printed by its own
 * routines into the video memory and, cell for cell, into a **shadow map**
 * at `$5EF6` (25 × 32 codes, the attributes $320 further on) that the game
 * tests the craft against. Sprites are drawn the same way: `$FAA1` shifts
 * the craft's graphics into a character set of its own in RAM (`$5D6E`) and
 * prints those characters with CHARS pointed at it. So this port keeps the
 * state **at the original's addresses** — a 64 K array `mem` holding the
 * tables of data/maze.json and the variables of data/global.json — and every
 * routine below reads and writes exactly what its Z80 original does — the
 * video memory ($4000-$5AFF) included, as on the machine.
 *
 * It covers the ordinary rooms (layouts 1-29, dark ones included) and the
 * special ones (30-34, `$D3A9`: the caves, the spider room, the red room),
 * which print out of little streams of codes (`$CF9E`), swap part of a
 * character set in and out (`$D201`) and draw the threads of the spiders
 * with the ROM's DRAW-LINE (svision ZXRomDraw). ? What the special rooms do
 * when the equipment is used there (TB2 with the right item: colour cycles,
 * crumbling rock) is M4/M5 — this port throws rather than guess it.
 *
 * Checked against the original's own drawing of every ordinary room —
 * screen, shadow map and SEED after — by tools/matchmaze.mjs. Free of DOM
 * dependencies (R-001).
 *
 * ★ **A classic script, not a module** (M3): the game's logic runs in the
 * worker (app/thunderbirdsLogic.js extends this class), and a classic worker
 * takes no `import`. The worker loads it with importScripts(), Node tools
 * with svision tools/classicScript.cjs.
 */

// ★ addresses (sources/docs/maze.md, sources/asm/thunderbirds.skool)
const CHARS = 0x5C36;       // ROM CHARS: glyph of code n at CHARS + 8n
const DF_CC = 0x5C84;       // print position in the bitmap
const S_POSN = 0x5C88;      // C (column, 33 - col), B (line, 24 - row)
const ATTR_T = 0x5C8F;
// ★ ROM P_FLAG, which the game's own printing uses as a mask for ATTR_T
// ($F8D2) and ROM PLOT as its OVER / INVERSE flags
const P_FLAG = 0x5C91;
const SEED = 0x5C76;
const SHADOW = 0x5EF6;      // shadow map, 25 × 32 codes; attributes +$320
const SHADOW_INDEX = 0x653E;
const WINDOW = 0x6536;      // clip window: top B, bottom B, left C, right C
const ROOM = 0x6561;
const ROOM_RECORD = 0x6568;
const ACTIVE_CRAFT = 0x656D;
const ROOMS = 0x7F9A;       // 13 bytes a room
const LAYOUTS = 0x6FD8;     // 80 bytes a layout
const OBJECTS = 0x8F83;
const SHAPES = 0x8490;
const BLOCK_LISTS = 0x667B;
const BLOCKS = 0x6573;      // records of 14 bytes
const ENEMY_STARTS = 0xDEB9;
const ENEMIES = 0x5D14;     // records of 15 bytes
const ENEMY_COUNT = 0x5D64;
const CRAFT_1 = 0x5CCC;     // Thunderbird 1
const CRAFT_2 = 0x5CDC;     // Thunderbird 2
const SPRITE_A = 0x5D6E;    // the shifted sprite characters ($FAA1)
const SPRITE_CHARS = 0x5C66;

class RoomRenderer {

  /**
   * @param {Object} maze - The parsed data/maze.json.
   * @param {Object} global - The parsed data/global.json.
   */
  constructor(maze, global) {
    if (!maze || !maze.regions || !global || !global.regions) {
      throw new Error('game data missing (data/maze.json, data/global.json)');
    }
    this.maze = maze;
    this.global = global;
    this.mem = new Uint8Array(65536);
    this.rom = new ZXRomDraw({rd: (a) => this.rd(a), wr: (a, v) => this.wr(a, v)});
    this.reset();
  } // constructor

  /** Puts the tables and the mission's state back into `mem`. */
  reset() {
    this.mem.fill(0);
    [this.maze, this.global].forEach((data) => {
      Object.keys(data.regions).forEach((name) => {
        var region = data.regions[name];
        this.mem.set(RoomRenderer.decode(region.bytes), region.address);
      });
    });
  } // reset

  /**
   * The bytes of a data region (base64, as tools/dumpmaze.py writes them).
   * @param {string} data - Base64.
   * @returns {Uint8Array}
   */
  static decode(data) {
    var binary = atob(data);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } // decode

  // --- memory: 64 K, the video memory at $4000 as on the machine -----------

  rd(address) {
    return this.mem[address & 0xFFFF];
  } // rd

  wr(address, value) {
    address &= 0xFFFF;
    if (address < 0x4000) {
      return;                         // ROM
    }
    this.mem[address] = value & 0xFF;
  } // wr

  /** The video memory, 6912 bytes ($4000-$5AFF). */
  screen() {
    return this.mem.subarray(0x4000, 0x5B00);
  } // screen

  /**
   * A point where the original's main program touches state it shares with
   * its interrupt (SEED, the flags of the sounds, the second's flag). The
   * room engine alone has no interrupt; app/thunderbirdsLogic.js runs it here.
   */
  event() {
  } // event

  word(address) {
    return this.rd(address) | (this.rd(address+1) << 8);
  } // word

  setWord(address, value) {
    this.wr(address, value & 0xFF);
    this.wr(address+1, (value >> 8) & 0xFF);
  } // setWord

  // --- the original's own primitives (the jump table at $F424) -------------

  /**
   * ★ `$F8BC` (`$F451`): the generator, state SEED. Returns B.
   * @returns {number}
   */
  rand() {
    this.event();                       // $F8BD LD BC,($5C76)
    var c = this.mem[SEED], b = this.mem[SEED+1];
    b = (b+c) & 0xFF;
    var sum = c+0xCD;
    c = sum & 0xFF;
    b = (0xAB+b+(sum > 0xFF ? 1 : 0)) & 0xFF;
    this.event();                       // $F8CC LD ($5C76),BC
    this.mem[SEED] = c;
    this.mem[SEED+1] = b;
    return b;
  } // rand

  /**
   * ★ `$F898` (`$F44B`): print position B (line, 24 - row), C (33 - col):
   * DF_CC = the word at $FF02 + 2B, less C. The table at $FF04 is what
   * `$F862` builds through ROM CL-SET at the start — column 0 of each line
   * plus 33 — and for a B out of 1-24 the original reads whatever lies
   * there; so does this (data/global.json `lines`; ROM reads as 0).
   * @param {number} b - Line.
   * @param {number} c - Column count.
   */
  setPos(b, c) {
    this.wr(S_POSN, c);
    this.wr(S_POSN+1, b);
    var entry = (0xFF02+2*(b & 0xFF)) & 0xFFFF;
    if (entry < 0x4000 || entry === 0xFFFF) {
      // the table read runs into the ROM: only a room left in a broken
      // state gets here (tools/matchmaze.mjs lists them)
      this.readsRom = true;
    }
    this.setWord(DF_CC, (this.word(entry)-c) & 0xFFFF);
  } // setPos

  /**
   * ★ `$F8D2` (`$F454`): prints code A — eight bytes from CHARS + 8A to
   * DF_CC, DF_CC + 1, S_POSN C - 1, and the attribute ATTR_T (or under
   * MASK_T).
   * @param {number} a - The code.
   */
  printChar(a) {
    var glyph = (this.word(CHARS)+8*(a & 0xFF)) & 0xFFFF;
    var de = this.word(DF_CC);
    this.setWord(DF_CC, (de+1) & 0xFFFF);
    for (var line = 0; line < 8; line++) {
      this.wr(de+(line << 8), this.rd(glyph+line));
    }
    this.wr(S_POSN, this.rd(S_POSN)-1);
    var h = ((de >> 8)+7) & 0xFF;
    var attribute = (((h >> 3) & 3) | 0x58) << 8 | (de & 0xFF);
    var mask = this.mem[P_FLAG];
    if (mask === 0) {
      this.wr(attribute, this.mem[ATTR_T]);
    } else {
      this.wr(attribute, (mask & this.rd(attribute)) | (~mask & this.mem[ATTR_T]));
    }
  } // printChar

  /**
   * ★ `$F972` (`$F45A`): the shadow index of B, C — row × 32 + col — into
   * `$653E`.
   * @returns {number} The index.
   */
  shadowIndex(b, c) {
    var row = (0x18-b) & 0xFF;
    var index = (row*32+((0x21-c) & 0xFF)) & 0xFFFF;
    this.setWord(SHADOW_INDEX, index);
    return index;
  } // shadowIndex

  /**
   * ★ `$F98E` (`$F460`): writes code A and ATTR_T into the shadow map at
   * the next index (pre-increment of `$653E` from `$5EF5`).
   * @param {number} a - The code.
   */
  shadowWrite(a) {
    var index = (this.word(SHADOW_INDEX)+1) & 0xFFFF;
    this.setWord(SHADOW_INDEX, index);
    this.wr(SHADOW-1+index, a);
    this.wr(SHADOW-1+index+0x320, this.mem[ATTR_T]);
  } // shadowWrite

  /**
   * ★ `$FA1B` (`$F466`): prints a block of consecutive codes from A, D rows
   * × E columns at B, C, inside the clip window `$6536`.
   */
  printBlock(a, b, c, d, e) {
    var l = (a-1) & 0xFF;
    var width = e;
    var w = this.mem;
    w[0x6543] = e;                      // LD ($6543),A
    for (;;) {
      e = width;
      while (w[WINDOW] < b) {           // rows above the window
        l = (width+l) & 0xFF;
        d = (d-1) & 0xFF;
        if (d === 0) {
          return;
        }
        b = (b-1) & 0xFF;
      }
      if (w[WINDOW+1] >= b) {
        return;
      }
      if (w[WINDOW+3] >= c) {
        return;
      }
      var savedB = b, savedC = c;
      var done = false;
      if (w[WINDOW+2] < c) {            // columns left of the window
        for (;;) {
          l = (l+1) & 0xFF;
          e = (e-1) & 0xFF;
          if (e === 0) {
            done = true;
            break;
          }
          c = (c-1) & 0xFF;
          if (!(w[WINDOW+2] < c)) {
            break;
          }
        }
      }
      if (!done) {
        for (;;) {
          this.setPos(b, c);
          l = (l+1) & 0xFF;
          this.printChar(l);
          c = (c-1) & 0xFF;
          if (w[WINDOW+3] >= c) {
            e = (e-1) & 0xFF;
            if (e !== 0) {
              l = (l+e) & 0xFF;
            }
            break;
          }
          e = (e-1) & 0xFF;
          if (e === 0) {
            break;
          }
        }
      }
      b = savedB;
      c = savedC;
      d = (d-1) & 0xFF;
      if (d === 0) {
        return;
      }
      b = (b-1) & 0xFF;
    }
  } // printBlock

  /**
   * ★ `$F92A` (`$F457`): writes code L into the shadow map over D rows × E
   * columns at B, C, inside the clip window (no pixels).
   */
  shadowBlock(l, b, c, d, e) {
    var width = e;
    var w = this.mem;
    w[0x6543] = e;                      // LD ($6543),A
    for (;;) {
      e = width;
      if (w[WINDOW] < b) {
        for (;;) {
          d = (d-1) & 0xFF;
          if (d === 0) {
            return;
          }
          b = (b-1) & 0xFF;
          if (w[WINDOW] === b) {
            break;
          }
        }
      }
      if (w[WINDOW+1] >= b) {
        return;
      }
      if (w[WINDOW+3] >= c) {
        return;
      }
      var savedB = b, savedC = c;
      var skip = false;
      if (w[WINDOW+2] < c) {
        for (;;) {
          e = (e-1) & 0xFF;
          if (e === 0) {
            skip = true;
            break;
          }
          c = (c-1) & 0xFF;
          if (!(w[WINDOW+2] < c)) {
            break;
          }
        }
      }
      if (!skip) {
        for (;;) {
          this.shadowIndex(b, c);
          this.shadowWrite(l);
          c = (c-1) & 0xFF;
          if (w[WINDOW+3] >= c) {
            break;
          }
          e = (e-1) & 0xFF;
          if (e === 0) {
            break;
          }
        }
      }
      b = savedB;
      c = savedC;
      d = (d-1) & 0xFF;
      if (d === 0) {
        return;
      }
      b = (b-1) & 0xFF;
    }
  } // shadowBlock

  // --- entering a room ($C991) ---------------------------------------------

  /**
   * ★ Enters room `number` and draws it, as `$C991` does.
   * @param {number} number - The room, 1-97.
   * @returns {boolean} False for a room this port does not draw yet.
   */
  enterRoom(number) {
    this.readsRom = false;
    var m = this.mem;
    m[ROOM] = number;
    this.setWord(CHARS, 0x89BB);
    m[0x662F] = 0xFF;
    m[0x65F3] = 0xFF;
    m[P_FLAG] = 0;
    m[ENEMY_COUNT] = 0;
    for (var i = 0; i < 10; i++) {
      m[0x65E9+i] = 0;
    }
    var ix = ROOMS+13*(number-1);
    this.setWord(ROOM_RECORD, ix);
    if (m[0x5D11]) {
      return false;                     // ? $CBCC: the title's demo, M5
    }
    var layout = m[ix+5];
    if (layout >= 0x1E) {
      this.specialRoom(ix, layout);
      return true;
    }
    m[ATTR_T] = 0x06;
    if (layout === 0) {
      // ★ $CB24: no room here — the next number ($62 wraps round to 1),
      // through $C95A, which saves the blocks first
      var next = (number+1) & 0xFF;
      if (next === 0x62) {
        next = 1;
      }
      this.saveBlocks();
      var readsRom = this.readsRom;
      var drawn = this.enterRoom(next);
      this.readsRom = this.readsRom || readsRom;
      return drawn;
    }
    var hl = LAYOUTS+80*(layout-1);
    if (m[ix+6]) {
      this.drawWallsMirrored(hl);
    } else {
      this.drawWalls(hl);
    }
    var flags = m[ix+0];
    if (flags & 1) {
      this.edgeLeft();
    }
    if (flags & 2) {
      this.edgeRight();
    }
    this.drawObjects(ix);
    this.populate(ix);
    return true;
  } // enterRoom

  /**
   * ★ `$C95A`: leaving a room — the places of its blocks (records at $6573)
   * written back into the room's list at $667B, so that a block pushed stays
   * where it was pushed. Not in the title's demo (`$5D11`).
   */
  saveBlocks() {
    var m = this.mem;
    if (m[0x5D11]) {
      return;
    }
    var hl = this.blockList(m[ROOM]);
    for (var ix = BLOCKS; this.rd(ix) !== 0xFF; ix = (ix+14) & 0xFFFF) {
      this.wr(hl+1, this.rd(ix));
      this.wr(hl+2, this.rd(ix+1));
      hl = (hl+4) & 0xFFFF;
    }
  } // saveBlocks

  /**
   * ★ `$CE8E`: the block list of a room in $667B — records of 4 bytes (shape,
   * C, B, attribute), each list ended by $FF.
   * @param {number} room - The room.
   * @returns {number} The address of its first record.
   */
  blockList(room) {
    var hl = BLOCK_LISTS;
    for (var skip = (room-1) & 0xFF; skip > 0; skip--) {
      for (var steps = 0; this.rd(hl) !== 0xFF; steps++) {
        if (steps > 0x4000) {
          // ★ only a list broken by a layout-0 room's $C95A gets here: the
          // original walks on through its code and the ROM until it finds
          // an $FF, which are not in the remake's data
          throw new Error('roomRenderer: poškozený seznam bloků běží mimo data');
        }
        hl = (hl+4) & 0xFFFF;
      }
      hl = (hl+1) & 0xFFFF;
    }
    return hl;
  } // blockList

  /**
   * ★ `$CDD0`: the walls. 20 lines from B = $18, 4 bytes × 8 bits a line,
   * bit 7 first: a wall is code $21 + (rand AND 7) — eight looks of the
   * same stone — and an empty cell $20; every cell into the shadow map and
   * onto the screen. Then `$D215` makes every wall $21 in the shadow map.
   * @param {number} hl - The layout.
   */
  drawWalls(hl) {
    for (var b = 0x18; b !== 4; b--) {
      this.shadowIndex(b, 0x21);
      this.setPos(b, 0x21);
      for (var k = 0; k < 4; k++) {
        var c = this.mem[hl++];
        for (var bit = 0; bit < 8; bit++) {
          var wall = c & 0x80;
          c = (c << 1) & 0xFF;
          var a = wall ? 0x21+(this.rand() & 7) : 0x20;
          this.shadowWrite(a);
          this.printChar(a);
        }
      }
    }
    this.normalizeShadow();
  } // drawWalls

  /**
   * ★ `$CE2B`: the walls mirrored left to right — the bytes of a line from
   * the last, the bits from bit 0.
   * @param {number} hl - The layout.
   */
  drawWallsMirrored(hl) {
    for (var b = 0x18; b !== 4; b--) {
      var p = hl+3;
      this.shadowIndex(b, 0x21);
      this.setPos(b, 0x21);
      for (var k = 0; k < 4; k++) {
        var c = this.mem[p--];
        for (var bit = 0; bit < 8; bit++) {
          var wall = c & 1;
          c >>= 1;
          var a = wall ? 0x21+(this.rand() & 7) : 0x20;
          this.shadowWrite(a);
          this.printChar(a);
        }
      }
      hl += 4;
    }
    this.normalizeShadow();
  } // drawWallsMirrored

  /** ★ `$D215`: every code but $20 in the first 640 cells becomes $21. */
  normalizeShadow() {
    for (var i = 0; i < 0x280; i++) {
      if (this.mem[SHADOW+i] !== 0x20) {
        this.mem[SHADOW+i] = 0x21;
      }
    }
  } // normalizeShadow

  /** ★ `$CE14`: row 0 cyan ($2D) on the screen and in the shadow map. */
  edgeTop() {
    for (var i = 0; i < 32; i++) {
      this.wr(0x5800+i, 0x2D);
      this.wr(0x6216+i, 0x2D);
    }
  } // edgeTop

  /** ★ `$CE08`: 20 cells down a column, $2D. */
  edgeColumn(hl) {
    for (var i = 0; i < 0x14; i++) {
      this.wr(hl, 0x2D);
      hl += 0x20;
    }
  } // edgeColumn

  /** ★ `$C94B` (flag bit 0): row 0 and column 0. */
  edgeLeft() {
    this.edgeTop();
    this.edgeColumn(0x5800);
    this.edgeColumn(0x6216);
  } // edgeLeft

  /** ★ `$C93C` (flag bit 1): row 0 and column 31. */
  edgeRight() {
    this.edgeTop();
    this.edgeColumn(0x581F);
    this.edgeColumn(0x6235);
  } // edgeRight

  /**
   * ★ `$CA2C`: the objects of the layout — urns, statues, the Greek-key
   * band… — printed as blocks of codes (screen only), mirrored with the
   * room; layout $1A first has its stone block of $81 (once, `$5CEC`).
   * @param {number} ix - The room record.
   */
  drawObjects(ix) {
    var m = this.mem;
    if (m[ix+5] === 0x1A && m[0x5CEC] === 0) {
      m[ATTR_T] = 0x03;
      var b = 0x0E, d = 3;
      do {
        var e = 8, c = 0x1C;
        do {
          this.setPos(b, c);
          this.shadowIndex(b, c);
          this.shadowWrite(0x81);
          this.printChar(0x81);
          c--;
          e--;
        } while (e);
        b--;
        d--;
      } while (d);
      m[0x5CEC] = 1;
      var index = this.shadowIndex(0x0C, 0x14);
      m[SHADOW+index] = 0xFF;
      m[SHADOW+index+1] = 0xFF;
      this.setPos(0x0C, 0x14);
      var chars = this.word(CHARS);
      this.setWord(CHARS, 0x79C9);
      m[ATTR_T] = 0x07;
      this.printChar(0x90);
      this.printChar(0x90);
      this.setWord(CHARS, chars);
    }
    m[ATTR_T] = 0x06;
    var hl = OBJECTS;
    for (var skip = m[ix+5]-1; skip > 0;) {
      if (m[hl] === 0xFF) {
        hl++;
        skip--;
      } else {
        hl += 4;
      }
    }
    while (m[hl] !== 0xFF) {
      var c2 = m[hl], b2 = m[hl+1];
      var d2 = m[hl+2] & 0x0F, e2 = m[hl+2] >> 4;
      if (m[ix+6]) {
        c2 = (0x23-c2+e2-1) & 0xFF;
      }
      this.printBlock(m[hl+3], b2, c2, d2, e2);
      hl += 4;
    }
  } // drawObjects

  /**
   * ★ `$CB32` onwards: what lives in the room — the scatter of `$CCA9`, the
   * stone blocks of the room's list, the craft, the craft's icon on the
   * panel and the darkness.
   * @param {number} ix - The room record.
   */
  populate(ix) {
    var m = this.mem;
    if (m[ix+7] === 1) {
      this.scatter(ix);
    }
    // ★ $CB3A: the blocks of the room ($667B), records of 14 bytes at $6573
    var list = this.blockList(m[ROOM]);
    var block = BLOCKS;
    for (var steps = 0; this.rd(list) !== 0xFF; steps++) {
      if (steps > 0x4000) {
        throw new Error('roomRenderer: poškozený seznam bloků běží mimo data');
      }
      var shape = (SHAPES+8*this.rd(list)) & 0xFFFF;
      this.blockRecord(block, this.rd(list+1), this.rd(list+2), shape, this.rd(list+3), this.rd(list+3));
      list = (list+4) & 0xFFFF;
      block = (block+14) & 0xFFFF;
    }
    this.wr(block, 0xFF);
    this.finish();
  } // populate

  /**
   * ★ `$CB65` onwards, shared by every room (the special ones come in at
   * `$D671` → `$CB62` with no blocks): the blocks drawn, the craft, the
   * craft's icon on the panel, and the darkness.
   */
  finish() {
    var m = this.mem;
    for (var number = 1, at = BLOCKS; this.rd(at) !== 0xFF; number = (number+1) & 0xFF, at = (at+14) & 0xFFFF) {
      this.drawBlock(at, number);
    }
    this.setWord(CHARS, 0x89BB);
    this.drawCraft(CRAFT_1);
    this.drawCraft(CRAFT_2);
    m[WINDOW+1] = 0;
    if (this.word(ACTIVE_CRAFT) === CRAFT_1) {
      this.craftIcon(0x05, 0x57);
    } else {
      this.craftIcon(0x04, 0x61);
    }
    m[WINDOW+1] = 4;
    var room = this.word(ROOM_RECORD);
    if ((m[room+7] & m[room+6]) && m[room+5] < 0x1E) {
      // ★ $CBBE: the lights go out — the walls in every colour from 7 down,
      // a hundred times, and black last
      for (var b = 100; b > 0; b--) {
        this.wallAttributes((b-1) & 7);
      }
    }
  } // finish

  /** ★ `$CC3A`: attribute A on every wall ($21 in the shadow map). */
  wallAttributes(a) {
    for (var i = 0; i < 0x280; i++) {
      if (this.mem[SHADOW+i] === 0x21) {
        this.wr(0x5800+i, a);
      }
    }
  } // wallAttributes

  /** ★ `$CE9F`: fills a 14-byte object record. */
  blockRecord(ix, c, b, de, a, l) {
    var put = (offset, value) => this.wr(ix+offset, value);
    put(0, c);
    put(0x0A, c);
    put(1, b);
    put(0x0B, b);
    put(2, 7);
    put(3, 7);
    put(0x0C, 7);
    put(0x0D, 7);
    put(4, de & 0xFF);
    put(5, de >> 8);
    put(6, a);
    put(7, l);
    put(8, 0);
    put(9, 0);
  } // blockRecord

  /**
   * ★ `$CED0`: a stone block — its shape, 8 × 8 bits, printed as code $21
   * in its own colour, and its number in the shadow map.
   */
  drawBlock(ix, number) {
    var m = this.mem;
    var get = (offset) => this.rd(ix+offset);
    m[0x6572] = number;
    m[ATTR_T] = get(7);
    var hl = get(4) | (get(5) << 8);
    var c = get(0), b = get(1);
    for (;;) {
      this.setPos(b, c);
      var e = this.rd(hl);
      this.shadowIndex(b, c);
      for (var bit = 0; bit < 8; bit++) {
        var set = e & 0x80;
        e = (e << 1) & 0xFF;
        if (set) {
          this.printChar(0x21);
          var index = this.word(SHADOW_INDEX);
          this.wr(SHADOW+index, m[0x6572]);
          this.wr(SHADOW+index+0x320, get(7));
        } else {
          this.setWord(DF_CC, (this.word(DF_CC)+1) & 0xFFFF);
          m[S_POSN] = (m[S_POSN]-1) & 0xFF;
        }
        this.setWord(SHADOW_INDEX, (this.word(SHADOW_INDEX)+1) & 0xFFFF);
      }
      hl = (hl+1) & 0xFFFF;
      b = (b-1) & 0xFF;
      if (b < 4) {
        return;
      }
      if (((b+8) & 0xFF) === get(1)) {
        return;
      }
    }
  } // drawBlock

  /**
   * ★ `$CCA9`: the scatter (rooms with +7 = 1) — the corridor the craft came
   * in by cleared, (+11) codes $82 on random cells that are not empty,
   * (+12) codes $81 on random walls, both counts then 0; and the enemies.
   * @param {number} ix - The room record.
   */
  scatter(ix) {
    var m = this.mem;
    this.clearEntry();
    m[ATTR_T] = 0x07;
    this.scatterCode(m[ix+0x0B], 0x82, (code) => code !== 0x20);
    m[ATTR_T] = 0x03;
    this.scatterCode(m[ix+0x0C], 0x81, (code) => code === 0x21);
    m[ATTR_T] = 0x07;
    m[ix+0x0C] = 0;
    m[ix+0x0B] = 0;
    this.enemies(ix);
  } // scatter

  /** ★ `$CD5A`: a random place, C 7-$21, B 8-$18. */
  randomPlace() {
    var c, b;
    do {
      c = ((this.rand() & 0x1F)-3) & 0xFF;
    } while (c < 7 || c >= 0x22);
    do {
      b = ((this.rand() & 0x0F)+6) & 0xFF;
    } while (b < 8 || b >= 0x19);
    return {b: b, c: c};
  } // randomPlace

  scatterCode(count, code, fits) {
    var m = this.mem;
    for (var n = count; n > 0; n--) {
      var place, index;
      do {
        place = this.randomPlace();
        index = this.shadowIndex(place.b, place.c);
      } while (!fits(m[SHADOW+index]));
      this.setPos(place.b, place.c);
      m[SHADOW+index] = code;
      this.printChar(code);
      m[SHADOW+index+0x320] = m[ATTR_T];
    }
  } // scatterCode

  /**
   * ★ `$CC73`: the cells the active craft entered by, made empty: at the top
   * or the bottom (B $18 or 5) the first and the last line over its width,
   * otherwise columns 0 and 31 over its height.
   */
  clearEntry() {
    var m = this.mem;
    var craft = this.word(ACTIVE_CRAFT);
    m[0x655C] = m[craft+6];
    m[0x5D13] = m[craft+1];
    m[0x5D12] = m[craft];
    var line = m[craft+1];
    if (line === 5 || line >= 0x18) {
      this.clearRow(0x18, m[craft], m[craft+4]);
      this.clearRow(5, m[craft], m[craft+4]);
    } else {
      this.clearColumn(line, 0x21, m[craft+5]);
      this.clearColumn(line, 2, m[craft+5]);
    }
  } // clearEntry

  /** ★ `$CDBC`. */
  clearRow(b, c, width) {
    this.setPos(b, c);
    this.shadowIndex(b, c);
    for (var n = width; n > 0; n--) {
      this.shadowWrite(0x20);
      this.printChar(0x20);
    }
  } // clearRow

  /** ★ `$CDA2`. */
  clearColumn(b, c, height) {
    for (var n = height; n > 0; n--) {
      this.setPos(b, c);
      this.shadowIndex(b, c);
      this.shadowWrite(0x20);
      this.printChar(0x20);
      b = (b-1) & 0xFF;
    }
  } // clearColumn

  /**
   * ★ `$CD0E`: (+8) enemies — records of 15 bytes at $5D14, places from
   * `$DEB9`, code $83 in white, a random direction from `$F514`.
   */
  enemies(ix) {
    this.enemyCount(this.mem[ix+8]);
  } // enemies

  /** ★ `$CD1D`: A enemies, as `$CD0E` past its count. */
  enemyCount(count) {
    var m = this.mem;
    m[ENEMY_COUNT] = count;
    var hl = ENEMY_STARTS, record = ENEMIES;
    for (var n = count; n > 0; n--) {
      var c = m[hl], b = m[hl+1];
      hl += 2;
      this.blockRecord(record, c, b, 0x0101, 0x83, 0x07);
      m[record+0x0E] = 7;
      this.setPos(b, c);
      this.printChar(0x83);
      var d = this.direction();
      m[record+8] = d.c;
      m[record+9] = d.b;
      record += 15;
    }
  } // enemyCount

  /** ★ `$F514`: one of four directions, from rand AND 3. */
  direction() {
    var a = this.rand() & 3;
    if (a === 0) {
      return {b: 0, c: 1};
    }
    if (a === 2) {
      return {b: 0, c: 0xFF};
    }
    if (a === 1) {
      return {b: 1, c: 0};
    }
    return {b: 0xFF, c: 0};
  } // direction

  /**
   * ★ `$CC57`: a craft in this room — `$FAA1` prints it, `$F92A` writes its
   * code into the shadow map over its size.
   * @param {number} ix - The craft's record.
   */
  drawCraft(ix) {
    var m = this.mem;
    if (m[ROOM] !== m[ix+0x0E]) {
      return;
    }
    this.sprite(ix);
    this.shadowBlock(m[ix+6], m[ix+1], m[ix], m[ix+5], m[ix+4]);
  } // drawCraft

  /**
   * ★ `$CF3A` / `$CF40`: the active craft's icon on the panel, 2 × 5 codes
   * from the second set (CHARS = $79C9) at line 2, C $20 — and CHARS stays
   * there.
   */
  craftIcon(attribute, code) {
    var m = this.mem;
    this.setWord(CHARS, 0x79C9);
    m[ATTR_T] = attribute;
    if (m[0x5D11]) {
      return;
    }
    this.printBlock(code, 0x02, 0x20, 0x02, 0x05);
  } // craftIcon

  /**
   * ★ `$FAA1`: a sprite, shifted to the pixel. The craft's graphics (codes
   * from +6 in the current CHARS, +4 wide, +5 high, column by column) are
   * shifted left by +2 + 1 bits into two buffers that overlap by a column
   * (`$5D6E`, the remainder ORed into the next column), each column a
   * character taller; then printed (`$FB6D`) with CHARS = $5C66 + (+3) + 1,
   * which shifts them down, one character wider when +2 is not 7 and one
   * taller when +3 is not 7.
   * @param {number} craft - The record.
   */
  sprite(craft) {
    var m = this.mem;
    var orMode = false;
    m[0xFB04] = 0x00;                   // ★ self-modified: NOP, later OR (HL)
    m[ATTR_T] = (m[ATTR_T] & 0x38) | m[craft+7];
    var chars = this.word(CHARS);
    var source = (chars+8*m[craft+6]) & 0xFFFF;
    var shift = (m[craft+2]+1) & 0xFF;
    m[0xFAF7] = shift;                  // ★ self-modified: LD B,n
    var width = m[craft+4], height = m[craft+5];
    var iy = (SPRITE_A+(((height+1) & 0xFF) << 3)) & 0xFFFF;
    var stride = (width << 3) & 0xFF;
    m[0xFB11] = stride;                 // ★ self-modified: LD BC,n
    var hl = SPRITE_A;
    for (var column = width; column > 0; column--) {
      var columnStart = source;
      var ixp = source;
      for (var row = height; row > 0; row--) {
        var rowStart = ixp;
        for (var line = 0; line < 8; line++) {
          var c = m[ixp], a = 0;
          for (var n = shift; n > 0; n--) {
            a = ((a << 1) | (c >> 7)) & 0xFF;
            c = (c << 1) & 0xFF;
          }
          if (shift === 0) {         // DJNZ with B = 0 runs 256 times
            for (var k = 0; k < 256; k++) {
              a = ((a << 1) | (c >> 7)) & 0xFF;
              c = (c << 1) & 0xFF;
            }
          }
          m[iy] = c;
          if (orMode) {
            a |= m[hl];
          }
          m[hl] = a;
          hl++;
          ixp++;
          iy++;
        }
        ixp = (rowStart+stride) & 0xFFFF;
      }
      orMode = true;
      m[0xFB04] = 0xB6;
      for (var z = 0; z < 8; z++) {
        m[hl++] = 0;
        m[iy++] = 0;
      }
      source = (columnStart+8) & 0xFFFF;
    }
    this.setWord(CHARS, (SPRITE_CHARS+((m[craft+3]+1) & 0xFF)) & 0xFFFF);
    var e = m[craft+4];
    if (m[craft+2] !== 7) {
      e++;
    }
    var d = (m[craft+5]+1) & 0xFF;
    m[0x653B] = d;
    if (m[craft+3] === 7) {
      d--;
    }
    this.spritePrint(m[craft+1], m[craft], d, e);
    this.setWord(CHARS, chars);
  } // sprite

  /** ★ `$FB6D`: prints the shifted sprite, codes from $20, clipped. */
  spritePrint(b, c, d, width) {
    var m = this.mem, w = m;
    var l = 0x1F;
    m[0xFB75] = width;                  // ★ self-modified: LD E,n
    for (;;) {
      l = (l+1) & 0xFF;
      var e = width;
      if (w[WINDOW] < b) {
        for (;;) {
          d = (d-1) & 0xFF;
          if (d === 0) {
            return;
          }
          l = (l+1) & 0xFF;
          b = (b-1) & 0xFF;
          if (!(w[WINDOW] < b)) {
            break;
          }
        }
      }
      if (w[WINDOW+3] >= c) {
        return;
      }
      if (w[WINDOW+1] >= b) {
        return;
      }
      var savedB = b, savedC = c;
      var h, a;
      var skip = false;
      if (w[WINDOW+2] < c) {
        h = l;
        for (;;) {
          e = (e-1) & 0xFF;
          if (e === 0) {
            skip = true;
            break;
          }
          h = (m[0x653B]+h) & 0xFF;
          c = (c-1) & 0xFF;
          if (!(w[WINDOW+2] < c)) {
            break;
          }
        }
        a = h;
        if (!skip) {
          this.setPos(b, c);
        }
      } else {
        this.setPos(b, c);
        a = l;
      }
      if (!skip) {
        for (;;) {
          this.printChar(a);
          h = a;
          c = (c-1) & 0xFF;
          if (w[WINDOW+3] >= c) {
            break;
          }
          a = (m[0x653B]+h) & 0xFF;
          e = (e-1) & 0xFF;
          if (e === 0) {
            break;
          }
        }
      }
      b = savedB;
      c = savedC;
      d = (d-1) & 0xFF;
      if (d === 0) {
        return;
      }
      b = (b-1) & 0xFF;
    }
  } // spritePrint

  // --- the special rooms ($D3A9) ---------------------------------------------

  /**
   * ★ `$D3A9`: clears the play area (`$CE6D`) and draws the special room of
   * layout 30-34; all of them end in `$D671` → `finish()`.
   * @param {number} ix - The room record.
   * @param {number} layout - 30-34.
   */
  specialRoom(ix, layout) {
    var m = this.mem;
    this.clearPlayArea();
    switch (layout) {
      case 0x1E: this.room30(ix); break;
      case 0x1F: this.room31(ix); break;
      case 0x20: this.room32(ix); break;
      case 0x21: this.room33(ix); break;
      default: this.room34(ix); break;
    }
    // ★ $D671 (a flag the interrupt reads: a shared access)
    this.event();
    m[0x6544] = 0;
    m[BLOCKS] = 0xFF;
    this.finish();
  } // specialRoom

  /** ★ `$CE6D`: the play area's attributes 0, ATTR_T 0, every cell $20. */
  clearPlayArea() {
    var m = this.mem;
    for (var i = 0; i < 0x280; i++) {
      this.wr(0x5800+i, 0);
    }
    m[ATTR_T] = 0;
    for (var b = 0x18; b !== 4; b--) {
      this.row(b, 0x21, 0x20);
    }
  } // clearPlayArea

  /** ★ `$D001`: 32 cells of code A from B, C (shadow and screen). */
  row(b, c, a) {
    this.setPos(b, c);
    this.shadowIndex(b, c);
    for (var n = 0; n < 0x20; n++) {
      this.shadowWrite(a);
      this.printChar(a);
    }
  } // row

  /** ★ `$D014`: a column of $21 from line B down to line 5. */
  column(b, c) {
    do {
      this.setPos(b, c);
      this.shadowIndex(b, c);
      this.shadowWrite(0x21);
      this.printChar(0x21);
      b = (b-1) & 0xFF;
    } while (b !== 4);
  } // column

  /**
   * ★ `$CFDD`: the frame of a special room — rows 0 and 19 and columns 0
   * and 31 of code $21 from the second set, in attribute A.
   */
  frame(a) {
    var m = this.mem;
    m[ATTR_T] = a;
    this.setWord(CHARS, 0x79C9);
    this.row(0x18, 0x21, 0x21);
    this.row(0x05, 0x21, 0x21);
    this.column(0x18, 0x21);
    this.column(0x18, 0x02);
  } // frame

  /** ★ `$D201`: swaps 288 bytes at $7E71 (codes 149-184 of the second set) with DE. */
  swapGlyphs(de) {
    var m = this.mem;
    for (var i = 0; i < 0x120; i++) {
      var a = m[de+i];
      m[de+i] = m[0x7E71+i];
      m[0x7E71+i] = a;
    }
  } // swapGlyphs

  /**
   * ★ `$CF9E`: prints a stream — a code below $FB is printed and recorded,
   * $FB C B sets the position, $FC n moves n columns back (round into the
   * line above), $FD code n repeats a code n + 1 times, $FE a sets ATTR_T,
   * $FF ends it.
   * @param {number} hl - The stream.
   */
  stream(hl) {
    var m = this.mem;
    for (;;) {
      var a = m[hl];
      if (a < 0xFB) {
        this.shadowWrite(a);
        this.printChar(a);
        hl++;
      } else if (a === 0xFB) {
        var c = m[hl+1], b = m[hl+2];
        hl += 3;
        this.setPos(b, c);
        this.shadowIndex(b, c);
      } else if (a === 0xFC) {
        hl++;
        var bb = m[S_POSN+1];
        var aa = (m[S_POSN]-m[hl]) & 0xFF;
        while (aa < 2 || aa >= 0x22) {
          aa = (aa+0x20) & 0xFF;
          bb = (bb-1) & 0xFF;
        }
        this.shadowIndex(bb, aa);
        this.setPos(bb, aa);
        hl++;
      } else if (a === 0xFD) {
        var code = m[hl+1];
        var count = (m[hl+2]+1) & 0xFF;
        hl += 3;
        do {
          this.shadowWrite(code);
          this.printChar(code);
          count = (count-1) & 0xFF;
        } while (count !== 0);
      } else if (a === 0xFE) {
        m[ATTR_T] = m[hl+1];
        hl += 2;
      } else {
        return;
      }
    }
  } // stream

  /** @returns {boolean} Thunderbird 2 is the craft under control. */
  tb2Active() {
    return this.word(ACTIVE_CRAFT) === CRAFT_2;
  } // tb2Active

  /** ? the equipment's effect in a special room: M4/M5 */
  notPorted(what) {
    throw new Error('roomRenderer: '+what+' is not ported yet (M4/M5)');
  } // notPorted

  /** ★ `$D264`: the cave of layout 30. */
  room30(ix) {
    var m = this.mem;
    var t = 0xD258+2*m[ix+9];
    m[ATTR_T] = m[t];
    m[0xDFFB] = m[t+1];
    m[0x5BFF] = 1;
    this.swapGlyphs(0x935C);
    this.frame(m[ATTR_T]);
    m[ATTR_T] = m[0xDFFB];
    this.stream(0x9B16);
    this.clearEntry();
    this.swapGlyphs(0x935C);
    this.normalizeShadow();
    this.specialList(0x662F, 0xDF55);
    var room = this.word(ROOM_RECORD);
    if (m[room+0x0C] !== 0) {
      if (!this.tb2Active() || !(m[0x6679] & 0x02)) {
        return;
      }
      this.notPorted('$D2C8 (layout 30 with the equipment)');
    }
    // ★ $D38B
    this.setWord(CHARS, 0x79C9);
    this.shadowIndex(0x08, 0x06);
    this.setPos(0x08, 0x06);
    for (var n = 0; n < 4; n++) {
      this.printChar(0x20);
      this.shadowWrite(0x20);
    }
  } // room30

  /** ★ `$D476`: layout 31. */
  room31(ix) {
    var m = this.mem;
    m[0x5BFF] = 7;
    this.swapGlyphs(0x9134);
    var t = 0xD46C+2*m[ix+9];
    m[0xDFFB] = m[t];
    this.frame(m[t+1]);
    this.setPos(0x18, 0x21);
    this.stream(0x9E2D);
    this.stream(0x9D2A);
    this.clearEntry();
    this.normalizeShadow();
    this.specialList(0x65F3, 0xDF2F);
    var room = this.word(ROOM_RECORD);
    if (m[room+9] >= 2) {
      this.specialList(0x662F, 0xDF42);
    }
    room = this.word(ROOM_RECORD);
    if (m[room+0x0C] !== 0) {
      this.paperRows(m[0xDFFB]);
    }
    this.swapGlyphs(0x9134);
    m[P_FLAG] = 0x38;
    if (this.tb2Active() && (m[0x6679] & 0x08) && m[room+0x0C] !== 0) {
      this.notPorted('$D4F8 (layout 31 with the equipment)');
    }
  } // room31

  /** ★ `$CF62`: rows 16-19 get paper $DFFB ORed into their attributes. */
  paperRows(paper) {
    this.mem[ATTR_T] = paper;
    for (var i = 0; i < 0x80; i++) {
      var at = 0x5A00+i;
      this.wr(at, ((paper << 3) | this.rd(at)) & 0xFF);
    }
  } // paperRows

  /** ★ `$D09B`: layout 32. */
  room32(ix) {
    var m = this.mem;
    this.frame((m[ix+9]+1) & 0xFF);
    this.swapGlyphs(0x9254);
    this.stream(0x9A5C);
    if (m[ix+0x0C] !== 0) {
      this.stream(0x9C26);
    }
    this.swapGlyphs(0x9254);
    this.clearEntry();
    this.normalizeShadow();
    m[WINDOW+1] = 4;
    this.specialList(0x65F3, 0xDEC3);
    if (this.tb2Active() && (m[0x6679] & 0x01)) {
      var room = this.word(ROOM_RECORD);
      if (m[room+0x0C] !== 0) {
        this.notPorted('$D0F2 (layout 32 with the equipment)');
      }
    }
  } // room32

  /** ★ `$D58E`: layout 33. */
  room33(ix) {
    var m = this.mem;
    var t = 0xD582+2*m[ix+9];
    m[ATTR_T] = m[t];
    m[0xDFFB] = m[t+1];
    m[0x5BFF] = m[ix+5] === 0x39 ? 1 : 3;
    this.swapGlyphs(0x9134);
    this.frame(m[ATTR_T]);
    this.stream(0x9D2A);
    m[ATTR_T] = m[0xDFFB];
    this.stream(0x9E2D);
    this.clearEntry();
    var room = this.word(ROOM_RECORD);
    if (m[room+0x0C] !== 0) {
      this.stream(0x9D04);
    }
    this.normalizeShadow();
    this.specialList(0x662F, 0xDEF9);
    m[ATTR_T] = 0;
    this.swapGlyphs(0x9134);
    room = this.word(ROOM_RECORD);
    if (this.tb2Active() && (m[0x667A] & 0x04) && m[room+0x0C] !== 0) {
      this.notPorted('$D60C (layout 33 with the equipment)');
    }
  } // room33

  /** ★ `$D1DC`: layout 34. */
  room34(ix) {
    this.frame(0x05);
    this.swapGlyphs(0x9134);
    this.stream(0x9C91);
    this.clearEntry();
    this.swapGlyphs(0x9134);
    this.normalizeShadow();
    this.enemyCount(5);
  } // room34

  /**
   * ★ `$D3C3`: the things of a special room — (+9) records of 18 bytes
   * (one more when `$5D00` ≥ 5 or `$5CFF` ≠ 0, at most 3) copied from HL to
   * DE and ended with $FF, then drawn with CHARS = $93DC: a block of codes,
   * or from code $C0 on a spider — a 16-line sprite placed to the pixel
   * (`$FC5F`) and its thread down from it by the ROM's DRAW-LINE.
   */
  specialList(de, hl) {
    var m = this.mem;
    var room = this.word(ROOM_RECORD);
    var b = m[room+9];
    if (m[0x5D00] >= 5 || m[0x5CFF] !== 0) {
      b = (b+1) & 0xFF;
    }
    if (b >= 4) {
      b = 3;
    }
    var start = de;
    var n = b === 0 ? 256 : b;
    for (var k = 0; k < n; k++) {
      for (var i = 0; i < 18; i++) {
        this.wr(de++, this.rd(hl++));
      }
    }
    this.wr(de, 0xFF);
    this.setWord(CHARS, 0x93DC);
    for (var ix = start; m[ix] !== 0xFF; ix += 18) {
      var c = m[ix], bb = m[ix+1], e = m[ix+4], d = m[ix+5];
      m[ATTR_T] = m[ix+7];
      var a = m[ix+6];
      if (a < 0xC0) {
        this.printBlock(a, bb, c, d, e);
        if (!this.tb2Active()) {
          m[ix+0x0F] = ((m[ix+8] ^ 0xFE)+m[ix+0x0F]) & 0xFF;
        }
      } else {
        this.spider(ix);
        m[ATTR_T] = 0x47;
        m[0x5C7D] = (m[ix+0x10]+7) & 0xFF;
        m[0x5C7E] = m[ix+0x11];
        var length = (m[ix+0x0E]-m[ix+0x0F]) & 0xFF;
        this.rom.drawLine(length, 0, 1, 1);
        if (!this.tb2Active()) {
          m[ix+0x0E] = (m[ix+0x0E]-8) & 0xFF;
        }
      }
    }
  } // specialList

  /**
   * ★ `$FC5F`: a spider — 16 lines of 2 bytes from CHARS $93DC + 8 × (+6),
   * placed to the pixel at x (+$10), y (+$11) through ROM PIXEL-ADD, and
   * attribute $47 over 2 × 2 cells (2 × 3 when +3 is not 7) from (+0, +1).
   */
  spider(ix) {
    var m = this.mem;
    var source = (0x93DC+8*m[ix+6]) & 0xFFFF;
    var x = m[ix+0x10], y = m[ix+0x11];
    for (var line = 0; line < 16; line++) {
      var at = this.rom.pixelAdd(y, x).address;
      this.wr(at, this.rd(source++));
      this.wr(at+1, this.rd(source++));
      y = (y-1) & 0xFF;
    }
    var index = this.shadowIndex(m[ix+1], m[ix]);
    var rows = m[ix+3] === 7 ? 2 : 3;
    this.fillAttributes(0x5800+index, rows, 2, 0x47);
  } // spider

  /** ★ `$FCA1`: attribute A over B rows × C columns from HL. */
  fillAttributes(hl, rows, columns, a) {
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < columns; c++) {
        this.wr(hl+c, a);
      }
      hl += 0x20;
    }
  } // fillAttributes

  // --- the start of a mission ($D9E9) ---------------------------------------

  /**
   * ★ The screen at the start of a mission, as the original leaves it when
   * the first room stands (`$E269`): `$D9E9` clears the screen (ROM CL-LINE,
   * everything 0), prints the take-off scene (rows 0-19, which the room
   * overwrites), the panel (`$F436`) and the lives (`$F439` at line 3,
   * ATTR_T 7); while Thunderbird 2 takes off the logo's flames turn
   * (`$F7ED`, every fourth interrupt); then the first room is entered.
   * data/global.json `entry` says which room and how many turns of the
   * flames — tools/tracerooms.py counted them in the original's run.
   */
  startMission() {
    var entry = this.global.entry;
    this.mem.fill(0, 0x4000, 0x5B00);
    this.drawPanel();
    this.mem[ATTR_T] = 0x07;
    this.drawLives(0x03, 0x21);
    this.flames(entry.logoSteps);
    this.enterRoom(entry.room);
  } // startMission

  // --- the panel ($F634) and the logo's flames ($F7ED) -----------------------

  /**
   * ★ `$F634`: the panel, as the start of a mission draws it — the labels
   * (the stream at `$F839` through `$F811`: a code below $64 is printed, $FF
   * ends, anything else is followed by C, B of a new position), SCORE and
   * HIGH (`$F799`), TIME (`$F6C9`), the fuel gauge (`$5CF1`: full cells from
   * column 6 up to the gauge's end, the last one in part, `$F60C`), its
   * colours (`$F82B`) and the Firebird logo and name — all in the second set
   * (CHARS = $79C9), with ATTR_T 6, 7 and 2. The clip window's bottom is left
   * at 0.
   */
  drawPanel() {
    var m = this.mem;
    m[ATTR_T] = 0x06;
    this.setWord(CHARS, 0x79C9);
    m[WINDOW+1] = 0;
    this.setPos(0x04, 0x21);
    for (var hl = 0xF839; m[hl] !== 0xFF;) {
      if (m[hl] < 0x64) {
        this.printChar(m[hl++]);
      } else {
        this.setPos(m[hl+2], m[hl+1]);
        hl += 3;
      }
    }
    this.scores();
    this.time();
    var gauge = 0x5CF1;
    if (m[gauge] !== 0x1A) {
      for (var c = 0x1A; c !== m[gauge]; c--) {
        this.setPos(0x01, c);
        var at = this.word(DF_CC);
        for (var line = 1; line <= 6; line++) {
          this.wr(at+(line << 8), 0xFF);
        }
      }
    }
    this.gaugeEnd();
    var index = this.shadowIndex(0x01, 0x1A);
    for (var i = 0; i < 14; i++) {
      this.wr(0x5800+index+i, m[0xF82B+i]);
    }
    m[ATTR_T] = 0x02;
    this.printBlock(0x2D, 0x04, 0x0B, 0x03, 0x0A);
    m[ATTR_T] = 0x07;
    this.printBlock(0x4B, 0x01, 0x0B, 0x01, 0x0A);
  } // drawPanel

  /**
   * ★ `$F6B3` (`$F439`): the lives at line B, C — `$5CF4` − 1 figures (code
   * $90 of the current set) and a space after them.
   * @param {number} b - Line.
   * @param {number} c - Column count.
   */
  drawLives(b, c) {
    this.setPos(b, c);
    for (var n = (this.mem[0x5CF4]-1) & 0xFF; n > 0; n--) {
      this.printChar(0x90);
    }
    this.printChar(0x20);
  } // drawLives

  /**
   * ★ `$F799`: SCORE (`$5CFF`, five digits) and HIGH (`$5D05`) — HIGH takes
   * the score when the score is higher; a digit d is code d + 10.
   */
  scores() {
    var m = this.mem;
    this.setWord(0x5CFD, 0);
    this.setWord(CHARS, 0x79C9);
    m[ATTR_T] = 0x07;
    this.digits(0x041B, 0x5CFF, 5);
    for (var i = 0; i < 5; i++) {
      var high = m[0x5D05+i], score = m[0x5CFF+i];
      if (high === score) {
        continue;
      }
      if (high < score) {
        for (var k = 0; k < 5; k++) {
          m[0x5D05+k] = m[0x5CFF+k];
        }
      }
      break;
    }
    this.digits(0x0410, 0x5D05, 5);
  } // scores

  /** ★ `$F6C9`: TIME, three pairs of digits at `$5CF5`, `$5CF7`, `$5CF9`. */
  time() {
    this.mem[ATTR_T] = 0x07;
    this.digits(0x0214, 0x5CF5, 2);
    this.digits(0x0211, 0x5CF7, 2);
    this.digits(0x020E, 0x5CF9, 2);
  } // time

  /** ★ `$F7DE` / `$F6E6`: n digits from HL at position BC. */
  digits(bc, hl, n) {
    this.setPos(bc >> 8, bc & 0xFF);
    for (var i = 0; i < n; i++) {
      this.printChar((this.mem[hl+i]+0x0A) & 0xFF);
    }
  } // digits

  /**
   * ★ `$F60C`: the last cell of the fuel gauge, (+1) + 1 pixels from the
   * left in six lines (none when +1 is 0).
   */
  gaugeEnd() {
    var m = this.mem;
    this.setPos(0x01, m[0x5CF1]);
    var at = this.word(DF_CC);
    var count = m[0x5CF2];
    var a = 0;
    if (count) {
      var c = 0;
      for (var n = count+1; n > 0; n--) {
        c = (c >> 1) | 0x80;
      }
      a = c;
    }
    for (var line = 1; line <= 6; line++) {
      this.wr(at+(line << 8), a);
    }
  } // gaugeEnd

  /**
   * ★ `$F7ED`: one step of the logo's flames — every fourth interrupt. Eight
   * bytes from `$5097` in eight lines, rotated left and right in turn.
   * @param {number} [times] - How many steps (the rotations repeat after 8).
   */
  flames(times) {
    for (var t = (times === undefined ? 1 : times) % 8; t > 0; t--) {
      var hl = 0x5097;
      for (var b = 0; b < 4; b++) {
        for (var k = 0; k < 4; k++) {
          var at = hl+2*k;
          var v = this.rd(at);
          this.wr(at, ((v << 1) | (v >> 7)) & 0xFF);
          v = this.rd(at+1);
          this.wr(at+1, ((v >> 1) | (v << 7)) & 0xFF);
        }
        hl += 0x100;
        for (var j = 0; j < 4; j++) {
          var at2 = hl+2*j;
          var w = this.rd(at2);
          this.wr(at2, ((w >> 1) | (w << 7)) & 0xFF);
          w = this.rd(at2+1);
          this.wr(at2+1, ((w << 1) | (w >> 7)) & 0xFF);
        }
        hl += 0x100;
      }
    }
  } // flames

  /** The shadow map: 800 codes and 800 attributes. */
  shadow() {
    return this.mem.subarray(SHADOW, SHADOW+1600);
  } // shadow

  /** @returns {number} SEED. */
  seed() {
    return this.word(SEED);
  } // seed

  /** @param {number} value - The new SEED. */
  setSeed(value) {
    this.setWord(SEED, value & 0xFFFF);
  } // setSeed

} // RoomRenderer

if (typeof self !== 'undefined') { self.RoomRenderer = RoomRenderer; }
if (typeof module !== 'undefined' && module.exports) { module.exports = RoomRenderer; }
