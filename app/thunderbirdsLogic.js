// classic script (importScripts): no import, no export — R-001, R-048.
// Needs ZXRomDraw (svision zxRomDraw.js) and RoomRenderer (roomRenderer.js)
// loaded before it.
// begin code

/**
 * The game of Thunderbirds — **one pass of the original's main loop**
 * (`$E299`-`$E353`) and its **interrupt** (`$A398`), routine for routine
 * (sources/docs/physics.md).
 *
 * It extends the room engine (app/roomRenderer.js, M2) and keeps the same
 * rule: the state lives **at the original's addresses** in a 64 K array
 * `mem` — the screen at $4000 included — and every routine reads and writes
 * what its Z80 original does, the self-modified bytes of the code too. So
 * tools/matchphysics.mjs can compare the whole state with the original's
 * after every pass.
 *
 * ★ **The main loop does not wait for the frame** (disasm_notes.md §4). One
 * pass moves the craft under control one step (eight steps a character),
 * moves the blocks that fall or are pushed, the enemies and the things of the
 * special rooms, counts the time and the fuel, and burns a delay of its own.
 * The interrupt comes 50 times a second wherever the pass is; it turns the
 * logo's flames, counts the seconds and plays the sounds — and the noise
 * sound moves the generator's SEED (`$A50F`). So **where** an interrupt falls
 * in a pass matters, but only against what the two share: SEED, the flags of
 * the sounds and the second's flag. Every place where the main program
 * touches one of them calls `event()`; tools/tracephysics.py counts the same
 * places in the original and records after how many of them each interrupt
 * came. Replayed (`isrQueue`), the port runs each interrupt between the very
 * same two accesses as the original did. In the game the worker runs the
 * interrupts between passes on its own clock (gameWorker.js).
 *
 * Covered (M3): the movement of the two Thunderbirds with their turning,
 * walls and pick-ups, pushing blocks left and right and lifting them, the
 * blocks' falling, the crushing, switching the craft, leaving a room on any
 * side, the enemies and the spiders' rooms (they run in every pass), time and
 * fuel, crashing and losing a life, the logo's flames and the sounds' state.
 * ? Not here: the texts the ROM prints and what comes after them — OUT OF
 * FUEL, GAME OVER, WELL DONE, the base (room 0, the start of a mission) —
 * end the pass with a signal (M4); the title's demo, the cheat's number on
 * the screen, saving and loading and the pause key (the remake has its own
 * pause) throw.
 *
 * Free of DOM dependencies (R-001).
 */
class ThunderbirdsLogic extends RoomRenderer {

  /**
   * @param {Object} maze - The parsed data/maze.json.
   * @param {Object} global - The parsed data/global.json.
   */
  constructor(maze, global) {
    super(maze, global);
    // the replay: after how many shared accesses each interrupt of the pass
    // came (tools/tracephysics.py); null in the game
    this.isrQueue = null;
    this.isrNext = 0;
    this.events = 0;
    // KEY-SCAN: the DE a replay gives, or the key the game holds
    this.scanQueue = null;
    this.key = 0xFFFF;
    this.scans = 0;
    // T-states the pass burns in its delays (the cadence, gameWorker.js)
    this.waited = 0;
    // sounds started in this pass and interrupt, for the audio (M6)
    this.sounds = [];
  } // constructor

  // --- the shared state: SEED, the sounds' flags, the second ---------------

  /**
   * ★ The main program touches state it shares with the interrupt: an
   * interrupt recorded to come before this access runs now.
   */
  event() {
    var queue = this.isrQueue;
    while (queue && this.isrNext < queue.length && queue[this.isrNext] <= this.events) {
      this.isrNext++;
      this.interrupt();
    }
    this.events++;
  } // event

  /** A shared byte written by the main program. */
  share(address, value) {
    this.event();
    this.mem[address] = value & 0xFF;
  } // share

  /** A shared word written by the main program (`LD (nn),rr`). */
  shareWord(address, value) {
    this.event();
    this.setWord(address, value);
  } // shareWord

  /** A shared byte read by the main program. */
  shared(address) {
    this.event();
    return this.mem[address];
  } // shared

  /**
   * ★ `$F8B6` (`$F44E`): `DEC BC` until 0 — 26 T-states a turn, nothing else.
   * BC 0 is 65 536 turns.
   */
  wait(bc) {
    this.waited += 26*(bc === 0 ? 0x10000 : bc);
  } // wait

  /**
   * ROM KEY-SCAN `$028E` as the game uses it: DE, $FFFF for no key.
   * @returns {number}
   */
  keyScan() {
    this.scans++;
    if (this.scanQueue) {
      if (!this.scanQueue.length) {
        throw new Error('thunderbirdsLogic: KEY-SCAN beyond the recording');
      }
      return this.scanQueue.shift();
    }
    return this.key;
  } // keyScan

  notPorted(what) {
    throw new Error('thunderbirdsLogic: '+what+' is not ported yet');
  } // notPorted

  // --- the interrupt ($A398) ----------------------------------------------

  /**
   * ★ `$A398`: the IM 2 handler. The counter `$6558` and every fourth time
   * the logo's flames (`$F7ED`), the seconds (`$F6F6`), then the sounds —
   * of which the long ones end the handler early. What the sounds send to
   * the speaker is M6; what they leave in memory is here, the noise's turns
   * of SEED (`$A50F`) included.
   */
  interrupt() {
    var m = this.mem;
    // what the handler did, for its length (isrCost)
    var stats = this.isrStats = {pulses: 0, sum: 0, note: 0, sweep: 0, tone: 0, flames: 0};
    m[0x6558] = (m[0x6558]+1) & 0xFF;
    if ((m[0x6558] & 3) === 0) {
      this.flames(1);
      stats.flames = 1;
    }
    // ★ $F6F6: fifty interrupts make a second
    m[0x5CFB] = (m[0x5CFB]+1) & 0xFF;
    if (m[0x5CFB] === 0x32) {
      m[0x5CFB] = 0;
      m[0x5CFC] = 1;
    }
    // $A3B0: LD A,R / BIT 7 — the loader set bit 7 of R, the copy check
    if (m[0x6547] === 2) {
      this.notPorted('$A528 (the title tune)');
    }
    // ★ $A455: the pick-up of fuel
    if (m[0x6550]) {
      this.sound('fuel');
      m[0x6550] = 0;
    }
    // ★ $A41A: the pick-up of a thing ($81)
    if (m[0x6551]) {
      m[0x6551] = 0;
      this.sound('pickup');
    }
    // ★ $A468: a block lands — noise, D $46
    if (m[0x654E]) {
      this.sound('land');
      this.noise(0x46, 0xFF);
      m[0x654E] = 0;
    }
    // ★ $A479: a block is pushed — noise, D $0C, eight interrupts
    if (m[0x6553]) {
      m[0x6553] = (m[0x6553]-1) & 0xFF;
      this.sound('push');
      this.noise(0x0C, 0x7F);
    }
    // ★ $A4FE: the crash — noise, D ($6545), every interrupt while ($6544)
    if (m[0x6544]) {
      this.sound('crash');
      this.noise(m[0x6545], m[0x6544]);
      return;                           // POP AF / JP $A3DC
    }
    // ★ $A3E6: a sweep, set by $6549, played a step an interrupt
    if (m[0x6549]) {
      m[0xA3F8] = m[0x6549];
      m[0x6549] = 0;
      m[0xA3F7] = 0x1E;
    } else if (m[0xA3F8] > 1) {
      m[0xA3F7] = (m[0xA3F7]+1) & 0xFF;
      m[0xA3F8] = (m[0xA3F8]-1) & 0xFF;
      this.sound('sweep');
      stats.sweep = m[0xA3F7]*m[0xA3F8];
      return;                           // POP AF / JP $A3DC
    }
    // ★ $A42D
    if (m[0x6552]) {
      m[0x6552] = 0;
      this.sound('tone');
      stats.tone = 1;
      return;                           // POP AF / JP $A3DC
    }
    // ★ $A4E6: the tune of the game, a note every fourth interrupt
    if (m[0x6547] === 1) {
      m[0xA4E5] = (m[0xA4E5]-1) & 0xFF;
      if (m[0xA4E5] === 0) {
        m[0xA4E5] = 4;
        this.note();
      }
    }
  } // interrupt

  /**
   * ★ `$A48A`: D turns (0 is 256) of two pulses of noise, each as long as
   * `$A50F` says — SEED low = 5 × SEED low + 1.
   */
  noise(d, b) {
    var stats = this.isrStats;
    for (var n = 2*(d === 0 ? 256 : d); n > 0; n--) {
      var pulse = this.noiseStep() & b;
      if (stats) {
        stats.pulses++;
        stats.sum += pulse;
      }
    }
  } // noise

  /**
   * ★ `$A50F`: `LD HL,($5C75) / SLA H / SLA H / LD A,($5C76) / INC A /
   * ADD A,H / LD ($5C76),A` — the low byte of SEED times five plus one, the
   * length of a pulse of the noise.
   * @returns {number} The new low byte (the A the original returns).
   */
  noiseStep() {
    var m = this.mem;
    var low = m[0x5C76];
    low = (low+1+((low << 2) & 0xFF)) & 0xFF;
    m[0x5C76] = low;
    return low;
  } // noiseStep

  /**
   * ★ `$A558`: the next note of the tune — `$654A` points into it, `$40`
   * starts it again from `$654C` (and counts `$A527`); the note and the
   * one $241 bytes on go to `$A61D`/`$A61E`.
   */
  note() {
    var m = this.mem;
    var hl = this.word(0x654A);
    if (m[hl] === 0x40) {
      hl = this.word(0x654C);
      m[0xA527] = (m[0xA527]+1) & 0xFF;
    }
    m[0xA61D] = m[hl];
    hl = (hl+1) & 0xFFFF;
    this.setWord(0x654A, hl);
    m[0xA61E] = m[(hl+0x0241) & 0xFFFF];
    if (this.isrStats) {
      this.isrStats.note = 1;
    }
    this.sound('note');
  } // note

