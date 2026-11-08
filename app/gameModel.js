const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { PauseGameEntity } = await import('./pauseGameEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { ScreenComposer } = await import('./screenComposer.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The game screen.
 *
 * The whole 256x192 picture is one {@link GameAreaEntity}, panel and all,
 * because that is how the machine holds it. ScreenComposer builds those 6912
 * bytes, and from M1 on tools/matchscreen.mjs checks the result against the
 * original's own video memory byte for byte.
 *
 * The worker (gameWorker.js, WORKER-PROTOCOL.md) keeps the state and ticks;
 * this model routes the controls into it and draws what comes back.
 *
 * ★ **The picture is drawn on the worker's message** (R-037): a `frame`
 * message composes the screen and draws it, and `loopModel` draws only when
 * no message has come since its last pass, so the picture keeps step with
 * the world and still keeps going while the worker stands (the pause panel).
 * How well that works is measured, not looked at: `drawn/messages/ticks FPS`
 * in the border in dev mode (R-045), healthy at 60/50/50.
 *
 * ★ **The game is the original's, pass for pass** (M3): the worker runs the
 * port of its main loop and interrupt (app/thunderbirdsLogic.js over the
 * room engine app/roomRenderer.js) on the program's data — data/maze.json
 * and data/global.json go to it in `init` — and sends the screen it drew.
 * tools/matchphysics.mjs replays recordings of the original against that
 * very code, zero differences after every pass.
 */
export class GameModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'GameModel';

    this.gameOver = false;
    // ★ the five controls of the original's key window: LEFT, RIGHT, UP,
    // DOWN and FIRE, which switches between the craft (disasm_notes.md §8)
    this.controlsState = {left: false, right: false, up: false, down: false,
                          fire: false};
    this.worker = null;
    this.render = null;
    this.gameAreaEntity = null;
    this.inputEntity = null;
    // R-045: drawn / worker messages / world ticks a second
    this.fps = {frames: 0, workerFrames: 0, ticks: 0, since: false, lastFrame: false};
    this.fpsEnabled = false;
    // R-037: true until a worker message has drawn the picture
    this.needDraw = true;
    // a touch that is shorter than one tick of the worker has to be held
    this.heldTaps = {};
  } // constructor

  /**
   * The game's own border: no X in it (Escape and the pause panel do that),
   * but on a touchscreen the two halves of the screen are the controls, so
   * the border carries them and their icons (jetpac/app/gameModel.js).
   * Without it the model gets the plain AbstractEntity of AbstractModel and
   * the touch halves are not there at all.
   * @returns {BorderEntity}
   */
  newBorderEntity() {
    return new BorderEntity(false, this.app.controls.touchscreen.supported);
  } // newBorderEntity

  init() {
    super.init();

    // ★ BORDER 0 in the BASIC loader, and black in every frame of the game
    // captured so far (tools/playtrace.py). ? Whether it ever changes is M2.
    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    this.sendEvent(0, {id: 'openAudioBus', bus: 'sounds',
                       options: {muted: this.app.muted.sounds}});

    // the data files: at once from localStorage, or from the server when
    // they are missing there (R-062)
    this.loadDataFiles(['screen', 'maze', 'global'], (files, error) => this.initData(files, error));
  } // init

  /**
   * The part of init() that needs the data files. Runs inside init()
   * when they are in localStorage, later when they had to come from the
   * server.
   * @param {Object|null} files - screen, maze and global, or null.
   * @param {Error} [error] - Why they are missing.
   */
  initData(files, error) {
    if (this.app.model !== this) {
      return;
    }
    if (!files) {
      this.app.showErrorMessage(error ? error.message : 'Game data could not be loaded.', 'restart');
    }

    if (!this.initScreen()) {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 8*8, this.desktopWidth, 8, 'THUNDERBIRDS', ZXColor.brightWhite, false, {align: 'center'}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 40,
        'GAME DATA MISSING (data/screen.json, maze.json, global.json). RUN tools/mkscreen.py AND tools/dumpmaze.py.', ZXColor.brightGreen, false, {align: 'center', textWrap: true}));
      return;
    }

    if (typeof this.app.devModeName === 'string') {
      // the FPS goes into the border (borderEntity.setFps, R-045 point 5);
      // the held controls go into the border as well, top right, for the
      // same reason: nothing is written over a picture that is compared with
      // the original byte for byte
      this.fpsEnabled = true;
      this.inputEntity = new TextEntity(this.borderEntity, this.app.fonts.fonts3x3, 0, 1, 10*8, 4, '', ZXColor.brightCyan, false, {align: 'right'});
      this.borderEntity.addEntity(this.inputEntity);
    }

    this.showTouchIcons();

    this.worker = this.app.worker;
    this.app.inputEventsManager.sendEventsActiveKeys('Press');
    this.sendWorkerMessage({
      id: 'init',
      initData: {
        headless: false,
        hiScore: this.app.hiScore,
        // ★ the program's tables and the mission's state at the original's
        // addresses (tools/dumpmaze.py, sources/docs/maze.md)
        maze: this.loadDataFile('maze'),
        global: this.loadDataFile('global'),
        // ★ the starting state of SEED ($5C76), the state of the original's
        // generator $F8BC (disasm_notes.md §5, WORKER-PROTOCOL.md)
        seed: this.app.gameSeed
      }
    });
  } // initData

  shutdown() {
    super.shutdown();
    this.sendWorkerMessage({id: 'reset'});
    this.sendEvent(0, {id: 'stopAllAudioBuses'});
  } // shutdown

  /**
   * Builds the renderer and adds the screen.
   * @returns {boolean} True when the screen was created.
   */
  initScreen() {
    try {
      if (!this.loadDataFile('maze') || !this.loadDataFile('global')) {
        throw new Error('game data missing (data/maze.json, data/global.json)');
      }
      this.render = new ScreenComposer(this.loadDataFile('screen'));
    } catch (error) {
      console.error(error.message);
      return false;
    }
    this.gameAreaEntity = new GameAreaEntity(this.desktopEntity, 0, 0, this.render);
    this.desktopEntity.addEntity(this.gameAreaEntity);
    return true;
  } // initScreen

  sendWorkerMessage(event) {
    if (this.worker) {
      this.worker.postMessage(event);
    }
  } // sendWorkerMessage

  /**
   * Sets one control and sends the whole state over when it changed. The
   * whole state goes rather than the change, so that the worker never has to
   * guess what is still held.
   * @param {string} action - The control action.
   * @param {boolean} value - Pressed or released.
   */
  setControl(action, value) {
    if (!(action in this.controlsState) || this.controlsState[action] === value) {
      return;
    }
    this.controlsState[action] = value;
    this.sendWorkerMessage(Object.assign({id: 'controls'}, this.controlsState));
  } // setControl

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'exitGame':
        this.app.setModel('MenuModel');
        return true;

      case 'blurWindow':
        this.pauseGame();
        return true;

      case 'continueGame':
        this.sendWorkerMessage({id: 'continue'});
        this.sendEvent(0, {id: 'continueAllAudioBuses'});
        return true;

      case 'releaseTouchAction':
        if (this.heldTaps[event.action]) {
          this.heldTaps[event.action]--;
        }
        this.releaseTouchAction(event.action);
        return true;

      case 'keyPress':
        var key = event.key;
        if (key.length == 1) {
          key = key.toUpperCase();
        }
        switch (key) {
          // ★ The original pauses on `P` (its SET KEYS). The remake does too,
          // and on Escape and a tab that loses focus, because a browser game
          // has to stop somewhere; ? that the remake's pause shows a panel is
          // a recorded deviation until M4 reads the original's (ZADANI 10).
          case 'Escape':
          case 'GamepadExit':
          case this.app.controls.keyboard.pause:
            this.pauseGame();
            return true;
          case 'Touch':
            if (this.borderEntity.leftControlEntity && this.borderEntity.leftControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.leftControlEntity;
              this.touchStart(event, 'left', this.borderEntity.leftControlEntity);
              return true;
            }
            if (this.borderEntity.rightControlEntity && this.borderEntity.rightControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.rightControlEntity;
              this.touchStart(event, 'right', this.borderEntity.rightControlEntity);
              return true;
            }
            break;
          case 'RetryTouch':
            this.setControl(event.action, true);
            return true;
          case this.app.controls.keyboard.sounds:
            this.app.muted.sounds = !this.app.muted.sounds;
            this.sendEvent(0, {id: 'muteAudioBus', bus: 'sounds', muted: this.app.muted.sounds});
            return true;
        }
        var action = this.controlAction(key);
        if (action !== false) {
          this.setControl(action, true);
          return true;
        }
        break;

      case 'keyRelease':
        var releasedKey = event.key;
        if (releasedKey.length == 1) {
          releasedKey = releasedKey.toUpperCase();
        }
        if (releasedKey == 'Touch') {
          this.touchEnd(event);
          return true;
        }
        var releasedAction = this.controlAction(releasedKey);
        if (releasedAction !== false) {
          this.setControl(releasedAction, false);
          return true;
        }
        break;

      case 'keyMove':
        if (event.key == 'Touch') {
          this.touchMove(event);
          return true;
        }
        break;

      case 'errorAudioBus':
        this.app.showErrorMessage(event.error, 'reopen');
        return true;
    }

    return false;
  } // handleEvent

  /** pauses the worker and opens the pause menu */
  pauseGame() {
    if (this.desktopEntity.modalEntity || this.gameOver) {
      return;
    }
    this.sendWorkerMessage({id: 'pause'});
    this.sendEvent(0, {id: 'pauseAllAudioBuses'});
    this.desktopEntity.addModalEntity(new PauseGameEntity(this.desktopEntity, 52, 34, 153, 97, 'PAUSE GAME', 'MenuModel'));
  } // pauseGame

  handleWorkerMessage(event) {
    var data = event.data;
    switch (data.id) {
      case 'frame':
        this.fps.workerFrames++;
        // R-045: the third number is read off the counter the message
        // carries, not counted here
        if (this.fps.lastFrame !== false && data.frame > this.fps.lastFrame) {
          this.fps.ticks += data.frame-this.fps.lastFrame;
        }
        this.fps.lastFrame = data.frame;
        // the generator's state goes on into the next game (gameApp.gameSeed)
        if (typeof data.rand === 'number') {
          this.app.gameSeed = data.rand;
        }
        if (data.panel) {
          this.app.score = data.panel.score;
          this.app.hiScore = data.panel.hiScore;
          this.app.lives = data.panel.lives;
        }
        if (this.inputEntity && data.controls) {
          var held = Object.keys(data.controls).filter((key) => data.controls[key]);
          this.inputEntity.setText(held.length ? held.join(' ').toUpperCase() : '-');
        }
        if (data.sounds && data.sounds.length && this.app.audioManager) {
          this.app.audioManager.playFrame(data);
        }
        // R-037: the message draws, and the loop knows it does not have to
        if (this.gameAreaEntity) {
          this.gameAreaEntity.setFrame(data);
          this.drawModel();
          this.needDraw = false;
        }
        break;
      case 'gameOver':
        if (!this.gameOver) {
          this.gameOver = true;
          this.app.score = data.score;
          this.app.setModel('GameOverModel');
        }
        break;
      case 'error':
        console.error(data.message);
        break;
    }
  } // handleWorkerMessage

  /**
   * Maps a key or gamepad event onto a control action.
   *
   * The keyboard keys are **only** the configured ones (`app.controls.keyboard`
   * — arrows and SPACE by default, remapped from SETTINGS); nothing is
   * accepted beside them, so a remapped key never keeps a hidden second
   * meaning. The gamepad keys are the fixed names the library gives its
   * buttons. The mouse is not a game control here. ★ The original's own
   * keys are `5` left, `8` right, `7` up, `6` down and `A` fire
   * (disasm_notes.md §8); whoever wants them sets them in SETTINGS.
   * @param {string} key - The event key.
   * @returns {string|false} The action, or false.
   */
  controlAction(key) {
    var kb = this.app.controls.keyboard;
    switch (key) {
      case kb.left: case 'GamepadLeft': return 'left';
      case kb.right: case 'GamepadRight': return 'right';
      case kb.up: case 'GamepadUp': return 'up';
      case kb.down: case 'GamepadDown': return 'down';
      case kb.fire: case 'GamepadFire': case 'GamepadOK': return 'fire';
    }
    return false;
  } // controlAction

  /**
   * What this half of the screen does: the stick or FIRE
   * (controlsOptions.touchscreen.halves). Which half is which is the
   * left-handed / right-handed choice in SETTINGS.
   * @param {string} side - 'left' or 'right'.
   * @returns {Object} {icon, zones}
   */
  touchHalf(side) {
    var ts = this.app.controlsOptions.touchscreen;
    return ts.halves[ts.types[this.app.controls.touchscreen.type][side].half];
  } // touchHalf

  /**
   * Icons into the border: what each half of the screen does. The border draws
   * them only where there is room for them outside the play area.
   */
  showTouchIcons() {
    if (!this.app.controls.touchscreen.supported || !this.borderEntity.setGameControlIcons) {
      return;
    }
    var icons = this.app.controlsOptions.touchscreen.icons;
    this.borderEntity.setGameControlIcons(icons[this.touchHalf('left').icon],
                                          icons[this.touchHalf('right').icon]);
  } // showTouchIcons

  /**
   * The zone of the layout under the finger. `rect` is a fraction of the half,
   * so it is worked out from where on that half the finger is, not from pixels.
   * @param {Object} event - The touch event (x, y).
   * @param {string} side - 'left' or 'right'.
   * @param {Object} entity - The half of the screen (borderEntity).
   * @returns {Object|false} The zone, or false.
   */
  touchZone(event, side, entity) {
    var half = this.touchHalf(side);
    var width = Math.max(entity.width, 1), height = Math.max(entity.height, 1);
    var rx = (event.x-(entity.parentX+entity.x))/width;
    var ry = (event.y-(entity.parentY+entity.y))/height;
    for (var z = 0; z < half.zones.length; z++) {
      var r = half.zones[z].rect;
      if (rx >= r[0] && rx <= r[0]+r[2] && ry >= r[1] && ry <= r[1]+r[3]) {
        return half.zones[z];
      }
    }
    return false;
  } // touchZone

  /**
   * A new touch on a half of the screen. There can be several at once: each
   * keeps its own record in `touchesGameControls` and the control state is
   * their sum, so moving and firing go together.
   * @param {Object} event - The touch event.
   * @param {string} side - 'left' or 'right'.
   * @param {Object} entity - The half of the screen.
   */
  touchStart(event, side, entity) {
    var zone = this.touchZone(event, side, entity);
    var control = {side: side, entity: entity, action: false,
                   type: zone === false ? 'none' : zone.type,
                   control: zone === false ? false : zone.control,
                   actions: zone === false ? false : zone.actions,
                   tap: zone !== false && zone.type == 'button' && !!zone.tap,
                   since: this.app.now,
                   origin: {x: event.x, y: event.y},
                   at: {x: event.x, y: event.y}};
    this.app.inputEventsManager.touchesGameControls[event.identifier] = control;
    // A button holds its action from the moment the finger lands; the stick
    // does nothing until the finger moves, so a tap on it sends nothing.
    if (zone !== false && zone.type == 'button') {
      control.action = zone.action;
      this.setControl(zone.action, true);
    }
  } // touchStart

  /**
   * The finger came up. A short tap has to be **held**: the original reads
   * its keys once per pass of its main loop, and a pass takes up to 2.28
   * frames (disasm_notes.md §4), so a shorter tap might never be seen.
   * @param {Object} event - The touch event.
   */
  touchEnd(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined) {
      return;
    }
    delete controls[event.identifier];
    if (control.action === false) {
      return;
    }
    var rest = this.app.controlsOptions.touchscreen.tapHoldTime-(this.app.now-control.since);
    if (control.tap && rest > 0) {
      this.heldTaps[control.action] = (this.heldTaps[control.action] || 0)+1;
      this.sendEvent(rest, {id: 'releaseTouchAction', action: control.action});
      return;
    }
    [].concat(control.action).forEach((action) => this.releaseTouchAction(action));
  } // touchEnd

  /**
   * Releases an action, but only when no other finger is still holding it —
   * two fingers on the same action must not cancel each other.
   * @param {string} action - The control action.
   */
  releaseTouchAction(action) {
    if (this.heldTaps[action]) {
      return;
    }
    var controls = this.app.inputEventsManager.touchesGameControls;
    var held = Object.keys(controls).some((id) => controls[id].action !== false
                                                  && [].concat(controls[id].action).indexOf(action) !== -1);
    if (!held) {
      this.setControl(action, false);
    }
  } // releaseTouchAction

  /**
   * The finger moved. The stick is **absolute**: the direction is where the
   * finger has moved to from where it landed, with a dead zone of
   * `joystickStep` in the middle. The original reads its keys through ROM
   * `KEY-SCAN`, which returns one key (disasm_notes.md §8), so the stick
   * holds the stronger of the two axes and never sends a diagonal the
   * keyboard of the original could not.
   * @param {Object} event - The touch event.
   */
  touchMove(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined || control.type != 'joystick') {
      return;
    }
    control.at = {x: event.x, y: event.y};
    var step = this.app.controlsOptions.touchscreen.joystickStep;
    var dx = event.x-control.origin.x, dy = event.y-control.origin.y;
    var next = false;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > step) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        next = dx < 0 ? control.actions.left : control.actions.right;
      } else {
        next = dy < 0 ? control.actions.up : control.actions.down;
      }
    }
    if (next === control.action) {
      return;
    }
    var previous = control.action;
    control.action = next;
    if (previous !== false) {
      this.releaseTouchAction(previous);
    }
    if (next !== false) {
      this.setControl(next, true);
    }
  } // touchMove

  updateFps(timestamp) {
    if (!this.fpsEnabled) {
      return;
    }
    this.fps.frames++;
    if (this.fps.since === false) {
      this.fps.since = timestamp;
      return;
    }
    var elapsed = timestamp-this.fps.since;
    if (elapsed >= 1000) {
      this.borderEntity.setFps(Math.round(this.fps.frames*1000/elapsed)+'/'+Math.round(this.fps.workerFrames*1000/elapsed)+'/'+Math.round(this.fps.ticks*1000/elapsed)+' FPS');
      this.fps.frames = 0;
      this.fps.workerFrames = 0;
      this.fps.ticks = 0;
      this.fps.since = timestamp;
    }
  } // updateFps

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }

    // R-045: counted before the needDraw branch, so the first number is how
    // often the loop runs, and R-037: the loop draws only when no worker
    // message has drawn since its last pass
    this.updateFps(timestamp);
    if (this.needDraw) {
      this.drawModel();
    }
    this.needDraw = true;
  } // loopModel

} // GameModel
