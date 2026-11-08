// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * Thunderbirds game worker.
 *
 * It keeps the game — the original's own memory, 64 KB laid out as on the
 * machine — and runs its main loop and its interrupt through the port in
 * thunderbirdsLogic.js (sources/docs/physics.md); the model only sends it the
 * controls and draws the screen that comes back (WORKER-PROTOCOL.md).
 *
 * ★ **The game is the original's, pass for pass.** tools/matchphysics.mjs
 * runs thunderbirdsLogic.js against recordings of the original — the screen,
 * the variables, the shadow map, the craft, the blocks, the enemies, the
 * self-modified code compared after every pass, zero differences — starting
 * from the very data this worker gets (data/maze.json, data/global.json).
 *
 * **Two clocks**, as on the machine:
 *
 * - the **interrupt**, 50.08 Hz: `$A398` — the logo's flames, the seconds,
 *   the sounds (and the noise's turns of SEED). ★ The original's handler
 *   runs with DI, and a note of the game's tune alone takes 1.4 frames: a
 *   fifth of the interrupts are lost, and with them the game's seconds and
 *   fuel run slower than the clock on the wall. So here a tick runs the
 *   handler only if the last one is over (`logic.isrCost()`, its length
 *   fitted to the original's), else that interrupt is lost too
 * - the **pass** of the main loop: ★ the original's does not wait for the
 *   frame; a pass takes as long as its work, its delays and the interrupts
 *   that fall into it — 0.4 to 7 frames. The remake spends **the pass's own
 *   cost**: the T-states of the delays the pass burnt (`logic.waited`, the
 *   original's `$F8B6` loops, exact) plus a constant for the rest of its work
 *   (`WORK_T`, the original's average, tools/measurecadence.mjs). The next
 *   pass runs when that much time has gone by, of the time the frames leave
 *   beside the handler. The interrupt falls between passes, not inside one —
 *   what it shares with the pass is the same, only the moment differs
 *   (tools/matchphysics.mjs replays the original's moments). Over the
 *   recordings this clock comes within 5 % of the original's frames and 4 %
 *   of its interrupts
 *
 * ★ **The original's random number generator** is `$F8BC` (SEED at $5C76),
 * carried over in roomRenderer.js (`rand`); the noise moves SEED's low byte
 * (`$A50F`, thunderbirdsLogic.js `noiseStep`). `Math.random()` is never used
 * in game logic. The seed is the state of SEED when the first room is drawn;
 * tools/matchrand.mjs checks both functions against the Z80 code.
 *
 * ★ The clock is a recursive `setTimeout` with an accumulator (R-046): it
 * measures how much time really went by and spends it in whole ticks, at most
 * four at once, so a tab coming back from the background does not run off
 * with thousands of frames. `setInterval` is not used anywhere.
 */

var query = (typeof self !== 'undefined' && self.location) ? self.location.search : '';
if (typeof importScripts === 'function') {
  // the ROM's PIXEL-ADD and DRAW-LINE belong to the machine, not to a game:
  // svision (R-048)
  importScripts('svision/js/platform/canvas2D/zx/zxRomDraw.js'+query,
                'roomRenderer.js'+query, 'thunderbirdsLogic.js'+query);
}

var TICK_MS = 1000*69888/3500000;     // 50.08 Hz, the ULA interrupt rate
var FRAME_T = 69888;
// ★ a pass's work beside its delays, and the interrupt's handler: the
// original's averages in T-states (tools/measurecadence.mjs over the
// recordings of tools/tracephysics.py)
var WORK_T = 22039;
// ? the remake's own (ZADANI chap. 10): after a switch of the craft FIRE is
// not taken for this many frames — one second — so a FIRE still held does
// not switch straight back
var FIRE_LOCK_FRAMES = 50;

var state = null;
var logic = null;
var timer = null;
var lastTime = false;
var accumulator = 0;

function reset() {
  clearTimeout(timer);
  timer = null;
  lastTime = false;
  accumulator = 0;
  logic = null;
  state = {
    running: false, paused: false, headless: false, over: false,
    // interrupts since the game started
    frame: 0,
    // passes of the main loop
    pass: 0,
    // T-states still to go before the next pass may run
    passT: 0,
    // T-states of the handler still running into the next frame
    isrLeft: 0,
    // interrupts lost to a handler still running
    lost: 0,
    hiScore: 0,
    // ★ the five controls of the original's key window: LEFT, RIGHT, UP,
    // DOWN and FIRE (which switches between Thunderbird 1 and 2); what they
    // are as keys is read out of the memory ($5D0B-$5D0F) at every pass
    controls: {left: false, right: false, up: false, down: false, fire: false},
    // FIRE is not taken before this frame (FIRE_LOCK_FRAMES)
    fireFrom: 0,
    outcome: 'pass',
    sounds: []
  };
} // reset

/**
 * The DE that ROM KEY-SCAN would give: $FFFF for no key, else D $FF and
 * E the key's code — the original reads one key, so of several held FIRE
 * wins, then UP, DOWN, LEFT, RIGHT. ? For a second after a switch of the
 * craft FIRE is left out (FIRE_LOCK_FRAMES).
 */
function heldKey() {
  var m = logic.mem;
  var order = [['fire', 4], ['up', 2], ['down', 3], ['left', 0], ['right', 1]];
  for (var i = 0; i < order.length; i++) {
    if (order[i][0] === 'fire' && state.frame < state.fireFrom) {
      continue;
    }
    if (state.controls[order[i][0]]) {
      return 0xFF00 | m[0x5D0B+order[i][1]];
    }
  }
  return 0xFFFF;
} // heldKey

/** a five-digit number out of its digits */
function digits(m, at) {
  var n = 0;
  for (var i = 0; i < 5; i++) {
    n = 10*n+m[at+i];
  }
  return n;
} // digits

/**
 * The frame the model draws: the screen as the game left it, the panel's
 * numbers.
 * @param {boolean} withScreen - Whether the screen changed since the last one.
 * @returns {Object} The 'frame' message.
 */
function frame(withScreen) {
  var m = logic ? logic.mem : null;
  var message = {
    id: 'frame',
    frame: state.frame,
    pass: state.pass,
    outcome: state.outcome,
    controls: state.controls,
    sounds: state.sounds.splice(0, state.sounds.length)
  };
  if (m) {
    message.rand = logic.seed();
    message.room = m[0x6561];
    // the craft under control: 1 Thunderbird 1 ($5CCC), 2 Thunderbird 2
    message.craft = logic.word(0x656D) === 0x5CCC ? 1 : 2;
    message.panel = {
      score: digits(m, 0x5CFF),
      hiScore: Math.max(state.hiScore, digits(m, 0x5D05)),
      // ★ the figures on the panel are $5CF4 − 1 (`$F6B3`)
      lives: m[0x5CF4]-1
    };
    if (withScreen) {
      message.screen = logic.screen().slice();
    }
  }
  return message;
} // frame

/** the game is over: the last frame, then 'gameOver' */
function finish() {
  state.over = true;
  state.running = false;
  stopClock();
  postMessage(frame(true));
  postMessage({id: 'gameOver', score: digits(logic.mem, 0x5CFF)});
} // finish

/** one pass of the main loop; false when the game is over */
function runPass() {
  logic.key = heldKey();
  var craft = logic.word(0x656D);
  var outcome;
  try {
    outcome = logic.pass();
  } catch (error) {
    // ? a part of the original not ported yet (thunderbirdsLogic.notPorted):
    // the game ends there rather than going on from a state that is not
    // the original's
    postMessage({id: 'error', message: error.message});
    finish();
    return false;
  }
  state.pass++;
  state.outcome = outcome;
  if (logic.word(0x656D) !== craft) {
    // the other craft under control: FIRE waits a second
    state.fireFrom = state.frame+FIRE_LOCK_FRAMES;
  }
  state.passT += logic.waited+WORK_T;
  logic.sounds.splice(0, logic.sounds.length).forEach((sound) => state.sounds.push(sound));
  if (outcome !== 'pass' && outcome !== 'restart') {
    // ★ GAME OVER, the mission done, the base, OUT OF FUEL: the original
    // goes on into the ROM's texts and the start of a mission — M4; the
    // remake ends the game here
    finish();
    return false;
  }
  return true;
} // runPass

/**
 * One frame — one tick: the handler `$A398` (unless the last one still runs),
 * then the passes whose time has come.
 */
function tick() {
  state.frame++;
  var left = state.isrLeft;
  if (left > 0) {
    // ★ the handler still runs with DI: this interrupt is lost
    state.lost++;
  } else {
    logic.interrupt();
    logic.sounds.splice(0, logic.sounds.length).forEach((sound) => state.sounds.push(sound));
    left = logic.isrCost();
  }
  // the handler's time is the passes' time lost
  var used = Math.min(left, FRAME_T);
  state.isrLeft = left-used;
  state.passT -= FRAME_T-used;
  var drawn = true;                   // the flames turn on the screen too
  while (state.passT <= 0 && state.running) {
    if (!runPass()) {
      return;
    }
  }
  postMessage(frame(drawn));
} // tick

function schedule() {
  if (!state.running || state.paused || state.headless) {
    return;
  }
  // the clock starts when it is scheduled, not when it first fires: else
  // the first interval after init or continue would be lost
  if (lastTime === false) {
    lastTime = Date.now();
  }
  timer = setTimeout(() => {
    // the message handler may have stopped the clock in the meantime
    if (timer === null) {
      return;
    }
    var now = Date.now();
    accumulator += now-lastTime;
    lastTime = now;
    // catch up rather than drift, but never run away with it after a stall
    var steps = Math.min(Math.floor(accumulator/TICK_MS), 4);
    accumulator -= steps*TICK_MS;
    if (accumulator > 4*TICK_MS) {
      accumulator = 0;
    }
    for (var step = 0; step < steps && state.running; step++) {
      tick();
    }
    schedule();
  }, TICK_MS);
} // schedule

function stopClock() {
  clearTimeout(timer);
  timer = null;
  lastTime = false;
} // stopClock

onmessage = function(event) {
  var message = event.data;
  switch (message.id) {

    case 'init':
      reset();
      var initData = message.initData || {};
      state.headless = !!initData.headless;
      state.hiScore = initData.hiScore || 0;
      if (!initData.maze || !initData.global) {
        postMessage({id: 'error', message: 'game data missing (data/maze.json, data/global.json)'});
        return;
      }
      logic = new ThunderbirdsLogic(initData.maze, initData.global);
      // ★ the seed is the state of the original's generator, SEED at $5C76,
      // when the first room is drawn. None given: the original's own
      // (data/global.json, what the title's sparkle left, ZADANI chap. 10);
      // a number: the state the last game left (gameApp.gameSeed)
      if (typeof initData.seed === 'number') {
        logic.setSeed(initData.seed);
      }
      logic.begin();
      state.running = true;
      postMessage(frame(true));
      schedule();
      break;

    case 'controls':
      Object.keys(state.controls).forEach((key) => {
        if (key in message) {
          state.controls[key] = !!message[key];
        }
      });
      break;

    case 'pause':
      state.paused = true;
      stopClock();
      break;

    case 'continue':
      if (state.paused) {
        state.paused = false;
        lastTime = false;
        accumulator = 0;
        schedule();
      }
      break;

    case 'tick':
      if (state.headless && state.running) {
        tick();
      }
      break;

    case 'reset':
      reset();
      break;

  } // switch
}; // onmessage

reset();