  /**
   * How long the last interrupt's handler ran, in T-states — a model fitted
   * to the original's (tools/measurecadence.mjs over the handler lengths
   * tools/tracephysics.py records): the bare handler, a turn of the flames,
   * a note of the tune (the tone loop $A586, most of it), the pulses of
   * the noise and their lengths ($A4A0: NOP / NOP / DJNZ a unit). ★ It is
   * what makes the original lose interrupts: a handler that outlasts the
   * frame runs with DI over the next interrupt (gameWorker.js).
   * @returns {number}
   */
  isrCost() {
    var s = this.isrStats;
    if (!s) {
      return 0;
    }
    return Math.round(ThunderbirdsLogic.ISR_BASE+ThunderbirdsLogic.ISR_FLAMES*s.flames
                      +ThunderbirdsLogic.ISR_NOTE*s.note+ThunderbirdsLogic.ISR_PULSE*s.pulses
                      +ThunderbirdsLogic.ISR_PULSE_UNIT*s.sum);
  } // isrCost

  sound(name) {
    this.sounds.push(name);
  } // sound

  // --- one pass of the main loop ($E299) ----------------------------------

  /**
   * ★ One pass of the main loop, from `$E299` to the `JP $E299`, or to the
   * restart at `$E24F` that leads back to it.
   * @returns {string} 'pass', 'restart' (a life lost, the mission begun
   *          again), 'gameOver', 'missionComplete', 'base' (room 0: the
   *          start of a mission, M4) or 'outOfFuel' (M4).
   */
  pass() {
    return this.run(() => this.loop());
  } // pass

  /**
   * ★ `JP $E24F` with A = room: the room entered anew and the loop reached
   * again — what a lost life does; tools/tracephysics.py uses it to put both
   * craft into a room of its choice (the same pokes here and there).
   * @param {number} room - The room.
   * @returns {string} As pass().
   */
  jump(room) {
    return this.run(() => this.restart(room));
  } // jump

  /** Runs `body` as a pass: the counters, the signals, the interrupts left. */
  run(body) {
    this.events = 0;
    this.isrNext = 0;
    this.scans = 0;
    this.waited = 0;
    var result;
    try {
      body();
      result = 'pass';
    } catch (signal) {
      if (!(signal instanceof ThunderbirdsLogic.Signal)) {
        throw signal;
      }
      result = signal.name;
    }
    // interrupts after the last shared access
    var queue = this.isrQueue;
    while (queue && this.isrNext < queue.length) {
      this.isrNext++;
      this.interrupt();
    }
    return result;
  } // run

  /** $E299-$E353. */
  loop() {
    var m = this.mem;
    this.wait(this.word(0xF396));
    if (m[0x5D11]) {
      this.notPorted('$E2A6 (the title\'s demo)');
    }
    this.input();                       // $F2C2
    if (m[0x655A]) {
      // ★ a life picked up: the figures again
      this.setWord(0x5C36, 0x79C9);
      m[0x5C8F] = 0x07;
      this.drawLives(0x03, 0x21);
      m[0x655A] = 0;
    }
    this.craftStep();                   // $EF31
    this.crumble();                     // $F424 → $F4CB
    if (m[0x5CF0] === 1) {
      this.death();                     // $E61B
    }
    this.fallCheck();                   // $EA5D
    this.refuel();                      // $F433 → $F5E6
    this.setWord(0x5C36, 0x79C9);
    this.clock();                       // $E6BF
    this.addScore();                    // $F442 → $F767
    if (m[0x655D] === 4) {
      this.notPorted('$E317 (the cheat\'s room number, ROM $1A1B)');
    }
    this.blocksMove();                  // $EBF6
    this.passDelay();                   // $E4D9
    this.specialStep();                 // $C939 → $F478 → $FCB1
    this.crash();                       // $E3D0
    this.enemiesStep();                 // $F42D → $F52B
    this.crash();                       // $E3D0
    this.craftsMeet();                  // $E356
  } // loop

  /**
   * ★ `$E24F` with A = room: a room entered anew (no blocks saved), then
   * `$E269`-`$E296`, the state a room starts with — and the pass is over.
   */
  restart(room) {
    var m = this.mem;
    if (m[0x5D11]) {
      this.notPorted('$E256 (the title\'s demo)');
    }
    this.enterFrom(room, false);
    this.roomStarts();
    throw new ThunderbirdsLogic.Signal('restart');
  } // restart

  /** ★ `$E269`: what every room starts with. */
  roomStarts() {
    var m = this.mem;
    m[0x6537] = 4;
    m[0xE778] = 0;
    m[0x656B] = 0;
    m[0x6562] = 0;
    m[0x656F] = 0;
    m[0x5CF0] = 0;
    m[0x5CEE] = 0;
    m[0x5CEF] = 0;
    m[0x5CED] = 0;
    m[0x655B] = 0;
    m[0x5C8F] = 0x07;
    if (!m[0x5D11]) {
      this.drawLives(0x03, 0x21);
    }
  } // roomStarts

  /**
   * ★ `$C933` (save = true: the blocks of the room left are saved first,
   * `$C95A`) or `$C936`: `$C986` keeps SP in `$DFF0` for the demo's way out,
   * then the room is entered (`$C991`). Every call in a pass is one level
   * deep: SP $5BFA.
   */
  enterFrom(room, save) {
    if (save) {
      this.saveBlocks();
    }
    this.setWord(0xDFF0, 0x5BFA);
    if (room === 0) {
      // ★ room 0 is the base: `$D67E`, the start of a mission (the cargo,
      // the equipment, the take-off) — M4
      throw new ThunderbirdsLogic.Signal('base');
    }
    this.enterRoom(room);
  } // enterFrom

  /**
   * The game's start, as `$D9E9` leaves it when the first room stands and
   * the loop is reached (`$E269`): the screen and the room of M2, the state
   * of the interrupt that the take-off left (data/global.json `entry`).
   */
  begin() {
    this.startMission();
    var entry = this.global.entry;
    if (entry.isr) {
      var isr = RoomRenderer.decode(entry.isr.bytes);
      for (var i = 0; i < entry.isr.addresses.length; i++) {
        this.mem[entry.isr.addresses[i]] = isr[i];
      }
    }
    this.roomStarts();
  } // begin

  // --- input ($F2C2) ------------------------------------------------------

  /**
   * ★ `$F2C2`: the keyboard is read once a pass, and only while nothing
   * moves: no push being drawn (`$E778`), no turn (`$656B`), no block
   * falling (`$656F`), the craft between steps (`$6562`).
   */
  input() {
    var m = this.mem;
    if (m[0xE778] || m[0x656B] || m[0x656F] || m[0x6562]) {
      return;
    }
    var de = this.keyScan();
    var e = de & 0xFF;
    if (e === 0x10) {
      // ★ $E5B2: M — the tune on and off
      this.share(0x6547, m[0x6547] ^ 0x05);
      this.wait(0x2710);
      return;
    }
    if (m[0x5D11]) {
      return;
    }
    if (de === 0x0826) {
      this.cheatCheck();                // $E5FD
      return;
    }
    if (de === 0x2720) {
      this.abort();                     // $F2A8: BREAK
    }
    if (e === 0x11) {
      this.setWord(0xF396, this.word(0xF396)+1);      // $F383: K
      return;
    }
    if (e === 0x09) {
      var delay = (this.word(0xF396)-1) & 0xFFFF;     // $F38B: J
      if (delay) {
        this.setWord(0xF396, delay);
      }
      return;
    }
    var ix = this.word(0x656D);
    m[0x6564] = m[ix+7];
    if (e === 0xFF) {
      // $F35E: Kempston at port $1F — ? not in the remake: an unconnected
      // port reads $FF, AND $E0 is not 0, RET
      return;
    }
    if (e === m[0x5D0B]) {
      this.left(ix);
    } else if (e === m[0x5D0C]) {
      this.right(ix);
    } else if (e === m[0x5D0D]) {
      this.up(ix);
    } else if (e === m[0x5D0E]) {
      this.down(ix);
    } else if (e === m[0x5D0F]) {
      this.fire();
    } else if (e === 0x22) {
      this.notPorted('$E5D4 (the pause key)');
    } else if (e === 0x1E || e === 0x19) {
      this.notPorted('$E3EC / $E408 (saving and loading)');
    } else if (m[0x655D] === 4) {
      this.cheatKeys(e);
    }
  } // input

  /** ★ `$E5FD`: the cheat, when `$FFFF` is $0A and the keys are the original's. */
  cheatCheck() {
    var m = this.mem;
    if (m[0xFFFF] !== 0x0A) {
      return;
    }
    for (var i = 0; i < 5; i++) {
      if (m[0xF3D2+i] !== m[0x5D0B+i]) {
        return;
      }
    }
    m[0x655D] ^= 0x04;
  } // cheatCheck

  /** ★ `$F33F`: N, B — the next and the previous room; R — the room again. */
  cheatKeys(e) {
    var m = this.mem;
    if (e === 0x08 || e === 0x00) {
      var room = e === 0x08 ? (m[0x6561]+1) & 0xFF : (m[0x6561]-1) & 0xFF;
      if (e === 0x08 && room === 0x62) {
        room = 1;
      }
      m[0x6561] = room;
      m[this.word(0x656D)+0x0E] = room;
      this.restart(m[0x6561]);
    } else if (e === 0x0D) {
      for (var i = 0; i < 0x04CB; i++) {
        m[0x667B+i] = m[0x85F1+i];
      }
      this.enterFrom(m[0x6561], false);
    }
  } // cheatKeys

  /**
   * ★ `$F2A8`: BREAK — a life (unless the cheat) and the mission from the
   * start, `$E1E6`.
   */
  abort() {
    var m = this.mem;
    if (m[0x655D] !== 4) {
      var lives = (m[0x5CF4]-1) & 0xFF;
      if (lives === 0) {
        this.gameOver();
      }
      m[0x5CF4] = lives;
    }
    this.missionAgain(0x31);
  } // abort

