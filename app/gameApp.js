const { Version } = await import('./version.js?ver='+window.srcVersion);
const { AbstractApp } = await import('./svision/js/abstractApp.js?ver='+window.srcVersion);
const { AudioManager } = await import('./audioManager.js?ver='+window.srcVersion);
const { ZXFonts8x8 } = await import('./svision/js/platform/canvas2D/zx/zxFonts8x8.js?ver='+window.srcVersion);
const { Fonts5x5 } = await import('./svision/js/platform/canvas2D/fonts5x5.js?ver='+window.srcVersion);
const { Fonts3x3 } = await import('./svision/js/platform/canvas2D/fonts3x3.js?ver='+window.srcVersion);
const { ZXResetModel } = await import('./svision/js/platform/canvas2D/zx/zxResetModel.js?ver='+window.srcVersion);
const { MenuModel } = await import('./menuModel.js?ver='+window.srcVersion);
const { AboutModel } = await import('./aboutModel.js?ver='+window.srcVersion);
const { HallOfFameModel } = await import('./hallOfFameModel.js?ver='+window.srcVersion);
const { GameModel } = await import('./gameModel.js?ver='+window.srcVersion);
const { GameOverModel } = await import('./gameOverModel.js?ver='+window.srcVersion);
const { TapeLoadingModel } = await import('./tapeLoadingModel.js?ver='+window.srcVersion);
const { ZXErrorEntity } = await import('./svision/js/platform/canvas2D/zx/zxErrorEntity.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * Thunderbirds application shell (built on the Booty one — a ZX game on
 * ZXPlatform with a worker).
 * LoadingModel -> MenuModel -> GameModel (the game) -> GameOverModel, plus
 * TapeLoadingModel, HallOfFameModel and AboutModel off the menu.
 *
 * ★ **LOAD TAPE is one of the ways to start**, not a decoration: the turbo
 * block of the tape starts with the loading screen and the remake loads that
 * picture for real, byte by byte, because the sound *is* those bytes
 * (tapeLoadingModel.js, data/tape.json, data/loading.json,
 * sources/docs/tape_layout.md).
 *
 * ★ What the original offers is measured (disasm_notes.md §3, §8): its
 * title waits for FIRE, `R` opens the window YOUR KEYS — `LEFT - 5`,
 * `RIGHT - 8`, `UP - 7`, `DOWN - 6`, `FIRE - A` — and SET KEYS — `SAVE - S`,
 * `LOAD - L`, `PAUSE - P`, `MUSIC - M`. FIRE switches the control from one
 * Thunderbird to the other (the instructions). A Kempston joystick is
 * accepted automatically. **There is no two-player game.**
 *
 * The remake's defaults are the arrows and SPACE, as in the sibling remakes,
 * and **every key comes from SETTINGS** — nothing is accepted beside the
 * configured keys, so the remap dialog always tells the truth.
 *
 * ? The original keeps a HIGH on its panel but no table of names. The remake
 * keeps the hall of fame the siblings have (ZADANI chap. 10).
 */
export class GameApp extends AbstractApp {

  /**
   * ★ The original has no two-player game — the remake has one player and
   * nothing to choose.
   */
  static get PLAYERS() { return [1]; }

