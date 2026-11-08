const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * Loading from tape, the way the original does it: `LOAD ""` typed on the ZX
 * keyboard, then the three blocks of the Thunderbirds tape in its own order,
 * each in its own timing, and the loading screen — the real one off the
 * original tape (data/loading.json, tools/matchloading.py: 112 128 checks,
 * zero differences).
 *
 * Every block is played as it is on the tape (audioManager.tapeBlockSound,
 * data/tape.json): the pilot, the sync pulses and the bytes it really
 * carries. The sound says when the pilot is over and when the block is over,
 * and the loading lives off those events rather than off a timer.
 *
 * The picture is not revealed, it is **loaded**: the sound sends an event
 * after every byte of the picture and the model writes that byte into the
 * video memory. ★ The loader's own copy of LD-BYTES builds a byte **from its
 * lowest bit** (`RR L` where the ROM has `RL L`), so the byte in the video
 * memory is the **mirror image** of the byte as it goes down the tape
 * (sources/docs/tape_layout.md, layer 1) — the model mirrors it, exactly as
 * the machine does.
 *
 * ★ **What the screen shows is measured** (tools/traceloading.py, the
 * simulated load of tools/mksnapshot.sh, read frame by frame against the ROM
 * font):
 *
 * - `Program: T'BIRDS` on row 1, black on white ($38), 5.1 s in
 * - when the BASIC runs (10.1 s): `BORDER 0: INK 0: PAPER 0: CLS` — the
 *   numbers on the screen of the listing are faked, the binary ones are
 *   zeros — so the screen and the border go **black**, rows 22-23 white on
 *   black ($07), and `*LOADING*` stands on row 21 from column 11: the stars
 *   blue on blue ($09, unseen), LOADING white on blue ($0F). `POKE
 *   20107,255` puts a byte into the bitmap where the attribute is $00 —
 *   unseen
 * - the turbo block goes **straight into the video memory**, its bitmap
 *   into cells of attribute $00 — unseen, except on rows 21-23 — and the
 *   picture comes up only with its 768 attributes, ≈ 48 s in
 *
 * ★ The tape (sources/docs/tape_layout.md): the ROM header `T'BIRDS`, the
 * BASIC with 187 bytes of machine code behind it, and one **turbo block**
 * (pilot 8179 × 2165 T, sync 714/714 T, bits 673/1346 T) of 52 056 bytes —
 * the picture, then records of code that the loader decrypts twice. The
 * remake plays the block up to the end of the picture and the printer buffer
 * behind it (7170 bytes, ≈ 33 s); the rest would take three minutes more
 * and shows nothing (ZADANI chap. 10).
 */