  /**
   * ★ `$E1E6`: the blocks back where the mission started them, Thunderbird 1
   * under control, the rooms' things counted anew, both craft in room $31.
   */
  missionAgain(room) {
    var m = this.mem;
    for (var i = 0; i < 0x04CB; i++) {
      m[0x667B+i] = m[0x85F1+i];
    }
    this.setWord(0x656D, 0x5CCC);
    this.setWord(0x653C, 0x79C9);
    for (var r = 0, ix = 0x7F9A; r < 0x61; r++, ix += 13) {
      m[ix+0x0B] = m[ix+9];
    }
    this.craftReset(0x5CCC, 0x08, 0x0F, 0x03, 0x01, 0x69, 0x05);
    m[0x5CCC+0x0E] = 0x31;
    this.craftReset(0x5CDC, 0x08, 0x11, 0x02, 0x04, 0x29, 0x04);
    m[0x5CDC+0x0E] = 0x31;
    this.setWord(0x5C36, 0x79C9);
    m[0x65E6] = 0;
    m[0x65E7] = 0;
    this.restart(room);
  } // missionAgain

  /** ★ `$F056`: a craft's record — C, B, aligned, E × D, code A, colour L. */
  craftReset(ix, c, b, e, d, a, l) {
    var m = this.mem;
    m[ix] = c;
    m[ix+0x0A] = c;
    m[ix+1] = b;
    m[ix+0x0B] = b;
    m[ix+2] = 7;
    m[ix+3] = 7;
    m[ix+0x0C] = 7;
    m[ix+0x0D] = 7;
    m[ix+4] = e;
    m[ix+5] = d;
    m[ix+6] = a;
    m[ix+7] = l;
    m[ix+8] = 0;
    m[ix+9] = 0;
  } // craftReset

  // --- the four directions ($F10F, $F087, $F19B, $F1F4) ----------------------

  /**
   * ★ What a craft finds in the cells it moves into (`$F0DB` and its kin):
   * $FF a life, $82 fuel, $81 a thing to pick up — each taken (`A` is then
   * 0) —, $20 and 0 free, 1-8 a block, $83 an enemy (no matter), $21 and
   * above a wall or the other craft: the step stops (`$F190`).
   */
  take(at, a) {
    if (a === 0xFF) {
      return this.life(at);             // $E760
    }
    if (a === 0x82) {
      return this.fuel(at);             // $E755
    }
    if (a === 0x81) {
      return this.thing(at);            // $E745
    }
    return a;
  } // take

  /** ★ `$F190`: the step stops. */
  stop(ix) {
    this.mem[0x6562] = 0;
    this.mem[ix+8] = 0;
    this.mem[ix+9] = 0;
  } // stop

  /** ★ `$F087`: RIGHT. */
  right(ix) {
    var m = this.mem;
    m[0x656A] = 0xFF;
    if (m[0x6564] === 4) {
      if (m[ix+6] !== 0x61) {
        this.turn(0x08);
        return;
      }
    } else if (m[ix+6] !== 0x7E) {
      this.turn(0x03);
      return;
    }
    m[ix+8] = 0xFF;
    m[0x6562] = 8;
    var p = this.nextPos(ix);
    var c = (p.c-m[ix+4]) & 0xFF;
    if (c < 2 || c >= 0x80) {
      return;
    }
    this.sideCells(ix, p.b, c, true);
    if (m[0x656A] !== 0xFF) {
      this.pushRight(m[0x656A]);
    }
  } // right

  /** ★ `$F10F`: LEFT. */
  left(ix) {
    var m = this.mem;
    m[0x656A] = 0xFF;
    if (m[0x6564] === 4) {
      if (m[ix+6] !== 0x29) {
        this.turn(0xF8);
        return;
      }
    } else if (m[ix+6] !== 0x69) {
      this.turn(0xFD);
      return;
    }
    m[ix+8] = 1;
    m[0x6562] = 8;
    var p = this.nextPos(ix);
    if (p.c >= 0x22) {
      return;
    }
    this.sideCells(ix, p.b, p.c, false);
    if (m[0x656A] !== 0xFF) {
      this.pushLeft(m[0x656A]);
    }
  } // left

  /** ★ `$F09A` and its kin: a turn — seven steps of the sprite's code by A. */
  turn(step) {
    this.mem[0x656B] = 7;
    this.mem[0x656C] = step;
  } // turn

  /**
   * ★ `$F0CE`-`$F104` (right) and `$F14F`-`$F185` (left): the column at B, C
   * over the craft's height.
   */
  sideCells(ix, b, c, right) {
    var m = this.mem;
    var at = 0x5EF6+this.shadowIndex(b, c);
    for (var n = m[ix+5]; n > 0; n--, at += 0x20) {
      var a = this.take(at, m[at]);
      if (right) {
        if (a === 0x20 || a === 0x00) {
          continue;
        }
      } else if (a === 0x00 || a === 0x20) {
        continue;
      }
      if (a < 0x09) {
        m[0x656A] = a;
      }
      if (a === 0x83) {
        continue;
      }
      if (a >= 0x21) {
        this.stop(ix);
      }
    }
  } // sideCells

  /** ★ `$F19B`: UP. */
  up(ix) {
    var m = this.mem;
    m[0x6562] = 8;
    m[ix+9] = 1;
    var c = m[ix], b = (m[ix+1]+1) & 0xFF;
    if (b >= 0x19) {
      return;
    }
    if (c >= 0x22) {
      this.stop(ix);
      return;
    }
    var at = 0x5EF6+this.shadowIndex(b, c);
    for (var n = m[ix+4]; n > 0; n--, at++) {
      var a = m[at];
      if (a === 0x81) {
        a = this.thing(at);
      }
      if (a === 0x82) {
        a = this.fuel(at);
      }
      if (a === 0x00 || a === 0x20 || a === 0x83) {
        continue;
      }
      if (a >= 0x21) {
        this.stop(ix);
      }
      if (a < 0x09) {
        this.lift(ix, a);               // $E7B5
        if (m[0x6562] === 0) {
          this.stop(ix);
        }
      }
    }
  } // up

  /** ★ `$F1F4`: DOWN. */
  down(ix) {
    var m = this.mem;
    m[ix+9] = 0xFF;
    m[0x6562] = 8;
    var p = this.nextPos(ix);
    var b = (p.b-m[ix+5]) & 0xFF;
    if (b < 5) {
      return;
    }
    if (p.c >= 0x22) {
      this.stop(ix);
      return;
    }
    var at = 0x5EF6+this.shadowIndex(b, p.c);
    for (var n = m[ix+4]; n > 0; n--, at++) {
      var a = m[at];
      if (a === 0xFF) {
        a = this.life(at);
      }
      if (a === 0x81) {
        a = this.thing(at);
      }
      if (a === 0x82) {
        a = this.fuel(at);
      }
      if (a === 0x00 || a === 0x83 || a === 0x20) {
        continue;
      }
      if (a < 0x09) {
        this.stop(ix);
        a = 0;                          // $F190 leaves A 0
      }
      if (a >= 0x21) {
        this.stop(ix);
      }
    }
    m[ix+0x0F] = 0;
  } // down

  /**
   * ★ `$F246`: FIRE — the other craft under control (not after Thunderbird
   * 1 has left, `$65E8`, and not in a room of the scatter), its icon on the
   * panel; in this room a pause, elsewhere its room is entered.
   */
  fire() {
    var m = this.mem;
    if (m[0x65E8]) {
      return;
    }
    var room = this.word(0x6568);
    if (m[room+7] === 1) {
      return;
    }
    this.setWord(0x5C36, 0x79C9);
    if (this.word(0x656D) === 0x5CCC) {
      this.setWord(0x656D, 0x5CDC);
      this.icon(0x04, 0x61);            // $EEB5
    } else {
      this.setWord(0x656D, 0x5CCC);
      this.icon(0x05, 0x57);            // $EEAF
    }
    var ix = this.word(0x656D);
    if (m[0x6561] === m[ix+0x0E]) {
      this.wait(0x4E20);
      return;
    }
    this.enterFrom(m[ix+0x0E], true);
  } // fire

  /** ★ `$EEB9`: the icon of the craft under control on the panel. */
  icon(attribute, code) {
    var m = this.mem;
    this.setWord(0x5C36, 0x79C9);
    m[0x5C8F] = attribute;
    m[0x6537] = 0;
    this.printBlock(code, 0x02, 0x20, 0x02, 0x05);
    m[0x6537] = 4;
  } // icon

  // --- pick-ups ($E690, $E745, $E755, $E760) ---------------------------------

  /** ★ `$E690`: the cell at shadow address HL emptied — $20, attributes 0. */
  takeCell(at) {
    var m = this.mem;
    m[at] = 0x20;
    m[at+0x320] = 0;
    this.wr(at+0x320-0x6216+0x5800, 0);
    return 0;
  } // takeCell

  /** ★ `$E745`: a thing ($81) — 100 points, a sound. */
  thing(at) {
    this.mem[0x5CFD] = 1;
    this.share(0x6551, 1);
    this.mem[0x5CFE] = 2;
    return this.takeCell(at);
  } // thing

  /** ★ `$E755`: fuel ($82) — 20 eighths of the gauge, a sound. */
  fuel(at) {
    this.mem[0x5CF3] = 0x14;
    this.share(0x6550, 0x14);
    return this.takeCell(at);
  } // fuel

  /** ★ `$E760`: a life ($FF), at most four. */
  life(at) {
    var m = this.mem;
    this.takeCell(at);
    if (m[0x5CF4] !== 4) {
      m[0x5CF4] = (m[0x5CF4]+1) & 0xFF;
      m[0x655A] = m[0x5CF4];
    }
    return 0;
  } // life

  // --- pushing and lifting blocks ------------------------------------------

  /** IX of block n: $6573 + 14 (n − 1). */
  block(n) {
    return (0x6565+14*(n === 0 ? 256 : n)) & 0xFFFF;
  } // block