  constructor(platform, importPath, wsURL, devModeName, appIconSprite) {
    super(platform, 'bodyApp', importPath, wsURL);

    this.worker = new Worker(this.importPath+'/gameWorker.js?ver='+window.srcVersion);
    this.worker.onmessage = (event) => {
      if (this.model) {
        this.model.handleWorkerMessage(event);
      }
    };

    this.version = Version;
    this.devModeName = devModeName;
    this.appIconSprite = appIconSprite;

    this.audioManager = new AudioManager(this);
    // one switch for both buses: the music follows the sounds (menuModel.js)
    this.muted = {sounds: false};

    // These are the **remake's** fonts — menus, dialogs, settings — and
    // they are svision's, ZX ROM font and all. ★ The original's key window,
    // cargo rules and equipment are in the ROM font; its panel is in an italic
    // set of its own (screen_layout.md), which is M2.
    this.fonts = {
      zxFonts8x8Mono: new ZXFonts8x8(this, false),
      zxFonts8x8: new ZXFonts8x8(this, true),
      zxFonts8x8Keys: new ZXFonts8x8(this, false),
      fonts5x5: new Fonts5x5(this),
      fonts3x3: new Fonts3x3(this)
    };
    // the keycap font of the on-screen keyboard (ZXPlayerNameEntity), the same
    // glyphs as in the other games
    this.fonts.zxFonts8x8Keys.setFontsData('00000000000000000010101010001000002424000000000014147E28FC505000107C507C14547C1042A44810244A8400001028102A443A00000810000000000000182020202018000030080808083000000014083E081400000008083E0808000000000000080810000000003E00000000000000001818000204081020408000007C4C5454647C000018280808083E00007C440438407C00007C441804447C00001828487E081C00007C407C04447C00007C407C44447C00007C440810101000007C443844447C00007C44447C047C000000001000001000000010000010102000000408100804000000003E003E00000000100804081000007C441C100010003C42BD85BDA5BE78003C42427E42E70000FC427C4242FC00007E424040427E0000FE42424242FE0000FE42784042FE0000FE42784040E000007E42404E427E0000E7427E4242E700007C101010107C00007E08080848780000E648705844E60000E040404242FE0000C3665A4242E70000C762524A46E700007E424242427E0000FE42427E40E000007E424242527E0800FE42427E44E700007E407E02427E0000FE92101010380000CE444444447E0000E742424224180000D7929292926C0000EE44382844EE0000EE442810103800007E440810227E001C10101010101C0000004020100804003808080808083800001038541010100000000000000000FF003C247020207C0000007C047C447E00C0407C4444447C0000007C4440407C000C047C4444447E0000007C447C407C003C2470202020700000007C44447C047CC0407C444444E6001000701010107C000800380808084878C0404C506058CC007010101010107C000000FC545454D6000000FC444444E60000007C4444447C0000007E22223E207000007C44447C040600007C242020700000007C407C04FC0000207820202038000000CC4444447E000000CE44442838000000D65454547E000000C6281028C6000000CC44447C047C00007E4418227E00000E083008080E0000080808080808000070100C1010700000142800000000003C4299A1A199423C');
    // Extra glyphs + hard/short spaces live in the game (svision core fonts are ASCII + normal space).
    this.fonts.fonts5x5.addSpace('␣', {width: 2, breaking: false, stretch: true});

    this.fonts.zxFonts8x8.addSpace('␣', {width: 3, breaking: false, stretch: false});
    this.fonts.zxFonts8x8.addSpace('▭', {width: 4, breaking: false, stretch: false});

    // ★ The original's five keys, in the words of its own key window:
    // LEFT, RIGHT, UP, DOWN and FIRE — FIRE switches between the craft.
    // `M` and `P` are fixed in the program (SET KEYS) and remappable here only
    // because a browser keyboard is not a Spectrum's.
    this.controlsOptions = {
      keyboard: {
        device: 'keyboard',
        keys: [
          {action: 'left', label: 'LEFT'},
          {action: 'right', label: 'RIGHT'},
          {action: 'up', label: 'UP'},
          {action: 'down', label: 'DOWN'},
          {action: 'fire', label: 'FIRE'},
          {action: 'sounds', label: 'MUTE SOUNDS'},
          {action: 'pause', label: 'PAUSE'}
        ]
      },
      gamepads: {
        device: 'gamepads',
        keys: [
          {action: 'left', label: 'LEFT', eventKey: 'GamepadLeft'},
          {action: 'right', label: 'RIGHT', eventKey: 'GamepadRight'},
          {action: 'up', label: 'UP', eventKey: 'GamepadUp'},
          {action: 'down', label: 'DOWN', eventKey: 'GamepadDown'},
          {action: 'fire', label: 'FIRE', eventKey: 'GamepadFire'},
          // the buttons of the menu, the dialogs and the tape loading listen
          // to GamepadOK (like manicminer, jetsetwilly)
          {action: 'ok', label: 'OK', eventKey: 'GamepadOK'},
          {action: 'exit', label: 'EXIT', eventKey: 'GamepadExit'}
        ]
      },
      // ★ Touch controls are part of M1, not of a later milestone. That is the
      // lesson of Underwurlde, where they were put off and left a hole (M5b),
      // confirmed by Sabre Wulf and Jetpac.
      //
      // One half of the screen is a **stick**, the other the **FIRE** button
      // (★ the original's FIRE, which switches the craft). Which half is
      // which is the left-handed / right-handed choice in SETTINGS.
      touchscreen: {
        device: 'touchscreen',
        types: {
          // default is FIRE on the left and the stick on the right; the
          // first key is also the fallback for a broken cookie
          keys: [
            'leftFire',
            'rightFire'
          ],
          rightFire: {
            left: {half: 'stick', sprite: 'stick'},
            right: {half: 'fire', sprite: 'fire'}
          },
          leftFire: {
            left: {half: 'fire', sprite: 'fire'},
            right: {half: 'stick', sprite: 'stick'}
          }
        },
        // What each half does. `rect` is a fraction of that half
        // ([x, y, width, height]), so the layout does not depend on how big
        // the half happens to be — a phone gets the same thing upright and on
        // its side.
        halves: {
          // both axes, one direction at a time (gameModel.touchMove): the
          // original reads its keys through ROM KEY-SCAN, which returns one
          // key (disasm_notes.md §8); ? whether it takes Kempston diagonals
          // is M3
          stick: {
            icon: 'stick',
            zones: [
              {rect: [0, 0, 1, 1], type: 'joystick', control: 'both',
               actions: {left: 'left', right: 'right', up: 'up', down: 'down'}}
            ]
          },
          fire: {
            icon: 'fire',
            zones: [
              {rect: [0, 0, 1, 1], type: 'button', action: 'fire', tap: true}
            ]
          }
        },
        // A short tap has to be seen by the game, which reads its keys once
        // per pass of its main loop: ★ a pass takes up to 2.28 frames,
        // 46 ms (disasm_notes.md §4); the tap is held longer than that.
        tapHoldTime: 120,
        // how far the finger has to move before the stick changes direction
        joystickStep: 10,
        icons: {
          // the four arrows for the stick are a control glyph of the svision
          // family (the same one the sibling remakes use)
          stick: {
            compressedSpriteData: 'lP101300N0E2P0111030Z051012320B0P020N0601234561718191AB9BCDB1BDCB9BA19181716543210'
          },
          fire: {
            // ? **A plain button, on purpose.** Sabre Wulf puts its own sword
            // here and Lunar Jetman its own Jetman, because both had their
            // sprites out of the program by then. Thunderbirds' are M2 — the
            // two craft would be the natural picture, out of the program, not
            // drawn here. Until then a disc, on the same 39x23 canvas as the
            // stick so both icons take the same room.
            width: 39, height: 23, frames: 1, directions: 1,
            sprite: [[
              '---------------------------------------',
              '---------------------------------------',
              '---------------------------------------',
              '---------------##########--------------',
              '-------------##############------------',
              '------------################-----------',
              '-----------##################----------',
              '----------####################---------',
              '----------####################---------',
              '---------######################--------',
              '---------######################--------',
              '---------######################--------',
              '---------######################--------',
              '---------######################--------',
              '----------####################---------',
              '----------####################---------',
              '-----------##################----------',
              '------------################-----------',
              '-------------##############------------',
              '---------------##########--------------',
              '---------------------------------------',
              '---------------------------------------',
              '---------------------------------------'
            ]]
          }
        }
      }
    };

    this.controls = {
      keyboard: this.getControls('keyboard'),
      touchscreen: this.getControls('touchscreen'),
      gamepads: this.getControls('gamepads')
    };

    this.players = GameApp.PLAYERS[0];
    // ★ three figures on the panel when a mission starts; the counter is
    // $5CF4 (disasm_notes.md §7). ? Where the 3 is written is M4.
    this.lives = 3;
    this.score = 0;
    this.score2 = 0;
    this.hiScore = 0;
    this.player = 1;
    this.level = 0;
    // ★ the seed of the game's randomness is the state of SEED ($5C76), the
    // original's generator $F8BC, when the first room is drawn. null: the
    // original's own first mission (data/global.json — what the title's
    // sparkle left); after a game the state it left, carried on as the
    // machine does with a variable nobody resets. ? Whether the original
    // resets it between missions is M4.
    this.gameSeed = null;
    this.playerName = Tool.readCookie('playerName', '');
    this.globalData = false;
    this.id = 'GameApp';
    this.fetchDataId = '';
    this.setModel('LoadingModel');
    this.loadAppData();
  } // constructor