export class TapeLoadingModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'TapeLoadingModel';

    this.inputLineEntity = null;
    this.commandPhase = 0;
    this.command = ['K', 'LOAD L', 'LOAD "L', 'LOAD ""L', ''];
    this.programNameEntity = null;
    this.screenEntity = null;
    this.app.stack.flashState = false;
    this.tapeBreak = false;
    // ★ the line BREAK reports while the ROM loads the BASIC: the command
    // typed directly, 0:1
    this.tapeBreakLine = '0:1';
    // whether BREAK works at all right now. ★ Once the BASIC runs, the
    // machine code in VARS has the screen and the loader's own LD-BYTES at
    // $FF00, whose BREAK test returns to $5B00 — into whatever the tape has
    // put there by then. ? What that does on the machine is not measured, so
    // the remake ignores BREAK from the BASIC on (ZADANI chap. 10)
    this.breakable = true;
    this.tapePhase = false;
    this.tape = null;
  } // constructor

  /**
   * The tape as a script: the blocks in the order of the tape, the pauses
   * between them and what happens on the screen in between. The blocks come
   * out of data/tape.json, the pauses too — ? those are a property of the
   * TZX container rather than of the tape (tools/bootylib.py), so they are an
   * order of magnitude, not measured numbers.
   * @param {Object} tape - data/tape.json.
   * @returns {Object[]} The steps.
   */
  script(tape) {
    var b = tape.blocks;
    var pause = (n) => ({id: 'pause', duration: b[n-1].pauseMs});
    var block = (n, extra) => Object.assign({id: 'block', block: n, duration: b[n-1].durationMs}, extra || {});
    return [
      {id: 'pause', duration: 1000},
      // the ROM loads the BASIC: header, then the program
      block(1, {end: {id: 'setProgramName'}}),
      pause(1),
      // ★ line 0 runs straight away (autostart 0) and ends in RANDOMIZE USR
      // into VARS, which loads the turbo block itself
      block(2, {end: {id: 'runBasic'}}),
      pause(2),
      block(3, {turbo: true}),
      // the code jumps to $E105 — the remake's menu takes over
      {id: 'pause', duration: 1000}
    ];
  } // script

  init() {
    super.init();

    this.borderEntity.bkColor = ZXColor.white;
    this.desktopEntity.bkColor = ZXColor.white;

    this.inputLineEntity = new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, 0, 23*8, 32*8, 8, '© 1982 Sinclair Research Ltd', ZXColor.black, false, {align: 'left'});
    this.desktopEntity.addEntity(this.inputLineEntity);

    // ★ row 1, black on white ($38): tools/traceloading.py, frame 256
    this.programNameEntity = new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, 0, 1*8, 32*8, 8, "Program: T'BIRDS", ZXColor.black, false, {});
    this.programNameEntity.hide = true;
    this.desktopEntity.addEntity(this.programNameEntity);

    // the tape and the picture: at once from localStorage, or from the server
    // when they are missing there (R-062)
    this.loadDataFiles(['tape', 'loading'], (files, error) => this.initData(files, error));
  } // init

  /**
   * The part of init() that needs the data files. Runs inside init()
   * when they are in localStorage, later when they had to come from the
   * server.
   * @param {Object|null} files - tape and loading, or null.
   * @param {Error} [error] - Why they are missing.
   */
  initData(files, error) {
    if (this.app.model !== this) {
      return;
    }
    if (!files) {
      this.app.showErrorMessage(error ? error.message : 'Game data could not be loaded.', 'restart');
    }

    var tape = this.loadDataFile('tape');
    if (!tape || !this.loadDataFile('loading')) {
      this.inputLineEntity.setText('TAPE DATA MISSING (data/tape.json)');
      this.sendEvent(3000, {id: 'setMenuModel'});
      return;
    }
    this.tape = this.script(tape);

    this.sendEvent(0, {id: 'openAudioBus', bus: 'sounds', options: {}});
    this.sendEvent(1000, {id: 'updateCommand'});

    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
  } // initData

  newBorderEntity() {
    // no X in the border, like the other screens: a click or a touch anywhere
    // in the border is BREAK (handleEvent), a second one goes back to the menu,
    // and Escape or GamepadExit go back straight away
    return new BorderEntity(false, false);
  } // newBorderEntity

  shutdown() {
    super.shutdown();
    this.sendEvent(0, {id: 'closeAllAudioBuses'});
  } // shutdown

  /**
   * The next step of the tape.
   */
  nextStep() {
    if (this.tapeBreak) {
      return;
    }
    var step = this.tape[this.tapePhase];
    switch (step.id) {
      case 'block':
        this.breakable = !step.turbo;
        this.sendEvent(0, {id: 'playSound', bus: 'sounds', sound: 'tapeBlock'+step.block, options: false});
        this.sendEvent(0, {id: 'setBorderAnimation', value: 'pilotTone'});
        // the block ends itself with `tapeBlockEnd`; this only catches a bus
        // that never got to play it
        this.sendEvent(step.duration+2000, {id: 'updateTape', fallback: true});
        return;
      case 'pause':
        this.breakable = true;
        this.sendEvent(0, {id: 'stopAudioBus', bus: 'sounds'});
        this.sendEvent(0, {id: 'setBorderAnimation', value: false});
        if (step.event) {
          this.sendEvent(0, step.event);
        }
        this.sendEvent(step.duration, {id: 'updateTape'});
        return;
    }
  } // nextStep

  /**
   * The step is over: what it leaves behind, and the step after it.
   */
  endStep() {
    this.cancelEvent('updateTape');
    var step = this.tape[this.tapePhase];
    if (step.end) {
      this.sendEvent(0, step.end);
    }
    this.tapePhase++;
    if (this.tapePhase < this.tape.length) {
      this.nextStep();
    } else {
      this.sendEvent(0, {id: 'setMenuModel'});
    }
  } // endStep

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;

      case 'updateCommand':
        this.inputLineEntity.options.align = 'left';
        this.inputLineEntity.fonts = this.app.fonts.zxFonts8x8Mono;
        this.inputLineEntity.options.animationMode = 'flashReverseColors';
        this.inputLineEntity.setText(this.command[this.commandPhase]);
        this.inputLineEntity.options.flashMask = '';
        if (this.command[this.commandPhase].length > 0) {
          this.inputLineEntity.options.flashMask = this.inputLineEntity.options.flashMask.padStart(this.command[this.commandPhase].length-1, ' ')+'#';
        }
        this.commandPhase++;
        this.sendEvent(0, {id: 'playSound', bus: 'sounds', sound: 'keyboardSound', options: false});
        if (this.commandPhase < this.command.length) {
          this.sendEvent(800, {id: 'updateCommand'});
        } else {
          this.inputLineEntity.hide = true;
          this.tapePhase = 0;
          this.nextStep();
        }
        return true;

      case 'updateTape':
        if (!this.tapeBreak && this.tapePhase !== false) {
          this.endStep();
        }
        return true;

      case 'tapePilotEnd':
        if (!this.tapeBreak) {
          this.sendEvent(0, {id: 'setBorderAnimation', value: 'dataTone'});
        }
        return true;

      case 'tapeByte':
        // one byte off the tape, straight into the video memory; the entity
        // repaints itself on the next frame and nothing else is needed
        // ★ mirrored: the loader's LD-BYTES takes the bits lowest first
        if (this.screenEntity && !this.tapeBreak) {
          this.screenEntity.pokeOffset(event.data.at, TapeLoadingModel.mirror(event.data.value));
        }
        return true;

      case 'tapeBlockEnd':
        var step = this.tapePhase === false ? null : this.tape[this.tapePhase];
        if (!this.tapeBreak && step && step.id == 'block' && step.block == event.data.block) {
          this.endStep();
        }
        return true;

      case 'setProgramName':
        this.programNameEntity.hide = false;
        return true;

      case 'runBasic':
        // ★ BORDER 0: INK 0: PAPER 0: CLS : PRINT AT 21,11;"*LOADING*":
        // POKE 20107,255 (tools/traceloading.py, frame 506), then RANDOMIZE
        // USR into the machine code in VARS — no BREAK from here on
        this.breakable = false;
        if (this.programNameEntity) {
          this.programNameEntity.destroy();
          this.programNameEntity = null;
        }
        this.borderEntity.bkColor = ZXColor.black;
        this.desktopEntity.bkColor = ZXColor.black;
        // the video memory the picture loads into, as the BASIC left it — the
        // screen tblib.basic_screen() builds and tools/matchimage.py checks
        // against the ROM: every cell $00 except the lower screen (rows 22-23,
        // $07) and `*LOADING*`; the bitmap loads unseen and only the
        // attributes bring the picture up
        this.screenEntity = new ZXVideoRAMEntity(this.desktopEntity, 0, 0);
        this.screenEntity.clear(0, 0x00);
        var vram = this.screenEntity.videoRAM;
        vram.fillAttributes({row: 22, col: 0, rows: 2, cols: 32}, 0x07);
        var basic = this.loadDataFile('loading').basic;
        if (basic) {
          basic.cells.forEach((cell) => {
            vram.pokeCell(basic.row, cell.col, cell.glyph);
            vram.pokeAttribute(basic.row, cell.col, cell.attr);
          });
          vram.pokeAddress(basic.poke.address, basic.poke.value);
        }
        this.screenEntity.invalidate();
        this.desktopEntity.addEntity(this.screenEntity);
        var entities = this.desktopEntity.entities;
        entities.push(entities.splice(entities.indexOf(this.inputLineEntity), 1)[0]);
        this.inputLineEntity.setPenColor(ZXColor.white);
        this.inputLineEntity.setBkColor(ZXColor.black);
        return true;

      case 'setMenuModel':
        this.app.setModel('MenuModel');
        return true;

      case 'keyPress':
        switch (event.key) {
          case 'Escape':
          case 'GamepadExit':
            this.app.setModel('MenuModel');
            return true;
          case ' ':
          case 'Enter':
          case 'GamepadOK':
            if (this.break()) {
              return true;
            }
            break;
          case 'Mouse1':
          case 'Mouse2':
          case 'Mouse4':
            this.app.inputEventsManager.keysMap[event.key] = this.borderEntity;
            return true;
          case 'Touch':
            this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity;
            return true;
        }
        break;

      case 'keyRelease':
        switch (event.key) {
          case 'Mouse1':
          case 'Mouse2':
          case 'Mouse4':
            if (this.app.inputEventsManager.keysMap[event.key] === this.borderEntity) {
              this.break();
            }
            return true;
          case 'Touch':
            if (this.app.inputEventsManager.touchesMap[event.identifier] === this.borderEntity) {
              this.break();
            }
            return true;
        }
        break;

      case 'errorAudioBus':
        this.app.showErrorMessage(event.error, 'reopen');
        return true;
    }

    return false;
  } // handleEvent

  /**
   * Stops the load the way BREAK does on the real machine, or leaves when the
   * tape is already stopped. During a turbo block BREAK does nothing, as in
   * the original (`breakable`).
   * @returns {boolean} True when the event was consumed.
   */
  break() {
    if (this.tapeBreak) {
      this.app.setModel('MenuModel');
      return true;
    }

    if (this.tapePhase !== false) {
      if (!this.breakable) {
        return true;
      }
      this.cancelEvent('updateTape');
      this.cancelEvent('setMenuModel');
      this.sendEvent(0, {id: 'stopAudioBus', bus: 'sounds'});
      this.tapeBreak = true;
      // whatever the tape has put into the video memory stays there; the
      // report is printed over it
      this.inputLineEntity.setText('D BREAK - CONT repeats, '+this.tapeBreakLine);
      this.inputLineEntity.hide = false;
      this.sendEvent(0, {id: 'setBorderAnimation', value: false});
      this.sendEvent(5000, {id: 'setMenuModel'});
      return true;
    }
    return false;
  } // break

  /**
   * ★ A byte with its bits in the opposite order — what the loader's own
   * LD-BYTES ($FF7B `RR L`) makes of a byte off the tape.
   * @param {number} value - The byte as it goes down the tape.
   * @returns {number} The byte in memory.
   */
  static mirror(value) {
    var out = 0;
    for (var bit = 0; bit < 8; bit++) {
      out = (out << 1) | ((value >> bit) & 1);
    }
    return out;
  } // mirror

  loopModel(timestamp) {
    super.loopModel(timestamp);

    this.drawModel();
  } // loopModel

} // TapeLoadingModel