  /** A block the craft may move: colour 2, or the craft's own colour (`$6564`). */
  movable(ix) {
    var m = this.mem;
    return m[ix+7] === 2 || m[ix+7] === m[0x6564];
  } // movable

  /**
   * ★ `$EA33`: the move refused — the step of the craft stops.
   */
  refuse() {
    var m = this.mem;
    m[0x6562] = 0;
    var craft = this.word(0x656D);
    m[craft+8] = 0;
    m[craft+9] = 0;
  } // refuse

  /**
   * ★ `$E7B5`: UP into block A — the block, and every block on it, goes up
   * with the craft (+9 = 1, `$656F` 8), if nothing but blocks lies above
   * them; the craft carries the top one's number in +$0F.
   */
  lift(craft, a) {
    var m = this.mem;
    if (m[0x6562] === 0) {
      return;
    }
    var chain = [];
    m[craft+9] = 0;
    m[0x6562] = 0;
    for (;;) {
      var ix = this.block(a);
      m[0x656A] = a;
      if (!this.movable(ix)) {
        this.refuse();
        return;
      }
      chain.push(ix);
      this.maskUp(ix);                  // $EB5B
      a = this.test((m[ix+1]+1) & 0xFF, m[ix]);
      if (a === 0xFF) {
        break;
      }
      if (a >= 0x21) {
        this.refuse();
        return;
      }
    }
    while (chain.length) {
      m[chain.pop()+9] = 1;
      m[0x656F] = 8;
    }
    m[0x6562] = 8;
    craft = this.word(0x656D);
    m[craft+9] = 1;
    m[craft+0x0F] = m[0x656A];
  } // lift

  /**
   * ★ `$E82A`: RIGHT into block A. The chain of blocks before the craft is
   * followed while each may move; if the cells beyond the last are free,
   * all of them slide (+8 = $FF, `$656F` 8, the push's noise). If the last
   * meets something that is neither wall nor block, of the craft's colour
   * and in its row, the craft **shoves** it a character at once in the
   * shadow map and the attributes, and the pixels follow in eight passes
   * (`$E773`, `$EEFB`).
   */
  pushRight(a) {
    this.push(a, false);
  } // pushRight

  /** ★ `$E95E`: LEFT into block A, the mirror of `$E82A`. */
  pushLeft(a) {
    this.push(a, true);
  } // pushLeft

  push(a, left) {
    var m = this.mem;
    if (m[0x6562] !== 8) {
      return;
    }
    var chain = [];
    var ix;
    for (;;) {
      ix = this.block(a);
      if (!this.movable(ix)) {
        this.refuse();
        return;
      }
      chain.push(ix);
      if (left) {
        this.maskLeft(ix);              // $EB90
      } else {
        this.maskRight(ix);             // $EBC4
      }
      var c = left ? (m[ix]+1) & 0xFF : (m[ix]-1) & 0xFF;
      if (c === (left ? 0x22 : 0x01)) {
        this.refuse();
        return;
      }
      a = this.test(m[ix+1], c);
      if (a === 0xFF) {
        // ★ $E907 / $EA48: the chain slides
        while (chain.length) {
          m[chain.pop()+8] = left ? 1 : 0xFF;
          m[0x656F] = 8;
          this.share(0x6553, 8);
        }
        return;
      }
      if (a < 0x29) {
        if (a >= 0x21) {
          this.refuse();
          return;
        }
        if (a < 0x09) {
          continue;                     // the next block of the chain
        }
      }
      break;
    }
    // ★ $E879: something else beyond the block
    if (a >= 0x69 ? m[0x6564] !== 5 : m[0x6564] !== 4) {
      this.refuse();
      return;
    }
    if (m[0x6564] !== m[ix+7]) {
      this.refuse();
      return;
    }
    ix = chain[chain.length-1];         // POP IX: the block pushed last
    var craft = this.word(0x656D);
    if (m[craft+1] !== m[ix+1]) {
      this.refuse();
      return;
    }
    var c0 = m[ix];
    m[ix] = (left ? c0+1 : c0-1) & 0xFF;
    this.shadowIndex(m[ix+1], left ? m[ix] : c0);
    var e = (m[craft+4]+2) & 0xFF, d = (m[craft+5]+1) & 0xFF;
    var shift = left ? this.shiftLeft : this.shiftRight;
    shift.call(this, 0x5EF6, 0, e, d);
    shift.call(this, 0x6216, 0, e, d);
    shift.call(this, 0x5800, m[craft+7], e, d);
    m[craft] = (left ? m[craft]+1 : m[craft]-1) & 0xFF;
    m[0xE773] = (m[craft]+(left ? 1 : 2)) & 0xFF;
    m[0xE774] = m[craft+1];
    m[0xE775] = (m[craft+4]+(left ? 2 : 3)) & 0xFF;
    m[0xE776] = (m[craft+5]+1) & 0xFF;
    m[0xE777] = left ? 1 : 0xFF;
    m[0xE778] = 8;
    this.share(0x6553, 8);
    this.refuse();                      // JP $EA33
  } // push

  /**
   * ★ `$E779`: E cells from the shadow index, D rows, moved one cell right
   * in the map at HL (`LDDR`), A into the cell left empty.
   */
  shiftRight(hl, a, e, d) {
    var m = this.mem;
    var at = (hl+this.word(0x653E)+e) & 0xFFFF;
    for (var row = d; ; ) {
      for (var i = 0; i < e; i++) {
        this.wr(at-i, this.rd(at-i-1));
      }
      this.wr(at-e, a);
      row = (row-1) & 0xFF;
      if (row === 0) {
        return;
      }
      at = (at+0x20) & 0xFFFF;
    }
  } // shiftRight

  /** ★ `$E799`: the same one cell left (`LDIR`). */
  shiftLeft(hl, a, e, d) {
    var at = (hl+this.word(0x653E)) & 0xFFFF;
    for (var row = d; ; ) {
      for (var i = 0; i < e; i++) {
        this.wr(at+i, this.rd(at+i+1));
      }
      this.wr(at+e, a);
      row = (row-1) & 0xFF;
      if (row === 0) {
        return;
      }
      at = (at+0x20) & 0xFFFF;
    }
  } // shiftLeft

  /**
   * ★ `$E920`: what lies under the mask at `$F3D8` laid on the shadow map at
   * B, C — $FF all free; a wall ($21-$28) at once; else the last other code
   * met (`$6571`).
   */
  test(b, c) {
    var m = this.mem;
    m[0x6571] = 0xFF;
    var at = 0x5EF6+this.shadowIndex(b, c);
    for (var mask = 0xF3D8; m[mask] !== 0xFF; mask++, at += 0x20) {
      var bits = m[mask];
      for (var i = 0; i < 8; i++, bits <<= 1) {
        if (!(bits & 0x80)) {
          continue;
        }
        var a = this.rd(at+i);
        if (a === 0x20 || a === 0) {
          continue;
        }
        if (a < 0x29 && a >= 0x21) {
          return a;
        }
        m[0x6571] = a;
      }
    }
    return m[0x6571];
  } // test

  // --- the masks of a block's shape ($F3D8) -----------------------------------

  /** The shape's rows (+4/+5), and a mask row into `$F3D8` + i. */
  shape(ix) {
    return this.mem[ix+4] | (this.mem[ix+5] << 8);
  } // shape

  /** ★ `$EB5B`: the top edge — each row less the row before it. */
  maskUp(ix) {
    var m = this.mem;
    var hl = this.shape(ix), de = 0xF3D8, c = 0;
    for (;;) {
      m[de] = (c | this.rd(hl))-c;
      c = this.rd(hl);
      hl = (hl+1) & 0xFFFF;
      de++;
      if (this.rd(hl) === 0) {
        m[de] = 0xFF;
        return;
      }
    }
  } // maskUp

  /** ★ `$EB74`: the bottom edge — each row less the row after it. */
  maskDown(ix) {
    var m = this.mem;
    var hl = this.shape(ix), de = 0xF3D8;
    var c = this.rd(hl);
    hl = (hl+1) & 0xFFFF;
    for (;;) {
      var next = this.rd(hl);
      m[de] = ((c | next)-next) & 0xFF;
      if (this.rd((hl-1) & 0xFFFF) === 0) {
        m[de] = 0xFF;
        return;
      }
      de++;
      c = this.rd(hl);
      hl = (hl+1) & 0xFFFF;
    }
  } // maskDown

  /** ★ `$EB90`: the left edge of each row. */
  maskLeft(ix) {
    var m = this.mem;
    var hl = this.shape(ix), de = 0xF3D8;
    do {
      var e = this.rd(hl), d = 0, a = 0;
      for (var i = 0; i < 8; i++) {
        var bit = e & 0x80;
        e = (e << 1) & 0xFF;
        if (!bit) {
          d = (d << 1) & 0xFF;
          a = 0;
        } else if (a === 1) {
          d = (d << 1) & 0xFF;
        } else {
          d = ((d << 1) | 1) & 0xFF;
          a = 1;
        }
      }
      m[de++] = d;
      hl = (hl+1) & 0xFFFF;
    } while (this.rd(hl) !== 0);
    m[de] = 0xFF;
  } // maskLeft

  /** ★ `$EBC4`: the right edge of each row. */
  maskRight(ix) {
    var m = this.mem;
    var hl = this.shape(ix), de = 0xF3D8;
    do {
      var e = this.rd(hl), d = 0, a = 0;
      for (var i = 0; i < 8; i++) {
        var bit = e & 0x01;
        e >>= 1;
        if (!bit) {
          d >>= 1;
          a = 0;
        } else if (a === 1) {
          d >>= 1;
        } else {
          d = (d >> 1) | 0x80;
          a = 1;
        }
      }
      m[de++] = d;
      hl = (hl+1) & 0xFFFF;
    } while (this.rd(hl) !== 0);
    m[de] = 0xFF;
  } // maskRight

  // --- the blocks fall and move ($EA5D, $EBF6) --------------------------------

