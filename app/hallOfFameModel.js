const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { SlidingTextEntity } = await import('./svision/js/platform/canvas2D/slidingTextEntity.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * HALL OF FAME as a screen of its own — the same shape as aboutModel.js: the
 * heading of the menu with the table under it. Silent, like
 * the menu.
 *
 * ? **Whether the original has a hall of fame of its own is not measured**
 * (ZADANI chap. 9); ★ its panel keeps a HIGH and no names. Until the program is read,
 * this table is **the remake's**: six places, 1ST to 6TH, scores off the
 * server — and what a score is in Thunderbirds is M4. If the original has a table, its heading, its places and its default
 * entries replace these; if it has none, this screen is a recorded deviation
 * (ZADANI chap. 10).
 *
 * A row is place, score and name, and a name too long for its column
 * ping-pongs (SlidingTextEntity), the way the player's name does in the menu.
 *
 * CLOSE (Enter, Escape, space, GamepadOK, GamepadExit) goes back to the menu.
 */
export class HallOfFameModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'HallOfFameModel';

    this.screenEntity = null;
    this.gameInfoEntity = null;
    this.titleEntity = null;
    this.subtitleEntity = null;
    this.tableEntity = null;
    this.rowEntities = [];
    // the names, ticked from loopModel(): a name too long for its column ping-pongs
    this.nameEntities = [];

    // the table under the original's heading, where the dialogs of the menu
    // open (menuModel.js): cells 4-27, from y 50 down to 176
    this.panelX = 32;
    this.panelY = 50;
    this.panelWidth = 192;
    this.panelHeight = 126;

    // ? the remake's places, as in the sibling remakes
    this.places = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'];
  } // constructor

  newBorderEntity() {
    // no X in the border: CLOSE goes back to the menu
    return new BorderEntity(false, false);
  } // newBorderEntity

  init() {
    super.init();

    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    // the original's own menu heading above the table
    // from localStorage at once, or from the server when it is missing there
    // (R-062)
    this.loadDataFiles(['screen'], () => {
      if (this.app.model !== this) {
        return;
      }
      this.screenEntity = GameAreaEntity.panelScreen(this);
      if (!this.screenEntity) {
        this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 1*8, this.desktopWidth, 8, 'THUNDERBIRDS', ZXColor.brightWhite, false, {align: 'center'}));
      }
    });

    // the table, over the middle of the frame, all on the black of the
    // tableEntity itself: the heading, the CLOSE button and the six places
    // drawn by showTable()
    this.tableEntity = new AbstractEntity(this.desktopEntity, this.panelX, this.panelY, this.panelWidth, this.panelHeight, false, ZXColor.black);
    this.desktopEntity.addEntity(this.tableEntity);
    var w = this.panelWidth, h = this.panelHeight;
    // the heading in the title bar every panel of the game has (aboutModel.js,
    // the dialogs of menuModel.js): fonts5x5, bright red, 9 px from the top
    // with a 2 px margin, centred; the text is the remake's, see above
    this.tableEntity.addEntity(new TextEntity(this.tableEntity, this.app.fonts.fonts5x5, 0, 0, w, 9, 'HALL OF FAME', ZXColor.brightRed, false, {align: 'center', topMargin: 2}));
    this.tableEntity.addEntity(new ButtonEntity(this.tableEntity, this.app.fonts.fonts5x5, w-39, h-16, 36, 13, 'CLOSE', {id: 'closeHallOfFame'}, ['Enter', 'Escape', ' ', 'GamepadOK', 'GamepadExit'], ZXColor.brightWhite, ZXColor.blue, {align: 'center', margin: 4}));

    if (navigator.onLine) {
      this.fetchData('hallOfFame.db', false, {});
    } else {
      this.showTable(this.defaultTable(), true);
    }

    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
  } // init

  /**
   * ? The original's own table, if it turns out to have one — it would come
   * out of data/global.json (M2/M4). Until then this is empty on purpose:
   * an invented set of names and scores presented as the game's would be
   * exactly the kind of thing this project does not do.
   * @returns {Array} [{name, score}], empty while the question is open.
   */
  defaultTable() {
    var global = this.app.globalData;
    if (global && global.hallOfFame && global.hallOfFame.defaults) {
      return global.hallOfFame.defaults;
    }
    return [];
  } // defaultTable

  setData(data) {
    var rows = Object.keys(data.data).map((key) => data.data[key]);
    if (!rows.length) {
      // nobody has played yet: show the table the original ships with
      this.showTable(this.defaultTable(), true);
      return;
    }
    this.showTable(rows, false);
    if (rows[0]) {
      this.app.hiScore = Number(rows[0].score);
    }
  } // setData

  errorData(error) {
    this.showTable(this.defaultTable(), true);
  } // errorData

  /**
   * Draws the six places.
   * @param {Array} rows - [{name, score}] in descending order of score.
   * @param {boolean} original - True when these are the original's own entries.
   */
  showTable(rows, original) {
    this.rowEntities.forEach((entity) => entity.destroy());
    this.rowEntities = [];
    this.nameEntities = [];
    var w = this.panelWidth, h = this.panelHeight;
    // the places in pairs, from the top down in the colours of the panel:
    // white, yellow, cyan — on black; 6 px between the rows
    var colors = [ZXColor.brightWhite, ZXColor.brightWhite, ZXColor.brightYellow, ZXColor.brightYellow, ZXColor.brightCyan, ZXColor.brightCyan];
    for (var i = 0; i < this.places.length; i++) {
      var y = 22+i*14;
      var row = rows[i];
      var color = colors[i];
      var place = new TextEntity(this.tableEntity, this.app.fonts.zxFonts8x8, 4, y, 26, 8, this.places[i], color, false, {align: 'right'});
      this.tableEntity.addEntity(place);
      this.rowEntities.push(place);
      // place (right-aligned in 26 px), 8 px, the six digits of the score
      // (48 px mono), 8 px, the name flush right in what is left of the row
      var score = new TextEntity(this.tableEntity, this.app.fonts.zxFonts8x8Mono, 38, y, 48, 8, row ? String(row.score).padStart(6, '0') : '', color, false, {});
      this.tableEntity.addEntity(score);
      this.rowEntities.push(score);
      var name = new SlidingTextEntity(this.tableEntity, this.app.fonts.zxFonts8x8, 94, y, w-94-4, 8, row ? String(row.name) : '', color, false, {align: 'right', animation: 'pingPong', speed: 30});
      this.tableEntity.addEntity(name);
      this.rowEntities.push(name);
      this.nameEntities.push(name);
    }
    if (original) {
      var note = new TextEntity(this.tableEntity, this.app.fonts.fonts5x5, 4, h-16, w-48, 12,
        navigator.onLine ? 'NOBODY HAS PLAYED YET' : 'SYSTEM OFFLINE',
        ZXColor.brightRed, false, {textWrap: true, margin: 1});
      this.tableEntity.addEntity(note);
      this.rowEntities.push(note);
    }
  } // showTable

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;

      case 'closeHallOfFame':
        this.app.setModel('MenuModel');
        return true;

    }

    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    } else {
      // entities are not ticked on their own: the long names ping-pong only
      // when the model advances them, as the menu does with the player's name
      this.nameEntities.forEach((entity) => entity.loopEntity(timestamp));
    }

    this.drawModel();
  } // loopModel

} // HallOfFameModel
