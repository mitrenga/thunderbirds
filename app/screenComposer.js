const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
// begin code

/**
 * Builds the Thunderbirds screen — all 6912 bytes of it — out of what the
 * original drew.
 *
 * What the machine is (the video memory, the ULA's interleaved addressing,
 * `poke`/`peek`, turning bytes plus attributes into pixels) is svision's
 * ZXVideoRAM (R-003). What is left here is the game's own drawing.
 *
 * ★ **The title is the program's, not a photograph.** data/screen.json
 * `title` is the first frame `$C1EF` draws: the picture at $A673, every $37
 * in its first 4096 bytes replaced by a number of the generator $F8BC from
 * SEED $0000 (130 calls — the sparkle on the water), and the band of the
 * running text empty (tools/mkscreen.py). tools/matchscreen.mjs checks it
 * against the screen of the simulator right after `CALL $C1EF`.
 *
 * ? The running text and the sparkle are not animated yet. The title's
 * interrupt plays the whole title tune and moves the text two pixels a note
 * (disasm_notes.md §3), so the text runs at the speed of the tune — M6. The
 * sparkle is redrawn by the title's main loop ($C58E) from the generator,
 * whose state then decides the game's — M4 (ZADANI chap. 10).
 *
 * ★ **The game screen is the game's own video memory** (M3): the worker
 * runs the port of the original (app/thunderbirdsLogic.js over
 * app/roomRenderer.js), which keeps the screen at $4000 of its 64 K as the
 * machine does, and sends its 6912 bytes whenever a pass has drawn. The
 * start of a mission is composed out of the program's data (M2, checked by
 * tools/matchscreen.mjs), every pass after it by tools/matchphysics.mjs.
 *
 * Free of DOM dependencies, so the offline tools render with this very code
 * (R-001).
 */
export class ScreenComposer {

  /**
   * @param {Object} scene - The parsed data/screen.json (the title).
   */
  constructor(scene) {
    if (!scene || !scene.title) {
      throw new Error('game data missing (data/screen.json)');
    }
    // base64, as ZXVideoRAM.restore takes it
    this.title = scene.title.videoRAM;
    // the last screen the worker sent: a frame without one keeps it
    this.game = null;
  } // constructor

  /**
   * The first frame of the original's title.
   * @param {ZXVideoRAM} videoRAM - The video memory to draw into.
   */
  composeTitle(videoRAM) {
    videoRAM.restore(this.title);
    return videoRAM;
  } // composeTitle

  /**
   * The whole game screen: the 6912 bytes of the game's video memory the
   * worker sent last (a frame without `screen` changed nothing on it).
   * @param {ZXVideoRAM} videoRAM - The video memory to draw into.
   * @param {Object} [state] - The 'frame' message of the worker.
   */
  composeInto(videoRAM, state) {
    if (state && state.screen) {
      this.game = state.screen;
    }
    if (this.game) {
      videoRAM.restore(this.game);
    } else {
      videoRAM.clear(0, 0);
    }
    return videoRAM;
  } // composeInto

  /**
   * The screen the menu sits on: the original's title with a window in the
   * colours of the original's own key window (ScreenLayout.MENU_WINDOW).
   * The texts are entities over it (menuModel.js).
   * @param {ZXVideoRAM} videoRAM - The video memory to draw into.
   */
  composeMenu(videoRAM) {
    this.composeTitle(videoRAM);
    var w = ScreenLayout.MENU_WINDOW, heading = ScreenLayout.MENU_HEADING;
    videoRAM.clearArea(w, ScreenLayout.ATTR_WINDOW);
    videoRAM.clearArea({col: heading.col, row: heading.row, cols: heading.cols, rows: 1},
                       ScreenLayout.ATTR_HEADING);
    var first = ScreenLayout.MENU_ITEMS.row;
    videoRAM.clearArea({col: w.col+1, row: first, cols: w.cols-2,
                        rows: ScreenLayout.MENU_VERSION_ROW+1-first}, ScreenLayout.ATTR_LINE);
    return videoRAM;
  } // composeMenu

  /**
   * The screen the hall of fame and the about page sit on: the title.
   * @param {ZXVideoRAM} videoRAM - The video memory to draw into.
   */
  clearScreen(videoRAM) {
    this.composeTitle(videoRAM);
  } // clearScreen

} // ScreenComposer