  /**
   * ★ `$EA5D`: which blocks fall — every block whose bottom edge stands on
   * nothing (or on a craft) starts falling (+9 = $FF, `$656F` 8). A craft
   * under it is crushed unless it carries that block (+$0F); a block that
   * comes to rest after falling makes its sound (`$65E9` + n, `$654E`).
   */
  fallCheck() {
    var m = this.mem;
    if (m[0xE778]) {
      return;
    }
    m[0x656A] = 0;
    if (m[0x6562] || m[0x656F]) {
      return;
    }
    for (var ix = 0x6573; ; ix = (ix+14) & 0xFFFF) {
      m[0x65E4] = 0;
      m[0x65E5] = 0;
      m[0x656A] = (m[0x656A]+1) & 0xFF;
      if (m[ix] === 0xFF) {
        return;
      }
      this.maskDown(ix);
      var at = 0x5EF6+this.shadowIndex((m[ix+1]-1) & 0xFF, m[ix]);
      var blocked = false;
      for (var mask = 0xF3D8; !blocked && m[mask] !== 0xFF; mask++, at += 0x20) {
        var bits = m[mask];
        for (var i = 0; i < 8; i++, bits <<= 1) {
          if (!(bits & 0x80)) {
            continue;
          }
          var a = this.rd(at+i);
          if (a >= 0x29) {
            if (a < 0x69) {
              m[0x65E5] = a;
            } else {
              m[0x65E4] = a;
            }
          } else if (a !== 0 && a !== 0x20) {
            blocked = true;
            break;
          }
        }
      }
      var landed = 0x65E9+m[0x656A];
      if (blocked) {
        // ★ $EB32
        if (m[landed]) {
          this.share(0x654E, 4);
          m[landed] = 0;
        }
        m[ix+9] = 0;
        m[0x65E4] = 0;
        m[0x65E5] = 0;
        continue;
      }
      m[landed] = 1;
      if (m[0x65E4]) {
        if (m[0x5CDB] === m[0x656A]) {
          continue;
        }
        this.crushed(1);
      }
      if (m[0x65E5]) {
        if (m[0x5CEB] === m[0x656A]) {
          continue;
        }
        this.crushed(2);
      }
      m[ix+9] = 0xFF;
      m[0x656F] = 8;
    }
  } // fallCheck

  /** ★ `$EAEF` / `$EB13`: a craft under a falling block. */
  crushed(which) {
    var m = this.mem;
    m[0x5CED] = which;
    m[0x5CF0] = 0x10;
    m[0x5CEF] = 0x10;
    this.shareWord(0x6544, 0x0FFF);
  } // crushed

  /**
   * ★ `$EBF6`: the blocks that move go a pixel further (eight passes, a
   * character); when the last pass is done, which ones fall is checked again
   * (`JP $EA5D`).
   */
  blocksMove() {
    var m = this.mem;
    if (m[0xE778] || m[0x656F] === 0) {
      return;
    }
    m[0x656F] = (m[0x656F]-1) & 0xFF;
    m[0x6570] = 1;
    for (var ix = 0x6573; m[ix] !== 0xFF; ix = (ix+14) & 0xFFFF) {
      if (m[ix+8] | m[ix+9]) {
        if (m[ix+9] === 0xFF) {
          this.blockDraw(ix);
        }
        if (m[ix+8] === 0xFF) {
          this.blockDraw(ix);
        }
        var p = this.nextPos(ix);
        this.moveRecord(ix, p);
        if (m[ix+9] === 1) {
          this.blockDraw(ix);
        }
        if (m[ix+8] === 1) {
          this.blockDraw(ix);
        }
        if (m[0x656F] === 0) {
          m[ix+8] = 0;
          m[ix+9] = 0;
        }
      }
      m[0x6570] = (m[0x6570]+1) & 0xFF;
    }
    this.fallCheck();
  } // blocksMove

  /**
   * ★ `$EC5D`: a block a pixel on — vertically a line of its edge drawn
   * and one wiped; at a character's end the attributes, the shadow map's
   * colours and its number go a cell on. Horizontally its edge columns are
   * XORed a pixel on.
   */
  blockDraw(ix) {
    var m = this.mem;
    if (m[ix+8]) {
      this.blockDrawSide(ix);
      return;
    }
    var dir = m[ix+9];
    if (dir >= 0x80) {
      this.blockDrawDown(ix);
      return;
    }
    if (dir === 0) {
      return;
    }
    // up
    this.maskUp(ix);
    if (m[ix+3] === 0) {
      m[0x6572] = m[ix+7];
      this.fillMasked(0x5800, m[ix+1], m[ix]);
      this.fillMasked(0x6216, m[ix+1], m[ix]);
      m[0x6572] = m[0x6570];
      this.fillMasked(0x5EF6, m[ix+1], m[ix]);
      this.maskDown(ix);
      this.clearMasked((m[ix+1]-1) & 0xFF, m[ix]);
      this.maskUp(ix);
    }
    m[0x6572] = 0xFF;
    this.lineMasked(ix, m[ix+1], m[ix]);
    this.maskDown(ix);
    m[0x6572] = 0;
    this.lineMasked(ix, (m[ix+1]-1) & 0xFF, m[ix]);
  } // blockDraw

  /** ★ `$ECFD`: a block a pixel down. */
  blockDrawDown(ix) {
    var m = this.mem;
    this.maskDown(ix);
    if (m[ix+3] === 7) {
      m[0x6572] = m[ix+7];
      var b = (m[ix+1]-1) & 0xFF;
      this.fillMasked(0x5800, b, m[ix]);
      this.fillMasked(0x6216, b, m[ix]);
      m[0x6572] = m[0x6570];
      this.fillMasked(0x5EF6, b, m[ix]);
    }
    m[0x6572] = 0xFF;
    this.lineMasked(ix, (m[ix+1]-1) & 0xFF, m[ix]);
    this.maskUp(ix);
    m[0x6572] = 0;
    this.lineMasked(ix, m[ix+1], m[ix]);
    if (m[ix+3] !== 0) {
      return;
    }
    m[0x6572] = 0x20;
    this.fillMasked(0x5EF6, m[ix+1], m[ix]);
  } // blockDrawDown

  /** ★ `$ED62`: a block a pixel left (+8 = 1) or right ($FF). */
  blockDrawSide(ix) {
    var m = this.mem;
    var dir = m[ix+8];
    if (dir < 0x80) {
      // left
      this.maskLeft(ix);
      if (m[ix+2] === 0) {
        m[0x6572] = m[ix+7];
        this.fillMasked(0x5800, m[ix+1], m[ix]);
        this.fillMasked(0x6216, m[ix+1], m[ix]);
        m[0x6572] = m[0x6570];
        this.fillMasked(0x5EF6, m[ix+1], m[ix]);
        this.maskRight(ix);
        this.clearMasked(m[ix+1], (m[ix]-1) & 0xFF);
        this.maskLeft(ix);
      }
      m[0x6572] = this.pixel(m[ix+2]);
      this.xorMasked(m[ix+1], m[ix]);
      this.maskRight(ix);
      this.xorMasked(m[ix+1], (m[ix]-1) & 0xFF);
      return;
    }
    // right ($EDC9)
    this.maskRight(ix);
    if (m[ix+2] === 7) {
      m[0x6572] = m[ix+7];
      var c = (m[ix]-1) & 0xFF;
      this.fillMasked(0x5800, m[ix+1], c);
      this.fillMasked(0x6216, m[ix+1], c);
      m[0x6572] = m[0x6570];
      this.fillMasked(0x5EF6, m[ix+1], c);
      this.maskLeft(ix);
      this.clearMasked(m[ix+1], m[ix]);
      this.maskRight(ix);
    }
    m[0x6572] = this.pixel(m[ix+2]);
    this.maskRight(ix);
    this.xorMasked(m[ix+1], (m[ix]-1) & 0xFF);
    this.maskLeft(ix);
    this.xorMasked(m[ix+1], m[ix]);
  } // blockDrawSide

  /**
   * ★ `$EDA7`: `XOR A / CCF` (carry 1), then B = +2 + 1 turns of `RLA` —
   * one bit set, bit +2.
   */
  pixel(sub) {
    var a = 0, carry = 1;
    for (var n = (sub+1) & 0xFF || 256; n > 0; n--) {
      var out = a >> 7;
      a = ((a << 1) | carry) & 0xFF;
      carry = out;
    }
    return a;
  } // pixel

  /**
   * ★ `$ECD5`: under the mask, a pixel line of each cell — line 7 − (+3) —
   * set to `$6572`.
   */
  lineMasked(ix, b, c) {
    var m = this.mem;
    for (var de = 0xF3D8; ; de++) {
      this.setPos(b, c);
      var hl = this.word(0x5C84);
      hl = (hl+((7-m[ix+3]) << 8)) & 0xFFFF;
      var bits = m[de];
      if (bits === 0xFF) {
        return;
      }
      for (var i = 0; i < 8; i++, bits <<= 1, hl++) {
        if (bits & 0x80) {
          this.wr(hl, m[0x6572]);
        }
      }
      b = (b-1) & 0xFF;
    }
  } // lineMasked

  /** ★ `$EE29`: under the mask, all eight lines of each cell XORed with `$6572`. */
  xorMasked(b, c) {
    var m = this.mem;
    for (var de = 0xF3D8; ; de++) {
      this.setPos(b, c);
      this.shadowIndex(b, c);
      var hl = this.word(0x5C84);
      var bits = m[de];
      if (bits === 0xFF) {
        return;
      }
      for (var i = 0; i < 8; i++, bits <<= 1, hl++) {
        if (bits & 0x80) {
          for (var line = 0; line < 8; line++) {
            var at = (hl+(line << 8)) & 0xFFFF;
            this.wr(at, this.rd(at) ^ m[0x6572]);
          }
        }
      }
      b = (b-1) & 0xFF;
    }
  } // xorMasked

