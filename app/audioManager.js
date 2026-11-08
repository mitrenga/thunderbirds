const { AbstractAudioManager } = await import('./svision/js/audio/abstractAudioManager.js?ver='+window.srcVersion);
const { AudioWorkletHandler } = await import('./svision/js/audio/audioWorkletHandler.js?ver='+window.srcVersion);
const { AudioScriptProcessorHandler } = await import('./svision/js/audio/audioScriptProcessorHandler.js?ver='+window.srcVersion);
const { AudioSilentHandler } = await import('./svision/js/audio/audioSilentHandler.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
const { ZXMachineSounds } = await import('./svision/js/platform/canvas2D/zx/zxMachineSounds.js?ver='+window.srcVersion);
// begin code

/**
 * Audio manager. The original has a one-bit beeper on bit 4 of port $FE and no
 * sound chip, so every sound is a stream of pulse lengths played by the svision
 * pulse handlers — the same way the machine makes sound, not sampled.
 *
 * There is **one bus**, `sounds` (R-024): one slider, one bus, one
 * AudioContext. ? Whether Thunderbirds plays a tune and effects at once —
 * the condition R-024 reopens on — is M6.
 * ★ The title's interrupt plays the title tune and moves the running text
 * with its notes (disasm_notes.md §3), so the tune comes with the text.
 *
 * In the skeleton the only sound is the machine's: the key click of the ROM
 * (svision ZXMachineSounds) and the three blocks of the tape as data/tape.json
 * has them — each with its own pilot, sync pulses and bits (★ the turbo block
 * in the loader's timing: pilot 8179 × 2165 T, sync 714/714 T, bits
 * 673/1346 T) and the bytes it really carries.
 *
 * ? **The game's own sounds are M6 and nothing is faked until then.** When M6
 * reads the routines out of the program, this file gets a Beeper like the
 * siblings' — the routines run instruction by instruction and checked against
 * port $FE pulse for pulse — and `playFrame` starts making sound.
 */
export class AudioManager extends AbstractAudioManager {

  constructor(app) {
    super(app);
    this.id = 'AudioManager';
    this.volume = {};
    this.volume.sounds = Math.min(10, Math.max(0, Math.round(Number(Tool.readCookie('audioBusSoundsLevel', 5)))));
    // the beeper of the game itself arrives in M6 (see the class comment)
    this.beeper = null;
  } // constructor

  /**
   * Reads a data file delivered with appData; see {@link Tool.loadDataFile}.
   * @param {string} key - The data file name without its extension.
   * @returns {Object|null} The parsed content, or null.
   */
  loadDataFile(key) {
    // through the model: a file its loadDataFiles() had to get from the
    // server is there, not in localStorage (R-062)
    var model = this.app.model;
    return model && model.loadDataFile ? model.loadDataFile(key) : Tool.loadDataFile(key);
  } // loadDataFile

  /**
   * One block of the tape as it sounds: the pilot, the two sync pulses, every
   * bit of the bytes the block carries and the terminating pulse — in the
   * block's own timing out of data/tape.json (tools/mktape.py), played by
   * svision's ZXMachineSounds.tapeBlock.
   *
   * Three events come with it, and the tape loading lives off them rather
   * than off a timer, so the picture and the stripes cannot drift away from
   * the sound:
   *
   * - `tapePilotEnd` when the pilot is over — the stripes change,
   * - `tapeByte` after every byte of the picture (`pictureBytes` of the
   *   block), with its offset in the video memory (`at`) and its value **as
   *   it goes down the tape** — tapeLoadingModel mirrors it, as the loader's
   *   own LD-BYTES does,
   * - `tapeBlockEnd` when the block is over — the tape moves on.
   *
   * Nothing is sped up: the picture takes the 33 seconds it takes on the
   * machine. The turbo block is cut after its first part (data/tape.json,
   * ZADANI chap. 10).
   *
   * @param {number} sampleRate - The audio context sample rate.
   * @param {number} level - Bus volume level.
   * @param {number} number - The block, 1-3 in the order of the tape.
   * @returns {Object|boolean} svision pulse data, or false with no data file.
   */
  tapeBlockSound(sampleRate, level, number) {
    var tape = this.loadDataFile('tape');
    if (!tape || !tape.blocks || !tape.blocks[number-1]) {
      return false;
    }
    var block = tape.blocks[number-1];
    var bytes = ZXMachineSounds.dataBytes(block.bytes);
    var options = {pilotEndEvent: 'tapePilotEnd', endEvent: 'tapeBlockEnd',
                   eventData: {block: number}};
    if (block.pictureBytes) {
      Object.assign(options, {byteEvent: 'tapeByte', firstEventByte: block.pictureBytes[0],
                              lastEventByte: block.pictureBytes[1]});
    }
    return ZXMachineSounds.tapeBlock(sampleRate, level, block, bytes, options);
  } // tapeBlockSound

  createAudioHandler(bus, options) {
    var audioHandler = false;

    var volume = 0.0;
    switch (bus) {
      case 'sounds':
      case 'extra':
        volume = this.volumeLevel(this.volume.sounds);
        break;
    }

    if (options.audioSilentHandler != 'disable' && volume == 0.0) {
      return new AudioSilentHandler(this.app);
    }

    if (this.unsupportedAudioBus == false) {
      this.unsupportedAudioBus = Tool.readCookie('unsupportedAudioBus', false);
    }

    switch (this.unsupportedAudioBus) {
      case false:
        audioHandler = new AudioWorkletHandler(this.app);
        break;
      case 'AudioWorkletHandler':
        Tool.writeCookie('unsupportedAudioBus', 'AudioWorkletHandler');
        audioHandler = new AudioScriptProcessorHandler(this.app);
        break;
      case 'AudioScriptProcessorHandler':
        Tool.writeCookie('unsupportedAudioBus', 'AudioScriptProcessorHandler');
        audioHandler = new AudioSilentHandler(this.app);
        break;
    }

    if (bus in this.restartSounds) {
      this.app.model.sendEvent(1, {id: 'playSound', bus: bus, sound: this.restartSounds[bus].sound, options: this.restartSounds[bus].options});
    }

    return audioHandler;
  } // createAudioHandler

  audioData(bus, sound, options) {
    var data = super.audioData(bus, sound, options);
    if (data !== false) {
      return data;
    }

    var sampleRate = this.getSampleRate();
    var level = this.volumeLevel(this.volume.sounds);
    var tapeBlock = /^tapeBlock(\d+)$/.exec(sound);
    if (tapeBlock) {
      return this.tapeBlockSound(sampleRate, level, Number(tapeBlock[1]));
    }
    switch (sound) {
      case 'keyboardSound': return ZXMachineSounds.keyClick(sampleRate, level);
    }
    // ? the game's own sounds are M6: until they are read out of the
    // program there is nothing to answer with, and nothing invents one
    return false;
  } // audioData

  volumeLevel(volume) {
    var levels = [0, 0.005, 0.01, 0.02, 0.04, 0.07, 0.1, 0.14, 0.18, 0.23, 0.29];
    return levels[volume];
  } // volumeLevel

  /**
   * One worker frame: what the game did in it, as sound.
   *
   * ? **M1 plays nothing.** The worker sends no sound events yet, because
   * which routine the game calls when is M6. The hook stays so that M6 has
   * somewhere to land, and so that the shape of the protocol
   * (WORKER-PROTOCOL.md) does not change under it.
   * @param {Object} frame - The 'frame' message from the worker.
   */
  playFrame(frame) {
  } // playFrame

} // AudioManager