  getControls(device) {
    var result = {};

    switch (device) {
      case 'keyboard':
        // The defaults of the remake: the arrows and SPACE, as in the sibling
        // remakes (ZADANI chap. 7). ★ The original's own are 5 8 7 6 and A;
        // whoever wants them sets them in SETTINGS. ★ `M` (music) and `P`
        // (pause) are the original's.
        result = {left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp',
                  down: 'ArrowDown', fire: ' ', sounds: 'M', pause: 'P'};
        break;
      case 'touchscreen':
        result = {supported: false, type: 'leftFire'};
        break;
      case 'gamepads':
        result = {supported: false, devices: {}};
        break;
    }

    switch (device) {
      case 'keyboard':
      case 'touchscreen':
        var cfgString = Tool.readCookie(device, false);
        if (cfgString !== false) {
          try {
            var cfg = JSON.parse(cfgString);
            Object.keys(cfg).forEach((item) => {
              result[item] = cfg[item];
              if (device == 'touchscreen' && !(result[item] in this.controlsOptions.touchscreen.types)) {
                result[item] = this.controlsOptions.touchscreen.types.keys[0];
              }
            });
          } catch (error) {
            console.error(error.message);
          }
        }
        break;
      case 'gamepads':
        var devicesString = Tool.readCookie('gamepads', false);
        if (devicesString !== false) {
          try {
            var devices = JSON.parse(devicesString);
          } catch (error) {
            console.error(error.message);
          } finally {
            if (Array.isArray(devices)) {
              devices.forEach((id) => {
                var deviceString = Tool.readCookie(id, false);
                if (deviceString !== false) {
                  try {
                    var device = JSON.parse(deviceString);
                  } catch (error) {
                    console.error(error.message);
                  } finally {
                    result.devices[id] = device;
                  }
                }
              });
            }
          }
        }
        break;
    }
    return result;
  } // getControls