  /** ★ `$EE59`: under the mask, the block's number (`$6570`) in the shadow map → $20. */
  clearMasked(b, c) {
    var m = this.mem;
    var at = 0x5EF6+this.shadowIndex(b, c);
    for (var de = 0xF3D8; m[de] !== 0xFF; de++, at += 0x20) {
      var bits = m[de];
      for (var i = 0; i < 8; i++, bits <<= 1) {
        if ((bits & 0x80) && this.rd(at+i) === m[0x6570]) {
          this.wr(at+i, 0x20);
        }
      }
    }
  } // clearMasked

  /** ★ `$EE85`: under the mask, `$6572` into the cells of the map at HL. */
  fillMasked(hl, b, c) {
    var m = this.mem;
    var at = (hl+this.shadowIndex(b, c)) & 0xFFFF;
    for (var de = 0xF3D8; m[de] !== 0xFF; de++, at = (at+0x20) & 0xFFFF) {
      var bits = m[de];
      for (var i = 0; i < 8; i++, bits <<= 1) {
        if (bits & 0x80) {
          this.wr(at+i, m[0x6572]);
        }
      }
    }
  } // fillMasked

  // --- a thing moves: $FA72, $F4EF, $F9A9 ------------------------------------

  /**
   * ★ `$FA72` (`$F469`): where a record's thing comes next — +2/+3 (7 is
   * on the character) plus the direction +8/+9, carried into C/B.
   * @returns {{c: number, b: number, e: number, d: number}}
   */
  nextPos(ix) {
    var m = this.mem;
    var c = m[ix], b = m[ix+1];
    var a = (m[ix+8]+m[ix+2]) & 0xFF;
    if (a >= 8) {
      c = a < 0x80 ? (c+1) & 0xFF : (c-1) & 0xFF;
      a &= 7;
    }
    var e = a;
    a = (m[ix+9]+m[ix+3]) & 0xFF;
    if (a >= 8) {
      b = a < 0x80 ? (b+1) & 0xFF : (b-1) & 0xFF;
      a &= 7;
    }
    return {c: c, b: b, e: e, d: a};
  } // nextPos

  /** ★ `$F4EF` (`$F427`): the old place into +$0A-+$0D, the new into +0-+3. */
  moveRecord(ix, p) {
    var m = this.mem;
    m[ix+0x0A] = m[ix];
    m[ix] = p.c;
    m[ix+0x0B] = m[ix+1];
    m[ix+1] = p.b;
    m[ix+0x0C] = m[ix+2];
    m[ix+2] = p.e;
    m[ix+0x0D] = m[ix+3];
    m[ix+3] = p.d;
  } // moveRecord

  /**
   * ★ `$F9A9` (`$F463`): when a thing has just come onto a character, the
   * column (or row) it left is wiped — blank characters (a buffer of zeros
   * at `$5D66`) and $20 in the shadow map.
   */
  wipe(ix, p) {
    var m = this.mem;
    var b = p.b, c = p.c, d = p.d, e = p.e;
    var dir = m[ix+8];
    if (dir) {
      if (e !== 7) {
        return;
      }
      if (dir === 0xFF) {
        c = (c+1) & 0xFF;
      } else {
        c = (c-m[ix+4]) & 0xFF;
      }
      e = 1;
      d = m[ix+5];
    } else {
      dir = m[ix+9];
      if (!dir || d !== 7) {
        return;
      }
      d = 1;
      if (dir === 0xFF) {
        b = (b+1) & 0xFF;
      } else {
        b = (b-m[ix+5]) & 0xFF;
      }
      e = m[ix+4];
    }
    var chars = this.word(0x5C36);
    this.setWord(0x5C36, 0x5D66);
    for (var i = 0; i <= 0x50; i++) {
      m[0x5D66+i] = 0;
    }
    this.printBlock(0, b, c, d, e);
    this.setWord(0x5C36, chars);
    this.shadowBlock(0x20, b, c, d, e);
  } // wipe

  // --- the craft's step ($EF31) ---------------------------------------------

  /**
   * ★ `$EF31`: the craft under control — a turn (seven passes of its
   * sprite's code), or a step of eight; at the step's end its code into
   * the shadow map, and at the edge of the room into the next one.
   */
  craftStep() {
    var m = this.mem;
    if (m[0x5CEF]) {
      this.wait(0x02BC);                // $E5C0
      return;
    }
    if (m[0x656F]) {
      return;
    }
    if (m[0xE778]) {
      this.shove();                     // $EEFB
      return;
    }
    var ix = this.word(0x656D);
    this.setWord(0x5C36, 0x89BB);
    if (m[0x656B]) {
      m[0x656B] = (m[0x656B]-1) & 0xFF;
      m[ix+6] = (m[0x656C]+m[ix+6]) & 0xFF;
      this.sprite(ix);
      this.wait(0x07D0);
      return;
    }
    if (m[0x6562] === 0) {
      this.wait(0x02BC);
      return;
    }
    m[0x6562] = (m[0x6562]-1) & 0xFF;
    if (m[0x6562] === 7) {
      m[0xFE61] = 0xAE;                 // $FDFC: XOR (HL)
      this.light();
    }
    var p = this.nextPos(ix);
    this.moveRecord(ix, p);
    this.wipe(ix, p);
    this.sprite(ix);
    if (m[0x6562]) {
      return;
    }
    m[0xFE61] = 0xB6;                   // $FDF5: OR (HL)
    this.light();
    ix = this.word(0x656D);
    this.shadowBlock(m[ix+6], m[ix+1], m[ix], m[ix+5], m[ix+4]);
    m[ix+8] = 0;
    m[ix+9] = 0;
    this.edges(ix);
  } // craftStep

  /** ★ `$EFA5`: the craft at an edge of the room. */
  edges(ix) {
    var m = this.mem;
    var room = this.word(0x6568);
    var c = m[ix];
    if (c >= 0x23) {
      // left
      m[ix+0x0E] = m[room+1];
      m[ix] = 4;
      m[ix+0x0F] = 0;
      this.enterFrom(m[ix+0x0E], true);
      return;
    }
    if (c === 3) {
      // right
      var next = m[room+2];
      m[ix+0x0E] = next;
      m[ix] = 0x22;
      m[ix+0x0F] = 0;
      if (next === 0xFF) {
        this.leave(ix);                 // $E55F
        return;
      }
      this.enterFrom(next, true);
      return;
    }
    var b = m[ix+1];
    if (b === 8) {
      // ★ $F02C: the bottom of the shaft of layout $1F
      if (m[room+5] !== 0x1F || m[room+0x0C] === 0) {
        return;
      }
      this.hitBottom();
      return;
    }
    if (b >= 0x19) {
      // up
      m[ix+0x0E] = m[room+3];
      m[ix+1] = 5;
      m[ix+0x0F] = 0;
      this.enterFrom(m[ix+0x0E], true);
      return;
    }
    if (b < 5) {
      // down
      m[ix+0x0E] = m[room+4];
      m[ix+1] = 0x18;
      m[ix+0x0F] = 0;
      this.enterFrom(m[ix+0x0E], true);
      return;
    }
    if (b < 0x16 || c !== 0x1F || m[room+5] !== 0x1E) {
      return;
    }
    this.hitBottom();
  } // edges

  /** ★ `$F03B`: the craft under control crashes. */
  hitBottom() {
    var m = this.mem;
    if (this.word(0x656D) === 0x5CCC) {
      m[0x65E4] = 1;
    } else {
      m[0x65E5] = 2;
    }
    this.crash();
  } // hitBottom

  /**
   * ★ `$E55F`: a craft out of the right edge where there is no room: the
   * first time Thunderbird 1 leaves (its code out of the map, the edge
   * drawn, the other craft under control, `$65E8`); the second time the
   * mission is done — ROM texts, M4.
   */
  leave(ix) {
    var m = this.mem;
    if (m[0x65E8]) {
      // ★ $E590: WELL DONE … (ROM texts, a key) and back to the title — M4
      throw new ThunderbirdsLogic.Signal('missionComplete');
    }
    this.shadowBlock(0, m[ix+1], m[ix], m[ix+5], m[ix+4]);
    this.edgeRight();                   // $C92D
    this.fire();                        // $F246
    m[0x65E8] = 1;
    m[0x599E] = 0;
    m[0x59BE] = 0;
    m[0x6094] = 0x20;
    m[0x60B4] = 0x20;
  } // leave

  /**
   * ★ `$EEFB`: the shove drawn — the record at `$E773` (C, B, width, height,
   * direction, passes) scrolls its cells a pixel a pass.
   */
  shove() {
    var m = this.mem;
    m[0xE778] = (m[0xE778]-1) & 0xFF;
    var c = m[0xE773], b = m[0xE774], width = m[0xE775], d = m[0xE776];
    if (m[0xE777] === 1) {
      c = (c-width) & 0xFF;
      for (;;) {
        this.setPos(b, c);
        var hl = this.word(0x5C84);
        for (var line = 0; line < 8; line++) {
          var carry = 0;
          for (var n = (width+1) & 0xFF || 256, at = hl; n > 0; n--, at = (at-1) & 0xFFFF) {
            var v = this.rd(at);
            this.wr(at, (v << 1) | carry);
            carry = v >> 7;
          }
          hl = (hl+0x100) & 0xFFFF;
        }
        b = (b-1) & 0xFF;
        d = (d-1) & 0xFF;
        if (d === 0) {
          return;
        }
      }
    }
    for (;;) {
      this.setPos(b, c);
      var hl2 = this.word(0x5C84);
      for (var line2 = 0; line2 < 8; line2++) {
        var carry2 = 0;
        for (var n2 = width || 256, at2 = hl2; n2 > 0; n2--, at2 = (at2+1) & 0xFFFF) {
          var v2 = this.rd(at2);
          this.wr(at2, (v2 >> 1) | (carry2 << 7));
          carry2 = v2 & 1;
        }
        hl2 = (hl2+0x100) & 0xFFFF;
      }
      b = (b-1) & 0xFF;
      d = (d-1) & 0xFF;
      if (d === 0) {
        return;
      }
    }
  } // shove

