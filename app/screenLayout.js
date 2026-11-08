// begin code

/**
 * Geometry of the Thunderbirds screen, measured on the original rather than
 * off a photograph (sources/docs/screen_layout.md).
 *
 * The screen is the plain ZX Spectrum one: 256x192 pixels, attributes in 8x8
 * cells.
 *
 * ★ Measured on the take-off scene and on the first room of the maze
 * (tools/playtrace.py, tools/mkscreen.py): character rows 0-19 are the play
 * area (256 x 160 px), rows 20-23 the panel — SCORE and HIGH on row 20, the
 * lives on row 21, the item carried and TIME on row 22, the fuel gauge on
 * row 23, the Firebird logo in columns 22-31. The panel rows have the same
 * attributes in both.
 */
export const ScreenLayout = {

  WIDTH: 256,
  HEIGHT: 192,

  CELL: 8,
  COLS: 32,
  ROWS: 24,

  // ★ rows 0-19: the play area
  PLAY_ROW: 0,
  PLAY_ROWS: 20,

  // ★ rows 20-23: the panel
  PANEL_ROW: 20,
  PANEL_ROWS: 4,

  // what is behind everything until the composer has drawn: black
  ATTR_SCREEN: 0x00,

  // ★ The title: the band of the running text is character row 22, columns
  // 1-31 ($C21E / $C233 save and restore $50C1, 31 bytes, 8 lines).
  TITLE_BAND: {row: 22, col: 1, cols: 31},

  // The remake's menu sits in a window over the original's title, in the
  // colours of the original's own window — YOUR KEYS / SET KEYS, the one `R`
  // opens over the title (★ sources/media/screens/define_keys.scr): $3F for
  // the frame (white on white), $17 for the heading bar (white on red, its
  // `SET KEYS`) and $38 for the lines (black on white). ? The window's size
  // and place are the remake's: the original's window holds keys, not a
  // menu, and spans rows 3-19 in two parts.
  MENU_WINDOW: {col: 4, row: 2, cols: 24, rows: 19},
  MENU_HEADING: {col: 6, row: 3, cols: 20},
  MENU_ITEMS: {col: 6, row: 5, pitch: 2},
  MENU_VERSION_ROW: 19,
  ATTR_WINDOW: 0x3F,
  ATTR_HEADING: 0x17,
  ATTR_LINE: 0x38,

  // 50.08 Hz — 69888 T states per frame on the 3.5 MHz Z80 of the 48K
  // machine (★ 48K, sources/docs/hw_notes.md).
  //
  // ★ This is the rate of the ULA interrupt, which drives the IM 2 handler
  // ($A398 in the game). It is **not** the rate of the game: the main loop
  // at $E299 does not wait for the frame, one pass takes 0.66-2.28 frames,
  // 0.95 on average (disasm_notes.md §4). Everything measured is written
  // down per pass, never per frame.
  FRAME_RATE: 3500000/69888

}; // ScreenLayout