  setModel(model) {
    if (model == 'MenuModel' && this.globalData === false) {
      // the fetch may still be pending or has failed: as a last resort try the
      // data cached in localStorage before bothering the user
      if (!this.loadGlobalDataFromStorage()) {
        this.showErrorMessage('Game data could not be loaded.', 'retry');
        return;
      }
    }
    var needResizeApp = false;
    var selectionItem = 0;
    if (this.model) {
      // where to put the menu cursor on the way back (menuModel.menuItems)
      if (this.model.id == 'TapeLoadingModel') {
        selectionItem = 5;
      } else if (this.model.id == 'AboutModel') {
        selectionItem = 6;
      } else if (this.model.id == 'HallOfFameModel') {
        selectionItem = 2;
      }
      this.model.shutdown();
      needResizeApp = true;
    }
    switch (model) {
      case 'LoadingModel':
        this.model = new ZXResetModel(this);
        break;
      case 'MenuModel':
        this.model = new MenuModel(this, selectionItem);
        break;
      case 'AboutModel':
        this.model = new AboutModel(this);
        break;
      case 'HallOfFameModel':
        this.model = new HallOfFameModel(this);
        break;
      case 'GameModel':
        this.model = new GameModel(this);
        break;
      case 'GameOverModel':
        this.model = new GameOverModel(this, 'MenuModel');
        break;
      case 'TapeLoadingModel':
        this.model = new TapeLoadingModel(this);
        break;
    } // switch
    this.model.init();
    if (needResizeApp) {
      this.resizeApp();
    }
  } // setModel