  /**
   * ★ `$FE07`: in a dark room with the lamp (`$667A` bit 0) the walls around
   * the craft get attribute 6 — ORed when a step ends, XORed off when the
   * next begins (the operation is the self-modified byte `$FE61`).
   */
  light() {
    var m = this.mem;
    var room = this.word(0x6568);
    if (m[room+5] >= 0x1E) {
      return;
    }
    if (!(m[room+6] & m[room+7])) {
      return;
    }
    if (!(m[0x667A] & 1)) {
      return;
    }
    var ix = this.word(0x656D);
    var q = this.clip((m[ix+1]+1) & 0xFF, (m[ix]+1) & 0xFF, (m[ix+5]+2) & 0xFF, (m[ix+4]+2) & 0xFF);
    if (!q) {
      return;
    }
    var index = this.shadowIndex(q.b, q.c);
    var de = 0x5EF6+index, hl = 0x5800+index;
    var op = m[0xFE61];
    for (var row = q.d; ; ) {
      for (var col = 0; col < q.e; col++) {
        if (this.rd(de+col) === 0x21) {
          var a = 0x06;
          if (op === 0xB6) {
            a |= this.rd(hl+col);
          } else if (op === 0xAE) {
            a ^= this.rd(hl+col);
          }
          this.wr(hl+col, a);
        }
      }
      row = (row-1) & 0xFF;
      if (row === 0) {
        return;
      }
      de += 0x20;
      hl += 0x20;
    }
  } // light

  /**
   * ★ `$FDC1`: B, C, D, E cut down to the window `$6536`-`$6539`; null when
   * nothing is left (D or E 0).
   */
  clip(b, c, d, e) {
    var m = this.mem;
    var a = m[0x6536];
    if (a < b) {
      do {
        d = (d-1) & 0xFF;
        if (d === 0) {
          return null;
        }
        b = (b-1) & 0xFF;
      } while (a !== b);
    }
    var l = ((b-d) & 0xFF)+1 & 0xFF;
    a = m[0x6537];
    while (!(a < l)) {
      l = (l+1) & 0xFF;
      d = (d-1) & 0xFF;
      if (d === 0) {
        return null;
      }
    }
    a = m[0x6538];
    while (a < c) {
      e = (e-1) & 0xFF;
      if (e === 0) {
        return null;
      }
      c = (c-1) & 0xFF;
    }
    l = ((c-e) & 0xFF)+1 & 0xFF;
    a = m[0x6539];
    while (!(a < l)) {
      l = (l+1) & 0xFF;
      e = (e-1) & 0xFF;
      if (e === 0) {
        return null;
      }
    }
    return {b: b, c: c, d: d, e: e};
  } // clip

  // --- crashes and lives ($E3D0, $F4CB, $E61B, $E356) --------------------------

  /**
   * ★ `$E3D0`: a craft hit (`$65E4` Thunderbird 1, `$65E5` 2): sixteen
   * passes of crumbling, the crash's noise.
   */
  crash() {
    var m = this.mem;
    var a = m[0x65E4] | m[0x65E5];
    if (!a) {
      return;
    }
    m[0x5CED] = a;
    m[0x5CF0] = 0x10;
    m[0x5CEF] = 0x10;
    m[0x655B] = 0x10;
    this.shareWord(0x6544, 0x0FFF);
  } // crash

  /** ★ `$E3AE`: both craft hit (the time is up, or they met). */
  crashBoth() {
    var m = this.mem;
    if (m[0x5CEF]) {
      return;
    }
    m[0x65E5] = 2;
    m[0x65E4] = 1;
    m[0x5CED] = 3;
    m[0x5CF0] = 0x10;
    m[0x5CEF] = 0x10;
    this.shareWord(0x6544, 0x19FF);
  } // crashBoth

  /** ★ `$F4CB`: a pass of crumbling for the craft hit (`$5CED` bits). */
  crumble() {
    var m = this.mem;
    if (m[0x5CF0] === 0) {
      return;
    }
    m[0x5CF0] = (m[0x5CF0]-1) & 0xFF;
    if (m[0x5CED] & 1) {
      this.crumbleCraft(0x5CCC);
    }
    if (m[0x5CED] & 2) {
      this.crumbleCraft(0x5CDC);
    }
  } // crumble

  /** ★ `$F47E`: the craft's pixels ANDed with the generator, byte by byte. */
  crumbleCraft(ix) {
    var m = this.mem;
    var d = m[ix+5], e = m[ix+4];
    if (m[ix+3] !== 7) {
      d = (d+1) & 0xFF;
    }
    if (m[ix+2] !== 7) {
      e = (e+1) & 0xFF;
    }
    var q = this.clip(m[ix+1], m[ix], d, e);
    if (!q) {
      return;
    }
    var b = q.b, c = q.c;
    d = q.d;
    e = q.e;
    for (;;) {
      this.setPos(b, c);
      for (var line = 0; line < 8; line++) {
        var hl = this.word(0x5C84);
        this.setWord(0x5C84, (hl+0x100) & 0xFFFF);
        for (var n = e || 256; n > 0; n--, hl = (hl+1) & 0xFFFF) {
          var v = this.rd(hl);
          if (v !== 0xFF) {
            this.wr(hl, this.rand() & this.rd(hl));
          }
        }
      }
      b = (b-1) & 0xFF;
      d = (d-1) & 0xFF;
      if (d === 0) {
        return;
      }
    }
  } // crumbleCraft

  /**
   * ★ `$E61B`: the crumbling is over. A crash costs a life (none under the
   * cheat), the craft goes back where it came into the room, and the room
   * starts again; out of fuel (no crash) the game is over.
   */
  death() {
    var m = this.mem;
    this.share(0x6544, 0);
    if (m[0x655B] === 0) {
      this.gameOver();
    }
    if (m[0x655D] !== 4) {
      var lives = (m[0x5CF4]-1) & 0xFF;
      if (lives === 0) {
        this.gameOver();
      }
      m[0x5CF4] = lives;
    }
    m[0x5C8F] = 0x07;
    this.setWord(0x5C36, 0x79C9);
    this.drawLives(0x03, 0x21);
    this.wait(0x86A0);
    var ix = this.word(0x656D);
    this.craftReset(ix, m[0x5D12], m[0x5D13], m[ix+4], m[ix+5], m[0x655C], m[ix+7]);
    this.restart(m[0x6561]);
  } // death

  /** ★ `$E66A`: GAME OVER (ROM texts, a wait) and back to the title. */
  gameOver() {
    throw new ThunderbirdsLogic.Signal('gameOver');
  } // gameOver

  /** ★ `$E356`: the two craft in one room, too close — both crash. */
  craftsMeet() {
    var m = this.mem;
    if (m[0x5CEF]) {
      return;
    }
    if (m[0x5CDA] !== m[0x5CDC+0x0E]) {
      return;
    }
    var c = ((m[0x5CDC] << 3)+m[0x5CDE]) & 0xFF;
    var a = ((m[0x5CCC] << 3)+m[0x5CCE]+0x20-c) & 0xFF;
    if (a === 0 || a >= 0x37) {
      return;
    }
    c = ((m[0x5CCD] << 3)+m[0x5CCF]) & 0xFF;
    a = ((m[0x5CDD] << 3)+m[0x5CDF]+0x08-c) & 0xFF;
    if (a === 0 || a >= 0x17) {
      return;
    }
    this.crashBoth();
  } // craftsMeet

  // --- time, fuel, score ($E6BF, $F709, $F5C6, $F5E6, $F767) -------------------

  /**
   * ★ `$E6BF`: once a second (the interrupt's flag `$5CFC`) — the time;
   * at two hours both craft crash; every sixth second an eighth of the
   * fuel, and at its end the mission ends (ROM texts, M4).
   */
  clock() {
    var m = this.mem;
    if (this.shared(0x5CFC) === 0) {
      return;
    }
    if (m[0x5D11]) {
      return;
    }
    this.time1();                       // $F43F → $F709
    if (m[0x5CF6] === 2) {
      this.crashBoth();
      return;
    }
    m[0x65E7] = (m[0x65E7]+1) & 0xFF;
    if (m[0x65E7] !== 6) {
      return;
    }
    m[0x65E7] = 0;
    if (m[0x655D] === 4) {
      return;
    }
    this.fuelUse();                     // $F430 → $F5C6
    if (m[0x5CF2] !== 0 || m[0x5CF1] !== 0x1A || m[0x5CEF]) {
      return;
    }
    m[0x5CF0] = 0x10;
    m[0x5CEF] = 0x10;
    this.shareWord(0x6544, 0x0FFF);
    // ★ $E70A: OUT OF FUEL through the ROM's printing ($203C), then the
    // craft in the room crumble and the game is over ($E61B, $655B 0) — M4
    throw new ThunderbirdsLogic.Signal('outOfFuel');
  } // clock

  /** ★ `$F709`: a second on the clock (and a point every ten). */
  time1() {
    var m = this.mem;
    if (this.shared(0x5CFC) === 0) {
      return;
    }
    this.share(0x5CFC, 0);
    var hl = 0x5CFA;
    m[hl] = (m[hl]+1) & 0xFF;
    if (m[hl] < 0x0A) {
      this.time();
      return;
    }
    m[hl] = 0;
    this.setWord(0x5CFD, 0x0001);
    hl--;
    m[hl] = (m[hl]+1) & 0xFF;
    if (m[hl] < 0x06) {
      this.time();
      return;
    }
    m[hl] = 0;
    hl--;
    m[hl] = (m[hl]+1) & 0xFF;
    if (m[hl] < 0x0A) {
      this.time();
      return;
    }
    m[hl] = 0;
    hl--;
    m[hl] = (m[hl]+1) & 0xFF;
    if (m[hl] < 0x06) {
      this.time();
      return;
    }
    m[hl] = 0;
    hl--;
    var a = (m[hl]+1) & 0xFF;
    m[hl] = a;
    if (a === 0x04) {
      hl--;
      if (m[hl] === 0x02) {
        m[hl] = 0;
        m[hl+1] = 0;
      }
      this.time();
      return;
    }
    if (a >= 0x0A) {
      m[hl] = 0;              // ★ and the tens are counted but not kept ($F762)
    }
    this.time();
  } // time1

