const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * ABOUT GAME as a screen of its own — the heading of the menu
 * (ScreenComposer.composeMenu, or the remake's provisional one until M1) with
 * the about text and its buttons under it, where the menu has its items.
 *
 * ? **Silent until M6.** Whether the original has a tune is not measured,
 * and nothing is played in its place.
 *
 * The title bar keeps the dialog's counter: five clicks on it show the game
 * statistics from the server, five more the system information, five more the
 * text again. CLOSE (Escape, GamepadExit) goes back to the menu, MORE INFO
 * (Enter, GamepadOK) opens the about page.
 */
export class AboutModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'AboutModel';

    this.screenEntity = null;
    this.gameInfoEntity = null;
    this.titleEntity = null;
    this.subtitleEntity = null;
    this.aboutEntity = null;

    // the about panel over the title, where the dialogs of the
    // menu open (menuModel.js): cells 4-27, from y 50 down to 176
    this.panelX = 32;
    this.panelY = 50;
    this.panelWidth = 192;
    this.panelHeight = 126;
    this.panelBkColor = ZXColor.black;

    this.aboutText = 'THUNDERBIRDS IS A REMAKE OF THE 1985 FIREBIRD GAME FOR THE ZX SPECTRUM, BASED ON THE TELEVISION SERIES.\n' +
                    'INTERNATIONAL RESCUE IS CALLED OUT, AND TWO OF ITS CRAFT HAVE TO WORK THEIR WAY THROUGH ' +
                    'THE MAZE BY TURNS, EACH CLEARING THE WAY FOR THE OTHER.\n' +
                    'THE REMAKE IS IN ITS EARLY STAGES: THE ORIGINAL IS BEING TAKEN APART FIRST.\n' +
                    'THE HIGH SCORES ARE KEPT IN THE HALL OF FAME ON THE SERVER.';
    this.statsText = 'error:\nstatistics data not available!';
    this.clickCounter = 0;
  } // constructor

  newBorderEntity() {
    // no X in the border: CLOSE and the ESC of the panel go back to the menu
    return new BorderEntity(false, false);
  } // newBorderEntity

  init() {
    super.init();

    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    // ★ the first frame of the original's title under the panel
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

    // the about text and the buttons, over the middle of the frame
    this.aboutEntity = new AbstractEntity(this.desktopEntity, this.panelX, this.panelY, this.panelWidth, this.panelHeight, false, ZXColor.black);
    this.desktopEntity.addEntity(this.aboutEntity);
    var w = this.panelWidth, h = this.panelHeight;
    this.aboutEntity.addEntity(new ButtonEntity(this.aboutEntity, this.app.fonts.fonts5x5, 0, 0, w, 9, 'ABOUT GAME', {id: 'clickLabel'}, [], ZXColor.brightRed, false, {align: 'center', topMargin: 2, member: 'titleBar', hoverColor: ZXColor.black, clickColor: ZXColor.black}));
    this.aboutEntity.addEntity(new AbstractEntity(this.aboutEntity, 1, 9, w-2, h-10, false, this.panelBkColor));
    this.aboutEntity.addEntity(new TextEntity(this.aboutEntity, this.app.fonts.fonts5x5, 1, 9, w-2, h-25, this.aboutText, ZXColor.brightWhite, false, {align: 'justify', textWrap: true, margin: 2, member: 'aboutText'}));
    this.aboutEntity.addEntity(new ButtonEntity(this.aboutEntity, this.app.fonts.fonts5x5, 3, h-16, 54, 13, 'MORE INFO', {id: 'openAboutURL'}, ['Enter', 'GamepadOK'], ZXColor.brightWhite, ZXColor.green, {align: 'center', margin: 4}));
    this.aboutEntity.addEntity(new ButtonEntity(this.aboutEntity, this.app.fonts.fonts5x5, w-39, h-16, 36, 13, 'CLOSE', {id: 'closeAbout'}, ['Escape', 'GamepadExit'], ZXColor.brightWhite, ZXColor.blue, {align: 'center', margin: 4}));

    this.fetchData('stats.db', false, {});

    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
  } // init

  setData(data) {
    this.statsText = '';
    Object.entries(data.data).forEach(([periodKey, periodValue]) => {
      this.statsText += periodKey + ': [';
      Object.entries(periodValue).forEach(([key, value]) => {
        this.statsText += key + ':' + value + ', ';
      });
      this.statsText = this.statsText.slice(0, -2) + ']\n';
    });
  } // setData

  errorData(error) {
  } // errorData

  /**
   * Switches the panel between the about text, the statistics and the system
   * information, by the count of clicks on the title bar.
   * @returns {void}
   */
  updateAbout() {
    switch (Math.floor(this.clickCounter/5)) {
      case 1:
        this.sendEvent(0, {id: 'updateEntity', member: 'titleBar', text: 'GAME STATS'});
        this.sendEvent(0, {id: 'updateEntity', member: 'aboutText', text: this.statsText});
        break;
      case 2:
        this.sendEvent(0, {id: 'updateEntity', member: 'titleBar', text: 'SYSTEM INFO'});
        var ipLabelSeparator = ' ';
        if (window.clientIP.indexOf(':') >= 0) {
          ipLabelSeparator = '\n';
        }
        var sysInfoText =
          'version: ' + this.app.version + '\n' +
          'element: ' + this.app.element.clientWidth + ' x ' + this.app.element.clientHeight + '\n' +
          'canvas: ' + this.app.element.width + ' x ' + this.app.element.height + '\n' +
          'ratio: ' + this.app.layout.ratio + '\n' +
          'ip:' + ipLabelSeparator + window.clientIP + '\n';
        this.sendEvent(0, {id: 'updateEntity', member: 'aboutText', text: sysInfoText});
        break;
      default:
        this.sendEvent(0, {id: 'updateEntity', member: 'titleBar', text: 'ABOUT GAME'});
        this.sendEvent(0, {id: 'updateEntity', member: 'aboutText', text: this.aboutText});
        break;
    }
  } // updateAbout

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;

      case 'closeAbout':
        this.app.setModel('MenuModel');
        return true;

      case 'openAboutURL':
        window.location.href = 'about';
        return true;

      case 'clickLabel':
        if (this.clickCounter < 14) {
          this.clickCounter++;
        } else {
          this.clickCounter = 0;
        }
        if (this.clickCounter%5 == 0) {
          this.updateAbout();
        }
        return true;

      case 'resizeModel':
        if (this.clickCounter > 9) {
          this.updateAbout();
        }
        return false;

    }

    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }

    this.drawModel();
  } // loopModel

} // AboutModel