  /**
   * How many players the game runs with. ★ The original offers one, so this
   * is here for the shape the sibling remakes share.
   * @param {number} [players] - 1.
   * @returns {number} The number of players in force.
   */
  setPlayers(players) {
    if (GameApp.PLAYERS.indexOf(players) >= 0) {
      this.players = players;
    }
    return this.players;
  } // setPlayers

  /**
   * Starts a new game.
   * @param {number} [players] - 1; without it the menu's choice stays.
   */
  startGame(players) {
    this.setPlayers(players);
    this.score = 0;
    this.score2 = 0;
    this.player = 1;
    this.level = 0;
    // ★ three figures on the panel when a mission starts
    this.lives = 3;
    // the seed is **not** renewed here: it goes on from the last game
    // (gameSeed in the constructor)
    this.setModel('GameModel');
  } // startGame

  applyGlobalData(global) {
    // ? **There is no data/global.json yet** — it is a snapshot of the
    // original's own variables and there is nothing measured to snapshot
    // (M2/M4). The server therefore sends null for it, which is not an error:
    // it is the honest answer while the question is open. Everything here has
    // to survive that, so that the menu comes up and LOAD TAPE works.
    var data = global || {};
    this.globalData = data;
    // ? whether the original has a hall of fame of its own is not measured
    // (ZADANI chap. 9), so a preset HI out of the game's data
    // would be the remake's invention — there is none until then
    if (data.hiScore && !this.hiScore) {
      this.hiScore = data.hiScore;
    }
  } // applyGlobalData

  setGlobalData(data) {
    this.applyGlobalData(data.data.global);

    var files = {};
    Object.keys(data.data).forEach((key) => {
      if (key == 'hiScore') {
        // the server's hall of fame wins over the game's preset one, but only
        // when somebody has actually beaten it
        this.hiScore = Math.max(this.hiScore || 0, data.data[key] || 0);
      } else if (key != 'global') {
        files[key] = data.data[key];
      }
    });
    // global goes last; a full localStorage is cleared and tried once more
    // (R-062)
    this.saveAppDataToStorage(files, data.data.global || {});
  } // setGlobalData

  // Load the application data: from the server when online (which also refreshes
  // localStorage), or rehydrate the global data from localStorage when offline.
  loadAppData() {
    if (navigator.onLine) {
      this.fetchDataId = this.fetchData('appData.db', false, {}, this, 2000);
    } else {
      this.loadGlobalDataFromStorage();
    }
  } // loadAppData

  loadGlobalDataFromStorage() {
    var stored = localStorage.getItem(window.appPrefix+'.global');
    if (stored !== null) {
      try {
        this.applyGlobalData(JSON.parse(stored));
        return true;
      } catch (error) {
        console.error(error.message);
      }
    }
    return false;
  } // loadGlobalDataFromStorage

  setData(data) {
    this.setGlobalData(data);
  } // setData

  errorData(error) {
    // The network request failed (offline, unreachable server, or the fetch
    // timeout). Fall back to the data cached in localStorage; if none exists,
    // log it and let the MenuModel guard surface the error to the user.
    if (!this.loadGlobalDataFromStorage()) {
      console.error(error.message ? error.message : error);
      return;
    }
    if (this.model && this.model.id == 'ZXResetModel'
        && !this.model.events.some((queued) => queued.id == 'setMenuModel')
        && !this.model.desktopEntity.modalEntity) {
      this.setModel('MenuModel');
    }
  } // errorData

  showErrorMessage(message, action) {
    var topModalEntity = this.model.desktopEntity.topModalEntity();
    topModalEntity.addModalEntity(
      new ZXErrorEntity(
        topModalEntity,
        -topModalEntity.absoluteX(),
        -topModalEntity.absoluteY(),
        this.fonts.zxFonts8x8,
        message,
        action,
        ZXColor.white,
        ZXColor.red
      )
    );
  } // showErrorMessage

} // GameApp