  /** ★ `$F5C6`: an eighth of the fuel gauge used. */
  fuelUse() {
    var m = this.mem;
    if (m[0x5CF2]) {
      m[0x5CF2] = (m[0x5CF2]-1) & 0xFF;
      this.gaugeEnd();
      return;
    }
    var a = (m[0x5CF1]+1) & 0xFF;
    if (a === 0x1B) {
      return;
    }
    m[0x5CF1] = a;
    m[0x5CF2] = 7;
    this.gaugeEnd();
  } // fuelUse

  /** ★ `$F5E6`: picked-up fuel goes into the gauge an eighth a pass. */
  refuel() {
    var m = this.mem;
    if (m[0x5CF3] === 0) {
      return;
    }
    m[0x5CF3] = (m[0x5CF3]-1) & 0xFF;
    var sub = (m[0x5CF2]+1) & 0xFF;
    m[0x5CF2] = sub;
    if (sub === 8) {
      var a = (m[0x5CF1]-1) & 0xFF;
      if (a === 0x0C) {
        return;
      }
      m[0x5CF1] = a;
      m[0x5CF2] = 0;
    }
    this.gaugeEnd();
  } // refuel

  /**
   * ★ `$F767`: points to add (`$5CFD` amount at digit `$5CFE` from the
   * right) carried through the five digits; then SCORE and HIGH (`$F799`).
   */
  addScore() {
    var m = this.mem;
    if (m[0x5CFD] === 0) {
      return;
    }
    for (;;) {
      var c = m[0x5CFD], b = m[0x5CFE];
      var at = (0x5D03-b) & 0xFFFF;
      if (at <= 0x5CFE) {
        break;
      }
      var a = (c+m[at]) & 0xFF;
      m[at] = a;
      if (a < 0x0A) {
        break;
      }
      m[at] = (a-0x0A) & 0xFF;
      m[0x5CFD] = 1;
      m[0x5CFE] = (b+1) & 0xFF;
    }
    this.scores();
  } // addScore

  /** ★ `$E4D9`: the pass's delay, (5 − enemies) × $78 turns of `$F8B6`. */
  passDelay() {
    var n = (5-this.mem[0x5D64]) & 0xFF;
    for (; n > 0; n--) {
      this.wait(0x78);
    }
  } // passDelay

  // --- the enemies ($F52B) and the special rooms' things ($FCB1) -------------

  /**
   * ★ `$F52B`: every enemy (`$5D64` records of 15 bytes at `$5D14`) a step —
   * every eighth pass it may turn (generator ≥ $E1, `$F514`) and turns away
   * from walls, edges and pick-ups; its sprite cycles $83-$86; it kills a
   * craft it touches (`$FBC9`).
   */
  enemiesStep() {
    var m = this.mem;
    m[0x65E4] = 0;
    m[0x65E5] = 0;
    m[0x5CEE] = 0;
    this.setWord(0x5C36, 0x89BB);
    var count = m[0x5D64];
    if (count === 0) {
      return;
    }
    for (var ix = 0x5D14; count > 0; count--, ix = (ix+15) & 0xFFFF) {
      m[ix+0x0E] = (m[ix+0x0E]+1) & 7;
      if (m[ix+0x0E] === 0) {
        var turn = this.rand() >= 0xE1;
        for (;;) {
          if (turn) {
            var dir = this.direction();
            m[ix+8] = dir.c;
            m[ix+9] = dir.b;
          }
          turn = true;
          var b = m[ix+1], c = m[ix];
          this.wr(0x5EF6+this.shadowIndex(b, c), 0x20);
          c = (m[ix+8]+c) & 0xFF;
          if (c === 0x22 || c === 0x01) {
            continue;
          }
          b = (m[ix+9]+b) & 0xFF;
          if (b === 0x19 || b === 0x04) {
            continue;
          }
          var a = this.rd(0x5EF6+this.shadowIndex(b, c));
          if (a === 0x21 || a === 0x81 || a === 0x82) {
            continue;
          }
          break;
        }
      }
      var code = (m[ix+6]+1) & 0xFF;
      if (code === 0x87) {
        code = 0x83;
      }
      m[ix+6] = code;
      var p = this.nextPos(ix);
      this.moveRecord(ix, p);
      this.wipe(ix, p);
      this.sprite(ix);
      this.hits(ix);
    }
  } // enemiesStep

  /**
   * ★ `$FBC9`: does the thing at IX touch a craft in this room — by pixels,
   * the thing's size from +4/+5 (written into the code's compares at
   * `$FBFF`, `$FC0C`, `$FC24`, `$FC31`). `$65E4` / `$65E5`.
   */
  hits(ix) {
    var m = this.mem;
    if (m[0x5CEF]) {
      return;
    }
    var w = ((m[ix+4] | (m[ix+5] << 8))*8) & 0xFFFF;
    var l = w & 0xFF, h = w >> 8;
    m[0xFBFF] = (0x18+l) & 0xFF;
    m[0xFC24] = (m[0xFBFF]+8) & 0xFF;
    m[0xFC0C] = (8+h) & 0xFF;
    m[0xFC31] = (m[0xFC0C]+8) & 0xFF;
    var near = (thing, craft, size) => {
      var c = ((m[thing] << 3)+m[thing+2]) & 0xFF;
      var a = ((m[craft] << 3)+m[craft+2]) & 0xFF;
      a = (a-(a < c ? 1 : 0)) & 0xFF;
      return (a+size-c) & 0xFF;
    };
    var craft = 0x5CCC;
    if (m[0x6561] === m[craft+0x0E]
        && near(ix, craft, l) < m[0xFBFF]
        && near(ix+1, craft+1, h) < m[0xFC0C]) {
      m[0x65E4] = 1;
    }
    craft = 0x5CDC;
    if (m[0x6561] === m[craft+0x0E]
        && near(ix, craft, l) < m[0xFC24]
        && near(ix+1, craft+1, h) < m[0xFC31]) {
      m[0x65E5] = 2;
    }
  } // hits

  /**
   * ★ `$FCB1` (`$C939`): the things of the special rooms — the spiders on
   * their threads (`$662F`, every pass ANDed by `$5BFF`) and the others
   * (`$65F3`, every fourth pass).
   */
  specialStep() {
    var m = this.mem;
    m[0x65E4] = 0;
    m[0x65E5] = 0;
    this.setWord(0x5C36, 0x93DC);
    var a = ((m[0xFDBF]+1) & 0xFF) & m[0x5BFF];
    m[0xFDBF] = a;
    if (a === 0) {
      for (var ix = 0x662F; m[ix] !== 0xFF; ix = (ix+18) & 0xFFFF) {
        var code = (m[ix+6]+4) & 0xFF;
        if (code === 0xD0) {
          code = 0xC0;
        }
        m[ix+6] = code;
        m[ix+0x11] = (m[ix+0x11]+m[ix+9]) & 0xFF;
        var c = m[ix+5], b = m[ix+3];
        m[ix+5] = 1;
        m[ix+3] = (b+4) & 7;
        this.hits(ix);
        m[ix+5] = c;
        m[ix+3] = b;
        var p = this.nextPos(ix);
        this.moveRecord(ix, p);
        this.spider(ix);
        m[ix+0x0F] = (m[ix+0x0F]-1) & 0xFF;
        if (m[ix+0x0F] === 0) {
          m[ix+0x0F] = m[ix+0x0E];
          m[ix+9] ^= 0xFE;
        }
      }
    }
    m[0xFDC0] = (m[0xFDC0]+1) & 3;
    if (m[0xFDC0] !== 0) {
      return;
    }
    for (var jx = 0x65F3; m[jx] !== 0xFF; jx = (jx+18) & 0xFFFF) {
      var f = (m[jx+6]+6) & 0xFF;
      if (f === 0x30) {
        f = 0;
      }
      if (f === 0x60) {
        f = 0x30;
      }
      if (f === 0x90) {
        f = 0x60;
      }
      if (f === 0xC0) {
        f = 0x90;
      }
      m[jx+6] = f;
      this.hits(jx);
      var q = this.nextPos(jx);
      this.moveRecord(jx, q);
      this.wipe(jx, q);
      this.sprite(jx);
      if (m[jx+2] === 7 && m[jx+0x0F] === m[jx]) {
        var dir = m[jx+8] ^ 0xFE;
        m[jx+8] = dir;
        var g = m[jx+6];
        if (dir === 1) {
          g = g < 0x60 ? 0x30 : 0x90;
        } else {
          g = g < 0x60 ? 0 : 0x60;
        }
        m[jx+6] = g;
        var t = m[jx+0x0F];
        m[jx+0x0F] = m[jx+0x0E];
        m[jx+0x0E] = t;
        var r = this.nextPos(jx);
        this.moveRecord(jx, r);
      }
    }
  } // specialStep

} // ThunderbirdsLogic

// ★ the handler's length, fitted (tools/measurecadence.mjs): T-states
ThunderbirdsLogic.ISR_BASE = 842;
ThunderbirdsLogic.ISR_FLAMES = 2131;
ThunderbirdsLogic.ISR_NOTE = 98712;
ThunderbirdsLogic.ISR_PULSE = 195;
ThunderbirdsLogic.ISR_PULSE_UNIT = 21;

/** How a pass ends early: `restart`, `gameOver`, `missionComplete`, `base`, `outOfFuel`. */
ThunderbirdsLogic.Signal = class {
  constructor(name) {
    this.name = name;
  }
};

if (typeof self !== 'undefined') { self.ThunderbirdsLogic = ThunderbirdsLogic; }
if (typeof module !== 'undefined' && module.exports) { module.exports = ThunderbirdsLogic; }
